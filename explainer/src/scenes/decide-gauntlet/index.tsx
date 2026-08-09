import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { CorridorVerdict, MotionSpec } from '../motion';
import type { NodeState, SceneModel, SceneNode, SceneRule, Tone } from '../model';
import type { SimState } from '../../sim/types';
import type { DecisionTrace, StepFact, StepVerdict } from '../../protocol/decide';
import { decide, describeOutcome } from '../../protocol/decide';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { DecisionOutcome, RejectReason } from '../../protocol/types';
import { PROPOSAL_CLASSES, REJECT_REASONS } from '../../protocol/types';
import { REJECT_REASON_META } from '../../protocol/lifecycle';
import { RERUN_HURDLE_BUMP, SECURITY_FACTOR } from '../../protocol/constants';
import { derived, spec, simulated } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './decide-gauntlet.css';

/**
 * The decision gauntlet — doc 05 §5.4's ordered eleven-step rule.
 *
 * The thing this scene has to teach is not *which* checks exist but that their
 * **order is normative**. `decide()` short-circuits over steps 1–5 and 9–11, so
 * the first refusal there is the outcome and everything after it is genuinely
 * unevaluated — which is why no welfare margin, however large, can buy past a
 * ruin veto: the comparison that would do it is never performed.
 *
 * Steps 6–8 are the documented exception (doc 05 §5.5, SQ-552). The rule
 * evaluates `full_pass`, `tail_pass` and `converged` and dispatches on the
 * *triple*, so a lone `✘` at step 6 determines nothing: 6 and 7 disagreeing
 * returns `Extend`, and step 8 failing too returns `ConvergenceFailed`.
 * `HurdleNotMet` is correct only when both hurdles fail *and* the series
 * converged. `decide.ts` implements the triple; the prose here must not
 * simplify it back into a short-circuit.
 *
 * The drawing is therefore a **numbered route**, read like text: steps 1 to 5 on
 * the top row, 6 to 11 on the bottom, both left to right. Two decisions there are
 * load-bearing rather than cosmetic:
 *
 *  - **The step number lives inside the station label.** Rules, ticks and
 *    sublabels are 2D-only; `node.label` is the one piece of text the 3D renderer
 *    also draws. Ordering is the whole point of this scene, so it has to survive
 *    in both renderers, and only the label does.
 *  - **The rows are the lesson.** The top row settles safety and validity; a
 *    proposal reaches the row where its value is weighed only by clearing all
 *    five of them. The two ruin gates stand taller than their neighbours — the
 *    one place height is spent — because they can only refuse.
 *
 * The earlier drawing hung those two gates over a corridor as beams. A beam is a
 * good metaphor once explained, and this scene's job is to need no explaining: a
 * taller stop with the word *veto* in its label, in a row captioned "safety
 * first", says the same thing without a legend.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const RULE_CITE: Citation = cite('05', '§5.4', 'the ordered eleven-step decision rule');
/** The reject-leg floor's own section — the formula lives in §5.3, not §5.4. */
const REFF_CITE: Citation = cite('05', '§5.3', 'r_eff = max(REJECT TWAP, Baseline TWAP − σ)');
const SIZING_CITE: Citation = cite('05', '§5.6', 'security sizing: 3 · InCapPrize ≤ AttackCost̂');
/** The rerun increment is a doc 05 rule (`DELTA[class] + ONE_PP`), not a doc 13 §2 row. */
const RERUN_CITE: Citation = cite('05', '§5.4', 'the rerun regime: δ + 1 pp');
const RATIFY_CITE: Citation = cite('00', 'D-5', 'the single ratification deadline is at execute');

/**
 * The step catalogue, read back out of the engine itself.
 *
 * `decide()` owns the names, the "guards against" sentences and the citations,
 * and this call exists only to read them, so they can never drift from the
 * implementation. **Every verdict and every fact from this probe run is
 * discarded** — it describes no proposal, and nothing about its outcome reaches
 * the screen.
 */
const STEP_SHELLS: readonly {
  readonly step: number;
  readonly name: string;
  readonly guards: string;
  readonly cite: Citation;
}[] = decide({ acceptFull: 0, rejectFullEffective: 0, delta: 0 }).steps.map((s) => ({
  step: s.step,
  name: s.name,
  guards: s.guards,
  cite: s.cite,
}));

/**
 * Canvas labels: the step number, then plain words. The rail carries the exact
 * names — `Gate-book validity` is what the specification calls step 3, and
 * `3 Risk books` is what a first-time reader can hold in their head while looking
 * at a picture. Numbers 3 and 5 are deliberately parallel ("risk books" are the
 * four gate books, "value books" the decision pair) because the two checks ask
 * the same question of different markets.
 */
const STATION_LABELS = [
  '1 Same bytes',
  '2 No holds',
  '3 Risk books',
  '4 Ruin veto',
  '5 Value books',
  '6 Value gain',
  '7 Last 24 h',
  '8 Settled',
  '9 Attack cost',
  '10 Sign-off',
  '11 Queued',
] as const;

/**
 * Which refusals are genuine *safety* states rather than ordinary answers.
 *
 * The classification is single-homed in `protocol/lifecycle.ts` and read back
 * here rather than restated, so the `alarm` tone this scene spends can never
 * drift from the tone the lifecycle scene spends on the same reason. It resolves
 * to exactly the two gate vetoes and a process hold (which includes an engaged
 * dead-man switch); every other refusal is an ordinary answer and stays ink.
 */
const isSafetyReason = (r: RejectReason): boolean =>
  REJECT_REASON_META[r].severity === 'safety';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Eleven stations on two rows, and the pitch is what fixes everything else.
 *
 * A label is drawn centred under its station, at roughly 0.24 stage units per
 * character, so two labels on one row stay legible only while
 * `|Δcentre| > (chars_a + chars_b) · 0.12 + 0.3`. Eleven stations strung across
 * the 21-unit stage would get 1.9 units each and every label would overprint its
 * neighbours; two rows of five and six at a 3.6-unit pitch clear the longest
 * neighbouring pair here (24 characters ⇒ 3.18 units) with 0.42 units to spare.
 * The scene's test asserts that inequality over every pair on every row rather
 * than trusting this comment.
 */
const PITCH = 3.6;
const ROW_A_X0 = 5.0;
const ROW_B_X0 = 1.9;
const ROW_A_Y = 8.3;
const ROW_B_Y = 3.9;
/** How many stations ride the top row: steps 1–5, the safety and validity block. */
const ROW_A_COUNT = 5;

const STATION_W = 1.5;
const STATION_H = 1.2;
/** The two ruin gates stand taller. Height is emphasis here, and never a quantity. */
const GATE_H = 1.9;

/** The proposal waits at the head of the top row, clear of station 1's labels. */
const SLAB_X = 0.8;
const SLAB_W = 1.4;
const SLAB_H = 1.7;

const stationCentre = (i: number): number =>
  i < ROW_A_COUNT ? ROW_A_X0 + PITCH * i : ROW_B_X0 + PITCH * (i - ROW_A_COUNT);
const stationY = (i: number): number => (i < ROW_A_COUNT ? ROW_A_Y : ROW_B_Y);
/** Steps 3 and 4 — the ruin gates. They can refuse; they are never outweighed. */
const isRuinGate = (i: number): boolean => i === 2 || i === 3;

/** `null` means the rule has not been run at all — not that a check passed. */
function stateFor(v: StepVerdict | null): NodeState {
  if (v === null) return 'inactive';
  switch (v.kind) {
    case 'pass':
      return 'passed';
    case 'reject':
      return 'blocked';
    case 'skip':
      return 'frozen';
    case 'extend':
      return 'active';
    case 'not-reached':
      return 'inactive';
  }
}

function toneFor(v: StepVerdict | null): Tone {
  if (v === null) return 'dim';
  if (v.kind === 'reject') return isSafetyReason(v.reason) ? 'alarm' : 'ink';
  if (v.kind === 'not-reached' || v.kind === 'skip') return 'dim';
  return 'ink';
}

/** Plain words under each station: a reader should not have to decode a glyph. */
const VERDICT_TOKEN: Readonly<Record<StepVerdict['kind'], string>> = {
  pass: 'passed',
  reject: 'stops here',
  skip: 'not needed',
  extend: '3 more days',
  'not-reached': 'not reached',
};
/** Before the windows seal, nothing ran at all — which is not the same as "not reached". */
const NOT_RUN_TOKEN = 'not run yet';

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export function buildModel(sim: SimState): SceneModel {
  const trace = sim.decision;
  const nodes: SceneNode[] = [];
  const verdictAt = (i: number): StepVerdict | null => trace?.steps[i]?.verdict ?? null;
  /** Did the run actually evaluate this step? Skipped still counts as reached. */
  const evaluated = (i: number): boolean => {
    const v = verdictAt(i);
    return v !== null && v.kind !== 'not-reached';
  };

  for (let i = 0; i < STEP_SHELLS.length; i++) {
    const n = i + 1;
    const verdict = verdictAt(i);
    nodes.push({
      id: `station-${n}`,
      domRowId: `decide-step-${n}`,
      kind: 'stop',
      x: stationCentre(i) - STATION_W / 2,
      y: stationY(i),
      w: STATION_W,
      h: isRuinGate(i) ? GATE_H : STATION_H,
      d: 1.1,
      tone: toneFor(verdict),
      state: stateFor(verdict),
      label: STATION_LABELS[i] ?? String(n),
      sublabel: verdict === null ? NOT_RUN_TOKEN : VERDICT_TOKEN[verdict.kind],
      hatched: verdict?.kind === 'skip',
    });
  }

  // The proposal itself. It exists on the route only once the rule has run:
  // before the decision windows seal there is nothing to place, and placing it
  // anyway would be a prediction. Where it *halted* is carried by the stations —
  // the one that refused is drawn blocked, and everything past it stays dim —
  // rather than by sliding this slab along the row, because a reader should not
  // have to measure a gap to learn which check produced the answer.
  if (trace !== null) {
    nodes.push({
      id: 'proposal',
      domRowId: 'decide-proposal',
      kind: 'slab',
      x: SLAB_X,
      y: ROW_A_Y,
      w: SLAB_W,
      h: SLAB_H,
      d: 1.1,
      tone: 'ink',
      state: trace.outcome.kind === 'Adopt' ? 'passed' : 'active',
      notches: PROPOSAL_CLASSES.indexOf(sim.proposal.cls) + 1,
      label: `#${sim.proposal.id}`,
      sublabel: sim.proposal.cls,
    });
    nodes.push({
      id: 'link-proposal-1',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'ink',
      state: 'active',
      from: 'proposal',
      to: 'station-1',
      emphasis: 0.9,
    });
  }

  // Connectors between consecutive stations of one row. They are the sequence,
  // drawn: a station whose connector is dim was never reached, so the route
  // visibly stops where the rule stopped. The row change (5 → 6) is deliberately
  // *not* connected — a line from the far right back to the far left would have
  // to leave station 5 straight through its own label.
  for (let i = 0; i + 1 < STEP_SHELLS.length; i++) {
    if (i === ROW_A_COUNT - 1) continue;
    const live = evaluated(i + 1);
    nodes.push({
      id: `link-${i + 1}-${i + 2}`,
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: live ? 'ink' : 'dim',
      state: live ? 'active' : 'inactive',
      from: `station-${i + 1}`,
      to: `station-${i + 2}`,
      emphasis: 0.9,
    });
  }

  // Row captions. Both are drawn as a short dashed rule with the caption running
  // off its right end, which is where the 2D renderer puts an axis label — the
  // rule segment itself sits in the empty band above each row.
  const rules: SceneRule[] = [
    {
      id: 'band-safety',
      axis: 'x',
      at: 10.9,
      from: 4.4,
      to: 8.2,
      tone: 'dim',
      dashed: true,
      label: 'steps 1–5: safety first — nothing later can outweigh these',
    },
    {
      id: 'band-value',
      axis: 'x',
      at: 6.0,
      from: 1.0,
      to: 8.2,
      tone: 'dim',
      dashed: true,
      label: 'steps 6–11: value and budget — only reached if all five passed',
    },
  ];

  return {
    nodes,
    rules,
    relation:
      'Order, drawn as a route. The eleven checks run in one fixed sequence — the top row ' +
      'left to right, then the bottom row — and the run halts at the first station that ' +
      'refuses, so every station past it stays dim and was never evaluated at all. Both ' +
      'ruin vetoes sit in the top row, before any station that reads how much the proposal ' +
      'is worth: that ordering is the reason a large enough margin cannot buy past them.',
    unitLegend:
      'Height is not a quantity here: the two taller stations are the ruin vetoes, which can only refuse.',
  };
}

// ---------------------------------------------------------------------------
// Rail helpers
// ---------------------------------------------------------------------------

interface StepRow {
  readonly step: number;
  readonly name: string;
  readonly guards: string;
  readonly cite: Citation;
  /** `null` means the rule has not been run at all — not that a check passed. */
  readonly verdict: StepVerdict | null;
  readonly facts: readonly StepFact[];
}

function stepRows(trace: DecisionTrace | null): readonly StepRow[] {
  if (trace === null) {
    return STEP_SHELLS.map((s) => ({ ...s, verdict: null, facts: [] }));
  }
  return trace.steps.map((s) => ({
    step: s.step,
    name: s.name,
    guards: s.guards,
    cite: s.cite,
    verdict: s.verdict,
    // A step the run never reached publishes no comparisons here, even where the
    // engine happened to carry some: an unevaluated check must never be able to
    // look like a satisfied one.
    facts: s.verdict.kind === 'not-reached' ? [] : s.facts,
  }));
}

const f4 = (v: number): string => v.toFixed(4);
const usd = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

function VerdictChip({ verdict }: { verdict: StepVerdict | null }) {
  if (verdict === null) return <span className="chip">not evaluated</span>;
  switch (verdict.kind) {
    case 'pass':
      return <span className="chip chip--state">pass</span>;
    case 'extend':
      return <span className="chip chip--state">extend</span>;
    case 'skip':
      return <span className="chip">not applicable</span>;
    case 'not-reached':
      return <span className="chip">not reached</span>;
    case 'reject':
      return (
        <span
          className={`chip gauntlet-chip-reason ${
            isSafetyReason(verdict.reason) ? 'chip--safety' : 'chip--state'
          }`}
        >
          reject · {verdict.reason}
        </span>
      );
  }
}

/**
 * The plain-language gloss for an outcome. Adopt and Reject are written to the
 * same register on purpose: `Reject(HurdleNotMet)` is the ordinary answer of a
 * market that looked and found no improvement, and reads as information.
 */
const REJECT_GLOSS: Partial<Record<RejectReason, string>> = {
  ConstitutionViolation:
    'The committed preimage is absent or no longer hashes to what was traded, so the bytes about to be enacted are not the bytes the market priced.',
  ResourceConflict:
    'A resource lock that was held at qualification has since been lost, so another mandate now owns something this payload would touch.',
  ProcessHold:
    'A merit-bonded dispute, a guardian hold or an engaged dead-man switch was open. The rule refuses to decide through it, and the proposal ends here rather than being decided under a fact still in contest.',
  NotDecisionGrade:
    'The books were not informative enough to decide on — too thin, too stale, or too poorly covered across the window.',
  GateVetoSurvival:
    'The Survival gate books price the chance that the S floor is breached on at least one day in the two epochs after the decision. Conditional on ADOPT that price was either above the absolute ruin cap p_max, or more than ε above the price conditional on REJECT — either test alone is a veto, and nothing later in the rule is allowed to outweigh it.',
  GateVetoSecurity:
    'The Security gate books price the chance that the C floor is breached on at least one day in the two epochs after the decision. Conditional on ADOPT that price was either above the absolute ruin cap p_max, or more than ε above the price conditional on REJECT — either test alone is a veto, and nothing later in the rule is allowed to outweigh it.',
  HurdleNotMet:
    'ADOPT did not beat the effective REJECT floor by the class margin δ. This is the ordinary answer of a market that looked and did not find an improvement, and it is the most common healthy path in the system.',
  ConvergenceFailed:
    'A decision book closed with its spot price further from the window average than Δ_max — both books are tested — so that average is not a fair summary of where the market actually ended.',
  SecondExtensionFailed:
    'The window and its own trailing tail disagreed while the proposal’s one extension had already been spent. That budget is one extension per proposal across all causes, so a disagreement after it is gone rejects rather than buying more time: the rule never produces a noisy PASS.',
  SecuritySizing:
    'Capturing this decision would not cost at least three times what capturing it pays. The prize is too large for the depth that actually showed up.',
  AttestationMissing:
    'The bonded attestation quorum a CODE or META artifact requires was absent or below quorum.',
  RateLimited:
    'The class capability or rate meter had no headroom left, or the required spacing between enactments was not met.',
};

/**
 * The refusals this rule can produce, in doc 02's frozen variant order.
 *
 * Derived from the gloss table rather than listed a second time, so a reason that
 * gains or loses a gloss cannot silently fall out of the drawer that enumerates
 * them.
 */
const RULE_REJECTIONS: readonly RejectReason[] = REJECT_REASONS.filter(
  (r) => REJECT_GLOSS[r] !== undefined,
);

function outcomeGloss(o: DecisionOutcome): string {
  switch (o.kind) {
    case 'Adopt':
      return 'The mandate is queued into its class timelock. Nothing has been enacted: a queued mandate is a permission to try, and its preconditions are re-read in full at execute time.';
    case 'Extend':
      return 'Three more days of trading, once. This is the single shared extension budget a proposal gets across all causes, and it has now been spent.';
    case 'Reject':
      return (
        REJECT_GLOSS[o.reason] ??
        'The rule refused at this step and reports the reason verbatim; the proposal did not enter the timelock.'
      );
  }
}

/** The one-line "what does this outcome mean" note carried under the key fact. */
function outcomeNote(trace: DecisionTrace | null): string {
  if (trace === null) return 'the trading windows have not sealed, so the rule has not run';
  switch (trace.outcome.kind) {
    case 'Adopt':
      return 'queued into its class timelock — nothing is enacted yet';
    case 'Extend':
      return 'three more days of trading, and the only extension it gets';
    case 'Reject':
      return `reason code ${trace.outcome.reason}`;
  }
}

// ---------------------------------------------------------------------------
// Rail: the headline
// ---------------------------------------------------------------------------

function Headline({ sim }: { sim: SimState }) {
  const trace = sim.decision;
  const stopped = trace === null ? null : (STEP_SHELLS[trace.stoppedAt - 1] ?? null);
  const adopted = trace !== null && trace.outcome.kind === 'Adopt';
  const d = trace?.diagnostics ?? null;
  // Both halves of the margin or neither: a fact that reports an uplift without
  // the hurdle it was tested against is worse than one that says "not measured".
  const margin =
    d === null || d.uplift === null || d.hurdle === null
      ? null
      : { uplift: d.uplift, hurdle: d.hurdle };

  return (
    <KeyFacts>
      <KeyFact label="Outcome" note={outcomeNote(trace)}>
        {trace === null ? 'Not yet run' : trace.outcome.kind}
      </KeyFact>

      <KeyFact
        label="Stopped at"
        note={
          trace === null
            ? 'no check has been evaluated'
            : adopted
              ? 'the mandate cleared every check'
              : (stopped?.name ?? 'the ordered rule')
        }
      >
        {trace === null ? (
          '—'
        ) : adopted ? (
          <>
            all <Value of={spec(STEP_SHELLS.length, RULE_CITE)} /> cleared
          </>
        ) : (
          <>
            step <Value of={derived(trace.stoppedAt, RULE_CITE)} /> of{' '}
            <Value of={spec(STEP_SHELLS.length, RULE_CITE)} />
          </>
        )}
      </KeyFact>

      <KeyFact
        label="Value margin"
        note={
          margin === null
            ? 'the run stopped before the value checks, so no uplift exists to report'
            : 'what the market says the change is worth, against the margin it had to clear'
        }
      >
        {margin === null ? (
          'not measured'
        ) : (
          <>
            <Value of={derived(margin.uplift, RULE_CITE)} format={f4} /> vs δ{' '}
            <Value of={derived(margin.hurdle, RULE_CITE)} format={f4} />
          </>
        )}
      </KeyFact>
    </KeyFacts>
  );
}

// ---------------------------------------------------------------------------
// Rail: the checklist (the one panel that stays open)
// ---------------------------------------------------------------------------

function ChecklistPanel({ sim }: { sim: SimState }) {
  const trace = sim.decision;
  const rows = stepRows(trace);

  return (
    <section className="panel">
      <h2 className="panel__title">The eleven checks, in order</h2>

      {trace === null ? (
        <>
          <p className="gauntlet-outcome">Not yet evaluable</p>
          <p>
            The decision windows have not sealed, so <span className="mono">decide()</span> has
            not run and <span className="mono">decision_stats()</span> would return nothing. No
            projected PASS or REJECT is shown here, and no uplift is projected: until the
            72-hour window and its trailing 24 hours are closed there is no average to compare,
            only a live price that any late trade can still move.
          </p>
        </>
      ) : (
        <>
          <p className="gauntlet-outcome">{describeOutcome(trace.outcome)}</p>
          <p className="gauntlet-chiprow">
            <VerdictChip
              verdict={
                trace.outcome.kind === 'Reject'
                  ? { kind: 'reject', reason: trace.outcome.reason }
                  : trace.outcome.kind === 'Extend'
                    ? { kind: 'extend' }
                    : { kind: 'pass' }
              }
            />
            <span className="chip chip--state">
              stopped at step <Value of={derived(trace.stoppedAt, RULE_CITE)} />
            </span>
          </p>
          <p>{outcomeGloss(trace.outcome)}</p>
        </>
      )}

      <table className="gauntlet-table">
        <caption className="sr-only">
          The eleven decision steps, what each one guards against, and its verdict
        </caption>
        <thead>
          <tr>
            <th scope="col" className="numeric">
              #
            </th>
            <th scope="col">Check</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.step} id={`decide-step-${r.step}`}>
              <th scope="row" className="numeric">
                <Value of={spec(r.step, r.cite)} />
              </th>
              <td>
                <span className="gauntlet-check">{r.name}</span>
                <span className="gauntlet-shortname">
                  on the diagram: {STATION_LABELS[i] ?? String(r.step)}
                </span>
                <span className="gauntlet-check__guards">{r.guards}</span>
              </td>
              <td>
                <VerdictChip verdict={r.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="panel__note">
        Read it top to bottom. The run halts at the first row that refuses, and every row below
        it is reported as not reached rather than quietly left out — an unevaluated check must
        never be able to look like a satisfied one. Rejection is not an error state: most
        proposals that reach this rule are refused by it, and that is the mechanism working.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: the drawers
// ---------------------------------------------------------------------------

function StepDetail({ trace }: { trace: DecisionTrace | null }) {
  const rows = stepRows(trace);

  return (
    <>
      <p className="panel__note">
        Steps 6, 7 and 8 are evaluated together and matched as a triple, so each carries its own
        verdict while the outcome is attributed to the step that actually determined it. A window
        that disagrees with its own trailing tail is the signature of a late spike: while the
        proposal&rsquo;s one shared extension is unspent that disagreement buys the extension and
        never a verdict, and once the extension is gone the same disagreement rejects.
      </p>

      <ol className="gauntlet-steps">
        {rows.map((r) => {
          const unreached = r.verdict === null || r.verdict.kind === 'not-reached';
          return (
            <li
              key={r.step}
              className={`gauntlet-step${unreached ? ' gauntlet-step--unreached' : ''}`}
            >
              <h3 className="gauntlet-step__name">
                <span className="gauntlet-step__n">
                  <Value of={spec(r.step, r.cite)} />
                </span>
                <span>{r.name}</span>
              </h3>
              <p className="gauntlet-step__guards">
                <span className="label">Guards against</span> {r.guards}{' '}
                <span className="cite">{formatCitation(r.cite)}</span>
              </p>
              <p className="gauntlet-step__verdict">
                <VerdictChip verdict={r.verdict} />
                {r.verdict !== null && r.verdict.kind === 'skip' ? (
                  <span className="gauntlet-step__aside">{r.verdict.why}</span>
                ) : null}
              </p>

              {r.facts.length > 0 ? (
                <table className="gauntlet-table">
                  <caption className="sr-only">
                    What step <Value of={spec(r.step, r.cite)} /> compared, and what it
                    concluded
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Fact</th>
                      <th scope="col">Actual</th>
                      <th scope="col">Expected / tested against</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.facts.map((f) => (
                      <tr key={f.label}>
                        <th scope="row">{f.label}</th>
                        <td>
                          <Value of={derived(f.value, r.cite)} />
                        </td>
                        <td>
                          {f.against === undefined ? (
                            <span className="gauntlet-absent">no threshold</span>
                          ) : (
                            <Value of={derived(f.against, r.cite)} />
                          )}
                        </td>
                        <td>
                          {f.ok === undefined ? (
                            <span className="gauntlet-absent">context</span>
                          ) : (
                            <span className="mono">{f.ok ? 'met' : 'not met'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="gauntlet-step__aside">
                  {r.verdict === null
                    ? 'Not evaluated: the decision windows have not sealed, so this check has not been run against anything.'
                    : unreached
                      ? 'Not reached: an earlier step produced the outcome, so this check was never evaluated and publishes no comparisons.'
                      : 'This step recorded no comparisons.'}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function OrderPanel() {
  return (
    <>
      <p>
        Steps 3 and 4 read the four risk books and may refuse outright. Because the run
        short-circuits at the first refusal, a vetoed proposal never reaches steps 6 to 8, where
        welfare uplift is weighed — so there is no arithmetic anywhere in the rule by which a
        large enough margin offsets a survival or security veto. The comparison that could do it
        is simply never performed. That is why the two ruin gates are drawn taller and sit in the
        top row: they can refuse, and no number computed later is allowed to raise them.
      </p>
      <p>
        Step 9 sitting before step 10 is a weaker kind of ordering, and worth saying so rather
        than borrowing the argument above. Security sizing and the class meters are both hard
        conditions and neither writes anything, so putting sizing first cannot change whether a
        proposal passes — failing either one is fatal on its own. What the order fixes is which
        reason is reported when both would refuse: the run halts at step 9 and returns{' '}
        <span className="mono">SecuritySizing</span>, the economic fact about the decision,
        rather than <span className="mono">RateLimited</span>, the administrative one.
      </p>
      <p>
        Step 10 checks the bonded attestation quorum and the class meters — and pointedly does{' '}
        <em>not</em> check ratification. The single ratification deadline sits at execute time
        (<span className="cite">{formatCitation(RATIFY_CITE)}</span>), which is precisely why a
        queued CODE mandate may still be ratified during its timelock. Checking it here would
        invent a second deadline and would reject proposals that are legitimately still in
        flight.
      </p>
      <p className="panel__note">
        Rejection is not an error state. Most proposals that reach this rule are rejected by it,
        and that is the mechanism working: the market was asked whether the change improves
        welfare and answered no. Only the two gate vetoes and a process hold are drawn as safety
        states here.
      </p>
    </>
  );
}

function DiagnosticsPanel({ trace }: { trace: DecisionTrace | null }) {
  if (trace === null) {
    return (
      <section className="panel">
        <h2 className="panel__title">What the gating steps compared</h2>
        <p>
          None exist yet. Every quantity this panel reports is one a step of the rule computed
          in order to test it, so before the windows seal there is no r_eff to floor the hurdle
          with, no uplift to measure and no prize to size against.
        </p>
      </section>
    );
  }

  const d = trace.diagnostics;
  const stopped = <Value of={derived(trace.stoppedAt, RULE_CITE)} />;
  const notComputed = (
    <span className="gauntlet-absent">not computed — the run stopped earlier</span>
  );
  const sizingRan = d.attackCostHat !== null;

  return (
    <section className="panel">
      <h2 className="panel__title">What the gating steps compared</h2>
      <table className="gauntlet-table">
        <caption className="sr-only">Decision diagnostics emitted by the run</caption>
        <thead>
          <tr>
            <th scope="col">Diagnostic</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">r_eff</th>
            <td className="numeric">
              {d.rEff === null ? notComputed : <Value of={derived(d.rEff, REFF_CITE)} format={f4} />}
            </td>
            <td>
              max(REJECT window TWAP, Baseline TWAP − σ). Suppressing the reject book cannot
              cheapen the hurdle below the unconditional forecast.
            </td>
          </tr>
          <tr>
            <th scope="row">Uplift</th>
            <td className="numeric">
              {d.uplift === null ? (
                notComputed
              ) : (
                <Value of={derived(d.uplift, RULE_CITE)} format={f4} />
              )}
            </td>
            <td>ACCEPT window TWAP minus r_eff — what the market says the change is worth.</td>
          </tr>
          <tr>
            <th scope="row">Hurdle δ</th>
            <td className="numeric">
              {d.hurdle === null ? (
                notComputed
              ) : (
                <Value of={derived(d.hurdle, RULE_CITE)} format={f4} />
              )}
            </td>
            <td>
              The class margin the uplift must clear, already including the rerun bump of{' '}
              <Value of={spec(RERUN_HURDLE_BUMP, RERUN_CITE)} format={f4} /> where the proposal
              is a rerun.
            </td>
          </tr>
          <tr>
            <th scope="row">AttackCost&#770;</th>
            <td className="numeric">
              {d.attackCostHat === null ? (
                notComputed
              ) : (
                <Value
                  of={derived(d.attackCostHat, SIZING_CITE)}
                  format={usd}
                  unit="USDC"
                  unverified
                />
              )}
            </td>
            <td>
              F&#770; · T_dec, rounded down. An assumption, not a measurement — see below.
            </td>
          </tr>
          <tr>
            <th scope="row">InCapPrize</th>
            <td className="numeric">
              {d.inCapPrize !== null ? (
                <Value of={derived(d.inCapPrize, SIZING_CITE)} format={usd} unit="USDC" />
              ) : sizingRan ? (
                <span className="gauntlet-absent">unavailable — no defined proxy</span>
              ) : (
                notComputed
              )}
            </td>
            <td>
              What a successful capture could extract, rounded up. Where the class has no defined
              proxy this is <strong>unavailable</strong> and never zero: an absent proxy means
              the proposal cannot pass sizing at all.
            </td>
          </tr>
          <tr>
            <th scope="row">
              <Value of={spec(SECURITY_FACTOR, SIZING_CITE)} /> × InCapPrize
            </th>
            <td className="numeric">
              {d.inCapPrize === null ? (
                <span className="gauntlet-absent">—</span>
              ) : (
                <Value
                  of={derived(SECURITY_FACTOR * d.inCapPrize, SIZING_CITE)}
                  format={usd}
                  unit="USDC"
                />
              )}
            </td>
            <td>
              Step 9 passes only when this is at most AttackCost&#770; — passing it is not
              adoption, since steps 10 and 11 still follow. That factor is a kernel floor, not a
              tunable.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        These are not side notes: they are the quantities the gating steps actually compared,
        reported after the fact. r_eff, the uplift and δ are what step 6 tested; AttackCost&#770;
        against <Value of={spec(SECURITY_FACTOR, SIZING_CITE)} /> × InCapPrize is what step 9
        tested. On chain the same quantities are published
        by <span className="mono">decision_stats()</span> once the windows seal. The run stopped
        at step {stopped}, and every quantity a later step would have produced is reported as not
        computed rather than as a zero.
      </p>
    </section>
  );
}

function AttackCostPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">AttackCost&#770; is an assumption, not a measurement</h2>
      <p>
        AttackCost&#770; = F&#770; · T_dec, where F&#770; = min(L&#770;/2, F&#770;_pub) per day.
        F&#770;_pub is the published arbitrage capital that would actually show up per day to
        fight a manipulated price — and it is unmeasured until a later phase, so today only the
        L&#770;/2 term stands. What the number therefore encodes is an assumption about how much
        capital the market would field against a captured decision, not an observation of it.
      </p>
      <p>
        Two consequences follow, and the interface has to carry both. The estimate is rounded
        down so it cannot flatter itself, and it is shown here with the dashed underline this app
        reserves for values the specification has not settled. It must not be read as a measured
        cost of attack (<span className="cite">{formatCitation(SIZING_CITE)}</span>).
      </p>
    </section>
  );
}

function RefusalsPanel() {
  return (
    <>
      <p>
        <Value of={spec(RULE_REJECTIONS.length, RULE_CITE)} /> of the{' '}
        <Value of={spec(REJECT_REASONS.length, cite('02', '§2', 'the frozen RejectReason list'))} />{' '}
        reason codes the integration contract freezes can be produced by this rule. The others
        belong to other moments in a proposal&rsquo;s life — losing a qualification slot twice,
        a guardian review, a failure at execute time — so they can never be this rule&rsquo;s
        answer. Whichever one is returned, it is returned verbatim: the chain reports which check
        refused, not merely that something did.
      </p>
      <table className="gauntlet-table">
        <caption className="sr-only">
          Every refusal the ordered decision rule can produce, and what each one means
        </caption>
        <thead>
          <tr>
            <th scope="col">Reason</th>
            <th scope="col">What it means, and which step produces it</th>
          </tr>
        </thead>
        <tbody>
          {RULE_REJECTIONS.map((r) => (
            <tr key={r}>
              <th scope="row">
                <span
                  className={`chip gauntlet-chip-reason ${
                    isSafetyReason(r) ? 'chip--safety' : 'chip--state'
                  }`}
                >
                  {r}
                </span>
              </th>
              <td>
                {REJECT_GLOSS[r]}
                {/* The producer stays with the meaning rather than in a third
                    column: at rail width a three-column table sets four words to
                    the line and stops being readable. */}
                <span className="gauntlet-check__guards">
                  {REJECT_REASON_META[r].producedBy}{' '}
                  <span className="cite">{formatCitation(REJECT_REASON_META[r].cite)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel__note">
        Only the two gate vetoes and a process hold are safety states, and only those three are
        drawn in the alarm colour. Every other row is an ordinary answer — most often{' '}
        <span className="mono">HurdleNotMet</span>, the market having looked and found no
        improvement.
      </p>
    </>
  );
}

function ProposalPanel({ sim }: { sim: SimState }) {
  const trace = sim.decision;
  const envelope = sim.proposal.envelope;

  return (
    <>
      <table className="gauntlet-table">
        <caption className="sr-only">The proposal put to the rule</caption>
        <thead>
          <tr>
            <th scope="col">Proposal</th>
            <th scope="col">Class</th>
            <th scope="col" className="numeric">
              Ask
            </th>
            <th scope="col" className="numeric">
              Envelope
            </th>
            <th scope="col">Halted</th>
          </tr>
        </thead>
        <tbody>
          <tr id="decide-proposal">
            <th scope="row">
              #<Value of={simulated(sim.proposal.id)} />
            </th>
            <td>{sim.proposal.cls}</td>
            <td className="numeric">
              <Value of={simulated(sim.proposal.ask)} format={usd} unit="USDC" />
            </td>
            <td className="numeric">
              {envelope === undefined ? (
                <span className="gauntlet-absent">none certified</span>
              ) : (
                <Value of={simulated(envelope)} format={usd} unit="USDC" />
              )}
            </td>
            <td>
              {trace === null ? (
                <span className="gauntlet-absent">rule not yet run</span>
              ) : trace.outcome.kind === 'Adopt' ? (
                'cleared all eleven'
              ) : (
                <>
                  before step <Value of={derived(trace.stoppedAt, RULE_CITE)} />
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        The slab&rsquo;s notches count the proposal class, so class is never carried by colour
        alone: PARAM one, TREASURY two, CODE three, META four, CONSTITUTIONAL five.
      </p>
      <p>
        On chain, <span className="mono">decide()</span> returns one outcome and, on a refusal,
        the reason code that produced it; the finalized statistics are published separately by{' '}
        <span className="mono">decision_stats()</span>. This page replays the same ordered rule
        and keeps every step&rsquo;s comparison, so all eleven checks are listed in the order
        doc 05 §5.4 fixes. Steps 1 to 5 and 9 to 11 short-circuit: the outcome is that one
        check&rsquo;s own conclusion, and every later check is reported as unevaluated rather than
        omitted. Steps 6, 7 and 8 do not short-circuit — the rule reads all three and then
        dispatches on the combination, so a failure at step 6 by itself names no reason code at
        all.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function DecideGauntletScene({ sim }: { sim: SimState }): JSX.Element {
  const trace = sim.decision;

  /**
   * Eleven gates, in the specification's order, whatever state the run is in.
   * The names come from `STEP_SHELLS`, which `decide()` itself produced, so a
   * step renamed in the protocol core renames its gate here and cannot drift.
   */
  const motion: MotionSpec = {
    kind: 'corridor',
    props: {
      steps: STEP_SHELLS.map((s, i) => ({
        n: s.step,
        name: s.name,
        verdict: (trace?.steps[i]?.verdict.kind ?? 'not-reached') as CorridorVerdict,
      })),
      haltedAt:
        trace === null || trace.outcome.kind === 'Adopt' ? null : trace.stoppedAt,
      outcome: trace === null ? 'pending' : trace.outcome.kind,
    },
  };

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          motion={motion}
          title="The decision gauntlet"
        />
      </div>
      <div className="col-rail">
        <Lede>
          When the trading window closes, the chain runs eleven checks in a fixed order and mostly
          stops at the first one that fails — that check&rsquo;s answer is the decision. It reads a{' '}
          <Jargon word="twap" label="time-averaged price" /> rather than the price at the closing
          bell, so no single late trade can decide anything.{' '}
          <strong>The safety checks run first</strong>, so no amount of predicted upside can buy
          past them: a proposal the market prices as a survival or security risk is refused
          before anything about how much it might be worth is ever read. Everything after the
          stop is genuinely unevaluated, and this page shows it that way rather than letting it
          look satisfied. The three checks in the middle are the exception, and they are the ones
          that ask whether the proposal is actually worth doing: steps 6, 7 and 8 are all read
          before any of them decides anything, because failing one of them alone means the
          evidence disagrees with itself rather than that the answer is no.
        </Lede>

        <Headline sim={sim} />

        <ChecklistPanel sim={sim} />

        <Depth
          title="What each check compared, step by step"
          hint={`${STEP_SHELLS.length} steps`}
        >
          <StepDetail trace={sim.decision} />
        </Depth>

        <Depth title="Why the order matters" hint="steps 3, 4, 9 and 10">
          <OrderPanel />
        </Depth>

        <Depth title="The numbers behind each check" hint="6 quantities">
          <DiagnosticsPanel trace={sim.decision} />
          <AttackCostPanel />
        </Depth>

        <Depth
          title="All the ways this rule can refuse"
          hint={`${RULE_REJECTIONS.length} of ${REJECT_REASONS.length} reasons`}
        >
          <RefusalsPanel />
        </Depth>

        <Depth title="The proposal, and what the chain publishes" hint="1 proposal">
          <ProposalPanel sim={sim} />
        </Depth>
      </div>
    </div>
  );
}
