/**
 * `verify-release compare` — 12 §1.3's independent verification (F13).
 *
 * §1.3 is a promise to a stranger: *"Anyone MUST be able to reproduce the verdict with no
 * project infrastructure"*, by cloning, building in the pinned container, and comparing the
 * tree they built against what a gateway serves. Its own command line names the four things
 * the tool does — fetch through at least two gateways, byte-compare every file, verify the
 * minisign signatures against the published keyring, and check the on-chain revocation set
 * when a node is reachable — then print a verdict.
 *
 * ## What is external here, precisely, and what is not
 *
 * Only two things in that list need something this repository does not have.
 *
 * The **live gateway call** needs a gateway. It is one function, `liveGateway`, and it is the
 * only code below that a suite does not execute. Everything downstream of the bytes — the
 * hashing, the byte comparison, the cross-gateway divergence check, the signature counting and
 * the verdict — is a pure function over supplied bytes, and is exercised against a transcript
 * read in place.
 *
 * The **published keyring** needs a ceremony. That is a real blocker for a verdict about a
 * real release, and it is not a blocker for this code: a key is a minisign public-key packet,
 * the suite generates one, and the registry is what says which key belongs to which generation
 * and which organization. `compare` refuses when the floors are unmet, which with an empty
 * keyring means it refuses — correctly, and by counting rather than by declaration.
 *
 * ## What this module deliberately does not know
 *
 * **How a gateway URL is spelled.** 12 §1.2 carries an unresolved `[VERIFY]` against live
 * gateway behaviour (prototype gate FE-P7), and §4.2 records that the naming platform moved
 * from AO to Solana, so resolver endpoints must be re-asked rather than carried over. Baking a
 * URL shape in would be resolving that tag by assumption, which R-2 forbids. So the templates
 * are operator configuration — the same `raw_url`/`tx_url` shape
 * `tools/monitoring/attestation_monitor.py` already takes in its own config — and a template
 * missing a field it must interpolate is refused rather than fetched.
 *
 * **How to resolve the name.** §1.3's command takes `--arweave <manifest-txid>`, so resolution
 * is not part of this subcommand at all. Resolving `futarchy` across gateways and comparing the
 * answers is §5.2's out-of-band monitor's job, and that tool does it.
 *
 * ## The comparison is the app's own
 *
 * File comparison is `packages/verify`'s `runSelfCheck`, reused rather than reimplemented, so
 * the CLI and the in-app self-check cannot disagree about what *matches* means — including its
 * third finding kind, the **unexpected** served file that a manifest-driven loop cannot see.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { SelfCheckResult, Sha256Hex } from '@bleavit/verify';
import { runSelfCheck } from '@bleavit/verify';

import { parseMinisignSignature } from './minisign.ts';
import type { RegistryEntry } from './registry.ts';
import { entryFor, keyringFor } from './registry.ts';
import type { Attestation, ReleaseSignature, Verdict } from './verdict.ts';
import { ATTESTATION_FLOOR, VerifyError, releaseSignatureFrom, releaseVerdict } from './verdict.ts';

/** §1.3's "fetches via ≥ 2 gateways". Stated as a constant so the refusal can cite it. */
export const GATEWAY_FLOOR = 2;

export interface GatewayResponse {
  readonly status: number;
  /**
   * The body as bytes, never as text.
   *
   * `packages/providers` types its HTTP seams with a `string` body, and this one deliberately
   * differs: a release tree contains wasm, fonts and images, and a transport that decoded
   * would have already chosen an encoding for bytes whose only meaning here is their SHA-256.
   */
  readonly body: Uint8Array;
}

/**
 * The transport, injected. Never `globalThis.fetch` at a call site.
 *
 * The same discipline `packages/providers` applies to the indexer and probe seams: this module
 * may not decide how the verifier reaches the network, because that is what lets the whole
 * comparison run against a transcript with no network at all.
 */
export type GatewayGet = (url: string) => Promise<GatewayResponse>;

export interface Gateway {
  readonly name: string;
  /** A bare transaction by id. Interpolates `{txid}`. */
  readonly rawUrl: string;
  /** One file inside a path manifest. Interpolates `{txid}` and `{path}`. */
  readonly txUrl: string;
}

export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareError';
  }
}

/**
 * Interpolate a configured template, refusing one that cannot carry what it is given.
 *
 * A template with no `{path}` would fetch the same URL for every file in the tree and the
 * comparison would report a whole release of matching files — one file's bytes, compared
 * against every hash, and reported under the name of whichever it happened to satisfy.
 */
export function formatUrl(template: string, values: Readonly<Record<string, string>>): string {
  for (const field of Object.keys(values)) {
    if (!template.includes(`{${field}}`)) {
      throw new CompareError(`the gateway template ${template} interpolates no {${field}}`);
    }
  }
  let url = template;
  for (const [field, value] of Object.entries(values)) {
    url = url.split(`{${field}}`).join(encodeURIComponent(value).replace(/%2F/g, '/'));
  }
  return url;
}

export function sha256Hex(bytes: Uint8Array): Sha256Hex {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Hash a built tree on disk — the `--local dist/` half of §1.3's command.
 *
 * Paths are reported with forward slashes because that is what `release.json`'s per-file map
 * carries; on a platform whose separator differs, a native-separator key matches nothing and
 * the whole tree would be reported missing while a whole tree of unexpected files sat beside it.
 */
export function hashDirectory(root: string): Record<string, Sha256Hex> {
  const hashes: Record<string, Sha256Hex> = {};
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      hashes[relative(root, full).split(sep).join('/')] = sha256Hex(readFileSync(full));
    }
  };
  walk(root);
  return hashes;
}

export interface ServedTree {
  readonly gateway: string;
  readonly hashes: Readonly<Record<string, Sha256Hex>>;
  /** Fetches that did not return bytes. Reported, never quietly dropped. */
  readonly failures: readonly string[];
}

/**
 * Fetch every path of the signed map through one gateway and hash what came back.
 *
 * A path that fails to fetch is left **out** of the map rather than recorded as a mismatch,
 * so `runSelfCheck` reports it as `missing` — which is what it is. The failure is also
 * carried, because "this gateway would not serve it" and "this gateway served the wrong
 * bytes" are different facts with different next steps.
 */
export async function fetchServedTree(
  get: GatewayGet,
  gateway: Gateway,
  manifestTxid: string,
  paths: readonly string[],
): Promise<ServedTree> {
  const hashes: Record<string, Sha256Hex> = {};
  const failures: string[] = [];
  for (const path of paths) {
    const url = formatUrl(gateway.txUrl, { txid: manifestTxid, path });
    try {
      const response = await get(url);
      if (response.status < 200 || response.status >= 300) {
        // A non-2xx body is refused rather than hashed. The service worker rule this mirrors
        // exists because a 404 carrying attacker HTML is a response the browser renders.
        failures.push(`${gateway.name} answered ${String(response.status)} for ${path}`);
        continue;
      }
      hashes[path] = sha256Hex(response.body);
    } catch (error) {
      failures.push(`${gateway.name} could not serve ${path}: ${message(error)}`);
    }
  }
  return { gateway: gateway.name, hashes, failures };
}

/** Fetch one transaction by id — `release.json` and each signature transaction. */
export async function fetchTransaction(
  get: GatewayGet,
  gateway: Gateway,
  txid: string,
): Promise<Uint8Array> {
  const response = await get(formatUrl(gateway.rawUrl, { txid }));
  if (response.status < 200 || response.status >= 300) {
    throw new CompareError(`${gateway.name} answered ${String(response.status)} for transaction ${txid}`);
  }
  return response.body;
}

/**
 * Where two gateways disagree about one path.
 *
 * §1.3 asks for at least two gateways and does not say why. This is why: a single gateway
 * that serves wrong bytes is caught by the signed map, and a *pair* that disagree tells the
 * verifier which one to stop using. A file both serve identically and wrongly is still caught,
 * by the map — so this check adds the case the map cannot name.
 */
export function crossGatewayFindings(trees: readonly ServedTree[]): string[] {
  const findings: string[] = [];
  if (trees.length < GATEWAY_FLOOR) {
    findings.push(
      `${trees.length} gateway(s) answered; 12 §1.3 verifies through at least ${GATEWAY_FLOOR}`,
    );
  }
  const paths = new Set<string>();
  for (const tree of trees) for (const path of Object.keys(tree.hashes)) paths.add(path);
  for (const path of [...paths].sort()) {
    const seen = new Map<string, string[]>();
    for (const tree of trees) {
      const hash = tree.hashes[path];
      if (hash === undefined) continue;
      seen.set(hash, [...(seen.get(hash) ?? []), tree.gateway]);
    }
    if (seen.size > 1) {
      const detail = [...seen.entries()]
        .map(([hash, names]) => `${names.join('+')}=${hash.slice(0, 12)}`)
        .join(' ');
      findings.push(`gateways disagree about ${path}: ${detail}`);
    }
  }
  for (const tree of trees) findings.push(...tree.failures);
  return findings;
}

/** One credential as it arrived, before the registry has had anything to say about it. */
export interface SignatureBlob {
  /** Where it came from, for the rejection line. A transaction id, or a file name. */
  readonly source: string;
  readonly text: string;
}

export interface CompareInputs {
  /** The exact bytes of the served `release.json`. The signatures are over their SHA-256. */
  readonly releaseJsonBytes: Uint8Array;
  /** The per-file map the release signed, read from that document by `parseReleaseDocument`. */
  readonly perFileHashes: Readonly<Record<string, Sha256Hex>>;
  readonly localHashes: Readonly<Record<string, Sha256Hex>>;
  readonly servedTrees: readonly ServedTree[];
  /** 12 §2.2's published registry — the only thing that says who holds which key. */
  readonly entries: readonly RegistryEntry[];
  /** The current keyring generation, from `release.json` and cross-checked against the chain. */
  readonly generation: number;
  /** `ReleaseChannel.revoked_key_bits`, when a node was reachable. */
  readonly revokedKeyBits?: bigint | undefined;
  /** Key id to minisign public-key text, from the published keyring. */
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly releaseSignatures: readonly SignatureBlob[];
  readonly attestations: readonly SignatureBlob[];
  readonly minimumSignatures?: number | undefined;
  readonly minimumAttestations?: number | undefined;
}

export interface ServedCheck {
  readonly gateway: string;
  readonly check: SelfCheckResult;
}

export interface CompareReport {
  readonly ok: boolean;
  readonly local: SelfCheckResult;
  readonly served: readonly ServedCheck[];
  readonly gatewayFindings: readonly string[];
  readonly release: Verdict;
  /**
   * What this run did **not** check, named rather than implied.
   *
   * §2.3 point 3 requires `verify-release` to warn loudly when it cannot reach a node for the
   * revocation set. A tool that printed the same verdict either way would make the loud part
   * unwritable, so the unchecked conditions are a field and the CLI gives them their own exit
   * code. An empty list is the only state that means everything §1.3 names was performed.
   */
  readonly unchecked: readonly string[];
}

/**
 * The whole verdict, over supplied bytes.
 *
 * Nothing here fetches. §1.3's promise is a verdict reproducible with no project
 * infrastructure, and a decision function that reached for a gateway could not run in the
 * container §1.3 describes — the same reason `countReleaseSignatures` takes its inputs.
 */
export function compareRelease(inputs: CompareInputs): CompareReport {
  const unchecked: string[] = [];
  const digest = new Uint8Array(createHash('sha256').update(inputs.releaseJsonBytes).digest());

  let keyring;
  if (inputs.revokedKeyBits === undefined) {
    // §2.3 point 3: fetch the revocation set when a node is reachable, and warn loudly when
    // you cannot. Counting against an empty revocation list is the honest arithmetic; saying
    // nothing about it is what turns "not checked" into "checked and clean".
    keyring = { generation: inputs.generation, revokedKeyIds: [] };
    unchecked.push(
      'the on-chain revocation set was not read (12 §2.3). A key revoked in ReleaseChannel ' +
        'still counts in this run, so this verdict cannot detect a compromised signer.',
    );
  } else {
    keyring = keyringFor(inputs.entries, inputs.generation, inputs.revokedKeyBits);
  }

  const signatures = inputs.releaseSignatures.map((blob) =>
    credential(blob, 'release-signer', digest, inputs),
  );
  const attestations = inputs.attestations.map((blob) => attestation(blob, digest, inputs));

  const local = runSelfCheck({ perFileHashes: inputs.perFileHashes }, inputs.localHashes);
  const served = inputs.servedTrees.map((tree) => ({
    gateway: tree.gateway,
    check: runSelfCheck({ perFileHashes: inputs.perFileHashes }, tree.hashes),
  }));
  const gatewayFindings = crossGatewayFindings(inputs.servedTrees);

  const release = releaseVerdict({
    selfCheck: local,
    signatures,
    keyring,
    attestations,
    ...(inputs.minimumSignatures === undefined ? {} : { minimumSignatures: inputs.minimumSignatures }),
    ...(inputs.minimumAttestations === undefined
      ? {}
      : { minimumAttestations: inputs.minimumAttestations }),
  });

  const ok =
    release.ok && gatewayFindings.length === 0 && served.every((entry) => entry.check.ok);
  return { ok, local, served, gatewayFindings, release, unchecked };
}

/**
 * Turn a signature blob into the `{ keyId, generation, valid }` §1.4 counts.
 *
 * The generation comes from the **registry**, never from the caller and never from the
 * signature: minisign carries no generation, and 12 §2.1 makes it a property of the keyring a
 * key belongs to. A signature by a key the registry does not publish is rejected with that as
 * its reason, which is the case §2.2 point 1 exists to make visible.
 */
function credential(
  blob: SignatureBlob,
  population: 'release-signer' | 'attestor',
  digest: Uint8Array,
  inputs: CompareInputs,
): ReleaseSignature {
  let keyId: string;
  try {
    keyId = parseMinisignSignature(blob.text).keyId;
  } catch (error) {
    return { keyId: blob.source, generation: inputs.generation, valid: false, why: message(error) };
  }
  const entry = entryFor(inputs.entries, population, keyId);
  if (entry === undefined || entry.generation === undefined) {
    return {
      keyId,
      generation: inputs.generation,
      valid: false,
      why: `no ${population} entry in the published registry claims key ${keyId} (12 §2.2 point 1)`,
    };
  }
  const publicKey = inputs.publicKeys[keyId];
  if (publicKey === undefined) {
    return {
      keyId,
      generation: entry.generation,
      valid: false,
      why: `the published keyring carries no public key for ${keyId}`,
    };
  }
  try {
    return releaseSignatureFrom(digest, blob.text, publicKey, entry.generation);
  } catch (error) {
    if (error instanceof VerifyError) {
      return { keyId, generation: entry.generation, valid: false, why: error.message };
    }
    throw error;
  }
}

/**
 * The same, plus the organization §1.4 gate 2 counts by — taken from the registry.
 *
 * An attestation whose key nobody published carries no organization, and `countAttestations`
 * refuses one for exactly that reason: independence is the entire claim, and it cannot be
 * shown for an anonymous builder.
 */
function attestation(blob: SignatureBlob, digest: Uint8Array, inputs: CompareInputs): Attestation {
  const signature = credential(blob, 'attestor', digest, inputs);
  const entry = entryFor(inputs.entries, 'attestor', signature.keyId);
  return {
    keyId: signature.keyId,
    organization: entry?.organization,
    valid: signature.valid,
    generation: signature.generation,
    why: signature.why,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The default attestation minimum, re-exported so the CLI can state it in its help text. */
export const DEFAULT_ATTESTATIONS = ATTESTATION_FLOOR;
