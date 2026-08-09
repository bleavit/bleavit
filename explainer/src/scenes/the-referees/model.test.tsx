import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TheRefereesScene, buildModel } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import type { ProposalClass } from '../../protocol/types';
import { PLAYBOOK_IDS, PROPOSAL_CLASSES } from '../../protocol/types';
import {
  ATT_MIN_MEMBERS,
  ATT_QUORUM,
  GUARDIAN_APPROVAL_THRESHOLD,
  GUARDIAN_MEMBERS,
  MAX_NESTED_CALLS,
  MAX_NESTED_LEVELS,
} from '../../protocol/constants';
import { param } from '../../protocol/params';

/**
 * What this scene promises, asserted where it can rot.
 *
 * Two claims carry the whole thing and both are counts, which is exactly the
 * kind of fact that decays silently: **eight** kinds of authority and **five**
 * guardian powers. If either ever grows, this scene starts teaching a closed
 * set that is not closed — so the counts are checked against the same constants
 * and tables the rail prints, not against numbers typed here.
 *
 * Legibility is asserted as directly as correctness. The renderer centres a
 * label under its node, so two labelled nodes sharing a row collide unless
 * their centres are far enough apart for both boxes plus a gap. An unreadable
 * drawing is a defect, and it is cheaper to catch here than by eye.
 */

const scenario = SCENARIOS['normal-execution'];
const stateFor = (cls: ProposalClass, cursor = 5) =>
  runScenario(scenario, cursor, cls, 'A referee test mandate');

const treasury = stateFor('Treasury');

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than the renderer, which estimates 0.56 em at a
 * 0.46-unit label size (0.258 per character) and keeps a 0.25 gap. Passing at
 * 0.26/0.3 clears it, so a change to either does not quietly turn this
 * assertion into a formality.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

/** The canvas budget: longer labels are dropped by the placement pass. */
const LABEL_BUDGET = 12;

describe('buildModel', () => {
  const model = buildModel(treasury);
  const doors = model.nodes.filter((n) => n.id.startsWith('door-'));
  const behind = model.nodes.filter((n) => n.id.startsWith('behind-'));

  it('draws one door per kind of authority, and exactly eight of them', () => {
    // Eight is the closed set of `origins_core::Origin` (doc 06 §3.1). It is
    // asserted as a literal *and* as a pairing, because the pairing alone would
    // stay green if a ninth door and a ninth panel row arrived together.
    expect(doors).toHaveLength(8);
    expect(behind).toHaveLength(doors.length);
    // caller + filter + seal + forbidden, plus the two columns.
    expect(model.nodes).toHaveLength(4 + doors.length * 2);
  });

  it('gives every node a unique id, a label inside budget, and a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of model.nodes) {
      expect(n.label, n.id).toBeTruthy();
      expect(n.label!.length, `${n.id}: ${n.label}`).toBeLessThanOrEqual(LABEL_BUDGET);
      expect(n.domRowId, n.id).toBeTruthy();
    }
  });

  it('keeps every node inside the stage', () => {
    for (const n of model.nodes) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('seals the top of the wall, with nothing above it and no door in it', () => {
    const seal = model.nodes.find((n) => n.id === 'seal');
    const wall = model.rules.find((r) => r.id === 'wall');
    expect(seal?.kind).toBe('ceiling');
    expect(wall).toBeDefined();
    // The seal caps the wall exactly: its top edge is the wall's top end, so
    // there is no stretch of wall drawn above it that could hold a door.
    expect(seal!.y + seal!.h).toBeCloseTo(wall!.to, 6);
    // And every door is below it, without exception. A door drawn level with or
    // above the seal would say the sealed calls are reachable after all.
    for (const d of doors) {
      expect(d.y + d.h, d.id).toBeLessThan(seal!.y);
    }
  });

  it('puts the origin-blind filter in front of every door at once', () => {
    const filter = model.nodes.find((n) => n.id === 'filter');
    const wall = model.rules.find((r) => r.id === 'wall');
    expect(filter).toBeDefined();
    // One plate spanning the whole wall, on the near side of it: the claim is
    // that no request reaches any door without passing this, and a plate that
    // covered only part of the height would draw the opposite.
    expect(filter!.y).toBeCloseTo(wall!.from, 6);
    expect(filter!.y + filter!.h).toBeCloseTo(wall!.to, 6);
    for (const d of doors) expect(filter!.x + filter!.w, d.id).toBeLessThan(d.x);
    // The two checks are named on the drawing, in order, and they are two.
    const order = model.rules.find((r) => r.id === 'order');
    expect(order?.ticks?.map((t) => t.label)).toEqual([
      'who asks',
      'check 1',
      'check 2',
      'what happens',
    ]);
  });

  it('lights exactly one door, and it is the one this proposal would leave by', () => {
    // Every class must resolve to a door, including CONSTITUTIONAL — which gets
    // no belief-side origin at all and therefore leaves by the token-vote door.
    const lit = (cls: ProposalClass) =>
      buildModel(stateFor(cls))
        .nodes.filter((n) => n.id.startsWith('door-') && n.state === 'passed')
        .map((n) => n.id);
    for (const cls of PROPOSAL_CLASSES) expect(lit(cls), cls).toHaveLength(1);
    expect(lit('Treasury')).toEqual(['door-treasury']);
    expect(lit('Code')).toEqual(['door-code']);
    expect(lit('Constitutional')).toEqual(['door-values']);
  });

  it('reserves the branch and safety tones, which have no business here', () => {
    // accept/reject belong to branch instruments and alarm to genuine safety
    // states. Authority is neither, and a door tinted like a branch would read
    // as an outcome.
    for (const n of model.nodes) {
      expect(['ink', 'dim'], n.id).toContain(n.tone);
    }
  });

  it('leaves every label room to be read', () => {
    for (const cls of PROPOSAL_CLASSES) {
      const labelled = buildModel(stateFor(cls)).nodes.filter((n) => n.label !== undefined);
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
    }
  });

  it('names the relation it exists to show, and keys every mark it draws', () => {
    expect(model.relation).toMatch(/no door/i);
    const kinds = new Set(model.nodes.map((n) => n.kind));
    const keyed = new Set((model.legend ?? []).map((e) => e.shape));
    for (const shape of keyed) expect(kinds, `legend names ${shape}`).toContain(shape);
    expect(model.legend?.length).toBeGreaterThan(0);
    expect(model.caption).toBeTruthy();
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(treasury)).toEqual(model);
  });
});

describe('TheRefereesScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const missing = buildModel(treasury)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer and three numbers, not with a table', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    // Everything denser than three numbers is behind a drawer, closed.
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(6);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    expect(container.querySelectorAll('.depth table').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.col-rail > table')).toHaveLength(0);
  });

  it('states the headline claims in words a first-time reader meets first', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const lede = container.querySelector('.lede')?.textContent ?? '';
    expect(lede).toMatch(/eight/i);
    expect(lede).toMatch(/stop/i);
    // No citations, no parameter keys, no Rust names in the opening paragraph.
    expect(lede).not.toMatch(/§/);
    expect(lede).not.toMatch(/Futarchy[A-Z]/);
    expect(lede).not.toMatch(/\b[a-z]+\.[a-z_]+\b/);
  });

  it('prints every origin twice: the door word, then the name in the code', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const doorWords = [...container.querySelectorAll('.ref-door')].map((e) => e.textContent);
    const modelWords = buildModel(treasury)
      .nodes.filter((n) => n.id.startsWith('door-'))
      .map((n) => n.label);
    expect(doorWords).toEqual(modelWords);
    // The eight frozen variant names, exactly as `origins_core::Origin` spells
    // them. A door word may be reworded for clarity; these may not.
    const rows = [...container.querySelectorAll('tr[id^="ref-origin-"]')];
    expect(rows).toHaveLength(8);
    const text = container.textContent ?? '';
    for (const name of [
      'FutarchyParam',
      'FutarchyTreasury',
      'FutarchyCode',
      'FutarchyMeta',
      'ConstitutionalValues',
      'OracleResolution',
      'GuardianHold',
      'EmergencyPlaybook',
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it('accounts for the guardian council exactly as the constants state it', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const text = container.textContent ?? '';
    expect(text).toContain(`${GUARDIAN_APPROVAL_THRESHOLD} of ${GUARDIAN_MEMBERS}`);
    // Five powers, and the six things they cannot do. Both counts are the point
    // of the panel, so both are asserted rather than assumed.
    expect(container.querySelectorAll('tr[id^="ref-power-"]')).toHaveLength(5);
    expect(container.querySelectorAll('.ref-prohibition')).toHaveLength(6);
    expect(text).toContain(String(PLAYBOOK_IDS.length));
  });

  it('states the attestor quorum, the bond, and the polarity trap', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const text = container.textContent ?? '';
    expect(text).toContain('att.bond');
    expect(text).toContain('att.window');
    expect(text).toContain(param('att.bond').value.toLocaleString('en-US'));
    expect(text).toContain(param('att.window').value.toLocaleString('en-US'));
    expect(container.querySelector('.depth')?.textContent).toBeTruthy();
    // The trap: `attestation_upheld` says the ATTESTATION stood, not the
    // challenge. Nothing else on this screen inverts as expensively.
    const warn = container.querySelector('.ref-warn')?.textContent ?? '';
    expect(warn).toContain('resolve_challenge');
    expect(warn).toMatch(/the signature stood/i);
    expect(warn).toMatch(/does not mean the challenge succeeded/i);
    // And the drawer heading carries the real quorum, not a remembered one.
    const summaries = [...container.querySelectorAll('.depth__hint')].map((e) => e.textContent);
    expect(summaries).toContain(`${ATT_QUORUM} of ${ATT_MIN_MEMBERS}`);
  });

  it('publishes the filter budget from the kernel constants, not from prose', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const summaries = [...container.querySelectorAll('.depth__hint')].map((e) => e.textContent);
    expect(summaries).toContain(`${MAX_NESTED_LEVELS} levels · ${MAX_NESTED_CALLS} calls`);
    // Every carrier that can hide a call inside another call gets a row: an
    // unlisted one is a hole in the "wrapping it changes nothing" claim.
    const text = container.textContent ?? '';
    for (const carrier of [
      'utility.batch',
      'utility.dispatch_as',
      'proxy.proxy_announced',
      'multisig.as_multi_threshold_1',
      'scheduler.*',
      'sudo.sudo_as',
      'pallet_xcm.execute',
    ]) {
      expect(text, carrier).toContain(carrier);
    }
  });

  it('names the sealed calls, and says the founding key cannot reach them either', () => {
    const { container } = render(<TheRefereesScene sim={treasury} />);
    const nobody = container.querySelector('#ref-nobody')?.closest('.panel');
    const text = nobody?.textContent ?? '';
    expect(text).toMatch(/founding key/i);
    expect(text).toMatch(/first block/i);
    for (const call of ['system.set_code', 'system.set_storage', 'balances.force_transfer']) {
      expect(text, call).toContain(call);
    }
  });
});
