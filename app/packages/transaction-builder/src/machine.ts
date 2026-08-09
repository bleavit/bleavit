/**
 * The transaction lifecycle machine — 11 §11.3, §11.4; INV-FE-2.
 *
 * 11 §11.4 rule 1: *"Every submit path passes through `refreshAndGate` — **structurally**
 * (the tx machine has no bypass edge), not by convention."* That word is the whole design
 * of this module. A machine that merely *tended* to call the gate would be one hurried
 * edge away from signing against stale state, and the review that produced it would have
 * to be repeated every time anyone added a transition.
 *
 * So the structure carries it, in three ways that are each testable without a chain:
 *
 *  1. `AwaitingSignature` is reachable **only** from `Refreshing`, and only by an event
 *     that carries a `GatePassed` — a value this module alone can construct, and only
 *     from a gate evaluation in which every precondition passed at one finalized block.
 *  2. The reducer's edge set is enumerable, so `tests/transaction-builder` asserts against
 *     the lifecycle 11 §11.3 writes out, in both directions. A new edge that skipped the
 *     gate would show up as an edge the specification does not draw.
 *  3. A precondition failure returns to **Draft with form state preserved** (rule 5),
 *     not to a terminal error — a blocked transaction is a normal outcome of a moving
 *     chain, and losing the user's work over one is how people learn to click through
 *     warnings.
 */

import type { FinalizedBlockRef } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';
import type { ClauseId, PreconditionResult } from './preconditions.js';
import { clauseCoverageIds, type RowId } from './rows.js';
import { governanceCoverageIds, isGovernanceRowId, type GovernanceRowId } from './governance-rows.js';
import type { FeeAsset } from './fee-asset.js';

/**
 * Any row a preparation may declare — §11.5's, §11.7.3's and §11.8's.
 *
 * `requires` was `PreconditionRowId[]`, which is §11.5's fifteen rows and nothing else. A
 * call whose row lives in another table therefore had **no id it could declare**, so
 * `gate()` had nothing to demand of it and every §11.8 console gated its own button on a
 * module-local check. §11.4 rule 1 asks for the gate structurally, and a union that cannot
 * name two thirds of the client's calls makes "structurally" unreachable for them.
 */
export type DeclarableRowId = RowId | GovernanceRowId;

/**
 * Every obligation a declared row imposes, whichever table it comes from.
 *
 * The two tables are separate and stay separate — §11.5/§11.8 clauses carry a fee-asset
 * selector and `anyOf` groups, §11.7.3's do not — so the expansion is dispatched rather than
 * merged. What matters to the gate is that a row expands to **its clauses** and not to
 * itself: see `ClauseId`.
 */
export function declaredCoverageIds(
  row: DeclarableRowId,
  feeAsset: FeeAsset,
): readonly ClauseId[] {
  return isGovernanceRowId(row) ? governanceCoverageIds(row) : clauseCoverageIds(row, feeAsset);
}

/** 11 §11.3's lifecycle. `Finalized` is the only success state. */
export type TxState =
  | 'Draft'
  | 'Prepared'
  | 'Refreshing'
  | 'Blocked'
  | 'AwaitingSignature'
  | 'Broadcast'
  | 'InBestBlock'
  | 'Finalized'
  | 'Dropped'
  | 'Retracted';

/** The failure codes 11 §11.3–§11.4 name. */
export type TxErrorCode = 'FE-TX-004' | 'FE-TX-007';

/** What a preparation was built against — re-checked at B′ before signing. */
export interface BuiltFor {
  readonly specVersion: number;
  readonly metadataHash: HexString;
}

export interface TxPreparation {
  /** The exact bytes to be signed. The confirm summary is decoded from THIS. */
  readonly scaleHex: HexString;
  readonly builtFor: BuiltFor;
  /** The block the preparation was assembled at (B). B′ is taken by the refresh. */
  readonly preparedAt: FinalizedBlockRef;
  /**
   * The `P-n` rows this call declares — 11 §11.5–§11.9.
   *
   * Required, and required to be **non-empty**. Without it the gate has no way to tell
   * "every precondition holds" from "nobody read one", and those are the same value:
   * `results.filter(r => !r.ok)` over an empty array is empty. See `gate`.
   */
  readonly requires: readonly DeclarableRowId[];
  /**
   * The fee currency this transaction was prepared for — 11 §11.3's selector.
   *
   * Required, and carried on the preparation rather than passed to the gate, because it
   * decides **which clauses a declared row has**: VIT headroom is a `System.Account` read and
   * USDC headroom a `ForeignAssets` one, so a row's obligation set is not answerable without
   * it. `rowsFor` has always refused a default for that reason; the gate now needs the same
   * answer, and taking it from the preparation makes the two the same answer by construction.
   */
  readonly feeAsset: FeeAsset;
}

declare const GATE_PASSED: unique symbol;

/**
 * Proof that a gate ran and every obligation of **one named preparation** passed, at one
 * finalized block.
 *
 * Branded for the same reason `Finalized<T>` is: without the phantom field, any object
 * literal of the right shape would open `AwaitingSignature`, and "the machine has no
 * bypass edge" would be a claim about the code rather than a property of the types. The
 * symbol is not exported, so only `gate()` below can produce one.
 *
 * ## The proof names what it proves
 *
 * `prep` is not a convenience. Without it this value said only *"some call to `gate()`
 * succeeded"* — it carried no preparation, no call and no `scaleHex` — so an authentic window
 * could be paired with **different bytes** and still typecheck, and every consumer that takes
 * a `GatePassed` as authorisation was authorising an unnamed transaction. A submitter must
 * encode `window.prep.scaleHex`; taking bytes from anywhere else is then a visible mismatch
 * rather than an invisible one, and `reduce` refuses a proof minted for a preparation other
 * than the session's own.
 *
 * ## The proof cannot be **re-pinned** either (2026-08-09)
 *
 * A `unique symbol` stops a literal and it does not stop a spread: object spread copies own
 * enumerable properties including symbol-keyed ones, so `{ ...passed, at: anotherBlock }`
 * compiles with no cast and is still a `GatePassed`. The paragraph above is about `prep`, and
 * `reduce`/`operatorGate` both compare `prep` by **identity**, so that field defends itself —
 * a substituted `prep` is a different object and the comparison fires. `at` has no such
 * comparison anywhere and three consumers read it in a permitting position:
 *
 * - `mortalityFor` anchors the era at `passed.at.blockNumber`, which **is** the staleness
 *   bound — an era anchored to the wrong block is the bound not being applied;
 * - the raw external signer is told `atBlock: request.window.at.blockNumber`, so the number a
 *   hardware device shows its holder comes from here;
 * - `estimateFee` and `signedNonce` refuse a fee or a nonce read at a different block by
 *   comparing `read.status.blockHash !== passed.at.blockHash` — and a re-pinned `at` makes
 *   both comparisons agree with whatever block the read really came from.
 *
 * So `GatePassed` intersects a phantom marker whose `#private` member a spread type drops.
 * See `ProducedByEpochClosure` in `src/features/tx/src/registry-filing.ts` for the mechanism
 * and for why the `unique symbol` stays beside it
 * (`tests/firewall/fixtures/gate-proof-repinned-by-spread.ts`).
 */
declare class ProducedByGate {
  readonly #producedByGate: true;
}

export interface GatePassed extends ProducedByGate {
  readonly at: FinalizedBlockRef;
  /** The exact preparation these results were evaluated for — bytes, rows and fee asset. */
  readonly prep: TxPreparation;
  readonly results: readonly PreconditionResult[];
  readonly [GATE_PASSED]: true;
}

export type GateOutcome =
  | { readonly kind: 'proceed'; readonly passed: GatePassed }
  | {
      readonly kind: 'blocked';
      readonly code: TxErrorCode;
      readonly at: FinalizedBlockRef;
      /** Only the rows that failed — rule 5's diff view. */
      readonly failed: readonly PreconditionResult[];
      readonly detail: string;
    };

export type TxEvent =
  | { readonly type: 'prepared'; readonly prep: TxPreparation }
  | { readonly type: 'submit-requested' }
  | { readonly type: 'gate-result'; readonly outcome: GateOutcome }
  | { readonly type: 'edit' }
  | { readonly type: 'signed' }
  | { readonly type: 'signature-declined' }
  | { readonly type: 'in-best-block' }
  | { readonly type: 'finalized' }
  | { readonly type: 'dropped' }
  | { readonly type: 'retracted' };

export interface TxSession {
  readonly state: TxState;
  readonly prep: TxPreparation | undefined;
  /** Non-empty only in `Blocked`. Cleared on the way back to Draft. */
  readonly failed: readonly PreconditionResult[];
  readonly lastError: TxErrorCode | undefined;
  /** Present only in `AwaitingSignature`: what the signer is allowed to sign, and when. */
  readonly signingWindow: GatePassed | undefined;
}

export const INITIAL_TX_SESSION: TxSession = Object.freeze({
  state: 'Draft',
  prep: undefined,
  failed: [],
  lastError: undefined,
  signingWindow: undefined,
});

export const TX_TERMINAL_STATES: ReadonlySet<TxState> = new Set<TxState>([
  'Finalized',
  'Dropped',
  'Retracted',
]);

/**
 * Run the gate — 11 §11.4's `refreshAndGate`, with the reads injected.
 *
 * `FE-TX-007` is checked **first and separately**. A runtime that changed under the
 * preparation invalidates the *encoding*, so evaluating preconditions against it would be
 * decoding new metadata with old assumptions — every row could pass and the bytes still be
 * wrong. Order matters here in a way it does not between the rows themselves.
 */
export function gate(
  prep: TxPreparation,
  at: FinalizedBlockRef,
  live: BuiltFor,
  results: readonly PreconditionResult[],
): GateOutcome {
  if (live.specVersion !== prep.builtFor.specVersion || live.metadataHash !== prep.builtFor.metadataHash) {
    return {
      kind: 'blocked',
      code: 'FE-TX-007',
      at,
      failed: [],
      detail:
        `the runtime changed under this transaction (built for spec_version ${prep.builtFor.specVersion}, ` +
        `now ${live.specVersion}). The prepared bytes were encoded against metadata that is no longer ` +
        'current, so they must be rebuilt rather than re-checked.',
    };
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      kind: 'blocked',
      code: 'FE-TX-004',
      at,
      failed,
      detail: `${failed.length} precondition(s) no longer hold at the finalized block just read.`,
    };
  }
  // **A gate over zero reads certifies nothing, and certified `proceed` anyway.**
  // Every check below is a filter over `results`, and every filter over an empty array is
  // empty — so `gate(prep, at, live, [])` reached `AwaitingSignature` having read nothing.
  // That is the same "passes by shrinking" defect the descriptor classifier refuses
  // (`ProbeCoverageError`) and the one INV-FE-2 exists to prevent, in the one place it
  // matters most: the only edge to a signer. The gate therefore compares what was read
  // against what the preparation **declares** it must read, and a declared obligation with no
  // result blocks — it is not evidence of anything, least of all of its own absence.
  //
  // **Coverage is per clause, not per row, and that was the second half of the same hole.**
  // A row is a set of clauses; while both sides of this comparison were row ids, one result
  // naming `O-1` covered all five of `O-1`'s obligations, so a single passing read — the
  // registry check, say — minted the window while the stake amount, the stake balance and
  // the fee headroom were never evaluated. Expanding the declaration through
  // `declaredCoverageIds` makes the demand what the specification's row actually says.
  if (prep.requires.length === 0) {
    return {
      kind: 'blocked',
      code: 'FE-TX-004',
      at,
      failed: [],
      detail:
        'this preparation declares no precondition rows, so the gate has nothing to verify ' +
        'and cannot authorise a signature (11 §11.5 gives every call at least one row).',
    };
  }
  let required: readonly ClauseId[];
  try {
    required = prep.requires.flatMap((row) => declaredCoverageIds(row, prep.feeAsset));
  } catch (error) {
    // A malformed declaration — an unknown row, an unselectable fee asset, a table whose
    // clauses collide on one id. Blocked rather than thrown: this runs from a click handler
    // on the only edge to a signer, and a thrown error there is an unhandled rejection that
    // leaves the control in whatever state it was in. Fail closed, and say what happened.
    return {
      kind: 'blocked',
      code: 'FE-TX-004',
      at,
      failed: [],
      detail:
        'this preparation\'s declared rows could not be expanded into the reads they require, ' +
        `so there is nothing to check them against: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const covered = new Set<string>(results.map((r) => r.id));
  const uncovered = required.filter((id) => !covered.has(id));
  if (uncovered.length > 0) {
    return {
      kind: 'blocked',
      code: 'FE-TX-004',
      at,
      failed: [],
      detail:
        `${uncovered.length} declared precondition(s) were never read at this block ` +
        `(${uncovered.join(', ')}). An unread precondition is not a passing one.`,
    };
  }

  const mixed = results.filter((r) => r.at.blockHash !== at.blockHash);
  if (mixed.length > 0) {
    // Not a precondition failure — a defect in how the batch was read. Passing it would
    // certify a conjunction that was never simultaneously true (INV-FE-2).
    return {
      kind: 'blocked',
      code: 'FE-TX-004',
      at,
      failed: mixed,
      detail:
        `${mixed.length} precondition(s) were evaluated at a different block than the gate's pin; ` +
        'the set does not describe one state and cannot authorise a signature.',
    };
  }
  return { kind: 'proceed', passed: { at, prep, results } as GatePassed };
}

/**
 * The transition function.
 *
 * Unknown (state, event) pairs return the session unchanged — never throw, never a
 * catch-all default. A machine that threw would turn a double-click into a crash mid-flow;
 * one with a default edge would silently acquire transitions §11.3 does not describe,
 * which for this machine means a path to a signer.
 */
export function reduce(session: TxSession, event: TxEvent): TxSession {
  if (TX_TERMINAL_STATES.has(session.state)) return session;
  const at = (state: TxState, patch: Partial<TxSession> = {}): TxSession =>
    Object.freeze({ ...session, state, ...patch });

  switch (session.state) {
    case 'Draft':
      return event.type === 'prepared' ? at('Prepared', { prep: event.prep }) : session;

    case 'Prepared':
      if (event.type === 'submit-requested') return at('Refreshing');
      if (event.type === 'edit') return at('Draft', { prep: undefined });
      return session;

    case 'Refreshing':
      // The ONLY edge into AwaitingSignature, and it requires a `GatePassed` this module
      // alone can mint. Everything else about "no bypass" follows from that.
      if (event.type === 'gate-result') {
        if (event.outcome.kind !== 'proceed') {
          return at('Blocked', { failed: event.outcome.failed, lastError: event.outcome.code });
        }
        // **The proof must be this session's.** A `GatePassed` is authentic evidence about
        // the preparation it names, and nothing more: gating preparation A and dispatching
        // its outcome into a session holding preparation B would open the signer against
        // bytes no precondition was evaluated for. Identity rather than structural equality —
        // the transaction path never rehydrates a session (INV-FE-7), so the object that was
        // gated is the object that is held, and anything else is a defect rather than a
        // lifecycle.
        if (session.prep === undefined || event.outcome.passed.prep !== session.prep) {
          return at('Blocked', { failed: [], lastError: 'FE-TX-004' });
        }
        return at('AwaitingSignature', {
          signingWindow: event.outcome.passed,
          failed: [],
          lastError: undefined,
        });
      }
      return session;

    case 'Blocked':
      // Back to Draft with the preparation preserved (rule 5): a blocked transaction is a
      // normal outcome of a moving chain, and discarding the user's work over one is how
      // people learn to click through warnings.
      return event.type === 'edit'
        ? at('Draft', { failed: [], lastError: undefined, signingWindow: undefined })
        : session;

    case 'AwaitingSignature':
      if (event.type === 'signed') return at('Broadcast');
      // A declined signature returns to Draft and **drops the signing window**: the gate
      // pin is now old, so re-submitting must re-run the gate rather than reuse it.
      if (event.type === 'signature-declined') return at('Draft', { signingWindow: undefined });
      return session;

    case 'Broadcast':
      if (event.type === 'in-best-block') return at('InBestBlock');
      if (event.type === 'dropped') return at('Dropped');
      return session;

    case 'InBestBlock':
      if (event.type === 'finalized') return at('Finalized');
      // 11 §11.3: inclusion in a best block is not success. A retracted transaction went
      // backwards, and only `Finalized` is a success state.
      if (event.type === 'retracted') return at('Retracted');
      if (event.type === 'dropped') return at('Dropped');
      return session;

    default:
      return session;
  }
}

/** Every (from, to) edge this reducer can take, for comparison against 11 §11.3. */
export function txTransitionEdges(): readonly (readonly [TxState, TxState])[] {
  const prep: TxPreparation = {
    scaleHex: '0x00',
    builtFor: { specVersion: 1, metadataHash: '0x00' },
    // Same chain as `pin` below: this enumerator walks the real machine, and a preparation
    // built against one chain gated by a pin from another is a transition the machine must
    // refuse, not one an edge enumerator should be exercising.
    preparedAt: {
      chain: `0x${'ce'.repeat(32)}` as HexString,
      blockHash: `0x${'00'.repeat(32)}` as HexString,
      blockNumber: 0,
    },
    requires: ['P-1'],
    feeAsset: 'USDC',
  };
  const pin: FinalizedBlockRef = {
    chain: `0x${'ce'.repeat(32)}` as HexString,
    blockHash: `0x${'11'.repeat(32)}` as HexString,
    blockNumber: 1,
  };
  // The passing gate has to be built from a **covered** row now, and that is the point of
  // the change rather than a cost of it: this enumerator previously minted its `proceed`
  // from `gate(prep, pin, prep.builtFor, [])` — an empty read set — which is exactly the
  // bypass it exists to prove does not exist. An edge enumerator that reaches
  // `AwaitingSignature` through a gate that read nothing enumerates a machine nobody ships.
  //
  // The results are derived from the row's **own obligations**, one per clause group, for the
  // same reason: a single stand-in result naming `P-1` used to satisfy the whole row, so the
  // enumerator was walking a machine whose gate demanded less than the shipped one's.
  const passing: readonly PreconditionResult[] = declaredCoverageIds('P-1', prep.feeAsset).map(
    (id) => ({
      id,
      ok: true,
      requirement: 'the enumerator\'s stand-in obligation',
      expected: 'ok',
      actual: 'ok',
      at: pin,
    }),
  );
  const proceed = gate(prep, pin, prep.builtFor, passing);
  const blocked = gate(prep, pin, { specVersion: 2, metadataHash: '0x00' }, passing);

  const states: TxState[] = [
    'Draft', 'Prepared', 'Refreshing', 'Blocked', 'AwaitingSignature',
    'Broadcast', 'InBestBlock', 'Finalized', 'Dropped', 'Retracted',
  ];
  const events: TxEvent[] = [
    { type: 'prepared', prep }, { type: 'submit-requested' },
    { type: 'gate-result', outcome: proceed }, { type: 'gate-result', outcome: blocked },
    { type: 'edit' }, { type: 'signed' }, { type: 'signature-declined' },
    { type: 'in-best-block' }, { type: 'finalized' }, { type: 'dropped' }, { type: 'retracted' },
  ];
  const edges = new Set<string>();
  for (const state of states) {
    for (const event of events) {
      // The synthetic session holds **this** preparation, because `Refreshing` now admits a
      // proof only for the preparation it is refreshing. An enumerator walking sessions with
      // no preparation would report `Refreshing → AwaitingSignature` as absent and the
      // lifecycle comparison would fail against 11 §11.3 for the wrong reason.
      const next = reduce({ ...INITIAL_TX_SESSION, state, prep }, event);
      if (next.state !== state) edges.add(`${state}>${next.state}`);
    }
  }
  return [...edges].sort().map((e) => e.split('>') as [TxState, TxState]);
}
