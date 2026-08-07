/**
 * The embedded-tree assertion — F22's whole point (10 §10.1; 12 §1).
 *
 * The desktop shell is a **direct download** that carries the application inside its own
 * binary. Everything 12 §1 promises about the canonical release — a per-file SHA-256 map, a
 * signed `release.json`, two independent rebuilds agreeing byte for byte — describes the
 * tree published to Arweave. A desktop build is only covered by those promises if the tree
 * it embeds *is* that tree. This module is the comparison that establishes it, and it runs
 * on a build machine, before any binary exists to hand anybody.
 *
 * ## Why this is not a fourth comparison
 *
 * `packages/verify`'s `runSelfCheck` is the INV-FE-8 mechanism, and its own doc comment
 * already names Tauri as an intended caller: *"hashing is the caller's job because the
 * platforms differ … while the comparison, which is the part that decides whether a user is
 * warned, is identical everywhere and belongs in one tested place."* So this module hashes
 * a directory and calls that function. It adds two things a self-check cannot know:
 *
 * 1. **The document is the producer's, not just a hash map.** `assertPublishable` (12 §1.2's
 *    deploy driver) is the sibling obligation — *"`perFileHashes` must describe exactly this
 *    tree, digest for digest"* — and it additionally requires the release fields that make
 *    the map a release record rather than three lines of JSON.
 * 2. **The shell will really embed that tree, unmodified.** A byte-identity claim about
 *    `dist/` says nothing if the shell is configured to embed something else, or to rewrite
 *    what it embeds. `checkShellConfig` is that leg, and its rules are measured against the
 *    pinned Tauri sources rather than assumed — see its own comment.
 *
 * ## Fail closed on nothing to check
 *
 * An absent `dist/`, an empty `dist/`, an absent `release.json` and a manifest pinning no
 * files are each refused rather than reported as verified. This is the failure mode this
 * repository keeps rediscovering: a checker that measured nothing exits 0.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { SelfCheckResult, Sha256Hex } from '@bleavit/verify';
import { readPerFileHashes, runSelfCheck } from '@bleavit/verify';

import { ArweaveDeployError, assertPublishable, type ReleaseDocumentLike } from '../release/arweave.ts';

export class EmbeddedTreeError extends Error {
  constructor(message: string, options?: { readonly cause: unknown }) {
    super(message, options);
    this.name = 'EmbeddedTreeError';
  }
}

export const sha256 = (bytes: Uint8Array): Sha256Hex =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Read a directory into the release-relative path → bytes map the rest of this file uses.
 *
 * Paths are normalised to forward slashes with **no leading slash**, which is the spelling
 * `release.json.perFileHashes` uses and the spelling `runSelfCheck` therefore compares. The
 * shell's own key spelling is different — Tauri's `AssetKey` is rooted, `/index.html` — and
 * that difference is the single most likely way for this assertion to become useless without
 * failing: normalise one side wrongly and every file is reported as both `missing` and
 * `unexpected`, which is fail-closed but tells nobody anything. It is therefore normalised
 * in exactly one place, here and in the shell's `normalise_key`, and both are tested.
 *
 * Symbolic links are refused rather than followed. A link is a path whose bytes are decided
 * outside the tree, and a release tree whose contents depend on the build machine's
 * filesystem is not a release tree.
 */
export function readTree(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new EmbeddedTreeError(
          `${relative(root, absolute)} is a symbolic link. A release tree whose bytes are ` +
            'decided outside itself cannot be attested, so this is refused rather than followed.',
        );
      }
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new EmbeddedTreeError(
          `${relative(root, absolute)} is neither a file nor a directory; refusing to guess ` +
            'what a shell would embed for it',
        );
      }
      out.set(relative(root, absolute).split(sep).join('/'), new Uint8Array(readFileSync(absolute)));
    }
  };
  const stats = statSync(root, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new EmbeddedTreeError(
      `${root} is not a directory. The desktop shell embeds the built release tree, so there ` +
        'is nothing to attest until `pnpm run release:build` has produced it.',
    );
  }
  walk(root);
  if (out.size === 0) {
    throw new EmbeddedTreeError(
      `${root} is empty. A comparison over no files reports success having compared nothing, ` +
        'which is the one result this check must never produce.',
    );
  }
  return out;
}

/**
 * Normalise an asset key to the spelling `release.json.perFileHashes` uses.
 *
 * The mirror of `normalise_key` in `crates/embedded-tree`, and the reason both exist is in
 * `readTree`'s comment: Tauri's `AssetKey` is rooted (`/index.html`) and the release manifest
 * is not, so a side that failed to normalise would report **every** file as both `missing`
 * and `unexpected` — fail-closed, useless, and the sort of result somebody repairs by
 * relaxing the comparison. `crates/embedded-tree/fixtures/self-check-cases.json` carries a
 * rooted case that both implementations must agree on.
 */
export function normaliseKey(key: string): string {
  return key.startsWith('/') ? key.slice(1) : key;
}

/** Hash a tree into the `path → digest` shape `runSelfCheck` compares. */
export function hashTree(tree: ReadonlyMap<string, Uint8Array>): Record<string, Sha256Hex> {
  const out: Record<string, Sha256Hex> = Object.create(null) as Record<string, Sha256Hex>;
  for (const [path, bytes] of tree) out[normaliseKey(path)] = sha256(bytes);
  return out;
}

export interface EmbeddedTreeVerdict {
  readonly selfCheck: SelfCheckResult;
  /** Files the shell will embed. Reported so a run cannot be green on a tree of one file. */
  readonly treeSize: number;
}

function isDocumentLike(value: unknown): value is ReleaseDocumentLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Assert that a built tree is exactly what the release document pins.
 *
 * Both readers are the production ones. `readPerFileHashes` rather than
 * `parseReleaseDocument` is deliberate and is explained where it is defined: a per-commit
 * build legitimately carries unresolved readiness blockers and no Arweave address, and the
 * full parser refuses both — those refusals are about publication state, while this question
 * is about whether the map describes the tree.
 *
 * ## The order of the two legs is the design, and getting it backwards makes one of them dead
 *
 * `assertPublishable` compares the key sets **and** the digests, and it **throws on the first
 * disagreement**. Run first, it therefore catches every divergence the self-check exists to
 * enumerate — and `runSelfCheck` becomes unreachable code whose findings array is empty in
 * every run that reaches it. Measured, not reasoned: with the self-check replaced by a
 * hardcoded clean verdict, `check-embedded-tree.ts --witness` stayed green on all three
 * mutations. A gate that cannot fail reports success, and this one would have reported it
 * while the comparison the milestone is about did nothing.
 *
 * So the self-check runs **first** and its findings are the verdict, and the publishability
 * gate runs only over a tree that already matched — where its comparison legs pass trivially
 * and what remains of it is the part the self-check cannot answer: whether the document is a
 * release *record* (`schema`, `sourceCommit`, `specVersionRange`, `descriptorMetadataHashes`)
 * rather than three lines of JSON carrying a hash map.
 */
export function assertEmbeddedTree(
  releaseDocument: unknown,
  tree: ReadonlyMap<string, Uint8Array>,
): EmbeddedTreeVerdict {
  if (!isDocumentLike(releaseDocument)) {
    throw new EmbeddedTreeError('release.json did not parse to a JSON object');
  }
  const pins = readPerFileHashes(releaseDocument);
  if (pins.kind === 'refused') {
    throw new EmbeddedTreeError(`release.json: ${pins.reason} — ${pins.detail}`);
  }
  if (tree.size === 0) {
    throw new EmbeddedTreeError('refusing to attest an empty tree');
  }

  // The three-way comparison — missing, changed, and the one a manifest-driven loop cannot
  // see: a file present in the tree that nothing signed. `PinnedFiles` is the whole of what
  // it reads, so nothing is fabricated here to satisfy a signature.
  const selfCheck = runSelfCheck({ perFileHashes: pins.perFileHashes }, hashTree(tree));

  if (selfCheck.ok) {
    // The document must be a release record, not a hash map in a file. This is the 12 §1.2
    // deploy driver's own gate, run here so the desktop channel cannot ship against a
    // document the web channel would refuse to publish.
    //
    // Its refusal is re-thrown under this module's own error type, and the catch is narrowed
    // to that type on purpose. One error type for the whole refusal surface means a caller
    // cannot catch half of them; catching everything would launder a programming error into a
    // release verdict, which is the opposite failure and the worse one.
    try {
      assertPublishable(releaseDocument, tree, sha256);
    } catch (error) {
      if (!(error instanceof ArweaveDeployError)) throw error;
      throw new EmbeddedTreeError(`release.json is not a publishable release record: ${error.message}`, {
        cause: error,
      });
    }
  }

  return { selfCheck, treeSize: tree.size };
}

/**
 * The shell configuration facts that make "byte-identical" true rather than aspirational.
 *
 * Every rule here was read off the pinned Tauri sources (`tauri-codegen` 2.4.0,
 * `tauri` 2.8.4) rather than inferred from documentation, because the first of them is not
 * something anyone would guess:
 *
 * - **A configured CSP rewrites every embedded HTML file.** `map_core_assets` in
 *   `tauri-codegen/src/context.rs` runs `if csp { parse_html(...); inject_nonce_token(...);
 *   *input = serialize_html_node(...) }` for every `.html` asset, and `csp` is set whenever
 *   `app.security.csp` (or `devCsp`) is present. So a shell with a CSP configured embeds a
 *   re-serialised `index.html` — and the assertion this file performs would be true of
 *   `dist/` and false of what the user runs. The release's own meta-CSP is already in that
 *   file (12 §5.1 delivers it as meta-CSP because gateways own real headers), so the correct
 *   configuration is *no Tauri CSP*, and the reason is recorded here rather than left as a
 *   surprising blank in `tauri.conf.json`.
 * - **`frontendDist` must be the built release tree.** Anything else embeds a different tree.
 * - **No `devUrl`, and `frontendDist` must not be a URL.** `BuildConfig::frontend_dist`
 *   accepts a URL, in which case *"the application won't have bundled assets and the
 *   application will load that URL by default"* — an application whose code arrives over the
 *   network, which is the one thing a direct-download channel exists to avoid.
 */
export interface ShellConfigFinding {
  readonly key: string;
  readonly detail: string;
}

/**
 * What `build.frontendDist` must say.
 *
 * Relative to `src-tauri/`, so it names the same `dist/` the gate reads. It lives here, next
 * to the rule that consumes it, rather than in the executable gate: the suite has to name it
 * too, and a module with a top-level `process.exit` cannot be imported by a test.
 */
export const EXPECTED_FRONTEND_DIST = '../dist';

export function checkShellConfig(config: unknown, expectedFrontendDist: string): ShellConfigFinding[] {
  const findings: ShellConfigFinding[] = [];
  const at = (source: unknown, key: string): unknown => {
    if (typeof source !== 'object' || source === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };

  const build = at(config, 'build');
  const frontendDist = at(build, 'frontendDist');
  if (frontendDist !== expectedFrontendDist) {
    findings.push({
      key: 'build.frontendDist',
      detail:
        `must be ${JSON.stringify(expectedFrontendDist)} — the attested release tree — and is ` +
        `${JSON.stringify(frontendDist)}. Any other value embeds a tree nothing attested.`,
    });
  }
  if (at(build, 'devUrl') !== undefined) {
    findings.push({
      key: 'build.devUrl',
      detail:
        'is set. A development server is a remote origin for application code, which the ' +
        'direct-download channel exists to not have.',
    });
  }

  const security = at(at(config, 'app'), 'security');
  for (const key of ['csp', 'devCsp'] as const) {
    if (at(security, key) !== undefined) {
      findings.push({
        key: `app.security.${key}`,
        detail:
          'is set. Tauri rewrites every embedded HTML file when a CSP is configured — it ' +
          'parses, injects a nonce token and re-serialises — so `index.html` inside the ' +
          'binary would no longer be the file the release signed. The release already ' +
          'carries its own meta-CSP (12 §5.1).',
      });
    }
  }
  if (at(security, 'dangerousDisableAssetCspModification') !== undefined) {
    findings.push({
      key: 'app.security.dangerousDisableAssetCspModification',
      detail:
        'is set, which only has meaning alongside a configured CSP. Its presence signals an ' +
        'intent to have Tauri modify assets; remove it rather than tuning it.',
    });
  }
  return findings;
}
