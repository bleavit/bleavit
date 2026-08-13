// expect-error: TS2305 — GateRefreshReads was the caller-controlled proof-injection interface and no longer exists
// MUST FAIL — INV-FE-2/12: production callers may not supply executable gate evaluators.
import type { GateRefreshReads } from '@bleavit/transaction-builder';

export type ForbiddenGateCallbacks = GateRefreshReads;
