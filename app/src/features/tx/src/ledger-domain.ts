/**
 * The two ledger domains — 11 §11.2a, 10 §11, contract v23.
 *
 * The canonical client serves external (hosted) books as ordinary S3/S4
 * surfaces, and this module is the three rules of §11.2a that a screen cannot be
 * trusted to remember:
 *
 * * **rule 1** — domain is decided by a bit test on an id the client already
 *   holds, never inferred from a name, a client id, or which call fetched the
 *   row; and a row whose domain could not be established is not rendered;
 * * **rule 2** — no merged portfolio total, because I-4 solvency holds *per
 *   instance* against that instance's own sovereign account, so one figure
 *   spanning both asserts a backing pool that does not exist;
 * * **rule 5** — a write goes to the pallet instance that owns the row, and the
 *   reachable service subset is smaller than the primary one.
 *
 * ## The boundary is read, never written down
 *
 * `serviceIdBase` is a **required argument** everywhere, and there is no default.
 * `kernel::SERVICE_ID_BASE` is `1 << 63`, and app-code rule 7 forbids that
 * literal appearing here — which is precisely why 02 §9 gives the boundary a
 * metadata home (`ConditionalLedger.ServiceIdBase`) rather than leaving clients
 * to compile it in. A caller that has not read it gets a type error, which is the
 * only failure mode available: a client that guessed the boundary and guessed
 * wrong would label every row of one domain as the other, and every downstream
 * check — the badge, the instance a write is addressed to, the capsule's book
 * `kind` — would agree with it.
 *
 * ## Why rule 2 is a type and not a review note
 *
 * `totalOf` takes the domain **and** rows whose `domain` field is that same
 * literal type, with the rows' type parameter marked `NoInfer`. A caller holding
 * a mixed array cannot make it compile: inference is fixed by the first argument,
 * so a service row in a primary total is a type error at the call site rather
 * than a number nobody questions. That is the same device `packages/contexts`
 * uses by keying positions on domain — give the merged figure nowhere to live
 * rather than a rule to remember.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2a
 * @see docs/architecture/16-hosted-question-service.md §7.1, §7.6
 */

/** Which ledger a question, book, vault or position belongs to (§11.2a rule 1). */
export type LedgerDomain = 'primary' | 'service';

/** The runtime pallet that owns each domain's rows (§11.2a rule 5). */
export type LedgerPallet = 'ConditionalLedger' | 'ServiceLedger';

/**
 * A domain could not be established from the inputs supplied.
 *
 * §11.2a rule 1 forbids rendering such a row at all, so this is thrown rather
 * than returned as an `unknown` domain: an `unknown` arm is one a screen can
 * render with a shrug, and the failure it hides — an id outside `u64`, or a
 * boundary constant that was never read — means the client does not know which
 * backing pool a balance belongs to.
 */
export class LedgerDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerDomainError';
  }
}

/** A call this domain cannot reach (§11.2a rule 5). */
export class UnreachableLedgerCallError extends Error {
  readonly domain: LedgerDomain;
  readonly call: string;

  constructor(domain: LedgerDomain, call: string) {
    super(
      `${call} is not reachable in the ${domain} domain: a hosted question has two books and ` +
        'no gate or Baseline leg (16 §7.6), so this call would fail against a vault map that ' +
        'has never heard of the id (11 §11.2a rule 5)',
    );
    this.name = 'UnreachableLedgerCallError';
    this.domain = domain;
    this.call = call;
  }
}

const U64_MAX = (1n << 64n) - 1n;

export const LEDGER_PALLET: Readonly<Record<LedgerDomain, LedgerPallet>> = Object.freeze({
  primary: 'ConditionalLedger',
  service: 'ServiceLedger',
});

/**
 * The domain of an id, by the single bit test §11.2a rule 1 mandates.
 *
 * `serviceIdBase` is `ConditionalLedger.ServiceIdBase` read from metadata. Both
 * instances publish it and the value is identical — it is a property of the id
 * space, not of either side — so either read is admissible and neither may be
 * replaced by a literal.
 *
 * Refuses rather than guessing on three inputs, each of which would otherwise
 * mislabel silently: an id outside `u64` (not an id this chain allocated), a
 * negative id, and a `serviceIdBase` of zero, which would classify **every** row
 * as hosted — including a user's entire primary portfolio.
 */
export function domainOf(id: bigint, serviceIdBase: bigint): LedgerDomain {
  if (serviceIdBase <= 0n || serviceIdBase > U64_MAX) {
    throw new LedgerDomainError(
      `ConditionalLedger.ServiceIdBase read as ${serviceIdBase.toString()}, which cannot ` +
        'partition the u64 id space; the boundary must be read from chain metadata (02 §9)',
    );
  }
  if (id < 0n || id > U64_MAX) {
    throw new LedgerDomainError(`${id.toString()} is not a u64 id this chain could have allocated`);
  }
  return id >= serviceIdBase ? 'service' : 'primary';
}

/**
 * Every `pallet-conditional-ledger` dispatchable an S4 surface offers, primary
 * domain — 11 §11.2 row S4's extrinsic column, which `app/tests/screens` parses
 * and compares against this list in both directions.
 *
 * Listed in the doc's own order so a diff against it reads.
 */
export const PRIMARY_LEDGER_CALLS: readonly string[] = Object.freeze([
  'split',
  'merge',
  'split_scalar',
  'merge_scalar',
  'split_gate',
  'merge_gate',
  'transfer',
  'redeem',
  'redeem_scalar',
  'redeem_scalar_pair',
  'redeem_gate',
  'redeem_baseline',
  'redeem_baseline_pair',
  'redeem_void',
]);

/**
 * The legs a hosted question does not have (16 §7.6): a gate structure and a
 * Baseline book. Written as the **rule** rather than as a second list, so there
 * is one place to get the subset wrong and a test that checks the rule.
 */
function isStructurallyAbsentInService(call: string): boolean {
  return call.endsWith('_gate') || call.includes('baseline');
}

/**
 * The calls reachable in a domain.
 *
 * The service subset is *derived*, never listed: a hand-written second array
 * agrees with itself and drifts from the rule the moment a call is added. The
 * suite still binds both to doc 11 §11.2's S4 row, so the rule and the document
 * are checked against each other rather than the rule being trusted.
 */
export function callsFor(domain: LedgerDomain): readonly string[] {
  if (domain === 'primary') return PRIMARY_LEDGER_CALLS;
  return PRIMARY_LEDGER_CALLS.filter((call) => !isStructurallyAbsentInService(call));
}

/** A fully-qualified ledger write: the instance, and the call on it. */
export interface LedgerCall {
  readonly pallet: LedgerPallet;
  readonly call: string;
}

/**
 * Route a ledger write to the instance that owns the row (§11.2a rule 5).
 *
 * Throws for a call the domain cannot reach rather than returning it addressed
 * to the right pallet. The runtime would refuse it too — `UnknownVault` against a
 * map that has never held the id — and the doc says plainly that this is *"the
 * correct outcome and a useless one"*: a button that always fails is a button
 * that should never have rendered. Use {@link callsFor} to decide what to offer;
 * this function is the backstop for a caller that offered it anyway.
 *
 * Note what is **not** here: `market.buy`/`sell`. Those are domain-agnostic to
 * the caller because `LedgerRoute::for_book` selects the instance inside the
 * market pallet (16 §7.1), and giving them a routing helper here would invite a
 * caller to route them.
 */
export function ledgerCall(domain: LedgerDomain, call: string): LedgerCall {
  if (!callsFor(domain).includes(call)) {
    throw new UnreachableLedgerCallError(domain, call);
  }
  return { pallet: LEDGER_PALLET[domain], call };
}

/** A balance that knows which backing pool it is drawn against. */
export interface LedgerRow<D extends LedgerDomain = LedgerDomain> {
  readonly domain: D;
  readonly amount: bigint;
}

/**
 * The total of one domain's rows — and there is deliberately no function that
 * totals two (§11.2a rule 2).
 *
 * `NoInfer` on the rows is the whole control. Without it a mixed array widens
 * `D` to `'primary' | 'service'`, the `domain` argument still satisfies it, and
 * a cross-domain total compiles. With it, `D` is fixed by the first argument
 * alone and a foreign row is a type error at the call site.
 *
 * Per-domain totals shown side by side are the honest form; a single figure
 * summing both asserts one backing pool where there are two.
 */
export function totalOf<D extends LedgerDomain>(
  domain: D,
  rows: readonly LedgerRow<NoInfer<D>>[],
): bigint {
  let total = 0n;
  for (const row of rows) {
    if (row.domain !== domain) {
      // Reachable from untyped input — a row rehydrated from storage, or one
      // built by a caller that widened the type on the way in. The compile-time
      // control covers the code path; this covers the data path.
      throw new LedgerDomainError(
        `a ${row.domain} row reached a ${domain} total; 11 §11.2a rule 2 forbids one figure ` +
          'spanning both domains, because I-4 solvency holds per instance',
      );
    }
    total += row.amount;
  }
  return total;
}
