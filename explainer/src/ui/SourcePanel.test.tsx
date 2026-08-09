import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';

import { SourcePanel } from './SourcePanel';
import { useUi } from '../state/store';

/**
 * A modal overlay makes two promises, and only one of them is a matter of markup.
 *
 * `role="dialog"` with `aria-modal="true"` TELLS assistive technology that the
 * rest of the page is unavailable. Nothing about that attribute makes it true.
 * The page behind the overlay keeps its tab order and stays in the accessibility
 * tree, so a keyboard user tabs straight into controls the overlay is covering,
 * operates them blind, and the page they cannot see changes under them. That is
 * the shape this file exists to prevent: an accessibility attribute that
 * describes a behaviour nobody implemented.
 *
 * The second promise is quieter. A dialog that takes focus owes it back. Without
 * that, closing drops the caret at the top of the document and the reader has to
 * traverse the whole page to return to the button they just pressed.
 *
 * Both are asserted here on the real DOM rather than on the component's props,
 * because both are properties of the document and not of the element.
 */

const openPanel = () => act(() => useUi.getState().setSourcePanel(true));
const closePanel = () => act(() => useUi.getState().setSourcePanel(false));

describe('<SourcePanel> as a modal', () => {
  beforeEach(() => {
    act(() => useUi.getState().setSourcePanel(false));
  });

  it('renders nothing at all until it is opened', () => {
    render(<SourcePanel />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks the rest of the page inert while it is open', () => {
    // The layout mirrors the real one: `App` renders `<nav>`, `<main>` and the
    // transport as SIBLINGS of the panel, all inside one wrapper. So the nearer
    // sibling is the load-bearing assertion — an implementation that swept only
    // `document.body.children` would find the wrapper contains the panel, skip
    // it, and leave every control in the page behind the overlay tabbable.
    render(
      <div>
        <main>
          <button type="button">behind the overlay</button>
        </main>
        <SourcePanel />
      </div>,
    );
    const behind = screen.getByRole('main');
    expect(behind.hasAttribute('inert')).toBe(false);

    openPanel();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(behind.hasAttribute('inert')).toBe(true);

    closePanel();
    expect(behind.hasAttribute('inert')).toBe(false);
  });

  it('reaches the whole path up to the body, not just the nearest siblings', () => {
    const background = document.createElement('div');
    background.innerHTML = '<button type="button">another region entirely</button>';
    document.body.appendChild(background);
    try {
      render(<SourcePanel />);
      openPanel();
      expect(background.hasAttribute('inert')).toBe(true);
      closePanel();
      expect(background.hasAttribute('inert')).toBe(false);
    } finally {
      background.remove();
    }
  });

  it('leaves an element alone that was already inert', () => {
    // Restoring one this panel did not close would re-open, on close, whatever
    // another component is deliberately holding shut.
    const held = document.createElement('div');
    held.setAttribute('inert', '');
    document.body.appendChild(held);
    try {
      render(<SourcePanel />);
      openPanel();
      closePanel();
      expect(held.hasAttribute('inert')).toBe(true);
    } finally {
      held.remove();
    }
  });

  it('takes focus to Close, and gives it back to the opener', () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'What would be verified here?';
    document.body.appendChild(opener);
    try {
      render(<SourcePanel />);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      openPanel();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

      closePanel();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('does not chase focus to an opener that has left the document', () => {
    // Scene changes unmount their controls. Focusing a detached node throws in
    // some engines and silently does nothing in others, and neither is a thing
    // to leave to chance on a close path.
    const opener = document.createElement('button');
    opener.type = 'button';
    document.body.appendChild(opener);
    render(<SourcePanel />);
    opener.focus();
    openPanel();
    opener.remove();
    expect(() => closePanel()).not.toThrow();
  });

  it('closes on Escape', () => {
    render(<SourcePanel />);
    openPanel();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
