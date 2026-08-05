/**
 * The base TXID, observed from `location` — 12 §1.2's `M′` (F11).
 *
 * > `release.json` records the asset-tree manifest and **the app resolves its own base TXID
 * > at runtime from `location`**; the verification CLI checks both.
 *
 * This is the other half of the pair `ReleaseIdentity.arweaveManifestTxId` pins. It cannot be
 * pinned, because `M′` addresses a manifest that contains `release.json`: writing it in
 * changes the file and therefore changes `M′`. So it is *observed*, and everything about
 * this module follows from the fact that an observation can fail.
 *
 * ## It returns a verdict, and `not-content-addressed` is a normal answer
 *
 * The app runs from an ar.io gateway in production and from `localhost` in development, from
 * a `file://` URL in a downloaded copy, and from an ArNS name that resolves to a TXID
 * without showing one. Only the first form carries the address. A function returning
 * `string | undefined` would push every caller into treating "we are not on a gateway" and
 * "we could not parse the gateway URL" as the same thing, and the panel would render an
 * empty release row either way — which reads as *this release has no address*.
 *
 * So absence is typed and carries its reason. The panel renders the reason.
 *
 * ## Never derived, never guessed (INV-FE-12)
 *
 * A 43-character base64url string is the only thing accepted, and it must occupy a whole
 * path segment or a whole subdomain label. Two shapes are deliberately *not* treated as
 * addresses:
 *
 * - **An ArNS undername** (`v1-2-3_futarchy.arweave.net`) resolves to a TXID that this code
 *   cannot see. Guessing one from the name would produce a confident wrong answer, and the
 *   comparison it feeds is the one that would catch a substituted bundle.
 * - **A 43-character segment anywhere else in the path.** `/assets/<43 chars>.js` is a
 *   content-hashed filename, not a manifest, and accepting it would let a bundle report a
 *   release address that is one of its own chunks.
 */

/** Arweave transaction ids are 32 bytes, base64url, unpadded — always exactly 43 chars. */
const TXID = /^[A-Za-z0-9_-]{43}$/;

export type BaseTxidVerdict =
  | {
      readonly kind: 'txid';
      /** 12 §1.2's `M′` — what the ArNS name is repointed to, as served. */
      readonly txid: string;
      /**
       * Always `'path'`. Kept as a field rather than dropped because the sandboxed-subdomain
       * form exists and is deliberately *not* read (see `resolveBaseTxid`); a verdict that
       * could not name where the address came from would make that omission invisible.
       */
      readonly form: 'path';
    }
  | {
      /** Not served from a content address. Development, `file://`, or an ArNS name. */
      readonly kind: 'not-content-addressed';
      readonly detail: string;
    };

/**
 * Resolve the base TXID from a full URL.
 *
 * Takes the href rather than reading `location` itself, because 10 §3.2 lists the
 * verification panel among the surfaces that must render when nothing else does — a module
 * that touched a global would be unusable in the CLI that 12 §1.2 says checks the same
 * thing, and untestable without a DOM.
 */
export function resolveBaseTxid(href: string): BaseTxidVerdict {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return {
      kind: 'not-content-addressed',
      detail: `the page address (${href}) is not a URL this can read, so the served content address is unknown`,
    };
  }

  // `https://gateway/<txid>/index.html` — the TXID must be the FIRST segment. A 43-char
  // segment deeper in the path is a content-hashed asset filename, and reporting one as the
  // release address would have the bundle name one of its own chunks.
  //
  // The **path is the only form read**, and a sandboxed subdomain is deliberately not:
  // DNS labels are case-insensitive and `new URL()` normalizes the host to lowercase, so a
  // case-sensitive base64url TXID cannot survive a hostname. An earlier draft here read the
  // first label and returned it — a well-formed *wrong* address that fails every comparison
  // it feeds, and which would have appeared to work for a coincidentally all-lowercase
  // TXID, making the defect intermittent. Arweave sandboxes to a **base32** subdomain for
  // exactly this reason; decoding that is real work with a verifiable answer, and INV-FE-12
  // forbids guessing at an encoding, so an unrecognised host is refused rather than
  // approximated.
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first !== undefined && TXID.test(first)) {
    return { kind: 'txid', txid: first, form: 'path' };
  }

  return {
    kind: 'not-content-addressed',
    detail:
      `this page is served from ${url.host || href} rather than from an Arweave content ` +
      'address, so its served identity cannot be compared here. That is expected for a ' +
      'development build, a local copy, or an ArNS name — an ArNS name does resolve to a ' +
      'transaction, but the page cannot see which one, and guessing would produce exactly ' +
      'the confident wrong answer this comparison exists to catch.',
  };
}
