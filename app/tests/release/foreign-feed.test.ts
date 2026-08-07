/**
 * The Asset Hub descriptor set, as `release.json` publishes it — 12 §1.1, §1.6; D-12 (F11).
 *
 * 12 §1.1 requires the release document to record descriptor metadata hashes *"including
 * the Asset Hub descriptor set"*. It did not: the set was a hand-declared field in
 * `release-sources.json` that nobody had filled, behind a readiness blocker naming a
 * question that had already been ruled — so the artifacts sat committed in the tree while
 * the document published an empty map and the pipeline reported the gap as somebody else's
 * open decision.
 *
 * What this suite pins is therefore not "the field is populated" but the two properties that
 * make the population meaningful:
 *
 *  1. **It is measured, not copied.** The hash comes from `metadata.scale`, re-derived here
 *     independently. A reader that trusted `runtime-info.json`'s claim would pin that file's
 *     opinion of a blob rather than the blob, and a stale-but-well-formed header would
 *     produce a descriptor hash matching nothing — surfacing much later as a compat probe
 *     against a runtime the release never described.
 *  2. **Every way the feed can be wrong is a refusal, not a smaller answer.** A gate that
 *     skips what it does not understand reports a comfortable number, and here the number
 *     is what the funding leg's second light client is verified against.
 *
 * The empty case is asserted too, in the direction that matters: an unpinned Asset Hub must
 * still reach the readiness block as a *named* blocker. Emptiness is a state the rollout
 * genuinely has (08 §2.5 opens Paseo's Asset Hub at Phase 2 and Polkadot's at Phase 3), so
 * the reader is right not to throw — which makes the caller's blocker the only thing
 * standing between a silent omission and a release that ships the deposit leg blocked
 * without saying so.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAssetHub } from '../../tools/release/build.ts';
import { ReleaseJsonError, readForeignChainFeed } from '../../tools/release/release-json.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FEED = join(APP_ROOT, 'fixtures/foreign-chain-feed');
const CHAIN = 'asset-hub-paseo';
const SPEC_VERSION = '2004002';

/** A scratch feed, so a refusal can be provoked without editing a committed artifact. */
function scratchFeed(
  build: (root: string) => void,
): { root: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'bleavit-foreign-feed-'));
  build(root);
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** One well-formed chain directory, from which each test breaks exactly one thing. */
function writeChain(
  root: string,
  {
    chain = CHAIN,
    version = SPEC_VERSION,
    info = {},
    metadata = 'metadata bytes',
  }: {
    chain?: string;
    version?: string;
    info?: Record<string, unknown>;
    metadata?: string;
  } = {},
): void {
  const dir = join(root, chain, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.scale'), metadata);
  const measured = createHash('sha256').update(metadata).digest('hex');
  writeFileSync(
    join(dir, 'runtime-info.json'),
    JSON.stringify({
      schema: 'bleavit.foreign-runtime-info.v1',
      label: 'Asset Hub',
      relay: 'paseo',
      core_version: { spec_version: Number(version) },
      metadata: { sha256: `0x${measured}` },
      ...info,
    }),
  );
}

test('the shipped feed is the Asset Hub set the release document publishes', () => {
  const pins = readForeignChainFeed(FEED);

  // Re-derived here from the artifact, not read out of the record the reader also read.
  // Asserting the reader agrees with `runtime-info.json` would only prove it can copy.
  const measured = createHash('sha256')
    .update(readFileSync(join(FEED, CHAIN, SPEC_VERSION, 'metadata.scale')))
    .digest('hex');

  assert.deepEqual(pins.descriptorMetadataHashes, { [SPEC_VERSION]: measured });
  assert.equal(pins.network, 'paseo');
});

test('the hash is bare hex, as the Bleavit descriptor map is', () => {
  // The two maps sit side by side in `release.json` and `ReleaseIdentity` types its own as
  // `Sha256Hex` — bare. The feed writes `0x…`, so an encoding carried through unchanged
  // would give one document two spellings of one kind of value, and a consumer comparing
  // them would have to know which map needed stripping.
  const [hash] = Object.values(readForeignChainFeed(FEED).descriptorMetadataHashes);
  assert.match(hash ?? '', /^[0-9a-f]{64}$/);
});

test('a header whose hash disagrees with the blob is refused', () => {
  const { root, dispose } = scratchFeed((dir) => {
    writeChain(dir, { info: { metadata: { sha256: `0x${'0'.repeat(64)}` } } });
  });
  try {
    assert.throws(() => readForeignChainFeed(root), ReleaseJsonError);
  } finally {
    dispose();
  }
});

test('a directory name that disagrees with the runtime inside it is refused', () => {
  // It would hand out the wrong artifact while every internal check still passed: the
  // directory name is the selector a consumer resolves a `spec_version` through.
  const { root, dispose } = scratchFeed((dir) => {
    writeChain(dir, { version: '2004002', info: { core_version: { spec_version: 2004003 } } });
  });
  try {
    assert.throws(() => readForeignChainFeed(root), ReleaseJsonError);
  } finally {
    dispose();
  }
});

test('a foreign chain the release format has no slot for is refused, never relabelled', () => {
  const { root, dispose } = scratchFeed((dir) => {
    writeChain(dir, { chain: 'bridge-hub-paseo', info: { label: 'Bridge Hub' } });
  });
  try {
    assert.throws(() => readForeignChainFeed(root), ReleaseJsonError);
  } finally {
    dispose();
  }
});

test('two foreign chains are refused rather than resolved by directory order', () => {
  // A release pins the Asset Hub of the relay it targets. Choosing between two would be a
  // property of `readdir` order rather than of anything anyone decided.
  const { root, dispose } = scratchFeed((dir) => {
    writeChain(dir, { chain: 'asset-hub-paseo' });
    writeChain(dir, { chain: 'asset-hub-polkadot', info: { relay: 'polkadot' } });
  });
  try {
    assert.throws(() => readForeignChainFeed(root), ReleaseJsonError);
  } finally {
    dispose();
  }
});

test('an unpinned Asset Hub is empty in the reader and a NAMED blocker in the caller', () => {
  const { root, dispose } = scratchFeed(() => {
    // Deliberately empty: a release targeting a relay whose Asset Hub is unpinned is a
    // state the rollout has, so the reader must not throw.
  });
  try {
    assert.deepEqual(readForeignChainFeed(root), { network: null, descriptorMetadataHashes: {} });

    const { assetHub, blockers } = readAssetHub(root);
    assert.deepEqual(assetHub, { network: null, descriptorMetadataHashes: {} });
    assert.equal(blockers.length, 1, 'an unpinned Asset Hub must reach the readiness block');
    assert.match(blockers[0] ?? '', /Asset Hub descriptor set is unpinned/);
  } finally {
    dispose();
  }
});

test('a feed directory that does not exist is empty rather than a crash', () => {
  assert.deepEqual(readForeignChainFeed(join(APP_ROOT, 'fixtures/no-such-feed')), {
    network: null,
    descriptorMetadataHashes: {},
  });
});

test('the shipped feed clears the blocker — the anti-vacuity direction', () => {
  // Every refusal above stays green if the reader simply always returned empty. This is the
  // assertion that fails in that case, and it is the whole point of the change: 12 §1.1
  // requires the Asset Hub set in `release.json`, and it is there.
  const { assetHub, blockers } = readAssetHub(FEED);
  assert.deepEqual(blockers, []);
  assert.equal(Object.keys(assetHub.descriptorMetadataHashes).length, 1);
});
