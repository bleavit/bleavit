// expect-error: TS2345 — 07 §7: the two registry instances keep independent `ClosedAt` maps
// MUST FAIL: an incident filing cannot be admitted by a closure read of the milestone map.
//
// The 2026-08-09 P2, first face. The 08-08 repair made `open` carry proof that a read
// happened, and a fourth-round review asked the next question: proof of **which** read. A
// finalized absence read of the wrong key is still a finalized absence read, so the brand
// admitted it and `filingBlocks` raised nothing.
//
// `pallet-registry` is instantiated twice — `IncidentRegistry` and `MilestoneRegistry` — with
// independent filing-id allocators and independent `ClosedAt` maps. The milestone map holding
// nothing for `(epoch, spec_version)` says exactly nothing about the incident one. And the
// direction is the expensive one: `open` is the arm that **permits**, a filing is bonded, and
// `registry_core::file` then reverts the call the user has already paid for with
// `AlreadyFinal`.
//
// A comparison would have worked and would have been weaker: someone can forget to call one.
// `EpochClosure<K>` is parameterised on the instance and `FilingInputs`' arms take
// `EpochClosure<'incident'>` and `EpochClosure<'milestone'>`, so the mismatch is not a value
// that exists. This is `TriggerState<'GateBreach'>`'s device in another domain.
import { filingBlocks } from '@bleavit/features-tx';
import type { BondQuoteState, EpochClosure, FrozenSpecVersions } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: Verified<number>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
/** A real read, taken through the real producer — of the **other** instance's map. */
declare const milestoneClosure: EpochClosure<'milestone'>;

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  epochClosed: milestoneClosure,
  evidenceHash: '0xevidence',
});
