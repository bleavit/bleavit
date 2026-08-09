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
 * **How to resolve the name.** §1.3's command takes the manifest addresses as arguments, so
 * resolution is not part of this subcommand at all. Resolving `futarchy` across gateways and
 * comparing the answers is §5.2's out-of-band monitor's job, and that tool does it. What this
 * module *does* check is that the address a caller says the name points at contains the tree
 * the release signed — the two are different questions, and only the second is decidable from
 * bytes alone.
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

/**
 * The one path 12 §1.2's second pass adds — the difference between `M` and `M′`.
 *
 * Named once because three separate decisions turn on it: the final manifest MUST list it,
 * MUST resolve it to the transaction whose bytes the signatures are over, and MUST otherwise
 * list exactly what the asset manifest lists.
 */
export const RELEASE_JSON_PATH = 'release.json';

/** An Arweave transaction id: 43 base64url characters, as `arweave.ts` writes them. */
const TXID = /^[A-Za-z0-9_-]{43}$/;

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
 * The host a configured template reaches, reduced to the operator it identifies.
 *
 * Four normalizations, and each one closes a spelling of the same endpoint:
 *
 * 1. **Case**, because a host name is case-insensitive: `ONE.example` is `one.example`.
 * 2. **The port**, dropped entirely rather than defaulted. The question here is *which
 *    operator answers*, not which socket — two ports on one host name is one operator.
 * 3. **Everything after the authority**, so a trailing slash or a different path prefix on
 *    the same host is the same operator. `https://g/raw/{txid}` and `https://g/{txid}` are
 *    one gateway offering two routes.
 * 4. **A leading label that carries a placeholder.** `https://{txid}.g/{path}` is the
 *    sandboxed form an ar.io gateway serves beside `https://g/raw/{txid}`; the label is a
 *    transaction id rather than an identity, so leaving it in would let one operator reach
 *    §1.3's floor with two of its own spellings.
 *
 * The placeholders are not URL syntax, so a template is parsed with each one replaced by a
 * single character that is legal in both a host label and a path segment. A template that is
 * not an absolute http(s) URL is refused here rather than at fetch time: an endpoint whose
 * operator cannot be identified cannot be counted, and `formatUrl` would otherwise hand a
 * relative string to `fetch`.
 */
function endpointHost(template: string, field: string, where: string): string {
  let url: URL;
  try {
    url = new URL(template.replace(/\{[^{}]*\}/g, '0'));
  } catch {
    throw new CompareError(
      `${where}: ${field} ${JSON.stringify(template)} is not an absolute URL, so the operator ` +
        'it reaches cannot be identified — and 12 §1.3 counts gateways by operator.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CompareError(
      `${where}: ${field} ${JSON.stringify(template)} is not an http(s) endpoint`,
    );
  }
  const authority = /:\/\/(?:[^@/?#]*@)?([^/?#]*)/.exec(template)?.[1] ?? '';
  const labels = url.hostname.split('.');
  const sandboxed = authority.split('.')[0]?.includes('{') === true && labels.length > 1;
  return (sandboxed ? labels.slice(1) : labels).join('.');
}

/**
 * Why a configured gateway set is not the several gateways it claims to be — 12 §1.3.
 *
 * §1.3 verifies through at least two gateways, and `crossGatewayFindings` is what that floor
 * is for: a single gateway serving wrong bytes is caught by the signed map, and a *pair* that
 * disagree names which one to stop using. Both halves die if one operator is listed twice.
 * The floor is then satisfied by one response, and the divergence check compares that response
 * with itself and reports agreement — a lying gateway corroborating its own lie, reported as a
 * multi-gateway verification.
 *
 * So a set is admissible only when its rows are **distinct operators at distinct endpoints**,
 * and both halves are required because either alone leaves the hole open: one name against two
 * rows is caught by the name, and two names against one host is caught by the host.
 *
 * ## What this does not catch, stated rather than implied
 *
 * Distinct host names are a *necessary* condition for independent operators, never a
 * sufficient one. One organization holding two domains, a CDN fronting several names, two
 * names resolving to one address, an internationalized name and its punycode alias reaching
 * one server — none of these is decidable from the configuration text, and a checker that
 * guessed at them would refuse legitimate sets. 12 §5.1 leaves *which* operators are
 * independent to the operator naming them; this refuses only the sets that are self-evidently
 * one operator answering twice.
 *
 * Returned as problems rather than thrown, because the two callers report a malformed set in
 * their own error type — a transcript is a fixture defect and a `--gateways` file is an
 * operator's.
 */
export function gatewayIdentityProblems(gateways: readonly Gateway[], where: string): string[] {
  const problems: string[] = [];
  const operators = new Map<string, string>();
  const hosts = new Map<string, string>();
  for (const [index, gateway] of gateways.entries()) {
    const label = `gateways[${String(index)}] ${JSON.stringify(gateway.name)}`;
    const folded = gateway.name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (folded.length === 0) {
      problems.push(
        `${where}${label} declares no operator name. 12 §1.3 counts gateways by operator, so a ` +
          'row nobody is named for cannot be counted as one.',
      );
    } else {
      const seen = operators.get(folded);
      if (seen === undefined) operators.set(folded, label);
      else {
        problems.push(
          `${where}${label} and ${seen} name one operator. Two rows for one operator satisfy ` +
            `12 §1.3's floor of ${GATEWAY_FLOOR} with one response, and the divergence check ` +
            'then compares that response with itself.',
        );
      }
    }
    const rowHosts = new Set([
      endpointHost(gateway.rawUrl, 'rawUrl', `${where}${label}`),
      endpointHost(gateway.txUrl, 'txUrl', `${where}${label}`),
    ]);
    for (const host of rowHosts) {
      const seen = hosts.get(host);
      if (seen === undefined || seen === label) hosts.set(host, label);
      else {
        problems.push(
          `${where}${label} and ${seen} both answer at ${host}. One endpoint under two names is ` +
            `one operator: it satisfies 12 §1.3's floor of ${GATEWAY_FLOOR} with a single ` +
            'response, and the divergence check — whose whole purpose is catching a lying ' +
            'gateway — then has nothing to compare it against.',
        );
      }
    }
  }
  return problems;
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

/** What one gateway's copy of the path manifest says the release contains. */
export interface ManifestEnumeration {
  /** Every path the manifest lists, sorted. Empty when it could not be read. */
  readonly paths: readonly string[];
  /**
   * Path to the transaction the manifest resolves it to, for every entry carrying a
   * well-formed id.
   *
   * Read for **one** binding and deliberately no more: 12 §1.2's final manifest must resolve
   * `release.json` to the sibling transaction whose bytes the signatures are over. The other
   * paths' ids are never compared between the two manifests, because whether an uploader
   * mints new data items when the second pass re-uploads identical bytes is inside FE-P7's
   * open `[VERIFY]` — and a checker that assumed either answer would be resolving it.
   */
  readonly entries: Readonly<Record<string, string>>;
  /** Why it could not be read. A finding carried into the verdict, never a silent skip. */
  readonly failure?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ask a gateway what the manifest lists, rather than deriving the list from the signed map.
 *
 * This is the only way the **unexpected** served file can ever be seen. `runSelfCheck` reports
 * three finding kinds and the third one — a file that was served and nobody signed — is the
 * one a manifest-driven loop structurally cannot reach: derive the fetch list from
 * `perFileHashes` and every path you fetch is a path the release signed, so the branch that
 * exists to catch an injected payload can never fire. A gateway serving an extra file was
 * therefore reported clean.
 *
 * Reading the manifest is not a guess about gateway behaviour: `tools/monitoring/attestation_monitor.py`
 * — the §5.2 monitor, the second independent implementation of this check — already fetches the
 * manifest through its own `raw_url` template and compares its `paths` set against the signed
 * map. This does the same thing through the same kind of operator-configured template, so the
 * two cannot answer the question differently.
 *
 * A manifest that cannot be read returns **no paths and a failure**, never a silent empty list:
 * an unreadable manifest means this gateway was not checked for extra files, and the failure is
 * carried into `crossGatewayFindings` so the verdict cannot come back clean on it.
 */
export async function fetchManifestPaths(
  get: GatewayGet,
  gateway: Gateway,
  manifestTxid: string,
): Promise<ManifestEnumeration> {
  let body: Uint8Array;
  try {
    body = await fetchTransaction(get, gateway, manifestTxid);
  } catch (error) {
    return {
      paths: [],
      entries: {},
      failure: `${gateway.name} would not serve the path manifest ${manifestTxid}, so it was not checked for files nobody signed: ${message(error)}`,
    };
  }
  let document: unknown;
  try {
    document = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (error) {
    return {
      paths: [],
      entries: {},
      failure: `${gateway.name} served a path manifest that is not JSON: ${message(error)}`,
    };
  }
  const paths = isRecord(document) ? document['paths'] : undefined;
  if (!isRecord(paths) || Object.keys(paths).length === 0) {
    return {
      paths: [],
      entries: {},
      failure: `${gateway.name} served a path manifest with no paths object, so the files it lists are unknown`,
    };
  }
  const names: string[] = [];
  const entries: Record<string, string> = {};
  for (const [name, entry] of Object.entries(paths)) {
    if (name.length === 0 || name.split('/').includes('..')) {
      return {
        paths: [],
        entries: {},
        failure: `${gateway.name}'s path manifest lists ${JSON.stringify(name)}, which is not a release-relative path`,
      };
    }
    names.push(name);
    const id = isRecord(entry) ? entry['id'] : undefined;
    // A malformed id is left out rather than recorded as an address. The only consumer is the
    // `release.json` binding below, which reports an absent entry in its own words — so a
    // manifest with no usable id for that path fails there, and never by comparing `undefined`
    // against a transaction that happens to be missing too.
    if (typeof id === 'string' && TXID.test(id)) entries[name] = id;
  }
  return { paths: names.sort(), entries };
}

/** The two manifest addresses 12 §1.2 produces, as one gateway answered for them. */
export interface FinalManifestInputs {
  readonly gateway: string;
  /** `M` — what `release.json` pins, as this gateway lists it. */
  readonly assets: ManifestEnumeration;
  /** `M′` — what the ArNS name is repointed to, as this gateway lists it. */
  readonly final: ManifestEnumeration;
  readonly assetManifestTxid: string;
  readonly finalManifestTxid: string;
  /** The transaction whose bytes were fetched and whose hash the signatures are over. */
  readonly releaseJsonTxid: string;
}

/**
 * Bind `M′` to `M` and to the signed `release.json` transaction — 12 §1.2.
 *
 * §1.2 says the verification CLI checks **both** addresses, and the two checks are not the
 * same check twice. `M` is what the release *authorized*: comparing it against the pin is what
 * makes a manifest serving the right bytes at the wrong address unusable. `M′` is what the
 * name *serves*: it is the address a user's browser resolves, so a release whose `M` is
 * impeccable and whose `M′` carries a payload is a release every user runs the payload from.
 *
 * Three claims are decidable here without assuming anything about gateway or uploader
 * behaviour, and each is 12 §1.2's own arithmetic:
 *
 * 1. `M′` lists `release.json`. §1.2's second pass exists to put it there; a manifest without
 *    it leaves the release pinning a manifest that does not contain it.
 * 2. `M′` resolves that path to the transaction the signatures were verified over. Equal bytes
 *    are not the same claim — `arweave.ts` records why the driver passes the *address* to the
 *    second `uploadTree` — and a byte comparison structurally cannot see the difference.
 * 3. `M′` lists exactly what `M` lists, plus that one path. A path only one of them carries is
 *    a tree the release did not sign in whichever direction it differs.
 *
 * What is **not** claimed: that the two manifests resolve the shared paths to the same
 * transactions. The second pass re-uploads the tree, and whether identical bytes yield
 * identical data items is FE-P7's open `[VERIFY]`. Those paths are checked where the check
 * needs no such answer — by fetching them through `M′` and hashing what comes back.
 */
export function finalManifestFindings(inputs: FinalManifestInputs): string[] {
  const { gateway, assets, final, assetManifestTxid, finalManifestTxid, releaseJsonTxid } = inputs;
  const findings: string[] = [];
  if (final.failure !== undefined) {
    // The unreadable manifest is already carried as a fetch failure; what is added here is
    // that the binding was therefore not performed. Silence would read as performed and clean.
    return [
      `${gateway} did not answer for the final manifest ${finalManifestTxid}, so 12 §1.2's ` +
        'second address was not checked at all',
    ];
  }
  if (assets.failure !== undefined) {
    return [
      `${gateway} did not answer for the asset manifest ${assetManifestTxid}, so the two ` +
        'manifests 12 §1.2 requires checking could not be compared',
    ];
  }

  const servedReleaseJson = final.entries[RELEASE_JSON_PATH];
  if (servedReleaseJson === undefined) {
    findings.push(
      `${gateway}'s final manifest ${finalManifestTxid} lists no ${RELEASE_JSON_PATH} with a ` +
        'usable transaction id (12 §1.2). The second pass exists to put it there, so the ' +
        'release names a manifest that does not contain it.',
    );
  } else if (servedReleaseJson !== releaseJsonTxid) {
    findings.push(
      `${gateway}'s final manifest ${finalManifestTxid} resolves ${RELEASE_JSON_PATH} to ` +
        `${servedReleaseJson}, and the signatures verified here are over ${releaseJsonTxid} ` +
        '(12 §1.2). Two transactions carrying the same bytes today are two objects tomorrow, ' +
        'which is why the manifest binds the address rather than the content.',
    );
  }

  const expected = new Set([...assets.paths, RELEASE_JSON_PATH]);
  const listed = new Set(final.paths);
  for (const path of [...expected].sort()) {
    if (path === RELEASE_JSON_PATH && servedReleaseJson === undefined) continue;
    if (!listed.has(path)) {
      findings.push(
        `${gateway}'s final manifest ${finalManifestTxid} does not list ${path}, which the ` +
          `asset manifest ${assetManifestTxid} does (12 §1.2)`,
      );
    }
  }
  for (const path of [...listed].sort()) {
    if (!expected.has(path)) {
      findings.push(
        `${gateway}'s final manifest ${finalManifestTxid} lists ${path}, which the asset ` +
          `manifest ${assetManifestTxid} does not (12 §1.2)`,
      );
    }
  }
  return findings;
}

/**
 * One gateway's served tree, over the union of what the release signed and what it lists.
 *
 * The union is what makes both directions of divergence reachable. The signed paths catch a
 * file that was altered or withheld; the manifest's own paths catch the file that was added.
 * Fetching only the intersection — which is what deriving the list from `perFileHashes` does —
 * leaves the second class invisible.
 */
export async function fetchGatewayTree(
  get: GatewayGet,
  gateway: Gateway,
  manifestTxid: string,
  signedPaths: readonly string[],
): Promise<GatewayTree> {
  const enumerated = await fetchManifestPaths(get, gateway, manifestTxid);
  const paths = [...new Set([...signedPaths, ...enumerated.paths])].sort();
  const served = await fetchServedTree(get, gateway, manifestTxid, paths);
  const tree =
    enumerated.failure === undefined
      ? served
      : { ...served, failures: [...served.failures, enumerated.failure] };
  return { tree, manifest: enumerated };
}

/**
 * One gateway's answer about one manifest: the bytes it served, and what it listed.
 *
 * The enumeration is returned rather than consumed here because 12 §1.2 has **two** manifests
 * and the caller must compare them. Deriving it twice would fetch the same document twice and,
 * worse, let the two readings disagree.
 */
export interface GatewayTree {
  readonly tree: ServedTree;
  readonly manifest: ManifestEnumeration;
}

/**
 * Where two gateways disagree about one path.
 *
 * §1.3 asks for at least two gateways and does not say why. This is why: a single gateway
 * that serves wrong bytes is caught by the signed map, and a *pair* that disagree tells the
 * verifier which one to stop using. A file both serve identically and wrongly is still caught,
 * by the map — so this check adds the case the map cannot name.
 */
export function crossGatewayFindings(trees: readonly ServedTree[], label = ''): string[] {
  const findings: string[] = [];
  const where = label === '' ? '' : `${label}: `;
  if (trees.length < GATEWAY_FLOOR) {
    findings.push(
      `${where}${trees.length} gateway(s) answered; 12 §1.3 verifies through at least ${GATEWAY_FLOOR}`,
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
      findings.push(`${where}gateways disagree about ${path}: ${detail}`);
    }
  }
  for (const tree of trees) for (const failure of tree.failures) findings.push(`${where}${failure}`);
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
  /** What each gateway served under `M`, the manifest `release.json` pins (12 §1.2). */
  readonly servedTrees: readonly ServedTree[];
  /**
   * What each gateway served under `M′`, the manifest the ArNS name is repointed to.
   *
   * Required rather than optional, and that is the whole design: 12 §1.2 says the CLI checks
   * both addresses, an omitted second one is indistinguishable from a checked one in any
   * report, and the first repair of this defect bound the pinned address and then never
   * fetched the served address at all. An empty list is not a way out either — it is `0`
   * gateways for `M′`, which is below §1.3's floor and fails.
   */
  readonly finalTrees: readonly ServedTree[];
  /** `finalManifestFindings` for every gateway, which the verdict may not come back clean on. */
  readonly manifestFindings: readonly string[];
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
  /**
   * The same check over the tree served under `M′`, against the signed map **plus
   * `release.json`**.
   *
   * The extra entry is not a special case that widens what may be served: 12 §1.2 says `M′`
   * is the signed tree plus that one file, its bytes are the ones fetched by transaction id,
   * and its hash is what every signature is over. Leaving it out would report the document
   * itself as a file nobody signed on every healthy release.
   */
  readonly finalServed: readonly ServedCheck[];
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
  const finalPins = {
    ...inputs.perFileHashes,
    [RELEASE_JSON_PATH]: sha256Hex(inputs.releaseJsonBytes),
  };
  const finalServed = inputs.finalTrees.map((tree) => ({
    gateway: tree.gateway,
    check: runSelfCheck({ perFileHashes: finalPins }, tree.hashes),
  }));
  const gatewayFindings = [
    ...crossGatewayFindings(inputs.servedTrees),
    ...crossGatewayFindings(inputs.finalTrees, 'final manifest'),
    ...inputs.manifestFindings,
  ];

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
    release.ok &&
    gatewayFindings.length === 0 &&
    served.every((entry) => entry.check.ok) &&
    finalServed.every((entry) => entry.check.ok);
  return { ok, local, served, finalServed, gatewayFindings, release, unchecked };
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
