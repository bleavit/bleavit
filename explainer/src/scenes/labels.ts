import type { SceneNode } from './model';

/**
 * Label placement for the 2D renderer.
 *
 * The first version drew every label at a fixed offset under its node, which is
 * correct exactly when no two nodes are near each other. In the lifecycle graph
 * they are, and the result was `Failed` and `Executed` printed on top of one
 * another — a diagram that reads as a typo.
 *
 * The fix is a placement pass rather than a per-scene hand-tuning exercise: each
 * label gets a measured box, and boxes are dealt into horizontal bands under the
 * drawing until one fits. A label that fits in no band is **dropped**, never
 * shrunk and never overlapped, because the rail carries every fact anyway and an
 * unreadable label is worse than an absent one.
 *
 * Widths are estimated rather than measured. Measuring would mean a DOM round
 * trip per label per render, and the estimate only has to be good enough to
 * decide overlap: Archivo's average advance over mixed-case latin is close to
 * 0.53 em, and the constant here is deliberately a little generous so the pass
 * errs towards spreading labels out.
 */

/** Advance width of one character, as a fraction of the font size. */
const AVG_ADVANCE = 0.56;

/** Gap that must remain between two label boxes in the same band. */
const MIN_GAP = 0.25;

export interface PlacedLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  /** Bottom edge of the owning node, in SVG y. */
  readonly anchorY: number;
  /** Band index: 0 sits closest to the node, each further band is one line down. */
  readonly band: number;
  readonly primary: boolean;
}

export interface LabelLayout {
  readonly placed: readonly PlacedLabel[];
  /** Labels that could not be placed without collision. Counted, never drawn. */
  readonly dropped: number;
}

interface Candidate {
  id: string;
  text: string;
  /** Centre of the node the label belongs to, in stage x. */
  cx: number;
  /** Bottom of the node, in SVG y (already flipped). */
  anchorY: number;
  halfWidth: number;
  primary: boolean;
  /** Ties a sublabel to its label so they never land in swapped bands. */
  order: number;
}

/**
 * Stagger a run of axis-tick labels so none of them overlaps its neighbour.
 *
 * Ticks are placed by the scale, not by this module — their positions *are* the
 * data — so the only free variable is which lane the printed value sits in. A
 * market's price axis ticks 0.00, 0.02, 0.50, 0.98 and 1.00: the two pairs at
 * the ends are two hundredths apart and their labels printed straight through
 * each other, which a sweep of the running app caught in both themes.
 *
 * Staggering rather than dropping is deliberate. Every one of those five values
 * means something — 0.02 and 0.98 are the sanity band, and a scale that prints
 * only its endpoints has stopped being a scale. Returning a lane index lets the
 * renderer step the crowded ones sideways and keep all five.
 *
 * @param positions tick positions along the axis, in stage units, in draw order
 * @param minGap    how close two labels may be before they touch
 * @param lanes     how many lanes are available
 * @returns lane index per tick, parallel to `positions`
 */
export function staggerTicks(
  positions: readonly number[],
  minGap: number,
  lanes = 2,
): number[] {
  const lastAt: number[] = new Array<number>(lanes).fill(Number.NEGATIVE_INFINITY);
  return positions.map((p) => {
    for (let lane = 0; lane < lanes; lane++) {
      if (Math.abs(p - (lastAt[lane] ?? Number.NEGATIVE_INFINITY)) >= minGap) {
        lastAt[lane] = p;
        return lane;
      }
    }
    // Every lane is crowded: take the one whose last label is furthest away, so
    // the unavoidable tightness is spread rather than piled onto lane 0.
    let best = 0;
    for (let lane = 1; lane < lanes; lane++) {
      if (Math.abs(p - (lastAt[lane] ?? 0)) > Math.abs(p - (lastAt[best] ?? 0))) best = lane;
    }
    lastAt[best] = p;
    return best;
  });
}

/**
 * Deal labels into bands.
 *
 * Order matters and is deliberate: primary labels are placed before sublabels,
 * and within a tier, left to right. So when the drawing is too dense the thing
 * that gets dropped is a secondary label on the right, not a primary one in the
 * middle — a stable, predictable degradation rather than whichever label the
 * array order happened to put last.
 */
export function layoutLabels(
  nodes: readonly SceneNode[],
  opts: {
    flip: (y: number, h?: number) => number;
    fontSize: number;
    subFontSize: number;
    maxBands: number;
    /** Distance from a node's bottom edge to its first band's baseline. */
    firstBand: number;
    /** Distance between consecutive bands. */
    bandStep: number;
  },
): LabelLayout {
  const { flip, fontSize, subFontSize, maxBands, firstBand, bandStep } = opts;

  const candidates: Candidate[] = [];
  nodes.forEach((n, i) => {
    if (n.kind === 'edge') return;
    const cx = n.x + n.w / 2;
    const anchorY = flip(n.y, n.h) + n.h;
    if (n.label !== undefined && n.label !== '') {
      candidates.push({
        id: n.id,
        text: n.label,
        cx,
        anchorY,
        halfWidth: (n.label.length * AVG_ADVANCE * fontSize) / 2,
        primary: true,
        order: i,
      });
    }
    if (n.sublabel !== undefined && n.sublabel !== '') {
      candidates.push({
        id: `${n.id}--sub`,
        text: n.sublabel,
        cx,
        anchorY,
        halfWidth: (n.sublabel.length * AVG_ADVANCE * subFontSize) / 2,
        primary: false,
        order: i,
      });
    }
  });

  candidates.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    if (a.cx !== b.cx) return a.cx - b.cx;
    return a.order - b.order;
  });

  /*
   * Occupancy is tracked in real page coordinates, not per anchor row.
   *
   * The first version kept an independent set of bands for each distinct node
   * bottom, on the reasoning that nodes at different heights cannot collide.
   * That is false, and a sweep of the running app found it: a ceiling node whose
   * bottom sits 0.4 units above a row of plates put its name on "band 0 of its
   * own row", which lands half a line-height from the plates' band 0 — and
   * `veto line` printed across `Security`. Two labels collide when their boxes
   * collide, and nothing about which node they belong to changes that.
   */
  interface Slot {
    lo: number;
    hi: number;
    y: number;
  }
  const occupied: Slot[] = [];
  const bandOf = new Map<string, number>();
  const placed: PlacedLabel[] = [];
  let dropped = 0;

  /* How close two baselines may be before their glyphs touch. Kept just under
     the caller's band step so consecutive bands are usable — a line height at
     or above the step makes every band collide with the one above it, and the
     pass silently loses a third of its capacity. */
  const lineHeight = Math.max(fontSize, subFontSize) * 1.05;

  for (const c of candidates) {
    const lo = c.cx - c.halfWidth - MIN_GAP / 2;
    const hi = c.cx + c.halfWidth + MIN_GAP / 2;
    // A sublabel starts one band below its own label rather than competing
    // with it, so the pair always reads top-to-bottom.
    const ownerBand = bandOf.get(c.id.replace(/--sub$/, ''));
    const startBand = c.primary ? 0 : (ownerBand ?? 0) + 1;

    let band = -1;
    for (let b = startBand; b < maxBands; b++) {
      const y = c.anchorY + firstBand + b * bandStep;
      const clash = occupied.some(
        (s) => Math.abs(s.y - y) < lineHeight && hi > s.lo && lo < s.hi,
      );
      if (!clash) {
        occupied.push({ lo, hi, y });
        band = b;
        break;
      }
    }

    if (band === -1) {
      dropped += 1;
      continue;
    }
    if (c.primary) bandOf.set(c.id, band);
    placed.push({
      id: c.id,
      text: c.text,
      x: c.cx,
      anchorY: c.anchorY,
      band,
      primary: c.primary,
    });
  }

  return { placed, dropped };
}
