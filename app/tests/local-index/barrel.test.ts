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
