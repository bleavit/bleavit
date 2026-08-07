/**
 * The curated suggestions file and its accept disclosure — 10 §8.1, INV-FE-13 (F9).
 *
 * §8.1 asks for three things in one sentence: the list ships **inside the release**, accepting is
 * an **explicit user action**, and the acceptance carries a **disclosure of exactly what the
 * operator learns**. The first is the one a unit test usually cannot see, because a fetched list
 * and a bundled list look identical at the call site once the value has arrived.
 *
 * So the first test reads the module's own **source**. That is the artefact the invariant is
 * about — INV-FE-13 forbids *"any remote-configuration channel"*, and whether this list is one is
 * a property of how it is obtained, not of what it contains. It is the same reason
 * `check:handoff-network` reads source rather than trusting the absence of a call.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  SUGGESTED_PROVIDERS,
  acceptSuggestion,
  afterProbe,
  canServeReads,
  defaultProviders,
  disclosureFor,
  fleetState,
  probeDue,
} from '@bleavit/providers';
import type { ProviderSuggestion } from '@bleavit/providers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '..', 'packages', 'providers', 'src', 'suggestions.ts');

/** One reviewed row, constructed here so the mechanism is testable while the release list is empty. */
const EXAMPLE: ProviderSuggestion = {
  id: 'example-archive',
  kind: 'snapshot',
  name: 'Example Archive',
  operator: 'Example Operator Ltd',
  endpoint: 'https://snapshots.example.org',
  why: 'Publishes monthly snapshots and a pin over an unrelated channel.',
};

// -------------------------------------------------- in the release, not over the network

test('the suggestions module contains no network primitive at all — INV-FE-13', () => {
  // Not "does not currently fetch": a *denylist of the calls somebody thought of* is the shape
  // that fails, so this asserts the absence of every primitive by which a list could arrive.
  const source = readFileSync(SOURCE, 'utf8');
  const forbidden = [
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'sendBeacon',
    'import(',
    'require(',
    'readFile',
    'process.env',
    'http://',
    'https://',
  ];
  const found = forbidden.filter((primitive) => source.includes(primitive));
  assert.deepEqual(
    found,
    [],
    `the curated list must ship inside the signed release; found ${found.join(', ')} in ` +
      'suggestions.ts. A fetched provider list is a remote channel that chooses who sees a ' +
      "user's queries, delivered to a client whose whole provider design is the user choosing.",
  );
});

test('the list is available synchronously at import time, which is what "in the bundle" means', () => {
  // A module that resolved its list asynchronously could not satisfy this even if the data
  // happened to be local — and asynchrony is the shape a fetch would need.
  assert.ok(Array.isArray(SUGGESTED_PROVIDERS));
  assert.equal('then' in Object(SUGGESTED_PROVIDERS), false, 'a thenable list is a fetched list');
});

test('the list is frozen, so a screen cannot sort or filter it in place', () => {
  assert.ok(Object.isFrozen(SUGGESTED_PROVIDERS));
});

test('this release curates nobody, and that is a fact rather than an oversight', () => {
  // The chain has not launched, so there is no operator whose endpoint could have been
  // reviewed. Naming one would be inventing an address a user would send their queries to.
  assert.deepEqual([...SUGGESTED_PROVIDERS], []);
});

test('a suggestion is not a provider — §8.1 ships an EMPTY provider list either way', () => {
  assert.deepEqual([...defaultProviders()], []);
});

// ------------------------------------------------------------------ the accept action

test('accepting returns the provider and the disclosure together', () => {
  // The only enforcement a pure function has: a call site cannot enable a source without
  // holding the sentence it was supposed to have shown. `accept(id)` on its own makes the
  // disclosure a separate call somebody forgets, and a forgotten disclosure looks exactly like
  // a provider enabled correctly.
  const accepted = acceptSuggestion(EXAMPLE, 'reads-only');
  assert.equal(accepted.provider.id, EXAMPLE.id);
  assert.equal(accepted.provider.kind, EXAMPLE.kind);
  assert.equal(accepted.provider.health.kind, 'unprobed');
  assert.equal(accepted.disclosure, disclosureFor(EXAMPLE, 'reads-only'));
});

test('an accepted provider CANNOT be read from until a probe answers — §8.3\'s "on enable"', () => {
  // It returned `healthy` until 2026-08-06, which is §8.3's probe-on-enable implemented as a
  // comment: nothing had asked the endpoint anything, and every read taken before the scheduler's
  // first tick came from a source the client had described to itself as healthy on no evidence.
  // `probeDue(null, now)` is not the control it looks like — it says a probe is *due*, and
  // nothing stops a caller reading first.
  const accepted = acceptSuggestion(EXAMPLE, 'reads-only');
  assert.equal(accepted.provider.health.kind, 'unprobed');
  assert.equal(canServeReads(accepted.provider), false);
  assert.equal(probeDue(null, 1_700_000_000_000), true);

  // And the ladder starts from it in both directions, so `unprobed` is a state and not a dead end.
  const answered = afterProbe(accepted.provider, { kind: 'responded', latencyMs: 5 });
  assert.equal(answered.health.kind, 'healthy');
  assert.equal(canServeReads(answered), true);

  // The failing direction, and this assertion has now moved twice — worth recording, because
  // both moves were right and the second is not a reversal of the first.
  //
  // It asserted `false` until 2026-08-06. That was a narrowing §8.3 does not authorise: its
  // normative shape says `Failing` counts consecutive failures "so one timeout in a healthy
  // series cannot ratchet the ladder; and only `Disabled` stops reads". So it became `true`.
  //
  // On 2026-08-07 an R-6 re-review of F24 pointed at the clause that had been read past.
  // §8.3 licenses `Failing` to serve on account of **a healthy series**, and the provider here
  // has none — it was accepted a moment ago and its very first probe timed out. Under the
  // `true` reading it went `unprobed` (serving nothing) → `failing` (serving), so *failing to
  // answer* bought it the eligibility that not being asked withheld. That is the same
  // non-monotonicity as the wrong-chain blocker, with silence as the trigger.
  //
  // So: `failing` still serves, exactly as §8.3 says — but only where the series exists.
  const silent = afterProbe(accepted.provider, { kind: 'failed', why: 'timeout' });
  assert.equal(silent.health.kind, 'failing', 'the counter runs, so it can still auto-disable');
  assert.equal(
    canServeReads(silent),
    false,
    'never answered ⇒ no healthy series ⇒ §8.3 does not license this one to serve',
  );

  // And the series, once it exists, survives a timeout — which is the thing §8.3 is explicit
  // about and the property the assertion above must not have broken.
  const afterOneGood = afterProbe(accepted.provider, { kind: 'responded', latencyMs: 5 });
  const thenSilent = afterProbe(afterOneGood, { kind: 'failed', why: 'timeout' });
  assert.equal(thenSilent.health.kind, 'failing');
  assert.equal(canServeReads(thenSilent), true, '§8.3: one timeout in a healthy series serves');
});

test('the fleet counts an unprobed source as enabled and NOT as serving', () => {
  // The same claim one layer up: a settings screen driven by "enabled minus disabled" would
  // report a source that has never answered anything as one that is serving reads.
  const accepted = acceptSuggestion(EXAMPLE, 'reads-only').provider;
  const state = fleetState([accepted]);
  assert.equal(state.kind, 'serving');
  if (state.kind !== 'serving') return;
  assert.equal(state.enabled, 1);
  assert.equal(state.serving, 0);
  assert.equal(state.unprobed, 1);
});

test('the disclosure names the operator, the endpoint, and what they learn', () => {
  // §8.1: "a disclosure of exactly what the operator learns (the addresses/objects you query)".
  // A disclosure that says "some data may be shared" is not one.
  const disclosure = disclosureFor(EXAMPLE, 'reads-only');
  assert.match(disclosure, /Example Operator Ltd/);
  assert.match(disclosure, /snapshots\.example\.org/);
  assert.match(disclosure, /accounts, markets and proposals/);
  assert.match(disclosure, /over time/, 'the pattern is the disclosure, not the single lookup');
});

test('the disclosure names the ten-minute heartbeat, not only the queries (§8.5.3)', () => {
  // Added 2026-08-07 with F24, and the reason is that adding the clause to `disclosureFor`
  // broke NO test — the two disclosure tests either side of this one both passed unchanged,
  // because each asserts what the copy says about queries and neither could notice a whole
  // category going unmentioned.
  //
  // §8.1's obligation is "exactly what the operator learns". Until F24 nothing drove §8.3's
  // probe, so describing queries alone was complete. §8.5.3 makes the client contact the
  // endpoint every ten minutes for as long as the source is enabled, whether or not the user
  // reads anything — presence and IP continuity rather than interest in an object. A user who
  // read the old copy and went idle would reasonably believe the operator stopped hearing
  // from them.
  const probing = disclosureFor(EXAMPLE, 'probes');
  assert.match(probing, /every ten minutes/, 'the cadence must be stated, not implied');
  assert.match(
    probing,
    /even when you are reading nothing/,
    'the point is that it happens while idle — a user who skips this reads it as query-driven',
  );
  assert.match(
    probing,
    /switching it off stops the ten-minute check/,
    '§8.1 makes switching off a user action, so its effect on the heartbeat must be stated too',
  );
});

test('...and it does NOT claim a heartbeat in a release that has no probe driver', () => {
  // The other half, added 2026-08-07 after an R-6 review. The clause above is only honest if a
  // heartbeat happens, and nothing in `app/src` schedules `runProbeRound` — so the shipped copy
  // was telling the user their device would contact the operator every ten minutes while the
  // provider panel said, correctly, that this release does not. §8.1's obligation is "exactly
  // what the operator learns", and a disclosure that overstates is as wrong as one that omits:
  // it invites a user to decline something this release does not do.
  //
  // `heartbeat` has no default precisely because of this test. A default is the value nobody
  // types, which is how the two sentences drifted apart in the first place.
  const readsOnly = disclosureFor(EXAMPLE, 'reads-only');
  assert.doesNotMatch(readsOnly, /every ten minutes/);
  assert.doesNotMatch(readsOnly, /ten-minute check/);
  assert.doesNotMatch(readsOnly, /even when you are reading nothing/);
  // And it still says what the operator does learn, rather than going quiet about the timing.
  assert.match(readsOnly, /only when you are reading something/);
  assert.match(readsOnly, /switching it off stops the queries/);
});

test('the disclosure states the true bound too, and does not overstate it', () => {
  // The bound is real — INV-FE-3 makes provider data structurally unable to satisfy a
  // precondition — and omitting it leaves a user weighing a privacy cost against an unstated
  // risk, which is how people decline something harmless and accept something that is not.
  const disclosure = disclosureFor(EXAMPLE, 'reads-only');
  assert.match(disclosure, /never sees your keys/);
  assert.match(disclosure, /never used to decide whether anything you sign is allowed/);
  // And it must not claim the labelling is protection against the data being wrong.
  assert.doesNotMatch(disclosure, /verified/);
});

test('every field of a suggestion is required, so a row cannot ship without its disclosure parts', () => {
  // The compile-time half is the type; this is the half that survives a JSON row being written
  // by hand. A disclosure assembled from missing parts is one the user cannot act on.
  for (const suggestion of SUGGESTED_PROVIDERS) {
    for (const field of ['id', 'kind', 'name', 'operator', 'endpoint', 'why'] as const) {
      assert.equal(typeof suggestion[field], 'string');
      assert.ok(String(suggestion[field]).length > 0, `${field} must not be empty`);
    }
  }
});
