/**
 * Release identity and boot chain verification — INV-FE-11, 10 §5.4, 12 §1.
 *
 * INV-FE-11 enumerates what the bundle pins: "release content address (TXID), source
 * commit, per-file hashes, descriptor metadata hashes, supported spec-version range,
 * chain-spec hashes, and relay + parachain genesis hashes". That list is reproduced as a
 * **required** field set rather than an optional bag, because an identity record with a
 * missing pin is not a partial identity — it is a bundle that cannot prove one of the
 * things the invariant says it proves, and an optional field lets that ship silently.
 *
 * ## Genesis mismatch is terminal, and that is not the same as `restricted`
 *
 * INV-FE-12's `restricted` / `read-only-incompatible` modes exist for a runtime whose
 * *surface* is partly unknown — the same chain, further along than the client. A genesis
 * mismatch is a different thing: it means the peer is **a different chain**, and there is
 * no subset of functionality that is still safe. Reads are not "degraded", they are about
 * some other network's state; the account balances are someone else's.
 *
 * So this module has no path from `genesis-mismatch` to any operating mode. The verdict
 * type carries no severity to compare and no override to pass — the only thing a caller
 * can do with a mismatch is stop. 10 §5.2's compatibility lattice never sees it, because
 * a compat probe against the wrong chain is a question that should not be asked.
 *
 * ## Chain-spec hash and genesis hash are separate obligations
 *
 * Both are pinned and both are checked. The chain-spec hash proves the *bytes handed to
 * smoldot* are the release's own — trusted input, verified before use (app-code rule 13).
 * The genesis hash proves the *network those bytes describe* is the one intended. A
 * correct spec for the wrong chain and the right chain reached through a tampered spec
 * are different failures, and one check cannot see both.
 */

import type { HexString } from '@bleavit/shared-types';

/** A 32-byte hash as the release record carries it. */
export type Hash32 = HexString;

/** The `spec_version` window a bundle's committed descriptors can serve (10 §5.1). */
export interface SpecVersionRange {
  /** The primary runtime. */
  readonly primary: number;
  /** Its paired terminal-recovery runtime, at exactly `primary + 1`. */
  readonly recovery: number;
}

/**
 * Everything INV-FE-11 requires the bundle to pin. Every field is required.
 *
 * `perFileHashes` is a map rather than a list so the self-check's two directions —
 * a file that changed, and a file that appeared — are both expressible; a list of
 * hashes can only express the first.
 */
export interface ReleaseIdentity {
  /** Arweave content address of the release (INV-FE-11's TXID). */
  readonly releaseTxid: string;
  /** The commit the bundle was built from. */
  readonly sourceCommit: string;
  /** Path → content hash, for every file in the distributed bundle. */
  readonly perFileHashes: Readonly<Record<string, Hash32>>;
  /** One metadata hash per served `spec_version` (10 §5.1's committed descriptor sets). */
  readonly descriptorMetadataHashes: Readonly<Record<number, Hash32>>;
  readonly specVersionRange: SpecVersionRange;
  /** Hash of the chain-spec bytes bundled for smoldot (app-code rule 13). */
  readonly chainSpecHashes: Readonly<Record<'relay' | 'para', Hash32>>;
  readonly genesisHashes: Readonly<Record<'relay' | 'para', Hash32>>;
}

/** What a live connection reports about itself, for comparison against the pins. */
export interface ObservedChain {
  readonly relayGenesis: Hash32;
  readonly paraGenesis: Hash32;
  /** The chain-spec bytes actually handed to smoldot, already hashed. */
  readonly relaySpecHash: Hash32;
  readonly paraSpecHash: Hash32;
}

export type ChainIdentityVerdict =
  | { readonly kind: 'verified' }
  | {
      /**
       * Terminal. There is deliberately no severity, no mode and no override here:
       * the only correct response is to stop, and a field a caller could compare
       * against a threshold would invite treating this as degradation.
       */
      readonly kind: 'genesis-mismatch';
      readonly which: 'relay' | 'para';
      readonly pinned: Hash32;
      readonly observed: Hash32;
      readonly detail: string;
    }
  | {
      /** The bytes given to smoldot were not the release's own (rule 13). */
      readonly kind: 'chain-spec-mismatch';
      readonly which: 'relay' | 'para';
      readonly pinned: Hash32;
      readonly observed: Hash32;
      readonly detail: string;
    };

/**
 * Verify a live connection against the bundle's pins — 10 §3.1's boot obligation.
 *
 * The chain-spec comparison runs **first**. If the bytes handed to smoldot were not the
 * release's own, then the genesis hash they produce is a fact about an input the release
 * did not choose, and reporting it as a genesis verdict would name the wrong failure —
 * the chain would look wrong when what was actually wrong was the file describing it.
 */
export function verifyChainIdentity(
  pinned: ReleaseIdentity,
  observed: ObservedChain,
): ChainIdentityVerdict {
  const specs = [
    ['relay', pinned.chainSpecHashes.relay, observed.relaySpecHash],
    ['para', pinned.chainSpecHashes.para, observed.paraSpecHash],
  ] as const;
  for (const [which, expected, actual] of specs) {
    if (expected !== actual) {
      return {
        kind: 'chain-spec-mismatch',
        which,
        pinned: expected,
        observed: actual,
        detail:
          `the ${which} chain spec handed to the light client is not the one this release ` +
          'pins, so any identity it reports describes bytes the release did not choose',
      };
    }
  }
  const genesis = [
    ['relay', pinned.genesisHashes.relay, observed.relayGenesis],
    ['para', pinned.genesisHashes.para, observed.paraGenesis],
  ] as const;
  for (const [which, expected, actual] of genesis) {
    if (expected !== actual) {
      return {
        kind: 'genesis-mismatch',
        which,
        pinned: expected,
        observed: actual,
        detail:
          `the ${which} chain's genesis hash is not the one this release was built for. ` +
          'This is a different chain, not an unsupported version of the intended one, so ' +
          'no read from it describes your account and no reduced mode is safe.',
      };
    }
  }
  return { kind: 'verified' };
}

/**
 * Whether a verdict permits the application to operate at all.
 *
 * Deliberately total over the verdict union rather than `verdict.kind !== 'verified'`,
 * so a future verdict variant is a compile error here instead of silently defaulting to
 * "keep going" — which is the direction that hurts.
 */
export function mayOperate(verdict: ChainIdentityVerdict): boolean {
  switch (verdict.kind) {
    case 'verified':
      return true;
    case 'genesis-mismatch':
    case 'chain-spec-mismatch':
      return false;
  }
}
