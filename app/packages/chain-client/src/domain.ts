/**
 * The two ledger domains — 10 §11, 11 §11.2a, 02 §7.1/§9 (contract v23, SQ-571).
 *
 * Contract v23 made the service instance's `{Vaults, BaselineVaults, Positions,
 * PositionTotals}` canonical ingest surface, so the data layer spans two conditional-
 * ledger instances: the primary domain (`()`) and the service domain (`ServiceLedger` =
 * `pallet_conditional_ledger::<Instance1>`).
 *
 * Nothing about provenance changes — both are smoldot finalized storage reads yielding
 * `Finalized<T>` on the same terms. This adds a **dimension to the data, not a status to
 * `VerificationStatus`** (10 §11).
 *
 * Four rules from 10 §11, and why each is enforced here rather than left to screens:
 *
 * 1. **Domain is a property of the datum, not of the query that fetched it.** It is a
 *    total function of an id the client already holds. Deriving it from a call site or a
 *    cache key is how a service row ends up rendered as a primary one after a refactor —
 *    so `domainOf` takes only the id, and there is no other way to obtain a domain.
 * 2. **The boundary is read from metadata, never written as a literal.** 02 §9 gave
 *    `ConditionalLedger::ServiceIdBase` a metadata home for exactly this reason. Writing
 *    `1n << 63n` here would violate 10 §5.4's no-hardcode rule like any other chain
 *    value, so the boundary arrives as a constructor argument with **no default** — a
 *    caller that has not read metadata cannot get a domain at all.
 * 3. **The two domains never aggregate.** I-4 solvency holds per instance against its own
 *    sovereign account, so a combined total asserts a backing pool that does not exist.
 *    That makes it wrong at the *data* layer, so the only summing helper here refuses a
 *    mixed input rather than trusting its caller to have filtered.
 * 4. **The write path routes by the same test.** The domains are two pallets, so the
 *    pallet name is derived from the datum's domain and carries no default.
 */

import type { Finalized } from './provenance.js';

export type LedgerDomain = 'primary' | 'service';

/** The pallet each domain's ledger calls are addressed to (10 §11; 11 §11.2a rule 5). */
export const LEDGER_PALLET: Readonly<Record<LedgerDomain, string>> = Object.freeze({
  primary: 'ConditionalLedger',
  service: 'ServiceLedger',
});

/**
 * The id-band boundary, read from `ConditionalLedger::ServiceIdBase` (02 §9).
 *
 * Published by **both** instances with the identical value — it partitions the shared id
 * space rather than describing either side, so there is exactly one number and no
 * per-instance copy to drift (02 §9).
 */
export interface DomainBoundary {
  /** Ids `>= serviceIdBase` are in the service domain (16 §7.1). */
  readonly serviceIdBase: bigint;
}

export class DomainBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainBoundaryError';
  }
}

/**
 * Build the boundary from the metadata constant.
 *
 * Fails closed on a missing or nonsensical value rather than defaulting: a client that
 * silently assumed `2^63` would label every hosted position as primary the moment the
 * constant went missing, which is the one error 11 §11.2a exists to prevent — it would
 * render an external book as governance participation.
 */
export function domainBoundaryFrom(serviceIdBase: bigint | undefined): DomainBoundary {
  if (serviceIdBase === undefined) {
    throw new DomainBoundaryError(
      'ConditionalLedger::ServiceIdBase absent from metadata (02 §9). Refusing to assume ' +
        'a boundary: guessing labels every hosted position as a governance one.',
    );
  }
  if (serviceIdBase <= 0n) {
    throw new DomainBoundaryError(`ServiceIdBase must be positive, got ${serviceIdBase}`);
  }
  return Object.freeze({ serviceIdBase });
}

/**
 * The single derivation. A total function of the id — no call site, no cache key, no name.
 */
export function domainOf(id: bigint, boundary: DomainBoundary): LedgerDomain {
  if (id < 0n) throw new DomainBoundaryError(`ids are unsigned; got ${id}`);
  return id >= boundary.serviceIdBase ? 'service' : 'primary';
}

/** A datum that knows which domain it belongs to. Every ledger read produces these. */
export interface Domained<T> {
  readonly domain: LedgerDomain;
  readonly value: T;
}

export function attachDomain<T>(id: bigint, value: T, boundary: DomainBoundary): Domained<T> {
  return { domain: domainOf(id, boundary), value };
}

/** The pallet a ledger call for this datum must be addressed to. No default (rule 4). */
export function ledgerPalletFor(domain: LedgerDomain): string {
  const pallet = LEDGER_PALLET[domain];
  if (pallet === undefined) throw new DomainBoundaryError(`unknown ledger domain ${domain}`);
  return pallet;
}

/**
 * The market calls are the sole domain-agnostic ones, because the market pallet routes
 * internally (10 §11; 11 §11.2a rule 5). Everything else must be addressed explicitly.
 */
const DOMAIN_AGNOSTIC_CALLS: ReadonlySet<string> = new Set(['market.buy', 'market.sell']);

export function isDomainAgnosticCall(call: string): boolean {
  return DOMAIN_AGNOSTIC_CALLS.has(call);
}

export class CrossDomainTotalError extends Error {
  constructor(domains: readonly LedgerDomain[]) {
    super(
      `refusing to total across ledger domains (${[...new Set(domains)].sort().join(' + ')}). ` +
        'I-4 solvency holds per instance against its own sovereign account, so a combined ' +
        'figure asserts a backing pool that does not exist (10 §11; 11 §11.2a rule 2).',
    );
    this.name = 'CrossDomainTotalError';
  }
}

/**
 * Sum within one domain, refusing a mixed input.
 *
 * The refusal is the feature. A helper that silently summed whatever it was handed would
 * make rule 3 a convention rather than a property, and the failure it guards against —
 * a portfolio total spanning both ledgers — is invisible on screen precisely because it
 * looks like a larger correct number.
 */
export function totalWithinDomain(
  rows: readonly Domained<bigint>[],
): { readonly domain: LedgerDomain; readonly total: bigint } | undefined {
  if (rows.length === 0) return undefined;
  const domains = rows.map((r) => r.domain);
  const first = domains[0] as LedgerDomain;
  if (domains.some((d) => d !== first)) throw new CrossDomainTotalError(domains);
  return { domain: first, total: rows.reduce((acc, r) => acc + r.value, 0n) };
}

/** Partition rows by domain so a caller can render both without ever merging them. */
export function partitionByDomain<T>(
  rows: readonly Domained<T>[],
): Readonly<Record<LedgerDomain, readonly T[]>> {
  const primary: T[] = [];
  const service: T[] = [];
  for (const row of rows) (row.domain === 'service' ? service : primary).push(row.value);
  return Object.freeze({ primary, service });
}

/**
 * Which `FutarchyApi` position view answers for a domain, and which storage prefix its
 * FE-P2 conservative cross-check must run against (10 §11, final bullet).
 *
 * While FE-P2 is unresolved every `FutarchyApi` result on the transaction path is
 * re-derived from direct storage reads. The cross-check is **per domain**: satisfying
 * one domain's view with the other's keys would make the check vacuous in exactly the
 * case it exists for, so the view and the prefix are returned together and never
 * separately selectable.
 */
export function positionSourceFor(domain: LedgerDomain): {
  readonly api: 'account_positions' | 'service_positions';
  readonly storagePallet: string;
} {
  return domain === 'service'
    ? { api: 'service_positions', storagePallet: 'ServiceLedger' }
    : { api: 'account_positions', storagePallet: 'ConditionalLedger' };
}

/**
 * A finalized read that also knows its domain.
 *
 * Provenance and domain are orthogonal by construction: this is `Finalized<T>` *and* a
 * domain, never a new `VerificationStatus` variant (10 §11).
 */
export type FinalizedDomained<T> = Finalized<Domained<T>>;
