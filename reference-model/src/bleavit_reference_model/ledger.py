from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_FLOOR, localcontext
from enum import Enum

WORK_PREC = 100
BASE_UNIT = Decimal("0.000001")  # 02 §8: one USDC base unit.

# --------------------------------------------------------------------------
# 03 §5.3a — redemption fee (milestone E1)
# --------------------------------------------------------------------------

PERBILL_ONE = 1_000_000_000
"""Perbill denominator: 02 §4 stores a `Perbill` as parts per billion."""

MIN_SPLIT = 10_000
"""13 §1 `ledger.min_split` = 0.01 USDC = 10^4 base units (03 §7 R-2)."""

DEFAULT_REDEEM_FEE_PERBILL = 3_000_000
"""13 §1 `ledger.redeem_fee` launch default: 30 bps.

Deliberately **not** the model's construction default. Every vault is built at
rate 0 so the fee is opt-in: the zero-rate leg is the pre-E1 regression that
15 §4.3 makes normative, and it is what proves the fee changed nothing it was
not meant to change.
"""


class VaultState(Enum):
    OPEN = "Open"
    RESOLVED = "Resolved"
    SCALAR_SETTLED = "ScalarSettled"
    VOIDED = "Voided"


class BaselineState(Enum):
    OPEN = "Open"
    SETTLED = "Settled"


class Branch(Enum):
    ACCEPT = "Accept"
    REJECT = "Reject"


class GateType(Enum):
    SURVIVAL = "Survival"
    SECURITY = "Security"


class ScalarSide(Enum):
    LONG = "Long"
    SHORT = "Short"


class GateSide(Enum):
    YES = "Yes"
    NO = "No"


class PositionKind(Enum):
    BRANCH_USDC = "BranchUsdc"
    LONG = "Long"
    SHORT = "Short"
    GATE_YES = "GateYes"
    GATE_NO = "GateNo"


class FeeTreatment(Enum):
    """03 §5.3a(1): the fee treatment of one escrow outflow.

    The treatment is **named at every call site**, never inferred from the
    payout, the vault state or the shape of the helper. That is what makes the
    exemptions structural: a later edit to the shared payout seam cannot make
    `redeem` (the G-3 par leg) or `redeem_void` (protocol failure) start paying
    a fee, because those call sites say what they are.

    Each exempt member records *why* it is exempt, mirroring §5.3a(1)'s
    enumeration — the exclusions are load-bearing, not conveniences.
    """

    CHARGED = "Charged"
    EXEMPT_PAR_LEG = "ExemptParLeg"
    """`redeem` — winning branch-USDC at par; charging it falsifies G-3."""

    EXEMPT_VOID = "ExemptVoid"
    """`redeem_void` — VOID is protocol failure (D-1); charging inverts G-1."""

    EXEMPT_MERGE = "ExemptMerge"
    """Every `merge*` — the complete-set primitive; a fee opens a spread."""

    EXEMPT_PROTOCOL = "ExemptProtocol"
    """A `ProtocolAccounts` claimant — the treasury would be taxing itself."""

    EXEMPT_SWEEP = "ExemptSweep"
    """`sweep_dust` residue → INSURANCE (§7 R-5); not a settlement payout."""

    @property
    def charged(self) -> bool:
        return self is FeeTreatment.CHARGED


def to_base_units(amount) -> int:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        scaled = Decimal(str(amount)) / BASE_UNIT
        integral = scaled.to_integral_value(rounding=ROUND_FLOOR)
        if scaled != integral:
            raise ValueError("amount is below the USDC base-unit grid")
        return int(integral)


def from_base_units(amount: int) -> Decimal:
    return Decimal(amount) * BASE_UNIT


def _amount(amount: int) -> int:
    if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
        raise ValueError("amount must be a non-negative integer base-unit balance")
    return amount


def effective_redeem_fee(rate) -> int:
    """03 §5.3a(5): read the rate, and fail **open**.

    A missing, malformed or out-of-domain record reads as **zero**, i.e. the
    fee is waived. This is the one place in the ledger where the fail-open
    direction is the correct one, because it is the claimant-favouring one
    (I-32(d)): a waived fee costs revenue, while a fee charged from an
    unreadable record takes value from a claimant on the strength of state the
    runtime could not parse.

    Only the `Perbill` **domain** is screened here. The 13 §1 record bounds and
    the live `ledger.redeem_fee ≤ mkt.fee` coupling are screened at the
    amendment boundary (13 rule 7), not by the consumer — and per I-31 no
    admissible rate, including a hypothetical 100 %, can create an unbacked
    claim, so the ledger must not reject a merely large rate.
    """
    if not isinstance(rate, int) or isinstance(rate, bool):
        return 0
    if rate < 0 or rate > PERBILL_ONE:
        return 0
    return rate


def redemption_fee(gross: int, rate, min_split: int = MIN_SPLIT) -> int:
    """03 §5.3a(2): the redemption fee on a gross payout.

        fee(g) = 0                if g − ceil(g · rate) < ledger.min_split
               = ceil(g · rate)   otherwise

    Pure integer arithmetic on base units — no floats, no `Decimal`. The fee
    rounds **up**, i.e. against the claimant and in favour of the protocol,
    matching 03 §7 R-1's direction for every other division.

    **The waiver tests the net, not the gross**, and that is load-bearing:
    `ledger.min_split` and the USDC `min_balance` are the same 10^4 (§7 R-2,
    R-4), so a gross-based test would let a gross of exactly `min_balance`
    through, charge it, and net it *below* `min_balance` — landing on the very
    R-4 `BelowMinimum` path the waiver exists to remove (§5.3a(2), I-32(b)).
    The net-based predicate `g − ceil(g·rate) < min_split` is monotone in `g`,
    so the waived set is a prefix interval and there is no second band.
    """
    gross = _amount(gross)
    rate = effective_redeem_fee(rate)
    fee = -((-gross * rate) // PERBILL_ONE)
    if fee > gross:
        # §5.3a(2): `fee(g) ≤ g` holds for every admissible rate, so no payout
        # can go negative and no branch of the arithmetic can underflow.
        raise AssertionError("redemption fee exceeds the gross payout")
    if gross - fee < min_split:
        return 0
    return fee


def _pair_legs(amount: int, s: Decimal) -> tuple[int, int]:
    """The LONG/SHORT gross payouts a pair's holdings would take leg by leg."""
    return (
        _floor_product(amount, s),
        _floor_product(amount, Decimal(1) - s),
    )


def redemption_fee_pair(
    amount: int, s: Decimal, rate, min_split: int = MIN_SPLIT
) -> int:
    """03 §5.3a(2a): a pair charges what its legs would charge.

        fee_pair(a) = fee(floor(a·s)) + fee(floor(a·(1−s)))

    **Not** `fee(a)`. Charging the combined base while the waiver applies per
    call is what let a pair pay *less* than leg-by-leg redemption of the same
    holdings, inverting the whole point of the atomic call (§5.3a(2a)). With
    the identical fee function on the identical bases the interaction is gone:
    since `floor(a·s) + floor(a·(1−s)) ≤ a`, the pair's **gross** advantage
    survives and `net_pair ≥ net_legs` for every `a`, `s` and rate, with
    equality exactly when the flooring loses nothing. The pair still pays
    exactly `a` gross; only the fee base changes.
    """
    return sum(
        redemption_fee(leg, rate, min_split)
        for leg in _pair_legs(_amount(amount), s)
    )


def _floor_product(amount: int, factor: Decimal) -> int:
    with localcontext() as ctx:
        ctx.prec = WORK_PREC
        return int(
            (Decimal(amount) * Decimal(factor)).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )


class _RedemptionFeeMixin:
    """03 §5.3a fee accounting, shared by the proposal and Baseline vaults.

    The *fields* are declared by each dataclass rather than here, so that
    neither vault inherits a field order it does not want; only the logic is
    single-homed, so the two kinds cannot drift apart. Each carries:

    ``redeem_fee``
        The live `ledger.redeem_fee` rate as a `Perbill` inner scalar (parts
        per billion). Defaults to **0** everywhere: the fee is opt-in.
    ``min_split``
        The `ledger.min_split` small-payout waiver threshold (§5.3a(3)).
    ``redemption_fees_accrued``
        The O(1) maintained `RedemptionFeesAccrued` counter of §5.3a(4). It is
        per vault here and sums to the pallet-wide counter exactly as
        ``escrowed`` sums to `TotalEscrowed`.
    ``fees_charged_total`` / ``fees_swept_total``
        Cumulative ledgers used only by ``check_conservation`` to pin the
        counter's monotonicity between sweeps.
    ``net_payouts``
        What claimants actually received, accumulated independently of
        ``total_payouts`` (the gross that left escrow) so that the
        ``net + fee == gross`` identity is a real check and not a tautology.
    ``sovereign``
        The ledger sovereign's USDC custody, accumulated by following the
        **real transfers**: collateral in on a split, the *net* out on a
        payout, the swept amount out on a sweep. It is deliberately not
        derived from the other counters, so ``escrowed + accrued ==
        sovereign`` catches a payout that drew the fee out of custody a second
        time (§5.3a(4), I-31, §9 L-2).
    """

    def _pay_out(
        self, gross: int, treatment: FeeTreatment, fee_basis=None
    ) -> int:
        """The single escrow-outflow seam. Returns the **net** to the claimant.

        03 §5.3a(4): `escrowed` decrements by the **gross**, always. The fee is
        not a second draw on escrow — it never leaves the sovereign account
        during the redemption, and is recorded in the accrual counter instead.

        `fee_basis` is the sequence of amounts the fee is computed over, each
        applying its own §5.3a(2) waiver. It defaults to the gross itself; the
        pair calls pass their two legs per §5.3a(2a), which is the only way the
        base ever differs from the gross.
        """
        if not isinstance(treatment, FeeTreatment):
            raise ValueError(
                "every escrow outflow must name its 03 §5.3a fee treatment"
            )
        gross = _amount(gross)
        basis = (gross,) if fee_basis is None else tuple(fee_basis)
        fee = (
            sum(
                redemption_fee(part, self.redeem_fee, self.min_split)
                for part in basis
            )
            if treatment.charged
            else 0
        )
        if fee > gross:
            # §5.3a(2a): the legs sum to at most the gross and each leg's fee
            # is at most its leg, so this can only fire on a mis-built basis.
            raise AssertionError("redemption fee exceeds the gross payout")
        net = gross - fee
        self._pay(gross)
        self.net_payouts += net
        self.fees_charged_total += fee
        self.redemption_fees_accrued += fee
        # §5.3a(4): only the net leaves the sovereign account. The fee is
        # retained there as lawful surplus until it is swept.
        self.sovereign -= net
        return net

    def sweep_redemption_fees(self) -> int:
        """03 §5.4 / §5.3a(4) / §6.5(3): pay the counter out and zero it.

        Touches no escrow, no supply field and no vault state, so it is outside
        the §6.5 induction entirely. A sweep on an empty counter is a no-op
        (I-31).
        """
        amount = self.redemption_fees_accrued
        self.redemption_fees_accrued = 0
        self.fees_swept_total += amount
        self.sovereign -= amount
        self.check_conservation()
        return amount

    @staticmethod
    def _claimant_treatment(protocol_account: bool) -> FeeTreatment:
        """03 §5.3a(1): `ProtocolAccounts` are exempt on every charged call."""
        return (
            FeeTreatment.EXEMPT_PROTOCOL
            if protocol_account
            else FeeTreatment.CHARGED
        )

    def _check_fee_conservation(self) -> None:
        """03 §6.5 closing paragraph and I-31, checked on every operation."""
        if self.redemption_fees_accrued < 0 or self.fees_swept_total < 0:
            raise AssertionError("negative redemption-fee counter")
        # (1) `net + fee == gross`: escrow saw the gross, the claimant saw the
        # net, and the difference is exactly the fee — no third destination.
        if self.net_payouts + self.fees_charged_total != self.total_payouts:
            raise AssertionError("net + fee != gross payout")
        # (2) The counter is monotone between sweeps: accrual only adds, and
        # `sweep_redemption_fees` is the only operation that removes.
        if (
            self.redemption_fees_accrued + self.fees_swept_total
            != self.fees_charged_total
        ):
            raise AssertionError("redemption-fee counter is not sweep-exact")
        # (3) §5.3a(4)/§6.5(2), I-31: the retained fee is lawful surplus and
        # never encroaches on escrow. `sovereign` follows the real transfers,
        # so this catches a payout that drew the fee out of custody a second
        # time. L-2 holds with slack exactly equal to the accrued counter, and
        # the I-4 drift predicate `liability > custody` therefore moves
        # strictly *away* from firing on every charged redemption.
        if self.sovereign < self.escrowed:
            raise AssertionError("escrow exceeds custody")
        if self.escrowed + self.redemption_fees_accrued != self.sovereign:
            raise AssertionError("accrued fee is not exactly the custody surplus")


@dataclass
class BranchSupply:
    usdc: int = 0
    scalar_sets: int = 0
    gate_sets: dict[GateType, int] = field(
        default_factory=lambda: {gate: 0 for gate in GateType}
    )
    long: int = 0
    short: int = 0
    gate_yes: dict[GateType, int] = field(
        default_factory=lambda: {gate: 0 for gate in GateType}
    )
    gate_no: dict[GateType, int] = field(
        default_factory=lambda: {gate: 0 for gate in GateType}
    )

    def identity(self) -> int:
        return self.usdc + self.scalar_sets + sum(self.gate_sets.values())


@dataclass
class Vault(_RedemptionFeeMixin):
    escrowed: int = 0
    state: VaultState = VaultState.OPEN
    winner: Branch | None = None
    s: Decimal | None = None
    branches: dict[Branch, BranchSupply] = field(
        default_factory=lambda: {branch: BranchSupply() for branch in Branch}
    )
    gate_outcomes: dict[GateType, bool | None] = field(
        default_factory=lambda: {gate: None for gate in GateType}
    )
    collateral_in: int = 0
    total_payouts: int = 0
    terminal_redemptions: int = 0
    # 03 §5.3a (see `_RedemptionFeeMixin`). The rate defaults to 0 so every
    # pre-E1 caller keeps its exact behaviour unless it opts in.
    redeem_fee: int = 0
    min_split: int = MIN_SPLIT
    redemption_fees_accrued: int = 0
    fees_charged_total: int = 0
    fees_swept_total: int = 0
    net_payouts: int = 0
    sovereign: int = 0

    def split(self, amount: int) -> None:
        self._need(VaultState.OPEN)
        amount = _amount(amount)
        self.escrowed += amount
        self.collateral_in += amount
        self.sovereign += amount
        for branch in Branch:
            self.branches[branch].usdc += amount
        self.check_conservation()

    def merge(self, amount: int) -> int:
        if self.state not in (
            VaultState.OPEN,
            VaultState.RESOLVED,
            VaultState.VOIDED,
        ):
            raise ValueError("wrong state")
        amount = _amount(amount)
        for branch in Branch:
            self._take(self.branches[branch], "usdc", amount)
        # 03 §5.3a(1): every `merge*` is exempt — these are the complete-set
        # primitives, and a fee on them opens a spread around par.
        payout = self._pay_out(amount, FeeTreatment.EXEMPT_MERGE)
        self.check_conservation()
        return payout

    def split_scalar(self, branch: Branch, amount: int) -> None:
        self._need(VaultState.OPEN)
        amount = _amount(amount)
        supply = self.branches[branch]
        self._take(supply, "usdc", amount)
        supply.scalar_sets += amount
        supply.long += amount
        supply.short += amount
        self.check_conservation()

    def merge_scalar(self, branch: Branch, amount: int) -> None:
        if self.state not in (
            VaultState.OPEN,
            VaultState.RESOLVED,
            VaultState.VOIDED,
        ):
            raise ValueError("wrong state")
        amount = _amount(amount)
        supply = self.branches[branch]
        self._take(supply, "long", amount)
        self._take(supply, "short", amount)
        self._take(supply, "scalar_sets", amount)
        supply.usdc += amount
        self.check_conservation()

    def split_gate(self, branch: Branch, gate: GateType, amount: int) -> None:
        self._need(VaultState.OPEN)
        amount = _amount(amount)
        supply = self.branches[branch]
        self._take(supply, "usdc", amount)
        supply.gate_sets[gate] += amount
        supply.gate_yes[gate] += amount
        supply.gate_no[gate] += amount
        self.check_conservation()

    def merge_gate(self, branch: Branch, gate: GateType, amount: int) -> None:
        if self.state not in (
            VaultState.OPEN,
            VaultState.RESOLVED,
            VaultState.VOIDED,
        ):
            raise ValueError("wrong state")
        amount = _amount(amount)
        supply = self.branches[branch]
        self._take_map(supply.gate_yes, gate, amount)
        self._take_map(supply.gate_no, gate, amount)
        self._take_map(supply.gate_sets, gate, amount)
        supply.usdc += amount
        self.check_conservation()

    def transfer(self, amount: int) -> int:
        if self.state not in (
            VaultState.OPEN,
            VaultState.RESOLVED,
            VaultState.VOIDED,
        ):
            raise ValueError("wrong state")
        return _amount(amount)

    def resolve(self, winner: Branch) -> None:
        self._need(VaultState.OPEN)
        self.state = VaultState.RESOLVED
        self.winner = winner
        self.check_conservation()

    def void(self) -> None:
        if self.state not in (VaultState.OPEN, VaultState.RESOLVED):
            raise ValueError("wrong state")
        self.state = VaultState.VOIDED
        self.check_conservation()

    def settle_scalar(self, s: Decimal) -> None:
        self._need(VaultState.RESOLVED)
        s = Decimal(s)
        if not Decimal(0) <= s <= Decimal(1):
            raise ValueError("s must be in [0, 1]")
        self.state = VaultState.SCALAR_SETTLED
        self.s = s
        self.check_conservation()

    def settle_gate(self, gate: GateType, outcome: bool) -> None:
        if self.state not in (
            VaultState.RESOLVED,
            VaultState.SCALAR_SETTLED,
        ):
            raise ValueError("wrong state")
        if self.gate_outcomes[gate] is not None:
            raise ValueError("gate already settled")
        self.gate_outcomes[gate] = bool(outcome)
        self.check_conservation()

    def redeem(self, branch: Branch, amount: int) -> int:
        """03 §5.3: winning branch-USDC 1:1. **Fee-exempt** (§5.3a(1)).

        This is the par leg — the mirror credit every D-3 wrapper buy leaves
        with the buyer — and G-3 promises it redeems at par. The exemption is
        named here rather than derived, so it cannot be lost to an edit of the
        shared payout seam.
        """
        self._need(VaultState.SCALAR_SETTLED)
        self._winning(branch)
        amount = _amount(amount)
        self._take(self.branches[branch], "usdc", amount)
        return self._terminal_pay(amount, FeeTreatment.EXEMPT_PAR_LEG)

    def redeem_scalar(
        self,
        branch: Branch,
        side: ScalarSide,
        amount: int,
        protocol_account: bool = False,
    ) -> int:
        """03 §5.3: unpaired scalar leg. **Charged** (§5.3a)."""
        self._need(VaultState.SCALAR_SETTLED)
        self._winning(branch)
        amount = _amount(amount)
        supply = self.branches[branch]
        if side is ScalarSide.LONG:
            self._take(supply, "long", amount)
            payout = _floor_product(amount, self.s)
        else:
            self._take(supply, "short", amount)
            payout = _floor_product(amount, Decimal(1) - self.s)
        return self._terminal_pay(
            payout, self._claimant_treatment(protocol_account)
        )

    def redeem_scalar_pair(
        self, branch: Branch, amount: int, protocol_account: bool = False
    ) -> int:
        """03 §5.3: atomic complete set, gross exactly `a`. **Charged**.

        §5.3a(1): exempting the pair path would tax the *fragmented* holder and
        spare the *assembled* one. §5.3a(2a): the fee base is the pair's own
        two legs, not the combined gross, which is what keeps the PT-7
        relative guarantee — the pair never pays less than leg-by-leg
        redemption of the same holdings.
        """
        self._need(VaultState.SCALAR_SETTLED)
        self._winning(branch)
        amount = _amount(amount)
        supply = self.branches[branch]
        self._take(supply, "long", amount)
        self._take(supply, "short", amount)
        self._take(supply, "scalar_sets", amount)
        return self._terminal_pay(
            amount,
            self._claimant_treatment(protocol_account),
            _pair_legs(amount, self.s),
        )

    def redeem_gate(
        self,
        branch: Branch,
        gate: GateType,
        side: GateSide,
        amount: int,
        protocol_account: bool = False,
    ) -> int:
        self._need(VaultState.SCALAR_SETTLED)
        self._winning(branch)
        outcome = self.gate_outcomes[gate]
        if outcome is None:
            raise ValueError("gate is not settled")
        amount = _amount(amount)
        balances = (
            self.branches[branch].gate_yes
            if side is GateSide.YES
            else self.branches[branch].gate_no
        )
        self._take_map(balances, gate, amount)
        winning = (side is GateSide.YES) == outcome
        # 03 §5.3: winning side 1:1, losing side pays 0. **Charged** (§5.3a) —
        # a zero gross is waived by the sub-`min_split` rule, not by exemption.
        return self._terminal_pay(
            amount if winning else 0,
            self._claimant_treatment(protocol_account),
        )

    def redeem_void(
        self,
        branch: Branch,
        kind: PositionKind,
        amount: int,
        gate: GateType | None = None,
    ) -> int:
        self._need(VaultState.VOIDED)
        amount = _amount(amount)
        supply = self.branches[branch]
        if kind is PositionKind.BRANCH_USDC:
            self._take(supply, "usdc", amount)
            payout = amount // 2
        elif kind is PositionKind.LONG:
            self._take(supply, "long", amount)
            payout = amount // 4
        elif kind is PositionKind.SHORT:
            self._take(supply, "short", amount)
            payout = amount // 4
        elif kind in (PositionKind.GATE_YES, PositionKind.GATE_NO):
            if gate is None:
                raise ValueError("gate is required")
            balances = supply.gate_yes if kind is PositionKind.GATE_YES else supply.gate_no
            self._take_map(balances, gate, amount)
            payout = amount // 4
        else:
            raise ValueError("unsupported position kind")
        # 03 §5.3a(1): VOID is protocol failure (D-1); charging users for the
        # protocol's own failure inverts G-1. Exempt, and named here so the
        # I-26 `Voided` schedule of §6.4 survives verbatim.
        return self._terminal_pay(payout, FeeTreatment.EXEMPT_VOID)

    def sweep_dust(self) -> int:
        if self.state not in (VaultState.SCALAR_SETTLED, VaultState.VOIDED):
            raise ValueError("vault is not terminal")
        residue = self.escrowed
        # 03 §7 R-5: residue moves to INSURANCE — not a settlement payout.
        self._pay_out(residue, FeeTreatment.EXEMPT_SWEEP)
        self.terminal_redemptions += 1
        for branch in Branch:
            self.branches[branch] = BranchSupply()
        self.check_conservation()
        return residue

    def check_conservation(self) -> None:
        """Assert 03 §6.1 identities and the terminal payout bound."""
        if self.escrowed < 0 or self.total_payouts > self.collateral_in:
            raise AssertionError("payout exceeds collateral")
        if self.escrowed + self.total_payouts != self.collateral_in:
            raise AssertionError("escrow flow mismatch")
        if self.terminal_redemptions == 0:
            for supply in self.branches.values():
                if supply.identity() != self.escrowed:
                    raise AssertionError("per-branch conservation identity failed")
                if supply.long != supply.short or supply.long != supply.scalar_sets:
                    raise AssertionError("scalar pair supply mismatch")
                for gate in GateType:
                    if (
                        supply.gate_yes[gate] != supply.gate_no[gate]
                        or supply.gate_yes[gate] != supply.gate_sets[gate]
                    ):
                        raise AssertionError("gate pair supply mismatch")
        # 03 §6.5(1): the claim bound stays **gross**. The fee changes only how
        # a payout is distributed after it leaves escrow, so charged
        # redemptions remain class (iii) and the inequality holds at least as
        # tightly as before.
        if self._claim_bound() > self.escrowed:
            raise AssertionError("remaining claims exceed escrow")
        self._check_fee_conservation()

    def _claim_bound(self) -> int:
        if self.state is VaultState.OPEN:
            return max(supply.identity() for supply in self.branches.values())
        if self.state is VaultState.RESOLVED:
            return self.branches[self.winner].identity()
        if self.state is VaultState.VOIDED:
            # 03 §6.4/§6.5: value the maximal dispatchable recovery path,
            # not each claim in isolation. Complete scalar/gate sets can first
            # merge into branch-USDC, and effective Accept+Reject branch-USDC
            # can then merge at par. Only unmatched remainders take the
            # claimant-adverse half/quarter VOID floors.
            effective = {}
            leftovers = 0
            for branch, supply in self.branches.items():
                scalar_pairs = min(supply.long, supply.short)
                branch_usdc = supply.usdc + scalar_pairs
                leftovers += (supply.long - scalar_pairs) // 4
                leftovers += (supply.short - scalar_pairs) // 4
                for gate in GateType:
                    gate_pairs = min(
                        supply.gate_yes[gate], supply.gate_no[gate]
                    )
                    branch_usdc += gate_pairs
                    leftovers += (
                        supply.gate_yes[gate] - gate_pairs
                    ) // 4
                    leftovers += (
                        supply.gate_no[gate] - gate_pairs
                    ) // 4
                effective[branch] = branch_usdc
            cross_pairs = min(
                effective[Branch.ACCEPT], effective[Branch.REJECT]
            )
            return (
                cross_pairs
                + (effective[Branch.ACCEPT] - cross_pairs) // 2
                + (effective[Branch.REJECT] - cross_pairs) // 2
                + leftovers
            )
        supply = self.branches[self.winner]
        pairs = min(supply.long, supply.short)
        scalar = pairs
        scalar += _floor_product(supply.long - pairs, self.s)
        scalar += _floor_product(
            supply.short - pairs, Decimal(1) - self.s
        )
        gates = 0
        for gate in GateType:
            outcome = self.gate_outcomes[gate]
            if outcome is None:
                gates += max(supply.gate_yes[gate], supply.gate_no[gate])
            elif outcome:
                gates += supply.gate_yes[gate]
            else:
                gates += supply.gate_no[gate]
        return supply.usdc + scalar + gates

    def _terminal_pay(
        self, gross: int, treatment: FeeTreatment, fee_basis=None
    ) -> int:
        """Shared terminal-redemption payout hook.

        `treatment` is a **required** argument: the shared seam never guesses
        whether a call is charged, so adding a redemption path without deciding
        its 03 §5.3a treatment is a `TypeError`, not a silent default.
        """
        self.terminal_redemptions += 1
        net = self._pay_out(gross, treatment, fee_basis)
        self.check_conservation()
        return net

    def _pay(self, amount: int) -> None:
        amount = _amount(amount)
        if amount > self.escrowed:
            raise ValueError("insufficient escrow")
        self.escrowed -= amount
        self.total_payouts += amount

    def _winning(self, branch: Branch) -> None:
        if branch is not self.winner:
            raise ValueError("losing branch")

    def _need(self, state: VaultState) -> None:
        if self.state is not state:
            raise ValueError("wrong state")

    @staticmethod
    def _take(target, name: str, amount: int) -> None:
        current = getattr(target, name)
        if amount > current:
            raise ValueError("insufficient supply")
        setattr(target, name, current - amount)

    @staticmethod
    def _take_map(target: dict, key, amount: int) -> None:
        if amount > target[key]:
            raise ValueError("insufficient supply")
        target[key] -= amount


@dataclass
class BaselineVault(_RedemptionFeeMixin):
    epoch: int
    escrowed: int = 0
    sets: int = 0
    long: int = 0
    short: int = 0
    state: BaselineState = BaselineState.OPEN
    s: Decimal | None = None
    collateral_in: int = 0
    total_payouts: int = 0
    # 03 §5.3a (see `_RedemptionFeeMixin`); rate defaults to 0 as above.
    redeem_fee: int = 0
    min_split: int = MIN_SPLIT
    redemption_fees_accrued: int = 0
    fees_charged_total: int = 0
    fees_swept_total: int = 0
    net_payouts: int = 0
    sovereign: int = 0

    def split_baseline(self, amount: int) -> None:
        self._need(BaselineState.OPEN)
        amount = _amount(amount)
        self.escrowed += amount
        self.collateral_in += amount
        self.sovereign += amount
        self.sets += amount
        self.long += amount
        self.short += amount
        self.check_conservation()

    def merge_baseline(self, amount: int) -> int:
        self._need(BaselineState.OPEN)
        amount = _amount(amount)
        self._take_pair(amount)
        # 03 §5.3a(1): every `merge*` is exempt.
        payout = self._pay_out(amount, FeeTreatment.EXEMPT_MERGE)
        self.check_conservation()
        return payout

    def transfer(self, amount: int) -> int:
        return _amount(amount)

    def settle_baseline(self, s: Decimal) -> None:
        self._need(BaselineState.OPEN)
        s = Decimal(s)
        if not Decimal(0) <= s <= Decimal(1):
            raise ValueError("s must be in [0, 1]")
        self.state = BaselineState.SETTLED
        self.s = s
        self.check_conservation()

    def redeem_baseline(
        self, side: ScalarSide, amount: int, protocol_account: bool = False
    ) -> int:
        """03 §5.3: unpaired Baseline leg. **Charged** (§5.3a)."""
        self._need(BaselineState.SETTLED)
        amount = _amount(amount)
        if side is ScalarSide.LONG:
            self._take("long", amount)
            payout = _floor_product(amount, self.s)
        else:
            self._take("short", amount)
            payout = _floor_product(amount, Decimal(1) - self.s)
        net = self._pay_out(
            payout, self._claimant_treatment(protocol_account)
        )
        self.check_conservation()
        return net

    def redeem_baseline_pair(
        self, amount: int, protocol_account: bool = False
    ) -> int:
        """03 §5.3: atomic Baseline set, gross exactly `a`. **Charged**.

        §5.3a(2a): the fee base is the pair's own two legs, as for
        `redeem_scalar_pair`.
        """
        self._need(BaselineState.SETTLED)
        amount = _amount(amount)
        self._take_pair(amount)
        net = self._pay_out(
            amount,
            self._claimant_treatment(protocol_account),
            _pair_legs(amount, self.s),
        )
        self.check_conservation()
        return net

    def sweep_dust(self) -> int:
        self._need(BaselineState.SETTLED)
        residue = self.escrowed
        # 03 §7 R-5: residue moves to INSURANCE — not a settlement payout.
        self._pay_out(residue, FeeTreatment.EXEMPT_SWEEP)
        self.long = self.short = self.sets = 0
        self.check_conservation()
        return residue

    def check_conservation(self) -> None:
        if self.escrowed < 0 or self.total_payouts > self.collateral_in:
            raise AssertionError("baseline payout exceeds collateral")
        if self.escrowed + self.total_payouts != self.collateral_in:
            raise AssertionError("baseline escrow flow mismatch")
        if self.state is BaselineState.OPEN:
            if not self.escrowed == self.sets == self.long == self.short:
                raise AssertionError("baseline set identity failed")
        # 03 §6.5(1): the claim bound stays gross, as for proposal vaults.
        if self._claim_bound() > self.escrowed:
            raise AssertionError("baseline claims exceed escrow")
        self._check_fee_conservation()

    def _claim_bound(self) -> int:
        if self.state is BaselineState.OPEN:
            return self.sets
        pairs = min(self.long, self.short)
        return (
            pairs
            + _floor_product(self.long - pairs, self.s)
            + _floor_product(self.short - pairs, Decimal(1) - self.s)
        )

    def _pay(self, amount: int) -> None:
        if amount > self.escrowed:
            raise ValueError("insufficient escrow")
        self.escrowed -= amount
        self.total_payouts += amount

    def _take(self, name: str, amount: int) -> None:
        current = getattr(self, name)
        if amount > current:
            raise ValueError("insufficient supply")
        setattr(self, name, current - amount)

    def _take_pair(self, amount: int) -> None:
        self._take("long", amount)
        self._take("short", amount)
        self._take("sets", amount)

    def _need(self, state: BaselineState) -> None:
        if self.state is not state:
            raise ValueError("wrong state")
