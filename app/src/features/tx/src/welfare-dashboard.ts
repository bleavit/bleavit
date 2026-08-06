/**
 * S7's model — the welfare and constitution dashboard (11 §11.2, doc 05).
 *
 * It is a reading screen with no extrinsic, so nothing here refuses a transaction. What it
 * owns instead is four ways of *misreporting* chain state, each of which renders as a
 * perfectly ordinary number.
 *
 * ## 1. A spec version is meaningless unless the chain says it is
 *
 * > `WelfareView.spec_version` is meaningful only when `active_spec_available == true`. A
 * > selected `MetricSpecVersion` of zero is legal and MUST still set
 * > `active_spec_available`; a false flag means that no unique active spec is available.
 * > — 02 §4
 *
 * The tempting shape is `specVersion: Verified<number>` plus a flag, and then a screen
 * renders "MetricSpec v0" for a chain that has no active spec at all — a truthful-looking
 * label over an absent fact, and `0` is exactly the value it would print. So
 * {@link ActiveSpec} is a discriminated union whose unavailable arm **has no version
 * field**, the same control `ProposalView` uses for decision statistics.
 *
 * ## 2. "No breach recorded" and "nothing recorded" are the same bitmap and different facts
 *
 * 05 §4.7 is explicit: `day_bitmap` records breached days only, so an unsampled epoch and
 * a clean epoch are indistinguishable *in the flags*. What distinguishes them is the
 * presence of the `Welfare.GateBreachFlags` entry — *"entry presence **is** 'sampled at
 * least once'"*. The same paragraph keeps the permissive default for **display**: a
 * not-yet-sampled current epoch legitimately reads "no breach so far". Both halves are
 * needed, so {@link gateReading} is a three-state function of the flag and the entry, and
 * a screen cannot collapse them by accident.
 *
 * ## 3. A `params()` scalar is not a display unit
 *
 * > `ParamView.value`, `.min` and `.max` carry the raw inner scalar of the stored
 * > `ParamValue` … These fields MUST NOT be interpreted as the human/display unit in 13.
 * > — 02 §4
 *
 * `ParamView` publishes no unit tag, so the client cannot know which grid a key is on
 * without keeping its own copy of doc 13's type column — a second table that can drift
 * from the one that governs. {@link ParamRow} therefore carries **no unit field and no
 * projection**: the raw scalar is rendered as the raw scalar, and the screen says so. A
 * row that helpfully printed `30 bps` for a `Perbill` of `3,000,000` would be inventing
 * the one thing this sentence forbids inventing.
 *
 * ## 4. External books are not protocol health
 *
 * 11 §11.2a rule 3: *"No external book, position, volume or fee may be rendered as an
 * input to a decision statistic, a gate, a welfare pillar, or NAV."* This model has no
 * field any service-domain figure could occupy, which is the only form of that rule a
 * screen cannot forget.
 *
 * @see docs/architecture/05-welfare-and-decision-engine.md §4.1, §4.6, §4.7
 * @see docs/architecture/02-integration-contract.md §4, §7.3, §7.4
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.2a
 */

import type { Verified } from '@bleavit/shared-types';

/**
 * The 02 §4 `WelfareView` pillars, on the contract's 1e9 grid.
 *
 * Named `…1e9` throughout so no call site can forget which grid it is on. Rendering one
 * through a parts-per-million formatter is a factor of a thousand, in the direction that
 * makes a breached gate look healthy.
 */
export interface WelfarePillars {
  readonly epoch: Verified<number>;
  readonly sPillar1e9: Verified<bigint>;
  readonly cOnchain1e9: Verified<bigint>;
  readonly cAttested1e9: Verified<bigint>;
  readonly pPillar1e9: Verified<bigint>;
  readonly aPillar1e9: Verified<bigint>;
  readonly gateS1e9: Verified<bigint>;
  readonly gateC1e9: Verified<bigint>;
  readonly wCurrent1e9: Verified<bigint>;
}

/**
 * Which MetricSpec the chain is scoring against, if it can say.
 *
 * The `unavailable` arm carries no version, so there is nowhere to put the `0` a false
 * `active_spec_available` would otherwise be rendered as.
 */
export type ActiveSpec =
  | { readonly available: true; readonly version: Verified<number> }
  | { readonly available: false };

/** What a gate flag can honestly be said to be. */
export type GateReading = 'breached' | 'no-breach-so-far' | 'not-sampled';

/**
 * A gate's state from its display flag and whether the epoch was sampled at all.
 *
 * `sampled` is the presence of the epoch's `Welfare.GateBreachFlags` entry, not a count:
 * 05 §4.7 makes the entry written on the first successful recording *whether or not that
 * day breached*, so presence is the sampling fact and the bitmap is not.
 */
export function gateReading(breached: boolean, sampled: boolean): GateReading {
  if (breached) return 'breached';
  return sampled ? 'no-breach-so-far' : 'not-sampled';
}

/** What each reading means, in the client's own voice. Frozen so it cannot be softened. */
export const GATE_READING_COPY: Readonly<Record<GateReading, string>> = Object.freeze({
  breached:
    'A daily gate breach is flagged for this epoch. Gate books settle on these flags, and ' +
    'the execution queue is blocked while a hard-gate breach stands.',
  'no-breach-so-far':
    'This epoch has been sampled and no breach has been flagged so far. The epoch is not ' +
    'over, so this is a statement about the days recorded, not about the whole epoch.',
  'not-sampled':
    'No daily observation has been recorded for this epoch yet, so there is nothing to ' +
    'report. That is not the same as "no breach": an unsampled epoch and a clean one carry ' +
    'the same flags, and this client will not present one as the other.',
});

/**
 * One `params()` row, exactly as 02 §4 publishes it.
 *
 * Every scalar is the **raw inner value** of the stored `ParamValue`. There is deliberately
 * no unit field, no decimals field and no projected form — see the module note.
 */
export interface ParamRow {
  readonly key: Verified<string>;
  readonly value: Verified<bigint>;
  readonly min: Verified<bigint>;
  readonly max: Verified<bigint>;
  /** The exact inclusive next-value interval after intersecting the bounds with max-Δ. */
  readonly minNext: Verified<bigint>;
  readonly maxNext: Verified<bigint>;
  readonly cooldownBlocks: Verified<number>;
  readonly lastChange: Verified<number>;
  /** The class of proposal that may amend this key. */
  readonly klass: Verified<string>;
}

/** The one sentence every constitution table on this screen must carry (02 §4). */
export const RAW_SCALAR_NOTE =
  'These are the raw stored scalars, not display units. A rate stored as a Perbill reads ' +
  'in parts per billion and a fixed-point value on the 1e9 grid; this client does not ' +
  'convert them, because the parameter view publishes no unit and a guessed one would be a ' +
  'second copy of doc 13’s table that can drift from it.';

/** The 1e9 grid every `FixedU64` in the contract uses — a decimal width, not a value. */
export const FIXED_DECIMALS = 9;

/**
 * A retained welfare snapshot, keyed as the chain keys it.
 *
 * `(epoch, spec_version)` rather than `epoch` alone, because 05 §3.3 runs one game per
 * frozen version and an epoch legitimately carries more than one record. Keying a screen
 * by epoch alone silently shows one of them and hides the rest.
 */
export interface SnapshotRow {
  readonly epoch: Verified<number>;
  readonly specVersion: Verified<number>;
  readonly w1e9: Verified<bigint>;
}

export interface WelfareDashboard {
  readonly pillars: WelfarePillars;
  readonly activeSpec: ActiveSpec;
  /** `WelfareView.s_breached` with the epoch's sampling fact, per the module note. */
  readonly sGate: GateReading;
  readonly cGate: GateReading;
  /** `WelfareView.reserve_flag` — the B-med reserve-health trigger. */
  readonly reserveFlag: Verified<boolean>;
  /** The retained window, newest first. Bounded by `Welfare::MaxSnapshots` (02 §9). */
  readonly snapshots: readonly SnapshotRow[];
  /** `Welfare::MaxSnapshots`, from the constants API — never a literal. */
  readonly snapshotBound: Verified<number>;
  /** The constitution rows this screen was asked to show. */
  readonly params: readonly ParamRow[];
}

/**
 * Whether the retained snapshot window is full, and therefore a *window* rather than a
 * history.
 *
 * A screen that renders a full ring with no such statement tells a user there were no
 * earlier epochs — the same false claim `RecentSettlements` guards against, arriving here
 * through a different map.
 */
export function snapshotWindowFull(dashboard: WelfareDashboard): boolean {
  return dashboard.snapshots.length >= dashboard.snapshotBound.value;
}

/**
 * The gates this screen must call out, in the order 05 §4.1 composes them.
 *
 * Returned as a list rather than rendered inline so the *set* is testable: the composite
 * `W` is `g(S) · g(C) · GeoComposite(P, A)`, so a screen that showed `W` and only one gate
 * would present a product as though one factor drove it.
 */
export function gatesOf(dashboard: WelfareDashboard): readonly {
  readonly pillar: 'S' | 'C';
  readonly reading: GateReading;
}[] {
  return [
    { pillar: 'S', reading: dashboard.sGate },
    { pillar: 'C', reading: dashboard.cGate },
  ];
}
