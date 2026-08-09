/**
 * Bundled, hash-pinned chain specs and the genesis identity check — 10 §4.1, §3.1, §4.3.
 *
 * A chain spec is **trusted input to smoldot**: it carries the genesis storage the light
 * client anchors on and the bootnode set it dials. smoldot's own documentation says as
 * much of the database content, and the spec is strictly more load-bearing. So the app
 * does not merely ship a spec — it ships a *pin*, and refuses to hand smoldot bytes that
 * do not match it.
 *
 * That matters specifically because of how this app is distributed (12 §5): a static
 * bundle on Arweave, fetched through a gateway. The release manifest is signed and
 * attested, but a chain spec substituted anywhere between the manifest and `addChain`
 * would point the light client at an attacker's genesis, and every read after it would be
 * honestly "verified" — against the wrong chain. Hashing the exact bytes at the call site
 * closes that window; the genesis identity check (§3.1) closes it again from the other
 * side, after smoldot reports what it actually synced.
 *
 * The two checks are not redundant. The hash pin authenticates the *file*; the genesis
 * check authenticates the *chain smoldot ended up on*. A spec whose bytes are genuine can
 * still name a relay it should not, and a spec that matches its own id can still be a
 * fork — only comparing the resulting genesis hash to the release pin catches that, which
 * is why 10 §3.1 makes `WrongChain` terminal with no override.
 */

import type { HexString } from '@bleavit/shared-types';

/** What the release pins about one bundled chain spec. */
export interface PinnedChainSpec {
  /** The spec's own `id`. smoldot matches a parachain's `relayChain` against this. */
  readonly id: string;
  readonly kind: 'relay' | 'para';
  /** SHA-256 of the exact bundled bytes. */
  readonly sha256: HexString;
  /** The genesis hash the light client must report after syncing (10 §3.1). */
  readonly genesisHash: HexString;
  /** Parachain only: the relay `id` this spec must name. */
  readonly relayChainId?: string;
}

/** The fields of a chain spec this layer reads. */
export interface ParsedChainSpec {
  readonly id: string;
  readonly name: string;
  /** Present iff the spec declares one. A relay spec that declares it is refused. */
  readonly relayChain: string | undefined;
  readonly bootNodes: readonly string[];
}

export class ChainSpecIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainSpecIntegrityError';
  }
}

/**
 * 10 §3.1's `FE-BOOT-003`. Terminal, no override — a user cannot click through it,
 * because the whole point of the check is that everything downstream of a wrong chain
 * looks correct.
 */
export class WrongChainError extends Error {
  readonly code = 'FE-BOOT-003' as const;
  readonly expected: HexString;
  readonly observed: HexString;

  constructor(expected: HexString, observed: HexString) {
    super(
      `genesis mismatch: the release pins ${expected}, the light client synced ${observed}. ` +
        'This is terminal (FE-BOOT-003) — a chain that is not Bleavit can answer every ' +
        'read consistently, so there is nothing further to verify against.',
    );
    this.name = 'WrongChainError';
    this.expected = expected;
    this.observed = observed;
  }
}

function toHex(bytes: ArrayBuffer): HexString {
  return `0x${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')}` as HexString;
}

/** SHA-256 of a bundled chain spec's exact bytes. */
export async function chainSpecHash(text: string): Promise<HexString> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * The relay a spec declares, under either spelling — F27, 2026-08-08.
 *
 * **This reader accepted only `relayChain` until F27, and no chain spec this repository
 * produces carries that key.** Substrate renames `ClientSpec`'s own fields to camelCase, but
 * a parachain's relay and para id come from Cumulus's `Extensions` struct, which is **not**
 * renamed — so `chain-spec-builder` emits `relay_chain` and `para_id`, in the drill specs and
 * in `deploy/chain-specs/out/` alike. `tools/deploy/validate-chain-spec.py` has always read
 * `relay_chain` and agreed with the artifacts; this file did not, so `verifyBundledChainSpec`
 * would have thrown *"declares no relayChain"* on **every** genuine parachain spec, including
 * the production one.
 *
 * Nothing caught it because every fixture in this package is hand-written with the spelling
 * this function used to require — the reader and its tests agreed with each other and with
 * nothing else.
 *
 * **smoldot honours `relay_chain`, verified rather than assumed** (R-2): the pinned
 * `smoldot@3.3.2` was handed the generated spec with `potentialRelayChains: []` and answered
 * `AddChainError: Couldn't find relevant relay chain` — it looked for the declared relay and
 * refused when none was supplied. Its own `public-types.d.ts` documents `relayChain`, so both
 * spellings reach the same code path there and this reader must be no narrower than the
 * client it feeds.
 *
 * Neither spelling is preferred and a spec carrying **both** is refused rather than resolved:
 * two declarations of the one fact are a spec that has been edited, and picking a winner is
 * how a client ends up dialling the relay the other key named.
 */
export function relayChainOf(spec: Record<string, unknown>): string | undefined {
  const camel = spec['relayChain'];
  const snake = spec['relay_chain'];
  if (typeof camel === 'string' && typeof snake === 'string' && camel !== snake) {
    throw new ChainSpecIntegrityError(
      `chain spec declares two different relay chains (relayChain=${JSON.stringify(camel)}, ` +
        `relay_chain=${JSON.stringify(snake)}); it has been edited, and either key could be the ` +
        'one a client acts on',
    );
  }
  if (typeof camel === 'string') return camel;
  return typeof snake === 'string' ? snake : undefined;
}

/** The two genesis forms smoldot accepts. Not a preference — see {@link genesisFormOf}. */
export type GenesisForm = 'raw' | 'state-root';

const STATE_ROOT = /^0x[0-9a-f]{64}$/i;

/**
 * Which genesis form a spec carries — F18, 2026-08-08, and the sentence it replaces was wrong.
 *
 * This module used to refuse anything without a `genesis.raw` map, saying *"smoldot accepts
 * only raw chain specifications"*. **The pinned `smoldot@3.3.2` says otherwise, in its own
 * words**: handed a `genesis.raw` spec it logs
 *
 * > Chain specification of `<id>` contains a `genesis.raw` item. It is possible to
 * > significantly improve the initialization time by replacing the `"raw": ...` field with
 * > `"stateRootHash": "0x…"`
 *
 * — a string read out of the shipped WebAssembly rather than remembered, and then executed:
 * the two forms of one dev Asset Hub spec return the **identical** genesis hash, and
 * `addChain` resolves in 3 ms instead of 23,644 ms (a 79.4 MB, ~189k-entry genesis). Every
 * published light-client spec in the ecosystem uses this form, so the old rule also meant the
 * canonical client could not load the very artifact 02 §7.7 will pin for Asset Hub.
 *
 * **The state-root form is refused for a relay, and that is not symmetry-breaking for its own
 * sake.** A relay's finality is its own: smoldot establishes the GRANDPA authority set from
 * genesis storage, so a relay spec carrying neither that storage nor a `lightSyncState`
 * checkpoint syncs and never finalizes — the failure mode this file already calls
 * indistinguishable from slow sync. A **parachain** derives finality from relay-finalized
 * para-inclusion (10 §4.1), so it needs no genesis storage at all.
 *
 * Nothing is weakened by admitting the form. The bytes are still hashed against the release
 * pin before smoldot sees them, and 10 §3.1's identity check still compares the genesis hash
 * smoldot computes — from the header it builds out of this state root — against the pin. A
 * tampered `stateRootHash` fails the first check on the bytes and the second on the hash.
 *
 * A spec declaring **both** is refused rather than resolved, on `relayChainOf`'s grounds: two
 * declarations of one fact are a spec that has been edited, and picking a winner is how a
 * client ends up anchored on the root the other key did not name.
 */
export function genesisFormOf(spec: Record<string, unknown>): GenesisForm | undefined {
  const genesis = spec['genesis'];
  if (typeof genesis !== 'object' || genesis === null) return undefined;
  const fields = genesis as Record<string, unknown>;
  const raw = typeof fields['raw'] === 'object' && fields['raw'] !== null;
  const stateRoot = typeof fields['stateRootHash'] === 'string' && STATE_ROOT.test(fields['stateRootHash']);
  if (raw && stateRoot) {
    throw new ChainSpecIntegrityError(
      'chain spec declares both `genesis.raw` and `genesis.stateRootHash`; it has been edited, ' +
        'and the two need not describe the same state — anchoring on either would be a guess',
    );
  }
  if (raw) return 'raw';
  return stateRoot ? 'state-root' : undefined;
}

/**
 * Verify a bundled chain spec against its release pin, and return the fields the topology
 * needs.
 *
 * Every failure here throws. There is deliberately no "warn and continue" path: the
 * alternative to a verified spec is not a degraded connection, it is a connection whose
 * verification means nothing.
 */
export async function verifyBundledChainSpec(
  text: string,
  pinned: PinnedChainSpec,
): Promise<ParsedChainSpec> {
  const observed = await chainSpecHash(text);
  if (observed !== pinned.sha256) {
    throw new ChainSpecIntegrityError(
      `chain spec ${pinned.id} does not match its release pin (expected ${pinned.sha256}, got ${observed})`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new ChainSpecIntegrityError(`chain spec ${pinned.id} is not valid JSON: ${String(cause)}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ChainSpecIntegrityError(`chain spec ${pinned.id} is not a JSON object`);
  }
  const spec = raw as Record<string, unknown>;

  if (spec['id'] !== pinned.id) {
    throw new ChainSpecIntegrityError(
      `chain spec declares id ${JSON.stringify(spec['id'])}, the pin says ${JSON.stringify(pinned.id)}`,
    );
  }

  // smoldot supports a **raw** genesis map or a **state root**, and nothing else. A spec
  // carrying neither fails inside `addChain` with a message that reads like a connectivity
  // problem, so catching it here is the difference between "the build shipped the wrong
  // artifact" and an hour spent on the network.
  const form = genesisFormOf(spec);
  if (form === undefined) {
    throw new ChainSpecIntegrityError(
      `chain spec ${pinned.id} declares neither a \`genesis.raw\` map nor a 32-byte ` +
        '`genesis.stateRootHash`; smoldot accepts no third form, and it reports the ' +
        'difference as a chain that never finalises',
    );
  }
  if (form === 'state-root' && pinned.kind === 'relay') {
    // A relay establishes its own finality from the GRANDPA authority set in genesis
    // storage. Without that storage and without a checkpoint it syncs forever — see
    // `genesisFormOf` for why a parachain is not in the same position.
    const checkpoint = spec['lightSyncState'];
    if (typeof checkpoint !== 'object' || checkpoint === null) {
      throw new ChainSpecIntegrityError(
        `relay spec ${pinned.id} carries a \`genesis.stateRootHash\` and no \`lightSyncState\`; ` +
          'a relay has no other chain to derive finality from, so it would sync and never ' +
          'finalize — which on screen is indistinguishable from slow sync',
      );
    }
  }

  const relayChain = relayChainOf(spec);
  if (pinned.kind === 'para') {
    // smoldot resolves a parachain's relay by matching this string against the `id` of a
    // chain in `potentialRelayChains`. If it does not match, the linkage silently fails
    // to form and the parachain never finalizes — the failure looks like slow sync.
    if (relayChain === undefined) {
      throw new ChainSpecIntegrityError(`parachain spec ${pinned.id} declares no relayChain`);
    }
    if (pinned.relayChainId !== undefined && relayChain !== pinned.relayChainId) {
      throw new ChainSpecIntegrityError(
        `parachain spec ${pinned.id} names relay ${JSON.stringify(relayChain)}, ` +
          `the pin says ${JSON.stringify(pinned.relayChainId)}`,
      );
    }
  } else if (relayChain !== undefined) {
    throw new ChainSpecIntegrityError(
      `relay spec ${pinned.id} declares a relayChain (${JSON.stringify(relayChain)}); it would be treated as a parachain`,
    );
  }

  const bootNodes = Array.isArray(spec['bootNodes'])
    ? spec['bootNodes'].filter((n): n is string => typeof n === 'string')
    : [];

  return {
    id: pinned.id,
    name: typeof spec['name'] === 'string' ? spec['name'] : pinned.id,
    relayChain,
    bootNodes,
  };
}

/**
 * The §3.1 identity check. Throws `WrongChainError`; there is no boolean return, because
 * a boolean invites a call site that logs it and carries on.
 */
export function assertGenesisIdentity(observed: HexString, pinned: PinnedChainSpec): void {
  if (observed !== pinned.genesisHash) throw new WrongChainError(pinned.genesisHash, observed);
}
