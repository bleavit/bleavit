/**
 * S12/S13 — the funding screens, over `funding.ts`. F18.
 *
 * Every refusal was decided in the model. What these components own is the distinction
 * between a **block** and a **warning**, which is the one thing a rendering can flatten and
 * the one thing §11.9 is most explicit about.
 *
 * ## Blocks disable; warnings do not
 *
 * Degraded XCM health and an unverifiable destination are *warnings*: I-24's fail-static
 * property means the funds are held, not lost, and a client that refused what the chain
 * accepts is the failure 15 §4.8's mirror rule forbids. Rendering them in the same red box
 * as a real block is how a lawful deposit stops happening — the user reads "there is a
 * problem" and does not send.
 *
 * So the two arrive through different components with different severities, and the suite
 * asserts a warning-only state leaves the control **enabled**. That assertion is the whole
 * point: it is the one a happy-path test never makes and a cautious developer breaks first.
 *
 * ## "Sent" is never rendered as "arrived"
 *
 * The model already makes this structural — `credited` cannot be constructed from the Asset
 * Hub leg alone. The screen's job is to not undo it in copy, so the progress line comes from
 * `progressCopy` rather than from a status word this component chooses, and the
 * `sent-awaiting-arrival` arm renders the Asset Hub block **labelled as the Asset Hub's**.
 * A single block number with no chain beside it is how a user concludes the transfer landed.
 *
 * ## The two chains' figures never share a badge
 *
 * Asset Hub balances and futarchy-chain balances come from **two light clients at two
 * finalized blocks**. Each renders as its own `Verified<T>`, and nothing here combines them —
 * `combine` would refuse across blocks anyway, but the deeper reason is that a single figure
 * spanning two chains describes neither, and no status in the vocabulary can say that.
 */

import {
  Amount,
  Button,
  Count,
  Field,
  Identifier,
  Notice,
  Panel,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import {
  depositBlocks,
  destinationWarning,
  progressCopy,
  withdrawBlocks,
  xcmWarning,
  type DepositInputs,
  type DepositProgress,
  type FundingBlock,
  type WithdrawInputs,
} from './funding.js';

/**
 * A balance the client read and could not decode.
 *
 * No number and no badge. The model made this field absent rather than substituting `0n`
 * (10 §2.2, INV-FE-12), and a screen that filled the gap back in with a zero would restore
 * the defect one layer up — the user would read a balance the chain never stated, and this
 * time with no `Verified<T>` for a badge to hang off. The matching block is already in the
 * list below, so this row says what is missing and the notice says what it stops.
 */
function BalanceUnreadable({ what }: { readonly what: string }) {
  return (
    <span className="datum datum--unread" role="note">
      {what} could not be decoded from the record this client read. It is not being guessed
      at, and nothing is being substituted for it.
    </span>
  );
}

/**
 * The chain figures a refusal was decided on, each with its own badge.
 *
 * §11.9.1's D-13 row does not merely require the deposit blocked — it requires it *"blocked
 * with the cap shown"*, which is a display obligation the model cannot discharge on its own.
 * The figures arrive as `Verified<bigint>` and render through `Amount`, so the number the
 * user is told about carries the status of the read it came from (INV-FE-9). Interpolating it
 * into the refusal sentence would put a chain value on screen with no badge at all, which is
 * the defect `check-render-provenance` rule C exists to catch one layer over.
 *
 * Rendered for **any** block carrying figures rather than for D-13 specifically: a component
 * that knew which check it was would be a second place the rule lives.
 */
function BlockFigures({
  block,
  decimals,
  symbol,
}: {
  readonly block: FundingBlock;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  if (block.figures === undefined) return null;
  return (
    <>
      {block.figures.map((figure) => (
        <Field label={figure.label} key={figure.label}>
          <Amount datum={figure.amount} decimals={decimals} symbol={symbol} />
        </Field>
      ))}
    </>
  );
}

export function DepositForm({
  inputs,
  xcmHealthy,
  decimals,
  symbol,
  onDeposit,
}: {
  readonly inputs: DepositInputs;
  readonly xcmHealthy: boolean;
  readonly decimals: number;
  readonly symbol: string;
  readonly onDeposit: () => void;
}): ReactNode {
  const blocks = depositBlocks(inputs);
  const warning = xcmWarning({ xcmHealthy });
  return (
    <Panel title="Deposit USDC">
      {/* The Asset Hub side's own figure, badged with the Asset Hub connection's status.
          Nothing on this screen combines it with a futarchy-chain balance. */}
      <Field label="Your Asset Hub balance">
        {inputs.assetHubBalance === undefined ? (
          <BalanceUnreadable what="Your Asset Hub USDC balance" />
        ) : (
          <Amount datum={inputs.assetHubBalance} decimals={decimals} symbol={symbol} />
        )}
      </Field>

      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
          <BlockFigures block={block} decimals={decimals} symbol={symbol} />
        </Notice>
      ))}

      {/* A warning, at caution severity, and it does NOT disable the button. Rendering it in
          the same red box as a block is how a lawful deposit stops happening. */}
      {warning === undefined ? null : (
        <Notice severity="caution" heading="XCM channel health is degraded">
          {warning}
        </Notice>
      )}

      <Button
        label="Deposit"
        intent="primary"
        onClick={onDeposit}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

export function DepositTracker({
  progress,
  decimals,
  symbol,
}: {
  readonly progress: DepositProgress;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  return (
    <Panel title="Deposit status">
      <Notice
        severity={progress.kind === 'credited' ? 'info' : 'caution'}
        heading={progress.kind === 'credited' ? 'Credited' : 'In progress'}
      >
        {progressCopy(progress)}
      </Notice>

      {progress.kind === 'not-sent' ? null : (
        // Labelled as the Asset Hub's. A bare block number with no chain beside it is how a
        // user concludes the transfer landed.
        <Field label="Asset Hub block (sent)">
          <Count datum={progress.assetHubBlock} />
        </Field>
      )}

      {progress.kind === 'credited' ? (
        <>
          <Field label="This chain’s block (credited)">
            <Count datum={progress.creditedAtLocalBlock} />
          </Field>
          <Field label="Amount credited">
            <Amount datum={progress.creditedAmount} decimals={decimals} symbol={symbol} />
          </Field>
        </>
      ) : null}
    </Panel>
  );
}

export function WithdrawForm({
  inputs,
  destination,
  decimals,
  symbol,
  onWithdraw,
}: {
  readonly inputs: WithdrawInputs;
  /** The Asset Hub destination account, rendered because it is what the funds go to. */
  readonly destination: Verified<string>;
  readonly decimals: number;
  readonly symbol: string;
  readonly onWithdraw: () => void;
}): ReactNode {
  const blocks = withdrawBlocks(inputs);
  const warning = destinationWarning(inputs.destinationViable);
  return (
    <Panel title="Withdraw USDC">
      <Field label="Free balance">
        {inputs.freeBalance === undefined ? (
          <BalanceUnreadable what="Your free USDC balance" />
        ) : (
          <Amount datum={inputs.freeBalance} decimals={decimals} symbol={symbol} />
        )}
      </Field>
      <Field label="Destination on Asset Hub">
        <Identifier datum={destination} />
      </Field>

      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
          <BlockFigures block={block} decimals={decimals} symbol={symbol} />
        </Notice>
      ))}

      {/* Warning, not block — and the unknown case says so in its own words, because
          "could not be checked" and "would be dusted" call for different user actions. */}
      {warning === undefined ? null : (
        <Notice severity="caution" heading="Destination account">
          {warning}
        </Notice>
      )}

      <Button
        label="Withdraw"
        intent="primary"
        onClick={onWithdraw}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}
