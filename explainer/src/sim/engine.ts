import { decide } from '../protocol/decide';
import { transitionById } from '../protocol/lifecycle';
import { buy as lmsrBuy, priceLong } from '../protocol/lmsr';
import { polCommitment } from '../protocol/treasury';
import { gate, settlementScore } from '../protocol/welfare';
import { THETA_C_HI, THETA_C_LO, THETA_S_HI, THETA_S_LO } from '../protocol/welfare';
import { BLOCKS_PER_DAY, ORC_WINDOW_BLOCKS } from '../protocol/constants';
import { cite } from '../protocol/citations';
import type { MarketKind, ProposalClass, ProposalState } from '../protocol/types';
import type {
  BookState,
  GuardCheck,
  SimEvent,
  SimState,
  Scenario,
} from './types';

/**
 * The simulation reducer.
 *
 * Pure and total: `(state, event) -> state`. There is no wall clock, no
 * randomness and no I/O, so replaying a scenario's events from the seed always
 * produces the same world. That is what lets the transport scrub backwards, and
 * what lets tests assert a scenario's terminal state.
 *
 * Where a number can be computed by the certified protocol core, it is — prices
 * come from the LMSR, the decision from `decide()`, welfare from `gate()`. The
 * engine's own job is only bookkeeping.
 */

const EPOCH_LENGTH = 302_400;

/** Per-class defaults, doc 13 §1. Whole USDC. */
const CLASS_B: Record<ProposalClass, number> = {
  Param: 10_000,
  Treasury: 25_000,
  Code: 60_000,
  Meta: 100_000,
  Constitutional: 0,
};
const CLASS_BOND: Record<ProposalClass, number> = {
  Param: 1_000,
  Treasury: 5_000,
  Code: 25_000,
  Meta: 50_000,
  Constitutional: 0,
};
export const CLASS_DELTA: Record<ProposalClass, number> = {
  Param: 0.0375,
  Treasury: 0.0375,
  Code: 0.06,
  Meta: 0.09,
  Constitutional: 0,
};
export const CLASS_SIGMA: Record<ProposalClass, number> = {
  Param: 0.003,
  Treasury: 0.005,
  Code: 0.008,
  Meta: 0.01,
  Constitutional: 0,
};
const GATE_B = 7_500;
const BASELINE_B = 25_000;

const book = (kind: MarketKind, b: number): BookState => ({
  kind,
  b,
  qLong: 0,
  qShort: 0,
  spot: 0.5,
  twap: 0.5,
  trailingTwap: 0.5,
  coveragePct: 100,
  staleEvents: 0,
  contestCapital: 0,
  phase: 'Trading',
  reaped: false,
});

/**
 * The fourteen rows a client re-reads before it lets you sign, doc 11 §11.5.
 *
 * The runtime itself runs eleven checks (doc 09 §1.2). The client shows more
 * rows because two of the eleven bundle readings a person needs told apart:
 * backend check 1 becomes rows 1 and 2, and backend check 10 becomes rows 11,
 * 12 and 13. Same conditions, told in the order a reader can act on.
 */
function initialGuardChecks(): GuardCheck[] {
  const G = (n: number, name: string, expected: string, at: string): GuardCheck => ({
    n,
    name,
    expected,
    actual: expected,
    ok: true,
    cite: cite('11', at),
  });
  return [
    G(1, 'Queued, not cancelled', 'present in the queue', '§11.5'),
    G(2, 'Window', 'maturity ≤ now ≤ grace end', '§11.5'),
    G(3, 'Preimage', 'present, hash matches the committed bytes', '§11.5'),
    G(4, 'Runtime version', 'spec name and version match the constraint', '§11.5'),
    G(5, 'Ratification', 'referendum approved (CODE/META)', '§11.5'),
    G(6, 'Attestation presence', 'records exist, unrevoked, unchallenged', '§11.5'),
    G(7, 'Capability rules', 'call domains admitted for the class origin', '§11.5'),
    G(8, 'Rate meters', 'treasury and issuance meters have headroom', '§11.5'),
    G(9, 'Resource locks', 'still held for every declared domain', '§11.5'),
    G(10, 'Guardian suspension', 'no delay_once, no gate suspension', '§11.5'),
    G(11, 'Gate flags', 'no active daily breach flag', '§11.5'),
    G(12, 'Dead-man freeze', 'switch not engaged — never waived', '§11.5'),
    G(13, 'Triggering freeze', 'no ledger freeze, no migration halt — unless expedited', '§11.5'),
    G(14, 'Batch bounds', '≤ 16 calls, ≤ 64 KiB, filter closure clean', '§11.5'),
  ];
}

export function initialState(scenario: Scenario, cls: ProposalClass, title: string): SimState {
  const decideAt = Math.floor((EPOCH_LENGTH * 18) / 21);
  return {
    block: 0,
    epoch: 41,
    epochLength: EPOCH_LENGTH,
    blockInEpoch: 0,
    proposal: {
      id: 1207,
      cls,
      title,
      ask: cls === 'Treasury' ? 200_000 : 0,
      envelope: cls === 'Param' ? 120_000 : cls === 'Constitutional' ? undefined : 0,
      bond: CLASS_BOND[cls],
      state: 'Submitted',
      rejectReason: null,
      extended: false,
      rerun: false,
      decideAt,
      maturity: null,
      graceEnd: null,
      ratification: cls === 'Code' || cls === 'Meta' ? { kind: 'NoPassedRecord' } : { kind: 'NotRequired' },
      history: [],
    },
    books: [],
    vault: { state: { kind: 'Open' }, escrowed: 0, holdings: {} },
    oracle: {
      component: 4,
      componentName: 'H — weight headroom',
      round: 0,
      reporterValue: null,
      challengerValue: null,
      bond: 0,
      cumulativeBond: 0,
      windowEnd: 0,
      acks: 0,
      extensionUsed: false,
      settledPath: null,
      settledValue: null,
      holdsDecision: false,
    },
    registry: {
      kind: 'Incident',
      filingId: 0,
      severity: 'S2',
      points: 0,
      bond: 0,
      state: { kind: 'Upheld' },
      incidentMultiplier: 1,
    },
    guard: { queued: false, checks: initialGuardChecks(), blockedAt: null, blockedReason: null, attempts: 0 },
    welfare: {
      s: 0.97,
      cOnchain: 0.94,
      cAttested: 0.98,
      p: 0.78,
      a: 0.71,
      w: 0,
      settlement: null,
      gateS: 0,
      gateC: 0,
    },
    flags: {
      deadManEngaged: false,
      ledgerFrozen: false,
      migrationHalt: false,
      gateBreachS: false,
      gateBreachC: false,
      reserveImpaired: false,
      intakePaused: false,
    },
    decision: null,
    narration: scenario.premise,
    stepTitle: 'Before the epoch opens',
    log: [],
    scenario: scenario.id,
    cursor: 0,
    stepCount: scenario.steps.length,
  };
}

/** Recompute the welfare composite from the current pillar values. */
function recomputeWelfare(s: SimState): void {
  const gS = gate(s.welfare.s, THETA_S_LO, THETA_S_HI);
  const gC = gate(s.welfare.cOnchain * s.welfare.cAttested, THETA_C_LO, THETA_C_HI);
  s.welfare.gateS = gS;
  s.welfare.gateC = gC;
  s.welfare.w = gS * gC * (s.welfare.p ** 0.6 * s.welfare.a ** 0.4);
}

const log = (s: SimState, text: string, kind: SimState['log'][number]['kind']) => {
  s.log = [...s.log, { block: s.block, text, kind }];
};

function applyEvent(prev: SimState, e: SimEvent): SimState {
  // Structural clone of the mutable parts; the reducer stays pure at the seam.
  const s: SimState = {
    ...prev,
    proposal: { ...prev.proposal, history: [...prev.proposal.history] },
    books: prev.books.map((b) => ({ ...b })),
    vault: { ...prev.vault, holdings: { ...prev.vault.holdings } },
    oracle: { ...prev.oracle },
    registry: { ...prev.registry },
    guard: { ...prev.guard, checks: prev.guard.checks.map((c) => ({ ...c })) },
    welfare: { ...prev.welfare },
    flags: { ...prev.flags },
  };

  switch (e.t) {
    case 'advanceTo': {
      s.block = e.block;
      // The dead-man switch pauses the logical clock: the epoch stops advancing
      // even though blocks keep arriving.
      if (!s.flags.deadManEngaged) s.blockInEpoch = e.block % s.epochLength;
      break;
    }

    case 'transition': {
      const t = transitionById(e.id);
      s.proposal.state = t.to as ProposalState;
      if (e.reason !== undefined) s.proposal.rejectReason = e.reason;
      else if (t.toReason !== undefined) s.proposal.rejectReason = t.toReason;
      s.proposal.history.push({ id: e.id, block: s.block });
      if (e.id === 'T8' || e.id === 'T13' || e.id === 'T25') s.proposal.extended = true;
      if (e.id === 'T13' || e.id === 'T25') s.proposal.rerun = true;
      if (e.id === 'T9') {
        s.guard.queued = true;
        s.proposal.maturity = s.block + 3 * BLOCKS_PER_DAY;
        s.proposal.graceEnd = s.block + 17 * BLOCKS_PER_DAY;
      }
      log(s, `${e.id} — ${t.to}${s.proposal.rejectReason ? `(${s.proposal.rejectReason})` : ''}`, 'transition');
      break;
    }

    case 'seedMarkets': {
      const b = CLASS_B[s.proposal.cls];
      s.books = [
        book('DecisionAccept', b),
        book('DecisionReject', b),
        book('GateS_Adopt', GATE_B),
        book('GateS_Reject', GATE_B),
        book('GateC_Adopt', GATE_B),
        book('GateC_Reject', GATE_B),
        book('Baseline', BASELINE_B),
      ];
      // Gate books open near zero: a healthy proposal is not expected to breach.
      for (const bk of s.books) {
        if (bk.kind.startsWith('Gate')) {
          bk.spot = 0.012;
          bk.twap = 0.012;
          bk.trailingTwap = 0.012;
        }
      }
      const headroom = polCommitment(b);
      log(
        s,
        `Markets opened: 6 proposal books + Baseline. Seeded headroom ${Math.round(headroom).toLocaleString('en-US')} USDC per decision book (b·ln 2).`,
        'market',
      );
      break;
    }

    case 'setBook': {
      const bk = s.books.find((x) => x.kind === e.kind);
      if (bk) Object.assign(bk, e.patch);
      break;
    }

    case 'buy': {
      const bk = s.books.find((x) => x.kind === e.kind);
      if (bk) {
        const q = lmsrBuy(bk.b, bk.qLong, bk.qShort, e.side, e.amount, 30);
        if (e.side === 'Long') bk.qLong += e.amount;
        else bk.qShort += e.amount;
        bk.spot = priceLong(bk.b, bk.qLong, bk.qShort);
        bk.contestCapital += e.amount;
        log(
          s,
          `Bought ${e.amount.toLocaleString('en-US')} ${e.side.toUpperCase()} on ${e.kind} for ${Math.round(q.cost).toLocaleString('en-US')} USDC + ${Math.round(q.fee)} fee; price now ${bk.spot.toFixed(3)}.`,
          'market',
        );
      }
      break;
    }

    case 'split': {
      s.vault.escrowed += e.amount;
      // The dual mint: one USDC in, a full unit of BOTH branches out.
      s.vault.holdings['Accept/BranchUsdc'] = (s.vault.holdings['Accept/BranchUsdc'] ?? 0) + e.amount;
      s.vault.holdings['Reject/BranchUsdc'] = (s.vault.holdings['Reject/BranchUsdc'] ?? 0) + e.amount;
      log(
        s,
        `split(${e.amount.toLocaleString('en-US')} USDC) — dual mint: ${e.amount.toLocaleString('en-US')} ACCEPT-USDC and ${e.amount.toLocaleString('en-US')} REJECT-USDC. Value is not halved; worlds are doubled.`,
        'market',
      );
      break;
    }

    case 'runDecide': {
      const acc = s.books.find((b) => b.kind === 'DecisionAccept');
      const rej = s.books.find((b) => b.kind === 'DecisionReject');
      const base = s.books.find((b) => b.kind === 'Baseline');
      const gsA = s.books.find((b) => b.kind === 'GateS_Adopt');
      const gsR = s.books.find((b) => b.kind === 'GateS_Reject');
      const gcA = s.books.find((b) => b.kind === 'GateC_Adopt');
      const gcR = s.books.find((b) => b.kind === 'GateC_Reject');
      const sigma = CLASS_SIGMA[s.proposal.cls];

      // r_eff = max(REJECT window TWAP, Baseline TWAP − σ). The Baseline term is
      // a floor on the floor: suppressing the reject book cannot cheapen the
      // hurdle below the unconditional forecast.
      const rEff = Math.max(rej?.twap ?? 0.5, (base?.twap ?? 0.5) - sigma);
      const rEffTail = Math.max(
        rej?.trailingTwap ?? 0.5,
        (base?.trailingTwap ?? 0.5) - sigma,
      );
      const converged =
        acc !== undefined && rej !== undefined
          ? Math.abs(acc.spot - acc.twap) <= 0.05 && Math.abs(rej.spot - rej.twap) <= 0.05
          : true;
      const grade =
        acc === undefined
          ? 'Invalid'
          : acc.staleEvents > 1 || acc.coveragePct < 95
            ? 'Insufficient'
            : 'Ok';

      s.decision = decide({
        proposalClass: s.proposal.cls,
        acceptFull: acc?.twap ?? 0.5,
        rejectFullEffective: rEff,
        acceptTrailing: acc?.trailingTwap ?? 0.5,
        rejectTrailingEffective: rEffTail,
        delta: CLASS_DELTA[s.proposal.cls],
        rerun: s.proposal.rerun,
        extended: s.proposal.extended,
        converged,
        welfareGrade: grade,
        processHold: s.oracle.holdsDecision || s.flags.deadManEngaged,
        gates: {
          Survival: { pAdopt: gsA?.twap ?? 0, pReject: gsR?.twap ?? 0 },
          Security: { pAdopt: gcA?.twap ?? 0, pReject: gcR?.twap ?? 0 },
        },
        ask: s.proposal.ask,
        envelopeValue: s.proposal.envelope,
        spendableNav: 0,
        polDepth: polCommitment(acc?.b ?? CLASS_B[s.proposal.cls]) * 2,
        contestAccept: acc?.contestCapital ?? 0,
        contestReject: rej?.contestCapital ?? 0,
        flowCap: 16,
        bAccept: acc?.b ?? CLASS_B[s.proposal.cls],
        bReject: rej?.b ?? CLASS_B[s.proposal.cls],
      });
      log(s, `decide() ran: ${s.decision.outcome.kind}${s.decision.outcome.kind === 'Reject' ? `(${s.decision.outcome.reason})` : ''} at step ${s.decision.stoppedAt}.`, 'transition');
      break;
    }

    case 'setFlag': {
      s.flags[e.flag] = e.value;
      log(s, `${e.flag} ${e.value ? 'engaged' : 'cleared'}.`, 'flag');
      break;
    }

    case 'oracleReport': {
      s.oracle.component = e.component;
      s.oracle.componentName = e.name;
      s.oracle.round = 1;
      s.oracle.reporterValue = e.value;
      s.oracle.bond = 10_000;
      s.oracle.cumulativeBond = 10_000;
      s.oracle.windowEnd = s.block + ORC_WINDOW_BLOCKS;
      s.oracle.acks = 0;
      log(s, `Reporter posts ${e.name} = ${e.value.toFixed(3)}, bonded 10,000 USDC. 72 h challenge window opens.`, 'oracle');
      break;
    }

    case 'oracleChallenge': {
      s.oracle.challengerValue = e.counterValue;
      log(s, `Challenged: counter-value ${e.counterValue.toFixed(3)}, matching bond posted.`, 'oracle');
      break;
    }

    case 'oracleEscalate': {
      s.oracle.round += 1;
      s.oracle.bond *= 2;
      s.oracle.cumulativeBond += s.oracle.bond;
      s.oracle.windowEnd = s.block + ORC_WINDOW_BLOCKS;
      log(
        s,
        `Escalated to round ${s.oracle.round}: bond doubles to ${s.oracle.bond.toLocaleString('en-US')} USDC (cumulative ${s.oracle.cumulativeBond.toLocaleString('en-US')}).`,
        'oracle',
      );
      break;
    }

    case 'oracleAck': {
      s.oracle.acks = e.count;
      if (e.count < 2) {
        s.oracle.extensionUsed = true;
        s.oracle.windowEnd += 2 * BLOCKS_PER_DAY;
        log(s, `Watchtower quorum missing (${e.count} of 2): one +48 h extension granted.`, 'oracle');
      } else {
        log(s, `Watchtower quorum met: ${e.count} acknowledgements.`, 'oracle');
      }
      break;
    }

    case 'oracleSettle': {
      s.oracle.settledPath = e.path;
      s.oracle.settledValue = e.value;
      s.oracle.holdsDecision = false;
      log(s, `Component settled via ${e.path} at ${e.value.toFixed(3)}.`, 'oracle');
      break;
    }

    case 'oracleHoldsDecision': {
      s.oracle.holdsDecision = e.value;
      break;
    }

    case 'registryFile': {
      s.registry.filingId += 1;
      s.registry.severity = e.severity;
      s.registry.bond = e.bond;
      s.registry.incidentMultiplier =
        e.severity === 'S1' ? 0 : e.severity === 'S2' ? 0.6 : 0.9;
      s.registry.state = {
        kind: 'Filed',
        windowEnd: s.block + ORC_WINDOW_BLOCKS,
        extended: false,
        acks: 0,
      };
      log(s, `Incident filed at severity ${e.severity}, bonded ${e.bond.toLocaleString('en-US')} USDC.`, 'registry');
      break;
    }

    case 'registryChallenge': {
      s.registry.state = {
        kind: 'Challenged',
        round: 1,
        windowEnd: s.block + ORC_WINDOW_BLOCKS,
        challenger: 'challenger',
        evidenceHash: '0x…',
      };
      log(s, 'Filing challenged within the 72 h window; the challenger bonds to match.', 'registry');
      break;
    }

    case 'registryResolve': {
      s.registry.state = { kind: e.uphold ? 'Upheld' : 'Rejected' };
      if (!e.uphold) s.registry.incidentMultiplier = 1;
      log(
        s,
        e.uphold
          ? 'Filing upheld. The challenger forfeits its bond; the incident multiplier applies to C at settlement.'
          : 'Filing rejected. The filer forfeits its bond, split between the challenger and INSURANCE. No effect on C.',
        'registry',
      );
      break;
    }

    case 'guardAttempt': {
      s.guard.attempts += 1;
      const failing = s.guard.checks.find((c) => !c.ok);
      s.guard.blockedAt = failing?.n ?? null;
      if (failing === undefined) {
        s.guard.blockedReason = null;
        log(s, 'All fourteen checks aligned. The batch dispatches atomically.', 'guard');
      } else {
        log(s, `execute() refused at check ${failing.n} — ${failing.name}: ${failing.actual}.`, 'guard');
      }
      break;
    }

    case 'guardSetCheck': {
      const c = s.guard.checks.find((x) => x.n === e.n);
      if (c) {
        c.actual = e.actual;
        c.ok = e.ok;
      }
      break;
    }

    case 'vaultResolve': {
      s.vault.state = { kind: 'Resolved', winner: e.winner };
      log(s, `Vault resolved to ${e.winner}. The losing branch's positions are frozen, not burned.`, 'settle');
      break;
    }

    case 'vaultVoid': {
      s.vault.state = { kind: 'Voided' };
      log(
        s,
        'Vault voided. A cross-branch pair still merges at par; unpaired branch-USDC pays half, unpaired legs a quarter.',
        'settle',
      );
      break;
    }

    case 'vaultSettleScalar': {
      s.vault.state = { kind: 'ScalarSettled', winner: e.winner, s: e.s };
      log(s, `Vault settled at s = ${e.s.toFixed(3)} on the ${e.winner} branch.`, 'settle');
      break;
    }

    case 'setWelfare': {
      Object.assign(s.welfare, e.patch);
      recomputeWelfare(s);
      break;
    }

    case 'settleCohort': {
      s.welfare.settlement = e.s;
      log(
        s,
        `Cohort settled at s = ${e.s.toFixed(3)} — the geometric mean of the two measured epochs.`,
        'settle',
      );
      break;
    }

    case 'log': {
      log(s, e.text, e.kind);
      break;
    }
  }

  recomputeWelfare(s);
  return s;
}

/**
 * Replay a scenario up to `cursor` steps. Always from the beginning, because
 * replay from a seed is what makes scrubbing backwards trivially correct.
 */
export function runScenario(
  scenario: Scenario,
  cursor: number,
  cls: ProposalClass,
  title: string,
): SimState {
  let s = initialState(scenario, cls, title);
  const upto = Math.min(cursor, scenario.steps.length);
  for (let i = 0; i < upto; i++) {
    const step = scenario.steps[i]!;
    for (const ev of step.events) s = applyEvent(s, ev);
    s = { ...s, narration: step.narrate, stepTitle: step.title, cursor: i + 1 };
  }
  if (upto === 0) s = { ...s, cursor: 0 };
  return s;
}

export { settlementScore };
