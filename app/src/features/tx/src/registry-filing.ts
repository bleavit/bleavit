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
 *
 * ## `file` refuses on five conditions and this module evaluated none of them (2026-08-08)
 *
 * `registry_core::file` raises `WindowClosed`, `AlreadyFinal`, `InvalidClass`,
 * `MilestoneTargetUnset` and `TooManyLiveEpochs`. `filingBlocks` checked the bond, the
 * occupancy, the frozen spec version and the evidence hash — none of those five — and O-8
 * declared no clause for any of them. The model could not even *describe* the call: `class`
 * and `points` are two of `file`'s five arguments and `FilingInputs` carried neither.
 *
 * Two are closed here, each by the strongest available means:
 *
 * - **`AlreadyFinal`** is a plain read, because `ClosedAt` is the same `(epoch, spec_version)`
 *   double map `close_epoch` writes in the same call that pushes the terminal aggregate. It is
 *   frozen (02 §7.4, contract v28) and O-9 already cited it; O-8 did not. Its **absence** now
 *   carries the read that found it absent — see `EpochClosure`, where the arm that grants
 *   permission was the one arm holding no evidence.
 * - **`InvalidClass`** is made unrepresentable rather than checked — see `FilingInputs`. The
 *   two instances take disjoint class types, so a milestone filing carrying `S2` does not
 *   typecheck.
 *
 * ## Evidence that does not name its subject is evidence about something else (2026-08-09)
 *
 * The repair above made `open` carry proof that a read happened, and a fourth-round review
 * found the obvious next question unanswered: proof of *which* read. `ClosedAt` is a
 * per-instance `(epoch, spec_version)` double map, so a finalized absence read of the milestone
 * instance — or of a sibling version, or of last epoch — produced an identical branded `open`
 * and `filingBlocks` raised nothing on a **bonded** action.
 *
 * Both readings this module decides on now name their key: {@link ClosureSubject} on every arm
 * of {@link EpochClosure}, and the epoch on both arms of {@link FrozenSpecVersions}. The
 * instance is enforced by the **type** and the key by **derivation** — `FilingInputs` carries
 * no `specVersion` of its own, because a second copy is a second thing to disagree. See
 * `EpochClosure`'s note for why those two means are different.
 *
 * **Two readings in this file still name no subject, and both are the same shape.** They are
 * recorded here rather than left for a fifth review to rediscover:
 *
 * - `filingsUsed` is `FilingCount[epoch]` on this instance and is a bare `Verified<number>`.
 *   `used < bound` is a permitting comparison, so a count read for another epoch — or for the
 *   sibling registry — opens the bonded control. (`filingsBound` needs no subject: it is a
 *   kernel constant.) Binding it to the closure subject is the same repair as
 *   `FrozenSpecVersions` got here.
 * - the whole **challenge** row (`ChallengeFilingInputs`) names no filing at all: not the
 *   epoch, not the `filing_id`, on a call whose signature is
 *   `challenge_filing(epoch, filing_id, evidence_hash)`. So `windowOpen` and `challengeBond`
 *   are both per-filing reads with nowhere to say which filing, and both decide the control.
 *   That is a modelling gap of the kind `class` and `points` were, not only a subject gap, so
 *   it is a row to implement rather than a field to add.
 *
 * Three stay open and are named rather than hidden (SQ-1031): the **filing window**
 * (`WindowClosed`, from `Epoch::filing_window_end(epoch)`, which no frozen surface publishes),
 * the **milestone target** (`MilestoneTargetUnset`, from `Epoch::milestone_target(epoch,
 * spec_version)`, likewise), and `TooManyLiveEpochs` (whose count is `FilingCount`'s key set
 * and whose bound is a kernel constant with no metadata home). `points` also stays absent from
 * the model, because nothing in `file` gates on it — it is the claim's magnitude, not a
 * precondition — but a form that cannot express it cannot encode the call either.
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
/**
 * ## The set is read **per epoch**, so the reading names the epoch it was keyed to
 *
 * `Epoch.CohortSchedules` is an epoch-keyed map, and this union carried no epoch at all — so a
 * set read for epoch 40, where version 3 was live, admitted a filing in epoch 41 whose cohorts
 * froze something else entirely. The `read` arm is the **permitting** one: `includes` returning
 * true raises no block, and the bond is committed before the chain disagrees. `filingBlocks`
 * therefore compares this epoch against the one the closure read was keyed to (see
 * {@link ClosureSubject}), which is the single home of `file`'s `(epoch, spec_version)` pair.
 */
export type FrozenSpecVersions =
  | { readonly kind: 'read'; readonly epoch: number; readonly versions: Verified<readonly number[]> }
  | { readonly kind: 'unread'; readonly epoch: number; readonly reason: string };

/**
 * `file`'s second argument — `registry_core::FilingClass`, and **the instance decides it**.
 *
 * `validate_class` admits `S1 | S2 | S3` on the Incident instance and `Scope(_)` on the
 * Milestone one, and nothing else (`InvalidClass`). That is not a check written here: the two
 * instances take two disjoint argument types, so `FilingInputs` is a union on `kind` and a
 * milestone filing carrying `S2` is not a value that exists. A predicate would have been the
 * weaker half of the same rule — `InvalidClass` is refused at dispatch, after the bond is
 * committed, and this client is the thing that decides what to encode.
 *
 * `Scope` carries a `u8` on chain. It is modelled as its own object rather than as a bare
 * number so an incident class and a milestone scope can never be mistaken for one another by
 * a caller writing a literal.
 */
export type IncidentClass = 'S1' | 'S2' | 'S3';
export interface MilestoneClass {
  readonly scope: number;
}

/** The three incident severities, as data — so a form offers exactly the admissible set. */
export const INCIDENT_CLASSES: readonly IncidentClass[] = Object.freeze(['S1', 'S2', 'S3']);

/**
 * What every filing carries whichever instance it is against.
 *
 * `file`'s `epoch` and `spec_version` arguments have **no field here**, and that absence is the
 * 2026-08-09 repair rather than an omission: they live in `epochClosed.subject`, the key the
 * `ClosedAt` read was actually taken against. A form value beside the read would be a second
 * home for the same pair, and two homes for one fact is precisely how a finalized read of the
 * wrong key came to satisfy a precondition about another. This is `guardianCall`'s device in
 * another domain — *the value evaluated and the value dispatched are one value* — and it is
 * why an encoder for `file` (still absent; `points` has no home either, SQ-1031) must take both
 * from {@link ClosureSubject} and from nowhere else.
 */
interface FilingInputsBase<K extends FilingKind> {
  readonly freeUsdc: Verified<bigint>;
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
  /**
   * Whether this instance has already closed out `(epoch, spec_version)` — `AlreadyFinal`.
   *
   * A read of `ClosedAt[epoch][spec_version]`, which `close_epoch` writes in the same call
   * that pushes the aggregate `registry_core::file` tests. `unread` is its own arm for the
   * reason every arm like it exists here: a read that did not land is not the same fact as
   * *"this epoch is open"*, and treating it as the second posts a bond into an epoch the
   * chain has closed. Build the two read arms with {@link epochClosure} — *open* is a chain
   * answer and cannot be written by hand.
   */
  readonly epochClosed: EpochClosure<K>;
  /** The evidence hash the filer supplies. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

declare const CLOSURE_READ: unique symbol;

/**
 * `ClosedAt[epoch][spec_version]`, read — 07 §7's terminal aggregate (02 §7.4, v28).
 *
 * ## `open` is a chain answer, so it carries the read that produced it
 *
 * Two of the three arms always held their evidence: `closed` carries the block and `unread`
 * carries the reason. `open` was `{ kind: 'open' }` — no datum, no pin and no producer — so
 * any caller could satisfy `file`'s `AlreadyFinal` precondition by writing two words, and
 * `filingBlocks` would raise nothing. It was a state the type let you *assert* rather than
 * one a read could *establish*, which is the defect this branch already closed once, on a
 * `Verified<T>` allowance limit that nothing produced.
 *
 * The direction is what makes it expensive rather than merely wrong. `unread` and `closed`
 * both block, so a hand-assembled one of those costs a user nothing. **`open` permits, and a
 * filing is bonded**: the bond is committed with the extrinsic, and the runtime then reverts
 * the call it paid for. So the arm that grants permission is the arm that must carry proof.
 *
 * The repair is a type rather than a check. `open` holds the finalized read that found the
 * key empty, plus a module-private brand — the `Finalized<T>` and `GatePassed` construction —
 * so {@link epochClosure} is the only producer and `{ kind: 'open' }` does not typecheck at
 * all (`tests/firewall/fixtures/registry-filing-open-epoch-without-a-read.ts`). The brand also
 * puts this type under `check:casts`, which discovers brands rather than listing them, so
 * `as EpochClosure` is refused everywhere except the file below.
 *
 * The sibling arms of `BondQuoteState` are **deliberately** left structural: `undeterminable`
 * and `unread` both refuse, so writing one by hand can only cost a user an action they could
 * have taken, never a bond on a transaction that cannot land.
 *
 * ## A read is proof of nothing until it says **which key** it read (2026-08-09)
 *
 * The brand established that a read happened. It did not establish what the read was *of* — and
 * a finalized absence read of the wrong key is still a finalized absence read, so the brand
 * admitted it and the control opened on evidence about something else. Three ways to be wrong,
 * all of them producing an identical `open`:
 *
 * - **the other instance.** `pallet-registry` is instantiated twice and each instance keeps its
 *   own `ClosedAt`; the milestone map being empty says nothing about the incident one;
 * - **a sibling `spec_version`.** The map is a double map and a close is per pair — this
 *   module's own `closed` sentence already said *"a sibling version's close would say nothing
 *   about this one"*, while the `open` arm could be produced by exactly that;
 * - **another epoch.** Same argument, outer key.
 *
 * Each is closed by the strongest means available to it, and the two means are different:
 *
 * - the **instance** is a type. `EpochClosure<K>` is parameterised on the registry and
 *   `FilingInputs`' two arms take `EpochClosure<'incident'>` and `EpochClosure<'milestone'>`,
 *   so a milestone reading in an incident filing does not typecheck at all. That is the device
 *   `TriggerState<'GateBreach'>` already uses one module over
 *   (`tests/firewall/fixtures/registry-filing-closure-for-the-other-instance.ts`);
 * - the **key** is a derivation. `epoch` and `spec_version` are numbers, so no type can hold
 *   them — but they need no comparison either, because `FilingInputs` no longer carries a
 *   second copy to disagree with: the subject **is** `file`'s `(epoch, spec_version)` pair and
 *   `filingBlocks` reads it from here
 *   (`tests/firewall/fixtures/registry-filing-spec-version-beside-its-read.ts`).
 *
 * A comparison someone can forget to call is weaker than a shape they cannot build, and one
 * value is weaker still than nothing to compare.
 */
export type EpochClosure<K extends FilingKind = FilingKind> =
  | {
      readonly kind: 'open';
      readonly subject: ClosureSubject<K>;
      /**
       * The read that established the absence — `Verified<undefined>` because the key held
       * nothing at that block, not because nothing was read.
       */
      readonly read: Verified<undefined>;
      readonly [CLOSURE_READ]: true;
    }
  | { readonly kind: 'closed'; readonly subject: ClosureSubject<K>; readonly at: Verified<number> }
  | { readonly kind: 'unread'; readonly subject: ClosureSubject<K>; readonly reason: string };

/**
 * Which `ClosedAt` key a closure reading answers about — instance, epoch and spec version.
 *
 * On **every** arm, including the two that refuse. `unread` is this client's report that a read
 * did not land, and *"a read did not land"* is only a fact once it says which read: a refusal
 * naming the wrong epoch sends an operator to retry something they were never blocked on.
 */
export interface ClosureSubject<K extends FilingKind = FilingKind> {
  /** Which of the two `pallet-registry` instances. Independent allocators, independent maps. */
  readonly registry: K;
  /** `ClosedAt`'s outer key, and `file`'s first argument. */
  readonly epoch: number;
  /** `ClosedAt`'s inner key, and `file`'s fifth argument. */
  readonly specVersion: number;
}

/**
 * `ClosedAt[epoch][spec_version]` as the chain answers it — and the only producer of `open`.
 *
 * It takes the whole `Option<BlockNumber>` read rather than a pre-decided arm, so which arm
 * results is the chain's answer and not the caller's claim. A caller holding no read has
 * nothing to pass in, which is the property `derive` has for the same reason (10 §2.2).
 *
 * The **subject comes first** because it is the question, not a label on the answer: a caller
 * writes down which key it is about before it has a result, and the same three values are then
 * what the filing itself is about. There is nowhere else to put them.
 *
 * Two arms are reachable without it and both refuse, which is why neither is branded: a
 * `closed` literal can only block a lawful filing, and `unread` is the client's own report
 * that the read did not land rather than a chain datum at all. Both still carry the subject,
 * because a refusal that names the wrong key is a refusal an operator cannot act on.
 */
export function epochClosure<K extends FilingKind>(
  subject: ClosureSubject<K>,
  read: Verified<number | undefined>,
): EpochClosure<K> {
  const { value, status } = read;
  return value === undefined
    ? ({ kind: 'open', subject, read: { value: undefined, status } } as EpochClosure<K>)
    : { kind: 'closed', subject, at: { value, status } };
}

/**
 * §11.8.6 row 1's inputs, keyed on the instance being filed to.
 *
 * A union rather than a `kind` field beside an unconstrained class, so `validate_class`'s rule
 * is the shape rather than a check: `InvalidClass` cannot be built. That matters more here
 * than it would elsewhere, because the refusal lands after the bond is committed.
 */
export type FilingInputs =
  | (FilingInputsBase<'incident'> & { readonly kind: 'incident'; readonly class: IncidentClass })
  | (FilingInputsBase<'milestone'> & { readonly kind: 'milestone'; readonly class: MilestoneClass });

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
  // `file`'s `(epoch, spec_version)` pair, taken from the read that was keyed to it. There is
  // no second copy on `FilingInputs` to disagree with — see `FilingInputsBase`.
  const { epoch, specVersion } = inputs.epochClosed.subject;
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
  if (inputs.frozenSpecVersions.epoch !== epoch) {
    // `Epoch.CohortSchedules` is epoch-keyed, so a set read for another epoch answers another
    // question. The `read` arm is the permitting one, which is what makes an unnamed subject
    // expensive here: `includes` returning true raises no block at all.
    blocks.push({
      check: 'Cohort schedule',
      detail:
        `The frozen MetricSpec versions this client holds were read for epoch ` +
        `${inputs.frozenSpecVersions.epoch}, and this filing is against epoch ${epoch}. ` +
        'Cohorts freeze their versions per epoch, so that set says nothing about this one — ' +
        'the control stays closed rather than posting a bond on a check that ran against a ' +
        'different question.',
    });
  } else if (inputs.frozenSpecVersions.kind === 'unread') {
    blocks.push({
      check: 'MetricSpec version',
      detail:
        `This client could not read the versions the live cohorts froze for this epoch ` +
        `(${inputs.frozenSpecVersions.reason}). A filing names one of them, and the chain ` +
        'refuses any other — so the control stays closed rather than posting a bond on a ' +
        'check that did not run.',
    });
  } else if (!inputs.frozenSpecVersions.versions.value.includes(specVersion)) {
    blocks.push({
      check: 'MetricSpec version',
      detail:
        `No live cohort in this epoch froze MetricSpec version ${specVersion}. A ` +
        'filing is scored against the version its cohort committed to, so one naming any ' +
        'other version is refused on chain and the bond is posted for nothing.',
    });
  }
  // `registry_core::file`'s `AlreadyFinal`, which nothing evaluated until 2026-08-08. A
  // closed-out `(epoch, version)` aggregate is terminal (07 §7), so a filing behind one is
  // refused — after the bond has been committed, which is what makes an unevaluated check
  // expensive here rather than merely wrong.
  if (inputs.epochClosed.kind === 'unread') {
    blocks.push({
      check: 'Epoch closed',
      detail:
        `This client could not read whether epoch ${epoch} has already been closed out at ` +
        `MetricSpec version ${specVersion} (${inputs.epochClosed.reason}). A closed ` +
        'epoch is terminal and a filing behind one is refused on chain, so the control stays ' +
        'closed rather than posting a bond on a check that did not run.',
    });
  } else if (inputs.epochClosed.kind === 'closed') {
    blocks.push({
      check: 'Epoch closed',
      detail:
        `This epoch was closed out at block ${inputs.epochClosed.at.value} for MetricSpec ` +
        `version ${specVersion}, and a close is terminal: the welfare input has ` +
        'already been derived, so a filing now cannot land behind it and the chain refuses ' +
        'it. A sibling version’s close would say nothing about this one.',
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
