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
  classifyCheckpointAge,
  mayClaimVerified,
  mayOperate,
  resolveBaseTxid,
  runSelfCheck,
  verifyChainIdentity,
} from '@bleavit/verify';
import type { Hash32, ReleaseIdentity } from '@bleavit/verify';
import * as verifyModule from '@bleavit/verify';

/**
 * A 32-byte hash fixture.
 *
 * The return type is `Hash32` (`` `0x${string}` ``), not `string`: an untyped template
 * expression infers as `string`, which then fails to satisfy every field in
 * `ReleaseIdentity` — and widening those fields to `string` would delete the one thing the
 * brand buys, which is that a hash missing its `0x` prefix cannot be written at all.
 */
const h = (n: number): Hash32 => `0x${String(n).repeat(2).padEnd(64, '0')}`;

/** A row the panel must contain, or a failure naming the label it lacks. */
function panelRow<T extends { readonly label: string }>(rows: readonly T[], label: string): T {
  const row = rows.find((r) => r.label === label);
  assert.ok(row, `the panel has no row labelled "${label}"`);
  return row;
}

/** The first finding, or a failure saying there was none — never `findings[0]!`. */
function finding<T>(findings: readonly T[], index = 0): T {
  const value = findings[index];
  assert.ok(value !== undefined, `expected a finding at ${index}, got ${findings.length}`);
  return value;
}

// A well-formed Arweave TXID: 43 base64url characters. Shaped correctly because
// `parseReleaseDocument` enforces it, and a fixture that could not survive the parser is a
// fixture describing a document that cannot exist.
const ASSET_MANIFEST = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_abcde';

const IDENTITY: ReleaseIdentity = {
  arweaveManifestTxId: ASSET_MANIFEST,
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
  assert.equal(finding(result.findings).kind, 'changed');
  assert.equal(finding(result.findings).path, 'app.js');
  assert.equal(result.verifiedCount, 2);
});

test('a missing file is reported, and is not silently a pass', () => {
  // Annotated so `delete` is legal: a spread of a known-keys object produces required
  // properties, and TypeScript refuses `delete` on one.
  const served: Record<string, Hash32> = { ...IDENTITY.perFileHashes };
  delete served['sw.js'];
  const result = runSelfCheck(IDENTITY, served);
  assert.equal(result.ok, false);
  assert.equal(finding(result.findings).kind, 'missing');
  assert.equal(finding(result.findings).path, 'sw.js');
});

test('an UNEXPECTED served file is reported — the direction a manifest loop cannot see', () => {
  // This is how a payload arrives: nothing the signed manifest lists has changed, so a
  // checker that iterates the manifest reports everything in order and the extra file
  // rides along.
  const result = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes, 'payload.js': h(12) });
  assert.equal(result.ok, false, 'an extra served file passed the self-check');
  assert.equal(result.findings.length, 1);
  assert.equal(finding(result.findings).kind, 'unexpected');
  assert.equal(finding(result.findings).path, 'payload.js');
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
  const served: Record<string, Hash32> = Object.create({ 'app.js': h(22) });
  served['index.html'] = h(11);
  served['sw.js'] = h(33);
  const result = runSelfCheck(IDENTITY, served);
  assert.equal(result.ok, false, 'an inherited entry satisfied a pinned file');
  assert.ok(result.findings.some((f) => f.kind === 'missing' && f.path === 'app.js'));

  // ...and the reverse: an inherited *manifest* entry must not suppress the
  // unexpected-file finding for a served file nobody signed.
  const inheritedManifest: Record<string, Hash32> = Object.create({ 'payload.js': h(44) });
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
  // Half of this is now a compile-time fact: were `buildPanel` async its declared return
  // type would be `Promise<VerificationPanel>` and `.then` would typecheck. The runtime
  // check stays, because it also catches a non-Promise thenable, and it is narrowed here
  // rather than by giving `VerificationPanel` a `then` member it must not have.
  const panel: unknown = buildPanel(IDENTITY);
  assert.equal(typeof (panel as { then?: unknown }).then, 'undefined');
  // The arity bound is a proxy for "no chain handle got added". It moved to 4 when the
  // observed base TXID arrived — which is a `BaseTxidVerdict` the caller already resolved
  // from `location`, not a connection, so the property this test guards is intact.
  assert.equal(buildPanel.length <= 4, true);
});

test('every INV-FE-11 pin appears in the panel', () => {
  const labels = buildPanel(IDENTITY).rows.map((r) => r.label).join(' | ');
  for (const required of [
    'Release assets (Arweave TXID)',
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
  assert.match(finding(panel.warnings), /different chain/);
});

test('self-check findings reach the user as warnings', () => {
  const tampered = runSelfCheck(IDENTITY, { ...IDENTITY.perFileHashes, 'app.js': h(12) });
  const panel = buildPanel(IDENTITY, tampered, { kind: 'verified' });
  assert.equal(panel.status, 'divergent');
  assert.equal(panel.warnings.length, 1);
  assert.match(finding(panel.warnings), /not the file that was published/);
  // A tampered bundle on the right chain still must not read as merely informational.
  assert.notEqual(panel.status, 'verified');
});

// ------------------------------------------- the long-range checkpoint bound (10 §2.4)

const DAY = 24 * 60 * 60 * 1000;
// Verified 2026-08-05 against the Fellowship Polkadot relay runtime and the Paseo relay
// runtime, which agree exactly. Written here as the values the release document carries,
// not as a client-side default — the module takes them as an argument for that reason.
const RELAY_BOUND = { bondingDurationEras: 28, slashDeferDurationEras: 27, eraMillis: DAY };
const at = (ageDays: number) => classifyCheckpointAge(0, ageDays * DAY, RELAY_BOUND);

test('a fresh checkpoint is fresh, and the boundary is the day it lapses', () => {
  assert.equal(at(0).kind, 'fresh');
  assert.equal(at(26).kind, 'fresh');
  // 27 eras: the slash-deferral window closes, so the deterrent has lapsed.
  assert.equal(at(27).kind, 'warn');
  assert.equal(at(27.9).kind, 'warn');
  // 28 eras: the stake itself may be withdrawn.
  assert.equal(at(28).kind, 'expired');
  assert.equal(at(365).kind, 'expired');
});

test('expiry refuses the verified claim; warn does not', () => {
  // The distinction 10 §2.4 rule 1 turns on: past the bound the claim is FALSE, not weaker.
  assert.equal(mayClaimVerified(at(26)), true);
  assert.equal(mayClaimVerified(at(27)), true);
  assert.equal(mayClaimVerified(at(28)), false);
});

test('a device clock behind the checkpoint refuses rather than reading age zero', () => {
  // The cheapest attack on this control is to set the clock back. Reading that as an age
  // of zero would disable the whole check silently.
  const verdict = classifyCheckpointAge(100 * DAY, 1 * DAY, RELAY_BOUND);
  assert.equal(verdict.kind, 'indeterminate');
  assert.match(verdict.message, /clock/);
  assert.equal(mayClaimVerified(verdict), false);
});

test('an age that cannot be established sits with expired, never with fresh', () => {
  // Fail-open here would be the same defect `chainIdentityVerified` was renamed to avoid:
  // "never checked" landing on the same side as "checked and fine".
  for (const bad of [
    classifyCheckpointAge(Number.NaN, 0, RELAY_BOUND),
    classifyCheckpointAge(0, Number.POSITIVE_INFINITY, RELAY_BOUND),
    classifyCheckpointAge(0, DAY, { ...RELAY_BOUND, eraMillis: 0 }),
    classifyCheckpointAge(0, DAY, { ...RELAY_BOUND, bondingDurationEras: 0 }),
  ]) {
    assert.equal(bad.kind, 'indeterminate', JSON.stringify(bad));
    assert.equal(mayClaimVerified(bad), false);
  }
});

test('a document claiming the deterrent outlives the stake is refused', () => {
  // Not a hypothetical shape to guard for its own sake: it is the ordering the whole
  // derivation rests on, and a document that inverts it is not describing this chain.
  const inverted = classifyCheckpointAge(0, DAY, {
    ...RELAY_BOUND,
    slashDeferDurationEras: 29,
  });
  assert.equal(inverted.kind, 'indeterminate');
  assert.match(inverted.message, /slash-defer/);
});

test('the bound moves with the chain rather than being baked in', () => {
  // 10 §2.4's last paragraph: the figures come from the release document, which is produced
  // from verified relay constants. A chain with a 7-day bonding duration must expire at 7.
  const kusamaLike = { bondingDurationEras: 7, slashDeferDurationEras: 6, eraMillis: DAY };
  assert.equal(classifyCheckpointAge(0, 5 * DAY, kusamaLike).kind, 'fresh');
  assert.equal(classifyCheckpointAge(0, 6 * DAY, kusamaLike).kind, 'warn');
  assert.equal(classifyCheckpointAge(0, 7 * DAY, kusamaLike).kind, 'expired');
});

test('the messages say what lapsed and what to do about it', () => {
  // `fresh` carries no message — deliberately, since there is nothing to say — so the
  // message is read through a narrowing accessor rather than by making it optional on
  // every arm, which would let a lapsed verdict ship with nothing to tell the user.
  const messageAt = (days: number): string => {
    const verdict = at(days);
    assert.ok(verdict.kind !== 'fresh', `day ${days} classified as fresh; it should have lapsed`);
    return verdict.message;
  };
  assert.match(messageAt(27), /deter|penalty/i);
  assert.match(messageAt(27), /newer release/);
  assert.match(messageAt(28), /withdrawn their stake|bonding duration/);
  assert.match(messageAt(28), /newer release/);
});

// --- the base TXID, observed from `location` (12 §1.2) ---------------------

test('the base TXID is observed from the URL path', () => {
  // 12 §1.2: "release.json records the asset-tree manifest and the app resolves its own
  // base TXID at runtime from `location`". It CANNOT be pinned — `M′` addresses a manifest
  // containing release.json, so writing it in changes the file and therefore changes `M′`.
  const path = resolveBaseTxid(`https://arweave.net/${ASSET_MANIFEST}/index.html`);
  assert.equal(path.kind, 'txid');
  assert.equal(path.txid, ASSET_MANIFEST);
  assert.equal(path.form, 'path');
});

test('a sandboxed subdomain is REFUSED, because a hostname cannot carry a TXID', () => {
  // The first draft of `resolveBaseTxid` read the first hostname label, and this test is
  // what caught it. DNS labels are case-insensitive and `new URL()` normalizes the host to
  // lowercase, so a case-sensitive base64url TXID does not survive a hostname: the function
  // returned a well-formed *wrong* address that fails every comparison it feeds — and would
  // have appeared to work for a coincidentally all-lowercase TXID, making it intermittent.
  //
  // Arweave sandboxes to a base32 subdomain for exactly this reason. Decoding that has a
  // verifiable answer and is real work; INV-FE-12 forbids guessing at an encoding, so this
  // refuses instead of approximating.
  const mixedCase = resolveBaseTxid(`https://${ASSET_MANIFEST}.arweave.net/index.html`);
  assert.equal(mixedCase.kind, 'not-content-addressed');

  // Proof the mechanism is case folding and not merely an unmatched pattern: the SAME
  // string lowercased still matches /^[A-Za-z0-9_-]{43}$/, so a label-reading version would
  // have accepted it here and returned an address that is not the release's.
  const lowered = ASSET_MANIFEST.toLowerCase();
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(lowered), true, 'the lowercased label is still TXID-shaped');
  assert.notEqual(lowered, ASSET_MANIFEST, 'the fixture must be mixed-case for this to prove anything');
  assert.equal(resolveBaseTxid(`https://${lowered}.arweave.net/`).kind, 'not-content-addressed');
});

test('a content-hashed asset filename is NOT read as the release address', () => {
  // The dangerous near-miss: chunk filenames are also 43-ish base64url strings, so a scan
  // for "a TXID anywhere in the path" would have the bundle report one of its own chunks
  // as its release address — a wrong answer that looks exactly like a right one.
  const verdict = resolveBaseTxid(`https://arweave.net/assets/${ASSET_MANIFEST}.js`);
  assert.equal(verdict.kind, 'not-content-addressed');
});

test('an ArNS name and a dev server are `not-content-addressed`, with a reason', () => {
  // An ArNS name DOES resolve to a transaction, but the page cannot see which one, and
  // guessing would produce the confident wrong answer this comparison exists to catch.
  // Typed absence rather than `undefined`, so the panel can say why rather than render a
  // blank release row — which reads as "this release has no address".
  for (const href of ['https://v1-2-3_futarchy.arweave.net/', 'http://localhost:5173/', 'not a url']) {
    const verdict = resolveBaseTxid(href);
    assert.equal(verdict.kind, 'not-content-addressed', href);
    assert.ok(verdict.kind === 'not-content-addressed');
    assert.ok(verdict.detail.length > 0, `${href} gave no reason`);
  }
  const arns = resolveBaseTxid('https://v1-2-3_futarchy.arweave.net/');
  assert.ok(arns.kind === 'not-content-addressed');
  assert.match(arns.detail, /ArNS/);
});

test('the panel renders the observed address beside the pinned one, and never as a warning', () => {
  // "the verification CLI checks both" — the pinned asset manifest and what was served.
  const served = resolveBaseTxid(`https://arweave.net/${'Z'.repeat(43)}/`);
  const panel = buildPanel(IDENTITY, undefined, undefined, served);
  const row = panelRow(panel.rows, 'Served from (Arweave TXID)');
  assert.equal(row.kind, 'observed');
  assert.equal(row.value, 'Z'.repeat(43));
  // The pinned row is a DIFFERENT row with a different address: conflating them would hide
  // exactly the substitution this pair exists to expose.
  const pinned = panelRow(panel.rows, 'Release assets (Arweave TXID)');
  assert.equal(pinned.kind, 'pinned');
  assert.notEqual(pinned.value, row.value);

  // Running off a dev server is not a divergence, so it must not become a warning.
  const local = buildPanel(IDENTITY, undefined, undefined, resolveBaseTxid('http://localhost:5173/'));
  assert.deepEqual(local.warnings, []);
  assert.equal(
    panelRow(local.rows, 'Served from (Arweave TXID)').value,
    'not a content address',
  );

  // And absent entirely when it was not resolved — no invented row.
  assert.equal(buildPanel(IDENTITY).rows.some((r) => r.label === 'Served from (Arweave TXID)'), false);
});
