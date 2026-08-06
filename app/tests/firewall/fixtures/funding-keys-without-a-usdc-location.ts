// expect-error: TS2345 — 02 §7.4/§8: the USDC Location is a per-release pin with no default
// MUST FAIL: `FundingKeyInputs.usdcLocation` is required, so `fundingKeys` cannot be called
// without it. The rule is the one `DepositReadParams.assetId` already follows, and for the
// same reason: a compiled-in default is a release constant that stops tracking the release,
// and 10 §5.4 forbids a chain value appearing as a literal in this source at all.
//
// The failure a default would produce is silent. `ForeignAssets.Account` is keyed by the XCM
// Location of USDC — NOT by the `1337` Asset Hub uses for the same asset (02 §7.7, X-11a) —
// so a stale or defaulted Location builds a well-formed key for an entry nobody holds, the
// read returns nothing, and the withdraw screen renders a confident **0 USDC**.
//
// A mutation sweep is why this fixture exists: making `usdcLocation` optional with a fallback
// was the one defect in this area that the whole suite let through.
import { fundingKeys } from '@bleavit/features-tx';
import type { FundingChain } from '@bleavit/features-tx';

declare const local: FundingChain;
declare const assetHub: FundingChain;

export const keys = fundingKeys({ local, assetHub });
