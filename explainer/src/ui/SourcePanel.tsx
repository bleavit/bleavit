import { useEffect, useRef } from 'react';
import { useUi } from '../state/store';
import { REAL_SOURCE_METHODS, PROVENANCE_DESCRIPTION } from '../provenance/types';
import { ProvenanceBadge } from './ProvenanceBadge';
import { INTEGRATION_CONTRACT_VERSION } from '../protocol/constants';

/**
 * "What would be verified here."
 *
 * The honesty of this app should be explained, not merely asserted. This panel
 * maps what the explainer simulates onto what the real client reads, and names
 * the mechanism that would make it trustworthy — an embedded light client
 * verifying storage proofs at a finalized block, per INV-FE-1.
 */
export function SourcePanel() {
  const open = useUi((s) => s.sourcePanelOpen);
  const setOpen = useUi((s) => s.setSourcePanel);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Whoever opened it gets the focus back. Without this the caret lands at
    // the top of the document on close, and a keyboard reader has to tab the
    // whole page again to return to where they were.
    const opener = document.activeElement;
    closeRef.current?.focus();

    // `aria-modal` is a promise to assistive technology, not a mechanism. On its
    // own the page behind the overlay keeps its tab order and stays readable to
    // a screen reader, so a keyboard user tabs into controls they cannot see.
    // `inert` is the mechanism: it removes a subtree from focus, from hit
    // testing and from the accessibility tree at once.
    //
    // It is applied to every SIBLING on the path from the panel up to `<body>`,
    // never to an ancestor — an inert ancestor would take the dialog with it,
    // which is the way this is usually got wrong. Walking the path matters
    // because the panel is mounted deep inside `#root` rather than beside it,
    // so marking only the body's own children would mark nothing at all.
    //
    // Elements that were already inert are left untouched and never restored,
    // so this cannot re-open something another component is holding closed.
    const inerted: Element[] = [];
    for (let node: Element | null = panelRef.current; node; node = node.parentElement) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
        inerted.push(sibling);
      }
      if (parent === document.body) break;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      for (const node of inerted) node.removeAttribute('inert');
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="sourcepanel"
      role="dialog"
      aria-modal="true"
      aria-label="What would be verified here"
      ref={panelRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="sourcepanel__body">
        <button
          type="button"
          ref={closeRef}
          className="vp-btn sourcepanel__close"
          onClick={() => setOpen(false)}
        >
          Close
        </button>

        <h2>What would be verified here</h2>
        <p>
          This explainer computes everything locally. The canonical Bleavit client
          does not: it embeds a light client and treats{' '}
          <strong>finalized, proof-verified chain state as the only authoritative
          read path</strong>. No RPC endpoint, indexer, cache or best-head value may
          be the source of anything a user acts on.
        </p>

        <h3>The three labels used on this page</h3>
        <ul className="sourcelist">
          {(['spec', 'derived', 'simulated'] as const).map((p) => (
            <li key={p}>
              <ProvenanceBadge prov={p} showText />
              <span>{PROVENANCE_DESCRIPTION[p]}</span>
            </li>
          ))}
        </ul>

        <h3>Where the real client reads this from</h3>
        <p>
          The chain exposes a frozen, sixteen-method runtime API. Every screen in the
          canonical client is built from these, read at a single pinned finalized
          block. It is integration contract version{' '}
          <span className="mono">{INTEGRATION_CONTRACT_VERSION}</span>.
        </p>
        <ul className="sourcelist sourcelist--mono">
          {REAL_SOURCE_METHODS.map((m) => (
            <li key={m}>
              <code className="mono">{m}</code>
            </li>
          ))}
        </ul>

        <h3>What this explainer deliberately does not do</h3>
        <p>
          It ships no signing affordance at all. The real client re-reads every
          declared precondition at one finalized block immediately before signature
          and blocks with a diff on any mismatch. Half-implementing that ritual here
          would teach it wrongly, so it is out of scope rather than approximated.
        </p>
        <p>
          It also never renders a projected outcome during trading. The chain's{' '}
          <code className="mono">decision_stats(pid)</code> returns nothing until a
          proposal&rsquo;s decision windows are sealed, precisely so that no interface
          can show a forecast as though it were a decision.
        </p>
      </div>
    </div>
  );
}
