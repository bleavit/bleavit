import type { ComponentType } from 'react';
import type { SceneId } from '../state/store';
import type { SimState } from '../sim/types';

import { TheChainScene } from './the-chain';
import { TheUpgradeScene } from './the-upgrade';
import { EpochClockScene } from './epoch-clock';
import { LifecycleScene } from './lifecycle';
import { MarketFloorScene } from './market-floor';
import { LedgerEscrowScene } from './ledger-escrow';
import { DecideGauntletScene } from './decide-gauntlet';
import { WelfareEngineScene } from './welfare-engine';
import { OracleDisputesScene } from './oracle-disputes';
import { ExecutionGuardScene } from './execution-guard';
import { TheBorderScene } from './the-border';
import { TheServiceScene } from './the-service';
import { TheRefereesScene } from './the-referees';
import { TheWindowScene } from './the-window';

export interface SceneProps {
  sim: SimState;
}

/**
 * Chrome hues. A scene's accent colours the page while that scene is open, so
 * you always know which room of the machine you are standing in.
 *
 * These are deliberately a *separate* set from the data hues. The palette
 * reserves teal to ACCEPT, amber to REJECT and rose to genuine safety states,
 * and a reserved hue spent as page chrome stops being a signal. All four chrome
 * hues therefore sit at least 39 degrees away from all three reserved ones, and
 * each carries the scenes that are about one kind of thing:
 *
 *   clock   azure   things measured over time
 *   path    violet  things that move through states and get judged
 *   flow    orchid  things where value changes hands
 *   guard   lime    things that stand between a decision and its effect
 *
 * The pairing used to be exactly two scenes per hue, which was true when there
 * were eight scenes and is not a rule. What *is* a rule is the 39-degree
 * clearance, because that is what keeps a reserved colour meaning one thing. Do
 * not add a fifth chrome hue to keep the counts even — the reserved hues are
 * load-bearing and the chrome hues are wayfinding.
 */
export type Chrome = 'clock' | 'path' | 'flow' | 'guard';

/**
 * The four acts, in reading order.
 *
 * Fourteen scenes in one flat list is a menu, not a route. The chapters say what
 * kind of thing the next few scenes are about, so a reader can skip a whole act
 * — somebody who wants to understand futarchy can start at *A proposal's life*
 * and never open the substrate, and somebody integrating against the chain can
 * go straight to *The edges*.
 */
export type Chapter = 'ground' | 'proposal' | 'edges';

export interface ChapterDefinition {
  readonly id: Chapter;
  readonly title: string;
  /** One line under the chapter heading: why these scenes are together. */
  readonly blurb: string;
}

export const CHAPTERS: readonly ChapterDefinition[] = Object.freeze([
  {
    id: 'ground',
    title: 'The chain itself',
    blurb: 'What Bleavit is before it is a futarchy: a Polkadot parachain that can replace its own code.',
  },
  {
    id: 'proposal',
    title: 'A proposal’s life',
    blurb: 'One decision, from the moment somebody files it to the moment it runs — or does not.',
  },
  {
    id: 'edges',
    title: 'The edges',
    blurb: 'Where the chain meets money, other chains, the people it trusts, and the programs that read it.',
  },
]);

export interface SceneDefinition {
  readonly id: SceneId;
  readonly navLabel: string;
  readonly title: string;
  /** One sentence under the title: what this scene is for. */
  readonly tagline: string;
  /** Drives `--accent` for the whole page while this scene is open. */
  readonly chrome: Chrome;
  /** Which act this scene belongs to. Drives the grouped nav. */
  readonly chapter: Chapter;
  readonly Component: ComponentType<SceneProps>;
}

/** The CSS custom property each chrome hue resolves to. */
export const CHROME_VAR: Record<Chrome, string> = {
  clock: 'var(--c-clock)',
  path: 'var(--c-path)',
  flow: 'var(--c-flow)',
  guard: 'var(--c-guard)',
};

export const SCENE_ORDER: readonly SceneId[] = [
  'the-chain',
  'the-upgrade',
  'epoch-clock',
  'lifecycle',
  'market-floor',
  'ledger-escrow',
  'decide-gauntlet',
  'welfare-engine',
  'oracle-disputes',
  'execution-guard',
  'the-border',
  'the-service',
  'the-referees',
  'the-window',
];

export const SCENES: Record<SceneId, SceneDefinition> = {
  'the-chain': {
    id: 'the-chain',
    navLabel: 'The chain',
    title: 'The chain',
    tagline: 'Bleavit does not secure itself. It rents that from Polkadot, and pays for it in proof.',
    chrome: 'clock',
    chapter: 'ground',
    Component: TheChainScene,
  },
  'the-upgrade': {
    id: 'the-upgrade',
    navLabel: 'The upgrade',
    title: 'Rewriting the chain',
    tagline: 'The chain keeps its own program inside itself, and replacing it takes two steps.',
    chrome: 'path',
    chapter: 'ground',
    Component: TheUpgradeScene,
  },
  'epoch-clock': {
    id: 'epoch-clock',
    navLabel: 'The clock',
    title: 'The clock',
    tagline: 'Everything happens on a 21-day cycle, and every deadline is a slice of it.',
    chrome: 'clock',
    chapter: 'proposal',
    Component: EpochClockScene,
  },
  lifecycle: {
    id: 'lifecycle',
    navLabel: 'The journey',
    title: 'A proposal’s journey',
    tagline: 'Fifteen states a proposal can be in, and the routes between them.',
    chrome: 'path',
    chapter: 'proposal',
    Component: LifecycleScene,
  },
  'market-floor': {
    id: 'market-floor',
    navLabel: 'The markets',
    title: 'The markets',
    tagline: 'Instead of voting, people bet. The price becomes the forecast.',
    chrome: 'flow',
    chapter: 'proposal',
    Component: MarketFloorScene,
  },
  'ledger-escrow': {
    id: 'ledger-escrow',
    navLabel: 'The escrow',
    title: 'The escrow',
    tagline: 'Put in one dollar, hold a claim in both possible futures at once.',
    chrome: 'flow',
    chapter: 'proposal',
    Component: LedgerEscrowScene,
  },
  'decide-gauntlet': {
    id: 'decide-gauntlet',
    navLabel: 'The decision',
    title: 'The decision',
    tagline: 'Eleven checks in a fixed order, and the safety ones run first.',
    chrome: 'path',
    chapter: 'proposal',
    Component: DecideGauntletScene,
  },
  'welfare-engine': {
    id: 'welfare-engine',
    navLabel: 'The score',
    title: 'The score',
    tagline: 'One number for how well things went — the number the markets bet on.',
    chrome: 'clock',
    chapter: 'proposal',
    Component: WelfareEngineScene,
  },
  'oracle-disputes': {
    id: 'oracle-disputes',
    navLabel: 'The disputes',
    title: 'Reporting and disputes',
    tagline: 'Facts arrive with money at stake, and almost anyone can challenge them.',
    chrome: 'guard',
    chapter: 'proposal',
    Component: OracleDisputesScene,
  },
  'execution-guard': {
    id: 'execution-guard',
    navLabel: 'The guard',
    title: 'The guard',
    tagline: 'Winning is only permission to try. Every condition is read again at the last moment.',
    chrome: 'guard',
    chapter: 'proposal',
    Component: ExecutionGuardScene,
  },
  'the-border': {
    id: 'the-border',
    navLabel: 'The border',
    title: 'The border',
    tagline: 'The dollars are not made here, and every message that arrives is read against a short list.',
    chrome: 'flow',
    chapter: 'edges',
    Component: TheBorderScene,
  },
  'the-service': {
    id: 'the-service',
    navLabel: 'The service',
    title: 'Questions for sale',
    tagline: 'Another chain can pay for a decision — and its money never touches Bleavit’s own.',
    chrome: 'flow',
    chapter: 'edges',
    Component: TheServiceScene,
  },
  'the-referees': {
    id: 'the-referees',
    navLabel: 'The referees',
    title: 'Who may act',
    tagline: 'Eight kinds of authority, a council with five buttons, and no master key.',
    chrome: 'guard',
    chapter: 'edges',
    Component: TheRefereesScene,
  },
  'the-window': {
    id: 'the-window',
    navLabel: 'The window',
    title: 'What you can see',
    tagline: 'A short list of promises, and a way to check every answer yourself.',
    chrome: 'clock',
    chapter: 'edges',
    Component: TheWindowScene,
  },
};

/** Scene ids grouped by chapter, in reading order. Drives the nav. */
export const SCENES_BY_CHAPTER: readonly (readonly [ChapterDefinition, readonly SceneId[]])[] =
  Object.freeze(
    CHAPTERS.map(
      (chapter) =>
        [chapter, SCENE_ORDER.filter((id) => SCENES[id].chapter === chapter.id)] as const,
    ),
  );
