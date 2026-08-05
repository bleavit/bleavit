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
import { estimateFee, type VitUsdcRate } from '@bleavit/transaction-builder';

const fabricated: VitUsdcRate = { value: 100_000n, reference: 1_000n, scale: 1n };

export const estimate = estimateFee(1_000n, fabricated, 'USDC');
