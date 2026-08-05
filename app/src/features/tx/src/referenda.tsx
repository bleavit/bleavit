/**
 * S9/S10 — the governance surface's read screens (11 §11.7.1, §11.7.6). F16.
 *
 * Three rules from §11.7.6 are made structural rather than remembered, and each has an
 * obvious way to be violated by a later change rather than by anybody deciding to.
 *
 * ## 1. A tally is never shown from provider data
 *
 * > Governance state renders with the same `Verified<T>` provenance badges as market state;
 * > a tally is never shown from provider data.
 *
 * The badge discipline already gives this for free — `ui`'s data components take
 * `Verified<T>` and derive the badge from the status. What is added here is that `Tally`'s
 * fields are `Verified<bigint>` individually rather than one `Verified<Tally>`, so a
 * component cannot render the ayes at one provenance and the nays at another *without the
 * screen showing two different badges*. Wrapping the pair would let one status stand for
 * both, which is the shape that hides a mismatch.
 *
 * ## 2. `Confirming` must state the abort semantics
 *
 * > A referendum in `Confirming` MUST display the confirm-period abort semantics (support
 * > dropping below the curve restarts confirmation).
 *
 * So `Confirming` is its own arm of the status union and carries the copy. A status modelled
 * as a bare string would let a screen render `Confirming` with no explanation, which is the
 * state where a user most needs one: the countdown is not a countdown, and nothing on screen
 * would say so.
 *
 * ## 3. An undecodable call is structured-unknown, never a guess
 *
 * 10 §5.4 / INV-FE-12. `ReferendumCall` is a union whose `undecodable` arm carries the raw
 * preimage bytes and a reason. A screen holding it cannot render a call name, because there
 * is no field to read one from.
 */

import {
  Amount,
  BlockRef,
  Count,
  DataTable,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Undecodable,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

/** A tally, with each side carrying its own provenance — see rule 1. */
export interface Tally {
  readonly ayes: Verified<bigint>;
  readonly nays: Verified<bigint>;
  readonly support: Verified<bigint>;
}

/**
 * A referendum's status.
 *
 * `Confirming` carries its own arm because §11.7.6 requires the abort semantics stated
 * wherever it renders. `Ongoing` and `Confirming` are distinguished for the same reason a
 * bare string would not do: the copy is attached to the state, not to a screen's memory.
 */
export type ReferendumStatus =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ongoing' }
  | { readonly kind: 'confirming'; readonly confirmEndsAt: Verified<number> }
  | { readonly kind: 'approved' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timed-out' };

/** 11 §11.7.6's fixed copy for the one status that needs it. */
export const CONFIRM_ABORT_COPY =
  'This is confirming, not counting down. If support drops below the track’s curve at any ' +
  'point, confirmation restarts from the beginning — the date below is the earliest it can ' +
  'end, not when it will.';

/**
 * The call a referendum would enact.
 *
 * The `undecodable` arm has no name field, so a screen holding one **cannot** render a call
 * name — 10 §5.4's "never guessed" made structural rather than promised.
 */
export type ReferendumCall =
  | {
      readonly kind: 'decoded';
      readonly pallet: Verified<string>;
      readonly call: Verified<string>;
    }
  | { readonly kind: 'undecodable'; readonly rawHex: string; readonly reason: string };

export interface Referendum {
  readonly index: Verified<string>;
  readonly track: Verified<string>;
  readonly status: ReferendumStatus;
  readonly tally: Tally;
  readonly call: ReferendumCall;
}

const STATUS_LABEL: Readonly<Record<ReferendumStatus['kind'], string>> = Object.freeze({
  preparing: 'Preparing',
  ongoing: 'Ongoing',
  confirming: 'Confirming',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  'timed-out': 'Timed out',
});

export function ReferendaList({
  referenda,
  onOpen,
}: {
  readonly referenda: readonly Referendum[];
  readonly onOpen: (index: string) => void;
}) {
  return (
    <Panel title="Referenda">
      <DataTable
        caption="Referenda across all six tracks"
        headers={['Index', 'Track', 'Status', 'Ayes', 'Nays']}
        rows={referenda.map((referendum) => ({
          key: referendum.index.value,
          cells: [
            <button
              type="button"
              className="link"
              key={`open-${referendum.index.value}`}
              onClick={() => onOpen(referendum.index.value)}
            >
              <Identifier datum={referendum.index} />
            </button>,
            <Phrase datum={referendum.track} key={`track-${referendum.index.value}`} />,
            STATUS_LABEL[referendum.status.kind],
            // Each side badged separately: one status standing for both would hide a
            // provenance mismatch between them.
            <Count datum={referendum.tally.ayes} key={`ayes-${referendum.index.value}`} />,
            <Count datum={referendum.tally.nays} key={`nays-${referendum.index.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}

export function ReferendumDetail({ referendum }: { readonly referendum: Referendum }) {
  return (
    <Panel title="Referendum" subject={<Identifier datum={referendum.index} />}>
      <Field label="Track">
        <Phrase datum={referendum.track} />
      </Field>
      <Field label="Status">{STATUS_LABEL[referendum.status.kind]}</Field>

      {referendum.status.kind === 'confirming' ? (
        <Notice severity="caution" heading="Confirmation can restart">
          {CONFIRM_ABORT_COPY}
          <BlockRef datum={referendum.status.confirmEndsAt} name="earliest end" />
        </Notice>
      ) : null}

      <Field label="Ayes">
        <Count datum={referendum.tally.ayes} />
      </Field>
      <Field label="Nays">
        <Count datum={referendum.tally.nays} />
      </Field>
      <Field label="Support">
        <Count datum={referendum.tally.support} />
      </Field>

      {referendum.call.kind === 'decoded' ? (
        <Field label="What it would do">
          <Phrase datum={referendum.call.pallet} />
          <Phrase datum={referendum.call.call} />
        </Field>
      ) : (
        <Undecodable
          label="Referendum call"
          rawHex={referendum.call.rawHex}
          reason={referendum.call.reason}
        />
      )}
    </Panel>
  );
}

/**
 * The lock a vote or delegation imposes — 11 §11.7.6's third statement.
 *
 * Returned as an `AboveTheFold` by the caller rather than rendered here, because §11.2
 * constraint 3 names `conviction-vote-lock` among the five facts that may not sit behind a
 * step, and `AlwaysVisible` is what enforces that. This component is the *content*; the
 * placement is the caller's and is checked by `ui`.
 */
export function ConvictionLock({
  amount,
  decimals,
  symbol,
  conviction,
  unlockAt,
}: {
  readonly amount: Verified<bigint>;
  readonly decimals: number;
  readonly symbol: string;
  readonly conviction: Verified<number>;
  readonly unlockAt: Verified<number>;
}): ReactNode {
  return (
    <div className="conviction-lock">
      <strong>These tokens are locked if you sign.</strong>
      <Amount datum={amount} decimals={decimals} symbol={symbol} name="locked" />
      <Count datum={conviction} name="conviction multiplier" />
      <BlockRef datum={unlockAt} name="unlocks at block" />
      <span className="conviction-lock__note">
        The lock is not released by the referendum ending. It runs from the end of the vote
        for the full period the multiplier buys.
      </span>
    </div>
  );
}
