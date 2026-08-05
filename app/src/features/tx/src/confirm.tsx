/**
 * The confirm-and-sign surface — 11 §11.3 (anti-substitution), §11.4 rule 3, §11.2
 * constraint 3, INV-FE-14.
 *
 * ## The one rule this file exists to make unbypassable
 *
 * 11 §11.3: *"The confirm screen derives its human summary by decoding `prep.scaleHex` —
 * the exact bytes to be signed — never from form state."*
 *
 * Written as a convention that is a comment. Written as a type it is a property:
 * `DecodedCall` carries a module-private brand and `decodeForConfirm` is the only thing
 * that can produce one, from a hex string. So a summary assembled out of the form the user
 * filled in does not typecheck, and the surface cannot be handed one by accident.
 *
 * The brand alone is not enough, because a decode of *some other* preparation is also
 * branded. So `ConfirmSurface` additionally requires `decoded.fromHex === prep.scaleHex`
 * and **throws** otherwise: showing a user the decode of one transaction while the wallet
 * signs another is the whole of the substitution attack, and it is invisible from the
 * screen.
 *
 * ## Progressive disclosure, and what may not be disclosed progressively
 *
 * 11 §11.2 constraint 3 permits a plain summary in front with the decoded tree, the raw
 * SCALE and the precondition detail one step behind. INV-FE-14 is satisfied by
 * *inspectable before signing*.
 *
 * The exceptions are the facts that change what the signature means. Two are reachable
 * from this surface — the sudo-era banner (§11.10, *"repeated as a line item on every
 * transaction confirm screen"*) and the net payout of a charged redemption (§11.5) — and
 * both go through `AlwaysVisible`, which throws if it ever finds itself inside a
 * `Disclosure`.
 */

import {
  AlwaysVisible,
  Amount,
  Button,
  DataTable,
  Disclosure,
  Field,
  Notice,
  Panel,
  aboveTheFold,
  type ReactNode,
} from '@bleavit/ui';
import type { HexString, Verified } from '@bleavit/shared-types';
import type { PreconditionResult, TxPreparation } from '@bleavit/transaction-builder';

declare const DECODED_FROM_BYTES: unique symbol;

/** One argument of a decoded call, already flattened for display. */
export interface DecodedArg {
  readonly name: string;
  readonly typeName: string;
  readonly display: string;
}

/** What a metadata-driven decoder returns. Plain data — anyone can produce it. */
export interface RawDecoded {
  readonly pallet: string;
  readonly call: string;
  readonly args: readonly DecodedArg[];
}

/**
 * A call decoded **from the bytes that will be signed**.
 *
 * Branded for the reason `GatePassed` and `Finalized<T>` are: without the phantom field,
 * an object literal built from form state would be indistinguishable from a real decode,
 * and 11 §11.3's anti-substitution rule would be a sentence rather than a property. The
 * symbol is not exported, so `decodeForConfirm` is the only producer.
 */
export interface DecodedCall {
  readonly pallet: string;
  readonly call: string;
  readonly args: readonly DecodedArg[];
  /** The exact hex this was decoded from. Compared against the prep before rendering. */
  readonly fromHex: HexString;
  readonly [DECODED_FROM_BYTES]: true;
}

/**
 * Decode the payload for display.
 *
 * `decode` is injected rather than imported so this module never reaches a chain
 * connection (10 §10.2's reference set) and so the suites can drive it with the recorded
 * metadata. What matters is that its **only** input is the hex.
 */
export function decodeForConfirm(
  scaleHex: HexString,
  decode: (hex: HexString) => RawDecoded,
): DecodedCall {
  const raw = decode(scaleHex);
  // The brand is a **phantom**: `DECODED_FROM_BYTES` is `declare const`, so it exists in
  // the type system and nowhere at runtime. Writing it as a computed key threw
  // `ReferenceError: DECODED_FROM_BYTES is not defined` on the first call — a phantom
  // field must never be materialised. The single assertion here is the one mint site, the
  // same shape `gate()` uses for `GatePassed` and `chain-client` for `Finalized<T>`, and
  // it must stay the only one: `as unknown as` is banned across `app/`, and this is a
  // narrowing assertion rather than a laundering double-cast.
  return { ...raw, fromHex: scaleHex } as DecodedCall;
}

/** A decode that does not belong to the preparation being signed. */
export class PayloadMismatchError extends Error {
  constructor(preparedHex: HexString, decodedHex: HexString) {
    super(
      '11 §11.3 anti-substitution: the confirm surface was given a decode of different bytes ' +
        `than the ones to be signed. The preparation is ${preparedHex.slice(0, 18)}… and the ` +
        `decode came from ${decodedHex.slice(0, 18)}…. Refusing to render — this is exactly the ` +
        'case where the screen and the wallet would disagree and the user could not tell.',
    );
    this.name = 'PayloadMismatchError';
  }
}

/**
 * The net payout of a charged redemption — 11 §11.5's presentation rule.
 *
 * `net` is the headline and `gross`/`fee` are the itemization, so they are modelled that
 * way rather than left to a layout decision. `undefined` means the call is not a charged
 * redemption; a charged redemption whose net could not be computed is **not** representable
 * here, because §11.5 rule 5 says the figure is chain-derived or not displayed at all and
 * the transaction blocked — that is a gate outcome, not a rendering state.
 */
export interface RedemptionPayout {
  readonly net: Verified<bigint>;
  readonly gross: Verified<bigint>;
  readonly fee: Verified<bigint>;
  readonly decimals: number;
  readonly symbol: string;
}

export interface ConfirmSurfaceProps {
  readonly prep: TxPreparation;
  readonly decoded: DecodedCall;
  /** Every row evaluated at B′, passing and failing alike (§11.4 rule 3). */
  readonly preconditions: readonly PreconditionResult[];
  /** Present only for the charged redemption calls of §11.5 rule 1. */
  readonly payout?: RedemptionPayout | undefined;
  /** Rendered as a line item here as well as in the shell (§11.10). */
  readonly sudoActive: boolean;
  readonly onSign: () => void;
  readonly onEdit: () => void;
  /** Expert mode shows raw keys and SCALE values (§11.4 rule 3). */
  readonly expert: boolean;
}

function PreconditionTable({ rows }: { readonly rows: readonly PreconditionResult[] }) {
  return (
    <DataTable
      caption="Every condition re-read at the block this will be signed against"
      headers={['Row', 'Requirement', 'Expected', 'Actual', 'Result']}
      rows={rows.map((row) => ({
        key: row.id,
        cells: [
          row.id,
          row.requirement,
          row.expected,
          row.actual,
          row.ok ? 'holds' : 'does not hold',
        ],
      }))}
    />
  );
}

export function ConfirmSurface({
  prep,
  decoded,
  preconditions,
  payout,
  sudoActive,
  onSign,
  onEdit,
  expert,
}: ConfirmSurfaceProps) {
  if (decoded.fromHex !== prep.scaleHex) {
    throw new PayloadMismatchError(prep.scaleHex, decoded.fromHex);
  }

  const failed = preconditions.filter((row) => !row.ok);
  const blocked = failed.length > 0;

  return (
    <Panel title="Review and sign">
      {sudoActive ? (
        <AlwaysVisible
          fold={aboveTheFold(
            'sudo-era-banner',
            <Notice severity="caution" heading="Bootstrap governance: sudo active">
              A founding multisig holds sudo while this transaction is signed.
            </Notice>,
          )}
        />
      ) : null}

      {payout === undefined ? null : (
        <AlwaysVisible
          fold={aboveTheFold(
            'charged-redemption-net-payout',
            <div className="payout">
              <Amount
                datum={payout.net}
                decimals={payout.decimals}
                symbol={payout.symbol}
                name="You will receive"
              />
              <span className="payout__itemization">
                <Amount
                  datum={payout.gross}
                  decimals={payout.decimals}
                  symbol={payout.symbol}
                  name="gross"
                />
                <Amount
                  datum={payout.fee}
                  decimals={payout.decimals}
                  symbol={payout.symbol}
                  name="redemption fee"
                />
              </span>
              <span className="payout__note">
                The redemption fee is the protocol’s and is separate from the transaction fee.
              </span>
            </div>,
          )}
        />
      )}

      <Field label="What this does">
        <span className="summary" data-pallet={decoded.pallet} data-call={decoded.call}>
          {decoded.pallet}.{decoded.call}
        </span>
      </Field>

      {blocked ? (
        <Notice severity="danger" heading="This cannot be signed as it stands">
          {failed.length === 1
            ? 'One condition no longer holds at the latest finalized block.'
            : `${failed.length} conditions no longer hold at the latest finalized block.`}{' '}
          The details are below, expected against actual.
        </Notice>
      ) : null}

      <Disclosure summary="What exactly will be signed" open={blocked}>
        <DataTable
          caption="The decoded call, argument by argument"
          headers={['Argument', 'Type', 'Value']}
          rows={decoded.args.map((arg) => ({
            key: arg.name,
            cells: [arg.name, arg.typeName, arg.display],
          }))}
        />
        <PreconditionTable rows={preconditions} />
        {expert ? (
          <Field label="Raw payload (SCALE)">
            <code className="scale-hex">{prep.scaleHex}</code>
          </Field>
        ) : null}
      </Disclosure>

      <div className="confirm__actions">
        <Button
          label="Sign"
          intent="primary"
          onClick={onSign}
          disabled={blocked}
          {...(blocked
            ? {
                disabledReason:
                  'A precondition failed when the chain was re-read. Signing is disabled until ' +
                  'the transaction is rebuilt against current state.',
              }
            : {})}
        />
        <Button label="Go back and edit" onClick={onEdit} />
      </div>
    </Panel>
  );
}

/**
 * The summary line the client states in its own voice.
 *
 * Exported separately so a suite can assert it is a function of the **decode** and nothing
 * else: it takes a `DecodedCall`, which is only obtainable from bytes.
 */
export function summarise(decoded: DecodedCall): string {
  const args = decoded.args.map((arg) => `${arg.name} = ${arg.display}`).join(', ');
  return `${decoded.pallet}.${decoded.call}(${args})`;
}

export type { ReactNode };
