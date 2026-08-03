#!/usr/bin/env node
/**
 * Generate `packages/descriptors/src/critical-surface.ts` from the frozen release manifest.
 *
 * 10 §5.4 forbids chain values as literals in frontend source, and app-code rule 7 makes
 * that concrete for this file: `CRITICAL_SURFACE` is **generated** from
 * `tools/release/surface-manifest.json`, never hand-listed. The reason is the one F2 kept
 * finding — a hand-maintained copy of a frozen surface is consistent with everyone who
 * reads it and is compared to nothing, so it drifts silently. Here the manifest is the
 * single source, the output is committed (the build must work offline), and
 * `--check` re-derives and byte-compares.
 *
 * The manifest's `properties` entry is deliberately excluded: it is chain *identity*
 * (ss58, decimals, symbol), verified by the genesis/spec pin at boot, not a runtime
 * surface a compat probe can ask about.
 *
 *   node tools/generate-critical-surface.mjs [--check]
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const MANIFEST = resolve(APP, '..', 'tools', 'release', 'surface-manifest.json');
const OUT = resolve(APP, 'packages', 'descriptors', 'src', 'critical-surface.ts');

/** The manifest kind → the PAPI compat group that answers for it. */
const GROUP = {
  runtime_api: 'apis',
  storage: 'query',
  constant: 'constants',
  event: 'event',
  // A raw fixed-layout key (02 §12's `ReleaseChannel`) has no metadata entry by design —
  // it is readable *without* current metadata, which is what makes the newer-release
  // pointer reachable from `ReadOnlyIncompatible`. It is therefore never probed.
  raw_storage: null,
  properties: null,
};

function memberOf(entry) {
  switch (entry.kind) {
    case 'runtime_api':
      return { group: entry.api, name: entry.method };
    case 'storage':
      return { group: entry.pallet, name: entry.item };
    case 'constant':
      return { group: entry.pallet, name: entry.constant };
    case 'event':
      return { group: entry.pallet, name: entry.event };
    default:
      return null;
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const rows = [];
let unprobed = 0;

for (const entry of manifest.entries) {
  const group = GROUP[entry.kind];
  if (group === undefined) {
    throw new Error(`surface-manifest.json has an unmapped kind ${JSON.stringify(entry.kind)}`);
  }
  if (group === null) {
    unprobed += 1;
    continue;
  }
  const member = memberOf(entry);
  rows.push({
    id: entry.id,
    compatGroup: group,
    pallet: member.group,
    member: member.name,
    required: entry.required === true,
    citation: entry.citation,
  });
}

rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const body = `/**
 * GENERATED — do not edit. Source: \`tools/release/surface-manifest.json\` (contract v${manifest.integration_contract_version}).
 * Regenerate: \`pnpm -C app run surface:generate\`; verified by \`pnpm -C app run surface:check\`.
 *
 * 10 §5.2's \`CRITICAL_SURFACE\`: every runtime API, storage item, constant and event the
 * app binds to, in the form a PAPI compatibility probe can ask about. Hand-listing it is
 * banned (app-code rule 7) because a hand-maintained copy of a frozen surface is
 * consistent with everyone who reads it and compared to nothing.
 *
 * **What is not here, and why.** The manifest carries no \`call\` entries — doc 02 freezes
 * the *read* contract (APIs, views, events, storage, constants, identity) and has no
 * extrinsic section at all — while 10 §5.2 names calls as part of \`CRITICAL_SURFACE\` and
 * 10 §3.2 makes \`restricted\` signing "per-surface", whose unit is exactly the call. That
 * gap is SQ-574. Until it closes, \`callIsProven()\` answers \`false\` for every call, which
 * is INV-FE-12's fail-closed reading: an unproven capability is *absent*, and absence
 * disables the dependent surface with a named reason.
 */

/** The PAPI compat group that answers for a surface (\`api.getStaticApis().compat[group]\`). */
export type CompatGroup = 'apis' | 'query' | 'constants' | 'event';

export interface CriticalSurfaceEntry {
  readonly id: string;
  readonly compatGroup: CompatGroup;
  /** Pallet name, or runtime-API trait name for \`apis\`. */
  readonly pallet: string;
  readonly member: string;
  readonly required: boolean;
  readonly citation: string;
}

export const INTEGRATION_CONTRACT_VERSION = ${manifest.integration_contract_version};

/** Manifest entries with no metadata surface to probe (raw fixed-layout key, chain properties). */
export const UNPROBED_MANIFEST_ENTRIES = ${unprobed};

/**
 * Every published surface id, as a **literal union**.
 *
 * Generated rather than derived from \`CRITICAL_SURFACE\` with
 * \`(typeof CRITICAL_SURFACE)[number]['id']\`, which looks equivalent and is not: the array
 * carries an explicit \`readonly CriticalSurfaceEntry[]\` annotation, so its \`id\`s widen to
 * \`string\` and any consumer indexing into it gets a type that accepts every string. That
 * version shipped, and a clause citing \`storage.epoch.nonexistent\` compiled clean — a
 * binding that reads as a compile-time check and is not one.
 */
export type SurfaceId =
${rows.map((r) => `  | ${JSON.stringify(r.id)}`).join('\n')};

export const CRITICAL_SURFACE: readonly CriticalSurfaceEntry[] = [
${rows
  .map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, compatGroup: ${JSON.stringify(r.compatGroup)}, pallet: ${JSON.stringify(
        r.pallet,
      )}, member: ${JSON.stringify(r.member)}, required: ${r.required}, citation: ${JSON.stringify(r.citation)} },`,
  )
  .join('\n')}
];
`;

/**
 * Cross-check `spec-versions.ts` against the committed feed.
 *
 * The map is the app's answer to "which runtimes can this release talk to", and 10 §5.1
 * makes that a *per-artifact* commitment. Left uncompared it is four numbers and two
 * hashes someone typed — so it is compared, in both directions, to the directories that
 * actually exist. Half a pair or a stale hash is a build failure rather than a runtime
 * surprise.
 */
function checkSpecVersions() {
  const feedRoot = resolve(APP, 'fixtures', 'chain-feed');
  const source = readFileSync(resolve(APP, 'packages', 'descriptors', 'src', 'spec-versions.ts'), 'utf8');
  const declared = new Map();
  for (const block of source.split('{').slice(1)) {
    const specVersion = block.match(/specVersion:\s*(\d+)/);
    const profile = block.match(/profile:\s*'([^']+)'/);
    const contract = block.match(/integrationContractVersion:\s*(\d+)/);
    const sha = block.match(/metadataSha256:\s*'([0-9a-f]{64})'/);
    if (specVersion && profile && contract && sha) {
      declared.set(Number(specVersion[1]), {
        profile: profile[1],
        contract: Number(contract[1]),
        sha: sha[1],
      });
    }
  }

  const problems = [];
  const onDisk = readdirSync(feedRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name))
    .sort((a, b) => a - b);

  for (const version of onDisk) {
    const info = JSON.parse(readFileSync(resolve(feedRoot, String(version), 'runtime-info.json'), 'utf8'));
    const row = declared.get(version);
    if (row === undefined) {
      problems.push(`spec_version ${version} is in the feed but not in SUPPORTED_RUNTIMES`);
      continue;
    }
    if (row.profile !== info.runtime_profile) {
      problems.push(`spec_version ${version}: profile ${row.profile} != feed ${info.runtime_profile}`);
    }
    if (row.contract !== info.integration_contract_version) {
      problems.push(
        `spec_version ${version}: contract v${row.contract} != feed v${info.integration_contract_version}`,
      );
    }
    if (row.sha !== info.metadata_sha256) {
      problems.push(`spec_version ${version}: metadataSha256 ${row.sha} != feed ${info.metadata_sha256}`);
    }
  }
  for (const version of declared.keys()) {
    if (!onDisk.includes(version)) {
      problems.push(`SUPPORTED_RUNTIMES declares spec_version ${version}, which the feed does not carry`);
    }
  }
  if (declared.size !== 2) {
    problems.push(`SUPPORTED_RUNTIMES has ${declared.size} entries; 10 §5.1 requires exactly a primary/recovery pair`);
  }
  if (manifest.integration_contract_version !== [...declared.values()][0]?.contract) {
    problems.push('the manifest contract version and SUPPORTED_RUNTIMES disagree');
  }
  return problems;
}

if (process.argv.includes('--check')) {
  const problems = checkSpecVersions();
  if (problems.length > 0) {
    console.error(`FAIL spec-versions.ts disagrees with app/fixtures/chain-feed/:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`OK  SUPPORTED_RUNTIMES matches the committed feed (${'primary + recovery pair'})`);

  const current = readFileSync(OUT, 'utf8');
  if (current !== body) {
    console.error(
      `FAIL ${OUT} is not what tools/release/surface-manifest.json generates.\n` +
        'Regenerate with `pnpm -C app run surface:generate` — never hand-edit the output, ' +
        'and never edit the manifest to match the output.',
    );
    process.exit(1);
  }
  console.log(`OK  CRITICAL_SURFACE reproduces from the manifest (${rows.length} probed, ${unprobed} unprobed)`);
} else {
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT} — ${rows.length} probed entries, ${unprobed} unprobed`);
}
