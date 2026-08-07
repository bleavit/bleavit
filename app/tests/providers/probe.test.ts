/**
 * §8.5.3's probe driver — 10 §8.3/§8.5.3 (F24).
 *
 * `sampling.test.ts` covers the ladder's arithmetic. What is testable only here is the part that
 * decides **whether a request is sent at all**, and every assertion below is about a request that
 * must not happen or an answer that must not count:
 *
 *  - a prompt, well-formed answer about the *wrong chain* is a failure, not health;
 *  - a `disabled` source is never contacted, because the request is itself the §8.1 disclosure;
 *  - a source with no endpoint is never contacted, because §8.5.3 scopes the ladder to endpoints;
 *  - one dead endpoint does not stop the round for the others.
 *
 * The transport records every URL it is given, so "was not contacted" is asserted against what
 * the transport saw rather than against the resulting health — a provider can end a round
 * unchanged for several different reasons, and only one of them means no request went out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LADDER,
  probe,
  runProbeRound,
  type HttpGet,
  type Provider,
  type ProbeResponse,
  type ProbeRound,
  type ProbeTarget,
} from '@bleavit/providers';

const GENESIS = '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3';
const OTHER_GENESIS = '0xe143f23803ac50e8f6f8e62695d1ce9e4e1d68aa36c1cd2cfd15340213f3423e';

const ENDPOINT = 'https://indexer.example';
const TARGET: ProbeTarget = { endpoint: ENDPOINT, genesisHash: GENESIS };

function bindingBody(genesisHash = GENESIS): string {
  return JSON.stringify({ genesisHash, specVersion: 3, contractVersion: 28 });
}

/** A transport that records what it was asked for. `seen` is the assertion surface. */
function recording(reply: (url: string) => ProbeResponse | Promise<ProbeResponse>): {
  get: HttpGet;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    get: async (url) => {
      seen.push(url);
      return reply(url);
    },
  };
}

function ok(genesisHash = GENESIS): ReturnType<typeof recording> {
  return recording(() => ({ status: 200, body: bindingBody(genesisHash) }));
}

/** A clock that returns each supplied reading in turn, then repeats the last. */
function clockOf(...readings: readonly number[]): () => number {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)] ?? 0;
}

// --------------------------------------------------------------------- probe(): what answers

test('a 200 carrying this chain’s binding is an answer, and its latency is the observation', async () => {
  const { get } = ok();
  const outcome = await probe(TARGET, get, clockOf(1_000, 1_120));
  assert.deepEqual(outcome, { kind: 'responded', latencyMs: 120 });
});

test('a latency above the threshold is still an answer — slow never disables (§8.3)', async () => {
  const { get } = ok();
  const outcome = await probe(TARGET, get, clockOf(0, LADDER.slowAboveMs + 1));
  assert.equal(outcome.kind, 'responded');
});

test('the probe asks for /chain, and a trailing slash does not double it', async () => {
  const a = ok();
  await probe(TARGET, a.get, clockOf(0, 1));
  assert.deepEqual(a.seen, [`${ENDPOINT}/chain`]);

  const b = ok();
  await probe({ endpoint: `${ENDPOINT}///`, genesisHash: GENESIS }, b.get, clockOf(0, 1));
  assert.deepEqual(b.seen, [`${ENDPOINT}/chain`]);
});

// ------------------------------------------------------- probe(): what looks like an answer

test('a prompt, well-formed answer about ANOTHER CHAIN is a failure', async () => {
  // The assertion this file exists for. By every network measure this endpoint is healthy: it
  // answered 200, quickly, with a valid binding. It can never supply a usable row. Counting it
  // as an answer parks it on the ladder in `healthy`, where it is indistinguishable from a source
  // that works, and the failure then surfaces as rows that never arrive.
  const { get } = ok(OTHER_GENESIS);
  const outcome = await probe(TARGET, get, clockOf(0, 5));
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.kind === 'failed' ? outcome.why : '', /describes genesis 0xe143/);
  assert.match(outcome.kind === 'failed' ? outcome.why : '', /this client is on 0x91b1/);
});

test('a non-200, a non-JSON body and a JSON body that is not a binding are each failures', async () => {
  const cases: readonly (readonly [ProbeResponse, RegExp])[] = [
    [{ status: 503, body: bindingBody() }, /answered 503/],
    [{ status: 200, body: 'not json at all' }, /not JSON/],
    [{ status: 200, body: JSON.stringify({ specVersion: 3 }) }, /without a chain binding/],
    [{ status: 200, body: JSON.stringify({ genesisHash: GENESIS }) }, /without a chain binding/],
    [
      { status: 200, body: JSON.stringify({ genesisHash: '', specVersion: 3, contractVersion: 1 }) },
      /without a chain binding/,
    ],
  ];
  for (const [response, why] of cases) {
    const outcome = await probe(TARGET, async () => response, clockOf(0, 1));
    assert.equal(outcome.kind, 'failed', `${response.status} ${response.body}`);
    assert.match(outcome.kind === 'failed' ? outcome.why : '', why);
  }
});

test('a transport that rejects is a failed probe, not a thrown round', async () => {
  const outcome = await probe(
    TARGET,
    async () => {
      throw new Error('ECONNREFUSED');
    },
    clockOf(0, 1),
  );
  assert.deepEqual(outcome, { kind: 'failed', why: 'ECONNREFUSED' });
});

test('a non-http(s) endpoint is refused WITHOUT calling the transport', async () => {
  for (const endpoint of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,x', 'nonsense']) {
    const { get, seen } = ok();
    const outcome = await probe({ endpoint, genesisHash: GENESIS }, get, clockOf(0, 1));
    assert.equal(outcome.kind, 'failed', endpoint);
    assert.deepEqual(seen, [], `${endpoint} must never reach the transport`);
  }
});

test('a clock that runs backwards does not report a negative latency', async () => {
  const { get } = ok();
  const outcome = await probe(TARGET, get, clockOf(5_000, 1_000));
  assert.deepEqual(outcome, { kind: 'responded', latencyMs: 0 });
});

// ----------------------------------------------------------------- runProbeRound(): the driver

function round(providers: readonly Provider[], last: readonly (readonly [string, number | null])[] = []): ProbeRound {
  return {
    providers,
    targets: new Map(providers.map((p) => [p.id, TARGET])),
    lastProbeMs: new Map(last),
  };
}

test('an unprobed source is probed on this tick and leaves the round serving', async () => {
  // F24's whole reason for existing: without a driver, an accepted source stays `unprobed`
  // forever, and `canServeReads` refuses `unprobed` — so it serves nothing, permanently.
  const providers: readonly Provider[] = [{ id: 'p1', kind: 'indexer', health: { kind: 'unprobed' } }];
  const { get, seen } = ok();
  const result = await runProbeRound(round(providers), get, 1_000, clockOf(0, 10));

  assert.deepEqual(seen, [`${ENDPOINT}/chain`]);
  assert.deepEqual(result.providers[0]?.health, { kind: 'healthy' });
  assert.deepEqual(result.probed, ['p1']);
  assert.equal(result.lastProbeMs.get('p1'), 1_000);
});

test('a DISABLED source is never contacted — the request is itself the §8.1 disclosure', async () => {
  const disabled: Provider = {
    id: 'off',
    kind: 'indexer',
    health: { kind: 'disabled', by: 'user', reason: 'switched off' },
  };
  const { get, seen } = ok();
  const result = await runProbeRound(round([disabled]), get, 1_000, clockOf(0, 10));

  assert.deepEqual(seen, [], 'a source the user switched off must not be told we are still here');
  assert.deepEqual(result.probed, []);
  assert.deepEqual(result.providers[0], disabled);
});

test('a source with no endpoint is never contacted and is unchanged', async () => {
  const fileOnly: Provider = { id: 'file', kind: 'snapshot', health: { kind: 'unprobed' } };
  const { get, seen } = ok();
  const result = await runProbeRound(
    { providers: [fileOnly], targets: new Map(), lastProbeMs: new Map() },
    get,
    1_000,
    clockOf(0, 10),
  );

  assert.deepEqual(seen, []);
  assert.deepEqual(result.providers[0], fileOnly);
});

test('a source probed less than the interval ago is skipped; one older is probed', async () => {
  const providers: readonly Provider[] = [
    { id: 'fresh', kind: 'indexer', health: { kind: 'healthy' } },
    { id: 'stale', kind: 'indexer', health: { kind: 'healthy' } },
  ];
  const now = 10_000_000;
  const { get, seen } = ok();
  const result = await runProbeRound(
    round(providers, [
      ['fresh', now - 1],
      ['stale', now - LADDER.probeEveryMs],
    ]),
    get,
    now,
    clockOf(0, 10),
  );

  assert.deepEqual(result.probed, ['stale']);
  assert.deepEqual(seen, [`${ENDPOINT}/chain`]);
});

test('one dead endpoint does not stop the round for the others', async () => {
  const providers: readonly Provider[] = [
    { id: 'dead', kind: 'indexer', health: { kind: 'unprobed' } },
    { id: 'live', kind: 'indexer', health: { kind: 'unprobed' } },
  ];
  const targets = new Map<string, ProbeTarget>([
    ['dead', { endpoint: 'https://dead.example', genesisHash: GENESIS }],
    ['live', TARGET],
  ]);
  const get: HttpGet = async (url) => {
    if (url.startsWith('https://dead.example')) throw new Error('ETIMEDOUT');
    return { status: 200, body: bindingBody() };
  };

  const result = await runProbeRound({ providers, targets, lastProbeMs: new Map() }, get, 1, clockOf(0, 10));

  assert.deepEqual(result.probed, ['dead', 'live']);
  assert.deepEqual(result.providers.find((p) => p.id === 'live')?.health, { kind: 'healthy' });
  assert.deepEqual(result.providers.find((p) => p.id === 'dead')?.health, {
    kind: 'failing',
    consecutiveFailures: 1,
  });
});

test('consecutive failing rounds auto-disable at the threshold, end to end', async () => {
  const get: HttpGet = async () => {
    throw new Error('ETIMEDOUT');
  };
  let providers: readonly Provider[] = [{ id: 'p1', kind: 'indexer', health: { kind: 'unprobed' } }];
  let last = new Map<string, number | null>();

  for (let round = 1; round <= LADDER.disableAfter; round += 1) {
    const now = round * LADDER.probeEveryMs;
    const result = await runProbeRound({ providers, targets: new Map([['p1', TARGET]]), lastProbeMs: last }, get, now, clockOf(0, 1));
    providers = result.providers;
    last = new Map(result.lastProbeMs);
  }

  const health = providers[0]?.health;
  assert.equal(health?.kind, 'disabled');
  assert.equal(health?.kind === 'disabled' ? health.by : '', 'auto');
  assert.ok((health?.kind === 'disabled' ? health.reason : '').length > 0, 'a disable always carries a reason');
});

test('a healthy probe does not resurrect an auto-disabled source, and does not even ask', async () => {
  const autoOff: Provider = {
    id: 'p1',
    kind: 'indexer',
    health: { kind: 'disabled', by: 'auto', reason: 'three consecutive failures' },
  };
  const { get, seen } = ok();
  const result = await runProbeRound(round([autoOff]), get, 10_000_000, clockOf(0, 1));

  assert.deepEqual(seen, []);
  assert.deepEqual(result.providers[0], autoOff);
});
