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
  defaultProviders,
  disclosureFor,
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
  const accepted = acceptSuggestion(EXAMPLE);
  assert.equal(accepted.provider.id, EXAMPLE.id);
  assert.equal(accepted.provider.kind, EXAMPLE.kind);
  assert.equal(accepted.provider.health.kind, 'healthy');
  assert.equal(accepted.disclosure, disclosureFor(EXAMPLE));
});

test('an accepted provider is due a health probe immediately — §8.3\'s "on enable"', () => {
  const accepted = acceptSuggestion(EXAMPLE);
  assert.equal(accepted.provider.health.kind, 'healthy');
  assert.equal(probeDue(null, 1_700_000_000_000), true);
});

test('the disclosure names the operator, the endpoint, and what they learn', () => {
  // §8.1: "a disclosure of exactly what the operator learns (the addresses/objects you query)".
  // A disclosure that says "some data may be shared" is not one.
  const disclosure = disclosureFor(EXAMPLE);
  assert.match(disclosure, /Example Operator Ltd/);
  assert.match(disclosure, /snapshots\.example\.org/);
  assert.match(disclosure, /accounts, markets and proposals/);
  assert.match(disclosure, /over time/, 'the pattern is the disclosure, not the single lookup');
});

test('the disclosure states the true bound too, and does not overstate it', () => {
  // The bound is real — INV-FE-3 makes provider data structurally unable to satisfy a
  // precondition — and omitting it leaves a user weighing a privacy cost against an unstated
  // risk, which is how people decline something harmless and accept something that is not.
  const disclosure = disclosureFor(EXAMPLE);
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
