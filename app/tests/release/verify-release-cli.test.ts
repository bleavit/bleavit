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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Gateway, ServedTree } from '../../tools/verify-release/compare.ts';
import {
  GATEWAY_FLOOR,
  crossGatewayFindings,
  fetchGatewayTree,
  fetchManifestPaths,
} from '../../tools/verify-release/compare.ts';
import {
  TranscriptError,
  parseTranscript,
  readTranscript,
  transcriptGateway,
} from '../../tools/verify-release/gateway.ts';
import { main, readGatewayConfig } from '../../tools/verify-release/cli.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '..', 'fixtures', 'gateway-transcript');

const MANIFEST_TXID = 'M'.repeat(43);
const IMPOSTOR_MANIFEST_TXID = 'N'.repeat(43);
const FINAL_MANIFEST_TXID = 'F'.repeat(43);
/** 12 §1.5's `--against` — the incumbent release's immutable address. */
const INCUMBENT_MANIFEST_TXID = 'I'.repeat(43);
const SUBSTITUTE_RELEASE_JSON_TXID = 'X'.repeat(43);
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
  readonly finalManifest?: string | false;
  readonly channel?: string;
  readonly registry?: string;
  readonly keyring?: boolean;
  readonly credentials?: boolean;
} = {}): string[] {
  return [
    'compare',
    '--local',
    join(FIXTURES, 'cli-local-tree'),
    '--arweave',
    over.arweave ?? MANIFEST_TXID,
    ...(over.finalManifest === false
      ? []
      : ['--final-manifest', over.finalManifest ?? FINAL_MANIFEST_TXID]),
    '--release-json',
    RELEASE_JSON_TXID,
    '--transcript',
    join(FIXTURES, over.transcript ?? 'cli-honest.json'),
    ...(over.keyring === false ? [] : ['--keyring', join(FIXTURES, 'keyring.json')]),
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

// ---------------------------------------------------------------------------------------
// The second address — 12 §1.2's `M′`.
//
// `release.json` pins `M`, the ArNS name is repointed to `M′`, and §1.2 says the verification
// CLI checks **both**. Binding `--arweave` to the pin (the test above) is one of the two: it
// makes a manifest the release never authorized unusable. It says nothing at all about the
// manifest users actually load, which is the one that can serve a payload while the pinned
// address stays impeccable.
//
// Every transcript below serves the signed bytes at every path of `M`, so a verifier that
// stops at the pinned address prints MATCH for each of them.
// ---------------------------------------------------------------------------------------

test('a payload under the repointed manifest is caught, though the pinned one is honest', async () => {
  // The whole of the release is right at `M`. `M′` — what the name resolves to, what a user
  // loads — serves application code nobody signed. This is the case a pinned-address-only
  // check cannot reach, because every path it asks for it asks of the honest manifest.
  const result = await run(
    compareArgv({
      transcript: 'cli-final-poisoned.json',
      channel: releaseChannel('clean-final-poisoned.bin', 4, 0n),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(
    result.code,
    1,
    `expected MISMATCH; the command exited ${String(result.code)} saying: ${result.out}`,
  );
  assert.match(result.err, /final manifest {2}changed assets\/app\.js/);
  assert.match(result.out, /VERDICT: MISMATCH/);
});

test('the repointed manifest must resolve release.json to the signed sibling, not to equal bytes', async () => {
  // `M′` lists `release.json` and hands over the signed document's exact bytes — from another
  // transaction. `arweave.ts` names why the address is the binding: two objects with the same
  // bytes today have no guarantee of it tomorrow, and a byte comparison cannot see the
  // difference at all.
  const result = await run(
    compareArgv({
      transcript: 'cli-final-substituted.json',
      channel: releaseChannel('clean-final-substituted.bin', 4, 0n),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(
    result.code,
    1,
    `expected MISMATCH; the command exited ${String(result.code)} saying: ${result.out}`,
  );
  assert.match(result.err, new RegExp(`resolves release\\.json to ${SUBSTITUTE_RELEASE_JSON_TXID}`));
  assert.match(result.err, new RegExp(`signatures verified here are over ${RELEASE_JSON_TXID}`));
  assert.match(result.out, /VERDICT: MISMATCH/);
});

test('a repointed manifest with no release.json in it is reported', async () => {
  // 12 §1.2's second pass exists to put `release.json` inside the manifest the name serves.
  // A manifest without it leaves the release naming a manifest that does not contain it —
  // the exact failure `twoPassDeploy` refuses to produce, seen from the verifying end.
  const result = await run(
    compareArgv({
      transcript: 'cli-final-omits-release-json.json',
      channel: releaseChannel('clean-final-omits.bin', 4, 0n),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(
    result.code,
    1,
    `expected MISMATCH; the command exited ${String(result.code)} saying: ${result.out}`,
  );
  assert.match(result.err, /lists no release\.json/);
  assert.match(result.out, /VERDICT: MISMATCH/);
});

test('naming one address twice does not satisfy the two-address check', async () => {
  // The cheapest way to defeat a second-address check is to pass the first one again. 12 §1.2
  // states the arithmetic that forbids it: the final manifest references one more transaction,
  // so `M′ = M` means `release.json` is not in it.
  const result = await run(compareArgv({ finalManifest: MANIFEST_TXID }));
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /--arweave and --final-manifest name the same manifest/);
  assert.match(String(result.thrown?.message), /12 §1\.2/);
});

test('the final manifest address is required, because a check that can be omitted is not one', async () => {
  const result = await run(compareArgv({ finalManifest: false }));
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /--final-manifest <final-manifest-txid>/);
});

test('a final manifest nobody serves is a failure, not a leg quietly skipped', async () => {
  // The anti-vacuity control for every test above: they show the second address being *judged*,
  // and this one shows it being *fetched*. A checker wired to an address the transcript never
  // recorded must report that it could not look, because "not served" and "served correctly"
  // are the two answers a skipped leg is indistinguishable between.
  const result = await run(
    compareArgv({
      finalManifest: 'Z'.repeat(43),
      channel: releaseChannel('clean-final-absent.bin', 4, 0n),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 1, `expected MISMATCH; the command exited ${String(result.code)}`);
  assert.match(result.err, /did not answer for the final manifest Z{43}/);
  assert.match(result.err, /second address was not checked at all/);
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
  const { tree, manifest } = await fetchGatewayTree(get, alpha, 'Z'.repeat(43), ['index.html']);
  assert.equal(tree.gateway, 'alpha');
  assert.ok(tree.failures.some((line) => line.includes('would not serve the path manifest')));
  // The enumeration comes back too, because 12 §1.2 has two manifests and the caller must
  // compare them. Fetching it twice would let the two readings disagree.
  assert.match(String(manifest.failure), /would not serve the path manifest/);
});

// ---------------------------------------------------------------------------------------
// What §1.3's published command can and cannot default — 12 §1.3, §1.4 gate 4, §2.1.
//
// §1.3 promises a verdict reproducible "with no project infrastructure". That is a promise
// about *private* infrastructure: every input it needs is published, and the tool's job is to
// default the ones with a fixed home and to name the ones that arrive per release.
// ---------------------------------------------------------------------------------------

test('the published keyring has an in-repo home, so its absence is one named line', async () => {
  // 12 §2.1: "Keyring published in-repo, in-app, and on Arweave." So `--keyring` has a
  // default, exactly as `--registry` does, and pre-ceremony that default is empty — which
  // must read as *nobody has published a key yet*, not as one rejection per signature.
  const result = await run(
    compareArgv({ keyring: false, channel: releaseChannel('clean-no-keyring.bin', 4, 0n) }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 1, `expected MISMATCH; the command exited ${String(result.code)}`);
  assert.match(result.err, /NO KEYRING {2}/);
  assert.match(result.err, /12 §2\.1/);
  // Refused by counting, which is the arithmetic and not a declaration.
  assert.match(result.out, /signatures: 0 distinct active key\(s\)/);
});

test('a live run takes its gateway set from the release notes, and the refusal says where', async () => {
  // §1.3's published command supplies neither `--transcript` nor `--gateways`, so it is
  // rejected before any request is made. The set is not this repository's to default —
  // §1.4 gate 4 publishes it per release and 12 §5.1 makes naming operators the operator's
  // decision — so the refusal has to carry both the source and the shape, or a verifier who
  // followed the published line is left with an error about a flag nobody told them to pass.
  const argv = compareArgv().filter(
    (token, index, all) => token !== '--transcript' && all[index - 1] !== '--transcript',
  );
  const result = await run(argv);
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /12 §1\.4 gate 4/);
  assert.match(String(result.thrown?.message), /--gateways/);
  assert.match(String(result.thrown?.message), /"rawUrl"/);
});

// ---------------------------------------------------------------------------------------
// 12 §1.5's expedited lane — `verify-release diff-scope --against <incumbent-txid>`.
//
// §1.5 publishes that command and calls the check **mechanical**: it is what stands between a
// release and a lane with **no staging soak**. It could not run at all. The parser took two
// positional file names, so the published line read `--against` as a local incumbent file and
// the transaction id as a local candidate file, then failed opening `--against`.
//
// Every test below drives `main(argv)` for the reason the header of this file gives: the defect
// lived in the caller, and a suite over `diffScope` — which this repository has, and which is
// green — agrees with a caller it never runs.
//
// ## The candidate trees carry the names 12 §1.1 emits, and until this round they did not
//
// The fixture incumbent carried `assets/descriptors/bleavit.js` and `EXPEDITED_SCOPE`
// allowlisted that prefix, so these tests asserted that a descriptor-only delta is *admitted* —
// against a build that emits no such path. The build names every chunk by its content alone,
// so a descriptor refresh **renames** its chunk, then the entry chunk importing it, then
// `index.html`; nothing confines that to a prefix, so the lane is unavailable and the refusal
// is what has to be asserted. See `EXPEDITED_SCOPE`'s comment for the whole argument.
// ---------------------------------------------------------------------------------------

/** §1.5's command: the incumbent by transaction id, the candidate as the tree you built. */
function diffScopeArgv(
  over: {
    readonly against?: string;
    readonly local?: string;
    readonly transcript?: string | false;
  } = {},
): string[] {
  return [
    'diff-scope',
    '--against',
    over.against ?? INCUMBENT_MANIFEST_TXID,
    '--local',
    over.local ?? join(FIXTURES, 'diff-scope-descriptor-tree'),
    ...(over.transcript === false
      ? []
      : ['--transcript', join(FIXTURES, over.transcript ?? 'cli-incumbent.json')]),
  ];
}

test('12 §1.5’s published diff-scope command runs, and refuses a descriptor refresh', async () => {
  const result = await run(diffScopeArgv());
  assert.equal(result.thrown, undefined, result.thrown?.message);
  // The incumbent is fetched, not read off disk: `--against` is a transaction id.
  assert.match(result.out, new RegExp(`incumbent ${INCUMBENT_MANIFEST_TXID}: 5 signed file\\(s\\)`));
  assert.match(result.out, /corroborated by 2 gateway\(s\) \(alpha, beta\)/);

  // The candidate is a descriptor-only refresh with nothing else touched, and the delta is
  // still every chunk plus `index.html` — which is the whole reason the lane cannot run.
  assert.equal(result.code, 1, `expected inadmissible; the command exited ${String(result.code)}`);
  assert.match(result.err, /removed: assets\/4b9d7e05\.js/);
  assert.match(result.err, /added: assets\/d05e3f78\.js/);
  assert.match(result.err, /changed: index\.html/);
  assert.match(result.out, /content-hash rename/);
  assert.match(result.out, /indistinguishable from an app-code delta/);
  assert.match(result.out, /expedited lane\s+is therefore unavailable/);
  assert.match(result.out, /must use the standard lane with its 72 h soak/);
});

test('a release-metadata-only delta is admitted, so the refusal above is not vacuous', async () => {
  // The half of §1.5 that survives 12 §1.1: a changelog and a release history keep fixed names,
  // so a delta confined to them is expressible in the built tree. Without this arm the command
  // could refuse everything and pass a suite made only of refusals.
  const result = await run(diffScopeArgv({ local: join(FIXTURES, 'diff-scope-metadata-tree') }));
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 0, `expected admissible; the command exited ${String(result.code)}`);
  assert.match(result.out, /confined to the release-metadata files 12 §1\.5 admits/);
  assert.match(result.out, /no published app asset moved/);
  assert.equal(result.err.trim(), '');
});

test('a delta that edits a fixed-name file is refused in the other words', async () => {
  // The same descriptor refresh with application code carried along in `sw.js`, which keeps its
  // name because a browser resolves it by URL. Its delta therefore arrives as `changed`, which a
  // content hash cannot produce — so the structural sentence must not be the one printed here.
  const result = await run(diffScopeArgv({ local: join(FIXTURES, 'diff-scope-app-code-tree') }));
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 1, `expected inadmissible; the command exited ${String(result.code)}`);
  assert.match(result.err, /changed: sw\.js/);
  assert.doesNotMatch(result.out, /content-hash rename/);
  assert.match(result.out, /§1\.5 requires zero app-code delta/);
  assert.match(result.out, /must use the standard lane with its 72 h soak/);
});

test('one gateway lying about the incumbent cannot admit a release to the lane', async () => {
  // `beta` serves an incumbent document whose per-file map is the *candidate's own*, so a
  // verifier that took the first answer — or that happened to ask beta — would measure the
  // candidate against itself, find zero out-of-scope files and admit it to the lane that skips
  // the soak. This is the whole reason the document is fetched through every gateway.
  const result = await run(
    diffScopeArgv({
      local: join(FIXTURES, 'diff-scope-app-code-tree'),
      transcript: 'cli-incumbent-divergent.json',
    }),
  );
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /gateways disagree about the incumbent release document/);
  assert.match(String(result.thrown?.message), /alpha=/);
  assert.match(String(result.thrown?.message), /beta=/);
  assert.match(String(result.thrown?.message), /72 h soak/);
});

test('--against names the immutable address, and the asset manifest is refused as one', async () => {
  // 12 §1.2 produces two addresses and only `M′` contains `release.json`. Passing `M` — the one
  // `release.json` pins, and the one a reader of §1.2 might reach for first — must say which
  // address was wanted rather than report a gateway that would not answer.
  const result = await run(diffScopeArgv({ against: MANIFEST_TXID, transcript: 'cli-honest.json' }));
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /no configured gateway served release\.json/);
  assert.match(String(result.thrown?.message), /immutable\*\* address/);
  assert.match(String(result.thrown?.message), /asset manifest that release\.json pins does not contain it/);
});

test('the ar:// scheme is accepted here too, because §1.3 accepts it', async () => {
  // One tool, one reading of a transaction id. A scheme that works on `--release-json` and not
  // on `--against` is the same defect the scheme fix closed, moved one flag over. Driven over
  // the admissible tree, so a stripped scheme has to reach a verdict rather than merely reach
  // the same refusal every other input reaches.
  const result = await run(
    diffScopeArgv({
      against: `ar://${INCUMBENT_MANIFEST_TXID}`,
      local: join(FIXTURES, 'diff-scope-metadata-tree'),
    }),
  );
  assert.equal(result.thrown, undefined, result.thrown?.message);
  assert.equal(result.code, 0);
});

test('an incumbent document pinning no files is refused, never compared as {}', async () => {
  // `{}` against `{}` yields zero out-of-scope files, so `diff-scope` would print "the delta is
  // confined to the scope 12 §1.5 admits" and exit 0 having compared nothing — a false pass on
  // the gate that decides whether a release may skip the soak.
  const transcript: unknown = JSON.parse(readFileSync(join(FIXTURES, 'cli-incumbent.json'), 'utf8'));
  const document = transcript as { responses: Record<string, { body_utf8: string }> };
  const emptied = {
    ...document,
    responses: Object.fromEntries(
      Object.entries(document.responses).map(([url, response]) => {
        const body: unknown = JSON.parse(response.body_utf8);
        return [url, { ...response, body_utf8: JSON.stringify({ ...(body as object), perFileHashes: {} }) }];
      }),
    ),
  };
  const path = join(SCRATCH, 'incumbent-no-pins.json');
  writeFileSync(path, `${JSON.stringify(emptied, null, 2)}\n`, 'utf8');

  const result = await run([...diffScopeArgv({ transcript: false }), '--transcript', path]);
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /cannot be compared/);
  assert.match(String(result.thrown?.message), /pins no file hashes/);
});

test('a --local pointed at an empty directory says so, rather than reporting a deleted tree', async () => {
  const empty = join(SCRATCH, 'empty-candidate');
  mkdirSync(empty, { recursive: true });
  const result = await run(diffScopeArgv({ local: empty }));
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /contains no files, so there is no built tree to compare/);
});

test('diff-scope names both of its inputs when either is missing', async () => {
  const noLocal = await run(['diff-scope', '--against', INCUMBENT_MANIFEST_TXID]);
  assert.equal(noLocal.code, undefined, `expected a refusal; got exit ${String(noLocal.code)}`);
  assert.match(String(noLocal.thrown?.message), /--against <incumbent-manifest-txid> and --local <dir>/);

  // And the gateway set, which §1.5's published line does not name either — the same omission
  // §1.3's line carried until contract-round three, refused here in the same words.
  const noGateways = await run(diffScopeArgv({ transcript: false }));
  assert.equal(noGateways.code, undefined, `expected a refusal; got exit ${String(noGateways.code)}`);
  assert.match(String(noGateways.thrown?.message), /diff-scope needs exactly one of --transcript/);
  assert.match(String(noGateways.thrown?.message), /12 §1\.4 gate 4/);
});

// ---------------------------------------------------------------------------------------
// One operator is not two gateways — 12 §1.3.
//
// §1.3 verifies through at least two gateways, and `crossGatewayFindings` is what that floor
// buys: a gateway serving wrong bytes is caught by the signed map, and a *pair* that disagree
// names which one to stop using. Both halves die if one operator is listed twice — the floor is
// met by one response and the divergence check compares that response with itself.
//
// Measured before the rule existed: one loopback server listed under two names answered all 23
// requests of a full run, and the command printed `VERDICT: MATCH` at exit 0.
// ---------------------------------------------------------------------------------------

/** Write a `--gateways` configuration and hand back its path. */
function gatewayConfig(name: string, gateways: readonly Partial<Gateway>[]): string {
  const path = join(SCRATCH, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ gateways }, null, 2)}\n`, 'utf8');
  return path;
}

const alpha: Gateway = {
  name: 'alpha',
  rawUrl: 'https://alpha.example/raw/{txid}',
  txUrl: 'https://alpha.example/{txid}/{path}',
};
const beta: Gateway = {
  name: 'beta',
  rawUrl: 'https://beta.example/raw/{txid}',
  txUrl: 'https://beta.example/{txid}/{path}',
};

test('the floor a duplicate would satisfy is live, so refusing one is worth something', () => {
  // The anti-vacuity control for everything below. `crossGatewayFindings` reports the shortfall
  // at one gateway and reports nothing at two — which is exactly why two rows naming one
  // operator was a silent pass rather than a visible one.
  const tree = (gateway: string): ServedTree => ({ gateway, hashes: { 'index.html': 'aa' }, failures: [] });
  assert.match(
    crossGatewayFindings([tree('alpha')]).join('\n'),
    new RegExp(`1 gateway\\(s\\) answered; 12 §1\\.3 verifies through at least ${String(GATEWAY_FLOOR)}`),
  );
  assert.deepEqual(crossGatewayFindings([tree('alpha'), tree('beta')]), []);
});

test('a config of two genuinely distinct operators is accepted', () => {
  // Stated first, because a rule that rejects a legitimate set gets loosened rather than fixed.
  assert.deepEqual([...readGatewayConfig(gatewayConfig('two-operators', [alpha, beta]))], [alpha, beta]);
});

test('one endpoint under two names is refused, however it is spelled', () => {
  // The case that motivated the rule: a host name is case-insensitive, a trailing slash is in
  // the path, and neither makes a second operator.
  const path = gatewayConfig('one-endpoint-two-names', [
    alpha,
    { name: 'beta', rawUrl: 'https://ALPHA.example/raw/{txid}/', txUrl: 'https://ALPHA.example/{txid}/{path}/' },
  ]);
  assert.throws(() => readGatewayConfig(path), /both answer at alpha\.example/);
  assert.throws(() => readGatewayConfig(path), /divergence check — whose whole purpose is catching a lying gateway/);
});

test('one operator name under two rows is refused, whatever the hosts are', () => {
  // The other direction. Two real endpoints are still one operator's word, and §1.4 gate 2's
  // whole vocabulary — independent, different organizations — is about who answers.
  const path = gatewayConfig('one-name-two-rows', [alpha, { ...beta, name: ' Alpha ' }]);
  assert.throws(() => readGatewayConfig(path), /name one operator/);
});

test('the sandboxed {txid} host form is the same operator as its raw host', () => {
  // `https://{txid}.g/{path}` is what an ar.io gateway serves beside `https://g/raw/{txid}`.
  // The leading label is a transaction id rather than an identity, so leaving it in would let
  // one operator reach the floor with two of its own spellings.
  const path = gatewayConfig('sandboxed', [
    { name: 'alpha', rawUrl: 'https://alpha.example/raw/{txid}', txUrl: 'https://{txid}.alpha.example/{path}' },
    { name: 'gamma', rawUrl: 'https://{txid}.alpha.example/', txUrl: 'https://alpha.example/{txid}/{path}' },
  ]);
  assert.throws(() => readGatewayConfig(path), /both answer at alpha\.example/);
});

test('a host shared crosswise between two rows is still one operator', () => {
  // Row A's tx endpoint is row B's raw endpoint. Both templates are fetched from, so a rule
  // that compared only like with like would leave this open.
  const path = gatewayConfig('crosswise', [
    alpha,
    { name: 'beta', rawUrl: 'https://alpha.example/raw/{txid}', txUrl: 'https://beta.example/{txid}/{path}' },
  ]);
  assert.throws(() => readGatewayConfig(path), /both answer at alpha\.example/);
});

test('a template that names no operator at all is refused', () => {
  // A relative template has no host, so there is nobody to count it as; and an unnamed row is
  // a gateway with no operator, which 12 §1.3 counts by.
  assert.throws(
    () => readGatewayConfig(gatewayConfig('relative', [{ ...alpha, rawUrl: '/raw/{txid}' }, beta])),
    /is not an absolute URL/,
  );
  assert.throws(
    () => readGatewayConfig(gatewayConfig('unnamed', [{ ...alpha, name: '  ' }, beta])),
    /declares no operator name/,
  );
});

test('the transcript parser applies the same rule, so a fixture cannot be looser', () => {
  // The suite's own corpus feeds the same floor. Sharing the rule is what stops a transcript
  // being admissible where an operator's file is not.
  const document: unknown = JSON.parse(readFileSync(join(FIXTURES, 'cli-honest.json'), 'utf8'));
  const transcript = document as { gateways: Gateway[] };
  assert.throws(
    () => parseTranscript({ ...transcript, gateways: [alpha, { ...alpha, name: 'beta' }] }),
    TranscriptError,
  );
  assert.throws(
    () => parseTranscript({ ...transcript, gateways: [alpha, { ...beta, name: 'alpha' }] }),
    TranscriptError,
  );
});

test('the command refuses a duplicated gateway set before it fetches anything', async () => {
  // Driven as the command, because that is where the config is read. It must refuse at parse
  // time: a check that fired after the fetches would already have asked one operator twice.
  const path = gatewayConfig('cli-duplicate', [alpha, { ...alpha, name: 'beta' }]);
  const argv = compareArgv().filter(
    (token, index, all) => token !== '--transcript' && all[index - 1] !== '--transcript',
  );
  const result = await run([...argv, '--gateways', path]);
  assert.equal(result.code, undefined, `expected a refusal; got exit ${String(result.code)}`);
  assert.match(String(result.thrown?.message), /both answer at alpha\.example/);
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
