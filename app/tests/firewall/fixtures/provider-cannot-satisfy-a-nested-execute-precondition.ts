// expect-error: TS2322 — `mayExecute`'s **nested** capability structure accepts only `Finalized<T>`; a provider read is a well-formed `Verified<T>` and still not assignable (11 §11.4 rule 4)
// MUST FAIL — 11 §11.4 rule 4; INV-FE-3; 11 §11.5 P-12; AGENTS.md R-7.
//
// This is the S6 execution gate, which R-7 puts in the strictest class: passing it is what
// enables a signature that dispatches a governance mandate. Rule 4 binds all fourteen rows.
//
// The provider leaf is **nested**, inside `CapabilityInputs`, and that is the whole reason
// this fixture exists beside the S5 one. Branding only the top-level fields of `ExecuteInputs`
// would leave the capability, suspension, lock, retry and bounds structures as ordinary
// object literals — so a gate that looked fully typed would still accept an operator's
// answer to "does the constitution's capability table admit this class origin", which is
// one of the two claims row 7 makes and the one a user cannot check by eye.
//
// Nothing about the value is wrong. `Verified<boolean>` is a perfectly well-formed status,
// every other row here passes, and `mayExecute` would return `true`.
import { mayExecute } from '@bleavit/features-tx';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString, Verified } from '@bleavit/shared-types';

const at = {
  chain: `0x${'ce'.repeat(32)}` as HexString,
  blockHash: `0x${'11'.repeat(32)}` as HexString,
  blockNumber: 900_000,
};
const read = <T,>(value: T) => finalize(value, at);

const admittedByAnOperator: Verified<boolean> = {
  value: true,
  status: { kind: 'provider', providerId: 'operator-1', sampled: true },
};

export const mayGo = mayExecute({
  klass: read('Param'),
  queued: read(true),
  cancelled: read(false),
  now: read(1_000),
  maturity: read(900),
  graceEnd: read(1_100),
  retry: { failedAt: read(undefined), retryWindow: read(43_200) },
  preimagePresent: read(true),
  preimageHashMatches: read(true),
  runtimeVersionMatches: read(true),
  ratification: read('NotRequired'),
  attestationRecordsIntact: read(true),
  capability: {
    domainsWithinDeclared: read(true),
    rulesAdmitClass: admittedByAnOperator,
  },
  metersClear: read(true),
  resourceLocks: { declared: read([]), held: read([]) },
  suspension: {
    suspendedForEpoch: undefined,
    currentEpoch: read(7),
    delayedOnce: read(false),
  },
  hardGateBreach: read(false),
  deadMan: { guardLatch: read(false), phaseFlagBit: read(false) },
  triggeringFreeze: {
    ledgerFrozen: read(false),
    migrationHalt: read(false),
    expedited: read(false),
  },
  batchBounds: {
    decodable: read(true),
    callCount: read(1),
    maxCalls: read(16),
    payloadBytes: read(64),
    maxPayloadBytes: read(65_536),
    declaredWeightWithinLimit: read(true),
    safetyFilterClosed: read(true),
  },
});
