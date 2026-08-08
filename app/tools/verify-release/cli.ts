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
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPerFileHashes } from '@bleavit/verify';

import type { Gateway, GatewayGet, SignatureBlob } from './compare.ts';
import { compareRelease, fetchServedTree, fetchTransaction, hashDirectory } from './compare.ts';
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

/**
 * The transaction ids `release.json` names for its signatures and attestations.
 *
 * The field names are the ones `tools/monitoring/attestation_monitor.py` already reads, so the
 * two independent implementations of this check cannot drift into two spellings. They remain
 * O1-provisional. Absence is not an error here: it produces zero credentials, the floors are
 * unmet, and the verdict refuses — which is the right outcome for a release that published no
 * signatures at all.
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
    txids.push(txid);
  }
  return txids;
}

async function compareCommand(argv: readonly string[]): Promise<number> {
  const local = option(argv, '--local');
  const manifestTxid = option(argv, '--arweave');
  const releaseJsonTxid = option(argv, '--release-json');
  const transcriptPath = option(argv, '--transcript');
  const gatewayConfigPath = option(argv, '--gateways');
  if (local === undefined || manifestTxid === undefined || releaseJsonTxid === undefined) {
    throw new Error('compare needs --local <dir>, --arweave <manifest-txid> and --release-json <txid>');
  }
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

  const paths = Object.keys(pins.perFileHashes);
  const servedTrees = [];
  for (const gateway of gateways) {
    servedTrees.push(await fetchServedTree(get, gateway, manifestTxid, paths));
  }

  const blobs = async (field: string): Promise<SignatureBlob[]> => {
    const out: SignatureBlob[] = [];
    for (const txid of signatureTxids(document, field)) {
      out.push({ source: txid, text: Buffer.from(await fetchTransaction(get, first, txid)).toString('utf8') });
    }
    return out;
  };

  const keyringPath = option(argv, '--keyring');
  const report = compareRelease({
    releaseJsonBytes,
    perFileHashes: pins.perFileHashes,
    localHashes: hashDirectory(local),
    servedTrees,
    entries: publishedRegistry(option(argv, '--registry') ?? REGISTRY),
    generation,
    ...(revokedKeyBits(option(argv, '--release-channel')) === undefined
      ? {}
      : { revokedKeyBits: revokedKeyBits(option(argv, '--release-channel')) }),
    publicKeys: keyringPath === undefined ? {} : readKeyring(keyringPath),
    releaseSignatures: await blobs('release_signatures'),
    attestations: await blobs('attestations'),
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

/** `{ "<keyId>": "<minisign public key text>" }` — the published keyring (12 §2.1). */
function readKeyring(path: string): Record<string, string> {
  const document: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const keys = isRecord(document) ? document['keys'] : undefined;
  if (!isRecord(keys) || Object.keys(keys).length === 0) {
    throw new Error(`${path} publishes no keys; a keyring nobody is in verifies nothing`);
  }
  const out: Record<string, string> = {};
  for (const [keyId, text] of Object.entries(keys)) {
    if (typeof text !== 'string') throw new Error(`${path}: key ${keyId} is not a public-key packet`);
    out[keyId] = text;
  }
  return out;
}

/**
 * `ReleaseChannel.revoked_key_bits` from a raw 168-byte record (02 §12, offsets 152..159).
 *
 * Read from a file rather than from a node, because §1.3 asks for the revocation set *when a
 * node is reachable* and this tool must run with no infrastructure. `undefined` means it was
 * not read, which `compareRelease` reports as an unchecked condition rather than as clean.
 */
function revokedKeyBits(path: string | undefined): bigint | undefined {
  if (path === undefined) return undefined;
  const bytes = readFileSync(path);
  if (bytes.length < 168) {
    throw new Error(`a ReleaseChannel record is at least 168 bytes (02 §12), got ${String(bytes.length)}`);
  }
  return bytes.readBigUInt64LE(152);
}

async function main(argv: readonly string[]): Promise<number> {
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
      '                              [--require-attestations N]',
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
