/**
 * S11 — the OracleResolution ballot (11 §11.7.5). F16.
 *
 * ## The rule this screen exists for
 *
 * > pre-sign, warn (and show effective power = 0) when the user's locks post-date the
 * > snapshot — the vote would be signable but weightless.
 *
 * That is a failure with no on-chain symptom: the extrinsic succeeds, the user believes
 * they voted, and their stake counted for nothing. Nothing after the signature can tell
 * them, so the whole obligation is *pre-sign*.
 *
 * It is modelled as a **discriminated union** rather than a number plus a boolean, because
 * a number plus a boolean can be rendered without the boolean. `EffectivePower`'s
 * `weightless` arm carries **no power field at all** — there is no zero to render, and no
 * way to show a figure while omitting why it is zero.
 *
 * ## The `[VERIFY]` is respected rather than assumed away
 *
 * §11.7.5 rule 2 carries **[VERIFY the snapshot mechanism]**, and R-2 forbids resolving a
 * `[VERIFY]` by assumption. So there is a third arm — `unestablished` — and it is the one
 * the client uses until that verification lands. It renders no number, because a computed
 * voting power that rests on a guessed snapshot mechanism is exactly the confident-looking
 * wrong answer the tag exists to prevent. A screen holding it **cannot** display a power:
 * the arm has no field for one.
 *
 * ## Rule 4 is copy, and copy is the whole point here
 *
 * > never present the ballot as a routine vote: copy states it is the stake-weighted
 * > backstop that makes earlier-round lying unprofitable.
 *
 * Fixed in-bundle, rendered unconditionally, taking no prop that could replace it.
 */

import {
  Amount,
  BlockRef,
  DataTable,
  Field,
  Notice,
  Panel,
  Phrase,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';

/** 11 §11.7.5 rule 4. Fixed, unconditional, unparameterised. */
export const BALLOT_NOT_ROUTINE =
  'This is not a routine vote. It is the stake-weighted backstop that makes lying in the ' +
  'earlier dispute rounds unprofitable: what you stake here is what makes the whole oracle ' +
  'game safe, and it is the last word on a value the protocol will act on.';

/**
 * The user's weight in this ballot.
 *
 * Three arms, and the two that carry no power field are the point: a screen holding one
 * has nothing to render a number from.
 */
export type EffectivePower =
  | {
      readonly kind: 'counted';
      readonly power: Verified<bigint>;
      readonly snapshotAt: Verified<number>;
    }
  | {
      /** Locks post-date the snapshot: signable, and weightless. */
      readonly kind: 'weightless';
      readonly lockedAt: Verified<number>;
      readonly snapshotAt: Verified<number>;
    }
  | {
      /**
       * The snapshot mechanism is `[VERIFY]`-tagged in §11.7.5 rule 2 and unresolved, so
       * this client cannot compute the figure. Fail-closed per R-2: no number is shown.
       */
      readonly kind: 'unestablished';
      readonly reason: string;
    };

/** One round of the dispute, for the lineage rule 1 requires. */
export interface DisputeRound {
  readonly round: Verified<number>;
  readonly reporter: Verified<string>;
  readonly bond: Verified<bigint>;
  readonly evidenceHash: Verified<string>;
}

export interface OracleBallot {
  readonly component: Verified<string>;
  readonly epoch: Verified<number>;
  readonly rounds: readonly DisputeRound[];
  readonly power: EffectivePower;
}

export function EffectivePowerNotice({
  power,
  decimals,
  symbol,
}: {
  readonly power: EffectivePower;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  if (power.kind === 'counted') {
    return (
      <Field label="Your weight in this ballot">
        <Amount datum={power.power} decimals={decimals} symbol={symbol} />
        <BlockRef datum={power.snapshotAt} name="measured at the snapshot block" />
      </Field>
    );
  }
  if (power.kind === 'weightless') {
    return (
      <Notice severity="danger" heading="Your vote here would count for nothing">
        Your tokens were locked after this ballot’s snapshot, so your weight in it is zero.
        The transaction would succeed and change no outcome. Nothing after signing would tell
        you that.
        <BlockRef datum={power.snapshotAt} name="snapshot block" />
        <BlockRef datum={power.lockedAt} name="your lock begins" />
      </Notice>
    );
  }
  return (
    <Notice severity="danger" heading="Your weight in this ballot cannot be established">
      {power.reason} No figure is shown, because a voting power computed from an unverified
      snapshot rule would look exactly like one that was checked.
    </Notice>
  );
}

export function OracleResolutionBallot({
  ballot,
  decimals,
  symbol,
}: {
  readonly ballot: OracleBallot;
  readonly decimals: number;
  readonly symbol: string;
}) {
  return (
    <Panel title="Oracle resolution ballot">
      {/* Rule 4: unconditional, and there is no prop that could replace it. */}
      <Notice severity="caution" heading="This is the oracle backstop">
        {BALLOT_NOT_ROUTINE}
      </Notice>

      <Field label="Component">
        <Phrase datum={ballot.component} />
      </Field>
      <Field label="Epoch">
        <BlockRef datum={ballot.epoch} />
      </Field>

      <EffectivePowerNotice power={ballot.power} decimals={decimals} symbol={symbol} />

      <DataTable
        caption="Every round of this dispute, with the bond each party staked"
        headers={['Round', 'Reporter', 'Bond', 'Evidence']}
        rows={ballot.rounds.map((round) => ({
          key: String(round.round.value),
          cells: [
            <BlockRef datum={round.round} key={`r-${round.round.value}`} />,
            <Phrase datum={round.reporter} key={`who-${round.round.value}`} />,
            <Amount
              datum={round.bond}
              decimals={decimals}
              symbol={symbol}
              key={`bond-${round.round.value}`}
            />,
            <Phrase datum={round.evidenceHash} key={`ev-${round.round.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}
