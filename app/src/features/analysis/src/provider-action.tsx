/**
 * INV-FE-3's last clause, which is a screen obligation by construction. F23.
 *
 * > provider data never satisfies a precondition, never renders a "passed/settled/mature/final/
 * > safe" state without a chain read; **any actionable provider-supplied object triggers a
 * > direct chain fetch before the action is enabled.** — 10 §8.4, INV-FE-3
 *
 * The first two clauses are structural already: `Finalized<T>`'s brand lives in `chain-client`,
 * `packages/providers` cannot name it, and the transaction path takes nothing else. The third
 * clause is different — it is about an **action surface**, and until one existed the invariant
 * had nowhere to hold. This is that surface.
 *
 * ## The control is the callback's argument, not a check the screen performs
 *
 * A screen could compare the two values and enable the button. That is a rule somebody has to
 * remember, and the failure it admits is invisible: the action still runs on the *provider*
 * value, so a source that supplied a plausible object gets its object acted on after a chain
 * read that merely happened nearby.
 *
 * So `onAct` takes the `Finalized<T>` and nothing else. The provider-supplied object is
 * displayed, badged `provider`, and is not an argument of anything: there is no path from the
 * thing a third party supplied to the thing the action operates on. `Finalized<T>` is
 * constructible only inside `packages/chain-client` (10 §2.1), so a caller cannot satisfy the
 * parameter with the provider value however the screen is composed.
 *
 * ## Absent is disabled with a named reason, never a silent no-op
 *
 * `chainRead === undefined` is *this device has not looked yet*, and it disables the control
 * with the sentence that says so — app-code rule 10's fail-closed lattice: an unproven
 * capability is absent, and absence disables the dependent surface with a **named** reason.
 * `Button` refuses a disabled control with no reason, so this is enforced one layer down too.
 *
 * ## A disagreement is shown, and it does not silently block
 *
 * Both values render side by side with their own badges. Where they differ, the chain's is the
 * one the action uses and the screen says so — because the alternative reading, *the provider
 * was right and the chain is stale*, is the one 10 §2.2 gives no path to.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.4, §2.1, §2.2
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-3
 */

import { Button, Datum, Field, Notice, type ReactNode } from '@bleavit/ui';
import type { Finalized } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';

/** Why an action over a provider-supplied object is unavailable until the chain has answered. */
export const AWAITING_CHAIN_READ =
  'This came from an optional source, and Bleavit has not read it from the chain yet. Nothing ' +
  'supplied by an optional source can enable an action on its own, so this stays unavailable ' +
  'until the chain answers for itself.';

/** What the screen says when the two disagree. The chain wins, and the user is told it did. */
export const CHAIN_DISAGREES =
  'The optional source and the chain do not say the same thing about this. What the chain says ' +
  'is what this action uses; the source’s version is shown so the difference is visible rather ' +
  'than resolved behind the screen.';

export interface ProviderObjectActionProps<T> {
  /** What the source supplied. Displayed, badged, and an argument of nothing. */
  readonly supplied: Verified<T>;
  /**
   * The direct chain fetch INV-FE-3 requires, or `undefined` while it has not happened.
   *
   * `Finalized<T>` rather than `Verified<T>`: the brand is unnameable outside `chain-client`,
   * so a caller cannot pass the provider value here by any route the type system admits.
   */
  readonly chainRead: Finalized<T> | undefined;
  /** Payload → text. Blind to the status, exactly as `Datum`'s formatter is. */
  readonly render: (value: T) => string;
  /** Whether the two agree. Supplied by the caller, since equality is `T`'s business. */
  readonly agrees: (supplied: T, chain: T) => boolean;
  readonly label: string;
  readonly name: string;
  /** Receives the **chain** value. The provider one has no path here. */
  readonly onAct: (confirmed: Finalized<T>) => void;
}

export function ProviderObjectAction<T>({
  supplied,
  chainRead,
  render,
  agrees,
  label,
  name,
  onAct,
}: ProviderObjectActionProps<T>): ReactNode {
  const disagreed = chainRead !== undefined && !agrees(supplied.value, chainRead.value);
  return (
    <div
      className="provider-action"
      data-confirmed={chainRead !== undefined}
      data-disagreed={disagreed}
    >
      <Field label={`${name} — as the optional source supplied it`}>
        <Datum datum={supplied} render={render} />
      </Field>
      {chainRead === undefined ? (
        <Notice severity="caution" heading="Waiting on a chain read">
          {AWAITING_CHAIN_READ}
        </Notice>
      ) : (
        <Field label={`${name} — as this device read it from the chain`}>
          <Datum datum={chainRead} render={render} />
        </Field>
      )}
      {disagreed ? (
        <Notice severity="danger" heading="These do not agree">
          {CHAIN_DISAGREES}
        </Notice>
      ) : null}
      {chainRead === undefined ? (
        <Button label={label} onClick={() => undefined} disabled disabledReason={AWAITING_CHAIN_READ} />
      ) : (
        // The chain value, never the supplied one. There is no expression here that could
        // pass `supplied`, and `Finalized<T>` is unforgeable outside `chain-client`.
        <Button label={label} intent="primary" onClick={() => onAct(chainRead)} />
      )}
    </div>
  );
}
