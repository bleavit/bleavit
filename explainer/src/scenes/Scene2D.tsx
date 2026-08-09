import type { SceneModel, SceneNode, SceneRule, Tone } from './model';
import { STAGE_HEIGHT, STAGE_WIDTH } from './model';
import { layoutLabels, staggerTicks } from './labels';
import './scene.css';

/**
 * The 2D renderer. It consumes the same `SceneModel` as the R3F renderer and
 * applies the elevation projection — the canonical orthographic view — so the
 * fallback is the same drawing rather than a separate design.
 *
 * It is not a lesser experience: it carries every node, every rule, every label
 * and every tick. What it drops is depth, which is exactly the channel that
 * carries no protocol fact.
 *
 * Two things changed after the first round of user testing, and both were real
 * defects rather than taste:
 *
 *  - **Labels are placed, not offset.** A fixed offset under each node printed
 *    neighbouring labels on top of one another. `layoutLabels` deals them into
 *    bands and drops what will not fit.
 *  - **Marks are filled, not outlined.** An unfilled outline in a mid-grey on a
 *    mid-grey field is invisible at a glance, which is how a diagram ends up
 *    "not understandable". Every mark now carries a tinted fill of its own tone.
 */

/* Left/right headroom. It has to clear a y-axis tick label pushed into the
   second lane, or the stagger fixes an overlap by pushing the value outside the
   frame instead — which is the same information loss wearing a different hat. */
const PAD_X = 1.3;
const PAD_TOP = 0.8;
/* Room under the drawing for three full bands of labels. It has to clear
   `label + 2 * band` at the largest scale below, or a label dealt into the
   bottom band is drawn outside the viewBox and silently disappears. */
const PAD_BOTTOM = 2.6;

const MAX_BANDS = 3;

/**
 * Label type sizes, in stage units, by how much room the stage has.
 *
 * These live here rather than in CSS, and that is the point. The placement pass
 * decides what collides by estimating each label's width from its font size, so
 * if a stylesheet scales the type at a breakpoint the pass is measuring one
 * drawing and the browser is painting another — labels laid out at 0.46 and
 * rendered at 0.62 overlap by a third of their width, on exactly the narrow
 * screens where there is least room to absorb it. One value, read by both.
 *
 * The sizes still grow as the stage shrinks: below roughly 11 device pixels a
 * label is unreadable, so a narrow stage needs *bigger* stage-unit type, and the
 * placement pass simply deals more of it into lower bands or drops it.
 */
interface LabelScale {
  label: number;
  sub: number;
  band: number;
  tick: number;
  /** Secondary tiers go first when there is no room for everything. */
  showSub: boolean;
  showEdge: boolean;
}

function labelScale(viewportWidth: number): LabelScale {
  /* `band` is the baseline-to-baseline step, and it must stay above the line
     height the placement pass enforces (1.05x the larger font) or consecutive
     bands overlap and the pass loses two thirds of its capacity. */
  if (viewportWidth <= 767) {
    return { label: 0.7, sub: 0.56, band: 0.88, tick: 0.44, showSub: false, showEdge: false };
  }
  if (viewportWidth <= 1023) {
    return { label: 0.56, sub: 0.44, band: 0.7, tick: 0.38, showSub: false, showEdge: false };
  }
  return { label: 0.46, sub: 0.36, band: 0.58, tick: 0.34, showSub: true, showEdge: true };
}

/**
 * Tone to colour.
 *
 * `ink` resolves to the **scene accent**, not to the text colour. The original
 * rule sent it to ink so the Baseline book would read as achromatic — belonging
 * to neither branch — and the cost was a stage where nine marks in ten were the
 * same neutral as the page behind them. The rule it was protecting still holds:
 * the accent is neither the ACCEPT hue nor the REJECT hue, so a Baseline drawn
 * in it still cannot be mistaken for a branch instrument. `dim` stays grey,
 * because "not active yet" genuinely is the absence of a colour.
 */
const toneVar = (t: Tone | undefined): string => {
  switch (t) {
    case 'accept':
      return 'var(--accept)';
    case 'reject':
      return 'var(--reject)';
    case 'alarm':
      return 'var(--alarm)';
    case 'dim':
      return 'var(--ink-3)';
    default:
      return 'var(--accent)';
  }
};

/** Stage y grows upward; SVG y grows downward. */
const flip = (y: number, h = 0): number => STAGE_HEIGHT - y - h;

function Defs() {
  return (
    <defs>
      <pattern
        id="scene-hatch"
        width="0.5"
        height="0.5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="0.5" stroke="var(--ink-3)" strokeWidth="0.1" />
      </pattern>
      <marker
        id="scene-arrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="4"
        markerHeight="4"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
      </marker>
    </defs>
  );
}

function Rule({ rule, tickSize }: { rule: SceneRule; tickSize: number }) {
  const stroke = toneVar(rule.tone);
  const isX = rule.axis === 'x';
  /* Ticks sit where the scale puts them, so when two are too close the only
     thing that can move is which lane the printed value goes in. */
  const ticks = rule.ticks ?? [];
  const lanes = staggerTicks(
    ticks.map((t) => t.at),
    isX ? tickSize * 3.2 : tickSize * 1.15,
  );
  /* The lane offset is derived from the widest value on this rule, not picked:
     it only has to exceed that width for two lanes to stop overlapping, and any
     more than that is frame width spent for nothing. */
  const widest = ticks.reduce((w, t) => Math.max(w, t.label.length), 0);
  const laneStep = widest * 0.56 * tickSize + 0.25;
  const x1 = isX ? rule.from : rule.at;
  const x2 = isX ? rule.to : rule.at;
  const y1 = isX ? flip(rule.at) : flip(rule.from);
  const y2 = isX ? flip(rule.at) : flip(rule.to);
  return (
    <g className="scene__rule">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={0.05}
        strokeDasharray={rule.dashed === true ? '0.3 0.2' : undefined}
      />
      {rule.ticks?.map((t, i) => {
        const tx = isX ? t.at : rule.at;
        const ty = isX ? flip(rule.at) : flip(t.at);
        const lane = lanes[i] ?? 0;
        return (
          <g key={`${rule.id}-${t.at}`}>
            <line
              x1={tx}
              y1={ty}
              x2={isX ? tx : tx - 0.18}
              y2={isX ? ty + 0.18 : ty}
              stroke={stroke}
              strokeWidth={0.05}
            />
            <text
              x={isX ? tx : tx - 0.3 - lane * laneStep}
              y={isX ? ty + 0.62 + lane * (tickSize * 1.3) : ty + 0.12}
              fontSize={tickSize}
              className="scene__tick"
              textAnchor={isX ? 'middle' : 'end'}
            >
              {t.label}
            </text>
          </g>
        );
      })}
      {rule.label !== undefined ? (
        <text
          x={isX ? rule.to + 0.2 : rule.at}
          y={isX ? flip(rule.at) + 0.12 : flip(rule.to) - 0.25}
          className="scene__axislabel"
          textAnchor={isX ? 'start' : 'middle'}
        >
          {rule.label}
        </text>
      ) : null}
    </g>
  );
}

function Node({
  node,
  byId,
  showEdgeLabels,
}: {
  node: SceneNode;
  byId: Map<string, SceneNode>;
  showEdgeLabels: boolean;
}) {
  const stroke = toneVar(node.tone);
  const frozen = node.state === 'frozen';
  const blocked = node.state === 'blocked';
  const inactive = node.state === 'inactive' || node.state === 'pending';
  const opacity = frozen ? 0.45 : inactive ? 0.5 : 1;

  if (node.kind === 'edge') {
    const a = node.from !== undefined ? byId.get(node.from) : undefined;
    const b = node.to !== undefined ? byId.get(node.to) : undefined;
    if (!a || !b) return null;
    const ax = a.x + a.w / 2;
    const ay = flip(a.y + a.h / 2);
    const bx = b.x + b.w / 2;
    const by = flip(b.y + b.h / 2);
    // Right-angle routing: an orthogonal graph reads as a diagram, not a web.
    const midY = (ay + by) / 2;
    return (
      <g className={`scene__node scene__node--${node.state ?? 'active'}`} opacity={opacity}>
        <path
          d={`M${ax} ${ay} L${ax} ${midY} L${bx} ${midY} L${bx} ${by}`}
          fill="none"
          stroke={stroke}
          strokeWidth={0.055 * (node.emphasis ?? 1)}
          markerEnd="url(#scene-arrow)"
        />
        {node.label !== undefined && showEdgeLabels ? (
          <text
            x={(ax + bx) / 2}
            y={midY - 0.18}
            className="scene__edgelabel"
            textAnchor="middle"
          >
            {node.label}
          </text>
        ) : null}
      </g>
    );
  }

  const x = node.x;
  const y = flip(node.y, node.h);
  const common = { stroke, strokeWidth: 0.07, opacity };
  /* A tinted fill is what makes a mark legible at a glance. Outline-only was
     the single biggest reason the first drawings read as empty boxes. */
  const wash = node.state === 'passed' ? 0.3 : blocked ? 0.1 : 0.18;

  return (
    <g className={`scene__node scene__node--${node.state ?? 'active'}`}>
      {node.kind === 'plate' ? (
        <>
          {/* The plate is the scale; the fill is the reading. */}
          <rect
            x={x}
            y={y}
            width={node.w}
            height={node.h}
            fill={stroke}
            fillOpacity={0.08}
            {...common}
          />
          {node.fill !== undefined ? (
            <>
              <rect
                x={x}
                y={y + node.h * (1 - node.fill)}
                width={node.w}
                height={node.h * node.fill}
                fill={stroke}
                opacity={frozen ? 0.18 : 0.34}
              />
              <line
                x1={x}
                y1={y + node.h * (1 - node.fill)}
                x2={x + node.w}
                y2={y + node.h * (1 - node.fill)}
                stroke={stroke}
                strokeWidth={0.12}
              />
            </>
          ) : null}
        </>
      ) : node.kind === 'chip' ? (
        <ellipse
          cx={x + node.w / 2}
          cy={y + node.h / 2}
          rx={node.w / 2}
          ry={node.h / 2}
          fill={node.hatched === true ? 'url(#scene-hatch)' : stroke}
          fillOpacity={node.hatched === true ? 1 : wash}
          {...common}
        />
      ) : node.kind === 'ceiling' ? (
        <>
          <line x1={x} y1={y} x2={x + node.w} y2={y} stroke={stroke} strokeWidth={0.14} />
          <rect
            x={x}
            y={y}
            width={node.w}
            height={0.32}
            fill="url(#scene-hatch)"
            opacity={0.75}
          />
        </>
      ) : node.kind === 'tie' ? (
        <line
          x1={x}
          y1={y + node.h / 2}
          x2={x + node.w}
          y2={y + node.h / 2}
          stroke={stroke}
          strokeWidth={0.16}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={node.w}
          height={node.h}
          fill={node.hatched === true ? 'url(#scene-hatch)' : stroke}
          fillOpacity={node.hatched === true ? 1 : wash}
          strokeDasharray={blocked ? '0.25 0.15' : undefined}
          {...common}
        />
      )}

      {/* Class notches: countable, so class is never encoded by colour alone. */}
      {node.notches !== undefined
        ? Array.from({ length: node.notches }, (_, i) => (
            <line
              key={i}
              x1={x + 0.2 + i * 0.22}
              y1={y}
              x2={x + 0.2 + i * 0.22}
              y2={y + 0.18}
              stroke={stroke}
              strokeWidth={0.07}
            />
          ))
        : null}
    </g>
  );
}

export function Scene2D({ model }: { model: SceneModel }) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  // Edges first so nodes sit on top of their connectors.
  const edges = model.nodes.filter((n) => n.kind === 'edge');
  const solids = model.nodes.filter((n) => n.kind !== 'edge');

  const scale = labelScale(
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const labelled = scale.showSub
    ? solids
    : solids.map((n) => ({ ...n, sublabel: undefined }));

  const labels = layoutLabels(labelled, {
    flip,
    fontSize: scale.label,
    subFontSize: scale.sub,
    maxBands: MAX_BANDS,
    firstBand: scale.label,
    bandStep: scale.band,
  });

  return (
    <svg
      className="scene2d"
      viewBox={`${-PAD_X} ${-PAD_TOP} ${STAGE_WIDTH + PAD_X * 2} ${
        STAGE_HEIGHT + PAD_TOP + PAD_BOTTOM
      }`}
      role="img"
      aria-label={
        model.relation === ''
          ? 'Scene diagram'
          : `Diagram. ${model.relation} The complete data is in the panel beside it.`
      }
      preserveAspectRatio="xMidYMid meet"
    >
      <Defs />
      {/* Stage floor: heavier every 3 — the 3/21 rhythm. Deliberately faint;
          in the first version the grid competed with the drawing on top of it. */}
      <g className="scene__grid">
        {Array.from({ length: STAGE_WIDTH / 3 + 1 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * 3}
            y1={0}
            x2={i * 3}
            y2={STAGE_HEIGHT}
            stroke="var(--ink-3)"
            strokeWidth={0.02}
            opacity={0.3}
          />
        ))}
        {Array.from({ length: STAGE_HEIGHT / 3 + 1 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * 3}
            x2={STAGE_WIDTH}
            y2={i * 3}
            stroke="var(--ink-3)"
            strokeWidth={0.02}
            opacity={0.3}
          />
        ))}
      </g>
      {model.rules.map((r) => (
        <Rule key={r.id} rule={r} tickSize={scale.tick} />
      ))}
      {edges.map((n) => (
        <Node key={n.id} node={n} byId={byId} showEdgeLabels={scale.showEdge} />
      ))}
      {solids.map((n) => (
        <Node key={n.id} node={n} byId={byId} showEdgeLabels={scale.showEdge} />
      ))}

      {/* Labels last and in their own layer: they must never be occluded by a
          mark, and the placement pass has already guaranteed they do not
          occlude each other. */}
      <g className="scene__labels">
        {labels.placed.map((l) => (
          <text
            key={l.id}
            x={l.x}
            y={l.anchorY + scale.label + l.band * scale.band}
            fontSize={l.primary ? scale.label : scale.sub}
            className={l.primary ? 'scene__label' : 'scene__sublabel'}
            textAnchor="middle"
          >
            {l.text}
          </text>
        ))}
      </g>
    </svg>
  );
}
