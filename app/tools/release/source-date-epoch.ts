/**
 * The recipe's own variable — 12 §1.1.
 *
 * 12 §1.1's deterministic-build recipe lists **`SOURCE_DATE_EPOCH` fixed** beside the pinned
 * Node version, `pnpm install --frozen-lockfile`, the `node-linker` layout and Vite's
 * content-hash filenames. That recipe is *this* pipeline's — it names the `packageManager`
 * pin and outputs `dist/`, `release.json` and `sbom.cdx.json` — and until now nothing here
 * set the variable. The byte-identical property therefore held **by construction** (the tree
 * reads no clock) rather than by the control §1.1 names, which lasts exactly until something
 * starts reading one.
 *
 * ## What setting it does, and what it does not
 *
 * It does **not** make a clock-reading tool deterministic. It makes a clock-reading tool
 * *that honours the convention* deterministic; a tool calling `Date.now()` in process ignores
 * it entirely. So the byte-identical property still rests on the tree being clock-free, and
 * the two-environment compare (`repro-manifest.ts` → `tools/ci/check-release-reproducibility.py`)
 * remains the control that proves it. What this module adds is the recipe's own variable and,
 * through the manifest, a refusal that keeps the two environments honest about carrying the
 * same one. It is not a proof, and nothing here should be read as one.
 *
 * ## The derivation is the chain pipeline's, deliberately
 *
 * `tools/release/build-runtime.sh` already resolves it exactly this way — injected value
 * first, `git show -s --format=%ct HEAD` otherwise — and `tools/release/release_common.py`
 * validates it the same way (an integer, non-negative). Two release pipelines in one
 * repository disagreeing about whether the recipe's own variable applies would be the *one
 * thing, two answers* defect. Deriving rather than choosing is also what satisfies R-2:
 * `release.json` publishes the source commit, so a third-party rebuilder recomputes the value
 * from the document rather than being told it.
 *
 * Injected wins because a build from a source tarball has no git history to derive from, and
 * because a value the operator states is the one the operator can reproduce.
 */

import { execFileSync } from 'node:child_process';

/** The convention's name. One home for it: three call sites spell it, none of them twice. */
export const SOURCE_DATE_EPOCH = 'SOURCE_DATE_EPOCH';

export class SourceDateEpochError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceDateEpochError';
  }
}

/** A mutable environment. `process.env`'s shape, narrowed so a test can pass its own. */
export type MutableEnvironment = Record<string, string | undefined>;

/**
 * A stated epoch, validated and canonicalised — `release_common.py`'s `source_date_epoch`.
 *
 * That function is `int(raw)` followed by a non-negative check, so the two accept and reject
 * the same strings: leading and trailing space are ignored, a sign is permitted, a negative
 * value is refused, and anything that is not an integer (`1e3`, `12.0`, an empty string) is
 * refused. Parsed through `BigInt` rather than `Number` so a value past 2⁵³ is not silently
 * rounded into agreement with a different one — the shape V-74 already cost this repository
 * twice, in a place where the rounded value would then be *pinned*.
 *
 * The return is canonical decimal, which is what `int()` on the Python side also produces:
 * two environments injecting `1786017411` and `0001786017411` mean one instant, and the
 * comparator downstream must not read that as two recipes.
 */
export function parseSourceDateEpoch(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[+-]?[0-9]+$/.test(trimmed)) {
    throw new SourceDateEpochError(
      `${SOURCE_DATE_EPOCH} must be an integer number of seconds; got ${JSON.stringify(raw)}`,
    );
  }
  const value = BigInt(trimmed);
  if (value < 0n) {
    throw new SourceDateEpochError(
      `${SOURCE_DATE_EPOCH} must be non-negative; got ${JSON.stringify(raw)}`,
    );
  }
  return value.toString();
}

/**
 * The source commit's own timestamp — the derivation, and the only one.
 *
 * Refused rather than defaulted when git cannot answer. `build.ts` already requires git for
 * the source commit and the dirty-worktree blocker, so this adds no restriction a release
 * build did not already carry; and a substituted value nobody chose is precisely what a
 * *fixed* epoch is supposed to exclude. The message names the fix, because a tree with no
 * history is a supported case and the injected value is how it is built.
 */
export function commitEpoch(repoRoot: string): string {
  let raw: string;
  try {
    raw = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      // Captured rather than inherited. `execFileSync` forwards a child's stderr to this
      // process by default, so a *handled* failure would print git's complaint into a build
      // log as though something had gone wrong — and the message below is the one that helps.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new SourceDateEpochError(
      `${SOURCE_DATE_EPOCH} is unset and the source commit time could not be read from ` +
        `${repoRoot} (${error instanceof Error ? error.message : String(error)}). Set ` +
        `${SOURCE_DATE_EPOCH} explicitly — that is the documented path for a tree with no ` +
        'git history, such as a source tarball.',
    );
  }
  return parseSourceDateEpoch(raw);
}

/**
 * Resolve the epoch and **export it**, returning the canonical value.
 *
 * Writing it back into the environment is the half that does the work: `vite` and `esbuild`
 * are child processes, and a variable this process resolved but did not export is one they
 * never see. It is the same `export SOURCE_DATE_EPOCH` line `build-runtime.sh` carries, and
 * it is why `release:manifest` can read the resolved value off the environment rather than
 * having its own opinion about how to derive one.
 *
 * An empty string is treated as unset, matching the chain-side `[[ -z … ]]` test. A shell
 * that exports an empty variable has stated nothing, and reading it as a value would put the
 * empty string into a comparison.
 */
export function resolveSourceDateEpoch(
  repoRoot: string,
  environment: MutableEnvironment = process.env,
): string {
  const injected = environment[SOURCE_DATE_EPOCH];
  const epoch =
    injected === undefined || injected.trim() === ''
      ? commitEpoch(repoRoot)
      : parseSourceDateEpoch(injected);
  environment[SOURCE_DATE_EPOCH] = epoch;
  return epoch;
}
