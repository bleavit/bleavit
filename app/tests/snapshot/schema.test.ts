/**
 * The published archive-export schema, bound to the parser that decides — 10 §8.2 (F9).
 *
 * `schemas:check` proves the committed file matches the generator. That is determinism, not
 * truth: it would stay green for a generator that published a schema describing nothing. What
 * makes the schema *true* is a differential — the same declarations through the schema and
 * through `parseArchiveExport`, asserted to agree — which is the discipline
 * `app/tests/intents/schemas.test.js` already applies to the inbound format.
 *
 * The direction that matters is the one a per-field loop cannot see. A schema silently missing a
 * movement kind tells every reader author that the kind is forbidden while this tool accepts it,
 * so the format grows a member nobody outside this repository can discover — and 10 §8.2's whole
 * claim is that somebody outside this repository can write a producer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { CANONICAL_AMOUNT_PATTERN } from '@bleavit/providers';

import {
  ARCHIVE_EXPORT_KEYS,
  ARCHIVE_EXPORT_OP_FIELDS,
  ARCHIVE_EXPORT_OP_KINDS,
  MalformedExport,
  parseArchiveExport,
} from '../../tools/snapshot/build.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schemas', 'bleavit.archive-export.v1.schema.json');

interface Fragment {
  readonly properties?: Record<string, Fragment>;
  readonly required?: readonly string[];
  readonly oneOf?: readonly Fragment[];
  readonly title?: string;
  readonly items?: Fragment;
  readonly additionalProperties?: boolean;
  readonly pattern?: string;
  readonly $comment?: string;
}

const published = JSON.parse(readFileSync(SCHEMA, 'utf8')) as Fragment;

test('the published schema names exactly the export`s top-level members', () => {
  assert.deepEqual(
    Object.keys(published.properties ?? {}).sort(),
    [...ARCHIVE_EXPORT_KEYS].sort(),
  );
  assert.deepEqual([...(published.required ?? [])].sort(), [...ARCHIVE_EXPORT_KEYS].sort());
});

test('the published movement kinds are exactly the ones the parser accepts', () => {
  const opSchema = published.properties?.['ops']?.items?.properties?.['op'];
  const titles = (opSchema?.oneOf ?? []).map((variant) => variant.title);
  assert.deepEqual([...titles].sort(), [...ARCHIVE_EXPORT_OP_KINDS].sort());
});

test('each published movement variant carries exactly its declared fields', () => {
  const opSchema = published.properties?.['ops']?.items?.properties?.['op'];
  for (const kind of ARCHIVE_EXPORT_OP_KINDS) {
    const variant = (opSchema?.oneOf ?? []).find((candidate) => candidate.title === kind);
    assert.ok(variant !== undefined, `no published variant for ${kind}`);
    assert.deepEqual(
      Object.keys(variant.properties ?? {}).sort(),
      [...ARCHIVE_EXPORT_OP_FIELDS[kind]].sort(),
    );
    assert.deepEqual(
      [...(variant.required ?? [])].sort(),
      [...ARCHIVE_EXPORT_OP_FIELDS[kind]].sort(),
    );
  }
});

test('a movement kind outside the published list is refused by the parser', () => {
  // The two halves of the same claim: the schema says these four, and the tool accepts these
  // four. A schema whose enum was wider would tell a reader author to emit something refused
  // at the publisher's own machine.
  assert.throws(
    () =>
      parseArchiveExport({
        binding: { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 },
        range: { fromBlock: 1, toBlock: 1 },
        observed: [],
        vaults: [],
        balances: [],
        ops: [
          {
            at: { block: 1, extrinsicIndex: 0, eventIndex: 0 },
            op: {
              kind: 'redeem_scalar',
              block: 1,
              vault: 'v1',
              account: 'alice',
              branch: 'PASS',
              amount: '1',
            },
          },
        ],
      }),
    MalformedExport,
  );
});

test('the schema publishes the parser`s own amount pattern, not a second copy of it', () => {
  const amount = published.properties?.['balances']?.items?.properties?.['amount'];
  assert.notEqual(
    amount?.pattern,
    undefined,
    'the amount field must publish a pattern; a reader author has no other way to learn the form',
  );
  // And the u128 bound, which no pattern can express, is stated in words rather than left for a
  // reader to infer — a value at or above 2^128 parses, replays and reconciles perfectly.
  assert.match(published.$comment ?? '', new RegExp(CANONICAL_AMOUNT_PATTERN.source.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  assert.match(published.$comment ?? '', /u128 Balance range/);
});

test('tolerated extras are published as tolerated — the parser ignores what it does not name', () => {
  // The opposite asymmetry from `bleavit.intent.v1`, and correct: an intent's closed cores are
  // where a hostile third party would place an encoded call, whereas this is a file a publisher
  // hands their own tool. Publishing `false` here tells reader authors to delete annotations
  // the tool happily accepts, which is the "stricter schema" defect in the other direction.
  assert.equal(published.additionalProperties, true);
  const parsed = parseArchiveExport({
    binding: { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 },
    range: { fromBlock: 1, toBlock: 1 },
    observed: [],
    vaults: [],
    balances: [],
    ops: [],
    producedBy: 'somebody else’s archive reader',
  });
  assert.equal(parsed.ops.length, 0);
});
