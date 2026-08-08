import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { OracleDisputesScene, buildModel } from './index';
import { SCENARIOS, SCENARIO_SUBJECT } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import {
  ORC_REPORT_WINDOW_BLOCKS,
  ORC_RETENTION_BLOCKS,
  ORC_WINDOW_BLOCKS,
  WATCHTOWER_EXTENSION_BLOCKS,
} from '../../protocol/constants';

/**
 * The scene's three structural promises.
 *
 * 1. **The DOM is authoritative.** Every object in the `SceneModel` names a
 *    `domRowId`, and that id must resolve to a row the rail actually renders —
 *    otherwise the canvas would be carrying a fact the table does not.
 * 2. **The stage is the drawing surface, not a suggestion.** Nothing may be laid
 *    outside it, at any point in either dispute scenario.
 * 3. **Labels are legible.** They are short, plain, and no two of them on the
 *    same row are close enough to collide. That last one is arithmetic rather
 *    than judgement, so it is asserted rather than reviewed.
 */

const DISPUTE_SCENARIOS = ['oracle-dispute', 'registry-dispute'] as const;

/** Stage units a character of label type occupies, measured off `scene.css`. */
const CHAR_W = 0.24;
/** The gap two labels must keep beyond their own half-widths. */
const LABEL_CLEARANCE = 0.3;
/** Canvas labels are a caption, not a sentence. */
const LABEL_MAX_CHARS = 12;

function* everyStep() {
  for (const id of DISPUTE_SCENARIOS) {
    const scenario = SCENARIOS[id];
    const subject = SCENARIO_SUBJECT[id];
    for (let cursor = 0; cursor <= scenario.steps.length; cursor++) {
      yield { id, cursor, sim: runScenario(scenario, cursor, subject.cls, subject.title) };
    }
  }
}

describe('oracle-disputes', () => {
  it('binds every drawn object to a row the rail renders', () => {
    for (const { id, cursor, sim } of everyStep()) {
      const { container, unmount } = render(<OracleDisputesScene sim={sim} />);
      for (const node of buildModel(sim).nodes) {
        if (node.domRowId === undefined) continue;
        expect(
          container.querySelector(`#${CSS.escape(node.domRowId)}`),
          `${id}@${cursor}: node ${node.id} points at missing row ${node.domRowId}`,
        ).toBeTruthy();
      }
      unmount();
    }
  });

  it('keeps every object on the stage and every id unique', () => {
    for (const { id, cursor, sim } of everyStep()) {
      const model = buildModel(sim);
      const ids = model.nodes.map((n) => n.id);
      expect(new Set(ids).size, `${id}@${cursor}: duplicate node id`).toBe(ids.length);
      for (const n of model.nodes) {
        expect(n.x, `${id}@${cursor}: ${n.id}`).toBeGreaterThanOrEqual(0);
        expect(n.y, `${id}@${cursor}: ${n.id}`).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w, `${id}@${cursor}: ${n.id}`).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(n.y + n.h, `${id}@${cursor}: ${n.id}`).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
    }
  });

  it('holds the money deadline still and spends the extension in front of it', () => {
    const scenario = SCENARIOS['oracle-dispute'];
    const subject = SCENARIO_SUBJECT['oracle-dispute'];

    // Step 3 is where the watchtower quorum is missed and the +48 h lands.
    const before = runScenario(scenario, 2, subject.cls, subject.title);
    const after = runScenario(scenario, 3, subject.cls, subject.title);
    expect(before.oracle.extensionUsed).toBe(false);
    expect(after.oracle.extensionUsed).toBe(true);

    const xOf = (m: ReturnType<typeof buildModel>, id: string): number => {
      const node = m.nodes.find((n) => n.id === id);
      expect(node, `missing node ${id}`).toBeDefined();
      return node!.x;
    };
    const endOf = (m: ReturnType<typeof buildModel>, id: string): number => {
      const node = m.nodes.find((n) => n.id === id);
      expect(node, `missing node ${id}`).toBeDefined();
      return node!.x + node!.w;
    };

    const modelBefore = buildModel(before);
    const modelAfter = buildModel(after);

    // `OracleSettleDeadline` comes out of the epoch schedule, so nothing that
    // happens inside the dispute may move it. That is the claim the drawing
    // makes, and it is the opposite of the one the geometry used to make.
    expect(xOf(modelAfter, 'deadline-wall')).toBeCloseTo(
      xOf(modelBefore, 'deadline-wall'),
      9,
    );

    // What the extension does move is the far end of the terminal track: it
    // spends the margin in front of the wall, and here it pushes the verdict
    // past it — 07 §11(2)'s maximally delayed path.
    const rounds = 3;
    const scale =
      17.0 /
      (ORC_REPORT_WINDOW_BLOCKS +
        rounds * ORC_WINDOW_BLOCKS +
        WATCHTOWER_EXTENSION_BLOCKS +
        ORC_RETENTION_BLOCKS);
    const shift = endOf(modelAfter, 'bay-terminal') - endOf(modelBefore, 'bay-terminal');
    expect(shift).toBeCloseTo(WATCHTOWER_EXTENSION_BLOCKS * scale, 9);
    expect(endOf(modelBefore, 'bay-terminal')).toBeLessThan(xOf(modelBefore, 'deadline-wall'));
    expect(endOf(modelAfter, 'bay-terminal')).toBeGreaterThan(xOf(modelAfter, 'deadline-wall'));
  });

  it('keeps every pair of labels on a row clear of each other', () => {
    // Both dispute scenarios, plus the two ladder lengths governance may set
    // that no scenario reaches: the ladder is `orc.rounds`-long, and at four
    // rounds the bays are at their narrowest — the case where labels crowd.
    const forced: { readonly id: string; readonly sim: ReturnType<typeof runScenario> }[] = [];
    for (const rounds of [2, 4]) {
      const scenario = SCENARIOS['oracle-dispute'];
      const subject = SCENARIO_SUBJECT['oracle-dispute'];
      for (const extensionUsed of [false, true]) {
        const sim = runScenario(scenario, 4, subject.cls, subject.title);
        sim.oracle.round = rounds;
        sim.oracle.extensionUsed = extensionUsed;
        forced.push({ id: `forced-${rounds}-rounds-ext-${String(extensionUsed)}`, sim });
      }
    }

    const cases = [
      ...[...everyStep()].map((s) => ({ id: `${s.id}@${s.cursor}`, sim: s.sim })),
      ...forced,
    ];

    for (const { id, sim } of cases) {
      const labelled = buildModel(sim)
        .nodes.filter((n) => n.label !== undefined)
        .map((n) => ({ id: n.id, label: n.label!, row: n.y, cx: n.x + n.w / 2 }));

      for (const n of labelled) {
        expect(n.label.length, `${id}: label "${n.label}" on ${n.id} is too long`).
          toBeLessThanOrEqual(LABEL_MAX_CHARS);
      }

      // A label is drawn centred under its node, so two nodes share a line of
      // type exactly when they share a `y`.
      for (let i = 0; i < labelled.length; i++) {
        for (let j = i + 1; j < labelled.length; j++) {
          const a = labelled[i]!;
          const b = labelled[j]!;
          if (Math.abs(a.row - b.row) > 0.001) continue;
          const need = (a.label.length + b.label.length) * (CHAR_W / 2) + LABEL_CLEARANCE;
          expect(
            Math.abs(a.cx - b.cx),
            `${id}: "${a.label}" (${a.id}) and "${b.label}" (${b.id}) collide on row ${String(a.row)}`,
          ).toBeGreaterThan(need);
        }
      }
    }
  });

  it('doubles the bond height from round to round', () => {
    const scenario = SCENARIOS['oracle-dispute'];
    const subject = SCENARIO_SUBJECT['oracle-dispute'];
    const sim = runScenario(scenario, scenario.steps.length, subject.cls, subject.title);
    const model = buildModel(sim);

    const heights = [1, 2, 3].map((r) => {
      const node = model.nodes.find((n) => n.id === `bond-reporter-${r}`);
      expect(node, `missing bond column for round ${String(r)}`).toBeDefined();
      return node!.h;
    });
    expect(heights[1]!).toBeCloseTo(heights[0]! * 2, 9);
    expect(heights[2]!).toBeCloseTo(heights[1]! * 2, 9);

    // The challenger matches the reporter round for round — the drawing says so
    // by giving the pair identical columns, and the pair is the whole picture.
    for (const r of [1, 2, 3]) {
      const rep = model.nodes.find((n) => n.id === `bond-reporter-${r}`);
      const chal = model.nodes.find((n) => n.id === `bond-challenger-${r}`);
      expect(chal?.h).toBeCloseTo(rep!.h, 9);
    }
  });

  it('does not draw a settlement before one exists', () => {
    const scenario = SCENARIOS['oracle-dispute'];
    const subject = SCENARIO_SUBJECT['oracle-dispute'];
    const open = runScenario(scenario, 4, subject.cls, subject.title);
    expect(open.oracle.settledPath).toBeNull();
    expect(buildModel(open).nodes.some((n) => n.id === 'settled-marker')).toBe(false);

    const settled = runScenario(scenario, scenario.steps.length, subject.cls, subject.title);
    expect(settled.oracle.settledPath).toBe('Adjudicated');
    const marker = buildModel(settled).nodes.find((n) => n.id === 'settled-marker');
    expect(marker?.label).toBe('Adjudicated');
    expect(marker?.domRowId).toBe('settle-Adjudicated');
  });
});
