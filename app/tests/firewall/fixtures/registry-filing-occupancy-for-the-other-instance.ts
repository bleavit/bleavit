// expect-error: TS2345 — 07 §7: `FilingCount` is per instance, and the allocators are separate
// MUST FAIL: an incident filing cannot be admitted by the milestone registry's occupancy count.
//
// Found by mutation, not by review, and it is worth saying which. The epoch half of this
// reading is compared in `filingBlocks` and a test covers it; the **instance** half is carried
// by `FilingOccupancy<K>`'s type parameter, and a mutant that kept `K` declared while widening
// the field to `RegistrySubject<FilingKind>` passed the entire suite. A type parameter proves
// nothing until something tries to violate it — which is what this corpus is for, and why a
// binding asserted only by a green run is a binding nobody has seen fire.
//
// The defect it forbids is the one 07 §7 makes structural: `FilingCount` is keyed by epoch
// **per instance**, the two registries allocate independently, and `used < bound` is the
// permitting comparison. A quiet milestone registry therefore admits a filing into a full
// incident one — after the bond is committed, which is what makes it expensive rather than
// merely wrong.
import { filingBlocks } from '@bleavit/features-tx';
import type {
  BondQuoteState,
  EpochClosure,
  FilingOccupancy,
  FrozenSpecVersions,
} from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
declare const epochClosed: EpochClosure<'incident'>;
/** A real count, of a real map, for the right epoch — on the **other** instance. */
declare const filingsUsed: FilingOccupancy<'milestone'>;

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  epochClosed,
  evidenceHash: '0xevidence',
});
