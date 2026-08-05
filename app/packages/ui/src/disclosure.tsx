/**
 * Progressive disclosure, and the facts it may not be used on — 11 §11.2 constraint 3.
 *
 * The handoff-first navigation default is allowed to put a plain-language summary in front
 * and the decoded tree, the raw SCALE bytes and the precondition detail one deliberate step
 * behind it. §11.4 rule 3 and INV-FE-14 are satisfied by *inspectable before signing*, not
 * by *all on the first screen*. So `Disclosure` exists and is legitimate.
 *
 * What the same paragraph then forbids is the interesting part:
 *
 * > **What MUST NOT be deferred behind a step is any fact that changes the meaning of the
 * > signature** … and this paragraph grants no relief from any of them.
 *
 * Five facts are named. A comment saying so protects nothing — the failure mode is a screen
 * built six months from now that wraps the sudo-era banner in a `<details>` because the
 * layout was crowded, and every test still passes because the banner is still *present*.
 *
 * Two controls, because neither is sufficient alone:
 *
 * 1. **Type.** `aboveTheFold()` returns an object, not a `ReactNode`. `Disclosure`'s
 *    children are `ReactNode`. So passing one directly into a disclosure does not compile.
 * 2. **Runtime.** `AlwaysVisible` throws when it renders inside a `Disclosure`, via context.
 *    This is what catches the indirect form — the fold handed down three components and
 *    rendered inside a collapsed region by a caller that never saw both ends. It fails
 *    loudly at render, in a test, rather than shipping a hidden consequence.
 *
 * Failing closed at render is the right direction here: a composition that reaches it is
 * already a spec violation, and a blank region with a thrown error is a better outcome than
 * a signature whose consequence was one click away.
 */

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The facts 11 §11.2 constraint 3 names, each with the section that owns it.
 *
 * The section strings are load-bearing: `app/tests/ui` parses that paragraph out of doc 11
 * and requires this set to equal the sections cited there. A sixth fact added to the spec
 * therefore fails the suite rather than quietly not existing in the code.
 */
export const MEANING_CHANGING_FACTS = Object.freeze({
  'charged-redemption-net-payout': '§11.5',
  'void-recovery-decomposition': '§11.6',
  'conviction-vote-lock': '§11.7.6',
  'sudo-era-banner': '§11.10',
  'imported-action-origin': '§11.14.4',
} as const);

export type MeaningChangingFact = keyof typeof MEANING_CHANGING_FACTS;

/**
 * A fact that must render where the user already is.
 *
 * Deliberately **not** a `ReactNode`: it is an object, and React refuses to render one. The
 * only thing that can unwrap it is `AlwaysVisible`, which is also the only thing that
 * checks whether it is about to be hidden.
 */
export interface AboveTheFold {
  readonly fact: MeaningChangingFact;
  readonly node: ReactNode;
}

export function aboveTheFold(fact: MeaningChangingFact, node: ReactNode): AboveTheFold {
  return { fact, node };
}

/** True while rendering inside a `Disclosure`'s deferred region. */
const DeferredRegion = createContext(false);

export class DeferredMeaningChangingFactError extends Error {
  readonly fact: MeaningChangingFact;
  readonly section: string;

  constructor(fact: MeaningChangingFact) {
    const section = MEANING_CHANGING_FACTS[fact];
    super(
      `11 §11.2 constraint 3: "${fact}" changes the meaning of the signature and is named ` +
        `above-the-fold by ${section}, so it MUST NOT render inside a Disclosure. Move it out ` +
        'of the collapsed region — do not wrap it in a summary.',
    );
    this.name = 'DeferredMeaningChangingFactError';
    this.fact = fact;
    this.section = section;
  }
}

/**
 * Render an above-the-fold fact.
 *
 * There is no `onDismiss`, no `dismissible` prop and no close affordance in the markup:
 * §11.10 and §11.14.4 call their facts *non-dismissible*, and a dismiss button offered
 * "for tidiness" is the whole of what those sections forbid.
 */
export function AlwaysVisible({ fold }: { readonly fold: AboveTheFold }) {
  if (useContext(DeferredRegion)) throw new DeferredMeaningChangingFactError(fold.fact);
  return (
    <div
      className={`above-fold above-fold--${fold.fact}`}
      data-fact={fold.fact}
      data-section={MEANING_CHANGING_FACTS[fold.fact]}
      role="note"
    >
      {fold.node}
    </div>
  );
}

/**
 * One deliberate step: a summary in front, detail behind it.
 *
 * `open` is a genuine option — the decoded payload tree may reasonably start expanded —
 * but it changes nothing about what may be inside, because the check is on the *region*
 * and not on its current state. A disclosure that happens to be open today is one layout
 * change away from being closed, and a control that depended on that would be a control
 * that passed by luck.
 */
export function Disclosure({
  summary,
  children,
  open = false,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly open?: boolean;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">
        <DeferredRegion.Provider value={true}>{children}</DeferredRegion.Provider>
      </div>
    </details>
  );
}
