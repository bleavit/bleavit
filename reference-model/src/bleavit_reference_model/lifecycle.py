"""05 §2–§3/§5.4–§5.5, 09 §1.2 and 11 §11.5 — lifecycle claims as data.

Doc 05's §2.1 transition table is normative ("anything absent is impossible and
MUST error"), §2.2 claims to be "re-verified against §2.1 — every edge below
appears above and vice versa", and §3.3 carries three derivations that the text
itself describes as wedges when they are got wrong:

* `epoch.horizon_k ≤ MAX_NON_TERMINAL_COHORTS − 2 = 2` — "at `k = 3` … within a
  few epochs **every** `qualify` fails `TooManyCohorts` permanently";
* the prune cutoff `current − 19` — "A cutoff of `current − 20` retains a full
  window and **permanently jams** `record_snapshot`";
* `MAX_SNAPSHOTS = 20 × (k + 1) = 60` — the multiplier is `k + 1`, not `k`, and
  at `k` "a signed caller could spend the epoch's single spare slot … after
  which `SnapshotDeadline` never advances".

All three are claims about what a bounded queue does over time, so this module
simulates them rather than restating them: :func:`simulate_cohorts` and
:func:`simulate_snapshot_window` reach the wedge for the wrong constant and do
not for the right one.

The state machine is carried as data (:data:`TRANSITIONS`) so its closure
properties are computable: termination under the one-shot budgets, I-15 (no
rejection/timeout/veto/expiry path enqueues execution), and the §2.2 edge-set
identity, which :func:`diagram_edges` checks against the document itself.

One divergence between the two documents that own the schedule is exposed here
rather than smoothed over — see :func:`decide_window_absolute` and
:func:`decide_window_by_fraction`. 05 §3.1 anchors the decision window
absolutely (`[18/21·L − dec.window, 18/21·L)`); 13 §3.1's table renders the same
row as the fixed fraction `[15/21, 18/21)`. They agree at the genesis registry
and nowhere else.

The execute checklist is likewise read from the documents rather than copied
into a second snapshot. 09 §1.2 publishes 13 items and demands an item-for-item
frontend mirror; 11 §11.5 publishes 14 rows. Executing the comparison finds nine
one-to-one rows, two backend rows split across two frontend rows each, two
backend execution steps with no frontend precondition, and one frontend-only
`DescriptorLeadTime` row. That last row belongs to 09 §2.2's separate
`apply_authorized_upgrade` call, not `execute`.

The same diff exposes a terminal state the contract cannot represent. 09
§1.2(11) says `Rejected(BadPreimage)`, but `BadPreimage` is absent from the
frozen 02 §4 :class:`~bleavit_reference_model.decision.RejectReason` set and
from 05 §2.1's T16 causes. The failure therefore leaves the proposal `Queued`;
with no lawful T16 cause it reaches T15 `Expired` at grace end. Separately, the
05 §5.5 table is total, deterministic and non-overlapping over its steps 6–8
partition, but its `Valid fail` row maps the reachable
`full = tail = false, converged = false` cell to `HurdleNotMet`; normative §5.4
maps it to `ConvergenceFailed`.

Units: lifecycle windows are block heights; checklist indices, row counts and
Boolean cells are exact integers. No new calculation divides, so no rounding is
performed. Every unrepresentable rejection keeps the status quo (`Queued`), the
direction against execution and against the claimant (R-7).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from fractions import Fraction
from itertools import product
from pathlib import Path

from .decision import Decision, Outcome, RejectReason
from .spec_values import EPOCH_LENGTH_DEFAULT, EPOCH_LENGTH_MAX, EPOCH_LENGTH_MIN

# ---------------------------------------------------------------------------
# 13 §3.1 / 13 §4 kernel constants.
# ---------------------------------------------------------------------------

BLOCKS_PER_DAY = 14_400
PHASE_DENOMINATOR = 21

#: `futarchy_primitives::phase_offsets` — the numerators over 21 (13 §3.1).
#: Review and Execute are per-class / per-proposal and carry no fixed fraction.
INTAKE_NUM = 0
QUALIFY_NUM = 3
SEED_NUM = 4
TRADE_NUM = 5
DECIDE_WINDOW_NUM = 15
DECIDE_NUM = 18
HOUSEKEEPING_NUM = 20

#: 02 §9 `Epoch::PhaseOffsets`, in the frozen order.
ORDERED_PHASES: tuple[tuple[str, int], ...] = (
    ("Intake", INTAKE_NUM),
    ("Qualify", QUALIFY_NUM),
    ("Seed", SEED_NUM),
    ("Trade", TRADE_NUM),
    ("DecideWindow", DECIDE_WINDOW_NUM),
    ("Decide", DECIDE_NUM),
    ("Housekeeping", HOUSEKEEPING_NUM),
)

DEC_WINDOW_DEFAULT = 43_200  # 72 h
DEC_WINDOW_MIN = 14_400
DEC_WINDOW_MAX = 86_400
DEC_TRAILING_DEFAULT = 14_400  # 24 h
DEC_EXTENSION_BLOCKS = 43_200  # 3 d, K, at most once per proposal

MAX_NON_TERMINAL_COHORTS = 4
HORIZON_K_DEFAULT = 2
#: 05 §3.3: the retained window is 20 snapshots deep, expressed in **epochs**.
RETAINED_EPOCHS = 20
#: 05 §3.3: pruning removes every snapshot with index ≤ current − 20, i.e. it
#: uses the cutoff `current − 19`.
PRUNE_CUTOFF_OFFSET = RETAINED_EPOCHS - 1


class ScheduleError(ValueError):
    """A schedule that cannot be computed exactly refuses (05 §3.1)."""


# ---------------------------------------------------------------------------
# 05 §3.1 — the phase schedule.
# ---------------------------------------------------------------------------


def phase_offset_blocks(numerator: int, epoch_length: int) -> int:
    """`numerator/21 · epoch.length`, exactly.

    05 §3.1 requires `epoch.length` to be a multiple of 21 "so all phase
    boundaries are exact"; a length that is not refuses rather than silently
    truncating a boundary.
    """
    if epoch_length <= 0:
        raise ScheduleError(f"non-positive epoch.length {epoch_length}")
    if epoch_length % PHASE_DENOMINATOR:
        raise ScheduleError(
            f"epoch.length {epoch_length} is not a multiple of {PHASE_DENOMINATOR}"
        )
    exact = Fraction(numerator * epoch_length, PHASE_DENOMINATOR)
    if exact.denominator != 1:
        raise ScheduleError(f"offset {numerator}/21 of {epoch_length} is not integral")
    return int(exact)


@dataclass(frozen=True)
class PhaseSchedule:
    """One epoch's phase boundaries, derived from `epoch.length` alone."""

    epoch_length: int
    boundaries: dict[str, int]

    def days(self, name: str) -> Fraction:
        """The boundary's day label at 14,400 blocks/day."""
        return Fraction(self.boundaries[name], BLOCKS_PER_DAY)

    def trade_span(self) -> int:
        """Blocks in `[5/21, 18/21)` — 13/21 of the epoch."""
        return self.boundaries["Decide"] - self.boundaries["Trade"]


def phase_schedule(epoch_length: int = EPOCH_LENGTH_DEFAULT) -> PhaseSchedule:
    """05 §3.1's schedule at any lawful `epoch.length`."""
    boundaries = {
        name: phase_offset_blocks(num, epoch_length) for name, num in ORDERED_PHASES
    }
    return PhaseSchedule(epoch_length, boundaries)


def lawful_epoch_lengths() -> range:
    """Every `epoch.length` satisfying 13 §1's bounds and 05 §3.1's multiple-of-21."""
    first = EPOCH_LENGTH_MIN + (-EPOCH_LENGTH_MIN) % PHASE_DENOMINATOR
    return range(first, EPOCH_LENGTH_MAX + 1, PHASE_DENOMINATOR)


def decide_window_absolute(
    epoch_length: int = EPOCH_LENGTH_DEFAULT, dec_window: int = DEC_WINDOW_DEFAULT
) -> tuple[int, int]:
    """05 §3.1: `[18/21·L − dec.window, 18/21·L)` — anchored to Trade close.

    05 §3.1 is explicit that "`dec.window` and `dec.trailing` remain absolute
    block-count parameters anchored to Trade close", and 13 §3.1's SQ-501
    clarification confirms accrual boundaries are "computed from the then-live
    `dec.window`/`dec.trailing` and stored per book". This is the governing
    reading.
    """
    close = phase_offset_blocks(DECIDE_NUM, epoch_length)
    return close - dec_window, close


def decide_window_by_fraction(epoch_length: int = EPOCH_LENGTH_DEFAULT) -> tuple[int, int]:
    """13 §3.1's rendering of the same row: the fixed fraction `[15/21, 18/21)`.

    Carried as `phase_offsets::DECIDE_WINDOW_NUM = 15` and exposed to clients in
    the 02 §9 `Epoch::PhaseOffsets` metadata list. It equals
    :func:`decide_window_absolute` **only** at the genesis registry; see
    :func:`decide_window_readings_agree`.
    """
    return (
        phase_offset_blocks(DECIDE_WINDOW_NUM, epoch_length),
        phase_offset_blocks(DECIDE_NUM, epoch_length),
    )


def decide_window_readings_agree(
    epoch_length: int = EPOCH_LENGTH_DEFAULT, dec_window: int = DEC_WINDOW_DEFAULT
) -> bool:
    """Whether 05 §3.1's and 13 §3.1's decision windows coincide here."""
    return decide_window_absolute(epoch_length, dec_window) == decide_window_by_fraction(
        epoch_length
    )


def dec_window_constraint_satisfied(
    epoch_length: int = EPOCH_LENGTH_DEFAULT, dec_window: int = DEC_WINDOW_DEFAULT
) -> bool:
    """05 §3.1's parameter-change constraint: `dec.window ≤ 13/21 · epoch.length`.

    Checked at parameter change; it is what keeps the accrual window inside the
    Trade phase rather than reaching back into Seed.
    """
    return Fraction(dec_window) <= Fraction(13, 21) * epoch_length


# ---------------------------------------------------------------------------
# 05 §2.1 — the transition table, as data.
# ---------------------------------------------------------------------------

#: Every proposal state named in §2.1. `Void` is a *vault* state (03 §2.3), not
#: a proposal state — §2.1's SQ-162 note is explicit that a measurement-time
#: cohort VOID draws no proposal transition.
STATES: tuple[str, ...] = (
    "None",
    "Submitted",
    "Screening",
    "Cancelled",
    "Qualified",
    "Trading",
    "Extended",
    "Queued",
    "Suspended",
    "Rerun",
    "Executed",
    "FailedExecuted",
    "Expired",
    "Rejected",
    "Measuring",
    "Settled",
)

#: §2.1 *Terminal states*. `Settled` and `Cancelled` are absorbing outright.
#: `Rejected` is **also** terminal "where no vault exists (pre-Seed rejections via
#: T20) or the vault is `Voided`", because T21 "fires iff markets were deployed and
#: the vault is open". Whether a configuration is terminal is therefore a question
#: about the vault as well as the state — use :func:`is_terminal`, not this set.
ABSORBING_STATES: frozenset[str] = frozenset({"Settled", "Cancelled"})

#: The vault's states as the proposal machine observes them (03 §2.3). A proposal
#: has no vault until T7 deploys markets and opens one; T20 voids an open one
#: (D-1) and a `Voided` vault takes no measurement.
VAULT_NONE, VAULT_OPEN, VAULT_VOIDED = "none", "open", "voided"
VAULT_STATES: tuple[str, ...] = (VAULT_NONE, VAULT_OPEN, VAULT_VOIDED)

#: §2.1 T20 scope: "any non-terminal pre-Executed" state. SQ-319 confirms
#: `Queued`, `Suspended`, `Rerun` and `FailedExecuted` are simultaneously
#: pre-Executed and decided, so all four are in scope.
PRE_EXECUTED_STATES: frozenset[str] = frozenset(
    {
        "Submitted",
        "Screening",
        "Qualified",
        "Trading",
        "Extended",
        "Queued",
        "Suspended",
        "Rerun",
        "FailedExecuted",
    }
)


@dataclass(frozen=True)
class Transition:
    """One §2.1 row."""

    tag: str
    sources: tuple[str, ...]
    target: str
    trigger: str
    #: Flags that must be unset for the transition to be enabled.
    requires_unset: tuple[str, ...] = ()
    #: Flags that must be set for the transition to be enabled.
    requires_set: tuple[str, ...] = ()
    #: Flags the transition sets.
    sets: tuple[str, ...] = ()
    #: Vault states in which the transition is enabled; empty means any.
    requires_vault: tuple[str, ...] = ()
    #: T7 alone deploys markets and opens the vault.
    opens_vault: bool = False
    #: T20 alone voids an open vault — "if a vault exists it transitions to
    #: `Voided` (03, D-1) — **no measurement**". A pre-Seed T20 has no vault to
    #: void and simply leaves the proposal terminally `Rejected`.
    voids_vault: bool = False


#: The §2.1 table. The flag names are the document's own: `extended`,
#: `delayed_once`, `rerun`, plus `deferred_once` for T6's single rollover
#: allowance and `guardian_rerun` for the "one guardian rerun of either kind per
#: proposal, ever" budget T11/T13 and T25 share.
TRANSITIONS: tuple[Transition, ...] = (
    Transition("T1", ("None",), "Submitted", "epoch.submit"),
    Transition("T2", ("Submitted",), "Cancelled", "epoch.withdraw"),
    Transition("T3", ("Submitted",), "Screening", "tick"),
    Transition("T4", ("Screening",), "Cancelled", "tick (static fail)"),
    Transition("T5", ("Screening",), "Qualified", "tick (slot + locks)"),
    Transition(
        "T6", ("Screening",), "Submitted", "tick (defer)",
        requires_unset=("deferred_once",), sets=("deferred_once",),
    ),
    Transition(
        "T7", ("Qualified",), "Trading", "tick (markets + POL)", opens_vault=True
    ),
    Transition(
        "T8", ("Trading",), "Extended", "decide (insufficiency / stale TWAP)",
        requires_unset=("extended",), sets=("extended",),
    ),
    Transition("T9", ("Trading", "Extended"), "Queued", "decide (ADOPT)"),
    Transition("T10", ("Trading", "Extended"), "Rejected", "decide (reject)"),
    Transition(
        "T11", ("Queued",), "Suspended", "guardian.delay_once",
        requires_unset=("delayed_once", "guardian_rerun"),
        sets=("delayed_once", "guardian_rerun"),
    ),
    Transition("T12", ("Suspended",), "Rerun", "tick (review not upheld)"),
    Transition(
        "T13", ("Rerun",), "Extended", "tick (reopen 3 d, 2× POL)",
        sets=("extended", "rerun"),
    ),
    Transition("T14", ("Queued",), "Executed", "execution_guard.execute"),
    Transition("T15", ("Queued",), "Expired", "tick (grace, no T16 cause)"),
    Transition("T16", ("Queued",), "Rejected", "tick / execute failure paths"),
    Transition("T17", ("Executed",), "Measuring", "automatic; resolve(Accept)"),
    Transition("T18", ("Queued",), "FailedExecuted", "execute (payload revert)"),
    Transition("T19", ("Measuring",), "Settled", "settle_cohort"),
    Transition(
        "T20", tuple(sorted(PRE_EXECUTED_STATES)), "Rejected",
        "tick / decide under VOID, stale epoch, PB-LEDGER-FREEZE",
        voids_vault=True,
    ),
    Transition(
        "T21", ("Rejected", "Expired"), "Measuring", "automatic; resolve(Reject)",
        requires_vault=(VAULT_OPEN,),
    ),
    Transition("T22", ("FailedExecuted",), "Measuring", "tick (retry exhausted)"),
    Transition("T23", ("FailedExecuted",), "Executed", "execution_guard.execute (retry)"),
    Transition("T24", ("Suspended",), "Rejected", "guardian.uphold_veto"),
    Transition(
        "T25", ("Trading", "Extended", "Queued"), "Extended", "guardian.force_rerun",
        requires_unset=("guardian_rerun",),
        sets=("extended", "rerun", "guardian_rerun"),
    ),
    Transition(
        "T26", ("Screening",), "Cancelled", "tick (rollover exhausted)",
        requires_set=("deferred_once",),
    ),
)

BY_TAG: dict[str, Transition] = {t.tag: t for t in TRANSITIONS}

#: §2.1 T16's enumerated causes, evaluated **before** T15 at grace end.
T16_CAUSES: tuple[str, ...] = ("StaleQueue", "NotRatified", "AttestationMissing")


def grace_end_disposition(causes: tuple[str, ...] = ()) -> tuple[str, str]:
    """§2.1 *Grace-end precedence: T16 before T15* (SQ-164).

    At the tick where grace expires a ratification-requiring proposal with no
    Passed record satisfies **both** T15 and T16. "T16's specific causes MUST be
    evaluated first", so it becomes `Rejected(cause)` and never `Expired`:
    "a known terminal cause must not collapse into generic expiry".

    Returns `(transition_tag, disposition)`.
    """
    for cause in T16_CAUSES:
        if cause in causes:
            return "T16", f"Rejected({cause})"
    return "T15", "Expired"


# ---------------------------------------------------------------------------
# Reachability over (state, flags).
# ---------------------------------------------------------------------------

FLAGS: tuple[str, ...] = ("deferred_once", "extended", "delayed_once", "rerun", "guardian_rerun")


@dataclass(frozen=True)
class Config:
    """A proposal's process state, its one-shot budgets, and its vault.

    The vault is part of the configuration because §2.1 makes terminality depend
    on it: T21 fires only on an open one, so the same `Rejected` state is
    transient with a healthy vault and terminal without.
    """

    state: str
    flags: frozenset[str] = field(default_factory=frozenset)
    vault: str = VAULT_NONE

    def __post_init__(self) -> None:
        if self.state not in STATES:
            raise ScheduleError(f"unknown proposal state {self.state!r}")
        if self.vault not in VAULT_STATES:
            raise ScheduleError(f"unknown vault state {self.vault!r}")


def enabled(config: Config) -> list[Transition]:
    """Every §2.1 transition enabled in this configuration."""
    return [
        t
        for t in TRANSITIONS
        if config.state in t.sources
        and not (set(t.requires_unset) & config.flags)
        and set(t.requires_set) <= config.flags
        and (not t.requires_vault or config.vault in t.requires_vault)
    ]


def fire(config: Config, transition: Transition) -> Config:
    vault = config.vault
    if transition.opens_vault:
        vault = VAULT_OPEN
    elif transition.voids_vault and vault == VAULT_OPEN:
        vault = VAULT_VOIDED
    return Config(transition.target, config.flags | set(transition.sets), vault)


def is_terminal(config: Config) -> bool:
    """§2.1 *Terminal states*, evaluated on the configuration rather than the state.

    Terminal means no §2.1 transition is enabled. That reproduces the document's
    list exactly: `Settled` and `Cancelled` always; `Rejected` when no vault
    exists (a pre-Seed T20) or the vault is `Voided`; and never `Expired`, since
    `Expired` implies `Queued` implies markets — §2.1 lists `Expired`-without-vault
    as impossible, and :func:`reachable_configs` confirms it is unreachable.
    """
    return not enabled(config)


def reachable_configs(start: Config | None = None) -> set[Config]:
    """Every configuration reachable from `∅` under §2.1."""
    start = start or Config("None")
    seen, frontier = {start}, [start]
    while frontier:
        config = frontier.pop()
        for transition in enabled(config):
            nxt = fire(config, transition)
            if nxt not in seen:
                seen.add(nxt)
                frontier.append(nxt)
    return seen


def reaches(start: Config, target_state: str) -> bool:
    """Whether `target_state` is reachable from `start` under §2.1."""
    return any(config.state == target_state for config in reachable_configs(start))


def find_cycle() -> list[str] | None:
    """A repeating configuration cycle, or ``None`` if the machine terminates.

    §2.1's one-shot budgets (`deferred_once`, `extended`, `delayed_once`, the
    shared `guardian_rerun`) are what make T6's rollover, T25's self-edge and
    the T11→T12→T13 loop finite. Because every flag is one-way, a cycle in
    `(state, flags)` space would mean a proposal that never terminates.
    """
    colour: dict[Config, int] = {}
    stack: list[str] = []

    def visit(config: Config) -> list[str] | None:
        colour[config] = 1
        for transition in enabled(config):
            nxt = fire(config, transition)
            stack.append(transition.tag)
            if colour.get(nxt, 0) == 1:
                return list(stack)
            if colour.get(nxt, 0) == 0:
                found = visit(nxt)
                if found is not None:
                    return found
            stack.pop()
        colour[config] = 2
        return None

    return visit(Config("None"))


def terminal_configs() -> set[Config]:
    """Reachable configurations from which no §2.1 transition is enabled."""
    return {c for c in reachable_configs() if is_terminal(c)}


# ---------------------------------------------------------------------------
# §2.2 — the lifecycle diagram, read from the document.
# ---------------------------------------------------------------------------

DOC_05 = "docs/architecture/05-welfare-and-decision-engine.md"
#: §2.2's parenthetical: the T20 force-reject edges and the Voided-vault
#: terminal `Rejected` "are omitted from the drawing for legibility".
DIAGRAM_OMITS: frozenset[str] = frozenset({"T20"})


def diagram_edges(repo_root: Path) -> set[tuple[str, str, str]]:
    """Parse §2.2's mermaid block into `(tag, from, to)` edges.

    §2.2 asserts "every edge below appears above and vice versa". That is a
    checkable claim about two artifacts in one file, so it is checked rather
    than trusted.
    """
    text = (repo_root / DOC_05).read_text(encoding="utf-8")
    match = re.search(r"```mermaid\n(stateDiagram-v2.*?)```", text, re.DOTALL)
    if match is None:
        raise ScheduleError("05 §2.2 mermaid block not found")
    edges = set()
    for line in match.group(1).splitlines():
        edge = re.match(
            r"\s*(\S+)\s*-->\s*(\S+)\s*:\s*(T\d+)", line.strip()
        )
        if edge:
            source, target, tag = edge.groups()
            edges.add((tag, source, target))
    return edges


def table_edges(omit: frozenset[str] = DIAGRAM_OMITS) -> set[tuple[str, str, str]]:
    """§2.1's edges in the same `(tag, from, to)` shape, for comparison.

    `[*]` is the diagram's spelling of `∅` and of a terminal sink; the table
    spells the former `∅`. Terminal sinks (`Settled --> [*]`) carry no tag and
    are not edges of the table at all.
    """
    edges = set()
    for transition in TRANSITIONS:
        if transition.tag in omit:
            continue
        for source in transition.sources:
            edges.add(
                (transition.tag, "[*]" if source == "None" else source, transition.target)
            )
    return edges


# ---------------------------------------------------------------------------
# §3.3 — the cohort machine and the horizon ceiling.
# ---------------------------------------------------------------------------


def cohort_lifetime_epochs(horizon_k: int) -> int:
    """§3.3: a cohort is non-terminal for `k + 2` epochs.

    "A cohort created at epoch `e` measures through `e + k`, settles at
    `e + k + 1` and is removed only then."
    """
    if horizon_k < 1:
        raise ScheduleError(f"horizon k {horizon_k} below 1")
    return horizon_k + 2


def max_horizon_k(cap: int = MAX_NON_TERMINAL_COHORTS) -> int:
    """§3.3: `k ≤ MAX_NON_TERMINAL_COHORTS − 2`.

    "one cohort forms per epoch, so steady state holds exactly `k + 2` live
    cohorts against I-21's cap of 4". A **kernel** ceiling, not META-amendable
    metadata: raising it is a wedge, not a tuning choice.
    """
    return cap - 2


@dataclass(frozen=True)
class CohortRun:
    """The §3.3 cohort machine's outcome, per epoch.

    Recording admission **per epoch** rather than only the first failure is what
    distinguishes the two claims a saturated live count is compatible with: a
    total halt, and a recurring shortfall. At `k = 3` it is the second — see
    :attr:`admission_rate` and the 2026-07-31 correction to 05 §3.3.
    """

    live_counts: tuple[int, ...]
    admitted: tuple[bool, ...]

    @property
    def failure_epochs(self) -> tuple[int, ...]:
        return tuple(e for e, ok in enumerate(self.admitted) if not ok)

    @property
    def first_failure(self) -> int | None:
        failures = self.failure_epochs
        return failures[0] if failures else None

    @property
    def admission_rate(self) -> Fraction:
        """Fraction of epochs that formed a cohort."""
        if not self.admitted:
            raise ScheduleError("empty run has no admission rate")
        return Fraction(sum(self.admitted), len(self.admitted))

    def failure_period(self) -> int | None:
        """The gap between consecutive admission failures, if it is constant."""
        failures = self.failure_epochs
        if len(failures) < 2:
            return None
        gaps = {b - a for a, b in zip(failures, failures[1:])}
        return gaps.pop() if len(gaps) == 1 else None


def simulate_cohorts(
    horizon_k: int, epochs: int, cap: int = MAX_NON_TERMINAL_COHORTS
) -> CohortRun:
    """Run the §3.3 cohort machine and record every epoch's admission outcome.

    A `qualify` that would create a `cap + 1`-th concurrent cohort fails
    `TooManyCohorts`. One cohort forms per epoch and each occupies `k + 2` of
    them, so the steady-state demand is `k + 2` against the cap: at `k ≤ 2` the
    demand fits and no epoch ever fails, and at `k = 3` it does not, so exactly
    one epoch in every `k + 2` fails — forever, and unrecoverably, because a
    cohort is per-epoch and a skipped epoch's proposals cannot join a later one.
    """
    lifetime = cohort_lifetime_epochs(horizon_k)
    live: list[int] = []  # creation epochs of non-terminal cohorts
    counts: list[int] = []
    admitted: list[bool] = []
    for epoch in range(epochs):
        live = [e for e in live if epoch - e < lifetime]
        ok = len(live) < cap
        if ok:
            live.append(epoch)
        admitted.append(ok)
        counts.append(len(live))
    return CohortRun(tuple(counts), tuple(admitted))


# ---------------------------------------------------------------------------
# §3.3 — snapshot retention.
# ---------------------------------------------------------------------------


def prune_cutoff(current_epoch: int, offset: int = PRUNE_CUTOFF_OFFSET) -> int:
    """§3.3 (SQ-200): retain every epoch `≥ current − 19`, retire below it."""
    return current_epoch - offset


def max_snapshots(horizon_k: int = HORIZON_K_DEFAULT, epochs: int = RETAINED_EPOCHS) -> int:
    """§3.3 (2026-07-27): `MAX_SNAPSHOTS = 20 × (k + 1) = 60` **records**.

    "`Snapshots` is keyed `(epoch, spec_version)` and capacity is enforced
    against the **record** count, so the epoch bound has to carry §3.3's version
    multiplicity to mean the same thing." The multiplier is `k + 1`, not `k`:
    the admissible set is the epoch's frozen versions ∪ its own active version,
    "and the active version need not be a member of the frozen set".
    """
    return epochs * (horizon_k + 1)


def admissible_versions(
    active_version: int, frozen_versions: tuple[int, ...]
) -> frozenset[int]:
    """§3.3: the epoch's active spec **plus** every version a live cohort froze.

    "`record_snapshot` MUST accept only a version in the epoch's admissible set
    … and not merely any version *activated* by the epoch. The two differ
    precisely in the versions no consumer will ever read, which is the
    difference an attacker was spending the spare slot on."
    """
    return frozenset(frozen_versions) | {active_version}


def worst_case_records(
    horizon_k: int = HORIZON_K_DEFAULT, epochs: int = RETAINED_EPOCHS
) -> int:
    """The largest lawful record count in the retained window.

    Each retained epoch can need one record per cohort measuring it (`k`, by
    I-16's freezing) plus one for its own active spec. Reached, not assumed:
    "Two `register_spec` calls activating in consecutive epochs reach that state
    through the ordinary governance path, with no attacker and no cadence rule
    forbidding it."
    """
    return epochs * (horizon_k + 1)


@dataclass
class SnapshotWindow:
    """The retained `(epoch, spec_version)` window, as a bounded map."""

    capacity: int
    cutoff_offset: int = PRUNE_CUTOFF_OFFSET
    records: dict[int, set[int]] = field(default_factory=dict)

    def total(self) -> int:
        return sum(len(versions) for versions in self.records.values())

    def retire(self, current_epoch: int) -> None:
        """§3.3: retirement is owned by the **epoch roll**, not by cohort reap.

        "every clock roll MUST retire welfare state that has fallen out of the
        retained window, whether or not that roll settled a cohort" — an epoch
        in which no proposal reaches `Measuring` forms no cohort, so
        cohort-keyed cleanup can never reach it.
        """
        cutoff = prune_cutoff(current_epoch, self.cutoff_offset)
        for epoch in [e for e in self.records if e < cutoff]:
            del self.records[epoch]

    def record(self, epoch: int, version: int) -> bool:
        """`record_snapshot`, which "requires strict spare capacity"."""
        if version in self.records.get(epoch, set()):
            return True
        if self.total() >= self.capacity:
            return False
        self.records.setdefault(epoch, set()).add(version)
        return True


def simulate_snapshot_window(
    epochs: int,
    *,
    capacity: int,
    cutoff_offset: int = PRUNE_CUTOFF_OFFSET,
    versions_per_epoch: int = 1,
) -> tuple[int | None, SnapshotWindow]:
    """Roll the epoch clock and record snapshots; report the first jam.

    Returns `(first_epoch_at_which_record_snapshot_failed, window)`. A jam is
    not a capacity nuisance: §3.3 traces it to `SnapshotDeadline` never
    advancing, §4.8's dead-man latching, and "the frozen epoch clock freez[ing]
    the very prune cutoff that would have released the slot".
    """
    window = SnapshotWindow(capacity=capacity, cutoff_offset=cutoff_offset)
    for epoch in range(epochs):
        window.retire(epoch)
        for version in range(versions_per_epoch):
            if not window.record(epoch, version):
                return epoch, window
    return None, window


# ---------------------------------------------------------------------------
# 09 §1.2 ↔ 11 §11.5 — execute-checklist contract diff.
# ---------------------------------------------------------------------------

DOC_09 = "docs/architecture/09-execution-upgrades-and-rollout.md"
DOC_11 = "docs/architecture/11-frontend-workflows.md"

# One item in either document can carry several independently re-readable
# obligations. These labels are semantic join keys, not parameter values. They
# preserve the documents' own grouping so a split/merge cannot masquerade as an
# item-for-item bijection.
_BACKEND_CHECK_ATOMS: dict[int, tuple[str, ...]] = {
    1: ("queue-state", "window"),
    2: ("preimage",),
    3: ("runtime-version",),
    4: ("ratification",),
    5: ("attestation",),
    6: ("capability-rules",),
    7: ("rate-meters",),
    8: ("resource-locks",),
    9: ("guardian-suspension",),
    10: ("gate-flags", "dead-man-freezes"),
    11: ("batch-bounds",),
    12: ("dispatch",),
    13: ("record",),
}

_FRONTEND_CHECK_ATOMS: dict[int, tuple[str, ...]] = {
    1: ("queue-state",),
    2: ("window",),
    3: ("preimage",),
    4: ("runtime-version",),
    5: ("ratification",),
    6: ("attestation",),
    7: ("capability-rules",),
    8: ("rate-meters",),
    9: ("resource-locks",),
    10: ("guardian-suspension",),
    11: ("gate-flags",),
    12: ("dead-man-freezes",),
    13: ("batch-bounds",),
    14: ("descriptor-lead-time",),
}


def _between(text: str, start: str, end: str) -> str:
    """The text between two unique headings, refusing a malformed document."""
    start_at = text.find(start)
    if start_at < 0:
        raise ScheduleError(f"heading not found: {start}")
    end_at = text.find(end, start_at + len(start))
    if end_at < 0:
        raise ScheduleError(f"heading not found after {start}: {end}")
    return text[start_at + len(start):end_at]


def _plain_markdown(value: str) -> str:
    """Remove the inline delimiters needed to compare names and reason codes."""
    return value.replace("**", "").replace("`", "").strip()


def _named_reject_reasons(text: str) -> tuple[str, ...]:
    """Reject reasons explicitly named as terminal outcomes in checklist prose."""
    found: list[str] = []
    for pattern in (r"Rejected\((\w+)\)", r"RejectReason::(\w+)"):
        for reason in re.findall(pattern, _plain_markdown(text)):
            if reason not in found:
                found.append(reason)
    return tuple(found)


@dataclass(frozen=True)
class ExecuteCheck:
    """One parsed 09 §1.2 item or 11 §11.5 frontend row."""

    document: str
    index: int
    name: str
    detail: str
    atoms: tuple[str, ...]
    reject_reasons: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.document}:{self.index}"


def backend_execute_checks(repo_root: Path) -> tuple[ExecuteCheck, ...]:
    """Parse 09 §1.2's numbered, canonical dispatch-time list."""
    text = (repo_root / DOC_09).read_text(encoding="utf-8")
    section = _between(
        text,
        "### 1.2 `execute(pid)` — permissionless, atomic; the complete dispatch-time check list",
        "### 1.3 Origin discipline",
    )
    checks = []
    for match in re.finditer(r"(?m)^(\d+)\. \*\*(.+?)\*\*: (.+)$", section):
        index = int(match.group(1))
        name, detail = _plain_markdown(match.group(2)), match.group(3).strip()
        checks.append(
            ExecuteCheck(
                document="09 §1.2",
                index=index,
                name=name,
                detail=detail,
                atoms=_BACKEND_CHECK_ATOMS.get(index, ()),
                reject_reasons=_named_reject_reasons(detail),
            )
        )
    if any(not check.atoms for check in checks):
        raise ScheduleError("09 §1.2 gained an unclassified execute-check item")
    return tuple(checks)


def frontend_execute_checks(repo_root: Path) -> tuple[ExecuteCheck, ...]:
    """Parse 11 §11.5's `execution_guard.execute` precondition table."""
    text = (repo_root / DOC_11).read_text(encoding="utf-8")
    section = _between(
        text,
        "### `execution_guard.execute` — the complete precondition row (X-11i resolved)",
        "\n---",
    )
    checks = []
    for line in section.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 2:
            continue
        match = re.fullmatch(r"(\d+)\.\s*(.+)", cells[0])
        if match is None:
            continue
        index = int(match.group(1))
        name, detail = _plain_markdown(match.group(2)), cells[1]
        checks.append(
            ExecuteCheck(
                document="11 §11.5",
                index=index,
                name=name,
                detail=detail,
                atoms=_FRONTEND_CHECK_ATOMS.get(index, ()),
                reject_reasons=_named_reject_reasons(detail),
            )
        )
    if any(not check.atoms for check in checks):
        raise ScheduleError("11 §11.5 gained an unclassified execute-check row")
    return tuple(checks)


@dataclass(frozen=True)
class ChecklistMismatch:
    """One reason the two parsed lists are not an item-for-item bijection."""

    key: str
    backend_rows: tuple[int, ...]
    frontend_rows: tuple[int, ...]
    why: str


@dataclass(frozen=True)
class ExecuteChecklistDiff:
    """The row-level bijection result for 09 §1.2 and 11 §11.5."""

    backend: tuple[ExecuteCheck, ...]
    frontend: tuple[ExecuteCheck, ...]
    one_to_one: tuple[tuple[int, int], ...]
    mismatches: tuple[ChecklistMismatch, ...]

    @property
    def bijective(self) -> bool:
        return not self.mismatches


def execute_checklist_diff(repo_root: Path) -> ExecuteChecklistDiff:
    """Diff the two live document lists by semantic obligation and row grouping.

    This is deliberately a row-level check. Comparing only the union of
    obligations would hide 09 items 1 and 10 being split by the frontend, even
    though both documents demand an *item-for-item* mirror.
    """
    backend = backend_execute_checks(repo_root)
    frontend = frontend_execute_checks(repo_root)
    backend_atoms = {atom: row for row in backend for atom in row.atoms}
    frontend_atoms = {atom: row for row in frontend for atom in row.atoms}

    one_to_one = []
    mismatches = []
    for row in backend:
        matches = tuple(
            sorted(
                {frontend_atoms[atom].index for atom in row.atoms if atom in frontend_atoms}
            )
        )
        if len(matches) == 1:
            frontend_row = next(item for item in frontend if item.index == matches[0])
            if frontend_row.atoms == row.atoms:
                one_to_one.append((row.index, frontend_row.index))
                continue
        if not matches:
            why = (
                f"09 item {row.index} is the {row.name.lower()} execution step; "
                "11's table contains pre-sign re-reads, not this post-check step"
            )
            mismatches.append(
                ChecklistMismatch(
                    f"backend:{row.index}:unmatched", (row.index,), (), why
                )
            )
        else:
            names = ", ".join(str(index) for index in matches)
            mismatches.append(
                ChecklistMismatch(
                    f"backend:{row.index}:split",
                    (row.index,),
                    matches,
                    f"09 item {row.index} groups {', '.join(row.atoms)}; "
                    f"11 separates them into rows {names}",
                )
            )

    for row in frontend:
        if not any(atom in backend_atoms for atom in row.atoms):
            why = (
                "09 §2.2 makes DescriptorLeadTime a precondition of "
                "apply_authorized_upgrade, not execution_guard.execute"
                if row.atoms == ("descriptor-lead-time",)
                else "no 09 §1.2 execute-check item carries this obligation"
            )
            mismatches.append(
                ChecklistMismatch(
                    f"frontend:{row.index}:unmatched", (), (row.index,), why
                )
            )

    return ExecuteChecklistDiff(
        backend,
        frontend,
        tuple(one_to_one),
        tuple(mismatches),
    )


@dataclass(frozen=True)
class RejectReasonFinding:
    """Membership of one checklist-named terminal reason in frozen 02 §4."""

    key: str
    document: str
    row: int
    reason: str
    ok: bool


def frozen_reject_reasons() -> frozenset[str]:
    """The frozen 02 §4 set, imported from the independent decision model."""
    return frozenset(reason.value for reason in RejectReason)


def check_execute_reject_reasons(repo_root: Path) -> tuple[RejectReasonFinding, ...]:
    """Check every terminal reason named by either parsed execute list."""
    frozen = frozen_reject_reasons()
    findings = []
    for check in backend_execute_checks(repo_root) + frontend_execute_checks(repo_root):
        for reason in check.reject_reasons:
            findings.append(
                RejectReasonFinding(
                    key=f"{check.key}:{reason}",
                    document=check.document,
                    row=check.index,
                    reason=reason,
                    ok=reason in frozen,
                )
            )
    return tuple(findings)


def checklist_t16_causes(repo_root: Path) -> frozenset[str]:
    """09 §1.2 reasons that claim `Queued → Rejected`, hence T16.

    T16 is the only 05 §2.1 transition from `Queued` to `Rejected`. The check
    derives the transition from those endpoints rather than assigning a tag by
    reason name; this is what exposes `BadPreimage` as an extra checklist cause.
    """
    return frozenset(
        reason
        for check in backend_execute_checks(repo_root)
        for reason in check.reject_reasons
        if f"Rejected({reason})" in _plain_markdown(check.detail)
    )


@dataclass(frozen=True)
class T16CauseDiff:
    """Both directions of the 09 §1.2 ↔ 05 §2.1 T16 reason-set diff."""

    checklist_only: frozenset[str]
    transition_only: frozenset[str]

    @property
    def ok(self) -> bool:
        return not self.checklist_only and not self.transition_only


def t16_cause_diff(repo_root: Path) -> T16CauseDiff:
    """Compare checklist-produced terminal reasons with `T16_CAUSES`."""
    checklist = checklist_t16_causes(repo_root)
    transitions = frozenset(T16_CAUSES)
    return T16CauseDiff(checklist - transitions, transitions - checklist)


@dataclass(frozen=True)
class ExecuteFailureDisposition:
    """Status-quo path when a purported rejection cannot be represented."""

    state_after_dispatch: str
    grace_transition: str
    grace_disposition: str


def unconstructable_reject_disposition(reason: str) -> ExecuteFailureDisposition:
    """Derive the fate of a checklist reason absent from frozen 02 §4.

    A failed dispatch performs no transition, so the state remains `Queued`.
    Because an unrepresentable reason cannot be a T16 cause, 05 §2.1's
    grace-end precedence selects generic T15 expiry.
    """
    if reason in frozen_reject_reasons():
        raise ScheduleError(f"{reason} is constructable as RejectReason")
    transition, disposition = grace_end_disposition()
    return ExecuteFailureDisposition("Queued", transition, disposition)


# ---------------------------------------------------------------------------
# 05 §5.4 ↔ §5.5 — reason-table check for the welfare match arm.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReasonTableRow:
    """One parsed row of 05 §5.5's 11-step truth table."""

    scenario: str
    steps: tuple[str, ...]
    outcome: str


def reason_table_rows(repo_root: Path) -> tuple[ReasonTableRow, ...]:
    """Parse all rows from 05 §5.5, refusing a malformed column count."""
    text = (repo_root / DOC_05).read_text(encoding="utf-8")
    section = _between(
        text,
        "### 5.5 Reason-code truth table (steps 1–11)",
        "### 5.6 Security sizing:",
    )
    rows = []
    for line in section.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or cells[0] in {"Scenario", "---"} or set(cells[0]) == {"-"}:
            continue
        if len(cells) != 13:
            raise ScheduleError(
                f"05 §5.5 row {cells[0]!r} has {len(cells)} columns, expected 13"
            )
        rows.append(
            ReasonTableRow(
                scenario=_plain_markdown(cells[0]),
                steps=tuple(_plain_markdown(cell) for cell in cells[1:12]),
                outcome=_plain_markdown(cells[12]),
            )
        )
    return tuple(rows)


@dataclass(frozen=True)
class WelfareHurdleCase:
    """The four inputs consumed by 05 §5.4's steps 6–8 match arm."""

    full_pass: bool
    tail_pass: bool
    converged: bool
    extended: bool


_WELFARE_SCENARIOS = frozenset(
    {
        "Valid pass",
        "Valid fail",
        "Full/trailing disagreement (first)",
        "Disagreement/fail after extension",
        "Non-convergence",
    }
)


def _welfare_row_matches(case: WelfareHurdleCase, row: ReasonTableRow) -> bool:
    """Interpret the scenario label and marks for steps 6–8 only."""
    def mark_matches(mark: str, value: bool) -> bool:
        if mark == "✔":
            return value
        if mark.startswith("✘"):
            return not value
        if mark in {"–", "...", "…"}:
            return True
        raise ScheduleError(f"unsupported boolean truth-table mark {mark!r}")

    full_mark, tail_mark, convergence_mark = row.steps[5:8]
    if row.scenario == "Valid pass":
        return (
            mark_matches(full_mark, case.full_pass)
            and mark_matches(tail_mark, case.tail_pass)
            and mark_matches(convergence_mark, case.converged)
        )
    if row.scenario == "Valid fail":
        # "fail", not disagreement: both hurdle windows fail. The dash under
        # convergence is the bad cell under test, so it remains a wildcard.
        return (
            case.full_pass == case.tail_pass
            and mark_matches(full_mark, case.full_pass)
            and mark_matches(tail_mark, case.tail_pass)
            and mark_matches(convergence_mark, case.converged)
        )
    if row.scenario == "Full/trailing disagreement (first)":
        return full_mark == "full ≠ tail" and case.full_pass != case.tail_pass and not case.extended
    if row.scenario == "Disagreement/fail after extension":
        return full_mark == "full ≠ tail again" and case.full_pass != case.tail_pass and case.extended
    if row.scenario == "Non-convergence":
        return (
            mark_matches(full_mark, case.full_pass)
            and mark_matches(tail_mark, case.tail_pass)
            and mark_matches(convergence_mark, case.converged)
        )
    return False


def _reason_table_decision(row: ReasonTableRow) -> Decision:
    """Decode a §5.5 outcome using the frozen reason enum."""
    if row.outcome.startswith("ADOPT"):
        return Decision(Outcome.ADOPT)
    if row.outcome.startswith("Extend"):
        return Decision(Outcome.EXTEND)
    match = re.search(r"Reject\((\w+)\)", row.outcome)
    if match is None:
        raise ScheduleError(f"unsupported reason-table outcome {row.outcome!r}")
    try:
        reason = RejectReason(match.group(1))
    except ValueError as error:
        raise ScheduleError(f"unknown reason-table reason {match.group(1)!r}") from error
    return Decision(Outcome.REJECT, reason)


def ordered_welfare_decision(case: WelfareHurdleCase) -> Decision:
    """05 §5.4's normative `(all, disagreement, extended)` match arm."""
    if case.full_pass and case.tail_pass and case.converged:
        return Decision(Outcome.ADOPT)
    if case.full_pass != case.tail_pass:
        if case.extended:
            return Decision(Outcome.REJECT, RejectReason.SECOND_EXTENSION_FAILED)
        return Decision(Outcome.EXTEND)
    reason = (
        RejectReason.HURDLE_NOT_MET
        if case.converged
        else RejectReason.CONVERGENCE_FAILED
    )
    return Decision(Outcome.REJECT, reason)


@dataclass(frozen=True)
class TruthTableMismatch:
    """One reachable input where §5.5 disagrees with normative §5.4."""

    case: WelfareHurdleCase
    row: str
    table: Decision
    normative: Decision


@dataclass(frozen=True)
class ReasonTableAnalysis:
    """Coverage, uniqueness and §5.4 agreement over the 16 hurdle cases."""

    case_count: int
    uncovered: tuple[WelfareHurdleCase, ...]
    overlaps: tuple[tuple[WelfareHurdleCase, tuple[str, ...]], ...]
    nondeterministic: tuple[tuple[WelfareHurdleCase, tuple[Decision, ...]], ...]
    mismatches: tuple[TruthTableMismatch, ...]

    @property
    def total(self) -> bool:
        return not self.uncovered

    @property
    def non_overlapping(self) -> bool:
        return not self.overlaps

    @property
    def deterministic(self) -> bool:
        return not self.nondeterministic


def analyze_reason_table(repo_root: Path) -> ReasonTableAnalysis:
    """Execute §5.5's steps 6–8 partition and compare it with §5.4.

    This is the complete 2⁴ product for the welfare match arm, not a lattice
    enumeration of the full decision engine. Steps 1–5 have already passed;
    steps 9–11 are evaluated only after this arm proceeds.
    """
    rows = tuple(
        row for row in reason_table_rows(repo_root) if row.scenario in _WELFARE_SCENARIOS
    )
    cases = tuple(
        WelfareHurdleCase(*values) for values in product((False, True), repeat=4)
    )
    uncovered = []
    overlaps = []
    nondeterministic = []
    mismatches = []
    for case in cases:
        matches = tuple(row for row in rows if _welfare_row_matches(case, row))
        if not matches:
            uncovered.append(case)
            continue
        if len(matches) > 1:
            overlaps.append((case, tuple(row.scenario for row in matches)))
        decisions = tuple(dict.fromkeys(_reason_table_decision(row) for row in matches))
        if len(decisions) > 1:
            nondeterministic.append((case, decisions))
        if len(matches) == 1:
            table = decisions[0]
            normative = ordered_welfare_decision(case)
            if table != normative:
                mismatches.append(
                    TruthTableMismatch(case, matches[0].scenario, table, normative)
                )
    return ReasonTableAnalysis(
        case_count=len(cases),
        uncovered=tuple(uncovered),
        overlaps=tuple(overlaps),
        nondeterministic=tuple(nondeterministic),
        mismatches=tuple(mismatches),
    )
