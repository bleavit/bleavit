// expect-error: TS2345 — a bare bigint is not a Finalized<bigint>; a fee with no read behind it cannot be priced
// MUST FAIL: 10 §2.3 — the transaction fee estimate MUST be `Finalized<T>`.
//
// 10 §2.3 lists what a payload may take from the user and what it must take from the chain,
// and it names this value in particular: *"named explicitly because it is the one an
// implementer is most likely to take from a wallet or an RPC — the transaction fee estimate
// and the fee headroom a precondition checks against"*. The section then held itself back —
// *"FE-P1 leaves the exact PAPI fee-estimation surface open, so until it resolves the
// conservative reading is in force"* — and while that qualifier stood, `estimateFee` took a
// bare `bigint`, so a wallet's number, an RPC's answer and a literal all entered on the same
// terms as a light-client read, with no type saying otherwise.
//
// FE-P1's fee half is resolved (V-301): PAPI 2.1.8 answers `getEstimatedFees` from
// `TransactionPaymentApi_query_info` issued as `chainHead.call$(null, …)`, and `null`
// resolves to the finalized hash — so the figure *is* obtainable as `Finalized<bigint>` and
// there is no longer any reason to accept one that is not.
import { admitRate, estimateFee } from '@bleavit/transaction-builder';
import type { GatePassed } from '@bleavit/transaction-builder';
import { finalize } from '@bleavit/chain-client/testing';

const PIN = {
  chain: `0x${'ce'.repeat(32)}` as const,
  blockHash: `0x${'11'.repeat(32)}` as const,
  blockNumber: 1,
};

const rate = admitRate(finalize({ value: 1_000_000n, reference: 1_000_000n, scale: 1_000_000n }, PIN));

// `declare const`, not a cast and not a forged value. `GatePassed` carries a non-exported
// `unique symbol`, so nothing outside the package can mint one — and a fixture that faked it
// would emit a *second* TS2345, at which point this file would fail for two reasons and prove
// neither. A declaration has a type and no value, so it contributes no diagnostic at all.
declare const passed: GatePassed;

// The rate is a genuine read. The fee is not — and that is the whole of what must fail.
export const estimate = estimateFee(passed, 1_000n, rate, 'USDC');
