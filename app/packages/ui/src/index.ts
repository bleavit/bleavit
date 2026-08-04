/**
 * `@bleavit/ui` — the render layer, and the only package that names React (10 §10.2, V-109).
 *
 * Two obligations live here rather than in the screens, because a screen is where they get
 * forgotten:
 *
 * - **INV-FE-9 / 10 §2.1** — a data component takes `Verified<T>` and derives the badge from
 *   the status it was given. A screen cannot render a chain value without one, because
 *   `Verified<T>` is an object and React will not render an object.
 * - **11 §11.2 constraint 3** — the five facts that change the meaning of a signature cannot
 *   be put behind a disclosure step. Enforced by type *and* at render.
 *
 * `ReactNode` is re-exported so screens can type their own composition without importing
 * `react` themselves — which is what keeps the handoff unit's dependency list free of every
 * external package, the 10 §10.1 rule the JSX indirection exists to preserve.
 */

export type { ReactElement, ReactNode } from 'react';

export { ProvenanceBadge, badgeCopyFor, isUnverifiedStatus } from './badge.js';
export {
  Amount,
  AskedVsEncoded,
  BlockRef,
  Count,
  Datum,
  Field,
  Identifier,
  Phrase,
  Ratio,
  WidenedLimitError,
  type DatumProps,
  type LimitDirection,
} from './datum.js';
export {
  AlwaysVisible,
  DeferredMeaningChangingFactError,
  Disclosure,
  MEANING_CHANGING_FACTS,
  aboveTheFold,
  type AboveTheFold,
  type MeaningChangingFact,
} from './disclosure.js';
export { Button, DataTable, Notice, Panel, Refusal } from './chrome.js';
export { abbreviateIdentifier, formatBaseUnits, formatCount, formatPpm } from './format.js';
export { mount } from './mount.js';
