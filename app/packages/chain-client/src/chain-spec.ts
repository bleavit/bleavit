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

  // smoldot supports **raw** specs only. A non-raw spec fails inside `addChain` with a
  // message that reads like a connectivity problem, so catching it here is the difference
  // between "the build shipped the wrong artifact" and an hour spent on the network.
  const genesis = spec['genesis'];
  const isRaw =
    typeof genesis === 'object' &&
    genesis !== null &&
    typeof (genesis as Record<string, unknown>)['raw'] === 'object';
  if (!isRaw) {
    throw new ChainSpecIntegrityError(
      `chain spec ${pinned.id} is not a raw spec; smoldot accepts only raw chain specifications`,
    );
  }

  const relayChain = typeof spec['relayChain'] === 'string' ? spec['relayChain'] : undefined;
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
