/**
 * The `connect-src` allowlist and the gate that keeps it from growing — 12 §5.1, 15 §4.8.
 *
 * FRONTEND_PLAN §9.8's policy is amended in exactly one directive: `connect-src *` becomes
 * an enumerated allowlist, rebuilt per release, containing precisely three classes of
 * entry. This module derives that list from declared sources and refuses anything it
 * cannot attribute to one of them — an allowlist somebody can *write* is an allowlist
 * somebody can add a host to, and 12 §5.1 states the failure mode plainly: a vendor host
 * "is exactly the kind of entry that arrives one release at a time".
 *
 * ## The three classes, and why each is derived rather than listed
 *
 * 1. **Bootnodes.** Taken from the §6.2 operator manifests and the bundled chain specs, as
 *    libp2p multiaddrs, and projected to `wss://host:port`. Derived, because the set that
 *    a browser must dial is the same set the chain spec ships — two hand-kept copies of
 *    that would disagree, and the copy the CSP uses is the one that decides whether the
 *    light client can connect at all.
 * 2. **Gateways.** The baked static ar.io fallback list. Wayfinder's runtime gateway
 *    selection is restricted to the intersection of its network-sourced set with this
 *    list, so this file is the ceiling on where release bytes may be fetched from.
 * 3. **Release-listed providers and RPC fallbacks.** Empty at launch — the opt-in posture
 *    of 10 §8.1 is unchanged — and empty is represented as an empty list rather than an
 *    absent key, so "nobody has added one" and "somebody deleted the section" are
 *    different states.
 *
 * ## The diff gate
 *
 * 15 §4.8 requires "a build-time diff asserting the emitted `connect-src` allowlist gained
 * no entry". The baseline is a committed file, so *adding* an entry is a reviewable diff to
 * two files rather than a silent consequence of editing a source. Removals pass: a release
 * that can reach fewer hosts is a tightening, and a gate that fought it would push
 * operators toward leaving dead endpoints in.
 *
 * This is the honest boundary of the control: it makes an addition visible, not
 * impossible. Nothing mechanical can tell an ar.io gateway from a vendor endpoint that
 * looks like one — that is what review is for, and what D-21's rule is written down for.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The release's **own origin**, always present, and this is not a widening.
 *
 * 12 §5.1 enumerates three classes of *operator* host. `'self'` is not one of them: it is
 * the origin the bundle was already served from, and it must be reachable or the release
 * cannot verify itself — INV-FE-8's self-check fetches `release.json` and the per-file map,
 * app-code rule 13 hashes the bundled chain-spec bytes before handing them to smoldot, and
 * every one of those is a `fetch` and therefore governed by `connect-src`. A policy without
 * it produces an app that loads, renders, and silently cannot run the check that proves it
 * is the app that was published.
 *
 * It adds no exfiltration surface that §5.1 does not already declare: the same-origin host
 * is the gateway, which is allowlisted anyway, and §5.1's "what it does not do" already
 * records that exfiltration *to* an allowlisted gateway via query strings is not stopped.
 *
 * An allowlist with no operator entries therefore renders as `'self'` alone — never as an
 * empty directive, which is a CSP syntax error whose recovery is a fall back to
 * `default-src` (`'none'` here): safe, but silently and totally.
 */
export const OWN_ORIGIN = "'self'";

export class ConnectSrcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConnectSrcError';
  }
}

/**
 * `/dns4/host/tcp/443/wss/p2p/<peer-id>` → `wss://host:443`.
 *
 * Deliberately strict about the shape rather than scanning for a hostname: a multiaddr the
 * projection does not fully understand is one whose dialled origin it is guessing at, and
 * a guessed origin either blocks a bootnode the release meant to allow or allows one it
 * did not. `/wss/` is required because 12 §6.2's commitment is browser-dialable WSS — a
 * `/tcp/` bootnode is for native peers and contributes no `connect-src` entry.
 */
export function originFromMultiaddr(multiaddr) {
  const parts = multiaddr.split('/');
  if (parts[0] !== '') throw new ConnectSrcError(`multiaddr must start with '/': ${multiaddr}`);
  const protocol = parts[1];
  const host = parts[2];
  if (protocol !== 'dns' && protocol !== 'dns4' && protocol !== 'dns6') {
    // `/ip4/` and `/ip6/` bootnodes cannot present a valid TLS certificate for a browser
    // WSS dial, so they are not part of the browser-dialable set 12 §6.2 commits to.
    return undefined;
  }
  if (parts[3] !== 'tcp') throw new ConnectSrcError(`unsupported transport in ${multiaddr}`);
  const port = parts[4];
  if (parts[5] !== 'wss') return undefined;
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) {
    throw new ConnectSrcError(`multiaddr host is not a plain DNS name: ${multiaddr}`);
  }
  if (!/^[0-9]{1,5}$/.test(port ?? '')) {
    throw new ConnectSrcError(`multiaddr port is not numeric: ${multiaddr}`);
  }
  return `wss://${host}:${port}`;
}

/**
 * Normalise and validate one authored origin (classes 2 and 3).
 *
 * Refuses a wildcard outright: `https://*.example` in an allowlist is `connect-src *`
 * scoped to a suffix somebody else may control, and 12 §5.1's whole claim is that egress
 * is bounded by an *enumerated operator set*. Also refuses anything carrying a path,
 * query, credentials or a non-default trailing slash, because a CSP source expression
 * matches by origin and a path here would read as a restriction that is not enforced.
 */
export function normaliseOrigin(raw, allowedSchemes) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ConnectSrcError(`origin must be a non-empty string, got ${JSON.stringify(raw)}`);
  }
  if (raw.includes('*')) {
    throw new ConnectSrcError(`wildcard origins are refused: ${raw}`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectSrcError(`origin is not a URL: ${raw}`);
  }
  if (!allowedSchemes.includes(url.protocol)) {
    throw new ConnectSrcError(
      `${raw} uses ${url.protocol}, but this class allows only ${allowedSchemes.join(', ')}`,
    );
  }
  if (url.username || url.password) throw new ConnectSrcError(`origin carries credentials: ${raw}`);
  if (url.search || url.hash) throw new ConnectSrcError(`origin carries a query or hash: ${raw}`);
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new ConnectSrcError(`origin carries a path, which CSP does not match on: ${raw}`);
  }
  // The host is checked **after** parsing, against a plain DNS alphabet, and that ordering
  // is the point: `new URL()` percent-decodes the hostname, so `https://%2A.example`
  // arrives here as `https://*.example` and the raw-string wildcard check above never sees
  // it — the emitted policy would carry a wildcard nobody wrote. Restricting the decoded
  // host closes the whole percent-encoding class rather than the one spelling of it, and it
  // is the same discipline `originFromMultiaddr` already applies to a bootnode's host.
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) {
    throw new ConnectSrcError(
      `${raw} decodes to the host ${url.hostname}, which is not a plain DNS name; CSP would ` +
        'match it as a source expression rather than as the literal host that was written',
    );
  }
  if (url.port && !/^[0-9]{1,5}$/.test(url.port)) {
    throw new ConnectSrcError(`origin carries a non-numeric port: ${raw}`);
  }
  return url.port ? `${url.protocol}//${url.hostname}:${url.port}` : `${url.protocol}//${url.hostname}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Collect every declared source into classified entries.
 *
 * `blockers` is the readiness channel: a source that is declared but empty is not an error
 * (pre-launch, the operator programs genuinely have no members yet) and is not silence
 * either — it is a named reason this tree cannot become a production release.
 */
export function collectAllowlist(repoRoot, declared) {
  const entries = new Map();
  const blockers = [];
  const add = (origin, sourceClass, provenance) => {
    const existing = entries.get(origin);
    if (existing) {
      existing.provenance.push(provenance);
      return;
    }
    entries.set(origin, { origin, sourceClass, provenance: [provenance] });
  };

  for (const relative of declared.bootnodeManifests) {
    const path = resolve(repoRoot, relative);
    const manifest = readJson(path);
    const operators = manifest.operators;
    if (!Array.isArray(operators)) {
      throw new ConnectSrcError(`${relative}: bootnode manifest has no operators array`);
    }
    if (operators.length === 0) {
      blockers.push(`${relative} lists no bootnode operators (12 §6.2 program not yet seated)`);
    }
    for (const operator of operators) {
      for (const multiaddr of operator.multiaddrs ?? []) {
        const origin = originFromMultiaddr(multiaddr);
        if (origin) add(origin, 'bootnode', `${relative}:${operator.name}`);
      }
    }
  }

  for (const relative of declared.chainSpecs) {
    const path = resolve(repoRoot, relative);
    let spec;
    try {
      spec = readJson(path);
    } catch (error) {
      // A declared chain spec that is not present is a blocker, not a silent omission:
      // the bundle would ship with no relay bootnodes and fail to sync, which is a
      // failure a user meets rather than one CI does.
      blockers.push(`${relative} is declared as a bundled chain spec and is not readable`);
      void error;
      continue;
    }
    for (const multiaddr of spec.bootNodes ?? []) {
      const origin = originFromMultiaddr(multiaddr);
      if (origin) add(origin, 'bootnode', relative);
    }
  }

  for (const raw of declared.gateways) {
    add(normaliseOrigin(raw, ['https:']), 'gateway', 'sources/release-sources.json:gateways');
  }
  if (declared.gateways.length === 0) {
    blockers.push('no ar.io gateway fallback is baked in (12 §5.1 class 2 is empty)');
  }

  for (const raw of declared.providers) {
    add(normaliseOrigin(raw, ['https:']), 'provider', 'sources/release-sources.json:providers');
  }
  for (const raw of declared.rpcFallbacks) {
    add(normaliseOrigin(raw, ['wss:']), 'rpc-fallback', 'sources/release-sources.json:rpcFallbacks');
  }

  return {
    // Sorted, so the emitted policy is a function of the source set and not of file order.
    entries: [...entries.values()].sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0)),
    blockers,
  };
}

/** The directive value that goes into `index.html`'s meta-CSP. */
export function renderConnectSrc(entries) {
  return [OWN_ORIGIN, ...entries.map((entry) => entry.origin)].join(' ');
}

/**
 * 15 §4.8's build-time diff. Returns additions and removals; the caller decides, so the
 * same function serves the gate and the "what changed" line in the readiness report.
 */
export function diffAgainstIncumbent(emitted, incumbent) {
  const before = new Set(incumbent);
  const after = new Set(emitted.map((entry) => entry.origin));
  return {
    additions: [...after].filter((origin) => !before.has(origin)).sort(),
    removals: [...before].filter((origin) => !after.has(origin)).sort(),
  };
}

/** Read the declared sources, refusing a shape that would silently contribute nothing. */
export function readDeclaredSources(path) {
  const document = readJson(path);
  const raw = document.connectSrc;
  if (typeof raw !== 'object' || raw === null) {
    throw new ConnectSrcError('release sources: connectSrc must be an object');
  }
  for (const key of ['bootnodeManifests', 'chainSpecs', 'gateways', 'providers', 'rpcFallbacks']) {
    if (!Array.isArray(raw[key])) {
      // An absent key and an empty list mean different things — "the section was deleted"
      // versus "nobody has added one" — so the absent case is refused rather than
      // defaulted to empty, which would make a deletion look like the launch posture.
      throw new ConnectSrcError(`release sources: ${key} must be an array`);
    }
  }
  return {
    bootnodeManifests: raw.bootnodeManifests,
    chainSpecs: raw.chainSpecs,
    gateways: raw.gateways,
    providers: raw.providers,
    rpcFallbacks: raw.rpcFallbacks,
  };
}
