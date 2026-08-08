import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { ParamRow } from '../../protocol/params';
import { param } from '../../protocol/params';
import { formatDuration, formatDurationHuman } from '../../protocol/epoch';
import { spec, simulated, derived } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-border.css';

/**
 * The border — doc 09 §6 (the XCM rule table and the client-ingress template),
 * doc 09 §5.2 (the Phase-3 inflow caps), doc 07 §8 (the reserve probe) and
 * doc 09 §4 (coretime renewal).
 *
 * One idea carries this scene: **this chain does not hold dollars.** USDC is
 * issued on Asset Hub and stays locked there; what Bleavit holds is a claim on
 * the locked money. Everything that crosses arrives as a message, and a message
 * is not a request the chain interprets — it is matched against a short written
 * list and discarded if it is not on it. That is the difference between "we
 * checked for the attacks we thought of" and "we enumerated what is allowed",
 * and it is why the drawing is a **wall** rather than a filter.
 *
 * The picture the canvas has to carry, and a table cannot, is *precedence in
 * space*: outside is refused by default, one gate is the only way in, the toll
 * is posted on the far side of it, and the caps are read **before** anything is
 * created rather than after. A list of rules loses that ordering entirely; a
 * reader who sees a cap meter drawn behind a toll booth behind a gate does not
 * have to be told which happens first.
 *
 * A second opening in the same wall is the rent hatch, and it is the one thing
 * on the canvas that faces outward. A parachain buys its block-production time,
 * and a chain that misses a renewal stops producing blocks — so that one call is
 * exempt from every protocol-level freeze the system has. The picture says it in
 * one glance: whatever else is shut, that hatch is not.
 *
 * Canvas labels stay inside the twelve-character budget and stay ordinary
 * ("Per second", not `xcm.usdc_per_sec`). Every parameter key, bound and
 * citation lives in the rail, behind a closed drawer.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/** The normative v1 XCM rule table: origins, barrier, assets, reserve model, fees. */
const C_RULES: Citation = cite('09', '§6.1', 'the normative v1 XCM rule table');
/** The exit leg: an ordinary signed call, and withdrawals are never capped. */
const C_EXIT: Citation = cite('09', '§6.2', 'limited_reserve_transfer_assets is the canonical exit');
/** What this chain must provide so a guided deposit can exist at all. */
const C_ONRAMP: Citation = cite('09', '§6.3', 'the Asset Hub on-ramp obligations');
/** The two Phase-3 exposure caps, and the rule that both bind before any mint. */
const C_CAPS: Citation = cite('09', '§5.2', 'phase3.tvl_cap and phase3.deposit_cap, enforced before any local mint');
/** The one inbound `Transact` path, admitted by a six-position whole-program match. */
const C_INGRESS: Citation = cite('09', '§6.5', 'the client-ingress positional template');
/** Only three XCM signals are runtime-readable, and all three are local. */
const C_HEALTH: Citation = cite('09', '§6.4', 'XCM health X and reserve health R');
/** The probe, its scoring, and what a failed streak arms. */
const C_PROBE: Citation = cite('07', '§8', 'the reserve probe, fail-static scoring and PB-RESERVE');
/** Coretime renewal: permissionless, budget-line-bounded, freeze-exempt. */
const C_CORETIME: Citation = cite('09', '§4', 'execute_coretime_renewal — permissionless and freeze-exempt');
/** The Asset Hub surfaces a release pins, including where USDC lives. */
const C_AH: Citation = cite('02', '§7.7', 'the Asset Hub foreign-chain surface, pinned per release');

/** The barrier as built, so the allowed shapes are read off the runtime, not off prose. */
const C_BARRIER_CODE: Citation = cite(
  'code',
  'runtime/bleavit-xcm/src/barrier.rs',
  'DenyTransact, DenyUnsupportedInstructions, DenyOverCapInflows, then the paid-execution allowlist',
);
/** The trader as built: purchases round up, refunds round down, both against the payer. */
const C_TRADER_CODE: Citation = cite(
  'code',
  'runtime/bleavit-xcm/src/trader.rs',
  'GovernedWeightTrader — price_up on purchase, price_down on refund',
);
/** The cumulative per-account meter the deposit leg writes through. */
const C_CAPS_CODE: Citation = cite(
  'code',
  'pallets/inflow-caps/src/lib.rs',
  'the pure admission reads and the single cumulative write',
);

// ---------------------------------------------------------------------------
// The parameters this scene depends on
// ---------------------------------------------------------------------------

/**
 * Read from the registry, never restated.
 *
 * Doc 13 is the only home for a value, and this app's local form of that rule is
 * that a scene may print `param(key).value` and may not print the number. The
 * four `xcm.*` rows below are literally the price posted on the gate, so the
 * canvas builds its own sublabels out of them too.
 */
const XCM_USDC_SEC = param('xcm.usdc_per_sec');
const XCM_USDC_MB = param('xcm.usdc_per_mb');
const XCM_DOT_SEC = param('xcm.dot_per_sec');
const XCM_DOT_MB = param('xcm.dot_per_mb');
const TVL_CAP = param('phase3.tvl_cap');
const DEP_CAP = param('phase3.dep_cap');
const PROBE_INT = param('res.probe_int');
const PROBE_TO = param('res.probe_to');
const PROBE_AMOUNT = param('res.probe_amount');
const PROBE_FAIL = param('res.fail_thr');
const PROBE_RECOVER = param('res.recover_thr');
const CT_RATE = param('ops.ct_dot_rate');
const CT_FEE = param('ops.ct_fee_dot');
const CT_TTL = param('ops.ct_quote_ttl');

/** The four rows that are the posted price, in the order the toll board shows them. */
const TOLL_ROWS: readonly ParamRow[] = [XCM_USDC_SEC, XCM_USDC_MB, XCM_DOT_SEC, XCM_DOT_MB];

/** The five rows that govern the daily round trip. */
const PROBE_ROWS: readonly ParamRow[] = [
  PROBE_INT,
  PROBE_TO,
  PROBE_AMOUNT,
  PROBE_FAIL,
  PROBE_RECOVER,
];

/** The three rows that govern the rent. */
const RENT_ROWS: readonly ParamRow[] = [CT_RATE, CT_FEE, CT_TTL];

/** µUSDC per whole USDC, and planck per whole DOT — display conversions only. */
const MICRO = 1_000_000;
const PLANCK = 10_000_000_000;

/**
 * The exact instruction families the built barrier accepts.
 *
 * Read off `DenyUnsupportedInstructions::all_supported_bounded`, in its own
 * order, so the rail cannot come to disagree with the runtime about what gets
 * in. Everything absent from this list is refused — that is the whole design,
 * and it is why the list is short enough to print.
 */
const ALLOWED_SHAPES: readonly { readonly name: string; readonly does: string }[] = [
  { name: 'ReserveAssetDeposited', does: 'Credits a claim here, because the same amount was just locked next door. This is a deposit arriving.' },
  { name: 'WithdrawAsset', does: 'Takes money out of the sending chain’s own account here, without creating any.' },
  { name: 'BuyExecution / PayFees', does: 'Pays for the work the rest of the message will cost, at the posted price.' },
  { name: 'RefundSurplus', does: 'Gives back the part of that payment the message did not use.' },
  { name: 'DepositAsset', does: 'Puts what is left into somebody’s account here. This is the step the caps meter.' },
  { name: 'ClaimAsset', does: 'Picks up money an earlier failed message left stranded. Only whoever it was stranded under may claim it.' },
  { name: 'QueryResponse', does: 'The answer to a question this chain asked. The daily reserve test comes back this way.' },
  { name: 'ReportError', does: 'Asks for an answer to be sent back, which is how the test above gets one.' },
  { name: 'ClearOrigin', does: 'Drops the sender’s authority for the rest of the message. It can only ever reduce what follows.' },
  { name: 'SubscribeVersion / UnsubscribeVersion', does: 'Agrees which version of the language the two chains speak.' },
  { name: 'SetFeesMode', does: 'Says whether fees come out of the money in hand or are taken as needed.' },
  { name: 'SetTopic / ClearTopic', does: 'Tags the message so both sides can refer to it later.' },
  {
    name: 'TransferReserveAsset / DepositReserveAsset / InitiateReserveWithdraw / InitiateTeleport',
    does: 'The four shapes an ordinary transfer between chains is built out of. Each one carries a second program for the far side, and that program is checked against this same list before anything runs.',
  },
  {
    name: 'SetAppendix / SetErrorHandler',
    does: 'Attach a program to run at the end, or to run if something fails. Their contents are checked against this same list too — a forbidden shape cannot hide inside a permitted one.',
  },
];

/**
 * The refusals a reader is most likely to have expected to work.
 *
 * `Transact` and `UnpaidExecution` are refused by `DenyTransact` at **every**
 * nesting depth, not merely at the top level, and the two are the ones worth
 * naming: one is "run one of your own transactions for me", the other is "let me
 * in for free".
 */
const REFUSED_SHAPES: readonly { readonly name: string; readonly why: string }[] = [
  {
    name: 'Transact',
    why: 'Run one of this chain’s own transactions. Refused from every sender and at every depth of nesting — the only exception is one exact six-instruction message shape published for paying clients.',
  },
  {
    name: 'UnpaidExecution',
    why: 'Do this work for free. There is no allow path for it, so a message with no money in it is discarded rather than run on credit.',
  },
  {
    name: 'DescendOrigin / AliasOrigin',
    why: 'Act as somebody else, or as a sub-identity of yourself. Neither is on the list, so both fail.',
  },
  {
    name: 'InitiateTransfer / ExportMessage / ExecuteWithOrigin',
    why: 'Three ways of carrying a hidden inner program. None appears in the accepted set, so none of them decodes to anything this chain will run.',
  },
  {
    name: 'Teleport, in either direction',
    why: 'Destroy a coin here and re-create it there. This chain trusts no teleport, so the only way a dollar moves is by being locked where it is issued.',
  },
];

/**
 * The key to the drawing, in plain words.
 *
 * Every object on the canvas has a row here, and `domRowId` on the node points
 * at it. Two things follow, and both are the reason it is a declared table
 * rather than prose: a reader who cannot tell what a box is has somewhere to
 * look, and a mark can never end up on the stage with nothing that explains it —
 * the bijection is asserted in the tests.
 */
const DRAWING_KEY: readonly { readonly row: string; readonly mark: string; readonly means: string }[] = [
  {
    row: 'border-row-assethub',
    mark: 'Asset Hub',
    means: 'The neighbouring chain where the dollars are issued and stay locked. It is drawn full because nothing ever drains out of it — only claims on it travel.',
  },
  {
    row: 'border-row-deposit',
    mark: 'Deposit',
    means: 'A message saying dollars were just locked next door, so credit a matching claim here. This is the one arriving shape that creates anything.',
  },
  {
    row: 'border-row-transact',
    mark: 'Transact',
    means: 'A message asking this chain to run one of its own transactions. Refused however deeply it is buried inside another message.',
  },
  {
    row: 'border-row-unpaid',
    mark: 'Unpaid',
    means: 'A message asking to be run for free. There is no path that grants it, so it is thrown away.',
  },
  {
    row: 'border-row-coretime',
    mark: 'Coretime',
    means: 'The chain that sells block-production time. It is where the rent goes, and it is the only place the outbound hatch leads.',
  },
  {
    row: 'border-row-wall',
    mark: 'The wall',
    means: 'Everything that is refused by default — which is everything the written list does not name. Drawn as one wall because it is one rule.',
  },
  {
    row: 'border-row-gate',
    mark: 'One gate',
    means: 'The only way in. A message is matched against the list here, and either goes through whole or does not go through at all.',
  },
  {
    row: 'border-row-rent',
    mark: 'Rent hatch',
    means: 'A second opening, outbound only, that no emergency stop in the system may close. The rent leaves through it.',
  },
  {
    row: 'border-row-toll-time',
    mark: 'Per second',
    means: 'The first half of the posted price: what a second of this chain’s working time costs the message that is using it.',
  },
  {
    row: 'border-row-toll-proof',
    mark: 'Per MiB',
    means: 'The second half: what a mebibyte of evidence costs. A message can be cheap in one half and expensive in the other.',
  },
  {
    row: 'border-row-tvl-cap',
    mark: 'Chain cap',
    means: 'How full the ceiling on every claim held here is. Read before a claim is created, never after.',
  },
  {
    row: 'border-row-dep-cap',
    mark: 'Person cap',
    means: 'How full one account’s own ceiling is. It counts everything ever brought in, so spending does not make room.',
  },
  {
    row: 'border-row-probe',
    mark: 'Daily probe',
    means: 'The round trip that tests whether money can still move. It turns red only when it has failed twice in a row.',
  },
  {
    row: 'border-row-renewal',
    mark: 'The rent',
    means: 'The one payment anybody may make and nothing may block, because missing it stops the chain.',
  },
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * The wall runs down x ≈ 5 and the stage reads left to right: next door, the
 * wall, then this chain.
 *
 * Two openings, and their heights are load-bearing rather than decorative. Every
 * edge on this canvas is routed orthogonally through the midpoint of the two
 * nodes it joins, so an edge crosses the wall at a height this layout chooses —
 * and each of the four crossings is placed inside an opening on purpose. A
 * crossing that landed on solid wall would draw the exact claim this scene
 * denies.
 */
const WALL_X = 4.9;
const WALL_W = 0.45;

/** The gate: the only way in, and the way the daily test leaves. */
const GATE_LO = 6.0;
const GATE_HI = 9.0;
/** The rent hatch: outbound only, and open through every stop the system has. */
const HATCH_LO = 0.3;
const HATCH_HI = 2.4;

/** Left column — everything outside, at one width so the four boxes read as a set. */
const OUT_X = 0.4;
const OUT_W = 2.6;

/** Right column x positions, in the order a deposit meets them. */
const TOLL_X = 6.9;
const TOLL_W = 3.0;
const CAP_W = 1.6;
const CAP_GLOBAL_X = 10.9;
/** Three units of pitch, not two: `Chain cap` and `Person cap` collide at 2.7. */
const CAP_ACCOUNT_X = 13.9;
const CAP_LO = 5.4;
const CAP_H = 3.6;
const FAR_X = 16.6;
const FAR_W = 3.4;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Thousands separators without `toLocaleString`, which is locale-dependent. */
const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Group an integer, and leave a fraction alone.
 *
 * The guard is not cosmetic: the grouping expression matches inside a decimal
 * tail as happily as inside an integer, and `res.probe_amount`'s floor of one
 * millionth of a dollar prints as `0.000,001` without it — a number that reads
 * as a thousand times itself.
 */
const num = (v: number): string => (Number.isInteger(v) ? group(v) : String(v));
const pct2 = (v: number): string => v.toFixed(2);
const pct0 = (v: number): string => v.toFixed(0);

/**
 * The dollars this example has brought across, in whole USDC.
 *
 * The simulation escrows collateral rather than tracking deposits, so this is
 * the escrowed total read as "at least this much had to cross the border first".
 * It is invented for the scenario and is labelled as such wherever it is printed.
 */
export function crossed(sim: SimState): number {
  return sim.vault.escrowed;
}

/** A plain box: an arriving message, or a thing sitting inside the chain. */
function box(
  id: string,
  domRowId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  sublabel: string,
  refused: boolean,
): SceneNode {
  return {
    id,
    kind: 'node',
    x,
    y,
    w,
    h,
    tone: refused ? 'dim' : 'ink',
    state: refused ? 'blocked' : 'passed',
    label,
    sublabel,
    domRowId,
  };
}

/**
 * The scene model.
 *
 * Exported for tests: the two cap plates read their fill from the scenario, and
 * the geometry has properties (every edge crosses at an opening; no node leaves
 * the stage) that are cheaper to assert than to re-check by eye.
 */
export function buildModel(sim: SimState): SceneModel {
  const brought = crossed(sim);
  const impaired = sim.flags.reserveImpaired;

  const nodes: SceneNode[] = [
    // --- outside: where the money is, what arrives, and where the rent goes ---
    {
      id: 'asset-hub',
      kind: 'plate',
      x: OUT_X,
      y: 9.3,
      w: OUT_W,
      h: 2.2,
      tone: 'ink',
      state: 'active',
      fill: 1,
      label: 'Asset Hub',
      sublabel: 'the dollars stay here',
      domRowId: 'border-row-assethub',
    },
    // The three arriving shapes sit clear of the round-trip line, which runs
    // back to Asset Hub at the height of the gate.
    box('msg-ok', 'border-row-deposit', OUT_X, 6.2, OUT_W, 0.9, 'Deposit', 'a claim, not a coin', false),
    box('msg-transact', 'border-row-transact', OUT_X, 4.4, OUT_W, 0.65, 'Transact', 'refused at any depth', true),
    box('msg-unpaid', 'border-row-unpaid', OUT_X, 2.6, OUT_W, 0.65, 'Unpaid', 'refused: no fee in it', true),
    box('coretime', 'border-row-coretime', OUT_X, 0.5, OUT_W, 0.9, 'Coretime', 'where the rent is paid', false),

    // --- the wall, and its two openings ------------------------------------
    {
      id: 'wall-high',
      kind: 'stop',
      x: WALL_X,
      y: GATE_HI,
      w: WALL_W,
      h: 11.6 - GATE_HI,
      tone: 'dim',
      state: 'active',
      label: 'The wall',
      sublabel: 'nothing else gets in',
      domRowId: 'border-row-wall',
    },
    {
      id: 'wall-mid',
      kind: 'stop',
      x: WALL_X,
      y: HATCH_HI,
      w: WALL_W,
      h: GATE_LO - HATCH_HI,
      tone: 'dim',
      state: 'active',
      domRowId: 'border-row-wall',
    },
    {
      id: 'gate',
      kind: 'stop',
      x: WALL_X - 0.15,
      y: GATE_LO,
      w: WALL_W + 0.3,
      h: GATE_HI - GATE_LO,
      tone: 'ink',
      state: 'passed',
      label: 'One gate',
      sublabel: 'matched to a list',
      domRowId: 'border-row-gate',
    },
    {
      id: 'hatch',
      kind: 'stop',
      x: WALL_X - 0.15,
      y: HATCH_LO,
      w: WALL_W + 0.3,
      h: HATCH_HI - HATCH_LO,
      tone: 'ink',
      state: 'passed',
      label: 'Rent hatch',
      sublabel: 'never barred',
      domRowId: 'border-row-rent',
    },

    // --- inside: the posted price -------------------------------------------
    // Two rows, because the price genuinely has two parts and a single number
    // would hide that a message can be cheap in one and expensive in the other.
    {
      id: 'toll-time',
      kind: 'stop',
      x: TOLL_X,
      y: 8.0,
      w: TOLL_W,
      h: 0.8,
      tone: 'ink',
      state: 'active',
      label: 'Per second',
      sublabel: `${num(XCM_USDC_SEC.value / MICRO)} USDC of work`,
      domRowId: 'border-row-toll-time',
    },
    {
      id: 'toll-proof',
      kind: 'stop',
      x: TOLL_X,
      y: 6.0,
      w: TOLL_W,
      h: 0.8,
      tone: 'ink',
      state: 'active',
      label: 'Per MiB',
      sublabel: `${num(XCM_USDC_MB.value / MICRO)} USDC of proof`,
      domRowId: 'border-row-toll-proof',
    },

    // --- inside: the two caps, read before anything is created ---------------
    {
      id: 'cap-global',
      kind: 'plate',
      x: CAP_GLOBAL_X,
      y: CAP_LO,
      w: CAP_W,
      h: CAP_H,
      tone: 'ink',
      state: 'active',
      fill: clamp01(brought / TVL_CAP.value),
      label: 'Chain cap',
      sublabel: 'all dollars here',
      domRowId: 'border-row-tvl-cap',
    },
    {
      id: 'cap-account',
      kind: 'plate',
      x: CAP_ACCOUNT_X,
      y: CAP_LO,
      w: CAP_W,
      h: CAP_H,
      tone: 'ink',
      state: 'active',
      fill: clamp01(brought / DEP_CAP.value),
      label: 'Person cap',
      sublabel: 'one account only',
      domRowId: 'border-row-dep-cap',
    },

    // --- inside: the daily test, and the rent --------------------------------
    // The probe is the only node that can carry the alarm tone, and only when
    // the reserve flag is actually set: a failed streak halts new escrow, which
    // is a genuine safety state rather than a low reading.
    {
      id: 'probe',
      kind: 'node',
      x: FAR_X,
      y: 4.5,
      w: FAR_W,
      h: 1.0,
      tone: impaired ? 'alarm' : 'ink',
      state: impaired ? 'blocked' : 'active',
      label: 'Daily probe',
      sublabel: impaired ? 'reserve unhealthy' : 'out and back again',
      domRowId: 'border-row-probe',
    },
    {
      id: 'rent',
      kind: 'node',
      x: FAR_X,
      y: 1.9,
      w: FAR_W,
      h: 1.0,
      tone: 'ink',
      state: 'active',
      label: 'The rent',
      sublabel: 'anyone may pay it',
      domRowId: 'border-row-renewal',
    },

    // --- flow ----------------------------------------------------------------
    // Read the arrows as an order in space: in through the gate, pay, then meet
    // the caps. Nothing reaches a cap without having passed the other two.
    { id: 'e-arrive', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'msg-ok', to: 'gate', emphasis: 1.4 },
    { id: 'e-toll', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'gate', to: 'toll-time', emphasis: 1.4 },
    { id: 'e-cap', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'toll-time', to: 'cap-global', emphasis: 1.4 },
    // Outbound: the daily test crosses the border at the gate and goes all the
    // way to Asset Hub, because reaching Asset Hub is the whole claim it tests.
    { id: 'e-probe', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'probe', to: 'asset-hub' },
    { id: 'e-rent', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'rent', to: 'coretime' },
  ];

  const rules: SceneRule[] = [
    // The stage is one place split in two, so it gets one divider and two names
    // rather than a frame around each half.
    {
      id: 'border-line',
      axis: 'y',
      at: WALL_X + WALL_W / 2,
      from: 0.1,
      to: 11.9,
      tone: 'dim',
      dashed: true,
      label: 'the border',
    },
    // The cap plates share one scale, printed once: empty is nothing brought
    // across, full is the cap itself. Two plates, two different ceilings — which
    // is exactly why the fills are not comparable and the scale says "full".
    {
      id: 'cap-scale',
      axis: 'y',
      at: CAP_GLOBAL_X - 0.35,
      from: CAP_LO,
      to: CAP_LO + CAP_H,
      tone: 'ink',
      ticks: [
        { at: CAP_LO, label: 'none' },
        { at: CAP_LO + CAP_H, label: 'full' },
      ],
    },
  ];

  return {
    nodes,
    rules,
    relation:
      'Default-deny, drawn as a place. The wall is the rule and the gate is the exception: everything ' +
      'outside is refused unless it matches a written list short enough to print, so the picture has ' +
      'one way in rather than a row of filters. What the arrows add to that list is an order in ' +
      'space — a message is admitted, then pays the posted price, then meets the caps, and the caps ' +
      'sit behind the toll because they are read before anything is created rather than after. The ' +
      'second opening faces the other way and is never barred: a chain that misses its rent stops ' +
      'producing blocks, so the one call that pays it is exempt from every emergency stop the system ' +
      'has. And the money itself never crosses at all — the plate on the left stays full, because ' +
      'the dollars are locked next door and only the claim on them travels.',
    unitLegend:
      'The two tall plates are the caps, and a fill is how much of that cap has been used; they have ' +
      'different ceilings, so compare each against its own scale and never against the other. The ' +
      'dashed boxes outside are messages the wall throws away.',
    caption: 'Money and messages crossing into the chain — and the two ways out.',
    legend: [
      { mark: 'ink', shape: 'stop', label: 'A way through, and what it charges' },
      { mark: 'dim', shape: 'node', label: 'Refused — not on the list' },
      { mark: 'ink', shape: 'plate', label: 'A cap, filled to what has been used' },
      { mark: 'alarm', label: 'The reserve test has failed twice running' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rail panels
// ---------------------------------------------------------------------------

/**
 * Doc 13 rows, printed exactly as the registry holds them.
 *
 * Nothing is rescaled here, and that is deliberate even though it makes the
 * numbers less friendly: the drawer is the expert view, and a reader who has
 * opened it is comparing against doc 13, where `xcm.usdc_per_sec` really is
 * fifty million millionths. The friendly halves — 50 USDC, 1 DOT — are computed
 * from these same rows in the prose and on the drawing, so the two can differ in
 * presentation and never in value.
 */
function ParamTable({ rows, caption }: { rows: readonly ParamRow[]; caption: string }) {
  const show = (row: ParamRow, v: number | undefined) =>
    v === undefined ? (
      <span className="border-absent">—</span>
    ) : (
      <Value
        of={spec(v, row.cite)}
        format={num}
        unverified={row.verification.status !== 'settled'}
      />
    );

  return (
    <table className="border-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col" className="numeric">
            Genesis
          </th>
          <th scope="col" className="numeric">
            Min
          </th>
          <th scope="col" className="numeric">
            Max
          </th>
          <th scope="col">Unit</th>
          <th scope="col">What it does</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} id={`border-param-${row.key}`}>
            <th scope="row">
              <span className="mono">{row.key}</span>
            </th>
            <td className="numeric">{show(row, row.value)}</td>
            <td className="numeric">{show(row, row.min)}</td>
            <td className="numeric">{show(row, row.max)}</td>
            <td className="border-unit">{row.unit}</td>
            <td>
              {row.blurb}
              {row.kernelBounded
                ? ' The bound itself is fixed at genesis, so no amendment reaches past it.'
                : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DrawingKeyPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Every mark on the drawing</h2>
      <p>
        The picture is a place, read left to right: next door, the border, then this chain. A dashed
        box is something the wall throws away. A solid one is something that got in, or something
        already inside.
      </p>
      <table className="border-table">
        <caption className="sr-only">What each object on the canvas stands for</caption>
        <thead>
          <tr>
            <th scope="col">On the drawing</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          {DRAWING_KEY.map((k) => (
            <tr key={k.row} id={k.row}>
              <th scope="row">{k.mark}</th>
              <td>{k.means}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MoneyPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Where the dollars actually are</h2>
      <p>
        Bleavit trades in <Jargon word="usdc" />, and it does not issue a single one of them. They
        are issued on <Jargon word="asset hub" />, a neighbouring chain in the same network, and
        that is where they stay. Bringing money here is a{' '}
        <Jargon word="reserve transfer" />: the dollars are locked on Asset Hub, a message says so,
        and this chain credits a matching claim. Sending money back reverses it — the claim here is
        destroyed and the lock over there is released.
      </p>
      <p>
        The coin never leaves home, and that is the safety property. This chain cannot mint a dollar
        it is not owed, because the only instruction that creates one is the one saying an equal
        amount was just locked next door (
        <span className="cite">{formatCitation(C_RULES)}</span>).
      </p>
      <p>
        Two mappings are pinned rather than discovered: the Asset Hub address of USDC and the local
        id it takes here. Nothing is looked up at runtime, so a client cannot be pointed at a
        different token by whatever it happens to talk to (
        <span className="cite">{formatCitation(C_AH)}</span>).
      </p>
      <p>
        Only two assets are recognised at all — USDC and DOT, the network&rsquo;s own token, which
        pays for work on other chains. Anything else arriving is refused. And nothing may{' '}
        <Jargon word="teleport" />{' '}
        in either direction: this chain trusts no teleport it did not itself instruct the network to
        run (<span className="cite">{formatCitation(C_RULES)}</span>).
      </p>
      <p className="panel__note">
        Getting out is deliberately ordinary. The exit is a normal signed call anybody can make, and
        the caps below never apply to it — they bound what comes in, never what leaves (
        <span className="cite">{formatCitation(C_EXIT)}</span>). What this chain owes the deposit
        flow on the other side — a pinned identity, USDC that can pay its own fees on arrival, an
        open channel and a published test environment — is listed at{' '}
        <span className="cite">{formatCitation(C_ONRAMP)}</span>.
      </p>
    </section>
  );
}

function BarrierPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The list, and what is not on it</h2>
      <p>
        A message in this network is not a request. It is a short program — a sequence of
        instructions the receiving chain runs — written in{' '}
        <Jargon word="xcm" />. So the receiving chain gets to decide how much of it, if any, it is
        willing to run.
      </p>
      <p>
        Bleavit&rsquo;s answer is the strictest one available: a written list of instruction shapes,
        and <strong>anything not on it is discarded</strong> — including instructions that do not
        exist yet, because they are absent from the list by construction. The alternative, a list of
        forbidden shapes, fails the first time somebody thinks of a shape nobody wrote down (
        <span className="cite">{formatCitation(C_BARRIER_CODE)}</span>).
      </p>
      <p>
        Before any of that, the sender has to be one this chain knows: Asset Hub, the{' '}
        <Jargon word="relay chain" />, the chain that sells block-production time, or a chain that
        has registered and paid to use Bleavit as a service. Every other sender is barred outright.
        Each admitted address is matched whole — never as a prefix somebody could extend, and never
        after an instruction that would change who the sender claims to be (
        <span className="cite">{formatCitation(C_RULES)}</span>).
      </p>

      <h3>What gets through</h3>
      <div className="border-scroll">
        <table className="border-table">
          <caption className="sr-only">The instruction families the barrier accepts</caption>
          <thead>
            <tr>
              <th scope="col">Shape</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            {ALLOWED_SHAPES.map((s) => (
              <tr key={s.name} id={`border-allow-${s.name.replace(/[^A-Za-z]/g, '')}`}>
                <th scope="row" className="mono border-shape">
                  {s.name}
                </th>
                <td>{s.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel__note">
        That is the whole set —{' '}
        <Value of={derived(ALLOWED_SHAPES.length, C_BARRIER_CODE)} /> families, enough for a deposit,
        a fee, a withdrawal, an answer and a version handshake, and nothing else. It is short enough
        to print, which is the point: a list of forbidden shapes could never be, and could never be
        finished.
      </p>

      <h3>What does not</h3>
      <table className="border-table">
        <caption className="sr-only">Refusals a reader is most likely to have expected to work</caption>
        <thead>
          <tr>
            <th scope="col">Shape</th>
            <th scope="col">Why it is refused</th>
          </tr>
        </thead>
        <tbody>
          {REFUSED_SHAPES.map((s) => (
            <tr key={s.name} id={`border-deny-${s.name.replace(/[^A-Za-z]/g, '')}`}>
              <th scope="row" className="mono border-shape">
                {s.name}
              </th>
              <td>{s.why}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>The one exception, and why it is not a hole</h3>
      <p>
        Bleavit sells its decision machinery to other chains, and a paying client has to be able to
        ask it something — which needs the very instruction the wall refuses. The exception is not a
        relaxed rule. It is <strong>one exact message</strong>, six instructions long, matched
        position by position: take this much USDC, pay the fee with it, run this one call, refund the
        rest, and give the remainder back <em>to the sender</em> and nobody else (
        <span className="cite">{formatCitation(C_INGRESS)}</span>).
      </p>
      <p>
        Three consequences fall out of the shape rather than out of anybody remembering to check
        them. Money cannot be redirected, because the last position names the sender. Nothing is
        created, because the first position spends a balance the client already holds here. And no
        instruction that carries a hidden inner program appears at any of the six positions, so
        every one of them fails without being enumerated.
      </p>
    </section>
  );
}

function TollPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Execution is sold, not given</h2>
      <p>
        An arriving message costs this chain real work, and it pays for that work out of the money
        it is carrying — at a price the chain publishes in advance rather than one it decides after
        the fact. There is no path for a free message: a program that asks for unpaid execution is
        discarded (<span className="cite">{formatCitation(C_RULES)}</span>).
      </p>
      <p>
        The price has two parts, because the work does. One is time: how long the message takes to
        run. The other is <Jargon word="proof size" />, the evidence a block has to carry so the
        network can re-check it — and that is usually what runs out first. A message can be cheap in
        one and expensive in the other, so a single number would hide half the bill (
        <Jargon word="weight" /> is the name for the pair).
      </p>

      <div className="border-scroll">
        <ParamTable rows={TOLL_ROWS} caption="The four posted rates, as the registry holds them" />
      </div>
      <p className="panel__note">
        The registry counts dollars in millionths and the network token in its own smallest unit, so
        a second of work is <Value of={spec(XCM_USDC_SEC.value, XCM_USDC_SEC.cite)} format={num} />{' '}
        of those millionths — <Value
          of={derived(XCM_USDC_SEC.value / MICRO, XCM_USDC_SEC.cite)}
          format={num}
          unit="USDC"
        />{' '}
        — or <Value
          of={derived(XCM_DOT_SEC.value / PLANCK, XCM_DOT_SEC.cite)}
          format={num}
          unit="DOT"
        />
        . A mebibyte of proof is{' '}
        <Value
          of={derived(XCM_USDC_MB.value / MICRO, XCM_USDC_MB.cite)}
          format={num}
          unit="USDC"
        />{' '}
        or{' '}
        <Value of={derived(XCM_DOT_MB.value / PLANCK, XCM_DOT_MB.cite)} format={num} unit="DOT" />.
        All four rows are marked unsettled: the sizing is re-checked against live fees on the
        neighbouring chains before the border opens to real money.
      </p>

      <h3>Rounding always goes the chain&rsquo;s way</h3>
      <p>
        The purchase rounds <strong>up</strong> in each of the two dimensions, and the refund of
        unused work rounds <strong>down</strong> in each. Both directions favour the chain, which is
        the same rule the rest of the system applies to every charge and every payout. A payer
        therefore never gets back more than the exact published price of the work they did not use (
        <span className="cite">{formatCitation(C_TRADER_CODE)}</span>).
      </p>
      <p>
        A message may pay in either asset, and USDC is enough on its own — an account holding no
        native token can still pay for its own arrival, which is what makes a first deposit possible
        at all. Whatever is left unrefunded at the end of the message goes to the treasury rather
        than being thrown away.
      </p>
    </section>
  );
}

function CapsPanel({ sim }: { sim: SimState }) {
  const brought = crossed(sim);
  return (
    <section className="panel">
      <h2 className="panel__title">Two ceilings while the chain is young</h2>
      <p>
        The chain launches in phases, and while real dollars trade under a founding key rather than
        under its own governance, two ceilings bound how much can be at stake. They bound{' '}
        <strong>different things</strong>, and each one is switched off separately, so containment
        disappears only when both are.
      </p>

      <table className="border-table">
        <caption className="sr-only">The two Phase-3 caps against this example</caption>
        <thead>
          <tr>
            <th scope="col">Ceiling</th>
            <th scope="col" className="numeric">
              Cap
            </th>
            <th scope="col" className="numeric">
              This example
            </th>
            <th scope="col">What it bounds</th>
          </tr>
        </thead>
        <tbody>
          <tr id="border-caps-tvl">
            <th scope="row">Whole chain</th>
            <td className="numeric">
              <Value of={spec(TVL_CAP.value, TVL_CAP.cite)} format={num} unit="USDC" unverified />
            </td>
            <td className="numeric">
              <Value of={simulated(brought)} format={num} unit="USDC" badge />
            </td>
            <td>
              Every dollar of claim that exists here at once, held by anybody. It is read at the
              moment a claim would be created, and an inbound transfer that would breach it fails
              with nothing created and nothing stranded.
            </td>
          </tr>
          <tr id="border-caps-dep">
            <th scope="row">One account</th>
            <td className="numeric">
              <Value of={spec(DEP_CAP.value, DEP_CAP.cite)} format={num} unit="USDC" unverified />
            </td>
            <td className="numeric">
              <Value of={simulated(brought)} format={num} unit="USDC" badge />
            </td>
            <td>
              Everything one account has ever brought in over the whole phase — a running total, not
              a balance, so spending it again does not free up room.
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>Checked before, never after.</strong> The check that matters happens before a single
        unit of claim exists. That ordering is the whole design, and it was corrected once because
        the other order does not work: a refusal that arrived after the money had been created would
        have left it stranded in a holding pen keyed to the <em>sending</em> chain, which the person
        it was meant for can never open — and every retry would strand it again, because the running
        total never falls (<span className="cite">{formatCitation(C_CAPS)}</span>).
      </p>
      <p>
        So the refusal is arranged to happen at the earliest point where the message can still be
        turned away whole. A rejected deposit leaves the sender&rsquo;s money sitting untouched on
        Asset Hub, which is recoverable, rather than in a pen here, which is not (
        <span className="cite">{formatCitation(C_CAPS_CODE)}</span>).
      </p>

      <div className="border-scroll">
        <ParamTable rows={[TVL_CAP, DEP_CAP]} caption="The two Phase-3 exposure caps" />
      </div>
      <p className="panel__note">
        Neither is an ordinary governable number: they are raised by a phase advance carrying the
        raise with it, not by a proposal. Lifting one means amending it to the largest value its type
        can hold — an unbounded ceiling is an ordinary amendment to the top of the row, so no
        separate switch has to exist and be guarded.
      </p>
    </section>
  );
}

function ProbePanel({ sim }: { sim: SimState }) {
  const impaired = sim.flags.reserveImpaired;
  return (
    <section className="panel">
      <h2 className="panel__title">The daily round trip</h2>
      <p className="border-chiprow">
        <span className={impaired ? 'chip chip--safety' : 'chip chip--state'}>
          {impaired ? 'reserve unhealthy — new escrow halted' : 'reserve reads healthy'}
        </span>
      </p>
      <p>
        Once a day the chain sends one small message to Asset Hub: take a tenth of a dollar out of
        my account there, put it straight back, and tell me it worked. That is the whole test — move
        a dust amount and see whether it moves — because the only way to know money can still move
        is to move some.
      </p>
      <p>
        <strong>The failure it catches is one nothing else can see.</strong> The obvious alarm on a
        stablecoin watches its price — and a price does not move when transfers freeze. So a channel
        that has stopped moving money looks perfectly healthy from every direction except one: try
        to move some. Before this existed, a frozen reserve fired nothing at all, and the treasury
        went on reporting full backing (<span className="cite">{formatCitation(C_PROBE)}</span>).
      </p>
      <p>
        <strong>Silence is a failure, not a pass.</strong> No answer inside the window, an error, or
        no attempt made at all — a missed turn counts the same as a refusal. This is the opposite of
        how the chain reads its other message counter, where no traffic scores full marks, and the
        difference is deliberate: absence of evidence about a reserve is evidence of a problem (
        <span className="cite">{formatCitation(C_HEALTH)}</span>).
      </p>
      <p>
        Two failures in a row and the reserve is marked unhealthy. That halts <em>new</em> money
        going into escrow and marks the treasury&rsquo;s stated worth down — and it stops nothing
        else: trading, merging back, redeeming and withdrawing all continue, because the halt exists
        to stop new exposure and never to trap what is already there. It takes three successes in a
        row to clear, more than it took to raise, on purpose.
      </p>

      <div className="border-scroll">
        <ParamTable rows={PROBE_ROWS} caption="The rows that govern the reserve probe" />
      </div>
      <p className="panel__note">
        One probe every{' '}
        <Value of={derived(PROBE_INT.value, PROBE_INT.cite)} format={formatDurationHuman} />, with
        the answer due inside{' '}
        <Value of={derived(PROBE_TO.value, PROBE_TO.cite)} format={formatDurationHuman} />, moving{' '}
        <Value of={spec(PROBE_AMOUNT.value, PROBE_AMOUNT.cite)} format={num} unit="USDC" />. The
        amount is dust on purpose: what is under test is the round trip, not the sum.
      </p>
    </section>
  );
}

function RentPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Rent, and the one door that never shuts</h2>
      <p>
        A <Jargon word="parachain" /> does not own its place in the network; it rents it. That rent
        is <Jargon word="coretime" />, bought from a chain that sells it, and a chain which misses a
        renewal <strong>stops producing blocks entirely</strong>. Not degraded — stopped.
      </p>
      <p>
        Which sets up a trap worth naming, because the system nearly walked into it. Most of this
        chain&rsquo;s safety machinery works by freezing things when something looks wrong. If a
        freeze also stopped the payment that keeps the chain running, then the response to a problem
        would eventually be the chain switching itself off — and the freeze would have to be lifted
        by a chain that is no longer producing blocks (
        <span className="cite">{formatCitation(C_CORETIME)}</span>).
      </p>
      <p>
        So the renewal is one narrow call with two unusual properties. It is{' '}
        <strong>permissionless</strong> — any <Jargon word="keeper" /> may make it, so it does not
        wait on a committee — and it is <strong>exempt from every protocol-level freeze the system
        has</strong>. It is the only outflow with that property, and it is bounded three ways: it
        spends only from a budget line that was authorised in calm weather, it funds one period at
        most once, and it cannot be stopped by a guardian.
      </p>
      <p>
        The exemption is a carve-out from the &ldquo;no new outflows&rdquo; rule, and it is
        deliberately narrow rather than a general emergency power. Renewal is maintenance, not a
        decision, so using it during degraded operation also does not consume any of the
        system&rsquo;s recovery time.
      </p>
      <p className="panel__note">
        One state is beyond its reach, and saying so is more useful than claiming otherwise. A
        half-finished upgrade can leave the chain accepting no ordinary instructions at all — not
        this one either. That is not a gap in the carve-out; it is a different failure with its own
        repair path, and the renewal outage lasts exactly as long as that repair does (
        <span className="cite">{formatCitation(C_CORETIME)}</span>).
      </p>

      <div className="border-scroll">
        <ParamTable rows={RENT_ROWS} caption="The rows that govern a coretime renewal" />
      </div>
      <p className="panel__note">
        A price quote for the next period is posted by the operators and stays usable for{' '}
        <Value of={derived(CT_TTL.value, CT_TTL.cite)} format={formatDuration} />; once it expires
        anybody may clear it away. Alongside the price the chain sets aside{' '}
        <Value of={derived(CT_FEE.value / PLANCK, CT_FEE.cite)} format={num} unit="DOT" /> for the
        two message legs. The rate row converts the network token into dollars purely so a budget
        line can be debited — no statement of what the treasury is worth depends on it, which is why
        an out-of-date rate cannot mislead anybody about solvency.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function TheBorderScene({ sim }: { sim: SimState }): JSX.Element {
  const brought = crossed(sim);

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="The border" />
      </div>
      <div className="col-rail border-rail">
        <Lede>
          The dollars this chain trades in are not made here. They are issued on a neighbouring
          chain and locked there, and what arrives is a claim on the locked money — so nobody has to
          trust this chain not to print one. Everything else that crosses arrives as a message, and
          every message is matched against a short written list: if it is not on the list it is
          thrown away rather than read generously. What is on the list still has to pay its own way,
          at a price posted in advance.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="A second of work costs"
            note="Or the same second in the network's own token, if you would rather pay in that."
          >
            <Value
              of={derived(XCM_USDC_SEC.value / MICRO, XCM_USDC_SEC.cite)}
              format={num}
              unit="USDC"
              unverified
            />
          </KeyFact>
          <KeyFact
            label="One account may bring in"
            note="For now. It is lifted by advancing a launch phase, not by a vote."
          >
            <Value of={spec(DEP_CAP.value, DEP_CAP.cite)} format={num} unit="USDC" unverified />
          </KeyFact>
          <KeyFact
            label="The reserve is tested every"
            note="A tenth of a dollar, out and back. No answer counts as a failure."
          >
            <Value of={derived(PROBE_INT.value, PROBE_INT.cite)} format={formatDuration} />
          </KeyFact>
        </KeyFacts>

        <section className="panel">
          <h2 className="panel__title">What has crossed, in this example</h2>
          <p>
            This scenario&rsquo;s participant has put{' '}
            <Value of={simulated(brought)} format={num} unit="USDC" badge /> into{' '}
            <Jargon word="escrow" />, so at least that much had to cross the border first. The two
            plates on the drawing show that same figure against each of the two ceilings — and the
            point of drawing both is that they are wildly different sizes. The same amount is{' '}
            <Value
              of={derived(TVL_CAP.value === 0 ? 0 : (brought / TVL_CAP.value) * 100, C_CAPS)}
              format={pct2}
              unit="%"
            />{' '}
            of what the whole chain may hold and{' '}
            <Value
              of={derived(DEP_CAP.value === 0 ? 0 : (brought / DEP_CAP.value) * 100, C_CAPS)}
              format={pct0}
              unit="%"
            />{' '}
            of what one person may bring. Whichever ceiling is nearer is the one that actually binds,
            and while the chain is young that is almost always the personal one.
          </p>
          <p className="panel__note">
            The escrowed figure is invented for this scenario. Every parameter beside it is a real
            value from the specification, and the badges say which is which.
          </p>
        </section>

        <Depth
          title="What each mark on the drawing means"
          hint={`${DRAWING_KEY.length} marks`}
        >
          <DrawingKeyPanel />
        </Depth>
        <Depth title="Where the dollars actually are, and how one gets here" hint="09 §6.1">
          <MoneyPanel />
        </Depth>
        <Depth
          title="The exact list a message is checked against"
          hint={`${ALLOWED_SHAPES.length} in, ${REFUSED_SHAPES.length} named refusals`}
        >
          <BarrierPanel />
        </Depth>
        <Depth title="What an arriving message pays, and who the rounding favours" hint="4 rates">
          <TollPanel />
        </Depth>
        <Depth title="The two ceilings, and why they are read before anything is created" hint="09 §5.2">
          <CapsPanel sim={sim} />
        </Depth>
        <Depth title="The daily round trip, and the failure it exists to catch" hint="07 §8">
          <ProbePanel sim={sim} />
        </Depth>
        <Depth title="Rent — the one payment no emergency stop may block" hint="09 §4">
          <RentPanel />
        </Depth>
      </div>
    </div>
  );
}
