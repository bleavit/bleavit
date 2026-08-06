#!/usr/bin/env node
/**
 * `pnpm run check:embedded-tree` — the F22 CI gate (10 §10.1; 12 §1).
 *
 * Runs the two legs `embedded-tree.ts` describes, over the tree `release:build` just
 * produced and the `tauri.conf.json` the shell will be built from:
 *
 * 1. the built `dist/` is byte-for-byte what `release-out/release.json` pins, in **both**
 *    directions — a pinned file that is not in the tree, a tree file nothing pinned, and any
 *    digest that differs;
 * 2. the shell embeds that tree and does not rewrite it.
 *
 * ## `--witness`
 *
 * A gate proven only by a green run is not proven. The witness leg copies the real tree,
 * mutates it in the three ways the comparison must catch — one byte changed, one file
 * removed, one file added — and requires a refusal for each, plus a negative control (the
 * untouched copy must pass). It also drives the empty-tree and empty-manifest paths, because
 * those are the ones whose failure mode is a green run over nothing.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_FRONTEND_DIST,
  EmbeddedTreeError,
  assertEmbeddedTree,
  checkShellConfig,
  readTree,
} from './embedded-tree.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../..');
const DIST = join(APP_ROOT, 'dist');
const RELEASE_JSON = join(APP_ROOT, 'release-out/release.json');
const SHELL_CONFIG = join(APP_ROOT, 'src-tauri/tauri.conf.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new EmbeddedTreeError(
      `${path} is missing. The desktop shell attests the built release, so this gate runs ` +
        'after `pnpm run release:build`.',
    );
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new EmbeddedTreeError(`${path} did not parse to a JSON object`);
  return parsed;
}

function checkOnce(distDir: string, releaseDocument: unknown): string[] {
  const problems: string[] = [];
  const verdict = assertEmbeddedTree(releaseDocument, readTree(distDir));
  for (const finding of verdict.selfCheck.findings) {
    problems.push(`${finding.kind}: ${finding.path} — ${finding.detail}`);
  }
  if (problems.length === 0) {
    console.log(
      `embedded tree: ${verdict.selfCheck.verifiedCount}/${verdict.selfCheck.pinnedCount} pinned ` +
        `file(s) verified over a tree of ${verdict.treeSize}`,
    );
  }
  return problems;
}

function runGate(): number {
  const releaseDocument = readJson(RELEASE_JSON);
  let problems: string[];
  try {
    problems = checkOnce(DIST, releaseDocument);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const configFindings = checkShellConfig(readJson(SHELL_CONFIG), EXPECTED_FRONTEND_DIST);
  for (const finding of configFindings) {
    problems.push(`src-tauri/tauri.conf.json: ${finding.key} ${finding.detail}`);
  }
  if (configFindings.length === 0) {
    console.log('desktop shell config: embeds the attested tree and rewrites nothing');
  }

  if (problems.length > 0) {
    console.error(
      '\nFAIL — the desktop shell would not embed the attested release tree:\n' +
        problems.map((line) => `  - ${line}`).join('\n'),
    );
    return 1;
  }
  return 0;
}

/** Expect a refusal, and say which case failed to produce one. */
function mustRefuse(what: string, body: () => void): string | undefined {
  try {
    body();
  } catch {
    return undefined;
  }
  return `${what}: no refusal — the comparison cannot detect this`;
}

function runWitness(): number {
  const releaseDocument = readJson(RELEASE_JSON);
  const scratch = mkdtempSync(join(tmpdir(), 'bleavit-f22-witness-'));
  const failures: string[] = [];
  try {
    // Negative control first. If an untouched copy does not pass, the mutations below prove
    // nothing — every one of them would "fire" for a reason that has nothing to do with the
    // mutation.
    const control = join(scratch, 'control');
    cpSync(DIST, control, { recursive: true });
    if (checkOnce(control, releaseDocument).length !== 0) {
      failures.push('negative control: an untouched copy of dist/ did not verify');
    }

    /**
     * Require a mutation to be caught **by the self-check, as a finding of the named kind**.
     *
     * Accepting "it threw, or it reported something" is what let this witness go vacuous
     * once: `assertPublishable` throws on the first key-set or digest disagreement, so with
     * it running first every mutation below was caught by the *wrong* leg — and the witness
     * stayed green with `runSelfCheck` replaced by a hardcoded clean verdict. Measured, not
     * reasoned. A throw is therefore a **failure** here, and so is a finding of another kind:
     * both mean the three-way comparison this milestone is about did not decide the case.
     */
    const mutate = (name: string, kind: string, apply: (dir: string) => void): void => {
      const dir = join(scratch, name);
      cpSync(DIST, dir, { recursive: true });
      apply(dir);
      let findings: string[];
      try {
        findings = checkOnce(dir, releaseDocument);
      } catch (error) {
        failures.push(
          `${name}: refused by a leg that is not the self-check, so the self-check is ` +
            `unproven here (${error instanceof Error ? error.message : String(error)})`,
        );
        return;
      }
      if (findings.length === 0) {
        failures.push(`${name}: the comparison reported no problem`);
        return;
      }
      if (!findings.every((finding) => finding.startsWith(`${kind}:`))) {
        failures.push(`${name}: expected only \`${kind}\` finding(s), got ${findings.join('; ')}`);
      }
    };

    // The three directions `runSelfCheck` distinguishes. Each is mutated on its own copy,
    // because a single tree carrying all three would be caught by whichever check runs first
    // and would prove nothing about the other two.
    mutate('changed', 'changed', (dir) => {
      const index = join(dir, 'index.html');
      writeFileSync(index, `${readFileSync(index, 'utf8')}<!-- tampered -->`);
    });
    mutate('missing', 'missing', (dir) => {
      rmSync(join(dir, 'index.html'));
    });
    mutate('unexpected', 'unexpected', (dir) => {
      writeFileSync(join(dir, 'payload.js'), 'globalThis.x = 1;\n');
    });

    // The vacuity paths. An empty tree and a manifest pinning nothing are the two inputs over
    // which a comparison reports success having compared nothing.
    const vacuity: readonly (readonly [string, () => void])[] = [
      ['empty tree', (): void => void assertEmbeddedTree(releaseDocument, new Map())],
      [
        'manifest pinning no files',
        (): void =>
          void assertEmbeddedTree({ ...releaseDocument, perFileHashes: {} }, readTree(control)),
      ],
      [
        'a directory that is not there at all',
        (): void => void readTree(join(scratch, 'nothing-here')),
      ],
      // The publishability leg, which the three mutations above deliberately no longer reach:
      // it now runs only over a tree that already matched, so this is the one case that
      // exercises it. Without it that leg would be as unproven as the self-check was.
      [
        'a hash map that is not a release record',
        (): void =>
          void assertEmbeddedTree(
            { perFileHashes: (readJson(RELEASE_JSON) as { perFileHashes: unknown }).perFileHashes },
            readTree(control),
          ),
      ],
      [
        'a release record with no source commit',
        (): void =>
          void assertEmbeddedTree({ ...releaseDocument, sourceCommit: null }, readTree(control)),
      ],
    ];
    for (const [what, body] of vacuity) {
      const failure = mustRefuse(what, body);
      if (failure !== undefined) failures.push(failure);
    }

    // The shell-config leg, witnessed on its own: a configured CSP makes Tauri rewrite every
    // embedded HTML file, which is exactly the case a green byte-identity claim would hide.
    const configCases: Readonly<Record<string, unknown>> = {
      'a CSP that rewrites index.html': {
        build: { frontendDist: EXPECTED_FRONTEND_DIST },
        app: { security: { csp: "default-src 'none'" } },
      },
      'a dev server serving app code': {
        build: { frontendDist: EXPECTED_FRONTEND_DIST, devUrl: 'http://localhost:5173' },
      },
      'a different embedded tree': { build: { frontendDist: '../somewhere-else' } },
    };
    for (const [name, config] of Object.entries(configCases)) {
      if (checkShellConfig(config, EXPECTED_FRONTEND_DIST).length === 0) {
        failures.push(`shell config witness "${name}": reported no problem`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(
      'WITNESS FAILED — the embedded-tree gate cannot detect:\n' +
        failures.map((line) => `  - ${line}`).join('\n'),
    );
    return 1;
  }
  console.log('witness fired on every mutation: the embedded-tree gate is live');
  return 0;
}

process.exit(process.argv.includes('--witness') ? runWitness() : runGate());
