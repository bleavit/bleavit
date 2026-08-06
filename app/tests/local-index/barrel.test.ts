/**
 * The `/testing` quarantine, asserted rather than commented — 10 §6.3, §2.2. F9.
 *
 * `local-index`'s barrel withholds `selfRange` (and `rangeForSource`, which reaches it through a
 * wrapper) by a comment. `no-range-minting-outside-ingest` forbids production code importing
 * `@bleavit/local-index/testing`, and a re-export is invisible to it: one line would let
 * `providers` — the package that backfills from operator endpoints, indexers and snapshots —
 * mint `origin: 'self'` from three numbers, which is 10 §2.2's promotion arriving through the
 * front door.
 *
 * Added by F9 with no other change to this package: the hole was found while closing the same one
 * in `packages/providers`, and a barrel test is the half a dependency-cruiser rule cannot supply.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as barrel from '@bleavit/local-index';
import * as testing from '@bleavit/local-index/testing';

import { assertTestingSubpathIsQuarantined } from '../shared/testing-subpath.ts';

test('`selfRange` is not reachable from the @bleavit/local-index barrel', () => {
  assertTestingSubpathIsQuarantined(
    {
      packageName: '@bleavit/local-index',
      barrel,
      testing,
      barrelMustExport: ['addRange', 'holesIn', 'providerRange', 'isVerifiedAt'],
    },
    assert,
  );
});

test('`rangeForSource` is withheld too — it reaches `selfRange` through a wrapper', () => {
  // The easier one to miss, and the reason the namespace sweep above is not the whole test: it
  // takes a `HeaderSource`, so `rangeForSource({ origin: 'self' }, …)` mints the same range
  // without ever naming the quarantined function. It lives in neither surface, which is why the
  // disjointness check cannot see it.
  assert.equal('rangeForSource' in barrel, false);
});

test('`writeDownsampled` is withheld too — §9.2 obligation 1 lives in its call site', () => {
  // The generic sweep above already covers it (it is a key of `/testing`), and it is named here
  // because the reason is different from `selfRange`'s and a failure message about disjointness
  // would not carry it. `writeDownsampled` takes no transaction of its own: §9.2 binds the label
  // to the delete — *"the 'downsampled' label is written in the same storage transaction that
  // deletes the rows"* — so it must run inside the eviction's `rw`. Exported from the barrel it
  // becomes a way for any consumer to write the label with **no eviction behind it**: rows still
  // present and `meta.downsampled` claiming they were folded, which is a false claim about a
  // deletion that did not happen. That exact state was found by mutation inside this package one
  // round ago; a barrel export is how it is reached from outside.
  assert.equal('writeDownsampled' in barrel, false);
  assert.equal(typeof testing.writeDownsampled, 'function', 'the suite cannot reach the real writer');
  // Its read counterpart stays on the barrel: reading a label makes no claim, and `coveredQuery`
  // returns it beside every history answer.
  assert.equal(typeof barrel.readDownsampled, 'function');
});

test('`isGenesisHash` left the barrel, because a predicate beside a door is a way around it', () => {
  // It had no consumer anywhere: `chainTag` is the validated door — it refuses, slices, and is
  // shared with the `fut-ingest` lock name so two chains cannot collide on either. A bare
  // predicate exported beside it invites `if (isGenesisHash(x)) use(x.slice(2, 10))`, which is the
  // hand-rolled second implementation the shared function exists to remove. `packages/providers`
  // restates the hash regex rather than importing it, and its stated reason — that importing this
  // barrel for a predicate pulls Dexie into that package's graph — is the one that holds.
  assert.equal('isGenesisHash' in barrel, false);
  assert.equal(typeof barrel.chainTag, 'function', 'the validated door left with it');
  assert.throws(() => (barrel.chainTag as (hash: string) => string)('0xdeadbeef'));
});
