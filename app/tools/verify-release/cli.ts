#!/usr/bin/env node
/**
 * `verify-release` — 12 §1.3, F13.
 *
 * §1.3's requirement is that **anyone** can reproduce the verdict with no project
 * infrastructure: clone, build in the pinned container, then compare a local tree against
 * what a gateway serves. This is the entry point for that; the deciding lives in
 * `verdict.ts` and `registry.ts` so it can be exercised against the outcomes a healthy
 * release never produces.
 *
 * Three subcommands:
 *
 *   verify-release signers audit        — 12 §2.2's disjointness check over the registry
 *   verify-release diff-scope A B       — 12 §1.5's expedited-lane admissibility
 *   verify-release compare …            — 12 §1.3's fetch, byte-compare and verdict
 *
 * ## What `compare` does and does not reach
 *
 * It used to refuse outright, on the grounds that it needed a published keyring and FE-P7's
 * gateway behaviour. Half of that was true and the other half was a park that grew: the fetch
 * loop, the byte comparison, the cross-gateway divergence check, the signature counting and
 * the verdict are all decisions over bytes, and every one of them runs here against a
 * transcript with no network. What genuinely needs something this repository does not have is
 * **one function** — `liveGateway` in `gateway.ts` — plus the real public keys a ceremony
 * produces, and the second of those is a refusal rather than a gap: with no keyring, nothing
 * verifies, the floors are unmet, and the verdict is `MISMATCH` by counting.
 *
 * So this command names which half is missing instead of declining to run. It exits `3` — not
 * `0` — when it produced a verdict with a condition it could not check, because 12 §2.3
 * requires it to warn loudly when it cannot reach a node, and a tool whose exit code is the
 * same either way makes the loud part unwritable.
 *
 * ## What `compare` binds, and why each binding is here
 *
 * Four of them, and each one exists because its absence made some check unable to report the
 * thing it was written for. `tests/release/verify-release-cli.test.ts` drives them as the
 * command rather than through a re-implementation of it, which is how they stayed absent.
 *
 * 1. **The manifest fetched is the manifest the release pins.** 12 §1.2 records `M` in
 *    `release.json` and says the CLI checks both addresses. Without the comparison, pointing
 *    `--arweave` at any other manifest serving the same bytes printed `MATCH` for a content
 *    address the release never authorized.
 * 2. **The served tree is the union of the signed map and what the manifest lists.** Derive
 *    the fetch list from `perFileHashes` alone and every path fetched is a path the release
 *    signed, so `runSelfCheck`'s **unexpected** finding — the injected payload — can never
 *    fire.
 * 3. **`ReleaseChannel` is decoded field by field at 02 §12's frozen offsets**, and its
 *    keyring generation must agree with the release's and with the published keyring's.
 * 4. **Credentials are named, not inferred.** The producer cannot carry its own signature
 *    transaction ids, so they come from 12 §1.4 gate 4's release notes as `--signature` and
 *    `--attestation` (see `credentials` below for why the other reading is unfillable).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPerFileHashes } from '@bleavit/verify';

import type { Gateway, GatewayGet, SignatureBlob } from './compare.ts';
import { compareRelease, fetchGatewayTree, fetchTransaction, hashDirectory } from './compare.ts';
import { liveGateway, readTranscript, transcriptGateway } from './gateway.ts';
import { checkControllerQuorum, checkDisjointness, parseRegistry } from './registry.ts';
import type { FileHashes } from './verdict.ts';
import { diffScope } from './verdict.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../release/sources/signers.json');

function signersAudit(strict: boolean): number {
  const document: unknown = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const declared = isRecord(document) ? document : {};
  const phaseGate = declared['_phase_gate'];
  // `parseRegistry` refuses an empty registry, and rightly: a disjointness check over no
  // entries compares nothing. Pre-ceremony that is the true state rather than a defect, so
  // it is reported as a phase gate — but only when the file **declares** one, so emptying a
  // populated registry is still an error, and `--strict` (what a release gate runs) still
  // fails either way.
  const declaredEntries = declared['entries'];
  if (Array.isArray(declaredEntries) && declaredEntries.length === 0 && phaseGate) {
    console.log(`unseated: ${String(phaseGate)}`);
    if (strict) {
      console.error('\n--strict: a release may not ship against a registry that declares nobody');
      return 1;
    }
    return 0;
  }
  const entries = parseRegistry(document);
  const { violations, empty } = checkDisjointness(entries);
  const quorum = checkControllerQuorum(entries);

  for (const violation of violations) {
    console.error(`DISJOINTNESS VIOLATION: ${violation.detail}\n  ${violation.reason}`);
  }
  for (const gap of empty) {
    console.log(`unseated: ${gap.pair.a} ∩ ${gap.pair.b} — ${gap.detail}`);
  }
  for (const line of quorum) console.log(`launch blocker: ${line}`);

  if (violations.length > 0) return 1;
  if (strict && (empty.length > 0 || quorum.length > 0)) {
    console.error('\n--strict: a release may not rest on a separation that holds for want of members');
    return 1;
  }
  console.log(
    `signers audit: ${entries.length} declared identit(y|ies), ${violations.length} violation(s), ` +
      `${empty.length} unseated pair(s)`,
  );
  return 0;
}

function diffScopeCommand(incumbentPath: string, candidatePath: string): number {
  // A document with no `perFileHashes` is refused rather than read as `{}`. Typing this
  // exposed the hole: `{}` against `{}` yields zero out-of-scope files, so `diff-scope`
  // would have printed "the delta is confined to the scope 12 §1.5 admits" and exited 0
  // having compared nothing — a false pass on the gate that decides whether a release may
  // skip the standard lane's 72 h soak.
  const read = (path: string): FileHashes => {
    const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const hashes = isRecord(document) ? document['perFileHashes'] : undefined;
    if (!isRecord(hashes) || Object.keys(hashes).length === 0) {
      throw new Error(`${path} carries no perFileHashes; there is nothing to compare`);
    }
    const out: Record<string, string> = {};
    for (const [file, hash] of Object.entries(hashes)) {
      if (typeof hash !== 'string') throw new Error(`${path}: perFileHashes[${file}] is not a digest`);
      out[file] = hash;
    }
    return out;
  };
  const result = diffScope(read(incumbentPath), read(candidatePath));
  console.log(result.detail);
  for (const entry of result.outOfScope) console.error(`  ${entry.change}: ${entry.path}`);
  return result.admissible ? 0 : 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read repeated `--flag value` pairs, in order. */
function options(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (const [index, token] of argv.entries()) {
    if (token !== flag) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} takes a value`);
    }
    values.push(value);
  }
  return values;
}

function option(argv: readonly string[], flag: string): string | undefined {
  const values = options(argv, flag);
  if (values.length > 1) throw new Error(`${flag} was given ${String(values.length)} times`);
  return values[0];
}

function integerOption(argv: readonly string[], flag: string): number | undefined {
  const value = option(argv, flag);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${flag} takes a whole number, not ${value}`);
  return Number(value);
}

/** An Arweave transaction id: 43 base64url characters. The shape `arweave.ts` writes and
 * `tools/monitoring/attestation_monitor.py` reads, restated here rather than imported so this
 * command keeps no dependency on the build tools it verifies. */
const TXID = /^[A-Za-z0-9_-]{43}$/;

/**
 * A transaction id as the caller may type it, reduced to the 43 bytes everything else uses.
 *
 * 12 §1.3 publishes the verification command with the `ar://` scheme —
 * `--release-json ar://<release-json-txid>` — and the id was interpolated into the gateway
 * URL verbatim, so the spec's own literal command requested `ar%3A//<txid>` and could not
 * resolve. Accepting the scheme here rather than at each use site keeps the manifest binding
 * below comparing two ids of the same form: `--arweave ar://<m>` against a document that
 * pins the bare `<m>` is the same manifest, and refusing it would be a second defect wearing
 * the first one's clothes.
 */
function bareTxid(value: string): string {
  return value.startsWith('ar://') ? value.slice('ar://'.length) : value;
}

function assertTxid(value: string, what: string): string {
  if (!TXID.test(value)) {
    throw new Error(`${what} is not a 43-character base64url Arweave transaction id: ${value}`);
  }
  return value;
}

/**
 * The transaction ids `release.json` names for its signatures and attestations.
 *
 * The field names are the ones `tools/monitoring/attestation_monitor.py` already reads, so the
 * two independent implementations of this check cannot drift into two spellings. They remain
 * O1-provisional, and **this repository's producer cannot fill them** — see `credentials`
 * below, which is why they are one source here rather than the only one.
 */
function signatureTxids(document: unknown, field: string): string[] {
  const rows = isRecord(document) ? document[field] : undefined;
  if (!Array.isArray(rows)) return [];
  const txids: string[] = [];
  for (const row of rows) {
    const txid = isRecord(row) ? row['txid'] : undefined;
    if (typeof txid !== 'string' || txid.length === 0) {
      throw new Error(`release.json ${field} carries a row with no txid`);
    }
    txids.push(assertTxid(txid, `release.json ${field} txid`));
  }
  return txids;
}

/**
 * Every credential transaction of one population, from both places one can come from.
 *
 * ## Why the document alone was never enough
 *
 * `buildReleaseJson` emits `signingKeyIds` and `keyringGeneration` and **no credential
 * arrays**, so a `compare` that read only the document counted zero signatures and zero
 * attestations for every genuine release — whatever was actually published — and printed
 * `MISMATCH` by arithmetic that had nothing to do with the release. The counting ran against
 * the constructed fixture and nothing else.
 *
 * ## And why adding the arrays to the producer would not fix it
 *
 * It is the `releaseTxid` defect again, and this time the circularity is the signature's.
 * 12 §2.1 has the release keys sign `release.json`'s hash, and `compareRelease` verifies each
 * one against the **served bytes**. A signature transaction exists only after those bytes are
 * final, so patching its id back into the document changes the bytes it signs and invalidates
 * every signature over them. The field would ship empty in every real deployment, exactly as
 * `releaseTxid` shipped `null`.
 *
 * ## Where they really come from
 *
 * 12 §1.4 gate 4 publishes them: *"release notes list the immutable TXID, attestation TXIDs,
 * and the multi-gateway URL set"*. So they are operator-supplied, like `--arweave` and
 * `--release-json` already are, and a verifier reading the release notes has them. The
 * document-embedded arrays stay as a second source, because that is the provisional contract
 * the §5.2 monitor reads and the two must not drift into two spellings.
 *
 * Zero credentials still refuses — by counting, at the floors — but it says so in its own
 * words first, so "this release published no signatures" and "you named none" are never the
 * same line.
 */
function credentials(argv: readonly string[], document: unknown, field: string, flag: string): string[] {
  const named = [
    ...signatureTxids(document, field),
    ...options(argv, flag).map((txid) => assertTxid(txid, flag)),
  ];
  const merged = [...new Set(named)];
  if (merged.length === 0) {
    console.error(
      `NONE NAMED  no ${field} were named, so ${field.replace('_', ' ')} are counted over zero. ` +
        `12 §1.4 gate 4 publishes each transaction id in the release notes; pass every one as ` +
        `${flag} <txid>. This is a refusal for want of inputs, not a release that published none.`,
    );
  }
  return merged;
}

async function compareCommand(argv: readonly string[]): Promise<number> {
  const local = option(argv, '--local');
  const manifestArg = option(argv, '--arweave');
  const releaseJsonArg = option(argv, '--release-json');
  const transcriptPath = option(argv, '--transcript');
  const gatewayConfigPath = option(argv, '--gateways');
  if (local === undefined || manifestArg === undefined || releaseJsonArg === undefined) {
    throw new Error('compare needs --local <dir>, --arweave <manifest-txid> and --release-json <txid>');
  }
  // Normalised once, before any use: the shape check, the gateway URL and the manifest
  // binding must all see the same id, or accepting `ar://` in one place breaks it in another.
  const manifestTxid = assertTxid(bareTxid(manifestArg), '--arweave');
  const releaseJsonTxid = assertTxid(bareTxid(releaseJsonArg), '--release-json');
  if ((transcriptPath === undefined) === (gatewayConfigPath === undefined)) {
    throw new Error(
      'compare needs exactly one of --transcript <path> (replay, what the suite runs) or ' +
        '--gateways <config.json> (the live call, which no suite in this repository exercises)',
    );
  }

  let gateways: readonly Gateway[];
  let get: GatewayGet;
  if (transcriptPath !== undefined) {
    const transcript = readTranscript(transcriptPath);
    gateways = transcript.gateways;
    get = transcriptGateway(transcript);
  } else {
    gateways = readGatewayConfig(gatewayConfigPath ?? '');
    get = liveGateway(globalThis.fetch);
  }

  // §1.3 addresses `release.json` by its own transaction id. The first gateway that serves it
  // supplies the bytes the signatures are over; the others are then checked against the map
  // that document carries, which is what makes a lying gateway visible.
  const first = gateways[0];
  if (first === undefined) throw new Error('no gateway was configured');
  const releaseJsonBytes = await fetchTransaction(get, first, releaseJsonTxid);
  const document: unknown = JSON.parse(Buffer.from(releaseJsonBytes).toString('utf8'));
  const pins = readPerFileHashes(document);
  if (pins.kind === 'refused') {
    throw new Error(`the served release.json cannot be compared: ${pins.detail}`);
  }
  const generation = isRecord(document) ? document['keyringGeneration'] : undefined;
  if (typeof generation !== 'number' || !Number.isInteger(generation)) {
    // §1.4 counts signatures of the *current keyring generation*. A document that names none
    // cannot be counted against one, and guessing a generation is how a previous generation's
    // signature comes to satisfy a floor.
    throw new Error('the served release.json declares no keyringGeneration (12 §2.1)');
  }

  // **The manifest the release signed, not the one the caller typed.** 12 §1.2 pins `M` in
  // `release.json` and says the verification CLI checks both addresses. Fetching the tree from
  // `--arweave` without comparing it to the pin verifies a content address the release never
  // authorized: point the command at any other manifest that serves the same bytes at the
  // signed paths and it printed MATCH.
  const pinnedManifest = isRecord(document) ? document['arweaveManifestTxId'] : undefined;
  if (typeof pinnedManifest !== 'string' || !TXID.test(pinnedManifest)) {
    throw new Error(
      'the served release.json pins no arweaveManifestTxId (12 §1.2), so there is no address ' +
        'the tree fetched here can be checked against. A document with `null` there is a build ' +
        'output rather than a published release.',
    );
  }
  if (pinnedManifest !== manifestTxid) {
    throw new Error(
      `--arweave names the manifest ${manifestTxid} and the served release.json pins ` +
        `${pinnedManifest} (12 §1.2). Comparing against the first would verify a content ` +
        'address this release never authorized, however well its bytes matched.',
    );
  }

  const paths = Object.keys(pins.perFileHashes);
  const servedTrees = [];
  for (const gateway of gateways) {
    // Over the union of the signed map and what each gateway's manifest lists, so a served
    // file nobody signed is reported instead of being unreachable by construction.
    servedTrees.push(await fetchGatewayTree(get, gateway, manifestTxid, paths));
  }

  const blobs = async (field: string, flag: string): Promise<SignatureBlob[]> => {
    const out: SignatureBlob[] = [];
    for (const txid of credentials(argv, document, field, flag)) {
      out.push({ source: txid, text: Buffer.from(await fetchTransaction(get, first, txid)).toString('utf8') });
    }
    return out;
  };

  const channel = readReleaseChannel(option(argv, '--release-channel'));
  if (channel !== undefined && channel.keyringGeneration !== generation) {
    // §2.3 point 1 bumps the generation and sets the bit in one write, so the two documents
    // disagreeing means one of them is not describing this release — and the revocation bits
    // would then be indexed into a keyring nobody published.
    throw new Error(
      `the ReleaseChannel record names keyring generation ${String(channel.keyringGeneration)} ` +
        `and the served release.json names ${String(generation)} (12 §2.1, §2.3). The revocation ` +
        'bitmask indexes into the generation it was written for, so counting it against another ' +
        'one revokes whichever keys happen to sit at those indices.',
    );
  }
  const keyringPath = option(argv, '--keyring');
  const keyring = keyringPath === undefined ? undefined : readKeyring(keyringPath);
  if (keyring !== undefined && keyring.generation !== generation) {
    throw new Error(
      `${String(keyringPath)} publishes keyring generation ${String(keyring.generation)} and ` +
        `this release names ${String(generation)} (12 §2.1). Old keyrings are retained to verify ` +
        'historical releases, so verifying against the wrong one is a silent success.',
    );
  }

  const report = compareRelease({
    releaseJsonBytes,
    perFileHashes: pins.perFileHashes,
    localHashes: hashDirectory(local),
    servedTrees,
    entries: publishedRegistry(option(argv, '--registry') ?? REGISTRY),
    generation,
    ...(channel === undefined ? {} : { revokedKeyBits: channel.revokedKeyBits }),
    publicKeys: keyring?.keys ?? {},
    releaseSignatures: await blobs('release_signatures', '--signature'),
    attestations: await blobs('attestations', '--attestation'),
    ...(integerOption(argv, '--min-signatures') === undefined
      ? {}
      : { minimumSignatures: integerOption(argv, '--min-signatures') }),
    ...(integerOption(argv, '--require-attestations') === undefined
      ? {}
      : { minimumAttestations: integerOption(argv, '--require-attestations') }),
  });

  for (const finding of report.local.findings) console.error(`local  ${finding.kind} ${finding.path}`);
  for (const served of report.served) {
    for (const finding of served.check.findings) {
      console.error(`${served.gateway}  ${finding.kind} ${finding.path}`);
    }
  }
  for (const finding of report.gatewayFindings) console.error(`gateway  ${finding}`);
  for (const failure of report.release.failures) console.error(`release  ${failure}`);
  console.log(
    `signatures: ${String(report.release.signatures.distinctKeys)} distinct active key(s); ` +
      `attestations: ${String(report.release.attestations.independentOrganizations)} organization(s)`,
  );
  if (!report.ok) {
    console.log('VERDICT: MISMATCH');
    return 1;
  }
  if (report.unchecked.length > 0) {
    // Never printed as a clean verdict, and never exited as one.
    for (const warning of report.unchecked) console.error(`NOT CHECKED  ${warning}`);
    console.log('VERDICT: MATCH, WITH UNCHECKED CONDITIONS');
    return 3;
  }
  console.log('VERDICT: MATCH');
  return 0;
}

/**
 * The published registry, or an empty one with a loud line.
 *
 * `parseRegistry` refuses an empty registry and is right to: a disjointness check over nobody
 * compares nothing. `compare` is a different question — the byte comparison is worth running
 * against a release nobody has signed yet, and an empty registry there is not a vacuous pass
 * but a guaranteed refusal, because every signature is then by a key nobody published and the
 * §1.4 floors are counted over zero.
 */
function publishedRegistry(path: string): ReturnType<typeof parseRegistry> {
  const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const entries = isRecord(document) ? document['entries'] : undefined;
  if (Array.isArray(entries) && entries.length === 0) {
    console.error(
      `NOT CHECKED  ${path} publishes no keys (12 §2.2 point 1), so no signature can be ` +
        'attributed to a holder and every floor is counted over zero.',
    );
    return [];
  }
  return parseRegistry(document);
}

/** `{ "gateways": [{ "name": …, "rawUrl": …, "txUrl": … }] }` — the live-call configuration. */
function readGatewayConfig(path: string): readonly Gateway[] {
  const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const rows = isRecord(document) ? document['gateways'] : undefined;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${path} configures no gateways`);
  return rows.map((row, index) => {
    const gateway = isRecord(row) ? row : {};
    const name = gateway['name'];
    const rawUrl = gateway['rawUrl'];
    const txUrl = gateway['txUrl'];
    if (typeof name !== 'string' || typeof rawUrl !== 'string' || typeof txUrl !== 'string') {
      throw new Error(`${path}: gateways[${String(index)}] needs name, rawUrl and txUrl`);
    }
    return { name, rawUrl, txUrl };
  });
}

/** The published keyring (12 §2.1): its generation, and key id to minisign public-key text. */
interface PublishedKeyring {
  readonly generation: number;
  readonly keys: Record<string, string>;
}

/**
 * `{ "generation": N, "keys": { "<keyId>": "<minisign public key text>" } }`.
 *
 * The generation is required rather than optional. 12 §2.1 tags every keyring by generation
 * precisely because old ones are retained to verify historical releases, so a keyring file
 * that does not say which one it is cannot be checked against the release it is verifying —
 * and verifying a current release against a superseded keyring succeeds silently.
 */
function readKeyring(path: string): PublishedKeyring {
  const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const generation = isRecord(document) ? document['generation'] : undefined;
  if (typeof generation !== 'number' || !Number.isInteger(generation)) {
    throw new Error(`${path} declares no keyring generation (12 §2.1); it cannot be bound to a release`);
  }
  const keys = isRecord(document) ? document['keys'] : undefined;
  if (!isRecord(keys) || Object.keys(keys).length === 0) {
    throw new Error(`${path} publishes no keys; a keyring nobody is in verifies nothing`);
  }
  const out: Record<string, string> = {};
  for (const [keyId, text] of Object.entries(keys)) {
    if (typeof text !== 'string') throw new Error(`${path}: key ${keyId} is not a public-key packet`);
    out[keyId] = text;
  }
  return { generation, keys: out };
}

/** 02 §12's frozen layout, named so the offsets appear once and cite their owner. */
const KEYRING_GENERATION_OFFSET = 152;
const REVOKED_KEY_BITS_OFFSET = 156;
const RELEASE_CHANNEL_BYTES = 168;

/** The two `ReleaseChannel` fields this command reads. */
interface ReleaseChannelFields {
  readonly keyringGeneration: number;
  readonly revokedKeyBits: bigint;
}

/**
 * `keyring_generation` and `revoked_key_bits` from a raw 168-byte record — 02 §12.
 *
 * Two adjacent fields at two frozen offsets, and reading them as one is not a rounding error:
 *
 * | 152 | 4 | `keyring_generation: u32` LE |
 * | 156 | 8 | `revoked_key_bits: u64` LE   |
 *
 * A single `u64` at 152 yields `generation + (low32(revoked_key_bits) << 32)`, which is wrong
 * in both directions at once. **The generation becomes revocation bits** — generation 4 reads
 * as bit 2 set, so a healthy channel revoking nobody revokes whichever key sits at index 2 —
 * and **the mask loses its top four bytes**, so every revocation above index 31 is discarded.
 * 02 §12 closes with the rule this obeys: the layout MUST NEVER change and readers parse by
 * offset, never by SCALE metadata. So parse by offset, one field at a time.
 *
 * Read from a file rather than from a node, because §1.3 asks for the revocation set *when a
 * node is reachable* and this tool must run with no infrastructure. `undefined` means it was
 * not read, which `compareRelease` reports as an unchecked condition rather than as clean.
 */
function readReleaseChannel(path: string | undefined): ReleaseChannelFields | undefined {
  if (path === undefined) return undefined;
  const bytes = readFileSync(path);
  if (bytes.length < RELEASE_CHANNEL_BYTES) {
    throw new Error(
      `a ReleaseChannel record is at least ${String(RELEASE_CHANNEL_BYTES)} bytes (02 §12), ` +
        `got ${String(bytes.length)}`,
    );
  }
  return {
    keyringGeneration: bytes.readUInt32LE(KEYRING_GENERATION_OFFSET),
    revokedKeyBits: bytes.readBigUInt64LE(REVOKED_KEY_BITS_OFFSET),
  };
}

/**
 * Exported so a suite can drive the command itself rather than a re-implementation of it.
 *
 * It is not a convenience. Every one of this file's four defects — a manifest never bound to
 * the one the release pins, a served tree that could not contain an unexpected file, two
 * `ReleaseChannel` fields decoded as one, and credentials only a fixture could supply — lived
 * in `compareCommand` and in nothing else, while `tests/release/compare.test.ts` exercised
 * `compare.ts` through a helper that reproduced the CLI's *intent*. A test of a copy of the
 * caller cannot see a defect in the caller.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'signers':
      if (rest[0] !== 'audit') break;
      return signersAudit(rest.includes('--strict'));
    case 'diff-scope': {
      const [incumbent, candidate] = rest;
      if (incumbent === undefined || candidate === undefined) break;
      return diffScopeCommand(incumbent, candidate);
    }
    case 'compare':
      return compareCommand(rest);
    default:
      break;
  }
  console.error(
    'usage: verify-release signers audit [--strict]\n' +
      '   or: verify-release diff-scope <incumbent.json> <candidate.json>\n' +
      '   or: verify-release compare --local <dir> --arweave <manifest-txid> --release-json <txid>\n' +
      '                              (--transcript <path> | --gateways <config.json>)\n' +
      '                              [--keyring <path>] [--release-channel <path>]\n' +
      '                              [--registry <path>] [--min-signatures N]\n' +
      '                              [--require-attestations N]\n' +
      '                              [--signature <txid>]... [--attestation <txid>]...\n' +
      '\n' +
      '--signature and --attestation name the credential transactions 12 §1.4 gate 4 publishes\n' +
      'in the release notes. Repeat each flag once per transaction.',
  );
  return 64;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
