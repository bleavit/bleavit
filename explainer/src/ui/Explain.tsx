import { useId, useState, type ReactNode } from 'react';
import { glossary } from './glossary';
import './explain.css';

/**
 * Progressive disclosure, as a design rule rather than a component library.
 *
 * The explainer has two audiences with opposite needs. Someone meeting futarchy
 * for the first time needs one paragraph of plain language and three numbers.
 * Someone auditing the protocol needs the block ranges, the parameter keys, the
 * error variants and the citations. Showing both at once serves neither: the
 * first reader bounces off a wall of normative prose, and the second cannot find
 * the table under the introduction.
 *
 * So every rail is ordered: `Lede`, then `KeyFacts`, then `Depth` sections that
 * are closed by default. Nothing is deleted — the depth is one click away, and
 * the click is the whole point, because it is the reader saying "I want this".
 */

/**
 * The plain-language answer. Two or three sentences, no citations, no parameter
 * keys, no protocol nouns that have not been introduced on screen.
 *
 * A rail that cannot state its subject this way does not understand its subject.
 */
export function Lede({ children }: { children: ReactNode }) {
  return <p className="lede">{children}</p>;
}

/**
 * The two or three numbers a reader should leave with. Anything beyond three is
 * a table, and a table belongs in a `Depth`.
 */
export function KeyFacts({ children }: { children: ReactNode }) {
  return <div className="keyfacts">{children}</div>;
}

export function KeyFact({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="keyfact">
      <span className="keyfact__label">{label}</span>
      <span className="keyfact__value">{children}</span>
      {note !== undefined ? <span className="keyfact__note">{note}</span> : null}
    </div>
  );
}

export interface DepthProps {
  /** What the reader gets by opening it. Written as a promise, not a heading. */
  title: string;
  /** Optional count shown in the summary, e.g. "6 rows". */
  hint?: string;
  /** Open on first render. Use for at most one section per rail. */
  open?: boolean;
  children: ReactNode;
}

/**
 * A closed drawer of expert material.
 *
 * Implemented over the native `<details>` element rather than a custom
 * disclosure: it is keyboard-operable, exposed to assistive technology, and —
 * critically for a page this dense — findable by the browser's own find-in-page,
 * which now opens closed `details` to reveal a match.
 */
export function Depth({ title, hint, open = false, children }: DepthProps) {
  const id = useId();
  return (
    <details className="depth" open={open}>
      <summary className="depth__summary" aria-controls={id}>
        <span className="depth__chevron" aria-hidden="true" />
        <span className="depth__title">{title}</span>
        {hint !== undefined ? <span className="depth__hint">{hint}</span> : null}
      </summary>
      <div className="depth__body" id={id}>
        {children}
      </div>
    </details>
  );
}

/**
 * A word from the shared glossary, defined where the reader meets it.
 *
 * This is the component scenes should reach for. It takes the definition from
 * `ui/glossary.ts` rather than from the call site, which is the whole point: a
 * term defined at each use is a term that ends up meaning three things in three
 * scenes, and the reader who notices is the one who stops trusting the page.
 *
 * Use it on **first use in a scene**, not on every occurrence — a paragraph
 * where five words are buttons is a paragraph nobody reads.
 *
 * `label` overrides the printed text where the sentence needs a different
 * inflection ("collators", "parachains") than the glossary key.
 */
export function Jargon({ word, label }: { word: string; label?: string }) {
  const entry = glossary(word);
  return <Term word={label ?? entry.word}>{entry.definition}</Term>;
}

/**
 * A two-line glossary entry for a term the scene cannot avoid using.
 *
 * The alternative — a global glossary page — moves the definition away from the
 * only place it is needed. This keeps it inline and closed.
 *
 * Prefer {@link Jargon}, which takes its definition from the shared glossary.
 * This lower-level form is for a definition that is genuinely local to one
 * scene and would be wrong to state anywhere else.
 */
export function Term({ word, children }: { word: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="term">
      <button
        type="button"
        className="term__btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {word}
      </button>
      {open ? (
        <span className="term__def" id={id} role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
