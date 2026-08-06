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
 * ## 2. A failing ratification before `grace_end` is not terminal
 *
 * > `execute` **errors `NotRatified` without changing proposal state** (it stays `Queued`
 * > and stays retryable until `grace_end`) … The FE blocks pre-sign either way, but MUST
 * > NOT present a pre-grace failure as terminal.
 *
 * The client blocks and the copy stays hopeful, which is an unusual combination and the
 * reason terminality is a computed property of the *window* rather than of the row. After
 * `grace_end` every row is terminal, because `execute` is unreachable at all; inside the
 * window only a malformed payload is (09 §1.2 item 11 — *"the mandate is doomed while its
 * on-chain state still reads `Queued`"*).
 *
 * ## 3. An unread row is not a passed row
 *
 * Every input is **required and nullable** rather than optional, so a caller that has not
 * performed a read must say so and gets an `unread` verdict that blocks. INV-FE-12's rule
 * for exactly this: an unproven capability is absent, and absence disables the dependent
 * surface with a named reason.
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

import type { Verified } from '@bleavit/shared-types';

/** A dispatch error the runtime returns for a failed check (02 §7.8, 09 §1.2). */
export type ExecuteErrorCode =
  | 'NotQueued'
  | 'NotMature'
  | 'BadPreimage'
  | 'VersionMismatch'
  | 'NotRatified'
  | 'AttestationMissing'
  | 'CapabilityDenied'
  | 'MeterExceeded'
  | 'ResourceLockMissing'
  | 'GateSuspended'
  | 'FreezeActive';

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
  /** 1–14, matching 11 §11.5's own numbering so a user can cite a row. */
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

/** Where `now` sits relative to the queued window — row 2, and every row's terminality. */
export type WindowState = 'before-maturity' | 'open' | 'past-grace';

export function windowStateFor(now: number, maturity: number, graceEnd: number): WindowState {
  if (now < maturity) return 'before-maturity';
  if (now > graceEnd) return 'past-grace';
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
  readonly guardLatch: Verified<boolean>;
  /** The `DEAD_MAN_ENGAGED` bit of `Constitution.PhaseFlags` (02 §7.3 bit 6). */
  readonly phaseFlagBit: Verified<boolean>;
}

/**
 * Row 13's inputs — the pair the expedited lane waives **together**.
 *
 * The waiver is over the conjunction: neither the ledger freeze nor the migration halt
 * clears the other, and the marker clears both.
 */
export interface TriggeringFreezeInputs {
  /** The `LEDGER_FROZEN` bit of `Constitution.PhaseFlags` (02 §7.3 bit 5) — PB-LEDGER-FREEZE. */
  readonly ledgerFrozen: Verified<boolean>;
  /** `ExecutionGuard.MigrationHalt` (02 §7.8). */
  readonly migrationHalt: Verified<boolean>;
  /** `ExecutionGuard.Expedited(pid)` (02 §7.8) — the queue-time marker of 09 §3.1. */
  readonly expedited: Verified<boolean>;
}

/** Row 10 — a suspension keyed to an epoch means nothing without the current one. */
export interface SuspensionInputs {
  /** `ExecutionGuard.GateSuspension`'s `Option<EpochId>` (02 §7.8). */
  readonly suspendedForEpoch: Verified<number> | undefined;
  /** `Epoch.EpochOf.index` (02 §7.1) — the companion read §7.8 names. */
  readonly currentEpoch: Verified<number>;
  /** A guardian `delay_once` hold on this proposal (06). */
  readonly delayedOnce: Verified<boolean>;
}

/** Row 7 — the two independent claims §11.5's capability row makes. */
export interface CapabilityInputs {
  /** Every call domain the decoded batch reaches is in the proposal's declared set (I-11). */
  readonly domainsWithinDeclared: Verified<boolean>;
  /** Each domain's `Constitution.Capabilities` rule admits this class origin (02 §7.3). */
  readonly rulesAdmitClass: Verified<boolean>;
}

/** Row 9 — every declared resource domain still held by this proposal. */
export interface ResourceLockInputs {
  /** The proposal's declared resource keys (05 §1.4). */
  readonly declared: Verified<readonly string[]>;
  /** The keys `ExecutionGuard.HeldResources` still holds for this pid (02 §7.8). */
  readonly held: Verified<readonly string[]>;
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
  readonly decodable: Verified<boolean>;
  readonly callCount: Verified<number>;
  /** `ExecutionGuard::MaxCalls`, from the constants API (02 §9). */
  readonly maxCalls: Verified<number>;
  readonly payloadBytes: Verified<number>;
  /** `ExecutionGuard::MaxPayloadBytes`, from the constants API (02 §9). */
  readonly maxPayloadBytes: Verified<number>;
  /**
   * Whether the declared weight is within the block-limit fraction of 13 §2.
   *
   * A verdict rather than a pair of numbers, because the fraction is a chain-read tunable
   * and the comparison needs the block limit — neither of which this package may hold as a
   * literal (app-code rule 7). The caller does the arithmetic where it has the readings.
   */
  readonly declaredWeightWithinLimit: Verified<boolean>;
  /** The SafetyFilter closure over nested wrappers, applied statically to the preimage. */
  readonly safetyFilterClosed: Verified<boolean>;
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
  readonly klass: Verified<string>;
  /** Row 1: `ExecutionGuard.Queue(pid)` holds this proposal. */
  readonly queued: Verified<boolean> | undefined;
  /** Row 1: the queue entry's `cancelled` flag (02 §4). */
  readonly cancelled: Verified<boolean> | undefined;
  /**
   * Row 2: the finalized height, and the entry's own window.
   *
   * `number` rather than `bigint` because 02 §4 types every one of them `BlockNumber`
   * (`u32`), which is exact in a JS number and is what `BlockRef` renders. A `bigint` here
   * would force a conversion at the render edge, and that conversion is a hand-built
   * `Verified<T>` — the shape rule B of `check-render-provenance` exists to catch.
   */
  readonly now: Verified<number> | undefined;
  readonly maturity: Verified<number> | undefined;
  readonly graceEnd: Verified<number> | undefined;
  /** Row 3: `Preimage.PreimageFor(payload_hash, len)` is present. */
  readonly preimagePresent: Verified<boolean> | undefined;
  /** Row 3: the client's own re-hash of those bytes equals the committed hash. */
  readonly preimageHashMatches: Verified<boolean> | undefined;
  /** Row 4: `RuntimeVersionConstraint` equals the live `spec_name`/`spec_version`. */
  readonly runtimeVersionMatches: Verified<boolean> | undefined;
  /** Row 5: 02 §2's `RatificationStatus` — `NotRequired` / `NoPassedRecord` / `Passed`. */
  readonly ratification: Verified<string> | undefined;
  /** Row 6: the committed attestation records still exist, unrevoked and unchallenged. */
  readonly attestationRecordsIntact: Verified<boolean> | undefined;
  /** Row 7. */
  readonly capability: CapabilityInputs | undefined;
  /** Row 8: `QueuedExecutionView.meters_clear` — the chain's own answer (02 §4). */
  readonly metersClear: Verified<boolean> | undefined;
  /** Row 9. */
  readonly resourceLocks: ResourceLockInputs | undefined;
  /** Row 10. */
  readonly suspension: SuspensionInputs | undefined;
  /** Row 11: `Welfare.GateBreachFlags` / `ExecutionGuard.HardGateBreach` (02 §7.8). */
  readonly hardGateBreach: Verified<boolean> | undefined;
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
  // is `unread` rather than assumed when any of its three inputs is missing.
  const window: WindowState | undefined =
    inputs.now === undefined || inputs.maturity === undefined || inputs.graceEnd === undefined
      ? undefined
      : windowStateFor(inputs.now.value, inputs.maturity.value, inputs.graceEnd.value);
  // Past `grace_end` there is no retry, so a failure anywhere is the end of the mandate.
  // Before then a failure defers — including a failed ratification, which §11.5 row 5
  // requires the client not to present as terminal.
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

  // ------------------------------------------------------------------ 1. Queued
  const queuedExpected = 'the proposal is queued and its entry is not cancelled';
  if (inputs.queued === undefined || inputs.cancelled === undefined) {
    rows.push(unread(1, 'Queued, not cancelled', queuedExpected));
  } else if (!inputs.queued.value) {
    rows.push(fail(1, 'Queued, not cancelled', queuedExpected, 'no queue entry for this proposal', 'NotQueued'));
  } else if (inputs.cancelled.value) {
    rows.push(fail(1, 'Queued, not cancelled', queuedExpected, 'the queue entry is cancelled', 'NotQueued'));
  } else {
    rows.push(pass(1, 'Queued, not cancelled', queuedExpected, 'queued and not cancelled'));
  }

  // ------------------------------------------------------------------- 2. Window
  const windowExpected = 'maturity ≤ the finalized height ≤ grace_end';
  if (window === undefined) {
    rows.push(unread(2, 'Window', windowExpected));
  } else if (window === 'before-maturity') {
    rows.push(
      fail(2, 'Window', windowExpected, 'the timelock has not elapsed; this mandate is not yet mature', 'NotMature'),
    );
  } else if (window === 'past-grace') {
    rows.push(
      fail(2, 'Window', windowExpected, 'the grace window has closed and execute is no longer reachable', 'NotMature', true),
    );
  } else {
    rows.push(pass(2, 'Window', windowExpected, 'inside the execution window'));
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
      fail(4, 'Runtime version', versionExpected, 'the runtime has moved past the version this mandate was built for', 'VersionMismatch'),
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
      fail(7, 'Capability rules', capabilityExpected, 'the decoded batch reaches a call domain the proposal did not declare', 'CapabilityDenied'),
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
        'MeterExceeded',
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
    rows.push(fail(10, 'Guardian suspension', suspensionExpected, 'a guardian delay_once hold is active', 'GateSuspended'));
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
      rows.push(fail(14, 'Batch bounds', boundsExpected, `the batch has ${b.callCount.value} calls and the limit is ${b.maxCalls.value}`, 'BadPreimage', true));
    } else if (b.payloadBytes.value > b.maxPayloadBytes.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, `the payload is ${b.payloadBytes.value} bytes and the limit is ${b.maxPayloadBytes.value}`, 'BadPreimage', true));
    } else if (!b.declaredWeightWithinLimit.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, 'the declared weight exceeds the per-block fraction a mandate may claim', 'BadPreimage', true));
    } else if (!b.safetyFilterClosed.value) {
      rows.push(fail(14, 'Batch bounds', boundsExpected, 'a nested wrapper in the payload is outside the SafetyFilter’s closed set', 'BadPreimage', true));
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
