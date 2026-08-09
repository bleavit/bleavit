/**
 * What the 3D layer is for — and what it is no longer for.
 *
 * The first version of this app rendered the 3D stage from the *same*
 * `SceneModel` as the flat diagram, under the same orthographic projection. That
 * made "degrades to 2D" a build-time guarantee, which was the goal, but it also
 * made the 3D view a strictly worse copy of the flat one: identical content,
 * fewer labels (screen-space labels cannot be placed the way the SVG pass places
 * them), and a tilt. A reader who switched to it learned nothing and lost
 * information. That is a redundant view, and redundant views are cost without
 * benefit.
 *
 * So the mirroring is gone. The flat diagram is *the* diagram — complete,
 * labelled, and the default everywhere. 3D now has one job and one test to pass:
 *
 *   **Show a relation that cannot be drawn on a plane without losing it.**
 *
 * Five relations pass that test, and they are declared here. A surface over two
 * variables loses a dimension when flattened. A rotation is the shape of a cycle.
 * Two simultaneously-real worlds need an axis to be simultaneous along. Distance
 * travelled down an ordered corridor is how far a proposal got. A cliff is a
 * cliff. Everything else in this app — state graphs, timelines, checklists,
 * price scales — is *better* on a plane, and those scenes now offer no 3D at all
 * rather than a decorative one.
 *
 * This module is deliberately free of any three/fiber import so that scene
 * modules can name a motion and type its inputs without pulling the renderer
 * onto the critical path. ESLint enforces that: nothing under `src/scenes/`
 * except `src/scenes/r3f/` may import three.
 */

// ---------------------------------------------------------------------------
// Inputs, per motion
// ---------------------------------------------------------------------------

/** One scheduled phase, as a span of the 21 kernel ticks. */
export interface MotionArc {
  readonly name: string;
  readonly fromTick: number;
  readonly toTick: number;
}

export interface TurningClockProps {
  readonly epoch: number;
  readonly epochLength: number;
  readonly blockInEpoch: number;
  readonly arcs: readonly MotionArc[];
  /** Name of the phase the cursor is inside. */
  readonly activePhase: string;
  /** The decision-window accrual band, inside Trade. */
  readonly decideWindow: MotionArc;
  /** The dead man stops the clock: the ring holds still and the cursor waits. */
  readonly stopped: boolean;
}

export interface CostSurfaceProps {
  /** Which book, in plain words. */
  readonly label: string;
  /** LMSR liquidity, whole USDC. */
  readonly b: number;
  /**
   * The book's quoted price, and the only state variable the surface needs.
   *
   * Not an omission that `q` is absent — a result. Rescale the cost function by
   * `b` and the landscape around a book is fixed by its current price alone, so
   * the quote is a complete description of the shape. Passing `q` as well would
   * invite the two to disagree, which is exactly what happened in the first
   * build: the scene drew a surface at 50 % beside a readout saying 56 %,
   * because the simulation moves its quote and its inventory independently.
   */
  readonly spot: number;
}

export interface BothFuturesProps {
  /** Whole USDC escrowed in the proposal vault. */
  readonly escrowed: number;
  readonly acceptUnits: number;
  readonly rejectUnits: number;
  /** Which branch was realized, once one was. */
  readonly resolved: 'Accept' | 'Reject' | null;
  /** Voided: both branches redeem at par, nobody wins. */
  readonly voided: boolean;
  /** PB-LEDGER-FREEZE: movement stops, holdings stay. */
  readonly frozen: boolean;
}

export type CorridorVerdict = 'pass' | 'skip' | 'extend' | 'reject' | 'not-reached';

export interface CorridorStep {
  readonly n: number;
  readonly name: string;
  readonly verdict: CorridorVerdict;
}

export interface CorridorProps {
  readonly steps: readonly CorridorStep[];
  /** 1-based index of the gate that stopped it, or null if it ran clean. */
  readonly haltedAt: number | null;
  readonly outcome: 'Adopt' | 'Extend' | 'Reject' | 'pending';
}

export interface CliffProps {
  /** Survival pillar, [0,1]. */
  readonly s: number;
  /** Capability pillar, [0,1]. */
  readonly c: number;
  /** The P·A composite: the height of the plateau both gates multiply. */
  readonly plateau: number;
  /** W as the engine computed it. Drawn as a marker, not as the surface. */
  readonly w: number;
  /** [θ⁻, θ⁺] for the Survival gate. */
  readonly thetaS: readonly [number, number];
  /** [θ⁻, θ⁺] for the Capability gate. */
  readonly thetaC: readonly [number, number];
}

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

export type MotionSpec =
  | { readonly kind: 'turning-clock'; readonly props: TurningClockProps }
  | { readonly kind: 'cost-surface'; readonly props: CostSurfaceProps }
  | { readonly kind: 'both-futures'; readonly props: BothFuturesProps }
  | { readonly kind: 'corridor'; readonly props: CorridorProps }
  | { readonly kind: 'cliff'; readonly props: CliffProps };

export type MotionKind = MotionSpec['kind'];

export interface MotionMeta {
  /** The tab label. Names what you get to see, never the technology. */
  readonly label: string;
  /**
   * The claim this motion has to earn: what a plane cannot show. Printed under
   * the stage, so the reason is on screen and not just in this comment.
   */
  readonly adds: string;
}

/**
 * The numbers a motion is showing, as text.
 *
 * Deliberately computed here and rendered as ordinary DOM beside the canvas
 * rather than as in-scene labels. Three reasons, in order of weight: a moving
 * picture is a terrible place to read a quantity off; a screen reader can reach
 * DOM and cannot reach geometry; and a pure function of the motion's props is
 * testable without a GPU, so the numbers on screen are covered by the same suite
 * as everything else.
 */
export interface MotionReadout {
  readonly title: string;
  readonly lines: readonly string[];
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function motionReadout(spec: MotionSpec): MotionReadout {
  switch (spec.kind) {
    case 'turning-clock': {
      const p = spec.props;
      return {
        title: `Epoch ${p.epoch.toLocaleString()} · ${p.activePhase}`,
        lines: [
          `block ${Math.round(p.blockInEpoch).toLocaleString()} of ${p.epochLength.toLocaleString()}`,
          p.stopped
            ? 'dead man engaged — the clock is held'
            : 'two earlier epochs are still being measured',
        ],
      };
    }
    case 'cost-surface': {
      const p = spec.props;
      return {
        title: p.label,
        lines: [
          `quoted ${pct(p.spot)} · liquidity b = ${p.b.toLocaleString()} USDC`,
          'height is what a trade costs · the slope is the price',
        ],
      };
    }
    case 'both-futures': {
      const p = spec.props;
      return {
        title: `${p.escrowed.toLocaleString()} USDC escrowed`,
        lines: [
          `${p.acceptUnits.toLocaleString()} pass-claims · ${p.rejectUnits.toLocaleString()} reject-claims`,
          p.frozen
            ? 'ledger frozen — holdings kept, movement stopped'
            : p.voided
              ? 'voided — both branches redeem at par'
              : p.resolved === null
                ? 'both futures are outstanding at once'
                : `${p.resolved} realized — the other branch is frozen, not burned`,
        ],
      };
    }
    case 'corridor': {
      const p = spec.props;
      const halted = p.haltedAt !== null ? p.steps[p.haltedAt - 1] : undefined;
      return {
        title:
          p.outcome === 'pending'
            ? 'The decision has not run yet'
            : halted !== undefined
              ? `Stopped at check ${halted.n} — ${halted.name}`
              : `All eleven cleared — ${p.outcome}`,
        lines: [
          p.haltedAt === null
            ? `${p.steps.filter((s) => s.verdict === 'pass').length} passed · ${p.steps.filter((s) => s.verdict === 'skip').length} not applicable`
            : `reached check ${p.haltedAt} of ${p.steps.length}`,
          p.haltedAt === null
            ? 'every check is evaluated, in this order'
            : 'the checks behind it were never evaluated',
        ],
      };
    }
    case 'cliff': {
      const p = spec.props;
      return {
        title: `W = ${p.w.toFixed(3)}`,
        lines: [
          `Survival ${p.s.toFixed(3)} (floor ${p.thetaS[0].toFixed(2)}) · Capability ${p.c.toFixed(3)} (floor ${p.thetaC[0].toFixed(2)})`,
          p.w <= 0
            ? 'a closed gate zeroes the product — nothing buys it back'
            : `plateau ${p.plateau.toFixed(3)}, set by the other two pillars`,
        ],
      };
    }
  }
}

export const MOTION_META: Record<MotionKind, MotionMeta> = {
  'turning-clock': {
    label: 'Turning clock',
    adds: 'The epoch is a cycle, not a bar. Here it turns, and the epochs behind it are the ones still being measured — three cohorts are always in flight at once.',
  },
  'cost-surface': {
    label: 'Cost surface',
    adds: 'The price of a trade depends on two quantities at once, so the cost is a landscape. Height is what a trade costs; the slope you are standing on is the price; the colour is who the market currently favours.',
  },
  'both-futures': {
    label: 'Both futures',
    adds: 'One deposit becomes a claim in two futures that are real at the same time. Side by side that reads as a choice between them; stacked on one axis it reads as what it is — both, at once, until one is realized.',
  },
  corridor: {
    label: 'The corridor',
    adds: 'Eleven checks in a fixed order, drawn as a distance. How far the proposal travelled before something stopped it is the thing you see first.',
  },
  cliff: {
    label: 'The cliff',
    adds: 'The score is a product of two gates, so the safe region is a plateau with a sheer drop on two sides. A weak pillar does not lower the score a little — it walks off an edge.',
  },
};
