/**
 * The streamed import and the layer-3 origin mint — 10 §8.4, §8.2, §6.3; INV-FE-15 (F9).
 *
 * `import-quota.test.ts` proves the meters. This proves they are **wired**, which is the finding
 * it could not reach: before 2026-08-06 `admitChunk` had no production caller, `planImport` was
 * bound to nothing, and `admitSnapshot` took the whole file as one string — so every control in
 * §8.4's *"≤ 400 MB uncompressed, ≤ 4 M rows, streamed, eviction preview before import"* existed
 * and none of them ran on the path a user takes.
 *
 * The assertions are about **order**, because every one of those four controls is an ordering
 * claim: refuse before retaining, count before previewing, preview before writing, and mint only
 * at the end. A test that checked the outcomes and not the sequence would pass for an
 * implementation that read the whole file first and apologised afterwards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  EVICTION_DECLINED,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_UNCOMPRESSED_BYTES,
  SNAPSHOT_FORMAT,
  admitSnapshot,
  importSnapshotStream,
  mintIndexerRows,
  mintSnapshotRows,
  rowUpperBound,
  runSamplingRound,
  serializeSnapshot,
  snapshotPreimage,
  spotCheckSnapshot,
} from '@bleavit/providers';
import type {
  ImportDependencies,
  ImportPlan,
  ImportRequest,
  LocalFootprint,
  Provider,
  SnapshotChunk,
  SnapshotDocument,
  SpotClaim,
  SpotVerdict,
} from '@bleavit/providers';
// A **test** dependency, and the reason it is one is 10 §10.1: `packages/providers` may import
// `local-index`'s types and not its values, since the values bring Dexie with them. The two
// halves of §6.3's edge therefore have to be bound somewhere, and a suite is where that costs
// no production edge — the same argument `tests/platform` makes for its two restatements.
import { EMPTY_COVERAGE, addRange, verifyRanges } from '@bleavit/local-index';

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;

/**
 * A real 32-byte genesis, because the indexer mint refuses anything else (10 §6.3).
 *
 * The `0xfeed` stand-in above is fine for the *document* binding, which `admitSnapshot`
 * compares only against the caller's own binding. It is not fine for a minted range's edge:
 * that value goes into a coverage set, where `assertCanonical` enforces the hash form, so a
 * stand-in here would be a fixture that this client's own index would refuse.
 */
const CLIENT_GENESIS = `0x${'c1'.repeat(32)}`;

function validDocument(): SnapshotDocument {
  return {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: 10, toBlock: 13 },
    coverage: [{ fromBlock: 10, toBlock: 13 }],
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
    ],
  };
}

/** Chop the file into pieces, as a stream reader would hand them over. */
async function* streamOf(text: string, pieces = 7): AsyncIterable<SnapshotChunk> {
  const encoder = new TextEncoder();
  const size = Math.ceil(text.length / pieces);
  for (let at = 0; at < text.length; at += size) {
    const slice = text.slice(at, at + size);
    yield { text: slice, bytes: encoder.encode(slice).length };
  }
}

const FOOTPRINT: readonly LocalFootprint[] = [
  { table: 'priceSamples', rows: 10_000, bytes: 1_200_000, oldestBlock: 1 },
  { table: 'events', rows: 4_000, bytes: 400_000, oldestBlock: 50 },
];

const PUBLISHER: Provider = { id: 'archive-one', kind: 'snapshot', health: { kind: 'healthy' } };

function requestFor(document: SnapshotDocument, budgetBytes = 10_000_000): ImportRequest {
  return {
    provider: PUBLISHER,
    admission: { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
    maxInputBytes: IMPORT_MAX_UNCOMPRESSED_BYTES,
    budgetBytes,
    footprint: FOOTPRINT,
    importedAt: 1_700_000_000_000,
  };
}

// `below-window` — the deep-history posture 10 §6.4 assigns snapshots, and the one an undirected
// verdict got backwards. See `spot-check.test.ts` for the walk's own cases.
const REACHES_NOTHING = async (): Promise<SpotVerdict> => ({
  kind: 'out-of-reach',
  where: 'below-window',
});
const ALWAYS_AGREES = async (): Promise<SpotVerdict> => ({ kind: 'agrees' });

/** Admit a document the way the importer does, so a test can hold the branded value. */
function admit(document: SnapshotDocument) {
  const verdict = admitSnapshot(
    serializeSnapshot(document),
    { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
  );
  assert.equal(verdict.kind, 'admitted');
  if (verdict.kind !== 'admitted') throw new Error('unreachable');
  return verdict;
}


/** The same, for a document bound to a real 32-byte genesis — see {@link CLIENT_GENESIS}. */
function admitOnThisChain(document: SnapshotDocument) {
  const verdict = admitSnapshot(
    serializeSnapshot(document),
    {
      expectedPin: sha256(snapshotPreimage(document)),
      binding: { ...BINDING, genesisHash: CLIENT_GENESIS },
    },
    sha256,
  );
  assert.equal(verdict.kind, 'admitted');
  if (verdict.kind !== 'admitted') throw new Error('unreachable');
  return verdict;
}

function deps(overrides: Partial<ImportDependencies> = {}): ImportDependencies {
  return {
    spotCheck: REACHES_NOTHING,
    confirmEviction: async () => true,
    ...overrides,
  };
}

// ------------------------------------------------------------------ the happy path

test('a streamed snapshot is admitted and minted into labelled layer-3 rows', async () => {
  const document = validDocument();
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps({ spotCheck: ALWAYS_AGREES }),
  );
  assert.equal(outcome.kind, 'imported');
  if (outcome.kind !== 'imported') return;

  // Every balance carries the badge, and the badge names the provider (INV-FE-15).
  assert.equal(outcome.minted.balances.length, document.balances.length);
  for (const row of outcome.minted.balances) {
    assert.equal(row.status.kind, 'provider');
    if (row.status.kind !== 'provider') return;
    assert.equal(row.status.providerId, 'archive-one');
    assert.equal(row.value.origin, 'snapshot');
    assert.equal(row.value.providerId, 'archive-one');
  }
  // And the §7 import record, keyed by the pin — a snapshot's identity is its bytes.
  assert.equal(outcome.minted.record.id, sha256(snapshotPreimage(document)));
  assert.equal(outcome.minted.record.fromBlock, 10);
  assert.equal(outcome.minted.record.toBlock, 13);
  assert.equal(outcome.minted.record.importedAt, 1_700_000_000_000);
});

test('`sampled` is true only when the chain actually compared something', async () => {
  // The difference between "we spot-check this source" and "this row was compared". A mint that
  // set `sampled` because sampling is configured labels unverified rows as checked.
  const document = validDocument();
  const unreachable = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps({ spotCheck: REACHES_NOTHING }),
  );
  assert.equal(unreachable.kind, 'imported');
  if (unreachable.kind !== 'imported') return;
  assert.equal(unreachable.minted.status.kind, 'provider');
  if (unreachable.minted.status.kind !== 'provider') return;
  assert.equal(unreachable.minted.status.sampled, false, 'out-of-reach is not a comparison');

  const compared = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps({ spotCheck: ALWAYS_AGREES }),
  );
  assert.equal(compared.kind, 'imported');
  if (compared.kind !== 'imported') return;
  assert.equal(compared.minted.status.kind, 'provider');
  if (compared.minted.status.kind !== 'provider') return;
  assert.equal(compared.minted.status.sampled, true);
});

// ------------------------------------------------------------------ streamed, per §8.4

test('the byte quota refuses AT the chunk that crosses it, not after the file is read', async () => {
  // A quota checked after the resource is consumed is a post-mortem. The refusal must arrive
  // while the stream is still being pulled, and the chunks after it must never be requested.
  const document = validDocument();
  const requested: number[] = [];
  async function* huge(): AsyncIterable<SnapshotChunk> {
    for (let piece = 0; piece < 20; piece += 1) {
      requested.push(piece);
      yield { text: 'x'.repeat(1024), bytes: 40_000_000 };
    }
  }
  const outcome = await importSnapshotStream(huge(), requestFor(document), deps());
  assert.equal(outcome.kind, 'over-quota');
  if (outcome.kind !== 'over-quota') return;
  assert.equal(outcome.breach, 'bytes');
  assert.match(outcome.message, /larger than the import limit/);
  assert.equal(requested.length, 11, 'ten chunks fit, the eleventh crosses, and pulling stops');
});

test('nothing is previewed or minted once a quota refuses', async () => {
  const document = validDocument();
  let previews = 0;
  async function* huge(): AsyncIterable<SnapshotChunk> {
    yield { text: 'x', bytes: 400_000_001 };
  }
  const outcome = await importSnapshotStream(
    huge(),
    requestFor(document),
    deps({
      confirmEviction: async () => {
        previews += 1;
        return true;
      },
    }),
  );
  assert.equal(outcome.kind, 'over-quota');
  assert.equal(previews, 0, 'a refused import never asks the user to give anything up');
});

test('the ROW quota is metered on the stream too, not only after the parse', async () => {
  // §8.4 says "streamed", and until 2026-08-06 that held for bytes and not for rows: the row
  // count was taken from the parsed document, so a file of four million tiny rows was fully
  // resident and fully parsed before anything objected.
  //
  // The discriminating assertion is that this input is **not JSON**. If the row meter ran only
  // after the parse, the outcome would be `rejected`/`malformed`; `over-quota`/`rows` can only
  // come from a meter that ran while the bytes were arriving.
  const document = validDocument();
  let pulled = 0;
  async function* manyRows(): AsyncIterable<SnapshotChunk> {
    pulled += 1;
    const text = '{'.repeat(IMPORT_MAX_ROWS + 1);
    yield { text, bytes: text.length };
    pulled += 1;
    yield { text: '{', bytes: 1 };
  }
  const outcome = await importSnapshotStream(manyRows(), requestFor(document), deps());
  assert.equal(outcome.kind, 'over-quota');
  if (outcome.kind !== 'over-quota') return;
  assert.equal(outcome.breach, 'rows');
  assert.equal(pulled, 1, 'and pulling stopped at the chunk that crossed the bound');
});

test('the streaming row meter over-counts and never under-counts', async () => {
  // The direction is the whole safety argument: every row this format stores is a JSON object, so
  // `{` is an upper bound on rows. Over-counting can refuse a document just under the bound,
  // which costs a user nothing; under-counting would admit one over it, which is the unusable
  // local database §8.4 has a row bound for.
  const document = validDocument();
  const text = serializeSnapshot(document);
  const exact =
    document.ops.length +
    document.balances.length +
    document.vaults.length +
    document.coverage.length;
  assert.ok(rowUpperBound(text) >= exact, `${rowUpperBound(text)} must bound ${exact}`);
  // Three objects that are not rows — the document, its binding and its range.
  assert.equal(rowUpperBound(text), exact + 3);
});

test('the byte bound is the DEVICE\'s, and a caller may only narrow it', async () => {
  // 400 MB of input is not 400 MB of memory, and §9.4 budgets a mobile tab 350 MB in total while
  // §9.2 caps its whole local store at 75 MB. So the bound is a required field with no default —
  // and a caller cannot use it to grant themselves more than §8.4 allows (SQ-632).
  const document = validDocument();
  await assert.rejects(
    () =>
      importSnapshotStream(
        streamOf(serializeSnapshot(document)),
        { ...requestFor(document), maxInputBytes: IMPORT_MAX_UNCOMPRESSED_BYTES + 1 },
        deps(),
      ),
    /may bound an import further than the specification does and may not loosen it/,
  );

  // And a narrower bound refuses at the chunk that crosses it, exactly as the spec ceiling does.
  const tight = await importSnapshotStream(
    streamOf(serializeSnapshot(document), 4),
    { ...requestFor(document), maxInputBytes: 32 },
    deps(),
  );
  assert.equal(tight.kind, 'over-quota');
  if (tight.kind !== 'over-quota') return;
  assert.equal(tight.breach, 'bytes');
});

test('the row quota is a separate bound, checked once the document parses', async () => {
  // 400 MB in 100 rows and 4 M rows in 10 MB are each inside one bound and outside the other.
  // The row count is only knowable after a parse, which is exactly why it is checked there and
  // not pretended to be a property of a chunk.
  assert.ok(IMPORT_MAX_ROWS > 0);
  const document = validDocument();
  const rows =
    document.ops.length +
    document.balances.length +
    document.vaults.length +
    document.coverage.length;
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps(),
  );
  assert.equal(outcome.kind, 'imported');
  if (outcome.kind !== 'imported') return;
  assert.equal(outcome.quota.rows, rows, 'every array in the document is rows in the store');
});

// -------------------------------------------------- eviction preview BEFORE import (§8.4)

test('the eviction preview is shown before the mint, and the plan names what goes', async () => {
  const document = validDocument();
  const seen: ImportPlan[] = [];
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    // A budget below what is already held, so something must be evicted for anything to fit.
    requestFor(document, 1_000_000),
    deps({
      confirmEviction: async (plan, copy) => {
        seen.push(plan);
        assert.match(copy, /delete local data to make room/);
        return true;
      },
    }),
  );
  assert.equal(outcome.kind, 'imported');
  assert.equal(seen.length, 1, 'asked exactly once');
  assert.ok((seen[0]?.wouldEvict.length ?? 0) > 0);
  // Oldest first — §9.2's ladder gives up depth before recency.
  assert.equal(seen[0]?.wouldEvict[0]?.table, 'priceSamples');
});

test('declining the preview imports nothing, and is not reported as a refusal of the file', async () => {
  // A user keeping their own history is not an error, so it carries no FE-PROV code: labelling
  // it FE-PROV-003 would tell them their snapshot was rejected when it was not.
  const document = validDocument();
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document, 1_000_000),
    deps({ confirmEviction: async () => false }),
  );
  assert.equal(outcome.kind, 'declined');
  if (outcome.kind !== 'declined') return;
  assert.equal(outcome.why, 'user');
  assert.equal(outcome.message, EVICTION_DECLINED);
  assert.ok(!('refusal' in outcome));
});

test('an import that cannot fit at all is declined WITHOUT asking a question nobody can answer', async () => {
  const document = validDocument();
  let asked = 0;
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    { ...requestFor(document, 1), footprint: [] },
    deps({
      confirmEviction: async () => {
        asked += 1;
        return true;
      },
    }),
  );
  assert.equal(outcome.kind, 'declined');
  if (outcome.kind !== 'declined') return;
  assert.equal(outcome.why, 'does-not-fit');
  assert.equal(asked, 0, 'a confirm dialog for an impossible action teaches people to click through');
  assert.match(outcome.message, /does not fit even after evicting/);
});

// ------------------------------------------------------------------ ordering and refusals

test('a rejected snapshot never reaches the preview — nothing local is put at risk', async () => {
  // FE-PROV-003's recovery promises exactly this: "the eviction preview happens before import
  // precisely so a rejected snapshot costs the user nothing".
  const document = validDocument();
  let asked = 0;
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    { ...requestFor(document), admission: { expectedPin: 'not-the-pin', binding: { ...BINDING } } },
    deps({
      confirmEviction: async () => {
        asked += 1;
        return true;
      },
    }),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.equal(outcome.refusal.code, 'FE-PROV-003');
  assert.equal(asked, 0);
});

test('an UNFINISHED re-derivation is DISCLOSED — imported unbadged, publisher untouched', async () => {
  // This asserted a refusal until 2026-08-06, and the refusal was the fixed blocker's own defect
  // class with a narrower trigger. §8.4 gives `FE-PROV-003` three causes — content-pin mismatch,
  // malformed encoding, failed internal consistency — and *"this device ran out of asks"* is none
  // of them; the bullet above them names the depth limit as **disclosed**. Two live
  // configurations reach the ceiling with nothing wrong with the file, and for one of them (more
  // reachable covered blocks than the ceiling) the old remedy — *"try again when this device has
  // caught up"* — was false, so the refusal was permanent.
  //
  // What replaces it is not silence. The document is admitted, `reach` states that the walk
  // stopped at the ceiling, and the mint refuses to badge the rows `sampled` however many blocks
  // were compared — so nothing claims the check §8.4 mandates was finished. SQ-811 asks §8.4 to
  // rule this; a ruling toward refusal brings back `spot-check-incomplete` and its remedy.
  const document: SnapshotDocument = {
    ...validDocument(),
    range: { fromBlock: 10, toBlock: 10_000 },
    coverage: [{ fromBlock: 10, toBlock: 10_000 }],
  };
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    // Never `out-of-reach`, so nothing terminates the walk except the ceiling.
    deps({ spotCheck: ALWAYS_AGREES }),
  );
  assert.equal(outcome.kind, 'imported');
  if (outcome.kind !== 'imported') return;
  assert.equal(outcome.spotCheck.reach, 'ceiling');
  assert.deepEqual(outcome.spotCheck.findings, [], 'a disclosure raises no finding');
  assert.ok(outcome.spotCheck.compared > 0, 'blocks WERE compared — the pass simply did not finish');
  assert.equal(outcome.minted.status.kind, 'provider');
  if (outcome.minted.status.kind !== 'provider') return;
  // The whole of what keeps the admission honest: hundreds of blocks agreed and the rows still
  // do not claim the mandated check ran, because it did not.
  assert.equal(outcome.minted.status.sampled, false);
  // The source is untouched, and now structurally so: only the `rejected` outcome carries a
  // provider at all, because only a refusal can advance the ladder. A ceiling this client chose
  // was never evidence about the publisher, and there is no longer a shape in which it could be.
  assert.equal(outcome.minted.status.providerId, PUBLISHER.id);
});

test('a chain disagreement rejects with the chain-disagreement remedy, before the preview', async () => {
  const document = validDocument();
  let asked = 0;
  const disagrees = async (claim: SpotClaim): Promise<SpotVerdict> =>
    claim.block === 13 ? { kind: 'disagrees', derived: [] } : { kind: 'agrees' };
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps({
      spotCheck: disagrees,
      confirmEviction: async () => {
        asked += 1;
        return true;
      },
    }),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.deepEqual(
    [...new Set(outcome.findings.map((finding) => finding.screen))],
    ['spot-check'],
  );
  assert.match(outcome.refusal.detail, /re-derived part of the snapshot from the chain/);
  assert.equal(asked, 0);
});

test('the auto-disable sentence counts the blocks it RE-DERIVED, not the ones it could not', async () => {
  // §10.4 gives this code fixed copy with one per-occurrence part, so the numbers in it are the
  // whole of what the user is told. The denominator was `compared + outOfReach`, which counts
  // blocks this device never re-derived: a publisher caught contradicting the chain in the one
  // block inside the window was reported as *"1 of 2 blocks … do not match"*, which reads as an
  // error rate on a sample rather than as everything that was checked disagreeing.
  const document = validDocument();
  const mixed = async (claim: SpotClaim): Promise<SpotVerdict> => {
    if (claim.block === 13) return { kind: 'disagrees', derived: [] };
    if (claim.block === 12) return { kind: 'agrees' };
    return { kind: 'out-of-reach', where: 'below-window' };
  };
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    requestFor(document),
    deps({ spotCheck: mixed }),
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.equal(outcome.provider.health.kind, 'disabled');
  if (outcome.provider.health.kind !== 'disabled') return;
  // Two compared (13, 12) and one out of reach (11), where the walk stopped.
  assert.match(outcome.provider.health.reason, /1 of 2 blocks this device re-derived/);
  assert.doesNotMatch(outcome.provider.health.reason, /1 of 3/);
});

test('a SWITCHED-OFF source cannot supply rows, and is refused before a byte is read', async () => {
  // §8.3: only `Disabled` stops reads — and this path asked nothing about health at all, so an
  // import from a source auto-disabled for contradicting the chain succeeded and minted rows
  // badged with its id, while `FE-PROV-002`'s recovery was telling the user that source "has been
  // switched off" and that turning it back on was theirs to do.
  const document = validDocument();
  const off: Provider = {
    ...PUBLISHER,
    health: { kind: 'disabled', by: 'auto', reason: 'a re-derived block did not match' },
  };
  let chunks = 0;
  async function* counted(): AsyncIterable<SnapshotChunk> {
    chunks += 1;
    yield* streamOf(serializeSnapshot(document));
  }
  await assert.rejects(
    () =>
      importSnapshotStream(
        counted(),
        { ...requestFor(document), provider: off },
        deps({
          spotCheck: ALWAYS_AGREES,
          confirmEviction: async () => {
            throw new Error('a source that cannot supply rows must never cost an eviction');
          },
        }),
      ),
    /is switched off/,
  );
  assert.equal(chunks, 0, 'refused before the stream was touched');

  // An UNPROBED source is not refused here, and that asymmetry is deliberate: a pinned file the
  // user already holds is admitted by its content hash and the §8.4 screens, none of which asks
  // the endpoint anything — and nothing in this release drives §8.3's probe, so gating on it
  // would refuse every import from a freshly accepted suggestion forever (SQ-773).
  const fresh: Provider = { ...PUBLISHER, health: { kind: 'unprobed' } };
  const admitted = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    { ...requestFor(document), provider: fresh },
    deps({ spotCheck: ALWAYS_AGREES }),
  );
  assert.equal(admitted.kind, 'imported');
});

test('the whole-text form and the streamed form admit exactly the same documents', async () => {
  // The producer CLI keeps `admitSnapshot(text, …)`. What it must not have is a different rule:
  // a more lenient publisher-side path certifies documents the client rejects.
  const document = validDocument();
  const text = serializeSnapshot(document);
  const streamed = await importSnapshotStream(streamOf(text, 3), requestFor(document), deps());
  const oneChunk = await importSnapshotStream(streamOf(text, 1), requestFor(document), deps());
  assert.equal(streamed.kind, 'imported');
  assert.equal(oneChunk.kind, 'imported');
  if (streamed.kind !== 'imported' || oneChunk.kind !== 'imported') return;
  assert.deepEqual(streamed.minted, oneChunk.minted);
});

test('the mint cannot be reached with a document that was never admitted', async () => {
  // "The mint is the only way an admitted document becomes rows" has to be a property of the
  // type system, not a comment. `AdmittedSnapshot` carries a phantom field only `snapshot.ts`
  // can name, so a plausible object literal — parsed, well shaped, unscreened — is untypeable
  // here. The directive is itself the assertion: if this ever compiled, `tsc` reports it as
  // unused and `check:types` goes red.
  const report = await spotCheckSnapshot(validDocument(), ALWAYS_AGREES);
  const uncallable: () => unknown = () =>
    mintSnapshotRows(
      // @ts-expect-error an admitted snapshot is minted by admitSnapshot, never built
      { kind: 'admitted', document: validDocument() },
      report,
      { providerId: 'forger', pin: 'whatever', importedAt: 0 },
    );
  assert.equal(typeof uncallable, 'function');
});

test('the mint cannot be reached with a spot-check report that was never run', () => {
  // The second half of the same property, and the half that was open until 2026-08-06: the
  // admission brand certifies the *file screens*, and §8.4 additionally mandates a comparison
  // against the chain. With the report as a plain field of the request, any holder of an admitted
  // document could write `{ compared: 1, outOfReach: 0, findings: [] }` and mint rows badged
  // `sampled: true` having compared nothing.
  const admitted = admit(validDocument());
  const uncallable: () => unknown = () =>
    mintSnapshotRows(
      admitted,
      // @ts-expect-error a spot-check report is produced by spotCheckSnapshot, never built
      { document: validDocument(), compared: 1, outOfReach: 0, findings: [] },
      { providerId: 'forger', pin: 'whatever', importedAt: 0 },
    );
  assert.equal(typeof uncallable, 'function');
});

test('a real report for a DIFFERENT document does not mint this one', async () => {
  // The brand proves a pass happened, not that it happened over this file. A caller holding two
  // documents could otherwise spot-check the honest one and mint the forged one with its report.
  const admitted = admit(validDocument());
  const elsewhere = await spotCheckSnapshot(validDocument(), ALWAYS_AGREES);
  assert.throws(
    () => mintSnapshotRows(admitted, elsewhere, { providerId: 'p', pin: 'x', importedAt: 0 }),
    /produced for a different document/,
  );
});

test('a report that CAUGHT a disagreement mints nothing', async () => {
  // Measured before the fix: `mint()` read `compared > 0` and ignored `findings` entirely, so a
  // report whose whole content was "this document contradicts the chain" produced exactly the
  // rows a clean one did — badged `sampled: true`, which is the badge saying the comparison
  // passed.
  const document = validDocument();
  const admitted = admit(document);
  const caught = await spotCheckSnapshot(admitted.document, async (claim) =>
    claim.block === 13 ? { kind: 'disagrees', derived: [] } : { kind: 'agrees' },
  );
  assert.ok(caught.findings.length > 0);
  assert.ok(caught.compared > 0, 'and it did compare, so `sampled` would have been true');
  assert.throws(
    () => mintSnapshotRows(admitted, caught, { providerId: 'p', pin: 'x', importedAt: 0 }),
    /carries 1 finding/,
  );
});

test('every minted range carries §6.3’s edge on its UNVERIFIABLE arm, and says why', async () => {
  // 10 §6.3's edge is a discriminated union because this module is the reason it had to be: it
  // is the only production producer of `snapshot` and `indexer` ranges, and it cannot honestly
  // fill two of the three facts. Asserted here on the producer, and asserted against the real
  // consumer below, because a shape agreed on by one side is a shape that can drift.
  const document = { ...validDocument(), binding: { ...BINDING, genesisHash: CLIENT_GENESIS } };
  const admitted = admitOnThisChain(document);
  const report = await spotCheckSnapshot(admitted.document, REACHES_NOTHING);
  const minted = mintSnapshotRows(admitted, report, {
    providerId: 'archive-one',
    pin: sha256(snapshotPreimage(document)),
    importedAt: 5,
  });
  assert.ok(minted.coverage.length > 0);
  for (const range of minted.coverage) {
    assert.equal(range.edge.kind, 'unverifiable');
    if (range.edge.kind !== 'unverifiable') continue;
    // The genesis comes from the admitted document, and the brand is what makes that honest:
    // `admitSnapshot` refuses on a binding mismatch, so this is **this client's** chain.
    assert.equal(range.edge.genesisHash, CLIENT_GENESIS);
    assert.match(range.edge.why, /no block hash/);
    assert.match(range.edge.why, /spec_version/);
  }

  // The indexer arm says something different, because its reason is a different one: an indexer
  // pins no document at all, so there is not even a claimed spec_version to decline.
  const round = await runSamplingRound(
    { id: 'live-one', kind: 'indexer', health: { kind: 'healthy' } },
    [{ rows: [{ reference: 'k', claimed: 'v' }] }],
    async () => ({ kind: 'match' }),
    () => 0,
  );
  const live = mintIndexerRows(document.balances, document.coverage, round, {
    providerId: 'live-one',
    importedAt: 7,
    genesisHash: CLIENT_GENESIS,
  });
  const liveEdge = live.coverage[0]?.edge;
  assert.equal(liveEdge?.kind, 'unverifiable');
  assert.match(liveEdge?.kind === 'unverifiable' ? liveEdge.why : '', /live indexer/);

  // A genesis this client cannot have is refused rather than stamped. It is the one §6.3 check a
  // provider range still carries, and a placeholder makes it a check that always passes or
  // always fails.
  assert.throws(
    () =>
      mintIndexerRows(document.balances, document.coverage, round, {
        providerId: 'live-one',
        importedAt: 7,
        genesisHash: '0xfeed',
      }),
    /must name this client's genesis hash/,
  );
});

test('a minted provider range is neither invalidated nor treated as checked by the real index', async () => {
  // The binding that makes the two halves one design: the range this module produced goes
  // through `@bleavit/local-index`'s own `addRange` and `verifyRanges`, not through a restatement
  // of what they were believed to do. `packages/providers` may not import that package's values
  // in production (Dexie would come with it), so the check belongs in a suite, where the
  // dependency carries no production edge.
  const document = { ...validDocument(), binding: { ...BINDING, genesisHash: CLIENT_GENESIS } };
  const admitted = admitOnThisChain(document);
  const report = await spotCheckSnapshot(admitted.document, REACHES_NOTHING);
  const minted = mintSnapshotRows(admitted, report, {
    providerId: 'archive-one',
    pin: sha256(snapshotPreimage(document)),
    importedAt: 5,
  });

  // Accepted: `assertCanonical` validates every edge, so a mint emitting a malformed one would
  // make the whole index unusable at the next mutation rather than here.
  const coverage = minted.coverage.reduce(addRange, EMPTY_COVERAGE);
  assert.equal(coverage.ranges.length, minted.coverage.length);

  // The chain answers, and it answers with a spec version and a hash that have nothing to do
  // with this document — which is the ordinary case for deep history (§6.4). Neither invalidates
  // it, and it is still reported as unchecked rather than passing quietly.
  const checked = verifyRanges(coverage, () => ({
    genesisHash: CLIENT_GENESIS,
    hash: `0x${'9'.repeat(64)}`,
    specVersion: 99,
  }));
  assert.deepEqual(checked.invalidated, []);
  assert.equal(checked.coverage.ranges.length, coverage.ranges.length);
  assert.equal(checked.unchecked.length, coverage.ranges.length);

  // And the genesis binding still bites, on the same range: the arm is a disclosure, not a hole.
  const foreign = verifyRanges(coverage, () => ({
    genesisHash: `0x${'ab'.repeat(32)}`,
    hash: `0x${'9'.repeat(64)}`,
    specVersion: 99,
  }));
  assert.equal(foreign.invalidated.length, coverage.ranges.length);
  assert.equal(foreign.coverage.ranges.length, 0);
});

test('an indexer mint labels `indexer`, and shares the labelling code with the snapshot one', async () => {
  // Two origins, one labelling discipline. A second mint would drift, and the drift is
  // invisible: both produce rows that render, and only one of them is honest about where they
  // came from. The evidence differs by §8.4's own design — indexers get *sampling* where
  // snapshots get *screens* — so the argument is a `SampledRound` and not a snapshot's report.
  const round = await runSamplingRound(
    { id: 'live-one', kind: 'indexer', health: { kind: 'healthy' } },
    [{ rows: [{ reference: 'k', claimed: 'v' }] }],
    async () => ({ kind: 'match' }),
    () => 0,
  );
  const minted = mintIndexerRows(validDocument().balances, validDocument().coverage, round, {
    providerId: 'live-one',
    importedAt: 7,
    genesisHash: CLIENT_GENESIS,
  });
  for (const row of minted.balances) {
    assert.equal(row.value.origin, 'indexer');
    assert.equal(row.status.kind, 'provider');
  }
  assert.equal(minted.coverage[0]?.origin, 'indexer');
  assert.equal(minted.coverage[0]?.ingestedAt, 7, '§6.3 requires it on every range');
  assert.equal(minted.status.kind, 'provider');
  if (minted.status.kind !== 'provider') return;
  assert.equal(minted.status.sampled, true, 'one row was actually compared');
  // And no `snapshotsImported` record: an indexer pins no file, so there is nothing to key one by.
  assert.equal('record' in minted, false);
});

test('an indexer mint cannot be reached with a round nobody ran', () => {
  // The literal below is complete **except for the brand** — every other field of a `SampledRound`
  // is present and correctly typed. That is deliberate: a literal missing three fields fails to
  // typecheck whatever the brand does, so the directive would keep firing for the wrong reason and
  // dropping the brand would survive. Measured: it did, until this fixture was completed.
  const uncallable: () => unknown = () =>
    mintIndexerRows(
      validDocument().balances,
      validDocument().coverage,
      // @ts-expect-error a sampled round is produced by runSamplingRound, never built
      {
        provider: PUBLISHER,
        outcome: 'clean',
        result: { rowsChecked: 9, mismatches: 0, unverifiable: 0 },
        selection: { rows: [], strata: 1, emptyStrata: 0 },
        mismatches: [],
        refusal: undefined,
      },
      { providerId: 'live-one', importedAt: 7, genesisHash: CLIENT_GENESIS },
    );
  assert.equal(typeof uncallable, 'function');
});

test('a round that caught the indexer lying mints none of its rows', async () => {
  const round = await runSamplingRound(
    { id: 'live-one', kind: 'indexer', health: { kind: 'healthy' } },
    [{ rows: [{ reference: 'k', claimed: 'a lie' }] }],
    async () => ({ kind: 'mismatch', expected: 'the truth' }),
    () => 0,
  );
  assert.equal(round.outcome, 'mismatch');
  assert.throws(
    () =>
      mintIndexerRows(validDocument().balances, validDocument().coverage, round, {
        providerId: 'live-one',
        importedAt: 7,
        genesisHash: CLIENT_GENESIS,
      }),
    /was disabled by this sampling round/,
  );
});

test('an inconclusive round mints rows that say `sampled: false`', async () => {
  const round = await runSamplingRound(
    { id: 'live-one', kind: 'indexer', health: { kind: 'healthy' } },
    [{ rows: [{ reference: 'k', claimed: 'v' }] }],
    async () => ({ kind: 'unverifiable', why: 'beyond-reach' }),
    () => 0,
  );
  const minted = mintIndexerRows(validDocument().balances, validDocument().coverage, round, {
    providerId: 'live-one',
    importedAt: 7,
    genesisHash: CLIENT_GENESIS,
  });
  assert.equal(minted.status.kind, 'provider');
  if (minted.status.kind !== 'provider') return;
  assert.equal(minted.status.sampled, false, 'nothing was comparable, so nothing was compared');
});

test('an import that cannot label its rows refuses BEFORE it reads a byte', async () => {
  // It used to surface from the mint, which runs after the eviction preview: the user was asked
  // to give up local history and then got a bare `RangeError` — the wrong order, and the
  // free-text error §10.4 forbids on a user path. Now nothing is read, nothing is asked.
  const document = validDocument();
  let pulled = 0;
  let asked = 0;
  async function* counted(): AsyncIterable<SnapshotChunk> {
    pulled += 1;
    yield { text: serializeSnapshot(document), bytes: 1_000 };
  }
  await assert.rejects(
    () =>
      importSnapshotStream(
        counted(),
        { ...requestFor(document), provider: { ...PUBLISHER, id: '' } },
        deps({
          confirmEviction: async () => {
            asked += 1;
            return true;
          },
        }),
      ),
    RangeError,
  );
  assert.equal(pulled, 0, 'the stream was never pulled');
  assert.equal(asked, 0, 'and the user was never asked to evict anything');
});
