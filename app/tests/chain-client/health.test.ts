/**
 * The peer watch — 10 §3.1's `SyncDegraded` driver (F1 / FE-P2, V-137, SQ-597).
 *
 * What is worth asserting here is almost entirely about **absence**, because the peer
 * count arrives from a legacy JSON-RPC method behind an escape hatch both vendors mark
 * unstable. The failure that matters is not "the watch missed an outage"; it is "the watch
 * invented one" — a client that reads a broken reader as zero peers throws the user into a
 * peer-diagnostics panel for a fault that is not theirs, while the chain is fine.
 *
 * So the suite spends most of its assertions proving the watch stays quiet, and the one
 * happy path is short.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPeerWatch,
  readingFromHealth,
  type PeerReading,
} from '@bleavit/chain-client';

const THRESHOLD = 60_000; // 10 §3.1's relay window; passed explicitly, never defaulted.

/** Drive the watch with one reading held steady across a span. */
function hold(
  watch: ReturnType<typeof createPeerWatch>,
  reading: PeerReading,
  from: number,
  to: number,
  lastFollowProgressMs?: number,
): string[] {
  const events: string[] = [];
  for (let t = from; t <= to; t += THRESHOLD / 4) {
    for (const e of watch.observe({ peers: reading, lastFollowProgressMs }, t)) events.push(e.type);
  }
  return events;
}

test('a malformed system_health reply is never read as zero peers', () => {
  // Every one of these says nothing about connectivity. The arm that degrades must not be
  // reachable from any of them — this is the whole reason `indeterminate` exists.
  const malformed: unknown[] = [
    undefined,
    null,
    'peers: 0',
    42,
    {},
    { peers: '0' },
    { peers: -1 },
    { peers: 1.5 },
    { peers: Number.NaN },
    { isSyncing: true },
    { peers: 0 }, //                     zero, but `shouldHavePeers` absent
    { peers: 0, shouldHavePeers: 'yes' }, // ...and non-boolean is not `true`
  ];
  for (const reply of malformed) {
    const reading = readingFromHealth(reply);
    assert.equal(
      reading.kind,
      'indeterminate',
      `${JSON.stringify(reply)} must be indeterminate, got ${reading.kind}`,
    );
  }
});

test('a well-formed reply maps to the arm the chain actually reported', () => {
  assert.deepEqual(readingFromHealth({ peers: 3, shouldHavePeers: true }), {
    kind: 'peers',
    count: 3,
  });
  // The reading measured against the pinned client with no bootnodes (V-137).
  assert.deepEqual(readingFromHealth({ isSyncing: true, peers: 0, shouldHavePeers: true }), {
    kind: 'no-peers',
  });
  // Zero peers on a chain that says it should not have any is a successful read of a
  // non-fault. Degrading on it would be wrong, and it is a *different* thing from a read
  // that failed — so it gets its own arm rather than being folded into either neighbour.
  assert.deepEqual(readingFromHealth({ peers: 0, shouldHavePeers: false }), {
    kind: 'no-peers-expected',
  });
  // `shouldHavePeers` is irrelevant once there is at least one peer.
  assert.deepEqual(readingFromHealth({ peers: 1, shouldHavePeers: false }), {
    kind: 'peers',
    count: 1,
  });
});

test('sustained zero peers degrades — but only after the threshold', () => {
  const watch = createPeerWatch(THRESHOLD);
  const zero: PeerReading = { kind: 'no-peers' };

  assert.deepEqual(watch.observe({ peers: zero, lastFollowProgressMs: undefined }, 0), []);
  // 10 §3.1 says "0 relay peers > 60 s", not "0 relay peers". Zero peers is the normal
  // state of a client that started two seconds ago.
  assert.deepEqual(hold(watch, zero, THRESHOLD / 4, THRESHOLD - 1), []);
  assert.equal(watch.diagnosis(), undefined);

  assert.deepEqual(
    watch.observe({ peers: zero, lastFollowProgressMs: undefined }, THRESHOLD),
    [{ type: 'peers-lost' }],
  );
  assert.equal(watch.diagnosis(), 'no-peers');

  // Once emitted, it is not re-emitted: the reducer is idempotent but a stream of
  // duplicate events is noise the panel would have to filter.
  assert.deepEqual(hold(watch, zero, THRESHOLD, THRESHOLD * 3), []);
});

test('recovery emits exactly one peer-acquired, and only if it had been lost', () => {
  const watch = createPeerWatch(THRESHOLD);
  const peers: PeerReading = { kind: 'peers', count: 2 };

  // Never degraded: acquiring peers is not an event.
  assert.deepEqual(watch.observe({ peers, lastFollowProgressMs: undefined }, 0), []);

  hold(watch, { kind: 'no-peers' }, 1, THRESHOLD * 2);
  assert.equal(watch.diagnosis(), 'no-peers');

  assert.deepEqual(
    watch.observe({ peers, lastFollowProgressMs: undefined }, THRESHOLD * 3),
    [{ type: 'peer-acquired' }],
  );
  assert.equal(watch.diagnosis(), undefined);
  assert.deepEqual(hold(watch, peers, THRESHOLD * 3, THRESHOLD * 5), []);
});

test('an unreadable peer count never degrades on its own', () => {
  // The load-bearing refusal. `indeterminate` for an hour with no fallback signal must
  // produce nothing: the client cannot tell whether it has peers, and inventing "no" is
  // the failure SQ-597 exists to prevent.
  const watch = createPeerWatch(THRESHOLD);
  const blind: PeerReading = { kind: 'indeterminate', reason: 'escape hatch is gone' };
  assert.deepEqual(hold(watch, blind, 0, THRESHOLD * 60), []);
  assert.equal(watch.diagnosis(), undefined);
});

test('an unreadable count degrades on stalled follow progress, under a named diagnosis', () => {
  const watch = createPeerWatch(THRESHOLD);
  const blind: PeerReading = { kind: 'indeterminate', reason: 'unimplemented' };

  // Follow is progressing: no fault, however unreadable the peer count is.
  assert.deepEqual(hold(watch, blind, 0, THRESHOLD * 3, THRESHOLD * 3), []);

  // Follow stalled at t=0 and it is now well past the window.
  const events = hold(watch, blind, THRESHOLD * 4, THRESHOLD * 6, 0);
  assert.deepEqual(events, ['peers-lost']);
  // ...and the diagnosis says the client does not know *why*, because a stalled follow
  // cannot distinguish "nobody to talk to" from "a chain that stopped".
  assert.equal(watch.diagnosis(), 'indeterminate');
});

test('a chain that should not have peers never degrades, and does not clear a run', () => {
  const watch = createPeerWatch(THRESHOLD);
  assert.deepEqual(hold(watch, { kind: 'no-peers-expected' }, 0, THRESHOLD * 10), []);

  // Freeze, not reset: a reader that breaks (or a chain that flips the flag) in the middle
  // of a real outage must not resolve that outage by going quiet. Start a zero run, cover
  // it with a non-degrading reading, then resume — the elapsed time still counts.
  const w2 = createPeerWatch(THRESHOLD);
  w2.observe({ peers: { kind: 'no-peers' }, lastFollowProgressMs: undefined }, 0);
  w2.observe({ peers: { kind: 'no-peers-expected' }, lastFollowProgressMs: undefined }, THRESHOLD / 2);
  assert.deepEqual(
    w2.observe({ peers: { kind: 'no-peers' }, lastFollowProgressMs: undefined }, THRESHOLD),
    [{ type: 'peers-lost' }],
  );
});

test('a change of cause restarts the clock rather than inheriting elapsed time', () => {
  const watch = createPeerWatch(THRESHOLD);
  // Nearly a full window of confirmed zero peers...
  hold(watch, { kind: 'no-peers' }, 0, THRESHOLD - 1);
  // ...then the reader breaks and follow is also stale. That is a *different* fault, and
  // reporting it as having held for 60 s would be a claim about a condition first observed
  // a moment ago.
  const blind: PeerReading = { kind: 'indeterminate', reason: 'reader gone' };
  assert.deepEqual(watch.observe({ peers: blind, lastFollowProgressMs: 0 }, THRESHOLD), []);
  assert.deepEqual(
    watch.observe({ peers: blind, lastFollowProgressMs: 0 }, THRESHOLD * 2 - 1),
    [],
  );
  assert.deepEqual(watch.observe({ peers: blind, lastFollowProgressMs: 0 }, THRESHOLD * 2), [
    { type: 'peers-lost' },
  ]);
});

test('a clock that goes backwards is refused, not acted on', () => {
  const watch = createPeerWatch(THRESHOLD);
  const zero: PeerReading = { kind: 'no-peers' };
  watch.observe({ peers: zero, lastFollowProgressMs: undefined }, THRESHOLD * 10);
  // A backwards jump would otherwise produce a negative elapsed — or, worse, restart the
  // run and hide an outage already in progress.
  assert.deepEqual(watch.observe({ peers: zero, lastFollowProgressMs: undefined }, 0), []);
  assert.deepEqual(watch.observe({ peers: zero, lastFollowProgressMs: undefined }, Number.NaN), []);
  assert.deepEqual(
    watch.observe({ peers: zero, lastFollowProgressMs: undefined }, THRESHOLD * 11),
    [{ type: 'peers-lost' }],
  );
});

test('the threshold is required and validated, because the two domains differ', () => {
  // 10 §3.1 gives the relay 60 s and the parachain 30 s. A default here would silently
  // apply one domain's rule to the other — the F17 staleness-threshold lesson.
  for (const bad of [Number.NaN, -1, Infinity]) {
    assert.throws(() => createPeerWatch(bad), RangeError, `threshold ${bad} must be refused`);
  }
  assert.doesNotThrow(() => createPeerWatch(30_000));
});

test('the events the watch emits are exactly the ones the boot machine consumes', () => {
  // Anti-drift: `boot.ts` declares these variants and, until this module, nothing produced
  // them. If a rename made them diverge again the state would go quietly unreachable, which
  // is the defect this whole module exists to close.
  const watch = createPeerWatch(THRESHOLD);
  const emitted = new Set<string>();
  hold(watch, { kind: 'no-peers' }, 0, THRESHOLD * 2).forEach((e) => emitted.add(e));
  watch
    .observe({ peers: { kind: 'peers', count: 1 }, lastFollowProgressMs: undefined }, THRESHOLD * 3)
    .forEach((e) => emitted.add(e.type));
  assert.deepEqual([...emitted].sort(), ['peer-acquired', 'peers-lost']);
});
