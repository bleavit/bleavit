/**
 * `bleavit.intent.v1` — the only inbound format (10 §13.1–§13.3, 11 §11.14).
 *
 * This parser is the attack surface of the whole handoff subsystem, and 10 §13's three
 * load-bearing sentences are what it implements:
 *
 *  1. *An imported action is exactly as trusted as keyboard input, and travels the same
 *     code path.* The external tool is a keyboard, not a data source.
 *  2. *The only inbound format carries no chain state — only a request.* No field of an
 *     intent asserts anything about the chain.
 *  3. *No format carries an encoded call, in either direction.*
 *
 * ## The asymmetry that is easy to get backwards
 *
 * Unknown keys at the **top level** are tolerated; unknown keys inside `action` or
 * `limits` are **refused** (`FE-HANDOFF-004`). That looks inconsistent and is the most
 * important rule here. 10 §13.2: at the top level an unknown key is a producer annotation
 * no consumer reads, whereas inside `action` it is *a proposed semantic* — and it is
 * precisely where an encoded call would be placed. Tolerating it there would be
 * tolerating the attack.
 *
 * ## Refused whole, never repaired
 *
 * *"The parser never strips a field and proceeds, never partially accepts, and never falls
 * back to a safe subset."* So every check returns a refusal for the entire document. There
 * is no sanitising path, because a sanitiser turns an attack into a slightly different
 * accepted document.
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

import { refuse, type HandoffRefusal } from './refusals.js';

export const INTENT_SCHEMA = 'bleavit.intent.v1';

/** 11 §11.14.2's closed vocabulary — three actions, matching what S3/S4 already offer. */
export const INTENT_ACTIONS = Object.freeze([
  'prepare_pass_position',
  'prepare_fail_position',
  'close_position',
] as const);

export type IntentActionKind = (typeof INTENT_ACTIONS)[number];

/**
 * Parser resource bounds — 10 §13.2: "computed, not chosen".
 *
 * These are client resource bounds derived from the 02-frozen view bounds times a
 * per-field ceiling, which is why they live here and not in doc 13: they bound what this
 * parser will read, and say nothing about what the chain permits.
 */
export const MAX_DOCUMENT_BYTES = 64 * 1024;
export const MAX_DEPTH = 8;

/** The chain binding every inbound document is gated on by exact equality (10 §13.1). */
export interface ChainBinding {
  readonly genesisHash: string;
  readonly specVersion: number;
  readonly contractVersion: number;
}

export interface IntentAction {
  readonly kind: IntentActionKind;
  /** The target the action names. Re-resolved against chain state before display. */
  readonly id: string;
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
}

export type ParseResult =
  | { readonly ok: true; readonly intent: Intent }
  | { readonly ok: false; readonly refusal: HandoffRefusal };

const ACTION_KEYS = new Set(['kind', 'id', 'collateral', 'fractionPpm']);
const LIMIT_KEYS = new Set(['maxCost', 'minProceeds', 'deadlineBlock']);
const PPM = 1_000_000;

const bad = (refusal: HandoffRefusal): ParseResult => ({ ok: false, refusal });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Depth guard applied before any semantic read — a bomb must not be parsed to be refused. */
function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_DEPTH || !isPlainObject(value)) return depth;
  let max = depth;
  for (const inner of Object.values(value)) max = Math.max(max, depthOf(inner, depth + 1));
  return max;
}

/**
 * A non-negative integer, accepted from a JSON number or a decimal string.
 *
 * Strings are accepted because JSON numbers past 2^53 lose precision silently, and a
 * collateral amount in base units runs past it — the same trap the vector corpus hit
 * (V-74). A string that is not a plain decimal integer is refused rather than coerced.
 */
function readAmount(raw: unknown): bigint | undefined {
  if (typeof raw === 'bigint') return raw >= 0n ? raw : undefined;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) return undefined;
    return BigInt(raw);
  }
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) return BigInt(raw);
  return undefined;
}

/**
 * Parse an inbound document. Returns the intent or the single refusal that stopped it.
 *
 * `live` is the client's own binding, read from the chain — the document is gated on it
 * by exact equality, except that an **older** `specVersion` is admitted: 10 §13.3 makes
 * that asymmetry explicit, because a document from an older runtime is rebuilt against
 * live descriptors, while a newer one describes a surface this client cannot check
 * (INV-FE-12 fails safe when the runtime surface is unknown).
 */
export function parseIntent(raw: unknown, live: ChainBinding): ParseResult {
  if (typeof raw === 'string') {
    if (raw.length > MAX_DOCUMENT_BYTES) {
      return bad(refuse('FE-HANDOFF-002', `document exceeds ${MAX_DOCUMENT_BYTES} bytes`));
    }
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return bad(refuse('FE-HANDOFF-002', 'document is not valid JSON'));
    }
  }
  if (!isPlainObject(raw)) return bad(refuse('FE-HANDOFF-002', 'document is not an object'));
  if (depthOf(raw) > MAX_DEPTH) {
    return bad(refuse('FE-HANDOFF-002', `document nests deeper than ${MAX_DEPTH}`));
  }

  // Exact equality, never `startsWith` or a version range.
  if (raw['schema'] !== INTENT_SCHEMA) {
    return bad(refuse('FE-HANDOFF-001', `schema is not ${INTENT_SCHEMA}`));
  }

  const binding = raw['binding'];
  if (!isPlainObject(binding)) return bad(refuse('FE-HANDOFF-002', 'binding is missing'));
  if (
    binding['genesisHash'] !== live.genesisHash ||
    binding['contractVersion'] !== live.contractVersion
  ) {
    return bad(refuse('FE-HANDOFF-005', 'the document names a different chain'));
  }
  const specVersion = binding['specVersion'];
  if (typeof specVersion !== 'number' || !Number.isInteger(specVersion)) {
    return bad(refuse('FE-HANDOFF-002', 'binding.specVersion is not an integer'));
  }
  if (specVersion > live.specVersion) {
    // Older is admitted and rebuilt; newer is refused. An intent's version never
    // selects an encoding (10 §13.3).
    return bad(
      refuse('FE-HANDOFF-006', `document targets spec_version ${specVersion}, live is ${live.specVersion}`),
    );
  }

  const action = raw['action'];
  if (!isPlainObject(action)) return bad(refuse('FE-HANDOFF-002', 'action is missing'));
  // The asymmetry: closed here, tolerant at the top level.
  for (const key of Object.keys(action)) {
    if (!ACTION_KEYS.has(key)) {
      return bad(refuse('FE-HANDOFF-004', `action carries the foreign field "${key}"`));
    }
  }
  const kind = action['kind'];
  if (typeof kind !== 'string' || !(INTENT_ACTIONS as readonly string[]).includes(kind)) {
    return bad(refuse('FE-HANDOFF-003', 'action.kind is not one of the three admitted actions'));
  }
  const id = action['id'];
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return bad(refuse('FE-HANDOFF-002', 'action.id is missing or implausible'));
  }

  const limitsRaw = raw['limits'];
  if (!isPlainObject(limitsRaw)) return bad(refuse('FE-HANDOFF-002', 'limits is missing'));
  for (const key of Object.keys(limitsRaw)) {
    if (!LIMIT_KEYS.has(key)) {
      return bad(refuse('FE-HANDOFF-004', `limits carries the foreign field "${key}"`));
    }
  }

  const actionKind = kind as IntentActionKind;
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
    collateral = readAmount(action['collateral']);
    // Never defaulted: 10 §13.2, "there is no safe default for money".
    if (collateral === undefined || collateral === 0n) {
      return bad(refuse('FE-HANDOFF-007', `${actionKind} needs a positive collateral amount`));
    }
    if (action['fractionPpm'] !== undefined) {
      return bad(refuse('FE-HANDOFF-004', `${actionKind} is sized in collateral and takes no fraction`));
    }
  }

  const limits: {
    maxCost?: bigint;
    minProceeds?: bigint;
    deadlineBlock?: number;
  } = {};
  for (const [key, target] of [['maxCost', 'maxCost'], ['minProceeds', 'minProceeds']] as const) {
    if (limitsRaw[key] !== undefined) {
      const amount = readAmount(limitsRaw[key]);
      if (amount === undefined) {
        return bad(refuse('FE-HANDOFF-007', `limits.${key} is not a non-negative integer`));
      }
      limits[target] = amount;
    }
  }
  if (limitsRaw['deadlineBlock'] !== undefined) {
    const deadline = limitsRaw['deadlineBlock'];
    if (typeof deadline !== 'number' || !Number.isInteger(deadline) || deadline <= 0) {
      return bad(refuse('FE-HANDOFF-007', 'limits.deadlineBlock is not a positive integer'));
    }
    limits.deadlineBlock = deadline;
  }
  // A buy ceiling and a sell floor in one document describe two different trades.
  if (limits.maxCost !== undefined && limits.minProceeds !== undefined) {
    return bad(refuse('FE-HANDOFF-007', 'maxCost and minProceeds are mutually exclusive'));
  }

  return {
    ok: true,
    intent: {
      schema: INTENT_SCHEMA,
      binding: { genesisHash: live.genesisHash, specVersion, contractVersion: live.contractVersion },
      action: {
        kind: actionKind,
        id,
        ...(collateral !== undefined ? { collateral } : {}),
        ...(fractionPpm !== undefined ? { fractionPpm } : {}),
      },
      limits,
    },
  };
}
