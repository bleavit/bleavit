/**
 * Every protocol claim this app makes carries a citation into the specification.
 *
 * The spec lives at `docs/architecture/` (00–16) in the Bleavit repository. Doc 13
 * is the only home for parameter values; doc 02 is the frozen chain<->frontend
 * integration contract. Citations are data, not comments, so the UI can render
 * provenance next to the number it justifies.
 */

export type DocId =
  | '00'
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | 'code';

export interface Citation {
  /** Architecture document number, or `code` for an implementation constant. */
  readonly doc: DocId;
  /** Section reference, e.g. `§5.4`, or a `file:line` for `code`. */
  readonly at: string;
  /** Optional short note on what exactly is being cited. */
  readonly note?: string;
}

export const cite = (doc: DocId, at: string, note?: string): Citation =>
  note === undefined ? { doc, at } : { doc, at, note };

export const DOC_TITLES: Readonly<Record<DocId, string>> = {
  '00': 'Decision record',
  '01': 'System overview',
  '02': 'Integration contract',
  '03': 'Conditional ledger',
  '04': 'Markets and pricing',
  '05': 'Welfare and decision engine',
  '06': 'Governance and guardians',
  '07': 'Oracle and disputes',
  '08': 'Treasury and economics',
  '09': 'Execution, upgrades and rollout',
  '10': 'Frontend architecture',
  '11': 'Frontend workflows',
  '12': 'Release and operations',
  '13': 'Parameters',
  '14': 'Threat model',
  '15': 'Invariants and testing',
  '16': 'Hosted question service',
  code: 'Implementation',
};

export function formatCitation(c: Citation): string {
  return c.doc === 'code' ? c.at : `${c.doc} ${c.at}`;
}

export function describeCitation(c: Citation): string {
  const title = DOC_TITLES[c.doc];
  return c.doc === 'code' ? `${title} — ${c.at}` : `Doc ${c.doc} ${c.at} — ${title}`;
}
