/**
 * The `connect-src` allowlist and its no-growth gate — 12 §5.1, 15 §4.8 (F11).
 *
 * The rule this suite exists for is D-21's: a release MUST NOT add an external-tool vendor
 * host to the allowlist, and 12 §5.1 says why the rule is written down at all — "a vendor
 * host is exactly the kind of entry that arrives one release at a time". No checker can
 * tell a gateway from a vendor endpoint dressed as one, so the control is *visibility*:
 * an addition must be written into a second, committed file before the build accepts it.
 *
 * What is asserted here is therefore mostly about **refusals** — the shapes that would make
 * the allowlist wider than it reads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConnectSrcError,
  GATEWAY_FLOOR,
  OWN_ORIGIN,
  collectAllowlist,
  diffAgainstIncumbent,
  normaliseOrigin,
  originFromMultiaddr,
  readDeclaredSources,
  renderConnectSrc,
} from '../../tools/release/connect-src.ts';
import { assertNoAllowlistGrowth } from '../../tools/release/build.ts';

const HTTPS = ['https:'];

test('a WSS bootnode multiaddr projects to the origin a browser dials', () => {
  assert.equal(originFromMultiaddr('/dns4/boot-1.example/tcp/443/wss/p2p/12D3KooW'), 'wss://boot-1.example:443');
  assert.equal(originFromMultiaddr('/dns/boot-2.example/tcp/30334/wss/p2p/12D3KooW'), 'wss://boot-2.example:30334');
});

test('a non-WSS or non-DNS bootnode contributes nothing, rather than a guessed origin', () => {
  // 12 §6.2's commitment is browser-dialable WSS. A `/tcp/` peer is for native clients, and
  // an `/ip4/` peer cannot present a certificate a browser will accept — so neither belongs
  // in a policy that governs what the *browser* may connect to.
  assert.equal(originFromMultiaddr('/dns4/boot.example/tcp/30333/p2p/12D3KooW'), undefined);
  assert.equal(originFromMultiaddr('/ip4/10.0.0.1/tcp/443/wss/p2p/12D3KooW'), undefined);
});

test('a multiaddr the projection does not fully understand is refused, not skipped', () => {
  // Skipping would silently drop a bootnode the release meant to allow; guessing would
  // allow one it did not. Both are worse than failing the build.
  assert.throws(() => originFromMultiaddr('dns4/boot.example/tcp/443/wss'), ConnectSrcError);
  assert.throws(() => originFromMultiaddr('/dns4/boot.example/quic/443/wss'), ConnectSrcError);
  assert.throws(() => originFromMultiaddr('/dns4/boot.example/tcp/https/wss'), ConnectSrcError);
  assert.throws(() => originFromMultiaddr('/dns4/bad host!/tcp/443/wss/p2p/x'), ConnectSrcError);
});

test('a wildcard origin is refused — it is `connect-src *` scoped to a suffix', () => {
  assert.throws(() => normaliseOrigin('https://*.arweave.net', HTTPS), ConnectSrcError);
});

test('a percent-encoded wildcard is refused too, because URL parsing decodes the host', () => {
  // Found by adversarial review. `new URL('https://%2A.example').hostname` is `*.example`,
  // so a check on the raw string alone never sees it and the emitted policy carries a
  // wildcard nobody wrote. The host is therefore validated **after** parsing, against a
  // plain DNS alphabet — which closes the class rather than this one spelling.
  assert.throws(() => normaliseOrigin('https://%2A.example', HTTPS), ConnectSrcError);
  assert.throws(() => normaliseOrigin('https://foo%2A.example', HTTPS), ConnectSrcError);
  // A benign percent-encoding still normalises, so the rule is about the decoded host and
  // not about the presence of a `%`.
  assert.equal(normaliseOrigin('https://ex%41mple.com', HTTPS), 'https://example.com');
});

test('credentials, paths and queries are refused, because CSP matches on origin alone', () => {
  // A path in an allowlist entry reads as a restriction and enforces nothing: the browser
  // compares scheme, host and port. Shipping one would describe a narrower policy than the
  // one in force.
  assert.throws(() => normaliseOrigin('https://user:pw@gw.example', HTTPS), ConnectSrcError);
  assert.throws(() => normaliseOrigin('https://gw.example/only/this/path', HTTPS), ConnectSrcError);
  assert.throws(() => normaliseOrigin('https://gw.example/?token=x', HTTPS), ConnectSrcError);
});

test('the scheme is checked per class', () => {
  assert.equal(normaliseOrigin('https://gw.example/', HTTPS), 'https://gw.example');
  assert.equal(normaliseOrigin('https://gw.example:8443', HTTPS), 'https://gw.example:8443');
  assert.throws(() => normaliseOrigin('http://gw.example', HTTPS), ConnectSrcError);
  assert.throws(() => normaliseOrigin('wss://gw.example', HTTPS), ConnectSrcError);
});

test("the release's own origin is always present, with or without operator entries", () => {
  // Without `'self'` the bundle loads, renders, and cannot fetch `release.json` or the
  // bundled chain-spec bytes — so INV-FE-8's self-check and app-code rule 13's spec
  // verification both silently stop running. Both are `fetch`, so both are `connect-src`.
  assert.equal(renderConnectSrc([]), OWN_ORIGIN);
  assert.equal(renderConnectSrc([{ origin: 'wss://boot.example:443' }]), "'self' wss://boot.example:443");
  // Never an empty directive: that is a CSP syntax error whose recovery is a fall back to
  // `default-src`, which here is `'none'` — safe, but silently and totally.
  assert.notEqual(renderConnectSrc([]), '');
});

test('the BUILD refuses an addition, not merely the diff function that reports one', () => {
  // The distinction the review drew, and it is the difference between a gate and a report:
  // a test that only asserted `diffAgainstIncumbent` returns `['https://vendor.example']`
  // stays green with the `throw` deleted from the pipeline. `assertNoAllowlistGrowth` is the
  // call the build makes, so this exercises the enforcement itself.
  assert.throws(
    () => assertNoAllowlistGrowth([{ origin: 'https://vendor.example' }], []),
    /gained 1 entr.*D-21/s,
  );
  assert.doesNotThrow(() => assertNoAllowlistGrowth([], ['https://gw-b.example']));
});

test('the diff gate fails on an addition and passes a removal', () => {
  const emitted = [{ origin: 'https://gw-a.example' }, { origin: 'https://vendor.example' }];
  const diff = diffAgainstIncumbent(emitted, ['https://gw-a.example', 'https://gw-b.example']);
  assert.deepEqual(diff.additions, ['https://vendor.example']);
  // A release that can reach fewer hosts is a tightening. Failing it would push operators
  // toward leaving dead endpoints in the policy rather than removing them.
  assert.deepEqual(diff.removals, ['https://gw-b.example']);
});

test('an unchanged allowlist produces no additions', () => {
  const diff = diffAgainstIncumbent([{ origin: 'https://gw.example' }], ['https://gw.example']);
  assert.deepEqual(diff.additions, []);
  assert.deepEqual(diff.removals, []);
});

test('an absent section is refused; an empty one is the launch posture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-sources-'));
  const path = join(dir, 'sources.json');
  writeFileSync(
    path,
    JSON.stringify({
      connectSrc: { bootnodeManifests: [], chainSpecs: [], gateways: [], providers: [] },
    }),
  );
  // `rpcFallbacks` deleted rather than emptied. Defaulting it to `[]` would make a deletion
  // indistinguishable from 10 §8.1's deliberate opt-in-empty posture.
  assert.throws(() => readDeclaredSources(path), ConnectSrcError);
});

test('an empty bootnode program and an empty gateway list are named blockers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-boot-'));
  writeFileSync(join(dir, 'boot.json'), JSON.stringify({ operators: [] }));
  const { entries, blockers } = collectAllowlist(dir, {
    bootnodeManifests: ['boot.json'],
    chainSpecs: [],
    gateways: [],
    providers: [],
    rpcFallbacks: [],
  });
  assert.deepEqual(entries, []);
  assert.equal(blockers.length, 2, blockers.join('; '));
});

test('the gateway blocker binds 12 §5.1’s floor of three, not merely a non-empty list', () => {
  // Written because nothing here covered it. The check read `gateways.length === 0` until
  // SQ-994 was ruled on 2026-08-07, so **one** gateway satisfied it — and one gateway is a
  // release the §5.2 monitor cannot check, since that monitor resolves across >= 3
  // independent gateways. Changing the check broke no test, which is the tell.
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-gwfloor-'));
  const declare = (gateways: readonly string[]) =>
    collectAllowlist(dir, {
      bootnodeManifests: [],
      chainSpecs: [],
      gateways: [...gateways],
      providers: [],
      rpcFallbacks: [],
    }).blockers.filter((line) => line.includes('ar.io gateway'));

  const gw = (n: number) => Array.from({ length: n }, (_, i) => `https://gw${i}.example`);
  for (const short of [0, 1, GATEWAY_FLOOR - 1]) {
    assert.equal(declare(gw(short)).length, 1, `${short} gateway(s) must still block`);
  }
  assert.deepEqual(declare(gw(GATEWAY_FLOOR)), [], 'three independent gateways clear the floor');
  // The message states the floor rather than only the shortfall, because the operator reading
  // it has to know how many to seat, and membership is theirs to choose (12 §5.1).
  assert.match(declare(gw(1))[0], new RegExp(`floor of ${GATEWAY_FLOOR}`));
});

test('a declared chain spec that is not present is a blocker, not a silent omission', () => {
  // The bundle would ship with no relay bootnodes and fail to sync — a failure a user meets
  // rather than one CI does.
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-spec-'));
  const { blockers } = collectAllowlist(dir, {
    bootnodeManifests: [],
    chainSpecs: ['missing-relay.json'],
    gateways: ['https://gw.example'],
    providers: [],
    rpcFallbacks: [],
  });
  assert.ok(blockers.some((line) => line.includes('missing-relay.json')), blockers.join('; '));
});

test('entries are sorted and deduplicated across sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-dedupe-'));
  writeFileSync(
    join(dir, 'boot.json'),
    JSON.stringify({
      operators: [
        { name: 'alpha', multiaddrs: ['/dns4/z.example/tcp/443/wss/p2p/A'] },
        { name: 'beta', multiaddrs: ['/dns4/a.example/tcp/443/wss/p2p/B'] },
      ],
    }),
  );
  writeFileSync(join(dir, 'relay.json'), JSON.stringify({ bootNodes: ['/dns4/a.example/tcp/443/wss/p2p/C'] }));
  const { entries } = collectAllowlist(dir, {
    bootnodeManifests: ['boot.json'],
    chainSpecs: ['relay.json'],
    gateways: [],
    providers: [],
    rpcFallbacks: [],
  });
  assert.deepEqual(
    entries.map((entry) => entry.origin),
    ['wss://a.example:443', 'wss://z.example:443'],
  );
  // Two operators reaching the same origin is one policy entry with two provenances — the
  // policy is about hosts, and the provenance is what a reviewer needs to judge an addition.
  assert.equal(entries[0]?.provenance.length, 2);
});
