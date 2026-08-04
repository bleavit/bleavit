/**
 * `bleavit.intent.v1` admission — the only inbound format (10 §13.1–§13.3, 11 §11.14).
 *
 * This is the attack surface of the whole handoff subsystem, and 10 §13's three
 * load-bearing sentences are what it implements:
 *
 *  1. *An imported action is exactly as trusted as keyboard input, and travels the same
 *     code path.* The external tool is a keyboard, not a data source.
 *  2. *The only inbound format carries no chain state — only a request.* No field of an
 *     intent asserts anything about the chain.
 *  3. *No format carries an encoded call, in either direction.*
 *
 * ## Admission, not precondition — and the file name says which
 *
 * 11 §11.14.1 draws a line that "must not be collapsed". **Admission checks** are
 * properties of a *file*: "schema equality, digest, chain binding, expiry, closed-object
 * shape, limit presence and internal consistency". **Preconditions** (§11.5) are re-reads
 * of *chain state* at `B′`. Putting a file-derived row into the precondition table would
 * make §11.4 rule 2 — every row is an exact chain read — false.
 *
 * All seven admission checks live in this one function, in the order §11.14.1 lists them,
 * and a document that fails any of them never becomes a transaction at all.
 *
 * ## The digest gate is inside, and that is the point
 *
 * An earlier draft of this module had no digest check whatsoever: `FE-HANDOFF-010` was
 * defined and never emitted, so the one refusal that detects a truncated or altered file
 * was unreachable. The fix is not merely to add the check but to make it **impossible to
 * skip** — the same lesson as `assertCheckable` in `packages/verify`, which protected only
 * the callers who remembered to call it. So there is no exported structural-parse-only
 * entry point to reach around, and the hash function is a **required** field of the
 * admission context rather than an optional one: an optional digest defaults to *not
 * checked*, which is the vacuous green this repository keeps rediscovering.
 *
 * Hashing itself is the caller's job (`SubtleCrypto` in a browser, `createHash` in node,
 * Tauri elsewhere) for the reason `packages/verify` gives, and the pre-image construction
 * — the part that must not vary — comes from `@bleavit/handoff-envelope`.
 *
 * ## The asymmetry that is easy to get backwards
 *
 * Unknown keys at the **top level** are tolerated; unknown keys inside `binding`, `action`
 * or `limits` are **refused** (`FE-HANDOFF-004`). That looks inconsistent and is the most
 * important rule here. 10 §13.2: at the top level an unknown key is a producer annotation
 * no consumer reads, whereas inside `action` it is *a proposed semantic* — and it is
 * precisely where an encoded call would be placed. Tolerating it there would be
 * tolerating the attack. 10 §13.1 settles the boundary: the envelope has "a frozen field
 * core with consumer-tolerated extras **at the top level only**", so every nested core
 * object is closed, `binding` included.
 *
 * ## Refused whole, never repaired
 *
 * *"The parser never strips a field and proceeds, never partially accepts, and never falls
 * back to a safe subset."* So every check returns a refusal for the entire document. There
 * is no sanitising path, because a sanitiser turns an attack into a slightly different
 * accepted document.
 *
 * ## The input is text, deliberately
 *
 * Every transport 10 §13.4 names — files, the clipboard, the share sheet, a deep link —
 * delivers text, so admission takes a string and does its own `JSON.parse`. Accepting a
 * caller-built object instead was a convenience for tests that widened the attack surface
 * in a way that is easy to miss: a property with a **getter** throws out of the parser
 * instead of returning a refusal, and one that returns a different value on each read
 * makes the value that was validated a different value from the one that is used. Parsing
 * the text ourselves means every field downstream is plain JSON data, and both classes
 * disappear rather than being defended against one read at a time.
 *
 * ## What is deliberately absent
 *
 * **No replay guard.** 10 §13.3 records this as a decision, not an omission: remembering
 * which documents have been seen would falsify the property that an imported document
 * cannot alter a later operation, in exchange for a guard one changed byte defeats. What
 * makes replay harmless is that nothing is remembered — a re-import is just an import,
 * rebuilt and re-clamped against freshly read state.
 *
 * **No device clock.** A deadline is compared against `B′`, the chain clock (11 §11.14.3).
 * A device clock is attacker-influenceable and, more simply, wrong often enough to expire
 * valid requests.
 */

import { digestPreimage } from '@bleavit/handoff-envelope';

import { refuse, type HandoffRefusal } from './refusals.js';

export const INTENT_SCHEMA = 'bleavit.intent.v1';

/**
 * The domain-separation tag for this format's digest (10 §13.1).
 *
 * Equal to the schema string, as the outbound tags are: the tag names the format, and a
 * tag that could disagree with the `schema` field would be a second name for one thing.
 */
export const INTENT_DOMAIN_TAG = INTENT_SCHEMA;

/** 11 §11.14.2's closed vocabulary — three actions, matching what S3/S4 already offer. */
export const INTENT_ACTIONS = Object.freeze([
  'prepare_pass_position',
  'prepare_fail_position',
  'close_position',
] as const);

export type IntentActionKind = (typeof INTENT_ACTIONS)[number];

/* ------------------------------------------------------------------------------------ *
 * Parser bounds — 10 §13.2: "computed, not chosen"
 * ------------------------------------------------------------------------------------ */

/** Decimal digits in the largest value an n-bit unsigned integer holds. */
const decimalDigits = (bits: number): number => (2n ** BigInt(bits) - 1n).toString().length;

const U32_MAX = 2n ** 32n - 1n;
const U64_MAX = 2n ** 64n - 1n;
const U128_MAX = 2n ** 128n - 1n;

const U32_DIGITS = decimalDigits(32);
const U64_DIGITS = decimalDigits(64);
const U128_DIGITS = decimalDigits(128);
/** `H256` rendered as `0x` + 32 bytes of hex — the genesis hash's frozen width. */
const H256_HEX_CHARS = 2 + 32 * 2;
/** SHA-256 rendered as hex. The digest field's width. */
const DIGEST_HEX_CHARS = 32 * 2;
const PPM = 1_000_000;
const PPM_DIGITS = String(PPM).length;

/**
 * The frozen field core, each leaf with the widest value its **02-frozen type** admits.
 *
 * This table is the derivation 10 §13.2 asks for. Every ceiling traces to a type width
 * rather than to a preference: `ProposalId`/position ids are `u64`, `Balance` is `u128`,
 * `BlockNumber` and the two versions are `u32`, the genesis hash is `H256`, and the action
 * vocabulary is closed so its longest member is a computed constant. Add a field to the
 * format and the document bound moves by itself; that is the property that makes it
 * computed rather than chosen.
 */
const STRING_QUOTES = 2;
const LEAF_CEILINGS: readonly (readonly [container: string | null, leaf: string, value: number])[] =
  [
    [null, 'schema', INTENT_SCHEMA.length + STRING_QUOTES],
    [null, 'digest', DIGEST_HEX_CHARS + STRING_QUOTES],
    ['binding', 'genesisHash', H256_HEX_CHARS + STRING_QUOTES],
    ['binding', 'specVersion', U32_DIGITS],
    ['binding', 'contractVersion', U32_DIGITS],
    ['action', 'kind', Math.max(...INTENT_ACTIONS.map((a) => a.length)) + STRING_QUOTES],
    ['action', 'id', U64_DIGITS + STRING_QUOTES],
    ['action', 'collateral', U128_DIGITS + STRING_QUOTES],
    ['action', 'fractionPpm', PPM_DIGITS],
    ['limits', 'maxCost', U128_DIGITS + STRING_QUOTES],
    ['limits', 'minProceeds', U128_DIGITS + STRING_QUOTES],
    ['limits', 'deadlineBlock', U32_DIGITS],
  ];

/** `"name":value,` — the JSON a leaf costs at its ceiling. */
const leafBytes = (leaf: string, value: number): number => leaf.length + STRING_QUOTES + 1 + value + 1;

const FROZEN_CORE_CEILING_BYTES =
  2 + // the document's own braces
  LEAF_CEILINGS.reduce((total, [, leaf, value]) => total + leafBytes(leaf, value), 0) +
  // each nested core object costs its own `"name":{},`
  ['binding', 'action', 'limits'].reduce((total, name) => total + leafBytes(name, 2), 0);

/**
 * The document byte cap.
 *
 * The frozen core at its ceiling, plus an equal budget for the top-level annotations
 * 10 §13.1 tolerates. That factor of two is the single judgement in the derivation, and it
 * is stated rather than folded into a round number: a producer may annotate at most as
 * much as the format itself carries. It leaves roughly a kilobyte, which is generous for
 * machine annotations and useless for anything else — the format carries no free text at
 * all (10 §13.2), so there is nothing legitimate that needs the room a 64 KiB cap gives.
 */
export const MAX_DOCUMENT_BYTES = FROZEN_CORE_CEILING_BYTES * 2;

/**
 * The nesting cap, derived the same way.
 *
 * The format's own deepest value sits at depth 2 (`{binding:{genesisHash}}`), and an
 * annotation is allowed one level deeper than the format it annotates. Nothing that
 * exists to be ignored needs to nest further than the thing it describes.
 */
const FROZEN_CORE_DEPTH = 2;
export const MAX_DEPTH = FROZEN_CORE_DEPTH + 1;

/* ------------------------------------------------------------------------------------ *
 * The format
 * ------------------------------------------------------------------------------------ */

/** The chain binding every inbound document is gated on by exact equality (10 §13.1). */
export interface ChainBinding {
  readonly genesisHash: string;
  readonly specVersion: number;
  readonly contractVersion: number;
}

export interface IntentAction {
  readonly kind: IntentActionKind;
  /** The target's `u64` chain id. Re-resolved against chain state before display. */
  readonly id: bigint;
  /**
   * Size as **collateral base units**, never instrument quantity (11 §11.14.2): the LMSR
   * inversion is exactly the arithmetic an external tool gets wrong, and doing it
   * client-side is what makes the cost ceiling derivable and therefore clampable.
   * Present for the two `prepare_*` actions.
   */
  readonly collateral?: bigint;
  /**
   * A close is a **fraction in parts-per-million**, never an absolute amount. An absolute
   * amount from a stale capsule can exceed the current holding or leave unredeemable
   * dust; a fraction clamps naturally against a freshly read balance. Security choice,
   * not convenience. Present for `close_position`.
   */
  readonly fractionPpm?: number;
}

export interface IntentLimits {
  /** Ceiling on cost, in collateral base units. Narrowed by the client, never widened. */
  readonly maxCost?: bigint;
  /** Floor on proceeds. Raised by the client, never lowered. */
  readonly minProceeds?: bigint;
  /** Compared against `B′`, the chain clock — never the device clock. */
  readonly deadlineBlock?: number;
}

export interface Intent {
  readonly schema: typeof INTENT_SCHEMA;
  readonly binding: ChainBinding;
  readonly action: IntentAction;
  readonly limits: IntentLimits;
  /** The verified digest, as the document carried it. Integrity only — it authenticates
   * nothing (10 §13.1), and nothing downstream may treat it as provenance. */
  readonly digest: string;
}

export type AdmissionResult =
  | { readonly ok: true; readonly intent: Intent }
  | { readonly ok: false; readonly refusal: HandoffRefusal };

/**
 * What admission needs from the client. Every field is required.
 *
 * `digest` is a hash over the pre-image bytes, returning **lowercase hex**. It is required
 * rather than optional for the reason in the module note: an optional hash function is a
 * digest check that defaults to off.
 */
export interface AdmissionContext {
  /** The client's own binding, read from the chain. */
  readonly live: ChainBinding;
  /** `B′` — the chain clock. Never a device clock. */
  readonly currentBlock: number;
  readonly digest: (preimage: Uint8Array) => string | Promise<string>;
}

const CORE_CONTAINERS = ['binding', 'action', 'limits'] as const;
const BINDING_KEYS = new Set(['genesisHash', 'specVersion', 'contractVersion']);
const ACTION_KEYS = new Set(['kind', 'id', 'collateral', 'fractionPpm']);
const LIMIT_KEYS = new Set(['maxCost', 'minProceeds', 'deadlineBlock']);

const LOWERCASE_HEX = /^[0-9a-f]+$/;
/** A canonical decimal integer: no sign, no leading zeros, no exponent, no whitespace. */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/;

const bad = (refusal: HandoffRefusal): AdmissionResult => ({ ok: false, refusal });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Depth guard applied before any semantic read — a bomb must not be parsed to be refused.
 *
 * Arrays count as depth-bearing even though the format contains none: a guard that walks
 * only objects leaves `[[[[…]]]]` unbounded, and the recursion that later serializes the
 * core for the digest does descend arrays.
 */
function depthOf(value: unknown, depth = 0): number {
  const isContainer = isPlainObject(value) || Array.isArray(value);
  if (depth > MAX_DEPTH || !isContainer) return depth;
  let max = depth;
  for (const inner of Object.values(value as object)) {
    max = Math.max(max, depthOf(inner, depth + 1));
    if (max > MAX_DEPTH) return max;
  }
  return max;
}

/**
 * A `u128` base-unit amount, accepted **only** as a canonical decimal string.
 *
 * A JSON number is refused rather than converted. Base-unit amounts run past 2^53, where
 * `JSON.parse` corrupts them silently — the V-74 trap, whose whole lesson was that a
 * consumer of exact integers must load them through a discipline that cannot round. That a
 * small amount would survive the round trip is not a reason to admit the type: it would
 * mean the same amount has two spellings, one of which is lossy above a threshold no
 * producer is tracking.
 */
function readU128(raw: unknown): bigint | undefined {
  if (typeof raw !== 'string' || !CANONICAL_DECIMAL.test(raw)) return undefined;
  const value = BigInt(raw);
  return value <= U128_MAX ? value : undefined;
}

/** A `u32`, as a JSON number. Exactly representable, so a string spelling is refused. */
function readU32(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return undefined;
  return BigInt(raw) <= U32_MAX ? raw : undefined;
}

/**
 * Admit an inbound document, or return the single refusal that stopped it.
 *
 * The checks run in 11 §11.14.1's order — schema, digest, chain binding, expiry, closed
 * shape, limits — after the resource bounds, which are not admission checks but the
 * guard that makes running them affordable.
 */
export async function admitIntent(
  document: unknown,
  ctx: AdmissionContext,
): Promise<AdmissionResult> {
  if (typeof ctx?.digest !== 'function') {
    // A programmer error, not a document condition, so it throws rather than joining the
    // refusal taxonomy: every `FE-HANDOFF-*` code names something a *file* did, and a
    // client with no hash function has not been handed a bad file — it has been built
    // wrong, and rendering that to a user as "this file is damaged" would hide the bug.
    throw new TypeError('admitIntent requires a digest function; there is no unchecked path');
  }

  /* -- resource bounds ------------------------------------------------------------- */

  if (typeof document !== 'string') {
    return bad(refuse('FE-HANDOFF-002', 'the document was not supplied as text'));
  }
  // UTF-8 length is never smaller than the UTF-16 code-unit count, so the cheap check is a
  // sound fast reject; the exact measure follows because it is the one the cap is stated
  // in. Comparing `.length` alone would let a document of astral characters carry four
  // bytes per unit and pass a byte cap it exceeds fourfold.
  if (document.length > MAX_DOCUMENT_BYTES) {
    return bad(refuse('FE-HANDOFF-002', `the document exceeds ${MAX_DOCUMENT_BYTES} bytes`));
  }
  if (new TextEncoder().encode(document).byteLength > MAX_DOCUMENT_BYTES) {
    return bad(refuse('FE-HANDOFF-002', `the document exceeds ${MAX_DOCUMENT_BYTES} bytes`));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(document) as unknown;
  } catch {
    return bad(refuse('FE-HANDOFF-002', 'the document is not valid JSON'));
  }
  if (!isPlainObject(parsed)) {
    return bad(refuse('FE-HANDOFF-002', 'the document is not a JSON object'));
  }
  if (depthOf(parsed) > MAX_DEPTH) {
    return bad(refuse('FE-HANDOFF-002', `the document nests deeper than ${MAX_DEPTH}`));
  }

  /* -- 1. schema equality ---------------------------------------------------------- */

  if (parsed['schema'] !== INTENT_SCHEMA) {
    return bad(refuse('FE-HANDOFF-001', `the schema field is not ${INTENT_SCHEMA}`));
  }

  /* -- 2. digest ------------------------------------------------------------------- */

  for (const container of CORE_CONTAINERS) {
    if (!isPlainObject(parsed[container])) {
      return bad(refuse('FE-HANDOFF-002', `the ${container} object is missing`));
    }
  }
  const binding = parsed['binding'] as Record<string, unknown>;
  const action = parsed['action'] as Record<string, unknown>;
  const limitsRaw = parsed['limits'] as Record<string, unknown>;

  const claimed = parsed['digest'];
  if (
    typeof claimed !== 'string' ||
    claimed.length === 0 ||
    claimed.length % 2 !== 0 ||
    !LOWERCASE_HEX.test(claimed)
  ) {
    return bad(refuse('FE-HANDOFF-002', 'the digest field is not lowercase hex'));
  }
  // The core projection is the frozen field core **as received** — never the normalized
  // values — because the producer hashed what it sent. Top-level annotations are excluded:
  // they are extras no consumer reads, and hashing them would mean a relay that adds one
  // breaks a document it did not alter.
  let expected: string;
  try {
    const preimage = digestPreimage(INTENT_DOMAIN_TAG, {
      schema: INTENT_SCHEMA,
      binding,
      action,
      limits: limitsRaw,
    });
    expected = await ctx.digest(preimage);
  } catch {
    // The only way canonicalization fails on `JSON.parse` output is a number the parse
    // already corrupted (past 2^53) — a damaged document, not a hash failure.
    return bad(refuse('FE-HANDOFF-002', 'the document contains a value that cannot be encoded'));
  }
  if (typeof expected !== 'string' || !LOWERCASE_HEX.test(expected)) {
    throw new TypeError('the supplied digest function did not return lowercase hex');
  }
  if (claimed !== expected) {
    return bad(refuse('FE-HANDOFF-010', 'the document does not match its own digest'));
  }

  /* -- 3. chain binding ------------------------------------------------------------ */

  for (const key of Object.keys(binding)) {
    if (!BINDING_KEYS.has(key)) {
      return bad(
        refuse('FE-HANDOFF-004', 'binding admits only genesisHash, specVersion and contractVersion'),
      );
    }
  }
  const specVersion = readU32(binding['specVersion']);
  const contractVersion = readU32(binding['contractVersion']);
  if (specVersion === undefined || contractVersion === undefined) {
    return bad(refuse('FE-HANDOFF-002', 'binding.specVersion and binding.contractVersion must be u32'));
  }
  if (binding['genesisHash'] !== ctx.live.genesisHash || contractVersion !== ctx.live.contractVersion) {
    return bad(refuse('FE-HANDOFF-005', 'the document names a different chain'));
  }
  if (specVersion > ctx.live.specVersion) {
    // Older is admitted and rebuilt; newer is refused. An intent's version never
    // selects an encoding (10 §13.3).
    return bad(
      refuse(
        'FE-HANDOFF-006',
        `the document targets spec_version ${specVersion} and this client runs against ${ctx.live.specVersion}`,
      ),
    );
  }

  /* -- 4. expiry ------------------------------------------------------------------- */

  let deadlineBlock: number | undefined;
  if (limitsRaw['deadlineBlock'] !== undefined) {
    deadlineBlock = readU32(limitsRaw['deadlineBlock']);
    if (deadlineBlock === undefined || deadlineBlock === 0) {
      return bad(refuse('FE-HANDOFF-007', 'limits.deadlineBlock is not a positive u32'));
    }
    if (deadlineBlock <= ctx.currentBlock) {
      return bad(
        refuse(
          'FE-HANDOFF-008',
          `the request expires at block ${deadlineBlock} and the chain is at ${ctx.currentBlock}`,
        ),
      );
    }
  }

  /* -- 5. closed-object shape ------------------------------------------------------ */

  for (const key of Object.keys(action)) {
    if (!ACTION_KEYS.has(key)) {
      return bad(refuse('FE-HANDOFF-004', 'action admits only kind, id, collateral and fractionPpm'));
    }
  }
  for (const key of Object.keys(limitsRaw)) {
    if (!LIMIT_KEYS.has(key)) {
      return bad(
        refuse('FE-HANDOFF-004', 'limits admits only maxCost, minProceeds and deadlineBlock'),
      );
    }
  }

  /* -- 6. limit presence and internal consistency ---------------------------------- */

  const kind = action['kind'];
  if (typeof kind !== 'string' || !(INTENT_ACTIONS as readonly string[]).includes(kind)) {
    return bad(refuse('FE-HANDOFF-003', 'action.kind is not one of the three admitted actions'));
  }
  const actionKind = kind as IntentActionKind;

  // The id is a `u64` chain id in all three actions, carried as a canonical decimal
  // string. Restricting it to digits is not tidiness: it is what makes 11 §11.14.4's
  // defence against id substitution possible at all, since an id that cannot be resolved
  // against chain state cannot have its identity rendered beside it. It also removes, in
  // one rule rather than a blocklist, every string that is not an id — a URL, a control
  // character, a bidirectional override, a homoglyph of a different id.
  const rawId = action['id'];
  if (typeof rawId !== 'string' || !CANONICAL_DECIMAL.test(rawId) || BigInt(rawId) > U64_MAX) {
    return bad(refuse('FE-HANDOFF-002', 'action.id is not a canonical u64 decimal string'));
  }
  const id = BigInt(rawId);

  let collateral: bigint | undefined;
  let fractionPpm: number | undefined;

  if (actionKind === 'close_position') {
    const fraction = action['fractionPpm'];
    if (typeof fraction !== 'number' || !Number.isInteger(fraction) || fraction <= 0 || fraction > PPM) {
      return bad(refuse('FE-HANDOFF-007', 'close_position needs a fraction in (0, 1_000_000] ppm'));
    }
    fractionPpm = fraction;
    if (action['collateral'] !== undefined) {
      return bad(refuse('FE-HANDOFF-004', 'close_position is a fraction and takes no collateral'));
    }
  } else {
    collateral = readU128(action['collateral']);
    // Never defaulted: 10 §13.2, "there is no safe default for money".
    if (collateral === undefined || collateral === 0n) {
      return bad(
        refuse('FE-HANDOFF-007', 'a prepare action needs a positive u128 collateral decimal string'),
      );
    }
    if (action['fractionPpm'] !== undefined) {
      return bad(
        refuse('FE-HANDOFF-004', 'a prepare action is sized in collateral and takes no fraction'),
      );
    }
  }

  const limits: { maxCost?: bigint; minProceeds?: bigint; deadlineBlock?: number } = {};
  for (const key of ['maxCost', 'minProceeds'] as const) {
    if (limitsRaw[key] !== undefined) {
      const amount = readU128(limitsRaw[key]);
      if (amount === undefined) {
        return bad(refuse('FE-HANDOFF-007', `limits.${key} is not a u128 decimal string`));
      }
      limits[key] = amount;
    }
  }
  if (deadlineBlock !== undefined) limits.deadlineBlock = deadlineBlock;
  // A buy ceiling and a sell floor in one document describe two different trades.
  if (limits.maxCost !== undefined && limits.minProceeds !== undefined) {
    return bad(refuse('FE-HANDOFF-007', 'maxCost and minProceeds are mutually exclusive'));
  }

  return {
    ok: true,
    intent: {
      schema: INTENT_SCHEMA,
      binding: {
        genesisHash: ctx.live.genesisHash,
        specVersion,
        contractVersion: ctx.live.contractVersion,
      },
      action: {
        kind: actionKind,
        id,
        ...(collateral !== undefined ? { collateral } : {}),
        ...(fractionPpm !== undefined ? { fractionPpm } : {}),
      },
      limits,
      digest: claimed,
    },
  };
}
