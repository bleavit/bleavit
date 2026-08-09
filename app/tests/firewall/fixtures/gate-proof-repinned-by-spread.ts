// expect-error: TS2345 — INV-FE-2, 11 §11.4: a gate proof is pinned to the block it ran at
// MUST FAIL: spreading a genuine `GatePassed` and replacing `at` re-pins a real proof.
//
// The 2026-08-09 sweep, applied to the brand with the most consequence in the workspace.
// `unguarded-signature.ts` proves a `GatePassed` cannot be assembled. This proves one cannot be
// re-pinned, which needs no cast either:
//
//   const forged = { ...passed, at: someOtherBlock };
//
// `prep` defends itself — `reduce` and `operatorGate` both compare it by **identity**, so a
// substituted preparation is a different object and the comparison fires. `at` has no such
// comparison anywhere, and three consumers read it in a permitting position: `mortalityFor`
// anchors the era at `passed.at.blockNumber` (which *is* the staleness bound), the raw external
// signer is told `atBlock: request.window.at.blockNumber`, and `estimateFee`/`signedNonce`
// refuse an off-block fee or nonce by comparing it against `read.status.blockHash`. A re-pinned
// proof makes those two refusals agree with whatever block the read really came from.
//
// The repair is `ProducedByGate`, a phantom marker carrying a `#private` member — the one member
// kind TypeScript drops from a spread type.
import { estimateFee } from '@bleavit/transaction-builder';
import type { AdmittedRate, GatePassed } from '@bleavit/transaction-builder';
import type { Finalized, FinalizedBlockRef } from '@bleavit/chain-client';

declare const passed: GatePassed;
declare const feeInVit: Finalized<bigint>;
declare const rate: Finalized<AdmittedRate>;
/** Any other finalized block. The gate did not run at it. */
declare const elsewhere: FinalizedBlockRef;

export const estimate = estimateFee(
  // A genuine proof, re-pinned. Every other field is the real one.
  { ...passed, at: elsewhere },
  feeInVit,
  rate,
  'VIT',
);
