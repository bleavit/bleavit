/**
 * Canonical JSON and the capsule digest — 10 §13.1.
 *
 * The envelope conventions are the repository's established ones: canonical JSON
 * (`sort_keys`, minimal separators, UTF-8) and a digest computed over a defined core
 * projection under a **NUL-terminated domain-separation tag**.
 *
 * ## The digest authenticates nothing, and saying so is part of the design
 *
 * 10 §13.1 is explicit: *"It is an integrity check against truncation and transcription
 * damage, not a signature; capsules are deliberately unsigned, because signing one with
 * the user's chain key would reuse a signing key for a non-chain purpose and manufacture
 * an artifact that looks authoritative."*
 *
 * That is why this module exposes `digestPreimage` and nothing named `sign`, `verifySignature`
 * or `authenticate`. What verifies a capsule is re-reading the chain, which anyone can do.
 * A helper here that *looked* like authentication would be the artifact the section
 * refuses to manufacture.
 *
 * ## Why the domain tag is NUL-terminated
 *
 * A length-ambiguous prefix lets two different (tag, payload) pairs produce the same
 * pre-image: tag `"ab"` with payload `"c"` and tag `"a"` with payload `"bc"` are the same
 * bytes when concatenated. The NUL terminator makes the boundary unambiguous, since the
 * tags are ASCII and contain no NUL. This matters even for a non-authenticating digest,
 * because a collision across formats would let a receipt's digest validate a context.
 */

export const CONTEXT_DOMAIN_TAG = 'bleavit.context.v1';
export const RECEIPT_DOMAIN_TAG = 'bleavit.receipt.v1';

/**
 * Serialize to canonical JSON: keys sorted, minimal separators, UTF-8.
 *
 * `bigint` is rendered as a decimal **string**, never via `Number`. A capsule carries
 * base-unit amounts that run past 2^53, and `JSON.stringify` on a lossy conversion would
 * produce a document whose digest is stable and whose contents are wrong — the failure
 * mode is silence, which is why the conversion is refused rather than rounded (V-74).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonical JSON has no representation for a non-finite number');
      }
      if (!Number.isSafeInteger(value) && Number.isInteger(value)) {
        throw new TypeError(
          `${value} is an integer past 2^53 and would serialize lossily; pass a bigint`,
        );
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError('canonical JSON has no representation for undefined');
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` members are omitted rather than serialized, matching JSON.stringify;
      // an explicit null is kept, because it is a value the producer chose.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON has no representation for ${typeof value}`);
}

/** The domain-separation terminator, written as an escape: a literal NUL in source is
 * invisible in most editors and is silently mangled by tools that assume text. */
const NUL = '\u0000';

/**
 * The bytes a capsule's digest is taken over: `tag` ++ NUL ++ canonical(core).
 *
 * Returned as bytes rather than hashed here for the same reason `packages/verify` does
 * not hash: the primitive differs per platform (`SubtleCrypto`, node, Tauri) while the
 * pre-image construction — which is the part that must not vary — is identical
 * everywhere and belongs in one tested place.
 */
export function digestPreimage(tag: string, core: unknown): Uint8Array {
  if (tag.includes(NUL)) {
    throw new TypeError('a domain-separation tag may not contain NUL; it is the terminator');
  }
  return new TextEncoder().encode(`${tag}${NUL}${canonicalJson(core)}`);
}
