import { cite } from '../protocol/citations';
import type { Scenario } from './types';

/**
 * The six scenarios, declared as data.
 *
 * Each maps onto a real, verified protocol path — none of these labels is a
 * spec term, so each scenario names the mechanism it is actually exercising.
 * Tests replay every one and assert the terminal state against the engine, so
 * the narration cannot drift away from the arithmetic.
 *
 * The numbers in `normal-execution` are the specification's own worked example
 * (doc 04 §12): a TREASURY proposal at b = 25,000 per branch.
 */

const C = {
  lifecycle: cite('05', '§2.1', 'the 26 transitions'),
  decide: cite('05', '§5.4', 'the ordered eleven steps'),
  gates: cite('05', '§5.1', 'gate veto'),
  markets: cite('04', '§12', 'worked numerical example'),
  baseline: cite('04', '§8.5', 'r_eff and the Baseline floor'),
  ledger: cite('03', '§5', 'redemption by vault state'),
  oracle: cite('07', '§5', 'rounds, bonds and challenge windows'),
  registry: cite('07', '§7', 'incident and milestone filings'),
  guard: cite('11', '§11.5', 'the fourteen dispatch-time checks'),
  welfare: cite('05', '§4', 'pillars, W and s'),
  deadman: cite('05', '§4.8', 'dead-man switch'),
};

const D = 14_400; // blocks per day

// ---------------------------------------------------------------------------

const normalExecution: Scenario = {
  id: 'normal-execution',
  title: 'Normal execution',
  premise:
    'A treasury proposal asking 200,000 USDC trades for thirteen days, clears every one of the eleven decision steps, waits out its timelock and is executed by a permissionless keeper. This is the specification’s own worked example.',
  cite: [C.markets, C.decide, C.lifecycle],
  expect: { finalState: 'Settled' },
  steps: [
    {
      id: 'submit',
      title: 'Intake — the bond goes up',
      narrate:
        'The proposer submits during Intake and locks a 5,000 USDC class bond. The bond is not a fee: every decision-grade outcome refunds it in full, because a rejection is information the system wanted to buy.',
      focus: 'lifecycle',
      cite: [C.lifecycle],
      events: [
        { t: 'advanceTo', block: 2 * D },
        { t: 'transition', id: 'T1' },
      ],
    },
    {
      id: 'screen',
      title: 'Qualify — static checks and a slot',
      narrate:
        'A keeper cranks the tick. Static checks pass, the committed preimage is pinned, and the proposal wins one of the five slots — ordered by bond descending, then by id.',
      focus: 'lifecycle',
      cite: [C.lifecycle],
      events: [
        { t: 'advanceTo', block: 3 * D + 100 },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
      ],
    },
    {
      id: 'seed',
      title: 'Seed — seven books open',
      narrate:
        'Six books open for this proposal — two decision, four gate — plus the epoch’s single unconditional Baseline book. Each decision book is seeded with b·ln 2 = 17,329 USDC of headroom, which is also the most the market maker can ever lose on it.',
      focus: 'market-floor',
      cite: [C.markets],
      events: [
        { t: 'advanceTo', block: 4 * D + 200 },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'split', amount: 10_000 },
      ],
    },
    {
      id: 'trade',
      title: 'Trade — thirteen days of pricing',
      narrate:
        'Informed flow moves ACCEPT-LONG to 0.560 and REJECT-LONG to 0.520. These are not odds on a vote: each is the market’s estimate of realised welfare in the world where that branch is taken.',
      focus: 'market-floor',
      cite: [C.markets],
      events: [
        { t: 'advanceTo', block: 17 * D },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.56, twap: 0.562, trailingTwap: 0.562, contestCapital: 400_000, coveragePct: 99 } },
        { t: 'setBook', kind: 'DecisionReject', patch: { spot: 0.52, twap: 0.521, trailingTwap: 0.5222, contestCapital: 400_000, coveragePct: 99 } },
        { t: 'setBook', kind: 'Baseline', patch: { spot: 0.523, twap: 0.523, trailingTwap: 0.523 } },
        { t: 'setBook', kind: 'GateS_Adopt', patch: { spot: 0.011, twap: 0.011, trailingTwap: 0.011 } },
        { t: 'setBook', kind: 'GateS_Reject', patch: { spot: 0.009, twap: 0.009, trailingTwap: 0.009 } },
        { t: 'setBook', kind: 'GateC_Adopt', patch: { spot: 0.017, twap: 0.017, trailingTwap: 0.017 } },
        { t: 'setBook', kind: 'GateC_Reject', patch: { spot: 0.015, twap: 0.015, trailingTwap: 0.015 } },
      ],
    },
    {
      id: 'decide',
      title: 'Decide — eleven steps, in order',
      narrate:
        'r_eff = max(0.5210, 0.5230 − σ) = 0.5210, so the uplift is 0.0410 against a treasury hurdle of 0.0375. The gates price breach risk at about one percent under a five percent cap. Adopt.',
      focus: 'decide-gauntlet',
      cite: [C.decide, C.baseline],
      events: [
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T9' },
      ],
    },
    {
      id: 'timelock',
      title: 'Review — the mandate waits',
      narrate:
        'Adoption enacts nothing. The mandate sits in a three-day treasury timelock, visible to everyone, during which a guardian may suspend it once and only once.',
      focus: 'execution-guard',
      cite: [C.guard],
      events: [{ t: 'advanceTo', block: 21 * D }],
    },
    {
      id: 'execute',
      title: 'Execute — fourteen checks, then dispatch',
      narrate:
        'Anyone may call execute(). All fourteen preconditions are re-read at a single finalized block and all fourteen align, so the batch dispatches atomically.',
      focus: 'execution-guard',
      cite: [C.guard],
      events: [
        { t: 'guardAttempt' },
        { t: 'transition', id: 'T14' },
        { t: 'transition', id: 'T17' },
        { t: 'vaultResolve', winner: 'Accept' },
      ],
    },
    {
      id: 'measure',
      title: 'Measure — two epochs of consequences',
      narrate:
        'The ACCEPT branch was realised, so it is the branch that gets measured. Welfare is observed over the next two epochs while the REJECT branch’s positions sit frozen.',
      focus: 'welfare-engine',
      cite: [C.welfare],
      events: [
        { t: 'advanceTo', block: 21 * D + 302_400 },
        { t: 'setWelfare', patch: { s: 0.99, cOnchain: 0.94, cAttested: 0.98, p: 0.78, a: 0.72 } },
      ],
    },
    {
      id: 'settle',
      title: 'Settle — the score arrives three epochs later',
      narrate:
        's is the geometric mean of the two measured epochs’ welfare. LONG holders receive s per unit, SHORT holders 1 − s, and a complete pair always redeems for exactly its principal.',
      focus: 'welfare-engine',
      cite: [C.welfare, C.ledger],
      events: [
        { t: 'advanceTo', block: 21 * D + 3 * 302_400 },
        { t: 'settleCohort', s: 0.436 },
        { t: 'vaultSettleScalar', winner: 'Accept', s: 0.436 },
        { t: 'transition', id: 'T19' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const gateFailure: Scenario = {
  id: 'gate-failure',
  title: 'Gate failure',
  premise:
    'The same proposal, but the survival gate books price a real chance that adopting it breaks block production. The gate veto runs at step 4 — before any welfare comparison exists — so a large uplift cannot buy its way past.',
  cite: [C.gates, C.decide],
  expect: { finalState: 'Measuring', rejectReason: 'GateVetoSurvival', stoppedAt: 4 },
  steps: [
    {
      id: 'setup',
      title: 'A proposal with a strong headline case',
      narrate:
        'This proposal trades even better than the last one: ACCEPT reaches 0.62 against a REJECT of 0.52. On welfare alone it would pass comfortably.',
      focus: 'market-floor',
      cite: [C.markets],
      events: [
        { t: 'advanceTo', block: 4 * D },
        { t: 'transition', id: 'T1' },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'split', amount: 10_000 },
        { t: 'advanceTo', block: 17 * D },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.62, twap: 0.62, trailingTwap: 0.62, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'DecisionReject', patch: { spot: 0.52, twap: 0.52, trailingTwap: 0.52, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'Baseline', patch: { spot: 0.523, twap: 0.523, trailingTwap: 0.523 } },
      ],
    },
    {
      id: 'gate-prices',
      title: 'The survival gate prices a real risk',
      narrate:
        'Traders in the GateS-Adopt book put a 6.2% chance on the survival floor being breached on at least one day if this is adopted — against 0.9% if it is rejected. The gate cap is 5%.',
      focus: 'market-floor',
      cite: [C.gates],
      events: [
        { t: 'setBook', kind: 'GateS_Adopt', patch: { spot: 0.062, twap: 0.062, trailingTwap: 0.062 } },
        { t: 'setBook', kind: 'GateS_Reject', patch: { spot: 0.009, twap: 0.009, trailingTwap: 0.009 } },
        { t: 'setBook', kind: 'GateC_Adopt', patch: { spot: 0.017, twap: 0.017, trailingTwap: 0.017 } },
        { t: 'setBook', kind: 'GateC_Reject', patch: { spot: 0.015, twap: 0.015, trailingTwap: 0.015 } },
      ],
    },
    {
      id: 'veto',
      title: 'Step 4 stops it, and steps 6–8 never run',
      narrate:
        'Two independent tests fire: the price exceeds the absolute 5% cap, and it exceeds the reject leg by more than ε = 0.02. The uplift of 0.10 is never computed, because the ruin gates precede all upside weighing.',
      focus: 'decide-gauntlet',
      cite: [C.decide, C.gates],
      events: [
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T10', reason: 'GateVetoSurvival' },
      ],
    },
    {
      id: 'measured',
      title: 'Rejection is not the end — it is measured too',
      narrate:
        'T21 fires in the same block: the vault resolves to REJECT and the reject branch trades on through measurement. Rejection followed by measurement is the most common healthy path in this protocol, not an error state.',
      focus: 'lifecycle',
      cite: [C.lifecycle],
      events: [
        { t: 'transition', id: 'T21' },
        { t: 'vaultResolve', winner: 'Reject' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const oracleDispute: Scenario = {
  id: 'oracle-dispute',
  title: 'Oracle dispute',
  premise:
    'A bonded reporter posts a welfare component value. A challenger says it is wrong. Bonds double each round for at most three rounds, and while the dispute is live and merit-bonded it holds the decision itself — not merely the money.',
  cite: [C.oracle, C.decide],
  expect: { finalState: 'Measuring', rejectReason: 'ProcessHold', stoppedAt: 2 },
  steps: [
    {
      id: 'report',
      title: 'Round 1 — a bonded report',
      narrate:
        'A registered reporter, staking 100,000 USDC to hold the seat at all, posts H = 0.720 with an evidence hash and a 10,000 USDC round bond. A 72-hour challenge window opens.',
      focus: 'oracle-disputes',
      cite: [C.oracle],
      events: [
        { t: 'advanceTo', block: 4 * D },
        { t: 'transition', id: 'T1' },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'advanceTo', block: 15 * D },
        { t: 'oracleReport', component: 4, name: 'H — weight headroom', value: 0.72 },
      ],
    },
    {
      id: 'challenge',
      title: 'A challenger disagrees, and pays to say so',
      narrate:
        'The challenger posts 0.410 and matches the bond. Disagreement is not free in either direction: whoever is wrong forfeits, with 40% going to the winner and 60% to insurance.',
      focus: 'oracle-disputes',
      cite: [C.oracle],
      events: [
        { t: 'advanceTo', block: 15 * D + 600 },
        { t: 'oracleChallenge', counterValue: 0.41 },
        { t: 'oracleHoldsDecision', value: true },
      ],
    },
    {
      id: 'watchtowers',
      title: 'Watchtowers fail to acknowledge',
      narrate:
        'Only one of the two required watchtower acknowledgements arrives, so the window is extended once by 48 hours. Watchtowers are the observability quorum — they do not adjudicate, they attest that the round was seen.',
      focus: 'oracle-disputes',
      cite: [C.oracle],
      events: [{ t: 'oracleAck', count: 1 }],
    },
    {
      id: 'escalate',
      title: 'Rounds 2 and 3 — the bond doubles each time',
      narrate:
        'Escalation costs 20,000 then 40,000 USDC, so a cumulative 70,000 is at risk by round three. The ladder is designed so that being repeatedly wrong is ruinous and being repeatedly right is profitable.',
      focus: 'oracle-disputes',
      cite: [C.oracle],
      events: [
        { t: 'advanceTo', block: 18 * D - 200 },
        { t: 'oracleEscalate' },
        { t: 'oracleEscalate' },
      ],
    },
    {
      id: 'hold',
      title: 'The decision refuses to run',
      narrate:
        'decide() reaches step 2 and stops. An open merit-bonded dispute touching this proposal’s frozen metric spec means the inputs are not trustworthy, so the answer is Reject(ProcessHold) — a full refund and a resubmission, never a guess.',
      focus: 'decide-gauntlet',
      cite: [C.decide],
      events: [
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T20', reason: 'ProcessHold' },
        { t: 'transition', id: 'T21' },
        { t: 'vaultResolve', winner: 'Reject' },
      ],
    },
    {
      id: 'adjudicate',
      title: 'The dispute settles afterwards, on its own clock',
      narrate:
        'The terminal round goes to a token-holder ballot on the oracle track, voted on a pre-cohort snapshot so capital that arrived after the fact carries no weight. The challenger was right; the reporter’s bond is forfeit.',
      focus: 'oracle-disputes',
      cite: [C.oracle],
      events: [
        { t: 'advanceTo', block: 22 * D },
        { t: 'oracleSettle', path: 'Adjudicated', value: 0.41 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const registryDispute: Scenario = {
  id: 'registry-dispute',
  title: 'Registry dispute',
  premise:
    'Someone files a bonded claim that a severity-2 incident occurred. The contrast with the oracle dispute is the whole point: a registry sub-game holds settlement, never a decision.',
  cite: [C.registry, C.welfare],
  expect: { finalState: 'Settled' },
  steps: [
    {
      id: 'file',
      title: 'A bonded filing about an off-chain fact',
      narrate:
        'Incidents are facts the chain cannot see for itself, so they enter through a bonded, challengeable filing rather than through a trusted feed. This one claims a severity-2 incident, bonded at 5,000 USDC.',
      focus: 'oracle-disputes',
      cite: [C.registry],
      events: [
        { t: 'advanceTo', block: 4 * D },
        { t: 'transition', id: 'T1' },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'advanceTo', block: 16 * D },
        { t: 'registryFile', severity: 'S2', bond: 5_000 },
      ],
    },
    {
      id: 'challenge',
      title: 'Challenged inside the 72-hour window',
      narrate:
        'A challenger bonds to match and disputes the severity. The same window, the same bond symmetry and the same watchtower acknowledgements as the oracle game — a deliberately shared shape.',
      focus: 'oracle-disputes',
      cite: [C.registry],
      events: [
        { t: 'advanceTo', block: 16 * D + 400 },
        { t: 'registryChallenge' },
      ],
    },
    {
      id: 'decides-anyway',
      title: 'The decision runs regardless',
      narrate:
        'This is the contrast. An open registry filing does not touch step 2, so the proposal is decided on schedule and adopted. Registry disputes bear on what the world was worth, not on whether the decision may be taken.',
      focus: 'decide-gauntlet',
      cite: [C.decide, C.registry],
      events: [
        { t: 'advanceTo', block: 17 * D },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.575, twap: 0.575, trailingTwap: 0.575, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'DecisionReject', patch: { spot: 0.52, twap: 0.52, trailingTwap: 0.52, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'Baseline', patch: { spot: 0.523, twap: 0.523, trailingTwap: 0.523 } },
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T9' },
        { t: 'advanceTo', block: 21 * D },
        { t: 'guardAttempt' },
        { t: 'transition', id: 'T14' },
        { t: 'transition', id: 'T17' },
        { t: 'vaultResolve', winner: 'Accept' },
      ],
    },
    {
      id: 'resolve',
      title: 'Resolved — and only now does it bite',
      narrate:
        'The filing is upheld. The incident score is a pure multiplier on the C pillar with no ε floor beneath it, so a severity-2 finding pulls realised welfare down hard — and a severity-1 finding would zero it outright.',
      focus: 'welfare-engine',
      cite: [C.registry, C.welfare],
      events: [
        { t: 'advanceTo', block: 19 * D },
        { t: 'registryResolve', uphold: true },
        { t: 'setWelfare', patch: { cAttested: 0.6 } },
      ],
    },
    {
      id: 'settle',
      title: 'Settlement pays the lower number',
      narrate:
        'Everyone who priced this world optimistically is paid at the score the world actually earned. The filing changed the payout without ever having changed the decision.',
      focus: 'welfare-engine',
      cite: [C.welfare],
      events: [
        { t: 'advanceTo', block: 21 * D + 3 * 302_400 },
        { t: 'settleCohort', s: 0.201 },
        { t: 'vaultSettleScalar', winner: 'Accept', s: 0.201 },
        { t: 'transition', id: 'T19' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const delayedResolution: Scenario = {
  id: 'delayed-resolution',
  title: 'Delayed resolution',
  premise:
    'Nine distinct mechanisms can delay a resolution. This walks the three that matter most: the one-per-proposal extension, a guardian delay followed by a rerun on tougher terms, and the dead-man switch extending every open window day for day.',
  cite: [C.decide, C.lifecycle, C.deadman],
  expect: { finalState: 'Queued' },
  steps: [
    {
      id: 'thin',
      title: 'The market is too thin to decide on',
      narrate:
        'Observation gaps have left coverage at 91%, below the 95% the decision rule requires. The books have a price, but not one worth deciding on.',
      focus: 'market-floor',
      cite: [C.markets],
      events: [
        { t: 'advanceTo', block: 4 * D },
        { t: 'transition', id: 'T1' },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'advanceTo', block: 17 * D },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.55, twap: 0.55, trailingTwap: 0.55, coveragePct: 91, staleEvents: 1, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'DecisionReject', patch: { spot: 0.52, twap: 0.52, trailingTwap: 0.52, coveragePct: 91, contestCapital: 400_000 } },
        { t: 'setBook', kind: 'Baseline', patch: { spot: 0.523, twap: 0.523, trailingTwap: 0.523 } },
      ],
    },
    {
      id: 'extend',
      title: 'T8 — the one extension this proposal will ever get',
      narrate:
        'Step 5 grades the books Insufficient and returns Extend: three more days of trading. There is exactly one extension budget per proposal and it is shared across every cause, so a second insufficiency always rejects rather than extending again.',
      focus: 'decide-gauntlet',
      cite: [C.decide],
      events: [
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T8' },
      ],
    },
    {
      id: 'deadman',
      title: 'The dead-man switch engages',
      narrate:
        'The relay advances 4,800 blocks without anchoring a parachain block. The execution queue freezes, the epoch clock pauses, and every open decision window extends day for day — the chain waits rather than deciding on stale inputs.',
      focus: 'epoch-clock',
      cite: [C.deadman],
      events: [
        { t: 'advanceTo', block: 19 * D },
        { t: 'setFlag', flag: 'deadManEngaged', value: true },
      ],
    },
    {
      id: 'recover',
      title: 'Recovery, then a decision that passes',
      narrate:
        'Collators return and the switch clears after one proposal-free recovery epoch. With coverage restored the extended window is decision-grade, and the proposal is adopted.',
      focus: 'epoch-clock',
      cite: [C.deadman],
      events: [
        { t: 'advanceTo', block: 20 * D },
        { t: 'setFlag', flag: 'deadManEngaged', value: false },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.575, twap: 0.575, trailingTwap: 0.575, coveragePct: 99, staleEvents: 1 } },
        { t: 'advanceTo', block: 21 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T9' },
      ],
    },
    {
      id: 'guardian-delay',
      title: 'A guardian suspends the queued mandate — once',
      narrate:
        'Five of seven guardians suspend the mandate with a justification hash. They cannot change the outcome, move funds, or enact anything; the single power here is to make the market look again. Every such action is retro-ratified, and a failed review slashes half of every approver’s bond.',
      focus: 'execution-guard',
      cite: [C.lifecycle],
      events: [
        { t: 'advanceTo', block: 22 * D },
        { t: 'transition', id: 'T11' },
      ],
    },
    {
      id: 'rerun',
      title: 'T12 → T13 — a rerun on harder terms',
      narrate:
        'The review window closes with no veto upheld, so the books reopen at twice the protocol liquidity for one final three-day window, with the hurdle raised by a full percentage point. Positions and prices survive; the accumulators reset.',
      focus: 'lifecycle',
      cite: [C.lifecycle],
      events: [
        { t: 'advanceTo', block: 24 * D },
        { t: 'transition', id: 'T12' },
        { t: 'transition', id: 'T13' },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.585, twap: 0.585, trailingTwap: 0.585 } },
      ],
    },
    {
      id: 'final',
      title: 'It clears the higher bar',
      narrate:
        'Uplift of 0.062 against a hurdle raised to 0.0475. Adopted a second time, queued a second time — roughly three weeks later than an undisputed proposal would have been.',
      focus: 'decide-gauntlet',
      cite: [C.decide],
      events: [
        { t: 'advanceTo', block: 27 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T9' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const blockedExecution: Scenario = {
  id: 'blocked-execution',
  title: 'Blocked execution',
  premise:
    'An adopted mandate is not an enacted one. Fourteen preconditions are re-read at dispatch, and this proposal fails several of them in turn — some recoverable, one terminal.',
  cite: [C.guard, C.lifecycle],
  expect: { finalState: 'Measuring', rejectReason: 'StaleQueue' },
  steps: [
    {
      id: 'queued',
      title: 'Adopted and queued',
      narrate:
        'A CODE proposal clears all eleven decision steps and enters a seven-day timelock. Nothing has been enacted; the authorization is only a permission to try.',
      focus: 'execution-guard',
      cite: [C.guard],
      events: [
        { t: 'advanceTo', block: 4 * D },
        { t: 'transition', id: 'T1' },
        { t: 'transition', id: 'T3' },
        { t: 'transition', id: 'T5' },
        { t: 'transition', id: 'T7' },
        { t: 'seedMarkets' },
        { t: 'advanceTo', block: 17 * D },
        { t: 'setBook', kind: 'DecisionAccept', patch: { spot: 0.6, twap: 0.6, trailingTwap: 0.6, contestCapital: 900_000 } },
        { t: 'setBook', kind: 'DecisionReject', patch: { spot: 0.52, twap: 0.52, trailingTwap: 0.52, contestCapital: 900_000 } },
        { t: 'setBook', kind: 'Baseline', patch: { spot: 0.523, twap: 0.523, trailingTwap: 0.523 } },
        { t: 'advanceTo', block: 18 * D },
        { t: 'runDecide' },
        { t: 'transition', id: 'T9' },
      ],
    },
    {
      id: 'not-ratified',
      title: 'Check 5 — not ratified, and that is recoverable',
      narrate:
        'A CODE mandate also needs a token-holder ratification referendum. It has not passed yet, so execute() refuses with NotRatified and changes no state at all: the proposal stays Queued and remains retryable until its grace period ends.',
      focus: 'execution-guard',
      cite: [C.guard],
      events: [
        { t: 'advanceTo', block: 25 * D },
        { t: 'guardSetCheck', n: 5, actual: 'no passed referendum record', ok: false },
        { t: 'guardAttempt' },
      ],
    },
    {
      id: 'ratified-then-frozen',
      title: 'Checks 11 and 12 — a gate breach and a ledger freeze',
      narrate:
        'Ratification passes, but a daily survival-floor breach has been recorded and guardians have activated PB-LEDGER-FREEZE. Both are safety states, and both refuse in a fixed order so the reason a user sees is always the same one the chain would give.',
      focus: 'execution-guard',
      cite: [C.guard],
      events: [
        { t: 'advanceTo', block: 26 * D },
        { t: 'guardSetCheck', n: 5, actual: 'referendum approved', ok: true },
        { t: 'setFlag', flag: 'gateBreachS', value: true },
        { t: 'setFlag', flag: 'ledgerFrozen', value: true },
        { t: 'guardSetCheck', n: 11, actual: 'survival breach flag active', ok: false },
        { t: 'guardSetCheck', n: 12, actual: 'PB-LEDGER-FREEZE active', ok: false },
        { t: 'guardAttempt' },
      ],
    },
    {
      id: 'stale',
      title: 'Check 4 — the runtime moved on, and now it is terminal',
      narrate:
        'The freeze lifts, but a runtime upgrade has shipped in the meantime and the queued payload was built against the previous spec version. That is not recoverable: T16 rejects it as StaleQueue and the bond is refunded.',
      focus: 'execution-guard',
      cite: [C.guard, C.lifecycle],
      events: [
        { t: 'advanceTo', block: 30 * D },
        { t: 'setFlag', flag: 'ledgerFrozen', value: false },
        { t: 'setFlag', flag: 'gateBreachS', value: false },
        { t: 'guardSetCheck', n: 11, actual: 'no active breach flag', ok: true },
        { t: 'guardSetCheck', n: 12, actual: 'clear', ok: true },
        { t: 'guardSetCheck', n: 4, actual: 'spec_version 42, payload built for 41', ok: false },
        { t: 'guardAttempt' },
        { t: 'transition', id: 'T16', reason: 'StaleQueue' },
      ],
    },
    {
      id: 'measured',
      title: 'And it is still measured',
      narrate:
        'T21 fires: the vault resolves to REJECT and the counterfactual is measured anyway. A payload that never executed still teaches the system what not executing it was worth.',
      focus: 'lifecycle',
      cite: [C.lifecycle],
      events: [
        { t: 'transition', id: 'T21' },
        { t: 'vaultResolve', winner: 'Reject' },
      ],
    },
  ],
};

export const SCENARIOS = {
  'normal-execution': normalExecution,
  'gate-failure': gateFailure,
  'oracle-dispute': oracleDispute,
  'registry-dispute': registryDispute,
  'delayed-resolution': delayedResolution,
  'blocked-execution': blockedExecution,
} as const;

export const SCENARIO_ORDER = [
  'normal-execution',
  'gate-failure',
  'oracle-dispute',
  'registry-dispute',
  'delayed-resolution',
  'blocked-execution',
] as const;

/** Which proposal class each scenario uses, and its human title. */
export const SCENARIO_SUBJECT = {
  'normal-execution': { cls: 'Treasury', title: 'Fund the light-client audit — 200,000 USDC' },
  'gate-failure': { cls: 'Treasury', title: 'Raise the collator target to 12' },
  'oracle-dispute': { cls: 'Treasury', title: 'Fund an indexer grant — 200,000 USDC' },
  'registry-dispute': { cls: 'Treasury', title: 'Fund a security retainer — 200,000 USDC' },
  'delayed-resolution': { cls: 'Treasury', title: 'Increase the POL budget' },
  'blocked-execution': { cls: 'Code', title: 'Runtime upgrade to spec_version 42' },
} as const;
