import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TheServiceScene, bMinPerStake, buildModel, subsidyPerStake } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { layoutLabels } from '../labels';
import { param, value } from '../../protocol/params';
import { SECURITY_FACTOR } from '../../protocol/constants';

/**
 * The service scene's contract with the specification and with the DOM.
 *
 * One property carries this scene, and it is the one a drawing can state and a
 * table cannot: **nothing crosses**. That is asserted structurally rather than
 * by eye — every node lies wholly on one side of the firewall rule, and no edge
 * joins a node on one side to a node on the other. A future edit that connected
 * the two halves would be a picture that contradicts doc 16 §7.1, and it fails
 * here rather than shipping.
 *
 * The rest of the file guards the things that rot silently: labels outside the
 * twelve-character budget the placement pass drops, counts that drift from the
 * table they are derived from, and headline claims quietly disappearing from
 * the rail.
 */

const scenario = SCENARIOS['normal-execution'];
const stepsAt = (n: number) =>
  runScenario(scenario, n, 'Treasury', 'Fund the light-client audit — 200,000 USDC');

/** Mid-scenario: the books are open and carry a price. */
const trading = stepsAt(4);
/** The very first step, before anything has been seeded. */
const early = stepsAt(0);

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than the renderer, which estimates `0.56 em` at a
 * 0.46-unit label size (0.258 per character) and keeps a 0.25 gap. Passing at
 * 0.26/0.3 clears it, so a change to the renderer's constants cannot quietly
 * turn this assertion into a formality.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

const model = buildModel(trading);
const solids = model.nodes.filter((n) => n.kind !== 'edge');
const edges = model.nodes.filter((n) => n.kind === 'edge');
const firewall = model.rules.find((r) => r.id === 'firewall');

/** Which side of the firewall a node sits on. `null` means it straddles it. */
function side(id: string): 'own' | 'service' | null {
  const n = model.nodes.find((x) => x.id === id);
  if (n === undefined || firewall === undefined) return null;
  if (n.kind === 'edge') {
    const a = n.from === undefined ? null : side(n.from);
    const b = n.to === undefined ? null : side(n.to);
    return a !== null && a === b ? a : null;
  }
  if (n.x + n.w <= firewall.at) return 'own';
  if (n.x >= firewall.at) return 'service';
  return null;
}

describe('buildModel', () => {
  it('draws both domains and the question that runs through one of them', () => {
    // Four parts per side, plus the five states of the hosted question. The
    // count is spelled out so adding a node without deciding which side it
    // belongs to cannot pass.
    expect(solids).toHaveLength(12);
    expect(edges).toHaveLength(10);
    expect(model.nodes).toHaveLength(22);
  });

  it('gives every node a unique id, and every drawn part a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of solids) expect(n.domRowId, n.id).toBeTruthy();
    const rows = new Set(solids.map((n) => n.domRowId));
    expect(rows.size).toBe(solids.length);
  });

  it('keeps every node inside the stage', () => {
    for (const n of solids) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  // --- the whole point of the picture --------------------------------------

  it('puts every node wholly on one side of the firewall', () => {
    expect(firewall).toBeDefined();
    expect(firewall?.axis).toBe('y');
    expect(firewall?.dashed).toBe(true);
    for (const n of solids) expect(side(n.id), `${n.id} straddles the line`).not.toBeNull();
    // Both sides are actually occupied, so the assertion above is not vacuous.
    expect(solids.filter((n) => side(n.id) === 'own').length).toBeGreaterThan(0);
    expect(solids.filter((n) => side(n.id) === 'service').length).toBeGreaterThan(0);
  });

  it('never joins the two sides with an edge', () => {
    for (const e of edges) {
      const from = e.from === undefined ? null : side(e.from);
      const to = e.to === undefined ? null : side(e.to);
      expect(from, `${e.id} starts nowhere`).not.toBeNull();
      expect(to, `${e.id} ends nowhere`).not.toBeNull();
      expect(from, `${e.id} crosses the firewall`).toBe(to);
    }
  });

  it('draws two solvency ceilings, one per side, and never one over both', () => {
    const ceilings = solids.filter((n) => n.kind === 'ceiling');
    expect(ceilings).toHaveLength(2);
    expect(ceilings.map((n) => side(n.id)).sort()).toEqual(['own', 'service']);
    // A single ceiling spanning the stage would be exactly the wrong drawing:
    // one solvency test over the total is the design doc 16 §7.1 refuses.
    for (const c of ceilings) expect(c.w).toBeLessThan(STAGE_WIDTH / 2);
  });

  it('mirrors the two domains, so the same machine reads as the same machine', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['own-vault', 'svc-vault'],
      ['own-books', 'svc-books'],
      ['own-check', 'svc-check'],
    ];
    for (const [a, b] of pairs) {
      const na = solids.find((n) => n.id === a);
      const nb = solids.find((n) => n.id === b);
      expect(na?.kind, a).toBe(nb?.kind);
      expect(na?.y, a).toBe(nb?.y);
      expect(na?.h, a).toBe(nb?.h);
      expect(na?.w, a).toBe(nb?.w);
    }
  });

  // --- tone discipline -------------------------------------------------------

  it('reserves the branch and alarm tones, using none of them', () => {
    for (const n of model.nodes) expect(['ink', 'dim'], n.id).toContain(n.tone);
    // A voided question is the healthy failure path, not a safety state.
    expect(model.nodes.find((n) => n.id === 'q-voided')?.tone).toBe('dim');
  });

  // --- the lifecycle ---------------------------------------------------------

  it('runs the four ordinary states forward, with an exit from each but the last', () => {
    const chain = ['q-registered', 'q-open', 'q-sealed', 'q-settled'];
    const xs = chain.map((id) => solids.find((n) => n.id === id)?.x ?? -1);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    for (const id of chain) expect(solids.find((n) => n.id === id)?.y).toBe(solids[4]?.y);

    const voidEdges = edges.filter((e) => e.to === 'q-voided');
    expect(voidEdges.map((e) => e.from).sort()).toEqual(['q-open', 'q-registered', 'q-sealed']);
    // Settled and Voided are the only terminal states, so nothing leaves them.
    expect(edges.filter((e) => e.from === 'q-settled' || e.from === 'q-voided')).toHaveLength(0);
  });

  it('gives the success chain the widest pipe, because it is the common path', () => {
    const success = edges.filter((e) => e.id.startsWith('e-') && e.tone === 'ink');
    expect(success).toHaveLength(3);
    for (const e of success) expect(e.emphasis ?? 1).toBeGreaterThan(1);
    for (const e of edges.filter((x) => x.to === 'q-voided')) {
      expect(e.emphasis ?? 1).toBeLessThanOrEqual(1);
    }
  });

  // --- legibility ------------------------------------------------------------

  it('labels every drawn part inside the twelve-character budget', () => {
    for (const n of solids) {
      expect(n.label, n.id).toBeTruthy();
      expect(n.label?.length ?? 99, `${n.id}: ${n.label}`).toBeLessThanOrEqual(12);
    }
  });

  it('leaves every label room to be read', () => {
    for (const sim of [early, trading]) {
      const labelled = buildModel(sim).nodes.filter(
        (n) => n.kind !== 'edge' && n.label !== undefined,
      );
      expect(labelled).toHaveLength(12);
      for (const a of labelled) {
        for (const b of labelled) {
          if (a.id >= b.id) continue;
          // Only nodes whose vertical extents overlap can collide horizontally.
          if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
          const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
          const need =
            ((a.label?.length ?? 0) + (b.label?.length ?? 0)) * (CHAR_W / 2) + MIN_GAP;
          expect(gap, `${a.id} (${a.label}) vs ${b.id} (${b.label})`).toBeGreaterThan(need);
        }
      }
    }
  });

  /**
   * The placement pass silently **drops** a label it cannot fit, so a crowded
   * stage degrades into a diagram with unnamed shapes rather than into an
   * error. The three settings below are `Scene2D`'s own, one per breakpoint,
   * including its rule that sublabels are not offered at all below 1024 px.
   */
  it('places every label at all three type scales, dropping none', () => {
    const flip = (y: number, h = 0): number => STAGE_HEIGHT - y - h;
    const scales = [
      { label: 0.7, sub: 0.56, band: 0.88, showSub: false },
      { label: 0.56, sub: 0.44, band: 0.7, showSub: false },
      { label: 0.46, sub: 0.36, band: 0.58, showSub: true },
    ];
    for (const s of scales) {
      const drawn = solids.map((n) => (s.showSub ? n : { ...n, sublabel: undefined }));
      const out = layoutLabels(drawn, {
        flip,
        fontSize: s.label,
        subFontSize: s.sub,
        maxBands: 3,
        firstBand: s.label,
        bandStep: s.band,
      });
      expect(out.dropped, `at label size ${s.label}`).toBe(0);
    }
  });

  it('reads the Bleavit-side price from the simulation, and only that', () => {
    const price = trading.books.find((b) => b.kind === 'DecisionAccept')?.spot ?? 0.5;
    expect(solids.find((n) => n.id === 'own-books')?.fill).toBeCloseTo(price, 9);
    // The service book carries an invented example, so it must not move with
    // the simulation — the app has no hosted question to read.
    const a = buildModel(early).nodes.find((n) => n.id === 'svc-books')?.fill;
    const b = solids.find((n) => n.id === 'svc-books')?.fill;
    expect(a).toBe(b);
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(trading)).toEqual(model);
  });

  it('names the relation and keys every shape it draws', () => {
    expect(model.relation).toContain('Separation');
    expect(model.caption).toBeTruthy();
    expect(model.legend?.length ?? 0).toBeGreaterThanOrEqual(4);
    const shapes = new Set(model.legend?.map((l) => l.shape));
    for (const kind of ['cube', 'plate', 'ceiling']) expect(shapes).toContain(kind);
  });
});

describe('the certification arithmetic', () => {
  /**
   * Doc 16 §5.2's own table, rounded **up** to two decimals from 36.7449 /
   * 14.2368 / 6.7221 — a `b` rounded down is a certificate that does not hold.
   * Recomputing it here is what stops the scene quoting the superseded
   * displacement-form figures, which read 1.928x low on the same rows.
   */
  const PUBLISHED: readonly (readonly [number, number])[] = [
    [0.02, 36.75],
    [0.05, 14.24],
    [0.1, 6.73],
  ];

  it('agrees with the published minimum liquidity per unit of stake', () => {
    for (const [eps, published] of PUBLISHED) {
      expect(Math.ceil(bMinPerStake(eps) * 100) / 100, `ε = ${eps}`).toBeCloseTo(published, 10);
    }
  });

  it('reproduces the corrected cash subsidy, not the liquidity parameter', () => {
    // Doc 16 §8.2: 19.736·S at ε = 0.05, against the superseded 28.5·S.
    expect(subsidyPerStake(0.05)).toBeCloseTo(19.736, 3);
    expect(subsidyPerStake(0.05) / bMinPerStake(0.05)).toBeCloseTo(2 * Math.LN2, 12);
  });

  it('is the security factor over twice a log, and nothing else', () => {
    expect(SECURITY_FACTOR).toBe(3);
    expect(bMinPerStake(0.05)).toBeCloseTo(3 / (2 * Math.log(0.5 / 0.45)), 12);
  });
});

describe('TheServiceScene', () => {
  it('carries a DOM row for every part on the canvas', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const missing = buildModel(trading)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer, three numbers, and no table', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers.length).toBeGreaterThanOrEqual(6);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    // Every table is behind a drawer; the open panel is prose only.
    expect(container.querySelectorAll('.depth table').length).toBe(
      container.querySelectorAll('table').length,
    );
  });

  it('states the two claims the whole scene exists to make', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const text = container.textContent ?? '';
    // A floor, never a ceiling — the one thing readers get wrong.
    expect(text).toContain('floor, never a ceiling');
    // And the failure that segregation prevents, said as a failure.
    expect(text).toContain('until Bleavit’s own traders are already unbacked');
  });

  it('renders the deposit and the cap from the registry, not from prose', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const text = container.textContent ?? '';
    expect(param('svc.client_bond').value).toBe(100_000);
    expect(param('svc.max_live').value).toBe(16);
    expect(text).toContain('100,000');
    // Four times an attestor's bond, computed rather than asserted in prose.
    expect(param('svc.client_bond').value / param('att.bond').value).toBe(4);
  });

  it('flags the cap as unsettled wherever it is printed', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    expect(param('svc.max_live').verification.status).not.toBe('settled');
    expect(container.querySelectorAll('.value--unverified').length).toBeGreaterThan(0);
  });

  it('accounts for all six governable service rows', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const rows = [...container.querySelectorAll('tr[id^="svc-param-"]')];
    expect(rows).toHaveLength(6);
    for (const key of [
      'svc.client_bond',
      'svc.max_live',
      'svc.max_window',
      'svc.fee_bps',
      'svc.epsilon_min',
      'svc.price_cap',
    ]) {
      expect(rows.some((r) => r.id === `svc-param-${key}`), key).toBe(true);
    }
  });

  it('prints the scarcity step the pair of rows actually produces', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const step = (value('svc.price_cap') - 1) / value('svc.max_live');
    // Doc 16 §8.6: (4 − 1) / 16 = 0.1875, which divides the 1e9 grid exactly.
    expect(step).toBe(0.1875);
    expect((step * 1e9) % 1).toBe(0);
    expect(container.textContent ?? '').toContain('0.1875');
  });

  it('lists every lifecycle state exactly once', () => {
    const { container } = render(<TheServiceScene sim={trading} />);
    const rows = [...container.querySelectorAll('tr[id^="svc-phase-"]')];
    expect(rows.map((r) => r.id).sort()).toEqual([
      'svc-phase-open',
      'svc-phase-registered',
      'svc-phase-sealed',
      'svc-phase-settled',
      'svc-phase-voided',
    ]);
  });
});
