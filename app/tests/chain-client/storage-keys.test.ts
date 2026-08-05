/**
 * Storage keys, against two independent producers — 02 §7, 02 §11, 10 §4.1.
 *
 * ## The two corpora, and why neither alone is enough
 *
 * **`app/fixtures/chainhead/`** holds 65 storage requests *issued against the built runtime*
 * by the F2 recorder, so each recorded key is what that runtime actually answered to. It
 * certifies `storagePrefix` completely — and **nothing whatever** about hasher application,
 * because the recorder reads whole maps with `descendantsValues` and never a single entry.
 * Every recorded key is therefore exactly 32 bytes. That limitation is asserted below rather
 * than left in a comment, because the corpus otherwise *looks* like it covers the surface:
 * its `metadata_presence` layouts declare eight distinct hasher combinations up to three keys
 * deep, none of which any recorded request exercises.
 *
 * **`runtime/bleavit-runtime/fixtures/storage-keys.json`** is the missing half (V-156). It is
 * written by the runtime's own storage types — `hashed_key_for`, not a re-implementation — so
 * its keys are the ones the node will serve, by construction. It is read **in place**, the
 * single-generator discipline `vectors.json`, `chain-quote-agreement.json` and
 * `multisig-derivation.json` all follow: a copied expectation is one a regeneration cannot
 * correct.
 *
 * Deriving the expected keys from `@polkadot-api/substrate-bindings` instead would have tested
 * the library `storage-keys.ts` is built from against itself. That is the whole reason the args
 * half waited for a Rust producer.
 *
 * ## Why this matters more than a normal gap
 *
 * A wrong storage key does not fail. It returns no value, and an absent value is
 * indistinguishable from an account that holds nothing — a mis-hashed `ForeignAssets.Account`
 * key and a genuinely empty balance render the same screen: *0 USDC*.
 *
 * And the near-miss is worse than the miss. `Blake2_128Concat` is a digest **followed by its
 * input**; a client that emitted the digest alone produces a key that is a *prefix* of the
 * right one, which `descendantsValues` answers by returning the whole map. That is not a
 * missing balance, it is everybody's.
 *
 * ## The one place the two corpora meet
 *
 * The last test compares them: for every surface both describe, the prefix the recorder
 * captured and the prefix inside the runtime's own full key must agree. Two producers that
 * never saw each other, one live and one compiled.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { storageKey, storagePrefix, UnsupportedHasherError } from '@bleavit/chain-client';
import type { StorageHasher } from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'chainhead');
/** Read in place — see the header. Never copied into `app/`. */
const RUNTIME_FIXTURE = join(
  HERE,
  '..',
  '..',
  '..',
  'runtime',
  'bleavit-runtime',
  'fixtures',
  'storage-keys.json',
);

/** `[fixture file, pallet, item]` — names only; every expected key comes from the fixture. */
const SURFACES: readonly (readonly [string, string, string])[] = [
  ['storage.attestor.attestations.json', 'Attestor', 'Attestations'],
  ['storage.attestor.liabilities.json', 'Attestor', 'Liabilities'],
  ['storage.attestor.members.json', 'Attestor', 'Members'],
  ['storage.attestor.next_attestation_id.json', 'Attestor', 'NextAttestationId'],
  ['storage.attestor.revocations.json', 'Attestor', 'Revocations'],
  ['storage.client_registry.clients.json', 'ClientRegistry', 'Clients'],
  ['storage.constitution.capabilities.json', 'Constitution', 'Capabilities'],
  ['storage.constitution.params.json', 'Constitution', 'Params'],
  ['storage.constitution.phase_flags.json', 'Constitution', 'PhaseFlags'],
  ['storage.constitution.release_channel.json', 'Constitution', 'ReleaseChannel'],
  ['storage.conviction_voting.class_locks_for.json', 'ConvictionVoting', 'ClassLocksFor'],
  ['storage.conviction_voting.voting_for.json', 'ConvictionVoting', 'VotingFor'],
  ['storage.epoch.cohorts.json', 'Epoch', 'Cohorts'],
  ['storage.epoch.epoch_of.json', 'Epoch', 'EpochOf'],
  ['storage.epoch.intake_queue.json', 'Epoch', 'IntakeQueue'],
  ['storage.epoch.proposals.json', 'Epoch', 'Proposals'],
  ['storage.epoch.recent_cohort_summaries.json', 'Epoch', 'RecentCohortSummaries'],
  ['storage.epoch.resource_locks.json', 'Epoch', 'ResourceLocks'],
  ['storage.execution_guard.attestation_bindings.json', 'ExecutionGuard', 'AttestationBindings'],
  ['storage.execution_guard.dead_man_freeze.json', 'ExecutionGuard', 'DeadManFreeze'],
  ['storage.execution_guard.execution_records.json', 'ExecutionGuard', 'ExecutionRecords'],
  ['storage.execution_guard.expedited.json', 'ExecutionGuard', 'Expedited'],
  ['storage.execution_guard.gate_suspension.json', 'ExecutionGuard', 'GateSuspension'],
  ['storage.execution_guard.hard_gate_breach.json', 'ExecutionGuard', 'HardGateBreach'],
  ['storage.execution_guard.held_resources.json', 'ExecutionGuard', 'HeldResources'],
  ['storage.execution_guard.migration_halt.json', 'ExecutionGuard', 'MigrationHalt'],
  ['storage.execution_guard.queue.json', 'ExecutionGuard', 'Queue'],
  ['storage.execution_guard.ratifications.json', 'ExecutionGuard', 'Ratifications'],
  ['storage.foreign_assets.account.json', 'ForeignAssets', 'Account'],
  ['storage.guardian.allowances.json', 'Guardian', 'Allowances'],
  ['storage.guardian.members.json', 'Guardian', 'Members'],
  ['storage.identity.parachain_id.json', 'ParachainInfo', 'ParachainId'],
  ['storage.identity.usdc_asset.json', 'ForeignAssets', 'Asset'],
  ['storage.identity.usdc_metadata.json', 'ForeignAssets', 'Metadata'],
  ['storage.ledger.baseline_vaults.json', 'ConditionalLedger', 'BaselineVaults'],
  ['storage.ledger.position_totals.json', 'ConditionalLedger', 'PositionTotals'],
  ['storage.ledger.positions.json', 'ConditionalLedger', 'Positions'],
  ['storage.ledger.vaults.json', 'ConditionalLedger', 'Vaults'],
  ['storage.market.baseline_market_of.json', 'Market', 'BaselineMarketOf'],
  ['storage.market.markets.json', 'Market', 'Markets'],
  ['storage.multisig.multisigs.json', 'Multisig', 'Multisigs'],
  ['storage.oracle.component_values.json', 'Oracle', 'ComponentValues'],
  ['storage.oracle.reporters.json', 'Oracle', 'Reporters'],
  ['storage.oracle.reserve_health.json', 'Oracle', 'ReserveHealth'],
  ['storage.oracle.rounds.json', 'Oracle', 'Rounds'],
  ['storage.oracle.watchtowers.json', 'Oracle', 'Watchtowers'],
  ['storage.preimage.preimage_for.json', 'Preimage', 'PreimageFor'],
  ['storage.preimage.status_for.json', 'Preimage', 'StatusFor'],
  ['storage.proxy.proxies.json', 'Proxy', 'Proxies'],
  ['storage.question_service.questions.json', 'QuestionService', 'Questions'],
  ['storage.question_service.reports.json', 'QuestionService', 'Reports'],
  ['storage.referenda.deciding_count.json', 'Referenda', 'DecidingCount'],
  ['storage.referenda.referendum_count.json', 'Referenda', 'ReferendumCount'],
  ['storage.referenda.referendum_info_for.json', 'Referenda', 'ReferendumInfoFor'],
  ['storage.referenda.track_queue.json', 'Referenda', 'TrackQueue'],
  ['storage.scheduler.agenda.json', 'Scheduler', 'Agenda'],
  ['storage.service_ledger.baseline_vaults.json', 'ServiceLedger', 'BaselineVaults'],
  ['storage.service_ledger.position_totals.json', 'ServiceLedger', 'PositionTotals'],
  ['storage.service_ledger.positions.json', 'ServiceLedger', 'Positions'],
  ['storage.service_ledger.vaults.json', 'ServiceLedger', 'Vaults'],
  ['storage.system.account.json', 'System', 'Account'],
  ['storage.system.events.json', 'System', 'Events'],
  ['storage.welfare.gate_breach_flags.json', 'Welfare', 'GateBreachFlags'],
  ['storage.welfare.metric_specs.json', 'Welfare', 'MetricSpecs'],
  ['storage.welfare.snapshots.json', 'Welfare', 'Snapshots'],
];

interface RuntimeEntry {
  readonly name: string;
  readonly pallet: string;
  readonly item: string;
  readonly hashers: readonly StorageHasher[];
  readonly preimages: readonly string[];
  readonly keyDescription: string;
  readonly key: string;
}

interface HasherRow {
  readonly name: string;
  readonly input: string;
  readonly Blake2_128Concat: string;
  readonly Twox64Concat: string;
}

interface RuntimeFixture {
  readonly schema: string;
  readonly prefixHash: string;
  readonly entries: readonly RuntimeEntry[];
  readonly hashers: readonly HasherRow[];
}

function runtimeFixture(): RuntimeFixture {
  const raw = readFileSync(RUNTIME_FIXTURE, 'utf8');
  const parsed = JSON.parse(raw) as RuntimeFixture;
  assert.equal(
    parsed.schema,
    'bleavit.storage-keys.v1',
    'the runtime fixture changed schema; re-read it before trusting this suite',
  );
  return parsed;
}

function bytes(hex: string): Uint8Array {
  assert.ok(hex.startsWith('0x'), `${hex} is not 0x-prefixed`);
  const body = hex.slice(2);
  assert.equal(body.length % 2, 0, `${hex} has an odd number of nibbles`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The key the runtime was actually asked for, read out of the recording. */
function recordedKey(file: string): string {
  const doc = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
    requests: { method: string; params: unknown[] }[];
  };
  const request = doc.requests.find((r) => r.method === 'chainHead_v1_storage');
  assert.ok(request, `${file} records no chainHead_v1_storage request`);
  const items = request.params[2] as { key: string }[];
  const first = items[0];
  assert.ok(first, `${file} records a storage request with no items`);
  return first.key.toLowerCase();
}

test('every recorded key is reproduced by twox128(pallet) ++ twox128(item)', () => {
  for (const [file, pallet, item] of SURFACES) {
    assert.equal(
      storagePrefix(pallet, item).toLowerCase(),
      recordedKey(file),
      `${pallet}.${item} (${file})`,
    );
  }
});

test('the table covers EVERY recorded storage surface, not a chosen subset', () => {
  // The direction a per-row loop cannot check. Without it, deleting rows makes the suite
  // pass faster and look identical.
  const onDisk = readdirSync(FIXTURES).filter(
    (f) => f.startsWith('storage.') && f.endsWith('.json'),
  );
  const named = new Set(SURFACES.map(([file]) => file));
  const missing = onDisk.filter((f) => !named.has(f));
  assert.deepEqual(missing, [], 'a recorded storage surface is not verified by this suite');
  assert.equal(named.size, SURFACES.length, 'the table names a fixture twice');
});

test('every recorded key is a 32-byte PREFIX — so the corpus exercises no hasher', () => {
  // The load-bearing limitation of the chainhead corpus, asserted rather than described.
  // It is the whole reason the runtime fixture exists; if the corpus ever gains a
  // single-entry read, this fails and the header stops being true.
  for (const [file] of SURFACES) {
    const key = recordedKey(file);
    assert.equal((key.length - 2) / 2, 32, `${file} records a key that is not a bare prefix`);
  }
});

test('the client rebuilds every key the runtime published', () => {
  const fixture = runtimeFixture();
  for (const entry of fixture.entries) {
    assert.equal(
      entry.hashers.length,
      entry.preimages.length,
      `${entry.name}: one pre-image per hasher`,
    );
    const built = storageKey(
      entry.pallet,
      entry.item,
      entry.hashers.map((hasher, index) => ({
        hasher,
        // Non-null via the length equality asserted above.
        encoded: bytes(entry.preimages[index] as string),
      })),
    );
    assert.equal(
      built.toLowerCase(),
      entry.key.toLowerCase(),
      `${entry.name} (${entry.pallet}.${entry.item}) — ${entry.keyDescription}`,
    );
  }
});

test('the runtime fixture still carries every shape it exists to carry', () => {
  // Coverage, mirroring the Rust side. Without it a future regeneration that dropped the
  // only Twox64Concat entry, or the only three-key one, leaves this suite green and the
  // client unverified for exactly the case it lost. A fixture-driven test is only as
  // strong as the fixture, so the fixture's contents are themselves asserted.
  const fixture = runtimeFixture();
  const hashers = new Set(fixture.entries.flatMap((e) => e.hashers));
  assert.ok(hashers.has('Blake2_128Concat'), 'no Blake2_128Concat entry');
  assert.ok(hashers.has('Twox64Concat'), 'no Twox64Concat entry — the hasher a balance-only client never meets');

  const arities = new Set(fixture.entries.map((e) => e.hashers.length));
  for (const arity of [0, 1, 2, 3]) {
    assert.ok(arities.has(arity), `no entry with ${arity} key(s)`);
  }

  // The pair that motivates `storageKey` taking pre-encoded keys: `Welfare.Snapshots` is a
  // single map over a TUPLE key (one hash over the encoded pair) and
  // `ConditionalLedger.Positions` is a DOUBLE map (one hash per key). Doc 02 writes both
  // as `(A, B) → V`. If the fixture ever lost one, a client that confused them would pass.
  const snapshots = fixture.entries.find((e) => e.name === 'welfare_snapshots');
  const positions = fixture.entries.find((e) => e.name === 'ledger_positions');
  assert.ok(snapshots && positions, 'the tuple-key/double-map contrast is gone from the fixture');
  assert.equal(snapshots.hashers.length, 1);
  assert.equal(positions.hashers.length, 2);
});

test('the two hashers are computed correctly, including their concat suffix', () => {
  // These vectors are what lets the client build keys for **Asset Hub**, whose storage types
  // the Bleavit runtime cannot name and whose `Assets.Account` is two of the four surfaces
  // the F18 funding reads touch (02 §7.7).
  const fixture = runtimeFixture();
  assert.ok(fixture.hashers.length > 0, 'the hasher section is empty');
  for (const row of fixture.hashers) {
    const input = bytes(row.input);
    for (const hasher of ['Blake2_128Concat', 'Twox64Concat'] as const) {
      const built = storageKey('X', 'Y', [{ hasher, encoded: input }]);
      const prefix = storagePrefix('X', 'Y');
      assert.equal(
        built.slice(prefix.length).toLowerCase(),
        row[hasher].slice(2).toLowerCase(),
        `${hasher} over ${row.name}`,
      );
    }
  }
});

test('the concat suffix is present — a digest alone is a map prefix, not an entry', () => {
  // The near-miss that is worse than a miss. Without the trailing input, the key is a
  // strict prefix of the right one and `descendantsValues` answers it with the WHOLE map.
  // Stated against the fixture's own longest input so a truncation cannot coincide.
  const fixture = runtimeFixture();
  const longest = fixture.hashers.reduce((a, b) => (b.input.length > a.input.length ? b : a));
  const input = bytes(longest.input);
  assert.ok(input.length > 16, 'the fixture no longer carries an input longer than a blake2_128 digest');

  for (const [hasher, digestBytes] of [
    ['Blake2_128Concat', 16],
    ['Twox64Concat', 8],
  ] as const) {
    const suffix = bytes(`0x${storageKey('X', 'Y', [{ hasher, encoded: input }]).slice(storagePrefix('X', 'Y').length)}`);
    assert.equal(
      suffix.length,
      digestBytes + input.length,
      `${hasher} did not append its input after the digest`,
    );
    assert.deepEqual(
      Array.from(suffix.slice(digestBytes)),
      Array.from(input),
      `${hasher}'s suffix is not the input verbatim`,
    );
  }
});

test('an unknown hasher is refused, never degraded to a shorter key', () => {
  // Fail-closed, and the reason is the same near-miss: returning the prefix would be a
  // request the node happily answers with the whole map. Reachable from metadata, which is
  // untyped at runtime, so the cast is the honest shape of the call site.
  assert.throws(
    () => storageKey('Epoch', 'Proposals', [{ hasher: 'Identity' as StorageHasher, encoded: new Uint8Array([1]) }]),
    UnsupportedHasherError,
  );
  // And a zero-key call is NOT an error — that is exactly a plain value's key.
  assert.equal(storageKey('Constitution', 'PhaseFlags', []), storagePrefix('Constitution', 'PhaseFlags'));
});

test('the two producers agree on every prefix they both describe', () => {
  // The one place the live recording and the compiled runtime meet. Each was produced
  // without reference to the other: the recorder asked a running node, the fixture asks
  // the storage types. A prefix both agree on is one no single generator could have got
  // wrong on its own.
  const fixture = runtimeFixture();
  const recorded = new Map(SURFACES.map(([file, pallet, item]) => [`${pallet}.${item}`, file]));

  let compared = 0;
  for (const entry of fixture.entries) {
    const file = recorded.get(`${entry.pallet}.${entry.item}`);
    if (file === undefined) continue;
    assert.equal(
      entry.key.slice(0, 66).toLowerCase(),
      recordedKey(file),
      `${entry.pallet}.${entry.item}: the runtime fixture and the chainhead recording disagree`,
    );
    compared += 1;
  }
  // Anti-vacuity: a loop that compared nothing would pass. Every runtime entry except the
  // scheduler one names a surface the recorder captured.
  assert.ok(compared >= 8, `only ${compared} surfaces were cross-checked between the two producers`);
});
