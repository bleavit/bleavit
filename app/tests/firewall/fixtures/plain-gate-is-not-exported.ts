// expect-error: TS2305 — the plain-value gate is withheld; the public boundary currently fails closed (INV-FE-2/12)
// MUST FAIL — 11 §11.4 rule 1; INV-FE-2.
import { gate } from '@bleavit/transaction-builder';

export const bypass = gate;
