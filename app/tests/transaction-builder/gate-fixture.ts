/** Test-only driver for the quarantined pure gate evaluator. */

import type {
  BuiltFor,
  GateCompat,
  GateOutcome,
  PreconditionResult,
  TxPreparation,
} from '@bleavit/transaction-builder';
import { gateForTest as evaluateGateForTest } from '@bleavit/transaction-builder/testing';
import { ChainHeadConnection } from '@bleavit/chain-client';
import type { FinalizedBlockRef, RuntimeVersionReport } from '@bleavit/chain-client';
import { createMockRuntime } from '@bleavit/mock-runtime';

import { SUBSCRIPTION, bundle, recordedProvider } from '../chain-client/recorded-provider.ts';

const fixtures = bundle();
const runtime = createMockRuntime(fixtures);

const byteHex = (byte: number): string => byte.toString(16).padStart(2, '0');

/** SCALE compact encoding for the block number in a synthetic header. */
function compactBlockNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid test block number ${value}`);
  }
  if (value < 1 << 6) return byteHex(value << 2);
  if (value < 1 << 14) {
    const encoded = (value << 2) | 0b01;
    return `${byteHex(encoded & 0xff)}${byteHex(encoded >>> 8)}`;
  }
  if (value < 1 << 30) {
    let encoded = (BigInt(value) << 2n) | 0b10n;
    let out = '';
    for (let index = 0; index < 4; index += 1) {
      out += byteHex(Number(encoded & 0xffn));
      encoded >>= 8n;
    }
    return out;
  }

  let remaining = BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0n) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  while (bytes.length < 4) bytes.push(0);
  return `${byteHex(((bytes.length - 4) << 2) | 0b11)}${bytes.map(byteHex).join('')}`;
}

const headerFor = (blockNumber: number) =>
  `0x${'00'.repeat(32)}${compactBlockNumber(blockNumber)}`;

/**
 * Open the real nominal transport over the repository's wire-level recorded-provider harness.
 *
 * Only the follow handshake, finalized runtime report and header vary. The public refresh makes
 * no storage/runtime-API calls while its closed evaluator is absent, so any unexpected RPC falls
 * through to the transcript-backed mock and fails.
 */
const DEFAULT_RUNTIME: RuntimeVersionReport = {
  specName: 'bleavit',
  specVersion: 2,
  implVersion: 1,
  transactionVersion: 1,
};

export async function gateConnectionForTest(
  at: FinalizedBlockRef,
  runtimeReport: RuntimeVersionReport | null = DEFAULT_RUNTIME,
): Promise<ChainHeadConnection> {
  const { provider } = recordedProvider(runtime, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: SUBSCRIPTION });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [at.blockHash],
        ...(runtimeReport === null
          ? {}
          : {
              finalizedBlockRuntime: {
                type: 'valid',
                spec: {
                  ...runtimeReport,
                  implName: runtimeReport.specName,
                  authoringVersion: 1,
                  apis: [],
                },
              },
            }),
      } as never);
      return true;
    },
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header') return false;
      if (request.params[1] !== at.blockHash) {
        throw new Error(`gate fixture asked for unexpected header ${String(request.params[1])}`);
      }
      emit({ jsonrpc: '2.0', id: request.id, result: headerFor(at.blockNumber) });
      return true;
    },
  });
  return ChainHeadConnection.open(provider, { chain: at.chain });
}

/**
 * Feed explicit fixture values through the quarantined pure evaluator.
 *
 * These values are deliberately not represented as chain reads. The package's `/testing`
 * subpath exists only for structural machine/signer tests and is forbidden from production
 * packages; the public two-argument refresh boundary cannot call this helper or accept these
 * values. This keeps the old gate-logic coverage without pretending fixtures are proof.
 */
export function gateForTest(
  prep: TxPreparation,
  at: FinalizedBlockRef,
  live: BuiltFor,
  compat: GateCompat,
  results: readonly PreconditionResult[],
): Promise<GateOutcome> {
  return Promise.resolve(evaluateGateForTest(prep, at, live, compat, results));
}
