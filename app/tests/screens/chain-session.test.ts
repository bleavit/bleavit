/**
 * Starting the light client — 10 §3.1, §4.1; `startLightClient`'s caller. F18.
 *
 * Everything below the injected `start` is unexercised here and says so in `chain-session.ts`:
 * that smoldot syncs, that browser-WSS peers answer, that a follow subscription behaves. What
 * *is* exercised is every decision made before and after that call, and each one fails
 * silently when it is got wrong — a build with no pin that dials anyway, a worker left running
 * after a failed start, and a terminal wrong-chain verdict reported as a retryable outage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UnusablePinError,
  releaseChainSpecs,
  releaseWorkerSource,
  startChainSession,
} from '@bleavit/application';
import type { ChainSpecs, WorkerSource } from '@bleavit/application';
import { WrongChainError } from '@bleavit/chain-client';
import type { BundledChain } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');

const RELAY_GENESIS: HexString = `0x${'a1'.repeat(32)}`;
const PARA_GENESIS: HexString = `0x${'b2'.repeat(32)}`;

const bundle = (
  id: string,
  kind: 'relay' | 'para',
  genesisHash: HexString,
  sha256: HexString = `0x${'cc'.repeat(32)}`,
): BundledChain => ({ pinned: { id, kind, sha256, genesisHash }, chainSpec: '{}' });

const PINNED: ChainSpecs = {
  kind: 'pinned',
  relay: bundle('paseo', 'relay', RELAY_GENESIS),
  para: bundle('bleavit', 'para', PARA_GENESIS),
};

/**
 * A `Worker`, complete enough to be one.
 *
 * A partial object plus a cast would have been shorter and would have needed `as unknown as`,
 * which is banned across `app/` — and the ban is the reason this is written out: the one
 * member that matters here is `terminate`, and a cast would have let a fixture that never had
 * it pass the type check that proves the production code can call it.
 */
function fakeWorker(log: string[]): Worker {
  return {
    onmessage: null,
    onmessageerror: null,
    onerror: null,
    postMessage: () => {},
    terminate: () => {
      log.push('terminated');
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}

const spawnable = (log: string[]): WorkerSource => ({
  kind: 'spawnable',
  createWorker: () => {
    log.push('spawned');
    return fakeWorker(log);
  },
});

/** A stand-in client. `LightClient` is nominal, which is why the module is generic. */
const CLIENT = { label: 'light client' } as const;

/* --------------------------------------------------- a build with no pin dials nothing */

test('an unpinned release constructs no worker and calls nothing', async () => {
  // "We did not connect" and "we connected to whatever was lying around" look identical from
  // the outside once a client is running, so the assertion is that the factory never ran.
  const log: string[] = [];
  const started: unknown[] = [];
  const session = await startChainSession({
    specs: { kind: 'unpinned', reason: 'no chain has been launched' },
    worker: spawnable(log),
    start: async (options) => {
      started.push(options);
      return CLIENT;
    },
  });
  assert.equal(session.kind, 'not-started');
  assert.deepEqual(log, [], 'a worker was spawned for a release with nothing to boot against');
  assert.deepEqual(started, [], 'a light client was started with no pin');
  assert.ok(session.kind === 'not-started' && session.reasons.includes('no chain has been launched'));
});

test('an unspawnable worker is a declared state, not a throw', async () => {
  // 10 §3.1 already has this state — `WorkerFailed` / FE-BOOT-002 — and its renderable surface
  // is the one this build renders. A throw here would take the verification panel down with it.
  const started: unknown[] = [];
  const session = await startChainSession({
    specs: PINNED,
    worker: { kind: 'unspawnable', reason: 'no worker entry point is bundled' },
    start: async (options) => {
      started.push(options);
      return CLIENT;
    },
  });
  assert.ok(session.kind === 'not-started');
  assert.deepEqual(started, []);
  assert.deepEqual(session.reasons, ['no worker entry point is bundled']);
});

test('both blockers are reported, never the first', async () => {
  // `depositBlocks` states the rule: a reader told to fix one thing, who then hits the next,
  // learns the report is guessing. Here the two have different owners — a release pin and a
  // bundler contract — so reporting one sends a reader to the wrong repair entirely.
  const session = await startChainSession({
    specs: { kind: 'unpinned', reason: 'no chain-spec bytes' },
    worker: { kind: 'unspawnable', reason: 'no worker entry point' },
    start: async () => CLIENT,
  });
  assert.ok(session.kind === 'not-started');
  assert.deepEqual(session.reasons, ['no chain-spec bytes', 'no worker entry point']);
});

/* ------------------------------------------------------ a pin that is not a pin is refused */

test('a null-shaped hash is refused before a worker exists', async () => {
  // `release-sources.json`'s own note: "a bundle that shipped a null genesis pin would run
  // `verifyChainIdentity` against nothing and report `verified`". The downstream checks do fail
  // closed on it — but only after a chain has been dialled, and they report it as a MISMATCH,
  // which sends a reader hunting for the wrong chain instead of an unfinished release.
  for (const specs of [
    {
      kind: 'pinned' as const,
      relay: bundle('paseo', 'relay', '' as HexString),
      para: bundle('bleavit', 'para', PARA_GENESIS),
    },
    {
      kind: 'pinned' as const,
      relay: bundle('paseo', 'relay', RELAY_GENESIS),
      para: bundle('bleavit', 'para', 'null' as HexString),
    },
    {
      kind: 'pinned' as const,
      relay: bundle('paseo', 'relay', RELAY_GENESIS, '0xdeadbeef' as HexString),
      para: bundle('bleavit', 'para', PARA_GENESIS),
    },
  ]) {
    const log: string[] = [];
    await assert.rejects(
      () => startChainSession({ specs, worker: spawnable(log), start: async () => CLIENT }),
      UnusablePinError,
    );
    assert.deepEqual(log, [], 'a worker was spawned for a pin that names nothing');
  }
});

test('a well-formed pin reaches the light client, with the bundles unchanged', async () => {
  const log: string[] = [];
  const seen: {
    relay: BundledChain | undefined;
    para: BundledChain | undefined;
    bootnodes: readonly string[] | undefined;
  } = { relay: undefined, para: undefined, bootnodes: undefined };
  const session = await startChainSession({
    specs: PINNED,
    worker: spawnable(log),
    start: async (options) => {
      seen.relay = options.relay;
      seen.para = options.para;
      seen.bootnodes = options.extraBootnodes;
      return CLIENT;
    },
    extraBootnodes: ['/dns/local/tcp/30333/ws/p2p/12D3'],
  });
  assert.ok(session.kind === 'started');
  assert.equal(session.client, CLIENT);
  assert.deepEqual(log, ['spawned']);
  assert.equal(seen.relay?.pinned.genesisHash, RELAY_GENESIS);
  assert.equal(seen.para?.pinned.genesisHash, PARA_GENESIS);
  assert.deepEqual(seen.bootnodes, ['/dns/local/tcp/30333/ws/p2p/12D3']);
});

test('the expert bootnode list is absent rather than empty when none was given', async () => {
  // `exactOptionalPropertyTypes` makes the difference expressible, and `startTopology` reads
  // it: an empty array is a caller saying "no extras", which is what `?? []` produces anyway —
  // but supplying the key at all would have to be a decision this module never made.
  let had = true;
  await startChainSession({
    specs: PINNED,
    worker: spawnable([]),
    start: async (options) => {
      had = 'extraBootnodes' in options;
      return CLIENT;
    },
  });
  assert.equal(had, false);
});

/* --------------------------------------------------------------- failure leaves nothing behind */

test('a failed start terminates the worker it constructed', async () => {
  // `startLightClient` tears down its chains and its smoldot client, and it never sees the
  // worker — it was handed one. A worker left running is a WASM light client syncing with
  // nothing reading it, the same unreferenced-resource leak `detach()` prevents one layer down.
  const log: string[] = [];
  const session = await startChainSession({
    specs: PINNED,
    worker: spawnable(log),
    start: async () => {
      throw new Error('peers were unreachable');
    },
  });
  assert.ok(session.kind === 'not-started');
  assert.deepEqual(log, ['spawned', 'terminated']);
  assert.match(session.reasons.join(' '), /peers were unreachable/);
});

test('a wrong chain is re-thrown, and the worker is still terminated', async () => {
  // 10 §3.1 makes FE-BOOT-003 terminal with no override. Folded into `not-started` it would
  // read as "could not connect, try again" — advice no retry can satisfy against a chain that
  // is simply a different chain, and the one verdict a user must not be invited to retry.
  const log: string[] = [];
  await assert.rejects(
    () =>
      startChainSession({
        specs: PINNED,
        worker: spawnable(log),
        start: async () => {
          throw new WrongChainError(PARA_GENESIS, `0x${'ff'.repeat(32)}` as HexString);
        },
      }),
    WrongChainError,
  );
  assert.deepEqual(log, ['spawned', 'terminated'], 'a terminal error left the worker running');
});

test('a worker whose terminate() throws does not swallow the terminal verdict', async () => {
  // The ordering trap: terminate first, re-throw second. A `terminate()` that throws (a worker
  // already gone) would otherwise replace FE-BOOT-003 with an error about cleanup.
  const hostile: WorkerSource = {
    kind: 'spawnable',
    createWorker: () => ({
      ...fakeWorker([]),
      terminate: () => {
        throw new Error('already terminated');
      },
    }),
  };
  await assert.rejects(
    () =>
      startChainSession({
        specs: PINNED,
        worker: hostile,
        start: async () => {
          throw new WrongChainError(PARA_GENESIS, `0x${'ff'.repeat(32)}` as HexString);
        },
      }),
    WrongChainError,
  );
});

/* ------------------------------------------- what THIS release pins, bound to its own sources */

test('this release pins no chain-spec bytes, and the client says exactly that', () => {
  // Bound to the declared sources rather than asserted, the same way `releaseParaChain` is: the
  // day a chain-spec hash and a genesis are pinned, this fails and the boot wiring has to start
  // handing them to smoldot. A development pin must NOT satisfy it — see `chain-identity.ts`.
  const sources: unknown = JSON.parse(
    readFileSync(join(APP, 'tools/release/sources/release-sources.json'), 'utf8'),
  );
  const identity = (
    sources as {
      chainIdentity: {
        chainSpecHashes: Record<string, string | null>;
        genesisHashes: Record<string, string | null>;
      };
      connectSrc: { chainSpecs: readonly string[] };
    }
  ).chainIdentity;
  for (const [role, hash] of Object.entries(identity.chainSpecHashes)) {
    assert.equal(hash, null, `a ${role} chain-spec hash is pinned; releaseChainSpecs() must return it`);
  }
  for (const [role, hash] of Object.entries(identity.genesisHashes)) {
    assert.equal(hash, null, `a ${role} genesis is pinned; releaseChainSpecs() must return it`);
  }
  assert.equal(releaseChainSpecs().kind, 'unpinned');
  const specs = releaseChainSpecs();
  assert.ok(specs.kind === 'unpinned' && specs.reason.length > 0);
});

test('no development or local pin has leaked into the release source', () => {
  // The ruling this milestone implements, as something that can fail. A pin to `bleavit_dev`
  // on `paseo-local` passes every identity check and reports `verified` about a chain that is
  // not Bleavit — worse than the null it would replace, because nothing downstream objects.
  const text = readFileSync(join(APP, 'tools/release/sources/release-sources.json'), 'utf8');
  for (const forbidden of ['bleavit_dev', 'bleavit_local', 'paseo-local', 'bleavit-dev.json', 'bleavit-local.json']) {
    assert.ok(
      !text.includes(forbidden),
      `${forbidden} appears in release-sources.json; a development pin may exist and may never live there`,
    );
  }
});

test('this build declares no worker source, and the reason is not an empty string', () => {
  const worker = releaseWorkerSource();
  assert.equal(worker.kind, 'unspawnable');
  assert.ok(worker.kind === 'unspawnable' && worker.reason.length > 0);
});

test('with this release’s own inputs, nothing is started', async () => {
  // The two statements above are about the inputs; this is about what they produce together,
  // which is what makes `cannotObserve` honest over in `features-analysis`.
  const started: unknown[] = [];
  const session = await startChainSession({
    specs: releaseChainSpecs(),
    worker: releaseWorkerSource(),
    start: async (options) => {
      started.push(options);
      return CLIENT;
    },
  });
  assert.equal(session.kind, 'not-started');
  assert.deepEqual(started, []);
});
