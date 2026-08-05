/**
 * S10's forms — vote, delegate, unlock (11 §11.7.1). F16's last piece.
 *
 * The safety properties live in the model layer (`conviction.ts`, `governance-rows.ts`), so
 * what these components own is the three places a *form* can still get it wrong.
 *
 * ## 1. The lock goes above the fold, or the form does not render it at all
 *
 * `VoteForm` takes an `AboveTheFold` — not a `ReactNode` — for the lock, and renders it
 * through `AlwaysVisible`. So the lock cannot be placed inside a `Disclosure` further up,
 * and a caller cannot pass a plain node in its place. 11 §11.2 constraint 3 names
 * `conviction-vote-lock`; this is where that becomes a prop type.
 *
 * ## 2. A disabled conviction selector states why
 *
 * `Split` and `SplitAbstain` have no conviction field in the pallet. A selector that
 * silently ignored a choice would tell the user two false things at once — that their
 * tokens are locked, and that their vote weighs more than it does. So the control is
 * disabled **with a reason**, which `ui`'s `Button` requires anyway (app-code rule 10) and
 * which is asserted here for the select.
 *
 * ## 3. Unlock names the account it acts on
 *
 * G-5's subject is `recipient`: `unlock(class, target)` acts on an account anyone may name.
 * A form that showed only "unlock my tokens" while submitting for a target would be
 * describing a different transaction than the one being signed — §11.3's anti-substitution
 * concern, in the smallest possible form.
 */

import {
  AlwaysVisible,
  BlockRef,
  Button,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  type AboveTheFold,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import {
  CONVICTIONS,
  acceptsConviction,
  type Conviction,
  type VoteIntent,
} from '@bleavit/transaction-builder';

const CONVICTION_LABEL: Readonly<Record<Conviction, string>> = Object.freeze({
  None: 'No lock (votes at 10%)',
  Locked1x: '1× — locked for 1 enactment period',
  Locked2x: '2× — locked for 2',
  Locked3x: '3× — locked for 4',
  Locked4x: '4× — locked for 8',
  Locked5x: '5× — locked for 16',
  Locked6x: '6× — locked for 32',
});

const SPLIT_NO_CONVICTION =
  'A split vote carries no conviction: the pallet has no field for one, so it neither locks ' +
  'your tokens nor multiplies your weight. Choose a single side to use conviction.';

export function VoteForm({
  intent,
  conviction,
  lock,
  onIntentChange,
  onConvictionChange,
  onSubmit,
}: {
  readonly intent: VoteIntent;
  readonly conviction: Conviction;
  /**
   * The computed lock, as an above-the-fold fact.
   *
   * `AboveTheFold` rather than `ReactNode` on purpose: it cannot be placed inside a
   * `Disclosure`, and a caller cannot substitute a plain node for it.
   */
  readonly lock: AboveTheFold;
  readonly onIntentChange: (intent: VoteIntent) => void;
  readonly onConvictionChange: (conviction: Conviction) => void;
  readonly onSubmit: () => void;
}) {
  const convictionAllowed = acceptsConviction(intent);
  return (
    <Panel title="Vote">
      <AlwaysVisible fold={lock} />

      <Field label="Your vote">
        <label>
          <input
            type="radio"
            name="side"
            checked={intent.kind === 'standard' && intent.aye}
            onChange={() =>
              onIntentChange({ kind: 'standard', aye: true, balance: 0n })
            }
          />
          Aye
        </label>
        <label>
          <input
            type="radio"
            name="side"
            checked={intent.kind === 'standard' && !intent.aye}
            onChange={() =>
              onIntentChange({ kind: 'standard', aye: false, balance: 0n })
            }
          />
          Nay
        </label>
        <label>
          <input
            type="radio"
            name="side"
            checked={intent.kind === 'split'}
            onChange={() => onIntentChange({ kind: 'split', aye: 0n, nay: 0n })}
          />
          Split
        </label>
        <label>
          <input
            type="radio"
            name="side"
            checked={intent.kind === 'split-abstain'}
            onChange={() =>
              onIntentChange({ kind: 'split-abstain', aye: 0n, nay: 0n, abstain: 0n })
            }
          />
          Split with abstain
        </label>
      </Field>

      <Field label="Conviction">
        <select
          value={conviction}
          disabled={!convictionAllowed}
          title={convictionAllowed ? undefined : SPLIT_NO_CONVICTION}
          aria-describedby={convictionAllowed ? undefined : 'conviction-disabled'}
          onChange={(event) => onConvictionChange(event.currentTarget.value as Conviction)}
        >
          {CONVICTIONS.map((option) => (
            <option key={option} value={option}>
              {CONVICTION_LABEL[option]}
            </option>
          ))}
        </select>
        {convictionAllowed ? null : (
          // A disabled control says why — app-code rule 10. Rendered as text rather than
          // only as a `title`, because a tooltip is not readable on a touch device and this
          // is the difference between "unavailable" and "you did something that removed it".
          <p id="conviction-disabled" className="field__reason">
            {SPLIT_NO_CONVICTION}
          </p>
        )}
      </Field>

      <Button label="Review and sign" intent="primary" onClick={onSubmit} />
    </Panel>
  );
}

export function DelegationForm({
  target,
  conviction,
  lock,
  onConvictionChange,
  onSubmit,
  onUndelegate,
  currentlyDelegating,
}: {
  /** The chain-read identity of the delegate — §11.3, and G-2's `recipient` clause. */
  readonly target: Verified<string>;
  readonly conviction: Conviction;
  readonly lock: AboveTheFold;
  readonly onConvictionChange: (conviction: Conviction) => void;
  readonly onSubmit: () => void;
  readonly onUndelegate: () => void;
  readonly currentlyDelegating: boolean;
}) {
  return (
    <Panel title="Delegate">
      <AlwaysVisible fold={lock} />
      <Field label="Delegating to">
        <Identifier datum={target} />
      </Field>
      <Field label="Conviction">
        <select
          value={conviction}
          onChange={(event) => onConvictionChange(event.currentTarget.value as Conviction)}
        >
          {CONVICTIONS.map((option) => (
            <option key={option} value={option}>
              {CONVICTION_LABEL[option]}
            </option>
          ))}
        </select>
      </Field>
      <Button label="Delegate" intent="primary" onClick={onSubmit} />
      <Button
        label="Undelegate"
        onClick={onUndelegate}
        disabled={!currentlyDelegating}
        {...(currentlyDelegating
          ? {}
          : { disabledReason: 'You are not currently delegating in this class.' })}
      />
    </Panel>
  );
}

/** One class's lock, as the unlock screen sees it. */
export interface ClassLock {
  readonly track: Verified<string>;
  readonly amount: Verified<bigint>;
  readonly unlocksAt: Verified<number>;
  /** Whether it has expired at the block just read. Computed, never guessed. */
  readonly expired: boolean;
}

export function UnlockForm({
  target,
  locks,
  onUnlock,
}: {
  /**
   * The account being unlocked **for** — G-5's subject is `recipient`, not the caller.
   * Rendered because a form that said only "your tokens" while submitting for another
   * account would describe a different transaction than the one being signed.
   */
  readonly target: Verified<string>;
  readonly locks: readonly ClassLock[];
  readonly onUnlock: (track: string) => void;
}): ReactNode {
  const expired = locks.filter((lock) => lock.expired);
  return (
    <Panel title="Unlock">
      <Field label="Unlocking for">
        <Identifier datum={target} />
      </Field>

      {expired.length === 0 ? (
        <Notice severity="info" heading="Nothing is unlockable yet">
          Every lock below is still running. The block each one lifts at is shown; unlocking
          before then is refused by the chain, not by this screen.
        </Notice>
      ) : null}

      {/* The track name is a chain read, so it renders badged as the field's content rather
          than as its label or inside the button's text — an unbadged track name here would
          let a user unlock against a class they were told the wrong name for. The button
          stays generically labelled and is bound to the track by `aria-describedby`, which
          is what a screen reader needs to tell two Unlock buttons apart. */}
      {locks.map((lock) => (
        <Field label="Class lock" key={lock.track.value}>
          <span id={`lock-track-${lock.track.value}`}>
            <Phrase datum={lock.track} name="track" />
          </span>
          <BlockRef datum={lock.unlocksAt} name="unlocks at" />
          <Button
            label="Unlock"
            describedBy={`lock-track-${lock.track.value}`}
            onClick={() => onUnlock(lock.track.value)}
            disabled={!lock.expired}
            {...(lock.expired
              ? {}
              : { disabledReason: 'This lock has not expired yet — the block it lifts at is shown beside it.' })}
          />
        </Field>
      ))}
    </Panel>
  );
}

export { SPLIT_NO_CONVICTION };
