// expect-error: TS2305 — the plain-value gate is private; callers must use refreshAndGate, which owns the finalized reads (INV-FE-2)
// MUST FAIL — 11 §11.4 rule 1; INV-FE-2.
import { gate } from '@bleavit/transaction-builder';

export const bypass = gate;
