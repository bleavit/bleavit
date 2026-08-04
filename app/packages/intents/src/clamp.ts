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
 * not a tool asking for something absurd — that is caught by the parser — but a tool
 * asking for something *plausible and slightly too generous*, which a client that treated
 * the stated ceiling as authoritative would encode. Taking the minimum means a tool can
 * only ever make the user's exposure **smaller** than the client would have allowed, so
 * the worst a hostile document achieves is a transaction the user would have been
 * permitted to make anyway, on worse terms for the attacker.
 *
 * ## The difference is shown, not silently applied
 *
 * 11 §11.14.3 requires it, and the reason is INV-FE-9's: the asked value and the encoded
 * value are two different facts with two different provenances — one `external-proposal`,
 * one chain-derived — and collapsing them into one displayed number destroys exactly the
 * distinction that lets a user notice the tool asked for something the client refused.
 * `Clamped` therefore carries all three values and which one bound.
 *
 * ## Deadlines and staleness narrow too
 *
 * A stated deadline is compared against `B′`, the chain clock, never the device clock. A
 * stated maximum context age is honoured **only in the narrowing direction**: a tool may
 * make its own advice expire sooner and cannot make it expire later — staleness needs no
 * timer because `refreshAndGate` bounds it structurally.
 */

import type { IntentLimits } from './parse.js';

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
  /** The client's own recomputed cost ceiling at `B′`. */
  readonly chainMaxCost?: bigint;
  /** The client's own recomputed proceeds floor at `B′`. */
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

export class ExpiredIntentError extends Error {}

/**
 * Apply the narrow-only rule to a parsed intent's limits.
 *
 * Throws `ExpiredIntentError` when the stated deadline is already past at `B′`. That is a
 * refusal (`FE-HANDOFF-008`) rather than a clamp: a deadline in the past is not a tighter
 * bound to honour, it is a statement that the request should no longer be acted on.
 */
export function clampLimits(limits: IntentLimits, inputs: ClampInputs): ClampedLimits {
  if (limits.deadlineBlock !== undefined && limits.deadlineBlock <= inputs.currentBlock) {
    throw new ExpiredIntentError(
      `the request states a deadline of block ${limits.deadlineBlock} and the chain is at ` +
        `${inputs.currentBlock}`,
    );
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
    result.minProceeds = clampFloor(limits.minProceeds, inputs.chainMinProceeds, inputs.policyMinProceeds);
  }

  result.anyNarrowed =
    (result.maxCost?.narrowed ?? false) ||
    (result.minProceeds?.narrowed ?? false) ||
    result.deadlineBlock.narrowed;
  return result;
}

/**
 * A stated maximum context age, honoured only in the narrowing direction.
 *
 * A tool may make its own advice expire sooner; it cannot make it expire later. Returning
 * the minimum rather than the stated value is the whole rule — and the capsule's own age
 * is displayed and diffed, never trusted, because a document that says it is fresh is
 * making an assertion about itself.
 */
export function narrowMaxAge(askedBlocks: number | undefined, clientMaxBlocks: number): number {
  if (askedBlocks === undefined || askedBlocks < 0) return clientMaxBlocks;
  return Math.min(askedBlocks, clientMaxBlocks);
}
