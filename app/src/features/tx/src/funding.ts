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
  /**
   * AH-side USDC, read on the Asset Hub connection at its own finalized block.
   *
   * `undefined` when the record was read and could not be decoded. It is deliberately not a
   * substituted `0n`: 10 §2.2 assigns `verified-finalized` *"only to values read through
   * smoldot with storage proofs checked"*, so a manufactured zero has no badge it may wear,
   * and INV-FE-12 forbids guessing at an encoding rather than showing the raw bytes. The
   * check below blocks on the absence, which is the direction the old zero produced anyway —
   * what it did not do was stop the screen showing that zero as a chain answer.
   *
   * An **absent Asset Hub account** is a different fact and remains a badged `0n`: the chain
   * did answer, and its answer is that the account holds nothing.
   */
  readonly assetHubBalance: Verified<bigint> | undefined;
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
  if (inputs.assetHubBalance === undefined) {
    blocks.push({
      check: 'Asset Hub balance',
      detail:
        'Your Asset Hub USDC record was read but could not be decoded, so this client cannot ' +
        'say whether it covers the amount plus the Asset Hub-side fee. The deposit is blocked ' +
        'rather than checked against a balance nobody stated. The raw bytes are shown below.',
    });
  } else if (inputs.assetHubBalance.value < inputs.amount + inputs.assetHubFee) {
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

/**
 * A progress observation that would put one chain's block under the other's label.
 *
 * The tracker's whole claim is *which chain saw what*, so a leaf read on the wrong one makes
 * every arm of {@link DepositProgress} say something false: `sent-awaiting-arrival` would name
 * a futarchy block as the Asset Hub extrinsic's, and `credited` would report *"this chain has
 * seen the balance in its own finalized state"* about Asset Hub. That is
 * `readDepositInputs(reader, reader, …)` at the tracker, and no badge can detect it — both
 * reads are genuine, both carry `verified-finalized`, and both are true about the wrong chain.
 */
export class WrongChainProgressError extends Error {
  constructor(leg: string, expected: string, actual: string | undefined) {
    super(
      `the ${leg} observation was read on chain ${String(actual)} while that leg follows ` +
        `${expected}. A tracker built from it would attribute one chain's block to the other, ` +
        'which is a true reading under a false label (11 §11.9.1).',
    );
    this.name = 'WrongChainProgressError';
  }
}

/** An Asset Hub observation the `sent` copy would misdescribe. See {@link depositProgress}. */
export class UnfinalizedProgressError extends Error {
  constructor(status: string) {
    super(
      `the Asset Hub observation carries ${status}, and the tracker states "The Asset Hub side ` +
        'is final" as a fact. A best-head inclusion can still reorg away, so it is not the ' +
        'evidence that sentence claims (11 §11.9).',
    );
    this.name = 'UnfinalizedProgressError';
  }
}

/** A credit whose two leaves describe different blocks — see {@link depositProgress}. */
export class MixedBlockProgressError extends Error {
  constructor(atBlock: string, amount: string) {
    super(
      `the credited block (${atBlock}) and the credited amount (${amount}) were read at ` +
        'different blocks, so together they describe a state that never existed (INV-FE-2).',
    );
    this.name = 'MixedBlockProgressError';
  }
}

/** What each leg observed. Both legs are optional; neither is inferred from the other. */
export interface DepositObservations {
  /**
   * The deposit extrinsic's block on **Asset Hub**, or `undefined` for *not sent*.
   *
   * Absence is a real state rather than a missing input: before the user submits, there is no
   * Asset Hub block, and `not-sent` is the honest rendering.
   */
  readonly assetHubBlock: Verified<number> | undefined;
  /**
   * The credit, observed on the **futarchy chain**, or `undefined` while it has not been.
   *
   * Both leaves come from the local reader at one block. They travel together rather than as
   * two fields of `DepositObservations`, because a credited amount with no block, or a block
   * with no amount, is not half an observation — it is one that was never made.
   */
  readonly credit:
    | { readonly atBlock: Verified<number>; readonly amount: Verified<bigint> }
    | undefined;
  /** The genesis hash of the connection the local reads came from. */
  readonly localChain: string;
  /** The genesis hash of the Asset Hub connection. Refused when it equals `localChain`. */
  readonly assetHubChain: string;
}

/** The chain a status names, or `undefined` for the four statuses that name none. */
function chainOf(datum: Verified<unknown>): string | undefined {
  return 'chain' in datum.status ? datum.status.chain : undefined;
}

/**
 * Assemble the tracker's state from what each connection observed — 11 §11.9's arrival rule.
 *
 * > Arrival tracking: local finality on AH ≠ delivery. The tracker shows "sent — awaiting
 * > arrival" until the **futarchy-chain** connection observes the balance credit in finalized
 * > state.
 *
 * The union already makes `credited` unreachable from the Asset Hub leg alone — its
 * `creditedAtLocalBlock` field has nothing to fill it from. What a *producer* can still get
 * wrong is the identity of the leaf it fills it with, and that is what this function refuses:
 *
 * - **The two chains must differ.** Two readers on one chain is the defect `fundingReaders`
 *   refuses at the read layer, and it reaches here through the same single-character slip.
 * - **Each leaf must carry its own leg's chain.** An Asset Hub credit read would satisfy every
 *   type in sight and render as *this chain has seen the balance in its own finalized state*.
 * - **`credited` requires a `verified-finalized` local read.** A `verified-best` credit is not
 *   a weaker credit, it is the *in-between* state §11.9 names — so it yields
 *   `sent-awaiting-arrival`, which is exactly what the sentence above prescribes.
 *
 * The last rule is deliberately asymmetric: an unfinalized **Asset Hub** observation *throws*
 * rather than degrading, because there is no arm whose copy it fits. `sent-awaiting-arrival`
 * tells the user *"The Asset Hub side is final"*, and `not-sent` says *"Nothing has been sent
 * yet"*; a best-head inclusion is neither, and picking one would make the tracker state a fact
 * the read does not support.
 */
export function depositProgress(observations: DepositObservations): DepositProgress {
  const { assetHubBlock, credit, localChain, assetHubChain } = observations;
  if (localChain === assetHubChain) {
    throw new WrongChainProgressError('Asset Hub', `a chain other than ${localChain}`, assetHubChain);
  }

  if (assetHubBlock === undefined) {
    if (credit !== undefined) {
      // Not `not-sent`: that would discard an observed credit and tell the user nothing has
      // been sent while their funds are on this chain. `credited` cannot be built either —
      // it has no Asset Hub block to name — so the observation is refused rather than rounded.
      throw new Error(
        'a credit was observed with no Asset Hub block. The credited state names the block the ' +
          'deposit was sent in, and reporting "not sent" instead would deny a transfer this ' +
          'chain has already seen (11 §11.9).',
      );
    }
    return { kind: 'not-sent' };
  }

  if (chainOf(assetHubBlock) !== assetHubChain) {
    throw new WrongChainProgressError('Asset Hub', assetHubChain, chainOf(assetHubBlock));
  }
  if (assetHubBlock.status.kind !== 'verified-finalized') {
    throw new UnfinalizedProgressError(assetHubBlock.status.kind);
  }

  if (credit === undefined) return { kind: 'sent-awaiting-arrival', assetHubBlock };

  for (const [label, leaf] of [
    ['credited block', credit.atBlock],
    ['credited amount', credit.amount],
  ] as const) {
    if (chainOf(leaf) !== localChain) {
      throw new WrongChainProgressError(`local ${label}`, localChain, chainOf(leaf));
    }
  }
  // Not yet final on this chain is not yet credited — §11.9's "until … in finalized state".
  if (
    credit.atBlock.status.kind !== 'verified-finalized' ||
    credit.amount.status.kind !== 'verified-finalized'
  ) {
    return { kind: 'sent-awaiting-arrival', assetHubBlock };
  }
  if (credit.atBlock.status.blockHash !== credit.amount.status.blockHash) {
    throw new MixedBlockProgressError(
      credit.atBlock.status.blockHash,
      credit.amount.status.blockHash,
    );
  }

  return {
    kind: 'credited',
    assetHubBlock,
    creditedAtLocalBlock: credit.atBlock,
    creditedAmount: credit.amount,
  };
}

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
  /**
   * **Free** balance only — positions and holds excluded (§11.9.2).
   *
   * `undefined` when the record could not be decoded, for the reason `DepositInputs`
   * gives. The dust-remainder check is skipped too: a remainder computed from a balance
   * nobody stated would name an exact figure the client cannot support.
   */
  readonly freeBalance: Verified<bigint> | undefined;
  readonly amount: bigint;
  readonly localFee: bigint;
  readonly minBalance: bigint;
  /** `undefined` when the Asset Hub connection is unavailable — degrades to a warning. */
  readonly destinationViable: boolean | undefined;
  readonly ledgerFrozen: boolean;
}

export function withdrawBlocks(inputs: WithdrawInputs): readonly FundingBlock[] {
  const blocks: FundingBlock[] = [];
  if (inputs.freeBalance === undefined) {
    blocks.push({
      check: 'Free balance',
      detail:
        'Your USDC record was read but could not be decoded, so this client cannot say what ' +
        'is free to send. The withdrawal is blocked rather than checked against a balance ' +
        'nobody stated. The raw bytes are shown below.',
    });
  } else {
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
