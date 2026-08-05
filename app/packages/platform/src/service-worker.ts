/**
 * The release-scoped service worker's policy — 12 §5.2, F11.
 *
 * Everything here is a pure function over data. The worker entry
 * (`src/application/src/sw.ts`) does the IO; this module decides. That split is not
 * tidiness: a service worker cannot be unit-tested in the environment it runs in, so a
 * policy written inline is a policy that is only ever exercised by shipping it.
 *
 * ## What this worker is for, and what 12 §5.2 already withdrew
 *
 * It is an **offline and integrity** control for one release's own assets. It is *not* a
 * defence against a hostile service worker — §5.2 withdraws that claim explicitly, because
 * a malicious worker interposes on every same-origin fetch including the ones that would
 * detect it, and answers them with consistent lies. The compensating control is the
 * out-of-band attestation monitor, which runs outside any worker's reach.
 *
 * So the honest statement of this file's job: once an *honest* release is installed, the
 * bytes it serves are the bytes it was published with, and a gateway that later serves
 * something else is refused rather than cached.
 *
 * ## The asset hashes are baked; the cache name is fetched
 *
 * The per-file SHA-256 map is substituted into the worker at build time, so integrity does
 * not depend on any fetch. The cache **name** is `release.json`'s `arweaveManifestTxId`,
 * read at install — and it cannot be baked, because §1.2's two-pass deploy only learns the
 * manifest TXID after uploading the tree the worker is part of. Baking it would make the
 * worker's bytes depend on a hash of the worker's bytes.
 *
 * That fetched field needs no trust, and saying why matters: it **names a cache, it does
 * not authorize a byte**. A gateway that returns a wrong TXID gets a differently-named
 * cache; every asset stored in it is still checked against the baked map. The one thing it
 * must not do is *fail open* — an absent or malformed `release.json` refuses the install
 * rather than falling back to a constant name, because a constant name is a cache two
 * different releases would share.
 *
 * ## Why an unknown path is refused rather than passed through
 *
 * A worker that forwards what it does not recognise is a worker whose integrity claim
 * covers only the paths an attacker chose not to invent. The release is a closed set of
 * files: `assets/…` are hash-pinned, and `release.json` is exempt because it carries
 * detached minisign signatures (12 §1.1/§2.1) that `packages/verify` checks — a strictly
 * stronger control than a SHA-256 the worker would have had to learn from the same
 * response. Everything else under scope is refused.
 */

/** A lowercase hex SHA-256 digest, as the release manifest carries it. */
export type Sha256Hex = string;

/** Path (release-relative, no leading slash) → content hash. Baked at build time. */
export type ReleaseAssetHashes = ReadonlyMap<string, Sha256Hex>;

export interface ReleaseScope {
  /** Cache name — `release.json`'s `arweaveManifestTxId` (12 §5.2). */
  readonly cacheName: string;
  /** Every hash-pinned file of this release. */
  readonly assets: ReleaseAssetHashes;
  /**
   * Paths served but not hash-pinned, because they authenticate themselves by a stronger
   * means. Exactly one member, and it is deliberately a list rather than a boolean so the
   * exemption is enumerable and testable rather than a special case inside a branch.
   */
  readonly signedMetadata: readonly string[];
}

export type RequestVerdict =
  | { readonly kind: 'hash-pinned'; readonly path: string; readonly sha256: Sha256Hex }
  | { readonly kind: 'signed-metadata'; readonly path: string }
  | { readonly kind: 'out-of-release'; readonly path: string; readonly reason: string };

/**
 * A request the worker never sees as its business at all — cross-origin, or a method with
 * no cacheable meaning. Separated from `out-of-release` because the response differs: this
 * one is not the worker's to answer, while `out-of-release` is a same-origin path this
 * release does not contain, which is a refusal.
 */
export type Handling = RequestVerdict | { readonly kind: 'not-mine'; readonly reason: string };

/**
 * Read a baked path→hash object as own-key, null-prototype data.
 *
 * The same defence `packages/verify` needs, for the same reason: a plain-object lookup
 * consults the prototype chain while enumeration does not, so `{}.constructor` resolving
 * to a function would make `classify('constructor')` report a pinned asset whose "hash" is
 * `Function`. Here the input is a JSON literal the build substituted, which makes the
 * attack far-fetched — but a `__proto__` key in that JSON is not far-fetched at all, and
 * the cost of being immune is four lines.
 */
export function assetHashesFrom(source: Readonly<Record<string, string>>): ReleaseAssetHashes {
  const out = new Map<string, Sha256Hex>();
  for (const key of Object.getOwnPropertyNames(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const value = descriptor.value as unknown;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new Error(`release asset map entry ${key} is not a lowercase hex SHA-256`);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Build the scope, refusing an empty asset map.
 *
 * An empty map would make `classify` answer `out-of-release` for every request, which the
 * worker turns into a refusal — so it fails closed rather than open. It is still refused
 * here, because the resulting application is a blank page with no explanation, and a
 * substitution step that silently produced nothing is exactly the failure the placeholder
 * gate in `tools/release/build.mjs` exists to catch.
 */
export function releaseScope(
  cacheName: string,
  assets: ReleaseAssetHashes,
  signedMetadata: readonly string[],
): ReleaseScope {
  if (cacheName.length === 0) {
    throw new Error('a release scope needs a cache name; an empty one is shared by every release');
  }
  if (assets.size === 0) {
    throw new Error('this release pins no asset hashes, so the worker would verify nothing');
  }
  return { cacheName, assets, signedMetadata: [...signedMetadata] };
}

/**
 * Decide what a request is, relative to this release.
 *
 * `swScopePath` is the directory the worker was served from — under Arweave that is
 * `/<manifest-txid>/`, under a local dev server `/`. Paths are compared relative to it, so
 * the same release verifies identically at every content address it is ever served from.
 * Nothing here parses a TXID out of a URL: gateway URL shapes (path-based, sandboxed
 * subdomain, `ar://`) are prototype gate FE-P7's question, and a control that depended on
 * its answer would be a control built on a guess.
 */
export function classify(requestUrl: URL, swScope: URL, scope: ReleaseScope): Handling {
  if (requestUrl.origin !== swScope.origin) {
    return { kind: 'not-mine', reason: 'cross-origin; this worker only answers for its own release' };
  }
  const base = swScope.pathname.endsWith('/') ? swScope.pathname : `${swScope.pathname}/`;
  if (!requestUrl.pathname.startsWith(base)) {
    return { kind: 'not-mine', reason: 'outside this release directory' };
  }
  const path = requestUrl.pathname.slice(base.length);
  // The empty path is the directory itself, which every gateway resolves to index.html.
  const resolved = path === '' ? 'index.html' : path;

  const pinned = scope.assets.get(resolved);
  if (pinned !== undefined) return { kind: 'hash-pinned', path: resolved, sha256: pinned };
  if (scope.signedMetadata.includes(resolved)) return { kind: 'signed-metadata', path: resolved };
  return {
    kind: 'out-of-release',
    path: resolved,
    reason:
      `${resolved} is not part of this release. It is refused rather than fetched: a worker ` +
      'that forwards what it does not recognise verifies only the paths an attacker chose ' +
      'not to invent.',
  };
}

/**
 * Whether bytes just received may be served and cached.
 *
 * Deliberately takes the already-computed digest rather than the bytes plus a hasher: the
 * caller has to hash anyway to decide, and a function that both hashes and compares
 * invites a caller to skip it for "trusted" responses. There is no trusted response here.
 */
export function acceptsBytes(verdict: RequestVerdict, digest: Sha256Hex): boolean {
  switch (verdict.kind) {
    case 'hash-pinned':
      return digest === verdict.sha256;
    case 'signed-metadata':
      // Its integrity is the minisign signature `packages/verify` checks, not a hash this
      // worker could only have learned from the same response it is trying to validate.
      return true;
    case 'out-of-release':
      return false;
  }
}

/**
 * Caches to delete when this worker activates — every cache that is not this release's.
 *
 * 12 §5.2's "old cache deleted on activation", stated as a set difference so the rule
 * cannot be written as "delete the previous one" and quietly leave three behind.
 */
export function staleCaches(existing: readonly string[], scope: ReleaseScope): string[] {
  return existing.filter((name) => name !== scope.cacheName);
}

/**
 * The one message that may make a waiting worker take over.
 *
 * 12 §5.2: **no automatic `skipWaiting`** — activation happens on explicit user action.
 * The constant lives here so the worker and the page cannot drift onto two spellings, and
 * so a test can assert that the worker responds to this and to nothing else. An update
 * that installs itself is an update the user did not verify, and the whole distribution
 * story is that a user can know what they are running.
 */
export const ACTIVATE_MESSAGE = 'bleavit:activate-waiting-release';

/**
 * Whether a `message` event should activate the waiting worker.
 *
 * `pinned` is the user's "stay on this release" choice (12 §5.2's pin toggle). A pinned
 * release refuses activation even when asked, because the pin is the user's statement
 * about which bytes they are willing to run, and an update prompt they mis-clicked should
 * not override it. Unpinning is a separate, deliberate act on the page.
 */
export function shouldActivate(messageData: unknown, pinned: boolean): boolean {
  if (pinned) return false;
  return messageData === ACTIVATE_MESSAGE;
}
