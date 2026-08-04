/**
 * `CRITICAL_SURFACE`, the supported-runtime map and the three-mode classifier — 10 §5.1,
 * §5.2, §5.4; §3.2's lattice; INV-FE-12.
 *
 * The classifier decides whether the app may sign, so what matters is its behaviour on the
 * probe outcomes a healthy chain never produces. Those are constructed here directly —
 * that is the whole reason the classifier is a pure function over probe results and the
 * PAPI adapter lives elsewhere.
 *
 * The surface itself is cross-checked against F2's recorded transcripts, so "the app binds
 * to this" and "a booted release node answers for it" are the same list rather than two
 * lists that agree today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  CRITICAL_SURFACE,
  INTEGRATION_CONTRACT_VERSION,
  ProbeCoverageError,
  SUPPORTED_RUNTIMES,
  SUPPORTED_SPEC_VERSIONS,
  COMPATIBILITY_LEVELS,
  UNPROBED_MANIFEST_ENTRIES,
  callIsProven,
  callUnavailableReason,
  classify,
  levelName,
  pairedRuntime,
  probeCriticalSurface,
  runtimeFor,
  surfaceIsProven,
} from '@bleavit/descriptors';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(
  readFileSync(resolve(HERE, '..', '..', '..', 'tools', 'release', 'surface-manifest.json'), 'utf8'),
);

const allPass = (surface = CRITICAL_SURFACE) =>
  surface.map((e) => ({ id: e.id, compatible: true, level: 'identical' }));

test('CRITICAL_SURFACE covers the manifest exactly, minus what cannot be probed', () => {
  // A whitelist is not a surface check (F2, Decision-log D7): a generated list that
  // silently dropped entries would shrink into agreement with anything.
  assert.equal(CRITICAL_SURFACE.length + UNPROBED_MANIFEST_ENTRIES, MANIFEST.entries.length);
  assert.equal(INTEGRATION_CONTRACT_VERSION, MANIFEST.integration_contract_version);

  const ids = new Set(CRITICAL_SURFACE.map((e) => e.id));
  const unprobedKinds = new Set(['raw_storage', 'properties']);
  for (const entry of MANIFEST.entries) {
    if (unprobedKinds.has(entry.kind)) {
      assert.equal(ids.has(entry.id), false, `${entry.id} is unprobeable but was included`);
    } else {
      assert.ok(ids.has(entry.id), `${entry.id} is in the frozen manifest but not in CRITICAL_SURFACE`);
    }
  }
});

test('every probed surface is reachable in the recorded transcripts', () => {
  // The two lists have different jobs — one is what the app binds to, the other is what a
  // booted release node was asked for — and nothing else compares them.
  const dir = resolve(HERE, '..', '..', 'fixtures', 'chainhead');
  const onDisk = new Set(
    readdirSync(dir)
      .filter((n) => n.endsWith('.json') && n !== 'fixtures-report.json')
      .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')).surface),
  );
  const report = JSON.parse(readFileSync(join(dir, 'fixtures-report.json'), 'utf8'));
  // Both directions, and against the report *and* the files: the report is the recorder's
  // own claim about what it captured, and a claim is not the artifact.
  assert.deepEqual([...report.recorded].filter((id) => !onDisk.has(id)), [], 'report claims transcripts that are not on disk');
  const unrecorded = CRITICAL_SURFACE.filter((e) => !onDisk.has(e.id)).map((e) => e.id);
  assert.deepEqual(unrecorded, [], 'CRITICAL_SURFACE entries with no recorded transcript');
});

test('the supported map is a primary/recovery pair that names each other (10 §5.1)', () => {
  // A primary runtime is not eligible until its exact paired terminal-recovery runtime has
  // published descriptors: recovery can become current under `OnlyInherents`, and
  // operator-only descriptors would strand the frontend during that incident.
  assert.equal(SUPPORTED_RUNTIMES.length, 2);
  const primary = SUPPORTED_RUNTIMES.find((r) => r.role === 'primary');
  const recovery = SUPPORTED_RUNTIMES.find((r) => r.role === 'recovery');
  assert.ok(primary && recovery);
  assert.equal(recovery.specVersion, primary.specVersion + 1);
  assert.equal(pairedRuntime(primary.specVersion), recovery);
  assert.equal(pairedRuntime(recovery.specVersion), primary);
  assert.equal(runtimeFor(999), undefined);
  assert.notEqual(primary.metadataSha256, recovery.metadataSha256);
  assert.deepEqual([...SUPPORTED_SPEC_VERSIONS].sort(), [2, 3]);
});

test('an unsupported spec_version is read-only-incompatible, whatever the probes say', () => {
  // 10 §3.1 draws that edge as "spec_version unsupported" — not "too much broke". A
  // runtime outside the descriptor commitment cannot be decoded at all.
  const result = classify(99, SUPPORTED_SPEC_VERSIONS, allPass());
  assert.equal(result.mode, 'read-only-incompatible');
  assert.deepEqual(result.proven, []);
  assert.equal(surfaceIsProven(result, CRITICAL_SURFACE[0].id), false);
  assert.equal(callIsProven(result, 'market.buy'), false);
  assert.match(callUnavailableReason(result, 'market.buy'), /newer release/);
});

test('a fully passing probe set is full, and both live runtimes classify', () => {
  for (const runtime of SUPPORTED_RUNTIMES) {
    const result = classify(runtime.specVersion, SUPPORTED_SPEC_VERSIONS, allPass());
    assert.equal(result.mode, 'full', `${runtime.profile} did not classify full`);
    assert.equal(result.proven.length, CRITICAL_SURFACE.length);
    assert.equal(result.disabled.length, 0);
  }
});

test('a partial failure is restricted with NAMED surfaces, never a lazy Ready', () => {
  // 10 §3.1: "it does not pretend to be `Ready` and fail lazily". The naming is the
  // product requirement — a restricted mode that cannot say what is disabled is an
  // unexplained outage.
  const probes = allPass().map((p, i) =>
    i === 3 ? { ...p, compatible: false, level: 'incompatible' } : p,
  );
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.equal(result.disabled.length, 1);
  assert.equal(result.disabled[0].id, CRITICAL_SURFACE[3].id);
  assert.match(result.disabled[0].reason, /absent from this runtime/);
  assert.match(result.disabled[0].reason, /02 §/, 'the reason must cite the contract section');
  assert.equal(surfaceIsProven(result, CRITICAL_SURFACE[3].id), false);
  assert.equal(surfaceIsProven(result, CRITICAL_SURFACE[0].id), true);
});

test('massive breakage is still restricted, not read-only-incompatible', () => {
  // Collapsing "lots of failures" into read-only-incompatible would take the app offline
  // for a partial upgrade it could have survived. The mode is a function of coverage,
  // not of damage.
  const probes = allPass().map((p) => ({ ...p, compatible: false, level: 'incompatible' }));
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.equal(result.disabled.length, CRITICAL_SURFACE.length);
  assert.equal(result.proven.length, 0);
});

test('a `partial` level is a failure, and reads differently from an absent surface', () => {
  // PAPI's `isCompatible()` defaults its threshold to BackwardsCompatible, so Partial is
  // not a pass (V-87). The level is still carried, because "changed shape" and "gone"
  // need different copy.
  const probes = allPass().map((p, i) => (i === 0 ? { ...p, compatible: false, level: 'partial' } : p));
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.match(result.disabled[0].reason, /changed shape/);
  assert.doesNotMatch(result.disabled[0].reason, /absent/);
});

test('an unprobed surface is refused, never counted as passing', () => {
  // A classifier that ignored the surfaces nobody asked about would report `full` for a
  // runtime it never examined — F2's whitelist defect exactly: a check that passes by
  // shrinking.
  assert.throws(
    () => classify(2, SUPPORTED_SPEC_VERSIONS, allPass().slice(1)),
    (error) => error instanceof ProbeCoverageError && /never probed/.test(error.message),
  );
});

test('signing in restricted mode is fail-closed while calls are unmanifested (SQ-577)', () => {
  // doc 02 freezes the *read* contract and has no extrinsic section, so there is nothing
  // to probe a call against. INV-FE-12: an unproven capability is absent, and absence
  // disables the dependent surface with a named reason. Permitting every call because none
  // is known to be broken would sign against a call surface that was never checked.
  const full = classify(2, SUPPORTED_SPEC_VERSIONS, allPass());
  assert.equal(callIsProven(full, 'market.buy'), true);
  assert.equal(callUnavailableReason(full, 'market.buy'), undefined);

  const probes = allPass().map((p, i) => (i === 0 ? { ...p, compatible: false, level: 'partial' } : p));
  const restricted = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(callIsProven(restricted, 'market.buy'), false);
  assert.match(callUnavailableReason(restricted, 'market.buy'), /SQ-577/);
  assert.match(callUnavailableReason(restricted, 'market.buy'), /INV-FE-12/);
  assert.equal(MANIFEST.entries.some((e) => e.kind === 'call'), false, 'calls are manifested — SQ-577 has closed, so this placeholder must go');
});

test('the compat group of every entry matches its manifest kind', () => {
  const expected = { runtime_api: 'apis', storage: 'query', constant: 'constants', event: 'event' };
  const byId = new Map(MANIFEST.entries.map((e) => [e.id, e]));
  for (const entry of CRITICAL_SURFACE) {
    assert.equal(entry.compatGroup, expected[byId.get(entry.id).kind], entry.id);
  }
});

/* ------------------------------------------------------------------ the probe (FE-P1) */

test('the CompatibilityLevel mapping matches PAPI\'s real enum (V-87)', async () => {
  // The ordering is what `isCompatible` compares against, so a silently renumbered enum
  // would turn `Partial` into a pass. Imported from the pinned package, not restated.
  const { CompatibilityLevel } = await import('polkadot-api');
  assert.deepEqual(COMPATIBILITY_LEVELS, ['incompatible', 'partial', 'backwards-compatible', 'identical']);
  assert.equal(levelName(CompatibilityLevel.Incompatible), 'incompatible');
  assert.equal(levelName(CompatibilityLevel.Partial), 'partial');
  assert.equal(levelName(CompatibilityLevel.BackwardsCompatible), 'backwards-compatible');
  assert.equal(levelName(CompatibilityLevel.Identical), 'identical');
  // Ordering, not just naming: `isCompatible(from = BackwardsCompatible)` is `level >= from`.
  assert.ok(CompatibilityLevel.Partial < CompatibilityLevel.BackwardsCompatible);
  assert.ok(CompatibilityLevel.BackwardsCompatible < CompatibilityLevel.Identical);
});

/** A compat surface double: `identical` everywhere unless overridden. */
function compatSurface(overrides = {}) {
  const helper = (level, compatible) => ({ level, isCompatible: () => compatible });
  const groups = { apis: {}, query: {}, constants: {}, event: {} };
  for (const entry of CRITICAL_SURFACE) {
    const over = overrides[entry.id];
    groups[entry.compatGroup][entry.pallet] ??= {};
    if (over === 'absent') continue;
    groups[entry.compatGroup][entry.pallet][entry.member] =
      entry.compatGroup === 'query' || entry.compatGroup === 'apis'
        ? { args: helper(3, true), value: helper(over?.level ?? 3, over?.compatible ?? true), isCompatible: () => over?.compatible ?? true }
        : helper(over?.level ?? 3, over?.compatible ?? true);
  }
  return groups;
}

test('the probe covers every entry, and an unlookupable helper is incompatible', () => {
  // Skipping would hand the classifier a short list — and the classifier only refuses a
  // short list *if it is short*. A silently dropped entry is the same defect one layer up.
  const probes = probeCriticalSurface(compatSurface());
  assert.equal(probes.length, CRITICAL_SURFACE.length);
  assert.equal(classify(2, SUPPORTED_SPEC_VERSIONS, probes).mode, 'full');

  const missing = CRITICAL_SURFACE[7].id;
  const withHole = probeCriticalSurface(compatSurface({ [missing]: 'absent' }));
  assert.equal(withHole.length, CRITICAL_SURFACE.length, 'the probe dropped an entry it could not look up');
  assert.equal(withHole.find((p) => p.id === missing).compatible, false);
  assert.equal(withHole.find((p) => p.id === missing).level, 'incompatible');
});

test('the probe reports min(args, value) for the two-sided helpers', () => {
  // Those helpers carry no top-level `level`; PAPI computes `isCompatible` as the minimum.
  // Reading a missing top-level `level` would name as `incompatible` beside a `true`
  // verdict — a report that contradicts itself.
  const twoSided = CRITICAL_SURFACE.find((e) => e.compatGroup === 'apis');
  const probes = probeCriticalSurface(compatSurface({ [twoSided.id]: { level: 1, compatible: false } }));
  const probe = probes.find((p) => p.id === twoSided.id);
  assert.equal(probe.level, 'partial');
  assert.equal(probe.compatible, false);
  assert.equal(classify(2, SUPPORTED_SPEC_VERSIONS, probes).mode, 'restricted');
});

test('the probe asks PAPI with no threshold argument', () => {
  // PAPI's default is BackwardsCompatible. Passing our own would be a second opinion about
  // safety with no basis — and passing `Partial` would silently widen what counts as safe.
  const seen = [];
  const surface = compatSurface();
  for (const group of Object.values(surface)) {
    for (const pallet of Object.values(group)) {
      for (const [name, helper] of Object.entries(pallet)) {
        const inner = helper.isCompatible;
        pallet[name] = { ...helper, isCompatible: (...args) => { seen.push(args.length); return inner(...args); } };
      }
    }
  }
  probeCriticalSurface(surface);
  assert.ok(seen.length > 0, 'no helper was consulted — this test would be vacuous');
  assert.deepEqual([...new Set(seen)], [0], 'the probe passed a threshold argument');
});
