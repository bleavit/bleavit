// expect-error: TS2322 — `tradeBlocks` accepts only `Finalized<T>` leaves, and a provider read is a well-formed `Verified<T>` missing the brand (11 §11.4 rule 4)
// MUST FAIL — 11 §11.4 rule 4; INV-FE-3; 11 §11.5 P-1.
//
// The S3 trade ticket is a precondition evaluator, so rule 4 binds it exactly as it
// binds `evaluate`: "provider/local-index data never satisfies any precondition; every
// row reads chain state."
//
// This fixture is the case that makes the type worth having. Every other leaf here is a
// real finalized read, the values are all plausible, and the one provider leaf is a
// perfectly well-formed `Verified<bigint>` — so the ticket would evaluate, find nothing
// wrong, and return an empty block list. An empty block list is what `mayPrepareTrade`
// reads as *every precondition passed*, which is how an operator snapshot would walk a
// user to a signature the chain refuses.
//
// A runtime guard would have to remember to look at `status.kind` on every leaf, on
// every future leaf, forever. `Finalized<T>` is constructible only inside
// `@bleavit/chain-client`, so the wrong input is untypeable instead.
import { tradeBlocks } from '@bleavit/features-tx';
import { finalize } from '@bleavit/chain-client/testing';
import type { Verified } from '@bleavit/shared-types';
import type { HexString } from '@bleavit/shared-types';

const at = { chain: `0x${'ce'.repeat(32)}` as HexString, blockHash: '0xdead' as HexString, blockNumber: 1_000 };
const read = <T,>(value: T) => finalize(value, at);

// Read from an operator's snapshot rather than from the light client. Nothing about
// the value is wrong — that is the point.
const balanceFromAnOperator: Verified<bigint> = {
  value: 5_000_000n,
  status: { kind: 'provider', providerId: 'operator-1', sampled: true },
};

export const blocks = tradeBlocks({
  book: { kind: 'decision', domain: 'primary' },
  order: { direction: 'buy', maxCost: 1_003_000n },
  proposalState: read('Trading' as const),
  marketOpen: read(true),
  fee: { metadataBps: read(30n), paramsPerbill: read(3_000_000n) },
  quote: {
    fromChain: read({ cost: 1_000_000n, fee: 3_000n }),
    fromClient: { cost: 1_000_000n, fee: 3_000n },
  },
  amount: 1_000_000n,
  minTrade: read(10_000n),
  maxTrade: read(50_000_000n),
  spendable: balanceFromAnOperator,
  tradingEnabled: read(true),
  ledgerFrozen: read(false),
});
