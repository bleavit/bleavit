/**
 * FE-R1 — the 02 §11 row-4 consumer: mock-runtime PR suites over the published
 * chainHead fixtures.
 *
 * 11 §11.13's acceptance criterion is *"callable via chainHead on Zombienet; bounds
 * asserted"*. This suite discharges the callable-and-bounded half against the recorded
 * transcripts, per commit, with no node and no network; the Zombienet execution of the
 * same surface rides the B7 drill set.
 *
 * Three properties are load-bearing and each is proved rather than assumed:
 *
 * 1. **The fixture set is complete against the frozen surface.** Bidirectional against
 *    `tools/release/surface-manifest.json`: every manifest entry has a fixture and every
 *    fixture answers to a manifest entry. A one-directional check passes a corpus that
 *    quietly stopped covering something.
 * 2. **Bounds are asserted against the specification, not against the recording.**
 *    Reading 32 out of a fixture and asserting it equals 32 proves nothing. The expected
 *    values below are transcribed from 02 §9's frozen table, so a runtime that changed a
 *    bound fails here even though its own metadata is self-consistent.
 * 3. **The mock refuses what it was not taught.** A test double that answers everything
 *    turns a missing surface into a green run — the exact defect this artifact exists to
 *    catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  chainHeadCall,
  chainHeadStorageValue,
  createFixtureBundle,
  createMockRuntime,
  metadataPresence,
  recoveryMetadataPresence,
  UnrecordedRequestError,
} from '@bleavit/mock-runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');
// Read the manifest **in place** in `tools/release/`, never a copy under `app/`: it is
// the backend's frozen critical surface and a second copy is a thing that can drift.
const MANIFEST = resolve(HERE, '..', '..', '..', 'tools', 'release', 'surface-manifest.json');

function loadBundle() {
  const names = readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json'));
  const report = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'));
  const fixtures = names
    .filter((n) => n !== 'fixtures-report.json')
    .map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), 'utf8')));
  assert.ok(fixtures.length > 0, 'no chainHead fixtures found — this suite would be vacuous');
  return createFixtureBundle(report, fixtures);
}

/** Decode a little-endian unsigned integer from the recorder's `0x…` constant value. */
function decodeUint(hex) {
  const bytes = hex.slice(2).match(/../g) ?? [];
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(parseInt(bytes[i], 16));
  return value;
}

const bundle = loadBundle();

test('the recording is strictly ready and was taken over chainHead v1', () => {
  const { report } = bundle;
  assert.equal(report.schema, 'bleavit.chainhead-fixtures-report.v1');
  // A recording taken over the legacy RPC would not certify the API 10 §2 binds to.
  assert.equal(report.mode, 'chainHead-v1');
  assert.equal(report.strict_ready, true, 'fixtures were recorded with required surface missing');
  assert.equal(report.missing.length, 0);
  assert.equal(report.recovery_missing.length, 0);
  assert.equal(report.recovery_metadata_present, true, '10 §5.1: the paired recovery runtime must be recorded too');
  // v14 has no runtime-APIs section at all, so a v14 recording cannot describe one
  // frozen `FutarchyApi` method (V-75).
  assert.ok(report.metadata_version >= 15, `metadata v${report.metadata_version} predates the runtime-APIs section`);
});

test('every frozen surface entry has a fixture, and every fixture a manifest entry', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const expected = new Set(manifest.entries.map((e) => e.id));
  const recorded = new Set(bundle.fixtures.keys());

  const unrecorded = [...expected].filter((s) => !recorded.has(s)).sort();
  const orphan = [...recorded].filter((s) => !expected.has(s)).sort();
  assert.deepEqual(unrecorded, [], 'frozen surface entries with no recorded fixture');
  assert.deepEqual(orphan, [], 'fixtures answering to no frozen surface entry');
  assert.equal(recorded.size, expected.size);
  assert.ok(expected.size >= 200, `frozen surface shrank to ${expected.size} entries — a smaller manifest passes this suite by covering less`);
});

test('all thirteen frozen FutarchyApi methods are callable via chainHead', () => {
  // 02 §3 freezes exactly these. The list is written out rather than derived from the
  // fixtures so that losing one is a failure here and not a quieter corpus.
  const methods = [
    'account_positions', 'decision_stats', 'epoch_status', 'execution_queue',
    'hosted_report', 'nav', 'open_oracle_rounds', 'params', 'proposal_summaries',
    'quote', 'recent_cohorts', 'service_positions', 'welfare_current',
  ];
  const runtime = createMockRuntime(bundle);
  for (const method of methods) {
    const surface = `api.${method}`;
    assert.ok(bundle.fixtures.has(surface), `${surface} has no fixture`);
    const presence = metadataPresence(runtime, surface, 'runtime_api');
    assert.equal(presence.present, true, `${surface}: ${presence.detail}`);
    assert.equal(presence.layout_matches, true, `${surface}: ${presence.detail}`);
  }
  assert.equal(methods.length, 13, '02 §3 freezes thirteen methods');
});

test('FE-R1 bounds are exactly 02 §9\'s frozen values', () => {
  // Transcribed from 02 §9, NOT read back from the recording — see the header note.
  const bounds = {
    'constant.epoch.recent_cohorts': 32n,              // RecentCohortSummaries ring
    'constant.epoch.max_live_proposals': 32n,          // MaxLiveProposals
    'constant.epoch.max_intake_queue': 64n,            // IntakeQueue
    'constant.ledger.max_positions_per_account': 64n,  // MaxPositionsPerAccount
    'constant.identity.ss58_prefix': 7777n,
    'constant.identity.contract_version': 26n,         // INTEGRATION_CONTRACT_VERSION (v26: SQ-589)
    'constant.market.max_live_markets': 196n,
    'constant.market.max_stored_markets': 2240n,
    'constant.market.max_live_external_markets': 128n,
    'constant.market.max_stored_external_markets': 128n,
    'constant.market.max_all_stored_markets': 2368n,
    'constant.epoch.books_per_proposal': 6n,
    'constant.ledger.service_id_base': 1n << 63n,      // the primary/service boundary
  };
  const runtime = createMockRuntime(bundle);
  for (const [surface, expected] of Object.entries(bounds)) {
    const presence = metadataPresence(runtime, surface, 'constant');
    assert.equal(presence.present, true, `${surface} absent from metadata`);
    const actual = decodeUint(presence.layout.value);
    assert.equal(actual, expected, `${surface}: chain says ${actual}, 02 §9 freezes ${expected}`);
  }
});

test('both ledger domains are served separately and neither is merged (11 §11.2a)', () => {
  // Contract v23 makes 64 primary + 64 service positions simultaneously lawful. The
  // bound is *per instance*, so a suite asserting one number against a merged read
  // would pass while certifying a total that describes no sovereign account (I-4).
  const primary = [...bundle.fixtures.keys()].filter((s) => s.startsWith('storage.ledger.'));
  const service = [...bundle.fixtures.keys()].filter((s) => s.startsWith('storage.service_ledger.'));
  assert.ok(primary.length > 0 && service.length > 0, 'both ledger instances must be recorded');
  // The same item names on both sides — two instances of one pallet, not one merged view.
  const strip = (p) => p.map((s) => s.split('.').slice(2).join('.')).sort();
  assert.deepEqual(strip(primary), strip(service), 'the two ledger instances expose different items');

  assert.ok(bundle.fixtures.has('api.account_positions'), 'primary domain position view');
  assert.ok(bundle.fixtures.has('api.service_positions'), 'service domain position view');
  // The boundary is a metadata constant precisely so the client never writes 2^63
  // as a literal (02 §9; app-code rule 8).
  assert.ok(bundle.fixtures.has('constant.ledger.service_id_base'));
});

test('the paired terminal-recovery runtime serves the same metadata surface (10 §5.1)', () => {
  const runtime = createMockRuntime(bundle);
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  // Kind comes from the manifest, never from the surface-name prefix: 02 §12's
  // `ReleaseChannel` is named `storage.constitution.release_channel` but its kind is
  // `raw_storage` — a fixed-layout raw key a stranded reader resolves *without*
  // metadata, so there is no metadata item to compare. `properties` is an RPC.
  const NON_METADATA = new Set(['raw_storage', 'properties']);
  let checked = 0;
  for (const entry of manifest.entries) {
    const surface = entry.id;
    if (NON_METADATA.has(entry.kind)) continue;
    const presence = recoveryMetadataPresence(runtime, surface, entry.kind);
    assert.equal(presence.present, true, `recovery runtime lacks ${surface}: ${presence.detail}`);
    assert.equal(presence.layout_matches, true, `recovery layout differs for ${surface}: ${presence.detail}`);
    checked += 1;
  }
  assert.ok(checked >= 200, `only ${checked} surfaces checked against the recovery runtime`);
});

test('storage and runtime-API reads replay through the chainHead transcript', () => {
  const runtime = createMockRuntime(bundle);
  // A runtime API that returns a non-empty SCALE body...
  const status = chainHeadCall(runtime, 'FutarchyApi_epoch_status');
  assert.match(status, /^0x[0-9a-f]+$/);
  assert.ok(status.length > 2, 'epoch_status returned an empty body');
  // ...and a storage read that resolves to at least one item.
  const key = bundle.fixtures.get('storage.epoch.recent_cohort_summaries')
    .requests.find((r) => r.method === 'chainHead_v1_storage').params[2][0];
  const items = chainHeadStorageValue(runtime, key.key, key.type);
  assert.ok(Array.isArray(items), 'RecentCohortSummaries did not replay');
});

test('the twelve surfaces contract v24 froze are present and probeable (SQ-580)', () => {
  // The completeness test above is bidirectional between the manifest and the
  // fixtures, so it passes just as happily on a manifest that never listed these —
  // it proves the two artifacts agree, not that they cover what docs 10/11 require.
  // These are named individually because their *absence* was the defect: with no
  // frozen entry there is nothing for a 10 §5.2 probe to ask about, so a runtime
  // upgrade that moved one would leave the classifier reporting `full` while the
  // dependent path broke. Naming them is what makes deleting one fail here.
  const frozen = [
    'storage.epoch.resource_locks',            // 09 §1.2(8) dispatch check, 11 §11.5 row 9
    'storage.multisig.multisigs',              // 11 §11.3 — blocked F6's multisig/proxy
    'storage.referenda.referendum_count',
    'storage.referenda.referendum_info_for',
    'storage.referenda.track_queue',
    'storage.referenda.deciding_count',
    'storage.preimage.status_for',
    'storage.preimage.preimage_for',
    'storage.conviction_voting.voting_for',
    'storage.conviction_voting.class_locks_for',
    'storage.scheduler.agenda',                // display only (11 §11.7.2)
    'storage.system.events',                   // 10 §4.2 — events are state
  ];
  const runtime = createMockRuntime(bundle);
  for (const surface of frozen) {
    assert.ok(bundle.fixtures.has(surface), `${surface} has no fixture`);
    const presence = metadataPresence(runtime, surface, 'storage');
    assert.equal(presence.present, true, `${surface}: ${presence.detail}`);
    assert.equal(presence.layout_matches, true, `${surface}: ${presence.detail}`);
  }
  assert.equal(frozen.length, 12, 'contract v24 froze twelve surfaces');
});

test('System.Events freezes its container while §6 freezes the payload (SQ-580)', () => {
  // `System.Events` has value `Vec<EventRecord<RuntimeEvent>>`. Expanding RuntimeEvent
  // restates every event of every pallet — 2.2 MB — and makes this row's drift signal
  // fire whenever any unrelated pallet gains an event. The manifest therefore elides
  // it, which is only sound because §6 freezes those events one by one. This asserts
  // both halves: the container is still checked, and the elision did not swallow it.
  const runtime = createMockRuntime(bundle);
  const presence = metadataPresence(runtime, 'storage.system.events', 'storage');
  assert.equal(presence.present, true, presence.detail);
  assert.equal(presence.layout_matches, true, presence.detail);
  const value = presence.layout.value;
  for (const part of ['EventRecord', 'phase', 'topics', 'bleavit_runtime::RuntimeEvent']) {
    assert.ok(value.includes(part), `System.Events layout lost ${part}`);
  }
  assert.ok(
    !value.includes('ExtrinsicSuccess'),
    'RuntimeEvent was expanded rather than elided — the row now restates every pallet event',
  );
});

test('the mock refuses an unrecorded request rather than answering it', () => {
  const runtime = createMockRuntime(bundle);
  assert.throws(
    () => runtime.respond('chainHead_v1_call', ['subscription-1', runtime.pinnedBlock(), 'FutarchyApi_not_a_method', '0x']),
    UnrecordedRequestError,
  );
  assert.throws(() => metadataPresence(runtime, 'constant.epoch.invented', 'constant'), UnrecordedRequestError);
  // Positive control: the same shape, recorded, must succeed — otherwise the two
  // assertions above would pass on a mock that refuses everything.
  assert.equal(metadataPresence(runtime, 'constant.epoch.recent_cohorts', 'constant').present, true);
});

test('every fixture is pinned to one block and carries no conflicting recording', () => {
  const runtime = createMockRuntime(bundle);  // throws on multi-block or conflict
  assert.match(runtime.pinnedBlock(), /^0x[0-9a-f]{64}$/);
  assert.equal(runtime.surfaces().length, bundle.fixtures.size);
});
