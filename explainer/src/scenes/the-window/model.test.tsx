import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { GAPS, METHODS, SURFACES, TELEMETRY, TheWindowScene, buildModel } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { layoutLabels } from '../labels';
import { REAL_SOURCE_METHODS } from '../../provenance/types';
import { INTEGRATION_CONTRACT_VERSION } from '../../protocol/constants';

/**
 * What this scene owes the specification, and what it owes the reader.
 *
 * Two things here would rot silently and neither would show up as a broken
 * build. The first is the **count**: this scene claims the chain answers exactly
 * sixteen questions, and the app's single home for that list is
 * `REAL_SOURCE_METHODS`. A method appended there and not described here would
 * leave the rail quietly one row short of the contract, so the two lists are
 * compared name for name and in order rather than merely counted.
 *
 * The second is **legibility**. The renderer centres a label under its node, so
 * two labelled nodes sharing a row collide unless their centres are far enough
 * apart for both boxes and a gap. A label that will not fit is dropped by the
 * placement pass, which means an unreadable drawing degrades into an
 * *incomplete* one — silently. That is asserted directly, at a stricter metric
 * than the renderer's own.
 *
 * The scene is deliberately independent of the simulation, so every assertion is
 * made against two different scenario states. If the model ever starts moving
 * with the transport, these disagree.
 */

const stepsAt = (n: number) =>
  runScenario(SCENARIOS['normal-execution'], n, 'Code', 'Runtime upgrade to spec_version 42');

const early = stepsAt(0);
const late = stepsAt(6);

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than the renderer, which estimates 0.56 em at a
 * 0.46-unit label size (0.258 per character) and keeps a 0.25 gap. Passing at
 * 0.26/0.3 clears it, so a change to either does not turn this into a formality.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

/** Canvas labels are budgeted at twelve characters; longer ones get dropped. */
const LABEL_BUDGET = 12;

describe('buildModel', () => {
  const model = buildModel(late);
  const openings = model.nodes.filter((n) => n.id.startsWith('open-'));
  const values = model.nodes.filter((n) => n.id.startsWith('value-'));
  const proofs = model.nodes.filter((n) => n.id.startsWith('proof-'));
  const wires = model.nodes.filter((n) => n.kind === 'edge');

  it('draws one opening, one answer, one proof and one wire per surface', () => {
    expect(SURFACES).toHaveLength(6);
    expect(openings).toHaveLength(SURFACES.length);
    expect(values).toHaveLength(SURFACES.length);
    expect(proofs).toHaveLength(SURFACES.length);
    expect(wires).toHaveLength(SURFACES.length);
    // Plus the two sides of the boundary, and nothing else on the stage.
    expect(model.nodes).toHaveLength(SURFACES.length * 4 + 2);
    expect(model.nodes.filter((n) => n.id === 'chain')).toHaveLength(1);
    expect(model.nodes.filter((n) => n.id === 'browser')).toHaveLength(1);
  });

  it('gives every node a unique id', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
  });

  it('keeps every node inside the stage', () => {
    for (const n of model.nodes) {
      if (n.kind === 'edge') continue;
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('labels every drawn object inside the twelve-character budget', () => {
    // Every solid carries a label. The wires deliberately do not: six connectors
    // all saying the same thing is noise, and the renderer prints an edge label
    // at the midpoint where it would sit on top of the answer it connects to.
    const unlabelled = model.nodes.filter((n) => n.label === undefined).map((n) => n.id);
    expect(unlabelled.sort()).toEqual(wires.map((n) => n.id).sort());
    for (const n of model.nodes) {
      if (n.kind === 'edge') continue;
      expect(n.label, n.id).toBeTruthy();
      expect(n.label!.length, `${n.id}: ${n.label}`).toBeLessThanOrEqual(LABEL_BUDGET);
    }
    // The labels are the scene's own words, not the rail's: the wall carries
    // "the records", the table carries "The stored records".
    expect(openings.map((n) => n.label)).toEqual(SURFACES.map((s) => s.opening));
    expect(values.map((n) => n.label)).toEqual(SURFACES.map((s) => s.value));
    // Every opening emits the same mark, because every opening carries the same
    // guarantee. A proof labelled per-row would suggest they differ.
    expect(new Set(proofs.map((n) => n.label))).toEqual(new Set(['proof']));
  });

  it('leaves every label room to be read', () => {
    const labelled = model.nodes.filter((n) => n.kind !== 'edge');
    for (const a of labelled) {
      for (const b of labelled) {
        if (a.id >= b.id) continue;
        // Only nodes whose vertical extents overlap can collide horizontally.
        if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
        const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        const need = (a.label!.length + b.label!.length) * (CHAR_W / 2) + MIN_GAP;
        expect(gap, `${a.id} (${a.label}) vs ${b.id} (${b.label})`).toBeGreaterThan(need);
      }
    }
  });

  /**
   * The renderer's own placement pass, at the three type scales `Scene2D`
   * chooses between. A label that fits in no band is dropped rather than
   * shrunk — a sensible degradation everywhere except here, where the count of
   * openings is the fact the picture exists to carry. One dropped label makes
   * the wall look shorter than the promise actually is.
   */
  it('loses no label at any screen size the renderer draws for', () => {
    const flip = (y: number, h = 0): number => STAGE_HEIGHT - y - h;
    const scales = [
      { fontSize: 0.46, subFontSize: 0.36, bandStep: 0.58 },
      { fontSize: 0.56, subFontSize: 0.44, bandStep: 0.7 },
      { fontSize: 0.7, subFontSize: 0.56, bandStep: 0.88 },
    ];
    for (const s of scales) {
      const out = layoutLabels(model.nodes, {
        flip,
        fontSize: s.fontSize,
        subFontSize: s.subFontSize,
        maxBands: 3,
        firstBand: s.fontSize,
        bandStep: s.bandStep,
      });
      expect(out.dropped, `at ${String(s.fontSize)}`).toBe(0);
      expect(out.placed).toHaveLength(model.nodes.length - wires.length);
    }
  });

  it('sets every opening into the wall, and nothing else on it', () => {
    const wall = model.rules.find((r) => r.id === 'wall');
    expect(wall?.axis).toBe('y');
    for (const n of openings) {
      expect(n.x + n.w / 2, n.id).toBeCloseTo(wall!.at, 6);
      expect(n.kind, n.id).toBe('stop');
    }
    // The two sides stand clear of the wall on opposite sides of it.
    const chain = model.nodes.find((n) => n.id === 'chain');
    const browser = model.nodes.find((n) => n.id === 'browser');
    expect(chain!.x + chain!.w).toBeLessThan(wall!.at);
    expect(browser!.x).toBeGreaterThan(wall!.at);
  });

  it('sends the answer and its proof out together, on one straight line', () => {
    for (const s of SURFACES) {
      const wire = wires.find((n) => n.id === `wire-${s.id}`);
      const open = openings.find((n) => n.id === `open-${s.id}`);
      const value = values.find((n) => n.id === `value-${s.id}`);
      const proof = proofs.find((n) => n.id === `proof-${s.id}`);
      expect(wire?.from).toBe(open!.id);
      expect(wire?.to).toBe(proof!.id);
      // The value sits on the line between the two, so it cannot be read as
      // leaving on its own.
      expect(value!.y + value!.h / 2).toBeCloseTo(open!.y + open!.h / 2, 6);
      expect(proof!.y + proof!.h / 2).toBeCloseTo(open!.y + open!.h / 2, 6);
      expect(open!.x).toBeLessThan(value!.x);
      expect(value!.x + value!.w).toBeLessThan(proof!.x);
    }
  });

  it('puts everything the chain promises above the dashed line, and the rest below', () => {
    const edge = model.rules.find((r) => r.id === 'promise-edge');
    expect(edge?.axis).toBe('x');
    expect(edge?.dashed).toBe(true);
    for (const s of SURFACES) {
      const open = openings.find((n) => n.id === `open-${s.id}`);
      if (s.promised) expect(open!.y, s.id).toBeGreaterThan(edge!.at);
      else expect(open!.y + open!.h, s.id).toBeLessThan(edge!.at);
    }
    expect(SURFACES.filter((s) => s.promised)).toHaveLength(5);
    expect(SURFACES.filter((s) => !s.promised)).toHaveLength(1);
  });

  it('reserves the branch and safety tones, and dims only what is unpromised', () => {
    for (const n of model.nodes) {
      expect(['ink', 'dim'], `${n.id}: ${n.tone}`).toContain(n.tone);
    }
    const dimmed = model.nodes.filter((n) => n.tone === 'dim').map((n) => n.id).sort();
    const unpromised = SURFACES.filter((s) => !s.promised).map((s) => s.id);
    expect(dimmed).toEqual(
      unpromised.flatMap((id) => [`open-${id}`, `proof-${id}`, `value-${id}`, `wire-${id}`]).sort(),
    );
  });

  it('carries a caption, a legend and the relation the table cannot state', () => {
    expect(model.caption).toContain(String(SURFACES.filter((s) => s.promised).length));
    expect(model.legend?.length).toBeGreaterThan(0);
    // Every mark the drawing makes is explained by exactly one legend row.
    const shapes = new Set(model.nodes.filter((n) => n.kind !== 'edge').map((n) => n.kind));
    for (const entry of model.legend ?? []) {
      if (entry.shape !== undefined) expect(shapes, entry.label).toContain(entry.shape);
    }
    expect(model.relation).not.toBe('');
  });

  it('binds every drawn object to a row in the rail', () => {
    for (const n of model.nodes) {
      if (n.id === 'chain' || n.id === 'browser') {
        expect(n.domRowId, n.id).toBeUndefined();
        continue;
      }
      expect(n.domRowId, n.id).toBeTruthy();
    }
  });

  it('does not move with the scenario, and is deterministic within one state', () => {
    expect(buildModel(early)).toEqual(model);
    expect(buildModel(late)).toEqual(model);
  });
});

describe('the tables the rail is built from', () => {
  it('describes exactly the frozen sixteen, in the order the contract declares them', () => {
    expect(METHODS.map((m) => m.method)).toEqual([...REAL_SOURCE_METHODS]);
    expect(METHODS).toHaveLength(16);
    for (const m of METHODS) {
      expect(m.answers.length, m.method).toBeGreaterThan(20);
      expect(m.ceiling, m.method).toBeTruthy();
    }
  });

  it('states which operator readings can answer that they could not be taken', () => {
    // Ten methods, eight of which return an optional — doc 12 §6.3's fail-closed
    // rule needs somewhere to put "absent", and a bool or a balance has none.
    expect(TELEMETRY).toHaveLength(10);
    expect(TELEMETRY.filter((t) => t.canSayMissing)).toHaveLength(8);
    expect(new Set(TELEMETRY.map((t) => t.name)).size).toBe(TELEMETRY.length);
  });

  it('keeps the completeness record whole rather than illustrative', () => {
    expect(GAPS).toHaveLength(4);
    expect(new Set(GAPS.map((g) => g.id)).size).toBe(GAPS.length);
  });
});

describe('TheWindowScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const missing = buildModel(late)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer and three numbers, not with a table', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(6);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    // Every table in this rail is behind a drawer: none of them is an opening move.
    const tables = [...container.querySelectorAll('table')];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t.closest('details.depth')).not.toBeNull();
  });

  it('states the one claim the whole scene exists to make', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const lede = container.querySelector('.lede')?.textContent ?? '';
    expect(lede).toContain('refuse to answer');
    expect(lede).toContain('cannot lie to it');
    // And it introduces the term rather than assuming it.
    expect(container.querySelector('.lede .term__btn')?.textContent).toBe('light client');
  });

  it('prints the promise’s edition from the constant, never as a literal', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const readouts = [...container.querySelectorAll('.keyfact [data-role="readout"]')].map(
      (e) => e.textContent,
    );
    expect(readouts).toContain(String(INTEGRATION_CONTRACT_VERSION));
    expect(readouts).toContain(String(METHODS.length));
  });

  it('gives every question, every opening and every operator reading its own row', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    expect(container.querySelectorAll('tr[id^="window-method-"]')).toHaveLength(METHODS.length);
    expect(container.querySelectorAll('tr[id^="window-surface-"]')).toHaveLength(SURFACES.length);
    expect(container.querySelectorAll('tr[id^="window-telemetry-"]')).toHaveLength(
      TELEMETRY.length,
    );
    expect(container.querySelectorAll('tr[id^="window-gap-"]')).toHaveLength(GAPS.length);
  });

  it('shows the storage key as the two hashes it is made of', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const key = container.querySelector('.tw-key')?.textContent ?? '';
    expect(key).toContain('twox128("Constitution")');
    expect(key).toContain('twox128("ReleaseChannel")');
  });

  it('names the failure each rule prevents, not merely the rule', () => {
    const { container } = render(<TheWindowScene sim={late} />);
    const text = container.textContent ?? '';
    // A wrong storage address is indistinguishable from an empty one.
    expect(text).toContain('empty shelf');
    // An unfrozen surface is one the compatibility check cannot fail on.
    expect(text).toContain('cannot fail on');
    // A broken collector reporting zero looks exactly like a healthy chain.
    expect(text).toContain('healthy-looking number');
  });
});
