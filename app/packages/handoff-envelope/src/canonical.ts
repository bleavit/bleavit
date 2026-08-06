/**
 * Canonical JSON and the capsule digest pre-image — 10 §13.1.
 *
 * The envelope conventions are the repository's established ones: canonical JSON
 * (`sort_keys`, minimal separators, UTF-8) and a digest computed over a defined core
 * projection under a **NUL-terminated domain-separation tag**.
 *
 * ## Why this is its own package
 *
 * 10 §13.1 states these conventions once, for all three formats — `bleavit.context.v1`
 * (out), `bleavit.intent.v1` (in) and `bleavit.receipt.v1` (out). A second copy of the
 * pre-image construction would be a second answer to the one question that must have
 * exactly one: *which bytes are hashed*. Two implementations that agree today and drift
 * tomorrow produce documents each side believes are intact.
 *
 * It is a separate package rather than a module inside `contexts` for a firewall reason.
 * `contexts` is the **outbound** package and depends on `chain-client`, because export's
 * input type is `Finalized<T>`. `intents` is the **inbound** parser, and 10 §13's second
 * load-bearing sentence is that the inbound format *carries no chain state*. A parser that
 * could reach `chain-client` — even transitively, even without using it — invites exactly
 * the mistake that sentence forbids. So the shared half depends on nothing at all, and the
 * two trust domains stay unconnected.
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
 * refuses to manufacture. It also stops short of hashing: the primitive differs per
 * platform (`SubtleCrypto`, node's `createHash`, Tauri) while the pre-image construction —
 * the part that must not vary — is identical everywhere and belongs in one tested place.
 *
 * ## Why the domain tag is NUL-terminated
 *
 * A length-ambiguous prefix lets two different (tag, payload) pairs produce the same
 * pre-image: tag `"ab"` with payload `"c"` and tag `"a"` with payload `"bc"` are the same
 * bytes when concatenated. The NUL terminator makes the boundary unambiguous, since the
 * tags are ASCII and contain no NUL. This matters even for a non-authenticating digest,
 * because a collision across formats would let a receipt's digest validate a context.
 */

/**
 * Serialize to canonical JSON: keys sorted, minimal separators, UTF-8.
 *
 * `bigint` is rendered as a decimal **string**, never via `Number`. A capsule carries
 * base-unit amounts that run past 2^53, and `JSON.stringify` on a lossy conversion would
 * produce a document whose digest is stable and whose contents are wrong — the failure
 * mode is silence, which is why the conversion is refused rather than rounded (V-74).
 *
 * ## Canonical across languages, not just across runs
 *
 * "Canonical" here has to mean the same bytes from a Python producer, a Rust one and this
 * one, because a digest computed anywhere else is compared here. Three places where the
 * obvious JavaScript implementation silently disagrees, each closed rather than documented:
 *
 *  - **Key order is by code point, not by UTF-16 code unit.** JavaScript's `<` compares
 *    code units, so an astral key (`U+10000`, stored as a surrogate pair beginning `0xD800`)
 *    sorts *before* `U+E000`; Python's `sort_keys` puts it after. Two producers, two orders,
 *    two digests for one document.
 *  - **Non-integer numbers are refused.** `1.0` renders as `1` here and `1.0` in Python, and
 *    `1e-7` as `1e-7` against Python's `1e-07`. None of the three formats carries a
 *    fractional number — amounts are decimal strings, and ppm, versions and block heights
 *    are integers — so refusing is free and removes the whole class.
 *  - **Only plain objects and dense arrays are values.** `Date`, `Map`, `Set` and `RegExp`
 *    all serialize as `{}` under a naive `Object.entries`, so three unrelated documents
 *    collide on one digest; a sparse array emits `[,]`, which is not JSON at all.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

/**
 * Order two strings by Unicode **code point**, as `sort_keys` does everywhere else.
 *
 * `a < b` would compare UTF-16 code units and put every astral character before `U+E000`.
 *
 * Exported because canonical JSON sorts object *keys* and leaves array order alone, so any
 * format whose arrays must also be canonical needs the same comparator — and a second
 * implementation beside this one would agree on every ASCII label and disagree on the first
 * astral character, which is the "two producers, two digests" failure this module exists to
 * close. One answer to *which order*, as there is one answer to *which bytes*.
 */
export function byCodePoint(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
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
      if (!Number.isInteger(value)) {
        // See the module note: `1.0` and `1e-7` render differently in every language, and
        // no handoff format carries a fractional number.
        throw new TypeError(`${value} is not an integer; canonical JSON here carries no floats`);
      }
      if (!Number.isSafeInteger(value)) {
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
  if (Array.isArray(value)) {
    // `Array.from` fills a sparse array's holes with `undefined`, which `serialize` then
    // refuses. `value.map` preserves the holes and `join` renders them as nothing, so a
    // sparse array would emit `[,]` — not JSON, and accepted by nothing that reads it back.
    return `[${Array.from(value, serialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      // `Date`, `Map`, `Set` and `RegExp` all have no own enumerable properties, so the
      // branch below would render each as `{}` and three unrelated documents would share
      // one digest.
      throw new TypeError('canonical JSON carries plain objects only; this value is not one');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` members are omitted rather than serialized, matching JSON.stringify;
      // an explicit null is kept, because it is a value the producer chose.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => byCodePoint(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON has no representation for ${typeof value}`);
}

/**
 * The domain-separation terminator, constructed rather than written as a literal.
 *
 * Writing it as the escape `'\u0000'` is what a reader expects, and it does not survive:
 * the escape is resolved on the way to disk, so the source file ends up holding a raw NUL
 * byte. That byte is invisible in every editor, makes `grep` treat the whole file as
 * binary and report nothing, and is dropped or replaced by anything that round-trips the
 * text. This module was written that way first, and the defect it would have caused is
 * silent in both directions \u2014 a changed separator changes every pre-image, and a
 * separator that survived as a *space* would still be a legal tag character.
 *
 * Building the byte from its code point keeps the source plain ASCII, so what is on disk
 * is what a reader sees and no tool can rewrite it.
 */
const NUL = String.fromCharCode(0);

/**
 * The bytes a capsule's digest is taken over: `tag` ++ NUL ++ canonical(core).
 *
 * Returned as bytes rather than hashed here — see the module note on why hashing is the
 * caller's job.
 */
export function digestPreimage(tag: string, core: unknown): Uint8Array {
  // Printable ASCII only. Refusing NUL is what the separation argument strictly needs, and
  // it is not sufficient on its own: `TextEncoder` replaces every lone surrogate with
  // U+FFFD, so a tag of one lone surrogate and a tag of U+FFFD encode to identical bytes
  // and the separation they were supposed to provide is gone. Every real tag is a schema
  // id, so restricting the alphabet costs nothing and removes the collision class instead
  // of patching one spelling of it.
  if (!/^[\x20-\x7e]+$/.test(tag)) {
    throw new TypeError(
      'a domain-separation tag must be non-empty printable ASCII (it is hashed as a prefix, ' +
        'and any encoding that is not one-to-one collapses two tags into one)',
    );
  }
  return new TextEncoder().encode(`${tag}${NUL}${canonicalJson(core)}`);
}
