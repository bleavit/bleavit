/**
 * Produce a development chain pin for a drill to inject — F18, ruled 2026-08-07.
 *
 * `tools/deploy/generate-chain-specs.sh` builds `bleavit-dev.json` (chain id `bleavit_dev`,
 * relay `paseo-local`) and `bleavit-local.json` into the gitignored `deploy/chain-specs/out/`.
 * `startChainSession` takes its pin by injection and will boot against either. This tool is
 * what turns those bytes into the pin, and the whole of its job is that **it is not the
 * release**.
 *
 * ## The rule this exists to keep
 *
 * > A development pin may exist. It may never live in `release-sources.json`.
 *
 * That file's `chainIdentity` block carries `paraId`, `chainSpecHashes` and `genesisHashes`,
 * and its own note says what a null there would do — *"a bundle that shipped a null genesis
 * pin would run `verifyChainIdentity` against nothing and report `verified`"*. A development
 * pin in the same fields is that failure with a **non-null** value, which is worse: a release
 * pinned to `bleavit_dev` on `paseo-local` passes the chain-spec hash check, passes the 10
 * §3.1 genesis check, and reports `verified` about a chain that is not Bleavit. Nothing
 * downstream objects, because every check it makes is satisfied.
 *
 * So the separation is structural rather than remembered: this tool **refuses to write into
 * the release sources or the build output** ({@link refuseReleasePath}), and the release
 * format gains no development channel that a gate would then have to refuse. A pin that is
 * never in a field a release reads cannot reach a release.
 *
 * ## The genesis hash is supplied, never derived
 *
 * A chain spec's genesis hash is the blake2-256 of the genesis *header*, whose state root is
 * the trie root of the genesis storage — it is not a function of the file's bytes, and
 * computing it means building the trie. This tool therefore **requires** each genesis hash as
 * an argument and refuses to guess one. A drill reads it from the chain it just started
 * (`chainSpec_v1_genesisHash`), which is the same live source
 * `fixtures/foreign-chain-feed/`'s Asset Hub pin records for the same reason, and R-2 forbids
 * resolving it any other way.
 *
 * What *is* computed here is the SHA-256 of the exact bytes on disk, so the pin cannot drift
 * from the file the harness will hand smoldot.
 *
 * ## Usage
 *
 * ```sh
 * node app/tools/dev-chain-pin.ts \
 *   --relay      zombienet/specs/out/paseo-local-raw.json           --relay-genesis 0x… \
 *   --para       zombienet/specs/out/bleavit-drill-raw.json         --para-genesis  0x… \
 *   [--asset-hub zombienet/specs/out/asset-hub-paseo-local-raw.json --asset-hub-genesis 0x…] \
 *   [--out /tmp/drill/dev-pin.json]
 * ```
 *
 * **Those paths were wrong until 2026-08-08 (F27) and could not have worked.** They named
 * `deploy/chain-specs/out/paseo-local.json` and `asset-hub-local.json`, which nothing
 * produces — `generate-chain-specs.sh` writes only `bleavit-dev.json` and
 * `bleavit-local.json` there — and both of those are **plain**, so `pinRole`'s own raw check
 * refuses them. The specs that exist in raw form come from `tools/env/generate-relay-specs.sh`,
 * which emits a `-raw.json` beside each plain one precisely so the zombienet spawn and the
 * light client can each have the form they accept. `zombienet/drills/js/client-boot.js` runs
 * this command with those arguments, so the usage block and its one caller now agree.
 *
 * With no `--out` the document goes to stdout. The shape is what
 * `ChainSpecs`/`FundingPins` need: one `{ pinned, chainSpec }` per role, so a harness reads
 * the file and passes the values straight in.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DevPinRole {
  readonly id: string;
  readonly kind: 'relay' | 'para';
  readonly sha256: string;
  readonly genesisHash: string;
  readonly relayChainId?: string;
}

export interface DevPinDocument {
  readonly schema: 'bleavit.dev-chain-pin.v1';
  readonly note: string;
  readonly relay: { readonly pinned: DevPinRole; readonly chainSpec: string };
  readonly para: { readonly pinned: DevPinRole; readonly chainSpec: string };
  readonly assetHub?: { readonly pinned: DevPinRole; readonly chainSpec: string };
}

export class DevPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevPinError';
  }
}

const HASH = /^0x[0-9a-f]{64}$/i;

/**
 * The paths a development pin may never be written to.
 *
 * `sources/` is compiled into the bundle and `dist/`/`release-out/` are the signed tree, so
 * these three are exactly the places where "a development pin exists" becomes "a release is
 * pinned to a development chain". Matched on the resolved path, because a relative `../`
 * dressed as an innocent filename is how a check on the argument string is got past.
 */
const FORBIDDEN = ['/tools/release/sources/', '/dist/', '/release-out/', '/fixtures/chain-feed/'];

export function refuseReleasePath(target: string): void {
  const resolved = resolve(target).replace(/\\/g, '/');
  for (const fragment of FORBIDDEN) {
    if (resolved.includes(fragment)) {
      throw new DevPinError(
        `refusing to write a development pin to ${resolved}. A pin under ${fragment} is read by ` +
          'the release, and a release pinned to a development chain passes every identity ' +
          'check and reports `verified` about a chain that is not Bleavit. Development pins ' +
          'are test fixtures: keep them where a drill reads them from.',
      );
    }
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

interface RoleInput {
  readonly role: string;
  readonly kind: 'relay' | 'para';
  readonly chainSpec: string;
  readonly genesisHash: string;
}

/**
 * One role's pin, with the four refusals that are cheap here and expensive in a drill.
 *
 * Each mirrors a `verifyBundledChainSpec` or `startTopology` refusal, and the point of making
 * them at production time is the failure they replace: smoldot reports a non-raw spec and a
 * broken relay linkage as a chain that never finalises, which on screen — and in a drill log —
 * is indistinguishable from slow sync.
 */
async function pinRole(input: RoleInput): Promise<{ pinned: DevPinRole; chainSpec: string }> {
  if (!HASH.test(input.genesisHash)) {
    throw new DevPinError(
      `the ${input.role} genesis hash ${JSON.stringify(input.genesisHash)} is not a 32-byte hex ` +
        'string. It is a property of the genesis storage trie rather than of the spec file, so ' +
        'this tool cannot compute it — read it from the chain the drill started ' +
        '(`chainSpec_v1_genesisHash`) and pass it in.',
    );
  }

  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(input.chainSpec) as Record<string, unknown>;
  } catch (error) {
    throw new DevPinError(`the ${input.role} chain spec is not valid JSON: ${String(error)}`);
  }
  const id = spec['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new DevPinError(`the ${input.role} chain spec declares no string \`id\``);
  }

  const genesis = spec['genesis'];
  const isRaw =
    typeof genesis === 'object' &&
    genesis !== null &&
    typeof (genesis as Record<string, unknown>)['raw'] === 'object';
  if (!isRaw) {
    throw new DevPinError(
      `the ${input.role} chain spec (${id}) is not a raw spec; smoldot accepts only raw chain ` +
        'specifications, and it reports the difference as a chain that never finalises',
    );
  }

  // Both spellings, for the reason `chain-spec.ts`'s `relayChainOf` records: Cumulus emits
  // `relay_chain`, so a camelCase-only reader refuses every spec this repository produces.
  // Read here rather than imported, because this tool is deliberately dependency-free — it
  // runs before anything is built, from a drill helper that shells out to it.
  const camelRelay = spec['relayChain'];
  const snakeRelay = spec['relay_chain'];
  if (
    typeof camelRelay === 'string' &&
    typeof snakeRelay === 'string' &&
    camelRelay !== snakeRelay
  ) {
    throw new DevPinError(
      `the ${input.role} chain spec (${id}) declares two different relay chains ` +
        `(relayChain=${JSON.stringify(camelRelay)}, relay_chain=${JSON.stringify(snakeRelay)})`,
    );
  }
  const relayChain = typeof camelRelay === 'string' ? camelRelay : snakeRelay;
  if (input.kind === 'relay' && typeof relayChain === 'string') {
    throw new DevPinError(
      `the relay spec (${id}) declares a relayChain (${relayChain}); it would be treated as a parachain`,
    );
  }
  if (input.kind === 'para' && typeof relayChain !== 'string') {
    throw new DevPinError(`the ${input.role} parachain spec (${id}) declares no relayChain`);
  }

  return {
    pinned: {
      id,
      kind: input.kind,
      sha256: await sha256Hex(input.chainSpec),
      genesisHash: input.genesisHash,
      ...(typeof relayChain === 'string' ? { relayChainId: relayChain } : {}),
    },
    chainSpec: input.chainSpec,
  };
}

export interface DevPinInputs {
  readonly relay: { readonly chainSpec: string; readonly genesisHash: string };
  readonly para: { readonly chainSpec: string; readonly genesisHash: string };
  readonly assetHub?: { readonly chainSpec: string; readonly genesisHash: string };
}

/**
 * Assemble the document.
 *
 * The cross-role refusals are the ones a single role cannot see, and both are already made
 * somewhere in the boot path — here they fail before a drill spends a sync on them:
 *
 * - **The parachain's `relayChain` must name the relay's `id`.** `startTopology` refuses this
 *   because the linkage would never form and the parachain would sit un-finalized.
 * - **No two roles may pin the same genesis.** `attachAssetHub` refuses an Asset Hub bundle
 *   pinning our own genesis, because it passes every other check and would put futarchy
 *   balances on screen under an Asset Hub label — and `fundingReaders` refuses the same
 *   collision one layer up, at read time.
 */
export async function buildDevPin(inputs: DevPinInputs): Promise<DevPinDocument> {
  const relay = await pinRole({ role: 'relay', kind: 'relay', ...inputs.relay });
  const para = await pinRole({ role: 'parachain', kind: 'para', ...inputs.para });
  const assetHub =
    inputs.assetHub === undefined
      ? undefined
      : await pinRole({ role: 'Asset Hub', kind: 'para', ...inputs.assetHub });

  for (const [role, entry] of [
    ['parachain', para],
    ...(assetHub === undefined ? [] : ([['Asset Hub', assetHub]] as const)),
  ] as const) {
    if (entry.pinned.relayChainId !== relay.pinned.id) {
      throw new DevPinError(
        `the ${role} spec names relay ${JSON.stringify(entry.pinned.relayChainId)} but the ` +
          `bundled relay is ${JSON.stringify(relay.pinned.id)}; the linkage would never form ` +
          'and the chain would sit un-finalized, which reads as slow sync',
      );
    }
  }

  const seen = new Map<string, string>();
  for (const [role, entry] of [
    ['relay', relay],
    ['parachain', para],
    ...(assetHub === undefined ? [] : ([['Asset Hub', assetHub]] as const)),
  ] as const) {
    const previous = seen.get(entry.pinned.genesisHash);
    if (previous !== undefined) {
      throw new DevPinError(
        `the ${role} and the ${previous} pin the same genesis (${entry.pinned.genesisHash}), so ` +
          'they are not two chains at all. Every figure from one would render under the ' +
          'other’s label, which no badge and no later check can detect.',
      );
    }
    seen.set(entry.pinned.genesisHash, role);
  }

  return {
    schema: 'bleavit.dev-chain-pin.v1',
    note:
      'A development pin, for a drill harness to inject into startChainSession. It is NOT a ' +
      'release pin and must never be copied into app/tools/release/sources/release-sources.json ' +
      '— a release pinned to a development chain verifies successfully about a chain that is ' +
      'not Bleavit.',
    relay,
    para,
    ...(assetHub === undefined ? {} : { assetHub }),
  };
}

function argOf(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : argv[index + 1];
}

function required(argv: readonly string[], name: string): string {
  const value = argOf(argv, name);
  if (value === undefined || value.startsWith('--')) {
    throw new DevPinError(`--${name} is required and takes a value`);
  }
  return value;
}

export async function main(argv: readonly string[]): Promise<string> {
  // Both arguments are resolved **before** either is used, so a missing `--…-genesis` is named
  // rather than surfacing as an I/O error about the path that happened to be read first.
  const role = (name: string) => {
    const path = required(argv, name);
    const genesisHash = required(argv, `${name}-genesis`);
    return { chainSpec: readFileSync(path, 'utf8'), genesisHash };
  };
  const assetHubPath = argOf(argv, 'asset-hub');
  const document = await buildDevPin({
    relay: role('relay'),
    para: role('para'),
    ...(assetHubPath === undefined ? {} : { assetHub: role('asset-hub') }),
  });
  const text = `${JSON.stringify(document, null, 2)}\n`;

  const out = argOf(argv, 'out');
  if (out !== undefined) {
    refuseReleasePath(out);
    writeFileSync(out, text);
  }
  return text;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const text = await main(process.argv.slice(2));
  if (!process.argv.includes('--out')) process.stdout.write(text);
}
