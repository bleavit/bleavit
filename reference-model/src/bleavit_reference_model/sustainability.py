"""08 §10 (Sustainability) — the executable form of the cost/revenue/runway arithmetic.

Doc 08's preamble makes this mandatory rather than optional: "all worked arithmetic
is shown and MUST be reproduced by the Phase-0 reference model". Until milestone E5
that obligation was undischarged for §10 — the section's tables were hand-computed
and nothing re-derived them, which is how two of them shipped wrong (the 77,864
quiet-epoch figure and the 8.2-year runway, both corrected 2026-07-30).

Everything here is a *derivation* from the 13 §1 registry and the 08 §10 formulas.
No figure is chosen. The accompanying test suite pins every published figure in
08 §10.1-§10.6, so a spec table and this module cannot drift apart silently.

Units: USDC in whole units (Decimal, 6-decimal base unit). Epoch is 13 §1
`epoch.length` = 302,400 blocks at 6 s = 21.0 days.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal, localcontext

WORK_PREC = 60

# ---------------------------------------------------------------------------
# 13 §1 registry values that drive the cost base. Every one of these is a live
# constitution key with published bounds; the bounds are carried alongside so a
# proposed operating point can be checked for admissibility rather than assumed.
# ---------------------------------------------------------------------------

BLOCK_SECONDS = Decimal(6)
DAYS_PER_YEAR = Decimal("365.25")

# 13 §1 epoch.length (kernel-bounded). 302,400 blocks x 6 s = 21.0 days.
EPOCH_LENGTH_BLOCKS = Decimal(302_400)
# 04 §3.1: the Trade phase is d5-d18, i.e. 13/21 of the epoch. Kept as a pair of
# integers rather than a quotient: 13/21 is non-terminating in base 10, and
# evaluating it before the multiplication loses the exact 580,320.
TRADE_PHASE_NUM = Decimal(13)
TRADE_PHASE_DEN = Decimal(21)
# 13 §1 dec.window (kernel-bounded): 43,200 blocks = 72 h.
DEC_WINDOW_BLOCKS = Decimal(43_200)

# 13 §5 item 4: books = epoch.slots * 6 + 1 (one book set per active slot plus
# the epoch's single unconditional Baseline book).
BOOKS_PER_PROPOSAL = Decimal(6)

# 13 §1 registry bounds for the keys E5 moves.
OBS_INTERVAL_MIN, OBS_INTERVAL_MAX, OBS_INTERVAL_MAX_DELTA = (
    Decimal(5),
    Decimal(50),
    Decimal(5),
)
KEEPER_REBATE_MIN_MULTIPLE, KEEPER_REBATE_MAX_MULTIPLE = Decimal(1), Decimal(10)
KEEPER_BUDGET_MIN, KEEPER_BUDGET_MAX = Decimal(6_000), Decimal(60_000)
COLLATOR_COMP_MIN, COLLATOR_COMP_MAX = Decimal(500), Decimal(10_000)

# ---------------------------------------------------------------------------
# The external anchor for `collator.comp_epoch` (SQ-536, milestone E5 pass 2).
#
# This is the ONE figure in 08 §10 that no amount of internal derivation can
# reach: a collator's cost is a market price, and R-2 forbids inventing one.
# It is anchored here to a published, governance-APPROVED rate for the same
# role rather than to a vendor estimate.
#
# Source: Polkadot OpenGov referendum #1870 (status: Executed / Passed),
# which funds the collators of the Polkadot system parachains. Verified
# 2026-07-31; recorded in PLAN.md's Verification log.
#
# The comparison is apt rather than approximate, because the two roles are in
# the same economic position on the one axis that matters: Bleavit collators
# earn NOTHING from transaction fees or tips. The runtime wires
# `OnChargeTransaction = FungibleAdapter<Balances, ()>`, whose `()` drops the
# imbalance (i.e. burns it), which is D-15's "collected VIT transaction fees
# continue to burn". Polkadot's system parachains are likewise treasury-funded
# precisely because their fee revenue does not cover a collator. So in both
# cases the treasury line IS the collator's entire compensation, and the rates
# are directly comparable.
#
# Where the comparison is NOT exact, and why the margin below covers it: a
# Polkadot system-parachain collator is run by an operator who is already
# running Polkadot infrastructure, so the funded rate is a MARGINAL cost. A new
# parachain's operators amortize nothing. That is the gap the shipped seed's
# multiple over this anchor has to absorb, and it is why the derivation below
# takes the registry MINIMUM rather than the anchor itself.
# ---------------------------------------------------------------------------

PDOT_FUNDED_COLLATORS = Decimal(38)  # AssetHub 8, BridgeHub 8, People 8,
#                                      Coretime 4, Collectives 2, Bulletin 8.
PDOT_PER_COLLATOR_MONTH = Decimal(250)  # USD/collator/month, March onward.
PDOT_HOSTING_MONTH = Decimal(425)  # Fixed hosting line, shared by the set.
PDOT_CURATORS_MONTH = Decimal(750)  # 3 curators x 250.
PDOT_COORDINATOR_MONTH = Decimal(1_000)  # Bounty coordinator.
MONTHS_PER_YEAR = Decimal(12)

# 04 §7 / futarchy_primitives::MKT_STALE_GAP_BLOCKS. A KERNEL constant, movable
# only by CODE. An observation gap strictly greater than this increments
# `stale_events` inside the decision window: first forces a 3-day extension,
# second forces reject. SQ-526 records that OBS_INTERVAL_MAX equals it exactly,
# so the top of the interval's own registry range guarantees staleness events.
STALE_GAP_BLOCKS = Decimal(50)

# 08 §10.2 revenue coefficients.
MKT_FEE = Decimal("0.003")  # 13 §1 mkt.fee, 30 bps.
REDEEM_FEE = Decimal("0.003")  # 13 §1 ledger.redeem_fee, 30 bps, <= mkt.fee.
RHO = Decimal("0.75")  # realized fraction of nominal trading fees.
BETA = Decimal("0.50")  # fee-assessed share of terminal claim mass (upper est).

# 08 §4.1 frozen per-class NAV floors. Compile-time literals; movable only by a
# CODE proposal under the 13 §5 item-6 value screen. E5 MUST NOT move these.
NAV_FLOOR_PARAM = Decimal(4_620_989)
NAV_FLOOR_TREASURY = Decimal(7_393_600)
NAV_FLOOR_CODE = Decimal(13_862_944)
NAV_FLOOR_META = Decimal(21_256_533)

# 08 §2.5 funding target.
GENESIS_ENDOWMENT = Decimal(25_000_000)

# ---------------------------------------------------------------------------
# Coretime (SQ-538, milestone E7).
#
# 08 §10.1 excludes `ops.coretime` from its table on the grounds that the
# `broker.renew` price is an off-chain quote AND that "the renewal *period* is
# not stated anywhere in this document set". The second half is resolvable: the
# period is not a Bleavit choice at all, it is a property of the platform.
# Polkadot bulk coretime is sold in 28-day periods, so a year carries
# 365.25/28 = 13.0446 renewals.
#
# CORRECTED 2026-07-31 (SQ-541). The first pass modelled the renewal price as
# compounding at the per-period cap without bound, and reported a runway of
# 14.3 years on that basis. That is wrong, and the correction matters in both
# directions. Read against the arithmetic actually shipped in this workspace's
# own dependency tree -- `pallet-broker` 0.28.0, the version in `Cargo.lock`,
# `dispatchable_impls.rs::do_renew` lines 209-211:
#
#     let price_cap = cmp::max(record.price + config.renewal_bump * record.price,
#                              end_price);
#     let price     = Self::sale_price(&sale, now).min(price_cap);
#
# so the price paid at each renewal is
#
#     renewal = min( leadin_factor(t) * end_price ,
#                    max( prev * (1 + bump), end_price ) )
#
# and `sale_price` (`utility_impls.rs::sale_price`) is `leadin_factor_at(t) *
# end_price` where `t` runs 0 -> 1 across the leadin. Three consequences the
# first pass missed, all of them load-bearing:
#
#   1. The ratchet is NOT unbounded. It is clamped above by the current sale
#      price, so it saturates at `leadin_factor(t) * end_price` and can never
#      exceed the open market. `CenterTargetPrice::leadin_factor_at` starts at
#      100 and decays to 1, so the ceiling is at worst 100x the market floor.
#   2. The renewal price TRACKS THE MARKET DOWN as well as up. A falling
#      `end_price` lowers the paid price immediately, because the `min` binds.
#      A model that only ever grows is not conservative, it is simply wrong.
#   3. The escalation is a function of WHEN the renewal is submitted, and that
#      is a Bleavit choice, not a platform constant. Renewing at the end of the
#      leadin (`t = 1`) pays `min(end_price, >= end_price) = end_price` EXACTLY,
#      for any prior price -- flat, no ratchet, and it rewrites the stored
#      `record.price` down to the market floor so the next period starts there
#      too. Renewing during the interlude (`t = 0`, the safe moment, when only
#      renewals may consume cores) pays `prev * (1 + bump)` and compounds.
#
# So the cost line is governed by a renewal-timing policy, which is why this
# module models the policy rather than a growth rate. What the first pass got
# right is that a runway computed against a constant `C` is not conservative
# with respect to `ops.coretime`; what it got wrong is the size and the shape
# of the exposure, and the fact that the protocol can simply decline it.
#
# The `renewal_bump`, `interlude_length` and `leadin_length` are live
# Coretime-chain `ConfigRecord` values set by relay governance, NOT constants of
# this repository -- they stay [VERIFY] and every consumer takes them as
# parameters. The 3 % below is Kusama's published configuration, used as a
# bracket, never as Polkadot's value.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# XCM fee revenue (SQ-540(e), milestone E7).
#
# 08 §10.2 names TWO revenue instruments, both paid by traders. There is a
# third: the chain charges every inbound XCM message for execution at governed
# 13 §1 rates, through `GovernedWeightTrader`. It is not in §10.2 because it is
# currently DISCARDED -- the runtime binds `Trader = GovernedWeightTrader<
# ConstitutionTraderRates, ()>` and `TakeRevenue for ()` drops the collected
# assets on the trader's `Drop`. So the fee is computed, charged, and thrown
# away.
#
# Everything below is anchored in this repository, so the size of what is being
# discarded is derivable rather than guessed:
#
#   * `UnitWeightCost = Weight::from_parts(1_000_000_000, 64 * 1024)` per
#     instruction (`runtime/bleavit-runtime/src/configs.rs`, the
#     `FixedWeightBounds` weigher), i.e. 1 ms of ref-time and 64 KiB of proof.
#   * `xcm.trade_usdc_per_sec` = 50,000,000 µUSDC/s and
#     `xcm.trade_usdc_per_mb` = 5,000,000 µUSDC/MiB (13 §1 defaults).
#   * `WEIGHT_REF_TIME_PER_SECOND` = 10^12, `WEIGHT_PROOF_SIZE_PER_MB` = 2^20
#     (`sp-weights`), the two denominators `price_up` divides by.
#
# The ONE quantity that is not derivable is inbound message volume, and it is
# deliberately not assumed here. Every consumer takes it as a parameter and the
# headline is expressed as a BREAK-EVEN rate -- how many messages a day would
# have to arrive for the discarded fee to cover the cost base -- which is a
# derivation, not a forecast.
# ---------------------------------------------------------------------------

# `runtime/bleavit-runtime/src/configs.rs` xcm_config::UnitWeightCost.
XCM_UNIT_REF_TIME = Decimal(1_000_000_000)
XCM_UNIT_PROOF_SIZE = Decimal(64 * 1024)
# `sp_weights::constants`, the denominators `GovernedWeightTrader::price_up` uses.
WEIGHT_REF_TIME_PER_SECOND = Decimal(10**12)
WEIGHT_PROOF_SIZE_PER_MB = Decimal(1024 * 1024)
# 13 §1 `xcm.trade_usdc_per_sec` / `xcm.trade_usdc_per_mb`, in µUSDC.
XCM_USDC_PER_SEC = Decimal(50_000_000)
XCM_USDC_PER_MB = Decimal(5_000_000)
MICRO_USDC = Decimal(1_000_000)
# A minimal inbound reserve transfer: ReserveAssetDeposited, ClearOrigin,
# BuyExecution, DepositAsset. Stated as the parameter's default, not as a
# universal truth -- messages carrying more instructions pay proportionally
# more, which is why every consumer takes the count.
XCM_RESERVE_TRANSFER_INSTRUCTIONS = 4

CORETIME_PERIOD_DAYS = Decimal(28)
# Kusama's configured per-renewal bump. [VERIFY the Polkadot value].
CORETIME_RENEWAL_CAP_KSM = Decimal("0.03")
# `CenterTargetPrice::leadin_factor_at` (pallet-broker 0.28.0, adapt_price.rs
# 111-117): two linear phases meeting at t = 1/2, pinned by that file's own
# `leadin_price_bound_check` at (0, 100) (1/4, 55) (1/2, 10) (3/4, 5.5) (1, 1).
CORETIME_LEADIN_BREAKPOINT = Decimal("0.5")
CORETIME_LEADIN_STEEP_BASE, CORETIME_LEADIN_STEEP_SLOPE = Decimal(100), Decimal(180)
CORETIME_LEADIN_FLAT_BASE, CORETIME_LEADIN_FLAT_SLOPE = Decimal(19), Decimal(18)
# The two renewal timings that bound the policy space. `t = 0` is the interlude,
# where only renewals may buy and a core is therefore guaranteed; `t = 1` is the
# end of the leadin, the cheapest lawful moment, where `SoldOut` is possible.
CORETIME_RENEW_INTERLUDE = Decimal(0)
CORETIME_RENEW_LEADIN_END = Decimal(1)

# 13 §1 dec.v_min class floors and pol.b class floors.
DEC_V_MIN = {
    "param": Decimal(100_000),
    "treasury": Decimal(250_000),
    "code": Decimal(600_000),
    "meta": Decimal(1_200_000),
}
POL_B = {
    "param": Decimal(10_000),
    "treasury": Decimal(25_000),
    "code": Decimal(60_000),
    "meta": Decimal(100_000),
}
# 13 §1 gate.v_min default = 0.1 x dec.v_min(class); pol.b_gate = 7,500.
GATE_V_MIN_MULTIPLE = Decimal("0.1")
POL_B_GATE = Decimal(7_500)
POL_B_BASELINE = Decimal(25_000)
# 13 §1 sec.flow_cap (Phase-0 sim-gated). 08 §10.3's Baseline row pins it: the
# unbranched Baseline saturates at flow_cap * pol.b_baseline = 400,000.
SEC_FLOW_CAP = Decimal(16)
# 13 rule 7 / SQ-232: the classless Baseline book grades at the dec.v_min.trs floor.
BASELINE_V_MIN = DEC_V_MIN["treasury"]


def epochs_per_year() -> Decimal:
    """17.392857... epochs/year. 08 §10.1 uses the 365.25-day convention."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        epoch_days = EPOCH_LENGTH_BLOCKS * BLOCK_SECONDS / Decimal(86_400)
        return +(DAYS_PER_YEAR / epoch_days)


# ---------------------------------------------------------------------------
# The collator-rate anchor
# ---------------------------------------------------------------------------


def polkadot_collator_rate_month(loaded: bool = True) -> Decimal:
    """Referendum #1870's per-collator monthly rate, in USD.

    `loaded=False` is the headline $250/collator/month. `loaded=True` adds the
    referendum's own shared overheads — the fixed hosting line, the curators
    and the coordinator — spread across the funded set, because those are costs
    the bounty pays to keep the collators running and a Bleavit `ops.collators`
    line has no separate home for. Loaded is the honest comparand and is the
    default; the unloaded figure is exposed only so the test suite can show the
    conclusion does not depend on which one is used.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        total = PDOT_PER_COLLATOR_MONTH * PDOT_FUNDED_COLLATORS
        if loaded:
            total += PDOT_HOSTING_MONTH + PDOT_CURATORS_MONTH + PDOT_COORDINATOR_MONTH
        return +(total / PDOT_FUNDED_COLLATORS)


def polkadot_collator_rate_epoch(loaded: bool = True) -> Decimal:
    """The same rate expressed in `collator.comp_epoch` units (USDC/epoch).

    This is the quantity 13 §1's row is denominated in, so it is what the seed
    must be compared against. Epochs are 21.0 days, i.e. NOT months — reading
    the monthly rate straight into the registry row would understate by 1.45x.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        annual = polkadot_collator_rate_month(loaded) * MONTHS_PER_YEAR
        return +(annual / epochs_per_year())


def collator_comp_month(comp_epoch: Decimal) -> Decimal:
    """A `collator.comp_epoch` value expressed back in USD/collator/month."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(comp_epoch * epochs_per_year() / MONTHS_PER_YEAR)


def collator_anchor_multiple(comp_epoch: Decimal, loaded: bool = True) -> Decimal:
    """How many times the anchored rate a given `collator.comp_epoch` pays.

    The safety argument for the shipped seed is this multiple, not the absolute
    number: the unsafe direction is UNDER-paying (collators stop authoring and
    the chain stalls), so what has to be shown is headroom above a rate that
    real operators demonstrably accepted for the same job.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(comp_epoch / polkadot_collator_rate_epoch(loaded))


# ---------------------------------------------------------------------------
# Cost base
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CostParams:
    """The live registry values that determine the recurring cost base.

    Defaults are the 13 §1 genesis values, so `CostParams()` reproduces 08 §10.1.
    """

    epoch_slots: Decimal = Decimal(5)
    mkt_obs_interval: Decimal = Decimal(10)
    dec_window: Decimal = DEC_WINDOW_BLOCKS
    epoch_length: Decimal = EPOCH_LENGTH_BLOCKS
    # 13 §1 `keeper.rebate` = 3x the kernel fee basis. SQ-531 (milestone E5)
    # replaced the assumed 0.03 USDC basis with the measured 85 uUSDC, so the
    # seed moved 0.09 -> 0.000255. See PRE_E5 below for the superseded value.
    keeper_rebate: Decimal = Decimal("0.000255")
    keeper_budget_epoch: Decimal = Decimal(12_000)
    # 13 §1 `collator.comp_epoch`. SQ-536 (milestone E5 pass 2) re-seeded this
    # 2,000 -> 500, the registry MINIMUM, against the referendum #1870 anchor
    # above: 500 is 2.36x the fully-loaded rate real operators accepted for the
    # same treasury-funded, zero-fee-revenue role, where 2,000 was 9.44x. The
    # value is the registry bound, not a chosen number -- see
    # `collator_anchor_multiple`. All remaining headroom is in the SAFE
    # direction (20x, up to the 10,000 maximum) and reachable by PARAM
    # amendment at x2 per step with a 1-epoch cooldown.
    collator_comp_epoch: Decimal = Decimal(500)
    collator_count: Decimal = Decimal(5)
    # 08 §1.1: PARAM proposer reward 500, paid only on `Executed`. The 08 §10.1
    # row is a CEILING (an all-pass five-slot PARAM slate), not a floor.
    proposer_reward: Decimal = Decimal(500)
    # 08 §10.1: realized POL divergence loss, the 04 §12 worked walk. Annual.
    pol_divergence_annual: Decimal = Decimal(18_830)
    # SQ-540(d). Share of the qualified slate that takes a T13 rerun. 08 §10.1's
    # divergence row is computed at 0 -- a no-rerun epoch -- and nothing in §10
    # says so, which makes the published cost base an understatement of exactly
    # the amount 05 §2.1 T13 permits. Default 0 to reproduce the published row;
    # pass a fraction to see the exposure the spec already allows.
    pol_rerun_fraction: Decimal = Decimal(0)
    # 07 §8 reserve-probe envelope. Annual.
    reserve_probe_annual: Decimal = Decimal(913)
    # The eight 13 §1 [VERIFY]-tagged ops lines. 08 §10.1 refuses to size them
    # and so does this model: pass an explicit overlay to see the sensitivity.
    ops_overlay_annual: Decimal = Decimal(0)
    # Fraction of keeper transaction fees that return to MAIN. Since milestone
    # E3, USDC transaction fees route to MAIN and VIT fees still burn, so the
    # treasury's NET keeper outflow is the rebate less whatever share of the
    # crank fee comes back. 08 §10.1 counts the rebate GROSS; 0 reproduces it.
    keeper_fee_return_fraction: Decimal = Decimal(0)
    # The crank fee the rebate is a multiple of. Measured under SQ-531 from the
    # committed generated weights at the SQ-528-restored multiplier, priced at
    # 13 §1's documented 0.05 USDC/VIT placeholder reference.
    crank_fee_basis: Decimal = Decimal("0.000085")

    def trading_books(self) -> Decimal:
        """13 §5 item 4: epoch.slots * 6 + 1."""
        return self.epoch_slots * BOOKS_PER_PROPOSAL + Decimal(1)

    def decision_critical_cranks(self) -> Decimal:
        """13 §5 item 4, first figure. Genesis registry: 133,920."""
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            return +(self.trading_books() * (self.dec_window / self.mkt_obs_interval))

    def full_window_cranks(self) -> Decimal:
        """13 §5 item 4, second figure. Genesis registry: 580,320."""
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            trade_blocks = self.epoch_length * TRADE_PHASE_NUM / TRADE_PHASE_DEN
            return +(self.trading_books() * (trade_blocks / self.mkt_obs_interval))


@dataclass(frozen=True)
class CostBase:
    collators: Decimal
    keeper_metered: Decimal
    keeper_beyond_meter: Decimal
    proposer_rewards: Decimal
    pol_divergence: Decimal
    reserve_probe: Decimal
    ops_overlay: Decimal

    @property
    def keeper_total(self) -> Decimal:
        return self.keeper_metered + self.keeper_beyond_meter

    @property
    def annual(self) -> Decimal:
        return (
            self.collators
            + self.keeper_metered
            + self.keeper_beyond_meter
            + self.proposer_rewards
            + self.pol_divergence
            + self.reserve_probe
            + self.ops_overlay
        )

    def shares(self) -> dict[str, Decimal]:
        total = self.annual
        if total == 0:
            return {}
        with localcontext() as ctx:
            ctx.prec = WORK_PREC
            return {
                "collators": +(self.collators / total),
                "keeper_metered": +(self.keeper_metered / total),
                "keeper_beyond_meter": +(self.keeper_beyond_meter / total),
                "proposer_rewards": +(self.proposer_rewards / total),
                "pol_divergence": +(self.pol_divergence / total),
                "reserve_probe": +(self.reserve_probe / total),
                "ops_overlay": +(self.ops_overlay / total),
            }


def cost_base(params: CostParams | None = None) -> CostBase:
    """08 §10.1's annual cost base `C`, derived rather than transcribed."""
    p = params or CostParams()
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        epy = epochs_per_year()

        # 08 §6.3: full-window coverage at the 3x rebate, less the metered
        # budget, is the `ops.keepers` continuity line.
        #
        # The metered line is what is actually PAID, not the budget: 08 §1.1 is
        # explicit that `fund_budget_line` is "an allocation act, not a spend"
        # and that each line's budget is enforced by its consuming mechanism.
        # At the genesis rebate the demand (52,228.80) exceeds the budget, so
        # the budget IS the spend and this reproduces 08 §10.1 exactly -- but at
        # a lower rebate the two diverge, and counting the budget would book a
        # cost nobody incurs. A test caught exactly that.
        gross_keeper_epoch = p.full_window_cranks() * p.keeper_rebate
        metered_epoch = min(p.keeper_budget_epoch, gross_keeper_epoch)
        beyond_meter_epoch = gross_keeper_epoch - metered_epoch

        # Net of the crank fee that returns to MAIN (E3). Zero by default so the
        # default construction reproduces 08 §10.1's gross figures exactly.
        fee_return_epoch = (
            p.full_window_cranks() * p.crank_fee_basis * p.keeper_fee_return_fraction
        )

        return CostBase(
            collators=+(p.collator_comp_epoch * p.collator_count * epy),
            keeper_metered=+(metered_epoch * epy),
            keeper_beyond_meter=+((beyond_meter_epoch - fee_return_epoch) * epy),
            proposer_rewards=+(p.proposer_reward * p.epoch_slots * epy),
            pol_divergence=pol_divergence_with_reruns(p.pol_rerun_fraction, p),
            reserve_probe=p.reserve_probe_annual,
            ops_overlay=p.ops_overlay_annual,
        )


# 05 §2.1 T13: a rerun REOPENS the same books at 2x POL with positions intact.
# `delayed_once` and `rerun` are one-way flags, so a proposal admits at most ONE
# rerun -- which is why 08 §4.4 can call the exposure "structurally bounded
# rather than budget-bounded" and cap an epoch at 2x its qualified commitment.
POL_RERUN_MAX_MULTIPLE = Decimal(2)


def pol_divergence_with_reruns(
    rerun_fraction: Decimal,
    params: CostParams | None = None,
) -> Decimal:
    """Realized POL divergence when `rerun_fraction` of the slate reruns.

    Divergence loss is `b*[ln2 - H(p)]` per book (04 §12), i.e. LINEAR in `b`,
    and T13 doubles `b` on the reopened book. A rerun book therefore contributes
    at most twice a non-rerun one, and the epoch total scales as
    `1 + rerun_fraction` up to the structural cap of 2x.

    This is a CEILING on the rerun term, not a forecast: it takes each rerun
    book to the full doubled bound. The point is that 08 §10.1's published row
    is the `rerun_fraction = 0` case and says so nowhere, so the cost base it
    states is an understatement by up to its own size.
    """
    p = params or CostParams()
    fraction = max(Decimal(0), min(Decimal(1), rerun_fraction))
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        multiple = Decimal(1) + fraction * (POL_RERUN_MAX_MULTIPLE - Decimal(1))
        return +(p.pol_divergence_annual * multiple)


# 13 §1 `prop.bond` per class and `trs.proposer_reward` per class, with the
# 08 §7.1 slash rule: bonds "refund in full only on a decision-grade outcome
# (adopt or reject -- rejection is information)", so the 10 % `intake.slash_pct`
# fires on NON-decision-grade outcomes, not on rejection.
PROP_BOND = {
    "param": Decimal(1_000),
    "treasury": Decimal(5_000),
    "code": Decimal(25_000),
    "meta": Decimal(50_000),
}
PROPOSER_REWARD = {
    "param": Decimal(500),
    "treasury": Decimal(25_000),
    "code": Decimal(25_000),
    "meta": Decimal(25_000),
}
INTAKE_SLASH_FRACTION = Decimal("0.10")


def proposer_expected_value(
    proposal_class: str,
    adopt_rate: Decimal,
    decision_grade_rate: Decimal,
) -> Decimal:
    """Expected USDC to a proposer per submission, per 08 §7.1 and §1.1.

    `reward * P(adopt) - slash * P(non-decision-grade)`. Rejection contributes
    ZERO, not a loss: 08 §7.1 refunds the bond in full on any decision-grade
    outcome because "rejection is information". Getting that wrong turns an
    honest rejected proposal into a penalised one and makes the reward look
    far more generous than it is -- which is exactly the error this function
    exists to stop a reader making by hand.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        reward = PROPOSER_REWARD[proposal_class]
        slash = PROP_BOND[proposal_class] * INTAKE_SLASH_FRACTION
        return +(reward * adopt_rate - slash * (Decimal(1) - decision_grade_rate))


def proposer_break_even_adopt_rate(
    proposal_class: str,
    decision_grade_rate: Decimal,
    reward: Decimal | None = None,
) -> Decimal:
    """Adopt rate at which proposing stops losing money, at a given formation rate.

    `reward` overrides the 13 §1 default so a proposed amendment can be tested
    before it is made. A result above 1 means NO adopt rate makes proposing
    profitable -- the reward cannot cover the non-formation slash even if every
    submission is adopted.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        reward = PROPOSER_REWARD[proposal_class] if reward is None else reward
        slash = PROP_BOND[proposal_class] * INTAKE_SLASH_FRACTION
        if reward <= 0:
            return INFINITE
        return +(slash * (Decimal(1) - decision_grade_rate) / reward)


def quiet_epoch_cost(params: CostParams | None = None) -> Decimal:
    """08 §10.6: what a zero-revenue epoch still bills.

    Excludes the two rows a quiet epoch does not incur: `REWARDS` (08 §1.1 pays
    it only on `Executed`) and the POL divergence (which needs a seeded book).
    """
    p = params or CostParams()
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        gross_keeper = p.full_window_cranks() * p.keeper_rebate
        metered = min(p.keeper_budget_epoch, gross_keeper)
        beyond = gross_keeper - metered
        fee_return = (
            p.full_window_cranks() * p.crank_fee_basis * p.keeper_fee_return_fraction
        )
        probe_epoch = p.reserve_probe_annual / epochs_per_year()
        return +(
            p.collator_comp_epoch * p.collator_count
            + metered
            + beyond
            - fee_return
            + probe_epoch
        )


# ---------------------------------------------------------------------------
# Held capital and revenue
# ---------------------------------------------------------------------------


def held_capital_at_v_min(proposal_class: str) -> Decimal:
    """08 §10.3, left column: 2 decision books + 4 gate books at their floors."""
    v = DEC_V_MIN[proposal_class]
    return Decimal(2) * v + Decimal(4) * (v * GATE_V_MIN_MULTIPLE)


def held_capital_at_saturation(proposal_class: str) -> Decimal:
    """08 §10.3, right column: `sec.flow_cap` saturation.

    `sec.flow_cap * (b_acc + b_rej)` on the decision pair plus
    `sec.flow_cap * pol.b_gate` on each of the four gate books.
    """
    b = POL_B[proposal_class]
    return SEC_FLOW_CAP * (Decimal(2) * b) + Decimal(4) * SEC_FLOW_CAP * POL_B_GATE


def baseline_held_capital(saturated: bool) -> Decimal:
    """08 §10.3's Baseline row.

    The Baseline book is UNBRANCHED and carries no gate books (04 §8.2), so
    there is no pair term and no gate term: saturation is
    `sec.flow_cap * pol.b_baseline`, not the branched formula.
    """
    return SEC_FLOW_CAP * POL_B_BASELINE if saturated else BASELINE_V_MIN


def annual_held_capital(
    proposal_class: str,
    slots: Decimal = Decimal(5),
    saturated: bool = True,
) -> Decimal:
    """08 §10.3's annualized table. Includes the epoch's one Baseline book."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        per = (
            held_capital_at_saturation(proposal_class)
            if saturated
            else held_capital_at_v_min(proposal_class)
        )
        per_epoch = slots * per + baseline_held_capital(saturated)
        return +(per_epoch * epochs_per_year())


def revenue_rate(tau: Decimal, mkt_fee: Decimal = MKT_FEE, redeem_fee: Decimal = REDEEM_FEE) -> Decimal:
    """08 §10.2: `mkt.fee*rho*tau + ledger.redeem_fee*beta`. At tau=3 this is 0.00825."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(mkt_fee * RHO * tau + redeem_fee * BETA)


def revenue(held: Decimal, tau: Decimal, **kw) -> Decimal:
    """08 §10.2: `R = H * (mkt.fee*rho*tau + ledger.redeem_fee*beta)`."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(held * revenue_rate(tau, **kw))


def crossover_held_capital(annual_cost: Decimal, tau: Decimal, **kw) -> Decimal:
    """08 §10.4's `V*`: the held capital at which `R = C`."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(annual_cost / revenue_rate(tau, **kw))


# ---------------------------------------------------------------------------
# Runway
# ---------------------------------------------------------------------------


# Interpreting an infinite runway. `Decimal("Infinity")` is returned when net
# burn is zero or negative, which is the whole point of the E5 exercise: a
# protocol whose revenue covers its cost base at a given activity level does not
# consume its endowment at all.
INFINITE = Decimal("Infinity")


def runway_years(
    annual_cost: Decimal,
    floor: Decimal,
    annual_revenue: Decimal = Decimal(0),
    endowment: Decimal = GENESIS_ENDOWMENT,
) -> Decimal:
    """08 §10.5: years of drawdown from `endowment` to `floor` at net burn.

    Returns INFINITE when revenue covers the cost base. `floor` is one of the
    08 §4.1 frozen class floors -- NOT zero: `pol.budget_epoch` is a fraction of
    NAV, so seeding capacity is lost long before the treasury empties.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        net_burn = annual_cost - annual_revenue
        if net_burn <= 0:
            return INFINITE
        headroom = endowment - floor
        if headroom <= 0:
            return Decimal(0)
        return +(headroom / net_burn)


# ---------------------------------------------------------------------------
# Coretime escalation (SQ-538)
# ---------------------------------------------------------------------------


def coretime_renewals_per_year() -> Decimal:
    """13.0446. The period is a platform constant, not a Bleavit choice."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(DAYS_PER_YEAR / CORETIME_PERIOD_DAYS)


def _pow(base: Decimal, exponent: Decimal) -> Decimal:
    """Decimal power for non-integer exponents (`**` rejects Decimal exponents)."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +((base.ln() * exponent).exp())


def coretime_annual_escalation(per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM) -> Decimal:
    """The per-period renewal bump compounded over a year of renewals.

    This is the number the "rent-controlled renewal" framing hides: a bump that
    is plainly modest per period -- 3 % -- is +47 %/yr once it applies 13.04
    times, and nothing in 08 §10.5 accounts for a cost line that can do that.

    It is the LOCAL rate of the ratchet, not a long-run growth rate, and on its
    own it overstates. `do_renew` clamps the ratchet to the current sale price
    (see the module header), so the compounding stops at
    `coretime_ratchet_ceiling` rather than continuing. Use
    `coretime_price_path` for anything spanning more than a few periods; this
    function is retained because the per-period bump really does compound at
    this rate up to the ceiling, and that is the part §10.5 omits.
    """
    return _pow(Decimal(1) + per_period_cap, coretime_renewals_per_year()) - Decimal(1)


def _ceil_div(numerator: Decimal, denominator: Decimal) -> Decimal:
    """Integer ceiling division, matching `component_price_up`'s remainder term."""
    whole = (numerator / denominator).to_integral_value(rounding="ROUND_FLOOR")
    return whole + (Decimal(1) if numerator != whole * denominator else Decimal(0))


def xcm_fee_micro_usdc(
    instructions: int = XCM_RESERVE_TRANSFER_INSTRUCTIONS,
) -> Decimal:
    """`GovernedWeightTrader::price_up` for a message of `instructions` steps.

    Transcribed from `runtime/bleavit-xcm/src/trader.rs`: each weight dimension
    is priced separately and rounded UP (payer-adverse, PT-3), then summed. The
    weigher is `FixedWeightBounds`, so message weight is exactly
    `instructions × UnitWeightCost` in both dimensions.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        n = Decimal(instructions)
        ref = _ceil_div(n * XCM_UNIT_REF_TIME * XCM_USDC_PER_SEC, WEIGHT_REF_TIME_PER_SECOND)
        proof = _ceil_div(n * XCM_UNIT_PROOF_SIZE * XCM_USDC_PER_MB, WEIGHT_PROOF_SIZE_PER_MB)
        return +(ref + proof)


def xcm_fee_per_message(
    instructions: int = XCM_RESERVE_TRANSFER_INSTRUCTIONS,
) -> Decimal:
    """The same fee in whole USDC, the unit 08 §10 states costs in."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(xcm_fee_micro_usdc(instructions) / MICRO_USDC)


def xcm_annual_revenue(
    messages_per_day: Decimal,
    instructions: int = XCM_RESERVE_TRANSFER_INSTRUCTIONS,
) -> Decimal:
    """Annual USDC currently discarded at a given inbound message rate."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(xcm_fee_per_message(instructions) * messages_per_day * DAYS_PER_YEAR)


def xcm_break_even_messages_per_day(
    annual_cost: Decimal,
    instructions: int = XCM_RESERVE_TRANSFER_INSTRUCTIONS,
) -> Decimal:
    """Inbound messages/day at which the DISCARDED fee alone covers `annual_cost`.

    The honest form of the finding. Volume is the one input that cannot be
    derived from this repository, so the result is stated as the volume the
    protocol would need rather than as a revenue figure it would earn.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        per_day = xcm_fee_per_message(instructions) * DAYS_PER_YEAR
        if per_day <= 0:
            return INFINITE
        return +(annual_cost / per_day)


def coretime_leadin_factor(through: Decimal) -> Decimal:
    """`CenterTargetPrice::leadin_factor_at` (pallet-broker 0.28.0).

    Two linear phases: a steep one from 100x down to 10x over the first half of
    the leadin, then a flatter one from 10x to 1x. `through` is the fraction of
    the leadin elapsed, clamped to [0, 1] exactly as `sale_price` clamps it
    with `.min(sale.leadin_length)`.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        t = max(Decimal(0), min(Decimal(1), through))
        if t <= CORETIME_LEADIN_BREAKPOINT:
            return +(CORETIME_LEADIN_STEEP_BASE - t * CORETIME_LEADIN_STEEP_SLOPE)
        return +(CORETIME_LEADIN_FLAT_BASE - t * CORETIME_LEADIN_FLAT_SLOPE)


def coretime_sale_price(end_price: Decimal, through: Decimal) -> Decimal:
    """`Broker::sale_price` -- the Dutch-auction price at `through` of the leadin."""
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return +(coretime_leadin_factor(through) * end_price)


def coretime_renewal_price(
    prev_price: Decimal,
    end_price: Decimal,
    through: Decimal = CORETIME_RENEW_INTERLUDE,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
) -> Decimal:
    """One application of `do_renew`'s price rule. THE load-bearing function.

    `min(sale_price(now), max(prev * (1 + bump), end_price))` -- transcribed
    from `pallet-broker` 0.28.0 `dispatchable_impls.rs` 209-211, which is the
    version this workspace's `Cargo.lock` pins, so it is checkable evidence
    rather than a recollection about how coretime works.

    The two clamps do opposite jobs and both matter. The `max` is a FLOOR that
    stops a renewer underpaying the market ("Renewals should never be priced
    lower than the current `end_price`" -- the pallet's own comment). The `min`
    is a CEILING that stops the ratchet exceeding what anyone else would pay.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        price_cap = max(prev_price * (Decimal(1) + per_period_cap), end_price)
        return +min(coretime_sale_price(end_price, through), price_cap)


def coretime_ratchet_ceiling(
    end_price: Decimal, through: Decimal = CORETIME_RENEW_INTERLUDE
) -> Decimal:
    """Where the ratchet stops. It is bounded, and the first pass said it was not.

    Once `prev * (1 + bump)` exceeds the sale price the `min` binds and the
    price is pinned to `sale_price` forever after. So the ceiling is exactly
    the sale price at the chosen renewal moment -- 100x the market floor if
    renewals go in during the interlude, and 1x if they go in at the end of the
    leadin.
    """
    return coretime_sale_price(end_price, through)


def coretime_price_path(
    periods: int,
    end_price: Decimal,
    through: Decimal = CORETIME_RENEW_INTERLUDE,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
    initial_price: Decimal | None = None,
) -> list[Decimal]:
    """Iterate the real recurrence for `periods` renewals.

    Each renewal's paid price becomes the next period's `record.price`, which
    is why the timing choice is not a per-period saving but a permanent one:
    renewing late rewrites the ratchet down to the market floor.
    """
    price = end_price if initial_price is None else initial_price
    path: list[Decimal] = []
    for _ in range(periods):
        price = coretime_renewal_price(price, end_price, through, per_period_cap)
        path.append(price)
    return path


def coretime_periods_to_saturation(
    through: Decimal = CORETIME_RENEW_INTERLUDE,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
    end_price: Decimal = Decimal(1),
) -> int:
    """How many renewals from the market floor until the ratchet pins to the ceiling.

    Scale-free in `end_price` (both terms are proportional to it), so the
    default of 1 is the general answer expressed as a multiple.
    """
    if per_period_cap <= 0:
        return 0
    ceiling = coretime_ratchet_ceiling(end_price, through)
    price, periods = end_price, 0
    while price < ceiling:
        nxt = coretime_renewal_price(price, end_price, through, per_period_cap)
        periods += 1
        if nxt <= price:
            break
        price = nxt
    return periods


def coretime_annual_cost_path(
    years: int,
    end_price_annual: Decimal,
    through: Decimal = CORETIME_RENEW_INTERLUDE,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
) -> list[Decimal]:
    """Per-year `ops.coretime` spend under one renewal-timing policy.

    `end_price_annual` is the ANNUAL cost of renewing at the market floor every
    period, i.e. `end_price * renewals_per_year`, so the caller states the line
    in the units 08 §10 uses rather than in DOT per period.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        per_year = coretime_renewals_per_year()
        floor_price = +(end_price_annual / per_year)
        price = floor_price
        out: list[Decimal] = []
        for _ in range(years):
            spend = Decimal(0)
            # Fractional renewals-per-year: carry the remainder so a 25-year
            # horizon lands on 326 renewals, not 25 x 13.
            whole = int(per_year)
            for _ in range(whole):
                price = coretime_renewal_price(price, floor_price, through, per_period_cap)
                spend += price
            out.append(+(spend * per_year / Decimal(whole)))
        return out


def coretime_cost_after_years(
    initial_annual: Decimal,
    years: Decimal,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
) -> Decimal:
    """`initial_annual` escalated at the compounded bump for `years`, UNCLAMPED.

    Retained as the naive reading, and deliberately *not* used by the runway
    functions any more: it ignores `do_renew`'s `min(sale_price, ...)` and so
    runs past the ceiling the pallet enforces. `coretime_annual_cost_path` is
    the honest one. Kept so the tests can state the size of the difference,
    since the difference is the finding.
    """
    growth = Decimal(1) + coretime_annual_escalation(per_period_cap)
    return _pow(growth, years) * initial_annual


def runway_years_with_coretime_policy(
    annual_cost: Decimal,
    floor: Decimal,
    coretime_floor_annual: Decimal,
    through: Decimal = CORETIME_RENEW_INTERLUDE,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
    annual_revenue: Decimal = Decimal(0),
    endowment: Decimal = GENESIS_ENDOWMENT,
    max_years: int = 400,
) -> Decimal:
    """Runway with `ops.coretime` priced by the real `do_renew` recurrence.

    `annual_cost` is the constant remainder of the base; `coretime_floor_annual`
    is what a year of renewals costs at the market floor, i.e. the line's size
    if every renewal paid `end_price`. The ratchet is then applied or not
    depending on `through`, which is the renewal-timing policy.

    This supersedes `runway_years_with_escalating_line` for anything published:
    that function grows the line without bound and therefore understates the
    runway, sometimes by a lot.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        path = coretime_annual_cost_path(
            max_years, coretime_floor_annual, through, per_period_cap
        )
        balance = endowment
        for year in range(max_years):
            burn = annual_cost + path[year] - annual_revenue
            if burn <= 0:
                continue
            if balance - burn <= floor:
                headroom = balance - floor
                return +(Decimal(year) + (headroom / burn if burn > 0 else Decimal(0)))
            balance -= burn
        return INFINITE


def runway_years_with_escalating_line(
    annual_cost: Decimal,
    floor: Decimal,
    escalating_initial: Decimal,
    per_period_cap: Decimal = CORETIME_RENEWAL_CAP_KSM,
    annual_revenue: Decimal = Decimal(0),
    endowment: Decimal = GENESIS_ENDOWMENT,
    max_years: int = 400,
) -> Decimal:
    """Runway when one cost line grows at a constant rate, WITHOUT a ceiling.

    SUPERSEDED for `ops.coretime` by `runway_years_with_coretime_policy`: the
    real renewal price is clamped to the sale price, so an unbounded geometric
    line is not a conservative model of it, it is a wrong one. Kept as the
    general "what if a line grows forever" integrator, and used by the tests to
    quantify how much the unbounded reading overstates.

    `annual_cost` is the constant remainder of the base; `escalating_initial`
    is the year-0 size of the escalating line, which is added on top and grown
    each year. Integrates year by year rather than solving in closed form,
    because the point is to show the shape and the shape is not linear.

    Returns INFINITE if revenue covers the total in every year up to
    `max_years` -- which cannot happen for a positive cap, since the escalating
    line eventually exceeds any fixed revenue.
    """
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        growth = Decimal(1) + coretime_annual_escalation(per_period_cap)
        balance = endowment
        line = escalating_initial
        for year in range(max_years):
            burn = annual_cost + line - annual_revenue
            if burn <= 0:
                line *= growth
                continue
            if balance - burn <= floor:
                headroom = balance - floor
                return +(Decimal(year) + (headroom / burn if burn > 0 else Decimal(0)))
            balance -= burn
            line *= growth
        return INFINITE


def cost_at_occupancy(occupied: Decimal, params: CostParams | None = None) -> Decimal:
    """Annual cost when only `occupied` of `epoch.slots` carry a proposal.

    Two of §10.1's rows are per-proposal, not standing, and holding them at
    full-slate values while varying revenue occupancy double-counts against the
    protocol:

    * `REWARDS` is paid only on `Executed` (08 §1.1), so a five-slot figure is
      an all-pass FULL slate -- the ceiling §10.1 already labels as such.
    * The realized POL divergence needs a seeded book, so it scales with the
      proposals actually seeded. The epoch's one Baseline book is standing and
      does not scale, and is held out here.

    Everything else -- collators, keepers, the reserve probe -- is standing.
    """
    p = params or CostParams()
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        full = cost_base(p)
        share = occupied / p.epoch_slots
        # 08 §10.1 sizes the POL row for a full PARAM slate PLUS the Baseline.
        # Realized divergence loss is `b*[ln2 - H(p)]` per book, hence linear in
        # `b`, so the row splits by total `b` and NOT into equal per-proposal
        # parts. A PARAM proposal carries `2*pol.b + 4*pol.b_gate` = 50,000
        # against the Baseline's `pol.b_baseline` = 25,000, so at five slots the
        # Baseline is 25,000/275,000 = 1/11 of the row.
        #
        # An earlier revision used 1/6, from 08 §10.5's observation that the
        # Baseline's cash equals PARAM's per-proposal cash. That is a different
        # quantity -- §10.5 measures custody AT RISK, where a branched proposal
        # contributes only half its commitment because one `split` funds a
        # branch pair, and the coincidence there does not carry over to a loss
        # that is linear in `b`.
        b_per_proposal = POL_B["param"] * Decimal(2) + POL_B_GATE * Decimal(4)
        b_full_slate = b_per_proposal * p.epoch_slots
        baseline_share = POL_B_BASELINE / (b_full_slate + POL_B_BASELINE)
        pol_baseline = full.pol_divergence * baseline_share
        pol_proposals = (full.pol_divergence - pol_baseline) * share

        # Keeper cost is NOT standing either (raised by review). 13 §5 item 4
        # derives observation load from `epoch.slots * 6 + 1` books, so it
        # scales with OCCUPIED slots and only the epoch's single Baseline book
        # is observed at zero occupancy. Treating it as standing charged five
        # slots' observations at one-slot occupancy, and — worse — capped it at
        # five when `break_even_slots_consistent` evaluated six through twelve.
        books_at_occupancy = occupied * BOOKS_PER_PROPOSAL + Decimal(1)
        keeper = full.keeper_total * books_at_occupancy / p.trading_books()

        return +(
            full.collators
            + keeper
            + full.reserve_probe
            + full.ops_overlay
            + full.proposer_rewards * share
            + pol_baseline
            + pol_proposals
        )


def break_even_slots(
    annual_cost: Decimal,
    tau: Decimal,
    proposal_class: str = "param",
    saturated: bool = False,
    max_slots: int = 12,
) -> int | None:
    """Fewest OCCUPIED proposal slots per epoch at which `R >= C`.

    Slate occupancy is a separate axis from book depth and conflating them
    overstates self-funding badly. "A five-slot PARAM slate at the `dec.v_min`
    floor" is the minimum *depth* at which five proposals are decision-grade --
    it is not the minimum *activity* at which the chain decides anything, which
    is ONE proposal. Held capital scales with occupancy, so a chain deciding one
    proposal per epoch earns roughly a fifth of the five-slot figure.

    Returns `None` when no occupancy up to `max_slots` covers the cost base.
    `epoch.slots` defaults to 5 and its registry maximum is 12 (13 §1), so a
    `None` at 12 means no lawful occupancy covers it at this `tau`.
    """
    for slots in range(1, max_slots + 1):
        held = annual_held_capital(proposal_class, Decimal(slots), saturated)
        if revenue(held, tau) >= annual_cost:
            return slots
    return None


def break_even_slots_consistent(
    tau: Decimal,
    params: CostParams | None = None,
    proposal_class: str = "param",
    saturated: bool = False,
    max_slots: int = 12,
) -> int | None:
    """`break_even_slots`, with cost evaluated at the SAME occupancy as revenue.

    `break_even_slots` holds the full-slate cost fixed while varying revenue
    occupancy, which charges five slots' proposer rewards against one slot's
    trading. That is the mirror of the error this pair of functions exists to
    correct, and it runs against the protocol rather than for it -- so the
    honest break-even is lower than the fixed-cost one, not higher.
    """
    p = params or CostParams()
    for slots in range(1, max_slots + 1):
        held = annual_held_capital(proposal_class, Decimal(slots), saturated)
        if revenue(held, tau) >= cost_at_occupancy(Decimal(slots), p):
            return slots
    return None


@dataclass(frozen=True)
class OperatingPoint:
    """A candidate parameter set together with everything it implies."""

    params: CostParams
    tau: Decimal
    held_capital: Decimal

    @property
    def cost(self) -> CostBase:
        return cost_base(self.params)

    @property
    def annual_revenue(self) -> Decimal:
        return revenue(self.held_capital, self.tau)

    @property
    def net_burn(self) -> Decimal:
        return self.cost.annual - self.annual_revenue

    @property
    def self_funding(self) -> bool:
        return self.net_burn <= 0

    def runway_to(self, floor: Decimal) -> Decimal:
        return runway_years(self.cost.annual, floor, self.annual_revenue)

    def crossover(self) -> Decimal:
        return crossover_held_capital(self.cost.annual, self.tau)


# ---------------------------------------------------------------------------
# Admissibility -- a proposed operating point must be reachable by governance
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AdmissibilityFinding:
    key: str
    ok: bool
    detail: str


def check_admissible(params: CostParams) -> list[AdmissibilityFinding]:
    """Every 13 §1 bound and coupling a proposed operating point must satisfy.

    A parameter set that reduces cost but cannot be reached by a lawful
    amendment is not a proposal, it is a wish. This is what separates the two.
    """
    out: list[AdmissibilityFinding] = []

    out.append(
        AdmissibilityFinding(
            "mkt.obs_interval",
            OBS_INTERVAL_MIN <= params.mkt_obs_interval <= OBS_INTERVAL_MAX,
            f"{params.mkt_obs_interval} must be in "
            f"[{OBS_INTERVAL_MIN}, {OBS_INTERVAL_MAX}] (13 §1)",
        )
    )
    # SQ-526: the registry max equals the KERNEL staleness threshold, so at the
    # top of the range every on-grid observation sits exactly on the boundary
    # and one missed crank trips `stale_events`. Require a real margin.
    out.append(
        AdmissibilityFinding(
            "mkt.obs_interval vs MKT_STALE_GAP_BLOCKS",
            params.mkt_obs_interval * Decimal(2) <= STALE_GAP_BLOCKS,
            f"{params.mkt_obs_interval} must leave >=2x margin under the "
            f"kernel staleness gap {STALE_GAP_BLOCKS} (04 §7; SQ-526)",
        )
    )
    out.append(
        AdmissibilityFinding(
            "keeper.budget_epoch",
            KEEPER_BUDGET_MIN <= params.keeper_budget_epoch <= KEEPER_BUDGET_MAX,
            f"{params.keeper_budget_epoch} must be in "
            f"[{KEEPER_BUDGET_MIN}, {KEEPER_BUDGET_MAX}] (13 §1 kernel floor)",
        )
    )
    # 08 §6.2: the metered budget must cover the decision-critical load, or
    # rational keepers stop mid-window and every decision rejects
    # NotDecisionGrade (A-1 fails silently). This is the load-bearing check.
    required = params.decision_critical_cranks() * params.keeper_rebate
    out.append(
        AdmissibilityFinding(
            "keeper.budget_epoch covers decision-critical load",
            params.keeper_budget_epoch >= required,
            f"budget {params.keeper_budget_epoch} must cover "
            f"{params.decision_critical_cranks()} cranks x {params.keeper_rebate} "
            f"= {required} (08 §6.2)",
        )
    )
    lo = KEEPER_REBATE_MIN_MULTIPLE * params.crank_fee_basis
    hi = KEEPER_REBATE_MAX_MULTIPLE * params.crank_fee_basis
    out.append(
        AdmissibilityFinding(
            "keeper.rebate",
            lo <= params.keeper_rebate <= hi,
            f"{params.keeper_rebate} must be in [{lo}, {hi}] "
            f"= [1x, 10x] the {params.crank_fee_basis} fee basis (13 §1)",
        )
    )
    out.append(
        AdmissibilityFinding(
            "collator.comp_epoch",
            COLLATOR_COMP_MIN <= params.collator_comp_epoch <= COLLATOR_COMP_MAX,
            f"{params.collator_comp_epoch} must be in "
            f"[{COLLATOR_COMP_MIN}, {COLLATOR_COMP_MAX}] (13 §1)",
        )
    )
    # 13 §5 item 6 / the occupancy screen: `constitution.set_param` re-derives
    # items 1-4 from the PROPOSED set and refuses when one would exceed the
    # frozen figure. Raising mkt.obs_interval lowers both, so it passes; this
    # check exists so a future edit that lowers it fails loudly here first.
    base = CostParams()
    out.append(
        AdmissibilityFinding(
            "13 §5 occupancy screen (decision-critical)",
            params.decision_critical_cranks() <= base.decision_critical_cranks(),
            f"{params.decision_critical_cranks()} must not exceed the frozen "
            f"{base.decision_critical_cranks()} (13 §5 item 4)",
        )
    )
    out.append(
        AdmissibilityFinding(
            "13 §5 occupancy screen (full-window)",
            params.full_window_cranks() <= base.full_window_cranks(),
            f"{params.full_window_cranks()} must not exceed the frozen "
            f"{base.full_window_cranks()} (13 §5 item 4)",
        )
    )
    return out


def is_admissible(params: CostParams) -> bool:
    return all(f.ok for f in check_admissible(params))


def amendment_steps(current: Decimal, target: Decimal, max_delta: Decimal) -> int:
    """How many amendments an additive-max-delta key needs to reach `target`.

    13 §1 gives `mkt.obs_interval` an additive max-delta of 5 and a 1-epoch
    cooldown, so the walk is visible and rate-limited rather than instant.
    """
    if current == target:
        return 0
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        distance = abs(target - current)
        steps = distance / max_delta
        whole = int(steps)
        return whole if Decimal(whole) == steps else whole + 1


def multiplicative_amendment_steps(
    current: Decimal, target: Decimal, factor: Decimal
) -> int:
    """Same, for a key whose max-delta is multiplicative (e.g. collator.comp x2)."""
    if current == target:
        return 0
    steps = 0
    value = current
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        while value > target:
            value = value / factor
            steps += 1
            if steps > 64:
                raise ValueError("target unreachable by multiplicative steps")
        while value < target:
            value = value * factor
            steps += 1
            if steps > 64:
                raise ValueError("target unreachable by multiplicative steps")
    return steps


def with_levers(**overrides) -> CostParams:
    """`CostParams` with named overrides, for readable scenario construction."""
    return replace(CostParams(), **{k: Decimal(str(v)) for k, v in overrides.items()})


# The superseded operating point, kept so the published 08 §10.1 table that
# E5 replaces stays reproducible and the size of the correction stays checkable.
# `keeper.rebate` = 0.09 was 3x an ASSUMED 0.03 USDC crank fee that nobody had
# measured; the real fee is 0.000085 USDC, so the seed was ~1,058x the fee it
# claimed to be 3x, and both keeper lines -- 79.3 % of the whole cost base --
# were scaled by that error (SQ-531). Pass 2 additionally re-seeded
# `collator.comp_epoch` 2,000 -> 500 against the referendum #1870 anchor
# (SQ-536), so that value is pinned here too rather than inherited.
def pre_e5_params(**overrides) -> CostParams:
    base = replace(
        CostParams(),
        keeper_rebate=Decimal("0.09"),
        crank_fee_basis=Decimal("0.03"),
        collator_comp_epoch=Decimal(2_000),
    )
    return replace(base, **{k: Decimal(str(v)) for k, v in overrides.items()})
