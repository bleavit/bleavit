/**
 * The funding legs — 11 §11.9. F18's model layer.
 *
 * ## The rule with no on-chain symptom, again
 *
 * > Arrival tracking: local finality on AH ≠ delivery. The tracker shows "sent — awaiting
 * > arrival" until the **futarchy-chain** connection observes the balance credit in
 * > finalized state.
 *
 * A tracker that showed "done" when the Asset Hub extrinsic finalized would tell a user
 * their money arrived when it has not. XCM delivery is asynchronous and can be delayed by
 * channel congestion — §11.9's own health row says so — so the AH side finalising proves
 * only that the message was *sent*.
 *
 * `DepositProgress` is therefore a union whose `credited` arm **requires the futarchy-chain
 * observation**: there is no way to construct it from the Asset Hub leg alone. The rule
 * becomes a missing field rather than a discipline.
 *
 * ## Two legs, two provenances
 *
 * Each leg carries its own `Verified<T>`, because they come from two different light-client
 * connections at two different finalized blocks. One status covering both would assert a
 * consistency across chains that nothing established — the same reason a tally's sides are
 * badged separately (11 §11.7.6).
 *
 * ## The Phase-3 caps read a bit, not a number
 *
 * §11.9.1 gated them on *"while PhaseFlags < Phase 4"*, which is unperformable: `PhaseFlags`
 * is a bitset with no ordering, and `17 < 4` is false, so a literal implementation would
 * **skip D-13's containment entirely** during the bootstrap window it exists for. Repaired
 * in the spec (V-115) and read here as bit 4 via `sudoActive`-style testing, supplied by
 * the caller as a boolean so this module names no bit itself.
 *
 * ## Two `[VERIFY]`s are respected, not assumed away
 *
 * §11.9.1 carries **[VERIFY exact AH extrinsic + params]** and **[VERIFY asset id 1337]**.
 * Neither is resolved here: the extrinsic is the caller's to name and the asset id arrives
 * as a parameter, so nothing in this module encodes a guess about either.
 */

import type { Verified } from '@bleavit/shared-types';

/** A reason a funding leg cannot proceed. Each is shown with what it read. */
export interface FundingBlock {
  readonly check: string;
  readonly detail: string;
}

export interface DepositInputs {
  /** AH-side USDC, read on the Asset Hub connection at its own finalized block. */
  readonly assetHubBalance: Verified<bigint>;
  readonly amount: bigint;
  /** AH-side fee estimate, in the same units. */
  readonly assetHubFee: bigint;
  /** The asset's `min_balance`. Below it the deposit would dust — §11.9.1. */
  readonly minBalance: bigint;
  /** True while `Constitution.PhaseFlags` bit 4 (`sudo present`) is set — 02 §7.3, V-115. */
  readonly bootstrapPhase: boolean;
  /** Remaining headroom under the two D-13 caps. Present only during bootstrap. */
  readonly caps?: {
    readonly globalTvlHeadroom: Verified<bigint>;
    readonly perAccountHeadroom: Verified<bigint>;
  };
  /** Whether the Asset Hub connection is synced and its descriptors compatible. */
  readonly assetHubReady: boolean;
  /** XCM channel health from the C_onchain sub-metric. */
  readonly xcmHealthy: boolean;
}

/**
 * Everything blocking a deposit, in the order §11.9.1 lists it.
 *
 * Returns **all** blocks rather than the first: a user told to fix one thing, who then hits
 * the next, learns the screen is guessing. `refreshAndGate` shows a diff for the same
 * reason (11 §11.4 rule 5).
 */
export function depositBlocks(inputs: DepositInputs): readonly FundingBlock[] {
  const blocks: FundingBlock[] = [];

  if (!inputs.assetHubReady) {
    blocks.push({
      check: 'Asset Hub connection',
      detail:
        'The Asset Hub light client is not synced, so none of this deposit’s checks can be ' +
        'made. The flow is blocked rather than offering to send anyway.',
    });
  }
  if (inputs.amount < inputs.minBalance) {
    blocks.push({
      check: 'Minimum deposit',
      detail:
        `Below the asset’s minimum balance of ${inputs.minBalance}, this deposit would be ` +
        'dusted rather than credited.',
    });
  }
  if (inputs.assetHubBalance.value < inputs.amount + inputs.assetHubFee) {
    blocks.push({
      check: 'Asset Hub balance',
      detail:
        'Your Asset Hub USDC does not cover the amount plus the Asset Hub-side fee. Both are ' +
        'needed: the fee is paid there, not here.',
    });
  }
  // D-13's containment, gated on the bit rather than on a phase number (V-115).
  if (inputs.bootstrapPhase) {
    if (inputs.caps === undefined) {
      blocks.push({
        check: 'Phase-3 exposure caps',
        detail:
          'The chain is still in bootstrap governance, and the deposit caps could not be ' +
          'read. The deposit is blocked rather than proceeding without the limit that ' +
          'applies to it.',
      });
    } else {
      if (inputs.amount > inputs.caps.globalTvlHeadroom.value) {
        blocks.push({
          check: 'Global TVL cap',
          detail: `Only ${inputs.caps.globalTvlHeadroom.value} of headroom remains under the chain-wide cap.`,
        });
      }
      if (inputs.amount > inputs.caps.perAccountHeadroom.value) {
        blocks.push({
          check: 'Per-account deposit cap',
          detail: `Only ${inputs.caps.perAccountHeadroom.value} of headroom remains on your account.`,
        });
      }
    }
  }
  return blocks;
}

/**
 * Degraded XCM health **warns**, it does not block — §11.9.1/§11.9.2.
 *
 * Kept separate from `depositBlocks` on purpose: folding a warning into the block list
 * would stop a lawful deposit, and I-24's fail-static property means the funds are not at
 * decision risk. A client that refused what the chain accepts is the failure 15 §4.8's
 * mirror rule exists to forbid.
 */
export function xcmWarning(inputs: { readonly xcmHealthy: boolean }): string | undefined {
  return inputs.xcmHealthy
    ? undefined
    : 'XCM channel health is degraded, so arrival may be delayed. The transfer is not at ' +
        'risk — it is held, not lost — but it may take longer than usual.';
}

/**
 * How far a deposit has got.
 *
 * `credited` **requires** the futarchy-chain observation: there is no way to reach it from
 * the Asset Hub leg alone, so "AH finalized" can never be rendered as "arrived".
 */
export type DepositProgress =
  | { readonly kind: 'not-sent' }
  | {
      readonly kind: 'sent-awaiting-arrival';
      /** The AH extrinsic, finalized on the Asset Hub connection. */
      readonly assetHubBlock: Verified<number>;
    }
  | {
      readonly kind: 'credited';
      readonly assetHubBlock: Verified<number>;
      /** The credit, observed in **futarchy-chain** finalized state. Not derivable. */
      readonly creditedAtLocalBlock: Verified<number>;
      readonly creditedAmount: Verified<bigint>;
    };

/** In-bundle copy per stage. `sent-awaiting-arrival` is the one that must not overstate. */
export function progressCopy(progress: DepositProgress): string {
  switch (progress.kind) {
    case 'not-sent':
      return 'Nothing has been sent yet.';
    case 'sent-awaiting-arrival':
      return (
        'Sent — awaiting arrival. The Asset Hub side is final, which means the message was ' +
        'sent, not that the funds have arrived. This will say credited when this chain sees ' +
        'the balance in its own finalized state.'
      );
    case 'credited':
      return 'Credited. This chain has seen the balance in its own finalized state.';
  }
}

export interface WithdrawInputs {
  /** **Free** balance only — positions and holds excluded (§11.9.2). */
  readonly freeBalance: Verified<bigint>;
  readonly amount: bigint;
  readonly localFee: bigint;
  readonly minBalance: bigint;
  /** `undefined` when the Asset Hub connection is unavailable — degrades to a warning. */
  readonly destinationViable: boolean | undefined;
  readonly ledgerFrozen: boolean;
}

export function withdrawBlocks(inputs: WithdrawInputs): readonly FundingBlock[] {
  const blocks: FundingBlock[] = [];
  if (inputs.freeBalance.value < inputs.amount + inputs.localFee) {
    blocks.push({
      check: 'Free balance',
      detail:
        'Your free USDC does not cover the amount plus this chain’s fee. Balance held ' +
        'against positions does not count — it is not free to send.',
    });
  }
  const remainder = inputs.freeBalance.value - inputs.amount - inputs.localFee;
  // A remainder between zero and `min_balance` would be dusted. A full withdrawal (exactly
  // zero remainder) is fine, which is why this is a band and not a floor.
  if (remainder > 0n && remainder < inputs.minBalance) {
    blocks.push({
      check: 'Remainder would be dusted',
      detail:
        `Leaving ${remainder} behind is below the minimum balance of ${inputs.minBalance}. ` +
        'Withdraw slightly less, or withdraw everything.',
    });
  }
  if (inputs.ledgerFrozen) {
    blocks.push({
      check: 'Ledger freeze',
      detail: 'A ledger freeze is active. Its frozen scope governs what may still move.',
    });
  }
  return blocks;
}

/**
 * The destination check degrades to a **warning**, never a silent skip (§11.9.2).
 *
 * `undefined` — the Asset Hub connection is down — is distinct from `false`, and both are
 * distinct from `true`. Collapsing unknown into either is what "silently skipped" means.
 */
export function destinationWarning(viable: boolean | undefined): string | undefined {
  if (viable === true) return undefined;
  if (viable === false) {
    return (
      'The destination account on Asset Hub would not survive this transfer. Sending anyway ' +
      'risks the funds being dusted on arrival.'
    );
  }
  return (
    'The Asset Hub connection is unavailable, so the destination account could not be ' +
    'checked. This is a warning rather than a check — it has not been established either way.'
  );
}
