// expect-error: TS2554 — refreshAndGate takes exactly preparation + nominal connection; derived callback evidence has no injection port
// MUST FAIL — a genuine but irrelevant finalized read cannot launder invented gate verdicts.
import {
  derive,
  type ChainHeadConnection,
  type Finalized,
} from '@bleavit/chain-client';
import {
  refreshAndGate,
  type TxPreparation,
} from '@bleavit/transaction-builder';

declare const prep: TxPreparation;
declare const connection: ChainHeadConnection;
declare const irrelevantRead: Finalized<{ readonly irrelevant: true }>;

const callerEvaluators = {
  runtime: async () =>
    derive(irrelevantRead, () => ({
      specVersion: prep.builtFor.specVersion,
      metadataHash: prep.builtFor.metadataHash,
    })),
  compatibility: async () =>
    derive(irrelevantRead, () => ({
      mode: 'full' as const,
      specVersion: prep.builtFor.specVersion,
      disabled: [],
      proven: [],
    })),
  preconditions: async () => derive(irrelevantRead, () => []),
};

void refreshAndGate(prep, connection, callerEvaluators);
