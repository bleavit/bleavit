//! `frame-benchmarking` v2 coverage for every welfare extrinsic (15 §4.5).
//! B5 replaces the hand-seeded weights after PoV calibration.

use super::*;
// `Vec`/`vec!` are not in the no_std prelude — the runtime's wasm
// `runtime-benchmarks` build compiles this file `no_std`, unlike the std-only
// pallet gate (B1a).
use crate::pallet::{BoundedSpecSet, Pallet};
use alloc::vec::Vec;
use frame_benchmarking::v2::*;
use frame_system::RawOrigin;

/// A seated oracle for benchmark fixtures: 07 §2(5)'s floors met and the 13 §1
/// default bond ladder readable, so the attested components every valid spec set
/// necessarily contains are admissible. Without it each setup would abort with
/// `InsufficientOracleSeats` before anything is measured.
fn seated_oracle() -> AttestedAdmission {
    AttestedAdmission {
        reporters: 3,
        watchtowers: 2,
        reporter_min: 3,
        watchtower_min: 2,
        coverage_bps: Some(1_750),
    }
}

fn metric_spec(id: u16, pillar: Pillar, weight: u64, version: u16) -> MetricSpec {
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

/// A full 16-component spec set weighted for the **worst case of the 05 §4.4
/// aggregation**, not merely for the component bound.
///
/// The distribution matters because `S` is a `min` — cheap — while every C/P/A
/// term costs a `log2`, a multiply and (under 07 §10's renormalization) a
/// divide. A set that spent 12 of its 16 slots on `S` filled the bound while
/// leaving four transcendental terms to measure; this one leaves twelve. The
/// joint C vector's eight components carry `ONE / 8` each, so the vector sums to
/// exactly 1 on the 1e9 grid, and both C sources stay live so the attested
/// incident-multiplier path is exercised too.
pub fn full_specs(version: u16) -> Vec<MetricSpec> {
    let mut specs = (1..=4)
        .map(|id| metric_spec(id, Pillar::S, 0, version))
        .collect::<Vec<_>>();
    for id in 5..=9 {
        specs.push(metric_spec(id, Pillar::COnchain, ONE / 8, version));
    }
    for id in 10..=12 {
        specs.push(metric_spec(id, Pillar::CAttested, ONE / 8, version));
    }
    specs.push(metric_spec(13, Pillar::P, ONE / 2, version));
    specs.push(metric_spec(14, Pillar::P, ONE / 2, version));
    specs.push(metric_spec(15, Pillar::A, ONE / 2, version));
    specs.push(metric_spec(16, Pillar::A, ONE / 2, version));
    specs
}

/// The attested components of [`full_specs`] — the only ones 07 §10 can flag
/// (§11(1) consequence (i)), and therefore the worst-case flagged set.
pub fn attested_ids() -> Vec<futarchy_primitives::MetricId> {
    full_specs(0)
        .into_iter()
        .filter(|spec| spec.source == SourceClass::Attested)
        .map(|spec| spec.id)
        .collect()
}

pub fn healthy(count: u16) -> Vec<ComponentValue> {
    (1..=count)
        .map(|id| ComponentValue {
            id,
            value: FixedU64(ONE),
        })
        .collect()
}

/// Component values strictly **inside** `(ε, 1)`, so every weighted-geometric
/// term is actually evaluated.
///
/// [`healthy`] returns exactly 1.0, at which 05 §4.4's product skips every term
/// (`x^w = 1`) and both gates saturate — so a snapshot benchmark built on it
/// measures the bookkeeping and none of the arithmetic. The value is also kept
/// away from the `θ⁻` floors, so `g(S)` and `g(C)` land on the interior
/// smoothstep branch rather than the constant one.
pub fn degraded(count: u16) -> Vec<ComponentValue> {
    (1..=count)
        .map(|id| ComponentValue {
            id,
            value: FixedU64(930_000_000),
        })
        .collect()
}

fn fill_snapshots(state: &mut WelfareState, count: usize) -> Result<(), BenchmarkError> {
    for epoch in 2..(count as u32 + 2) {
        state
            .record_snapshot(
                epoch,
                1,
                degraded(MAX_COMPONENTS_PER_SPEC as u16),
                FixedU64(ONE),
                // Worst-case 07 §10 context: every flaggable component flagged,
                // which is also the largest record the pallet mirror stores.
                attested_ids(),
                &CoreWelfareParams::DEFAULT,
            )
            .map_err(|_| BenchmarkError::Stop("benchmark snapshot setup failed"))?;
    }
    Ok(())
}

fn fill_gate_flags(state: &mut WelfareState, count: usize) -> Result<(), BenchmarkError> {
    for epoch in 2..(count as u32 + 2) {
        state
            .record_daily_gate(
                epoch,
                0,
                1,
                degraded(MAX_COMPONENTS_PER_SPEC as u16),
                &CoreWelfareParams::DEFAULT,
            )
            .map_err(|_| BenchmarkError::Stop("benchmark gate setup failed"))?;
    }
    Ok(())
}

fn fill_specs(state: &mut WelfareState, first_version: u16) -> Result<(), BenchmarkError> {
    for version in first_version..=MAX_METRIC_SPECS as u16 {
        state
            .register_metric_spec(
                Registration::Genesis,
                version,
                full_specs(version),
                &seated_oracle(),
            )
            .map_err(|_| BenchmarkError::Stop("benchmark spec setup failed"))?;
    }
    Ok(())
}

#[benchmarks]
mod benches {
    use super::*;

    #[benchmark]
    fn register_spec() -> Result<(), BenchmarkError> {
        // 07 §2(5): every valid spec set contains an attested component (05 §4.3
        // makes the A pillar attested, §4.4 makes it mandatory), so an unseated
        // oracle refuses the dispatch with `InsufficientOracleSeats` and nothing
        // downstream is measured (SQ-341).
        T::BenchmarkHelper::seat_oracle();
        let mut state = WelfareState::new();
        for version in 1..MAX_METRIC_SPECS as u16 {
            state
                .register_metric_spec(
                    Registration::Genesis,
                    version,
                    full_specs(version),
                    &seated_oracle(),
                )
                .map_err(|_| BenchmarkError::Stop("benchmark setup failed"))?;
        }
        fill_snapshots(&mut state, MAX_SNAPSHOTS)?;
        fill_gate_flags(&mut state, MAX_GATE_FLAGS)?;
        Pallet::<T>::seed(&state)?;
        let version = MAX_METRIC_SPECS as u16;
        // The extrinsic registers at the live clock, so its specs must clear the
        // two-epoch activation lead (05 §4.6) — unlike the epoch-0 seed above.
        let activation =
            <T::CurrentEpoch as frame_support::traits::Get<EpochId>>::get().saturating_add(2);
        let specs_vec = full_specs(version)
            .into_iter()
            .map(|spec| MetricSpec {
                activation_epoch: activation,
                ..spec
            })
            .collect::<Vec<_>>();
        let specs = BoundedSpecSet::try_from(specs_vec)
            .map_err(|_| BenchmarkError::Stop("benchmark specs exceed bound"))?;
        let origin = T::BenchmarkHelper::metric_governance_origin();

        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, version, specs);

        assert_eq!(MetricSpecs::<T>::iter().count(), MAX_METRIC_SPECS);
        Ok(())
    }

    #[benchmark]
    fn record_snapshot() -> Result<(), BenchmarkError> {
        let mut state = WelfareState::new();
        state
            .register_metric_spec(Registration::Genesis, 1, full_specs(1), &seated_oracle())
            .map_err(|_| BenchmarkError::Stop("benchmark setup failed"))?;
        fill_specs(&mut state, 2)?;
        fill_snapshots(&mut state, MAX_SNAPSHOTS - 1)?;
        fill_gate_flags(&mut state, MAX_GATE_FLAGS)?;
        Pallet::<T>::seed(&state)?;
        T::BenchmarkHelper::prime_finalized_epoch(MAX_SNAPSHOTS as u32 + 1);
        T::BenchmarkHelper::prime_metric_inputs(MAX_COMPONENTS_PER_SPEC as u16);
        let caller: T::AccountId = whitelisted_caller();
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), MAX_SNAPSHOTS as u32 + 1, 1);

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::DecisionCritical,
        );
        assert_eq!(Snapshots::<T>::iter().count(), MAX_SNAPSHOTS);
        Ok(())
    }

    #[benchmark]
    fn record_daily_gate() -> Result<(), BenchmarkError> {
        let mut state = WelfareState::new();
        state
            .register_metric_spec(Registration::Genesis, 1, full_specs(1), &seated_oracle())
            .map_err(|_| BenchmarkError::Stop("benchmark setup failed"))?;
        fill_specs(&mut state, 2)?;
        fill_snapshots(&mut state, MAX_SNAPSHOTS)?;
        fill_gate_flags(&mut state, MAX_GATE_FLAGS - 1)?;
        Pallet::<T>::seed(&state)?;
        T::BenchmarkHelper::prime_finalized_epoch(MAX_GATE_FLAGS as u32 + 1);
        T::BenchmarkHelper::prime_metric_inputs(MAX_COMPONENTS_PER_SPEC as u16);
        let caller: T::AccountId = whitelisted_caller();
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), MAX_GATE_FLAGS as u32 + 1, 0, 1);

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
        assert_eq!(GateBreachFlags::<T>::iter().count(), MAX_GATE_FLAGS);
        Ok(())
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
