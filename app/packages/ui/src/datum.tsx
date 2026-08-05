/**
 * Data components — 10 §2.1: *"UI data components accept only `Verified<T>`; a component
 * cannot render a value without a status."*
 *
 * ## The structural claim, stated exactly
 *
 * A `Verified<T>` is an **object**, and React's `ReactNode` does not accept an arbitrary
 * object. So a screen holding a model whose leaves are `Verified<T>` cannot write
 * `<span>{model.price}</span>` — it is a type error, not a lint. That is what makes the
 * rule structural rather than a convention: the natural way to get a value onto the screen
 * is to hand the whole `Verified<T>` to one of the components below, and those derive the
 * badge from the status they were given.
 *
 * ## What that claim does *not* cover, said out loud
 *
 * `<span>{model.price.value}</span>` typechecks, because the payload of a `Verified<bigint>`
 * is a `bigint` and React renders one. Nothing in the type system can stop a screen
 * unwrapping a value by hand, so the second half of this control is a source gate —
 * `check-render-provenance.mjs` — which fails on a `.value` access reaching JSX. The two
 * are complements, and each is weak alone: the type layer makes the correct path the easy
 * one, and the gate closes the deliberate bypass.
 *
 * ## The formatter is a function of the payload alone
 *
 * `render` receives `T`, never the `Verified<T>`. A formatter that could see the status
 * could format around it — dropping the qualifier on a `provider` value, or rendering a
 * `stale-cache` figure with the confident typography of a finalized one — and the badge
 * beside it would still say the right thing while the number said the wrong one.
 */

import type { ReactNode } from 'react';
import type { Combined, Verified } from '@bleavit/shared-types';
import { ProvenanceBadge } from './badge.js';
import { abbreviateIdentifier, formatBaseUnits, formatCount, formatPpm } from './format.js';

export interface DatumProps<T> {
  /** The value and its provenance. There is no overload taking a bare `T`. */
  readonly datum: Verified<T>;
  /** Payload → text. Deliberately blind to the status (see the module note). */
  readonly render: (value: T) => string;
  /**
   * The field's name, e.g. "Cost ceiling". Chrome, not data.
   *
   * Written `?: string | undefined` rather than `?: string` because
   * `exactOptionalPropertyTypes` is on and every wrapper below forwards this prop
   * positionally. That is the accurate type — the wrappers really do pass `undefined` —
   * and narrowing it to `?: string` would make each forward need a conditional spread or
   * a cast, and `as unknown as` is banned across `app/`.
   */
  readonly name?: string | undefined;
}

/**
 * The general labelled value. Every other component here is this one with its formatter
 * fixed, which is why there is exactly one place the badge is emitted.
 */
export function Datum<T>({ datum, render, name }: DatumProps<T>) {
  const text = render(datum.value);
  return (
    <span className="datum" data-status={datum.status.kind}>
      {name === undefined ? null : <span className="datum__name">{name}</span>}
      <span className="datum__value">{text}</span>
      <ProvenanceBadge status={datum.status} />
    </span>
  );
}

/**
 * A money amount in base units.
 *
 * `decimals` and `symbol` are required props with no defaults, for app-code rule 7's
 * reason: a default is a chain value baked into the render layer, and the render layer has
 * nowhere to read one from.
 */
export function Amount({
  datum,
  decimals,
  symbol,
  name,
}: {
  readonly datum: Verified<bigint>;
  readonly decimals: number;
  readonly symbol: string;
  readonly name?: string | undefined;
}) {
  return (
    <Datum
      datum={datum}
      name={name}
      render={(value) => `${formatBaseUnits(value, decimals)} ${symbol}`}
    />
  );
}

/** A count of things — proposals, positions, slots. Never abbreviated. */
export function Count({
  datum,
  name,
}: {
  readonly datum: Verified<number | bigint>;
  readonly name?: string | undefined;
}) {
  return <Datum datum={datum} name={name} render={formatCount} />;
}

/** A block height. Rendered with the `#` so it cannot be mistaken for an amount. */
export function BlockRef({
  datum,
  name,
}: {
  readonly datum: Verified<number>;
  readonly name?: string | undefined;
}) {
  return <Datum datum={datum} name={name} render={(value) => `#${formatCount(value)}`} />;
}

/**
 * An account, hash or id. Abbreviated head-and-tail, with the full string as the
 * accessible name so it is copyable and readable by assistive technology.
 */
export function Identifier({
  datum,
  name,
}: {
  readonly datum: Verified<string>;
  readonly name?: string | undefined;
}) {
  return (
    <span className="datum datum--identifier" data-status={datum.status.kind} title={datum.value}>
      {name === undefined ? null : <span className="datum__name">{name}</span>}
      <span className="datum__value" aria-label={datum.value}>
        {abbreviateIdentifier(datum.value)}
      </span>
      <ProvenanceBadge status={datum.status} />
    </span>
  );
}

/** Chain-derived text — a proposal title, a track name, a dispatch error. */
export function Phrase({
  datum,
  name,
}: {
  readonly datum: Verified<string>;
  readonly name?: string | undefined;
}) {
  return <Datum datum={datum} name={name} render={(value) => value} />;
}

/** A parts-per-million ratio rendered as an exact percentage. */
export function Ratio({
  datum,
  name,
}: {
  readonly datum: Verified<number | bigint>;
  readonly name?: string | undefined;
}) {
  return <Datum datum={datum} name={name} render={formatPpm} />;
}

/** A widened limit reaching the confirm surface — 11 §11.14.3's one prohibition. */
export class WidenedLimitError extends Error {
  constructor(name: string, direction: LimitDirection, asked: bigint, encoded: bigint) {
    super(
      `11 §11.14.3: a limit is never widened, only narrowed. "${name}" is a ${direction} ` +
        `whose asked value is ${asked} and whose encoded value is ${encoded}, which is the ` +
        'looser of the two. Refusing to render it — a widened limit displayed as an ordinary ' +
        'clamp is a trade with a weaker bound than the user was shown.',
    );
    this.name = 'WidenedLimitError';
  }
}

/** Which way a monetary limit protects: a ceiling on cost, or a floor under proceeds. */
export type LimitDirection = 'ceiling' | 'floor';

/**
 * The asked-vs-encoded pair — 11 §11.14.3/§11.14.4.
 *
 * *"When the client's number is the binding one, the difference is shown, not silently
 * applied"*, and *"Every imported value renders with `external-proposal` status wherever it
 * is shown — including the asked side of the asked-vs-encoded pair."*
 *
 * Both sides are `Verified<bigint>`, so both carry a badge and the asked side is
 * unmistakably a request.
 *
 * **Which side binds is computed, not declared.** A `bindingSide` prop would let a caller
 * label the wrong number as the one taking effect, and a reader has no way to check that
 * claim — whereas "tighter" is arithmetic once the *direction* is known, and the direction
 * is a property of the call being built rather than of the two values. So the component
 * takes `direction` and derives the rest.
 *
 * Deriving it also makes the widening case reachable, which a label never would: a ceiling
 * whose encoded value exceeds what was asked, or a floor below it, is 11 §11.14.3's single
 * prohibition, and it **throws** here rather than rendering. This is the last point before
 * a user's eyes, and a clamp that ran the wrong way looks exactly like one that ran the
 * right way.
 */
export function AskedVsEncoded({
  asked,
  encoded,
  decimals,
  symbol,
  name,
  direction,
}: {
  readonly asked: Verified<bigint>;
  readonly encoded: Verified<bigint>;
  readonly decimals: number;
  readonly symbol: string;
  readonly name: string;
  readonly direction: LimitDirection;
}) {
  const widened =
    direction === 'ceiling' ? encoded.value > asked.value : encoded.value < asked.value;
  if (widened) throw new WidenedLimitError(name, direction, asked.value, encoded.value);

  const narrowed = encoded.value !== asked.value;
  const render = (value: bigint) => `${formatBaseUnits(value, decimals)} ${symbol}`;
  return (
    <div className="asked-vs-encoded" data-narrowed={narrowed} data-direction={direction}>
      <span className="asked-vs-encoded__name">{name}</span>
      <Datum datum={asked} render={render} name="asked for" />
      <Datum datum={encoded} render={render} name="will be encoded" />
      {narrowed ? (
        <span className="asked-vs-encoded__note">
          The client’s own {direction === 'ceiling' ? 'ceiling is lower' : 'floor is higher'}, so
          that is the one being encoded.
        </span>
      ) : null}
    </div>
  );
}

/**
 * A labelled group of already-rendered data components.
 *
 * 10 §10.2's last rule: *"Cross-unit UI composition happens only through `ui`-package
 * components that accept already-rendered, provenance-badged children."* `children` is
 * `ReactNode`, so a caller passing raw store data hits the same wall as anywhere else.
 */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="field__body">{children}</div>
    </div>
  );
}

/**
 * A value computed from more than one read — `packages/shared-types`' `Combined<T>`.
 *
 * The component exists so that **both arms must be rendered**. A screen holding a
 * `Combined<T>` can reach `.datum` only after narrowing, but nothing stops it narrowing with
 * `if (c.kind === 'stated')` and rendering nothing otherwise — and *nothing* is exactly how a
 * missing figure looks like a figure that is zero, or absent, or still loading.
 *
 * Here the `incomparable` arm is a rendered refusal carrying its reason, so the value's
 * absence is visible and says what to do about it.
 */
export function Derived<T>({
  combined,
  render,
  name,
}: {
  readonly combined: Combined<T>;
  readonly render: (value: T) => string;
  readonly name?: string | undefined;
}) {
  if (combined.kind === 'incomparable') {
    return (
      <span className="datum datum--incomparable" role="status">
        {name === undefined ? null : <span className="datum__name">{name}</span>}
        <span className="datum__unavailable">Not available</span>
        <span className="datum__reason">{combined.reason}</span>
      </span>
    );
  }
  return <Datum datum={combined.datum} render={render} {...(name === undefined ? {} : { name })} />;
}
