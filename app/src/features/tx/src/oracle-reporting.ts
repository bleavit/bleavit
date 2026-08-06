/**
 * `oracle.report` and `oracle.challenge` — 11 §11.8.1's second row, preconditions P-13/P-14.
 *
 * ## Every bond here is **read**, and this module contains no bond arithmetic
 *
 * P-14 says the escalation bond *"doubles per round"*, and that sentence is an invitation to
 * write `B_1 << (round - 1)` in a client. It would be wrong for the same reason SQ-552's
 * lead-time recomputation was wrong. 07 §6.1 freezes `B_1` and `R_max` **per game**, at the
 * block round 1 is created:
 *
 * > Every subsequent escalation derives `B_r` from the stored `B_1` … no escalation re-reads
 * > `orc.bond_floor`, `orc.bond_bps` or `orc.rounds`. A META amendment to any of those three
 * > therefore prices only games opened after it takes effect.
 *
 * So a client that recomputed would price the round off *today's* parameters while the chain
 * prices it off the ones frozen when the game opened — and after any lawful amendment the two
 * disagree. The user is then shown a bond that is not the bond, and either signs a call the
 * chain refuses for insufficient balance or is refused one it would have accepted.
 *
 * 02 §4's `OracleRoundView` carries `bond` — *this* round's amount, as the chain holds it —
 * so the correct client behaviour is to read it. There is therefore **no doubling, no
 * `orc.bond_bps` multiplication and no window arithmetic anywhere in this module**, and a
 * test asserts their absence, exactly as `upgrade-crank.ts` does for `DescriptorLeadTime`.
 * `challenge_deadline` is likewise the stored deadline, already carrying any extension the
 * chain applied — recomputing it from `orc.window` would be the same defect one field over.
 *
 * ## The round-1 report bond is **not** computable from any frozen surface (SQ-598)
 *
 * P-13 asks for the bond to be *"recomputed and displayed"*, and for a fresh report there is
 * no round yet to read it from. The formula needs `StakeAtRisk(c, m)` — the sum of
 * `CohortEscrow(k)` over *every* cohort whose frozen MetricSpec consumes component `c` for
 * measurement epoch `m` (07 §6.1). 02 freezes no surface carrying it: `open_oracle_rounds()`
 * returns only rounds that already exist, `RoundState.stake_at_risk` is explicitly not what
 * the FE reads, and reassembling the sum from cohort membership and per-vault escrow would be
 * a client *computation* where 11 §11.4 rule 2 requires an exact chain read — the same
 * distinction 02 §4 draws when it explains why `is_reserved_protocol_destination` is a method
 * rather than published constants.
 *
 * The honest shape is the one this console already uses for SQ-564: state the bound that
 * *can* be read and refuse to present it as the amount. `reportBondFloor` returns a value
 * **labelled a lower bound**, and `reportBlocks` will block on failing to cover even that —
 * a true statement — while `REPORT_BOND_NOT_ESTABLISHED` says plainly that the value-scaled
 * part is unknown to this client and that the held amount will be larger for a cohort with
 * escrow. There is deliberately no `exact` arm: an arm no code path can construct is
 * `FE-HANDOFF-010`'s shape, and its presence would suggest a capability that does not exist.
 *
 * ## A reporter may not challenge their own round
 *
 * 07 §5.2 grants `challenge` to *"anyone **other than the round's own reporter**"* — §5.5
 * disposes of a round in favour of "the honest counterparty" and no party can lose to itself.
 * §11.5's P-14 row does not list it, but `OracleRoundView` carries `reporter`, so it is an
 * exact chain read and 11 §11.4's discipline is to refuse what the chain will refuse. Left
 * out, it costs a fee and returns an error the user cannot map to anything they did.
 */

import type { Verified } from '@bleavit/shared-types';

/**
 * 02 §4's `OracleRoundView`, as the client holds it.
 *
 * `bond` is this round's amount **as the chain holds it** — never derived here. `escalated`
 * is `round > 1` and, per 02 §4, MUST NOT be read as "currently challenged".
 */
export interface OracleRound {
  readonly component: Verified<number>;
  readonly epoch: Verified<number>;
  readonly specVersion: Verified<number>;
  readonly round: Verified<number>;
  readonly reporter: Verified<string>;
  readonly value1e9: Verified<bigint>;
  readonly evidenceHash: Verified<string>;
  /** The round's bond. Read — see the module note; no doubling happens in this client. */
  readonly bond: Verified<bigint>;
  /** Stored deadline, already carrying any extension. Read, never recomputed from `orc.window`. */
  readonly challengeDeadline: Verified<number>;
  readonly ackedByWatchtowers: Verified<number>;
  readonly escalated: Verified<boolean>;
}

/**
 * A lower bound on the round-1 report bond, and it says so.
 *
 * Not an estimate and not a default: `floor` is `orc.bond_floor`, read through `params()`,
 * and the value-scaled term above it is unreadable (see the module note). Carrying it as its
 * own type keeps a screen from rendering it in the place an exact amount would go.
 */
export interface ReportBondFloor {
  readonly floor: Verified<bigint>;
  /** Why this is a bound rather than the amount. Fixed copy — the reason is structural. */
  readonly why: string;
}

export const REPORT_BOND_NOT_ESTABLISHED =
  'This client cannot state the bond your report will hold. It is value-scaled against the ' +
  'escrow of every cohort measuring this component (07 §6), and no surface the integration ' +
  'contract freezes publishes that figure — so what is shown is the floor, which is the ' +
  'least it can be. For a cohort with escrow it will be larger, and the difference is held ' +
  'from your balance when the report lands.';

export function reportBondFloor(floor: Verified<bigint>): ReportBondFloor {
  return { floor, why: REPORT_BOND_NOT_ESTABLISHED };
}

export interface ReportInputs {
  /**
   * Whether the 07 §5.1 report window is still open, **read** rather than derived from the
   * epoch clock. No deadline arithmetic lives in this module.
   */
  readonly reportWindowOpen: Verified<boolean>;
  /** From the frozen `Oracle.Reporters` map (02 §7.2). */
  readonly registered: Verified<boolean>;
  /** The stake currently held for this reporter, against `orc.reporter_stake`. Both read. */
  readonly stakeHeld: Verified<bigint>;
  readonly reporterStake: Verified<bigint>;
  readonly freeUsdc: Verified<bigint>;
  readonly bondFloor: ReportBondFloor;
  /** The evidence hash the reporter supplies. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

export interface ReportBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * What this client can establish before `oracle.report`, and what it cannot.
 *
 * `bondUnknown` is a **required** field for the reason `RegistrationCheck.uncheckable` is:
 * there is no shape of this result in which the unreadable part is absent, so no screen can
 * present the check as complete.
 */
export interface ReportCheck {
  readonly blocks: readonly ReportBlock[];
  readonly bondUnknown: string;
}

export function reportBlocks(inputs: ReportInputs): ReportCheck {
  const blocks: ReportBlock[] = [];
  if (!inputs.reportWindowOpen.value) {
    blocks.push({
      check: 'Report window',
      detail:
        'The reporting window for this measurement epoch has closed. A report now is refused ' +
        'on chain, and the component settles neutral for this epoch.',
    });
  }
  if (!inputs.registered.value) {
    blocks.push({
      check: 'Reporter registry',
      detail: 'This account is not a registered reporter, so it cannot report.',
    });
  } else if (inputs.stakeHeld.value < inputs.reporterStake.value) {
    // Registered but under-staked — a distinct state from unregistered, and a distinct
    // remedy. A prior slash leaves the registration standing and the hold short.
    blocks.push({
      check: 'Reporter stake',
      detail:
        'Your reporter stake is no longer held in full — a previous slash left it short. ' +
        'Reporting requires the whole stake held, so it must be topped up first.',
    });
  }
  if (inputs.freeUsdc.value < inputs.bondFloor.floor.value) {
    blocks.push({
      check: 'Round bond',
      detail:
        'Your free USDC does not cover even the floor of the round bond, so this report ' +
        `cannot be posted. ${inputs.bondFloor.why}`,
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A report needs an evidence hash — content-addressed raw data and the recomputation ' +
        'instructions the frozen MetricSpec requires. Evidence nobody can fetch is treated as ' +
        'absent, which loses the round on its own.',
    });
  }
  return { blocks, bondUnknown: inputs.bondFloor.why };
}

export interface ChallengeInputs {
  readonly round: OracleRound;
  /** The account that would sign. Compared against the round's reporter — 07 §5.2. */
  readonly caller: string;
  readonly freeUsdc: Verified<bigint>;
  /** Chain head at B′. Compared against the **stored** deadline, never a recomputed one. */
  readonly now: Verified<number>;
  readonly evidenceHash: string | undefined;
}

/**
 * Everything blocking `oracle.challenge`, all of it — P-14 plus 07 §5.2's self-challenge rule.
 *
 * The bond compared against is `round.bond`: the chain's own figure for this round. Nothing
 * here doubles anything.
 */
export function challengeBlocks(inputs: ChallengeInputs): readonly ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (inputs.now.value > inputs.round.challengeDeadline.value) {
    blocks.push({
      check: 'Challenge window',
      detail:
        'The challenge window for this round has closed. This is the deadline the chain ' +
        'stores, so it already includes any extension that was granted.',
    });
  }
  if (inputs.caller === inputs.round.reporter.value) {
    blocks.push({
      check: 'Own round',
      detail:
        'You are this round’s reporter, and a reporter may not challenge their own round. ' +
        'The game resolves in favour of an honest counterparty, and there is no counterparty ' +
        'when one account holds both roles — nothing about the reported value would be ' +
        'settled by it.',
    });
  }
  if (inputs.freeUsdc.value < inputs.round.bond.value) {
    blocks.push({
      check: 'Matching bond',
      detail:
        'Your free USDC does not cover this round’s bond. A challenge posts the same bond ' +
        'the round carries — the amount shown is the one the chain holds for it, not a ' +
        'figure this client worked out.',
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A challenge needs an evidence hash for the counter-value. Unretrievable evidence is ' +
        'adjudicated as absent, so a challenge filed without it argues nothing.',
    });
  }
  return blocks;
}

/**
 * What a challenger stands to lose, stated before they post.
 *
 * §6.2's ladder is a fact about the *game*, not a computation this client performs: the copy
 * names the round's own bond (read) and says the stack can grow, without predicting by how
 * much. Predicting it would mean deriving `B_r` — the thing this module refuses to do.
 */
export function escalationConsequence(round: OracleRound): string {
  return (
    'A challenge posts this round’s bond and opens an escalation the reporter may answer at ' +
    'a higher one. If the round is adjudicated against you, the whole stack you have posted ' +
    'is forfeited — 40% to the counterparty and 60% to INSURANCE. The ladder is fixed when ' +
    'the game opens and this client does not predict it: what is shown is the amount the ' +
    `chain holds for round ${round.round.value}.`
  );
}
