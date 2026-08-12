// expect-error: TS2322 — a signing request cannot pair a valid gate proof with independent bytes or an account (INV-FE-14)
// MUST FAIL — 11 §11.3–§11.4; INV-FE-2, INV-FE-14.
import type { SigningRequest } from '@bleavit/signing';
import type { GatePassed } from '@bleavit/transaction-builder';

declare const window: GatePassed;

export const substituted: SigningRequest = {
  window,
  account: '5Attacker',
};
