/**
 * The `/testing` quarantine, asserted rather than commented — 10 §2.1, INV-FE-1. F9.
 *
 * `chain-client`'s barrel withholds `finalize` by a comment (V-118). The dependency-cruiser rule
 * beside it, `no-finalized-minting-outside-chain-client`, forbids production code importing
 * `@bleavit/chain-client/testing` — and says nothing about a re-export, so one line in the barrel
 * would hand `transaction-builder` and `signing` the ability to label any value
 * `verified-finalized` with no subpath import for the rule to see.
 *
 * The shared helper takes the whole `/testing` namespace, so a second name added to the
 * quarantine is covered the moment it exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as barrel from '@bleavit/chain-client';
import * as testing from '@bleavit/chain-client/testing';

import { assertTestingSubpathIsQuarantined } from '../shared/testing-subpath.ts';

test('`finalize` is not reachable from the @bleavit/chain-client barrel', () => {
  assertTestingSubpathIsQuarantined(
    {
      packageName: '@bleavit/chain-client',
      barrel,
      testing,
      // Production entry points, so a barrel that failed to load cannot pass by being empty.
      barrelMustExport: ['meet', 'hasFinalizedStatus', 'readmitFromLeader'],
    },
    assert,
  );
});
