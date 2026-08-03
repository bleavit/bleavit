// MUST COMPILE. Anti-vacuity: without this, a corpus in which every fixture failed
// for some unrelated reason (a broken tsconfig, a missing lib) would look like a
// working firewall. This asserts the toolchain is capable of succeeding.
import { externalProposal } from '@bleavit/shared-types';
import { hasFinalizedStatus } from '@bleavit/chain-client';

export const asked = externalProposal(1_000_000n);
export const notFinalized = hasFinalizedStatus(asked);
