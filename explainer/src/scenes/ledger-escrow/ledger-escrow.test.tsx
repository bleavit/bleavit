import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { LedgerEscrowScene, buildModel } from './index';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { runScenario } from '../../sim/engine';
import { SCENARIOS } from '../../sim/scenarios';
import type { SimState } from '../../sim/types';
import { legalCallsFor, proposalPositions } from '../../protocol/ledger';
import type { VaultState } from '../../protocol/types';

/**
 * The canvas is aria-hidden, so every object it draws has to be recoverable from
 * the DOM. These tests assert that structurally rather than by review: each node
 * that names a `domRowId` must find that row, the stage must stay inside its own
 * 21 x 12 bounds, and no state may print a NaN.
 */

const BASE = runScenario(SCENARIOS['normal-execution'], 3, 'Treasury', 'Fund the audit');

const STATES: readonly VaultState[] = [
  { kind: 'Open' },
  { kind: 'Resolved', winner: 'Accept' },
  { kind: 'Resolved', winner: 'Reject' },
  { kind: 'ScalarSettled', winner: 'Accept', s: 0.436 },
  { kind: 'Voided' },
  { kind: 'BaselineSettled', s: 0.5 },
];

const withState = (state: VaultState): SimState => ({
  ...BASE,
  vault: { ...BASE.vault, state },
});

/**
 * Label geometry, as the SVG renderer draws it: a label is centred under its
 * node at `12 − y + 0.55`, so two labels share a text row exactly when their
 * nodes share a `y` — regardless of node height. An N-character label occupies
 * roughly `N · 0.24` stage units at the widest type size, so two of them need
 * their centres more than half of each, plus a gap, apart.
 */
const HALF_CHAR = 0.12;
const LABEL_GAP = 0.3;

describe('ledger-escrow scene', () => {
  it.each(STATES.map((s) => [s.kind, s] as const))(
    'keeps every %s node inside the stage',
    (_kind, state) => {
      for (const n of buildModel(withState(state)).nodes) {
        if (n.kind === 'edge') continue;
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(n.y + n.h).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
    },
  );

  it.each(STATES.map((s) => [s.kind, s] as const))(
    'gives every %s node a row in the rail',
    (_kind, state) => {
      const sim = withState(state);
      const { container } = render(<LedgerEscrowScene sim={sim} />);
      const missing = buildModel(sim)
        .nodes.map((n) => n.domRowId)
        .filter((id): id is string => id !== undefined)
        .filter((id) => container.querySelector(`#${id}`) === null);
      expect(missing).toEqual([]);
      expect(container.textContent).not.toMatch(/NaN|Infinity/);
    },
  );

  it.each(STATES.map((s) => [s.kind, s] as const))(
    'never overlaps two %s labels on one text row',
    (_kind, state) => {
      const drawn = buildModel(withState(state)).nodes.filter((n) => n.kind !== 'edge');
      const collisions: string[] = [];
      for (const tier of ['label', 'sublabel'] as const) {
        const texts = drawn
          .map((n) => ({ id: n.id, y: n.y, cx: n.x + n.w / 2, text: n[tier] }))
          .filter((t): t is typeof t & { text: string } => t.text !== undefined);
        for (let i = 0; i < texts.length; i += 1) {
          for (let j = i + 1; j < texts.length; j += 1) {
            const a = texts[i];
            const b = texts[j];
            if (a === undefined || b === undefined || a.y !== b.y) continue;
            const need = (a.text.length + b.text.length) * HALF_CHAR + LABEL_GAP;
            const have = Math.abs(a.cx - b.cx);
            if (have <= need) {
              collisions.push(`${a.id}/${b.id}: ${have.toFixed(2)} <= ${need.toFixed(2)}`);
            }
          }
        }
      }
      expect(collisions).toEqual([]);
    },
  );

  it('draws one chip per instrument, on both branches', () => {
    const sim = withState({ kind: 'Open' });
    const chips = buildModel(sim).nodes.filter((n) => n.kind === 'chip');
    expect(chips).toHaveLength(proposalPositions(sim.proposal.id).length);
    // Shape, not colour, separates the families: discs are the scalar legs.
    expect(chips.filter((c) => c.w === c.h)).toHaveLength(4);
  });

  it('freezes the losing branch in place rather than removing it', () => {
    const model = buildModel(withState({ kind: 'Resolved', winner: 'Accept' }));
    // Edges record the mint that already happened, not a live claim.
    const reject = model.nodes.filter((n) => n.kind !== 'edge' && n.id.includes('Reject'));
    expect(reject.length).toBeGreaterThan(0);
    expect(reject.every((n) => n.state === 'frozen')).toBe(true);
    const open = buildModel(withState({ kind: 'Open' }));
    // Same objects, same places — only the state changed.
    for (const n of reject) {
      const before = open.nodes.find((m) => m.id === n.id);
      expect(before).toBeDefined();
      expect([before?.x, before?.y]).toEqual([n.x, n.y]);
    }
  });

  it('carries the tie bar exactly when merge is a legal call', () => {
    for (const state of STATES) {
      const hasTie = buildModel(withState(state)).nodes.some((n) => n.kind === 'tie');
      expect(hasTie).toBe(legalCallsFor(state).includes('merge'));
    }
  });

  it('offers exactly the five calls I-27 permits in a voided vault', () => {
    const { container } = render(<LedgerEscrowScene sim={withState({ kind: 'Voided' })} />);
    const offered = [...container.querySelectorAll('.lx-calls li')].map((li) => li.textContent);
    expect(offered).toEqual(legalCallsFor({ kind: 'Voided' }));
    expect(offered).toHaveLength(5);
  });

  it('shelves the void schedule at par, one half and one quarter', () => {
    const shelves = buildModel(withState({ kind: 'Voided' })).rules.filter((r) =>
      r.id.startsWith('shelf-'),
    );
    expect(shelves.map((r) => r.id)).toEqual([
      'shelf-par',
      'shelf-half',
      'shelf-quarter',
      'shelf-zero',
    ]);
    // The scale is linear, so the shelves are ordered by the value they carry.
    const at = shelves.map((r) => r.at);
    expect(at[0]).toBeGreaterThan(at[1] ?? 0);
    expect(at[1]).toBeGreaterThan(at[2] ?? 0);
    expect(at[2]).toBeGreaterThan(at[3] ?? 0);
  });
});
