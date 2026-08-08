import type { Tagged } from '../provenance/types';
import { formatCitation, describeCitation } from '../protocol/citations';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * The only path by which a number reaches the screen.
 *
 * `of` accepts `Tagged<number>` and nothing else. A bare `number` is a compile
 * error, so "every displayed value carries its provenance" is a property of the
 * type system rather than of reviewer attention — the local form of INV-FE-9's
 * *"UI data components reject unlabeled values by type"*.
 */

export interface ValueProps {
  of: Tagged<number> | Tagged<string>;
  /** Formatter for the underlying value. Defaults to `String`. */
  format?: (v: never) => string;
  unit?: string;
  /** Branch tint. Only ever for branch instruments — never for outcomes. */
  branch?: 'accept' | 'reject';
  /** Show the provenance glyph inline. Off inside a table that has a
   * dedicated provenance column, to avoid saying the same thing twice. */
  badge?: boolean;
  /** Print the doc citation after the value. */
  showCite?: boolean;
  /** Mark a doc-13 row the spec has not settled ([VERIFY] / sim-gated). */
  unverified?: boolean;
  className?: string;
}

export function Value({
  of,
  format,
  unit,
  branch,
  badge = false,
  showCite = false,
  unverified = false,
  className,
}: ValueProps) {
  const text =
    format !== undefined
      ? (format as (v: unknown) => string)(of.value)
      : String(of.value);

  const classes = [
    'value',
    `value--${of.prov}`,
    branch ? `value--${branch}` : '',
    unverified ? 'value--unverified' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // The full description lands in the title so the meaning is available without
  // colour, without hover styling, and to assistive technology.
  const title = [
    of.cite ? describeCitation(of.cite) : undefined,
    of.note,
    unverified
      ? 'The specification has not settled this value: it is [VERIFY]-tagged or bound to a simulation artifact.'
      : undefined,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <span className={classes} title={title === '' ? undefined : title}>
      {badge ? <ProvenanceBadge prov={of.prov} /> : null}
      <span className="value__num" data-role="readout">
        {text}
      </span>
      {unit ? <span className="value__unit">{unit}</span> : null}
      {showCite && of.cite ? (
        <span className="value__cite">{formatCitation(of.cite)}</span>
      ) : null}
      {unverified ? <span className="sr-only">(value not yet settled by the specification)</span> : null}
    </span>
  );
}
