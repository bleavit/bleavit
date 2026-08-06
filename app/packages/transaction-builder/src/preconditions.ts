/**
 * Preconditions — 11 §11.4 rules 2–5; INV-FE-2, INV-FE-3.
 *
 * A precondition is *an exact read at B′*, and 11 §11.4 rule 2 names the only three
 * sources it may have: a storage key, a runtime-API call, or a **constants-API (metadata)
 * read**. That third one is not a rounding of the first: values the backend defines as
 * kernel constants — per-trade min/max, `MinSplit`, `MinTransfer`,
 * `MaxPositionsPerAccount`, every §21-class tunable's kernel floor — have *no storage
 * representation at all*, so a client that went looking for them in storage would find
 * nothing and would have to invent a default. That is the hardcode X-11e/X-11h forbid.
 *
 * **Rule 4 is enforced by the type system, not by review.** "Provider/local-index data
 * never satisfies any precondition" is stated as a rule in the document; here an
 * evaluation *cannot be constructed* from anything but a `Finalized<T>`, because that is
 * the only input type `evaluate` accepts and `Finalized<T>` is constructible only inside
 * `@bleavit/chain-client`. A provider value is not rejected at runtime — it is
 * untypeable, which is the difference between a rule and a guarantee.
 */

import type { Finalized, FinalizedBlockRef, FinalizedReader } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';

/** 11 §11.4 rule 2's three admissible sources, and nothing else. */
export type PreconditionSource =
  | { readonly kind: 'storage'; readonly key: HexString; readonly query: 'value' | 'descendantsValues' }
  | { readonly kind: 'runtime-api'; readonly api: string; readonly argsHex?: HexString }
  /**
   * A metadata constant. Re-read whenever the compat layer observes a new
   * `spec_version` (rule 2: they can only change via a Wasm change), which is why the
   * spec_version it was read at is carried rather than assumed.
   */
  | { readonly kind: 'constant'; readonly pallet: string; readonly name: string };

/**
 * The identity of one precondition **obligation** — a single clause, or an `anyOf` group.
 *
 * It is a template literal type (`row/discriminator`) for one reason: a bare `P-n`/`O-n`/`G-n`
 * row id does not match it, so it cannot be used as a result id. That is the whole repair.
 * Before it, every clause of a row carried the row's own id, and `gate()` treats a row as
 * covered as soon as *some* result names it — so one passing read out of five minted the
 * signing window and the other four were never evaluated. On `O-1` that meant the registry
 * check alone could authorise a 100,000-USDC stake whose balance nobody had looked at.
 *
 * Build one with `clauseCoverageId` in `rows.ts`; never by hand, because the coverage check
 * compares what a preparation *requires* against what was read, and both sides must be
 * derived from the same table or the comparison is between two opinions.
 */
export type ClauseId = `${string}/${string}`;

export interface PreconditionRow<T> {
  /**
   * The obligation this predicate discharges — `clauseCoverageId(clause)`.
   *
   * Not the `P-n` row id. A row is a set of clauses and this is one of them; see `ClauseId`.
   */
  readonly id: ClauseId;
  /** What the user is told when it fails. Never a raw error code alone (rule 5). */
  readonly requirement: string;
  readonly source: PreconditionSource;
  /** Decide from a value read at B′. Pure — it may not read anything itself. */
  readonly satisfiedBy: (value: T) => boolean;
  /** Rendered in the confirm screen beside the actual (rule 3). */
  readonly expected: (value: T) => string;
}

export interface PreconditionResult {
  /**
   * Which obligation this answers — one clause, or one `anyOf` group.
   *
   * A disjunctive group is answered by **one** result carrying the group's id: its members
   * are alternatives to one obligation, not obligations of their own, and emitting one
   * result per member would let a failing alternative block a satisfied group.
   */
  readonly id: ClauseId;
  readonly ok: boolean;
  readonly requirement: string;
  readonly expected: string;
  readonly actual: string;
  readonly at: FinalizedBlockRef;
}

/**
 * Evaluate one row against a finalized read.
 *
 * The signature is the control: `Finalized<T>` is the only thing this accepts, and it is
 * constructible only inside `@bleavit/chain-client` (10 §2.1). A `provider`-,
 * `derived-local`- or `stale-cache`-status value therefore cannot reach a precondition —
 * not because it is filtered, but because it does not typecheck. `tests/firewall` carries
 * the fixture that proves it.
 */
export function evaluate<T>(row: PreconditionRow<T>, read: Finalized<T>): PreconditionResult {
  const ok = row.satisfiedBy(read.value);
  return {
    id: row.id,
    ok,
    requirement: row.requirement,
    expected: row.expected(read.value),
    actual: describe(read.value),
    at: {
      chain: read.status.chain,
      blockHash: read.status.blockHash,
      blockNumber: read.status.blockNumber,
    },
  };
}

function describe(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Read every row at **one** finalized block and evaluate it.
 *
 * The reader is passed in already open, so every row in a batch shares its pin: INV-FE-2
 * requires the whole precondition set to be evaluated at a single finalized block, and a
 * set assembled from several blocks describes a state that never existed — each row
 * individually true, the conjunction fictional.
 *
 * A row whose read *fails* is a failed precondition, not a skipped one. Treating an
 * unreadable key as "no objection" is the fail-open direction, and every precondition
 * exists to stop a transaction that would revert.
 */
export async function evaluateAll(
  reader: FinalizedReader,
  rows: readonly PreconditionRow<never>[],
  read: (reader: FinalizedReader, source: PreconditionSource) => Promise<Finalized<never>>,
): Promise<readonly PreconditionResult[]> {
  const results: PreconditionResult[] = [];
  for (const row of rows) {
    try {
      results.push(evaluate(row, await read(reader, row.source)));
    } catch (error) {
      results.push({
        id: row.id,
        ok: false,
        requirement: row.requirement,
        expected: 'readable at the pinned finalized block',
        actual: `read failed: ${error instanceof Error ? error.message : String(error)}`,
        at: reader.at,
      });
    }
  }
  return results;
}
