#!/usr/bin/env node
/**
 * 10 §9.4's two lazily-fetched artifact rows — chain specs and release-shipped fallback
 * metadata — measured rather than asserted (F14).
 *
 * Both rows name a **size gate** in their enforcement column and neither had one. They
 * are the same shape as the initial-JS row one line up: a published budget over bytes the
 * release ships, with nothing weighing the bytes.
 *
 * ## Units
 *
 * MB is 10^6 bytes, per the convention 10 §9 states once for the whole section, and gz
 * means DEFLATE at level 9 — the same measurement `check-bundle-budget.ts` and
 * `check-smoldot-budget.ts` take, so the four §9.4 size rows are comparable with each
 * other. Every constant below is bound to its published cell by
 * `tools/ci/check-frontend-budgets.py`.
 *
 * ## Release-shipped fallback metadata (§9.4 row 4, §9.3's blob bound)
 *
 * §9.3 makes releases ship SCALE metadata blobs for supported historical `spec_version`s
 * where the light client cannot retrieve them at depth (FE-P5), and §9.4 budgets the
 * shipped set at **≤ 1.5 MB combined**, derived as *"§9.3's 8-blob cache bound × the
 * measured blob, rounded up for metadata growth. The release cannot ship more blobs than
 * the cache admits."*
 *
 * The candidate set is `app/fixtures/chain-feed/<spec_version>/metadata.scale` — the
 * runtimes this release supports, which 10 §5.1 makes a committed primary/recovery
 * **pair**. Those are the exact bytes an FE-P5 fallback would carry, so measuring them
 * answers the question the row asks *today*, before a shipping decision has been taken:
 * would the fallback fit if it shipped? It also re-measures §9.3's own published blob
 * figures, which nothing did — and which were 0.01 MB low, because 147,008 B is 0.15 MB
 * and the section printed 0.14 (F14; the first thing this gate found).
 *
 * ## Chain specs (§9.4 row 3) — measured over the release, not over the source tree
 *
 * §9.4 budgets the relay, parachain and Asset Hub chain specs at **≤ 3.5 MB combined**, and
 * the subject of that budget is what a browser lazily fetches. So the measurement is taken
 * over `dist/chain-specs/` — the tree `release:build` emits — and not over the repository
 * paths `release-sources.json` names.
 *
 * The distinction is the whole finding this row was rebuilt on (P1 on PR #254). A declared
 * source path is what the release is *built from*: `tools/release/connect-src.ts` opens
 * those files for their bootnode multiaddrs and nothing copied them into the bundle, so a
 * release could pin a chain-spec hash, name its file, weigh it, pass — and ship no chain
 * spec at all. Gzipping a file under `REPO_ROOT` says nothing about the bytes a user
 * downloads.
 *
 * Four bindings replace that, and each is a direction the previous shape could not see:
 *
 * 1. every declared spec must be **emitted**, and it is the emitted bytes that are weighed;
 * 2. every emitted spec must be **declared** — bytes in the release that no declaration
 *    covers are bytes no budget ever saw;
 * 3. every pinned `chainSpecHashes` role must be matched by an emitted file **by SHA-256**,
 *    which is the comparison the client itself makes before handing bytes to smoldot
 *    (10 §4.1). A pin with no matching emitted spec is a boot that fails at the user;
 * 4. a pinned hash with nothing declared still fails, as before.
 *
 * Today the release declares none, pins none and emits none: no production chain exists, so
 * `connectSrc.chainSpecs` is `[]` and both `chainIdentity.chainSpecHashes` are `null` —
 * named readiness blockers that `release:build --production` already refuses on. A size gate
 * over an empty list would measure nothing and report a comfortable number, which is the
 * failure this whole milestone is about, so the empty case **asserts the readiness blocker is
 * still live** and additionally requires the emitted tree to carry no chain spec either. The
 * exemption expires by itself the moment a release pins or ships one.
 *
 * ## Fails closed, and `--witness` proves it can still fail
 *
 * A missing release tree, a missing feed, a feed directory with no metadata blob, a declared
 * chain spec the build never emitted, an emitted spec nothing declares, a pin no emitted file
 * hashes to, and a `release-sources.json` this gate cannot parse all exit non-zero.
 *
 * The `--witness` leg re-runs the same measurements against bounds the committed
 * artifacts must exceed and requires every one of them to be refused. It is not
 * ceremony: this repository has shipped a control defined and unreachable more than once
 * (`FE-HANDOFF-012` had zero emitting call sites), and a size gate whose comparison
 * stopped firing looks exactly like a release that got smaller.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

import { RELEASE_CHAIN_SPEC_DIR } from './release/build.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const CHAIN_FEED = join(APP, 'fixtures', 'chain-feed');
const DIST = join(APP, 'dist');
const RELEASE_SOURCES = join(APP, 'tools', 'release', 'sources', 'release-sources.json');

/** 10 §9.4, "Chain specs (relay + para + Asset Hub, gz, lazy)". Decimal MB. */
const CHAIN_SPEC_BUDGET_GZ_BYTES = 3.5e6;
/** 10 §9.4, "Release-shipped fallback metadata (gz, lazy)". Decimal MB. */
const METADATA_BUDGET_GZ_BYTES = 1.5e6;
/**
 * 10 §9.3's desktop `metadataCache` blob **count** bound. §9.4's row states the release
 * cannot ship more blobs than the cache admits, so the count is a budget in its own right
 * — and at the measured blob size it is the one that actually binds.
 */
const METADATA_BLOB_COUNT_BOUND = 8;
/** 10 §9.3's published per-blob measurement, in decimal MB gz. */
const MEASURED_BLOB_GZ_MB = 0.15;
/** 10 §9.3's published raw size of the committed `metadata.scale`, in bytes. */
const MEASURED_BLOB_RAW_BYTES = 489_180;

/** A budget refusal. Thrown rather than exiting, so the witness leg can require one. */
export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

function refuse(message: string): never {
  throw new BudgetError(message);
}

const mb = (n: number): string => `${(n / 1e6).toFixed(3)} MB`;

function gzBytes(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

/**
 * Compare a measured value against a published one **at the precision it was published**.
 *
 * A fixed tolerance would either reject an honestly-rounded cell or let a cell printed to
 * three decimals drift in the third. The document chooses its own precision; this reads
 * that choice back — the same rule `tools/ci/check-frontend-budgets.py` applies to every
 * other §9 cell.
 */
function agreesAtPublishedPrecision(published: number, measured: number): boolean {
  const text = String(published);
  const places = text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
  const factor = 10 ** places;
  return Math.round(measured * factor) / factor === published;
}

// --------------------------------------------------------- release-shipped metadata

interface Blob {
  readonly specVersion: string;
  readonly raw: number;
  readonly gz: number;
}

/** The committed per-`spec_version` metadata blobs an FE-P5 fallback would carry. */
export function metadataBlobs(): readonly Blob[] {
  if (!existsSync(CHAIN_FEED)) {
    refuse(
      `no ${CHAIN_FEED}; there is no committed runtime feed, so the FE-P5 fallback set cannot ` +
        'be weighed. An absent feed is an unmeasured budget, never a passing one.',
    );
  }
  const blobs: Blob[] = [];
  for (const entry of readdirSync(CHAIN_FEED).sort()) {
    const dir = join(CHAIN_FEED, entry);
    if (!statSync(dir).isDirectory()) continue;
    const blob = join(dir, 'metadata.scale');
    if (!existsSync(blob)) {
      refuse(
        `${entry}/ is a chain-feed runtime directory with no metadata.scale. 10 §5.1 requires ` +
          'the blob per supported spec_version, and a directory this gate skipped is a blob ' +
          "that never counted against §9.4's bundle row.",
      );
    }
    blobs.push({ specVersion: entry, raw: statSync(blob).size, gz: gzBytes(blob) });
  }
  if (blobs.length === 0) {
    refuse(
      'the chain feed holds no runtime directories, so no metadata blob was measured. ' +
        '10 §5.1 requires a committed primary/recovery pair.',
    );
  }
  return blobs;
}

export function checkMetadataBlobs(
  blobs: readonly Blob[],
  budgetBytes: number,
  countBound: number,
  report: boolean,
): void {
  let total = 0;
  for (const { specVersion, raw, gz } of blobs) {
    total += gz;
    if (report) console.log(`  spec_version ${specVersion}: ${mb(raw)} raw -> ${mb(gz)} gz`);
  }
  if (report) {
    console.log(
      `release-shipped fallback metadata (FE-P5 candidate set): ${blobs.length} blob(s), ` +
        `${mb(total)} gz (10 §9.4 budget ${mb(budgetBytes)}, 10 §9.3 count bound ${countBound})`,
    );
  }

  if (blobs.length > countBound) {
    refuse(
      `${blobs.length} blobs against 10 §9.3's ${countBound}-blob desktop cache bound. §9.4 ` +
        'states it plainly: the release cannot ship more blobs than the cache admits, because a ' +
        'shipped blob the cache immediately evicts is bytes the user paid for and cannot use.',
    );
  }
  if (total > budgetBytes) {
    refuse(
      `over 10 §9.4's ${mb(budgetBytes)} budget by ${mb(total - budgetBytes)}. These blobs count ` +
        'against the bundle a user fetches to decode history the light client cannot reach at ' +
        'depth (§9.3, FE-P5).',
    );
  }

  // §9.3 publishes a *measured* blob size and a *measured* raw byte count, and nothing
  // re-measured either. A published measurement that drifts is worse than an assumption:
  // §9.4's 1.5 MB cell is derived from it, so the derivation would stay internally
  // consistent while describing a blob the repository no longer contains.
  const largest = blobs.reduce((a, b) => (b.gz > a.gz ? b : a));
  if (!agreesAtPublishedPrecision(MEASURED_BLOB_GZ_MB, largest.gz / 1e6)) {
    refuse(
      `10 §9.3 publishes a measured blob of ${MEASURED_BLOB_GZ_MB} MB gz; the largest committed ` +
        `blob measures ${(largest.gz / 1e6).toFixed(6)} MB (spec_version ${largest.specVersion}). ` +
        "§9.4's metadata budget is derived from that figure, so it cannot be left stale.",
    );
  }
  if (largest.raw !== MEASURED_BLOB_RAW_BYTES) {
    refuse(
      `10 §9.3 publishes the committed metadata.scale as ${MEASURED_BLOB_RAW_BYTES} B; the ` +
        `largest committed blob is ${largest.raw} B (spec_version ${largest.specVersion}).`,
    );
  }
}

// ------------------------------------------------------------------- chain specs

export interface ReleaseSources {
  readonly chainSpecs: readonly string[];
  readonly chainSpecHashes: Readonly<Record<string, unknown>>;
}

export function readReleaseSources(): ReleaseSources {
  if (!existsSync(RELEASE_SOURCES)) {
    refuse(`no ${RELEASE_SOURCES}; the release declares no sources and nothing can be weighed`);
  }
  const parsed: unknown = JSON.parse(readFileSync(RELEASE_SOURCES, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    refuse(`${RELEASE_SOURCES} is not an object`);
  }
  const root = parsed as Record<string, unknown>;
  const connectSrc = root['connectSrc'];
  const chainIdentity = root['chainIdentity'];
  if (typeof connectSrc !== 'object' || connectSrc === null) {
    refuse(`${RELEASE_SOURCES} declares no connectSrc block`);
  }
  if (typeof chainIdentity !== 'object' || chainIdentity === null) {
    refuse(`${RELEASE_SOURCES} declares no chainIdentity block`);
  }
  const specs = (connectSrc as Record<string, unknown>)['chainSpecs'];
  if (!Array.isArray(specs) || specs.some((s) => typeof s !== 'string')) {
    refuse(
      `${RELEASE_SOURCES}'s connectSrc.chainSpecs is not a list of paths. The chain-spec budget ` +
        'is measured over exactly what a release declares it bundles; an unreadable declaration ' +
        'is an unmeasurable budget.',
    );
  }
  const hashes = (chainIdentity as Record<string, unknown>)['chainSpecHashes'];
  if (typeof hashes !== 'object' || hashes === null) {
    refuse(`${RELEASE_SOURCES}'s chainIdentity declares no chainSpecHashes block`);
  }
  return {
    chainSpecs: specs as readonly string[],
    chainSpecHashes: hashes as Readonly<Record<string, unknown>>,
  };
}

/**
 * The chain specs the release **emits**, read out of the built tree.
 *
 * Exported so `app/tests/budgets` can drive it over a tree it constructs, which is the only
 * way to exercise the emitted-but-undeclared direction without writing into `dist/`.
 */
export function emittedChainSpecs(distDir: string): readonly { name: string; path: string }[] {
  const dir = join(distDir, RELEASE_CHAIN_SPEC_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((file) => statSync(file.path).isFile());
}

/** The digest the client compares a bundled spec against before smoldot sees it (10 §4.1). */
function sha256Of(path: string): string {
  return `0x${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

export function checkChainSpecs(
  sources: ReleaseSources,
  distDir: string,
  budgetBytes: number,
  report: boolean,
): void {
  if (!existsSync(distDir)) {
    refuse(
      `no ${distDir} — run \`pnpm run release:build\` first. §9.4 budgets the specs a release ` +
        'ships, so the emitted tree is the only artifact that can answer this row. A source ' +
        'path is what the release is built from, and a browser fetches none of it.',
    );
  }
  const emitted = emittedChainSpecs(distDir);
  const pinned = Object.entries(sources.chainSpecHashes).filter(([, value]) => value !== null);

  // Declared once each, and one emitted file per declaration. Two declarations resolving to
  // one emitted name would ship one chain under both pins, with list order picking which.
  const declared = new Map<string, string>();
  for (const relative of sources.chainSpecs) {
    const name = basename(relative);
    const clash = declared.get(name);
    if (clash !== undefined) {
      refuse(
        `${relative} and ${clash} both emit as ${RELEASE_CHAIN_SPEC_DIR}/${name}, so the release ` +
          'would carry one of them under both declarations and weigh it once.',
      );
    }
    declared.set(name, relative);
  }

  // The direction a source-path gate structurally cannot see: bytes in the release that no
  // declaration covers are bytes no budget ever weighed and no `connect-src` class derived a
  // bootnode from.
  for (const file of emitted) {
    if (!declared.has(file.name)) {
      refuse(
        `the release emits ${RELEASE_CHAIN_SPEC_DIR}/${file.name}, which no ` +
          'connectSrc.chainSpecs entry declares. A lazily-fetched artifact nobody declared is ' +
          'outside every §9.4 budget and outside 12 §5.1’s derived allowlist.',
      );
    }
  }

  if (declared.size === 0) {
    // Nothing to weigh — but only because no release has ever declared, pinned or shipped a
    // chain spec. That is a live readiness blocker, and this gate expires with it rather than
    // staying green over an empty list forever.
    if (pinned.length > 0) {
      refuse(
        `${RELEASE_SOURCES} pins ${pinned.length} chain-spec hash(es) ` +
          `(${pinned.map(([k]) => k).join(', ')}) while connectSrc.chainSpecs is empty. A release ` +
          'that pins a spec ships a spec, and 10 §9.4 budgets the bundled set at ' +
          `${mb(budgetBytes)} combined. Declare the spec files so they are weighed rather than ` +
          'shipping bytes no budget ever saw.',
      );
    }
    if (report) {
      console.log(
        `chain specs: none declared, none pinned, none emitted into ` +
          `${RELEASE_CHAIN_SPEC_DIR}/. 10 §9.4's ${mb(budgetBytes)} combined budget is ` +
          'UNMEASURED — no production chain exists (both named readiness blockers). This gate ' +
          'starts measuring, and this line stops printing, the moment any of the three changes.',
      );
    }
    return;
  }

  let total = 0;
  for (const [name, relative] of [...declared.entries()].sort()) {
    const file = emitted.find((candidate) => candidate.name === name);
    if (file === undefined) {
      refuse(
        `${relative} is declared as a bundled chain spec and the release emits no ` +
          `${RELEASE_CHAIN_SPEC_DIR}/${name}. Weighing the source file would have called that ` +
          'measured: 10 §4.1 verifies the *bundled* bytes against the release pin, so a spec ' +
          'that never reached the tree is a light client with nothing to boot from.',
      );
    }
    const gz = gzBytes(file.path);
    total += gz;
    if (report) {
      console.log(
        `  ${RELEASE_CHAIN_SPEC_DIR}/${name} (declared ${relative}): ` +
          `${mb(statSync(file.path).size)} raw -> ${mb(gz)} gz`,
      );
    }
  }

  // Every pinned role gets an emitted spec, matched the way the client matches it. This is
  // what makes §9.4's "relay + para + Asset Hub" a requirement on the tree rather than a
  // count: a role whose pin nothing hashes to is a boot that fails at the user.
  for (const [role, hash] of pinned) {
    if (typeof hash !== 'string') {
      refuse(
        `${RELEASE_SOURCES} pins the ${role} chain spec as ${JSON.stringify(hash)}, which is not ` +
          'a digest. A pin that cannot match is a comparison the client always fails.',
      );
    }
    const match = emitted.find((file) => sha256Of(file.path) === hash.toLowerCase());
    if (match === undefined) {
      refuse(
        `${RELEASE_SOURCES} pins the ${role} chain spec at ${hash} and no emitted spec hashes ` +
          `to it (${emitted.map((file) => file.name).join(', ') || 'the tree emits none'}). ` +
          '10 §4.1 refuses bytes that do not match their pin, so this release cannot boot its ' +
          `${role} chain however small the bundle measures.`,
      );
    }
  }

  if (report) {
    console.log(
      `chain specs: ${emitted.length} emitted spec(s), ${mb(total)} gz ` +
        `(10 §9.4 budget ${mb(budgetBytes)} combined)`,
    );
  }
  if (total > budgetBytes) {
    refuse(
      `over 10 §9.4's ${mb(budgetBytes)} combined budget by ${mb(total - budgetBytes)}. §9.4 ` +
        'budgets these checkpoint-trimmed; an untrimmed spec is a warp-sync checkpoint the user ' +
        'downloads before the light client can start.',
    );
  }
}

// ------------------------------------------------------------------------- witness

/**
 * A throwaway release tree carrying one emitted chain spec.
 *
 * The chain-spec witness needs an *emitted* artifact, and the committed tree has none — so
 * it is built in the OS temp directory rather than in `dist/`. Mutating a checked-out
 * repository is how a witness leaves a half-written artifact behind when a case fails, and
 * the whole tree is removed in a `finally` whatever happens.
 */
function withTemporaryRelease<T>(
  specs: Readonly<Record<string, string>>,
  run: (distDir: string) => T,
): T {
  const distDir = mkdtempSync(join(tmpdir(), 'bleavit-artifact-witness-'));
  try {
    mkdirSync(join(distDir, RELEASE_CHAIN_SPEC_DIR), { recursive: true });
    for (const [name, body] of Object.entries(specs)) {
      writeFileSync(join(distDir, RELEASE_CHAIN_SPEC_DIR, name), body);
    }
    return run(distDir);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

/** The bytes every temporary-release case emits, and their digest. */
const WITNESS_SPEC_BODY = JSON.stringify({ id: 'witness', genesis: { raw: {} } });
const WITNESS_SPEC_SHA256 = `0x${createHash('sha256').update(WITNESS_SPEC_BODY).digest('hex')}`;

/**
 * Every comparison this gate makes, run against something the release must be refused for.
 * Each MUST be refused.
 *
 * The metadata cases mutate the **bounds** rather than the committed feed, for the reason
 * above. The chain-spec cases mutate a temporary tree instead, because three of the four
 * bindings are about a *disagreement between a declaration and an emitted tree* and a bound
 * cannot express one. What is proven either way is that the measurement is real and is being
 * compared: a refusal here can only come from bytes that were actually weighed.
 */
function witness(): void {
  const blobs = metadataBlobs();
  const declaredOne = ['deploy/chain-specs/out/relay.json'];
  const cases: Array<{ what: string; run: () => void }> = [
    {
      what: 'the metadata blob-count bound',
      run: () => checkMetadataBlobs(blobs, METADATA_BUDGET_GZ_BYTES, blobs.length - 1, false),
    },
    {
      what: 'the combined metadata size budget',
      run: () => checkMetadataBlobs(blobs, 1, METADATA_BLOB_COUNT_BOUND, false),
    },
    {
      what: 'the chain-spec size budget, over emitted bytes',
      run: () =>
        withTemporaryRelease({ 'relay.json': WITNESS_SPEC_BODY }, (distDir) =>
          checkChainSpecs({ chainSpecs: declaredOne, chainSpecHashes: {} }, distDir, 1, false),
        ),
    },
    {
      what: 'a declared chain spec the release never emitted',
      run: () =>
        withTemporaryRelease({}, (distDir) =>
          checkChainSpecs(
            { chainSpecs: declaredOne, chainSpecHashes: {} },
            distDir,
            CHAIN_SPEC_BUDGET_GZ_BYTES,
            false,
          ),
        ),
    },
    {
      what: 'an emitted chain spec no declaration covers',
      run: () =>
        withTemporaryRelease({ 'relay.json': WITNESS_SPEC_BODY }, (distDir) =>
          checkChainSpecs(
            { chainSpecs: [], chainSpecHashes: {} },
            distDir,
            CHAIN_SPEC_BUDGET_GZ_BYTES,
            false,
          ),
        ),
    },
    {
      what: 'a pinned role that no emitted spec hashes to',
      run: () =>
        withTemporaryRelease({ 'relay.json': WITNESS_SPEC_BODY }, (distDir) =>
          checkChainSpecs(
            { chainSpecs: declaredOne, chainSpecHashes: { relay: `0x${'0'.repeat(64)}` } },
            distDir,
            CHAIN_SPEC_BUDGET_GZ_BYTES,
            false,
          ),
        ),
    },
    {
      what: 'a pinned chain-spec hash with no spec declared for measurement',
      run: () =>
        checkChainSpecs(
          { chainSpecs: [], chainSpecHashes: { relay: '0xdeadbeef' } },
          DIST,
          CHAIN_SPEC_BUDGET_GZ_BYTES,
          false,
        ),
    },
    {
      what: 'an absent release tree',
      run: () =>
        checkChainSpecs(
          { chainSpecs: [], chainSpecHashes: {} },
          join(DIST, 'there-is-no-such-release-tree'),
          CHAIN_SPEC_BUDGET_GZ_BYTES,
          false,
        ),
    },
  ];

  // The positive control: the same tree, declared and pinned consistently, must be admitted.
  // Without it every case above is satisfied by a checker that refuses unconditionally.
  withTemporaryRelease({ 'relay.json': WITNESS_SPEC_BODY }, (distDir) =>
    checkChainSpecs(
      { chainSpecs: declaredOne, chainSpecHashes: { relay: WITNESS_SPEC_SHA256 } },
      distDir,
      CHAIN_SPEC_BUDGET_GZ_BYTES,
      false,
    ),
  );

  let silent = 0;
  for (const { what, run } of cases) {
    try {
      run();
      console.error(`WITNESS DID NOT FIRE — ${what} accepted a violation`);
      silent += 1;
    } catch (error) {
      if (!(error instanceof BudgetError)) throw error;
      console.log(`witness fired: ${what} — ${error.message.slice(0, 90)}…`);
    }
  }
  if (silent > 0) {
    console.error(
      `FAIL ${silent} of ${cases.length} witness case(s) did not fire. A size gate that can no ` +
        'longer refuse reports every release as inside budget.',
    );
    process.exit(1);
  }
  console.log(
    `OK  ${cases.length} witness case(s) fired and the consistent release was admitted; the ` +
      'artifact budgets are live',
  );
}

function main(): void {
  if (process.argv.includes('--witness')) {
    witness();
    return;
  }
  try {
    checkMetadataBlobs(metadataBlobs(), METADATA_BUDGET_GZ_BYTES, METADATA_BLOB_COUNT_BOUND, true);
    checkChainSpecs(readReleaseSources(), DIST, CHAIN_SPEC_BUDGET_GZ_BYTES, true);
  } catch (error) {
    if (!(error instanceof BudgetError)) throw error;
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
  console.log('OK  10 §9.4 lazy-artifact size rows');
}

// Guarded so `app/tests/budgets` can import the checks above and drive them over trees it
// builds. An unguarded `main()` would run the whole gate on import, against `dist/`.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
