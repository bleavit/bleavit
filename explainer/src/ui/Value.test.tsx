import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Value } from './Value';
import { ProvenanceBadge } from './ProvenanceBadge';
import { derived, simulated, spec, combine, weakest } from '../provenance/types';
import { cite } from '../protocol/citations';

/**
 * The provenance guarantee is a type-level one: `<Value>` accepts only
 * `Tagged<T>`, so a bare number cannot reach the screen. These tests cover the
 * runtime half — that the label is actually rendered, that it is available to
 * assistive technology, and that provenance never strengthens.
 */

describe('<Value>', () => {
  it('renders the number and exposes the citation', () => {
    render(<Value of={spec(0.05, cite('13', '§1'))} showCite badge />);
    expect(screen.getByText('0.05')).toBeDefined();
    expect(screen.getByText('13 §1')).toBeDefined();
  });

  it('announces the provenance to assistive technology even without the text', () => {
    render(<Value of={simulated(0.562)} badge />);
    expect(screen.getByText('SIMULATED')).toBeDefined();
  });

  it('marks an unsettled specification value without using colour alone', () => {
    const { container } = render(
      <Value of={spec(25_000, cite('13', '§1'))} unverified />,
    );
    expect(container.querySelector('.value--unverified')).not.toBeNull();
    expect(
      screen.getByText('(value not yet settled by the specification)'),
    ).toBeDefined();
  });

  it('applies a branch tint only when asked', () => {
    const { container } = render(<Value of={simulated(0.56)} branch="accept" />);
    expect(container.querySelector('.value--accept')).not.toBeNull();
  });
});

describe('<ProvenanceBadge>', () => {
  it('carries a text equivalent for every status, never an icon alone', () => {
    for (const p of ['spec', 'derived', 'simulated'] as const) {
      const { unmount } = render(<ProvenanceBadge prov={p} showText />);
      expect(
        screen.getByText(p.toUpperCase(), { selector: '.prov__text' }),
      ).toBeDefined();
      unmount();
    }
  });
});

describe('provenance never strengthens', () => {
  it('takes the weakest of its inputs', () => {
    expect(weakest('spec', 'derived')).toBe('derived');
    expect(weakest('spec', 'simulated')).toBe('simulated');
    expect(weakest('derived', 'simulated')).toBe('simulated');
    expect(weakest('spec', 'spec')).toBe('spec');
  });

  it('keeps a derivation over simulated inputs simulated', () => {
    // The local form of the chain client's never-promote rule: a computation
    // cannot launder the provenance of what went into it.
    const out = combine([spec(1, cite('13', '§1')), simulated(2)], 3);
    expect(out.prov).toBe('simulated');
  });

  it('a derivation over specification constants stays derived, not spec', () => {
    const out = combine([spec(1, cite('13', '§1')), derived(2)], 3);
    expect(out.prov).toBe('derived');
  });
});
