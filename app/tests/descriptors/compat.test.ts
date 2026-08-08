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
import { execFileSync } from 'node:child_process';
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
  probeForeignSurface,
  runtimeFor,
  surfaceIsProven,
} from '@bleavit/descriptors';
import type {
  AnyCompatHelper,
  CompatClassification,
  CompatSurface,
  CriticalSurfaceEntry,
  SurfaceProbe,
} from '@bleavit/descriptors';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `app/` — the root the committed artifacts and the pinned packages both hang off. */
const APP_ROOT = resolve(HERE, '..', '..');
const MANIFEST: SurfaceManifest = JSON.parse(
  readFileSync(resolve(HERE, '..', '..', '..', 'tools', 'release', 'surface-manifest.json'), 'utf8'),
);

const allPass = (surface: readonly CriticalSurfaceEntry[] = CRITICAL_SURFACE): SurfaceProbe[] =>
  surface.map((e) => ({ id: e.id, compatible: true, level: 'identical' }));

/**
 * A `CRITICAL_SURFACE` entry by position, or a failure saying the list is shorter.
 *
 * `noUncheckedIndexedAccess` types `surfaceAt(3)` as possibly `undefined`, and that
 * is not pedantry here: the list is **generated** from the release manifest, so an entry
 * being dropped is a real event, and these tests address entries by index. Reading through
 * `!` would turn a shrunken surface into `undefined.id` several lines later instead of a
 * failure naming the index that vanished.
 */
function surfaceAt(index: number): CriticalSurfaceEntry {
  const entry = CRITICAL_SURFACE[index];
  assert.ok(entry, `CRITICAL_SURFACE has no entry ${index} (length ${CRITICAL_SURFACE.length})`);
  return entry;
}

/** The first element, or a failure saying there was none. */
function first<T>(items: readonly T[], what: string): T {
  const value = items[0];
  assert.ok(value !== undefined, `expected at least one ${what}, got none`);
  return value;
}

/**
 * `tools/release/surface-manifest.json`, as far as this suite reads it.
 *
 * The entries are the generator's input; `CRITICAL_SURFACE` is its output, and the tests
 * below compare the two. Only `id` and `kind` are read here, so only those are declared —
 * this is a description of what the suite consumes, not a second copy of the manifest schema.
 */
interface SurfaceManifest {
  readonly integration_contract_version: number;
  readonly entries: ReadonlyArray<{ readonly id: string; readonly kind: string }>;
}

/**
 * Why a call is unavailable, or a failure if the classifier said it is available.
 *
 * `callUnavailableReason` returns `undefined` for `full` — the honest signature, since a
 * usable call has no reason to give. Asserting a regex against `undefined` would otherwise
 * fail with "expected string" rather than with "the classifier considers this call fine",
 * which is the fact that actually went wrong.
 */
function reasonFor(classification: CompatClassification, call: string): string {
  const reason = callUnavailableReason(classification, call);
  assert.ok(reason !== undefined, `${call} is available; expected it to be unavailable`);
  return reason;
}

/** The probe for `id`, or a failure saying it is absent from the report. */
function probeFor(probes: readonly SurfaceProbe[], id: string): SurfaceProbe {
  const probe = probes.find((p) => p.id === id);
  assert.ok(probe, `the probe report has no entry for ${id}`);
  return probe;
}


/**
 * Compile a types-only module under this suite and report the outcome.
 *
 * Flags mirror `tsconfig.base.json`'s strictness for the properties that matter here.
 * `skipLibCheck` is on, as it is everywhere in this workspace — it skips checking
 * declaration files' *internals*, not the assignment being asserted, which is in our own
 * source. The witness is what proves that distinction holds.
 */
function compileTypes(relative: string): { ok: boolean; output: string } {
  const tsc = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/.bin/tsc');
  try {
    execFileSync(
      tsc,
      [
        join(dirname(fileURLToPath(import.meta.url)), relative),
        '--noEmit', '--strict',
        '--target', 'ES2022', '--module', 'ESNext',
        '--moduleResolution', 'Bundler', '--skipLibCheck',
      ],
      { cwd: dirname(fileURLToPath(import.meta.url)), stdio: 'pipe', encoding: 'utf8' },
    );
    return { ok: true, output: '' };
  } catch (err) {
    // `execFileSync` throws an Error carrying the child's streams; `unknown` is the honest
    // type for a caught value, so the two fields are read through a narrow shape.
    const failure = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

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
  assert.equal(surfaceIsProven(result, surfaceAt(0).id), false);
  assert.equal(callIsProven(result, 'market.buy'), false);
  assert.match(reasonFor(result, 'market.buy'), /newer release/);
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
  const probes: SurfaceProbe[] = allPass().map((p, i) =>
    i === 3 ? { ...p, compatible: false, level: 'incompatible' } : p,
  );
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.equal(result.disabled.length, 1);
  assert.equal(first(result.disabled, 'disabled surface').id, surfaceAt(3).id);
  assert.match(first(result.disabled, 'disabled surface').reason, /absent from this runtime/);
  assert.match(first(result.disabled, 'disabled surface').reason, /02 §/, 'the reason must cite the contract section');
  assert.equal(surfaceIsProven(result, surfaceAt(3).id), false);
  assert.equal(surfaceIsProven(result, surfaceAt(0).id), true);
});

test('massive breakage is still restricted, not read-only-incompatible', () => {
  // Collapsing "lots of failures" into read-only-incompatible would take the app offline
  // for a partial upgrade it could have survived. The mode is a function of coverage,
  // not of damage.
  const probes: SurfaceProbe[] = allPass().map((p) => ({
    ...p,
    compatible: false,
    level: 'incompatible',
  }));
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.equal(result.disabled.length, CRITICAL_SURFACE.length);
  assert.equal(result.proven.length, 0);
});

test('a `partial` level is a failure, and reads differently from an absent surface', () => {
  // PAPI's `isCompatible()` defaults its threshold to BackwardsCompatible, so Partial is
  // not a pass (V-87). The level is still carried, because "changed shape" and "gone"
  // need different copy.
  const probes: SurfaceProbe[] = allPass().map((p, i) =>
    i === 0 ? { ...p, compatible: false, level: 'partial' } : p,
  );
  const result = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(result.mode, 'restricted');
  assert.match(first(result.disabled, 'disabled surface').reason, /changed shape/);
  assert.doesNotMatch(first(result.disabled, 'disabled surface').reason, /absent/);
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
  // The raw accessor here, not `reasonFor`: this asserts there is *no* reason, which is
  // what `full` means. `reasonFor` fails when a call is available, so using it would invert
  // the assertion — and it did, until the suite caught it.
  assert.equal(callUnavailableReason(full, 'market.buy'), undefined);

  const probes: SurfaceProbe[] = allPass().map((p, i) =>
    i === 0 ? { ...p, compatible: false, level: 'partial' } : p,
  );
  const restricted = classify(2, SUPPORTED_SPEC_VERSIONS, probes);
  assert.equal(callIsProven(restricted, 'market.buy'), false);
  assert.match(reasonFor(restricted, 'market.buy'), /SQ-577/);
  assert.match(reasonFor(restricted, 'market.buy'), /INV-FE-12/);
  assert.equal(MANIFEST.entries.some((e) => e.kind === 'call'), false, 'calls are manifested — SQ-577 has closed, so this placeholder must go');
});

test('the compat group of every entry matches its manifest kind', () => {
  const expected: Readonly<Record<string, string>> = {
    runtime_api: 'apis',
    storage: 'query',
    constant: 'constants',
    event: 'event',
  };
  const byId = new Map(MANIFEST.entries.map((e) => [e.id, e]));
  for (const entry of CRITICAL_SURFACE) {
    const manifested = byId.get(entry.id);
    assert.ok(manifested, `${entry.id} is in CRITICAL_SURFACE but not in the manifest`);
    assert.equal(entry.compatGroup, expected[manifested.kind], entry.id);
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
type CompatOverride = 'absent' | { readonly level?: number; readonly compatible?: boolean };

function compatSurface(overrides: Readonly<Record<string, CompatOverride>> = {}): CompatSurface {
  const helper = (level: number, compatible: boolean) => ({
    level,
    isCompatible: () => compatible,
  });
  const groups: {
    [K in keyof CompatSurface]: Record<string, Record<string, AnyCompatHelper>>;
  } = { apis: {}, query: {}, constants: {}, event: {}, tx: {} };
  for (const entry of CRITICAL_SURFACE) {
    const raw = overrides[entry.id];
    const over = raw === 'absent' || raw === undefined ? undefined : raw;
    groups[entry.compatGroup][entry.pallet] ??= {};
    if (raw === 'absent') continue;
    const pallet = groups[entry.compatGroup][entry.pallet];
    assert.ok(pallet, 'the pallet bucket was just created');
    pallet[entry.member] =
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

  const missing = surfaceAt(7).id;
  const withHole = probeCriticalSurface(compatSurface({ [missing]: 'absent' }));
  assert.equal(withHole.length, CRITICAL_SURFACE.length, 'the probe dropped an entry it could not look up');
  assert.equal(probeFor(withHole, missing).compatible, false);
  assert.equal(probeFor(withHole, missing).level, 'incompatible');
});

test('the probe reports min(args, value) for the two-sided helpers', () => {
  // Those helpers carry no top-level `level`; PAPI computes `isCompatible` as the minimum.
  // Reading a missing top-level `level` would name as `incompatible` beside a `true`
  // verdict — a report that contradicts itself.
  const twoSided = CRITICAL_SURFACE.find((e) => e.compatGroup === 'apis');
  assert.ok(twoSided, 'no runtime-API entry in CRITICAL_SURFACE to exercise the two-sided path');
  const probes = probeCriticalSurface(
    compatSurface({ [twoSided.id]: { level: 1, compatible: false } }),
  );
  const probe = probeFor(probes, twoSided.id);
  assert.equal(probe.level, 'partial');
  assert.equal(probe.compatible, false);
  assert.equal(classify(2, SUPPORTED_SPEC_VERSIONS, probes).mode, 'restricted');
});

test('the probe asks PAPI with no threshold argument', () => {
  // PAPI's default is BackwardsCompatible. Passing our own would be a second opinion about
  // safety with no basis — and passing `Partial` would silently widen what counts as safe.
  const seen: number[] = [];
  const surface = compatSurface();
  const groupNames = ['apis', 'query', 'constants', 'event'] as const;
  for (const groupName of groupNames) {
    for (const pallet of Object.values(surface[groupName])) {
      for (const [name, helper] of Object.entries(pallet)) {
        const inner = helper.isCompatible.bind(helper);
        pallet[name] = {
          ...helper,
          isCompatible: (...args: readonly [number?]) => {
            seen.push(args.length);
            return inner(...args);
          },
        };
      }
    }
  }
  probeCriticalSurface(surface);
  assert.ok(seen.length > 0, 'no helper was consulted — this test would be vacuous');
  assert.deepEqual([...new Set(seen)], [0], 'the probe passed a threshold argument');
});

test('the probe’s structural shapes are assignable from PAPI’s real ones (F4)', () => {
  // The last F4 item, and it sat open on a wrong premise: `probe.ts` said there was no
  // equivalent of `light-client.ts`'s binding "because nothing constructs a `TypedApi`
  // until F6 wires `createClient`". Assignability is a COMPILE-TIME relation — nothing has
  // to be constructed and no client has to exist.
  //
  // `types/papi-shapes.ts` is types-only and emits nothing; compiling it IS the assertion.
  // It must SUCCEED, which makes this a positive control: a toolchain that cannot compile
  // anything fails here rather than agreeing silently.
  const { ok, output } = compileTypes('types/papi-shapes.ts');
  assert.equal(ok, true, `the probe's shapes no longer match PAPI 2.1.8's:\n${output}`);
});

test('the binding can fail — a divergent shape is rejected', () => {
  // Anti-vacuity. Without this, "it compiled" is equally consistent with the file having
  // been silently emptied, or with `skipLibCheck` swallowing the comparison.
  const { ok, output } = compileTypes('types/papi-shapes-witness.ts');
  assert.equal(ok, false, 'a deliberately wrong shape compiled — the binding proves nothing');
  assert.match(output, /TS2(322|345|739|741)/, output);
});

/* ------------------- PAPI's own absence behaviour, pinned executably (F26 review, minor 11) */

/**
 * **The fail-closed guarantee this whole classifier rests on is PAPI's, not ours.**
 *
 * `probeCriticalSurface` treats a missing helper as `incompatible`, and that branch is
 * **unreachable** against a real compat object: `compat[group][pallet][member]` is a proxy
 * path that always returns a helper. So what actually makes an absent surface fail closed is
 * PAPI answering `Incompatible` for an entry the runtime does not have — an assumption
 * `probe.ts` recorded in prose and nothing executed. Everything downstream (INV-FE-12's
 * *"an unproven capability is absent"*, `classify`'s named disabled surfaces, the deposit
 * row) is built on it.
 *
 * It is pinned **offline, over the committed artifacts**, by crossing them: the `bleavit`
 * descriptor set is compared against **Asset Hub's** metadata, where `Epoch`,
 * `ConditionalLedger` and `FutarchyApi` genuinely do not exist. That is a real absence
 * produced by two files this release already ships, not a fixture asserting itself.
 *
 * It reaches two module-internal paths (`compatibility/compatibility.js`,
 * `observable-client`'s `create-metadata-ctx.js`) because `getStaticApis()` needs a client
 * and this must run with no node. Neither carries a compatibility promise, which is the
 * point: a bump that moves them fails **here**, loudly, rather than moving the meaning of
 * every verdict silently.
 */
/**
 * What `getSyncHelpers` returns, at the shape this repository reads it as.
 *
 * Declared as `CompatSurface` rather than a loose record, so the offline construction below is
 * itself a check that PAPI's six groups still satisfy the probe's structural type — the same
 * binding `compat-boot.ts` makes on the production path, made here without a chain.
 */
type CompatGroups = CompatSurface & Record<string, Record<string, Record<string, AnyCompatHelper>>>;

/**
 * Read a pallet's declared member names out of a descriptor set.
 *
 * Takes `unknown` so the shape is narrowed once, here, with a single assertion. The generated
 * descriptors have a real PAPI type that does not overlap a plain record, and widening through
 * `as unknown as` at each call site is exactly what `check:casts` bans across `app/`.
 */
function declaredMembers(declared: unknown, group: string, pallet: string): readonly string[] {
  const groups = declared as Record<string, Record<string, Record<string, unknown>> | undefined>;
  return Object.keys(groups[group]?.[pallet] ?? {});
}

async function crossedCompat(): Promise<CompatGroups> {
  const papi = resolve(
    APP_ROOT,
    'node_modules/.pnpm/polkadot-api@2.1.8_esbuild@0.28.1_rxjs@7.8.2/node_modules/polkadot-api/dist/src',
  );
  const observable = resolve(
    APP_ROOT,
    'node_modules/.pnpm/@polkadot-api+observable-client@0.18.7_rxjs@7.8.2/node_modules/@polkadot-api/observable-client/dist',
  );
  const { createCompatHelpers } = (await import(`${papi}/compatibility/compatibility.js`)) as {
    createCompatHelpers: (d: unknown) => { getSyncHelpers: (ctx: unknown) => Promise<CompatGroups> };
  };
  const { createRuntimeCtx } = (await import(`${observable}/utils/create-metadata-ctx.js`)) as {
    createRuntimeCtx: (meta: unknown, raw: Uint8Array, codeHash: string) => unknown;
  };
  const bindings = await import('@polkadot-api/substrate-bindings');
  const { bleavit } = await import('@polkadot-api/descriptors');

  const raw = new Uint8Array(
    readFileSync(join(APP_ROOT, 'fixtures/foreign-chain-feed/asset-hub-paseo/2004002/metadata.scale')),
  );
  const assetHubRuntime = createRuntimeCtx(
    bindings.unifyMetadata(bindings.metadata.dec(raw)),
    raw,
    `0x${'00'.repeat(32)}`,
  );
  return createCompatHelpers(bleavit).getSyncHelpers(assetHubRuntime);
}

test('PAPI reports a surface the runtime does not have as incompatible — in every probed group', async () => {
  const compat = await crossedCompat();
  const { bleavit } = await import('@polkadot-api/descriptors');
  const declared = await bleavit.descriptors;
  // Names taken from the descriptor set itself rather than written here, so the test cannot
  // drift from the artifact it is about.
  const txName = declaredMembers(declared, 'tx', 'Epoch')[0];
  const eventName = declaredMembers(declared, 'events', 'Epoch')[0];
  const apiName = declaredMembers(declared, 'apis', 'FutarchyApi')[0];
  assert.ok(txName && eventName && apiName, 'the bleavit descriptors declare no Epoch/FutarchyApi entries');

  const absent: readonly [string, AnyCompatHelper][] = [
    ['query', compat['query']!['Epoch']!['EpochOf']!],
    ['constants', compat['constants']!['Epoch']!['RecentCohorts']!],
    ['tx', compat['tx']!['Epoch']![txName]!],
    ['event', compat['event']!['Epoch']![eventName]!],
    ['apis', compat['apis']!['FutarchyApi']![apiName]!],
  ];

  for (const [group, helper] of absent) {
    // Always an object: the `helper === undefined` branch in `helperFor` is unreachable here
    // and guards a hand-built surface only. Stated as an assertion so the dead branch is
    // known-dead rather than believed-live.
    assert.ok(helper, `${group} returned no helper at all`);
    assert.equal(helper.isCompatible(), false, `${group} reported an absent surface as compatible`);
  }

  // **Through the production probe**, not through a local restatement of `levelOf`. An earlier
  // draft asserted the levels with a copy of that rule written in this file, which agrees with
  // the subject by construction: a mutant returning `identical` for every flat helper — the
  // shape an absent `tx` has — passed the whole suite. `probeForeignSurface` takes a surface
  // list, so the absent members can be probed as if they were frozen ones.
  const probes = probeForeignSurface(compat, [
    { id: 'x.Epoch.EpochOf', kind: 'storage', compatGroup: 'query', pallet: 'Epoch', member: 'EpochOf', citation: 'F26 review, minor 11' },
    { id: 'x.Epoch.tx', kind: 'call', compatGroup: 'tx', pallet: 'Epoch', member: txName, citation: 'F26 review, minor 11' },
  ]);
  for (const probe of probes) {
    assert.equal(probe.compatible, false, probe.id);
    // The level is what `restricted` mode renders as a reason, and the flat-vs-split read is
    // exactly what `levelOf` decides. A wrong read here reports an absent surface as
    // `identical` beside a `false` verdict — two statements about one surface that disagree.
    assert.equal(probe.level, 'incompatible', probe.id);
  }
});

test('the absent-entry SHAPE differs per group, and `tx` is the flat one', async () => {
  // `getCompatibilityHelper` builds `inOutIncompat` and then returns `result.args` for `tx`,
  // `result.value` for constants/events, and the whole `{args, value}` object only for
  // storage/apis/view. So an absent `tx` — 02 §7.7's frozen Asset Hub **call** is one — has
  // no `args` property and its level must be read off the top. `probe.ts` said `inOutIncompat`
  // for all six until this test was written.
  const compat = await crossedCompat();
  const { bleavit } = await import('@polkadot-api/descriptors');
  const txName = declaredMembers(await bleavit.descriptors, 'tx', 'Epoch')[0]!;

  const flat = compat['tx']!['Epoch']![txName]! as { level?: number; args?: unknown };
  assert.equal('args' in flat, false, 'an absent `tx` helper carried an `args` side');
  assert.equal(flat.level, 0);

  const split = compat['query']!['Epoch']!['EpochOf']! as {
    level?: number;
    args: { level: number };
    value: { level: number };
  };
  assert.equal(split.level, undefined, 'an absent storage helper grew a top-level `level`');
  assert.equal(split.args.level, 0);
  assert.equal(split.value.level, 0);
});

test('a surface the runtime DOES have is compatible — the control that stops the test above passing on nothing', async () => {
  // Without this, "everything is incompatible" would satisfy the two tests above perfectly,
  // including against a compat construction that had failed and was answering `incompatible`
  // for every name.
  const papi = resolve(
    APP_ROOT,
    'node_modules/.pnpm/polkadot-api@2.1.8_esbuild@0.28.1_rxjs@7.8.2/node_modules/polkadot-api/dist/src',
  );
  const observable = resolve(
    APP_ROOT,
    'node_modules/.pnpm/@polkadot-api+observable-client@0.18.7_rxjs@7.8.2/node_modules/@polkadot-api/observable-client/dist',
  );
  const { createCompatHelpers } = (await import(`${papi}/compatibility/compatibility.js`)) as {
    createCompatHelpers: (d: unknown) => { getSyncHelpers: (ctx: unknown) => Promise<CompatGroups> };
  };
  const { createRuntimeCtx } = (await import(`${observable}/utils/create-metadata-ctx.js`)) as {
    createRuntimeCtx: (meta: unknown, raw: Uint8Array, codeHash: string) => unknown;
  };
  const bindings = await import('@polkadot-api/substrate-bindings');
  const { bleavit } = await import('@polkadot-api/descriptors');

  const raw = new Uint8Array(readFileSync(join(APP_ROOT, 'fixtures/chain-feed/2/metadata.scale')));
  const ownRuntime = createRuntimeCtx(
    bindings.unifyMetadata(bindings.metadata.dec(raw)),
    raw,
    `0x${'00'.repeat(32)}`,
  );
  const compat = await createCompatHelpers(bleavit).getSyncHelpers(ownRuntime);
  const helper = compat['query']!['Epoch']!['EpochOf']!;
  assert.equal(helper.isCompatible(), true, 'this release cannot read its own committed runtime');
  const [probe] = probeForeignSurface(compat, [
    { id: 'x.Epoch.EpochOf', kind: 'storage', compatGroup: 'query', pallet: 'Epoch', member: 'EpochOf', citation: 'F26 review, minor 11' },
  ]);
  assert.equal(probe?.level, 'identical');
  assert.equal(probe?.compatible, true);
});


