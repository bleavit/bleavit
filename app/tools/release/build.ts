#!/usr/bin/env node
/**
 * The release pipeline — 12 §1.1, §5.1–§5.3, F11.
 *
 * One ordered pass over `dist/`, and the order is the design:
 *
 *  1. `vite build` → the asset tree, content-hash-only filenames.
 *  2. `esbuild` → `dist/sw.js`, IIFE, unminified (see `src/application/src/sw.ts`).
 *  3. determinism check — before anything is hashed, so a leaked build path is reported as
 *     itself rather than as a mismatch two environments later.
 *  4. `connect-src` allowlist → substituted into `index.html`.
 *  5. SRI → injected into `index.html`.
 *  6. the per-file SHA-256 map → substituted into `sw.js`.
 *  7. `sbom.cdx.json`, then `release.json`.
 *
 * Steps 4 and 5 come **before** 6 because the worker's map pins `index.html`, so the file
 * must be final before it is hashed. Step 7 comes last because `release.json` pins the
 * worker, which step 6 rewrote. Get either backwards and the release ships a map that
 * refuses its own files — fail-closed, but at the user, which is the wrong place.
 *
 * `--check` re-runs every gate over an existing tree without rebuilding it. `--production`
 * additionally refuses while any readiness blocker stands.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OriginBearing } from './connect-src.ts';
import {
  collectAllowlist,
  diffAgainstIncumbent,
  readDeclaredSources,
  renderConnectSrc,
} from './connect-src.ts';
import { checkDeterminism, environmentProbes } from './normalize.ts';
import type { ReleaseJsonInputs } from './release-json.ts';
import {
  buildRecipeDigest,
  buildReleaseJson,
  perFileHashes,
  readChainFeed,
  readForeignChainFeed,
  sha256,
  walkTree,
} from './release-json.ts';
import { buildSbom, parseLockfile } from './sbom.ts';
import { resolveSourceDateEpoch } from './source-date-epoch.ts';
import { injectSri, verifySri } from './sri.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const DIST = join(APP_ROOT, 'dist');
const OUT = join(APP_ROOT, 'release-out');
const SOURCES = join(HERE, 'sources/release-sources.json');
const INCUMBENT = join(HERE, 'sources/incumbent-connect-src.json');

export const CONNECT_SRC_PLACEHOLDER = '__CONNECT_SRC__';
export const ASSET_MAP_PLACEHOLDER = '__BLEAVIT_RELEASE_ASSETS__';

/**
 * What the recipe digest is computed over — the files that decide what the build emits.
 *
 * `src/styles/app.css` is here for the same reason `vite.config.ts` is, and it was added with
 * F28 (Tailwind). The stylesheet is not a source module the bundler discovers through an
 * import graph: it is the CSS **entry**, and it carries the whole Tailwind configuration —
 * the `@theme` tokens and the `@source` directives that decide which files are scanned for
 * class candidates. Two builds could therefore emit visibly different trees from identical
 * source while publishing the same `buildRecipeDigest`, which is a digest asserting that the
 * recipes matched when they did not. The two-environment tree-hash gate would still catch the
 * divergence; this stops `release.json` from making a false claim on the way there.
 *
 * Tailwind needs no config file of its own — v4 configures in CSS, so there is no
 * `tailwind.config.*` and no `postcss.config.*` to add. Should either ever appear, it belongs
 * in this list.
 */
const RECIPE_INPUTS = [
  '.npmrc',
  'index.html',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'src/styles/app.css',
  'tsconfig.base.json',
  'vite.config.ts',
  'tools/release/build.ts',
];

/**
 * Directories copied verbatim into the release tree so a producer can obtain them from the
 * client they are actually running, rather than from a code host (F21).
 */
const PRODUCER_ASSETS = ['schemas', 'skills'];

/**
 * Where the release puts the chain specs it bundles — 10 §4.1, §9.4; app-code rule 13.
 *
 * A chain spec is trusted input to smoldot and the client verifies the **bundled bytes**
 * against the release pin before handing them over, so the bytes have to be *in the
 * release*. Declaring a source path is not shipping one: `connect-src.ts` reads those paths
 * at build time for their bootnode multiaddrs and nothing copied them, so a release could
 * pin a chain-spec hash, name its file, and emit no chain spec for a browser to boot from
 * (P1 on PR #254, 2026-08-06).
 *
 * Exported because `check-artifact-budget.ts` weighs this directory against §9.4's budget.
 * One home for the name: a gate looking in a directory the build does not write measures an
 * empty set and reports a comfortable number.
 */
export const RELEASE_CHAIN_SPEC_DIR = 'chain-specs';

/**
 * A parsed JSON object. Every field is a claim until a reader below checks it.
 *
 * The readers here already treated the sources file as untrusted — `?? {}` and `?? null`
 * everywhere — because it is a hand-maintained document whose fields become release pins.
 * These two helpers are that same posture with a type on it: a non-object where an object
 * was declared collapses to `{}`, so each field then reads `undefined` and lands in
 * `blockers` rather than being handed to `JSON.stringify` as whatever it was.
 */
type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, { cwd: APP_ROOT, stdio: 'inherit' });
}

function buildTree() {
  rmSync(DIST, { recursive: true, force: true });
  run('node', [join(APP_ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
  run('node', [
    join(APP_ROOT, 'node_modules/esbuild/bin/esbuild'),
    'src/application/src/sw.ts',
    '--bundle',
    '--format=iife',
    '--target=es2022',
    // Unminified on purpose: the one file whose job is deciding whether tampered bytes
    // reach a user should be readable at the address it was published from.
    '--minify-syntax=false',
    `--outfile=${join(DIST, 'sw.js')}`,
  ]);
}

/**
 * The two directories a *producer* needs, copied into the release tree (F21).
 *
 * `schemas/` and `skills/` are what somebody hands their analysis tool so that what comes
 * back is something this client will accept. Leaving them out of the bundle would make the
 * documented way to use a released client depend on fetching files from a code host —
 * which is the shape of dependency D-21 exists to remove, even though the handoff being
 * convenience-only (10 §13.5) means no invariant would actually be falsified.
 *
 * Copied **before** anything is hashed, so they land in the worker's baked map like every
 * other file: pinned, verified on read, and refusable if they are not what the release
 * published. A static directory copied in after the map is written would be a same-origin
 * path the worker refuses — fail-closed, at the user, for no reason.
 */
function copyProducerAssets(): void {
  for (const name of PRODUCER_ASSETS) {
    cpSync(join(APP_ROOT, name), join(DIST, name), { recursive: true });
  }
}

/**
 * The declared chain specs, copied into the release tree (10 §4.1, §9.4).
 *
 * Copied **before** anything is hashed, for the same reason `copyProducerAssets` is: the
 * files land in the service worker's baked map, so they are pinned, re-verified on read, and
 * refused if they are not what the release published. A chain spec added to the tree after
 * the map is written would be a same-origin path the worker refuses — and that refusal
 * arrives as a light client that cannot start.
 *
 * A basename collision is refused rather than resolved. Two declarations landing on one
 * emitted file would ship one chain's genesis under both names, and the survivor is whichever
 * was copied last, which is a property of list order rather than of anything anyone decided.
 */
function copyChainSpecs(chainSpecs: readonly string[]): void {
  if (chainSpecs.length === 0) return;
  const target = join(DIST, RELEASE_CHAIN_SPEC_DIR);
  mkdirSync(target, { recursive: true });
  const emitted = new Map<string, string>();
  for (const relative of chainSpecs) {
    const name = basename(relative);
    const clash = emitted.get(name);
    if (clash !== undefined) {
      throw new Error(
        `two declared chain specs share the emitted name ${name} (${clash} and ${relative}). ` +
          'One would overwrite the other and the release would ship one chain under both pins.',
      );
    }
    emitted.set(name, relative);
    const source = resolve(REPO_ROOT, relative);
    if (!existsSync(source)) {
      throw new Error(
        `${relative} is declared as a bundled chain spec and is not on disk, so the release ` +
          'would ship no bytes for it. A missing spec is a light client that cannot start.',
      );
    }
    cpSync(source, join(target, name));
  }
}

function substitute(path: string, placeholder: string, replacement: string, what: string): string {
  const before = readFileSync(path, 'utf8');
  if (!before.includes(placeholder)) {
    throw new Error(
      `${what}: the placeholder ${placeholder} is absent from ${path}. Either it was already ` +
        'substituted (a stale tree) or the source stopped emitting it — both would ship a ' +
        'release whose control was silently not applied.',
    );
  }
  const after = before.replaceAll(placeholder, replacement);
  writeFileSync(path, after);
  return after;
}

/** Blockers are collected from every stage rather than thrown, so one build reports the
 * whole list instead of the first thing missing. */
/** A 32-byte hash as every pinned identity field carries it. */
const HASH32 = /^0x[0-9a-f]{64}$/;

function readChainIdentity(sources: unknown): {
  identity: ReleaseJsonInputs['chainIdentity'];
  blockers: string[];
} {
  const declared = record(record(sources)['chainIdentity']);
  const blockers: string[] = [];
  // **Shape-checked, not merely present.** A pin is what `verifyChainIdentity` compares a
  // live chain against, so an empty string or a truncated hash is not a partial pin — it is
  // a comparison that can never match, shipped in a release the readiness block called
  // ready. Rejecting it here keeps `productionReady` from meaning "somebody typed
  // something".
  //
  // Split into a hash pin and an integer pin because the shape is the check, and typing it
  // exposed a hole in the single untyped one: `paraId` was pinned with no shape argument
  // and no later validation, so a string `"4242"` in the sources file would have shipped as
  // the para-id pin. `ss58Prefix` escaped only because a `Number.isInteger` check sat
  // further down; that check is now the pin itself, for both.
  const missing = (name: string): null => {
    blockers.push(`chain identity: ${name} is unknown (INV-FE-11 requires the bundle to pin it)`);
    return null;
  };
  const malformed = (name: string, value: unknown): null => {
    blockers.push(`chain identity: ${name} is present but malformed (${JSON.stringify(value)})`);
    return null;
  };
  const pinHash = (value: unknown, name: string): string | null => {
    if (value === null || value === undefined) return missing(name);
    if (typeof value !== 'string' || !HASH32.test(value)) return malformed(name, value);
    return value;
  };
  const pinInteger = (value: unknown, name: string): number | null => {
    if (value === null || value === undefined) return missing(name);
    if (typeof value !== 'number' || !Number.isInteger(value)) return malformed(name, value);
    return value;
  };

  const specHashes = record(declared['chainSpecHashes']);
  const genesisHashes = record(declared['genesisHashes']);
  const decimals = declared['decimals'];
  const identity = {
    chainSpecHashes: {
      relay: pinHash(specHashes['relay'], 'relay chain-spec hash'),
      para: pinHash(specHashes['para'], 'parachain chain-spec hash'),
    },
    genesisHashes: {
      relay: pinHash(genesisHashes['relay'], 'relay genesis hash'),
      para: pinHash(genesisHashes['para'], 'parachain genesis hash'),
    },
    ss58Prefix: pinInteger(declared['ss58Prefix'], 'ss58 prefix'),
    paraId: pinInteger(declared['paraId'], 'para id'),
    decimals: isRecord(decimals) ? tokenDecimals(decimals, blockers) : null,
  };
  if (identity.decimals === null) blockers.push('chain identity: token decimals are undeclared');
  // 10 §9.4 budgets **three** bundled chain specs — relay, parachain and Asset Hub — and
  // 11 §11.9.1 opens a second light client against the third. `chainSpecHashes` has room for
  // two, so the Asset Hub spec has no pin for `verifyBundledChainSpec` to compare against and
  // no role any gate could require. Named here rather than discovered by the first release
  // that ships the funding leg, and the blocker expires by itself once the format grows the
  // slot (SQ-720).
  if (!('assetHub' in specHashes)) {
    blockers.push(
      'chain identity: the Asset Hub chain spec has no pin — chainSpecHashes carries relay and ' +
        'para only, while 10 §9.4 budgets relay + para + Asset Hub and 11 §11.9.1 boots a second ' +
        'light client against it (SQ-720)',
    );
  }
  return { identity, blockers };
}

/** `{ VIT: 12, USDC: 6 }` — per-token, and a non-integer entry is a blocker, not a pin. */
function tokenDecimals(declared: JsonRecord, blockers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [token, value] of Object.entries(declared)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      out[token] = value;
      continue;
    }
    blockers.push(`chain identity: ${token} decimals are malformed (${JSON.stringify(value)})`);
  }
  return out;
}

/**
 * The Asset Hub descriptor set (12 §1.1, §1.6; D-12).
 *
 * `release.json` MUST record the Asset Hub descriptor metadata hashes as well as Bleavit's:
 * the funding flow's second light-client connection pins them, and Asset Hub upgrades ride
 * the Fellowship's schedule rather than this protocol's governance.
 *
 * **Read from the committed feed, not from `release-sources.json`.** This was a hand-declared
 * field whose blocker said a release could not choose *which* Asset Hub to pin. There is no
 * standing choice: the rollout phases it, opening Paseo's Asset Hub at Phase 2 and
 * Polkadot's at Phase 3 (08 §2.5; 09 §6.3), so a release pins the Asset Hub of the relay it
 * targets, exactly as it pins the relay. F4 landed every artifact the set needs — the feed
 * directory, the PAPI descriptor entry and `FOREIGN_CHAIN_PINS` — and nothing connected them
 * to this document, so the blocker stood over finished work. Deriving the set removes both
 * the stale claim and the second home for a value the feed already owns.
 * (`tools/ci/check-release-blocker-citations.py` is what keeps the next one from surviving
 * its own ruling; PLAN.md's decision log is where the ruling itself is recorded.)
 *
 * The empty case stays reachable and stays a **named blocker**: a release targeting a relay
 * whose Asset Hub is unpinned ships the deposit leg blocked (`classifyForeign` →
 * `unreachable`), which is a state the rollout has and not one this document may be silent
 * about.
 */
export function readAssetHub(feedDir: string): {
  assetHub: NonNullable<ReleaseJsonInputs['assetHub']>;
  blockers: string[];
} {
  const feed = readForeignChainFeed(feedDir);
  if (Object.keys(feed.descriptorMetadataHashes).length === 0) {
    return {
      assetHub: feed,
      blockers: [
        'Asset Hub descriptor set is unpinned (12 §1.1/§1.6, D-12): the foreign chain feed ' +
          'carries no Asset Hub runtime, so this release would ship the deposit leg blocked ' +
          '(10 §5.2 reports the foreign chain as `unreachable`)',
      ],
    };
  }
  return { assetHub: feed, blockers: [] };
}

function readSigning(sources: unknown): {
  signing: ReleaseJsonInputs['signing'];
  blockers: string[];
} {
  const declared = record(record(sources)['signing']);
  const rawKeyIds = declared['keyIds'];
  const keyIds = Array.isArray(rawKeyIds) ? rawKeyIds.map((id: unknown) => String(id)) : [];
  const blockers: string[] = [];
  // 12 §1.4's release-signature floor: ≥ 2 valid signatures from **distinct active keys**.
  // Counted on the *distinct* set, because the word doing the work in that clause is
  // "distinct": `["K", "K"]` is two entries and one key, and one key is exactly the
  // unilateral shipping authority §2.2 exists to prevent. Checked here on the declared
  // keyring so a release cannot be assembled against one that could never satisfy the
  // floor, whatever the signing step later produces.
  const distinct = new Set(keyIds);
  if (distinct.size < 2) {
    blockers.push(
      `release signing: ${distinct.size} distinct key id(s) declared out of ${keyIds.length} ` +
        'entries; 12 §1.4 fixes a floor of two distinct active keys, so a one-key release ' +
        'would make a single key a unilateral shipping authority',
    );
  }
  // §2.1 makes the generation a `u32` carried in both `release.json` and `ReleaseChannel`;
  // an absent one leaves an old bundle unable to say which keyring it verified against, and
  // §2.3's revocation bitmask is indexed within a generation.
  //
  // A generation that fails the check becomes `null` rather than being carried through: a
  // document whose readiness block says "no keyring generation declared" while the field
  // itself reads `-1` states two different things about the same fact, and the one a
  // consumer parses is the field.
  const rawGeneration = declared['keyringGeneration'];
  const keyringGeneration =
    typeof rawGeneration === 'number' && Number.isInteger(rawGeneration) && rawGeneration >= 0
      ? rawGeneration
      : null;
  if (keyringGeneration === null) {
    blockers.push('release signing: no keyring generation declared (12 §2.1, §2.3)');
  }
  return { signing: { keyIds, keyringGeneration }, blockers };
}

/**
 * The committed 15 §4.8 diff baseline.
 *
 * Refuses a document with no `allowlist` array rather than treating it as empty, because an
 * empty incumbent makes *every* emitted entry an addition — which sounds fail-closed and is
 * the opposite: the build then fails on a policy nobody changed, and the obvious way to get
 * a green build again is to write the current allowlist into the baseline, which is exactly
 * the review step the gate exists to force.
 */
function readIncumbentAllowlist(path: string): readonly string[] {
  const document = record(JSON.parse(readFileSync(path, 'utf8')));
  const allowlist = document['allowlist'];
  if (!Array.isArray(allowlist) || allowlist.some((entry: unknown) => typeof entry !== 'string')) {
    throw new Error(`${path}: the incumbent connect-src baseline must be an array of origins`);
  }
  return allowlist.filter((entry: unknown): entry is string => typeof entry === 'string');
}

export interface PipelineOptions {
  readonly check?: boolean;
}

export function pipeline({ check = false }: PipelineOptions = {}) {
  // 0 — the recipe's own variable, before any child process exists to inherit it (12 §1.1).
  // Set here rather than in the CI step that invokes this, so a local build carries the same
  // recipe as a CI one; the chain-side `tools/release/build-runtime.sh` puts it in the build
  // script for the same reason. It does not make a clock-reading tool deterministic — only
  // one that honours the convention — so the byte-identical claim still rests on the tree
  // being clock-free and on the two-environment compare that proves it.
  resolveSourceDateEpoch(REPO_ROOT);

  const sources: unknown = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const declared = readDeclaredSources(SOURCES);
  const blockers: string[] = [];

  if (!check) {
    buildTree();
    copyProducerAssets();
    copyChainSpecs(declared.chainSpecs);
  }

  // 3 — determinism, before anything is hashed.
  const files = walkTree(DIST);
  const determinism = checkDeterminism(DIST, files, environmentProbes({ appRoot: APP_ROOT }));
  if (determinism.length > 0) {
    for (const finding of determinism) console.error(`  ${finding.detail}`);
    throw new Error(`${determinism.length} environment-specific string(s) in the built tree`);
  }

  // 4 — the connect-src allowlist and 15 §4.8's no-growth diff.
  const allowlist = collectAllowlist(REPO_ROOT, declared);
  blockers.push(...allowlist.blockers);
  const incumbent = readIncumbentAllowlist(INCUMBENT);
  const diff = assertNoAllowlistGrowth(allowlist.entries, incumbent);
  const connectSrc = renderConnectSrc(allowlist.entries);
  const indexPath = join(DIST, 'index.html');
  if (!check) substitute(indexPath, CONNECT_SRC_PLACEHOLDER, connectSrc, 'connect-src');

  // 5 — SRI over the final HTML.
  const resolveBytes = (href: string): Uint8Array | undefined => {
    const relativePath = href.replace(/^\.?\//, '');
    try {
      return readFileSync(join(DIST, relativePath));
    } catch {
      return undefined;
    }
  };
  if (!check) {
    writeFileSync(indexPath, injectSri(readFileSync(indexPath, 'utf8'), resolveBytes).html);
  }

  // 6 — the worker's baked map, over the now-final tree, excluding the worker itself.
  const assetHashes = perFileHashes(DIST, { exclude: ['sw.js'] });
  if (!check) {
    const mapJson = JSON.stringify(assetHashes);
    const escaped = JSON.stringify(mapJson).slice(1, -1);
    substitute(join(DIST, 'sw.js'), ASSET_MAP_PLACEHOLDER, escaped, 'service-worker asset map');
  } else {
    // In `--check` the map already exists, and the useful question is not whether the
    // placeholder is gone but whether what replaced it still describes this tree. A stale or
    // edited map is the failure that matters: the worker would refuse files the release
    // actually contains, or accept ones it does not, and the placeholder check sees neither.
    const baked = readBakedAssetMap(readFileSync(join(DIST, 'sw.js'), 'utf8'));
    const expected = JSON.stringify(assetHashes, Object.keys(assetHashes).sort());
    if (JSON.stringify(baked, Object.keys(baked).sort()) !== expected) {
      throw new Error(
        "the service worker's baked asset map does not describe this tree; it pins " +
          `${Object.keys(baked).length} file(s) and the tree has ${Object.keys(assetHashes).length}, ` +
          'or a digest differs',
      );
    }
  }

  // 7 — SBOM, then release.json over the complete tree.
  const components = parseLockfile(readFileSync(join(APP_ROOT, 'pnpm-lock.yaml'), 'utf8'));
  const appPackage = record(JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')));
  const packageName = String(appPackage['name'] ?? '');
  const packageVersion = String(appPackage['version'] ?? '');
  const sbom = buildSbom(components, { name: packageName, version: packageVersion });
  const sbomBytes = `${JSON.stringify(sbom, null, 2)}\n`;

  const chainFeed = readChainFeed(join(APP_ROOT, 'fixtures/chain-feed'));
  const { identity, blockers: identityBlockers } = readChainIdentity(sources);
  const { signing, blockers: signingBlockers } = readSigning(sources);
  const { assetHub, blockers: assetHubBlockers } = readAssetHub(
    join(APP_ROOT, 'fixtures/foreign-chain-feed'),
  );
  blockers.push(...identityBlockers, ...signingBlockers, ...assetHubBlockers);
  if (packageVersion === '0.0.0') {
    blockers.push('app/package.json still carries version 0.0.0, which no release may publish');
  }

  // **A dirty worktree is a readiness blocker.** `release.json` records `HEAD` as the commit
  // the tree was built from, and 12 §1.3's independent verification is a `git checkout
  // <commit>` followed by the same build — so a build carrying uncommitted changes publishes
  // a claim that a third-party rebuild will falsify, having done nothing wrong. It is a
  // blocker rather than a hard failure because every per-commit CI run of this pipeline
  // happens on a clean tree while every local one does not, and a gate that refused would
  // simply stop being run locally.
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (dirty.length > 0) {
    blockers.push(
      `the worktree has ${dirty.split('\n').length} uncommitted change(s), so the recorded ` +
        'source commit does not describe these bytes and an independent rebuild would differ',
    );
  }

  const release = buildReleaseJson({
    version: packageVersion,
    assetHub,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    buildRecipe: buildRecipeDigest(APP_ROOT, RECIPE_INPUTS),
    files: perFileHashes(DIST),
    chainFeed,
    chainIdentity: identity,
    connectSrc: allowlist.entries.map((entry) => entry.origin),
    sbomSha256: sha256(sbomBytes),
    signing,
    blockers,
  });

  if (!check) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'sbom.cdx.json'), sbomBytes);
    writeFileSync(join(OUT, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  }

  // The gates that must hold over any tree, built or checked.
  const finalHtml = readFileSync(indexPath, 'utf8');
  if (finalHtml.includes(CONNECT_SRC_PLACEHOLDER)) {
    throw new Error('index.html still carries the connect-src placeholder');
  }
  if (!finalHtml.includes('integrity="sha384-')) {
    throw new Error('index.html carries no SRI attribute; 12 §5.3 requires one per subresource');
  }
  // Recomputed, not counted. A present-but-wrong digest is the case that matters more than
  // a missing one: the browser refuses to execute and the app is blank — fail-closed and
  // completely opaque — and only re-deriving from the emitted bytes can see it.
  const sriMismatches = verifySri(finalHtml, resolveBytes);
  if (sriMismatches.length > 0) {
    throw new Error(
      `${sriMismatches.length} SRI digest(s) do not match the emitted file: ` +
        sriMismatches.map((hit) => `${hit.href} declares ${hit.declared}, file is ${hit.actual}`).join('; '),
    );
  }
  const worker = readFileSync(join(DIST, 'sw.js'), 'utf8');
  if (worker.includes(ASSET_MAP_PLACEHOLDER)) {
    throw new Error('sw.js still carries the asset-map placeholder; it would refuse to install');
  }
  assertNoTestOnlySigner(DIST, files);
  // Held over any tree, built or checked, because `--check` does not copy: a re-checked tree
  // that lost its chain specs is exactly the release this gate exists to refuse.
  assertChainSpecsEmitted(DIST, declared.chainSpecs);

  return { release, sbom, allowlist, connectSrc, diff, assetHashes, blockers, files, sources };
}

/**
 * 15 §4.8's build-time no-growth gate, as its own exported function.
 *
 * Extracted from the pipeline body so the suite can exercise **the enforcement** rather than
 * the diff. A test asserting only that `diffAgainstIncumbent` reports an addition would stay
 * green with the `throw` deleted — which is the shape of vacuity this repository keeps
 * finding, and the reason the production path and the tested path are now the same call.
 */
export function assertNoAllowlistGrowth(
  entries: readonly OriginBearing[],
  incumbent: readonly string[],
): ReturnType<typeof diffAgainstIncumbent> {
  const diff = diffAgainstIncumbent(entries, incumbent);
  if (diff.additions.length > 0) {
    throw new Error(
      `the emitted connect-src allowlist gained ${diff.additions.length} entr(y|ies) against ` +
        `the incumbent release (15 §4.8): ${diff.additions.join(', ')}. If the addition is ` +
        'intended, record it in tools/release/sources/incumbent-connect-src.json — D-21 ' +
        'forbids an external-tool vendor host outright.',
    );
  }
  return diff;
}

/** Recover the substituted map from a built `sw.js`. Exported so the suite reads it the same
 * way `--check` does, rather than each having its own idea of the encoding. */
export function readBakedAssetMap(workerSource: string): Record<string, string> {
  const encoded = /RELEASE_ASSETS_JSON\s*=\s*"((?:\\.|[^"\\])*)"/.exec(workerSource);
  if (!encoded) throw new Error('sw.js carries no substituted asset map');
  return JSON.parse(JSON.parse(`"${encoded[1]}"`));
}

/**
 * Every declared chain spec is present in the emitted tree — 10 §4.1, §9.4.
 *
 * The declaration and the emission are separate acts, and until F14's review round only the
 * first existed: `release-sources.json` could name a spec, `connect-src.ts` could take its
 * bootnodes, `chainIdentity` could pin its hash, and `dist/` could contain no chain spec at
 * all. The client verifies bundled bytes against that pin (§4.1), so the shipped release
 * would fail at the user with a hash comparison against nothing.
 */
export function assertChainSpecsEmitted(distDir: string, chainSpecs: readonly string[]): void {
  const missing = chainSpecs.filter(
    (relative) => !existsSync(join(distDir, RELEASE_CHAIN_SPEC_DIR, basename(relative))),
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} declared chain spec(s) are absent from the emitted release tree ` +
        `(${missing.join(', ')}). 10 §4.1 verifies the *bundled* bytes against the release pin, ` +
        'so a spec that never reached dist/ is a light client with nothing to boot from.',
    );
  }
}

/**
 * 10 §10.1's last firewall rule: no signer adapter marked test-only may appear in a release
 * chunk.
 *
 * Checked over the **emitted bundle**, not the source graph, because that is where the rule
 * can actually fail: a tree-shaking regression, a barrel export, or a test helper reached
 * through a re-export all put the symbol in a chunk while every import in the source looked
 * fine. It is the one gate here that dependency-cruiser structurally cannot answer.
 */
export function assertNoTestOnlySigner(distDir: string, files: readonly string[]): void {
  const markers = ['MockSigner', 'mock-signer', '@bleavit/signing/testing'];
  const found: { path: string; marker: string }[] = [];
  for (const path of files) {
    if (!/\.(js|css|html)$/.test(path)) continue;
    const text = readFileSync(join(distDir, path), 'utf8');
    for (const marker of markers) if (text.includes(marker)) found.push({ path, marker });
  }
  if (found.length > 0) {
    throw new Error(
      `a test-only signer reached the release tree (10 §10.1): ` +
        found.map((hit) => `${hit.path} contains ${hit.marker}`).join('; '),
    );
  }
}

function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const production = argv.includes('--production');
  const result = pipeline({ check });

  console.log(`${result.files.length} files; connect-src ${result.connectSrc}`);
  if (result.diff.removals.length > 0) {
    console.log(`connect-src removed since the incumbent: ${result.diff.removals.join(', ')}`);
  }
  if (result.blockers.length > 0) {
    console.log(`\n${result.blockers.length} readiness blocker(s):`);
    for (const blocker of result.blockers) console.log(`  - ${blocker}`);
  }
  if (production && result.blockers.length > 0) {
    console.error('\nrefusing to certify a production release while blockers stand (12 §1.4)');
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
