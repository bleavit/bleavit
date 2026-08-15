#!/usr/bin/env node
/**
 * The reproducibility manifest — 12 §1.1, §1.3; INV-FE-10; 15 §4.8's release-gate row (F13).
 *
 * 12 §1.1: *"Two independent CI environments MUST produce an identical tree hash."* Both
 * `release:build` runs already happened on independent runners — the `app` job and the
 * `desktop-shell` job — and **nothing compared them**, because neither published anything a
 * comparison could read. This is what each one publishes.
 *
 * ## Why a manifest of digests and not the tree
 *
 * The comparison consumes per-file digests, so uploading the tree would upload megabytes to
 * derive kilobytes. It also reads badly on the day it fails: a diff of two binary chunk
 * bundles says "these differ", while a digest map says *which path* differs, which is the
 * only sentence that helps the person who has to fix it.
 *
 * ## What is in the map, and why `release-out/` is in it too
 *
 * 12 §1.1 names the build's output as `dist/` **plus** `release.json` **plus**
 * `sbom.cdx.json`. All three are covered here, under prefixed paths (`dist/…`,
 * `release-out/…`), so the claim is about the release rather than about the asset tree
 * alone. `release.json` is the file that carries every pin a verifier re-derives, and an
 * SBOM that differed between two builders would be the one file undermining the recipe the
 * other two prove — the pipeline already strips its timestamp and serial number for exactly
 * that reason, and this is the gate that would notice if either came back.
 *
 * The manifest itself is never in its own map: a file cannot hash itself.
 *
 * ## Environment facts are recorded to be **different**, not equal
 *
 * Every other manifest in this repository records facts that must agree. These must not: a
 * "two-environment" gate whose two environments are one environment proves that a build is
 * repeatable on the same machine, which is a far weaker claim than 12 §1.1's and is
 * indistinguishable from it in a green log. So the axes that could plausibly change the
 * emitted bytes are recorded as data under `substantive`, the comparator requires at least
 * one of them to genuinely differ, and the facts that differ between any two runners for
 * uninteresting reasons (hostname, runner name) are kept apart under `incidental` where they
 * cannot satisfy that requirement.
 *
 * `substantive` is a **map, not a fixed shape**, so adding an axis is a change here and no
 * change at all in `tools/ci/check-release-reproducibility.py`. The comparator requires both
 * manifests to declare the same key set, which is what stops one side from manufacturing a
 * difference by simply not recording an axis.
 *
 * **One key in that block is a recipe fact rather than an environment axis.**
 * 12 §1.1 names `SOURCE_DATE_EPOCH` as part of the deterministic-build recipe, so the two
 * environments must carry the *same* one — and the comparator therefore both requires it to
 * be equal and refuses to let it count towards the independence requirement above. Recorded
 * here rather than beside `buildRecipeDigest` because an environment variable is what the
 * convention is; classified there, because that is where the classification is enforced.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, hostname, release as osRelease } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { perFileHashes, sha256, treeDigest } from './release-json.ts';
import { SOURCE_DATE_EPOCH, resolveSourceDateEpoch } from './source-date-epoch.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const DIST = join(APP_ROOT, 'dist');
const OUT = join(APP_ROOT, 'release-out');

export const REPRO_MANIFEST_SCHEMA = 'bleavit.app-repro-manifest.v1';

/** The `release-out/` files 12 §1.1 names as release output beside `dist/`. */
export const RELEASE_OUT_FILES = Object.freeze(['release.json', 'sbom.cdx.json']);

export class ReproManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReproManifestError';
  }
}

/** Path → sha256 over the whole release output, `dist/`- and `release-out/`-prefixed. */
export type ReleaseFileHashes = Readonly<Record<string, string>>;

export interface ReproEnvironment {
  /** Which environment this is. Two manifests carrying one id are one environment. */
  readonly id: string;
  /**
   * Axes that could change the emitted bytes. A `null` is "not observable here", never a
   * value: the comparator counts a difference only between two *known* unequal values, so an
   * unrecorded axis can neither prove independence nor be mistaken for proof of it.
   *
   * One key in here is not that kind of axis and the comparator classifies it separately:
   * `sourceDateEpoch` is part of 12 §1.1's **recipe**, so the two environments must carry the
   * same one, and it can never stand in for the independence the block otherwise exists to
   * demonstrate. It is recorded here rather than beside `buildRecipeDigest` because it is
   * read off the environment, which is what the convention is.
   */
  readonly substantive: Readonly<Record<string, string | number | null>>;
  /**
   * Facts that differ between any two runners and mean nothing. Kept out of `substantive` so
   * they cannot satisfy the comparator's independence requirement — a gate that accepted
   * "the hostnames differ" as two environments would accept the same environment twice.
   */
  readonly incidental: Readonly<Record<string, string | null>>;
}

export interface ReproManifest {
  readonly schema: string;
  readonly environment: ReproEnvironment;
  readonly sourceCommit: string;
  readonly buildRecipeDigest: string;
  readonly treeDigest: string;
  readonly files: ReleaseFileHashes;
}

function environmentValue(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

/**
 * `pnpm` reports itself in `npm_config_user_agent` (`pnpm/10.23.0 npm/? node/v22.19.0 …`)
 * whenever it is the thing running this script, which under `pnpm run release:manifest` it
 * always is. Read rather than spawned: `pnpm --version` would be a second process to learn
 * something the first one already said, and it would report whichever pnpm is on `PATH`
 * rather than the one that actually ran the build.
 */
export function pnpmVersionFrom(userAgent: string | null): string | null {
  if (userAgent === null) return null;
  const match = /(?:^|\s)pnpm\/([0-9][^\s]*)/.exec(userAgent);
  return match?.[1] ?? null;
}

export function describeEnvironment(id: string, appRoot: string): ReproEnvironment {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    // Named, and named in an alphabet that survives an artifact name. An environment with no
    // stable id cannot be shown to be a *different* environment from the other one, which is
    // the entire property this manifest exists to support.
    throw new ReproManifestError(
      `environment id ${JSON.stringify(id)} must be lowercase alphanumeric with dashes`,
    );
  }
  return {
    id,
    substantive: {
      node: process.version,
      pnpm: pnpmVersionFrom(environmentValue('npm_config_user_agent')),
      platform: process.platform,
      arch: process.arch,
      // The kernel string. Two GitHub runner images of different generations differ here
      // even when both answer to `ubuntu-latest`.
      osRelease: osRelease(),
      // GitHub's own image identity. `null` off CI, which is honest: a developer's laptop is
      // not a runner image and pretending otherwise would put a value in a comparison.
      imageOs: environmentValue('ImageOS'),
      imageVersion: environmentValue('ImageVersion'),
      // 12 §1.1's own recorded measurement varied "absolute path depth with separate stores",
      // so it is an axis the specification already treats as one, and the cheapest genuine
      // difference two CI jobs can be given.
      buildPath: appRoot,
      home: environmentValue('HOME'),
      // A bundler that schedules work across cores can emit a different chunk order on a
      // machine with a different count. Recorded because it can change bytes, not because it
      // is expected to.
      cpuCount: availableParallelism(),
      // 12 §1.1 requires `SOURCE_DATE_EPOCH` fixed, and `source-date-epoch.ts` now resolves
      // and **exports** it — injected value first, the source commit's time otherwise — so
      // this reads the value the build itself ran under rather than a second opinion about
      // how to derive one. `main` resolves before describing, which is what makes that true;
      // the consumer refuses a `null` here, because unsetting the variable is the cheapest
      // way to make a recipe divergence look like agreement.
      sourceDateEpoch: environmentValue(SOURCE_DATE_EPOCH),
    },
    incidental: {
      hostname: hostname(),
      runner: environmentValue('RUNNER_NAME'),
      workflowJob: environmentValue('GITHUB_JOB'),
      runId: environmentValue('GITHUB_RUN_ID'),
    },
  };
}

/**
 * Every file 12 §1.1 counts as release output, hashed **from disk**.
 *
 * Deliberately not read out of `release.json`'s `perFileHashes`: a manifest assembled from
 * another document's claims proves the two documents agree, and the claim here is about
 * bytes. The two are then cross-checked below, which is the cheap version of the same
 * argument running in the other direction.
 */
export function collectReleaseFiles(distDir: string, outDir: string): ReleaseFileHashes {
  if (!existsSync(distDir)) {
    throw new ReproManifestError(
      `${distDir} does not exist; run \`pnpm run release:build\` before the manifest step`,
    );
  }
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(perFileHashes(distDir))) {
    files[`dist/${path}`] = digest;
  }
  for (const name of RELEASE_OUT_FILES) {
    const path = join(outDir, name);
    if (!existsSync(path)) {
      throw new ReproManifestError(
        `${path} does not exist; 12 §1.1 counts it as release output, so a manifest without ` +
          'it would claim reproducibility for two thirds of the release',
      );
    }
    files[`release-out/${name}`] = sha256(readFileSync(path));
  }
  return files;
}

/**
 * `release.json` describes the tree it was written from.
 *
 * A third check over ground two others already cover (`release:check`'s baked-map comparison
 * and `check:embedded-tree`), and it costs one loop: the manifest is the document a *second*
 * environment is compared against, so it must not be able to certify a `release.json` that
 * describes some other tree. If this ever fires, the two builds would compare byte-identical
 * on `dist/` and differ on `release.json` for a reason no path name would explain.
 */
export function assertReleaseJsonDescribesTree(files: ReleaseFileHashes, releaseJson: unknown): void {
  const document = releaseJson as { perFileHashes?: Record<string, string> } | null;
  const declared = document?.perFileHashes;
  if (declared === undefined || Object.keys(declared).length === 0) {
    throw new ReproManifestError('release.json carries no perFileHashes; there is nothing to bind');
  }
  const measured: Record<string, string> = {};
  for (const [path, digest] of Object.entries(files)) {
    if (path.startsWith('dist/')) measured[path.slice('dist/'.length)] = digest;
  }
  const mismatches: string[] = [];
  for (const [path, digest] of Object.entries(declared)) {
    if (measured[path] !== digest) mismatches.push(`release.json pins ${path} and the tree ${measured[path] === undefined ? 'does not contain it' : 'differs'}`);
  }
  for (const path of Object.keys(measured)) {
    if (declared[path] === undefined) mismatches.push(`${path} is in the tree and release.json pins no digest for it`);
  }
  if (mismatches.length > 0) {
    throw new ReproManifestError(
      `release.json does not describe the emitted tree:\n  ${mismatches.join('\n  ')}`,
    );
  }
}

export function buildReproManifest({
  environment,
  sourceCommit,
  buildRecipeDigest,
  files,
}: {
  readonly environment: ReproEnvironment;
  readonly sourceCommit: string;
  readonly buildRecipeDigest: string;
  readonly files: ReleaseFileHashes;
}): ReproManifest {
  return {
    schema: REPRO_MANIFEST_SCHEMA,
    environment,
    sourceCommit,
    buildRecipeDigest,
    treeDigest: treeDigest(files),
    files,
  };
}

function argumentValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv: readonly string[]): number {
  const id = argumentValue(argv, '--environment');
  if (id === undefined) {
    console.error(
      'usage: release:manifest -- --environment <id> [--out <path>]\n' +
        'The id names which of 12 §1.1\'s two environments this build was; the comparator\n' +
        'refuses two manifests that carry the same one.',
    );
    return 64;
  }
  const out = argumentValue(argv, '--out') ?? join(OUT, 'repro-manifest.json');
  // Before the environment is described, so the recorded epoch is the resolved one. This runs
  // in its own process — `release:build` and `release:manifest` are two commands — and the two
  // agree because both resolve the same way from the same source, not because one told the
  // other.
  resolveSourceDateEpoch(REPO_ROOT);
  const files = collectReleaseFiles(DIST, OUT);
  const releaseJson: unknown = JSON.parse(readFileSync(join(OUT, 'release.json'), 'utf8'));
  assertReleaseJsonDescribesTree(files, releaseJson);

  const manifest = buildReproManifest({
    environment: describeEnvironment(id, APP_ROOT),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    // Read from `release.json` rather than recomputed: the recipe digest is what the release
    // *claims* it was built from, and the property under test is that two environments
    // building the claimed recipe agree. Recomputing it here would compare this tool's
    // reading of the recipe on two runners, which is not the claim.
    buildRecipeDigest: String((releaseJson as { buildRecipeDigest?: unknown })?.buildRecipeDigest ?? ''),
    files,
  });
  if (!/^[0-9a-f]{64}$/.test(manifest.buildRecipeDigest)) {
    throw new ReproManifestError('release.json carries no build-recipe digest to publish');
  }

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${Object.keys(files).length} release files; tree digest ${manifest.treeDigest}\n` +
      `environment ${manifest.environment.id} at ${String(manifest.environment.substantive['buildPath'])}`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
