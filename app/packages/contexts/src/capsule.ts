/**
 * `bleavit.context.v1` — the exporter. Out only (10 §13.1; 11 §11.14.4; D-21).
 *
 * A capsule is *this user's verified view of the chain, at one finalized block, limited to
 * what they agreed to share this time*. Every rule below follows from one of those three
 * clauses, and the ones worth reading first are the two that fail silently.
 *
 * ## Scope is checked in both directions, and the second direction is the one that lies
 *
 * The obvious implementation filters: take everything the caller has, keep what the scope
 * permits. It cannot leak, so it looks safe. It is half a check, and the missing half
 * produces a document that is *wrong about the chain* rather than merely incomplete.
 *
 *  - **Supplied but not consented** — the leak direction. Refused (`FE-HANDOFF-012`)
 *    rather than dropped, because a silent drop means the export screen offered one scope
 *    and the caller passed another, and nothing would ever surface that disagreement.
 *  - **Consented but not supplied** — the lying direction. Also refused. A capsule whose
 *    scope announces `positions` and whose body carries none reads, to any tool and any
 *    human, as *this user holds no positions*. That is a false statement about chain state
 *    made by a document whose entire purpose is to carry true ones.
 *
 * The distinction that makes the second rule implementable is the one `local-index` already
 * needed for holes: **an empty array is data and an absent key is not**. A user with no
 * positions supplies `[]` and the capsule says so; a caller that forgot to read them
 * supplies nothing and is refused. Collapsing those two is how the lying direction gets
 * written by accident.
 *
 * ## Domain is carried, never inferred, and never summed
 *
 * 11 §11.2a rule 1: every external book and service-domain position is labelled wherever
 * it is rendered, and the label comes from a bit test against
 * `ConditionalLedger::ServiceIdBase` — an id the client already holds, never a name and
 * never a heuristic. A capsule leaves the app and is read somewhere with none of that
 * context, so an unlabelled one is strictly worse than an unlabelled screen: it puts a
 * hosted book's prices beside a governance market's with nothing to tell them apart, which
 * exports precisely the endorsement 16 §1 says Bleavit does not sell.
 *
 * Rule 2 is enforced by shape rather than by discipline. Positions are keyed **by domain**,
 * so the document has no field a merged total could occupy, and `buildCapsule` never adds
 * one because there is nowhere to put it.
 *
 * ## The anchor, and why age is a fact rather than a policy
 *
 * 11 §11.14.3: the capsule's age is *displayed and diffed, never trusted*, and a stated
 * maximum age is honoured only in the narrowing direction. So the capsule carries the block
 * it was read at and nothing resembling an expiry: staleness is bounded structurally by
 * `refreshAndGate` on the way back in, and a producer-chosen lifetime on the way out would
 * be a timer the client is not entitled to believe.
 *
 * ## What this module does not export
 *
 * No `sign`, no `verify`, no `authenticate`. 10 §13.1: capsules are deliberately unsigned,
 * because signing one with the user's chain key reuses a signing key for a non-chain
 * purpose and manufactures an artifact that looks authoritative. What verifies a capsule is
 * re-reading the chain at the block it names, which anyone can do. A test asserts the
 * absence, because this is the module where such a helper would be most tempting to add.
 */

import {
  type ChainBinding,
  HandoffRefusalError,
  canonicalJson,
  digestPreimage,
} from '@bleavit/handoff-envelope';
import { type DomainBoundary, type Finalized, type LedgerDomain, domainOf } from '@bleavit/chain-client';

import {
  ACCOUNT_SCOPES,
  type ExportScope,
  type ScopeKey,
  isAccountScope,
} from './scope.js';
import { CONTEXT_DOMAIN_TAG } from './canonical.js';

/** The `schema` string, validated by exact equality (10 §13.1). */
export const CONTEXT_SCHEMA = 'bleavit.context.v1';

/** Where the capsule was read. This is what makes it independently checkable. */
export interface ContextAnchor {
  readonly blockHash: string;
  readonly blockNumber: number;
}

/**
 * A book, labelled with the domain it belongs to.
 *
 * `kind` is not optional and has no default. A default would be `'governance'` — the
 * common case, and the one that turns a missing label into a false claim rather than into
 * an error.
 */
export interface CapsuleBook {
  readonly id: string;
  readonly kind: LedgerDomain;
  readonly proposalId: string;
  readonly branch: string;
  /** LMSR price in ppm, as the client computed it from finalized state. */
  readonly pricePpm: number;
}

export interface CapsuleProposal {
  readonly id: string;
  readonly state: string;
  readonly title: string;
}

export interface CapsuleDecision {
  readonly proposalId: string;
  readonly outcome: string;
  readonly decidedAtBlock: number;
}

export interface CapsuleEpoch {
  readonly index: number;
  readonly startBlock: number;
}

/** One held position. `bookId` decides the domain; nothing else may. */
export interface CapsulePosition {
  readonly bookId: string;
  readonly baseUnits: bigint;
}

/** A balance, per asset. Never summed across assets or domains. */
export interface CapsuleBalance {
  readonly asset: 'USDC' | 'VIT';
  readonly baseUnits: bigint;
}

/**
 * The chain-derived inputs, each one `Finalized<T>`.
 *
 * 10 §13.1: *"The exporter's input type is `Finalized<T>` (§2.1), so a `provider`-,
 * `derived-local`- or `stale-cache`-status value is untypeable in a capsule."* The brand
 * is constructible only inside `packages/chain-client`, so this is a compile-time control
 * and not a convention — and `FE-HANDOFF-013` covers the case the type system cannot see,
 * a caller with nothing verified to export at all.
 *
 * Every field is optional **at the type level and required by the scope**: which ones must
 * be present is a per-export decision the user makes, so it cannot be expressed in the
 * type. That is what `assertScopeAgrees` is for.
 */
export interface CapsuleReads {
  readonly proposal?: Finalized<readonly CapsuleProposal[]>;
  readonly market?: Finalized<readonly CapsuleBook[]>;
  readonly decision?: Finalized<readonly CapsuleDecision[]>;
  readonly epoch?: Finalized<CapsuleEpoch>;
  readonly positions?: Finalized<readonly CapsulePosition[]>;
  readonly balances?: Finalized<readonly CapsuleBalance[]>;
  readonly address?: Finalized<string>;
}

export interface BuildCapsuleInput {
  readonly binding: ChainBinding;
  readonly anchor: Finalized<ContextAnchor>;
  readonly scope: ExportScope;
  readonly reads: CapsuleReads;
  /**
   * The id band that separates the two ledger domains, from
   * `ConditionalLedger::ServiceIdBase` (02 §9).
   *
   * No default, deliberately — app-code rule 7 forbids the literal `1n << 63n` in client
   * source, and a default would be that literal wearing a parameter name. A caller without
   * a boundary has not read metadata, and a capsule built without one could not have
   * labelled its books.
   */
  readonly boundary: DomainBoundary;
}

/** The emitted document. Canonical JSON sorts the keys; the order here is for readers. */
export interface Capsule {
  readonly schema: typeof CONTEXT_SCHEMA;
  readonly binding: ChainBinding;
  readonly anchor: ContextAnchor;
  /** What the user agreed to share this time. Present so a reader sees what is absent. */
  readonly scope: {
    readonly included: readonly ScopeKey[];
    readonly pseudonymized: boolean;
  };
  // `| undefined` alongside `?` is required by `exactOptionalPropertyTypes` and is the
  // accurate type rather than a concession to it: these fields are *present and undefined*
  // in memory and *absent* in the serialized document, because `canonicalJson` omits an
  // undefined member. The alternative — conditional assignment into a `Record<string,
  // unknown>` — would end in the `as unknown as Capsule` rule 2 bans, and would have made
  // this object's shape unchecked at exactly the point it is being decided.
  readonly proposal?: readonly CapsuleProposal[] | undefined;
  readonly market?: readonly CapsuleBook[] | undefined;
  readonly decision?: readonly CapsuleDecision[] | undefined;
  readonly epoch?: CapsuleEpoch | undefined;
  /** Keyed by domain, so no field can hold a cross-domain total (11 §11.2a rule 2). */
  readonly positions?: Readonly<Record<LedgerDomain, readonly CapsulePosition[]>> | undefined;
  readonly balances?: readonly CapsuleBalance[] | undefined;
  readonly address?: string | undefined;
}

/** A refusal raised while exporting. See `HandoffRefusalError` on why builders throw. */
export class CapsuleError extends HandoffRefusalError {
  constructor(code: 'FE-HANDOFF-012' | 'FE-HANDOFF-013' | 'FE-HANDOFF-002', detail: string) {
    super(code, detail);
    this.name = 'CapsuleError';
  }
}

/**
 * The scope key each read satisfies.
 *
 * Written as a total map from `ScopeKey` rather than from the read names, so a new scope
 * with no read behind it fails to compile here instead of being silently unexportable.
 */
const READ_FOR_SCOPE: Readonly<Record<ScopeKey, keyof CapsuleReads>> = Object.freeze({
  proposal: 'proposal',
  market: 'market',
  decision: 'decision',
  epoch: 'epoch',
  positions: 'positions',
  balances: 'balances',
  address: 'address',
});

/**
 * Both directions of the scope check.
 *
 * Order matters for the message only: the leak direction is reported first because it is
 * the one a user needs to know about immediately, and both are reported by refusing the
 * whole export either way.
 */
function assertScopeAgrees(scope: ExportScope, reads: CapsuleReads): void {
  const consented = new Set<ScopeKey>(scope.included);

  for (const [key, read] of Object.entries(READ_FOR_SCOPE) as [ScopeKey, keyof CapsuleReads][]) {
    const supplied = reads[read] !== undefined;
    if (supplied && !consented.has(key)) {
      throw new CapsuleError(
        'FE-HANDOFF-012',
        `${key} data was supplied but is not in this export's consented scope. Refusing to ` +
          'export it. This is refused rather than dropped because a silent drop would leave ' +
          'the export screen and the exporter disagreeing about what was shared, with ' +
          'nothing to surface the disagreement.',
      );
    }
    if (!supplied && consented.has(key)) {
      throw new CapsuleError(
        'FE-HANDOFF-002',
        `${key} is in the consented scope but no ${key} read was supplied. A capsule whose ` +
          `scope announces ${key} and carries none reads as "there is no ${key} data", which ` +
          'is a false claim about the chain rather than an omission. Supply an empty array ' +
          'if that is what was read — empty is data, absent is not.',
      );
    }
  }
}

/**
 * Refuse an export because nothing verified is available — `FE-HANDOFF-013`.
 *
 * 10 §13.1: in RPC-only, degraded or `read-only-incompatible` modes *"there is nothing to
 * construct a capsule from, and export is disabled with a stated reason rather than
 * silently degraded"*. The mode is the stated reason and travels as expert detail; the
 * sentence the user reads is fixed, from the one table.
 */
export function refuseUnverifiedExport(mode: string): CapsuleError {
  return new CapsuleError(
    'FE-HANDOFF-013',
    `Export is unavailable in ${mode}: a capsule may only be built from finalized, ` +
      'light-client-verified state, and none is available. Nothing has been exported.',
  );
}

/**
 * Partition positions by the domain of the book each one is in.
 *
 * Takes the boundary rather than a pre-labelled row so the label cannot arrive from the
 * call site — 11 §11.2a rule 1 requires it be derived from the id, and an argument of type
 * `LedgerDomain` is exactly the "trust the caller" shape that rule forbids.
 */
function positionsByDomain(
  positions: readonly CapsulePosition[],
  boundary: DomainBoundary,
): Readonly<Record<LedgerDomain, readonly CapsulePosition[]>> {
  const primary: CapsulePosition[] = [];
  const service: CapsulePosition[] = [];
  for (const position of positions) {
    const domain = domainOf(parseId(position.bookId, 'position.bookId'), boundary);
    (domain === 'service' ? service : primary).push(position);
  }
  return Object.freeze({ primary, service });
}

/**
 * Ids travel as decimal strings and are parsed back to `bigint` for the bit test.
 *
 * A `number` would be wrong in the direction that matters: `SERVICE_ID_BASE` is 2^63, so
 * every service-domain id is past 2^53 and `Number` rounds it — and two ids that round to
 * the same value are two rows the client believes are one. The string form is also what the
 * document carries, for the same V-74 reason receipts carry amounts as strings.
 */
function parseId(id: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(id)) {
    throw new CapsuleError(
      'FE-HANDOFF-002',
      `${field} must be a canonical decimal id, got ${JSON.stringify(id)}. A leading zero, ` +
        'a sign or a hex form would each parse to something a reader could not reproduce.',
    );
  }
  return BigInt(id);
}

/**
 * Check every book carries a `kind` that matches its own id.
 *
 * The label is supplied *and* verified rather than derived, which looks redundant and is
 * not: the caller labelled the row on screen (rule 1 applies there too), and a capsule that
 * silently re-derived a different label from the one the user saw would export a claim the
 * user never read. Disagreement is a refusal, not a correction.
 */
function assertBooksLabelled(books: readonly CapsuleBook[], boundary: DomainBoundary): void {
  for (const book of books) {
    const derived = domainOf(parseId(book.id, 'book.id'), boundary);
    if (book.kind !== derived) {
      throw new CapsuleError(
        'FE-HANDOFF-002',
        `book ${book.id} is labelled "${book.kind}" but its id is in the ${derived} band. ` +
          'The label the user saw and the label the id implies must agree; correcting it ' +
          'here would export a claim the user never read.',
      );
    }
  }
}

/**
 * Build a capsule from finalized state.
 *
 * The `Finalized<T>` wrappers are unwrapped here and the document carries plain values.
 * That is correct and worth stating: provenance is a property of *this client's* reading
 * and a JSON file has no way to be verified-finalized. What replaces it is the anchor — a
 * reader re-reads the chain at that block, which is the only check that means anything
 * outside the app.
 */
export function buildCapsule(input: BuildCapsuleInput): Capsule {
  const { binding, anchor, scope, reads, boundary } = input;

  assertScopeAgrees(scope, reads);

  if (reads.market !== undefined) assertBooksLabelled(reads.market.value, boundary);

  // Absent fields are left `undefined` rather than conditionally assigned, because
  // `canonicalJson` omits an undefined member and keeps an explicit null — a property its
  // own suite pins. That keeps this function a single object literal the compiler checks
  // against `Capsule`, instead of a `Record<string, unknown>` accumulated field by field
  // and cast at the end. The cast is the point: `as unknown as` is banned across `app/`
  // (rule 2), and a builder that needs one has usually lost its type, not its patience.
  return {
    schema: CONTEXT_SCHEMA,
    binding,
    anchor: anchor.value,
    scope: { included: [...scope.included].sort(), pseudonymized: scope.pseudonymized },
    proposal: reads.proposal?.value,
    market: reads.market?.value,
    decision: reads.decision?.value,
    epoch: reads.epoch?.value,
    positions:
      reads.positions === undefined
        ? undefined
        : positionsByDomain(reads.positions.value, boundary),
    balances: reads.balances?.value,
    // Pseudonymization is the whole of what the option does: the address is replaced, and
    // the holdings — which remain a fingerprint — are untouched. `scope.pseudonymized`
    // stays in the document so a reader knows an address was withheld rather than absent.
    address: scope.pseudonymized ? undefined : reads.address?.value,
  };
}

/** The canonical JSON bytes of a capsule, for a file, the clipboard or a share sheet. */
export function serializeCapsule(capsule: Capsule): string {
  return canonicalJson(capsule);
}

/** The digest pre-image. Hashing is the caller's, as everywhere else — platforms differ. */
export function capsuleDigestPreimage(capsule: Capsule): Uint8Array {
  return digestPreimage(CONTEXT_DOMAIN_TAG, capsule);
}

/** Re-exported so a caller listing account scopes need not reach two modules. */
export { ACCOUNT_SCOPES, isAccountScope };
