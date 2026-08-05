/**
 * A JSON-RPC provider backed by F2's recorded chainHead transcripts.
 *
 * This is the piece that makes the transport testable per commit. `getSmProvider` hands
 * PAPI a `(onMessage) => {send, disconnect}` function; so does this. The transport under
 * test therefore runs its *real* code path — request ids, the follow subscription,
 * operation demultiplexing, the started/items/done handshake — against traffic a booted
 * release node actually produced, with no node and no network.
 *
 * Two things it deliberately does **not** fake:
 *
 * - It never invents a response. Anything the transcripts do not contain reaches
 *   `runtime.respond()` and throws `UnrecordedRequestError`, so a transport that started
 *   asking for something new fails loudly instead of being quietly humoured.
 * - It does not paper over what the recorder did not capture. The recorder synthesised
 *   the follow subscription (`subscription-1`) rather than recording the handshake, and
 *   every operation it recorded got the id `operation-1`. Both are supplied here, and
 *   both are stated rather than hidden: the transcripts pin the *operation* protocol, not
 *   the follow handshake, and concurrent operations are outside what they can prove.
 *
 * **On the types.** `FollowEvent` is a union rather than `Record<string, unknown>`, and
 * that is the point of typing this file at all: every failure branch of the transport is
 * driven by an *injected* event, because the recorder only ever met a healthy node — so a
 * misspelled `event` name or a missing `operationId` would produce a test that exercises
 * the transport's "unknown event, ignore it" path while reading as a passing failure-mode
 * test. The union's members carry exactly the fields `transport.ts` reads, no more: it
 * describes what the double must be able to say, not the full chainHead-v1 schema.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createFixtureBundle, createMockRuntime } from '@bleavit/mock-runtime';
import type { Fixture, FixtureBundle, FixturesReport, MockRuntime } from '@bleavit/mock-runtime';
import type {
  JsonRpcConnectionLike,
  JsonRpcId,
  JsonRpcMessageLike,
  JsonRpcProviderLike,
  JsonRpcRequestLike,
  StorageQueryType,
} from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');
export const SUBSCRIPTION = 'subscription-1';

export function bundle(): FixtureBundle {
  const names = readdirSync(FIXTURE_DIR).filter(
    (n) => n.endsWith('.json') && n !== 'fixtures-report.json',
  );
  const report = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'),
  ) as FixturesReport;
  return createFixtureBundle(
    report,
    names.map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), 'utf8')) as Fixture),
  );
}

/* --------------------------------------------------------------- the wire vocabulary */

/** A `chainHead_v1_followEvent` payload, carrying the fields `transport.ts` reads. */
export type FollowEvent =
  | {
      readonly event: 'initialized';
      readonly finalizedBlockHashes?: readonly HexString[];
      readonly finalizedBlockHash?: HexString;
    }
  | { readonly event: 'newBlock'; readonly blockHash: HexString; readonly parentBlockHash?: HexString }
  | { readonly event: 'bestBlockChanged'; readonly bestBlockHash: HexString }
  | {
      readonly event: 'finalized';
      readonly finalizedBlockHashes: readonly HexString[];
      readonly prunedBlockHashes?: readonly HexString[];
    }
  | {
      readonly event: 'operationStorageItems';
      readonly operationId: string;
      readonly items: readonly { readonly key: HexString; readonly value?: HexString }[];
    }
  | { readonly event: 'operationStorageDone'; readonly operationId: string }
  | { readonly event: 'operationCallDone'; readonly operationId: string; readonly output: HexString }
  | { readonly event: 'operationWaitingForContinue'; readonly operationId: string }
  | { readonly event: 'operationError'; readonly operationId: string; readonly error: string }
  | { readonly event: 'operationInaccessible'; readonly operationId: string }
  | { readonly event: 'stop' };

/**
 * A request as the suites read it back off the wire.
 *
 * `params` is an array here while `JsonRpcRequestLike.params` is `unknown`, because the
 * assertions this double exists for are positional — *which block a read was issued
 * against* is `params[1]`, the V-84 property. `send()` refuses a non-array rather than
 * casting: a transport that started sending by-name parameters would otherwise index
 * `undefined` and read as a passing test.
 */
export interface SentRequest {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params: readonly unknown[];
  readonly id: JsonRpcId;
}

/** What a recorded exchange replays: the direct answer, then any follow events. */
interface RecordedExchange {
  readonly direct: { readonly result: unknown };
  readonly events?: readonly FollowEvent[] | null;
}

/** The `{key, type}` pair a recorded storage request carried. */
export interface StorageQuery {
  readonly key: HexString;
  readonly type: StorageQueryType;
}

/* ------------------------------------------------------------------- the double */

/** Emit helpers handed to the injection hooks. */
export interface EmitHooks {
  readonly emit: (message: JsonRpcMessageLike) => void;
  readonly followEvent: (result: FollowEvent) => void;
}

export interface FollowHookArgs extends EmitHooks {
  readonly id: JsonRpcId;
}

export interface RecordedProviderOptions {
  /** Take over `chainHead_v1_follow`. Return `true` to suppress the default handshake. */
  readonly onFollow?: (args: FollowHookArgs) => boolean | undefined;
  /** Take over any other request. Return `true` to suppress the recorded reply. */
  readonly intercept?: (request: SentRequest, hooks: EmitHooks) => boolean | undefined;
}

export interface RecordedProviderState {
  finalized: HexString;
  onMessage: ((message: JsonRpcMessageLike) => void) | undefined;
  /** Emit a follow event out of band — how the suites advance the head mid-test. */
  followEvent: (result: FollowEvent) => void;
  disconnected?: boolean;
}

export interface RecordedProvider {
  readonly provider: JsonRpcProviderLike;
  readonly sent: readonly SentRequest[];
  readonly state: RecordedProviderState;
}

/**
 * Build a provider over a mock runtime.
 *
 * `sent` accumulates every outbound request, which is how the suites assert *which block
 * a read was issued against* — the property V-84 was about. Asserting on the returned
 * value cannot catch that: the value is correct, only its label is wrong.
 */
export function recordedProvider(
  runtime: MockRuntime,
  options: RecordedProviderOptions = {},
): RecordedProvider {
  const sent: SentRequest[] = [];
  const notFollowingYet = (): never => {
    throw new Error('followEvent() before the provider was connected');
  };
  const state: RecordedProviderState = {
    finalized: runtime.pinnedBlock() as HexString,
    onMessage: undefined,
    followEvent: notFollowingYet,
  };

  const provider: JsonRpcProviderLike = (onMessage) => {
    state.onMessage = onMessage;
    const emit = (message: JsonRpcMessageLike): void => queueMicrotask(() => onMessage(message));
    const followEvent = (result: FollowEvent): void =>
      emit({
        jsonrpc: '2.0',
        method: 'chainHead_v1_followEvent',
        params: { subscription: SUBSCRIPTION, result },
      });
    state.followEvent = followEvent;

    const connection: JsonRpcConnectionLike = {
      send(request: JsonRpcRequestLike) {
        if (!Array.isArray(request.params)) {
          throw new Error(
            `${request.method} was sent with non-positional params; the transcripts and ` +
              `every positional assertion in these suites read params by index`,
          );
        }
        const seen: SentRequest = {
          jsonrpc: request.jsonrpc,
          method: request.method,
          params: request.params,
          id: request.id ?? null,
        };
        sent.push(seen);
        const { id, method, params } = seen;

        if (method === 'chainHead_v1_follow') {
          // `onFollow` exists for the boot-failure branch: a node can answer the follow
          // and then stop before `initialized`, and that sequence cannot be reached
          // through `intercept`, which runs after this.
          if (options.onFollow?.({ id, emit, followEvent })) return;
          emit({ jsonrpc: '2.0', id, result: SUBSCRIPTION });
          followEvent({ event: 'initialized', finalizedBlockHashes: [state.finalized] });
          return;
        }
        // Acknowledgement of a paused operation; the node returns nothing.
        if (method === 'chainHead_v1_continue') return;
        // Releasing pins as finality advances; the node answers `null`.
        if (method === 'chainHead_v1_unpin') {
          emit({ jsonrpc: '2.0', id, result: null });
          return;
        }

        if (options.intercept?.(seen, { emit, followEvent })) return;

        const recorded = runtime.respond(method, params) as RecordedExchange;
        emit({ jsonrpc: '2.0', id, result: recorded.direct.result });
        for (const event of recorded.events ?? []) followEvent(event);
      },
      disconnect() {
        state.disconnected = true;
      },
    };
    return connection;
  };

  return { provider, sent, state };
}

/**
 * The first — or last — outbound request of a method, or a throw naming what was absent.
 *
 * A throw rather than `undefined`: every caller goes on to index `params` positionally, so
 * a missing request would otherwise surface as "cannot read property 1 of undefined" at a
 * line that reads like the assertion, rather than as "the transport never issued a storage
 * request", which is the actual finding.
 */
export function sentWith(
  sent: readonly SentRequest[],
  method: string,
  which: 'first' | 'last' = 'first',
): SentRequest {
  const matches = sent.filter((r) => r.method === method);
  const found = which === 'first' ? matches[0] : matches.at(-1);
  if (found === undefined) {
    throw new Error(`the transport sent no ${method} request (sent: ${sent.map((r) => r.method).join(', ')})`);
  }
  return found;
}

/** One recorded request of a given method, or a throw naming the surface that lacks it. */
function recordedRequest(fixtures: FixtureBundle, surface: string, method: string) {
  const fixture = fixtures.fixtures.get(surface);
  if (fixture === undefined) {
    throw new Error(`no fixture recorded for surface ${surface}`);
  }
  const request = fixture.requests.find((r) => r.method === method);
  if (request === undefined) {
    throw new Error(`fixture ${surface} recorded no ${method} request`);
  }
  if (!Array.isArray(request.params)) {
    throw new Error(`fixture ${surface} recorded ${method} with non-positional params`);
  }
  return request.params;
}

/**
 * The storage key/type a recorded surface reads, taken from the transcript itself.
 *
 * The `type` is checked against the closed set rather than passed through: it is fed
 * straight to `storage()`, and a transcript naming a third query kind would otherwise
 * reach the transport as a string it has no branch for.
 */
export function keyFor(fixtures: FixtureBundle, surface: string): StorageQuery {
  const params = recordedRequest(fixtures, surface, 'chainHead_v1_storage');
  const query = (params[2] as readonly { key: HexString; type: string }[])[0];
  if (query === undefined) {
    throw new Error(`fixture ${surface} recorded a storage request with no queries`);
  }
  if (query.type !== 'value' && query.type !== 'descendantsValues') {
    throw new Error(
      `fixture ${surface} recorded storage query type ${JSON.stringify(query.type)}, ` +
        `which the transport has no branch for`,
    );
  }
  return { key: query.key, type: query.type };
}

/** The argument a recorded runtime-API call was made with, from the transcript itself. */
export function argsFor(fixtures: FixtureBundle, surface: string): HexString {
  const params = recordedRequest(fixtures, surface, 'chainHead_v1_call');
  return params[3] as HexString;
}

export { createMockRuntime };
