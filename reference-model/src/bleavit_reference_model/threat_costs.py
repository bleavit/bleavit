"""14 §3.2, §3.3, §4 — the threat model's attack-cost column, executed.

Doc 14 makes every number in a threat row normative. Three of those rows rely
on arithmetic rather than a rule: TH-64 says transaction fees price redemption
waiver fragmentation at about 1,000 times the fee avoided, TH-11 says position
deposits make third-party dusting uneconomic, and TH-16 prices sustained intake
and slot monopolization at about 10,900 USDC per epoch.

Executing the owning documents falsifies all three claims (SQ-556):

* 03 §5.3a(3), TH-64 and 14 §4 residual 14 agree with each other at about
  1,000x. The committed `redeem_scalar` weight instead charges 266 micro-USDC
  at the 0.05 USDC/VIT placeholder, so 100 calls avoid a 0.003-USDC fee for
  0.0266 USDC: exactly 133/15 = 8.8666...x. At the lawful 0.1x rate floor the
  ratio is 9/10, so the mitigation crosses into profit inside its own envelope.
  The continuous break-even rate is 0.005641145... USDC/VIT, only
  0.1128229...x the placeholder reference. Publishing a larger ratio is the
  unsafe direction because it overstates the cost of avoiding protocol revenue.
* A 64-slot position dusting costs the attacker 0.64 USDC of transferred dust
  plus 0.022656 USDC in `transfer` fees at the reference rate. The attacker's
  serial 0.1-USDC source deposit is refunded; the recipient, without consent,
  is forced to lock 6.4 USDC. A fast recovery costs another 0.022656 USDC and
  relocates the deposit lock to the next recipient. Releasing it through a
  sweep requires `ScalarSettled`/`Voided` (or Baseline `Settled`), the archive
  delay (one year at the default), and every seeded book's Sweep. The attack
  reaches only non-protocol accounts with enough reducible USDC to fund the
  recipient deposits.
* 08 §7 reproduces 64,000/6,400 USDC for intake denial,
  125,000/12,500 for slot capture, 189,000/18,900 combined, at least 16 funded
  accounts, and the 18,000-USDC refund-path fee floor. TH-16 instead applies
  the 10 percent slash to its superseded 109,000-USDC total and publishes
  10,900. That error understates the attacker's cost, so it is conservative
  rather than safety-weakening, but the two normative documents disagree.

Units are whole USDC and VIT represented as exact :class:`fractions.Fraction`.
VIT has 12 decimal places and USDC has 6. Transaction fees round **up** to a
micro-USDC against the fee payer (08 §9); redemption fees round up against the
claimant (03 §5.3a). No binary floating-point arithmetic is used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path


class ThreatCostError(ValueError):
    """A threat-cost derivation with an invalid or unreadable input refuses."""


def ceil_fraction(value: Fraction) -> int:
    """Round a non-negative exact quantity up to the next integer."""
    if value < 0:
        raise ThreatCostError(f"cannot ceil a negative cost {value}")
    return -(-value.numerator // value.denominator)


# ---------------------------------------------------------------------------
# Currency and fee mechanics (08 §6.2/§9).
# ---------------------------------------------------------------------------

VIT_BASE_UNITS = 10**12
USDC_BASE_UNITS = 10**6

# 08 §9 / 13 §1 `fee.vit_usdc_rate`: placeholder reference 0.05 USDC/VIT,
# with a kernel envelope [0.1x, 10x] of that genesis reference.
FEE_VIT_USDC_RATE_REF = Fraction(5, 100)
FEE_VIT_USDC_RATE_MIN = FEE_VIT_USDC_RATE_REF * Fraction(1, 10)
FEE_VIT_USDC_RATE_MAX = FEE_VIT_USDC_RATE_REF * 10

# 08 §6.2's measured transaction-fee composition. WeightToFee and
# LengthToFee are IdentityFee: one picosecond/byte maps to one VIT planck.
TX_EXTENSION_REF_TIME = 352_392_000
EXTRINSIC_BASE_REF_TIME = 108_157_000
DEFAULT_EXTRINSIC_LENGTH = 120

# runtime configs bind RocksDbWeight; these are the generated-weight read/write
# ref-time charges used by 08 §6.2's committed-weight derivation.
ROCKSDB_READ_REF_TIME = 25_000_000
ROCKSDB_WRITE_REF_TIME = 100_000_000

GENERATED_LEDGER_WEIGHT_FILE = Path(
    "runtime/bleavit-runtime/src/weights/pallet_conditional_ledger.rs"
)


@dataclass(frozen=True)
class CallWeight:
    """One committed generated call weight's fee-bearing ref-time parts."""

    function: str
    call_ref_time: int
    reads: int
    writes: int
    source: Path = GENERATED_LEDGER_WEIGHT_FILE

    def dispatch_ref_time(self) -> int:
        """Call ref-time plus RocksDB reads/writes; proof size is not fee time."""
        return (
            self.call_ref_time
            + self.reads * ROCKSDB_READ_REF_TIME
            + self.writes * ROCKSDB_WRITE_REF_TIME
        )

    def fee_plancks(self, length_bytes: int = DEFAULT_EXTRINSIC_LENGTH) -> int:
        """08 §6.2: dispatch + extension + base + length, in VIT plancks."""
        if length_bytes < 0:
            raise ThreatCostError(f"negative extrinsic length {length_bytes}")
        return (
            self.dispatch_ref_time()
            + TX_EXTENSION_REF_TIME
            + EXTRINSIC_BASE_REF_TIME
            + length_bytes
        )

    def fee_vit(self, length_bytes: int = DEFAULT_EXTRINSIC_LENGTH) -> Fraction:
        return Fraction(self.fee_plancks(length_bytes), VIT_BASE_UNITS)


# Live implementation inputs, deliberately kept separate from the specification
# parameters below. Source: runtime/bleavit-runtime/src/weights/
# pallet_conditional_ledger.rs, `WeightInfo::redeem_scalar`.
REDEEM_SCALAR_WEIGHT = CallWeight("redeem_scalar", 232_520_000, 41, 36)
# Same file, `WeightInfo::transfer`; TH-11's attacker calls this, not a crank.
TRANSFER_WEIGHT = CallWeight("transfer", 293_020_000, 57, 49)


def generated_call_weight(repo_root: Path, function: str) -> CallWeight:
    """Read one generated ledger weight so committed weights cannot drift silently."""
    path = repo_root / GENERATED_LEDGER_WEIGHT_FILE
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"\bfn\s+{re.escape(function)}\(\)\s*->\s*Weight\s*\{{(.*?)\n\s*\}}",
        text,
        re.DOTALL,
    )
    if match is None:
        raise ThreatCostError(f"generated function {function!r} not found in {path}")
    body = match.group(1)
    call = re.search(r"Weight::from_parts\(([\d_]+),\s*0\)", body)
    reads = re.search(r"DbWeight::get\(\)\.reads\(([\d_]+)\)", body)
    writes = re.search(r"DbWeight::get\(\)\.writes\(([\d_]+)\)", body)
    if call is None or reads is None or writes is None:
        raise ThreatCostError(f"generated weight grammar unreadable for {function!r}")
    integer = lambda token: int(token.replace("_", ""))
    return CallWeight(
        function,
        integer(call.group(1)),
        integer(reads.group(1)),
        integer(writes.group(1)),
    )


def raw_transaction_fee_usdc(
    vit_usdc_rate: Fraction,
    weight: CallWeight,
    length_bytes: int = DEFAULT_EXTRINSIC_LENGTH,
) -> Fraction:
    """The exact pre-USDC-rounding fee for one call (08 §9)."""
    if vit_usdc_rate < 0:
        raise ThreatCostError(f"negative VIT/USDC rate {vit_usdc_rate}")
    return weight.fee_vit(length_bytes) * vit_usdc_rate


def transaction_fee_usdc(
    vit_usdc_rate: Fraction,
    weight: CallWeight,
    length_bytes: int = DEFAULT_EXTRINSIC_LENGTH,
) -> Fraction:
    """08 §9's `ceil(fee_vit * rate)`, minimum one micro-USDC.

    Rounding up is against the fee payer. Underpricing an attack is the unsafe
    direction, so the executable cost uses the charged micro-USDC amount rather
    than 08 §6.2's display-rounded 85-micro-USDC basis.
    """
    raw = raw_transaction_fee_usdc(vit_usdc_rate, weight, length_bytes)
    base_units = max(1, ceil_fraction(raw * USDC_BASE_UNITS))
    return Fraction(base_units, USDC_BASE_UNITS)


# ---------------------------------------------------------------------------
# TH-64 / 03 §5.3a — redemption-fee waiver fragmentation.
# ---------------------------------------------------------------------------

# 13 §1 `ledger.min_split` and `ledger.redeem_fee`.
LEDGER_MIN_SPLIT = Fraction(1, 100)  # 0.01 USDC; hard floor is the default.
LEDGER_REDEEM_FEE = Fraction(30, 10_000)  # 30 bps.


def redemption_fee_amount(gross: Fraction, redeem_fee: Fraction) -> Fraction:
    """03 §5.3a's charged redemption fee before applying the dust waiver.

    The fee rounds up to a USDC base unit against the claimant. This helper is
    the fee *avoided* by fragmentation, so its caller supplies a gross large
    enough that the unfragmented redemption is charged.
    """
    if gross <= 0:
        raise ThreatCostError(f"non-positive redemption gross {gross}")
    if not Fraction(0) <= redeem_fee <= Fraction(1):
        raise ThreatCostError(f"redemption fee outside [0, 1]: {redeem_fee}")
    return Fraction(ceil_fraction(gross * redeem_fee * USDC_BASE_UNITS), USDC_BASE_UNITS)


def redemption_fee_avoidance_ratio(
    gross: Fraction,
    *,
    min_split: Fraction = LEDGER_MIN_SPLIT,
    redeem_fee: Fraction = LEDGER_REDEEM_FEE,
    vit_usdc_rate: Fraction = FEE_VIT_USDC_RATE_REF,
    weight: CallWeight = REDEEM_SCALAR_WEIGHT,
    length_bytes: int = DEFAULT_EXTRINSIC_LENGTH,
) -> Fraction:
    """Transaction-fee cost of fragmentation divided by redemption fee avoided.

    03 §5.3a(3) and TH-64 price `ceil(gross/min_split)` calls. The charged
    call is `redeem_scalar`, so a crank weight is not a valid substitute. A
    ratio at or below one means the grief pays for itself; TH-64's arithmetic
    is its only mitigation, so the load-bearing requirement is strictly > 1.
    """
    if gross <= 0 or min_split <= 0:
        raise ThreatCostError("gross and ledger.min_split must be positive")
    calls = ceil_fraction(gross / min_split)
    avoided = redemption_fee_amount(gross, redeem_fee)
    if avoided == 0:
        raise ThreatCostError("a zero redemption fee has no avoidance ratio")
    cost = calls * transaction_fee_usdc(vit_usdc_rate, weight, length_bytes)
    return cost / avoided


def avoidance_breakeven_vit_usdc_rate(
    *,
    min_split: Fraction = LEDGER_MIN_SPLIT,
    redeem_fee: Fraction = LEDGER_REDEEM_FEE,
    weight: CallWeight = REDEEM_SCALAR_WEIGHT,
    length_bytes: int = DEFAULT_EXTRINSIC_LENGTH,
) -> Fraction:
    """Continuous VIT/USDC rate above which one leg costs more than its fee.

    The gross cancels from TH-64's own `g/min_split` approximation. The exact
    micro-USDC charge is stepped: rounding up creates an equality band, but it
    cannot move the lawful 0.1x floor above one (that ratio is exactly 9/10).
    """
    if min_split <= 0 or redeem_fee <= 0:
        raise ThreatCostError("min_split and redeem_fee must be positive")
    return min_split * redeem_fee / weight.fee_vit(length_bytes)


@dataclass(frozen=True)
class PublishedRedemptionFactors:
    """The three normative locations that publish TH-64's factor."""

    ledger_section_5_3a: Fraction
    threat_row_64: Fraction
    accepted_residual_14: Fraction

    def values(self) -> tuple[Fraction, Fraction, Fraction]:
        return (
            self.ledger_section_5_3a,
            self.threat_row_64,
            self.accepted_residual_14,
        )


def _number(token: str) -> Fraction:
    cleaned = token.replace(",", "")
    try:
        return Fraction(cleaned)
    except (ValueError, ZeroDivisionError) as exc:
        raise ThreatCostError(f"unreadable published number {token!r}") from exc


def _extract(pattern: str, text: str, label: str) -> Fraction:
    match = re.search(pattern, text, re.DOTALL)
    if match is None:
        raise ThreatCostError(f"could not extract {label}")
    return _number(match.group(1))


def published_redemption_factors(repo_root: Path) -> PublishedRedemptionFactors:
    """Read the three copies of TH-64's normative factor from the documents."""
    doc_03 = (repo_root / "docs/architecture/03-conditional-ledger.md").read_text(
        encoding="utf-8"
    )
    doc_14 = (repo_root / "docs/architecture/14-threat-model.md").read_text(
        encoding="utf-8"
    )
    ledger = _extract(
        r"\*\*\(3\) The waiver is not a griefing surface\.\*\*.*?factor of about ([\d,]+)",
        doc_03,
        "03 §5.3a(3) factor",
    )
    th64_line = next(
        (line for line in doc_14.splitlines() if line.startswith("| TH-64 |")), None
    )
    residual_line = next(
        (
            line
            for line in doc_14.splitlines()
            if line.startswith("14. **Dust-scale fee-induced")
        ),
        None,
    )
    if th64_line is None or residual_line is None:
        raise ThreatCostError("TH-64 or accepted residual 14 not found")
    threat = _extract(r"factor of \*\*≈ ([\d,]+)", th64_line, "TH-64 factor")
    residual = _extract(
        r"avoidance bought at ≈ ([\d,]+)×", residual_line, "residual 14 factor"
    )
    return PublishedRedemptionFactors(ledger, threat, residual)


# ---------------------------------------------------------------------------
# TH-11 / 03 §4.3, §5.2 — third-party position dusting.
# ---------------------------------------------------------------------------

# 13 §1 `ledger.pos_dep` is frozen at 0.1 USDC per entry.
LEDGER_POSITION_DEPOSIT = Fraction(1, 10)
# 13 §4 structural bound; protocol accounts are exempt and reject Signed ingress.
MAX_POSITIONS_PER_ACCOUNT = 64
# 13 §1 `ledger.archive`: default and hard max one year; hard min 90 days.
BLOCKS_PER_DAY = 14_400
LEDGER_ARCHIVE_DEFAULT = 365 * BLOCKS_PER_DAY
LEDGER_ARCHIVE_MIN = 90 * BLOCKS_PER_DAY
LEDGER_ARCHIVE_MAX = 365 * BLOCKS_PER_DAY
REAP_BATCH = 100

PROPOSAL_TERMINAL_STATES = frozenset({"ScalarSettled", "Voided"})
BASELINE_TERMINAL_STATES = frozenset({"Settled"})


def dusting_cost(
    victim_slots: int,
    *,
    position_deposit: Fraction = LEDGER_POSITION_DEPOSIT,
    min_transfer: Fraction = LEDGER_MIN_SPLIT,
    vit_usdc_rate: Fraction = FEE_VIT_USDC_RATE_REF,
    weight: CallWeight = TRANSFER_WEIGHT,
    length_bytes: int = DEFAULT_EXTRINSIC_LENGTH,
) -> tuple[Fraction, Fraction, Fraction]:
    """Return `(attacker_outlay, victim_outlay, victim_recovery_cost)`.

    03 §4.3/§5.1 charge a newly created transfer entry to the recipient and
    require no recipient consent. The attacker gives away one `MinTransfer` and
    pays one `transfer` fee per slot. Moving the whole source balance deletes
    the attacker's entry and refunds its deposit, so 0.1 USDC is peak exposure,
    never `victim_slots * 0.1` cumulative cost.

    `victim_recovery_cost` is the incremental fee for the fast path: transfer
    every whole dust balance onward. That refunds the victim's deposits but
    charges the next recipient, relocating rather than releasing the system's
    lock. Archive-sweep eligibility is modelled separately below.
    """
    if not 0 <= victim_slots <= MAX_POSITIONS_PER_ACCOUNT:
        raise ThreatCostError(
            f"victim slots {victim_slots} outside 0..{MAX_POSITIONS_PER_ACCOUNT}"
        )
    if position_deposit <= 0 or min_transfer <= 0:
        raise ThreatCostError("position deposit and MinTransfer must be positive")
    tx_fee = transaction_fee_usdc(vit_usdc_rate, weight, length_bytes)
    attacker_outlay = victim_slots * (min_transfer + tx_fee)
    victim_outlay = victim_slots * position_deposit
    victim_recovery_cost = victim_slots * tx_fee
    return attacker_outlay, victim_outlay, victim_recovery_cost


def attacker_peak_position_deposit(
    victim_slots: int, position_deposit: Fraction = LEDGER_POSITION_DEPOSIT
) -> Fraction:
    """Peak refundable source deposit under a serial transfer attack."""
    if not 0 <= victim_slots <= MAX_POSITIONS_PER_ACCOUNT:
        raise ThreatCostError(
            f"victim slots {victim_slots} outside 0..{MAX_POSITIONS_PER_ACCOUNT}"
        )
    return Fraction(0) if victim_slots == 0 else position_deposit


def dust_reach(
    recipient_reducible_usdc: Fraction,
    *,
    recipient_is_protocol: bool,
    position_deposit: Fraction = LEDGER_POSITION_DEPOSIT,
) -> int:
    """How many third-party dust entries the recipient can actually receive.

    Signed transfers to protocol destinations reject. A non-protocol recipient
    must fund every deposit from reducible balance, so empty accounts are not
    targets and a full 64-slot attack requires at least 6.4 reducible USDC.
    """
    if recipient_reducible_usdc < 0 or position_deposit <= 0:
        raise ThreatCostError("recipient balance cannot be negative and deposit must be positive")
    if recipient_is_protocol:
        return 0
    affordable = int(recipient_reducible_usdc / position_deposit)
    return min(MAX_POSITIONS_PER_ACCOUNT, affordable)


def sweep_recovery_eligible(
    state: str,
    blocks_since_terminal: int,
    *,
    seeded_books_swept: bool,
    baseline: bool = False,
    archive_delay: int = LEDGER_ARCHIVE_DEFAULT,
) -> bool:
    """03 §5.4's three gates for deposit-releasing dust recovery."""
    if blocks_since_terminal < 0:
        raise ThreatCostError(f"negative terminal age {blocks_since_terminal}")
    if not LEDGER_ARCHIVE_MIN <= archive_delay <= LEDGER_ARCHIVE_MAX:
        raise ThreatCostError(f"archive delay {archive_delay} outside 13 §1 bounds")
    terminals = BASELINE_TERMINAL_STATES if baseline else PROPOSAL_TERMINAL_STATES
    return (
        state in terminals
        and blocks_since_terminal >= archive_delay
        and seeded_books_swept
    )


# ---------------------------------------------------------------------------
# TH-16 / 08 §7 — intake and slot monopolization.
# ---------------------------------------------------------------------------

# 13 §1 `prop.bond` defaults, ordered PARAM/TREASURY/CODE/META. Treasury's
# Ask surcharge is irrelevant to the two strategies 08 §7 prices explicitly.
PROP_BOND_PARAM = Fraction(1_000)
PROP_BOND_TREASURY_BASE = Fraction(5_000)
PROP_BOND_CODE = Fraction(25_000)
PROP_BOND_META = Fraction(50_000)
# 13 §1 / §4 registry and kernel values used by 08 §7.
INTAKE_MAX_PER_ACCOUNT = 4  # `intake.max_acct`.
INTAKE_SLASH_FRACTION = Fraction(10, 100)  # `intake.slash_pct`.
INTAKE_QUEUE = 64
EPOCH_SLOTS = 5
# 13 §1 CODE `dec.v_min` and `mkt.fee`, used by the refund path.
DEC_V_MIN_CODE = Fraction(600_000)
MARKET_FEE = Fraction(30, 10_000)

# 08 §7's pre-review comparison basis. These are historical figures, not
# live registry values: 109,000 USDC locked at a 5% annual opportunity cost.
PRE_REVIEW_COMBINED_LOCKED = Fraction(109_000)
PRE_REVIEW_INTAKE_LOCKED = Fraction(32_000)
ANNUAL_DISCOUNT_RATE = Fraction(5, 100)
EPOCH_DAYS = 21
DAYS_PER_YEAR = 365


@dataclass(frozen=True)
class IntakeParams:
    """The live inputs to 08 §7's four strategy rows."""

    param_bond: Fraction = PROP_BOND_PARAM
    slot_bond: Fraction = PROP_BOND_CODE
    intake_queue: int = INTAKE_QUEUE
    live_slots: int = EPOCH_SLOTS
    slash_fraction: Fraction = INTAKE_SLASH_FRACTION
    max_per_account: int = INTAKE_MAX_PER_ACCOUNT
    decision_floor: Fraction = DEC_V_MIN_CODE
    market_fee: Fraction = MARKET_FEE

    def validate(self) -> None:
        if self.param_bond <= 0 or self.slot_bond <= 0:
            raise ThreatCostError("proposal bonds must be positive")
        if self.intake_queue <= 0 or self.live_slots <= 0 or self.max_per_account <= 0:
            raise ThreatCostError("queue, slots and per-account cap must be positive")
        if not Fraction(0) <= self.slash_fraction <= Fraction(1):
            raise ThreatCostError("slash fraction outside [0, 1]")
        if self.decision_floor <= 0 or self.market_fee < 0:
            raise ThreatCostError("decision floor must be positive and market fee non-negative")


DEFAULT_INTAKE_PARAMS = IntakeParams()


@dataclass(frozen=True)
class IntakeCost:
    """One 08 §7 strategy's locked capital and unrecoverable epoch cost."""

    strategy: str
    locked: Fraction
    cost_per_epoch: Fraction
    funded_accounts: int


def funded_accounts_required(entries: int, max_per_account: int = INTAKE_MAX_PER_ACCOUNT) -> int:
    """`ceil(entries / intake.max_acct)`, keyed to the funder (contract v18)."""
    if entries < 0 or max_per_account <= 0:
        raise ThreatCostError("entries must be non-negative and cap positive")
    return ceil_fraction(Fraction(entries, max_per_account))


def queue_occupancy(
    funded_accounts: int,
    *,
    intake_queue: int = INTAKE_QUEUE,
    max_per_account: int = INTAKE_MAX_PER_ACCOUNT,
) -> int:
    """Maximum Submitted occupancy those funded accounts can create in one epoch."""
    if funded_accounts < 0 or intake_queue <= 0 or max_per_account <= 0:
        raise ThreatCostError("accounts must be non-negative and bounds positive")
    return min(intake_queue, funded_accounts * max_per_account)


def intake_monopolization_cost(
    strategy: str, params: IntakeParams = DEFAULT_INTAKE_PARAMS
) -> IntakeCost:
    """Derive one of 08 §7's four priced monopolization strategies.

    Strategies are `intake_denial`, `slot_capture`, `combined`, and
    `refund_path`. The first three forfeit `intake.slash_pct`; the refund path
    avoids the slash by making five CODE proposals decision-grade and therefore
    pays at least entry and exit market fees on the held contest capital.
    """
    params.validate()
    if strategy == "intake_denial":
        entries = params.intake_queue
        locked = entries * params.param_bond
        cost = locked * params.slash_fraction
    elif strategy == "slot_capture":
        entries = params.live_slots
        locked = entries * params.slot_bond
        cost = locked * params.slash_fraction
    elif strategy == "combined":
        entries = params.intake_queue
        locked = (
            params.intake_queue * params.param_bond
            + params.live_slots * params.slot_bond
        )
        cost = locked * params.slash_fraction
    elif strategy == "refund_path":
        entries = params.live_slots
        locked = params.live_slots * params.decision_floor
        cost = locked * 2 * params.market_fee
    else:
        raise ThreatCostError(f"unknown intake strategy {strategy!r}")
    return IntakeCost(
        strategy,
        locked,
        cost,
        funded_accounts_required(entries, params.max_per_account),
    )


def capital_time_value(
    locked: Fraction,
    *,
    annual_discount_rate: Fraction = ANNUAL_DISCOUNT_RATE,
    epoch_days: int = EPOCH_DAYS,
    days_per_year: int = DAYS_PER_YEAR,
) -> Fraction:
    """08 §7's pre-review refundable-bond opportunity cost per epoch."""
    if locked < 0 or annual_discount_rate < 0 or epoch_days < 0 or days_per_year <= 0:
        raise ThreatCostError("invalid time-value input")
    return locked * annual_discount_rate * Fraction(epoch_days, days_per_year)


@dataclass(frozen=True)
class PublishedIntakeForfeits:
    """The conflicting per-epoch figures in TH-16 and 08 §7."""

    threat_row_16: Fraction
    treasury_section_7: Fraction


def published_intake_forfeits(repo_root: Path) -> PublishedIntakeForfeits:
    """Extract both normative figures from their document text."""
    doc_08 = (repo_root / "docs/architecture/08-treasury-and-economics.md").read_text(
        encoding="utf-8"
    )
    doc_14 = (repo_root / "docs/architecture/14-threat-model.md").read_text(
        encoding="utf-8"
    )
    th16_line = next(
        (line for line in doc_14.splitlines() if line.startswith("| TH-16 |")), None
    )
    combined_line = next(
        (
            line
            for line in doc_08.splitlines()
            if line.startswith("| Combined monopolization |")
        ),
        None,
    )
    if th16_line is None or combined_line is None:
        raise ThreatCostError("TH-16 or 08 §7 combined row not found")
    threat_k = _extract(r"forfeits ~([\d.]+)k USDC", th16_line, "TH-16 forfeit")
    section = _extract(
        r"\*\*≈ ([\d,]+)\*\*", combined_line, "08 §7 combined forfeit"
    )
    return PublishedIntakeForfeits(threat_k * 1_000, section)


# ---------------------------------------------------------------------------
# Queryable findings (the green-suite shape for a red specification claim).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ThreatCostFinding:
    """One claim evaluated as data rather than left only in a test comment."""

    key: str
    ok: bool
    actual: Fraction
    claimed_or_required: Fraction
    error_direction: str


def check_threat_cost_claims(repo_root: Path) -> tuple[ThreatCostFinding, ...]:
    """Evaluate the three red threat rows and TH-64's envelope requirement."""
    gross = Fraction(1)
    factors = published_redemption_factors(repo_root)
    if len(set(factors.values())) != 1:
        raise ThreatCostError("TH-64's three normative copies already disagree")
    published_factor = factors.values()[0]
    reference_ratio = redemption_fee_avoidance_ratio(gross)
    floor_ratio = redemption_fee_avoidance_ratio(
        gross, vit_usdc_rate=FEE_VIT_USDC_RATE_MIN
    )
    attacker, victim, _ = dusting_cost(MAX_POSITIONS_PER_ACCOUNT)
    intake = published_intake_forfeits(repo_root)
    derived_intake = intake_monopolization_cost("combined").cost_per_epoch
    return (
        ThreatCostFinding(
            "TH-64 published default avoidance factor",
            reference_ratio == published_factor,
            reference_ratio,
            published_factor,
            "overstating attacker cost is unsafe",
        ),
        ThreatCostFinding(
            "TH-64 ratio exceeds one across fee.vit_usdc_rate envelope",
            floor_ratio > 1,
            floor_ratio,
            Fraction(1),
            "a lower ratio makes fee avoidance profitable",
        ),
        ThreatCostFinding(
            "TH-11 attacker outlay covers victim deposit outlay",
            attacker >= victim,
            attacker,
            victim,
            "attacker below victim inverts deposit incidence",
        ),
        ThreatCostFinding(
            "TH-16 agrees with 08 §7 combined recurring cost",
            intake.threat_row_16 == derived_intake == intake.treasury_section_7,
            intake.threat_row_16,
            derived_intake,
            "understating attacker cost is conservative, but non-normative",
        ),
    )
