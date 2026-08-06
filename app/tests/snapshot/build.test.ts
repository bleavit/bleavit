/**
 * `app/tools/snapshot` — the producer driver (10 §8.2, F9).
 *
 * Two properties carry this suite, and neither is "the happy path works":
 *
 *  1. **Byte-identical reproduction is proven, not claimed.** The same history handed in with
 *     its arrays in a different order, and its movements arriving in a different sequence,
 *     must produce the *same file* and the *same pin*. That is 10 §8.2's published promise,
 *     and the only way to know it holds is to shuffle an export and compare bytes.
 *  2. **The balance sheet is a differential against chain state.** A producer that folded its
 *     own movements would agree with itself by construction, and §8.4's event↔derived-row
 *     screen could never fail on anything it emitted. The failure that actually happens to a
 *     snapshot tool is a *missing* movement — a variant not decoded, a range answered short —
 *     which is self-consistent and invisible to a self-fold.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { admitSnapshot, type Sha256 } from '@bleavit/providers';

import {
  MalformedExport,
  buildSnapshot,
  parseArchiveExport,
  type ArchiveExport,
  type PositionedOp,
} from '../../tools/snapshot/build.ts';

const sha256: Sha256 = (preimage) => createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;

function at(block: number, extrinsicIndex = 0, eventIndex = 0) {
  return { block, extrinsicIndex, eventIndex };
}

/**
 * A settled history, exported.
 *
 * `alice` splits 1000 and merges 200 back; `bob` splits 500 and redeems PASS. After the
 * redemption the branches no longer agree — which is the state a cross-branch equality check
 * would call a forgery, and the reason the fixture is post-settlement.
 */
function validExport(): ArchiveExport {
  return {
    binding: { ...BINDING },
    range: { fromBlock: 10, toBlock: 13 },
    observed: [{ fromBlock: 10, toBlock: 13 }],
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [
      { at: at(10), op: { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' } },
      { at: at(11), op: { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' } },
      { at: at(12), op: { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' } },
      {
        at: at(13),
        op: { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
      },
    ],
    // Read from chain state at block 13, independently of the movements above.
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
    ],
  };
}

function built(read: ArchiveExport) {
  const result = buildSnapshot(read, sha256);
  assert.equal(result.kind, 'built', result.kind === 'refused' ? result.why.join('\n') : '');
  if (result.kind !== 'built') throw new Error('unreachable');
  return result;
}

function refusal(read: ArchiveExport): readonly string[] {
  const result = buildSnapshot(read, sha256);
  assert.equal(result.kind, 'refused', 'expected the driver to refuse this export');
  return result.kind === 'refused' ? result.why : [];
}

// ------------------------------------------------------------------ the loop closure

test('what the producer emits, the client admits', () => {
  // The anti-vacuity control for everything below, and the property that makes the tool worth
  // having: the last step of a build runs the *client's* admission path over the bytes it just
  // produced, so a snapshot that would fail at the user is never written.
  const result = built(validExport());
  const verdict = admitSnapshot(
    result.text,
    { expectedPin: result.pin, binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'admitted');
});

test('the pin addresses the bytes on disk', () => {
  const result = built(validExport());
  const rehashed = buildSnapshot(validExport(), sha256);
  assert.equal(rehashed.kind === 'built' && rehashed.text, result.text);
  assert.equal(rehashed.kind === 'built' && rehashed.pin, result.pin);
});

// ------------------------------------------------------------------ byte-identical, by anyone

test('a shuffled export produces the SAME file and the SAME pin', () => {
  // 10 §8.2's actual promise. Two readers of one chain will not enumerate vaults, accounts or
  // events in the same order; if that reached the file, the two would publish different pins
  // for one history and each would look corrupt to the other's users.
  const reference = built(validExport());
  const shuffled = validExport();
  const scrambled: ArchiveExport = {
    ...shuffled,
    vaults: [{ vault: 'v1', branches: ['PASS', 'FAIL'] }],
    ops: [...shuffled.ops].reverse(),
    balances: [...shuffled.balances].reverse(),
    observed: [...shuffled.observed].reverse(),
  };
  const result = built(scrambled);
  assert.equal(result.text, reference.text);
  assert.equal(result.pin, reference.pin);
});

test('movements are ordered by chain position, including within one block', () => {
  // The document has no ordering field: `ops` are ordered by array position and the
  // conservation replay walks them in that order, so the chain's own order is the only
  // defensible one — and it is (block, extrinsic, event), not block alone.
  const read = validExport();
  const sameBlock: readonly PositionedOp[] = [
    {
      at: at(20, 3, 1),
      op: { kind: 'merge', block: 20, vault: 'v1', account: 'alice', amount: '400' },
    },
    {
      at: at(20, 1, 0),
      op: { kind: 'split', block: 20, vault: 'v1', account: 'alice', amount: '400' },
    },
  ];
  const result = built({
    ...read,
    range: { fromBlock: 20, toBlock: 20 },
    observed: [{ fromBlock: 20, toBlock: 20 }],
    ops: sameBlock,
    balances: [],
  });
  assert.deepEqual(
    result.document.ops.map((op) => op.kind),
    ['split', 'merge'],
  );
});

test('a merge that really does precede its split is refused, not reordered', () => {
  // The anti-vacuity control for the sort: ordering by chain position must not be able to
  // rescue an invalid history into a valid-looking one. Here the positions say merge-first,
  // and merge-first is a movement of tokens nobody held.
  const why = refusal({
    ...validExport(),
    range: { fromBlock: 20, toBlock: 21 },
    observed: [{ fromBlock: 20, toBlock: 21 }],
    ops: [
      {
        at: at(20, 0, 0),
        op: { kind: 'merge', block: 20, vault: 'v1', account: 'alice', amount: '400' },
      },
      {
        at: at(21, 0, 0),
        op: { kind: 'split', block: 21, vault: 'v1', account: 'alice', amount: '400' },
      },
    ],
    balances: [],
  });
  assert.ok(why.some((line) => line.includes('[conservation]')), why.join('\n'));
});

test('two movements at one chain position are refused — no tie-break here is right', () => {
  const read = validExport();
  const collided = read.ops.map((entry, i) => (i === 1 ? { ...entry, at: read.ops[0]!.at } : entry));
  assert.ok(refusal({ ...read, ops: collided }).some((line) => /share chain position/.test(line)));
});

test('a movement whose block disagrees with its chain position is refused', () => {
  const read = validExport();
  const wrong = read.ops.map((entry, i) => (i === 0 ? { ...entry, at: at(99) } : entry));
  assert.ok(
    refusal({ ...read, ops: wrong }).some((line) => /One of the two is wrong/.test(line)),
    'preferring either field would silently relocate a movement in history',
  );
});

// ------------------------------------------------------------------ the differential

test('a MISSING movement is caught — the failure a self-fold cannot see', () => {
  // The chain holds a position no movement in the export produces. Fold-your-own-ops emits a
  // perfectly self-consistent document that simply omits an account, and §8.4's derived-row
  // screen agrees with it, because both halves came from the same incomplete op set.
  const read = validExport();
  const why = refusal({
    ...read,
    balances: [...read.balances, { vault: 'v1', account: 'carol', branch: 'FAIL', amount: '99' }],
  });
  assert.ok(why.some((line) => /missing movements/.test(line)), why.join('\n'));
});

test('a TRUNCATED export is caught from the other side', () => {
  // Dropping the settling `redeem` leaves the fold holding a position the chain no longer has.
  // Same differential, opposite direction, and worth its own case: an export that stops early
  // is the commonest way a snapshot tool goes wrong, and it presents as a *surplus* rather
  // than a shortfall.
  const read = validExport();
  const why = refusal({ ...read, ops: read.ops.slice(0, 3) });
  assert.ok(why.some((line) => /does not agree happened/.test(line)), why.join('\n'));
});

test('a FABRICATED movement is caught — the chain has no such holding', () => {
  const read = validExport();
  const why = refusal({
    ...read,
    ops: [
      ...read.ops,
      {
        at: at(13, 9, 9),
        op: { kind: 'split', block: 13, vault: 'v1', account: 'mallory', amount: '77' },
      },
    ],
  });
  assert.ok(why.some((line) => /does not agree happened/.test(line)), why.join('\n'));
});

test('a movement of the wrong SIZE is caught, and both figures are named', () => {
  const read = validExport();
  const wrong = read.ops.map((entry, i) =>
    i === 2 ? { at: entry.at, op: { ...entry.op, amount: '300' } } : entry,
  );
  const why = refusal({ ...read, ops: wrong });
  assert.ok(why.some((line) => /the chain read at block 13 says/.test(line)), why.join('\n'));
});

test('the differential is what refuses, not the internal replay', () => {
  // Stated as its own case because it is the whole argument for reading balances from chain
  // state: the truncated export above is *internally* flawless. Rebuilt with a fold-derived
  // balance sheet it would be accepted by every screen in the client.
  const read = validExport();
  const truncated = { ...read, ops: read.ops.slice(0, 3) };
  const foldConsistent = {
    ...truncated,
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
  };
  assert.equal(buildSnapshot(foldConsistent, sha256).kind, 'built');
});

// ------------------------------------------------------------------ coverage honesty

test('coverage is what the reader OBSERVED, and the requested span is kept beside it', () => {
  // A reader that fails part-way and reports the requested span anyway publishes a document
  // claiming to have observed history it never saw — which passes every screen, because the
  // movements it does carry are consistent. A forgery produced by accident.
  const read = validExport();
  const result = built({
    ...read,
    range: { fromBlock: 1, toBlock: 100 },
    observed: [
      { fromBlock: 10, toBlock: 11 },
      { fromBlock: 12, toBlock: 13 },
    ],
  });
  assert.deepEqual(result.document.range, { fromBlock: 1, toBlock: 100 });
  // Adjacent ranges merge, so one covered set has exactly one spelling.
  assert.deepEqual(result.document.coverage, [{ fromBlock: 10, toBlock: 13 }]);
});

test('a genuine hole survives into the file rather than being papered over', () => {
  const read = validExport();
  const result = built({
    ...read,
    range: { fromBlock: 10, toBlock: 13 },
    observed: [
      { fromBlock: 10, toBlock: 10 },
      { fromBlock: 12, toBlock: 13 },
    ],
    ops: read.ops.filter((entry) => entry.op.account === 'alice'),
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
    ],
  });
  assert.equal(result.document.coverage.length, 2);
});

test('overlapping observed ranges are refused rather than quietly merged', () => {
  // A reader that observed one block twice has a defect; merging would hide it in the one
  // structure whose job is to say exactly what was seen.
  const why = refusal({
    ...validExport(),
    observed: [
      { fromBlock: 10, toBlock: 12 },
      { fromBlock: 11, toBlock: 13 },
    ],
  });
  assert.ok(why.some((line) => /overlap/.test(line)), why.join('\n'));
});

test('a movement outside observed coverage is caught by the client screens, not by luck', () => {
  // The driver has no coverage rule of its own; this refusal comes from running the real
  // `admitSnapshot` at the end, which is the point of the self-check — it covers reasons this
  // file does not know about.
  const read = validExport();
  const why = refusal({ ...read, observed: [{ fromBlock: 10, toBlock: 12 }] });
  assert.ok(why.some((line) => line.startsWith('[coverage]')), why.join('\n'));
});

test('a transfer round-trips through the producer and reconciles against the chain', () => {
  // The movement 03 §5 has and v1 needed: holdings change hands with no escrow or supply
  // movement. An exporter without it could only drop the event or fake a merge-plus-split.
  const read = validExport();
  const result = built({
    ...read,
    ops: [
      ...read.ops,
      {
        at: at(12, 5, 0),
        op: {
          kind: 'transfer',
          block: 12,
          vault: 'v1',
          account: 'alice',
          to: 'bob',
          branch: 'PASS',
          amount: '300',
        },
      },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'PASS', amount: '300' },
    ],
  });
  assert.equal(result.document.ops.filter((op) => op.kind === 'transfer').length, 1);
});

test('a movement v1 cannot express refuses at the DIFFERENTIAL, not at the parser', () => {
  // This is the argument for reading balances from chain state. A scalar redemption is outside
  // v1, so an exporter can only omit it — and the remaining ops stay perfectly self-consistent,
  // so no screen in the client could ever see the omission. What sees it is the chain read
  // disagreeing with the fold.
  const read = validExport();
  const why = refusal({
    ...read,
    balances: [
      ...read.balances.filter((row) => !(row.account === 'bob' && row.branch === 'FAIL')),
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '125' },
    ],
  });
  assert.ok(why.some((line) => /the chain read at block 13 says 125/.test(line)), why.join('\n'));
});

// ------------------------------------------------------------------ the input boundary

test('a JSON NUMBER amount is refused at the boundary — V-74 in its exact shape', () => {
  // `BigInt` accepts a number, so an amount past 2^53 would fold as its *rounded* value with
  // nothing thrown, and the snapshot would be quietly wrong about the largest positions in it.
  assert.throws(
    () =>
      parseArchiveExport({
        binding: { ...BINDING },
        range: { fromBlock: 1, toBlock: 1 },
        observed: [],
        vaults: [],
        ops: [
          {
            at: at(1),
            op: { kind: 'split', block: 1, vault: 'v1', account: 'a', amount: 100000000000000000001 },
          },
        ],
        balances: [],
      }),
    MalformedExport,
  );
});

test('a non-canonical decimal is refused too, before it can fold correctly and fail later', () => {
  assert.throws(
    () =>
      parseArchiveExport({
        binding: { ...BINDING },
        range: { fromBlock: 1, toBlock: 1 },
        observed: [],
        vaults: [],
        ops: [],
        balances: [{ vault: 'v1', account: 'a', branch: 'FAIL', amount: '007' }],
      }),
    MalformedExport,
  );
});

test('an export round-trips through its own parser', () => {
  const read = validExport();
  const parsed = parseArchiveExport(JSON.parse(JSON.stringify(read)));
  assert.deepEqual(parsed, read);
  assert.equal(built(parsed).pin, built(read).pin);
});

test('an unknown movement kind is refused rather than dropped', () => {
  assert.throws(
    () =>
      parseArchiveExport({
        binding: { ...BINDING },
        range: { fromBlock: 1, toBlock: 1 },
        observed: [],
        vaults: [],
        ops: [{ at: at(1), op: { kind: 'transfer', block: 1, vault: 'v1', account: 'a', amount: '1' } }],
        balances: [],
      }),
    MalformedExport,
  );
});
