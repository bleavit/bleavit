/**
 * `verify-release compare` — 12 §1.3, §1.4, §2.3 (F13).
 *
 * §1.3's command names four things: fetch through at least two gateways, byte-compare every
 * file, verify the minisign signatures against the published keyring, and check the on-chain
 * revocation set when a node is reachable. Every one of those runs here, against a transcript
 * read in place, on the outcomes a healthy release never produces — a gateway that serves
 * altered bytes, a gateway that serves nothing, a signature by a key nobody published, two
 * attestations from one organization, and a revoked key that still signs.
 *
 * The one thing the suite does not run is `liveGateway`, which needs a gateway. That is the
 * honest scope of what remains external and it is one function wide.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sha256Hex } from '@bleavit/verify';
import { readPerFileHashes } from '@bleavit/verify';

import type { CompareInputs, Gateway, ServedTree, SignatureBlob } from '../../tools/verify-release/compare.ts';
import {
  CompareError,
  compareRelease,
  crossGatewayFindings,
  fetchServedTree,
  fetchTransaction,
  formatUrl,
  hashDirectory,
  sha256Hex,
} from '../../tools/verify-release/compare.ts';
import {
  TranscriptError,
  UnrecordedUrlError,
  parseTranscript,
  readTranscript,
  transcriptGateway,
} from '../../tools/verify-release/gateway.ts';
import { keyringFor, parseRegistry } from '../../tools/verify-release/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read in place, never a copy: the same discipline `tests/protocol` applies to the vector
// corpus, for the same reason — a copy is a second artifact that drifts silently.
const FIXTURES = resolve(HERE, '..', '..', 'fixtures', 'gateway-transcript');

const MANIFEST_TXID = 'M'.repeat(43);
const RELEASE_JSON_TXID = 'R'.repeat(43);

const registryEntries = parseRegistry(
  JSON.parse(readFileSync(join(FIXTURES, 'registry.json'), 'utf8')),
);
const publicKeys = ((): Record<string, string> => {
  const document: unknown = JSON.parse(readFileSync(join(FIXTURES, 'keyring.json'), 'utf8'));
  const keys = (document as { keys?: Record<string, string> }).keys ?? {};
  return keys;
})();

const first = <T>(items: readonly T[], what: string): T => {
  const item = items[0];
  assert.ok(item !== undefined, `expected at least one ${what}, got none`);
  return item;
};

async function scenario(
  name: 'honest.json' | 'tampered-gateway.json' | 'refused-status.json',
): Promise<{
  gateways: readonly Gateway[];
  releaseJsonBytes: Uint8Array;
  perFileHashes: Readonly<Record<string, Sha256Hex>>;
  servedTrees: ServedTree[];
  releaseSignatures: SignatureBlob[];
  attestations: SignatureBlob[];
  document: { release_signatures: { txid: string }[]; attestations: { txid: string }[] };
}> {
  const transcript = readTranscript(join(FIXTURES, name));
  const get = transcriptGateway(transcript);
  const gateway = first(transcript.gateways, 'gateway');
  const releaseJsonBytes = await fetchTransaction(get, gateway, RELEASE_JSON_TXID);
  const document: unknown = JSON.parse(Buffer.from(releaseJsonBytes).toString('utf8'));
  const pins = readPerFileHashes(document);
  assert.equal(pins.kind, 'pins');
  if (pins.kind !== 'pins') throw new Error('unreachable');
  const paths = Object.keys(pins.perFileHashes);
  const servedTrees: ServedTree[] = [];
  for (const each of transcript.gateways) {
    servedTrees.push(await fetchServedTree(get, each, MANIFEST_TXID, paths));
  }
  const rows = document as { release_signatures: { txid: string }[]; attestations: { txid: string }[] };
  const blobs = async (list: { txid: string }[]): Promise<SignatureBlob[]> => {
    const out: SignatureBlob[] = [];
    for (const row of list) {
      out.push({
        source: row.txid,
        text: Buffer.from(await fetchTransaction(get, gateway, row.txid)).toString('utf8'),
      });
    }
    return out;
  };
  return {
    gateways: transcript.gateways,
    releaseJsonBytes,
    perFileHashes: pins.perFileHashes,
    servedTrees,
    releaseSignatures: await blobs(rows.release_signatures),
    attestations: await blobs(rows.attestations),
    document: rows,
  };
}

function inputs(
  base: Awaited<ReturnType<typeof scenario>>,
  over: Partial<CompareInputs> = {},
): CompareInputs {
  return {
    releaseJsonBytes: base.releaseJsonBytes,
    perFileHashes: base.perFileHashes,
    // The local tree is the signed tree by construction here: `--local dist/` is the verifier's
    // own build, and the interesting failures are the served ones.
    localHashes: base.perFileHashes,
    servedTrees: base.servedTrees,
    entries: registryEntries,
    generation: 4,
    publicKeys,
    releaseSignatures: base.releaseSignatures,
    attestations: base.attestations,
    ...over,
  };
}

test('the honest transcript verifies, and says the revocation set was not read', async () => {
  const report = compareRelease(inputs(await scenario('honest.json')));
  assert.deepEqual(report.release.failures, []);
  assert.deepEqual([...report.gatewayFindings], []);
  assert.ok(report.ok);
  assert.equal(report.release.signatures.distinctKeys, 2);
  assert.equal(report.release.attestations.independentOrganizations, 2);
  // §2.3 point 3: warn loudly when a node cannot be reached. A verdict that read the same
  // either way would make the loud part unwritable.
  assert.equal(report.unchecked.length, 1);
  assert.match(first(report.unchecked, 'warning'), /revocation set was not read/);
});

test('a gateway serving altered bytes fails, and is named', async () => {
  const report = compareRelease(inputs(await scenario('tampered-gateway.json')));
  assert.equal(report.ok, false);
  const beta = report.served.find((entry) => entry.gateway === 'beta');
  assert.ok(beta !== undefined);
  assert.equal(beta.check.ok, false);
  assert.equal(first(beta.check.findings, 'finding').kind, 'changed');
  assert.equal(first(beta.check.findings, 'finding').path, 'assets/app.js');
  // The divergence check adds what the signed map cannot say: which gateway to stop using.
  assert.ok(report.gatewayFindings.some((line) => line.includes('gateways disagree about assets/app.js')));
  // The other gateway still verifies, so this is a distribution finding rather than a build one.
  const alpha = report.served.find((entry) => entry.gateway === 'alpha');
  assert.equal(alpha?.check.ok, true);
});

test('a non-2xx response is refused even when its body is the right bytes', async () => {
  // The status decides, not the bytes. A 404 body is a response the browser *renders*, and a
  // verifier that hashed it would report a release as served correctly by a gateway that
  // answered an error page for one of its files. The fixture makes the two disagree on
  // purpose: the body here is byte-identical to the signed file.
  const report = compareRelease(inputs(await scenario('refused-status.json')));
  assert.equal(report.ok, false);
  const beta = report.served.find((entry) => entry.gateway === 'beta');
  assert.equal(first(beta?.check.findings ?? [], 'finding').kind, 'missing');
  assert.equal(first(beta?.check.findings ?? [], 'finding').path, 'assets/app.js');
  assert.ok(report.gatewayFindings.some((line) => line.includes('beta answered 404')));
});

test('one gateway is not two, and the refusal cites §1.3', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(inputs(base, { servedTrees: [first(base.servedTrees, 'tree')] }));
  assert.equal(report.ok, false);
  assert.ok(report.gatewayFindings.some((line) => line.includes('at least 2')));
});

test('a revoked key does not count, which is the case §2.3 exists for', async () => {
  const base = await scenario('honest.json');
  // Index 0 is the first release signer in the fixture registry. Setting its bit is exactly
  // what §2.3 point 1 does, and the compromised key is the one still signing.
  const report = compareRelease(inputs(base, { revokedKeyBits: 1n }));
  assert.equal(report.release.signatures.distinctKeys, 1);
  assert.equal(report.ok, false);
  assert.ok(report.release.failures.some((line) => line.includes('marked revoked')));
  // Reading the revocation set is what removes the warning; nothing else does.
  assert.deepEqual([...report.unchecked], []);
});

test('a revoked attestor drops its organization, not merely its signature', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(inputs(base, { revokedKeyBits: 1n << 2n }));
  assert.equal(report.release.attestations.independentOrganizations, 1);
  assert.equal(report.ok, false);
});

test('a signature by a key the registry does not publish is refused', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(
    inputs(base, { entries: registryEntries.filter((entry) => entry.population !== 'release-signer') }),
  );
  assert.equal(report.release.signatures.distinctKeys, 0);
  assert.ok(
    report.release.failures.some((line) => line.includes('no release-signer entry in the published registry')),
  );
});

test('an attestation whose key nobody published cannot be shown independent of any other', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(
    inputs(base, { entries: registryEntries.filter((entry) => entry.population !== 'attestor') }),
  );
  assert.equal(report.release.attestations.independentOrganizations, 0);
  assert.equal(report.ok, false);
  // The rejection names the registry rather than the bytes. "The attestation signature does
  // not verify" would send an operator to check bytes that are intact.
  assert.ok(
    report.release.attestations.rejected.some((rejected) =>
      rejected.why.includes('no attestor entry in the published registry'),
    ),
  );
});

test('two attestations from one organization is one reproduction', async () => {
  const base = await scenario('honest.json');
  const oneOrg = registryEntries.map((entry) =>
    entry.population === 'attestor' ? { ...entry, organization: 'Pallas' } : entry,
  );
  const report = compareRelease(inputs(base, { entries: oneOrg }));
  assert.equal(report.release.attestations.independentOrganizations, 1);
  assert.equal(report.ok, false);
});

test('an empty keyring refuses by counting rather than by declaration', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(inputs(base, { publicKeys: {} }));
  assert.equal(report.release.signatures.distinctKeys, 0);
  assert.equal(report.ok, false);
  assert.ok(
    report.release.signatures.rejected.some((rejected) => rejected.why.includes('no public key')),
  );
});

test('a signature over different bytes does not verify, and the reason is not the bytes', async () => {
  const base = await scenario('honest.json');
  const report = compareRelease(
    inputs(base, { releaseJsonBytes: new Uint8Array(Buffer.from('{}\n', 'utf8')) }),
  );
  assert.equal(report.release.signatures.distinctKeys, 0);
  assert.ok(
    report.release.signatures.rejected.some((rejected) =>
      rejected.why.includes('does not verify against these bytes'),
    ),
  );
});

test('a restated trusted comment fails, with the artifact bytes intact', async () => {
  const base = await scenario('honest.json');
  const signature = first(base.releaseSignatures, 'signature');
  const lines = signature.text.split('\n');
  lines[2] = 'trusted comment: bleavit release 9.9.9, audited by nobody';
  const report = compareRelease(
    inputs(base, { releaseSignatures: [{ source: signature.source, text: lines.join('\n') }] }),
  );
  assert.ok(
    report.release.signatures.rejected.some((rejected) =>
      rejected.why.includes('the trusted comment is not signed by this key'),
    ),
  );
});

test('the fetch loop refuses a template that cannot carry a path', () => {
  assert.throws(
    () => formatUrl('https://gateway.example/{txid}', { txid: MANIFEST_TXID, path: 'app.js' }),
    CompareError,
  );
  assert.equal(
    formatUrl('https://gateway.example/{txid}/{path}', { txid: 'T', path: 'assets/app.js' }),
    'https://gateway.example/T/assets/app.js',
  );
});

test('a gateway that will not serve a file reports it as missing, and says which gateway', async () => {
  const transcript = readTranscript(join(FIXTURES, 'honest.json'));
  const get = transcriptGateway(transcript);
  const gateway = first(transcript.gateways, 'gateway');
  const tree = await fetchServedTree(get, gateway, MANIFEST_TXID, ['index.html', 'not-recorded.js']);
  assert.equal(Object.keys(tree.hashes).length, 1);
  assert.equal(tree.failures.length, 1);
  assert.match(first(tree.failures, 'failure'), /alpha could not serve not-recorded\.js/);
});

test('an unrecorded URL is refused rather than answered', async () => {
  const get = transcriptGateway(readTranscript(join(FIXTURES, 'honest.json')));
  await assert.rejects(() => get('https://alpha.example/raw/unknown'), UnrecordedUrlError);
});

test('a transcript that would make the replay weaker is refused', () => {
  const honest: unknown = JSON.parse(readFileSync(join(FIXTURES, 'honest.json'), 'utf8'));
  const document = honest as { schema: string; gateways: Gateway[]; responses: Record<string, unknown> };
  assert.throws(() => parseTranscript({ ...document, schema: 'other' }), TranscriptError);
  assert.throws(() => parseTranscript({ ...document, gateways: [] }), TranscriptError);
  assert.throws(() => parseTranscript({ ...document, responses: {} }), TranscriptError);
  // Two gateways under one name makes the divergence check compare a gateway with itself.
  const twice = [first(document.gateways, 'gateway'), first(document.gateways, 'gateway')];
  assert.throws(() => parseTranscript({ ...document, gateways: twice }), TranscriptError);
  const url = first(Object.keys(document.responses), 'response');
  assert.throws(
    () => parseTranscript({ ...document, responses: { [url]: { status: 200 } } }),
    TranscriptError,
  );
  assert.throws(
    () =>
      parseTranscript({
        ...document,
        responses: { [url]: { status: 200, body_utf8: 'a', body_base64: 'YQ==' } },
      }),
    TranscriptError,
  );
});

test('the fixture describes itself: every body hashes to what the release signed', async () => {
  // The suite does not trust the generator. A fixture that stopped describing itself would
  // otherwise pass every test above by agreeing with its own mistake.
  const base = await scenario('honest.json');
  const tree = first(base.servedTrees, 'tree');
  assert.deepEqual({ ...tree.hashes }, { ...base.perFileHashes });
  assert.equal(
    sha256Hex(base.releaseJsonBytes),
    createHash('sha256').update(base.releaseJsonBytes).digest('hex'),
  );
});

test('hashDirectory reads a tree the way the signed map keys it', () => {
  const hashes = hashDirectory(FIXTURES);
  assert.ok(hashes['README.md'] !== undefined);
  assert.equal(hashes['README.md'], sha256Hex(readFileSync(join(FIXTURES, 'README.md'))));
});

test('a bit no declared key claims is a disagreement, not a key to skip', () => {
  assert.throws(() => keyringFor(registryEntries, 4, 1n << 40n), /no declared key claims it/);
  assert.deepEqual(keyringFor(registryEntries, 4, 0n).revokedKeyIds, []);
  assert.equal(keyringFor(registryEntries, 4, 1n).revokedKeyIds?.length, 1);
  // A key of another generation is not in this generation's keyring at all.
  assert.throws(() => keyringFor(registryEntries, 5, 1n), /no declared key claims it/);
});

test('crossGatewayFindings carries every gateway failure into the verdict', () => {
  const findings = crossGatewayFindings([
    { gateway: 'alpha', hashes: { 'a.js': 'aa' }, failures: ['alpha answered 500 for b.js'] },
    { gateway: 'beta', hashes: { 'a.js': 'bb' }, failures: [] },
  ]);
  assert.ok(findings.some((line) => line.includes('gateways disagree about a.js')));
  assert.ok(findings.some((line) => line.includes('alpha answered 500')));
});
