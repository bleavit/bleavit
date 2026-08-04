/**
 * Clamping — 11 §11.14.3, "the client asserts authority over the tool".
 *
 * *"A limit is never widened, only narrowed."* For a buy the encoded ceiling is the
 * **minimum** of what the intent asked, what the client's own recomputed cost at `B′`
 * permits under the stated slippage, and the client's own policy cap. Symmetrically, a
 * floor on proceeds is only **raised**.
 *
 * ## Why `min`/`max` rather than "use the intent's value if present"
 *
 * The intent is a request from something with no authority. The failure this prevents is
 * not a tool asking for something absurd — that is caught at admission — but a tool
 * asking for something *plausible and slightly too generous*, which a client that treated
 * the stated ceiling as authoritative would encode. Taking the minimum means a tool can
 * only ever make the user's exposure **smaller** than the client would have allowed, so
 * the worst a hostile document achieves is a transaction the user would have been
 * permitted to make anyway, on worse terms for the attacker.
 *
 * ## A missing chain value is a refusal, not an absent limit
 *
 * This is where an earlier draft failed open, and the failure is worth naming because it
 * looks like nothing: when the client had computed no ceiling of its own, the whole
 * `maxCost` entry was simply omitted from the result. The tool's stated ceiling vanished
 * with it, and what reached the encoder was a trade with **no cost bound at all** — the
 * widest possible limit, produced by a function whose entire contract is that limits only
 * narrow. Nothing threw and nothing was logged.
 *
 * So the chain-side value is mandatory for whichever direction the trade has, and its
 * absence returns `FE-HANDOFF-011`. That code reads "no longer possible against current
 * chain state", which is exactly true: without a recomputed bound at `B′` the client
 * cannot state what it would permit, and encoding anyway is the one thing it must not do.
 *
 * ## Expiry appears twice, under two different codes, and that is deliberate
 *
 * 11 §11.14.1 separates **admission checks** (properties of a file) from **preconditions**
 * (re-reads of chain state at `B′`), and expiry is genuinely both. A deadline already past
 * when the document arrives is an admission failure — `FE-HANDOFF-008`, "this request has
 * expired", raised before the transaction enters Draft. A deadline that passes *between*
 * admission and the refreshed block is not a property of the file at all; the file was
 * fine and the chain moved. That is `FE-HANDOFF-011`, and collapsing the two would either
 * tell a user their file is bad when it never was, or let a refresh-time expiry through
 * the gap between the two checks.
 *
 * ## The difference is shown, not silently applied
 *
 * 11 §11.14.3 requires it, and the reason is INV-FE-9's: the asked value and the encoded
 * value are two different facts with two different provenances — one `external-proposal`,
 * one chain-derived — and collapsing them into one displayed number destroys exactly the
 * distinction that lets a user notice the tool asked for something the client refused.
 * `Clamped` therefore carries all three values and which one bound.
 */

import type { IntentLimits } from './admission.js';
import { refuse, type HandoffRefusal } from './refusals.js';

/** Which input bound the encoded value — shown in expert mode (11 §11.14.3). */
export type ClampSource = 'intent' | 'chain' | 'policy';

export interface Clamped<T> {
  /** What the tool asked for. Renders at `external-proposal` status wherever shown. */
  readonly asked: T | undefined;
  /** The client's own value at `B′`. */
  readonly chain: T;
  /** What will actually be encoded. */
  readonly encoded: T;
  readonly boundBy: ClampSource;
  /** True when the client's number is the binding one — the difference must be shown. */
  readonly narrowed: boolean;
}

function clampCeiling(asked: bigint | undefined, chain: bigint, policy?: bigint): Clamped<bigint> {
  let encoded = chain;
  let boundBy: ClampSource = 'chain';
  if (asked !== undefined && asked < encoded) {
    encoded = asked;
    boundBy = 'intent';
  }
  if (policy !== undefined && policy < encoded) {
    encoded = policy;
    boundBy = 'policy';
  }
  return { asked, chain, encoded, boundBy, narrowed: asked === undefined || encoded < asked };
}

function clampFloor(asked: bigint | undefined, chain: bigint, policy?: bigint): Clamped<bigint> {
  let encoded = chain;
  let boundBy: ClampSource = 'chain';
  if (asked !== undefined && asked > encoded) {
    encoded = asked;
    boundBy = 'intent';
  }
  if (policy !== undefined && policy > encoded) {
    encoded = policy;
    boundBy = 'policy';
  }
  return { asked, chain, encoded, boundBy, narrowed: asked === undefined || encoded > asked };
}

export interface ClampInputs {
  /** The client's own recomputed cost ceiling at `B′`. Required for a buy. */
  readonly chainMaxCost?: bigint;
  /** The client's own recomputed proceeds floor at `B′`. Required for a sell. */
  readonly chainMinProceeds?: bigint;
  readonly policyMaxCost?: bigint;
  readonly policyMinProceeds?: bigint;
  /** `B′` — the chain clock. Never a device clock. */
  readonly currentBlock: number;
  /** The client's own deadline, e.g. mortality-derived. */
  readonly chainDeadlineBlock: number;
}

export interface ClampedLimits {
  readonly maxCost?: Clamped<bigint>;
  readonly minProceeds?: Clamped<bigint>;
  readonly deadlineBlock: Clamped<number>;
  /** True if any limit was narrowed by the client — the confirm screen must show it. */
  readonly anyNarrowed: boolean;
}

export type ClampResult =
  | { readonly ok: true; readonly limits: ClampedLimits }
  | { readonly ok: false; readonly refusal: HandoffRefusal };

/**
 * Apply the narrow-only rule to an admitted intent's limits at the refreshed block.
 *
 * Returns a refusal rather than throwing. An exception here would escape the
 * `FE-HANDOFF-*` taxonomy entirely: the caller is the import flow, whose whole contract
 * with the user is that every rejection arrives as a coded refusal with fixed copy and a
 * stated recovery. A thrown error reaches the user, if at all, as an unhandled failure
 * with none of those.
 */
export function clampLimits(limits: IntentLimits, inputs: ClampInputs): ClampResult {
  // The client's own inputs are checked first, and against each other. A
  // `chainDeadlineBlock` already at or behind `B'` is a mortality window with nothing in
  // it — the encoded transaction would be born expired — and `NaN` propagates through
  // `Math.min` to produce an encoded deadline of `NaN`. Neither is a hostile document; both
  // are a client that has computed something wrong, and encoding either is worse than
  // refusing, because the user pays for a transaction that cannot be included.
  if (
    !Number.isInteger(inputs.currentBlock) ||
    !Number.isInteger(inputs.chainDeadlineBlock) ||
    inputs.currentBlock < 0 ||
    inputs.chainDeadlineBlock <= inputs.currentBlock
  ) {
    return {
      ok: false,
      refusal: refuse(
        'FE-HANDOFF-011',
        'the client holds no usable mortality window at the refreshed block',
      ),
    };
  }
  if (limits.deadlineBlock !== undefined && limits.deadlineBlock <= inputs.currentBlock) {
    return {
      ok: false,
      refusal: refuse(
        'FE-HANDOFF-011',
        `the request expires at block ${limits.deadlineBlock} and the refreshed chain is at ` +
          `${inputs.currentBlock}`,
      ),
    };
  }

  // Whichever direction the tool stated, the client must hold its own recomputed value for
  // that direction; there is nothing to narrow against otherwise.
  if (limits.maxCost !== undefined && inputs.chainMaxCost === undefined) {
    return {
      ok: false,
      refusal: refuse('FE-HANDOFF-011', 'no client-side cost ceiling was recomputed at this block'),
    };
  }
  if (limits.minProceeds !== undefined && inputs.chainMinProceeds === undefined) {
    return {
      ok: false,
      refusal: refuse('FE-HANDOFF-011', 'no client-side proceeds floor was recomputed at this block'),
    };
  }
  // A trade has a direction whether or not the document stated one, so at least one of the
  // two must be present. Both absent is a call with nothing to encode.
  if (inputs.chainMaxCost === undefined && inputs.chainMinProceeds === undefined) {
    return {
      ok: false,
      refusal: refuse('FE-HANDOFF-011', 'neither a cost ceiling nor a proceeds floor was recomputed'),
    };
  }

  // A deadline narrows only: the earlier of the tool's and the client's own.
  const askedDeadline = limits.deadlineBlock;
  const encodedDeadline =
    askedDeadline !== undefined
      ? Math.min(askedDeadline, inputs.chainDeadlineBlock)
      : inputs.chainDeadlineBlock;

  const result: {
    maxCost?: Clamped<bigint>;
    minProceeds?: Clamped<bigint>;
    deadlineBlock: Clamped<number>;
    anyNarrowed: boolean;
  } = {
    deadlineBlock: {
      asked: askedDeadline,
      chain: inputs.chainDeadlineBlock,
      encoded: encodedDeadline,
      boundBy: askedDeadline !== undefined && encodedDeadline === askedDeadline ? 'intent' : 'chain',
      narrowed: askedDeadline === undefined || encodedDeadline < askedDeadline,
    },
    anyNarrowed: false,
  };

  if (inputs.chainMaxCost !== undefined) {
    result.maxCost = clampCeiling(limits.maxCost, inputs.chainMaxCost, inputs.policyMaxCost);
  }
  if (inputs.chainMinProceeds !== undefined) {
    result.minProceeds = clampFloor(
      limits.minProceeds,
      inputs.chainMinProceeds,
      inputs.policyMinProceeds,
    );
  }

  result.anyNarrowed =
    (result.maxCost?.narrowed ?? false) ||
    (result.minProceeds?.narrowed ?? false) ||
    result.deadlineBlock.narrowed;
  return { ok: true, limits: result };
}

/**
 * A stated maximum context age, honoured only in the narrowing direction.
 *
 * A tool may make its own advice expire sooner; it cannot make it expire later. Returning
 * the minimum rather than the stated value is the whole rule — and the capsule's own age
 * is displayed and diffed, never trusted, because a document that says it is fresh is
 * making an assertion about itself.
 *
 * Only `undefined` — the tool stated nothing — falls back to the client's own maximum.
 * Every other unusable input narrows instead of widening, which is the direction an
 * earlier draft had backwards: a negative request took the `undefined` branch and returned
 * the client's maximum, so a nonsensical value silently produced the *most generous*
 * answer from a function whose only job is to never widen. A negative floors at zero (the
 * narrowing reading of "expire before now"), `NaN` is not a request and yields zero, and
 * an infinite one is simply the widest request there is, so the client's own maximum binds
 * it in the ordinary way.
 */
export function narrowMaxAge(askedBlocks: number | undefined, clientMaxBlocks: number): number {
  if (askedBlocks === undefined) return clientMaxBlocks;
  if (Number.isNaN(askedBlocks)) return 0;
  return Math.min(Math.max(Math.trunc(askedBlocks), 0), clientMaxBlocks);
}
