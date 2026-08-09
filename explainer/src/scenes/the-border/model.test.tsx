import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TheBorderScene, buildModel, crossed } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import type { SceneNode } from '../model';
import { param } from '../../protocol/params';

/**
 * The border's contract with the specification, with the runtime, and with the
 * page.
 *
 * The property that carries this scene is **spatial**: there is one way in, and
 * every line that crosses the border crosses it at an opening. A drawing whose
 * arrows cut through the wall says the exact opposite of the scene's one claim,
 * and it says it silently — the model still type-checks and the page still
 * renders — so it is asserted here rather than checked by eye.
 *
 * Legibility is asserted the same way. The renderer centres a label under its
 * node, so two labelled nodes sharing a row collide unless their centres are far
 * enough apart for both boxes plus a gap.
 */

const scenario = SCENARIOS['normal-execution'];
const stepsAt = (n: number) =>
  runScenario(scenario, n, 'Treasury', 'Fund the light-client audit — 200,000 USDC');

/** After the seed step: collateral is escrowed, so something has crossed. */
const funded = stepsAt(3);
/** Before anything happens: nothing has crossed, and both meters read empty. */
const empty = stepsAt(0);
/** The one state that earns the alarm tone: two failed probes in a row. */
const impaired = {
  ...funded,
  flags: { ...funded.flags, reserveImpaired: true },
};

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than either measure of the renderer: it estimates
 * `0.56 em` at a 0.46-unit label size (0.258 per character) and keeps a 0.25
 * gap. Passing at 0.26/0.3 clears both, so a change to either does not quietly
 * turn this assertion into a formality.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

const LABEL_BUDGET = 12;

const centre = (n: SceneNode): { x: number; y: number } => ({
  x: n.x + n.w / 2,
  y: n.y + n.h / 2,
});

describe('buildModel', () => {
  const model = buildModel(funded);
  const solids = model.nodes.filter((n) => n.kind !== 'edge');
  const edges = model.nodes.filter((n) => n.kind === 'edge');
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  it('gives every node a unique id and a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of solids) expect(n.domRowId, n.id).toBeTruthy();
  });

  it('keeps every node inside the stage', () => {
    for (const n of solids) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('labels in plain words, inside the twelve-character budget', () => {
    for (const n of solids) {
      if (n.label === undefined) continue;
      expect(n.label.length, `${n.id}: ${n.label}`).toBeLessThanOrEqual(LABEL_BUDGET);
      // The canvas never carries a parameter key: those belong in the rail.
      expect(n.label, n.id).not.toMatch(/\./);
    }
    // Only the wall's second segment is unlabelled, because it is the same wall
    // as the first and naming it twice would read as two walls.
    const unlabelled = solids.filter((n) => n.label === undefined).map((n) => n.id);
    expect(unlabelled).toEqual(['wall-mid']);
  });

  it('leaves every label room to be read', () => {
    for (const sim of [empty, funded, impaired]) {
      const labelled = buildModel(sim).nodes.filter(
        (n) => n.kind !== 'edge' && n.label !== undefined,
      );
      for (const a of labelled) {
        for (const b of labelled) {
          if (a.id >= b.id) continue;
          if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
          const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
          const need = (a.label!.length + b.label!.length) * (CHAR_W / 2) + MIN_GAP;
          expect(gap, `${a.id} (${a.label}) vs ${b.id} (${b.label})`).toBeGreaterThan(need);
        }
      }
    }
  });

  it('builds a wall with exactly two openings, and no gap between its pieces', () => {
    const gate = byId.get('gate');
    const hatch = byId.get('hatch');
    const high = byId.get('wall-high');
    const mid = byId.get('wall-mid');
    expect(gate).toBeDefined();
    expect(hatch).toBeDefined();
    // Bottom to top: hatch, wall, gate, wall — four pieces that meet exactly, so
    // the drawing has no unexplained hole in it.
    const spans = [hatch!, mid!, gate!, high!];
    for (let i = 1; i < spans.length; i++) {
      const below = spans[i - 1]!;
      expect(spans[i]!.y, `${spans[i]!.id} meets ${below.id}`).toBeCloseTo(below.y + below.h, 6);
    }
    // The two openings are drawn as ways through, the two solid pieces are not.
    expect(gate!.state).toBe('passed');
    expect(hatch!.state).toBe('passed');
    expect(high!.tone).toBe('dim');
    expect(mid!.tone).toBe('dim');
  });

  it('routes every crossing through an opening, never through the wall', () => {
    const wall = byId.get('wall-high')!;
    const openings = ['gate', 'hatch'].map((id) => {
      const n = byId.get(id)!;
      return { id, lo: n.y, hi: n.y + n.h };
    });

    const crossed: string[] = [];
    for (const e of edges) {
      const a = byId.get(e.from ?? '');
      const b = byId.get(e.to ?? '');
      expect(a, e.id).toBeDefined();
      expect(b, e.id).toBeDefined();
      const ca = centre(a!);
      const cb = centre(b!);
      // Only an edge whose two ends straddle the wall's whole width draws a
      // line across it; one that stops at the gate ends in an opening already.
      if (Math.min(ca.x, cb.x) >= wall.x || Math.max(ca.x, cb.x) <= wall.x + wall.w) continue;
      crossed.push(e.id);
      // The renderer routes orthogonally through the midpoint of the two
      // centres, so that midpoint's height is where the line meets the wall.
      const at = (ca.y + cb.y) / 2;
      const through = openings.some((o) => at >= o.lo && at <= o.hi);
      expect(through, `${e.id} crosses the wall at y=${at}`).toBe(true);
    }
    // The round trip to Asset Hub, and the rent going out. Both are drawn all
    // the way rather than stopped at the border, because reaching the far side
    // is the claim each of them makes.
    expect(crossed.sort()).toEqual(['e-probe', 'e-rent']);

    // The inbound path is drawn *into* the gate and out of it, so a deposit is
    // never shown arriving anywhere but at the opening.
    const arrive = edges.find((e) => e.id === 'e-arrive');
    const toll = edges.find((e) => e.id === 'e-toll');
    expect(arrive?.to).toBe('gate');
    expect(toll?.from).toBe('gate');
  });

  it('reads the two cap meters off the registry, each against its own ceiling', () => {
    const brought = crossed(funded);
    expect(brought).toBeGreaterThan(0);

    const global = model.nodes.find((n) => n.id === 'cap-global');
    const account = model.nodes.find((n) => n.id === 'cap-account');
    expect(global?.fill).toBeCloseTo(brought / param('phase3.tvl_cap').value, 9);
    expect(account?.fill).toBeCloseTo(brought / param('phase3.dep_cap').value, 9);
    // The per-account ceiling is the tighter of the two while the chain is
    // young, which is the whole reason both are drawn.
    expect(account!.fill!).toBeGreaterThan(global!.fill!);

    const before = buildModel(empty);
    expect(before.nodes.find((n) => n.id === 'cap-global')?.fill).toBe(0);
    expect(before.nodes.find((n) => n.id === 'cap-account')?.fill).toBe(0);
  });

  it('posts the two-part price from the registry, never from a literal', () => {
    const perSecond = param('xcm.usdc_per_sec').value / 1_000_000;
    const perMebibyte = param('xcm.usdc_per_mb').value / 1_000_000;
    expect(model.nodes.find((n) => n.id === 'toll-time')?.sublabel).toBe(
      `${perSecond} USDC of work`,
    );
    expect(model.nodes.find((n) => n.id === 'toll-proof')?.sublabel).toBe(
      `${perMebibyte} USDC of proof`,
    );
  });

  it('marks the two hard refusals as refused, and the deposit as admitted', () => {
    for (const id of ['msg-transact', 'msg-unpaid']) {
      const n = byId.get(id);
      expect(n?.state, id).toBe('blocked');
      expect(n?.tone, id).toBe('dim');
    }
    expect(byId.get('msg-ok')?.state).toBe('passed');
    expect(byId.get('msg-ok')?.tone).toBe('ink');
  });

  it('reserves the alarm tone to a genuinely unhealthy reserve', () => {
    expect(model.nodes.filter((n) => n.tone === 'alarm')).toHaveLength(0);
    expect(buildModel(empty).nodes.filter((n) => n.tone === 'alarm')).toHaveLength(0);
    const alarmed = buildModel(impaired).nodes.filter((n) => n.tone === 'alarm');
    expect(alarmed.map((n) => n.id)).toEqual(['probe']);
  });

  it('declares a key for every mark it draws', () => {
    expect(model.legend).toBeDefined();
    expect(model.caption).toBeTruthy();
    expect(model.relation).not.toBe('');
    const drawnTones = new Set(buildModel(impaired).nodes.map((n) => n.tone));
    for (const entry of model.legend ?? []) {
      if (entry.mark === 'hatch' || entry.mark === 'frozen') continue;
      expect(drawnTones.has(entry.mark), `legend names ${entry.mark}`).toBe(true);
    }
    // Branch tints belong to branch instruments and nothing here is one.
    expect(drawnTones.has('accept')).toBe(false);
    expect(drawnTones.has('reject')).toBe(false);
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(funded)).toEqual(model);
  });
});

describe('TheBorderScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const missing = buildModel(funded)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('explains every mark, and explains nothing that is not drawn', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const rows = [...container.querySelectorAll('tr[id^="border-row-"]')].map((r) => r.id);
    const drawn = new Set(
      buildModel(funded)
        .nodes.map((n) => n.domRowId)
        .filter((id): id is string => id !== undefined),
    );
    expect(rows.sort()).toEqual([...drawn].sort());
  });

  it('opens with the plain answer and three numbers, not with a table', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(7);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    // Every table is behind a drawer except the one that reads the live example.
    expect(container.querySelectorAll('.depth table').length).toBeGreaterThan(0);
  });

  it('states the headline claims in words a first-time reader can use', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const text = container.textContent ?? '';
    // Where the money is, and that it does not move.
    expect(text).toContain('are not made here');
    expect(text).toContain('The coin never leaves home');
    // Default-deny, stated as a rule rather than implied by a list.
    expect(text).toContain('anything not on it is discarded');
    // The failure each mechanism exists to prevent — the thing that makes a rule
    // memorable rather than arbitrary.
    expect(text).toContain('a price does not move when transfers freeze');
    expect(text).toContain('stops producing blocks entirely');
    expect(text).toContain('Silence is a failure, not a pass');
    // Rounding, and the direction it goes.
    expect(text).toContain('Rounding always goes the chain');
  });

  it('names every allowed shape and every named refusal exactly once', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const allowed = [...container.querySelectorAll('tr[id^="border-allow-"]')];
    const denied = [...container.querySelectorAll('tr[id^="border-deny-"]')];
    expect(allowed.length).toBeGreaterThan(0);
    expect(denied.length).toBeGreaterThan(0);
    const ids = [...allowed, ...denied].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The two the runtime denies at every depth of nesting are both named.
    const deniedText = denied.map((r) => r.textContent ?? '').join(' ');
    expect(deniedText).toContain('Transact');
    expect(deniedText).toContain('UnpaidExecution');
  });

  it('prints every parameter row it depends on, with its registry key', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    const keys = [
      'xcm.usdc_per_sec',
      'xcm.usdc_per_mb',
      'xcm.dot_per_sec',
      'xcm.dot_per_mb',
      'phase3.tvl_cap',
      'phase3.dep_cap',
      'res.probe_int',
      'res.probe_to',
      'res.probe_amount',
      'res.fail_thr',
      'res.recover_thr',
      'ops.ct_dot_rate',
      'ops.ct_fee_dot',
      'ops.ct_quote_ttl',
    ];
    for (const key of keys) {
      const row = container.querySelector(`#${CSS.escape(`border-param-${key}`)}`);
      expect(row, key).not.toBeNull();
      // Every one of these is a real doc 13 row, so `param()` must not throw.
      expect(row?.textContent).toContain(key);
      expect(param(key).key).toBe(key);
    }
    // Four rates, and no more: the toll is exactly two dimensions in two assets.
    expect(
      [...container.querySelectorAll('tr[id^="border-param-xcm."]')],
    ).toHaveLength(4);
  });

  it('marks the unsettled rows as unsettled rather than presenting them as final', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    for (const key of ['xcm.usdc_per_sec', 'phase3.tvl_cap', 'phase3.dep_cap']) {
      const row = container.querySelector(`#${CSS.escape(`border-param-${key}`)}`);
      expect(row?.querySelector('.value--unverified'), key).not.toBeNull();
    }
  });

  it('labels the invented figure as invented, and the spec values as spec', () => {
    const { container } = render(<TheBorderScene sim={funded} />);
    expect(container.querySelectorAll('.value--simulated').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.value--spec').length).toBeGreaterThan(0);
  });

  it('shows the reserve state, and only calls it unhealthy when it is', () => {
    const healthy = render(<TheBorderScene sim={funded} />);
    expect(healthy.container.textContent).toContain('reserve reads healthy');
    expect(healthy.container.querySelectorAll('.chip--safety')).toHaveLength(0);

    const broken = render(<TheBorderScene sim={impaired} />);
    expect(broken.container.textContent).toContain('reserve unhealthy');
    expect(broken.container.querySelectorAll('.chip--safety').length).toBeGreaterThan(0);
  });
});
