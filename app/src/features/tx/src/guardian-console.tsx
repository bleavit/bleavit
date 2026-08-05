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
  Button,
  Count,
  DataTable,
  Derived,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Undecodable,
  type ReactNode,
} from '@bleavit/ui';
import {
  UNRATIFIED_CONSEQUENCE,
  allowanceRemaining,
  approvalBlocks,
  proposalBlocks,
  type AllowanceMeter,
  type ApprovalContext,
  type GuardianPower,
  type PendingAction,
  type TriggerState,
} from './guardian.js';
import { EvidencePanel } from './operator-consoles.js';

/** Release copy for the five powers. Closed over `GuardianPower`, so a sixth cannot slip in. */
const POWER_LABEL: Readonly<Record<GuardianPower, string>> = Object.freeze({
  pause_intake: 'a pause on intake',
  delay_once: 'a one-time delay',
  force_rerun: 'a forced re-run',
  activate_playbook: 'a playbook activation',
  suspend_on_gate: 'a suspension on the gate',
});

export function PendingActions({
  actions,
  onOpen,
}: {
  readonly actions: readonly PendingAction[];
  readonly onOpen: (actionId: string) => void;
}) {
  return (
    <Panel title="Pending guardian actions">
      <DataTable
        caption="Actions awaiting approval, with how many signatures each still needs"
        headers={['Action', 'Power', 'Target', 'Approvals', 'Required', 'Expires']}
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
            // Both numbers, never a percentage: at 4-of-5 versus 5-of-7 a bar looks the
            // same and the decision is entirely different.
            <Count datum={action.approvals} key={`a-${action.actionId.value}`} />,
            <Count datum={action.threshold} key={`t-${action.actionId.value}`} />,
            <Count datum={action.expiresAt} key={`e-${action.actionId.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}

export function ApproveAction({
  context,
  onApprove,
}: {
  readonly context: ApprovalContext;
  readonly onApprove: () => void;
}): ReactNode {
  const blocks = approvalBlocks(context);
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

      {/* Every reason, not the first: fixing one and hitting the next reads as guesswork. */}
      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      <Button
        label="Approve"
        intent="primary"
        onClick={onApprove}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

export function ProposeAction({
  meter,
  trigger,
  onPropose,
}: {
  readonly meter: AllowanceMeter;
  /** Only `activate_playbook` has one; `undefined` for the other four powers. */
  readonly trigger?: TriggerState | undefined;
  readonly onPropose: () => void;
}): ReactNode {
  // The model owns every reason — the screen re-deriving them was how the two lists drifted
  // apart in the first place, and a button enabled on the screen's own weaker test is the
  // failure that matters.
  const blocks = proposalBlocks(meter, trigger);
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

      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      <Button
        label="Propose"
        intent="primary"
        onClick={onPropose}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}
