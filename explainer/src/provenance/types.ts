/**
 * Provenance — where a number came from, carried in the type system.
 *
 * The canonical Bleavit client is bound by INV-FE-9: *"Every displayed data item
 * carries an explicit, typed verification status … There is no unlabeled
 * rendering path: UI data components reject unlabeled values by type."*
 *
 * This app verifies nothing on-chain, so it must not borrow that vocabulary and
 * imply that it does. It uses its own three statuses, and the honest one
 * dominates: almost everything here is `simulated`.
 *
 * The enforcement is structural. `Tagged<T>` carries a unique symbol that only
 * this module can produce, and the `<Value>` component accepts nothing else — so
 * a bare `number` reaching the screen is a compile error, not a review miss.
 */

import type { Citation } from '../protocol/citations';

/**
 * A phantom brand: it exists in the type system and never at runtime, so the
 * guarantee costs nothing in the bundle. Only this module can produce a value
 * that satisfies it.
 */
declare const TAG: unique symbol;
interface Brand {
  readonly [TAG]: true;
}

export type Provenance =
  /** A constant or parameter fixed by the specification. Carries its citation. */
  | 'spec'
  /** Computed by the certified protocol core from spec formulas and tagged inputs. */
  | 'derived'
  /** Invented for a scenario. Plausible, illustrative, and not from any chain. */
  | 'simulated';

export type Tagged<T> = {
  readonly value: T;
  readonly prov: Provenance;
  readonly cite?: Citation;
  /** Short note shown on hover/focus, e.g. why a value is provisional. */
  readonly note?: string;
} & Brand;

const make = <T>(
  value: T,
  prov: Provenance,
  cite?: Citation,
  note?: string,
): Tagged<T> => {
  const base: Record<string, unknown> = { value, prov };
  if (cite !== undefined) base['cite'] = cite;
  if (note !== undefined) base['note'] = note;
  // The brand is phantom, so this cast is the only place it is asserted — and
  // this module is the only place that can perform it.
  return base as unknown as Tagged<T>;
};

/** A value the specification fixes. Always cite it. */
export const spec = <T>(value: T, cite: Citation, note?: string): Tagged<T> =>
  make(value, 'spec', cite, note);

/** A value the protocol core computed. Cite the formula's owning section. */
export const derived = <T>(value: T, cite?: Citation, note?: string): Tagged<T> =>
  make(value, 'derived', cite, note);

/** A value invented to make a scenario concrete. Never from a chain. */
export const simulated = <T>(value: T, note?: string): Tagged<T> =>
  make(value, 'simulated', undefined, note);

/** Map the underlying value, keeping provenance. Weakens to `derived` if the
 * input was `simulated`, because a function of simulated data is still simulated. */
export function mapTagged<T, U>(t: Tagged<T>, f: (v: T) => U): Tagged<U> {
  return make(f(t.value), t.prov, t.cite, t.note);
}

/**
 * Combine provenances. The weakest wins, and it never strengthens: this is the
 * local form of the chain client's never-promote rule (doc 10 §2.2, F-2). A
 * derivation over simulated inputs is simulated, permanently.
 */
export function weakest(...provs: Provenance[]): Provenance {
  if (provs.includes('simulated')) return 'simulated';
  if (provs.includes('derived')) return 'derived';
  return 'spec';
}

/** Compute over tagged inputs without ever losing the label. */
export function combine<T>(
  inputs: readonly Tagged<unknown>[],
  value: T,
  cite?: Citation,
  note?: string,
): Tagged<T> {
  return make(value, weakest(...inputs.map((i) => i.prov)), cite, note);
}

export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  spec: 'SPEC',
  derived: 'DERIVED',
  simulated: 'SIMULATED',
};

export const PROVENANCE_DESCRIPTION: Readonly<Record<Provenance, string>> = {
  spec: 'Fixed by the Bleavit specification. The citation names the owning section.',
  derived:
    'Computed here by the protocol core, which is certified against the repository’s reference vector corpus.',
  simulated:
    'Invented for this scenario to make the mechanism concrete. No value on this page was read from a chain.',
};

/**
 * What the real client would read this from — shown in the "what would be
 * verified here" panel so the app explains its own honesty rather than merely
 * asserting it. These are the frozen doc 02 §3 runtime API methods.
 */
export const REAL_SOURCE_METHODS = [
  'epoch_status()',
  'proposal_summaries()',
  'quote(market, side, amount)',
  'decision_stats(pid)',
  'account_positions(who)',
  'execution_queue()',
  'welfare_current()',
  'params(keys)',
  'nav()',
  'recent_cohorts()',
  'open_oracle_rounds()',
  'hosted_report(question)',
  'service_positions(who)',
  'is_reserved_protocol_destination(account)',
  'bond_quote(kind)',
  'treasury_streams()',
] as const;
