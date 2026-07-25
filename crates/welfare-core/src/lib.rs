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

pub const ONE: u64 = 1_000_000_000;
pub const EPSILON: FixedU64 = FixedU64(1);
pub const EPSILON_PILLAR: FixedU64 = FixedU64(10_000_000);
pub const MAX_METRIC_SPECS: usize = 16;
pub const MAX_SNAPSHOTS: usize = 20;
pub const MAX_GATE_FLAGS: usize = MAX_SNAPSHOTS;
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    /// Registered reporters holding a full stake (07 §3).
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
        self.specs.push((version, specs));
        self.events.push(Event::MetricSpecRegistered { version });
        Ok(())
    }

    pub fn record_snapshot(
        &mut self,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
        components: Vec<ComponentValue>,
        incident_multiplier: FixedU64,
        params: &WelfareParams,
    ) -> Result<FixedU64, Error> {
        params.validate()?;
        let specs = self.spec(spec_version)?.to_vec();
        ensure!(
            specs.iter().all(|spec| spec.activation_epoch <= epoch),
            Error::SpecNotActive
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
        self.events.push(Event::SnapshotRecorded {
            epoch,
            spec_version,
            welfare,
        });
        Ok(welfare)
    }

    pub fn record_daily_gate(
        &mut self,
        epoch: EpochId,
        day: u8,
        spec_version: MetricSpecVersion,
        components: Vec<ComponentValue>,
        params: &WelfareParams,
    ) -> Result<(GateBreachFlags, bool), Error> {
        params.validate()?;
        let specs = self.spec(spec_version)?.to_vec();
        ensure!(
            specs.iter().all(|spec| spec.activation_epoch <= epoch),
            Error::SpecNotActive
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
        let w1 = self.snapshot(first_epoch, spec_version)?.welfare;
        let w2 = self.snapshot(second_epoch, spec_version)?.welfare;
        let score = settlement_score(w1, w2)?;
        self.events.push(Event::SettlementComputed {
            epoch: cohort_epoch,
            spec_version,
            score,
        });
        Ok(score)
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
        exponent = exponent
            .checked_add(mul_ceil_q64(log, weight)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
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
        exponent = exponent
            .checked_add(mul_ceil_q64(log, q64_from_1e9(weight.0)?)?)
            .map_err(|_| Error::ArithmeticOverflow)?;
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
    let gs = gate(s, params.theta_s_lo, params.theta_s_hi)?;
    let gc = gate(c, params.theta_c_lo, params.theta_c_hi)?;
    let pa = geo_pair((p, params.w_p), (a, params.w_a))?;
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
                healthy_components(),
                FixedU64(ONE),
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
                healthy_components(),
                FixedU64(ONE),
                &WelfareParams::DEFAULT,
            ),
            Err(Error::SpecNotActive)
        );
        assert_eq!(
            w.record_daily_gate(1, 0, 1, healthy_components(), &WelfareParams::DEFAULT,),
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
        for epoch in 2..MAX_SNAPSHOTS as u32 + 2 {
            w.record_snapshot(
                epoch,
                1,
                healthy_components(),
                FixedU64(ONE),
                &WelfareParams::DEFAULT,
            )
            .unwrap();
            w.record_daily_gate(epoch, 0, 1, healthy_components(), &WelfareParams::DEFAULT)
                .unwrap();
        }
        w.events.clear();
        w.prune_before(3);
        assert!(w.events.is_empty());
        assert!(w.snapshots.iter().all(|snapshot| snapshot.epoch >= 3));
        assert!(w.gate_flags.iter().all(|(epoch, _)| *epoch >= 3));
        assert_eq!(w.specs.len(), 1);

        let next = MAX_SNAPSHOTS as u32 + 2;
        assert!(w
            .record_snapshot(
                next,
                1,
                healthy_components(),
                FixedU64(ONE),
                &WelfareParams::DEFAULT,
            )
            .is_ok());
        assert!(w
            .record_daily_gate(next, 0, 1, healthy_components(), &WelfareParams::DEFAULT,)
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
            .record_daily_gate(2, 0, 1, healthy_components(), &WelfareParams::DEFAULT)
            .unwrap();
        let (_, duplicate_changed) = w
            .record_daily_gate(2, 0, 1, healthy_components(), &WelfareParams::DEFAULT)
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
            .record_daily_gate(2, 0, 1, breached.clone(), &WelfareParams::DEFAULT)
            .unwrap();
        let (_, repeated_augmentation) = w
            .record_daily_gate(2, 0, 1, breached, &WelfareParams::DEFAULT)
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
            .record_daily_gate(2, 3, 1, healthy_components(), &WelfareParams::DEFAULT)
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
            .record_daily_gate(2, 5, 1, breached, &WelfareParams::DEFAULT)
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
                comps.clone(),
                FixedU64(ONE + 1),
                &WelfareParams::DEFAULT,
            ),
            Err(Error::ValueOutOfRange)
        );
        w.record_snapshot(7, 1, comps.clone(), FixedU64(ONE), &WelfareParams::DEFAULT)
            .unwrap();
        assert_eq!(
            w.record_snapshot(7, 1, comps, FixedU64(ONE), &WelfareParams::DEFAULT),
            Err(Error::DuplicateSnapshot)
        );
    }

    #[test]
    fn snapshots_and_settlement_bind_creation_time_spec_version() {
        let mut w = WelfareState::new();
        w.register_metric_spec(Registration::Genesis, 1, default_specs(1), &seated())
            .unwrap();
        w.register_metric_spec(Registration::Genesis, 2, default_specs(2), &seated())
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
        w.record_snapshot(11, 1, comps.clone(), FixedU64(ONE), &WelfareParams::DEFAULT)
            .unwrap();
        w.record_snapshot(12, 1, comps, FixedU64(ONE), &WelfareParams::DEFAULT)
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
