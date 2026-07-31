"""13 §5 — the derived-value cross-checks and the occupancy admission screen.

13 §5 calls its four envelopes "normative derivations" and then states the screen
that defends them (item 6 + the *Occupancy admission rule*, SQ-501) entirely in
prose, with two worked laundering cases and one central claim:

    "enumerating transitions closes instances while composing against reality
     closes the class."

That claim is a statement about *every* lawful amendment sequence, and nothing
executed it. This module is the executable form: the four re-derivations, the
by-value screen, the in-flight composition, and the load the chain actually
incurs — so the claim can be searched rather than asserted.

Two things follow that the prose does not say and could not easily:

* `epoch.slots` can never exceed **5**, because item 2 refuses every raise above
  it (13 §5 says so). So the registry row's published range `[1, 12]` is
  *nominal above 5*: seven of its twelve values are unreachable through the
  amendment boundary. See :func:`reachable_slots_max`.
* Item 1's frozen **2,240** is evaluated at each input's compiled bound, and two
  of those bounds are themselves unreachable (`epoch.slots = 12` by the above).
  The reachable maximum is **1,064** rows. The envelope is deliberately
  conservative — 13 §5 item 1 says so — and this quantifies by how much.

Units: blocks for every time quantity; counts are exact integers throughout.
Every division rounds **up** (13 §5: "the error direction is against the
proposal", R-7).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from fractions import Fraction

# ---------------------------------------------------------------------------
# Kernel constants (13 §4; `futarchy_primitives::bounds` / `::kernel`).
# ---------------------------------------------------------------------------

BLOCKS_PER_DAY = 14_400
MAX_LIVE_MARKETS = 196
MAX_LIVE_PROPOSALS = 32
MAX_STORED_MARKETS = 2_240
MAX_SETTLING_COHORTS = 4
MAX_NON_TERMINAL_COHORTS = 4

# 13 §5 item 1 / item 2 per-row sizes. Item 1 uses the *measured* 205 B; item 2
# uses the **pinned** 256 B rather than the measured 160 B, deliberately: an
# occupancy admitted only because today's struct is small is an envelope the
# next field addition breaks (13 §5 item 2).
MARKET_ROW_BYTES = 205
VAULT_ROW_BYTES_PINNED = 256

# 05 §3.1: the Trade phase is [5/21, 18/21) of the epoch, i.e. 13/21 of it.
# Kept as an exact Fraction; 13/21 is non-terminating in base 10 and rounding it
# before the multiplication loses the exact 187,200 at the default length.
TRADE_PHASE_FRACTION = Fraction(13, 21)

# 05 §3.1: `epoch.length` MUST be a multiple of 21 blocks so all phase
# boundaries are exact.
PHASE_DENOMINATOR = 21


class DerivationRefused(ValueError):
    """A re-derivation that cannot be completed refuses (G-1).

    13 §5: "an overflow, a zero `epoch.length`, a zero `mkt.obs_interval` or an
    unreadable registry row refuses rather than reading as 'no envelope was
    breached'". A refusal is never a fallback to the registry value.
    """


def ceil_div(numerator: int, denominator: int) -> int:
    """Integer division rounding **up** (13 §5: every division rounds up)."""
    if denominator <= 0:
        raise DerivationRefused(f"non-positive divisor {denominator}")
    if numerator < 0:
        raise DerivationRefused(f"negative dividend {numerator}")
    return -(-numerator // denominator)


# ---------------------------------------------------------------------------
# 13 §1 registry rows for the five keys 13 §5 reads. Bounds, max-Δ and the
# kernel-bounded marker are the row's own; nothing here is chosen.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class KeyBound:
    """One 13 §1 row's admissibility metadata."""

    key: str
    minimum: int
    maximum: int
    #: Additive max-Δ in the key's own unit, or ``None`` when the row states a
    #: proportional band (see :attr:`max_delta_fraction`) or carries no max-Δ.
    max_delta: int | None = None
    #: Proportional max-Δ as a fraction of the *live* value (13 §1 "10 %", "20 %").
    max_delta_fraction: Fraction | None = None
    #: 13 §1 rule 7: kernel-bounded rows have a genesis-fixed metadata tuple.
    kernel_bounded: bool = False

    def in_bounds(self, value: int) -> bool:
        return self.minimum <= value <= self.maximum

    def step_admissible(self, live: int, proposed: int) -> bool:
        """13 §1 bounds + max-Δ for a single amendment.

        The cooldown is a separate temporal check and is not modelled here; it
        cannot admit a value this predicate refuses.
        """
        if not self.in_bounds(proposed):
            return False
        if proposed == live:
            # 13 §5: "An equal write is not a change and is never screened."
            return True
        delta = abs(proposed - live)
        if self.max_delta is not None:
            return delta <= self.max_delta
        if self.max_delta_fraction is not None:
            # The band is a fraction of the live value; the boundary is
            # inclusive and evaluated exactly (Fraction), never in float.
            return Fraction(delta) <= self.max_delta_fraction * live
        return True  # no max-Δ on the row (e.g. `orc.rounds`, `ledger.archive`)


#: 13 §1 rows. `ledger.archive` carries no max-Δ and can only move **down**
#: from its one-year K ceiling; that direction is expressed by the maximum.
BOUNDS: dict[str, KeyBound] = {
    "epoch.slots": KeyBound("epoch.slots", 1, 12, max_delta=2),
    "epoch.length": KeyBound(
        "epoch.length",
        201_600,
        604_800,
        max_delta_fraction=Fraction(1, 10),
        kernel_bounded=True,
    ),
    "mkt.obs_interval": KeyBound("mkt.obs_interval", 5, 50, max_delta=5),
    "dec.window": KeyBound(
        "dec.window",
        14_400,
        86_400,
        max_delta_fraction=Fraction(1, 5),
        kernel_bounded=True,
    ),
    "ledger.archive": KeyBound(
        "ledger.archive", 90 * BLOCKS_PER_DAY, 365 * BLOCKS_PER_DAY, kernel_bounded=True
    ),
}

#: The four keys 13 §5's occupancy rule screens. `ledger.archive` is an *input*
#: to item 1 and never a trigger (13 §5 consequence (a)).
OCCUPANCY_KEYS = ("epoch.slots", "epoch.length", "mkt.obs_interval", "dec.window")


@dataclass(frozen=True)
class Registry:
    """The five 13 §1 values 13 §5's derivations read."""

    epoch_slots: int = 5
    epoch_length: int = 302_400
    mkt_obs_interval: int = 10
    dec_window: int = 43_200
    ledger_archive: int = 365 * BLOCKS_PER_DAY

    _FIELDS = {
        "epoch.slots": "epoch_slots",
        "epoch.length": "epoch_length",
        "mkt.obs_interval": "mkt_obs_interval",
        "dec.window": "dec_window",
        "ledger.archive": "ledger_archive",
    }

    def get(self, key: str) -> int:
        return getattr(self, self._FIELDS[key])

    def with_key(self, key: str, value: int) -> "Registry":
        return replace(self, **{self._FIELDS[key]: value})


#: The genesis registry (13 §1 defaults). 13 §5 consequence (b): it "sits
#: exactly on three of the four figures", which is why each key's admission
#: boundary is its own default.
GENESIS = Registry()


def books(epoch_slots: int) -> int:
    """13 §5 item 4: `epoch.slots·6 + 1`.

    One book set per active slot (2 decision + 4 gate, 04 §1.1) plus the
    epoch's single unconditional Baseline book (04 §8).
    """
    if epoch_slots < 0:
        raise DerivationRefused(f"negative epoch.slots {epoch_slots}")
    return epoch_slots * 6 + 1


# ---------------------------------------------------------------------------
# 13 §5 items 1–4: the frozen figures and their re-derivations.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Envelopes:
    """One evaluation of 13 §5 items 1–4."""

    stored_markets: int
    stored_market_bytes: int
    vaults: int
    vault_bytes: int
    reap_cells: int
    decision_critical_obs: int
    full_window_obs: int

    def exceeds(self, frozen: "Envelopes") -> tuple[str, ...]:
        """Which frozen figures this evaluation exceeds, in item order."""
        breaches = []
        if self.stored_markets > frozen.stored_markets:
            breaches.append("item1.rows")
        if self.stored_market_bytes > frozen.stored_market_bytes:
            breaches.append("item1.bytes")
        if self.vaults > frozen.vaults:
            breaches.append("item2.vaults")
        if self.vault_bytes > frozen.vault_bytes:
            breaches.append("item2.bytes")
        if self.reap_cells > frozen.reap_cells:
            breaches.append("item3.cells")
        if self.decision_critical_obs > frozen.decision_critical_obs:
            breaches.append("item4.decision_critical")
        if self.full_window_obs > frozen.full_window_obs:
            breaches.append("item4.full_window")
        return tuple(breaches)


#: 13 §5's frozen figures — the values the runtime compiles against. Not
#: re-derived at read time; the screen compares derivations *against* these.
FROZEN = Envelopes(
    stored_markets=MAX_STORED_MARKETS,
    stored_market_bytes=512 * 1024,
    vaults=52,
    vault_bytes=13 * 1024,
    reap_cells=28,
    decision_critical_obs=133_920,
    full_window_obs=580_320,
)


def item1_stored_markets(registry: Registry, book_count: int | None = None) -> int:
    """`MaxLiveMarkets + (ceil(ledger.archive / epoch.length) + 1)·(slots·6 + 1)`."""
    if registry.epoch_length <= 0:
        raise DerivationRefused("zero epoch.length")
    per_batch = books(registry.epoch_slots) if book_count is None else book_count
    batches = ceil_div(registry.ledger_archive, registry.epoch_length) + 1
    return MAX_LIVE_MARKETS + batches * per_batch


def item2_vaults(epoch_slots: int) -> int:
    """`MaxLiveProposals + MaxSettlingCohorts·epoch.slots`."""
    if epoch_slots < 0:
        raise DerivationRefused(f"negative epoch.slots {epoch_slots}")
    return MAX_LIVE_PROPOSALS + MAX_SETTLING_COHORTS * epoch_slots


def item3_reap_cells() -> int:
    """`market.reap` protocol-position cells: 14 instruments × 2 accounts.

    13 §5's table records "none — no §1 key moves item 3". It is derived here
    anyway so the screen evaluates all four items uniformly and a future key
    that *did* move it could not slip through an item nobody computes.
    """
    return 14 * 2


def item4_decision_critical(registry: Registry, book_count: int | None = None) -> int:
    """`(slots·6 + 1)·ceil(dec.window / mkt.obs_interval)`."""
    if registry.mkt_obs_interval <= 0:
        raise DerivationRefused("zero mkt.obs_interval")
    count = books(registry.epoch_slots) if book_count is None else book_count
    return count * ceil_div(registry.dec_window, registry.mkt_obs_interval)


def trade_phase_blocks(epoch_length: int) -> int:
    """13/21 of the epoch — the 05 §3.1 Trade phase, exactly.

    05 §3.1 requires `epoch.length` to be a multiple of 21 so every phase
    boundary is exact; a length that is not refuses rather than silently
    truncating a boundary.
    """
    if epoch_length <= 0:
        raise DerivationRefused("zero epoch.length")
    if epoch_length % PHASE_DENOMINATOR:
        raise DerivationRefused(
            f"epoch.length {epoch_length} is not a multiple of {PHASE_DENOMINATOR} "
            "(05 §3.1: phase boundaries would not be exact)"
        )
    span = Fraction(epoch_length) * TRADE_PHASE_FRACTION
    assert span.denominator == 1
    return int(span)


def item4_full_window(registry: Registry, book_count: int | None = None) -> int:
    """`(slots·6 + 1)·ceil(epoch.length·13/21 / mkt.obs_interval)`."""
    if registry.mkt_obs_interval <= 0:
        raise DerivationRefused("zero mkt.obs_interval")
    count = books(registry.epoch_slots) if book_count is None else book_count
    return count * ceil_div(
        trade_phase_blocks(registry.epoch_length), registry.mkt_obs_interval
    )


def derive(registry: Registry, book_count: int | None = None) -> Envelopes:
    """13 §5 items 1–4 at one parameter set.

    `book_count` overrides the registry-derived book count with an in-flight
    one; it is what the *Occupancy admission rule*'s composition supplies.
    """
    return Envelopes(
        stored_markets=item1_stored_markets(registry, book_count),
        stored_market_bytes=item1_stored_markets(registry, book_count)
        * MARKET_ROW_BYTES,
        vaults=item2_vaults(registry.epoch_slots),
        vault_bytes=item2_vaults(registry.epoch_slots) * VAULT_ROW_BYTES_PINNED,
        reap_cells=item3_reap_cells(),
        decision_critical_obs=item4_decision_critical(registry, book_count),
        full_window_obs=item4_full_window(registry, book_count),
    )


# ---------------------------------------------------------------------------
# In-flight state and the admission screen.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InFlight:
    """What is actually live, independent of the registry.

    13 §5 *In-flight state*: the screen "composes the registry with what is
    actually in flight", taking the book count from the largest cohort in
    flight and the epoch length from the longest in force. `mkt.obs_interval`,
    `dec.window` and `ledger.archive` are **live**-consumed, so their proposed
    value *is* their in-flight value and they need no member here.
    """

    #: `epoch.slots` of the largest cohort still live (pinned at qualification).
    largest_cohort_slots: int = 5
    #: The longest `epoch.length` still in force (pinned per epoch/proposal/cohort).
    longest_length_in_force: int = 302_400

    def readable(self) -> bool:
        """13 §5: an in-flight maximum that cannot be established is a refusal."""
        return self.largest_cohort_slots >= 0 and self.longest_length_in_force > 0


GENESIS_IN_FLIGHT = InFlight()


def compose(registry: Registry, in_flight: InFlight) -> tuple[Registry, int]:
    """The 13 §5 in-flight composition: worst case over what is live.

    Returns the composed registry and the composed book count. The composition
    is per key and follows the *In-flight state* table's audited
    classification — pinned keys take the larger of proposed and live, live
    keys take the proposed value unchanged.
    """
    if not in_flight.readable():
        raise DerivationRefused(
            "in-flight maximum unestablishable — refuse, never fall back to the "
            "registry value (13 §5, G-1)"
        )
    effective_slots = max(registry.epoch_slots, in_flight.largest_cohort_slots)
    effective_length = max(registry.epoch_length, in_flight.longest_length_in_force)
    composed = replace(
        registry, epoch_slots=effective_slots, epoch_length=effective_length
    )
    return composed, books(effective_slots)


@dataclass(frozen=True)
class ScreenResult:
    """The outcome of one `constitution.set_param` occupancy screen."""

    admitted: bool
    breaches: tuple[str, ...] = ()
    envelopes: Envelopes | None = None

    @property
    def error(self) -> str | None:
        """13 §5: the refusal is `BudgetDerivationRequired`."""
        return None if self.admitted else "BudgetDerivationRequired"


def screen(
    live: Registry,
    key: str,
    value: int,
    in_flight: InFlight = GENESIS_IN_FLIGHT,
    *,
    composed: bool = True,
    frozen: Envelopes = FROZEN,
) -> ScreenResult:
    """`constitution.set_param`'s occupancy screen (13 §5, SQ-501).

    "the amended key at its proposed value, every other key at its live one",
    re-derived and refused exactly when the result exceeds a frozen figure.

    `composed=False` models the **registry-only** screen the amendment was
    written to replace; it exists so the two can be compared by execution
    rather than by argument (see the module docstring).
    """
    if key not in Registry._FIELDS:
        raise DerivationRefused(f"unknown key {key!r}")
    if value == live.get(key):
        # "An equal write is not a change and is never screened."
        return ScreenResult(admitted=True)
    bound = BOUNDS[key]
    if not bound.step_admissible(live.get(key), value):
        # 13 §5: bounds/max-Δ/cooldown run **before** the screen, so this fails
        # as an ordinary registry violation, not as BudgetDerivationRequired.
        raise DerivationRefused(
            f"{key} {live.get(key)} → {value} violates its 13 §1 bounds or max-Δ"
        )
    if key not in OCCUPANCY_KEYS:
        # `ledger.archive` is an input, never a trigger (13 §5 consequence (a)).
        return ScreenResult(admitted=True)

    proposed = live.with_key(key, value)
    if composed:
        effective, book_count = compose(proposed, in_flight)
    else:
        effective, book_count = proposed, books(proposed.epoch_slots)
    envelopes = derive(effective, book_count)
    breaches = envelopes.exceeds(frozen)
    return ScreenResult(
        admitted=not breaches, breaches=breaches, envelopes=envelopes
    )


def real_load(registry: Registry, in_flight: InFlight) -> Envelopes:
    """What the chain actually incurs at this registry and in-flight state.

    This is *not* the screen. Pinned keys are read from the in-flight state
    (that is what "pinned" means: a live cohort keeps its creation-time slot
    count and epoch length); live keys are read from the registry, because the
    consumer re-reads them on every crank. The screen is sound exactly when it
    dominates this for every reachable state.
    """
    if not in_flight.readable():
        raise DerivationRefused("unreadable in-flight state")
    actual = replace(
        registry,
        epoch_slots=in_flight.largest_cohort_slots,
        epoch_length=in_flight.longest_length_in_force,
    )
    return derive(actual, books(in_flight.largest_cohort_slots))


# ---------------------------------------------------------------------------
# Reachability: what the screen actually permits, as opposed to what 13 §1's
# published ranges suggest.
# ---------------------------------------------------------------------------


def reachable_slots_max(frozen: Envelopes = FROZEN) -> int:
    """The largest `epoch.slots` item 2 admits.

    13 §1 publishes `[1, 12]`; item 2's `32 + 4·slots ≤ 52` caps it at 5 — the
    genesis default — so every value above it is nominal. 13 §5 states the
    consequence ("the screen refuses every raise above 5"); this derives it.
    """
    bound = BOUNDS["epoch.slots"]
    admissible = [
        slots
        for slots in range(bound.minimum, bound.maximum + 1)
        if item2_vaults(slots) <= frozen.vaults
        and item2_vaults(slots) * VAULT_ROW_BYTES_PINNED <= frozen.vault_bytes
    ]
    return max(admissible)


def item1_reachable_max(frozen: Envelopes = FROZEN) -> int:
    """Item 1's maximum over the *reachable* box, not the compiled one.

    Item 1's frozen 2,240 is the formula at each input's compiled bound
    (`epoch.slots` 12, `epoch.length` at its 14-day floor, `ledger.archive` at
    its one-year ceiling). `epoch.slots = 12` is unreachable, so the envelope
    is strictly larger than any state the chain can occupy.
    """
    slots = reachable_slots_max(frozen)
    worst = Registry(
        epoch_slots=slots,
        epoch_length=BOUNDS["epoch.length"].minimum,
        ledger_archive=BOUNDS["ledger.archive"].maximum,
    )
    return item1_stored_markets(worst)


def item1_compiled_max() -> int:
    """Item 1 at each input's compiled bound — 13 §5's own `196 + 28·73`."""
    worst = Registry(
        epoch_slots=BOUNDS["epoch.slots"].maximum,
        epoch_length=BOUNDS["epoch.length"].minimum,
        ledger_archive=BOUNDS["ledger.archive"].maximum,
    )
    return item1_stored_markets(worst)


# ---------------------------------------------------------------------------
# The adversarial search. 13 §5's claim is about every lawful sequence, so it
# is searched rather than argued.
# ---------------------------------------------------------------------------


def _extremal_moves(live: Registry, key: str) -> list[int]:
    """Candidate values for one amendment of `key`.

    Both envelopes are monotone in every input, so an adversary's best move on
    any key is always to one end of its admissible step. Enumerating the two
    extremes plus the registry bound is therefore complete for the reachable
    *frontier* while keeping the search finite: `epoch.length` alone spans
    403,201 values, which no exhaustive enumeration could cover.
    """
    bound = BOUNDS[key]
    current = live.get(key)
    candidates: set[int] = set()
    if bound.max_delta is not None:
        span = bound.max_delta
    elif bound.max_delta_fraction is not None:
        span = int(bound.max_delta_fraction * current)  # floor: stays admissible
    else:
        span = bound.maximum - bound.minimum
    for value in (current - span, current + span, bound.minimum, bound.maximum):
        clamped = max(bound.minimum, min(bound.maximum, value))
        if key == "epoch.length":
            # 05 §3.1: keep phase boundaries exact. Round toward `current` so
            # the value stays inside the max-Δ band.
            if clamped > current:
                clamped -= clamped % PHASE_DENOMINATOR
            else:
                clamped += (-clamped) % PHASE_DENOMINATOR
        if clamped != current and bound.step_admissible(current, clamped):
            candidates.add(clamped)
    return sorted(candidates)


def search_breach(
    depth: int,
    *,
    composed: bool,
    start: Registry = GENESIS,
    in_flight: InFlight = GENESIS_IN_FLIGHT,
    frozen: Envelopes = FROZEN,
) -> list[tuple[str, int]] | None:
    """Search lawful amendment sequences for one that breaches a real envelope.

    Returns the first breaching sequence as `[(key, value), …]`, or ``None``
    when no sequence up to `depth` amendments leaves the *real* load (per
    :func:`real_load`) above a frozen figure while every step passed `screen`.

    The in-flight state is held fixed: the adversary chooses when to amend, so
    the worst case is amending while the genesis cohort is still live. That is
    the exact scenario 13 §5's two worked cases describe.
    """
    seen: set[Registry] = {start}
    frontier: list[tuple[Registry, list[tuple[str, int]]]] = [(start, [])]
    for _ in range(depth):
        nxt: list[tuple[Registry, list[tuple[str, int]]]] = []
        for registry, path in frontier:
            for key in OCCUPANCY_KEYS:
                for value in _extremal_moves(registry, key):
                    try:
                        verdict = screen(
                            registry,
                            key,
                            value,
                            in_flight,
                            composed=composed,
                            frozen=frozen,
                        )
                    except DerivationRefused:
                        continue
                    if not verdict.admitted:
                        continue
                    advanced = registry.with_key(key, value)
                    step = path + [(key, value)]
                    if real_load(advanced, in_flight).exceeds(frozen):
                        return step
                    if advanced not in seen:
                        seen.add(advanced)
                        nxt.append((advanced, step))
        frontier = nxt
        if not frontier:
            break
    return None
