/**
 * `packages/verify` — release self-check, identity pins, verification panel (F10).
 *
 * Three properties carry the invariants and each is tested as a property rather than as
 * a happy path, because all three are invisible when right:
 *
 *  - **Genesis mismatch is terminal** (INV-FE-11). Not `restricted`, not degraded — a
 *    different chain, where no reduced mode is safe.
 *  - **Divergence is surfaced, never repaired** (INV-FE-8). Tested structurally: the
 *    module must export no way to make a finding go away.
 *  - **The panel is always available** (INV-FE-11, 10 §3.2 `FE-BOOT-002`). It must render
 *    with no chain and no self-check, because the moment a user most needs to know what
 *    they are running is the moment the light client failed to start.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCheckable,
  buildPanel,
  mayOperate,
  runSelfCheck,
  verifyChainIdentity,
} from '@bleavit/verify';
import * as verifyModule from '@bleavit/verify';

const h = (n) => `0x${String(n).repeat(2).padEnd(64, '0')}`;

const IDENTITY = {
  releaseTxid: 'tx-abcdefghijklmnopqrstuvwxyz0123456789',
  sourceCommit: '3e0985e656549d987ff20a78d00de185f6f28381',
  perFileHashes: { 'index.html': h(11), 'app.js': h(22), 'sw.js': h(33) },
  descriptorMetadataHashes: { 2: h(44), 3: h(55) },
  specVersionRange: { primary: 2, recovery: 3 },
  chainSpecHashes: { relay: h(66), para: h(77) },
  genesisHashes: { relay: h(88), para: h(99) },
};

const OBSERVED = {
  relayGenesis: h(88),
  paraGenesis: h(99),
  relaySpecHash: h(66),
  paraSpecHash: h(77),
};

// --- chain identity -------------------------------------------------------

test('a matching chain verifies', () => {
  const verdict = verifyChainIdentity(IDENTITY, OBSERVED);
  assert.equal(verdict.kind, 'verified');
  assert.equal(mayOperate(verdict), true);
});

test('a genesis mismatch is terminal, not a degraded mode', () => {
  // The distinction INV-FE-12's `restricted` does NOT cover: a partly-unknown surface is
  // the same chain further along; a wrong genesis is someone else's network, where every
  // balance shown belongs to a different account.
  const verdict = verifyChainIdentity(IDENTITY, { ...OBSERVED, paraGenesis: h(12) });
  assert.equal(verdict.kind, 'genesis-mismatch');
  assert.equal(verdict.which, 'para');
  assert.equal(mayOperate(verdict), false);
  assert.match(verdict.detail, /different chain/);
  // No severity and no override to compare against — the shape must not invite treating
  // this as something to weigh.
  assert.equal('severity' in verdict, false);
  assert.equal('override' in verdict, false);
});

test('the relay genesis is checked too, not just the parachain', () => {
  const verdict = verifyChainIdentity(IDENTITY, { ...OBSERVED, relayGenesis: h(12) });
  assert.equal(verdict.kind, 'genesis-mismatch');
  assert.equal(verdict.which, 'relay');
});

test('a tampered chain spec is reported as itself, not as a genesis failure', () => {
  // Order matters and is asserted: if the bytes handed to smoldot were not the release's
  // own, the genesis they yield is a fact about an input the release did not choose.
  // Reporting that as a genesis mismatch would name the wrong failure — the chain would
  // look wrong when the file describing it was.
  const verdict = verifyChainIdentity(IDENTITY, {
    ...OBSERVED,
    paraSpecHash: h(12),
    paraGenesis: h(13),
  });
  assert.equal(verdict.kind, 'chain-spec-mismatch');
  assert.equal(verdict.which, 'para');
  assert.equal(mayOperate(verdict), false);
});

// --- self-check -----------------------------------------------------------

test('an untampered bundle passes with every file counted', () => {
  const result = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.verifiedCount, 3);
  assert.equal(result.pinnedCount, 3);
});

test('a changed file is reported as changed', () => {
  const result = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes, 'app.js': h(12) });
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'changed');
  assert.equal(result.findings[0].path, 'app.js');
  assert.equal(result.verifiedCount, 2);
});

test('a missing file is reported, and is not silently a pass', () => {
  const served = { ...IDENTITY.perFileHashes };
  delete served['sw.js'];
  const result = runSelfCheck(IDENTITY, served);
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].kind, 'missing');
  assert.equal(result.findings[0].path, 'sw.js');
});

test('an UNEXPECTED served file is reported — the direction a manifest loop cannot see', () => {
  // This is how a payload arrives: nothing the signed manifest lists has changed, so a
  // checker that iterates the manifest reports everything in order and the extra file
  // rides along.
  const result = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes, 'payload.js': h(12) });
  assert.equal(result.ok, false, 'an extra served file passed the self-check');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'unexpected');
  assert.equal(result.findings[0].path, 'payload.js');
  // ...and every signed file still verified, which is exactly why it needs its own finding.
  assert.equal(result.verifiedCount, 3);
});

test('divergence is surfaced and never repaired (INV-FE-8)', () => {
  // The module must export no way to make a finding go away. A refetch would ask the
  // channel that just served wrong bytes for better ones, and the user would see a
  // flicker instead of a warning.
  //
  // **What this does NOT catch, stated because the earlier comment claimed too much.**
  // Adversarial review demonstrated the surviving mutation: inserting
  // `globalThis.location?.reload()` inside `runSelfCheck` leaves every assertion here
  // green, and a helper named `loadCurrentRelease()` would evade the pattern too. A name
  // scan is a **review aid**, not a proof — it catches the obvious addition and nothing
  // subtler. The property that actually holds is enforced by the purity assertion below,
  // and by the package having no network or navigation primitive at all (the
  // dependency-cruiser handoff rules and the CI source gate).
  const repairish = Object.keys(verifyModule).filter((name) =>
    /repair|refetch|retry|fix|heal|reset|reload|load/i.test(name),
  );
  assert.deepEqual(repairish, [], 'verify exports something that could silently repair divergence');
});

test('runSelfCheck is pure: it mutates neither input and returns only findings', () => {
  // The half the name scan cannot reach. A repair path would have to *act* — write a
  // file, reload, refetch — and the observable proxy for "acted" available here is that
  // nothing it was given changed and nothing but a result came back.
  const identity = { ...IDENTITY, perFileHashes: { ...IDENTITY.perFileHashes } };
  const served = { ...IDENTITY.perFileHashes, 'app.js': h(12), 'payload.js': h(13) };
  const identityBefore = JSON.stringify(identity);
  const servedBefore = JSON.stringify(served);

  const result = runSelfCheck(identity, served);

  assert.equal(JSON.stringify(identity), identityBefore, 'the signed manifest was mutated');
  assert.equal(JSON.stringify(served), servedBefore, 'the served map was mutated');
  assert.deepEqual(Object.keys(result).sort(), ['findings', 'ok', 'pinnedCount', 'verifiedCount']);
  assert.equal(result.ok, false);
});

test('a release pinning no files is refused rather than reported as verified', () => {
  // Adversarial review (2026-08-04): `assertCheckable` was a *separate* call, so an
  // empty manifest ran through `runSelfCheck`, returned ok having compared nothing, and
  // produced a **verified** panel — the vacuous green, reachable by any caller who did
  // not remember the extra call. The check now lives inside `runSelfCheck`, so it cannot
  // be skipped by forgetting it.
  const empty = { ...IDENTITY, perFileHashes: {} };
  assert.throws(() => runSelfCheck(empty, {}), /verify nothing/);
  assert.throws(() => assertCheckable(empty), /verify nothing/);
  assert.doesNotThrow(() => assertCheckable(IDENTITY));
});

test('a prototype-carried entry cannot hide a tamper (own keys only)', () => {
  // Adversarial review: a plain lookup consults the prototype chain while
  // `Object.entries` does not. `Object.create({'app.js': good})` therefore made
  // `served['app.js']` return the good hash at comparison time while the enumeration
  // never listed it — so a tampered `app.js` was neither compared nor reported.
  const served = Object.create({ 'app.js': h(22) });
  served['index.html'] = h(11);
  served['sw.js'] = h(33);
  const result = runSelfCheck(IDENTITY, served);
  assert.equal(result.ok, false, 'an inherited entry satisfied a pinned file');
  assert.ok(result.findings.some((f) => f.kind === 'missing' && f.path === 'app.js'));

  // ...and the reverse: an inherited *manifest* entry must not suppress the
  // unexpected-file finding for a served file nobody signed.
  const inheritedManifest = Object.create({ 'payload.js': h(44) });
  inheritedManifest['index.html'] = h(11);
  const reverse = runSelfCheck(
    { ...IDENTITY, perFileHashes: inheritedManifest },
    { 'index.html': h(11), 'payload.js': h(44) },
  );
  assert.equal(reverse.ok, false, 'an inherited manifest entry excused an unsigned file');
  assert.ok(reverse.findings.some((f) => f.kind === 'unexpected' && f.path === 'payload.js'));
});

// --- panel ----------------------------------------------------------------

test('the panel renders with no chain and no self-check (FE-BOOT-002)', () => {
  // The `WorkerFailed` case: smoldot never started, no verified read exists. The panel is
  // named in 10 §3.2's renderable surface, so it must build from pins alone.
  const panel = buildPanel(IDENTITY);
  assert.equal(panel.status, 'unverified');
  assert.ok(panel.rows.length >= 8, 'panel lost its pinned rows offline');
  assert.equal(panel.warnings.length, 0);
  // Adversarial review: this previously asserted `mayOperate === true`, which made a
  // NEVER-CHECKED identity indistinguishable from a verified one — an app that simply
  // skipped the check was treated as safe. INV-FE-11 makes identity verification a boot
  // obligation and a mismatch terminal, so "not checked" must sit beside "wrong". The
  // flag is now named for the check and defaults false; the panel still RENDERS, which
  // is the separate property 10 §3.2 requires and the reason the two were conflated.
  assert.equal(panel.chainIdentityVerified, false);
  assert.ok(panel.rows.length > 0, 'the panel must still render with nothing verified');
});

test('buildPanel is synchronous and takes no chain handle', () => {
  // If it ever returns a promise, the panel has acquired a dependency on something that
  // can be down — and it would be down in exactly the incident it exists for.
  const panel = buildPanel(IDENTITY);
  assert.equal(typeof panel.then, 'undefined');
  assert.equal(buildPanel.length <= 3, true);
});

test('every INV-FE-11 pin appears in the panel', () => {
  const labels = buildPanel(IDENTITY).rows.map((r) => r.label).join(' | ');
  for (const required of [
    'Release (Arweave TXID)',
    'Source commit',
    'Files pinned',
    'Supported spec versions',
    'Relay chain spec',
    'Parachain chain spec',
    'Relay genesis',
    'Parachain genesis',
    'Descriptor metadata (spec 2)',
    'Descriptor metadata (spec 3)',
  ]) {
    assert.ok(labels.includes(required), `panel is missing "${required}"`);
  }
});

test('pinned rows and observed rows are distinguishable', () => {
  // A panel that renders both identically lets a compiled-in pin masquerade as a
  // verification against a live chain.
  const panel = buildPanel(IDENTITY, runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes }), {
    kind: 'verified',
  });
  const kinds = new Set(panel.rows.map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ['observed', 'pinned']);
});

test('`verified` requires BOTH the self-check and the chain identity', () => {
  const clean = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes });
  // Self-check alone says the bundle is intact, not that it is talking to the right chain.
  assert.equal(buildPanel(IDENTITY, clean).status, 'unverified');
  // Chain alone says the right chain, not that the bundle is the published one.
  assert.equal(buildPanel(IDENTITY, undefined, { kind: 'verified' }).status, 'unverified');
  assert.equal(buildPanel(IDENTITY, clean, { kind: 'verified' }).status, 'verified');
});

test('a terminal chain verdict stops the app and says why', () => {
  const verdict = verifyChainIdentity(IDENTITY, { ...OBSERVED, paraGenesis: h(12) });
  const panel = buildPanel(IDENTITY, runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes }), verdict);
  assert.equal(panel.status, 'divergent');
  assert.equal(panel.chainIdentityVerified, false);
  assert.equal(panel.warnings.length, 1);
  assert.match(panel.warnings[0], /different chain/);
});

test('self-check findings reach the user as warnings', () => {
  const tampered = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes, 'app.js': h(12) });
  const panel = buildPanel(IDENTITY, tampered, { kind: 'verified' });
  assert.equal(panel.status, 'divergent');
  assert.equal(panel.warnings.length, 1);
  assert.match(panel.warnings[0], /not the file that was published/);
  // A tampered bundle on the right chain still must not read as merely informational.
  assert.notEqual(panel.status, 'verified');
});
