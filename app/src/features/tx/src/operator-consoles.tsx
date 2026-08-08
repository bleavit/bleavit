/**
 * S14, S16, S17, S18 and S19 — the operator consoles rendered over their models. F17.
 *
 * Every refusal, every classification and every piece of required copy was decided in
 * `reporter.ts`, `treasury.ts` and `registry-crank.ts`. What a *rendering* can still get
 * wrong is narrower, and it is the same four mistakes each time.
 *
 * ## 0. A submit control must be the gate's, not the screen's
 *
 * 11 §11.4 rule 1 wants `refreshAndGate` on every submit path **structurally**, and §11.8's
 * opening sentence binds these workflows to §11.4. Every console here used to take an
 * `onX: () => void` and enable it on its own model result — correct checks, computed from
 * whatever the screen was handed, with no refresh and no gate. So each console now takes a
 * `TxSession` and an `onSubmit` that **requires a `GatePassed`**, and derives its control
 * through `operatorGate`. A screen cannot mint that proof and cannot obtain one outside
 * `AwaitingSignature`, so the bypass is closed by the signature rather than by review.
 *
 * ## 1. A caveat the model returns must reach the screen
 *
 * The reporter console's whole point is that its precondition check is **incomplete** — two
 * conditions the contract does not let a client read. `RegistrationCheck.uncheckable` is a
 * required field so no screen can present a complete verdict, but a screen can still render
 * the field and not the caveat. So `RegisterReporter` renders the caveat **on the clean
 * path**, which is the only path where it matters: a blocked form already says why. Its
 * `stakeHold` consequence renders there too, and for the sharper version of the same
 * reason: a consequence is for the reader nothing is blocking.
 *
 * ## 2. A no-op must not look like an action
 *
 * §11.5's *"never sign a guaranteed no-op without an explicit expert override"*. The
 * snapshot crank's button is disabled with the model's own copy, and the copy states the
 * fee — because a button that looks identical either way is exactly what makes the rule
 * necessary.
 *
 * ## 3. A classification must not be re-derived into a number
 *
 * `insuranceStanding` returns "at target" / "below by X" / "above, awaiting overflow"
 * precisely so a component cannot plot a balance as a trend. The screen renders the
 * classification and its copy, and never the raw balance beside them — a figure and an
 * explanation that a reader can compare invites them to trust the figure.
 */

import {
  Amount,
  Button,
  Count,
  DataTable,
  Datum,
  Derived,
  Field,
  Identifier,
  Notice,
  Panel,
  Ratio,
  Refusal,
  formatBaseUnits,
  formatCount,
  type ReactNode,
} from '@bleavit/ui';
import type { Combined, Verified } from '@bleavit/shared-types';
import type { GatePassed, TxSession } from '@bleavit/transaction-builder';
import { operatorGate, type OperatorBlock } from './operator-gate.js';
import { GateControl } from './gate-control.js';
import { evidenceCopy, type EvidenceState } from './evidence.js';
import {
  CONSERVATIVE_ZERO_HOLDINGS,
  PARTIAL_CUSTODY_NOTE,
  accountLines,
  floorDistances,
  incomeLabel,
  navPresentation,
  windowedTotal,
  type NavView,
  type WindowedIncome,
} from './nav.js';
import {
  checkRegistration,
  maySubmitRecompute,
  registrationCaveat,
  type RecomputeSubmission,
  type RegistrationInputs,
} from './reporter.js';
import {
  challengeBlocks,
  escalationConsequence,
  reportBlocks,
  type ChallengeInputs,
  type ReportInputs,
} from './oracle-reporting.js';
import {
  CLAIMABLE_IS_A_LOWER_BOUND,
  STREAM_CLAIMS_NOT_WIRED,
  claimBlocks,
  claimableNow,
  insuranceCopy,
  type ClaimContext,
  type InsuranceStanding,
  type Stream,
} from './treasury.js';
import {
  feeHeadroomBlock,
  isApplicable,
  leadTimeCountdown,
  progressLine,
  submissionOutlook,
  upgradeFeeHeadroom,
  type AuthorizedUpgrade,
  type FetchProgress,
  type UpgradeFeeInputs,
  type UpgradeSubmission,
} from './upgrade-crank.js';
import {
  REGISTRY_HOLDS_SETTLEMENT,
  challengeWindowCopy,
  mayChallenge,
  noOpWarning,
  snapshotCrankState,
  stalenessCopy,
  type ChallengeWindow,
  type SnapshotStaleness,
} from './registry-crank.js';
import {
  FILING_BOND_IS_A_QUOTE,
  challengeFilingBlocks,
  filingBlocks,
  type ChallengeFilingInputs,
  type FilingInputs,
} from './registry-filing.js';

// --------------------------------------------------------------- S14 reporter

export function RegisterReporter({
  inputs,
  decimals,
  symbol,
  session,
  onRegister,
}: {
  readonly inputs: RegistrationInputs;
  readonly decimals: number;
  readonly symbol: string;
  readonly session: TxSession;
  readonly onRegister: (window: GatePassed) => void;
}): ReactNode {
  const check = checkRegistration(inputs);
  const gate = operatorGate('oracle.register_reporter', session, check.blocks);
  return (
    <Panel title="Register as a reporter">
      <Field label="Reporter stake">
        <Amount datum={inputs.reporterStake} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>

      {/* §11.8.1 row 1's last clause: *"stake-hold consequence displayed"*. It renders
          **unconditionally**, and that is the repair rather than a preference — it used to
          live inside the short-balance `RegistrationBlock`, which fires only when the stake
          cannot be afforded, so the one reader who needs it (an account that *can* afford
          the stake and is about to commit it) was the only one who never saw it. A
          consequence is not a failure message. */}
      <Notice severity="caution" heading="What registering does to these funds">
        {check.stakeHold}
      </Notice>

      {/* The two conditions the contract does not expose, always listed — never only when
          something else is wrong. `uncheckable` is a required field for exactly this reason;
          rendering it only on the blocked path would restore the green "ready to sign" the
          model exists to prevent. */}
      <Notice severity="caution" heading="Two conditions this client cannot check">
        <ul>
          {check.uncheckable.map((condition) => (
            <li key={condition.dispatchError}>
              <strong>{condition.dispatchError}</strong> — {condition.condition}.{' '}
              {condition.why}
            </li>
          ))}
        </ul>
        {check.blocks.length === 0 ? registrationCaveat(check) : null}
      </Notice>

      <GateControl label="Register" intent="primary" gate={gate} onSubmit={onRegister} />
    </Panel>
  );
}

/**
 * `oracle.report` — P-13, and the screen contract v29 opened.
 *
 * The bond is the chain's own figure (`api.bond_quote`), rendered as the amount rather than
 * as a floor. Everything about that is a read: this screen performs no bond arithmetic, and
 * neither does the module behind it.
 *
 * The disclosure renders **unconditionally**, like `RegisterReporter`'s caveat and for the
 * same reason. It no longer says *"we cannot tell you the amount"* — it says the amount is a
 * quote priced at a block and fixes at submission, which 02 §3 requires. Showing it only on
 * the blocked path would restore exactly the green "ready to sign" the model exists to
 * prevent, and here the qualified figure is money the reporter is about to commit.
 */
export function SubmitReport({
  inputs,
  decimals,
  symbol,
  evidence,
  session,
  onReport,
}: {
  readonly inputs: ReportInputs;
  readonly decimals: number;
  readonly symbol: string;
  /**
   * The round's evidence, under §11.8.1's rules. **Required**, and a state rather than an
   * optional string: this is the console §11.8.1's evidence paragraph is written for, and
   * an optional field lets a screen render nothing — which reads as *no evidence was filed*
   * when the fact may be *this device could not fetch it*. 07 adjudicates on the first.
   */
  readonly evidence: EvidenceState;
  readonly session: TxSession;
  readonly onReport: (window: GatePassed) => void;
}): ReactNode {
  const check = reportBlocks(inputs);
  const gate = operatorGate('oracle.report', session, check.blocks);
  return (
    <Panel title="Report a component value">
      {/* The amount, when the chain quoted one. The non-`quoted` arms are blocks rather
          than a rendered fallback: a floor in this slot understates what is committed. */}
      {inputs.bondQuote.kind === 'quoted' ? (
        <>
          <Field label="Round bond">
            <Amount datum={inputs.bondQuote.quote.bond} decimals={decimals} symbol={symbol} />
          </Field>
          <Field label="Priced at block">
            <Count datum={inputs.bondQuote.quote.readAt} />
          </Field>
          {/* 02 §4 ships the exposure as disclosure beside the amount, never as an input a
              client multiplies. It is rendered so a reporter can see what the bond scales
              with, and it is labelled as the exposure rather than as a second price. */}
          <Field label="Cohort escrow this bond is scaled against">
            <Amount datum={inputs.bondQuote.quote.exposure} decimals={decimals} symbol={symbol} />
          </Field>
        </>
      ) : null}
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>

      {/* §11.8.1's dispute-evidence display, on the console that files it. It was specified
          for this screen and rendered on none — the panel existed and no operator surface
          mounted it, so an unretrievable evidence document was silently omitted rather than
          stated, which is exactly what E22 forbids. */}
      <EvidencePanel state={evidence} label="Evidence for this round" />

      {/* Always, never only on the blocked path — see the component note. */}
      <Notice severity="caution" heading="This bond is a quote, priced now">
        {check.bondDisclosure}
      </Notice>

      <GateControl label="Post the report" intent="primary" gate={gate} onSubmit={onReport} />
    </Panel>
  );
}

/**
 * `oracle.challenge` — P-14, plus 07 §5.2's rule that a reporter may not challenge their own
 * round.
 *
 * Two renderings carry the module's discipline onto the screen. The bond is the **round's
 * own** datum, badged with the provenance of the read it came from, so nothing here can look
 * like a figure this client worked out; and the escalation consequence is shown **before**
 * the control, because what a challenger risks is the thing that decides whether to start.
 */
export function ChallengeRound({
  inputs,
  decimals,
  symbol,
  evidence,
  session,
  onChallenge,
}: {
  readonly inputs: ChallengeInputs;
  readonly decimals: number;
  readonly symbol: string;
  /** The reported round's evidence — §11.8.1's rules, on the screen that disputes it. */
  readonly evidence: EvidenceState;
  readonly session: TxSession;
  readonly onChallenge: (window: GatePassed) => void;
}): ReactNode {
  const blocks = challengeBlocks(inputs);
  const gate = operatorGate('oracle.challenge', session, blocks);
  return (
    <Panel title="Challenge this round" subject={<Count datum={inputs.round.round} />}>
      <Field label="Reporter">
        <Identifier datum={inputs.round.reporter} />
      </Field>
      {/* Read, never doubled — the chain's own amount for this round (07 §6.1 freezes it). */}
      <Field label="Bond to post">
        <Amount datum={inputs.round.bond} decimals={decimals} symbol={symbol} />
      </Field>
      {/* The stored deadline, extension included. No `orc.window` arithmetic exists here. */}
      <Field label="Challenge window closes at">
        <Count datum={inputs.round.challengeDeadline} />
      </Field>
      <Field label="Watchtower acknowledgements">
        <Count datum={inputs.round.ackedByWatchtowers} />
      </Field>

      {/* What the reporter filed, re-hashed before rendering. A challenger deciding whether
          to stake a doubling bond needs the evidence, and E22 requires an unretrievable one
          named as such rather than left blank. */}
      <EvidencePanel state={evidence} label="Evidence the reporter filed" />

      {/* Fixed copy, and it takes no argument — see `escalationConsequence`. The round number
          it used to interpolate is the panel's own badged `subject` above. */}
      <Notice severity="caution" heading="What a challenge risks">
        {escalationConsequence()}
      </Notice>

      <GateControl label="Challenge" intent="danger" gate={gate} onSubmit={onChallenge} />
    </Panel>
  );
}

/**
 * `oracle.recompute_proof` — §11.8.1's third row.
 *
 * The screen takes a `RecomputeSubmission`, which requires a branded `RecomputedProof`, which
 * only `recomputeProof` mints and only on agreement. So there is **no arm of this component
 * in which the client's own recomputation contradicts the reported value** — the spec's
 * *"never submit a proof the client's own recomputation contradicts"* is a property of the
 * type rather than a check this component performs and could omit. Same construction as
 * `UpgradeCrank`, and for the same reason: both are signatures whose entire justification is
 * a check that happened first.
 *
 * The value renders as plain text and is labelled as a **local** recomputation, not as a
 * chain read. Badging it would claim a provenance it does not have; it is what this device
 * computed, and the only reason it is also the committed value is that a disagreement could
 * not have reached this screen.
 */
export function RecomputeProof({
  submission,
  session,
  onSubmit,
}: {
  readonly submission: RecomputeSubmission;
  readonly session: TxSession;
  readonly onSubmit: (window: GatePassed) => void;
}): ReactNode {
  const open = maySubmitRecompute(submission);
  const gate = operatorGate(
    'oracle.recompute_proof',
    session,
    open
      ? []
      : [
          {
            check: 'Round open',
            detail:
              'The round is no longer open, so a recomputation proof would not resolve it.',
          },
        ],
  );
  return (
    <Panel title="Submit a recomputation proof">
      <Field label="Component">{formatCount(submission.proof.component)}</Field>
      <Field label="Measurement epoch">{formatCount(submission.proof.epoch)}</Field>
      <Field label="Frozen MetricSpec version">
        {formatCount(submission.proof.specVersion)}
      </Field>
      <Field label="Value this device recomputed (1e9 grid)">
        {formatCount(submission.proof.value1e9)}
      </Field>

      <Notice severity="info" heading="This proof reproduces the committed value">
        The raw data committed for this round was evaluated on this device and produced the
        value above. A recomputation that disagreed would not have reached this screen — it
        cannot be assembled into a submission at all, because a submission requires a proof
        this client reproduced.
      </Notice>

      <GateControl label="Submit the proof" intent="primary" gate={gate} onSubmit={onSubmit} />
    </Panel>
  );
}

/**
 * The two states in which no proof exists to submit.
 *
 * They are **separate refusals** because the operator's next step differs, and because
 * collapsing them would be a false accusation in one direction: a non-deterministic component
 * is not a reporter behaving badly, it is a component nobody promised would reproduce.
 */
export function ProofRefused({
  reason,
}: {
  readonly reason:
    | { readonly kind: 'mismatch'; readonly claimed: bigint; readonly recomputed: bigint }
    | { readonly kind: 'non-deterministic'; readonly component: number };
}): ReactNode {
  if (reason.kind === 'non-deterministic') {
    return (
      <Refusal
        code="FE-ORC-002"
        message={`Component ${formatCount(reason.component)} cannot be recomputed deterministically.`}
        detail="Its frozen MetricSpec does not permit deterministic recomputation, so this device cannot reproduce the reported value."
        recovery="This round resolves by counter-report and counter-challenge, or by adjudication — not by a recomputation proof. Nothing here indicates the reported value is wrong."
      />
    );
  }
  return (
    <Refusal
      code="FE-ORC-001"
      message="This device's recomputation does not match the reported value."
      detail={`Reported: ${formatCount(reason.claimed)} — recomputed here: ${formatCount(reason.recomputed)} (1e9 grid).`}
      recovery="No proof is submitted. A proof asserting the reported value would stake your bond on a number your own recomputation has already contradicted; if you believe the reported value is wrong, the action is a challenge, not a proof."
    />
  );
}

// --------------------------------------------------------------- S16 treasury

/**
 * The stream list — S16's table, with each claim control **inside its own row**.
 *
 * ## Three defects lived in the space between the table and the buttons
 *
 * The buttons used to be a second loop under the table: one identically-labelled "Claim"
 * per claimable stream, in a column of their own with no row beside them.
 *
 * 1. **Nothing named which stream a button acted on.** Every one read `Claim`, and the only
 *    thing distinguishing them was position in a list that is not the table's list — the
 *    button loop skipped blocked streams, so the *n*th button was not the *n*th row. A user
 *    clicking the second button was claiming from whichever stream happened to be second
 *    after the skips.
 * 2. **`describedBy` pointed at nothing.** It named `stream-<id>`, and no element in this
 *    component ever carried that id. An `aria-describedby` to a missing node is not a
 *    degraded label; assistive technology reads the button as *"Claim"* and nothing else,
 *    so the control that was meant to carry the subject silently carried none.
 * 3. **A blocked stream rendered no control at all**, which reads as *this stream has no
 *    claim action* rather than *you cannot claim from it, because …*. `Button` refuses a
 *    disabled control with no reason precisely so that absence is not the answer.
 *
 * The repair is one loop: the control is a cell, the row's identifier cell carries the id
 * the control references, and a blocked stream renders the control **disabled with its
 * reasons**. The claim flow itself is the gated `ClaimStream` panel — this table's button
 * selects a stream, it does not submit anything, which is why it takes a plain handler.
 */
export function TreasuryStreams({
  streams,
  now,
  decimals,
  symbol,
  callerIsRecipient,
  streamClaimsWired,
  onSelect,
}: {
  readonly streams: readonly Stream[];
  readonly now: Verified<number>;
  readonly decimals: number;
  readonly symbol: string;
  readonly callerIsRecipient: (stream: Stream) => boolean;
  /** `NavView.streamClaimsWired` — required, so the table cannot assume a payout leg. */
  readonly streamClaimsWired: Verified<boolean>;
  /** Opens `ClaimStream` for this stream. Selection, not submission — no gate is involved. */
  readonly onSelect: (streamId: string) => void;
}): ReactNode {
  return (
    <Panel title="Treasury streams">
      <DataTable
        caption="Streams paying out to accounts, with what each has released so far"
        // No recipient column: `treasury_streams(who)` is a **per-caller** projection
        // (02 §3), so every row here is already the caller's. A column repeating the
        // signer's own address would read as a fact about the stream rather than about
        // the query, and the client holds no recipient field to fill it from.
        headers={['Stream', 'Total', 'Claimed', 'Claimable now', 'Claim']}
        rows={streams.map((stream) => {
          const claimable = claimableNow(stream, now);
          const blocks = claimBlocks({
            stream,
            now,
            streamClaimsWired,
            callerIsRecipient: callerIsRecipient(stream),
          });
          const labelId = `stream-${stream.id.value}`;
          return {
            key: stream.id.value,
            cells: [
              // The id the row's control references. It lives on the identifier rather than
              // on the cell so the accessible description is the badged stream id itself.
              <span id={labelId} key={`id-${stream.id.value}`}>
                <Identifier datum={stream.id} />
              </span>,
              <Amount
                datum={stream.total}
                decimals={decimals}
                symbol={symbol}
                key={`t-${stream.id.value}`}
              />,
              <Amount
                datum={stream.claimed}
                decimals={decimals}
                symbol={symbol}
                key={`c-${stream.id.value}`}
              />,
              // The reason travels with the zero: "not started" and "nothing left" are
              // different states, and a bare 0 for both tells a recipient the wrong next
              // step. The amount is the chain's `claimable_now`, and the classification
              // combines it with four other reads — so it renders through `Derived` and is
              // withheld rather than fabricated when they do not agree on a block.
              <Derived
                key={`n-${stream.id.value}`}
                combined={claimable}
                render={(value) =>
                  value.reason === 'claimable'
                    ? `${formatBaseUnits(value.amount, decimals)} ${symbol}`
                    : value.reason
                }
              />,
              <Button
                key={`claim-${stream.id.value}`}
                label="Claim"
                intent="primary"
                describedBy={labelId}
                onClick={() => onSelect(stream.id.value)}
                disabled={blocks.length > 0}
                {...(blocks.length > 0
                  ? { disabledReason: blocks.map((block) => block.check).join('; ') }
                  : {})}
              />,
            ],
          };
        })}
      />
    </Panel>
  );
}

export function ClaimStream({
  context,
  decimals,
  symbol,
  session,
  onClaim,
}: {
  readonly context: ClaimContext;
  readonly decimals: number;
  readonly symbol: string;
  readonly session: TxSession;
  readonly onClaim: (window: GatePassed) => void;
}): ReactNode {
  const blocks = claimBlocks(context);
  const claimable = claimableNow(context.stream, context.now);
  const gate = operatorGate('futarchy_treasury.claim_stream', session, blocks);
  // Read once, outside JSX. The badged field below carries the provenance; this local
  // only decides whether the standing caution appears.
  const claimsWired = context.streamClaimsWired.value;
  return (
    <Panel title="Claim from a stream" subject={<Identifier datum={context.stream.id} />}>
      <Field label="Claimable now">
        <Derived
          combined={claimable}
          render={(value) => `${formatBaseUnits(value.amount, decimals)} ${symbol}`}
        />
      </Field>
      {/* 02 §4's monotonicity, stated on the screen that acts on the figure: a claim
          included later pays at least this, never less. Unconditional, because a reader
          who assumes the number is exact reports a discrepancy that is not one. */}
      <Notice severity="info" heading="This is what the chain would pay now">
        {CLAIMABLE_IS_A_LOWER_BOUND}
      </Notice>
      {/* The runtime-level refusal, rendered as its own notice rather than only as a
          gate block: it is a standing property of the deployment, not something about
          this claim, and a recipient reading a disabled button needs to know their
          entitlement is intact.

          The state is ALSO stated as its own badged field rather than only as a
          conditional notice. `streamClaimsWired` is a chain read like any other, so
          INV-FE-9 applies even though what it drives is a notice rather than a number:
          "this runtime cannot pay" is a claim about the chain, and a reader is owed the
          same provenance for it as for the amount above. `check:render-provenance`
          caught the unwrapped form, and it was right — this is the second time today the
          gate has caught this exact shape. */}
      <Field label="Claim leg">
        <Datum
          datum={context.streamClaimsWired}
          render={(wired) => (wired ? 'wired' : 'not wired on this runtime')}
        />
      </Field>
      {claimsWired ? null : (
        <Notice severity="caution" heading="This runtime cannot pay claims yet">
          {STREAM_CLAIMS_NOT_WIRED}
        </Notice>
      )}
      <GateControl label="Claim" intent="primary" gate={gate} onSubmit={onClaim} />
    </Panel>
  );
}

/**
 * `INSURANCE` — its standing, and the honest statement when there is none.
 *
 * The panel took two `Verified<bigint>`s and classified one against the other, and the
 * second one had no producer: 08 §1.2's `T_ins` was a treasury-internal counter that no
 * frozen surface published, so the only thing a caller could have passed was a figure it
 * made up. A classification against a made-up target is worse than no classification,
 * because the screen's whole job here is to stop the balance reading as income and it does
 * that by telling the reader where the balance *should* be.
 *
 * **Contract v29 publishes it** as a trailing `NavView.insurance_target` (02 §4, SQ-602), so
 * the target is now an ordinary `nav()` read. The panel still takes a
 * `Combined<InsuranceStanding>` whose value may be `unestablished` and still renders that
 * refusal through `Derived`, because a `nav()` that did not answer must not fall back to a
 * comparison against zero — which renders as *this reserve is exactly sized* at the moment
 * it holds nothing. The client says it cannot size the reserve, and still says the one thing
 * it knows for certain, that this is not income either way.
 */
export function InsurancePanel({
  standing,
}: {
  readonly standing: Combined<InsuranceStanding>;
}): ReactNode {
  return (
    <Panel title="INSURANCE">
      {/* The classification and its copy — deliberately without the raw balance beside them.
          E1 made this normative: a rising INSURANCE balance is not protocol income, and a
          number a reader can watch move is an invitation to read it as one. */}
      <Field label="Standing">
        <Derived combined={standing} render={(value) => value.kind} />
      </Field>
      <Notice severity="info" heading="What this balance means">
        <Derived combined={standing} render={insuranceCopy} />
      </Notice>
    </Panel>
  );
}

// -------------------------------------------------- S18 welfare snapshot crank

export function SnapshotCrank({
  epoch,
  specVersion,
  boundaryPassed,
  takenAtThisVersion,
  staleness,
  session,
  onCrank,
}: {
  readonly epoch: Verified<number>;
  /**
   * The MetricSpec version this snapshot would record under.
   *
   * `Welfare.Snapshots` is keyed `(epoch, spec_version)` and the call is
   * `record_snapshot(epoch, spec_version)`, so a screen that showed only the epoch could
   * not tell an operator *which* record is missing — and the no-op copy would be about a
   * different pair from the one the transaction writes.
   */
  readonly specVersion: Verified<number>;
  readonly boundaryPassed: boolean;
  /** Keyed on the **pair**, never on the epoch alone — see `snapshotCrankState`. */
  readonly takenAtThisVersion: boolean;
  /** From `snapshotStaleness`, with both thresholds read from chain params. */
  readonly staleness: Combined<SnapshotStaleness>;
  readonly session: TxSession;
  readonly onCrank: (window: GatePassed) => void;
}): ReactNode {
  const state = snapshotCrankState(epoch, specVersion, boundaryPassed, takenAtThisVersion);
  const warning = noOpWarning(state);
  const gate = operatorGate(
    'welfare.record_snapshot',
    session,
    warning === undefined ? [] : [{ check: 'Nothing to crank', detail: warning }],
  );
  const engaged = staleness.kind === 'stated' && staleness.datum.value.kind === 'dead-man-engaged';
  return (
    <Panel title="Welfare snapshot">
      {/* §11.8.5: staleness "shown prominently", and above the crank rather than beside it —
          past its threshold an overdue snapshot is not a housekeeping item, it engages the
          dead-man rule, and the severity says which of the two a reader is looking at. */}
      <Notice
        severity={engaged ? 'danger' : 'info'}
        heading={engaged ? 'The dead-man rule is engaged' : 'Snapshot staleness'}
      >
        <Derived
          combined={staleness}
          render={(value) => `${stalenessCopy(value)} (${value.blocksSince} blocks since)`}
        />
      </Notice>

      <Field label="Epoch">
        <Count datum={state.epoch} />
      </Field>
      {/* The version is on screen because the refusal is about the pair. Without it, "a
          snapshot already exists" cannot be told apart from the defect where a lawful record
          at a *second* admissible version was refused because some other version had one. */}
      <Field label="MetricSpec version">
        <Count datum={state.specVersion} />
      </Field>
      {warning === undefined ? null : (
        // §11.5: never sign a guaranteed no-op. The copy states the fee, because the button
        // looks identical either way and that is precisely why the rule exists.
        <Notice severity="caution" heading="This would do nothing">
          {warning}
        </Notice>
      )}
      <GateControl label="Take the snapshot" intent="primary" gate={gate} onSubmit={onCrank} />
    </Panel>
  );
}

// --------------------------------------------------------------- S19 registry

/**
 * S19's **filing** half — the screen §11.8.6's first row describes and that had none.
 *
 * `filingBlocks` existed and nothing rendered it, so the console offered the challenge flow
 * and not the flow that creates the thing being challenged. The two are separate screens
 * because they are separate calls with separate bonds and opposite postures: filing makes a
 * claim, challenging disputes one.
 *
 * The kind is a **release-defined choice** — which form the operator opened — so it renders
 * as the panel's title rather than as a badged datum. Everything else here is a read.
 */
export function RegistryFilingForm({
  inputs,
  decimals,
  symbol,
  evidence,
  session,
  onFile,
}: {
  readonly inputs: FilingInputs;
  readonly decimals: number;
  readonly symbol: string;
  /** The evidence this filing commits to, under §11.8.1's rules (§11.8.6 applies them). */
  readonly evidence: EvidenceState;
  readonly session: TxSession;
  readonly onFile: (window: GatePassed) => void;
}): ReactNode {
  const blocks = filingBlocks(inputs);
  const gate = operatorGate('registry.file', session, blocks);
  return (
    <Panel title={inputs.kind === 'incident' ? 'File an incident' : 'File a milestone'}>
      {/* Unconditional, exactly as on the challenge panel: a filer needs to know what their
          claim can and cannot hold before they post a bond behind it. */}
      <Notice severity="info" heading="What a filing holds">
        {REGISTRY_HOLDS_SETTLEMENT}
      </Notice>

      {/* The chain's own figure, and nothing rendered when it did not answer: 07 §7's
          not-determinable exposure is a block, not a slot to fill with a floor. */}
      {inputs.filingBond.kind === 'quoted' ? (
        <>
          <Field label="Filing bond">
            <Amount datum={inputs.filingBond.quote.bond} decimals={decimals} symbol={symbol} />
          </Field>
          <Field label="Priced at block">
            <Count datum={inputs.filingBond.quote.readAt} />
          </Field>
          <Field label="Cohort escrow this bond is scaled against">
            <Amount datum={inputs.filingBond.quote.exposure} decimals={decimals} symbol={symbol} />
          </Field>
        </>
      ) : null}
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>
      {/* `file`'s second and fifth arguments, rendered as plain text because both are form
          values rather than chain reads — the same reason the panel title is not badged. They
          are here because a value the model carries and no screen shows is the shape this
          client keeps finding (V-169): the class decides what the claim *is*, and the version
          decides what it is scored against. The admissible class set is the instance's own —
          `validate_class` — and the union makes the other instance's set unbuildable. */}
      <Field label="Class">
        <span>{inputs.kind === 'incident' ? inputs.class : `Scope ${inputs.class.scope}`}</span>
      </Field>
      <Field label="MetricSpec version this filing names">
        <span>{String(inputs.specVersion)}</span>
      </Field>
      <Field label="Filings this epoch">
        <Count datum={inputs.filingsUsed} />
        <Count datum={inputs.filingsBound} name="of" />
      </Field>

      <EvidencePanel state={evidence} label="Evidence this filing commits to" />

      {/* The same disclosure P-13 states, because it is the same method and the same
          freezing rule: 07 §7 fixes `F(kind, m)` when the filing is created. */}
      <Notice severity="caution" heading="This bond is a quote, priced now">
        {FILING_BOND_IS_A_QUOTE}
      </Notice>

      <GateControl label="File" intent="primary" gate={gate} onSubmit={onFile} />
    </Panel>
  );
}

export function RegistryFiling({
  filingId,
  window,
  inputs,
  decimals,
  symbol,
  evidence,
  session,
  onChallenge,
}: {
  readonly filingId: Verified<string>;
  readonly window: ChallengeWindow;
  /**
   * The challenge's own preconditions. **Required**: §11.8.6's row names a challenge bond
   * balance, and the panel tested only the window — so it offered a challenge to an account
   * that cannot post the bond, on the one screen where the user has a deadline and one
   * attempt inside it.
   */
  readonly inputs: Omit<ChallengeFilingInputs, 'windowOpen' | 'windowReason'>;
  readonly decimals: number;
  readonly symbol: string;
  /** The filing's evidence — §11.8.6 applies §11.8.1's rules to its display. */
  readonly evidence: EvidenceState;
  readonly session: TxSession;
  readonly onChallenge: (window: GatePassed) => void;
}): ReactNode {
  const blocks = challengeFilingBlocks({
    ...inputs,
    windowOpen: mayChallenge(window),
    windowReason: challengeWindowCopy(window),
  });
  const gate = operatorGate('registry.challenge', session, blocks);
  return (
    <Panel title="Registry filing" subject={<Identifier datum={filingId} />}>
      {/* §11.8.6's required statement, and it renders unconditionally: the natural reading
          of "a challenge is open" is that governance is paused, and it is not. */}
      <Notice severity="info" heading="What a challenge holds">
        {REGISTRY_HOLDS_SETTLEMENT}
      </Notice>

      <Field label="Challenge window">{challengeWindowCopy(window)}</Field>
      {window.kind === 'open' ? (
        <Field label="Closes at">
          <Count datum={window.closesAt} />
        </Field>
      ) : null}

      <Field label="Challenge bond">
        <Amount datum={inputs.challengeBond} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>

      <EvidencePanel state={evidence} label="Evidence filed with this claim" />

      <GateControl label="Challenge this filing" intent="danger" gate={gate} onSubmit={onChallenge} />
    </Panel>
  );
}

// ---------------------------------------------------------- S17 upgrade crank

/**
 * The most consequential signature this client can produce.
 *
 * The safety property is already structural: `UpgradeSubmission` requires a
 * `VerifiedArtifact`, which only `verifyArtifact` mints, so bytes that were never hashed
 * cannot be assembled into a submission. This screen therefore owns only what a rendering
 * can still get wrong, and both halves are about **not overstating**:
 *
 * - the FE-P10 outlook is shown **before** the submit control, not after it, because it is
 *   the thing a user needs in order to decide whether to start at all; and
 * - a **mismatch** renders as a refusal with the two hashes, never as a retry prompt. There
 *   is nothing to retry: the bytes are not the authorized runtime, and offering "try again"
 *   suggests the failure was transport rather than identity.
 */
export function UpgradeCrank({
  submission,
  authorized,
  now,
  progress,
  fee,
  decimals,
  symbol,
  session,
  onSubmit,
}: {
  /** Undefined until bytes have been fetched and verified — there is no unverified arm. */
  readonly submission: UpgradeSubmission | undefined;
  readonly authorized: AuthorizedUpgrade;
  readonly now: Verified<number>;
  /** E19's *"artifact fetch progress"*. Undefined before a fetch has started. */
  readonly progress?: FetchProgress | undefined;
  /** §11.8.4 step 4's fee headroom — required, because this is the largest fee here. */
  readonly fee: UpgradeFeeInputs;
  /**
   * Decimals and symbol of the **selected fee asset**, supplied per `fee.asset`.
   *
   * Not derived here: VIT and USDC do not share a scale, so a component that assumed one
   * would print a shortfall a millionfold wrong for the other — on the figure that decides
   * whether an operator tops up before starting a multi-megabyte download.
   */
  readonly decimals: number;
  readonly symbol: string;
  readonly session: TxSession;
  readonly onSubmit: (window: GatePassed) => void;
}): ReactNode {
  const applicable = isApplicable(authorized, now);
  const headroom = upgradeFeeHeadroom(fee);
  const blocks: OperatorBlock[] = [];
  if (submission === undefined) {
    blocks.push({
      check: 'Artifact',
      detail: 'No artifact has been verified against the authorized hash yet.',
    });
  }
  if (!applicable) {
    blocks.push({
      check: 'Applicable at',
      detail:
        'The stored applicable_at block has not been reached. This is the chain’s own ' +
        'field, not a countdown this client computed.',
    });
  }
  const feeBlock = feeHeadroomBlock(headroom);
  if (feeBlock !== undefined) blocks.push(feeBlock);
  const gate = operatorGate('system.apply_authorized_upgrade', session, blocks);
  return (
    <Panel title="Runtime upgrade">
      <Field label="Authorized code hash">
        <Identifier datum={authorized.codeHash} />
      </Field>
      {/* Read, never recomputed from `authorized_at + DescriptorLeadTime` — SQ-552. The
          screen shows the stored field for the same reason the model requires it. */}
      <Field label="Applicable at">
        <Count datum={authorized.applicableAt} />
      </Field>
      {/* E19's DescriptorLeadTime countdown. Arithmetic over the **stored** field and the
          current block — never a derivation of `applicable_at` itself, which is what SQ-552
          forbids. It renders through `Derived` because two reads at different blocks
          describe no single deadline. */}
      <Field label="Blocks until applicable">
        <Derived
          combined={leadTimeCountdown(authorized, now)}
          render={(blocksLeft) =>
            blocksLeft > 0 ? String(blocksLeft) : `reached, ${-blocksLeft} blocks ago`
          }
        />
      </Field>
      {/* Fee headroom, displayed — §11.8.4 step 4 asks for it explicitly and says why: the
          extrinsic is large. It is a figure derived from two reads, so it is withheld rather
          than fabricated when they disagree on a block. */}
      <Field label="Fee headroom">
        <Derived
          combined={headroom}
          render={(value) =>
            value.covered
              ? 'covered'
              : `short by ${formatBaseUnits(value.shortfall, decimals)} ${symbol}`
          }
        />
      </Field>

      {progress === undefined ? null : (
        <Notice severity="info" heading="Fetching the artifact">
          {progressLine(progress)}
        </Notice>
      )}

      {submission === undefined ? (
        <Notice severity="info" heading="No artifact has been verified yet">
          The runtime bytes are hashed on this device as they arrive and compared against the
          authorized hash above before anything is offered for signing. Until that check
          passes there is nothing to submit.
        </Notice>
      ) : (
        // Before the control, not after: this is what decides whether to start.
        <Notice severity="caution" heading="What submitting this needs">
          {submissionOutlook(submission.artifact)}
        </Notice>
      )}

      <GateControl label="Submit the upgrade" intent="danger" gate={gate} onSubmit={onSubmit} />
    </Panel>
  );
}

/**
 * `FE-UPG-001` — the bytes are not the authorized runtime.
 *
 * A refusal, never a retry: re-downloading cannot make different bytes into the authorized
 * ones, and a "try again" control would suggest the failure was transport. Both hashes are
 * shown, because the operator's next step is to find out which artifact they actually have.
 */
export function UpgradeHashMismatch({
  expected,
  computed,
}: {
  readonly expected: string;
  readonly computed: string;
}): ReactNode {
  return (
    <Refusal
      code="FE-UPG-001"
      message="These bytes are not the runtime the chain authorized."
      detail={`Authorized: ${expected} — computed from the downloaded bytes: ${computed}.`}
      recovery="Obtain the artifact whose hash matches the authorized one. Re-downloading the same file will not change this result, and these bytes are never offered to a wallet."
    />
  );
}

/**
 * Content-addressed evidence, rendered under §11.8.1's rules.
 *
 * Text only — `<pre>`, never markup. `check:no-html-sinks` is what actually enforces that
 * across the app; this component simply has nowhere to put HTML even if somebody wanted to.
 *
 * The two failure arms render as a **notice**, not as an empty panel, because "this device
 * could not obtain the evidence" and "no evidence was filed" are different facts and 07
 * adjudicates on the second.
 */
export function EvidencePanel({
  state,
  label,
}: {
  readonly state: EvidenceState;
  readonly label: string;
}): ReactNode {
  const copy = evidenceCopy(state);
  if (state.kind === 'admitted') {
    return (
      <div className="evidence">
        <span className="evidence__label">{label}</span>
        {/* Text, always. The bytes were chosen by whoever filed this. */}
        <pre className="evidence__text">{state.text}</pre>
      </div>
    );
  }
  return (
    <Notice severity="caution" heading={label}>
      {copy}
    </Notice>
  );
}

// ------------------------------------------------- S16b the nav() view (§11.8.3)

/**
 * The treasury NAV screen.
 *
 * Everything load-bearing was decided in `nav.ts`; what this component owns is that the
 * haircut arm's banner is **persistent** — rendered as part of the panel rather than as a
 * dismissible notice — and that the account table carries its partial-view note where a
 * reader meets the numbers, not in a footnote they scroll past.
 */
export function NavPanel({
  nav,
  income,
  decimals,
  symbol,
}: {
  readonly nav: NavView;
  /** Optional: a client with no ingested history window has no income figure to show. */
  readonly income?: WindowedIncome | undefined;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  const presentation = navPresentation(nav);
  return (
    <Panel title="Treasury">
      {presentation.kind === 'haircut' ? (
        <>
          {/* Persistent by construction — a `Notice` takes no dismiss handler. */}
          <Notice severity="danger" heading="Reserve health degraded">
            {presentation.banner}
          </Notice>
          <Field label="Spendable NAV">
            <Amount datum={presentation.headlineSpendable} decimals={decimals} symbol={symbol} />
          </Field>
          <Field label="Gross total">
            <Amount datum={presentation.unbackedTotal} decimals={decimals} symbol={symbol} />
            <span className="nav__caveat">{presentation.unbackedTotalLabel}</span>
          </Field>
        </>
      ) : (
        <>
          <Field label="NAV">
            <Amount datum={presentation.headline} decimals={decimals} symbol={symbol} />
          </Field>
          <Field label="Spendable NAV">
            <Amount datum={presentation.spendable} decimals={decimals} symbol={symbol} />
          </Field>
        </>
      )}

      {/* The note sits with the numbers, not in a footnote: it is what stops the table
          reading as a decomposition, and a reader who misses it draws the wrong conclusion
          from the very rows it qualifies. */}
      <Notice severity="info" heading="These accounts do not sum to the total">
        {PARTIAL_CUSTODY_NOTE}
      </Notice>
      <DataTable
        caption="Treasury accounts published by the chain’s own view — a partial set"
        headers={['Account', 'Balance']}
        rows={accountLines(nav).map((line) => ({
          key: line.account,
          cells: [
            line.account,
            <Amount
              datum={line.balance}
              decimals={decimals}
              symbol={symbol}
              key={`b-${line.account}`}
            />,
          ],
        }))}
      />

      <Field label="Stream remainders">
        <Amount datum={nav.streamRemainders} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Obligations">
        <Amount datum={nav.obligations} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Rolling-meter utilization">
        <Ratio datum={nav.meterUtilizationBps} />
      </Field>

      {/* Contract v29's `insurance_target` (SQ-602). Rendered here rather than only inside
          `InsurancePanel`, because §11.8.3 requires **every** `NavView` field on this
          screen — and it is labelled as the liability the account backs rather than as a
          target it is topped up to, which is the reading §1.2 forbids. */}
      <Field label="INSURANCE target (the liability it backs)">
        <Amount datum={nav.insuranceTarget} decimals={decimals} symbol={symbol} />
      </Field>

      {/* Contract v29. §11.8.3 requires every `NavView` field rendered, and this one is
          the deployment fact behind S16's claim control — a reader of the treasury screen
          is entitled to know the payout leg's state without opening a stream. `Datum`
          with an explicit renderer rather than a bare boolean: "false" on a treasury
          screen reads as an absence, and the two states need words. */}
      <Field label="Stream claims payable">
        <Datum
          datum={nav.streamClaimsWired}
          render={(wired) => (wired ? 'yes' : 'no — the payout leg is not wired')}
        />
      </Field>

      {/* Continuous, never a pass/fail badge: one USDC above a floor and a million above
          render identically under a binary indicator, and the first is about to stop being
          able to fund its class. */}
      <Field label="Class floors (distance from spendable NAV)">
        <Derived
          combined={floorDistances(nav)}
          render={(rows) =>
            rows
              .map(
                (row) =>
                  `${row.klass}: ${row.meetsFloor ? '+' : ''}${formatBaseUnits(row.distance, decimals)} ${symbol}`,
              )
              .join(' · ')
          }
        />
      </Field>

      {CONSERVATIVE_ZERO_HOLDINGS.map((holding) => (
        <Notice severity="info" heading={`${holding.holding}: 0`} key={holding.holding}>
          {holding.why}
        </Notice>
      ))}

      {income === undefined ? null : (
        <Field label="Observed income">
          <Derived
            combined={windowedTotal(income)}
            render={(total) => `${formatBaseUnits(total, decimals)} ${symbol}`}
          />
          <span className="nav__caveat">{incomeLabel(income)}</span>
        </Field>
      )}
    </Panel>
  );
}
