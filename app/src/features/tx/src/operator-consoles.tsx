/**
 * S14, S16, S18 and S19 — the operator consoles rendered over their models. F17.
 *
 * Every refusal, every classification and every piece of required copy was decided in
 * `reporter.ts`, `treasury.ts` and `registry-crank.ts`. What a *rendering* can still get
 * wrong is narrower, and it is the same three mistakes each time.
 *
 * ## 1. A caveat the model returns must reach the screen
 *
 * The reporter console's whole point is that its precondition check is **incomplete** — two
 * conditions the contract does not let a client read. `RegistrationCheck.uncheckable` is a
 * required field so no screen can present a complete verdict, but a screen can still render
 * the field and not the caveat. So `RegisterReporter` renders the caveat **on the clean
 * path**, which is the only path where it matters: a blocked form already says why.
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
  claimBlocks,
  claimableNow,
  insuranceCopy,
  insuranceStanding,
  type ClaimContext,
  type Stream,
} from './treasury.js';
import {
  isApplicable,
  submissionOutlook,
  type AuthorizedUpgrade,
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

// --------------------------------------------------------------- S14 reporter

export function RegisterReporter({
  inputs,
  decimals,
  symbol,
  onRegister,
}: {
  readonly inputs: RegistrationInputs;
  readonly decimals: number;
  readonly symbol: string;
  readonly onRegister: () => void;
}): ReactNode {
  const check = checkRegistration(inputs);
  return (
    <Panel title="Register as a reporter">
      <Field label="Reporter stake">
        <Amount datum={inputs.reporterStake} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>

      {check.blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

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

      <Button
        label="Register"
        intent="primary"
        onClick={onRegister}
        disabled={check.blocks.length > 0}
        {...(check.blocks.length > 0
          ? { disabledReason: check.blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

/**
 * `oracle.report` — P-13, and the one screen in this client that must show a bond it cannot
 * compute.
 *
 * The caveat renders **unconditionally**, like `RegisterReporter`'s. Showing it only when
 * something else blocks would restore exactly the green "ready to sign" the model exists to
 * prevent — and here the unknown is an *amount of money*, which is worse than an unknown
 * eligibility: a reporter who reads the floor as the charge budgets for the wrong number.
 */
export function SubmitReport({
  inputs,
  decimals,
  symbol,
  onReport,
}: {
  readonly inputs: ReportInputs;
  readonly decimals: number;
  readonly symbol: string;
  readonly onReport: () => void;
}): ReactNode {
  const check = reportBlocks(inputs);
  return (
    <Panel title="Report a component value">
      <Field label="Round bond — at least">
        <Amount datum={inputs.bondFloor.floor} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Your free balance">
        <Amount datum={inputs.freeUsdc} decimals={decimals} symbol={symbol} />
      </Field>

      {check.blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      {/* Always, never only on the blocked path — see the component note. */}
      <Notice severity="caution" heading="The bond shown is a floor, not the amount">
        {check.bondUnknown}
      </Notice>

      <Button
        label="Post the report"
        intent="primary"
        onClick={onReport}
        disabled={check.blocks.length > 0}
        {...(check.blocks.length > 0
          ? { disabledReason: check.blocks.map((block) => block.check).join('; ') }
          : {})}
      />
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
  onChallenge,
}: {
  readonly inputs: ChallengeInputs;
  readonly decimals: number;
  readonly symbol: string;
  readonly onChallenge: () => void;
}): ReactNode {
  const blocks = challengeBlocks(inputs);
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

      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      {/* Fixed copy, and it takes no argument — see `escalationConsequence`. The round number
          it used to interpolate is the panel's own badged `subject` above. */}
      <Notice severity="caution" heading="What a challenge risks">
        {escalationConsequence()}
      </Notice>

      <Button
        label="Challenge"
        intent="danger"
        onClick={onChallenge}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
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
  onSubmit,
}: {
  readonly submission: RecomputeSubmission;
  readonly onSubmit: () => void;
}): ReactNode {
  const open = maySubmitRecompute(submission);
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

      <Button
        label="Submit the proof"
        intent="primary"
        onClick={onSubmit}
        disabled={!open}
        {...(open
          ? {}
          : {
              disabledReason:
                'The round is no longer open, so a recomputation proof would not resolve it.',
            })}
      />
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

export function TreasuryStreams({
  streams,
  now,
  decimals,
  symbol,
  callerIsRecipient,
  onClaim,
}: {
  readonly streams: readonly Stream[];
  readonly now: Verified<number>;
  readonly decimals: number;
  readonly symbol: string;
  readonly callerIsRecipient: (stream: Stream) => boolean;
  readonly onClaim: (streamId: string) => void;
}): ReactNode {
  return (
    <Panel title="Treasury streams">
      <DataTable
        caption="Streams paying out to accounts, with what each has released so far"
        headers={['Stream', 'Recipient', 'Total', 'Claimed', 'Claimable now']}
        rows={streams.map((stream) => {
          const claimable = claimableNow(stream, now);
          return {
            key: stream.id.value,
            cells: [
              <Identifier datum={stream.id} key={`id-${stream.id.value}`} />,
              <Identifier datum={stream.recipient} key={`to-${stream.id.value}`} />,
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
              // step. The amount is derived from six reads, so it renders through `Derived`
              // and is withheld rather than fabricated when they do not agree on a block.
              <Derived
                key={`n-${stream.id.value}`}
                combined={claimable}
                render={(value) =>
                  value.reason === 'claimable'
                    ? `${formatBaseUnits(value.amount, decimals)} ${symbol}`
                    : value.reason
                }
              />,
            ],
          };
        })}
      />
      {streams.map((stream) => {
        const blocks = claimBlocks({ stream, now, callerIsRecipient: callerIsRecipient(stream) });
        return blocks.length > 0 ? null : (
          <Button
            key={`claim-${stream.id.value}`}
            label="Claim"
            intent="primary"
            describedBy={`stream-${stream.id.value}`}
            onClick={() => onClaim(stream.id.value)}
          />
        );
      })}
    </Panel>
  );
}

export function ClaimStream({
  context,
  decimals,
  symbol,
  onClaim,
}: {
  readonly context: ClaimContext;
  readonly decimals: number;
  readonly symbol: string;
  readonly onClaim: () => void;
}): ReactNode {
  const blocks = claimBlocks(context);
  const claimable = claimableNow(context.stream, context.now);
  return (
    <Panel title="Claim from a stream" subject={<Identifier datum={context.stream.id} />}>
      <Field label="Claimable now">
        <Derived
          combined={claimable}
          render={(value) => `${formatBaseUnits(value.amount, decimals)} ${symbol}`}
        />
      </Field>
      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}
      <Button
        label="Claim"
        intent="primary"
        onClick={onClaim}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

export function InsurancePanel({
  balance,
  target,
}: {
  readonly balance: Verified<bigint>;
  readonly target: Verified<bigint>;
}): ReactNode {
  const standing = insuranceStanding(balance, target);
  return (
    <Panel title="INSURANCE">
      {/* The classification and its copy — deliberately without the raw balance beside them.
          E1 made this normative: a rising INSURANCE balance is not protocol income, and a
          number a reader can watch move is an invitation to read it as one. */}
      <Field label="Standing">{standing.kind}</Field>
      <Notice severity="info" heading="What this balance means">
        {insuranceCopy(standing)}
      </Notice>
    </Panel>
  );
}

// -------------------------------------------------- S18 welfare snapshot crank

export function SnapshotCrank({
  epoch,
  boundaryPassed,
  alreadyTaken,
  staleness,
  onCrank,
}: {
  readonly epoch: Verified<number>;
  readonly boundaryPassed: boolean;
  readonly alreadyTaken: boolean;
  /** From `snapshotStaleness`, with both thresholds read from chain params. */
  readonly staleness: Combined<SnapshotStaleness>;
  readonly onCrank: () => void;
}): ReactNode {
  const state = snapshotCrankState(epoch, boundaryPassed, alreadyTaken);
  const warning = noOpWarning(state);
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
      {warning === undefined ? null : (
        // §11.5: never sign a guaranteed no-op. The copy states the fee, because the button
        // looks identical either way and that is precisely why the rule exists.
        <Notice severity="caution" heading="This would do nothing">
          {warning}
        </Notice>
      )}
      <Button
        label="Take the snapshot"
        intent="primary"
        onClick={onCrank}
        disabled={warning !== undefined}
        {...(warning === undefined ? {} : { disabledReason: warning })}
      />
    </Panel>
  );
}

// --------------------------------------------------------------- S19 registry

export function RegistryFiling({
  filingId,
  window,
  onChallenge,
}: {
  readonly filingId: Verified<string>;
  readonly window: ChallengeWindow;
  readonly onChallenge: () => void;
}): ReactNode {
  const open = mayChallenge(window);
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

      <Button
        label="Challenge this filing"
        onClick={onChallenge}
        disabled={!open}
        {...(open
          ? {}
          : {
              disabledReason:
                window.kind === 'closed'
                  ? 'The challenge window has closed.'
                  : 'This client cannot establish when the window closes, so it will not offer a challenge it may not be able to complete.',
            })}
      />
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
  onSubmit,
}: {
  /** Undefined until bytes have been fetched and verified — there is no unverified arm. */
  readonly submission: UpgradeSubmission | undefined;
  readonly authorized: AuthorizedUpgrade;
  readonly now: Verified<number>;
  readonly onSubmit: () => void;
}): ReactNode {
  const applicable = isApplicable(authorized, now);
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

      {submission === undefined ? (
        <Notice severity="info" heading="No artifact has been verified yet">
          The runtime bytes are hashed on this device and compared against the authorized
          hash above before anything is offered for signing. Until that check passes there is
          nothing to submit.
        </Notice>
      ) : (
        // Before the control, not after: this is what decides whether to start.
        <Notice severity="caution" heading="What submitting this needs">
          {submissionOutlook(submission.artifact)}
        </Notice>
      )}

      <Button
        label="Submit the upgrade"
        intent="danger"
        onClick={onSubmit}
        disabled={submission === undefined || !applicable}
        {...(submission === undefined
          ? { disabledReason: 'No artifact has been verified against the authorized hash yet.' }
          : applicable
            ? {}
            : {
                disabledReason:
                  'The stored applicable_at block has not been reached. This is the chain’s own field, not a countdown this client computed.',
              })}
      />
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
