/**
 * The one submit control every §11.8 console renders. F17.
 *
 * It lives in its own module because both operator consoles need it and neither should
 * import the other for chrome — `guardian-console.tsx` already reaches into
 * `operator-consoles.tsx` for `EvidencePanel`, and adding a second reason to would make the
 * pair mutually load-bearing for no gain.
 *
 * What it centralises is the pairing that must never come apart: whether a handler exists,
 * and whether the button is disabled with a reason. Both are derived from one `OperatorGate`
 * here, so a console cannot enable a control whose gate refused, and cannot disable one
 * without saying why (which `Button` refuses anyway, deliberately).
 *
 * It also renders the gate's **unreadable obligations unconditionally**, including the
 * `stated` ones that do not block. That is `RegistrationCheck.uncheckable`'s device applied
 * to every row: a console holding this control cannot present a complete verdict for a row
 * whose check is known to be partial, because the caveat travels with the control rather
 * than beside it.
 */

import { Button, Notice, type ReactNode } from '@bleavit/ui';
import type { GatePassed } from '@bleavit/transaction-builder';
import { operatorDisabledReason, operatorSubmit, type OperatorGate } from './operator-gate.js';

export function GateControl({
  label,
  intent,
  gate,
  onSubmit,
  describedBy,
}: {
  readonly label: string;
  readonly intent: 'primary' | 'danger';
  readonly gate: OperatorGate;
  /**
   * Takes the gate proof. This is the signature that makes 11 §11.4 rule 1 structural for
   * the operator surface: a caller cannot construct a `GatePassed`, so the only way to
   * invoke this is to have been handed one by a session in `AwaitingSignature`.
   */
  readonly onSubmit: (window: GatePassed) => void;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const submit = operatorSubmit(gate, onSubmit);
  const reason = operatorDisabledReason(gate);
  return (
    <>
      {/* Every reason, not the first: a user who fixes one and meets the next learns the
          screen is guessing. */}
      {gate.blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}
      {gate.unreadable.length === 0 ? null : (
        <Notice severity="caution" heading="What this client cannot check here">
          <ul>
            {gate.unreadable.map((entry) => (
              <li key={entry.requirement}>
                {entry.requirement} — {entry.reason} ({entry.specQuestion})
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <Button
        label={label}
        intent={intent}
        // Never a live no-op: the handler is absent exactly when the control is disabled,
        // and `Button` refuses a disabled control with no stated reason.
        onClick={submit ?? (() => undefined)}
        disabled={submit === undefined}
        {...(reason === undefined ? {} : { disabledReason: reason })}
        {...(describedBy === undefined ? {} : { describedBy })}
      />
    </>
  );
}
