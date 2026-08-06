/**
 * S6's model — 11 §11.5 row P-12, the complete `execution_guard.execute` precondition set.
 *
 * > The FE renders each of the 14 checks as a named row with expected/actual; any failure
 * > blocks with the same reason code the runtime would return.
 *
 * Fourteen rows is the whole design. Everything interesting here is about the three places
 * a shorter implementation gets it wrong, and each of them is a *silent* wrong.
 *
 * ## 1. The dead-man latch and the triggering freeze are two rows, not one
 *
 * They were one row until 2026-08-05, and 11 §11.5 says why they cannot be:
 *
 * > A single row cannot carry both — grouped as mandatory it refuses the emergency upgrade
 * > the lane exists to admit, and grouped under the exemption it waives the dead-man switch.
 *
 * A comment saying so protects nothing. So {@link DeadManInputs} **has no `expedited`
 * field**: the D-9 exemption is not merely ignored by row 12, it is not in scope for it,
 * and a future edit that wanted to consult it would have to change a type and meet this
 * paragraph on the way past. Row 13 takes the exemption and applies it over the
 * **conjunction** — expedited clears both the ledger freeze and the migration halt, and
 * neither of those clears the other.
 *
 * ## 2. A failing ratification before the deadline is not terminal
 *
 * > `execute` **errors `NotRatified` without changing proposal state** (it stays `Queued`
 * > and stays retryable until `grace_end`) … The FE blocks pre-sign either way, but MUST
 * > NOT present a pre-grace failure as terminal.
 *
 * The client blocks and the copy stays hopeful, which is an unusual combination and the
 * reason terminality is a computed property of the *window* rather than of the row. Past
 * the deadline every row is terminal, because `execute` is unreachable at all; inside the
 * window only a malformed payload is (09 §1.2 item 11 — *"the mandate is doomed while its
 * on-chain state still reads `Queued`"*).
 *
 * ## 2a. The deadline is not always `grace_end`
 *
 * A mandate that has already failed once runs on a **different clock**. 09 §1.2 item 1 and
 * 05 §2.1's T18/T23 both say so: a T18 dispatch failure stamps `failed_at` and opens the
 * bounded `[failed_at, failed_at + RETRY_WINDOW]` retry window, which is the deadline the
 * runtime then enforces *instead of* `grace_end`. It is wrong in both directions to ignore
 * it. A retry still lawful after `grace_end` would be classified terminal, locking the user
 * out of a recovery window the chain is still offering; and a retry whose window closed
 * *before* `grace_end` would read as live, which walks the user to a signature the runtime
 * refuses with `GraceExpired` — the unsafe direction, and the one nobody reports.
 *
 * `RETRY_WINDOW` itself is **not published by any frozen surface** (SQ-790), so the
 * deadline is frequently uncomputable rather than merely unread. That is a third state and
 * it fails closed: the window row is `unread`, `mayExecute` is false, and the mandate is
 * **not** declared over — refusing a lawful retry is bad, and declaring the mandate dead on
 * the client's own authority is worse.
 *
 * ## 3. An unread row is not a passed row
 *
 * Every input is **required and nullable** rather than optional, so a caller that has not
 * performed a read must say so and gets an `unread` verdict that blocks. INV-FE-12's rule
 * for exactly this: an unproven capability is absent, and absence disables the dependent
 * surface with a named reason.
 *
 * ## 4. Every leaf is `Finalized<T>`, read at one B′
 *
 * 11 §11.4 rule 4 — *"provider/local-index data never satisfies any precondition"* — is a
 * type here rather than a review obligation, because a `provider` read is a perfectly
 * well-formed `Verified<T>` and a queued mandate assembled from an operator snapshot would
 * satisfy all fourteen rows and enable signing. `Finalized<T>` is constructible only inside
 * `@bleavit/chain-client` (10 §2.1), and it reaches the **nested** capability, suspension,
 * lock, retry and bounds structures too: a gate is only as strong as its weakest leaf.
 *
 * The brand carries a block and cannot compare two, so the single-B′ rule of §11.4 is row
 * **0** — outside the numbered fourteen, because it is a statement about this client's own
 * reads rather than a dispatch check, and it carries no dispatch code for the same reason.
 *
 * What this module deliberately does **not** do is decide the meters itself. §11.5 row 8
 * binds the client to `QueuedExecutionView.meters_clear` — the chain's own answer over the
 * exact committed preimage — and notes that it answers 09 §1.2 item 7 *only*: a `true`
 * does not predict that dispatch succeeds, so nothing here says it does.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.5 row P-12 and its 14-check table
 * @see docs/architecture/09-execution-upgrades-and-rollout.md §1.2
 * @see docs/architecture/02-integration-contract.md §7.8
 */

import type { Finalized } from '@bleavit/chain-client';

/**
 * A dispatch error the runtime returns for a failed check.
 *
 * **Every member is a variant of `pallet_execution_guard::Error<T>`, spelled as the pallet
 * spells it**, and `tools/ci/check-execute-error-codes.py` holds that binding: it parses
 * the pallet's `#[pallet::error]` enum and fails on any code here that is not in it. §11.5
 * requires each failure to block *"with the same reason code the runtime would return"*,
 * and before that gate existed four of these were names the runtime has never returned —
 * `NotQueued`, `VersionMismatch`, `MeterExceeded` and a `GateSuspended` standing in for
 * `GuardianHold`. A user shown `MeterExceeded` for a `MetersBlocked` refusal is being told
 * something the chain did not say, and a code table with no mechanical binding to its
 * source is the same unfalsifiable claim one layer down from the row it describes.
 *
 * The binding is deliberately **one-directional**: the pallet declares many variants
 * `execute` cannot reach (the upgrade path, queue admission), so requiring every variant to
 * appear here would be requiring the client to model checks it never makes.
 */
export type ExecuteErrorCode =
  | 'NotFound'
  | 'Cancelled'
  | 'NotMature'
  | 'GraceExpired'
  | 'BadPreimage'
  | 'PayloadTooLarge'
  | 'StaleQueue'
  | 'NotRatified'
  | 'AttestationMissing'
  | 'CapabilityDenied'
  | 'BadDomainDeclaration'
  | 'MetersBlocked'
  | 'ResourceLockMissing'
  | 'GuardianHold'
  | 'GateSuspended'
  | 'FreezeActive'
  | 'TooManyCalls'
  | 'SafetyFilter';

/** How a row came out. `unread` is a third state and never folds into either other one. */
export type ExecuteVerdict = 'pass' | 'fail' | 'unread';

/**
 * One of the 14 checks, as the screen renders it (INV-FE-14: expected and actual).
 *
 * `expected` and `actual` are the client's own words about what it read, so they are plain
 * strings rather than `Verified<T>`: the values they describe are rendered as badged data
 * beside the row, and a sentence is chrome. A row that put a chain value *only* in this
 * string would be putting an unbadged reading on screen, which is why the screen renders
 * the datum too.
 */
export interface ExecuteRow {
  /**
   * 1–14, matching 11 §11.5's own numbering so a user can cite a row.
   *
   * **0 is the read pin** and is emitted only when this client mixed blocks — it is not a
   * dispatch check, has no counterpart in 09 §1.2, and carries no `code`. Numbering it
   * outside the fourteen keeps the normative mirror a mirror.
   */
  readonly id: number;
  readonly check: string;
  readonly verdict: ExecuteVerdict;
  readonly expected: string;
  readonly actual: string;
  /** The error the runtime would return. Absent where the row is not a dispatch error. */
  readonly code?: ExecuteErrorCode;
  /** Whether this failure ends the mandate rather than deferring it. */
  readonly terminal: boolean;
}

/**
 * Where `now` sits relative to the queued window — row 2, and every row's terminality.
 *
 * `deadline-unreadable` is the SQ-790 state: the mandate has already failed once, so the
 * runtime's deadline is `failed_at + RETRY_WINDOW`, and no frozen surface publishes
 * `RETRY_WINDOW`. It is neither open nor past — it is *not established*, which blocks
 * without declaring the mandate over.
 */
export type WindowState = 'before-maturity' | 'open' | 'past-grace' | 'deadline-unreadable';

/**
 * The deadline the runtime enforces, which is `grace_end` only for a mandate that has
 * never failed.
 *
 * 09 §1.2 item 1 (and 05 §2.1's T18/T23 before it) puts a `FailedExecuted` mandate on
 * `failed_at + RETRY_WINDOW` **instead of** `grace_end`, and the substitution is not
 * monotone: a failure early in the grace window closes the door *sooner*, a failure near
 * the end holds it open *later*. `undefined` means the deadline could not be established.
 */
export function executionDeadline(
  graceEnd: number,
  failedAt: number | undefined,
  retryWindow: number | undefined,
): number | undefined {
  if (failedAt === undefined) return graceEnd;
  if (retryWindow === undefined) return undefined;
  return failedAt + retryWindow;
}

export function windowStateFor(
  now: number,
  maturity: number,
  graceEnd: number,
  failedAt: number | undefined = undefined,
  retryWindow: number | undefined = undefined,
): WindowState {
  if (now < maturity) return 'before-maturity';
  const deadline = executionDeadline(graceEnd, failedAt, retryWindow);
  if (deadline === undefined) return 'deadline-unreadable';
  if (now > deadline) return 'past-grace';
  return 'open';
}

/**
 * Row 12's inputs. **There is no `expedited` field, and that is the control.**
 *
 * 09 §3.1 waives only the *triggering* freeze of row 13; the dead-man latch is the one
 * latch D-9 makes unconditional. A client that let the exemption satisfy it would offer a
 * signature the runtime refuses, on exactly the check that exists to be unwaivable.
 */
export interface DeadManInputs {
  /** `ExecutionGuard.DeadManFreeze` (02 §7.8). */
  readonly guardLatch: Finalized<boolean>;
  /** The `DEAD_MAN_ENGAGED` bit of `Constitution.PhaseFlags` (02 §7.3 bit 6). */
  readonly phaseFlagBit: Finalized<boolean>;
}

/**
 * Row 13's inputs — the pair the expedited lane waives **together**.
 *
 * The waiver is over the conjunction: neither the ledger freeze nor the migration halt
 * clears the other, and the marker clears both.
 */
export interface TriggeringFreezeInputs {
  /** The `LEDGER_FROZEN` bit of `Constitution.PhaseFlags` (02 §7.3 bit 5) — PB-LEDGER-FREEZE. */
  readonly ledgerFrozen: Finalized<boolean>;
  /** `ExecutionGuard.MigrationHalt` (02 §7.8). */
  readonly migrationHalt: Finalized<boolean>;
  /** `ExecutionGuard.Expedited(pid)` (02 §7.8) — the queue-time marker of 09 §3.1. */
  readonly expedited: Finalized<boolean>;
}

/** Row 10 — a suspension keyed to an epoch means nothing without the current one. */
export interface SuspensionInputs {
  /** `ExecutionGuard.GateSuspension`'s `Option<EpochId>` (02 §7.8). */
  readonly suspendedForEpoch: Finalized<number> | undefined;
  /** `Epoch.EpochOf.index` (02 §7.1) — the companion read §7.8 names. */
  readonly currentEpoch: Finalized<number>;
  /** A guardian `delay_once` hold on this proposal (06). */
  readonly delayedOnce: Finalized<boolean>;
}

/**
 * Row 2's post-failure clock — the half of the window `grace_end` does not describe.
 *
 * Both fields are `undefined`-bearing and the two `undefined`s mean different things, which
 * is why they are one structure with prose rather than two loose nullable fields:
 *
 * - `failedAt`'s payload is `Option<BlockNumber>`, so an **inner** `undefined` is the
 *   chain's own `None` — this mandate has never failed — and is a positive reading rather
 *   than a gap. The read itself is required: `ExecutionGuard.Queue(pid)` is frozen (02 §7.4)
 *   and its stored entry carries `failed_at`, so a client that has the queue row has this.
 * - `retryWindow` is the SQ-790 gap. `EXECUTION_RETRY_WINDOW_BLOCKS` is a kernel constant
 *   with no metadata-constant or runtime-API home, so `undefined` here is the ordinary case
 *   today and not a caller's oversight — the consumer fails closed rather than guessing a
 *   value, which R-2 forbids outright.
 */
export interface RetryInputs {
  /** `ExecutionGuard.Queue(pid).failed_at` — inner `undefined` **is** the chain's `None`. */
  readonly failedAt: Finalized<number | undefined>;
  /** `RETRY_WINDOW` in blocks. No frozen surface publishes it (SQ-790). */
  readonly retryWindow: Finalized<number> | undefined;
}

/** Row 7 — the two independent claims §11.5's capability row makes. */
export interface CapabilityInputs {
  /** Every call domain the decoded batch reaches is in the proposal's declared set (I-11). */
  readonly domainsWithinDeclared: Finalized<boolean>;
  /** Each domain's `Constitution.Capabilities` rule admits this class origin (02 §7.3). */
  readonly rulesAdmitClass: Finalized<boolean>;
}

/** Row 9 — every declared resource domain still held by this proposal. */
export interface ResourceLockInputs {
  /** The proposal's declared resource keys (05 §1.4). */
  readonly declared: Finalized<readonly string[]>;
  /** The keys `ExecutionGuard.HeldResources` still holds for this pid (02 §7.8). */
  readonly held: Finalized<readonly string[]>;
}

/** Row 14 — the payload bounds, each against a chain-read limit. */
export interface BatchBoundsInputs {
  /**
   * Whether the committed preimage decoded at all, under 09 §1.2 item 11's depth bound.
   *
   * `false` is the one in-window terminal state: an over-deep or trailing-byte-bearing
   * preimage is a *permanent* defect while the proposal's on-chain state still reads
   * `Queued`, so the client presents it as unexecutable rather than live.
   */
  readonly decodable: Finalized<boolean>;
  readonly callCount: Finalized<number>;
  /** `ExecutionGuard::MaxCalls`, from the constants API (02 §9). */
  readonly maxCalls: Finalized<number>;
  readonly payloadBytes: Finalized<number>;
  /** `ExecutionGuard::MaxPayloadBytes`, from the constants API (02 §9). */
  readonly maxPayloadBytes: Finalized<number>;
  /**
   * Whether the declared weight is within the block-limit fraction of 13 §2.
   *
   * A verdict rather than a pair of numbers, because the fraction is a chain-read tunable
   * and the comparison needs the block limit — neither of which this package may hold as a
   * literal (app-code rule 7). The caller does the arithmetic where it has the readings.
   */
  readonly declaredWeightWithinLimit: Finalized<boolean>;
  /** The SafetyFilter closure over nested wrappers, applied statically to the preimage. */
  readonly safetyFilterClosed: Finalized<boolean>;
}

/**
 * Everything the 14 rows read at B′.
 *
 * Every field is **required and nullable**: `undefined` means *this client did not perform
 * the read*, which is a distinct state from a read that failed the check and is rendered
 * as such. Making them optional instead would let a caller omit one and get a green row.
 */
export interface ExecuteInputs {
  /** The proposal class — `Code`/`Meta` are the classes row 6 applies to. */
  readonly klass: Finalized<string>;
  /** Row 1: `ExecutionGuard.Queue(pid)` holds this proposal. */
  readonly queued: Finalized<boolean> | undefined;
  /** Row 1: the queue entry's `cancelled` flag (02 §4). */
  readonly cancelled: Finalized<boolean> | undefined;
  /**
   * Row 2: the finalized height, and the entry's own window.
   *
   * `number` rather than `bigint` because 02 §4 types every one of them `BlockNumber`
   * (`u32`), which is exact in a JS number and is what `BlockRef` renders. A `bigint` here
   * would force a conversion at the render edge, and that conversion is a hand-built
   * `Finalized<T>` — the shape rule B of `check-render-provenance` exists to catch.
   */
  readonly now: Finalized<number> | undefined;
  readonly maturity: Finalized<number> | undefined;
  readonly graceEnd: Finalized<number> | undefined;
  /** Row 2's other clock — see {@link RetryInputs}. */
  readonly retry: RetryInputs | undefined;
  /** Row 3: `Preimage.PreimageFor(payload_hash, len)` is present. */
  readonly preimagePresent: Finalized<boolean> | undefined;
  /** Row 3: the client's own re-hash of those bytes equals the committed hash. */
  readonly preimageHashMatches: Finalized<boolean> | undefined;
  /** Row 4: `RuntimeVersionConstraint` equals the live `spec_name`/`spec_version`. */
  readonly runtimeVersionMatches: Finalized<boolean> | undefined;
  /** Row 5: 02 §2's `RatificationStatus` — `NotRequired` / `NoPassedRecord` / `Passed`. */
  readonly ratification: Finalized<string> | undefined;
  /** Row 6: the committed attestation records still exist, unrevoked and unchallenged. */
  readonly attestationRecordsIntact: Finalized<boolean> | undefined;
  /** Row 7. */
  readonly capability: CapabilityInputs | undefined;
  /** Row 8: `QueuedExecutionView.meters_clear` — the chain's own answer (02 §4). */
  readonly metersClear: Finalized<boolean> | undefined;
  /** Row 9. */
  readonly resourceLocks: ResourceLockInputs | undefined;
  /** Row 10. */
  readonly suspension: SuspensionInputs | undefined;
  /** Row 11: `Welfare.GateBreachFlags` / `ExecutionGuard.HardGateBreach` (02 §7.8). */
  readonly hardGateBreach: Finalized<boolean> | undefined;
  /** Row 12. */
  readonly deadMan: DeadManInputs | undefined;
  /** Row 13. */
  readonly triggeringFreeze: TriggeringFreezeInputs | undefined;
  /** Row 14. */
  readonly batchBounds: BatchBoundsInputs | undefined;
}

/** The classes whose mandate carries an attestation commitment (09 §1.2 item 5). */
const ATTESTED_CLASSES: ReadonlySet<string> = new Set(['Code', 'Meta']);

/** The `RatificationStatus` variants that admit execution (02 §2, contract v6). */
const RATIFICATION_ADMITS: ReadonlySet<string> = new Set(['NotRequired', 'Passed']);

const UNREAD = 'this client did not perform the read; an unperformed check is not a passed one';

function unread(id: number, check: string, expected: string): ExecuteRow {
  return { id, check, verdict: 'unread', expected, actual: UNREAD, terminal: false };
}

/** Every finalized leaf these rows were assembled from, labelled for the pin row. */
function pinnedLeaves(
  inputs: ExecuteInputs,
): readonly (readonly [string, Finalized<unknown> | undefined])[] {
  return [
    ['the proposal class', inputs.klass],
    ['ExecutionGuard.Queue.queued', inputs.queued],
    ['ExecutionGuard.Queue.cancelled', inputs.cancelled],
    ['the finalized height', inputs.now],
    ['maturity', inputs.maturity],
    ['grace_end', inputs.graceEnd],
    ['failed_at', inputs.retry?.failedAt],
    ['RETRY_WINDOW', inputs.retry?.retryWindow],
    ['Preimage.PreimageFor', inputs.preimagePresent],
    ['the preimage re-hash', inputs.preimageHashMatches],
    ['RuntimeVersionConstraint', inputs.runtimeVersionMatches],
    ['the ratification status', inputs.ratification],
    ['the attestation records', inputs.attestationRecordsIntact],
    ['the declared call domains', inputs.capability?.domainsWithinDeclared],
    ['Constitution.Capabilities', inputs.capability?.rulesAdmitClass],
    ['meters_clear', inputs.metersClear],
    ['the declared resources', inputs.resourceLocks?.declared],
    ['ExecutionGuard.HeldResources', inputs.resourceLocks?.held],
    ['ExecutionGuard.GateSuspension', inputs.suspension?.suspendedForEpoch],
    ['Epoch.EpochOf.index', inputs.suspension?.currentEpoch],
    ['the delay_once hold', inputs.suspension?.delayedOnce],
    ['ExecutionGuard.HardGateBreach', inputs.hardGateBreach],
    ['ExecutionGuard.DeadManFreeze', inputs.deadMan?.guardLatch],
    ['the dead-man PhaseFlags bit', inputs.deadMan?.phaseFlagBit],
    ['the ledger-freeze PhaseFlags bit', inputs.triggeringFreeze?.ledgerFrozen],
    ['ExecutionGuard.MigrationHalt', inputs.triggeringFreeze?.migrationHalt],
    ['ExecutionGuard.Expedited', inputs.triggeringFreeze?.expedited],
    ['the payload decode', inputs.batchBounds?.decodable],
    ['the call count', inputs.batchBounds?.callCount],
    ['ExecutionGuard::MaxCalls', inputs.batchBounds?.maxCalls],
    ['the payload size', inputs.batchBounds?.payloadBytes],
    ['ExecutionGuard::MaxPayloadBytes', inputs.batchBounds?.maxPayloadBytes],
    ['the declared weight', inputs.batchBounds?.declaredWeightWithinLimit],
    ['the SafetyFilter closure', inputs.batchBounds?.safetyFilterClosed],
  ];
}

/**
 * Row 0, or nothing when every leaf came from one block.
 *
 * The chain is compared as well as the block hash, for `meet`'s reason: after F18 there are
 * two light clients, and *"these two reads are comparable"* is a claim about the chain
 * rather than one that should hold because two hashes did not collide.
 */
function mixedPinRow(inputs: ExecuteInputs): ExecuteRow | undefined {
  const byPin = new Map<string, string[]>();
  for (const [label, read] of pinnedLeaves(inputs)) {
    if (read === undefined) continue;
    const pin = `${read.status.chain} block ${read.status.blockNumber} (${read.status.blockHash})`;
    byPin.set(pin, [...(byPin.get(pin) ?? []), label]);
  }
  if (byPin.size <= 1) return undefined;
  const spread = [...byPin].map(([pin, labels]) => `${labels.join(', ')} at ${pin}`).join('; ');
  return {
    id: 0,
    check: 'Read pin',
    verdict: 'fail',
    expected: 'every row of this gate read at one finalized block B′ (11 §11.4)',
    actual:
      `this gate mixes blocks — ${spread}. Rows from two blocks are each true and their ` +
      'conjunction describes a state that never existed',
    terminal: false,
  };
}

/**
 * The 14 checks, evaluated in 11 §11.5's own order.
 *
 * Every row is returned — passing, failing and unread alike — because the screen is a
 * *table* of expected against actual, not a list of complaints. A caller wanting only the
 * refusals filters; a caller wanting to know whether to offer the signature calls
 * {@link mayExecute}.
 */
export function executeChecks(inputs: ExecuteInputs): readonly ExecuteRow[] {
  const rows: ExecuteRow[] = [];

  // The window decides terminality for every other row, so it is computed first — and it
  // is `unread` rather than assumed when any of its inputs is missing. `retry` is one of
  // them: without it the client does not know which clock this mandate is on, and the
  // `failed_at`-bearing clock can close **before** `grace_end` as well as after it.
  const window: WindowState | undefined =
    inputs.now === undefined ||
    inputs.maturity === undefined ||
    inputs.graceEnd === undefined ||
    inputs.retry === undefined
      ? undefined
      : windowStateFor(
          inputs.now.value,
          inputs.maturity.value,
          inputs.graceEnd.value,
          inputs.retry.failedAt.value,
          inputs.retry.retryWindow?.value,
        );
  // Past the deadline there is no retry, so a failure anywhere is the end of the mandate.
  // Before then a failure defers — including a failed ratification, which §11.5 row 5
  // requires the client not to present as terminal. A deadline this client could not
  // establish is emphatically **not** an ending: it is an unproven fact (SQ-790).
  const ended = window === 'past-grace';

  const fail = (
    id: number,
    check: string,
    expected: string,
    actual: string,
    code: ExecuteErrorCode,
    terminal = ended,
  ): ExecuteRow => ({ id, check, verdict: 'fail', expected, actual, code, terminal });

  const pass = (id: number, check: string, expected: string, actual: string): ExecuteRow => ({
    id,
    check,
    verdict: 'pass',
    expected,
    actual,
    terminal: false,
  });

  // ------------------------------------------------------------- 0. The read pin
  // Not one of the fourteen: §11.4 pins a single B′ per gate, and this asks whether this
  // client honoured that — a statement about the reads, not a dispatch check, so it carries
  // no code and is numbered outside the mirror.
  const mixed = mixedPinRow(inputs);
  if (mixed !== undefined) rows.push(mixed);

  // ------------------------------------------------------------------ 1. Queued
  // Two dispatch errors, not one. `Queue::get(pid)` missing is `NotFound`; a present entry
  // with `cancelled` set is `Cancelled`. The runtime returns each by name and §11.5 requires
  // the client to block with the same one.
  const queuedExpected = 'the proposal is queued and its entry is not cancelled';
  if (inputs.queued === undefined || inputs.cancelled === undefined) {
    rows.push(unread(1, 'Queued, not cancelled', queuedExpected));
  } else if (!inputs.queued.value) {
    rows.push(fail(1, 'Queued, not cancelled', queuedExpected, 'no queue entry for this proposal', 'NotFound'));
  } else if (inputs.cancelled.value) {
    rows.push(fail(1, 'Queued, not cancelled', queuedExpected, 'the queue entry is cancelled', 'Cancelled'));
  } else {
    rows.push(pass(1, 'Queued, not cancelled', queuedExpected, 'queued and not cancelled'));
  }

  // ------------------------------------------------------------------- 2. Window
  const windowExpected =
    'maturity ≤ the finalized height ≤ the deadline — grace_end, or failed_at + RETRY_WINDOW once this mandate has failed once';
  const failedAt = inputs.retry?.failedAt.value;
  if (window === undefined) {
    rows.push(unread(2, 'Window', windowExpected));
  } else if (window === 'before-maturity') {
    rows.push(
      fail(2, 'Window', windowExpected, 'the timelock has not elapsed; this mandate is not yet mature', 'NotMature'),
    );
  } else if (window === 'deadline-unreadable') {
    // Fail closed, and stop short of the second claim. Blocking is the client refusing to
    // offer a signature it cannot justify; declaring the mandate over would be the client
    // ending a recovery window on its own authority, which is the worse of the two.
    rows.push({
      id: 2,
      check: 'Window',
      verdict: 'unread',
      expected: windowExpected,
      actual:
        `this mandate failed at block ${String(failedAt)}, so the runtime's deadline is ` +
        'failed_at + RETRY_WINDOW rather than grace_end — and no frozen surface publishes ' +
        'RETRY_WINDOW (SQ-790), so this client cannot establish the deadline. It will not ' +
        'guess one, and it does not claim the mandate is over',
      terminal: false,
    });
  } else if (window === 'past-grace') {
    rows.push(
      fail(
        2,
        'Window',
        windowExpected,
        failedAt === undefined
          ? 'the grace window has closed and execute is no longer reachable'
          : 'the post-failure retry window has closed and execute is no longer reachable',
        'GraceExpired',
        true,
      ),
    );
  } else {
    rows.push(
      pass(
        2,
        'Window',
        windowExpected,
        failedAt === undefined
          ? 'inside the execution window'
          : `inside the post-failure retry window opened at block ${String(failedAt)}`,
      ),
    );
  }

  // ----------------------------------------------------------------- 3. Preimage
  const preimageExpected = 'the committed preimage is present and re-hashes to the commitment';
  if (inputs.preimagePresent === undefined || inputs.preimageHashMatches === undefined) {
    rows.push(unread(3, 'Preimage', preimageExpected));
  } else if (!inputs.preimagePresent.value) {
    rows.push(fail(3, 'Preimage', preimageExpected, 'the preimage is not on chain', 'BadPreimage'));
  } else if (!inputs.preimageHashMatches.value) {
    rows.push(
      fail(
        3,
        'Preimage',
        preimageExpected,
        'the stored bytes do not hash to the commitment made at trading time',
        'BadPreimage',
        // A payload that does not match its own commitment can never satisfy this check,
        // whatever else changes inside the window.
        true,
      ),
    );
  } else {
    rows.push(pass(3, 'Preimage', preimageExpected, 'present and matching'));
  }

  // ---------------------------------------------------------- 4. Runtime version
  const versionExpected = 'the queued RuntimeVersionConstraint equals the live spec_name/spec_version';
  if (inputs.runtimeVersionMatches === undefined) {
    rows.push(unread(4, 'Runtime version', versionExpected));
  } else if (!inputs.runtimeVersionMatches.value) {
    rows.push(
      // `StaleQueue`, not a `VersionMismatch` the guard never returns for this check.
      // `UpgradeVersionMismatch` is a different error on the apply-upgrade path.
      fail(4, 'Runtime version', versionExpected, 'the runtime has moved past the version this mandate was built for', 'StaleQueue'),
    );
  } else {
    rows.push(pass(4, 'Runtime version', versionExpected, 'the live runtime matches the constraint'));
  }

  // ------------------------------------------------------------- 5. Ratification
  const ratifyExpected = 'the linked ratify-track referendum is Approved, or ratification is not required';
  if (inputs.ratification === undefined) {
    rows.push(unread(5, 'Ratification', ratifyExpected));
  } else if (!RATIFICATION_ADMITS.has(inputs.ratification.value)) {
    rows.push(
      fail(
        5,
        'Ratification',
        ratifyExpected,
        ended
          ? `ratification is ${inputs.ratification.value} and the grace window has closed`
          : `ratification is ${inputs.ratification.value}; the proposal stays Queued and stays ` +
            'retryable until grace_end, and the referendum may still pass',
        'NotRatified',
      ),
    );
  } else {
    rows.push(pass(5, 'Ratification', ratifyExpected, inputs.ratification.value));
  }

  // ------------------------------------------------------ 6. Attestation presence
  const attestExpected =
    'for CODE/META: the committed attestation records still exist, unrevoked, with no challenge resolved against them';
  const attested = ATTESTED_CLASSES.has(inputs.klass.value);
  if (!attested) {
    rows.push(pass(6, 'Attestation presence', attestExpected, `not applicable to class ${inputs.klass.value}`));
  } else if (inputs.attestationRecordsIntact === undefined) {
    rows.push(unread(6, 'Attestation presence', attestExpected));
  } else if (!inputs.attestationRecordsIntact.value) {
    rows.push(
      fail(6, 'Attestation presence', attestExpected, 'a committed attestation record is missing, revoked or challenged', 'AttestationMissing'),
    );
  } else {
    rows.push(pass(6, 'Attestation presence', attestExpected, 'the committed records are intact'));
  }

  // --------------------------------------------------------- 7. Capability rules
  const capabilityExpected =
    'every decoded call domain is within the declared set, and each domain’s capability rule admits this class origin';
  if (inputs.capability === undefined) {
    rows.push(unread(7, 'Capability rules', capabilityExpected));
  } else if (!inputs.capability.domainsWithinDeclared.value) {
    rows.push(
      // The ⊆-declared half is `BadDomainDeclaration` in the guard's item-11 loop, not
      // `CapabilityDenied` — the two halves of this row fail with different names, and a
      // user told the wrong one looks for the wrong defect in their payload.
      fail(7, 'Capability rules', capabilityExpected, 'the decoded batch reaches a call domain the proposal did not declare', 'BadDomainDeclaration'),
    );
  } else if (!inputs.capability.rulesAdmitClass.value) {
    rows.push(
      fail(7, 'Capability rules', capabilityExpected, `the capability table does not admit class ${inputs.klass.value} for a declared domain`, 'CapabilityDenied'),
    );
  } else {
    rows.push(pass(7, 'Capability rules', capabilityExpected, 'declared and admitted'));
  }

  // -------------------------------------------------------------- 8. Rate meters
  // Bound to the chain's own answer rather than re-derived, per §11.5's SHOULD — and the
  // copy says what that answer covers, because it covers 09 §1.2 item 7 and nothing else.
  const metersExpected = 'meters_clear is true — the treasury and issuance meters would not block this batch now';
  if (inputs.metersClear === undefined) {
    rows.push(unread(8, 'Rate meters', metersExpected));
  } else if (!inputs.metersClear.value) {
    rows.push(
      fail(
        8,
        'Rate meters',
        metersExpected,
        'the chain reports the meters would not admit this batch; execution stays queued and retries within grace',
        'MetersBlocked',
      ),
    );
  } else {
    rows.push(
      pass(
        8,
        'Rate meters',
        metersExpected,
        'the chain reports the meters would admit it — which answers this check only, and does ' +
          'not predict that dispatch succeeds',
      ),
    );
  }

  // ------------------------------------------------------------ 9. Resource locks
  const locksExpected = 'HeldResources still holds (pid, resource) for every declared resource domain';
  if (inputs.resourceLocks === undefined) {
    rows.push(unread(9, 'Resource locks', locksExpected));
  } else {
    const held = new Set(inputs.resourceLocks.held.value);
    const missing = inputs.resourceLocks.declared.value.filter((key) => !held.has(key));
    if (missing.length > 0) {
      rows.push(
        fail(9, 'Resource locks', locksExpected, `${missing.length} declared resource domain(s) are no longer held: ${missing.join(', ')}`, 'ResourceLockMissing'),
      );
    } else {
      rows.push(pass(9, 'Resource locks', locksExpected, 'every declared domain is still held'));
    }
  }

  // ------------------------------------------------------ 10. Guardian suspension
  const suspensionExpected = 'no delay_once hold on this proposal and no gate suspension for the current epoch';
  if (inputs.suspension === undefined) {
    rows.push(unread(10, 'Guardian suspension', suspensionExpected));
  } else if (inputs.suspension.delayedOnce.value) {
    // `GuardianHold`, not `GateSuspended`: the guard checks `rerun_held(pid)` and
    // `gate_suspended()` as two `ensure!`s with two errors, and only the second is a
    // suspension. One name for both tells a user the queue is frozen when in fact one
    // guardian has held their proposal.
    rows.push(fail(10, 'Guardian suspension', suspensionExpected, 'a guardian delay_once hold is active', 'GuardianHold'));
  } else if (
    // `Some(epoch)` is a suspension only when that epoch is the current one (02 §7.8): a
    // stale entry for a past epoch blocks nothing, and reading its mere presence as a
    // suspension refuses an execution the guard would admit.
    inputs.suspension.suspendedForEpoch !== undefined &&
    inputs.suspension.suspendedForEpoch.value === inputs.suspension.currentEpoch.value
  ) {
    rows.push(
      fail(10, 'Guardian suspension', suspensionExpected, `the queue is suspended for epoch ${inputs.suspension.currentEpoch.value}`, 'GateSuspended'),
    );
  } else {
    rows.push(pass(10, 'Guardian suspension', suspensionExpected, 'no hold and no current-epoch suspension'));
  }

  // ------------------------------------------------------------- 11. Gate flags
  const gateExpected = 'no active hard-gate daily breach flag';
  if (inputs.hardGateBreach === undefined) {
    rows.push(unread(11, 'Gate flags', gateExpected));
  } else if (inputs.hardGateBreach.value) {
    rows.push(fail(11, 'Gate flags', gateExpected, 'a hard welfare-gate breach flag is set', 'FreezeActive'));
  } else {
    rows.push(pass(11, 'Gate flags', gateExpected, 'no breach flag set'));
  }

  // ------------------------------------------------------- 12. Dead-man — never waived
  const deadManExpected = 'the dead-man switch is not engaged — neither latch, and no exemption reaches this row';
  if (inputs.deadMan === undefined) {
    rows.push(unread(12, 'Dead-man freeze', deadManExpected));
  } else if (inputs.deadMan.guardLatch.value || inputs.deadMan.phaseFlagBit.value) {
    rows.push(
      fail(
        12,
        'Dead-man freeze',
        deadManExpected,
        inputs.deadMan.guardLatch.value && inputs.deadMan.phaseFlagBit.value
          ? 'both the guard latch and the constitution’s dead-man bit are engaged'
          : inputs.deadMan.guardLatch.value
            ? 'the guard’s own dead-man latch is engaged'
            : 'the constitution’s dead-man bit is engaged',
        'FreezeActive',
      ),
    );
  } else {
    rows.push(pass(12, 'Dead-man freeze', deadManExpected, 'neither latch is engaged'));
  }

  // ------------------------------------- 13. Triggering freeze — waived by expedited
  const freezeExpected =
    'no PB-LEDGER-FREEZE and no PB-MIGRATION halt — unless this proposal holds the queue-time expedited marker, which clears both';
  if (inputs.triggeringFreeze === undefined) {
    rows.push(unread(13, 'Triggering freeze', freezeExpected));
  } else {
    const { ledgerFrozen, migrationHalt, expedited } = inputs.triggeringFreeze;
    const blocked = ledgerFrozen.value || migrationHalt.value;
    if (blocked && expedited.value) {
      // The waiver is over the conjunction: expedited clears both, and neither clears the
      // other. A client that reported this as a block would refuse the emergency upgrade
      // the lane exists to admit.
      rows.push(
        pass(
          13,
          'Triggering freeze',
          freezeExpected,
          'a triggering freeze is in force and this proposal holds the expedited marker, which waives it',
        ),
      );
    } else if (blocked) {
      rows.push(
        fail(
          13,
          'Triggering freeze',
          freezeExpected,
          ledgerFrozen.value && migrationHalt.value
            ? 'PB-LEDGER-FREEZE and a PB-MIGRATION halt are both in force'
            : ledgerFrozen.value
              ? 'PB-LEDGER-FREEZE is in force'
              : 'a PB-MIGRATION halt is in force',
          'FreezeActive',
        ),
      );
    } else {
      rows.push(pass(13, 'Triggering freeze', freezeExpected, 'no freeze and no migration halt'));
    }
  }

  // ------------------------------------------------------------ 14. Batch bounds
  const boundsExpected =
    'the committed payload decodes within its bounds, is within MaxCalls / MaxPayloadBytes / the declared-weight limit, and the SafetyFilter closes over every nested wrapper';
  if (inputs.batchBounds === undefined) {
    rows.push(unread(14, 'Batch bounds', boundsExpected));
  } else {
    const b = inputs.batchBounds;
    if (!b.decodable.value) {
      // 09 §1.2 item 11: the dispatch *errors*, so the proposal keeps reading `Queued`
      // while being permanently unexecutable. Presenting it as live is the failure that
      // rule names.
      rows.push(
        fail(
          14,
          'Batch bounds',
          boundsExpected,
          'the committed preimage does not decode within its bounds. This is permanent: the ' +
            'proposal still reads Queued on chain, but no retry can succeed',
          'BadPreimage',
          true,
        ),
      );
    } else if (b.callCount.value > b.maxCalls.value) {
      // Each bound of item 11 has its own dispatch error, and `BadPreimage` was none of
      // them: `TooManyCalls`, `PayloadTooLarge`, `SafetyFilter` — and, for the weight
      // ceiling, `CapabilityDenied`, which reads oddly and is what the guard returns
      // (`ensure!(total_weight.all_lte(max_weight), Error::CapabilityDenied)`). §11.5 asks
      // for the runtime's code, not for the one a reader would have expected.
      rows.push(fail(14, 'Batch bounds', boundsExpected, `the batch has ${b.callCount.value} calls and the limit is ${b.maxCalls.value}`, 'TooManyCalls', true));
    } else if (b.payloadBytes.value > b.maxPayloadBytes.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, `the payload is ${b.payloadBytes.value} bytes and the limit is ${b.maxPayloadBytes.value}`, 'PayloadTooLarge', true));
    } else if (!b.declaredWeightWithinLimit.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, 'the declared weight exceeds the per-block fraction a mandate may claim', 'CapabilityDenied', true));
    } else if (!b.safetyFilterClosed.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, 'a nested wrapper in the payload is outside the SafetyFilter’s closed set', 'SafetyFilter', true));
    } else {
      rows.push(pass(14, 'Batch bounds', boundsExpected, 'within every bound, filter closed'));
    }
  }

  return rows;
}

/** The rows that refuse — what a screen disables the button with (§11.4 rule 5's diff). */
export function executeBlocks(inputs: ExecuteInputs): readonly ExecuteRow[] {
  return executeChecks(inputs).filter((row) => row.verdict !== 'pass');
}

/** Whether S6 may hand off to `refreshAndGate` (11 §11.4 rule 1). */
export function mayExecute(inputs: ExecuteInputs): boolean {
  return executeBlocks(inputs).length === 0;
}

/**
 * Whether this mandate is over, as opposed to merely blocked right now.
 *
 * Separate from `mayExecute` because §11.5 row 5 makes the distinction normative: a
 * pre-grace refusal keeps §11.7.4's ratification panel actionable, and a screen that
 * treated every refusal as an ending would take that panel away at the one moment it is
 * the user's only remaining move.
 */
export function mandateEnded(inputs: ExecuteInputs): boolean {
  return executeBlocks(inputs).some((row) => row.terminal);
}
