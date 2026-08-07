// expect-error: TS2322 — `quoteRedemption` accepts only `Finalized<T>` leaves, and a provider read is a well-formed `Verified<T>` missing the brand (11 §11.4 rule 4)
// MUST FAIL — 11 §11.4 rule 4; INV-FE-1; 11 §11.5 rule 5.
//
// The S4 redemption ticket decides a **payout**, so rule 4 binds it exactly as it binds
// the S3 trade ticket: "provider/local-index data never satisfies any precondition; every
// row reads chain state." §11.5 rule 5 says the same thing about this figure in
// particular — a net redemption payout "is computed from chain-read values or not
// displayed at all".
//
// This is the trade ticket's fixture one module over, and the reason it exists is that
// the trade ticket had one and this module did not. Every other leaf here is a real
// finalized read, the figures are all plausible, and the one provider leaf is a
// perfectly well-formed `Verified<bigint>` — so `quoteRedemption` would return a
// `charged` quote with a `net`, `mayPrepareRedemption` would read that as *this payout
// may be signed*, and the net is emitted above the fold through `AlwaysVisible` because
// 11 §11.2 constraint 3 names it a fact that changes the meaning of the signature.
//
// A runtime guard would have to remember to look at `status.kind` on every leaf, on
// every future leaf, forever. `Finalized<T>` is constructible only inside
// `@bleavit/chain-client`, so the wrong input is untypeable instead.
import { quoteRedemption } from '@bleavit/features-tx';
import { finalize } from '@bleavit/chain-client/testing';
import type { Verified } from '@bleavit/shared-types';
import type { HexString } from '@bleavit/shared-types';

const at = { chain: `0x${'ce'.repeat(32)}` as HexString, blockHash: '0xdead' as HexString, blockNumber: 1_000 };
const read = <T,>(value: T) => finalize(value, at);

// Read from an operator's snapshot rather than from the light client. Nothing about
// the value is wrong — it is the 30 bps this chain really charges — and that is the point.
const rateFromAnOperator: Verified<bigint> = {
  value: 3_000_000n,
  status: { kind: 'provider', providerId: 'operator-1', sampled: true },
};

export const quote = quoteRedemption({
  call: 'redeem_scalar',
  gross: read(10_000_000n),
  rate: { metadataBps: read(30n), paramsPerbill: rateFromAnOperator },
  minSplit: read(10_000n),
});
