// expect-error: TS2322 — an `external-proposal` status is the bottom of the lattice and is not assignable where a verified read is required
// MUST FAIL: the whole point of adding `external-proposal` (INV-FE-9, amended).
// A value an external tool requested must be structurally incapable of inhabiting
// the type the transaction path accepts — not merely discouraged from doing so.
import type { Finalized } from '@bleavit/chain-client';
import { externalProposal } from '@bleavit/shared-types';

const asked = externalProposal(1_000_000n);
export const laundered: Finalized<bigint> = asked;
