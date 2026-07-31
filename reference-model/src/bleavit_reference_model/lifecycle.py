"""05 §2–§3 — the proposal state machine, the phase schedule, cohorts and snapshots.

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
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

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

EPOCH_LENGTH_DEFAULT = 302_400
EPOCH_LENGTH_MIN = 201_600  # 14 d floor, K
EPOCH_LENGTH_MAX = 604_800
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
