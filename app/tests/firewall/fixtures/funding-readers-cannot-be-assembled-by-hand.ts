// expect-error: TS2345 — 11 §11.9.1: the two funding readers must be proven to be two chains
// MUST FAIL: `FundingReaders` carries a module-private `unique symbol`, so the only way to
// obtain one is `fundingReaders(local, assetHub)` — which refuses two readers sharing a chain
// identity. A structural `{ local, assetHub }` would be satisfiable by an object literal, and
// the literal below is exactly the mistake the check exists for: one reader used for both
// legs, so every Asset Hub figure on screen is a futarchy-chain read under an Asset Hub label.
// Nothing downstream can detect that — both chains answer every read, and both badges say
// `verified-finalized` while telling the truth about the wrong chain.
import { readDepositInputs } from '@bleavit/features-tx';
import type { FundingDecoders, FundingKeys, FundingReader } from '@bleavit/features-tx';

declare const reader: FundingReader;
declare const keys: FundingKeys;
declare const decoders: FundingDecoders;

export const read = readDepositInputs(
  { local: reader, assetHub: reader },
  keys,
  decoders,
  {
    who: '5Grw',
    assetId: 1337,
    amount: 1n,
    assetHubFee: 1n,
    minBalance: 10_000n,
    xcmHealthy: true,
    assetHubCompatible: true,
  },
);
