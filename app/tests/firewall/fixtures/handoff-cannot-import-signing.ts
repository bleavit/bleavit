// expect-error: TS2305 — the handoff packages may name `chain-client` but not a signing export (D-21)
// MUST FAIL: 10 §10.1 — `llm-handoff`, `contexts`, `intents` and `receipts` may not
// reach `signing` or `transaction-builder`. The import path's only output is a
// TxPreparation entering Draft; it must not be able to touch a signer at all.
import { anything } from '@bleavit/signing';
export const x = anything;
