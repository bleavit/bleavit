/** Test-only driver for the production `refreshAndGate` boundary. */

import { refreshAndGate } from '@bleavit/transaction-builder';
import type {
  BuiltFor,
  GateCompat,
  GateOutcome,
  PreconditionResult,
  TxPreparation,
} from '@bleavit/transaction-builder';
import { ChainHeadConnection } from '@bleavit/chain-client';
import type { FinalizedBlockRef } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
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
 * Only the follow handshake and header vary: callbacks below deliberately perform no storage or
 * runtime calls, so an unexpected RPC falls through to the transcript-backed mock and fails.
 */
export async function gateConnectionForTest(
  at: FinalizedBlockRef,
): Promise<ChainHeadConnection> {
  const { provider } = recordedProvider(runtime, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: SUBSCRIPTION });
      followEvent({ event: 'initialized', finalizedBlockHashes: [at.blockHash] });
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
 * Feed explicit fixture values through the real refresh owner.
 *
 * The literals are branded only here, through the quarantined chain-client testing surface;
 * production code cannot import that mint. This keeps gate-logic tests compact while ensuring
 * the package barrel exposes no caller-fabricable proof constructor.
 */
export function gateForTest(
  prep: TxPreparation,
  at: FinalizedBlockRef,
  live: BuiltFor,
  compat: GateCompat,
  results: readonly PreconditionResult[],
): Promise<GateOutcome> {
  return gateConnectionForTest(at).then(async (connection) => {
    try {
      return await refreshAndGate(prep, connection, {
        runtime: async () => finalize(live, at),
        compatibility: async () => finalize(compat, at),
        preconditions: async () => results.map((result) => finalize(result, result.at)),
      });
    } finally {
      connection.close();
    }
  });
}
