/**
 * The diagram.
 *
 * Each scene exports a plain-TypeScript `SceneModel` in stage coordinates, and
 * `Scene2D` draws it. This used to feed two renderers — an SVG one and an R3F
 * one under the same orthographic projection — which made the 3D view a copy of
 * this one with fewer labels. The 3D layer is now built from its own material
 * (`scenes/motion.ts`), so this model has exactly one consumer and can be shaped
 * for it: labels placed by a real placement pass, no depth to spend, nothing
 * held back for a camera.
 *
 * The stage is **21 x 12 units**, and the page grid is 21 columns. A tick in the
 * drawing lands on a column edge in the DOM because they share one ruler: the
 * same 21 that the epoch's kernel phase fractions are denominated in.
 */

export const STAGE_WIDTH = 21;
export const STAGE_HEIGHT = 12;

/**
 * Tone is semantic, never decorative. `accept`/`reject` are reserved to branch
 * instruments; `alarm` to genuine safety states; `ink` carries everything else,
 * including the Baseline book, which belongs to neither branch.
 */
export type Tone = 'ink' | 'dim' | 'accept' | 'reject' | 'alarm';

export type NodeKind =
  /** A proposal. Class is shown by notch count, not colour. */
  | 'slab'
  /** A market book. Price is a fill level with a hard level line. */
  | 'plate'
  /** One escrow unit, or a counted stack of them. */
  | 'cube'
  /** A position. Round for scalar LONG/SHORT, square for gate YES/NO. */
  | 'chip'
  /** A veto threshold, drawn above everything it constrains. */
  | 'ceiling'
  /** Joins a complete pair: present means it merges at par. */
  | 'tie'
  /** A stop plate in an ordered gauntlet. */
  | 'stop'
  /** A state node in the lifecycle graph. */
  | 'node'
  /** A directed transition between two nodes. */
  | 'edge'
  /** A stack of unit weights on a labelled scale. */
  | 'stack'
  /** A tooth of the epoch dial. */
  | 'tooth';

export type NodeState =
  | 'active'
  | 'pending'
  | 'passed'
  | 'blocked'
  /** Losing positions are flattened and bracketed **in place** — never removed.
   * "Frozen, not burned" is a geometry rule, not a colour. */
  | 'frozen'
  | 'inactive';

/**
 * Optional fields are written `?: T | undefined` throughout, because the project
 * runs `exactOptionalPropertyTypes`. Scene builders assemble nodes from data
 * that is genuinely sometimes absent, and forcing each one to omit the key
 * rather than pass `undefined` buys no safety and costs a conditional-spread at
 * every call site.
 */
export interface SceneNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Stage coordinates: x in [0,21], y in [0,12], z for depth tiers. */
  readonly x: number;
  readonly y: number;
  readonly z?: number | undefined;
  readonly w: number;
  readonly h: number;
  readonly d?: number | undefined;
  readonly tone: Tone;
  /** Fill level in [0,1] for plates. This is the price, and it is a level, not a size. */
  readonly fill?: number | undefined;
  readonly label?: string | undefined;
  readonly sublabel?: string | undefined;
  readonly state?: NodeState | undefined;
  /** Provenance hatch: a dashed silhouette plus a decal, never a colour change. */
  readonly hatched?: boolean | undefined;
  /** Class notches on a slab's top edge — countable, so it is not colour-coded. */
  readonly notches?: number | undefined;
  /** The DOM row this object corresponds to. The bijection is asserted in tests. */
  readonly domRowId?: string | undefined;
  /** For `edge`: the node ids it connects. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Draw weight for an edge — the common path is the widest pipe. */
  readonly emphasis?: number | undefined;
}

export interface SceneRule {
  readonly id: string;
  readonly axis: 'x' | 'y';
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly label?: string | undefined;
  readonly tone?: Tone | undefined;
  readonly dashed?: boolean | undefined;
  /** Tick marks along the rule, as stage coordinates with their printed values. */
  readonly ticks?: readonly { readonly at: number; readonly label: string }[] | undefined;
}

/**
 * One row of the drawing's key.
 *
 * A diagram of unfamiliar shapes without a key is a puzzle, and this app's
 * shapes are all unfamiliar by construction. The key is part of the model rather
 * than per-scene markup so both renderers show the same one, and so a scene
 * cannot ship a shape it never explains.
 */
export interface LegendEntry {
  /** Which mark this row describes. `hatch` is the provenance overlay. */
  readonly mark: Tone | 'hatch' | 'frozen';
  readonly shape?: NodeKind | undefined;
  /** Plain language. "Bets that it passes", not "GateS_Adopt". */
  readonly label: string;
}

export interface SceneModel {
  readonly nodes: readonly SceneNode[];
  readonly rules: readonly SceneRule[];
  /**
   * The relation this canvas shows that a table cannot: ordering, precedence,
   * simultaneity, conservation, multiplicativity. A scene that cannot name one
   * has no business being 3D and should ship as 2D only.
   */
  readonly relation: string;
  /** Legend for any aggregated quantity, e.g. "each block = 1,000 USDC". */
  readonly unitLegend?: string;
  /** One short line printed above the drawing: what am I looking at? */
  readonly caption?: string | undefined;
  /** The drawing's key. Shown under the stage, in both renderers. */
  readonly legend?: readonly LegendEntry[] | undefined;
}

/*
 * There is no viewpoint switcher any more, and its removal is the point rather
 * than a side effect.
 *
 * The old stage offered "Angled" and "Straight on" as named reading positions on
 * this same model. Straight on projected to something pixel-for-pixel
 * indistinguishable from the flat drawing, and Angled was that drawing with a
 * tilt — two controls that spent a reader's attention to move between three
 * views of one picture. The third dimension has to earn its place with a
 * relation, not with a camera angle, and where it cannot there is now simply
 * nothing to switch to.
 */

/** Empty model, for a scene state with nothing yet to draw. */
export const EMPTY_MODEL: SceneModel = { nodes: [], rules: [], relation: '' };
