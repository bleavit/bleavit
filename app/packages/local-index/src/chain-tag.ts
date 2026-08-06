/**
 * The chain tag — the eight hex characters every per-chain name is built from (10 §7).
 *
 * §7 names the database `futarchy@<paraGenesisHash-prefix8>` and §6.5 names the writer lock
 * `fut-ingest`. Both are per chain, and both were deriving the suffix themselves: the
 * database validated its argument as a genesis hash and the lock did not, so an empty string
 * produced the lock name `fut-ingest@` — one global lock shared by every chain, silently, in
 * the module whose whole job is keeping one writer per chain.
 *
 * The two now derive from one function. A caller that cannot name the chain has nothing to
 * index and nothing to lock, so the refusal is the same on both sides rather than a property
 * of whichever call site remembered it.
 */

export class ChainTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainTagError';
  }
}

/** `0x` + 32 bytes, as every genesis hash is carried. */
const GENESIS_HASH = /^0x[0-9a-f]{64}$/;

/** Whether a string is a parachain genesis hash in this repository's canonical rendering. */
export function isGenesisHash(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && GENESIS_HASH.test(candidate);
}

/**
 * The per-chain tag: prefix-8 of the hash proper, skipping `0x` — §7's own naming.
 *
 * Required rather than defaulted, and validated rather than sliced. A single shared database
 * would let a client that connected to Paseo yesterday and Polkadot today read yesterday's
 * rows as today's chain, and nothing downstream could detect it: the rows are well-formed,
 * the coverage is contiguous, and the ids collide because both chains number their proposals
 * from one.
 */
export function chainTag(paraGenesisHash: string): string {
  if (!isGenesisHash(paraGenesisHash)) {
    throw new ChainTagError(
      `${String(paraGenesisHash)} is not a parachain genesis hash. Every per-chain name in this ` +
        'package is what keeps two chains apart, so it is not derived from a value this module ' +
        'could guess at.',
    );
  }
  return paraGenesisHash.slice(2, 10);
}
