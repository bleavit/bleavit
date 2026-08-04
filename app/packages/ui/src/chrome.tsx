/**
 * Chrome — the non-data furniture. Nothing here renders a chain value.
 *
 * The split matters: everything in `datum.tsx` takes a `Verified<T>` and emits a badge,
 * and everything here takes strings that are **in-bundle copy**. A component that accepted
 * both would be the seam through which a chain value reaches the screen wearing a label
 * chosen by its caller, which is the failure the badge exists to prevent.
 */

import type { ReactNode } from 'react';

export function Panel({
  title,
  children,
  tone = 'plain',
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly tone?: 'plain' | 'advanced';
}) {
  return (
    <section className={`panel panel--${tone}`} aria-label={title}>
      <h2 className="panel__title">{title}</h2>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/**
 * A message the client says in its own voice.
 *
 * `severity` drives presentation only. It takes no dismiss handler on purpose — a notice
 * that can be closed is a notice that can be missed, and every case in F7's surfaces where
 * dismissal would be tempting is one 11 §11.2 constraint 3 already forbids deferring.
 */
export function Notice({
  severity,
  heading,
  children,
}: {
  readonly severity: 'info' | 'caution' | 'danger';
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`notice notice--${severity}`}
      data-severity={severity}
      role={severity === 'info' ? 'note' : 'alert'}
    >
      <strong className="notice__heading">{heading}</strong>
      <div className="notice__body">{children}</div>
    </div>
  );
}

/**
 * A refusal the client is stating, with its code and its recovery.
 *
 * 10 §13.3 requires a refusal to carry what the reader can do about it, and the
 * `FE-HANDOFF-*` table now carries a `recovery` per code for exactly this component. A
 * refusal rendered without one is a dead end wearing an error message.
 */
export function Refusal({
  code,
  message,
  recovery,
  detail,
}: {
  readonly code: string;
  readonly message: string;
  readonly recovery: string;
  readonly detail?: string;
}) {
  return (
    <div className="refusal" data-code={code} role="alert">
      <span className="refusal__code">{code}</span>
      <p className="refusal__message">{message}</p>
      {detail === undefined ? null : <p className="refusal__detail">{detail}</p>}
      <p className="refusal__recovery">{recovery}</p>
    </div>
  );
}

export function Button({
  label,
  onClick,
  intent = 'secondary',
  disabled = false,
  disabledReason,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly intent?: 'primary' | 'secondary' | 'danger';
  readonly disabled?: boolean;
  /**
   * Why the control is unavailable. Required whenever `disabled` is true — app-code rule 10:
   * *"absence disables the dependent surface with a named reason — never a silent
   * fallback."* A greyed-out button with no explanation is the silent fallback.
   */
  readonly disabledReason?: string;
}) {
  if (disabled && (disabledReason === undefined || disabledReason.length === 0)) {
    throw new Error(
      `Button "${label}" is disabled with no reason. A disabled control must say why ` +
        '(app-code rule 10 / INV-FE-12): an unexplained greyed-out button is indistinguishable ' +
        'from a bug, and the user cannot act on it.',
    );
  }
  return (
    <button
      type="button"
      className={`button button--${intent}`}
      onClick={onClick}
      disabled={disabled}
      title={disabledReason}
      aria-disabled={disabled}
    >
      {label}
    </button>
  );
}

/** A table of already-rendered rows. Headers are in-bundle copy; cells are components. */
export function DataTable({
  caption,
  headers,
  rows,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly { readonly key: string; readonly cells: readonly ReactNode[] }[];
}) {
  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => (
              // The cell index is the column, and columns are fixed by `headers` — so the
              // index is a stable identity here rather than the usual list-order hazard.
              <td key={`${row.key}:${headers[index] ?? index}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Data the client could not decode — INV-FE-12 / app-code rule 10.
 *
 * > undecodable data renders as raw SCALE with a warning; never guess at encodings.
 *
 * Deliberately **not** a `VerificationStatus`. The bytes were read from finalized state and
 * are perfectly authentic; what failed is the client's ability to interpret them, which is
 * a different claim and belongs in a different place. Giving it a status would put a
 * *provenance* label on a *decoding* failure, and the six statuses would then answer two
 * questions at once — after which "verified" would no longer mean one thing.
 *
 * The raw hex is rendered rather than hidden because it is the only true thing available:
 * a user can take it to a block explorer, and a support conversation can proceed. An empty
 * space or an em dash would say "there is nothing here", which is false.
 */
export function Undecodable({
  label,
  rawHex,
  reason,
}: {
  readonly label: string;
  readonly rawHex: string;
  readonly reason: string;
}) {
  return (
    <div className="undecodable" data-undecodable={label} role="alert">
      <strong className="undecodable__label">{label}</strong>
      <p className="undecodable__reason">
        This client could not decode this value: {reason}. It is not guessing at it. The raw
        bytes as read from finalized state are below.
      </p>
      <code className="undecodable__raw">{rawHex}</code>
    </div>
  );
}
