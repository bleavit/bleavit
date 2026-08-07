// expect-error: TS2345 — a bare VitUsdcRate is not an AdmittedRate; the bounds check is not bypassable
// MUST FAIL: 11 §11.3 — a fee estimate must come from the *live bounded* rate.
//
// `admitRate` used to return the same `VitUsdcRate` it was handed, so its [0.1×, 10×] check
// was advisory: any caller could build a rate literal — or take one from a provider read —
// and hand it straight to `estimateFee`. Every test called `admitRate` first, so the
// omission was invisible; the suite proved the checker worked and never that anything used
// it. What an out-of-band rate buys is a number on a confirm screen: a 100× rate makes the
// fee look negligible in the currency the user is reading, so the figure they consent to is
// not the figure the chain charges.
//
// The *fee* below is a genuine read, deliberately. `estimateFee` also refuses an unsourced
// fee now (see `unsourced-fee-estimate.ts`), and a fixture failing for both reasons at once
// would stop proving either — a corpus that cannot say which control fired is the vacuum
// V-91 was about. So only the rate is fabricated here.
import { estimateFee, type GatePassed, type VitUsdcRate } from '@bleavit/transaction-builder';
import { finalize } from '@bleavit/chain-client/testing';

const PIN = {
  chain: `0x${'ce'.repeat(32)}` as const,
  blockHash: `0x${'11'.repeat(32)}` as const,
  blockNumber: 1,
};

const fabricated: VitUsdcRate = { value: 100_000n, reference: 1_000n, scale: 1n };

// Declared rather than built, for the same reason the fee below is a genuine read: a forged
// gate would emit its own TS2345 and this fixture would stop proving which control fired.
declare const passed: GatePassed;

export const estimate = estimateFee(passed, finalize(1_000n, PIN), finalize(fabricated, PIN), 'USDC');
