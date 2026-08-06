/**
 * S4 — positions, redemption and the VOID layout, across **both** ledger domains.
 *
 * 11 §11.2's S4 row, §11.2a's five rules, §11.5's payout presentation and §11.6's VOID
 * decomposition. The arithmetic is all decided elsewhere — `ledger-domain.ts`,
 * `void-recovery.ts`, `redemption-ticket.ts` over `@bleavit/protocol` — and what this file
 * owns is the set of things a *rendering* can get wrong while every model stays correct.
 *
 * ## Four rules made unreachable rather than remembered
 *
 * 1. **No merged portfolio total (§11.2a rule 2).** `PositionsView` has two books, each
 *    generic in its own domain, and **no field** a combined figure could occupy. A service
 *    row cannot be placed in the primary book because `PositionRow<'service'>` is not a
 *    `PositionRow<'primary'>`. I-4 solvency holds per instance against that instance's own
 *    sovereign account, so one figure spanning both asserts a backing pool that does not
 *    exist — and it does so by looking like a larger correct number.
 * 2. **No winning branch under VOID or on a Baseline vault.** §11.6: *"There is no 'winning
 *    branch' under VOID; any UI element that gates redemption on a winning position MUST NOT
 *    render for a `Voided` vault."* §11.2: the positions and redemption screens *"MUST NOT
 *    fabricate or display a winning branch for a Baseline vault"*. Both are enforced by
 *    {@link VaultProjection}: its `voided` and `baseline-settled` arms carry **no `winner`
 *    field**, so the element has nothing to read.
 * 3. **No fee line on an exempt payout (§11.5 rule 1, P-4/P-5, §11.6).** The `exempt` arm of
 *    `RedemptionQuote` has no `fee` and no `net`, so `RedemptionTicket` cannot render one.
 *    The VOID panel takes no rate, no `MinSplit` and no quote at all — `redeem_void` and
 *    every `merge*` are exempt, and §11.6 says the `floor(a/2)` / `floor(a/4)` rates are what
 *    the account receives *"gross and net alike"*.
 * 4. **The par promise is copy, and it is rarer than the action (SQ-171).**
 *    `mayOfferParMerge` decides whether the merge button renders; `parCopyPermitted` decides
 *    whether the words *par* and *full principal* may appear. The second is strictly rarer —
 *    it requires the decomposition to have left **no** residue — because a portfolio of one
 *    unit of pair and ninety-nine of residue recovers far under par while a pair plainly
 *    exists.
 *
 * ## The two above-the-fold facts on this screen
 *
 * §11.2 constraint 3 names `void-recovery-decomposition` (§11.6) and
 * `charged-redemption-net-payout` (§11.5) among the facts that change the meaning of a
 * signature and therefore may never sit behind a disclosure step. Both are emitted here
 * through `AlwaysVisible`, which throws if a caller ever nests one inside a `Disclosure`.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.2a, §11.5, §11.6
 * @see docs/architecture/03-conditional-ledger.md §5.3, §5.3a, §6.4
 */

import {
  AlwaysVisible,
  Amount,
  Button,
  DataTable,
  Datum,
  Derived,
  Field,
  Identifier,
  Notice,
  Panel,
  Undecodable,
  aboveTheFold,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Combined, Verified } from '@bleavit/shared-types';

import type { LedgerDomain } from './ledger-domain.js';
import type { Branch, GateType, VoidResidual } from './void-recovery.js';
import type { RedemptionQuote } from './redemption-ticket.js';

/**
 * The vault state a position is projected onto — 11 §11.2's *Position-state projection*.
 *
 * Deliberately five arms rather than a state string plus optional fields. The two arms that
 * have no winning branch have no field for one, which is what makes §11.6's *"any UI element
 * that gates redemption on a winning position MUST NOT render for a `Voided` vault"* a
 * property of the type instead of a review note.
 */
export type VaultProjection =
  | { readonly kind: 'open' }
  | { readonly kind: 'resolved'; readonly branch: Verified<string> }
  | {
      readonly kind: 'scalar-settled';
      readonly winner: Verified<string>;
      /** The settlement score `s`, on the 1e9 grid (03 §5.3). */
      readonly score: Verified<bigint>;
    }
  /** D-1. No winner, by construction — see the note on this type. */
  | { readonly kind: 'voided' }
  /** `PositionId::Baseline` renders the branch-free `BaselineSettled { s }` (11 §11.2). */
  | { readonly kind: 'baseline-settled'; readonly score: Verified<bigint> };

/** One holding, and the domain whose backing pool it is drawn against. */
export interface PositionRow<D extends LedgerDomain = LedgerDomain> {
  readonly domain: D;
  /** The `PositionId` as the client renders it — established by the §11.2a rule-1 bit test. */
  readonly positionId: Verified<string>;
  /** Which instrument: `BranchUsdc(Accept)`, `Long(Reject)`, `GateYes(Accept, Survival)`, … */
  readonly instrument: Verified<string>;
  readonly balance: Verified<bigint>;
  readonly vault: VaultProjection;
}

/**
 * One domain's book. Generic in its domain so the two cannot be mixed at a call site.
 *
 * `total` is a {@link Combined} rather than a `Verified`, because it is derived from every
 * row's read: two rows read at different blocks make the sum true of neither, and `Derived`
 * renders that refusal instead of a number.
 */
export interface DomainBook<D extends LedgerDomain> {
  readonly domain: D;
  readonly rows: readonly PositionRow<D>[];
  readonly total: Combined<bigint>;
}

/** A value read but not interpretable. Rendered as raw SCALE, never substituted (INV-FE-12). */
export interface UndecodableRead {
  readonly label: string;
  readonly rawHex: string;
  readonly reason: string;
}

/** Chain state the client read but cannot reconcile. Reported, never silently resolved. */
export interface PositionAnomaly {
  readonly detail: string;
}

/**
 * The whole S4 model.
 *
 * There is no `total`, no `portfolio` and no `combined` field, and that absence is §11.2a
 * rule 2. Adding one later requires adding a field, which is a diff a reviewer sees.
 */
export interface PositionsView {
  readonly primary: DomainBook<'primary'>;
  readonly service: DomainBook<'service'>;
  readonly undecodable: readonly UndecodableRead[];
  readonly anomalies: readonly PositionAnomaly[];
}

/**
 * Per-domain copy. §11.2a rule 1 requires the domain visible wherever a row is rendered, and
 * rule 3 forbids copy implying that trading a hosted book participates in governing Bleavit.
 */
export const DOMAIN_COPY: Readonly<
  Record<LedgerDomain, { readonly title: string; readonly note: string }>
> = Object.freeze({
  primary: {
    title: 'Bleavit positions',
    note:
      'These are positions in Bleavit’s own governance markets. They are backed by the ' +
      'primary conditional ledger.',
  },
  service: {
    title: 'External (hosted) positions',
    note:
      'These are positions in questions hosted for an external client. They are backed by a ' +
      'separate ledger with its own reserves, and they are not part of governing Bleavit: ' +
      'nothing here feeds a decision, a gate, a welfare pillar or NAV.',
  },
});

/**
 * Why the two books are never added together, said to the user rather than only to a reader
 * of this file. Fixed copy, so it can carry no chain value (§11.2a rule 2).
 */
export const NO_MERGED_TOTAL =
  'Each book is totalled on its own. Bleavit does not show one figure across both, because ' +
  'each ledger is backed by its own reserves — a combined number would claim a single pool ' +
  'that does not exist.';

function amountRender(decimals: number, symbol: string): (value: bigint) => string {
  return (value) => `${formatBaseUnits(value, decimals)} ${symbol}`;
}

/**
 * A settlement score `s`, on the 1e9 grid `FixedU64` uses (03 §5.3).
 *
 * Rendered through `Datum` rather than `Amount` or `Ratio`, and neither is an aesthetic
 * choice: `Amount` is the only component that can render a currency and `s` is not money,
 * while `Ratio` reads parts-per-million and would state a score of 0.5 as 0.00005 %.
 */
const scoreRender = (value: bigint): string => formatBaseUnits(value, SCORE_DECIMALS);

/** The `FixedU64` scale (`futarchy_primitives::kernel::SCORE_SCALE` = 1e9), as a digit count. */
const SCORE_DECIMALS = 9;

/** How a vault state reads on a position card. Fixed copy, one sentence per arm. */
export const VAULT_COPY: Readonly<Record<VaultProjection['kind'], string>> = Object.freeze({
  open: 'This vault is open. Nothing has settled yet.',
  resolved:
    'One branch was annulled. Complete pairs merge at par; there is no unpaired redemption in ' +
    'this state.',
  'scalar-settled': 'This vault has settled. Redemption is open on the winning branch.',
  voided:
    'This vault was voided. There is no winning branch, and no redemption here depends on ' +
    'holding one.',
  'baseline-settled':
    'This Baseline vault has settled. A Baseline vault has no branches, so there is no ' +
    'winning branch to show.',
});

function VaultState({ vault }: { readonly vault: VaultProjection }): ReactNode {
  return (
    <div className="vault-state" data-vault-state={vault.kind}>
      <span className="vault-state__copy">{VAULT_COPY[vault.kind]}</span>
      {vault.kind === 'resolved' ? (
        <Field label="Annulled branch">
          <Identifier datum={vault.branch} />
        </Field>
      ) : null}
      {/* The only arm carrying a winner. `voided` and `baseline-settled` have no such field,
          so this branch is unreachable for them by type rather than by an `if`. */}
      {vault.kind === 'scalar-settled' ? (
        <>
          <Field label="Winning branch">
            <Identifier datum={vault.winner} />
          </Field>
          <Field label="Settlement score">
            <Datum datum={vault.score} render={scoreRender} />
          </Field>
        </>
      ) : null}
      {vault.kind === 'baseline-settled' ? (
        <Field label="Settlement score">
          <Datum datum={vault.score} render={scoreRender} />
        </Field>
      ) : null}
    </div>
  );
}

function BookPanel<D extends LedgerDomain>({
  book,
  decimals,
  symbol,
}: {
  readonly book: DomainBook<D>;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  const copy = DOMAIN_COPY[book.domain];
  return (
    <Panel title={copy.title} tone="advanced">
      <Notice severity="info" heading="Which ledger these belong to">
        {copy.note}
      </Notice>
      {book.rows.length === 0 ? (
        <Notice severity="info" heading="No positions in this ledger">
          This account holds nothing here at the block below.
        </Notice>
      ) : (
        <DataTable
          caption={`Positions in the ${book.domain} ledger`}
          headers={['Position', 'Instrument', 'Balance', 'Vault']}
          rows={book.rows.map((row) => ({
            key: row.positionId.value,
            cells: [
              <Identifier datum={row.positionId} key={`id-${row.positionId.value}`} />,
              <Identifier datum={row.instrument} key={`kind-${row.positionId.value}`} />,
              <Amount
                datum={row.balance}
                decimals={decimals}
                symbol={symbol}
                key={`bal-${row.positionId.value}`}
              />,
              <VaultState vault={row.vault} key={`vault-${row.positionId.value}`} />,
            ],
          }))}
        />
      )}
      <Field label={`Total in the ${book.domain} ledger`}>
        <Derived combined={book.total} render={amountRender(decimals, symbol)} />
      </Field>
    </Panel>
  );
}

/**
 * The S4 screen — two books, side by side, never added.
 *
 * The two panels render unconditionally, including when a domain is empty. A hosted book
 * that vanished from the screen because the account holds nothing in it is indistinguishable
 * from a client that stopped reading that domain, and §11.2a rule 1 wants the split visible.
 */
export function Positions({
  view,
  decimals,
  symbol,
}: {
  readonly view: PositionsView;
  readonly decimals: number;
  readonly symbol: string;
}): ReactNode {
  return (
    <Panel title="Positions">
      <Notice severity="info" heading="Two ledgers, two totals">
        {NO_MERGED_TOTAL}
      </Notice>
      <BookPanel book={view.primary} decimals={decimals} symbol={symbol} />
      <BookPanel book={view.service} decimals={decimals} symbol={symbol} />
      {view.anomalies.map((anomaly) => (
        <Notice severity="danger" heading="A row was read but not rendered" key={anomaly.detail}>
          {anomaly.detail}
        </Notice>
      ))}
      {view.undecodable.map((row) => (
        <Undecodable label={row.label} rawHex={row.rawHex} reason={row.reason} key={row.label} />
      ))}
    </Panel>
  );
}

// ------------------------------------------------------------------ the redemption ticket

/**
 * §11.5 rule 3's presentation: `net` is the headline, `gross` and `fee` are itemized beside
 * it, and the displayed fee is the **protocol's** — never summed with the §11.3 transaction
 * fee, which is a separate deduction in a separate asset.
 */
export const FEE_IS_NOT_THE_TRANSACTION_FEE =
  'This is the protocol’s redemption fee. It is not the transaction fee, which is charged ' +
  'separately and in the asset you selected to pay fees in. The two are never added together.';

export function RedemptionTicket({
  quote,
  decimals,
  symbol,
  onSubmit,
}: {
  readonly quote: RedemptionQuote;
  readonly decimals: number;
  readonly symbol: string;
  readonly onSubmit: () => void;
}): ReactNode {
  const render = amountRender(decimals, symbol);

  if (quote.kind === 'unavailable') {
    // §11.5 rule 5: the figure is disabled with an explanation and the transaction blocked.
    // A number is never shown here — the runtime's own read fails open and a client must not
    // mirror that, so this arm renders a refusal in place of a payout.
    return (
      <Panel title="Redeem">
        <Notice severity="danger" heading="This payout cannot be stated">
          {quote.reason}
        </Notice>
        <Button
          label="Redeem"
          intent="primary"
          onClick={onSubmit}
          disabled
          disabledReason="The payout is computed from chain-read values, and one of them could not be read."
        />
      </Panel>
    );
  }

  if (quote.kind === 'exempt') {
    return (
      <Panel title="Redeem">
        {/* No fee line: this arm carries no fee field, so there is nothing to render. */}
        <Field label="You will receive">
          <Derived combined={quote.gross} render={render} />
        </Field>
        <Notice severity="info" heading="No redemption fee applies">
          {quote.exemption}
        </Notice>
        <Button label="Redeem" intent="primary" onClick={onSubmit} />
      </Panel>
    );
  }

  return (
    <Panel title="Redeem">
      <AlwaysVisible
        fold={aboveTheFold(
          'charged-redemption-net-payout',
          <div className="payout">
            <Field label="You will receive">
              <Derived combined={quote.net} render={render} />
            </Field>
            <span className="payout__itemization">
              <Derived combined={quote.gross} render={render} name="gross" />
              <Derived combined={quote.fee} render={render} name="redemption fee" />
            </span>
            <span className="payout__note">{FEE_IS_NOT_THE_TRANSACTION_FEE}</span>
          </div>,
        )}
      />
      <Button label="Redeem" intent="primary" onClick={onSubmit} />
    </Panel>
  );
}

// --------------------------------------------------------------------- the VOID layout

/** One consolidation step, with its amount carrying the provenance of the holdings read. */
export interface VoidConsolidationRow {
  readonly call: 'merge_scalar' | 'merge_gate';
  readonly branch: Branch;
  readonly gate?: GateType | undefined;
  readonly amount: Combined<bigint>;
}

/** One unpaired instrument, with the exact floored payout §11.6 step 2 states. */
export interface VoidResidualRow {
  readonly branch: Branch;
  readonly kind: VoidResidual['kind'];
  readonly gate?: GateType | undefined;
  readonly amount: Combined<bigint>;
  readonly payout: Combined<bigint>;
}

/**
 * §11.6's decomposition with provenance attached.
 *
 * `total` is step 3's headline — *"the total recovery those actual holdings reach"* — and it
 * is the only figure this panel may lead with. `parPair` is rendered beneath it, never
 * instead of it.
 */
export interface VoidRecoveryView {
  readonly total: Combined<bigint>;
  readonly parPair: Combined<bigint>;
  readonly consolidations: readonly VoidConsolidationRow[];
  readonly residuals: readonly VoidResidualRow[];
  /** Offer the cross-branch merge action at all (a pair exists). */
  readonly mayOfferParMerge: boolean;
  /** Say "par" / "full principal" (the decomposition left no residue) — SQ-171. */
  readonly parCopyPermitted: boolean;
}

/**
 * §11.6 step 2's copy, normative intent, localizable wording.
 *
 * Fixed in the bundle and taking no argument, so it can never carry a chain value past a
 * badge. The rates in it are the ones D-1 fixes; the *amounts* are rendered beside it as
 * badged data.
 */
export const VOID_COPY =
  'This vault was voided. Cross-branch complete pairs (Accept and Reject) recover 100% by ' +
  'merging; a same-branch LONG+SHORT set alone does not — merging it yields one branch-USDC, ' +
  'worth 0.5 under VOID. An unpaired single-branch position redeems at 0.5 per branch-USDC ' +
  '(0.25 per LONG/SHORT) — the value of a voided binary claim.';

/**
 * The sentence §11.6 step 3 requires beside the headline.
 *
 * Not a penalty and not a confiscation: no copy on this screen may describe the rates that
 * way, and this is the wording that says what the difference from the original debit actually
 * is.
 */
export const VOID_NEUTRAL_PRICE =
  'These rates are the neutral price of a voided binary claim, not a penalty. Any difference ' +
  'from what you originally paid is the premium or discount of your realized average ' +
  'execution price against the neutral prior, plus fees.';

/** Step 1a is value-neutral, and may never sit under a 100 %-recovery heading (§11.6, E16). */
export const CONSOLIDATION_IS_NOT_RECOVERY =
  'Consolidating pays no USDC. It merges a same-branch set into one branch-USDC of that same ' +
  'branch, which is worth par only once paired with the opposite branch, and 0.5 otherwise.';

/** Permitted only when the holdings are complete across both branches (SQ-171). */
export const PAR_COPY =
  'Your holdings are complete across both branches, so merging them returns your full ' +
  'principal at par.';

/** The honest alternative when a pair exists but residue does too (SQ-171). */
export const PART_PAR_COPY =
  'Merging your cross-branch pairs returns those at par. The rest of your holdings are ' +
  'unpaired and recover at the rates below, so your total recovery is less than par.';

export function VoidRecoveryPanel({
  view,
  decimals,
  symbol,
  onMergePairs,
  onConsolidate,
  onRedeemVoid,
}: {
  readonly view: VoidRecoveryView;
  readonly decimals: number;
  readonly symbol: string;
  readonly onMergePairs: () => void;
  readonly onConsolidate: (row: VoidConsolidationRow) => void;
  readonly onRedeemVoid: (row: VoidResidualRow) => void;
}): ReactNode {
  const render = amountRender(decimals, symbol);
  return (
    <Panel title="This vault was voided">
      <AlwaysVisible
        fold={aboveTheFold(
          'void-recovery-decomposition',
          <div className="void-recovery">
            {/* Step 3's headline: the total these actual holdings reach, never the par value
                of the pairs alone. */}
            <Field label="Total recovery from these holdings">
              <Derived combined={view.total} render={render} />
            </Field>
            <p className="void-recovery__copy">{VOID_COPY}</p>
            <p className="void-recovery__neutral">{VOID_NEUTRAL_PRICE}</p>
            {/* SQ-171. The par promise is made only for holdings complete across both
                branches; a portfolio that is part pairs and part residue gets the honest
                sentence instead. */}
            {view.parCopyPermitted ? (
              <p className="void-recovery__par">{PAR_COPY}</p>
            ) : view.mayOfferParMerge ? (
              <p className="void-recovery__part-par">{PART_PAR_COPY}</p>
            ) : null}
          </div>,
        )}
      />

      {/* E16: the cross-branch merge is visually primary whenever a cross-branch pair
          exists, and it is the only action that may carry a 100 % label. */}
      {view.mayOfferParMerge ? (
        <Panel title="Merge pairs → 100% recovery">
          <Field label="Pairable across branches">
            <Derived combined={view.parPair} render={render} />
          </Field>
          <Button label="Merge pairs" intent="primary" onClick={onMergePairs} />
        </Panel>
      ) : null}

      {view.consolidations.length > 0 ? (
        <Panel title="Consolidate same-branch sets">
          <Notice severity="caution" heading="This is not a recovery step">
            {CONSOLIDATION_IS_NOT_RECOVERY}
          </Notice>
          {view.consolidations.map((row) => (
            <Field
              label={`${row.call} · ${row.branch}${row.gate === undefined ? '' : ` · ${row.gate}`}`}
              key={`${row.call}-${row.branch}-${row.gate ?? 'scalar'}`}
            >
              <Derived combined={row.amount} render={render} />
              <Button
                label="Consolidate"
                onClick={() => onConsolidate(row)}
                describedBy={`${row.call}-${row.branch}`}
              />
            </Field>
          ))}
        </Panel>
      ) : null}

      {view.residuals.length > 0 ? (
        <Panel title="Redeem unpaired holdings">
          {/* No fee line anywhere on this panel: `redeem_void` and every merge primitive are
              exempt (03 §5.3a(1)), so the floored figures are gross and net alike. */}
          <DataTable
            caption="Unpaired holdings and the exact amount each redeems for"
            headers={['Branch', 'Instrument', 'Held', 'Redeems for', '']}
            rows={view.residuals.map((row) => ({
              key: `${row.branch}-${row.kind}-${row.gate ?? 'none'}`,
              cells: [
                row.branch,
                row.gate === undefined ? row.kind : `${row.kind} (${row.gate})`,
                <Derived
                  combined={row.amount}
                  render={render}
                  key={`held-${row.branch}-${row.kind}-${row.gate ?? 'none'}`}
                />,
                <Derived
                  combined={row.payout}
                  render={render}
                  key={`pay-${row.branch}-${row.kind}-${row.gate ?? 'none'}`}
                />,
                <Button
                  label="Redeem"
                  onClick={() => onRedeemVoid(row)}
                  key={`act-${row.branch}-${row.kind}-${row.gate ?? 'none'}`}
                />,
              ],
            }))}
          />
        </Panel>
      ) : null}
    </Panel>
  );
}
