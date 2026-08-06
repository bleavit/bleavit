/**
 * The platform adapter and its capability lattice — F22 (10 §10.1; INV-FE-12).
 *
 * App-code rule 10 is the sentence this suite exists to make true: *"Platform and signer
 * capabilities are a fail-closed lattice: an unproven capability is absent, and absence
 * disables the dependent surface with a named reason — never a silent fallback."*
 *
 * Three of the properties below are shapes rather than behaviours, and are asserted here
 * because a shape that nothing exercises drifts on the first refactor:
 *
 * 1. **`absent` carries a real reason.** An empty one is refused. A disabled control with no
 *    explanation is indistinguishable from a broken one, and the repair a user attempts is a
 *    reload, which changes nothing.
 * 2. **The two restatements are bound.** `AttestationFinding` restates `verify`'s
 *    `SelfCheckFinding`, and `transportCapabilities` projects onto `llm-handoff`'s
 *    `TransportCapabilities`. Both are restatements *on purpose* — the production edges are
 *    forbidden by 10 §10.2 — so each is assigned to the other here, in both directions, and
 *    a rename on either side stops compiling.
 * 3. **The channel union has no store member.** Track F Phase 1's direct-download scoping,
 *    made structural. The assertion is over the frozen list rather than over a type, because
 *    a type-level claim would erase at runtime and this list is what a release reads.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TransportCapabilities } from '@bleavit/llm-handoff';
import { chooseTransport } from '@bleavit/llm-handoff';
import type {
  AttestationFinding,
  AttestationState,
  CapabilityLattice,
  CapabilityState,
  HostReport,
  PlatformAdapter,
  PlatformCapability,
} from '@bleavit/platform';
import {
  CapabilityError,
  DISTRIBUTION_CHANNELS,
  PLATFORM_CAPABILITIES,
  PlatformError,
  SHIPPING_CHANNELS,
  absent,
  desktopPlatform,
  lattice,
  meet,
  proven,
  requireCapabilities,
  transportCapabilities,
  unknownPlatform,
  unprovenLattice,
  webPlatform,
} from '@bleavit/platform';
import type { SelfCheckFinding } from '@bleavit/verify';

const EVERY_WEB_PROBE = { file: true, clipboard: true, share: true, serviceWorker: true } as const;

const reportedVerified: AttestationState = {
  kind: 'reported-verified',
  pinnedCount: 12,
  sourceCommit: '0'.repeat(40),
};

const divergence: AttestationFinding = {
  kind: 'changed',
  path: 'index.html',
  detail: 'index.html does not match the hash this release signed',
};

const reportedDivergent: AttestationState = {
  kind: 'reported-divergent',
  findings: [divergence],
};

function hostReport(overrides: Partial<HostReport> = {}): HostReport {
  return {
    host: 'tauri',
    file: true,
    clipboard: true,
    share: false,
    // False by default because it is what the shipped shell reports: `src-tauri` registers no
    // host plugin and `gen/schemas/capabilities.json` is `{}`. A helper whose defaults are
    // all `true` tests a host nobody built.
    externalNavigation: false,
    attestation: reportedVerified,
    ...overrides,
  };
}

test('an absent capability must name the reason the surface will show', () => {
  assert.throws(() => absent(''), CapabilityError);
  assert.throws(() => absent('   \n\t '), CapabilityError);
  assert.deepEqual(absent('the clipboard needs a secure context'), {
    kind: 'absent',
    reason: 'the clipboard needs a secure context',
  });
});

test('`lattice` re-checks a hand-written literal, so the reason rule is not helper-only', () => {
  // The record type forces every capability to be *mentioned*. What it cannot force is that
  // an `absent` state carries a reason, because a caller can spell the literal by hand — and
  // this literal needs no assertion at all to typecheck, which is exactly the problem.
  const unexplained = { kind: 'absent', reason: '' } as const;
  const handWritten: CapabilityLattice = {
    file: unexplained,
    clipboard: unexplained,
    share: unexplained,
    'external-navigation': unexplained,
    'service-worker': unexplained,
    'embedded-tree-attestation': unexplained,
  };
  assert.throws(() => lattice(handWritten), CapabilityError);
});

test('the lattice is total: every capability is present in every constructor', () => {
  const built = [
    webPlatform(EVERY_WEB_PROBE).capabilities,
    desktopPlatform({ report: hostReport() }).capabilities,
    unknownPlatform('this host was not identified').capabilities,
    unprovenLattice('nothing established yet'),
  ];
  for (const value of built) {
    assert.deepEqual(
      Object.keys(value).sort(),
      [...PLATFORM_CAPABILITIES].sort(),
      'a lattice that omits a capability lets `undefined` read as "probably fine"',
    );
  }
});

test('an unidentified host proves nothing, and says the same thing about everything', () => {
  const reason = 'this host was not identified, so nothing about it has been established';
  const adapter = unknownPlatform(reason);
  for (const capability of PLATFORM_CAPABILITIES) {
    assert.deepEqual(adapter.capabilities[capability], { kind: 'absent', reason });
  }
  // Unknown is a state, not a default to the permissive one (app-code rule 10). The channel
  // is part of that: `web` would claim the release-scoped service worker is checking these
  // bytes, which is reassurance nobody earned about a host that may be a native shell.
  assert.equal(adapter.channel, 'unknown');
  assert.equal(adapter.attestation.kind, 'not-applicable');
  assert.ok(!(SHIPPING_CHANNELS as readonly string[]).includes(adapter.channel));
});

test('requireCapabilities names every missing member, not the first one checked', () => {
  const available = lattice({
    file: proven(),
    clipboard: absent('no clipboard here'),
    share: absent('no share sheet here'),
    'external-navigation': proven(),
    'service-worker': proven(),
    'embedded-tree-attestation': proven(),
  });
  const verdict = requireCapabilities(available, ['clipboard', 'share', 'file']);
  assert.equal(verdict.kind, 'disabled');
  if (verdict.kind !== 'disabled') return;
  assert.deepEqual([...verdict.missing].sort(), ['clipboard', 'share']);
  assert.match(verdict.reason, /no clipboard here/);
  assert.match(verdict.reason, /no share sheet here/);
  assert.equal(requireCapabilities(available, ['file']).kind, 'enabled');
});

test('requireCapabilities refuses an empty question rather than returning `enabled`', () => {
  // The vacuous-pass shape this repository keeps rediscovering: a check over nothing that
  // reports success. A surface requiring no capability has no business asking.
  assert.throws(() => requireCapabilities(unprovenLattice('nothing'), []), CapabilityError);
});

test('meet takes the weaker side and keeps both reasons', () => {
  const host = unprovenLattice('the host did not offer it');
  const release = lattice({
    file: proven(),
    clipboard: proven(),
    share: proven(),
    'external-navigation': proven(),
    'service-worker': proven(),
    'embedded-tree-attestation': proven(),
  });
  const combined = meet(host, release);
  for (const capability of PLATFORM_CAPABILITIES) {
    assert.equal(combined[capability].kind, 'absent');
  }

  const left = lattice({ ...release, file: absent('the host has no file picker') });
  const right = lattice({ ...release, file: absent('this release disabled file export') });
  const both = meet(left, right).file;
  assert.equal(both.kind, 'absent');
  if (both.kind !== 'absent') return;
  assert.match(both.reason, /the host has no file picker/);
  assert.match(both.reason, /this release disabled file export/);
  // Two identical reasons must not be repeated back at the user twice. Asserted on the
  // reason rather than by reference: `meet` re-reads both sides through the same refusal
  // `lattice` uses, so it returns a fresh object, and object identity was never the property.
  assert.deepEqual(meet(left, left).file, {
    kind: 'absent',
    reason: 'the host has no file picker',
  });
});

test('the web channel disables what it cannot prove, with the reason', () => {
  const adapter = webPlatform({ file: true, clipboard: false, share: false, serviceWorker: false });
  assert.equal(adapter.channel, 'web');
  assert.equal(adapter.capabilities.file.kind, 'proven');
  for (const capability of ['clipboard', 'share', 'service-worker'] as const) {
    const state = adapter.capabilities[capability];
    assert.equal(state.kind, 'absent');
    if (state.kind !== 'absent') return;
    assert.ok(state.reason.trim().length > 0);
  }
  // The web channel has no embedded tree, and that is a first-class arm rather than a
  // failed check: collapsing it into "not verified" warns every web user about a control
  // their channel does not use.
  assert.equal(adapter.capabilities['embedded-tree-attestation'].kind, 'absent');
  assert.equal(adapter.attestation.kind, 'not-applicable');
  // A top-level navigation is the one capability a browser cannot lack (10 §13.4).
  assert.equal(adapter.capabilities['external-navigation'].kind, 'proven');
});

test('the desktop channel proves the embedded-tree attestation and drops the worker', () => {
  const adapter = desktopPlatform({ report: hostReport() });
  assert.equal(adapter.channel, 'direct-download');
  assert.equal(adapter.host, 'tauri');
  assert.equal(adapter.capabilities['embedded-tree-attestation'].kind, 'proven');
  assert.equal(adapter.capabilities['service-worker'].kind, 'absent');
  assert.equal(adapter.capabilities.share.kind, 'absent');
  assert.deepEqual(adapter.attestation, reportedVerified);
});

test('the desktop adapter refuses a `not-applicable` attestation rather than degrading', () => {
  // Almost certainly a bridge wired to the web adapter's value. Accepting it ships a desktop
  // build whose one distinguishing control reports that it does not apply.
  assert.throws(
    () =>
      desktopPlatform({
        report: hostReport({ attestation: { kind: 'not-applicable', reason: 'no tree' } }),
      }),
    PlatformError,
  );
});

test('the desktop adapter refuses a divergence that names nothing', () => {
  assert.throws(
    () =>
      desktopPlatform({
        report: hostReport({ attestation: { kind: 'reported-divergent', findings: [] } }),
      }),
    PlatformError,
  );
  // ...and admits one that does, unchanged. Surfaced, never repaired: the adapter has no
  // branch that turns a divergence into anything else.
  const adapter = desktopPlatform({ report: hostReport({ attestation: reportedDivergent }) });
  assert.deepEqual(adapter.attestation, reportedDivergent);
});

test('the desktop adapter refuses a verification that compared no file', () => {
  // The exact mirror of the empty-findings refusal above, and it was missing: "I compared
  // nothing and found no divergence" is the vacuous pass, and `pinnedCount: 0` is what a
  // bridge that lost the field produces. No honest release reaches it — `readPerFileHashes`
  // and the Rust `attest` both refuse an empty manifest — so it means the report is wrong.
  assert.throws(
    () =>
      desktopPlatform({
        report: hostReport({
          attestation: { kind: 'reported-verified', pinnedCount: 0, sourceCommit: '0'.repeat(40) },
        }),
      }),
    PlatformError,
  );
  // The negative control: one pinned file is a comparison, and it verifies.
  assert.equal(
    desktopPlatform({
      report: hostReport({
        attestation: { kind: 'reported-verified', pinnedCount: 1, sourceCommit: '0'.repeat(40) },
      }),
    }).capabilities['embedded-tree-attestation'].kind,
    'proven',
  );
});

test('a reported divergence leaves the embedded-tree capability absent, naming what diverged', () => {
  // The defect this asserts against: the adapter deliberately RETURNS on a divergence, and
  // the capability beside that branch was the literal `proven()`. Every surface guarded on
  // `embedded-tree-attestation` was therefore enabled in exactly the state where the host had
  // said the embedded tree failed verification.
  const adapter = desktopPlatform({ report: hostReport({ attestation: reportedDivergent }) });
  const state = adapter.capabilities['embedded-tree-attestation'];
  assert.equal(state.kind, 'absent');
  if (state.kind !== 'absent') return;
  // Absence disables the dependent surface WITH A NAMED REASON (app-code rule 10), and the
  // reason has to be about this divergence rather than a generic sentence.
  assert.match(state.reason, /index\.html/);
  assert.match(state.reason, /1 file/);

  const verdict = requireCapabilities(adapter.capabilities, ['embedded-tree-attestation']);
  assert.equal(verdict.kind, 'disabled');
  if (verdict.kind !== 'disabled') return;
  assert.deepEqual([...verdict.missing], ['embedded-tree-attestation']);

  // Disabling the capability must not swallow the divergence: INV-FE-8 surfaces it, and the
  // findings are what a verification panel renders.
  assert.deepEqual(adapter.attestation, reportedDivergent);
});

test('a divergence names a bounded number of files and always the true count', () => {
  // A reason nobody finishes reading is the unexplained control again, so the list is capped
  // — but the count is exact, because "3 files" for a wholesale replacement is a different
  // event from "412 files" and the user is the one deciding what to do about it.
  const findings: AttestationFinding[] = Array.from({ length: 9 }, (_unused, index) => ({
    kind: 'changed',
    path: `assets/chunk-${index}.js`,
    detail: 'digest mismatch',
  }));
  const adapter = desktopPlatform({
    report: hostReport({ attestation: { kind: 'reported-divergent', findings } }),
  });
  const state = adapter.capabilities['embedded-tree-attestation'];
  assert.equal(state.kind, 'absent');
  if (state.kind !== 'absent') return;
  assert.match(state.reason, /9 file/);
  assert.match(state.reason, /and 6 more/);
  assert.match(state.reason, /assets\/chunk-0\.js/);
  assert.ok(!state.reason.includes('assets/chunk-8.js'), 'the reason is unbounded');
});

test('the capability and the attestation cannot disagree, in any constructor', () => {
  // The property the fix is FOR, asserted over every adapter this package can produce rather
  // than over the one branch that was wrong. A capability computed from the attestation arm
  // cannot fall out of step with it; a literal written beside a divergence check can, and did.
  const adapters: readonly PlatformAdapter[] = [
    webPlatform(EVERY_WEB_PROBE),
    webPlatform({ file: false, clipboard: false, share: false, serviceWorker: false }),
    unknownPlatform('this host was not identified'),
    desktopPlatform({ report: hostReport() }),
    desktopPlatform({ report: hostReport({ attestation: reportedDivergent }) }),
  ];
  for (const adapter of adapters) {
    assert.equal(
      adapter.capabilities['embedded-tree-attestation'].kind === 'proven',
      adapter.attestation.kind === 'reported-verified',
      `${adapter.channel}/${adapter.host}: the capability disagrees with the attestation it ` +
        'is supposed to be derived from',
    );
  }
  // Both sides of that equivalence are actually exercised, so it is not satisfied by an
  // absence. Without this the loop passes on five adapters that all report the same arm.
  const arms = new Set(adapters.map((adapter) => adapter.attestation.kind));
  assert.deepEqual(
    [...arms].sort(),
    ['not-applicable', 'reported-divergent', 'reported-verified'],
  );
});

test('the desktop channel does not inherit the browser argument for external navigation', () => {
  // `webPlatform` proves this unconditionally and is right to: a browser cannot lack a
  // top-level navigation (10 §13.4). That argument is about browsers. A downloaded
  // application opens an external URL only where its host grants it, and the shell this
  // milestone ships grants nothing — so the copied `proven()` offered a control that would
  // do nothing when clicked.
  const withoutGrant = desktopPlatform({ report: hostReport({ externalNavigation: false }) });
  const state = withoutGrant.capabilities['external-navigation'];
  assert.equal(state.kind, 'absent');
  if (state.kind !== 'absent') return;
  assert.ok(state.reason.trim().length > 0);
  assert.equal(
    requireCapabilities(withoutGrant.capabilities, ['external-navigation']).kind,
    'disabled',
  );

  const withGrant = desktopPlatform({ report: hostReport({ externalNavigation: true }) });
  assert.equal(withGrant.capabilities['external-navigation'].kind, 'proven');
  // The browser's own claim is untouched: this is a correction to one channel, not a
  // withdrawal of the capability.
  assert.equal(webPlatform(EVERY_WEB_PROBE).capabilities['external-navigation'].kind, 'proven');
});

test('`transportCapabilities` is exactly what `chooseTransport` consumes', () => {
  const adapter = webPlatform({ file: false, clipboard: true, share: false, serviceWorker: true });
  const projected = transportCapabilities(adapter.capabilities);
  // The compile-time half: the projection IS a `TransportCapabilities`, and the restatement
  // in `platform` cannot drift from the handoff package's declaration without a type error.
  const asDeclared: TransportCapabilities = projected;
  assert.deepEqual(asDeclared, { file: false, clipboard: true, share: false });
  // The runtime half: the same values reach the real chooser and decide the real transport.
  assert.deepEqual(chooseTransport('{"a":1}', asDeclared), { kind: 'clipboard' });
});

test('`AttestationFinding` and `SelfCheckFinding` are the same shape, both ways', () => {
  // Restated rather than imported in production, because `platform` is in the tx unit's
  // 10 §10.2 reference set and `verify` is not. This is what keeps the restatement bound.
  const fromVerify: SelfCheckFinding = {
    kind: 'unexpected',
    path: 'assets/payload.js',
    served: 'a'.repeat(64),
    detail: 'assets/payload.js is in this build and is not part of the signed release',
  };
  const asAttestation: AttestationFinding = fromVerify;
  const backAgain: SelfCheckFinding = asAttestation;
  assert.equal(backAgain.kind, 'unexpected');

  // The kind unions must agree member for member, which structural assignability alone does
  // not check in the widening direction.
  const kinds: readonly AttestationFinding['kind'][] = ['changed', 'missing', 'unexpected'];
  const mirrored: readonly SelfCheckFinding['kind'][] = kinds;
  assert.deepEqual([...mirrored], ['changed', 'missing', 'unexpected']);
});

test('the shipping channels are direct-download and web, and name no application store', () => {
  // Track F Phase 1's scoping decision, made structural. It has no citation in
  // `docs/architecture/` — see PLAN.md · Decision log (2026-08-06) — so the honest control
  // is a closed union that fails every exhaustive `switch` when somebody adds a member,
  // rather than a configuration flag. Asserted over `SHIPPING_CHANNELS`, because
  // `DISTRIBUTION_CHANNELS` also has to carry `unknown`, which is not a channel anything
  // ships on.
  assert.deepEqual([...SHIPPING_CHANNELS], ['web', 'direct-download']);
  for (const forbidden of ['app-store', 'play-store', 'store', 'msix', 'flathub', 'snap']) {
    assert.ok(
      !(DISTRIBUTION_CHANNELS as readonly string[]).includes(forbidden),
      `${forbidden} is a re-signing channel; adding one needs the argument, not a constant`,
    );
  }
  // Every shipping channel is a distribution channel, so the narrower list cannot drift into
  // naming something the union does not admit.
  for (const channel of SHIPPING_CHANNELS) {
    assert.ok((DISTRIBUTION_CHANNELS as readonly string[]).includes(channel));
  }
});

test('an unrecognised capability state is refused, never read as proven', () => {
  // The direction is the point: an `else` returning `proven` turns a typo — or an untyped
  // record rehydrated from storage, or a value across a host bridge — into a capability
  // nobody established. `lattice` exists because the type is not enough, so it cannot then
  // trust the type.
  // Parsed rather than asserted through `unknown`, which `check:casts` bans and which would
  // also be the wrong illustration: the realistic source of a malformed state is untyped data
  // arriving from outside, and this is exactly that.
  const wrong = JSON.parse('{"kind":"unknown","reason":"x"}') as CapabilityState;
  const base = lattice(unprovenLattice('nothing established'));
  assert.throws(() => lattice({ ...base, file: wrong }), CapabilityError);
  // `meet` is the *more* likely entry point, since it is where two independently-sourced
  // records arrive, so it must refuse from either side.
  assert.throws(() => meet({ ...base, file: wrong }, base), CapabilityError);
  assert.throws(() => meet(base, { ...base, file: wrong }), CapabilityError);
});

test('the capability set is closed and every member is reachable from a real adapter', () => {
  // A capability nothing ever proves is a surface nobody can enable — the "defined and
  // unreachable" defect class, applied to the lattice.
  const proven_: ReadonlySet<PlatformCapability> = new Set(
    [
      webPlatform(EVERY_WEB_PROBE).capabilities,
      desktopPlatform({ report: hostReport({ share: true }) }).capabilities,
    ].flatMap((value) =>
      PLATFORM_CAPABILITIES.filter((capability) => value[capability].kind === 'proven'),
    ),
  );
  assert.deepEqual(
    [...proven_].sort(),
    [...PLATFORM_CAPABILITIES].sort(),
    'every capability must be provable by some real adapter',
  );
});
