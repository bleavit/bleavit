#!/usr/bin/env node
/**
 * Build the gateway transcript `tests/release/compare.test.ts` replays — 12 §1.3 (F13).
 *
 * Every other transcript corpus in this repository was **recorded** from a running system.
 * This one is **constructed**, and the distinction is the point rather than a caveat: 12 §1.2
 * carries an unresolved `[VERIFY]` against live gateway behaviour (prototype gate FE-P7), and
 * 12 §4.2 records that the naming platform moved from AO to Solana, so resolver and manifest
 * behaviour must be re-asked rather than carried over. Recording a session and committing it
 * would assert an answer to an open `[VERIFY]`, which R-2 forbids.
 *
 * So the fixture claims nothing about what an ar.io gateway answers. Its URLs are produced by
 * the *configured* templates, and its bodies are bytes this file defines. That is enough to
 * execute every decision in `compare.ts` — which is the half of `compare` that is not external.
 *
 * The holders are fictional and the keys are generated from fixed seeds, so the output is
 * byte-stable. Run `node tools/verify-release/make-transcript.ts` to regenerate.
 */

import { createHash, createPrivateKey, createPublicKey, sign as signEd25519 } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../fixtures/gateway-transcript');

const MANIFEST_TXID = 'M'.repeat(43);
const RELEASE_JSON_TXID = 'R'.repeat(43);
const GATEWAYS = [
  { name: 'alpha', rawUrl: 'https://alpha.example/raw/{txid}', txUrl: 'https://alpha.example/{txid}/{path}' },
  { name: 'beta', rawUrl: 'https://beta.example/raw/{txid}', txUrl: 'https://beta.example/{txid}/{path}' },
];

/** PKCS#8 for a raw Ed25519 seed: a fixed 16-byte prefix, then the seed. */
function keypair(seedByte: number): { publicKeyText: string; keyId: string; sign: (message: Uint8Array) => Uint8Array } {
  const seed = Buffer.alloc(32, seedByte);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const publicKey = Buffer.from(String(jwk.x), 'base64url');
  const keyIdBytes = Buffer.alloc(8, seedByte);
  const packet = Buffer.concat([Buffer.from('Ed', 'latin1'), keyIdBytes, publicKey]);
  return {
    publicKeyText: `untrusted comment: fixture key ${String(seedByte)}\n${packet.toString('base64')}\n`,
    keyId: keyIdBytes.toString('hex'),
    sign: (message) => new Uint8Array(signEd25519(null, message, privateKey)),
  };
}

/** A detached minisign signature in prehashed (`ED`) mode, which is what a real signer emits. */
function minisign(key: ReturnType<typeof keypair>, message: Uint8Array, trustedComment: string): string {
  const prehashed = new Uint8Array(createHash('blake2b512').update(message).digest());
  const primary = key.sign(prehashed);
  const packet = Buffer.concat([
    Buffer.from('ED', 'latin1'),
    Buffer.from(key.keyId, 'hex'),
    Buffer.from(primary),
  ]);
  const global = key.sign(
    new Uint8Array(Buffer.concat([Buffer.from(primary), Buffer.from(trustedComment, 'utf8')])),
  );
  return [
    'untrusted comment: signature from the bleavit fixture keyring',
    packet.toString('base64'),
    `trusted comment: ${trustedComment}`,
    Buffer.from(global).toString('base64'),
    '',
  ].join('\n');
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

const signers = [keypair(0x11), keypair(0x22)];
const attestors = [keypair(0x33), keypair(0x44)];

const files: Record<string, Uint8Array> = {
  'index.html': utf8('<!doctype html><title>bleavit</title>\n'),
  'assets/app.js': utf8('export const boot = () => undefined;\n'),
  // A binary file, so the transport is exercised on bytes that are not text.
  'assets/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
};

const releaseDocument = {
  schema: 'bleavit.app-release.v1',
  arweaveManifestTxId: MANIFEST_TXID,
  keyringGeneration: 4,
  perFileHashes: Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)]),
  ),
  release_signatures: [{ txid: 'S1'.padEnd(43, 'a') }, { txid: 'S2'.padEnd(43, 'b') }],
  attestations: [{ txid: 'A1'.padEnd(43, 'c') }, { txid: 'A2'.padEnd(43, 'd') }],
};
const releaseJsonBytes = utf8(`${JSON.stringify(releaseDocument, null, 2)}\n`);
const signedDigest = new Uint8Array(createHash('sha256').update(releaseJsonBytes).digest());

const credentials: Record<string, string> = {
  [releaseDocument.release_signatures[0]!.txid]: minisign(signers[0]!, signedDigest, 'bleavit release fixture'),
  [releaseDocument.release_signatures[1]!.txid]: minisign(signers[1]!, signedDigest, 'bleavit release fixture'),
  [releaseDocument.attestations[0]!.txid]: minisign(attestors[0]!, signedDigest, 'reproduced by pallas'),
  [releaseDocument.attestations[1]!.txid]: minisign(attestors[1]!, signedDigest, 'reproduced by rhea'),
};

interface Tamper {
  readonly gateway: string;
  readonly path: string;
  readonly body?: Uint8Array;
  readonly status?: number;
}

function transcript(tamper: Tamper | undefined): unknown {
  const responses: Record<string, unknown> = {};
  const put = (url: string, bytes: Uint8Array, status = 200): void => {
    const text = Buffer.from(bytes).toString('utf8');
    responses[url] = Buffer.from(text, 'utf8').equals(Buffer.from(bytes))
      ? { status, body_utf8: text }
      : { status, body_base64: Buffer.from(bytes).toString('base64') };
  };
  for (const gateway of GATEWAYS) {
    put(gateway.rawUrl.replace('{txid}', RELEASE_JSON_TXID), releaseJsonBytes);
    for (const [txid, text] of Object.entries(credentials)) {
      put(gateway.rawUrl.replace('{txid}', txid), utf8(text));
    }
    for (const [path, bytes] of Object.entries(files)) {
      const url = gateway.txUrl.replace('{txid}', MANIFEST_TXID).replace('{path}', path);
      const hit = tamper && tamper.gateway === gateway.name && tamper.path === path;
      put(url, hit && tamper.body ? tamper.body : bytes, hit ? (tamper.status ?? 200) : 200);
    }
  }
  return { schema: 'bleavit.gateway-transcript.v1', gateways: GATEWAYS, responses };
}

const registry = {
  _doc:
    'A fixture registry with fictional holders, for tests/release/compare.test.ts. The real ' +
    'registry is app/tools/release/sources/signers.json and it is deliberately empty until a ' +
    'ceremony is held. Nothing here is a key, a person or an organization of this project.',
  entries: [
    { id: signers[0]!.keyId, population: 'release-signer', operator: 'Fixture Ada', organization: 'Pallas', generation: 4, revocationIndex: 0 },
    { id: signers[1]!.keyId, population: 'release-signer', operator: 'Fixture Grace', organization: 'Rhea', generation: 4, revocationIndex: 1 },
    { id: attestors[0]!.keyId, population: 'attestor', operator: 'Fixture Linus', organization: 'Pallas', generation: 4, revocationIndex: 2 },
    { id: attestors[1]!.keyId, population: 'attestor', operator: 'Fixture Margaret', organization: 'Rhea', generation: 4, revocationIndex: 3 },
    { id: 'ar://fixture-ant-1', population: 'arns-controller', operator: 'Fixture Hedy', organization: 'Thebe' },
    { id: 'fixture-monitor-1', population: 'monitor-operator', operator: 'Fixture Katherine', organization: 'Metis' },
  ],
};

const keyring = {
  _doc: 'The fixture keyring: key id to minisign public-key packet. Generation 4.',
  generation: 4,
  keys: Object.fromEntries(
    [...signers, ...attestors].map((key) => [key.keyId, key.publicKeyText]),
  ),
};

mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown): void => {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
write('honest.json', transcript(undefined));
write(
  'tampered-gateway.json',
  transcript({ gateway: 'beta', path: 'assets/app.js', body: utf8('export const boot = () => steal();\n') }),
);
// A 404 whose body is the **correct** bytes. The discriminating case for the status check:
// with it, the file is missing from that gateway; without it, the release verifies against a
// response the browser would have rendered as an error page.
write('refused-status.json', transcript({ gateway: 'beta', path: 'assets/app.js', status: 404 }));
write('registry.json', registry);
write('keyring.json', keyring);
writeFileSync(join(OUT, 'release.json'), Buffer.from(releaseJsonBytes));
console.log(`wrote the gateway transcript fixture to ${OUT}`);
