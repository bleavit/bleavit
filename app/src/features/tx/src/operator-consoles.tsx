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
  Refusal,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import {
  checkRegistration,
  registrationCaveat,
  type RegistrationInputs,
} from './reporter.js';
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
  type ChallengeWindow,
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
  onCrank,
}: {
  readonly epoch: Verified<number>;
  readonly boundaryPassed: boolean;
  readonly alreadyTaken: boolean;
  readonly onCrank: () => void;
}): ReactNode {
  const state = snapshotCrankState(epoch, boundaryPassed, alreadyTaken);
  const warning = noOpWarning(state);
  return (
    <Panel title="Welfare snapshot">
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
