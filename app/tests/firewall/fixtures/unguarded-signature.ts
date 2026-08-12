// expect-error: TS2739 — the forged `GatePassed` is missing both private brands, so an unguarded signature does not typecheck (11 §11.4 rule 1)
// MUST FAIL — 11 §11.4 rule 1; INV-FE-2.
//
// "Every submit path passes through `refreshAndGate` — structurally (the tx machine has
// no bypass edge), not by convention." The machine's edge set carries half of that; this
// carries the other half, at the package boundary: a caller cannot hand a signer a
// hand-written proof that the gate ran.
//
// `GatePassed` is branded with a non-exported `unique symbol` for the same reason
// `Finalized<T>` is. Without it this object literal — which names every field the type
// documents — would open a signature against state nobody re-read, and the failure would
// be invisible: the transaction would simply revert on chain some of the time.
import type { GatePassed, TxPreparation } from '@bleavit/transaction-builder';
import { MockSigner } from '@bleavit/signing/testing';

const chain = `0x${'ce'.repeat(32)}` as const;
const prep: TxPreparation = {
  scaleHex: '0x0403aabbcc',
  signingAccount: '5Grw',
  builtFor: { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` },
  preparedAt: { chain, blockHash: `0x${'22'.repeat(32)}`, blockNumber: 99 },
  requires: ['P-1'],
  feeAsset: 'USDC',
};

const forged: GatePassed = {
  at: { chain, blockHash: `0x${'11'.repeat(32)}`, blockNumber: 100 },
  prep,
  authorization: { scaleHex: prep.scaleHex, account: prep.signingAccount },
  results: [],
};

export const signed = new MockSigner().sign({
  window: forged,
});
