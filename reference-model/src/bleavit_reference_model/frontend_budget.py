"""10 §9, 02 §5–§6, 13 §4–§5 — frontend ingest and storage budgets.

Doc 10 §9.1 publishes a model of 196 simultaneously active books, one
observation per 10 blocks during the 13/21 Trade phase, and 120 effective bytes
per IndexedDB row.  Its arithmetic is internally reproducible: the implied
per-book rate is exactly 6,240/7 = 891.428571… rows/day and the published load
and retention cells are approximations of that rate.

Executing the same rate against 13 §5's chain-side occupancy arithmetic exposes
the defect SQ-557 records.  `occupancy.item4_full_window` is 580,320 observations
per 21-day epoch from 31 newly trading books, or 27,634.285714… rows/day.  The
196-book stock is the no-terminal-latch/POL capacity, not the sustained flow of
books in `Trading`/`Extended`; doc 10 therefore overstates the bounded `Observed`
stream by 196/31 = 6.322580….  At the same quotas the corrected raw depths are
exactly 54.280397… / 13.570099… days (desktop/mobile), and the hourly-candle
depths are 672.043010… / 168.010752… days.  Reruns mean 31 is not an
instantaneous ceiling: T13 and T25 each reopen six proposal books for three
days.  This module keeps those peak additions explicit instead of laundering
them into the sustained-average stock.

The error in the other direction is unsafe.  02 §5 freezes the minimal price
ingest set as `Traded` plus `Observed`, but 10 §9.1 prices only observations.
The specification fixes no per-event `Traded` weight, so the capacity and
retention functions accept an explicit weight.  A separate ``observed_*``
accessor parses the current generated ``buy()`` artifact and reports what that
implementation would imply.  It is supporting conformance evidence only: a
benchmark regeneration changes the observation, never the specification model
or the finding that 10 §9.1 omits a frozen event family.

Two smaller inconsistencies also execute here.  The metadata sub-bounds exceed
their fixed metadata shares.  The committed bootstrap blob is measured only as
implementation evidence and is far below doc 10's stated ~1–2 MB range; tests
assert that range relationship, not a compressor-backend-specific byte count.
Finally, doc 10 has seven `normative value(s): 13-parameters.md` citations.  Six
resolve to a statement in doc 13; the IndexedDB caps do not.

Units: bytes are exact bytes and MB is decimal 1,000,000 B, matching doc 10's
growth arithmetic; time is blocks, days, hours or picoseconds as named.  Rates,
shares and depths use :class:`fractions.Fraction`; no binary float participates.
Integer capacity division rounds **down**, so an over-capacity event claim is
never published.  Retention depths remain exact; any UI promise derived from
them must round down against the claimant (R-7).  Gzip evidence uses level 9,
mtime 0 and no filename, but DEFLATE output size is deliberately not treated as
byte-stable across zlib implementations.
"""

from __future__ import annotations

import gzip
import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model import occupancy

# ---------------------------------------------------------------------------
# Doc 10 §9.1–§9.3 values and their exact units.  The two platform caps are
# deliberately cited to doc 10, not doc 13: the citation resolver below proves
# that doc 13 does not currently contain them (SQ-557).
# ---------------------------------------------------------------------------

BYTES_PER_MB = 1_000_000
HOURS_PER_DAY = 24
DAYS_PER_YEAR = Fraction(36525, 100)
MONTHS_PER_YEAR = 12

ROW_BYTES = 120  # 10 §9.1: effective Dexie bytes per event/sample/candle row.
DOC10_MAX_BOOKS = 196  # 10 §9.1: published "maximum sustained active" stock.
TYPICAL_BOOKS = 20
HALF_LOAD_BOOKS = 98

DESKTOP_CAP_BYTES = 300 * BYTES_PER_MB  # 10 §9.2 (dangling normative citation).
MOBILE_CAP_BYTES = 75 * BYTES_PER_MB  # 10 §9.2 (dangling normative citation).
RAW_SHARE = Fraction(60, 100)
CANDLES_SHARE = Fraction(20, 100)
EVENTS_SHARE = Fraction(15, 100)
METADATA_SHARE = Fraction(5, 100)

METADATA_STATED_MIN_BYTES = 1 * BYTES_PER_MB  # 10 §9.3: "~1–2 MB gz each".
METADATA_STATED_MAX_BYTES = 2 * BYTES_PER_MB
PINNED_METADATA_BLOBS = 2  # current and next-authorized runtime.

# 06 §5.2 / 05 T13,T25: bounded guardian rerun production.  One proposal has
# six proposal books; Baseline is shared by epoch and therefore travels as a
# separate scenario input below.
PROPOSAL_BOOKS = 6  # 13 §4: 2 decision + 4 gate books.
DELAY_ONCE_ALLOWANCE_PER_EPOCH = 2
FORCE_RERUN_ALLOWANCE_PER_EPOCH = 1

# 13 §5 pins the normal-class PoV budget.  The ref-time half follows from the
# runtime's 75% normal share of a two-second block; it is an argument to the
# generic capacity function so callers can re-evaluate another runtime profile.
NORMAL_PROOF_BUDGET = 3_932_160
NORMAL_REF_TIME_BUDGET = 1_500_000_000_000

# The runtime binds frame_system::DbWeight = RocksDbWeight.  In the pinned
# frame-support 48.0.0, a read is 25,000 ns and a write 100,000 ns at 1,000
# ref-time units/ns.  Counts still come from the generated weight fixture.
ROCKSDB_READ_REF_TIME = 25_000_000
ROCKSDB_WRITE_REF_TIME = 100_000_000

DOC_02 = "docs/architecture/02-integration-contract.md"
DOC_10 = "docs/architecture/10-frontend-architecture.md"
DOC_13 = "docs/architecture/13-parameters.md"
MARKET_WEIGHT_FIXTURE = "runtime/bleavit-runtime/src/weights/pallet_market.rs"
METADATA_FIXTURE = "keeper/bleavit-keeper/tests/fixtures/runtime-metadata.scale"


class BudgetError(ValueError):
    """A malformed document, weight fixture or budget refuses (G-1)."""


@dataclass(frozen=True)
class Finding:
    """One executable claim, including defects that intentionally have ``ok=False``."""

    key: str
    ok: bool
    actual: int | Fraction | str | tuple[str, ...]
    expected: int | Fraction | str | tuple[str, ...]
    error_direction: str
    sq_id: str | None = None
    supporting_evidence: object | None = None


@dataclass(frozen=True)
class PublishedCell:
    """One approximate cell in 10 §9.1–§9.2 and its printed resolution."""

    value: Fraction
    tolerance: Fraction
    unit: str

    def contains(self, derived: Fraction) -> bool:
        return abs(derived - self.value) <= self.tolerance


# 10 §9.1–§9.2's published cells, carried as data so tests can derive each
# input and compare at the table's stated approximate precision.
DOC10_TABLE: dict[str, PublishedCell] = {
    "typical.rows_per_day": PublishedCell(Fraction(17_800), Fraction(100), "rows/day"),
    "half.rows_per_day": PublishedCell(Fraction(87_000), Fraction(500), "rows/day"),
    "max.rows_per_day": PublishedCell(Fraction(175_000), Fraction(500), "rows/day"),
    "typical.megabytes_per_day": PublishedCell(Fraction(21, 10), Fraction(1, 20), "MB/day"),
    "half.megabytes_per_day": PublishedCell(Fraction(105, 10), Fraction(1, 20), "MB/day"),
    "max.megabytes_per_day": PublishedCell(Fraction(21), Fraction(1, 20), "MB/day"),
    "raw.desktop.typical_days": PublishedCell(Fraction(84), Fraction(1), "days"),
    "raw.mobile.typical_days": PublishedCell(Fraction(21), Fraction(1), "days"),
    "raw.desktop.max_days": PublishedCell(Fraction(85, 10), Fraction(1, 10), "days"),
    "raw.mobile.max_days": PublishedCell(Fraction(21, 10), Fraction(1, 10), "days"),
    "candles.desktop.typical_years": PublishedCell(Fraction(29, 10), Fraction(1, 10), "years"),
    "candles.mobile.typical_months": PublishedCell(Fraction(8), Fraction(1), "months"),
    "candles.desktop.max_days": PublishedCell(Fraction(106), Fraction(1), "days"),
    "candles.mobile.max_days": PublishedCell(Fraction(26), Fraction(1), "days"),
}


def epoch_days(registry: occupancy.Registry = occupancy.GENESIS) -> Fraction:
    """One registry epoch in days, exactly."""
    if registry.epoch_length <= 0:
        raise BudgetError("epoch.length must be positive")
    return Fraction(registry.epoch_length, occupancy.BLOCKS_PER_DAY)


def doc10_rows_per_book_day(
    obs_interval: int = occupancy.GENESIS.mkt_obs_interval,
) -> Fraction:
    """10 §9.1: one observation/interval during a 13/21 duty cycle.

    This is derived independently from the frontend document's own inputs.  It
    is compared to the chain-side item-4 value in :func:`load_findings`.
    """
    if obs_interval <= 0:
        raise BudgetError("observation interval must be positive")
    return Fraction(occupancy.BLOCKS_PER_DAY, obs_interval) * occupancy.TRADE_PHASE_FRACTION


def chain_rows_per_book_day(
    registry: occupancy.Registry = occupancy.GENESIS,
) -> Fraction:
    """13 §5 item 4, divided by its book count and epoch duration."""
    count = occupancy.books(registry.epoch_slots)
    if count <= 0:
        raise BudgetError("chain book count must be positive")
    return Fraction(occupancy.item4_full_window(registry), count) / epoch_days(registry)


def rows_per_day_for_books(
    book_count: int,
    registry: occupancy.Registry = occupancy.GENESIS,
) -> Fraction:
    """Doc 10's sustained row-rate formula at an explicit book count."""
    if book_count < 0:
        raise BudgetError("book count must be non-negative")
    return chain_rows_per_book_day(registry) * book_count


def observed_rows_per_day(
    registry: occupancy.Registry = occupancy.GENESIS,
) -> Fraction:
    """The chain-side sustained `Observed` flow from 13 §5 item 4."""
    return Fraction(occupancy.item4_full_window(registry), 1) / epoch_days(registry)


def raw_depth_days(
    share_bytes: int | Fraction,
    rows_per_day: int | Fraction,
    row_bytes: int = ROW_BYTES,
) -> Fraction:
    """Raw-sample retention before downsampling, without display rounding."""
    if share_bytes < 0:
        raise BudgetError("share bytes must be non-negative")
    if rows_per_day <= 0 or row_bytes <= 0:
        raise BudgetError("row rate and row size must be positive")
    return Fraction(share_bytes, 1) / (Fraction(rows_per_day, 1) * row_bytes)


def candle_depth_days(
    share_bytes: int | Fraction,
    book_count: int,
    *,
    hours_per_candle: int = 1,
    row_bytes: int = ROW_BYTES,
) -> Fraction:
    """Retention for a regular candle ladder rung.

    A one-hour rung emits 24 rows/book/day; four-hour and daily rungs follow by
    changing ``hours_per_candle``.  An incomplete day rounds the promise down
    at the consumer; this function returns the exact capacity.
    """
    if share_bytes < 0 or book_count <= 0 or row_bytes <= 0:
        raise BudgetError("share must be non-negative; count and size positive")
    if hours_per_candle <= 0 or HOURS_PER_DAY % hours_per_candle:
        raise BudgetError("candle width must divide one day exactly")
    rows_day = book_count * (HOURS_PER_DAY // hours_per_candle)
    return Fraction(share_bytes, rows_day * row_bytes)


def doc10_derived_cells(
    registry: occupancy.Registry = occupancy.GENESIS,
) -> dict[str, Fraction]:
    """Re-derive every numeric load/depth cell carried in :data:`DOC10_TABLE`."""
    typical_rows = rows_per_day_for_books(TYPICAL_BOOKS, registry)
    half_rows = rows_per_day_for_books(HALF_LOAD_BOOKS, registry)
    max_rows = rows_per_day_for_books(DOC10_MAX_BOOKS, registry)
    desktop_raw = DESKTOP_CAP_BYTES * RAW_SHARE
    mobile_raw = MOBILE_CAP_BYTES * RAW_SHARE
    desktop_candles = DESKTOP_CAP_BYTES * CANDLES_SHARE
    mobile_candles = MOBILE_CAP_BYTES * CANDLES_SHARE
    typical_candle_days_desktop = candle_depth_days(desktop_candles, TYPICAL_BOOKS)
    typical_candle_days_mobile = candle_depth_days(mobile_candles, TYPICAL_BOOKS)
    return {
        "typical.rows_per_day": typical_rows,
        "half.rows_per_day": half_rows,
        "max.rows_per_day": max_rows,
        "typical.megabytes_per_day": typical_rows * ROW_BYTES / BYTES_PER_MB,
        "half.megabytes_per_day": half_rows * ROW_BYTES / BYTES_PER_MB,
        "max.megabytes_per_day": max_rows * ROW_BYTES / BYTES_PER_MB,
        "raw.desktop.typical_days": raw_depth_days(desktop_raw, typical_rows),
        "raw.mobile.typical_days": raw_depth_days(mobile_raw, typical_rows),
        "raw.desktop.max_days": raw_depth_days(desktop_raw, max_rows),
        "raw.mobile.max_days": raw_depth_days(mobile_raw, max_rows),
        "candles.desktop.typical_years": typical_candle_days_desktop / DAYS_PER_YEAR,
        "candles.mobile.typical_months": (
            typical_candle_days_mobile / DAYS_PER_YEAR * MONTHS_PER_YEAR
        ),
        "candles.desktop.max_days": candle_depth_days(desktop_candles, DOC10_MAX_BOOKS),
        "candles.mobile.max_days": candle_depth_days(mobile_candles, DOC10_MAX_BOOKS),
    }


def corrected_budget_cells(
    registry: occupancy.Registry = occupancy.GENESIS,
) -> dict[str, Fraction]:
    """10 §9.1–§9.2 max-load cells at the chain's sustained book flow."""
    book_count = occupancy.books(registry.epoch_slots)
    rows = observed_rows_per_day(registry)
    return {
        "load.books": Fraction(book_count),
        "load.rows_per_day": rows,
        "load.bytes_per_day": rows * ROW_BYTES,
        "load.megabytes_per_day": rows * ROW_BYTES / BYTES_PER_MB,
        "raw.desktop.days": raw_depth_days(DESKTOP_CAP_BYTES * RAW_SHARE, rows),
        "raw.mobile.days": raw_depth_days(MOBILE_CAP_BYTES * RAW_SHARE, rows),
        "candles1h.desktop.days": candle_depth_days(
            DESKTOP_CAP_BYTES * CANDLES_SHARE, book_count
        ),
        "candles1h.mobile.days": candle_depth_days(
            MOBILE_CAP_BYTES * CANDLES_SHARE, book_count
        ),
    }


def instantaneous_observing_books(
    *,
    registry: occupancy.Registry = occupancy.GENESIS,
    scheduled_reruns: int = 0,
    forced_reruns: int = 0,
    additional_baseline_epochs: int = 0,
) -> int:
    """One explicit overlap scenario, not a false universal ceiling.

    The incoming cohort contributes ``slots·6 + 1``.  Each T13/T25 proposal
    reopens six proposal books; an older epoch's still-open shared Baseline is
    counted once via ``additional_baseline_epochs``.  The caller states the
    scenario because Baseline sharing depends on which epochs the reruns came
    from, and a late keeper can move when T13 is observed.
    """
    values = (scheduled_reruns, forced_reruns, additional_baseline_epochs)
    if any(value < 0 for value in values):
        raise BudgetError("rerun scenario counts must be non-negative")
    reruns = scheduled_reruns + forced_reruns
    if additional_baseline_epochs > reruns:
        raise BudgetError("cannot add more old Baselines than rerun proposals")
    return (
        occupancy.books(registry.epoch_slots)
        + reruns * PROPOSAL_BOOKS
        + additional_baseline_epochs
    )


def load_findings(
    registry: occupancy.Registry = occupancy.GENESIS,
) -> tuple[Finding, ...]:
    """SQ-557's two-model reconciliation as structured values."""
    doc_rate = doc10_rows_per_book_day(registry.mkt_obs_interval)
    chain_rate = chain_rows_per_book_day(registry)
    sustained_books = occupancy.books(occupancy.reachable_slots_max())
    return (
        Finding(
            "observed.per-book-rate",
            doc_rate == chain_rate,
            chain_rate,
            doc_rate,
            "A lower model rate undersizes storage; a higher one wastes capacity.",
        ),
        Finding(
            "observed.max-sustained-book-count",
            DOC10_MAX_BOOKS == sustained_books,
            sustained_books,
            DOC10_MAX_BOOKS,
            "Doc 10 errs high (capacity-safe) here; the unsafe direction is low.",
            sq_id="SQ-557",
        ),
    )


# ---------------------------------------------------------------------------
# 02 §5 ingest set versus the generated market weight fixture.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DispatchWeight:
    """A constant generated dispatch weight, including database operation counts."""

    ref_time: int
    proof_size: int
    reads: int
    writes: int
    minimum_ref_time: int
    read_ref_time: int = ROCKSDB_READ_REF_TIME
    write_ref_time: int = ROCKSDB_WRITE_REF_TIME

    @property
    def database_ref_time(self) -> int:
        return self.reads * self.read_ref_time + self.writes * self.write_ref_time

    @property
    def total_ref_time(self) -> int:
        return self.ref_time + self.database_ref_time


def _rust_int(value: str) -> int:
    return int(value.replace("_", ""))


def parse_generated_weight(path: Path, function: str = "buy") -> DispatchWeight:
    """Parse one constant function from a generated FRAME weight artifact.

    The parser refuses component-bearing or structurally unfamiliar functions;
    silently dropping a slope or database term would turn a measurement into an
    unsafe upper-bound claim.
    """
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"\tfn {re.escape(function)}\(\) -> Weight \{{(?P<body>.*?)\n\t\}}",
        text,
        re.DOTALL,
    )
    if match is None:
        raise BudgetError(f"generated weight function {function!r} not found")
    body = match.group("body")
    if "saturating_mul" in body:
        raise BudgetError(f"component-bearing weight {function!r} is unsupported")

    def one(pattern: str, label: str) -> int:
        matches = re.findall(pattern, body)
        if len(matches) != 1:
            raise BudgetError(
                f"expected exactly one {label} in {function!r}, found {len(matches)}"
            )
        return _rust_int(matches[0])

    parts = re.findall(r"Weight::from_parts\(([0-9_]+),\s*([0-9_]+)\)", body)
    if len(parts) != 2:
        raise BudgetError(f"expected base and proof terms in {function!r}")
    ref_time, base_proof = map(_rust_int, parts[0])
    proof_ref, proof_size = map(_rust_int, parts[1])
    if base_proof != 0 or proof_ref != 0:
        raise BudgetError(f"weight dimensions are not separated in {function!r}")
    return DispatchWeight(
        ref_time=ref_time,
        proof_size=proof_size,
        reads=one(r"\.reads\(([0-9_]+)\)", "database read term"),
        writes=one(r"\.writes\(([0-9_]+)\)", "database write term"),
        minimum_ref_time=one(
            r"Minimum execution time:\s*([0-9_]+) picoseconds", "minimum time"
        ),
    )


@dataclass(frozen=True)
class TradeCapacity:
    """The two-dimensional normal-block ceiling for one-event fills."""

    proof_limit: int
    ref_time_limit: int

    @property
    def events(self) -> int:
        return min(self.proof_limit, self.ref_time_limit)

    @property
    def binding_dimension(self) -> str:
        if self.proof_limit < self.ref_time_limit:
            return "proof_size"
        if self.ref_time_limit < self.proof_limit:
            return "ref_time"
        return "both"


def traded_events_per_block(
    proof_budget: int,
    ref_time_budget: int,
    buy_weight: DispatchWeight,
) -> TradeCapacity:
    """One `Traded` event per successful fill, floor-divided in both dimensions."""
    if proof_budget < 0 or ref_time_budget < 0:
        raise BudgetError("block budgets must be non-negative")
    if buy_weight.proof_size <= 0 or buy_weight.total_ref_time <= 0:
        raise BudgetError("dispatch weight dimensions must be positive")
    return TradeCapacity(
        proof_limit=proof_budget // buy_weight.proof_size,
        ref_time_limit=ref_time_budget // buy_weight.total_ref_time,
    )


def saturated_traded_rows_per_day(capacity: TradeCapacity) -> int:
    """Capacity bound at 14,400 six-second blocks/day; not a traffic forecast."""
    return capacity.events * occupancy.BLOCKS_PER_DAY


def events_share_exhaustion_hours(
    share_bytes: int | Fraction,
    rows_per_day: int | Fraction,
    row_bytes: int = ROW_BYTES,
) -> Fraction:
    """Hours until `Traded` alone consumes an events+archive share."""
    return raw_depth_days(share_bytes, rows_per_day, row_bytes) * HOURS_PER_DAY


@dataclass(frozen=True)
class ObservedTradeEvidence:
    """Current generated-buy capacity; implementation evidence only."""

    source: Path
    weight: DispatchWeight
    capacity: TradeCapacity
    rows_per_day: int
    desktop_exhaustion_hours: Fraction
    mobile_exhaustion_hours: Fraction


def observed_trade_evidence(repo_root: Path) -> ObservedTradeEvidence:
    """Read generated Rust weight evidence without making it a spec oracle.

    The block budgets and generated ``buy`` weight describe the current runtime
    profile. They support the operational severity of an omitted ``Traded``
    stream, but no value returned here decides whether 10 §9.1 covers 02 §5.
    """
    source = repo_root / MARKET_WEIGHT_FIXTURE
    weight = parse_generated_weight(source)
    capacity = traded_events_per_block(
        NORMAL_PROOF_BUDGET, NORMAL_REF_TIME_BUDGET, weight
    )
    rows = saturated_traded_rows_per_day(capacity)
    return ObservedTradeEvidence(
        source=source,
        weight=weight,
        capacity=capacity,
        rows_per_day=rows,
        desktop_exhaustion_hours=events_share_exhaustion_hours(
            DESKTOP_CAP_BYTES * EVENTS_SHARE, rows
        ),
        mobile_exhaustion_hours=events_share_exhaustion_hours(
            MOBILE_CAP_BYTES * EVENTS_SHARE, rows
        ),
    )


def _markdown_section(text: str, heading: str, next_heading: str) -> str:
    start = text.find(heading)
    if start < 0:
        raise BudgetError(f"section heading not found: {heading}")
    end = text.find(next_heading, start + len(heading))
    if end < 0:
        raise BudgetError(f"next section heading not found: {next_heading}")
    return text[start:end]


def minimal_ingest_set(doc02_text: str) -> tuple[str, ...]:
    """Parse 02 §5's frozen minimal FE ingest set in document order."""
    section = _markdown_section(doc02_text, "## 5. pallet-market events", "## 6.")
    match = re.search(r"minimal FE ingest set is ([^;\n]+)", section)
    if match is None:
        raise BudgetError("02 §5 minimal FE ingest set not found")
    names = tuple(re.findall(r"`([A-Z][A-Za-z0-9_]*)`", match.group(1)))
    if not names or len(names) != len(set(names)):
        raise BudgetError("02 §5 minimal FE ingest set is empty or duplicated")
    return names


def _event_stem(name: str) -> str:
    lowered = name.lower()
    for suffix in ("ations", "ation", "ed", "es", "s"):
        if lowered.endswith(suffix) and len(lowered) - len(suffix) >= 4:
            return lowered[: -len(suffix)]
    return lowered


def modelled_ingest_set(doc10_text: str, required: tuple[str, ...]) -> tuple[str, ...]:
    """Parse the event-family subject of 10 §9.1's `Row-rate model` sentence."""
    section = _markdown_section(doc10_text, "### 9.1 Load model", "### 9.2")
    match = re.search(r"Row-rate model[^:]*:\s*([A-Za-z]+)", section)
    if match is None:
        raise BudgetError("10 §9.1 row-rate model subject not found")
    subject = _event_stem(match.group(1))
    return tuple(name for name in required if _event_stem(name) == subject)


@dataclass(frozen=True)
class IngestCoverage:
    """02's required event families versus 10 §9.1's priced families."""

    required: tuple[str, ...]
    modelled: tuple[str, ...]

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(name for name in self.required if name not in self.modelled)

    @property
    def ok(self) -> bool:
        return not self.missing


def ingest_coverage(repo_root: Path) -> IngestCoverage:
    doc02 = (repo_root / DOC_02).read_text(encoding="utf-8")
    doc10 = (repo_root / DOC_10).read_text(encoding="utf-8")
    required = minimal_ingest_set(doc02)
    return IngestCoverage(required, modelled_ingest_set(doc10, required))


def check_frontend_budget_claims(repo_root: Path) -> tuple[Finding, ...]:
    """Return SQ-557's ingest defect with measurements only as evidence."""
    coverage = ingest_coverage(repo_root)
    return (
        Finding(
            "ingest.frozen-streams-modelled",
            coverage.ok,
            coverage.modelled,
            coverage.required,
            "Omitting an adversary-controlled event stream undersizes storage.",
            sq_id="SQ-557",
            supporting_evidence=observed_trade_evidence(repo_root),
        ),
    )


# ---------------------------------------------------------------------------
# 10 §9.2–§9.4 quota and metadata checks.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MetadataMeasurement:
    """Deterministic size of one committed SCALE metadata artifact."""

    raw_bytes: int
    gzip_bytes: int


def measure_metadata(path: Path) -> MetadataMeasurement:
    """Measure one artifact as conformance evidence, never as a spec input.

    ``mtime=0`` removes timestamp variance but does not pin the DEFLATE
    implementation. Consumers must compare the result to a document bound and
    must not assert an exact compressed byte count across environments.
    """
    raw = path.read_bytes()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    return MetadataMeasurement(len(raw), len(compressed))


def observed_metadata(repo_root: Path) -> MetadataMeasurement:
    """Read the committed metadata blob as implementation evidence only."""
    return measure_metadata(repo_root / METADATA_FIXTURE)


@dataclass(frozen=True)
class QuotaPlan:
    """One platform's 10 §9.2 shares and §9.3 metadata sub-bounds."""

    platform: str
    total_bytes: int
    raw_share: Fraction
    candles_share: Fraction
    events_share: Fraction
    metadata_share: Fraction
    metadata_blob_limit: int
    metadata_byte_limit: int

    def share_bytes(self, share: Fraction) -> Fraction:
        return self.total_bytes * share

    def validate(self, measured_blob_bytes: int) -> tuple[Finding, ...]:
        """Check every sub-bound against its own share, never borrowed slack."""
        if self.total_bytes <= 0 or measured_blob_bytes <= 0:
            raise BudgetError("quota and measured blob size must be positive")
        shares = (
            self.raw_share,
            self.candles_share,
            self.events_share,
            self.metadata_share,
        )
        if any(share < 0 for share in shares):
            raise BudgetError("quota shares must be non-negative")
        metadata_bytes = self.share_bytes(self.metadata_share)
        return (
            Finding(
                f"{self.platform}.shares-sum",
                sum(shares, Fraction()) == 1,
                sum(shares, Fraction()),
                Fraction(1),
                "Below one strands quota; above one overcommits the platform cap.",
            ),
            Finding(
                f"{self.platform}.metadata-declared-byte-bound",
                self.metadata_byte_limit <= metadata_bytes,
                self.metadata_byte_limit,
                metadata_bytes,
                "A bound above its share is internally inconsistent; unsafe if allocated.",
                sq_id="SQ-557",
            ),
            Finding(
                f"{self.platform}.metadata-count-at-measured-size",
                self.metadata_blob_limit * measured_blob_bytes <= metadata_bytes,
                self.metadata_blob_limit * measured_blob_bytes,
                metadata_bytes,
                "Too many measured blobs would crowd out another fixed share.",
            ),
            Finding(
                f"{self.platform}.metadata-pinned-pair-at-measured-size",
                PINNED_METADATA_BLOBS * measured_blob_bytes <= metadata_bytes,
                PINNED_METADATA_BLOBS * measured_blob_bytes,
                metadata_bytes,
                "Pinned blobs exceeding the share would make eviction unable to recover.",
            ),
        )


DESKTOP_QUOTA = QuotaPlan(
    platform="desktop",
    total_bytes=DESKTOP_CAP_BYTES,
    raw_share=RAW_SHARE,
    candles_share=CANDLES_SHARE,
    events_share=EVENTS_SHARE,
    metadata_share=METADATA_SHARE,
    metadata_blob_limit=8,
    metadata_byte_limit=16 * BYTES_PER_MB,
)
MOBILE_QUOTA = QuotaPlan(
    platform="mobile",
    total_bytes=MOBILE_CAP_BYTES,
    raw_share=RAW_SHARE,
    candles_share=CANDLES_SHARE,
    events_share=EVENTS_SHARE,
    metadata_share=METADATA_SHARE,
    metadata_blob_limit=3,
    metadata_byte_limit=6 * BYTES_PER_MB,
)


def metadata_size_finding(measurement: MetadataMeasurement) -> Finding:
    """Whether the committed blob falls in 10 §9.3's stated ~1–2 MB range."""
    return Finding(
        "metadata.stated-compressed-range",
        METADATA_STATED_MIN_BYTES <= measurement.gzip_bytes <= METADATA_STATED_MAX_BYTES,
        measurement.gzip_bytes,
        f"{METADATA_STATED_MIN_BYTES}…{METADATA_STATED_MAX_BYTES}",
        "The document errs high (capacity-safe); an error low would overflow quotas.",
        sq_id="SQ-557",
        supporting_evidence=measurement,
    )


def metadata_bundle_budget_finding(doc10_text: str) -> Finding:
    """Whether the release-shipped metadata blobs mandated by §9.3 have a §9.4 row."""
    section93 = _markdown_section(doc10_text, "### 9.3 Metadata blobs", "### 9.4")
    section94 = _markdown_section(doc10_text, "### 9.4 Budget table", "## 10.")
    mandated = "Release-shipped blobs" in section93
    row_labels = tuple(
        match.group(1).strip()
        for match in re.finditer(r"^\|\s*([^|]+?)\s*\|", section94, re.MULTILINE)
        if match.group(1).strip().lower() not in {"budget", "---"}
    )
    covered = any("metadata" in label.lower() for label in row_labels)
    return Finding(
        "metadata.release-bundle-budget-row",
        (not mandated) or covered,
        row_labels,
        "a metadata-blob bundle row",
        "Missing release-size accounting is unsafe when the bundle grows.",
        sq_id="SQ-557",
    )


# ---------------------------------------------------------------------------
# Dangling "normative value(s): 13-parameters.md" citations.
# ---------------------------------------------------------------------------

_CITATION_MARKER = re.compile(
    r"normative values?:\s*\[13-parameters\.md\]\(13-parameters\.md\)", re.IGNORECASE
)
_NUMBER = re.compile(r"(?<![A-Za-z0-9_.])\d[\d,]*(?:\.\d+)?")
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*")
_STOPWORDS = {
    "a", "an", "and", "as", "at", "be", "between", "by", "for", "from",
    "hard", "in", "is", "last", "lists", "of", "on", "or", "per", "the",
    "to", "value", "values", "with",
}


def _normal_number(token: str) -> str:
    value = token.replace(",", "")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value.lstrip("0") or "0"


def _numbers(text: str) -> frozenset[str]:
    return frozenset(_normal_number(token) for token in _NUMBER.findall(text))


def _normal_word(token: str) -> str:
    value = token.casefold().strip(".-_")
    if value.endswith("s") and len(value) > 4:
        value = value[:-1]
    return value


def _words(text: str) -> frozenset[str]:
    return frozenset(
        word
        for token in _WORD.findall(text)
        if (word := _normal_word(token)) not in _STOPWORDS and len(word) >= 2
    )


def _strong_anchors(text: str) -> frozenset[str]:
    """Code identifiers (or vector labels such as V1) that must resolve by name."""
    code = re.findall(r"`([^`]+)`", text)
    labels = re.findall(r"\b[A-Z][A-Z0-9_]*\d+[A-Z0-9_]*\b", text)
    return frozenset(_normal_word(token) for token in (*code, *labels))


def _citation_fragment(line: str, marker_start: int) -> str:
    prefix = line[:marker_start]
    starts = [prefix.rfind(". "), prefix.rfind("— ")]
    start = max(starts)
    if start >= 0:
        prefix = prefix[start + 2 :]
    return prefix.lstrip("- ").strip(" *(")


@dataclass(frozen=True)
class NormativeCitation:
    """One doc-10 values citation and the doc-13 lines that resolve it."""

    line_number: int
    claim: str
    values: tuple[str, ...]
    matching_doc13_lines: tuple[int, ...]

    @property
    def ok(self) -> bool:
        return bool(self.matching_doc13_lines)


def normative_citation_findings(
    doc10_text: str,
    doc13_text: str,
) -> tuple[NormativeCitation, ...]:
    """Resolve every explicit doc-10 values citation against one doc-13 statement.

    A resolution line must contain every numeric atom in the cited claim and at
    least one non-generic lexical anchor.  Requiring co-location avoids the
    vacuous test "both numbers occur somewhere in doc 13".
    """
    doc13_lines = tuple(enumerate(doc13_text.splitlines(), 1))
    findings: list[NormativeCitation] = []
    for line_number, line in enumerate(doc10_text.splitlines(), 1):
        marker = _CITATION_MARKER.search(line)
        if marker is None:
            continue
        claim = _citation_fragment(line, marker.start())
        values = _numbers(claim)
        anchors = _words(claim)
        strong_anchors = _strong_anchors(line[: marker.start()])
        if not values:
            raise BudgetError(f"doc 10 line {line_number} citation has no numeric value")
        matches = []
        for candidate_number, candidate in doc13_lines:
            candidate_words = _words(candidate)
            lexical_match = (
                bool(strong_anchors & candidate_words)
                if strong_anchors
                else bool(anchors & candidate_words)
            )
            if values <= _numbers(candidate) and lexical_match:
                matches.append(candidate_number)
        findings.append(
            NormativeCitation(
                line_number=line_number,
                claim=claim,
                values=tuple(sorted(values)),
                matching_doc13_lines=tuple(matches),
            )
        )
    if not findings:
        raise BudgetError("doc 10 contains no normative doc-13 value citations")
    return tuple(findings)


def repo_normative_citation_findings(repo_root: Path) -> tuple[NormativeCitation, ...]:
    return normative_citation_findings(
        (repo_root / DOC_10).read_text(encoding="utf-8"),
        (repo_root / DOC_13).read_text(encoding="utf-8"),
    )
