/**
 * `decide()` — the ordered eleven-step decision rule of doc 05 §5.4.
 *
 * This is the centre of the protocol. A proposal that has traded for thirteen
 * days arrives here, and eleven checks run **in a normative order** that is
 * itself a safety property: the ruin gates (steps 3–4) run before any upside is
 * weighed (steps 6–8), so no welfare margin can ever buy its way past a veto.
 *
 * The engine returns a full **trace**, not a verdict. Every step reports what it
 * compared and what it concluded, including the steps that were never reached.
 * That is what makes the decision explainable: you can see not only that a
 * proposal was rejected, but exactly which gate stopped it and what the numbers
 * were when it did.
 */

import type { Citation } from './citations';
import { cite } from './citations';
import {
  DECISION_SANITY_MAX,
  DECISION_SANITY_MIN,
  RERUN_HURDLE_BUMP,
  SECURITY_FACTOR,
} from './constants';
import type { DecisionOutcome, GateType, ProposalClass, RejectReason, WelfareGrade } from './types';
import { ADOPT, EXTEND, reject, requiresGateMarkets, requiresRatification } from './types';
import {
  attackCostHat,
  decisionPairContestCapital,
  inCapPrize,
  lHat,
  securitySizingOk,
} from './treasury';

export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type StepVerdict =
  | { readonly kind: 'pass' }
  /** The check does not apply to this proposal, with the reason why. */
  | { readonly kind: 'skip'; readonly why: string }
  | { readonly kind: 'extend' }
  | { readonly kind: 'reject'; readonly reason: RejectReason }
  /** An earlier step stopped the run before this one was evaluated. */
  | { readonly kind: 'not-reached' };

/** One comparison a step made, in a form the UI can render as a row. */
export interface StepFact {
  readonly label: string;
  readonly value: string;
  /** The threshold it was tested against, when there is one. */
  readonly against?: string | undefined;
  /** Absent where the fact is context rather than a test. */
  readonly ok?: boolean | undefined;
}

export interface StepResult {
  readonly step: StepId;
  readonly name: string;
  /** One sentence: what this step is protecting against. */
  readonly guards: string;
  readonly cite: Citation;
  readonly verdict: StepVerdict;
  readonly facts: readonly StepFact[];
}

export interface DecisionTrace {
  readonly outcome: DecisionOutcome;
  /** Always eleven entries, in order, including unreached ones. */
  readonly steps: readonly StepResult[];
  /** Index of the step that produced the outcome. */
  readonly stoppedAt: StepId;
  /** Diagnostics that are emitted but never gate in v1. */
  readonly diagnostics: {
    readonly rEff: number | null;
    readonly uplift: number | null;
    readonly hurdle: number | null;
    readonly attackCostHat: number | null;
    readonly inCapPrize: number | null;
  };
}

export interface GateReadings {
  readonly pAdopt: number;
  readonly pReject: number;
  readonly pMax: number;
  readonly eps: number;
  readonly bookValid: boolean;
}

export interface DecisionInputs {
  readonly proposalClass?: ProposalClass;

  // Step 1
  readonly preimageOk?: boolean;
  readonly resourceLocksHeld?: boolean;

  // Step 2
  readonly processHold?: boolean;

  // Steps 3-4
  readonly gateBookValid?: boolean;
  readonly gates?: Partial<Record<GateType, Partial<GateReadings>>>;

  // Step 5
  readonly welfareGrade?: WelfareGrade;
  readonly extended?: boolean;

  // Steps 6-8: the hurdle. `rejectFullEffective` is r_eff — already the
  // max(reject, baseline − σ) floor, because the caller owns the Baseline read.
  readonly acceptFull: number;
  readonly rejectFullEffective: number;
  readonly acceptTrailing?: number;
  readonly rejectTrailingEffective?: number;
  readonly delta: number;
  /** A rerun raises the hurdle by one percentage point (doc 05 §2.1, T13/T25). */
  readonly rerun?: boolean;
  readonly converged?: boolean;

  // Step 9
  readonly measuredLiquidity?: number;
  readonly polDepth?: number;
  readonly contestAccept?: number;
  readonly contestReject?: number;
  readonly flowCap?: number;
  readonly bAccept?: number;
  readonly bReject?: number;
  readonly publishedFlowPerDay?: number;
  readonly decisionWindow?: number;
  readonly ask?: number | undefined;
  /** Absent means the class has no certified prize proxy — which must reject,
   * not default to zero. Hence the explicit `undefined`. */
  readonly envelopeValue?: number | undefined;
  readonly spendableNav?: number | undefined;

  // Step 10
  readonly attestationOk?: boolean | undefined;
  readonly queueTimeOk?: boolean | undefined;
}

const S = (
  step: StepId,
  name: string,
  guards: string,
  at: string,
): Omit<StepResult, 'verdict' | 'facts'> => ({
  step,
  name,
  guards,
  cite: cite('05', at),
});

const SPECS = [
  S(1, 'Payload and locks', 'That the bytes about to be enacted are the bytes that were traded.', '§5.4'),
  S(2, 'Process holds', 'That no live dispute, guardian hold or dead-man freeze is being decided through.', '§5.4'),
  S(3, 'Gate-book validity', 'That the four risk books are actually informative before their prices are trusted.', '§5.2'),
  S(4, 'Gate veto', 'That a proposal priced as a survival or security risk cannot be bought past it.', '§5.1'),
  S(5, 'Welfare-book grade', 'That the decision books are deep, fresh and covered enough to decide on.', '§5.2'),
  S(6, 'Full-window hurdle', 'That ADOPT beat REJECT over the whole window by more than the class margin.', '§5.4'),
  S(7, 'Trailing hurdle', 'That the last 24 hours agree with the window, so a late spike cannot decide.', '§5.4'),
  S(8, 'Convergence', 'That the closing spot price agrees with the average it is being judged by.', '§5.4'),
  S(9, 'Security sizing', 'That capturing this decision costs at least three times what it pays.', '§5.6'),
  S(10, 'Attestation and meters', 'That the artifact is attested and the class has budget left.', '§5.4'),
  S(11, 'Enqueue', 'The mandate enters the timelock; nothing is enacted yet.', '§5.4'),
] as const;

const notReached = (i: number): StepResult => ({
  ...SPECS[i]!,
  verdict: { kind: 'not-reached' },
  facts: [],
});

const f3 = (x: number): string => x.toFixed(3);
const f4 = (x: number): string => x.toFixed(4);
const usd = (x: number): string =>
  `${x.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;

/**
 * Run the rule. Steps short-circuit: the first refusal is the outcome, and every
 * later step reports `not-reached` rather than being silently omitted — an
 * unevaluated check must never look like a passed one.
 */
export function decide(input: DecisionInputs): DecisionTrace {
  const cls: ProposalClass = input.proposalClass ?? 'Param';
  const steps: StepResult[] = [];
  const push = (i: number, verdict: StepVerdict, facts: StepFact[] = []) => {
    steps.push({ ...SPECS[i]!, verdict, facts });
  };

  const aF = input.acceptFull;
  const rF = input.rejectFullEffective;
  const aT = input.acceptTrailing ?? aF;
  const rT = input.rejectTrailingEffective ?? rF;
  const delta = input.delta + (input.rerun === true ? RERUN_HURDLE_BUMP : 0);
  const extended = input.extended ?? false;

  const finish = (
    outcome: DecisionOutcome,
    stoppedAt: StepId,
    diagnostics: DecisionTrace['diagnostics'],
  ): DecisionTrace => {
    for (let i = steps.length; i < SPECS.length; i++) steps.push(notReached(i));
    return { outcome, steps, stoppedAt, diagnostics };
  };

  const diag = (
    over: Partial<DecisionTrace['diagnostics']> = {},
  ): DecisionTrace['diagnostics'] => ({
    rEff: null,
    uplift: null,
    hurdle: null,
    attackCostHat: null,
    inCapPrize: null,
    ...over,
  });

  // --- Step 1: payload, then locks ----------------------------------------
  if (input.preimageOk === false) {
    push(0, { kind: 'reject', reason: 'ConstitutionViolation' }, [
      { label: 'Committed preimage', value: 'absent or altered', ok: false },
    ]);
    return finish(reject('ConstitutionViolation'), 1, diag());
  }
  if (input.resourceLocksHeld === false) {
    push(0, { kind: 'reject', reason: 'ResourceConflict' }, [
      { label: 'Committed preimage', value: 'present', ok: true },
      { label: 'Resource locks', value: 'lost since qualification', ok: false },
    ]);
    return finish(reject('ResourceConflict'), 1, diag());
  }
  push(0, { kind: 'pass' }, [
    { label: 'Committed preimage', value: 'present, hash matches', ok: true },
    { label: 'Resource locks', value: 'still held', ok: true },
  ]);

  // --- Step 2: process holds ----------------------------------------------
  if (input.processHold === true) {
    push(1, { kind: 'reject', reason: 'ProcessHold' }, [
      { label: 'Open dispute / hold / dead-man', value: 'active', ok: false },
    ]);
    // A hold is terminal for this proposal, not a deferral: the bond is
    // refunded and it may be resubmitted. Never a noisy PASS.
    return finish(reject('ProcessHold'), 2, diag());
  }
  push(1, { kind: 'pass' }, [
    { label: 'Merit-bonded oracle dispute', value: 'none touching this spec', ok: true },
    { label: 'Guardian hold', value: 'none', ok: true },
    { label: 'Dead-man switch', value: 'not engaged', ok: true },
  ]);

  // --- Steps 3-4: the ruin gates ------------------------------------------
  const gateOrder: GateType[] = ['Survival', 'Security'];
  if (!requiresGateMarkets(cls)) {
    push(2, { kind: 'skip', why: `${cls} proposals carry no gate books.` });
    push(3, { kind: 'skip', why: `${cls} proposals carry no gate books.` });
  } else {
    const readings = gateOrder.map((g) => {
      const r = input.gates?.[g];
      return {
        gate: g,
        pAdopt: r?.pAdopt ?? 0,
        pReject: r?.pReject ?? 0,
        pMax: r?.pMax ?? 0.05,
        eps: r?.eps ?? 0.02,
        bookValid: r?.bookValid ?? input.gateBookValid ?? true,
      };
    });

    // The loop asserts each gate's validity *then* its veto, so a Survival veto
    // is reported before Security's validity is ever inspected. That ordering is
    // normative, not incidental.
    const validityFacts: StepFact[] = [];
    const vetoFacts: StepFact[] = [];
    for (const r of readings) {
      if (!r.bookValid) {
        validityFacts.push({
          label: `${r.gate} books`,
          value: 'not decision-grade',
          ok: false,
        });
        push(2, { kind: 'reject', reason: 'NotDecisionGrade' }, validityFacts);
        return finish(reject('NotDecisionGrade'), 3, diag());
      }
      validityFacts.push({ label: `${r.gate} books`, value: 'decision-grade', ok: true });

      const capBreached = r.pAdopt > r.pMax;
      const relBreached = r.pAdopt > r.pReject + r.eps;
      vetoFacts.push({
        label: `${r.gate} breach price, ADOPT`,
        value: f3(r.pAdopt),
        against: `cap ${f3(r.pMax)} · REJECT ${f3(r.pReject)} + ε ${f3(r.eps)}`,
        ok: !capBreached && !relBreached,
      });
      if (capBreached || relBreached) {
        push(2, { kind: 'pass' }, validityFacts);
        const reason: RejectReason =
          r.gate === 'Survival' ? 'GateVetoSurvival' : 'GateVetoSecurity';
        push(3, { kind: 'reject', reason }, vetoFacts);
        return finish(reject(reason), 4, diag());
      }
    }
    push(2, { kind: 'pass' }, validityFacts);
    push(3, { kind: 'pass' }, vetoFacts);
  }

  // --- Step 5: welfare-book grade -----------------------------------------
  const grade: WelfareGrade = input.welfareGrade ?? 'Ok';
  const gradeFacts: StepFact[] = [
    { label: 'Decision-book grade', value: grade, ok: grade === 'Ok' },
    {
      label: 'Extension budget',
      value: extended ? 'already spent' : 'available (one per proposal)',
    },
    {
      label: 'Sanity band',
      value: `${f3(DECISION_SANITY_MIN)} – ${f3(DECISION_SANITY_MAX)}`,
    },
  ];
  if (grade === 'Insufficient' && !extended) {
    // The one shared extension budget: +3 days, once, across all causes.
    push(4, { kind: 'extend' }, gradeFacts);
    return finish(EXTEND, 5, diag());
  }
  if (grade !== 'Ok') {
    push(4, { kind: 'reject', reason: 'NotDecisionGrade' }, gradeFacts);
    return finish(reject('NotDecisionGrade'), 5, diag());
  }
  push(4, { kind: 'pass' }, gradeFacts);

  // --- Steps 6-8: hurdle, trailing hurdle, convergence ---------------------
  const fullPass = aF >= rF + delta;
  const tailPass = aT >= rT + delta;
  const converged = input.converged ?? true;
  const uplift = aF - rF;

  const hurdleFacts: StepFact[] = [
    { label: 'ACCEPT window TWAP', value: f4(aF) },
    { label: 'r_eff = max(REJECT, Baseline − σ)', value: f4(rF) },
    { label: 'Uplift', value: f4(uplift), against: `δ ${f4(delta)}`, ok: fullPass },
  ];
  const tailFacts: StepFact[] = [
    { label: 'ACCEPT trailing 24 h', value: f4(aT) },
    { label: 'REJECT trailing (effective)', value: f4(rT) },
    { label: 'Trailing uplift', value: f4(aT - rT), against: `δ ${f4(delta)}`, ok: tailPass },
  ];
  const convFacts: StepFact[] = [
    { label: 'Spot vs window TWAP', value: converged ? 'within Δ_max' : 'diverged', ok: converged },
    { label: 'Δ_max', value: '0.05' },
  ];

  const diagHurdle = diag({ rEff: rF, uplift, hurdle: delta });

  // Steps 6, 7 and 8 are evaluated together and matched as a triple, so each is
  // recorded with its own verdict and the outcome is attributed to the step that
  // actually determined it.
  const ok = { kind: 'pass' } as const;
  if (fullPass && tailPass && converged) {
    push(5, ok, hurdleFacts);
    push(6, ok, tailFacts);
    push(7, ok, convFacts);
  } else if (fullPass !== tailPass) {
    // A disagreement between the window and its own tail is the signature of a
    // late spike. It buys one extension rather than a verdict — and a second
    // occurrence always rejects, so the mechanism can never produce a noisy PASS.
    const stopped: StepId = fullPass ? 7 : 6;
    if (extended) {
      const r: StepVerdict = { kind: 'reject', reason: 'SecondExtensionFailed' };
      push(5, fullPass ? ok : r, hurdleFacts);
      push(6, tailPass ? ok : r, tailFacts);
      push(7, { kind: 'not-reached' }, convFacts);
      return finish(reject('SecondExtensionFailed'), stopped, diagHurdle);
    }
    const e: StepVerdict = { kind: 'extend' };
    push(5, fullPass ? ok : e, hurdleFacts);
    push(6, tailPass ? ok : e, tailFacts);
    push(7, { kind: 'not-reached' }, convFacts);
    return finish(EXTEND, stopped, diagHurdle);
  } else {
    const reason: RejectReason = converged ? 'HurdleNotMet' : 'ConvergenceFailed';
    const r: StepVerdict = { kind: 'reject', reason };
    push(5, fullPass ? ok : r, hurdleFacts);
    push(6, tailPass ? ok : r, tailFacts);
    push(7, converged ? ok : r, convFacts);
    return finish(reject(reason), converged ? 6 : 8, diagHurdle);
  }

  // --- Step 9: security sizing --------------------------------------------
  const decomposed = [
    input.polDepth,
    input.contestAccept,
    input.contestReject,
    input.flowCap,
    input.bAccept,
    input.bReject,
  ];
  let measured = input.measuredLiquidity ?? 0;
  if (decomposed.some((p) => p !== undefined)) {
    if (decomposed.some((p) => p === undefined)) {
      throw new Error(
        'decomposed L-hat needs polDepth, contestAccept, contestReject, flowCap, bAccept and bReject together',
      );
    }
    measured = lHat(
      input.polDepth!,
      decisionPairContestCapital(input.contestAccept!, input.contestReject!),
      input.flowCap!,
      input.bAccept!,
      input.bReject!,
    );
  }

  const attack = attackCostHat(measured, {
    publishedFlowPerDay: input.publishedFlowPerDay,
    decisionWindow: input.decisionWindow ?? 43_200,
  });
  const prize = inCapPrize(cls, {
    ask: input.ask,
    envelope: input.envelopeValue,
    spendableNav: input.spendableNav,
  });

  const sizingFacts: StepFact[] = [
    { label: 'Measured depth L̂', value: usd(measured) },
    { label: 'AttackCost̂ (F̂ · T_dec)', value: usd(attack) },
    {
      label: 'InCapPrize',
      // An absent prize proxy means the proposal *cannot* pass sizing. A UI must
      // render this as unavailable, never as zero.
      value: prize === null ? 'unavailable — no defined proxy' : usd(prize),
    },
    {
      label: `${SECURITY_FACTOR} × InCapPrize`,
      value: prize === null ? '—' : usd(SECURITY_FACTOR * prize),
      against: usd(attack),
      ok: prize !== null && securitySizingOk(prize, attack),
    },
  ];

  const diagFull = diag({
    rEff: rF,
    uplift,
    hurdle: delta,
    attackCostHat: attack,
    inCapPrize: prize,
  });

  if (prize === null || !securitySizingOk(prize, attack)) {
    push(8, { kind: 'reject', reason: 'SecuritySizing' }, sizingFacts);
    return finish(reject('SecuritySizing'), 9, diagFull);
  }
  push(8, { kind: 'pass' }, sizingFacts);

  // --- Step 10: attestation, then meters -----------------------------------
  const needsAttestation = cls === 'Code' || cls === 'Meta';
  const attestationOk = input.attestationOk ?? true;
  const queueTimeOk = input.queueTimeOk ?? true;
  const meterFacts: StepFact[] = [
    {
      label: 'Bonded attestation quorum',
      value: needsAttestation
        ? attestationOk
          ? '2-of-3 present, unrevoked'
          : 'absent or below quorum'
        : `not required for ${cls}`,
      ok: needsAttestation ? attestationOk : undefined,
    },
    {
      label: 'Class capability and rate meters',
      value: queueTimeOk ? 'headroom available' : 'exhausted or spacing not met',
      ok: queueTimeOk,
    },
    {
      label: 'Ratification',
      // Deliberately not checked here. The single ratification deadline is at
      // execute time (D-5), which is why a queued CODE proposal can still be
      // ratified during its timelock.
      value: requiresRatification(cls)
        ? 'checked at execute, not here (D-5)'
        : 'not required',
    },
  ];
  if (needsAttestation && !attestationOk) {
    push(9, { kind: 'reject', reason: 'AttestationMissing' }, meterFacts);
    return finish(reject('AttestationMissing'), 10, diagFull);
  }
  if (!queueTimeOk) {
    push(9, { kind: 'reject', reason: 'RateLimited' }, meterFacts);
    return finish(reject('RateLimited'), 10, diagFull);
  }
  push(9, { kind: 'pass' }, meterFacts);

  // --- Step 11: enqueue -----------------------------------------------------
  push(10, { kind: 'pass' }, [
    { label: 'Outcome', value: 'ADOPT — enqueued into the class timelock' },
    { label: 'Enacted now?', value: 'no; the mandate matures, then anyone may execute it' },
  ]);
  return finish(ADOPT, 11, diagFull);
}

/** Human-readable one-liner for an outcome, for narration and headings. */
export function describeOutcome(o: DecisionOutcome): string {
  switch (o.kind) {
    case 'Adopt':
      return 'Adopt — the mandate is queued into its timelock.';
    case 'Extend':
      return 'Extend — one more 3-day window, the only extension this proposal gets.';
    case 'Reject':
      return `Reject(${o.reason})`;
  }
}
