/**
 * The `nav()` view — 11 §11.8.3, *"rendered, at last"*. F17.
 *
 * Three of this section's rules forbid **the rendering you would naturally build**, and each
 * is made structural here rather than left as a note.
 *
 * ## 1. The account lines are a partial view, and there is no way to total them
 *
 * > the account fields are a **partial** view of treasury custody — the nine `ops.*` lines
 * > carry no field of their own — and MUST NOT be presented as an additive decomposition of
 * > `total`.
 *
 * The obvious screen is a table of `main`/`pol`/`insurance`/`keeper`/`oracle`/`rewards` with
 * a sum at the bottom, and that sum is **wrong** — nine operational lines have no field in
 * `NavView`, so the parts do not add up to `total` and never will. A reader who sees a
 * decomposition assumes it decomposes; the residual then looks like an error in the chain
 * rather than a documented gap in the view.
 *
 * So `accountLines()` returns lines carrying a **required** `partialNote`, and this module
 * exports **no function that sums them**. A screen wanting a total has to write the fold
 * itself, which is a visible act rather than an accident.
 *
 * ## 2. Under the haircut flag the headline is *replaced*, not annotated
 *
 * > the FE MUST **replace the headline NAV** with the haircut presentation and a persistent
 * > banner … The FE never renders full backing while the flag is set.
 *
 * "Never renders full backing" cannot be a discipline — it is one `<Amount datum={nav.total}>`
 * away at all times. So `navPresentation()` returns a union whose `haircut` arm has **no
 * headline field at all**: the headline is `spendable_nav`, which the chain sets to 0, and
 * `total` is available only as a subordinate line explicitly labelled as unbacked. A screen
 * holding the haircut arm cannot render `total` as the headline, because there is no
 * property to read it from in that position.
 *
 * ## 3. Income is window-bounded, and the type will not let it be called lifetime
 *
 * > Any income figure … MUST be derived from the **ingest-set** events `RevenueSwept` and
 * > `RedemptionFeesSwept` within the committed history window, and labelled as the partial,
 * > window-bounded total it is — never as lifetime protocol revenue.
 *
 * `WindowedIncome` therefore requires `fromBlock` and `toBlock` and carries its own label
 * text; there is no constructor that produces an unlabelled figure. `InsuranceSwept` is
 * deliberately **not** in the ingest set (02 §5), so no field here can be computed from it —
 * the type simply has no slot for one, which is the enforceable form of that sentence.
 */

import { combine, type Combined, type Verified } from '@bleavit/shared-types';

/** 02 §4's `NavView`, field for field. Every one of them renders (§11.8.3). */
export interface NavView {
  readonly total: Verified<bigint>;
  readonly main: Verified<bigint>;
  readonly pol: Verified<bigint>;
  readonly insurance: Verified<bigint>;
  readonly keeper: Verified<bigint>;
  readonly oracle: Verified<bigint>;
  readonly rewards: Verified<bigint>;
  readonly streamRemainders: Verified<bigint>;
  readonly obligations: Verified<bigint>;
  readonly haircutFlag: Verified<boolean>;
  readonly spendableNav: Verified<bigint>;
  readonly meterUtilizationBps: Verified<number>;
  /** 08 §4.1, in Param/Treasury/Code/Meta declaration order — the order is normative. */
  readonly classFloors: readonly [
    Verified<bigint>,
    Verified<bigint>,
    Verified<bigint>,
    Verified<bigint>,
  ];
  /**
   * 08 §1.2's derived `T_ins`, appended trailing at contract v29 (02 §4, SQ-602).
   *
   * §11.8.3 requires `INSURANCE` presented as a **sized reserve against its target**, and
   * this is the only field that answers it — `insuranceStanding`'s `read` arm has no other
   * producer, because §11.8.3 also says *"The FE reads `NavView` and nothing else for this
   * screen"*. Before v29 no surface published the target at all, so the panel could reach
   * only `unestablished`; that is the state SQ-602 was resolved to remove.
   *
   * It is **not** a floor the account is topped up to, and the gap between `insurance` and
   * this figure is **not** a measured shortfall: §1.2's archived-claims decrement is
   * unspecified in v1, so `T_ins` is a deliberate over-estimate and the account is expected
   * to sit below it.
   */
  readonly insuranceTarget: Verified<bigint>;
  /**
   * Whether this runtime has `claim_stream`'s real-asset payout leg wired
   * (02 §4, contract v29; 08 §1.4's A9 follow-up).
   *
   * An unwired runtime refuses **every** claim with `OutflowCustodyUnwired`, so
   * `treasury_streams`' per-stream `claimable_now` describes money no claim can
   * move. §11.8.3 checks this first and blocks the control with a reason about
   * the runtime rather than the stream — the figure is still shown, because a
   * recipient is entitled to know what has vested.
   */
  readonly streamClaimsWired: Verified<boolean>;
}

/** 08 §4.1's declaration order. A named tuple, so an index cannot be mislabelled. */
export const FLOOR_CLASSES = Object.freeze(['PARAM', 'TREASURY', 'CODE', 'META'] as const);
export type FloorClass = (typeof FLOOR_CLASSES)[number];

export interface AccountLine {
  readonly account: string;
  readonly balance: Verified<bigint>;
  /**
   * Required on every line, because the note is what stops the table reading as a
   * decomposition. Making it optional would let one line omit it and the whole table imply
   * completeness.
   */
  readonly partialNote: string;
}

export const PARTIAL_CUSTODY_NOTE =
  'These accounts are a partial view of treasury custody: nine operational lines have no ' +
  'field in the chain’s own view, so these balances do not add up to the total and are not ' +
  'a decomposition of it.';

/** The six accounts `NavView` publishes. No sum is exported — see the module note. */
export function accountLines(nav: NavView): readonly AccountLine[] {
  return [
    { account: 'MAIN', balance: nav.main, partialNote: PARTIAL_CUSTODY_NOTE },
    { account: 'POL', balance: nav.pol, partialNote: PARTIAL_CUSTODY_NOTE },
    { account: 'INSURANCE', balance: nav.insurance, partialNote: PARTIAL_CUSTODY_NOTE },
    { account: 'KEEPER', balance: nav.keeper, partialNote: PARTIAL_CUSTODY_NOTE },
    { account: 'ORACLE', balance: nav.oracle, partialNote: PARTIAL_CUSTODY_NOTE },
    { account: 'REWARDS', balance: nav.rewards, partialNote: PARTIAL_CUSTODY_NOTE },
  ];
}

/** §11.8.3's required banner, verbatim. Fixed copy — it names the playbook a reader looks up. */
export const HAIRCUT_BANNER =
  'reserve health degraded — NAV shown with haircut; split inflows halted (PB-RESERVE)';

/**
 * How the treasury headline is presented.
 *
 * The `haircut` arm carries **no `headline` field**. That is the whole control: a screen
 * cannot render full backing while the flag is set, because in that arm there is no property
 * holding `total` in headline position.
 */
export type NavPresentation =
  | {
      readonly kind: 'full';
      readonly headline: Verified<bigint>;
      readonly spendable: Verified<bigint>;
    }
  | {
      readonly kind: 'haircut';
      /** `spendable_nav`, which 08 §1.2 sets to 0 while the flag stands. */
      readonly headlineSpendable: Verified<bigint>;
      readonly banner: string;
      /**
       * `total` is still readable — but only here, and the label says what it is not.
       * Withholding it entirely would be worse: an operator needs the number, and hiding it
       * invites them to find it somewhere less careful.
       */
      readonly unbackedTotal: Verified<bigint>;
      readonly unbackedTotalLabel: string;
    };

export function navPresentation(nav: NavView): NavPresentation {
  if (nav.haircutFlag.value) {
    return {
      kind: 'haircut',
      headlineSpendable: nav.spendableNav,
      banner: HAIRCUT_BANNER,
      unbackedTotal: nav.total,
      unbackedTotalLabel:
        'Gross total before the haircut — this is not backing available to spend, and while ' +
        'reserve health is degraded the protocol does not treat it as such.',
    };
  }
  return { kind: 'full', headline: nav.total, spendable: nav.spendableNav };
}

/** A class floor and how far `spendable_nav` currently is from it — §11.8.3's "continuous". */
export interface FloorDistance {
  readonly klass: FloorClass;
  readonly floor: Verified<bigint>;
  /** Positive: headroom above the floor. Negative: the floor is not met. */
  readonly distance: bigint;
  readonly meetsFloor: boolean;
}

/**
 * Distance to each class floor, continuously rather than as a pass/fail badge.
 *
 * §11.8.3 asks for *"continuous distance-to-floor"* because a binary indicator hides the
 * approach: a treasury one USDC above a floor and one a million above render identically,
 * and the first is about to stop being able to fund its class.
 *
 * Measured against `spendable_nav`, never `total` — under a haircut `spendable_nav` is 0 and
 * every floor is unmet, which is the true statement. Measuring against `total` would report
 * floors as met while the protocol itself would refuse the spend.
 */
export function floorDistances(nav: NavView): Combined<readonly FloorDistance[]> {
  const statuses = [nav.spendableNav.status, ...nav.classFloors.map((floor) => floor.status)];
  const distances = nav.classFloors.map((floor, index) => {
    const distance = nav.spendableNav.value - floor.value;
    return {
      klass: FLOOR_CLASSES[index] as FloorClass,
      floor,
      distance,
      meetsFloor: distance >= 0n,
    };
  });
  return combine(distances, statuses);
}

/**
 * The two holdings 08's conservative rule marks as zero.
 *
 * §11.8.3: *"In-flight XCM and VIT holdings remain marked 0 with copy explaining the
 * conservative rule."* Modelled as fixed copy with a literal `0n` rather than as a field,
 * because there is nothing to read — the value is 0 *by rule*, and a field would invite a
 * future caller to populate it from somewhere and quietly turn a conservative floor into an
 * estimate.
 */
export const CONSERVATIVE_ZERO_HOLDINGS: readonly {
  readonly holding: string;
  readonly value: bigint;
  readonly why: string;
}[] = Object.freeze([
  {
    holding: 'In-flight XCM',
    value: 0n,
    why:
      'Assets in transit over XCM are counted as zero until they arrive. A message that has ' +
      'been sent is not an asset the treasury can spend, and counting it would let a stalled ' +
      'transfer inflate NAV for as long as it stays stuck.',
  },
  {
    holding: 'VIT holdings',
    value: 0n,
    why:
      'Value-in-transit holdings are counted as zero for the same reason: NAV states what is ' +
      'backed now, not what is expected.',
  },
]);

/**
 * An income figure, which can only exist window-bounded.
 *
 * There is no constructor for an unlabelled or unbounded one, so *"never as lifetime protocol
 * revenue"* is a property of the type rather than a rule to remember. `InsuranceSwept` is not
 * in 02 §5's ingest set and has no slot here — a figure that depended on observing it could
 * not be represented.
 */
export interface WindowedIncome {
  readonly revenueSwept: Verified<bigint>;
  readonly redemptionFeesSwept: Verified<bigint>;
  readonly fromBlock: number;
  readonly toBlock: number;
}

export function incomeLabel(income: WindowedIncome): string {
  return (
    `Income observed between blocks ${income.fromBlock} and ${income.toBlock}, from the ` +
    'RevenueSwept and RedemptionFeesSwept events this client has ingested. This is a ' +
    'partial, window-bounded figure — not lifetime protocol revenue, and not a figure the ' +
    'chain publishes.'
  );
}

/** The two ingest-set components, combined. Their sum is a total *for the window only*. */
export function windowedTotal(income: WindowedIncome): Combined<bigint> {
  return combine(income.revenueSwept.value + income.redemptionFeesSwept.value, [
    income.revenueSwept.status,
    income.redemptionFeesSwept.status,
  ]);
}
