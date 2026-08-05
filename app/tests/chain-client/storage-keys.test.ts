/**
 * `storagePrefix` against the runtime's own recorded keys — 02 §11, 10 §4.1.
 *
 * The corpus is ground truth rather than a restatement: `app/fixtures/chainhead/` holds 65
 * storage requests **issued against the built runtime** by the F2 recorder, so each recorded
 * key is what that runtime actually answered to. The keys are read **in place**, the same
 * single-generator discipline the vector corpus and the multisig fixture follow — a copied
 * expectation is one a regeneration cannot correct.
 *
 * The table below supplies only the *names*; every expected value comes from the fixture. And
 * it is checked **in both directions**: a `storage.*.json` file this table does not name fails
 * the suite, so a surface added to the corpus cannot be silently unverified. That is the half
 * a "for each row, assert" loop always lacks.
 *
 * **What this cannot show, stated because the corpus makes it look otherwise**: every recorded
 * key is exactly 32 bytes, because the recorder reads whole maps with `descendantsValues` and
 * never a single entry. So none of these 65 cases exercises a hasher, even though their
 * `metadata_presence` layouts declare eight distinct hasher combinations up to three keys deep.
 * `storage-keys.ts` therefore exports no function taking key arguments at all (V-156), and the
 * last test here asserts that absence — because the tempting next commit is to add one and
 * point it at this suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as chainClient from '@bleavit/chain-client';
import { storagePrefix } from '@bleavit/chain-client';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'chainhead');

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
  const onDisk = readdirSync(FIXTURES).filter((f) => f.startsWith('storage.') && f.endsWith('.json'));
  const named = new Set(SURFACES.map(([file]) => file));
  const missing = onDisk.filter((f) => !named.has(f));
  assert.deepEqual(missing, [], 'a recorded storage surface is not verified by this suite');
  assert.equal(named.size, SURFACES.length, 'the table names a fixture twice');
});

test('every recorded key is a 32-byte PREFIX — so no case here exercises a hasher', () => {
  // The load-bearing limitation, asserted rather than left in a comment. If the corpus ever
  // gains a single-entry read, this fails and the suite stops claiming what it cannot show.
  for (const [file] of SURFACES) {
    const key = recordedKey(file);
    assert.equal((key.length - 2) / 2, 32, `${file} records a key that is not a bare prefix`);
  }
});

test('the package exports NO key builder that takes arguments (V-156)', () => {
  // A wrong storage key does not fail loudly: it returns no value, and an absent value is
  // indistinguishable from an account holding nothing. So the args half must not ship before
  // it has known-answer vectors from outside TypeScript, and this asserts the absence rather
  // than trusting a comment — the tempting next commit is to add one and point it here.
  const suspicious = Object.keys(chainClient).filter(
    (name) => /storageKey|entryKey|mapKey/i.test(name),
  );
  assert.deepEqual(
    suspicious,
    [],
    'a key builder appeared; it needs Rust-generated hasher vectors before this corpus can vouch for it',
  );
  assert.equal(storagePrefix.length, 2, 'storagePrefix took an extra argument — arguments are not the prefix');
});
