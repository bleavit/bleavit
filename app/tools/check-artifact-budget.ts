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
 * figures, which nothing did — and which were 0.01 MB low, because 146,946 B is 0.15 MB
 * and the section printed 0.14 (F14; the first thing this gate found).
 *
 * ## Chain specs (§9.4 row 3)
 *
 * §9.4 budgets the relay, parachain and Asset Hub chain specs at **≤ 3.5 MB combined**.
 * `tools/release/sources/release-sources.json` is where a release declares which chain
 * specs it bundles, and today it declares none: no production chain exists, so
 * `connectSrc.chainSpecs` is `[]` and both `chainIdentity.chainSpecHashes` are `null` —
 * named readiness blockers that `release:build --production` already refuses on.
 *
 * A size gate over an empty list would measure nothing and report a comfortable number,
 * which is the failure this whole milestone is about. So when the list is empty this gate
 * does not pass quietly: it **asserts the readiness blocker is still live**, and fails if
 * a chain-spec hash has been pinned while no spec is declared for measurement. The
 * exemption therefore expires by itself the moment a release actually pins a chain spec,
 * rather than living on as a permanently green check over nothing.
 *
 * ## Fails closed, and `--witness` proves it can still fail
 *
 * A missing feed, a feed directory with no metadata blob, a declared chain spec that is
 * not on disk, and a `release-sources.json` this gate cannot parse all exit non-zero.
 *
 * The `--witness` leg re-runs the same measurements against bounds the committed
 * artifacts must exceed and requires every one of them to be refused. It is not
 * ceremony: this repository has shipped a control defined and unreachable more than once
 * (`FE-HANDOFF-012` had zero emitting call sites), and a size gate whose comparison
 * stopped firing looks exactly like a release that got smaller.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO_ROOT = resolve(APP, '..');
const CHAIN_FEED = join(APP, 'fixtures', 'chain-feed');
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
const MEASURED_BLOB_RAW_BYTES = 469_581;

/** A budget refusal. Thrown rather than exiting, so the witness leg can require one. */
class BudgetError extends Error {
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
function metadataBlobs(): readonly Blob[] {
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

function checkMetadataBlobs(
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

interface ReleaseSources {
  readonly chainSpecs: readonly string[];
  readonly chainSpecHashes: Readonly<Record<string, unknown>>;
}

function readReleaseSources(): ReleaseSources {
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

function checkChainSpecs(sources: ReleaseSources, budgetBytes: number, report: boolean): void {
  const pinned = Object.entries(sources.chainSpecHashes).filter(([, value]) => value !== null);

  if (sources.chainSpecs.length === 0) {
    // Nothing to weigh — but only because no release has ever pinned a chain spec. That
    // is a live readiness blocker, and this gate expires with it rather than staying
    // green over an empty list forever.
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
        `chain specs: none declared. 10 §9.4's ${mb(budgetBytes)} combined budget is UNMEASURED — ` +
          'no production chain exists, so `release-sources.json` declares no bundled spec and ' +
          'pins no chain-spec hash (both named readiness blockers). This gate starts measuring, ' +
          'and this line stops printing, the moment either changes.',
      );
    }
    return;
  }

  let total = 0;
  for (const relative of sources.chainSpecs) {
    const path = resolve(REPO_ROOT, relative);
    if (!existsSync(path) || !statSync(path).isFile()) {
      refuse(
        `${relative} is declared as a bundled chain spec and is not on disk. A declared spec that ` +
          'cannot be weighed is not a smaller bundle; it is an unmeasured one.',
      );
    }
    const gz = gzBytes(path);
    total += gz;
    if (report) console.log(`  ${relative}: ${mb(statSync(path).size)} raw -> ${mb(gz)} gz`);
  }
  if (report) {
    console.log(
      `chain specs: ${sources.chainSpecs.length} spec(s), ${mb(total)} gz ` +
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
 * Every comparison this gate makes, run against a bound the committed artifacts must
 * violate. Each MUST be refused.
 *
 * The mutations are of the **bounds**, not of the tree, because mutating the tree in a
 * checked-out repository is how a witness leaves a half-written artifact behind when it
 * fails. What is proven is that the measurement is real and is being compared: a refusal
 * here can only come from bytes that were actually weighed.
 */
function witness(): void {
  const blobs = metadataBlobs();
  const sources = readReleaseSources();
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
      what: 'the chain-spec size budget',
      run: () =>
        checkChainSpecs(
          { chainSpecs: [SELF_AS_SPEC], chainSpecHashes: sources.chainSpecHashes },
          1,
          false,
        ),
    },
    {
      what: 'a pinned chain-spec hash with no spec declared for measurement',
      run: () =>
        checkChainSpecs(
          { chainSpecs: [], chainSpecHashes: { relay: '0xdeadbeef' } },
          CHAIN_SPEC_BUDGET_GZ_BYTES,
          false,
        ),
    },
    {
      what: 'a declared chain spec that is not on disk',
      run: () =>
        checkChainSpecs(
          { chainSpecs: ['deploy/chain-specs/out/there-is-no-such-spec.json'], chainSpecHashes: {} },
          CHAIN_SPEC_BUDGET_GZ_BYTES,
          false,
        ),
    },
  ];

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
  console.log(`OK  ${cases.length} witness case(s) fired; the artifact budgets are live`);
}

/**
 * A real file, used only to give the chain-spec witness bytes to weigh. Any committed file
 * would do; this one is guaranteed present because it is this gate.
 */
const SELF_AS_SPEC = 'app/tools/check-artifact-budget.ts';

function main(): void {
  if (process.argv.includes('--witness')) {
    witness();
    return;
  }
  try {
    checkMetadataBlobs(metadataBlobs(), METADATA_BUDGET_GZ_BYTES, METADATA_BLOB_COUNT_BOUND, true);
    checkChainSpecs(readReleaseSources(), CHAIN_SPEC_BUDGET_GZ_BYTES, true);
  } catch (error) {
    if (!(error instanceof BudgetError)) throw error;
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
  console.log('OK  10 §9.4 lazy-artifact size rows');
}

main();
