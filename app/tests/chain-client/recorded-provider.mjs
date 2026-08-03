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
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createFixtureBundle, createMockRuntime } from '@bleavit/mock-runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');
export const SUBSCRIPTION = 'subscription-1';

export function bundle() {
  const names = readdirSync(FIXTURE_DIR).filter(
    (n) => n.endsWith('.json') && n !== 'fixtures-report.json',
  );
  const report = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'));
  return createFixtureBundle(
    report,
    names.map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), 'utf8'))),
  );
}

/**
 * Build a provider over a mock runtime.
 *
 * `sent` accumulates every outbound request, which is how the suites assert *which block
 * a read was issued against* — the property V-84 was about. Asserting on the returned
 * value cannot catch that: the value is correct, only its label is wrong.
 */
export function recordedProvider(runtime, options = {}) {
  const sent = [];
  const state = { finalized: runtime.pinnedBlock(), onMessage: undefined };

  const provider = (onMessage) => {
    state.onMessage = onMessage;
    const emit = (message) => queueMicrotask(() => onMessage(message));
    const followEvent = (result) =>
      emit({ jsonrpc: '2.0', method: 'chainHead_v1_followEvent', params: { subscription: SUBSCRIPTION, result } });
    state.followEvent = followEvent;

    return {
      send(request) {
        sent.push(request);
        const { id, method, params } = request;

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

        if (options.intercept?.(request, { emit, followEvent })) return;

        const recorded = runtime.respond(method, params);
        emit({ jsonrpc: '2.0', id, result: recorded.direct.result });
        for (const event of recorded.events ?? []) followEvent(event);
      },
      disconnect() {
        state.disconnected = true;
      },
    };
  };

  return { provider, sent, state };
}

/** The storage key/type a recorded surface reads, taken from the transcript itself. */
export function keyFor(fixtures, surface) {
  const request = fixtures.fixtures
    .get(surface)
    .requests.find((r) => r.method === 'chainHead_v1_storage');
  return request.params[2][0];
}

/** The argument a recorded runtime-API call was made with, from the transcript itself. */
export function argsFor(fixtures, surface) {
  const request = fixtures.fixtures
    .get(surface)
    .requests.find((r) => r.method === 'chainHead_v1_call');
  return request.params[3];
}
