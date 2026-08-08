/**
 * `verify-release compare`, driven as the command — 12 §1.2–§1.4, §2.1, §2.3; 02 §12 (F13).
 *
 * ## Why this file exists beside `compare.test.ts`
 *
 * That suite drives `compare.ts` through a helper that reproduces what the CLI does. It is a
 * good suite and it could not have caught any of the four defects below, because every one of
 * them lived in the caller: the manifest the command fetched from was never bound to the one
 * the release pins, the served tree was assembled so that an unexpected file could not appear
 * in it, two frozen `ReleaseChannel` fields were decoded as one, and the credentials were read
 * from a document shape this repository's producer does not emit. A test of a copy of the
 * caller agrees with the copy.
 *
 * So this one runs `main(argv)`. Its inputs are the fixture transcripts that serve the
 * document `tools/release/release-json.ts` really builds, and the local tree is a real
 * directory on disk — the two halves of §1.3's command line that the earlier suite supplied
 * as literals.
 *
 * ## The `ReleaseChannel` records are built here, from 02 §12's offsets
 *
 * Not read from a fixture. The layout is frozen forever and readers parse it by offset, so a
 * suite that wrote the offsets down is the only kind that can fail when a reader stops
 * honouring them — and the defect it caught was exactly a reader that took two adjacent
 * fields as one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchGatewayTree, fetchManifestPaths } from '../../tools/verify-release/compare.ts';
import { readTranscript, transcriptGateway } from '../../tools/verify-release/gateway.ts';
import { main } from '../../tools/verify-release/cli.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '..', 'fixtures', 'gateway-transcript');

const MANIFEST_TXID = 'M'.repeat(43);
const IMPOSTOR_MANIFEST_TXID = 'N'.repeat(43);
const RELEASE_JSON_TXID = 'R'.repeat(43);
const SIGNATURE_TXIDS = ['P1'.padEnd(43, 'e'), 'P2'.padEnd(43, 'f')];
const ATTESTATION_TXIDS = ['Q1'.padEnd(43, 'g'), 'Q2'.padEnd(43, 'h')];

const SCRATCH = mkdtempSync(join(tmpdir(), 'bleavit-verify-release-cli-'));
process.on('exit', () => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * A `ReleaseChannel` value at 02 §12's frozen layout — 168 bytes, fixed width, no prefixes.
 *
 * Only the two fields this command reads are filled. The offsets are written out because they
 * are the claim under test: `keyring_generation` is a `u32` at 152 and `revoked_key_bits` is a
 * `u64` at **156**, so a reader taking one `u64` at 152 gets `generation | (low32(mask) << 32)`
 * and is wrong about both.
 */
function releaseChannel(name: string, generation: number, revokedKeyBits: bigint): string {
  const bytes = Buffer.alloc(168);
  bytes[0] = 1; // schema
  bytes.writeUInt32LE(generation, 152);
  bytes.writeBigUInt64LE(revokedKeyBits, 156);
  const path = join(SCRATCH, name);
  writeFileSync(path, bytes);
  return path;
}

interface Run {
  readonly code: number | undefined;
  readonly thrown: Error | undefined;
  readonly out: string;
  readonly err: string;
}

/** Run the command and capture everything it said, including what it refused with. */
async function run(argv: readonly string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]): void => void out.push(args.map((arg) => String(arg)).join(' '));
  console.error = (...args: unknown[]): void => void err.push(args.map((arg) => String(arg)).join(' '));
  try {
    const code = await main(argv);
    return { code, thrown: undefined, out: out.join('\n'), err: err.join('\n') };
  } catch (caught) {
    const thrown = caught instanceof Error ? caught : new Error(String(caught));
    return { code: undefined, thrown, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** §1.3's command, with the credentials §1.4 gate 4 publishes in the release notes. */
function compareArgv(over: {
  readonly transcript?: string;
  readonly arweave?: string;
  readonly channel?: string;
  readonly registry?: string;
  readonly credentials?: boolean;
} = {}): string[] {
  return [
    'compare',
    '--local',
    join(FIXTURES, 'cli-local-tree'),
    '--arweave',
    over.arweave ?? MANIFEST_TXID,
    '--release-json',
    RELEASE_JSON_TXID,
    '--transcript',
    join(FIXTURES, over.transcript ?? 'cli-honest.json'),
    '--keyring',
    join(FIXTURES, 'keyring.json'),
    '--registry',
    over.registry ?? join(FIXTURES, 'registry.json'),
    ...(over.channel === undefined ? [] : ['--release-channel', over.channel]),
    ...(over.credentials === false
      ? []
      : [
          ...SIGNATURE_TXIDS.flatMap((txid) => ['--signature', txid]),
          ...ATTESTATION_TXIDS.flatMap((txid) => ['--attestation', txid]),
        ]),
  ];
}

test('the document the producer really builds names no credentials at all', () => {
  // The premise of the next test, asserted rather than assumed. `buildReleaseJson` emits
  // `signingKeyIds` and `keyringGeneration`; the arrays `compare` used to read for its
  // signature and attestation transactions exist only in a hand-written fixture, so counting
  // them was counting a shape no release has.
  const document: unknown = JSON.parse(readFileSync(join(FIXTURES, 'cli-release.json'), 'utf8'));
  const record = document as Record<string, unknown>;
  assert.equal(record['release_signatures'], undefined);
  assert.equal(record['attestations'], undefined);
  assert.deepEqual(record['signingKeyIds'], ['1111111111111111', '2222222222222222']);
  assert.equal(record['keyringGeneration'], 4);
});

test('a producer-built release verifies once its published credentials are named', async () => {
  const result = await run(
    compareArgv({ channel: releaseChannel('clean.bin', 4, 0n) }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.match(result.out, /signatures: 2 distinct active key\(s\); attestations: 2 organization\(s\)/);
  assert.match(result.out, /VERDICT: MATCH$/m);
  assert.equal(result.code, 0);
});

test('naming no credentials refuses, and says it is for want of inputs', async () => {
  // The same release, the same bytes, nothing named. It must still refuse — the floors are
  // counted over zero — but "you named none" and "this release published none" are different
  // facts and only one of them is about the release.
  const result = await run(
    compareArgv({ channel: releaseChannel('clean-none.bin', 4, 0n), credentials: false }),
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /signatures: 0 distinct active key\(s\)/);
  assert.match(result.err, /NONE NAMED {2}no release_signatures were named/);
  assert.match(result.err, /NONE NAMED {2}no attestations were named/);
  assert.match(result.err, /12 §1\.4 gate 4/);
});

test('a healthy channel revokes nobody, whatever its generation number is', async () => {
  // 02 §12: `keyring_generation` u32 at 152, `revoked_key_bits` u64 at 156. Read as one u64 at
  // 152 the generation becomes the low half of the mask, so generation 4 sets bit 2 — and the
  // fixture's key at revocation index 2 is an attestor, which drops the release below §1.4
  // gate 2 while the chain revoked nobody at all.
  const result = await run(compareArgv({ channel: releaseChannel('generation-4.bin', 4, 0n) }));
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.match(result.out, /attestations: 2 organization\(s\)/);
  assert.equal(result.code, 0);
});

test('the revocation mask is read at 156, so a revoked signer is the one that stops counting', async () => {
  // Bit 1 is the fixture's second release signer. Read at the wrong offset this mask lands in
  // the high half of a u64 whose low half is the generation, which names bits no declared key
  // claims — a refusal about the registry rather than a verdict about a compromised key.
  const result = await run(compareArgv({ channel: releaseChannel('signer-1.bin', 4, 1n << 1n) }));
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.match(result.out, /signatures: 1 distinct active key\(s\)/);
  assert.match(result.err, /marked revoked/);
  assert.equal(result.code, 1);
});

test('a revocation above index 31 survives, because the mask is a u64 and not its low half', async () => {
  // The other half of the same defect: a u64 read at 152 keeps only the mask's low four bytes,
  // so every bit from 32 up is discarded and a revoked key goes on counting. The registry here
  // is the fixture's, with one signer moved to index 33 — a legal index, 02 §12 gives the mask
  // 64 of them.
  const registry: unknown = JSON.parse(readFileSync(join(FIXTURES, 'registry.json'), 'utf8'));
  const document = registry as { entries: Record<string, unknown>[] };
  const moved = {
    ...document,
    entries: document.entries.map((entry) =>
      entry['revocationIndex'] === 1 ? { ...entry, revocationIndex: 33 } : entry,
    ),
  };
  const path = join(SCRATCH, 'registry-high-index.json');
  writeFileSync(path, `${JSON.stringify(moved, null, 2)}\n`, 'utf8');

  const result = await run(
    compareArgv({ channel: releaseChannel('signer-33.bin', 4, 1n << 33n), registry: path }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.match(result.out, /signatures: 1 distinct active key\(s\)/);
  assert.match(result.err, /marked revoked/);
  assert.equal(result.code, 1);
});

test('a channel of another generation is refused rather than counted against this one', async () => {
  // §2.3 point 1 bumps the generation and sets the bit in one write. Two documents disagreeing
  // means the bitmask indexes a keyring nobody published for this release.
  const result = await run(compareArgv({ channel: releaseChannel('generation-5.bin', 5, 0n) }));
  assert.equal(
    result.code,
    undefined,
    `expected a refusal; the command exited ${String(result.code)} saying: ${result.out}`,
  );
  assert.match(String(result.thrown?.message), /keyring generation 5 and the served release\.json names 4/);
});

test('a manifest the release does not pin is refused, however well its bytes match', async () => {
  // The impostor serves the signed tree exactly: every path present, every byte right. The
  // only thing wrong with it is that `release.json` pins another address — which is the whole
  // of what 12 §1.2 means by the CLI checking both.
  const result = await run(
    compareArgv({ arweave: IMPOSTOR_MANIFEST_TXID, channel: releaseChannel('clean-impostor.bin', 4, 0n) }),
  );
  assert.equal(
    result.code,
    undefined,
    `expected a refusal; the command exited ${String(result.code)} saying: ${result.out}`,
  );
  assert.match(String(result.thrown?.message), /--arweave names the manifest N{43}/);
  assert.match(String(result.thrown?.message), /pins M{43}/);
  assert.match(String(result.thrown?.message), /never authorized/);
});

test('12 §1.3’s published command runs — the ar:// scheme is accepted, not interpolated', async () => {
  // §1.3 prints the verification command with the scheme:
  //
  //     ./tools/verify-release compare --local dist/ --arweave <manifest-txid> \
  //         --release-json ar://<release-json-txid> --require-attestations 2
  //
  // and the value went into the gateway URL verbatim, so the spec's own copy-pasted line
  // requested `ar%3A//<txid>`. A verifier following the published instructions saw what looked
  // like a missing transaction rather than a malformed request — the worst shape for a command
  // whose entire job is telling someone whether to trust the bytes they are about to run.
  const withScheme = compareArgv({ channel: releaseChannel('clean.bin', 4, 0n) }).map(
    (arg, index, all) => {
      const flag = all[index - 1];
      return flag === '--arweave' || flag === '--release-json' ? `ar://${arg}` : arg;
    },
  );
  const result = await run(withScheme);
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.match(result.out, /VERDICT: MATCH$/m);
  assert.equal(result.code, 0);
});

test('stripping the scheme does not stop a malformed id being refused', async () => {
  // Anti-vacuity for the test above: `bareTxid` removes a prefix and nothing else, so the
  // 43-character shape check must still run on what is left. A normaliser that quietly
  // accepted anything would make the pair above pass for the wrong reason.
  const result = await run(compareArgv({ arweave: 'ar://not-a-real-transaction-id' }));
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /--arweave is not a 43-character base64url/);
});

test('a gateway serving a file nobody signed is reported, not passed over', async () => {
  // Nothing the release pins is missing or altered on `beta`; it serves one extra payload and
  // lists it in its own copy of the manifest. A fetch loop driven by the signed map cannot
  // see this, because every path it asks for is a path the release signed.
  const result = await run(
    compareArgv({
      transcript: 'cli-extra-payload.json',
      channel: releaseChannel('clean-extra.bin', 4, 0n),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 1, `expected MISMATCH; the command exited ${String(result.code)} saying: ${result.out}`);
  assert.match(result.err, /beta {2}unexpected assets\/tracker\.js/);
  assert.match(result.out, /VERDICT: MISMATCH/);
  // Nothing signed was touched, which is exactly why this had to be its own finding.
  assert.doesNotMatch(result.err, /changed|missing/);
});

test('fetchManifestPaths reads what a gateway lists, and names it when it cannot', async () => {
  const transcript = readTranscript(join(FIXTURES, 'cli-honest.json'));
  const get = transcriptGateway(transcript);
  const alpha = transcript.gateways[0];
  assert.ok(alpha !== undefined);
  const listed = await fetchManifestPaths(get, alpha, MANIFEST_TXID);
  assert.deepEqual([...listed.paths], ['assets/app.js', 'assets/logo.png', 'index.html']);
  assert.equal(listed.failure, undefined);

  // An unreadable manifest yields no paths **and** a failure. Returning an empty list alone
  // would silently restore the behaviour this replaced: a gateway nobody could enumerate,
  // reported as a gateway with nothing extra on it.
  const absent = await fetchManifestPaths(get, alpha, 'Z'.repeat(43));
  assert.deepEqual([...absent.paths], []);
  assert.match(String(absent.failure), /would not serve the path manifest/);
});

test('fetchGatewayTree carries an unreadable manifest into the verdict as a failure', async () => {
  const transcript = readTranscript(join(FIXTURES, 'cli-honest.json'));
  const get = transcriptGateway(transcript);
  const alpha = transcript.gateways[0];
  assert.ok(alpha !== undefined);
  const tree = await fetchGatewayTree(get, alpha, 'Z'.repeat(43), ['index.html']);
  assert.equal(tree.gateway, 'alpha');
  assert.ok(tree.failures.some((line) => line.includes('would not serve the path manifest')));
});

test('the usage text names the credential flags, because nothing else does', async () => {
  // §1.3's published command line is the whole interface a stranger has. A flag that must be
  // passed for the tool to reach a verdict and appears in no usage text is a flag nobody
  // passes, and the tool then refuses every release for want of inputs.
  const result = await run(['help']);
  assert.equal(result.code, 64);
  assert.match(result.err, /--signature <txid>/);
  assert.match(result.err, /--attestation <txid>/);
  assert.match(result.err, /12 §1\.4 gate 4/);
});
