// expect-error: TS2345 — a structural transport is not a live gate-refresh capability
import { refreshAndGate } from '@bleavit/transaction-builder';
import type { TxPreparation } from '@bleavit/transaction-builder';
import type { ChainHeadTransport } from '@bleavit/chain-client';

declare const prep: TxPreparation;
declare const transport: ChainHeadTransport;

void refreshAndGate(prep, transport);
