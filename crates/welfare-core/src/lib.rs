#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_fixed::FixedU64x64;
use futarchy_primitives::{
    metric_ids, EpochId, FixedU64, MetricId, MetricSpecVersion, WelfareView,
};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

macro_rules! ensure {
    ($cond:expr, $err:expr $(,)?) => {
        if !$cond {
            return Err($err);
        }
    };
}

pub mod normalization;

pub use normalization::{
    apply as apply_normalization, freeze_constants as freeze_normalization_constants, log1p,
    minmax, normalization_sample, normalize_metric, percentile, uses_log1p, winsorize,
    winsorize_value, NormalizationConstants, P_HIGH, P_LOW,
};

pub const ONE: u64 = 1_000_000_000;
pub const EPSILON: FixedU64 = FixedU64(1);
pub const EPSILON_PILLAR: FixedU64 = FixedU64(10_000_000);
pub const MAX_METRIC_SPECS: usize = 16;
/// Retained snapshot **epochs** — the bound 13 §4 states ("Snapshots: ≤ 20
/// epochs (H + challenge + 12)"). 05 §4.6 (SQ-200) fixes the prune cutoff at
/// `current − 19`, so the retained window is 19 historical epochs plus the
/// live one.
pub const SNAPSHOT_RETENTION_EPOCHS: usize = 20;
/// Distinct MetricSpec versions that can consume one measurement epoch.
///
/// Derived, not chosen: cohorts freeze their version at qualification (I-16),
/// an activation boundary can leave adjacent cohorts on different versions, so
/// the count is bounded by the cohorts consuming the epoch — `epoch.horizon_k`,
/// whose kernel ceiling is 2 (05 §3.3, SQ-496). Same factor as
/// `oracle_core::MAX_ROUNDS`'s and `registry_core::MAX_AGGREGATES`'s.
pub const MAX_CONCURRENT_FROZEN_VERSIONS: usize = 2;
/// Retained snapshot **records**.
///
/// 13 §4 bounds the retained window in *epochs*, but `Snapshots` is keyed
/// `(epoch, spec_version)` and capacity is enforced against the record count,
/// so the epoch bound has to carry 05 §3.3's version multiplicity to mean the
/// same thing. It did not: at a flat 20 the eviction rule (by epoch age, 19
/// retained + one spare slot) and the capacity rule (by record count)
/// disagreed, so an activation boundary produced more lawful records than
/// slots. A signed caller could then spend the spare slot on the in-flight
/// cohort's record before the keeper wrote the active-version one, at which
/// point `SnapshotDeadline` stopped advancing, the 05 §4.8 dead-man latched,
/// and the frozen epoch clock froze the prune cutoff that would have released
/// the slot — with no origin able to clear the flag (SQ-254).
///
/// **The multiplier is `k + 1`, not `k`.** `record_snapshot`'s admissible set
/// is `frozen_spec_versions(e) ∪ {active_snapshot_spec(e)}`, and the active
/// version need not be a member of the frozen set: `cohort_consumes_measurement`
/// admits exactly the cohorts created in `[e − k, e − 1]`, so their versions are
/// the ones active at `e − 1` and `e − 2` — a version activating at `e` itself
/// is a lawful third. Two `register_spec` calls activating in consecutive
/// epochs reach that state through the ordinary governance path, with no
/// attacker and no cadence rule to prevent it, and sizing at `× k` would have
/// re-created the same wedge one activation cadence later. The active-version
/// record cannot be dropped from the union instead: it is the only one
/// `note_snapshot_recorded` will advance `SnapshotDeadline` on, so refusing it
/// *is* the wedge.
pub const MAX_SNAPSHOTS: usize = SNAPSHOT_RETENTION_EPOCHS * (MAX_CONCURRENT_FROZEN_VERSIONS + 1);
/// Gate-breach flags are keyed by **epoch alone** (05 §4.7), so they take the
/// epoch bound and not the record bound. Formerly written as `MAX_SNAPSHOTS`,
/// which was numerically right only while that constant was itself an epoch
/// count.
pub const MAX_GATE_FLAGS: usize = SNAPSHOT_RETENTION_EPOCHS;
/// Number of day indices accepted by the daily-gate recorder. The two-word
/// frozen breach bitmap covers this whole range (05 §4.7).
pub const MAX_DAILY_GATE_SAMPLES: u8 = 64;
/// Full scale in basis points — the ceiling 05 §4.4 puts on
/// `delta_s_max_bps`, since `s` itself lives in [0, 1]. Narrowed from
/// `kernel::BASIS_POINTS_DENOMINATOR` so the bound check stays in `u32`.
pub const BPS_ONE: u32 = futarchy_primitives::kernel::BASIS_POINTS_DENOMINATOR as u32;
pub const MAX_COMPONENTS_PER_SPEC: usize = 16;
pub const HISTORY_PRIORS: usize = 12;
pub const THETA_S_LO: FixedU64 = FixedU64(900_000_000);
pub const THETA_S_HI: FixedU64 = FixedU64(980_000_000);
pub const THETA_C_LO: FixedU64 = FixedU64(850_000_000);
pub const THETA_C_HI: FixedU64 = FixedU64(950_000_000);
pub const W_P: FixedU64 = FixedU64(600_000_000);
pub const W_A: FixedU64 = FixedU64(400_000_000);

/// Live welfare tunables supplied by the constitution parameter registry.
///
/// The constants above remain the kernel-floor/default backstop used by the
/// independent core and reference vectors. Production runtimes pass the live
/// values into every operation that consumes a gate threshold or pillar
/// weight, preserving byte-identical behavior at [`Self::DEFAULT`].
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct WelfareParams {
    pub theta_s_lo: FixedU64,
    pub theta_s_hi: FixedU64,
    pub theta_c_lo: FixedU64,
    pub theta_c_hi: FixedU64,
    pub w_p: FixedU64,
    pub w_a: FixedU64,
}

impl WelfareParams {
    pub const DEFAULT: Self = Self {
        theta_s_lo: THETA_S_LO,
        theta_s_hi: THETA_S_HI,
        theta_c_lo: THETA_C_LO,
        theta_c_hi: THETA_C_HI,
        w_p: W_P,
        w_a: W_A,
    };

    /// Validate live tunables against their kernel floors and exact weight
    /// identity. Invalid live parameters fail before any state mutation.
    pub fn validate(&self) -> Result<(), Error> {
        ensure!(
            self.theta_s_lo.0 >= THETA_S_LO.0
                && self.theta_s_lo.0 < self.theta_s_hi.0
                && self.theta_s_hi.0 <= ONE
                && self.theta_c_lo.0 >= THETA_C_LO.0
                && self.theta_c_lo.0 < self.theta_c_hi.0
                && self.theta_c_hi.0 <= ONE,
            Error::ValueOutOfRange
        );
        ensure!(
            (300_000_000..=700_000_000).contains(&self.w_p.0)
                && (300_000_000..=700_000_000).contains(&self.w_a.0),
            Error::ValueOutOfRange
        );
        ensure!(
            self.w_p
                .0
                .checked_add(self.w_a.0)
                .is_some_and(|sum| sum == ONE),
            Error::BadWeightSum
        );
        Ok(())
    }

    /// Validate a **recorded** parameter set — one stored with a past snapshot
    /// and replayed by 07 §10's recompute — for the internal consistency its
    /// arithmetic needs, and nothing else.
    ///
    /// Deliberately *not* [`Self::validate`]. That check compares against the
    /// live kernel floors (`THETA_S_LO`, `THETA_C_LO`) and the 13 §1 band on the
    /// pillar weights, both of which a later CODE or META amendment may lawfully
    /// move. Applied to history, that turns a legal amendment into a wedge: a
    /// cohort in flight across it could never settle its recomputed window, and
    /// a `try-state` assertion over the same fields would halt the chain
    /// outright. The same reasoning the spec-coverage note in `try_state`
    /// records for 07 §6.3 — live rules do not bind stored records.
    pub fn validate_recorded(&self) -> Result<(), Error> {
        ensure!(
            self.theta_s_lo.0 < self.theta_s_hi.0
                && self.theta_s_hi.0 <= ONE
                && self.theta_c_lo.0 < self.theta_c_hi.0
                && self.theta_c_hi.0 <= ONE,
            Error::ValueOutOfRange
        );
        ensure!(
            self.w_p
                .0
                .checked_add(self.w_a.0)
                .is_some_and(|sum| sum == ONE),
            Error::BadWeightSum
        );
        Ok(())
    }
}

impl Default for WelfareParams {
    fn default() -> Self {
        Self::DEFAULT
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    Encode,
    Eq,
    MaxEncodedLen,
    Ord,
    PartialEq,
    PartialOrd,
    TypeInfo,
    DecodeWithMemTracking,
)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Pillar {
    S,
    COnchain,
    CAttested,
    P,
    A,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum SourceClass {
    Onchain,
    RelayDerived,
    Attested,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct MetricSpec {
    pub id: MetricId,
    pub version: MetricSpecVersion,
    pub pillar: Pillar,
    pub weight: FixedU64,
    pub epsilon_floor: FixedU64,
    pub activation_epoch: EpochId,
    pub source: SourceClass,
    pub formula_ref: [u8; 32],
    pub units: [u8; 16],
    pub repr: [u8; 16],
    pub cadence_blocks: u32,
    pub sanity_min: FixedU64,
    pub sanity_max: FixedU64,
    pub has_normalization_rule: bool,
    pub has_missing_data_rule: bool,
    pub has_gaming_vectors: bool,
    pub has_challenge_procedure: bool,
    pub prior_bounds: [FixedU64; HISTORY_PRIORS],
    /// The A-pillar milestone divisor of 05 §4.3's `min(1, points ÷ target)`,
    /// frozen per version so a live cohort's milestones can never be
    /// retroactively renormalized (I-16; 07 §7 *Milestone normalization*).
    /// Required strictly positive on the milestone component
    /// ([`metric_ids::A_SHIPPED_UPGRADES`]); ignored for every other component.
    /// Trailing field, contract v14 (SQ-175).
    pub target: u32,
    /// `Δs_max` — the documented maximum single-epoch settlement impact this
    /// component can move, in **basis points** of settlement score (05 §4.4;
    /// 07 §6.1 fixes the basis-point space). It is the right-hand side of
    /// 07 §6.3's admission rule `(2^R_max − 1) · orc.bond_bps ≥ Δs_max`, the
    /// rule that makes an attested lie cost more than it can move. Bound-checked
    /// to `0 < x ≤ 10_000` for an **attested** component only; recorded but
    /// unconsumed for source classes 1–3, which run no §5 game and so have no
    /// bond ladder to collateralize. Trailing field, contract v14 (SQ-341).
    pub delta_s_max_bps: u32,
}

// FRAME genesis configs are serde-backed (including in the no_std Wasm
// runtime, whose GenesisBuilder API builds genesis inside the blob). `FixedU64`
// is a shared no_std tuple type without a serde dependency, so serialize this
// one genesis carrier through its canonical 1e9-grid integer representation
// rather than forcing serde into `futarchy-primitives`. Gated on the `serde`
// feature (std implies it) so the pallet can enable it for no_std Wasm builds.
#[cfg(feature = "serde")]
#[derive(serde::Serialize, serde::Deserialize)]
struct MetricSpecSerde {
    id: MetricId,
    version: MetricSpecVersion,
    pillar: Pillar,
    weight: u64,
    epsilon_floor: u64,
    activation_epoch: EpochId,
    source: SourceClass,
    formula_ref: [u8; 32],
    units: [u8; 16],
    repr: [u8; 16],
    cadence_blocks: u32,
    sanity_min: u64,
    sanity_max: u64,
    has_normalization_rule: bool,
    has_missing_data_rule: bool,
    has_gaming_vectors: bool,
    has_challenge_procedure: bool,
    prior_bounds: [u64; HISTORY_PRIORS],
    target: u32,
    delta_s_max_bps: u32,
}

#[cfg(feature = "serde")]
impl serde::Serialize for MetricSpec {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        MetricSpecSerde {
            id: self.id,
            version: self.version,
            pillar: self.pillar,
            weight: self.weight.0,
            epsilon_floor: self.epsilon_floor.0,
            activation_epoch: self.activation_epoch,
            source: self.source,
            formula_ref: self.formula_ref,
            units: self.units,
            repr: self.repr,
            cadence_blocks: self.cadence_blocks,
            sanity_min: self.sanity_min.0,
            sanity_max: self.sanity_max.0,
            has_normalization_rule: self.has_normalization_rule,
            has_missing_data_rule: self.has_missing_data_rule,
            has_gaming_vectors: self.has_gaming_vectors,
            has_challenge_procedure: self.has_challenge_procedure,
            prior_bounds: self.prior_bounds.map(|value| value.0),
            target: self.target,
            delta_s_max_bps: self.delta_s_max_bps,
        }
        .serialize(serializer)
    }
}

#[cfg(feature = "serde")]
impl<'de> serde::Deserialize<'de> for MetricSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let spec = MetricSpecSerde::deserialize(deserializer)?;
        Ok(Self {
            id: spec.id,
            version: spec.version,
            pillar: spec.pillar,
            weight: FixedU64(spec.weight),
            epsilon_floor: FixedU64(spec.epsilon_floor),
            activation_epoch: spec.activation_epoch,
            source: spec.source,
            formula_ref: spec.formula_ref,
            units: spec.units,
            repr: spec.repr,
            cadence_blocks: spec.cadence_blocks,
            sanity_min: FixedU64(spec.sanity_min),
            sanity_max: FixedU64(spec.sanity_max),
            has_normalization_rule: spec.has_normalization_rule,
            has_missing_data_rule: spec.has_missing_data_rule,
            has_gaming_vectors: spec.has_gaming_vectors,
            has_challenge_procedure: spec.has_challenge_procedure,
            prior_bounds: spec.prior_bounds.map(FixedU64),
            target: spec.target,
            delta_s_max_bps: spec.delta_s_max_bps,
        })
    }
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct ComponentValue {
    pub id: MetricId,
    pub value: FixedU64,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct Snapshot {
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
    pub s_pillar: FixedU64,
    pub c_onchain: FixedU64,
    pub c_attested: FixedU64,
    pub p_pillar: FixedU64,
    pub a_pillar: FixedU64,
    pub gate_s: FixedU64,
    pub gate_c: FixedU64,
    pub welfare: FixedU64,
    pub components: Vec<ComponentValue>,
}

/// The per-snapshot settlement context 07 §10's renormalization needs.
///
/// Kept **beside** [`Snapshot`] rather than inside it because `Snapshots` is a
/// frozen 02 §7.4 frontend read surface: widening the value shape (or widening
/// [`ComponentValue`] with a `flagged` bit) would move the contract for data no
/// frontend consumes. The 07 §10 recompute is settlement-time and pallet-
/// internal, so its inputs are too.
///
/// Both fields are recorded *when observed* rather than derived later, which is
/// the [`crate`]-wide lesson of 05 §4.4's own two-consecutive-carried-epochs
/// rule (`epoch-core`'s `baseline_carry`): the oracle's flagged
/// `ComponentValues` history is reaped on an epoch cutoff (07 §13), so a
/// settlement that re-derived consecutiveness from it would be reading state
/// that may legitimately be gone.
#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct SnapshotContext {
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
    /// The components whose settled value for this `(epoch, version)` is a
    /// **flagged carry-last** (07 §10). Ascending `MetricId`, deduplicated.
    /// Only an attested component can appear: 07 §11(1) consequence (i) makes
    /// class-4 components the only reportable — hence the only flaggable — ones.
    pub flagged: Vec<MetricId>,
    /// The `I_e` incident multiplier this snapshot's `C_e` was computed with
    /// (05 §4.4). Stored because the recompute needs it and the snapshot keeps
    /// it only *folded into* `c_attested`/`c_settlement`; recovering it as
    /// `c_settlement ÷ c_joint` would be a lossy division in an unaudited
    /// direction.
    pub incident_multiplier: FixedU64,
    /// The live tunables this snapshot's `W` was evaluated under.
    ///
    /// Stored so the 07 §10 recompute differs from the recorded `W` in exactly
    /// one respect — the dropped components — and never in a gate threshold or
    /// pillar weight that governance lawfully amended in between. Re-reading
    /// live `Params` at settlement would silently re-price an already-measured
    /// epoch, which is the I-16 freeze applied to the values layer.
    pub params: WelfareParams,
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct GateBreachFlags {
    pub s_breached: bool,
    pub c_breached: bool,
    pub day_bitmap: [u32; 2],
}

// Not `Copy`/`MaxEncodedLen`: `SettlementRenormalized` names the dropped
// components, and the bound on that list belongs to the pallet's `BoundedVec`
// mirror (`MAX_COMPONENTS_PER_SPEC`), not to this frame-free core.
#[derive(Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, PartialEq, TypeInfo)]
pub enum Event {
    MetricSpecRegistered {
        version: MetricSpecVersion,
    },
    SnapshotRecorded {
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        welfare: FixedU64,
    },
    GateBreachRecorded {
        epoch: EpochId,
        day: u8,
        s_breached: bool,
        c_breached: bool,
    },
    SettlementComputed {
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        score: FixedU64,
    },
    /// 07 §10: this cohort's `W` was recomputed without `dropped`, whose
    /// components were flagged in two consecutive epochs of its measurement
    /// window, with the surviving weights renormalized. Emitted only when the
    /// set is non-empty, immediately before [`Event::SettlementComputed`], so a
    /// score that does not match the geometric mean of the two published
    /// `Snapshots.welfare` values always carries its reason.
    SettlementRenormalized {
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        dropped: Vec<MetricId>,
    },
}

#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub enum Error {
    BadOrigin,
    TooManyMetricSpecs,
    TooManySnapshots,
    TooManyComponents,
    TooManyGateFlags,
    DuplicateSpecVersion,
    SpecNotFound,
    BadActivationEpoch,
    SpecNotActive,
    MissingMetricDiscipline,
    BadEpsilonFloor,
    BadSourceClass,
    BadWeightSum,
    ValueOutOfRange,
    MissingComponent,
    DuplicateComponent,
    DuplicateSnapshot,
    ArithmeticOverflow,
    TryStateViolation,
    /// A cohort's gate window contains an epoch with **no** recorded daily
    /// observation at all (05 §4.7, SQ-79). A zero-sample window is an
    /// unavailable gate input, not evidence of no breach.
    GateWindowUnsampled,
    /// The A-pillar milestone component declares no positive `target`, so
    /// 05 §4.3's `min(1, points ÷ target)` has no defined value (07 §7
    /// *Milestone normalization*). Named to match the registry's error for the
    /// same fact, which is the downstream half of one rule. Trailing variant.
    MilestoneTargetUnset,
    /// An **attested** component's `delta_s_max_bps` is outside `(0, 10_000]`
    /// (05 §4.4). Zero would assert the component cannot move settlement at
    /// all, which no attested component can truthfully claim; above 10,000
    /// exceeds the range of `s` itself. Trailing variant.
    BadDeltaSMax,
    /// The spec declares an attested component but 07 §2(5)'s seats are not
    /// filled — fewer than `orc.n_min` registered reporters or fewer than
    /// `wt.quorum` registered watchtowers. Trailing variant.
    InsufficientOracleSeats,
    /// The live bond ladder does not cover an attested component's declared
    /// `Δs_max`: 07 §6.3's `(2^R_max − 1) · orc.bond_bps ≥ Δs_max` fails, so a
    /// lie about this component would cost less than it can move. Also returned
    /// when the ladder itself is unreadable, which is the fail-closed direction
    /// for admission. Trailing variant.
    BondCoverageUnmet,
    /// A snapshot was offered a flagged component that is not an **attested**
    /// component of its own spec version (07 §10; §11(1) consequence (i)).
    /// Only class-4 components are reportable, so only they can be absent at
    /// the money deadline and carry a flagged epoch — a flag on anything else
    /// would feed 07 §10's renormalization with a value the oracle never owned.
    /// Trailing variant.
    BadFlaggedComponent,
    /// A snapshot exists with no [`SnapshotContext`] beside it, so 07 §10's
    /// consecutiveness cannot be evaluated for the epochs it covers. Recording
    /// writes the pair atomically and pruning retires it atomically, so this is
    /// a corrupted-state signal, not a reachable path. Trailing variant.
    MissingSnapshotContext,
    /// A 05 §4.6 percentile was asked of an empty sample. Unreachable through
    /// the 12-element `prior_bounds ++ finalized` assembly, which is total by
    /// construction; the variant exists so the kernel's percentile is total for
    /// every caller rather than only for its own. Trailing variant.
    EmptyNormalizationSample,
    /// The 05 §4.6 min–max range is zero-width (`p95 ≤ p5` after the optional
    /// `log1p`), so the series has no map onto [0,1]. Refused rather than
    /// resolved: the adopt-favourable convention (1.0) would hand a pillar a
    /// perfect component computed from a series that never moved, which is the
    /// opposite of the status-quo default (G-1). Trailing variant.
    DegenerateNormalizationRange,
    /// The named version is activated by the epoch but is not one the epoch
    /// may be measured under: for a snapshot, outside the epoch's admissible
    /// set (its active spec ∪ the versions live cohorts froze for it, I-16);
    /// for a daily gate, not the epoch's active spec at all. Trailing variant.
    SpecVersionNotAdmissible,
}

/// The 07 §2(5) admission inputs that [`WelfareState::register_metric_spec`]
/// cannot see for itself: this crate is frame-free and owns neither oracle
/// state nor constitution parameters. Injected by the caller so the genesis
/// build and a live `register_spec` dispatch take the identical path — the
/// SQ-82 discipline applied to a second ambient dependency.
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    Eq,
    MaxEncodedLen,
    PartialEq,
    TypeInfo,
)]
pub struct AttestedAdmission {
    /// Registered reporters **still holding a full stake** (07 §3). A reporter
    /// slashed to half stake on a second adjudicated-false report stays
    /// registered, so a count of registered seats over-states this.
    pub reporters: u32,
    /// Registered watchtowers (07 §4).
    pub watchtowers: u32,
    /// Live `orc.n_min` — the reporter floor 07 §2(5)/§3 require before any
    /// attested component may be admitted (13 §1; K floor 3).
    pub reporter_min: u32,
    /// Live `wt.quorum` — the watchtower floor of the same rule (13 §1; K floor
    /// 2, which is the "≥ 2 registered watchtowers" 07 §2(5) states).
    pub watchtower_min: u32,
    /// `(2^orc.rounds − 1) · orc.bond_bps`, from `oracle_core::coverage_bps`.
    /// `None` means the live ladder is unreadable, and **no attested component
    /// is then admissible** — the opposite direction the registry's filing-bond
    /// pricing takes on the same input, and the fail-closed one here: admitting
    /// against an unknown ladder is what 07 §6.3 exists to prevent.
    pub coverage_bps: Option<u32>,
}

impl AttestedAdmission {
    /// A context under which no attested component can be admitted. Used by
    /// callers that have no oracle to consult; never a default, because
    /// silently admitting is the failure this type exists to prevent.
    pub const CLOSED: Self = Self {
        reporters: 0,
        watchtowers: 0,
        reporter_min: u32::MAX,
        watchtower_min: u32::MAX,
        coverage_bps: None,
    };
}

/// Explicit registration context for [`WelfareState::register_metric_spec`]
/// (05 §4.4/§4.6; SQ-82).
///
/// The `>= current + 2` activation lead exists to protect in-flight cohorts
/// (I-16), of which there are none at genesis — so a genesis registration may
/// activate at epoch 1 and keep welfare computable from epoch 1 (the §4.6 cold
/// start). Which of the two regimes applies is supplied by the caller rather
/// than inferred from an ambient `current_epoch == 0`: that sentinel cannot
/// distinguish "this is the genesis build" from "the epoch clock has not been
/// set yet", so a live registration observed against an unset clock would
/// silently inherit the genesis relaxation and activate one epoch early.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Registration {
    /// The genesis build. No cohort can be in flight, so the lead is one epoch.
    Genesis,
    /// A live `register_spec` dispatch, carrying the observed epoch clock.
    Live { current_epoch: EpochId },
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct WelfareState {
    pub specs: Vec<(MetricSpecVersion, Vec<MetricSpec>)>,
    pub snapshots: Vec<Snapshot>,
    /// One record per snapshot, carrying the 07 §10 inputs the frozen 02 §7.4
    /// `Snapshots` shape deliberately does not: see [`SnapshotContext`].
    pub snapshot_contexts: Vec<SnapshotContext>,
    pub gate_flags: Vec<(EpochId, GateBreachFlags)>,
    pub events: Vec<Event>,
}

impl Default for WelfareState {
    fn default() -> Self {
        Self::new()
    }
}

impl WelfareState {
    pub const fn new() -> Self {
        Self {
            specs: Vec::new(),
            snapshots: Vec::new(),
            snapshot_contexts: Vec::new(),
            gate_flags: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn register_metric_spec(
        &mut self,
        registration: Registration,
        version: MetricSpecVersion,
        mut specs: Vec<MetricSpec>,
        admission: &AttestedAdmission,
    ) -> Result<(), Error> {
        ensure!(
            self.specs.len() < MAX_METRIC_SPECS,
            Error::TooManyMetricSpecs
        );
        ensure!(
            self.specs.iter().all(|(v, _)| *v != version),
            Error::DuplicateSpecVersion
        );
        ensure!(
            !specs.is_empty() && specs.len() <= MAX_COMPONENTS_PER_SPEC,
            Error::TooManyComponents
        );
        specs.sort_by_key(|s| s.id);
        // Activation lead time (05 §4.4/§4.6). The genesis regime is now carried
        // by an explicit `Registration` rather than inferred from an ambient
        // `current_epoch == 0` (SQ-82): the sentinel conflated "genesis build"
        // with "epoch clock not yet set", so a *live* registration observed
        // against a zero clock inherited the genesis relaxation and could
        // activate one epoch early, past the I-16 in-flight-cohort guard.
        // `checked_add` (not saturating) so a registration near `EpochId::MAX`
        // cannot bypass the lead time by saturating `current + 2` down to
        // `MAX` (G-1; final review 2026-07-16).
        let min_activation = match registration {
            Registration::Genesis => 1,
            Registration::Live { current_epoch } => current_epoch
                .checked_add(2)
                .ok_or(Error::BadActivationEpoch)?,
        };
        let mut prev = None;
        for spec in &specs {
            ensure!(spec.version == version, Error::SpecNotFound);
            ensure!(
                spec.activation_epoch >= min_activation,
                Error::BadActivationEpoch
            );
            ensure!(
                spec.weight.0 <= ONE
                    && spec.sanity_min.0 <= spec.sanity_max.0
                    && spec.sanity_max.0 <= ONE,
                Error::ValueOutOfRange
            );
            ensure!(spec.epsilon_floor == EPSILON_PILLAR, Error::BadEpsilonFloor);
            ensure!(source_matches_pillar(spec), Error::BadSourceClass);
            ensure!(
                spec.has_normalization_rule
                    && spec.has_missing_data_rule
                    && spec.has_gaming_vectors
                    && spec.has_challenge_procedure,
                Error::MissingMetricDiscipline
            );
            ensure!(
                prev.replace(spec.id).is_none_or(|p| p < spec.id),
                Error::DuplicateComponent
            );
            // 05 §4.4 / 07 §7: the milestone component's divisor must exist
            // before the MilestoneRegistry can normalize anything against it.
            // A zero target is not "no milestones" — it makes `points ÷ target`
            // undefined, and the registry's own rule refuses to fabricate 0.0
            // in its place (SQ-291). Checked here, at the only place the frozen
            // value is ever written (SQ-175).
            ensure!(
                spec.id != metric_ids::A_SHIPPED_UPGRADES || spec.target > 0,
                Error::MilestoneTargetUnset
            );
            // 05 §4.4: `Δs_max` is mandatory on every component but bound-checked
            // for attested ones only — classes 1–3 run no §5 game, so there is
            // no bond ladder to collateralize them against and no rule the value
            // would feed.
            if spec.source == SourceClass::Attested {
                ensure!(
                    spec.delta_s_max_bps > 0 && spec.delta_s_max_bps <= BPS_ONE,
                    Error::BadDeltaSMax
                );
                // 07 §6.3's coverage rule, evaluated against the **live**
                // parameters (SQ-341): the whole ladder must be worth more than
                // the maximum settlement impact a lie about this component could
                // move. The 10.5% figure §6.3 quotes describes `R_max = 3` only
                // and MUST NOT be hardcoded — `orc.rounds ∈ [2, 4]`, and at
                // `(2, 150)` coverage is 450 bps.
                ensure!(
                    admission
                        .coverage_bps
                        .is_some_and(|cov| cov >= spec.delta_s_max_bps),
                    Error::BondCoverageUnmet
                );
            }
        }
        // 07 §2(5)'s other half, enforced for the first time: an attested
        // component may not be admitted until the reporter and watchtower seats
        // that make its game adjudicable are actually filled. Evaluated once
        // over the whole spec set rather than per component, because the seats
        // are shared by every attested component in it.
        //
        // Deliberately gated on the spec set *containing* an attested component:
        // a purely on-chain spec runs no oracle game, so requiring oracle seats
        // for it would refuse registration for a reason 07 §2(5) does not state
        // — and would make the chain's first, necessarily on-chain, MetricSpec
        // unregistrable.
        if specs
            .iter()
            .any(|spec| spec.source == SourceClass::Attested)
        {
            ensure!(
                admission.reporters >= admission.reporter_min
                    && admission.watchtowers >= admission.watchtower_min,
                Error::InsufficientOracleSeats
            );
        }
        // 05 §4.4: every weight vector sums to 1 exactly, checked here. S is
        // min-aggregated (no weights); the C vector is one vector across
        // C_onchain and C_attested jointly - C_daily then renormalizes over
        // the on-chain subset, which is only meaningful for a joint vector.
        let weight_sum = |pillars: &[Pillar]| -> Result<u64, Error> {
            specs
                .iter()
                .filter(|s| pillars.contains(&s.pillar))
                .try_fold(0u64, |acc, s| {
                    acc.checked_add(s.weight.0).ok_or(Error::ArithmeticOverflow)
                })
        };
        ensure!(
            weight_sum(&[Pillar::COnchain, Pillar::CAttested])? == ONE,
            Error::BadWeightSum
        );
        ensure!(weight_sum(&[Pillar::P])? == ONE, Error::BadWeightSum);
        ensure!(weight_sum(&[Pillar::A])? == ONE, Error::BadWeightSum);
        // 05 §4.6 / I-16 select the active spec as "the unique version with the
        // latest activation epoch"; a tie means **no active spec**, permanently,
        // for every epoch from that activation onward. That fail-closed reading is
        // correct — but nothing stopped two lawful registrations from creating the
        // tie, and once created there is no re-derivation path: `active_spec`
        // returns `None` forever, so no snapshot can advance `SnapshotDeadline`,
        // the dead-man's snapshot-overdue cause latches, and the deadline's
        // try-state pairing fails once the wedged epoch's timing is reaped.
        //
        // Admission control is the repair: refuse the *second* registration that
        // would tie, so the ambiguity branch below stays unreachable by
        // construction while remaining as defense in depth. Refusing (rather than
        // silently ordering the tie) is the G-1 direction — governance re-submits
        // one epoch over (audit 2026-07-27, AUD-4).
        let incoming_activation = specs.iter().map(|s| s.activation_epoch).max();
        if let Some(incoming) = incoming_activation {
            ensure!(
                !self.specs.iter().any(|(_, existing)| {
                    existing.iter().map(|s| s.activation_epoch).max() == Some(incoming)
                }),
                Error::BadActivationEpoch
            );
        }
        self.specs.push((version, specs));
        self.events.push(Event::MetricSpecRegistered { version });
        Ok(())
    }

    /// Record epoch `epoch`'s snapshot under `spec_version`.
    ///
    /// `flagged` carries the 07 §10 flag bits the oracle settled for this
    /// `(epoch, version)` — the components whose value here is a carry-last, not
    /// a fresh measurement. They do **not** change this snapshot's `W`: §10
    /// grants a single flagged epoch the carried value and only a *second
    /// consecutive* one drops the component, which is a per-cohort fact resolved
    /// in [`Self::compute_settlement`]. Recording them is what makes that
    /// resolution possible without re-reading reapable oracle history.
    /// `admissible` is the epoch's admissible version set — its active spec
    /// plus every version a live cohort froze for it (I-16). Supplied by the
    /// caller because both halves are runtime state this crate does not hold.
    ///
    /// Checked *after* `SpecNotFound`/`SpecNotActive` so the precise error
    /// survives, and *before* any capacity accounting: "activated by `epoch`"
    /// is strictly weaker than "measurable at `epoch`", and admitting the
    /// difference let a caller spend the epoch's single spare snapshot slot on
    /// a record no consumer reads.
    // Eight arguments, one past clippy's threshold. A parameter struct would
    // hide the very thing the extra argument exists to make explicit: the
    // admissible set is *caller-supplied runtime state*, not something this
    // frame-free crate can derive. Keeping it in the signature is what stops a
    // caller from forgetting it.
    #[allow(clippy::too_many_arguments)]
    pub fn record_snapshot(
        &mut self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        admissible: &[MetricSpecVersion],
        components: Vec<ComponentValue>,
        incident_multiplier: FixedU64,
        flagged: Vec<MetricId>,
        params: &WelfareParams,
    ) -> Result<FixedU64, Error> {
        params.validate()?;
        let specs = self.spec(spec_version)?.to_vec();
        ensure!(
            specs.iter().all(|spec| spec.activation_epoch <= epoch),
            Error::SpecNotActive
        );
        ensure!(
            admissible.contains(&spec_version),
            Error::SpecVersionNotAdmissible
        );
        ensure!(
            self.snapshots.len() < MAX_SNAPSHOTS,
            Error::TooManySnapshots
        );
        ensure!(
            components.len() <= MAX_COMPONENTS_PER_SPEC,
            Error::TooManyComponents
        );
        ensure!(incident_multiplier.0 <= ONE, Error::ValueOutOfRange);
        ensure!(
            self.snapshots
                .iter()
                .all(|s| s.epoch != epoch || s.spec_version != spec_version),
            Error::DuplicateSnapshot
        );
        let flagged = normalized_flags(&specs, flagged)?;
        let pillars = compute_pillars(&specs, &components, incident_multiplier)?;
        let welfare = compute_welfare(
            pillars.s,
            pillars.c_settlement,
            pillars.p,
            pillars.a,
            params,
        )?;
        self.snapshots.push(Snapshot {
            epoch,
            spec_version,
            s_pillar: pillars.s,
            c_onchain: pillars.c_onchain,
            c_attested: pillars.c_attested,
            p_pillar: pillars.p,
            a_pillar: pillars.a,
            gate_s: gate(pillars.s, params.theta_s_lo, params.theta_s_hi)?,
            gate_c: gate(pillars.c_settlement, params.theta_c_lo, params.theta_c_hi)?,
            welfare,
            components,
        });
        self.snapshot_contexts.push(SnapshotContext {
            epoch,
            spec_version,
            flagged,
            incident_multiplier,
            params: *params,
        });
        self.events.push(Event::SnapshotRecorded {
            epoch,
            spec_version,
            welfare,
        });
        Ok(welfare)
    }

    /// `active` is the epoch's **active** spec version (05 §4.6 / I-16), not
    /// the wider admissible set [`Self::record_snapshot`] takes.
    /// `GateBreachFlags` is keyed by epoch alone, OR-merged, never cleared and
    /// is 05 §4.7's sole settlement source for gate markets — a
    /// version-independent flag admits exactly one version, or a caller picks
    /// whichever lawfully registered version aggregates lower.
    pub fn record_daily_gate(
        &mut self,
        epoch: EpochId,
        day: u8,
        spec_version: MetricSpecVersion,
        active: Option<MetricSpecVersion>,
        components: Vec<ComponentValue>,
        params: &WelfareParams,
    ) -> Result<(GateBreachFlags, bool), Error> {
        params.validate()?;
        let specs = self.spec(spec_version)?.to_vec();
        ensure!(
            specs.iter().all(|spec| spec.activation_epoch <= epoch),
            Error::SpecNotActive
        );
        ensure!(
            active == Some(spec_version),
            Error::SpecVersionNotAdmissible
        );
        ensure!(day < MAX_DAILY_GATE_SAMPLES, Error::ValueOutOfRange);
        ensure!(
            components.len() <= MAX_COMPONENTS_PER_SPEC,
            Error::TooManyComponents
        );
        let (s_daily, c_daily) = compute_daily_gates(&specs, &components)?;
        let s_breach = s_daily.0 < params.theta_s_lo.0;
        let c_breach = c_daily.0 < params.theta_c_lo.0;
        let idx = self.gate_flags.iter().position(|(e, _)| *e == epoch);
        let mut flags = idx
            .map(|i| self.gate_flags[i].1)
            .unwrap_or(GateBreachFlags {
                s_breached: false,
                c_breached: false,
                day_bitmap: [0; 2],
            });
        let before = flags;
        // Frozen 02 §7.4 / 05 §4.7 semantics: this bitmap identifies
        // breached days only. Pallet-internal sample tracking must not reuse it.
        if s_breach || c_breach {
            let word = flags
                .day_bitmap
                .get_mut(usize::from(day / 32))
                .ok_or(Error::ValueOutOfRange)?;
            *word |= 1u32 << (day % 32);
        }
        flags.s_breached |= s_breach;
        flags.c_breached |= c_breach;
        let changed = flags != before;
        if let Some(i) = idx {
            self.gate_flags[i].1 = flags;
        } else {
            ensure!(
                self.gate_flags.len() < MAX_GATE_FLAGS,
                Error::TooManyGateFlags
            );
            self.gate_flags.push((epoch, flags));
        }
        self.events.push(Event::GateBreachRecorded {
            epoch,
            day,
            s_breached: s_breach,
            c_breached: c_breach,
        });
        Ok((flags, changed))
    }

    pub fn compute_settlement(
        &mut self,
        cohort_epoch: EpochId,
        spec_version: MetricSpecVersion,
    ) -> Result<FixedU64, Error> {
        let first_epoch = cohort_epoch
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let second_epoch = cohort_epoch
            .checked_add(2)
            .ok_or(Error::ArithmeticOverflow)?;
        // 07 §10: a component flagged in two consecutive epochs of the window
        // this cohort consumes stops voting; the surviving weights renormalize.
        let dropped = self.twice_flagged(cohort_epoch, spec_version)?;
        let w1 = self.settlement_welfare(first_epoch, spec_version, &dropped)?;
        let w2 = self.settlement_welfare(second_epoch, spec_version, &dropped)?;
        let score = settlement_score(w1, w2)?;
        if !dropped.is_empty() {
            self.events.push(Event::SettlementRenormalized {
                epoch: cohort_epoch,
                spec_version,
                dropped,
            });
        }
        self.events.push(Event::SettlementComputed {
            epoch: cohort_epoch,
            spec_version,
            score,
        });
        Ok(score)
    }

    /// The 07 §10 drop set for a cohort at `cohort_epoch`: every component
    /// flagged in **two consecutive epochs** that meet inside the cohort's
    /// measurement window `{e+1, e+2}` — i.e. flagged at `(e, e+1)` or at
    /// `(e+1, e+2)`.
    ///
    /// Three properties of this reading are deliberate.
    ///
    /// 1. **Cohort-scoped, not epoch-scoped.** §10 drops the component from
    ///    "affected not-yet-settled cohorts", so the streak is evaluated against
    ///    the window and applied to *both* of its epochs. Two cohorts sharing an
    ///    epoch can therefore weigh it differently, which is exactly why §10
    ///    makes this a settlement-time operation instead of folding it into the
    ///    recorded `W`.
    /// 2. **`e` participates, `e+3` does not.** The streak that condemns a
    ///    component may begin one epoch before the window; a streak beginning at
    ///    `e+2` is not yet two epochs long inside it. `e`'s snapshot is the
    ///    cohort's own creation epoch, so its flags are already settled history
    ///    by the time the cohort settles at `e+2`'s Housekeeping.
    /// 3. **An absent record is not a flagged epoch.** A version's first live
    ///    epoch has no predecessor at that version, so no streak is observable
    ///    there — and §10 grants a single flagged epoch its carried value
    ///    anyway. The failure keeps voting for at most one extra epoch at an
    ///    activation boundary, after which the streak is fully inside the
    ///    version and observed exactly.
    fn twice_flagged(
        &self,
        cohort_epoch: EpochId,
        spec_version: MetricSpecVersion,
    ) -> Result<Vec<MetricId>, Error> {
        let first_epoch = cohort_epoch
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let second_epoch = cohort_epoch
            .checked_add(2)
            .ok_or(Error::ArithmeticOverflow)?;
        let before = self.flagged_at(cohort_epoch, spec_version);
        let first = self.flagged_at(first_epoch, spec_version);
        let second = self.flagged_at(second_epoch, spec_version);
        let mut dropped = first
            .iter()
            .filter(|id| before.contains(id) || second.contains(id))
            .copied()
            .collect::<Vec<_>>();
        dropped.sort_unstable();
        dropped.dedup();
        Ok(dropped)
    }

    /// The flagged set recorded for `(epoch, version)`, or empty when no
    /// snapshot covers it (see `twice_flagged` property 3).
    fn flagged_at(&self, epoch: EpochId, version: MetricSpecVersion) -> &[MetricId] {
        self.snapshot_contexts
            .iter()
            .find(|context| context.epoch == epoch && context.spec_version == version)
            .map(|context| context.flagged.as_slice())
            .unwrap_or_default()
    }

    /// One epoch's contribution to a cohort's settlement score: the recorded
    /// `W` when nothing is dropped, else 07 §10's recompute over the surviving
    /// components with renormalized weights.
    ///
    /// The recompute reads the snapshot's own stored components, incident
    /// multiplier and tunables, so it reproduces the recorded evaluation in
    /// every respect but the drop — no live re-read can move it.
    fn settlement_welfare(
        &self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        dropped: &[MetricId],
    ) -> Result<FixedU64, Error> {
        let snapshot = self.snapshot(epoch, spec_version)?;
        if dropped.is_empty() {
            return Ok(snapshot.welfare);
        }
        let context = self
            .snapshot_contexts
            .iter()
            .find(|context| context.epoch == epoch && context.spec_version == spec_version)
            .ok_or(Error::MissingSnapshotContext)?;
        // Unreachable while the pallet retires no spec version (I-16 retains a
        // version for as long as a cohort can still settle on it), and
        // deliberately fail-soft rather than fatal if that ever changes:
        // a settlement that cannot be recomputed must still settle on the
        // recorded measurement. Wedging the cohort would strand every holder in
        // it, which is a strictly worse outcome than one epoch of a carried
        // value continuing to vote.
        let Ok(specs) = self.spec(spec_version) else {
            return Ok(snapshot.welfare);
        };
        renormalized_welfare(
            specs,
            &snapshot.components,
            context.incident_multiplier,
            dropped,
            &context.params,
        )
    }

    pub fn current_view(
        &self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        reserve_flag: bool,
    ) -> Result<WelfareView, Error> {
        let s = self.snapshot(epoch, spec_version)?;
        let flags = self.gate_breach(epoch);
        Ok(WelfareView {
            epoch,
            spec_version,
            s_pillar_1e9: s.s_pillar,
            c_onchain_1e9: s.c_onchain,
            c_attested_1e9: s.c_attested,
            p_pillar_1e9: s.p_pillar,
            a_pillar_1e9: s.a_pillar,
            gate_s_1e9: s.gate_s,
            gate_c_1e9: s.gate_c,
            w_current_1e9: s.welfare,
            s_breached: flags.s_breached,
            c_breached: flags.c_breached,
            reserve_flag,
            active_spec_available: true,
        })
    }

    /// Daily gate-breach flags recorded for `epoch` (05 §4.7). Absent epochs read
    /// as unbreached — the deterministic default before any daily counter lands.
    ///
    /// This is a **display/view** accessor (it backs the 02 §4 `WelfareView`
    /// breach flags) and deliberately keeps the permissive default so a
    /// not-yet-sampled current epoch renders as "no breach so far" rather than
    /// erroring. Gate-market *settlement* must not use it — see
    /// [`Self::gate_window_outcomes`], which refuses a zero-sample window.
    pub fn gate_breach(&self, epoch: EpochId) -> GateBreachFlags {
        self.gate_flags
            .iter()
            .find(|(e, _)| *e == epoch)
            .map(|(_, f)| *f)
            .unwrap_or(GateBreachFlags {
                s_breached: false,
                c_breached: false,
                day_bitmap: [0; 2],
            })
    }

    /// Whether `epoch` carries at least one recorded daily gate observation.
    ///
    /// `record_daily_gate` pushes a `gate_flags` entry on the first successful
    /// recording *whether or not that day breached*, so entry presence is
    /// exactly "this epoch was sampled at least once". The breach `day_bitmap`
    /// stays a breached-days-only map (05 §4.7) and is not consulted here.
    pub fn gate_window_sampled(&self, epoch: EpochId) -> bool {
        self.gate_flags.iter().any(|(e, _)| *e == epoch)
    }

    /// Resolve the `(s_breached, c_breached)` gate outcomes for cohort
    /// `cohort_epoch` over its measurement window e+1…e+2 (05 §4.7, §7).
    ///
    /// **A zero-sample epoch in the window is an unavailable gate input and is
    /// refused (05 §4.7; SQ-79 ruling).** The permissive default of
    /// [`Self::gate_breach`] would otherwise settle gate markets at "no breach"
    /// on a window with no observations at all — an adopt-favourable claim paid
    /// out of absent data, which is the opposite of G-1. Refusing leaves
    /// settlement at the status quo; the affected cohort takes doc 07 §10's
    /// fail-static VOID ("if the failed component is a gate input, affected
    /// cohorts VOID") through the existing VoidAuthority path.
    ///
    /// *Partial* coverage is deliberately **not** classified here: 05 §4.7
    /// declares no expected-day count, so any completeness threshold would be a
    /// values call rather than a spec reading (SQ-79 leaves it open).
    pub fn gate_window_outcomes(&self, cohort_epoch: EpochId) -> Result<(bool, bool), Error> {
        let first_epoch = cohort_epoch
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let second_epoch = cohort_epoch
            .checked_add(2)
            .ok_or(Error::ArithmeticOverflow)?;
        ensure!(
            self.gate_window_sampled(first_epoch) && self.gate_window_sampled(second_epoch),
            Error::GateWindowUnsampled
        );
        let first = self.gate_breach(first_epoch);
        let second = self.gate_breach(second_epoch);
        Ok((
            first.s_breached || second.s_breached,
            first.c_breached || second.c_breached,
        ))
    }

    /// Remove finalized rolling-window data older than `cutoff_epoch`.
    /// Metric-spec versions remain until their independent in-flight-cohort
    /// retention rule permits pruning.
    pub fn prune_before(&mut self, cutoff_epoch: EpochId) {
        self.snapshots
            .retain(|snapshot| snapshot.epoch >= cutoff_epoch);
        // Retired in lockstep with the snapshots they annotate: the try-state
        // pairing is what lets `compute_settlement` treat a missing context as
        // corruption rather than as "not flagged" (07 §10).
        self.snapshot_contexts
            .retain(|context| context.epoch >= cutoff_epoch);
        self.gate_flags.retain(|(epoch, _)| *epoch >= cutoff_epoch);
    }

    pub fn try_state(&self) -> Result<(), Error> {
        ensure!(
            self.specs.len() <= MAX_METRIC_SPECS
                && self.snapshots.len() <= MAX_SNAPSHOTS
                && self.gate_flags.len() <= MAX_GATE_FLAGS,
            Error::TryStateViolation
        );
        for (index, (version, specs)) in self.specs.iter().enumerate() {
            ensure!(
                self.specs[..index].iter().all(|(seen, _)| seen != version),
                Error::TryStateViolation
            );
            // 05 §4.6 / I-16: two versions sharing a maximum activation epoch make
            // the active spec permanently unresolvable from that epoch onward,
            // which wedges `SnapshotDeadline` and latches the 05 §4.8 dead-man.
            // `register_metric_spec` refuses to create one, but admission control
            // alone cannot see state that predates it — an upgrading chain, or any
            // future raw storage write, could carry a tie in. Checking it here is
            // what makes the property an invariant rather than a property of one
            // code path (audit 2026-07-27, AUD-4; 15 §1 try-state coverage rule).
            let activation = specs.iter().map(|spec| spec.activation_epoch).max();
            ensure!(
                self.specs[..index].iter().all(|(_, seen)| {
                    seen.iter().map(|spec| spec.activation_epoch).max() != activation
                }),
                Error::TryStateViolation
            );
            ensure!(
                !specs.is_empty() && specs.len() <= MAX_COMPONENTS_PER_SPEC,
                Error::TryStateViolation
            );
            let mut prev = None;
            for spec in specs {
                ensure!(
                    spec.version == *version
                        && spec.weight.0 <= ONE
                        && spec.epsilon_floor == EPSILON_PILLAR
                        && spec.sanity_min.0 <= spec.sanity_max.0
                        && spec.sanity_max.0 <= ONE
                        && spec.has_normalization_rule
                        && spec.has_missing_data_rule
                        && spec.has_gaming_vectors
                        && spec.has_challenge_procedure
                        && source_matches_pillar(spec)
                        // The two v14 fields, checked here because both are
                        // **static properties of the stored record**: neither
                        // can stop holding without someone rewriting the spec,
                        // and a spec is immutable once registered (I-16).
                        && (spec.id != metric_ids::A_SHIPPED_UPGRADES || spec.target > 0)
                        && (spec.source != SourceClass::Attested
                            || (spec.delta_s_max_bps > 0 && spec.delta_s_max_bps <= BPS_ONE))
                        && prev.replace(spec.id).is_none_or(|p| p < spec.id),
                    Error::TryStateViolation
                );
            }
            // Deliberately NOT re-checked here: 07 §6.3's coverage rule and
            // §2(5)'s seat floors. Both are evaluated against *live* state —
            // `orc.bond_bps`, `orc.rounds`, and the reporter/watchtower sets —
            // every one of which may lawfully move after a spec is admitted. A
            // try-state assertion over them would turn a legal META amendment or
            // a reporter's legal exit into a chain-halting invariant violation,
            // which is the opposite of G-1. That an admitted component can drift
            // out of coverage this way is a real and open gap, recorded as
            // SQ-495 in 07 §6.3 — it needs a screening obligation at the
            // amendment boundary or a defined disposition at snapshot time, not
            // a panic here.
            let weight_sum = |pillars: &[Pillar]| -> Option<u64> {
                specs
                    .iter()
                    .filter(|spec| pillars.contains(&spec.pillar))
                    .try_fold(0u64, |sum, spec| sum.checked_add(spec.weight.0))
            };
            ensure!(
                weight_sum(&[Pillar::COnchain, Pillar::CAttested]) == Some(ONE)
                    && weight_sum(&[Pillar::P]) == Some(ONE)
                    && weight_sum(&[Pillar::A]) == Some(ONE),
                Error::TryStateViolation
            );
        }
        for (index, s) in self.snapshots.iter().enumerate() {
            ensure!(
                self.snapshots[..index]
                    .iter()
                    .all(|seen| seen.epoch != s.epoch || seen.spec_version != s.spec_version)
                    && s.components.len() <= MAX_COMPONENTS_PER_SPEC,
                Error::TryStateViolation
            );
            ensure!(
                [
                    s.s_pillar,
                    s.c_onchain,
                    s.c_attested,
                    s.p_pillar,
                    s.a_pillar,
                    s.gate_s,
                    s.gate_c,
                    s.welfare
                ]
                .iter()
                .all(|v| v.0 <= ONE),
                Error::TryStateViolation
            );
        }
        // 07 §10: exactly one context per snapshot, in both directions. The
        // pairing is what makes an absent context corruption rather than an
        // unflagged epoch, and it is the only thing standing between a pruning
        // bug and a silently un-renormalized settlement.
        ensure!(
            self.snapshot_contexts.len() == self.snapshots.len(),
            Error::TryStateViolation
        );
        for (index, context) in self.snapshot_contexts.iter().enumerate() {
            ensure!(
                self.snapshot_contexts[..index].iter().all(|seen| {
                    seen.epoch != context.epoch || seen.spec_version != context.spec_version
                }) && self
                    .snapshots
                    .iter()
                    .any(|snapshot| snapshot.epoch == context.epoch
                        && snapshot.spec_version == context.spec_version)
                    && context.incident_multiplier.0 <= ONE
                    // Internal consistency only — see `validate_recorded`. The
                    // live-floor form of this check would halt the chain on a
                    // legal kernel or 13 §1 amendment.
                    && context.params.validate_recorded().is_ok(),
                Error::TryStateViolation
            );
            // Only attested components of this very version can be flagged, and
            // the set is ascending and deduplicated (§11(1) consequence (i)).
            let mut previous = None;
            for id in &context.flagged {
                ensure!(
                    previous.replace(*id).is_none_or(|seen| seen < *id)
                        && self.spec(context.spec_version).is_ok_and(|specs| specs
                            .iter()
                            .any(|spec| spec.id == *id && spec.source == SourceClass::Attested)),
                    Error::TryStateViolation
                );
            }
        }
        for (index, (epoch, flags)) in self.gate_flags.iter().enumerate() {
            ensure!(
                self.gate_flags[..index]
                    .iter()
                    .all(|(seen, _)| seen != epoch)
                    && flags.day_bitmap.len() == 2,
                Error::TryStateViolation
            );
        }
        Ok(())
    }

    fn spec(&self, version: MetricSpecVersion) -> Result<&[MetricSpec], Error> {
        self.specs
            .iter()
            .find(|(v, _)| *v == version)
            .map(|(_, s)| s.as_slice())
            .ok_or(Error::SpecNotFound)
    }
    fn snapshot(&self, epoch: EpochId, version: MetricSpecVersion) -> Result<&Snapshot, Error> {
        self.snapshots
            .iter()
            .find(|s| s.epoch == epoch && s.spec_version == version)
            .ok_or(Error::MissingComponent)
    }
}

fn source_matches_pillar(spec: &MetricSpec) -> bool {
    match spec.pillar {
        Pillar::S | Pillar::COnchain => {
            matches!(
                spec.source,
                SourceClass::Onchain | SourceClass::RelayDerived
            )
        }
        Pillar::CAttested | Pillar::A => spec.source == SourceClass::Attested,
        Pillar::P => spec.source == SourceClass::Onchain,
    }
}

#[derive(Clone, Copy)]
struct Pillars {
    s: FixedU64,
    c_onchain: FixedU64,
    c_attested: FixedU64,
    c_settlement: FixedU64,
    p: FixedU64,
    a: FixedU64,
}

fn compute_pillars(
    specs: &[MetricSpec],
    components: &[ComponentValue],
    incident: FixedU64,
) -> Result<Pillars, Error> {
    let s = specs
        .iter()
        .filter(|m| m.pillar == Pillar::S)
        .try_fold(FixedU64(ONE), |acc, m| {
            Ok(FixedU64(acc.0.min(value_for(m.id, components)?.0)))
        })?;
    // View partials (per sub-pillar, spec weights as registered)...
    let c_onchain = weighted_geo(specs, components, &[Pillar::COnchain], None)?;
    let c_attested_geo = weighted_geo(specs, components, &[Pillar::CAttested], None)?;
    let c_attested = mul_down(incident, c_attested_geo)?;
    // ...while the settlement C_e evaluates the joint weight vector as ONE
    // exp2(sum(w * log2(max(c, eps)))) composite (05 §4.4 (2)), incident-
    // multiplied (05 §4.4: I is a pure multiplier).
    let c_joint = weighted_geo(
        specs,
        components,
        &[Pillar::COnchain, Pillar::CAttested],
        None,
    )?;
    let c_settlement = mul_down(incident, c_joint)?;
    let p = weighted_geo(specs, components, &[Pillar::P], None)?;
    let a = weighted_geo(specs, components, &[Pillar::A], None)?;
    Ok(Pillars {
        s,
        c_onchain,
        c_attested,
        c_settlement,
        p,
        a,
    })
}

/// 07 §10's settlement-time `W` recompute: the same evaluation the snapshot
/// recorded, with `dropped` removed and the surviving weights renormalized
/// (05 §4.4's `w_j / Σ w`, the rule `C_daily` already states).
///
/// **Which groups may be emptied is not symmetric.** `S` and `C` enter `W`
/// through the gates `g(S)`, `g(C)`; a gate has no weight to renormalize away,
/// and both a min over nothing and a weighted product over nothing evaluate to
/// the *most favourable* value, so an emptied gate group would convert total
/// unavailability into a perfect score — and dropping the factor outright would
/// treat an unmeasurable security pillar as no constraint at all. Those groups
/// therefore decline the drop and keep every component they had; §10 assigns
/// gate-input failure to VOID, which is a different mechanism with a different
/// trigger (05 §4.7), not something this recompute may improvise. `P` and `A`
/// are weighted terms of one composite, so an emptied group renormalizes at the
/// pillar level by the same rule — `A` going dark leaves `W` measured on what
/// could be measured, rather than on `A`'s stale carried values.
///
/// In v1 only `A` is reachable: `source_matches_pillar` makes every `S`, `P` and
/// `C_onchain` component on-chain, only attested components can be flagged
/// (07 §11(1)(i)), and `C_attested` is empty (07 §2's split keeps gate inputs
/// unattested). The other branches are the fail-safe for a spec set that is not.
fn renormalized_welfare(
    specs: &[MetricSpec],
    components: &[ComponentValue],
    incident: FixedU64,
    dropped: &[MetricId],
    params: &WelfareParams,
) -> Result<FixedU64, Error> {
    // `validate_recorded`, not `validate`: these tunables are a stored record of
    // an epoch already measured, and re-checking them against today's kernel
    // floors would make a lawful amendment wedge every in-flight cohort whose
    // window carries a drop set.
    params.validate_recorded()?;
    let kept = specs
        .iter()
        .filter(|spec| !dropped.contains(&spec.id))
        .copied()
        .collect::<Vec<_>>();
    let weight_sum = |set: &[MetricSpec], group: &[Pillar]| -> Result<u64, Error> {
        set.iter()
            .filter(|spec| group.contains(&spec.pillar))
            .try_fold(0u64, |acc, spec| {
                acc.checked_add(spec.weight.0)
                    .ok_or(Error::ArithmeticOverflow)
            })
    };
    let populated =
        |set: &[MetricSpec], group: &[Pillar]| set.iter().any(|spec| group.contains(&spec.pillar));
    // A group whose drop would empty it declines the drop entirely.
    let retained = |group: &[Pillar]| -> &[MetricSpec] {
        if populated(specs, group) && !populated(&kept, group) {
            specs
        } else {
            kept.as_slice()
        }
    };
    // Renormalize only where the surviving weights no longer sum to 1, so an
    // untouched group takes the byte-identical path the snapshot took.
    let renormalize = |total: u64| (total != ONE).then_some(total);

    let s_group = [Pillar::S];
    let s = retained(&s_group)
        .iter()
        .filter(|spec| spec.pillar == Pillar::S)
        .try_fold(FixedU64(ONE), |acc, spec| {
            Ok(FixedU64(acc.0.min(value_for(spec.id, components)?.0)))
        })?;

    let c_group = [Pillar::COnchain, Pillar::CAttested];
    let c_specs = retained(&c_group);
    let c_total = weight_sum(c_specs, &c_group)?;
    ensure!(c_total > 0, Error::BadWeightSum);
    let c_joint = weighted_geo(c_specs, components, &c_group, renormalize(c_total))?;
    let c_settlement = mul_down(incident, c_joint)?;

    // P and A: an emptied group's weight moves to its sibling, which — since
    // `w_p + w_a == 1` is enforced — is exactly that sibling's weight
    // renormalized over itself.
    let p_group = [Pillar::P];
    let a_group = [Pillar::A];
    let p_total = weight_sum(&kept, &p_group)?;
    let a_total = weight_sum(&kept, &a_group)?;
    let p = weighted_geo(&kept, components, &p_group, renormalize(p_total))?;
    let a = weighted_geo(&kept, components, &a_group, renormalize(a_total))?;
    let (w_p, w_a) = match (p_total == 0, a_total == 0) {
        (false, true) => (FixedU64(ONE), FixedU64(0)),
        (true, false) => (FixedU64(0), FixedU64(ONE)),
        // Both pillars gone: nothing survives to renormalize onto, so the
        // composite declines the drop the same way the gate groups do.
        (true, true) => {
            let p = weighted_geo(specs, components, &p_group, None)?;
            let a = weighted_geo(specs, components, &a_group, None)?;
            return welfare_from_pillars(s, c_settlement, p, a, params.w_p, params.w_a, params);
        }
        (false, false) => (params.w_p, params.w_a),
    };
    welfare_from_pillars(s, c_settlement, p, a, w_p, w_a, params)
}

/// Normalize and validate one snapshot's 07 §10 flag set: ascending, deduped,
/// and drawn only from the version's **attested** components (§11(1)(i)).
fn normalized_flags(
    specs: &[MetricSpec],
    mut flagged: Vec<MetricId>,
) -> Result<Vec<MetricId>, Error> {
    ensure!(
        flagged.len() <= MAX_COMPONENTS_PER_SPEC,
        Error::TooManyComponents
    );
    flagged.sort_unstable();
    let offered = flagged.len();
    flagged.dedup();
    ensure!(flagged.len() == offered, Error::DuplicateComponent);
    for id in &flagged {
        let spec = specs
            .iter()
            .find(|spec| spec.id == *id)
            .ok_or(Error::BadFlaggedComponent)?;
        ensure!(
            spec.source == SourceClass::Attested,
            Error::BadFlaggedComponent
        );
    }
    Ok(flagged)
}

fn compute_daily_gates(
    specs: &[MetricSpec],
    components: &[ComponentValue],
) -> Result<(FixedU64, FixedU64), Error> {
    let s = specs
        .iter()
        .filter(|m| m.pillar == Pillar::S)
        .try_fold(FixedU64(ONE), |acc, m| {
            Ok(FixedU64(acc.0.min(value_for(m.id, components)?.0)))
        })?;
    // C_daily renormalizes the joint C weight vector over the on-chain
    // subset (05 §4.4): w_j / sum_onchain(w). No attested term, ever.
    let onchain_sum = specs
        .iter()
        .filter(|m| m.pillar == Pillar::COnchain)
        .try_fold(0u64, |acc, m| {
            acc.checked_add(m.weight.0).ok_or(Error::ArithmeticOverflow)
        })?;
    let c_daily = weighted_geo(specs, components, &[Pillar::COnchain], Some(onchain_sum))?;
    Ok((s, c_daily))
}

/// Weighted geometric composite per the 05 §4.4 determinism discipline:
/// evaluated in ascending `MetricId` order (specs are stored sorted) as one
/// `exp2(sum(w_i * log2(max(x_i, eps))))` in 64.64. Every true product
/// `w_i * log2(x_i)` is <= 0 and must round toward negative infinity, which
/// in the inverse domain used here (`log2(1/x) >= 0`) is a ceiling. With
/// `renormalize = Some(total)`, each weight is divided by `total` first
/// (the C_daily rule).
fn weighted_geo(
    specs: &[MetricSpec],
    components: &[ComponentValue],
    pillars: &[Pillar],
    renormalize: Option<u64>,
) -> Result<FixedU64, Error> {
    let mut exponent = FixedU64x64::ZERO;
    // The one participating term, when there is exactly one (see below).
    let mut sole: Option<(u64, FixedU64x64)> = None;
    let mut participants = 0usize;
    for m in specs.iter().filter(|m| pillars.contains(&m.pillar)) {
        let v = value_for(m.id, components)?;
        let value = v.0.max(m.epsilon_floor.0);
        if m.weight.0 == 0 || value >= ONE {
            continue;
        }
        ensure!(value > 0, Error::ValueOutOfRange);
        let inv = FixedU64x64::ONE
            .checked_div(q64_from_1e9(value)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
        let log = inv.log2().map_err(|_| Error::ArithmeticOverflow)?;
        let mut weight = q64_from_1e9(m.weight.0)?;
        if let Some(total) = renormalize {
            ensure!(total > 0, Error::BadWeightSum);
            weight = weight
                .checked_div(q64_from_1e9(total)?)
                .map_err(|_| Error::ArithmeticOverflow)?;
        }
        participants += 1;
        sole = Some((value, weight));
        exponent = exponent
            .checked_add(mul_ceil_q64(log, weight)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
    }
    // 05 §4.4 rule 3: a **single** participating term whose weight is exactly 1
    // is the value itself — every other term contributed a factor of exactly 1
    // (weight 0, or a value at the 1.0 ceiling), so the composite is `x^1`.
    //
    // The log2/exp2 route does not reproduce that, and not because of precision:
    // §4.4's discipline truncates the exponent to the 64.64 grid, and truncating
    // an irrational `log2 x` alone lands one 1e-9 ulp below `x`. The reference
    // model does the same at 332-bit, so no differential would ever catch it —
    // which is why the exact reading is normative rather than left to rounding.
    // (`settlement_score` below is the *other* case: there the residual really
    // is finite-precision and the exact `isqrt` is the fix.) Reachable in
    // production since 07 §10's renormalization can leave one survivor at
    // weight 1.
    if participants == 1 {
        if let Some((value, weight)) = sole {
            if weight == FixedU64x64::ONE {
                return Ok(FixedU64(value));
            }
        }
    }
    exp2_inverse_down(exponent)
}

/// `ceil(a * b)` at 64.64 raw granularity. The low 64 bits of the full
/// 256-bit raw product are exactly `a.raw() as u64 * b.raw() as u64`
/// (wrapping), so they detect whether the crate's flooring multiply
/// truncated.
fn mul_ceil_q64(a: FixedU64x64, b: FixedU64x64) -> Result<FixedU64x64, Error> {
    let floor = a.checked_mul(b).map_err(|_| Error::ArithmeticOverflow)?;
    let truncated = (a.raw() as u64).wrapping_mul(b.raw() as u64) != 0;
    if truncated {
        floor
            .checked_add(FixedU64x64::from_raw(1))
            .map_err(|_| Error::ArithmeticOverflow)
    } else {
        Ok(floor)
    }
}

/// `2^(-exponent)` floored to the 1e9 grid (the composite's closing step).
fn exp2_inverse_down(exponent: FixedU64x64) -> Result<FixedU64, Error> {
    if exponent.raw() == 0 {
        return Ok(FixedU64(ONE));
    }
    let denom = exponent.exp2().map_err(|_| Error::ArithmeticOverflow)?;
    let term = FixedU64x64::ONE
        .checked_div(denom)
        .map_err(|_| Error::ArithmeticOverflow)?;
    q64_to_1e9_down(term)
}

fn value_for(id: MetricId, components: &[ComponentValue]) -> Result<FixedU64, Error> {
    let mut found = None;
    for c in components {
        if c.id == id {
            ensure!(found.is_none(), Error::DuplicateComponent);
            ensure!(c.value.0 <= ONE, Error::ValueOutOfRange);
            found = Some(c.value);
        }
    }
    found.ok_or(Error::MissingComponent)
}

/// `x1^w1 * x2^w2` as one exp2/log2 composite (the P/A GeoComposite of the
/// W product, same discipline as [`weighted_geo`]).
fn geo_pair(first: (FixedU64, FixedU64), second: (FixedU64, FixedU64)) -> Result<FixedU64, Error> {
    let mut exponent = FixedU64x64::ZERO;
    let mut sole = None;
    let mut participants = 0usize;
    for (value, weight) in [first, second] {
        if weight.0 == 0 || value.0 >= ONE {
            continue;
        }
        if value.0 == 0 {
            return Ok(FixedU64(0));
        }
        let inv = FixedU64x64::ONE
            .checked_div(q64_from_1e9(value.0)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
        let log = inv.log2().map_err(|_| Error::ArithmeticOverflow)?;
        participants += 1;
        sole = Some((value, weight));
        exponent = exponent
            .checked_add(mul_ceil_q64(log, q64_from_1e9(weight.0)?)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
    }
    // The `weighted_geo` exactness rule, which this composite reaches whenever
    // 07 §10 renormalizes a whole pillar group away: one surviving pillar at
    // weight 1 is that pillar's value, not its log2/exp2 round-trip.
    if participants == 1 {
        if let Some((value, weight)) = sole {
            if weight.0 == ONE {
                return Ok(value);
            }
        }
    }
    exp2_inverse_down(exponent)
}

pub fn compute_welfare(
    s: FixedU64,
    c: FixedU64,
    p: FixedU64,
    a: FixedU64,
    params: &WelfareParams,
) -> Result<FixedU64, Error> {
    params.validate()?;
    welfare_from_pillars(s, c, p, a, params.w_p, params.w_a, params)
}

/// The 05 §4.4(3) `W` product with the composite's pillar weights supplied.
/// They are the live `params` values on every ordinary path; 07 §10's recompute
/// passes them renormalized when a whole pillar group has been dropped.
fn welfare_from_pillars(
    s: FixedU64,
    c: FixedU64,
    p: FixedU64,
    a: FixedU64,
    w_p: FixedU64,
    w_a: FixedU64,
    params: &WelfareParams,
) -> Result<FixedU64, Error> {
    let gs = gate(s, params.theta_s_lo, params.theta_s_hi)?;
    let gc = gate(c, params.theta_c_lo, params.theta_c_hi)?;
    let pa = geo_pair((p, w_p), (a, w_a))?;
    mul_down(mul_down(gs, gc)?, pa)
}

/// 05 §4.4 (4): `s = exp2((log2 max(W1, eps_W) + log2 max(W2, eps_W)) / 2)`,
/// eps_W = 1e-9, rounded down to the FixedU64 grid — i.e. the exact
/// geometric mean of the two epoch welfares, floored to the grid.
///
/// 15 §4.4 requires this value bit-identical to the ≥256-bit reference
/// model, which evaluates the expression exactly and floors. On the 1e9
/// grid that exact floor is `isqrt(A · B)` in grid units (`s · 1e9 =
/// sqrt(A · B)` for `A = W1 · 1e9`, `B = W2 · 1e9`), so it is computed as
/// an integer square root: no transcendental approximation error, monotone
/// non-decreasing in both arguments, bounded by `s <= max(W1, W2) <= 1`,
/// and still rounded down (against the claimant) exactly as the spec
/// prescribes. An approximate exp2/log2 evaluation loses one grid ulp
/// whenever the true mean lies exactly on the grid (e.g. geomean(0.8, 0.8)
/// = 0.8), which 15 §4.4 forbids as a divergence from the reference model.
pub fn settlement_score(w1: FixedU64, w2: FixedU64) -> Result<FixedU64, Error> {
    let a = u128::from(w1.0.clamp(EPSILON.0, ONE));
    let b = u128::from(w2.0.clamp(EPSILON.0, ONE));
    // a, b <= 1e9 so the product is <= 1e18 (no u128 overflow is reachable)
    // and its integer square root is <= 1e9, which always fits u64.
    let product = a.checked_mul(b).ok_or(Error::ArithmeticOverflow)?;
    let root = u64::try_from(product.isqrt()).map_err(|_| Error::ArithmeticOverflow)?;
    Ok(FixedU64(root))
}

pub fn gate(x: FixedU64, lo: FixedU64, hi: FixedU64) -> Result<FixedU64, Error> {
    ensure!(
        lo.0 < hi.0 && hi.0 <= ONE && x.0 <= ONE,
        Error::ValueOutOfRange
    );
    if x.0 <= lo.0 {
        return Ok(FixedU64(0));
    }
    if x.0 >= hi.0 {
        return Ok(FixedU64(ONE));
    }
    let t = (u128::from(x.0 - lo.0) * u128::from(ONE) / u128::from(hi.0 - lo.0)) as u64;
    let t2 = (u128::from(t) * u128::from(t) / u128::from(ONE)) as u64;
    let three_minus_2t = 3 * ONE - 2 * t;
    Ok(FixedU64(
        (u128::from(t2) * u128::from(three_minus_2t) / u128::from(ONE)) as u64,
    ))
}

fn mul_down(a: FixedU64, b: FixedU64) -> Result<FixedU64, Error> {
    Ok(FixedU64(
        (u128::from(a.0) * u128::from(b.0) / u128::from(ONE)) as u64,
    ))
}
fn q64_from_1e9(v: u64) -> Result<FixedU64x64, Error> {
    Ok(FixedU64x64::from_raw(
        (u128::from(v) << 64) / u128::from(ONE),
    ))
}
fn q64_to_1e9_down(v: FixedU64x64) -> Result<FixedU64, Error> {
    Ok(FixedU64(((v.raw() * u128::from(ONE)) >> 64) as u64))
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    pub fn benchmark_stub() -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;
    fn spec(id: MetricId, pillar: Pillar, weight: u64, version: u16) -> MetricSpec {
        let source = match pillar {
            Pillar::CAttested | Pillar::A => SourceClass::Attested,
            Pillar::S | Pillar::COnchain | Pillar::P => SourceClass::Onchain,
        };
        MetricSpec {
            id,
            version,
            pillar,
            weight: FixedU64(weight),
            epsilon_floor: EPSILON_PILLAR,
            activation_epoch: 2,
            source,
            formula_ref: [1; 32],
            units: [2; 16],
            repr: [3; 16],
            cadence_blocks: 1,
            sanity_min: FixedU64(0),
            sanity_max: FixedU64(ONE),
            has_normalization_rule: true,
            has_missing_data_rule: true,
            has_gaming_vectors: true,
            has_challenge_procedure: true,
            prior_bounds: [FixedU64(ONE); HISTORY_PRIORS],
            target: 100,
            delta_s_max_bps: 1_000,
        }
    }
    /// A seated oracle for tests: 07 §2(5)'s floors met and the default bond
    /// ladder readable, so attested components are admissible. Written out
    /// rather than defaulted — `AttestedAdmission` has no `Default` precisely
    /// because "admit" must never be the value you get by not thinking.
    fn seated() -> AttestedAdmission {
        AttestedAdmission {
            reporters: 3,
            watchtowers: 2,
            reporter_min: 3,
            watchtower_min: 2,
            // `(2^3 − 1) × 250` at the 13 §1 defaults for `orc.rounds` /
            // `orc.bond_bps` — the 1,750 bps of 07 §6.3's worked example.
            coverage_bps: Some(1_750),
        }
    }

    #[test]
    fn a_milestone_component_without_a_positive_target_is_refused() {
        let mut w = WelfareState::new();
        let mut specs = default_specs(1);
        // The A-pillar milestone component (05 §4.3's `min(1, points ÷ target)`).
        specs.push(MetricSpec {
            weight: FixedU64(0),
            target: 0,
            ..spec(metric_ids::A_SHIPPED_UPGRADES, Pillar::A, 0, 1)
        });
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs.clone(), &seated()),
            Err(Error::MilestoneTargetUnset)
        );
        // The identical set with a positive target registers, so the refusal is
        // attributable to `target` alone.
        let fixed = specs
            .into_iter()
            .map(|s| MetricSpec { target: 1, ..s })
            .collect::<Vec<_>>();
        assert!(w
            .register_metric_spec(Registration::Genesis, 1, fixed, &seated())
            .is_ok());
    }

    #[test]
    fn delta_s_max_is_bound_checked_for_attested_components_only() {
        for bad in [0, BPS_ONE + 1] {
            let mut w = WelfareState::new();
            let specs = default_specs(1)
                .into_iter()
                .map(|s| {
                    if s.source == SourceClass::Attested {
                        MetricSpec {
                            delta_s_max_bps: bad,
                            ..s
                        }
                    } else {
                        s
                    }
                })
                .collect::<Vec<_>>();
            assert_eq!(
                w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
                Err(Error::BadDeltaSMax),
                "delta_s_max_bps = {bad} must be refused for an attested component"
            );
        }
        // 05 §4.4: recorded but not bound-checked for source classes 1-3 — a
        // zero on an on-chain component is legal, because it runs no §5 game
        // and so has no bond ladder to collateralize.
        let mut w = WelfareState::new();
        let specs = default_specs(1)
            .into_iter()
            .map(|s| {
                if s.source == SourceClass::Attested {
                    s
                } else {
                    MetricSpec {
                        delta_s_max_bps: 0,
                        ..s
                    }
                }
            })
            .collect::<Vec<_>>();
        assert!(w
            .register_metric_spec(Registration::Genesis, 1, specs, &seated())
            .is_ok());
    }

    #[test]
    fn attested_admission_needs_both_halves_of_the_oracle_gate() {
        // 07 §6.3: the ladder must cover the declared impact. `seated()` carries
        // 1,750 bps of coverage; the specs declare 1,000.
        let thin = AttestedAdmission {
            coverage_bps: Some(999),
            ..seated()
        };
        assert_eq!(
            WelfareState::new().register_metric_spec(
                Registration::Genesis,
                1,
                default_specs(1),
                &thin
            ),
            Err(Error::BondCoverageUnmet)
        );
        // An unreadable ladder refuses too — the fail-closed direction for
        // admission, and the opposite of what the registry's bond pricing does
        // with the same `None`.
        let unreadable = AttestedAdmission {
            coverage_bps: None,
            ..seated()
        };
        assert_eq!(
            WelfareState::new().register_metric_spec(
                Registration::Genesis,
                1,
                default_specs(1),
                &unreadable
            ),
            Err(Error::BondCoverageUnmet)
        );
        // 07 §2(5): seats, independently of coverage.
        for starved in [
            AttestedAdmission {
                reporters: 2,
                ..seated()
            },
            AttestedAdmission {
                watchtowers: 1,
                ..seated()
            },
        ] {
            assert_eq!(
                WelfareState::new().register_metric_spec(
                    Registration::Genesis,
                    1,
                    default_specs(1),
                    &starved
                ),
                Err(Error::InsufficientOracleSeats)
            );
        }
        // The gate is written as scoped to spec sets containing an attested
        // component — and that scope turns out to be **every valid set**:
        // `source_matches_pillar` forces `Pillar::A` to be `Attested`, and the
        // A weights must sum to 1, so a valid set always has at least one
        // attested member. A closed oracle therefore refuses registration
        // outright, which is 07 §3's bootstrap order (reporters and watchtowers
        // register first, permissionlessly, then the spec) rather than a
        // deadlock. Pinned here because it is the load-bearing consequence of
        // enforcing §2(5), and because the scoping condition reads as if some
        // set escapes it.
        assert_eq!(
            WelfareState::new().register_metric_spec(
                Registration::Genesis,
                1,
                default_specs(1),
                &AttestedAdmission::CLOSED
            ),
            Err(Error::BondCoverageUnmet)
        );
    }

    #[test]
    fn try_state_rejects_a_stored_spec_that_violates_the_v14_field_rules() {
        // Both fields are static properties of the stored record, so try-state
        // owns them. The live-parameter halves of the gate deliberately are NOT
        // re-checked there — see the comment at the try_state site (SQ-495).
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        assert!(w.try_state().is_ok());

        let mut corrupt = w.clone();
        corrupt.specs[0].1[3].delta_s_max_bps = 0;
        assert_eq!(corrupt.try_state(), Err(Error::TryStateViolation));

        let mut corrupt = w;
        corrupt.specs[0].1[3].id = metric_ids::A_SHIPPED_UPGRADES;
        corrupt.specs[0].1[3].target = 0;
        assert_eq!(corrupt.try_state(), Err(Error::TryStateViolation));
    }

    fn default_specs(version: u16) -> Vec<MetricSpec> {
        vec![
            spec(1, Pillar::S, ONE, version),
            spec(2, Pillar::COnchain, ONE, version),
            spec(3, Pillar::P, ONE, version),
            spec(4, Pillar::A, ONE, version),
        ]
    }
    fn healthy_components() -> Vec<ComponentValue> {
        (1..=4)
            .map(|id| ComponentValue {
                id,
                value: FixedU64(ONE),
            })
            .collect()
    }

    // ---- 07 §10 two-consecutive-flag renormalization (SQ-493) ----------------

    /// A spec set with **two** components in the joint C vector and **two** in
    /// A, so a drop leaves something to renormalize onto. Ids 3, 5 and 6 are
    /// attested and therefore the only flaggable ones.
    fn renorm_specs(version: u16) -> Vec<MetricSpec> {
        vec![
            spec(1, Pillar::S, 0, version),
            spec(2, Pillar::COnchain, 600_000_000, version),
            spec(3, Pillar::CAttested, 400_000_000, version),
            spec(4, Pillar::P, ONE, version),
            spec(5, Pillar::A, 500_000_000, version),
            spec(6, Pillar::A, 500_000_000, version),
        ]
    }

    /// Values deliberately **below** 1.0 across the board: at exactly 1.0 every
    /// weighted-geometric term is skipped, so a renormalization test built on
    /// healthy inputs would pass while proving nothing. They are also chosen to
    /// keep every gate strictly **interior** — a fixture whose `g(C)` sits at
    /// its floor zeroes `W`, and two zeroed welfares compare equal whatever the
    /// renormalization does. `renorm_state` asserts that non-degeneracy.
    fn renorm_components() -> Vec<ComponentValue> {
        vec![
            ComponentValue {
                id: 1,
                value: FixedU64(950_000_000),
            },
            ComponentValue {
                id: 2,
                value: FixedU64(930_000_000),
            },
            ComponentValue {
                id: 3,
                value: FixedU64(900_000_000),
            },
            ComponentValue {
                id: 4,
                value: FixedU64(800_000_000),
            },
            ComponentValue {
                id: 5,
                value: FixedU64(600_000_000),
            },
            ComponentValue {
                id: 6,
                value: FixedU64(500_000_000),
            },
        ]
    }

    /// Record snapshots for `epochs`, flagging `flagged` in the epochs named by
    /// `flag_at`. Returns the state ready for a `compute_settlement` call.
    fn renorm_state(epochs: &[EpochId], flag_at: &[(EpochId, Vec<MetricId>)]) -> WelfareState {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, renorm_specs(1), &seated())
            .expect("spec set registers");
        for epoch in epochs {
            let flagged = flag_at
                .iter()
                .find_map(|(at, ids)| (at == epoch).then(|| ids.clone()))
                .unwrap_or_default();
            w.record_snapshot(
                *epoch,
                1,
                &[1],
                renorm_components(),
                FixedU64(ONE),
                flagged,
                &WelfareParams::DEFAULT,
            )
            .expect("snapshot records");
        }
        // The fixture must exercise the arithmetic it claims to: a zeroed or
        // saturated `W` makes every comparison below vacuous.
        for epoch in epochs {
            let welfare = w.snapshot(*epoch, 1).expect("snapshot").welfare.0;
            assert!(
                (100_000_000..900_000_000).contains(&welfare),
                "degenerate renormalization fixture: W = {welfare}"
            );
        }
        w.events.clear();
        w
    }

    fn renormalized_event(state: &WelfareState) -> Option<Vec<MetricId>> {
        state.events.iter().find_map(|event| match event {
            Event::SettlementRenormalized { dropped, .. } => Some(dropped.clone()),
            _ => None,
        })
    }

    #[test]
    fn sq493_two_consecutive_flags_drop_the_component_and_renormalize() {
        // Flagged at 6 and 7 — the cohort at 5 consumes exactly those.
        let mut flagged = renorm_state(&[5, 6, 7], &[(6, vec![3]), (7, vec![3])]);
        let score = flagged.compute_settlement(5, 1).expect("settles");
        assert_eq!(renormalized_event(&flagged), Some(vec![3]));

        // Independent derivation: the identical inputs under a spec set that
        // never had component 3, whose C weight vector is therefore the
        // renormalized one (0.6 / 0.6 = 1). 07 §10's "recompute W without the
        // component, weights renormalized" is exactly that measurement.
        let mut without = WelfareState::new();
        let specs = renorm_specs(1)
            .into_iter()
            .filter(|s| s.id != 3)
            .map(|s| {
                if s.pillar == Pillar::COnchain {
                    MetricSpec {
                        weight: FixedU64(ONE),
                        ..s
                    }
                } else {
                    s
                }
            })
            .collect::<Vec<_>>();
        without
            .register_metric_spec(Registration::Genesis, 1, specs, &seated())
            .expect("reduced spec set registers");
        for epoch in [6, 7] {
            without
                .record_snapshot(
                    epoch,
                    1,
                    &[1],
                    renorm_components(),
                    FixedU64(ONE),
                    Vec::new(),
                    &WelfareParams::DEFAULT,
                )
                .expect("snapshot records");
        }
        let expected = without.compute_settlement(5, 1).expect("settles");
        assert_eq!(score, expected);

        // ...and the drop is not a no-op: the flagged component was voting.
        let mut unflagged = renorm_state(&[5, 6, 7], &[]);
        let carried = unflagged.compute_settlement(5, 1).expect("settles");
        assert!(
            carried.0 < score.0,
            "dropping the 0.7 component must raise the renormalized score \
             (carried {carried:?}, renormalized {score:?})"
        );
        assert_eq!(renormalized_event(&unflagged), None);
    }

    #[test]
    fn sq493_one_flagged_epoch_keeps_carrying_at_full_weight() {
        // §10 grants the first flagged epoch its carried value; only the second
        // consecutive one drops the component.
        let mut once = renorm_state(&[5, 6, 7], &[(6, vec![3])]);
        let score = once.compute_settlement(5, 1).expect("settles");
        let mut never = renorm_state(&[5, 6, 7], &[]);
        assert_eq!(score, never.compute_settlement(5, 1).expect("settles"));
        assert_eq!(renormalized_event(&once), None);
    }

    #[test]
    fn sq493_a_streak_entering_the_window_from_before_it_still_drops() {
        // Flagged at 5 and 6: the streak began in the cohort's own epoch and is
        // two long by `e+1`, so it condemns the component for this cohort.
        let mut early = renorm_state(&[5, 6, 7], &[(5, vec![3]), (6, vec![3])]);
        let score = early.compute_settlement(5, 1).expect("settles");
        assert_eq!(renormalized_event(&early), Some(vec![3]));
        let mut both = renorm_state(&[5, 6, 7], &[(6, vec![3]), (7, vec![3])]);
        assert_eq!(score, both.compute_settlement(5, 1).expect("settles"));
    }

    #[test]
    fn sq493_consecutive_cohorts_weigh_the_same_epoch_differently() {
        // Flagged at 7 and 8. The cohort at 5 (window 6,7) sees no streak inside
        // its window; the cohort at 6 (window 7,8) does. The same epoch-7
        // snapshot therefore enters the two settlements with different weight —
        // which is why §10 makes this settlement-time rather than a property of
        // the recorded `W`.
        let mut state = renorm_state(&[5, 6, 7, 8], &[(7, vec![3]), (8, vec![3])]);
        let earlier = state.compute_settlement(5, 1).expect("settles");
        assert_eq!(renormalized_event(&state), None);
        state.events.clear();
        let later = state.compute_settlement(6, 1).expect("settles");
        assert_eq!(renormalized_event(&state), Some(vec![3]));
        assert!(earlier.0 < later.0);
    }

    #[test]
    fn sq493_dropping_the_whole_a_pillar_renormalizes_the_composite_onto_p() {
        let mut state = renorm_state(&[5, 6, 7], &[(6, vec![5, 6]), (7, vec![5, 6])]);
        let score = state.compute_settlement(5, 1).expect("settles");
        assert_eq!(renormalized_event(&state), Some(vec![5, 6]));

        // With A unmeasurable the composite's surviving weight renormalizes to
        // exactly 1, so `W = g(S) · g(C) · P` — not `A = 1.0` (which would turn
        // total attestation failure into a perfect pillar) and not a wedge.
        let specs = renorm_specs(1);
        let components = renorm_components();
        let params = WelfareParams::DEFAULT;
        let pillars = compute_pillars(&specs, &components, FixedU64(ONE)).expect("pillars");
        let p = pillars.p;
        let expected_w = mul_down(
            mul_down(
                gate(pillars.s, params.theta_s_lo, params.theta_s_hi).expect("g(S)"),
                gate(pillars.c_settlement, params.theta_c_lo, params.theta_c_hi).expect("g(C)"),
            )
            .expect("g(S)*g(C)"),
            p,
        )
        .expect("W");
        assert_eq!(score, settlement_score(expected_w, expected_w).expect("s"));
    }

    #[test]
    fn sq493_a_drop_that_would_empty_the_gate_group_is_declined() {
        // A spec set whose whole joint C vector is attested — not reachable for a
        // 07 §2-conforming v1 spec, and the one case where renormalization has
        // nothing to renormalize onto. `g(C)` has no weight to redistribute, and
        // an empty weighted product is 1.0, so the drop is declined instead of
        // converting total unavailability into a perfect security pillar.
        let mut w = WelfareState::new();
        let specs = vec![
            spec(1, Pillar::S, 0, 1),
            spec(2, Pillar::CAttested, ONE, 1),
            spec(4, Pillar::P, ONE, 1),
            spec(5, Pillar::A, ONE, 1),
        ];
        w.register_metric_spec(Registration::Genesis, 1, specs, &seated())
            .expect("registers");
        let components = renorm_components();
        for epoch in [5, 6, 7] {
            let flagged = if epoch == 5 { Vec::new() } else { vec![2] };
            w.record_snapshot(
                epoch,
                1,
                &[1],
                components.clone(),
                FixedU64(ONE),
                flagged,
                &WelfareParams::DEFAULT,
            )
            .expect("records");
        }
        let recorded = w.snapshot(6, 1).expect("snapshot").welfare;
        w.events.clear();
        let score = w.compute_settlement(5, 1).expect("settles");
        // The event still reports the streak, but the measurement is unchanged:
        // declining is visible, not silent.
        assert_eq!(renormalized_event(&w), Some(vec![2]));
        assert_eq!(
            score,
            settlement_score(recorded, recorded).expect("unchanged score")
        );
    }

    #[test]
    fn sq493_each_epoch_recomputes_under_its_own_recorded_tunables() {
        // Amending a gate threshold between the two measured epochs must not
        // re-price either of them: the recompute reads the tunables stored with
        // the snapshot, so it differs from the recorded `W` in the drop alone.
        let tight = WelfareParams {
            theta_c_lo: FixedU64(890_000_000),
            ..WelfareParams::DEFAULT
        };
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, renorm_specs(1), &seated())
            .expect("registers");
        for (epoch, params) in [
            (5, &WelfareParams::DEFAULT),
            (6, &WelfareParams::DEFAULT),
            (7, &tight),
        ] {
            w.record_snapshot(
                epoch,
                1,
                &[1],
                renorm_components(),
                FixedU64(ONE),
                if epoch == 5 { Vec::new() } else { vec![3] },
                params,
            )
            .expect("records");
        }
        let score = w.compute_settlement(5, 1).expect("settles");

        let specs = renorm_specs(1);
        let components = renorm_components();
        let recompute = |params: &WelfareParams| {
            renormalized_welfare(&specs, &components, FixedU64(ONE), &[3], params).expect("W'")
        };
        let expected =
            settlement_score(recompute(&WelfareParams::DEFAULT), recompute(&tight)).expect("s");
        assert_eq!(score, expected);
        // The amendment is load-bearing: evaluating both epochs under either
        // single parameter set gives a different score.
        for params in [&WelfareParams::DEFAULT, &tight] {
            assert_ne!(
                score,
                settlement_score(recompute(params), recompute(params)).expect("s")
            );
        }
    }

    #[test]
    fn sq493_only_attested_components_of_this_version_can_be_flagged() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, renorm_specs(1), &seated())
            .expect("registers");
        let record = |w: &mut WelfareState, epoch: EpochId, flagged: Vec<MetricId>| {
            w.record_snapshot(
                epoch,
                1,
                &[1],
                renorm_components(),
                FixedU64(ONE),
                flagged,
                &WelfareParams::DEFAULT,
            )
        };
        // On-chain component (07 §11(1)(i): only class-4 components are
        // reportable, so only they can be absent at the money deadline).
        assert_eq!(record(&mut w, 5, vec![2]), Err(Error::BadFlaggedComponent));
        // Not a component of this version at all.
        assert_eq!(record(&mut w, 5, vec![99]), Err(Error::BadFlaggedComponent));
        // Repeated id.
        assert_eq!(
            record(&mut w, 5, vec![3, 3]),
            Err(Error::DuplicateComponent)
        );
        // The attested one records, and normalizes to ascending order.
        assert!(record(&mut w, 5, vec![6, 5, 3]).is_ok());
        assert_eq!(w.flagged_at(5, 1), &[3, 5, 6]);
    }

    #[test]
    fn sq493_a_recorded_window_still_settles_after_the_live_floors_move() {
        // A kernel or 13 §1 amendment may lawfully raise `welfare.thetaS` above
        // what an in-flight cohort's snapshots were measured under. The recompute
        // must replay those stored tunables anyway: validating them against the
        // *new* floors would refuse the settlement forever, wedging every holder
        // in the cohort, and the same check in `try_state` would halt the chain.
        let stale = WelfareParams {
            theta_s_lo: FixedU64(500_000_000),
            ..WelfareParams::DEFAULT
        };
        assert_eq!(stale.validate(), Err(Error::ValueOutOfRange));
        assert!(stale.validate_recorded().is_ok());

        let mut state = renorm_state(&[5, 6, 7], &[(6, vec![3]), (7, vec![3])]);
        for context in &mut state.snapshot_contexts {
            context.params = stale;
        }
        assert!(state.try_state().is_ok(), "history must not halt try-state");
        assert!(
            state.compute_settlement(5, 1).is_ok(),
            "a recomputed window must survive a lawful floor amendment"
        );

        // Internal inconsistency is still refused — the relaxation is scoped to
        // the live-bounds comparison, not to the arithmetic's preconditions.
        let broken = WelfareParams {
            theta_c_hi: FixedU64(0),
            ..WelfareParams::DEFAULT
        };
        assert_eq!(broken.validate_recorded(), Err(Error::ValueOutOfRange));
        for context in &mut state.snapshot_contexts {
            context.params = broken;
        }
        assert_eq!(state.try_state(), Err(Error::TryStateViolation));
    }

    #[test]
    fn sq493_a_lone_surviving_component_at_weight_one_is_evaluated_exactly() {
        // 05 §4.4 rule 3. 07 §10's renormalization makes a weight of exactly 1
        // reachable, and at that weight the composite is the value itself. The
        // `exp2(log2(1/x))` route floors one ulp short of it because §4.4
        // truncates the exponent to the 64.64 grid — an error the reference model
        // reproduces exactly, so only a normative rule closes it.
        let specs = vec![spec(4, Pillar::P, ONE, 1)];
        let value = FixedU64(800_000_000);
        let components = vec![ComponentValue { id: 4, value }];
        assert_eq!(
            weighted_geo(&specs, &components, &[Pillar::P], None).expect("P"),
            value
        );
        assert_eq!(
            geo_pair((value, FixedU64(ONE)), (FixedU64(500_000_000), FixedU64(0)))
                .expect("composite"),
            value
        );
        // The residual this guards against is real, not hypothetical: evaluated
        // the long way round the same input lands one ulp low.
        let inv = FixedU64x64::ONE
            .checked_div(q64_from_1e9(value.0).expect("q64"))
            .expect("inverse");
        let round_trip = exp2_inverse_down(inv.log2().expect("log2")).expect("exp2");
        assert_eq!(round_trip.0, value.0 - 1);
    }

    #[test]
    fn sq493_contexts_are_paired_with_their_snapshots_through_pruning() {
        let mut w = renorm_state(&[5, 6, 7], &[(6, vec![3]), (7, vec![3])]);
        assert!(w.try_state().is_ok());
        w.prune_before(7);
        assert_eq!(w.snapshot_contexts.len(), 1);
        assert_eq!(w.snapshots.len(), 1);
        assert!(w.try_state().is_ok());

        // A context left behind by a partial prune is a try-state violation, and
        // a snapshot with no context refuses to settle rather than reading the
        // absence as "nothing was flagged".
        let mut orphaned = renorm_state(&[5, 6, 7], &[(6, vec![3]), (7, vec![3])]);
        orphaned.snapshots.retain(|s| s.epoch != 7);
        assert_eq!(orphaned.try_state(), Err(Error::TryStateViolation));

        // A snapshot with no context refuses to settle rather than reading the
        // absence as "nothing was flagged". The streak here is carried by epochs
        // 5 and 6, so stripping 7's context leaves a live drop set whose second
        // recompute has no inputs — the state this can only reach by corruption.
        let mut stripped = renorm_state(&[5, 6, 7], &[(5, vec![3]), (6, vec![3])]);
        stripped.snapshot_contexts.retain(|c| c.epoch != 7);
        assert_eq!(stripped.try_state(), Err(Error::TryStateViolation));
        assert_eq!(
            stripped.compute_settlement(5, 1),
            Err(Error::MissingSnapshotContext)
        );
    }
    #[test]
    fn metric_spec_registration_enforces_activation_disciplines_and_weight_sums() {
        let mut w = WelfareState::new();
        // Genesis floor: activation must be >= 1 (epoch 0 is the pre-launch
        // sentinel, not a welfare epoch — 05 §4.6). `activation_epoch = 0` is
        // below the floor and rejected.
        let mut specs = default_specs(1);
        specs[0].activation_epoch = 0;
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Err(Error::BadActivationEpoch)
        );
        let mut specs = default_specs(1);
        specs[0].has_gaming_vectors = false;
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Err(Error::MissingMetricDiscipline)
        );
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated()),
            Ok(())
        );
    }

    #[test]
    fn genesis_specs_activate_at_epoch_one_but_post_genesis_keeps_the_lead_time() {
        // 05 §4.6 cold start: genesis specs (registered at the epoch-0 sentinel)
        // activate at epoch 1 so `s` is computable from epoch 1. The core has no
        // finalization gate — that is the pallet's live-clock concern — so it
        // records epoch 1 directly here.
        let mut w = WelfareState::new();
        let mut specs = default_specs(1);
        for spec in &mut specs {
            spec.activation_epoch = 1;
        }
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Ok(())
        );
        assert_eq!(
            w.record_snapshot(
                1,
                1,
                &[1],
                healthy_components(),
                FixedU64(ONE),
                Vec::new(),
                &WelfareParams::DEFAULT,
            ),
            Ok(FixedU64(ONE))
        );
        // Post-genesis (current epoch 1) the two-epoch lead is enforced: a
        // version that activates at epoch 2 is one short and rejected...
        let mut specs = default_specs(2);
        for spec in &mut specs {
            spec.activation_epoch = 2;
        }
        assert_eq!(
            w.register_metric_spec(Registration::Live { current_epoch: 1 }, 2, specs, &seated()),
            Err(Error::BadActivationEpoch)
        );
        // ...but activating at epoch 3 (current + 2) is accepted.
        let mut specs = default_specs(2);
        for spec in &mut specs {
            spec.activation_epoch = 3;
        }
        assert_eq!(
            w.register_metric_spec(Registration::Live { current_epoch: 1 }, 2, specs, &seated()),
            Ok(())
        );
    }

    #[test]
    fn registration_rejects_activation_lead_time_overflow_near_epoch_max() {
        // Near EpochId::MAX, `current + 2` cannot be represented; registration
        // must reject rather than saturate the two-epoch lead time down to MAX
        // (G-1; final review 2026-07-16).
        let mut w = WelfareState::new();
        assert_eq!(
            w.register_metric_spec(
                Registration::Live {
                    current_epoch: EpochId::MAX - 1
                },
                1,
                default_specs(1),
                &seated()
            ),
            Err(Error::BadActivationEpoch)
        );
        assert_eq!(
            w.register_metric_spec(
                Registration::Live {
                    current_epoch: EpochId::MAX
                },
                1,
                default_specs(1),
                &seated()
            ),
            Err(Error::BadActivationEpoch)
        );
    }

    #[test]
    fn welfare_weights_stay_within_the_constitution_bounds() {
        let params = WelfareParams {
            w_p: FixedU64(800_000_000),
            w_a: FixedU64(200_000_000),
            ..WelfareParams::DEFAULT
        };
        assert_eq!(params.validate(), Err(Error::ValueOutOfRange));
    }
    #[test]
    fn metric_spec_registration_rejects_bad_epsilon_and_source_class() {
        let mut w = WelfareState::new();
        let mut specs = default_specs(1);
        specs[0].epsilon_floor = FixedU64(EPSILON_PILLAR.0 - 1);
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Err(Error::BadEpsilonFloor)
        );

        let mut specs = default_specs(1);
        specs[3].source = SourceClass::Onchain;
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Err(Error::BadSourceClass)
        );
    }

    #[test]
    fn cranks_reject_a_metric_version_before_activation() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        assert_eq!(
            w.record_snapshot(
                1,
                1,
                &[1],
                healthy_components(),
                FixedU64(ONE),
                Vec::new(),
                &WelfareParams::DEFAULT,
            ),
            Err(Error::SpecNotActive)
        );
        assert_eq!(
            w.record_daily_gate(
                1,
                0,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            ),
            Err(Error::SpecNotActive)
        );
        assert!(w.snapshots.is_empty());
        assert!(w.gate_flags.is_empty());
    }

    #[test]
    fn prune_rolls_the_bounded_epoch_windows() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        w.events.clear();
        // Both windows are driven by the *epoch* bound: gate flags are keyed by
        // epoch alone, and a single-version epoch takes one snapshot slot.
        for epoch in 2..SNAPSHOT_RETENTION_EPOCHS as u32 + 2 {
            w.record_snapshot(
                epoch,
                1,
                &[1],
                healthy_components(),
                FixedU64(ONE),
                Vec::new(),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
            w.record_daily_gate(
                epoch,
                0,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        }
        w.events.clear();
        w.prune_before(3);
        assert!(w.events.is_empty());
        assert!(w.snapshots.iter().all(|snapshot| snapshot.epoch >= 3));
        assert!(w.gate_flags.iter().all(|(epoch, _)| *epoch >= 3));
        assert_eq!(w.specs.len(), 1);

        let next = SNAPSHOT_RETENTION_EPOCHS as u32 + 2;
        assert!(w
            .record_snapshot(
                next,
                1,
                &[1],
                healthy_components(),
                FixedU64(ONE),
                Vec::new(),
                &WelfareParams::DEFAULT,
            )
            .is_ok());
        assert!(w
            .record_daily_gate(
                next,
                0,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            )
            .is_ok());
    }
    #[test]
    fn daily_gate_uses_only_s_and_onchain_c_components() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        let (flags, changed) = w
            .record_daily_gate(
                2,
                0,
                1,
                Some(1),
                vec![
                    ComponentValue {
                        id: 1,
                        value: FixedU64(ONE),
                    },
                    ComponentValue {
                        id: 2,
                        value: FixedU64(ONE),
                    },
                ],
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        assert!(!changed);
        assert!(!flags.s_breached);
        assert!(!flags.c_breached);
        assert_eq!(flags.day_bitmap, [0; 2]);
    }

    #[test]
    fn daily_gate_signals_only_new_breach_flags_and_not_samples_or_duplicates() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();

        let (_, first_changed) = w
            .record_daily_gate(
                2,
                0,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        let (_, duplicate_changed) = w
            .record_daily_gate(
                2,
                0,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        assert!(!first_changed);
        assert!(!duplicate_changed);

        let mut breached = healthy_components();
        breached
            .iter_mut()
            .find(|component| component.id == 1)
            .expect("default specs include the S component")
            .value = FixedU64(0);
        let (flags, augmented) = w
            .record_daily_gate(2, 0, 1, Some(1), breached.clone(), &WelfareParams::DEFAULT)
            .unwrap();
        let (_, repeated_augmentation) = w
            .record_daily_gate(2, 0, 1, Some(1), breached, &WelfareParams::DEFAULT)
            .unwrap();
        assert!(augmented);
        assert!(flags.s_breached);
        assert_eq!(flags.day_bitmap, [1, 0]);
        assert!(!repeated_augmentation);
    }

    #[test]
    fn daily_gate_bitmap_contains_breached_days_only() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();

        let (healthy, changed) = w
            .record_daily_gate(
                2,
                3,
                1,
                Some(1),
                healthy_components(),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        assert!(!changed);
        assert_eq!(healthy.day_bitmap, [0, 0]);

        let mut breached = healthy_components();
        breached
            .iter_mut()
            .find(|component| component.id == 1)
            .expect("default specs include the S component")
            .value = FixedU64(0);
        let (flags, changed) = w
            .record_daily_gate(2, 5, 1, Some(1), breached, &WelfareParams::DEFAULT)
            .unwrap();
        assert!(changed);
        assert_eq!(flags.day_bitmap, [1 << 5, 0]);
    }

    #[test]
    fn c_weight_vector_is_joint_across_onchain_and_attested() {
        // 05 §4.4: one C weight vector across C_onchain and C_attested,
        // summing to 1 - which is what makes C_daily's renormalization over
        // the on-chain subset meaningful. Per-sub-pillar sums of 1 (joint 2)
        // must reject.
        let mut w = WelfareState::new();
        let mut specs = default_specs(1);
        specs.push(spec(5, Pillar::CAttested, ONE, 1));
        specs.sort_by_key(|s| s.id);
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Err(Error::BadWeightSum)
        );
        // A split joint vector (0.8 on-chain + 0.2 attested) registers.
        let mut specs = default_specs(1);
        specs[1].weight = FixedU64(800_000_000);
        specs.push(spec(5, Pillar::CAttested, 200_000_000, 1));
        specs.sort_by_key(|s| s.id);
        assert_eq!(
            w.register_metric_spec(Registration::Genesis, 1, specs, &seated()),
            Ok(())
        );
    }

    #[test]
    fn daily_c_renormalizes_over_the_onchain_subset() {
        // 05 §4.4: C_daily = product over C_onchain of max(c, eps)^(w / sum_onchain w).
        // With the on-chain share at weight 0.8 of the joint vector, a daily
        // value of 0.84 renormalizes to 0.84^1 = 0.84 < theta_C_lo = 0.85
        // (breach); unrenormalized it would be 0.84^0.8 ~= 0.87 (no breach).
        let mut w = WelfareState::new();
        let mut specs = default_specs(1);
        specs[1].weight = FixedU64(800_000_000);
        specs.push(spec(5, Pillar::CAttested, 200_000_000, 1));
        specs.sort_by_key(|s| s.id);
        w.register_metric_spec(Registration::Genesis, 1, specs, &seated())
            .unwrap();
        let (flags, changed) = w
            .record_daily_gate(
                2,
                0,
                1,
                Some(1),
                vec![
                    ComponentValue {
                        id: 1,
                        value: FixedU64(ONE),
                    },
                    ComponentValue {
                        id: 2,
                        value: FixedU64(840_000_000),
                    },
                ],
                &WelfareParams::DEFAULT,
            )
            .unwrap();
        assert!(changed);
        assert!(flags.c_breached);
        assert!(!flags.s_breached);
    }

    #[test]
    fn composites_follow_the_normative_exp2_log2_pipeline() {
        // 05 §4.4 (2)/(4): weighted geometric terms evaluate as one
        // exp2(sum(w * log2(...))) — the crate primitives are <= 2 ulp, so
        // those 1e9-grid results sit within a couple of units of the exact
        // values — while the settlement score is the exact grid floor of
        // the true geometric mean (integer sqrt; 15 §4.4 bit-identity).
        let within = |actual: FixedU64, expected: u64, tol: u64| {
            assert!(
                actual.0.abs_diff(expected) <= tol,
                "actual {} expected {expected}",
                actual.0
            );
        };
        // geo: 0.25^0.5 * 1^0.5 = 0.5
        within(
            geo_pair(
                (FixedU64(250_000_000), FixedU64(500_000_000)),
                (FixedU64(ONE), FixedU64(500_000_000)),
            )
            .unwrap(),
            500_000_000,
            2,
        );
        // settlement: exact floor of the true geometric mean (05 §4.4 (4);
        // 15 §4.4 bit-identity) — on-grid means are exact, never 1 ulp short.
        assert_eq!(
            settlement_score(FixedU64(ONE), FixedU64(ONE)).unwrap(),
            FixedU64(ONE)
        );
        assert_eq!(
            settlement_score(FixedU64(640_000_000), FixedU64(250_000_000)).unwrap(),
            FixedU64(400_000_000)
        );
        assert_eq!(
            settlement_score(FixedU64(800_000_000), FixedU64(800_000_000)).unwrap(),
            FixedU64(800_000_000)
        );
        // The eps_W floor keeps a zeroed epoch finite:
        // geomean(1e-9, 0.5) ~= 2.2360679e-5, floored to the grid.
        assert_eq!(
            settlement_score(FixedU64(0), FixedU64(500_000_000)).unwrap(),
            FixedU64(22_360)
        );
    }

    #[test]
    fn try_state_rejects_corrupt_duplicate_storage() {
        let mut w = WelfareState::new();
        w.specs.push((1, default_specs(1)));
        w.specs.push((1, default_specs(1)));
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));

        let mut w = WelfareState::new();
        w.snapshots.push(Snapshot {
            epoch: 1,
            spec_version: 1,
            s_pillar: FixedU64(ONE),
            c_onchain: FixedU64(ONE),
            c_attested: FixedU64(ONE),
            p_pillar: FixedU64(ONE),
            a_pillar: FixedU64(ONE),
            gate_s: FixedU64(ONE),
            gate_c: FixedU64(ONE),
            welfare: FixedU64(ONE),
            components: Vec::new(),
        });
        w.snapshots.push(w.snapshots[0].clone());
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));
    }

    #[test]
    fn try_state_rechecks_metric_registration_invariants() {
        let mut w = WelfareState::new();
        w.specs.push((1, default_specs(1)));
        w.specs[0].1[0].epsilon_floor = FixedU64(EPSILON_PILLAR.0 - 1);
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));

        let mut w = WelfareState::new();
        w.specs.push((1, default_specs(1)));
        w.specs[0].1[3].source = SourceClass::Onchain;
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));

        let mut w = WelfareState::new();
        w.specs.push((1, default_specs(1)));
        w.specs[0].1[0].has_missing_data_rule = false;
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));

        let mut w = WelfareState::new();
        w.specs.push((1, default_specs(1)));
        w.specs[0].1[1].weight = FixedU64(ONE - 1);
        assert_eq!(w.try_state(), Err(Error::TryStateViolation));
    }

    #[test]
    fn snapshot_rejects_duplicate_epoch_spec_and_bad_incident_multiplier() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        let comps = vec![
            ComponentValue {
                id: 1,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 2,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 3,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 4,
                value: FixedU64(ONE),
            },
        ];
        assert_eq!(
            w.record_snapshot(
                7,
                1,
                &[1],
                comps.clone(),
                FixedU64(ONE + 1),
                Vec::new(),
                &WelfareParams::DEFAULT,
            ),
            Err(Error::ValueOutOfRange)
        );
        w.record_snapshot(
            7,
            1,
            &[1],
            comps.clone(),
            FixedU64(ONE),
            Vec::new(),
            &WelfareParams::DEFAULT,
        )
        .unwrap();
        assert_eq!(
            w.record_snapshot(
                7,
                1,
                &[1],
                comps,
                FixedU64(ONE),
                Vec::new(),
                &WelfareParams::DEFAULT
            ),
            Err(Error::DuplicateSnapshot)
        );
    }

    #[test]
    fn snapshots_and_settlement_bind_creation_time_spec_version() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        // Distinct activation epochs: two versions may no longer tie on their
        // maximum activation epoch (AUD-4). `default_specs` hardcodes epoch 2,
        // and this test is about creation-time spec BINDING, not activation.
        let mut v2 = default_specs(2);
        for spec in &mut v2 {
            spec.activation_epoch = 3;
        }
        w.register_metric_spec(Registration::Genesis, 2, v2, &seated())
            .unwrap();
        let comps = vec![
            ComponentValue {
                id: 1,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 2,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 3,
                value: FixedU64(ONE),
            },
            ComponentValue {
                id: 4,
                value: FixedU64(ONE),
            },
        ];
        w.record_snapshot(
            11,
            1,
            &[1],
            comps.clone(),
            FixedU64(ONE),
            Vec::new(),
            &WelfareParams::DEFAULT,
        )
        .unwrap();
        w.record_snapshot(
            12,
            1,
            &[1],
            comps,
            FixedU64(ONE),
            Vec::new(),
            &WelfareParams::DEFAULT,
        )
        .unwrap();
        assert_eq!(w.compute_settlement(10, 1), Ok(FixedU64(ONE)));
        assert_eq!(w.compute_settlement(10, 2), Err(Error::MissingComponent));
    }
    #[test]
    fn settlement_epoch_arithmetic_rejects_overflow() {
        let mut w = WelfareState::new();
        assert_eq!(
            w.compute_settlement(EpochId::MAX, 1),
            Err(Error::ArithmeticOverflow)
        );
        assert!(w.events.is_empty());
    }
    #[test]
    fn gate_and_welfare_zero_on_security_breach() {
        assert_eq!(
            gate(FixedU64(850_000_000), THETA_C_LO, THETA_C_HI).unwrap(),
            FixedU64(0)
        );
        assert_eq!(
            compute_welfare(
                FixedU64(ONE),
                FixedU64(850_000_000),
                FixedU64(ONE),
                FixedU64(ONE),
                &WelfareParams::DEFAULT,
            )
            .unwrap(),
            FixedU64(0)
        );
    }
    #[test]
    fn settlement_score_is_geometric_mean_with_epsilon_floor() {
        assert_eq!(
            settlement_score(FixedU64(ONE), FixedU64(ONE)).unwrap(),
            FixedU64(ONE)
        );
        assert_eq!(
            settlement_score(FixedU64(0), FixedU64(ONE)).unwrap().0,
            31_622
        );
    }
}
