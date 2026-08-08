/**
 * Registry filings and the window event stream — 11 §11.8.6. F17.
 *
 * ## The ingest filter binds the pallet, because two pallets publish the same names
 *
 * > The registry-window history and countdown adjustments MUST source
 * > `WindowAcknowledged { epoch, filing_id, watchtower }` and
 * > `WindowExtended { epoch, filing_id, new_deadline }` from the **registry** event stream
 * > frozen in [02 §6], alongside the filing storage read. They are distinct from the oracle
 * > events of the same names, whose fields carry `component`/`round`; the ingest filter MUST
 * > bind the pallet as well as the variant name.
 *
 * This is a defect that hides perfectly. A filter matching `variant === 'WindowExtended'`
 * compiles, runs, and ingests events all day — some of them from `pallet-oracle`, about a
 * different sub-game entirely. The visible symptom is a registry challenge countdown that
 * moves when an *oracle* watchtower extends an *oracle* round: a filing's deadline appears to
 * shift for a reason that has nothing to do with it, and a challenger who trusted the
 * countdown misses their window.
 *
 * `admitRegistryWindowEvent` therefore checks **both directions**:
 *
 * - the pallet must be a registry's — a name match alone admits the wrong pallet;
 * - the payload must carry `filing_id` and must **not** carry `component`/`round` — because
 *   an event mislabelled with the right pallet and the wrong body is the same failure
 *   arriving by another route, and checking only the label trusts the labeller.
 *
 * One check alone is weaker than it looks, which is why there are two.
 *
 * ## The pallet names are **supplied**, and there is no `Registry` (V-169)
 *
 * This module shipped with `REGISTRY_PALLET = 'Registry'` and a suite that built its
 * fixtures out of that same constant, so the two agreed with each other and neither agreed
 * with the chain. **No pallet of that name exists.** `pallet-registry` is instantiated
 * *twice* — `IncidentRegistry` and `MilestoneRegistry` (02 §6 gives each its own frozen
 * event rows) — so the filter matched nothing, every real window event was rejected, and
 * §11.8.6's countdown adjustments could never happen. The failure direction is the one the
 * module's own note names: an extension that never arrives leaves the base deadline on
 * screen, and a challenger is told they are out of time while the window is still open.
 *
 * So there is no constant to be wrong any more. `RegistryInstances` is a **required
 * argument** — the same discipline `admitEvidence` uses for its hash function and
 * `fundingKeys` for the USDC location — and the composition root supplies it from the
 * runtime's own metadata. A name this module cannot invent is a name it cannot get wrong.
 *
 * ## An admitted event names **which** registry, because `filing_id` alone is not an id
 *
 * The two instances allocate ids independently (07 §7: `FilingCount` is keyed by epoch, per
 * instance), so incident filing 42 and milestone filing 42 are different filings. A stream
 * that returned a bare `filingId` would let a consumer key them together, and the visible
 * result is one filing's watchtower extension moving the other's countdown — the same defect
 * the pallet binding exists to prevent, re-entering one level down. This is 11 §11.2a rule 2
 * in another domain: two id spaces, never merged.
 *
 * ## A filing's bond is **read**, and `undeterminable` is one of the chain's answers
 *
 * §11.8.6's row scales the filing bond off `Exposure(kind, m)` (07 §7), and until contract
 * v29 nothing published it — so S19's file control asked a user to commit an amount nobody
 * could show them, and the row carried a `blocking` obligation under SQ-731.
 * `FutarchyApi.bond_quote(IncidentFiling { epoch })` / `MilestoneFiling { epoch }` now
 * answers it, and this module shares `bond-quote.ts` with P-13's reporter console because
 * the chain publishes **one** fold under two names.
 *
 * The optional return is load-bearing rather than defensive: 07 §7 makes the Milestone
 * exposure not determinable until the aggregate is bound to a component, and `file` MUST
 * then refuse with `ExposureUnavailable` — the status-quo default (G-1). A client receiving
 * nothing blocks and says which of the two silences it got, because waiting for an aggregate
 * and retrying a read are different remedies.
 *
 * The **challenge** bond is a different quantity and stays a plain read: `challenge_filing`
 * posts the filing's own stored `bond` (07 §7, I-28), which the chain priced when the filing
 * was created. A bond that already exists has been priced; one that does not has not — the
 * same asymmetry P-13 has against P-14.
 */

import type { Verified } from '@bleavit/shared-types';
import {
  bondQuoteRefusal,
  coversBond,
  BOND_QUOTE_IS_A_QUOTE,
  type BondQuoteState,
} from './bond-quote.js';

export type FilingKind = 'incident' | 'milestone';

/**
 * The two pallets `pallet-registry` is instantiated as.
 *
 * Supplied, never assumed: see the module note. The composition root reads these off the
 * runtime metadata that `CRITICAL_SURFACE` already binds (02 §6 freezes the event rows under
 * both instance names), so this module holds no chain identifier of its own.
 */
export interface RegistryInstances {
  readonly incident: string;
  readonly milestone: string;
}

/** The two window variants 02 §6 freezes for `pallet-registry`, on both instances. */
export type RegistryWindowVariant = 'WindowAcknowledged' | 'WindowExtended';

/** A raw decoded event, before it is admitted. Deliberately loose — this is untrusted input. */
export interface RawEvent {
  readonly pallet: string;
  readonly variant: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type RegistryWindowEvent =
  | {
      readonly variant: 'WindowAcknowledged';
      /** Which registry allocated this `filingId`. Never dropped — see the module note. */
      readonly registry: FilingKind;
      readonly epoch: number;
      readonly filingId: number;
      readonly watchtower: string;
    }
  | {
      readonly variant: 'WindowExtended';
      readonly registry: FilingKind;
      readonly epoch: number;
      readonly filingId: number;
      readonly newDeadline: number;
    };

export type Admission =
  | { readonly kind: 'admitted'; readonly event: RegistryWindowEvent }
  | { readonly kind: 'rejected'; readonly reason: string };

/** Fields that identify a `pallet-oracle` event of the same name — 02 §7.2. */
const ORACLE_ONLY_FIELDS = Object.freeze(['component', 'round']);

/**
 * Two registries configured under one name would silently merge their id spaces.
 *
 * Thrown rather than returned: this is a composition mistake, not an untrusted input, and a
 * mis-wired ingest filter that reported *rejected* for every event would look exactly like a
 * quiet chain.
 */
export class RegistryInstanceCollisionError extends Error {
  constructor(pallet: string) {
    super(
      `The incident and milestone registries are both configured as \`${pallet}\`. They are ` +
        'separate pallet instances with independent filing-id allocators, so one name for ' +
        'both would key two different filings together and let one filing’s extension move ' +
        'the other’s countdown.',
    );
    this.name = 'RegistryInstanceCollisionError';
  }
}

/**
 * Admit a window event only if it is a **registry's**, and say which one.
 *
 * Rejection is a first-class result rather than a filter that drops silently: an event this
 * client refuses is information — it means the stream carried something unexpected, and a
 * countdown built on a stream nobody audited is how the wrong deadline gets rendered.
 */
export function admitRegistryWindowEvent(
  raw: RawEvent,
  registries: RegistryInstances,
): Admission {
  if (registries.incident === registries.milestone) {
    throw new RegistryInstanceCollisionError(registries.incident);
  }
  const registry: FilingKind | undefined =
    raw.pallet === registries.incident
      ? 'incident'
      : raw.pallet === registries.milestone
        ? 'milestone'
        : undefined;
  if (registry === undefined) {
    return {
      kind: 'rejected',
      reason:
        `This ${raw.variant} came from ${raw.pallet}, which is neither ` +
        `${registries.incident} nor ${registries.milestone}. The oracle publishes events ` +
        'with these exact names about a different sub-game; ingesting one here would move a ' +
        'filing’s deadline for a reason that has nothing to do with it.',
    };
  }
  if (raw.variant !== 'WindowAcknowledged' && raw.variant !== 'WindowExtended') {
    return { kind: 'rejected', reason: `${raw.variant} is not a registry window event.` };
  }
  // The second direction. A right-pallet, wrong-body event is the same failure arriving by
  // another route, and checking only the label trusts the labeller.
  const strayOracleField = ORACLE_ONLY_FIELDS.find((field) => field in raw.fields);
  if (strayOracleField !== undefined) {
    return {
      kind: 'rejected',
      reason:
        `This ${raw.variant} is labelled ${raw.pallet} but carries \`${strayOracleField}\`, ` +
        'which only the oracle’s event of this name has. The label and the body disagree, so ' +
        'it is not admitted.',
    };
  }
  const epoch = raw.fields['epoch'];
  const filingId = raw.fields['filing_id'];
  if (typeof epoch !== 'number' || typeof filingId !== 'number') {
    return {
      kind: 'rejected',
      reason: `This ${raw.variant} is missing \`epoch\` or \`filing_id\`.`,
    };
  }
  if (raw.variant === 'WindowAcknowledged') {
    const watchtower = raw.fields['watchtower'];
    if (typeof watchtower !== 'string') {
      return { kind: 'rejected', reason: 'WindowAcknowledged is missing `watchtower`.' };
    }
    return {
      kind: 'admitted',
      event: { variant: 'WindowAcknowledged', registry, epoch, filingId, watchtower },
    };
  }
  const newDeadline = raw.fields['new_deadline'];
  if (typeof newDeadline !== 'number') {
    return { kind: 'rejected', reason: 'WindowExtended is missing `new_deadline`.' };
  }
  return {
    kind: 'admitted',
    event: { variant: 'WindowExtended', registry, epoch, filingId, newDeadline },
  };
}

// --------------------------------------------------------------- filing preconditions

/**
 * The MetricSpec versions live cohorts froze for this epoch — 11 §11.8.6's O-8 clause.
 *
 * Read from `Epoch.CohortSchedules[epoch].specs` (02 §7.1, frozen at contract v29). The set
 * is what the cohort committed to, and a filing naming anything else is refused on chain.
 *
 * The `unread` arm is the same fail-closed device `BondQuoteState` and `TriggerState` use,
 * and it is required for the same reason: an empty array and a read that did not land are
 * different facts, and treating a failed read as *"no versions, so nothing matches"* would
 * be right by accident while treating it as *"nothing to check"* would be the defect this
 * clause exists to remove.
 */
export type FrozenSpecVersions =
  | { readonly kind: 'read'; readonly versions: Verified<readonly number[]> }
  | { readonly kind: 'unread'; readonly reason: string };

export interface FilingInputs {
  readonly kind: FilingKind;
  readonly freeUsdc: Verified<bigint>;
  /**
   * `file`'s fifth argument, as the filer supplies it. A form value, not a chain read.
   *
   * Required rather than optional: `file(epoch, class, points, evidence_hash, spec_version)`
   * takes it, so a filing without one cannot be encoded and *"absent"* is not a state the
   * chain can be asked about.
   */
  readonly specVersion: number;
  /** What the cohorts froze — see `FrozenSpecVersions`. */
  readonly frozenSpecVersions: FrozenSpecVersions;
  /**
   * The chain's own answer for this filing's bond (contract v29, SQ-731).
   *
   * Not a constant and not a floor — see the module note. Its non-`quoted` arms block, so
   * there is no shape of these inputs in which an unpriced filing proceeds.
   */
  readonly filingBond: BondQuoteState;
  /** Current occupancy and its bound, both read. */
  readonly filingsUsed: Verified<number>;
  readonly filingsBound: Verified<number>;
  /** The evidence hash the filer supplies. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

export interface FilingBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * `registry.challenge` — §11.8.6's second row, and the bond half of it was never checked.
 *
 * The row reads *"filing within its 72 h challenge window (incl. watchtower-quorum
 * extension state, displayed); **challenge bond balance**"*, and `mayChallenge` tested only
 * the window. So the client offered a challenge to an account that cannot post the bond,
 * and the chain refused it after the signature — the same failure direction `filingBlocks`
 * exists to prevent one row above, left open on the row where the user has a deadline and
 * one attempt inside it.
 *
 * ## Two things this mirrors deliberately, and one it adds
 *
 * The bond is **read**, never computed: 07 §7 scales it with the filing's value exactly as
 * it scales the filing bond, so a constant baked in here would under-report after the first
 * amendment. And an **indeterminate** window blocks rather than degrading — `mayChallenge`
 * already refuses it, and repeating the refusal here means a caller that consults only this
 * function reaches the same answer.
 *
 * What it adds is the evidence hash. §11.8.6's row omitted one while the runtime's
 * `challenge_filing(epoch, filing_id, evidence_hash)` requires it, so a client following the
 * row alone could not encode the call at all. **That disagreement is settled** — SQ-617 was
 * resolved in the contract-v29 batch and §11.8.6's O-9 row now carries the clause in its own
 * text — so this is the row implemented, not a client working around a document. It is
 * blocked on rather than defaulted, because there is no hash that means *no evidence*.
 */
export interface ChallengeFilingInputs {
  readonly kind: FilingKind;
  /** From `challengeWindow` — its `indeterminate` arm blocks, never falls back. */
  readonly windowOpen: boolean;
  /** Why, when it is not open. Carried so this module states the window's own reason. */
  readonly windowReason: string;
  readonly freeUsdc: Verified<bigint>;
  /** Value-scaled per 07 §7 — a read, never a constant this module knows. */
  readonly challengeBond: Verified<bigint>;
  /** `challenge_filing`'s third argument. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

export function challengeFilingBlocks(inputs: ChallengeFilingInputs): readonly FilingBlock[] {
  const blocks: FilingBlock[] = [];
  if (!inputs.windowOpen) {
    blocks.push({ check: 'Challenge window', detail: inputs.windowReason });
  }
  if (inputs.freeUsdc.value < inputs.challengeBond.value) {
    blocks.push({
      check: 'Challenge bond',
      detail:
        'Your free USDC does not cover the challenge bond. The bond is value-scaled per the ' +
        'filing it disputes, so it is read from chain state rather than fixed — challenging ' +
        'a larger claim costs more.',
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A challenge needs an evidence hash. The call takes one as an argument, and a ' +
        'challenge whose evidence nobody can fetch is adjudicated as absent — which loses ' +
        'the bond you just posted.',
    });
  }
  return blocks;
}

/**
 * 02 §3's required disclosure for a filing bond — the same sentence P-13 states, because it
 * is the same method and the same freezing rule (07 §7 freezes `F(kind, m)` at creation).
 */
export const FILING_BOND_IS_A_QUOTE = BOND_QUOTE_IS_A_QUOTE;

export function filingBlocks(inputs: FilingInputs): readonly FilingBlock[] {
  const blocks: FilingBlock[] = [];
  // The arm comes from `inputs.kind`, the instance this filing is against — the two
  // registries are separate pallet instances and each asks `bond_quote` its own question.
  const refusal = bondQuoteRefusal(
    inputs.filingBond,
    inputs.kind === 'incident' ? 'incident-filing' : 'milestone-filing',
  );
  if (refusal !== undefined) {
    blocks.push({ check: 'Bond amount', detail: refusal });
  } else if (!coversBond(inputs.filingBond, inputs.freeUsdc)) {
    blocks.push({
      check: 'Filing bond',
      detail:
        'Your free USDC does not cover the filing bond. The bond is value-scaled against the ' +
        'escrow of every cohort the claim can move, so it is read from chain state rather ' +
        'than fixed — a larger claim costs more to file.',
    });
  }
  // §11.8.6's frozen-version clause (contract v29). It had **no predicate and no clause**
  // until 2026-08-07: `clauseGroupsFor` reports an undeclared read as vacuously passed, so
  // O-8 claimed complete coverage of a precondition nothing evaluated and a filer could be
  // walked to a bonded signature the runtime refuses.
  if (inputs.frozenSpecVersions.kind === 'unread') {
    blocks.push({
      check: 'MetricSpec version',
      detail:
        `This client could not read the versions the live cohorts froze for this epoch ` +
        `(${inputs.frozenSpecVersions.reason}). A filing names one of them, and the chain ` +
        'refuses any other — so the control stays closed rather than posting a bond on a ' +
        'check that did not run.',
    });
  } else if (!inputs.frozenSpecVersions.versions.value.includes(inputs.specVersion)) {
    blocks.push({
      check: 'MetricSpec version',
      detail:
        `No live cohort in this epoch froze MetricSpec version ${inputs.specVersion}. A ` +
        'filing is scored against the version its cohort committed to, so one naming any ' +
        'other version is refused on chain and the bond is posted for nothing.',
    });
  }
  if (inputs.filingsUsed.value >= inputs.filingsBound.value) {
    blocks.push({
      check: 'Registry bounds',
      detail:
        'The registry is at its bound for this epoch. A filing now would be refused on ' +
        'chain; the bound clears when the epoch closes.',
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A filing needs an evidence hash. Evidence nobody can fetch is adjudicated as ' +
        'absent, so filing without one commits a claim you cannot later support.',
    });
  }
  return blocks;
}
