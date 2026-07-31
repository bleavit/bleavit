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
# The external anchor for `collator.comp_epoch` (SQ-535, milestone E5 pass 2).
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
    # 13 §1 `collator.comp_epoch`. SQ-535 (milestone E5 pass 2) re-seeded this
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
            pol_divergence=p.pol_divergence_annual,
            reserve_probe=p.reserve_probe_annual,
            ops_overlay=p.ops_overlay_annual,
        )


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
# (SQ-535), so that value is pinned here too rather than inherited.
def pre_e5_params(**overrides) -> CostParams:
    base = replace(
        CostParams(),
        keeper_rebate=Decimal("0.09"),
        crank_fee_basis=Decimal("0.03"),
        collator_comp_epoch=Decimal(2_000),
    )
    return replace(base, **{k: Decimal(str(v)) for k, v in overrides.items()})
