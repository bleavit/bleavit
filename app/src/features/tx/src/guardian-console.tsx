/**
 * S15 — the guardian console, rendered over `guardian.ts`. F17.
 *
 * Every decision this screen makes was already made in the model; what the component owns
 * is the three places a *rendering* can still mislead.
 *
 * ## The consequence is always on screen, never behind the propose button
 *
 * §11.8.2 requires the 50%-bond-slash and recall consequence *stated*. It renders
 * unconditionally at the top of the propose flow rather than after a click, because the
 * moment it matters is while the guardian is deciding — not after they have decided.
 *
 * It is **not** an `AboveTheFold` fact: 11 §11.2 constraint 3's list is closed at five, and
 * adding a sixth here would put a screen's judgement into a set the spec fixes. The
 * placement obligation is met by rendering it where it belongs and testing that; inventing
 * a spec entry to get the enforcement would be the tail wagging the dog.
 *
 * ## m-of-7 shows both numbers, never a percentage or a bar alone
 *
 * "3 of 5 required" is actionable — a guardian knows whether their signature closes it.
 * "60%" is not, and a progress bar with no numbers is worse: at 4-of-5 versus 5-of-7 the
 * bars look similar and the decisions are completely different.
 *
 * ## A blocked approval lists every reason
 *
 * The model already returns them all; the screen must not render only the first. A
 * guardian who fixes one blocker and hits the next learns the screen is guessing.
 */

import {
  Count,
  DataTable,
  Derived,
  Field,
  Datum,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Undecodable,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import type { GatePassed, TxSession } from '@bleavit/transaction-builder';
import {
  POWER_FIELDS,
  UNRATIFIED_CONSEQUENCE,
  allowanceRemaining,
  approvalBlocks,
  proposalBlocks,
  proposeFormBlocks,
  ratificationCopy,
  type ActionRatification,
  type AllowanceMeter,
  type ApprovalContext,
  type GuardianPower,
  type PendingAction,
  type ProposalTrigger,
  type ProposeInputs,
} from './guardian.js';
import { EvidencePanel } from './operator-consoles.js';
import { operatorGate } from './operator-gate.js';
import { GateControl } from './gate-control.js';
import type { EvidenceState } from './evidence.js';

/** Release copy for the five powers. Closed over `GuardianPower`, so a sixth cannot slip in. */
const POWER_LABEL: Readonly<Record<GuardianPower, string>> = Object.freeze({
  pause_intake: 'a pause on intake',
  delay_once: 'a one-time delay',
  force_rerun: 'a forced re-run',
  activate_playbook: 'a playbook activation',
  suspend_on_gate: 'a suspension on the gate',
});

/**
 * §11.8.2's pending-actions list.
 *
 * Its row is specified field by field: *"power, target, `justification_hash` (+ resolved
 * justification document via the evidence rules of §11.8.1), current approvals m-of-7,
 * expiry"*. The table shipped with the hash and the document **missing** — both of them,
 * although the model carried the hash and `ApproveAction` already resolved the document.
 *
 * That absence is not cosmetic. The list is where a guardian decides which action to open,
 * and the justification is the only thing on the row that says *why* an action exists.
 * Without it the list ranks five identical-looking privileged actions by nothing but their
 * ids, and the document that would distinguish them appears one click later — after the
 * choice it was meant to inform.
 */
export function PendingActions({
  actions,
  justifications,
  onOpen,
}: {
  readonly actions: readonly PendingAction[];
  /**
   * The resolved justification per action id, under §11.8.1's evidence rules.
   *
   * A **total** function rather than an optional map, so a caller cannot omit an action and
   * have the row render blank: `evidenceUnavailable(reason)` is the answer for one that
   * could not be fetched, and blank is not an available answer at all.
   */
  readonly justifications: (actionId: string) => EvidenceState;
  readonly onOpen: (actionId: string) => void;
}) {
  return (
    <Panel title="Pending guardian actions">
      <DataTable
        // Not "Actions awaiting approval". `guardian_core` keeps a **dispatched** action in
        // `PendingActions` for the whole review window so a veto can still reach it, so this
        // list is not uniformly awaiting anything — the caption said it was until 2026-08-07,
        // and the Status column below is what tells the two apart.
        caption="Proposed guardian actions, with each one's status and how many signatures it still needs"
        headers={[
          'Action',
          'Power',
          'Target',
          'Justification',
          'Approvals',
          'Required',
          'Expires',
          'Status',
        ]}
        rows={actions.map((action) => ({
          key: action.actionId.value,
          cells: [
            <button
              type="button"
              className="link"
              key={`open-${action.actionId.value}`}
              onClick={() => onOpen(action.actionId.value)}
            >
              <Identifier datum={action.actionId} />
            </button>,
            <Identifier datum={action.power} key={`p-${action.actionId.value}`} />,
            // A power without its target is not actionable: "delay_once" does not say what
            // is being delayed, and a guardian cannot weigh a re-run without its cohort.
            <Identifier datum={action.target} key={`tg-${action.actionId.value}`} />,
            // The hash **and** the resolved document, per §11.8.2. The hash always shows —
            // it is what a reader checks a document against elsewhere when this device
            // cannot fetch one — and the document's absence renders as a stated fact rather
            // than as an empty cell, which would read as "no justification was filed".
            <span key={`j-${action.actionId.value}`}>
              <Identifier datum={action.justificationHash} />
              <EvidencePanel
                state={justifications(action.actionId.value)}
                label="Justification"
              />
            </span>,
            // Both numbers, never a percentage: at 4-of-5 versus 5-of-7 a bar looks the
            // same and the decision is entirely different.
            <Count datum={action.approvals} key={`a-${action.actionId.value}`} />,
            <Count datum={action.threshold} key={`t-${action.actionId.value}`} />,
            <Count datum={action.expiresAt} key={`e-${action.actionId.value}`} />,
            // The column the caption used to imply. A dispatched action stays listed for the
            // review window and cannot be approved again (`AlreadyDispatched`), so a reader who
            // acts on this list needs the difference stated rather than inferred from a count.
            <Datum
              key={`s-${action.actionId.value}`}
              datum={action.dispatched}
              render={(done) => (done ? 'dispatched — reviewable, not approvable' : 'pending')}
            />,
          ],
        }))}
      />
    </Panel>
  );
}

/**
 * §11.8.2's fourth element — the ratification tracker, which had no screen at all.
 *
 * The consequence copy is rendered **above** the state, not below it, and unconditionally.
 * A guardian reading "ratified" has no further exposure and a guardian reading anything
 * else does; putting the consequence first means the ordering never has to be re-derived
 * from which arm happened to render.
 */
export function RatificationTracker({
  actionId,
  state,
}: {
  readonly actionId: Verified<string>;
  readonly state: ActionRatification;
}): ReactNode {
  const severity =
    state.kind === 'ratified' ? 'info' : state.kind === 'failed' ? 'danger' : 'caution';
  return (
    <Panel title="Retrospective ratification" subject={<Identifier datum={actionId} />}>
      <Notice severity="caution" heading="What happens to you if this is not ratified">
        {UNRATIFIED_CONSEQUENCE}
      </Notice>
      <Notice severity={severity} heading="Where the review stands">
        {ratificationCopy(state)}
      </Notice>
      {state.kind === 'pending' && state.review.kind === 'ongoing' ? (
        <Field label="Review referendum">
          <Count datum={state.review.ayes} name="ayes" />
          <Count datum={state.review.nays} name="nays" />
        </Field>
      ) : null}
      {/* An unread referendum is stated, never rendered as a quiet one: a review this device
          could not read is not a review going well, and E20's discipline for the trigger is
          the same discipline here. */}
      {state.kind === 'pending' && state.review.kind === 'unread' ? (
        <Notice severity="caution" heading="The review referendum could not be read">
          {state.review.reason} Until it can be, treat the consequence above as live.
        </Notice>
      ) : null}
    </Panel>
  );
}

export function ApproveAction({
  context,
  session,
  onApprove,
}: {
  readonly context: ApprovalContext;
  readonly session: TxSession;
  readonly onApprove: (window: GatePassed) => void;
}): ReactNode {
  const blocks = approvalBlocks(context);
  const gate = operatorGate('guardian.approve_action', session, blocks);
  return (
    <Panel title="Approve action" subject={<Identifier datum={context.action.actionId} />}>
      <Field label="Power">
        <Identifier datum={context.action.power} />
      </Field>
      <Field label="Target">
        <Identifier datum={context.action.target} />
      </Field>
      {/* §11.8.2 wants the *resolved* justification document, under §11.8.1's evidence
          rules: re-hashed before rendering, and unavailable-or-mismatched stated rather than
          silently omitted. The hash always shows — it is what a reader checks a document
          against elsewhere if this device cannot fetch one. */}
      <Field label="Justification">
        <Identifier datum={context.action.justificationHash} />
        <EvidencePanel state={context.justification} label="Justification document" />
      </Field>

      {/* §11.8.2: the exact enumerated batch, "decoded and displayed, never summarized away".
          A count, a summary, or the justification hash alone would all let a guardian approve
          calls nobody read — and an undecodable one renders as raw SCALE rather than as a
          guessed name, with the model refusing the approval outright. */}
      <Field label={`What this action would execute (${context.action.calls.length})`}>
        <ol className="call-batch">
          {context.action.calls.map((call, index) =>
            call.kind === 'decoded' ? (
              <li key={`call-${index}`}>
                <Phrase datum={call.pallet} />
                <Phrase datum={call.call} />
                {call.args.map((arg, argIndex) => (
                  <Phrase datum={arg} key={`arg-${index}-${argIndex}`} />
                ))}
              </li>
            ) : (
              <li key={`call-${index}`}>
                <Undecodable
                  label={`Call ${index + 1}`}
                  rawHex={call.rawHex}
                  reason={call.reason}
                />
              </li>
            ),
          )}
        </ol>
      </Field>
      <Field label="Approvals so far">
        <Count datum={context.action.approvals} />
      </Field>
      <Field label="Required">
        <Count datum={context.action.threshold} />
      </Field>

      <GateControl label="Approve" intent="primary" gate={gate} onSubmit={onApprove} />
    </Panel>
  );
}

/**
 * §11.8.2's *"power-specific forms"*, which shipped as one generic form for all five.
 *
 * The powers do not take the same arguments — `suspend_on_gate` takes none, and
 * `activate_playbook` takes four including a target only one playbook accepts — so a single
 * form presented five different calls as interchangeable. `POWER_FIELDS` is closed over
 * `GuardianPower`, so the field list for a power is data rather than markup a sixth power
 * could quietly miss.
 *
 * The empty case renders as a sentence, not as an empty form: a form with no fields looks
 * like one that failed to load, on a screen where the next click is a privileged signature.
 */
export function ProposeAction({
  meter,
  inputs,
  trigger,
  session,
  onPropose,
}: {
  readonly meter: AllowanceMeter;
  /** The power's own arguments and the justification hash — see `PowerArguments`. */
  readonly inputs: ProposeInputs;
  /**
   * What this caller states about the trigger. **Required**, and the other four powers say
   * `{ kind: 'no-trigger-power' }` rather than omitting it.
   *
   * It was optional, and an omitted trigger on an `activate_playbook` form produced an empty
   * block list and a `ready` control — a guardian signature offered on an emergency
   * activation whose condition was never evaluated. See `ProposalTrigger`.
   */
  readonly trigger: ProposalTrigger;
  readonly session: TxSession;
  readonly onPropose: (window: GatePassed) => void;
}): ReactNode {
  // The model owns every reason — the screen re-deriving them was how the two lists drifted
  // apart in the first place, and a button enabled on the screen's own weaker test is the
  // failure that matters.
  const blocks = [...proposalBlocks(meter, trigger), ...proposeFormBlocks(inputs)];
  const gate = operatorGate('guardian.propose_action', session, blocks);
  const fields = POWER_FIELDS[meter.power];
  // `power` is a release-defined literal — which form the user opened — not a chain read, so
  // it belongs in the title. Borrowing the meter's status for it would claim the chain told
  // us which button was pressed.
  return (
    <Panel title={`Propose ${POWER_LABEL[meter.power]}`}>
      {/* Unconditional, and at the top: the moment it matters is while deciding. */}
      <Notice severity="caution" heading="What happens to you if this is not ratified">
        {UNRATIFIED_CONSEQUENCE}
      </Notice>

      <Field label="Allowance remaining">
        <Derived
          combined={allowanceRemaining(meter)}
          render={(remaining) => String(remaining)}
        />
        <Count datum={meter.limit} name="of" />
      </Field>

      {fields.length === 0 ? (
        <Notice severity="info" heading="This power takes no arguments">
          Suspending on the gate carries no parameters — the action is fully described by
          the power itself and by the justification you attach to it.
        </Notice>
      ) : (
        <Field label="This power’s arguments">
          <ul className="power-fields">
            {fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </Field>
      )}

      <GateControl label="Propose" intent="primary" gate={gate} onSubmit={onPropose} />
    </Panel>
  );
}
