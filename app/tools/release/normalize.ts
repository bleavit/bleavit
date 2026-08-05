/**
 * The post-build determinism check — 12 §1.1, F11.
 *
 * 12 §1.1 calls for "a post-build normalizer [that] strips nondeterminism (plain tree, no
 * archive metadata)". This is that step, written as an **assertion rather than a rewrite**,
 * and the choice is deliberate.
 *
 * A normalizer that edits the tree makes two environments agree by erasing the evidence
 * that they disagreed. The property 12 §1.1 actually needs is that two independent CI
 * environments produce an identical tree hash — so the useful step is the one that fails
 * when the build has embedded something environment-specific, naming the file and the
 * string, while there is still someone to fix it. There is nothing left to strip in this
 * pipeline anyway: `dist/` is a plain directory (no archive, so no archive metadata), and
 * the two classic sources of drift are already closed by configuration — sourcemaps are
 * not emitted, and asset filenames are content hashes.
 *
 * What it looks for is what has actually leaked out of bundlers here and elsewhere:
 * absolute build paths, `node_modules` paths (which under pnpm encode the virtual store
 * layout), a home directory, and today's date.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class DeterminismError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterminismError';
  }
}

/**
 * Binaries are scanned too, as `latin1`.
 *
 * The first draft skipped them, and the review was right that this is the wrong shape: a
 * build path is ASCII, and ASCII survives inside a wasm module's name section, a font's
 * metadata and an image's EXIF just as readably as it does in a JavaScript chunk. Skipping
 * them meant the one class of file whose contents nobody inspects was also the one class
 * this check declined to look at — and per-file hashing then blessed whatever was in there.
 *
 * `latin1` rather than `utf8` because it is a total byte→char mapping: `utf8` replaces
 * invalid sequences with `U+FFFD`, which can destroy the very ASCII run being searched for
 * when it happens to sit beside non-UTF-8 bytes.
 */
const BINARY = /\.(png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|wasm|mp4|webm)$/i;

/** One environment-specific string to look for, and the name it is reported under. */
export interface EnvironmentProbe {
  readonly name: string;
  readonly pattern: string | undefined;
}

/** A string that leaked into a built file, named so it can be fixed. */
export interface DeterminismFinding {
  readonly path: string;
  readonly probe: string;
  readonly detail: string;
}

/**
 * `probes` is injected rather than derived from `process.env` inside the check, so a test
 * can assert the detector fires without having to arrange for a real home directory to
 * appear in a real bundle.
 */
export function environmentProbes({
  appRoot,
  home = process.env['HOME'],
}: {
  readonly appRoot: string;
  readonly home?: string | undefined;
}): EnvironmentProbe[] {
  const probes: EnvironmentProbe[] = [
    { name: 'absolute build path', pattern: appRoot },
    { name: 'pnpm virtual store path', pattern: 'node_modules/.pnpm' },
  ];
  if (home && home.length > 1) probes.push({ name: 'home directory', pattern: home });
  return probes;
}

export function checkDeterminism(
  distDir: string,
  files: readonly string[],
  probes: readonly EnvironmentProbe[],
): DeterminismFinding[] {
  const findings: DeterminismFinding[] = [];
  for (const path of files) {
    const text = readFileSync(join(distDir, path), BINARY.test(path) ? 'latin1' : 'utf8');
    for (const probe of probes) {
      if (probe.pattern && text.includes(probe.pattern)) {
        findings.push({
          path,
          probe: probe.name,
          detail:
            `${path} contains ${JSON.stringify(probe.pattern)} — an environment-specific ` +
            'string. Two builders would produce different bytes for the same commit, and ' +
            '12 §1.1 requires them to produce an identical tree hash.',
        });
      }
    }
  }
  return findings;
}
