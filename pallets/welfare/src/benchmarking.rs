//! `frame-benchmarking` v2 coverage for every welfare extrinsic (15 §4.5).
//! B5 replaces the hand-seeded weights after PoV calibration.

use super::*;
// `Vec`/`vec!` are not in the no_std prelude — the runtime's wasm
// `runtime-benchmarks` build compiles this file `no_std`, unlike the std-only
// pallet gate (B1a).
use crate::pallet::{BoundedSpecSet, Pallet};
use alloc::vec::Vec;
use frame_benchmarking::v2::*;
use frame_support::traits::Get;
use frame_support::BoundedVec;
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

/// Seed one 05 §4.3 authorship window at its 13 §4 bound.
///
/// The runtime's `MetricInputs` binding reads an authorship window on **every**
/// `record_snapshot` (the epoch aggregate) and every `record_daily_gate` (the
/// day window), so both fixtures must present the largest window the bound
/// admits or the generated weight declares a read of a value smaller than
/// production can hold. Returned for the caller to assert on: a fixture that
/// silently stops reaching the work is the defect this exists to close.
fn authorship_window<T: Config>(bound: u32) -> Result<AuthorshipWindow<T>, BenchmarkError> {
    let mut authors = Vec::new();
    for index in 0..bound {
        authors.push((account::<T::AccountId>("welfare-author", index, 0), 1u32));
    }
    Ok(AuthorshipWindow {
        authors: BoundedVec::try_from(authors)
            .map_err(|_| BenchmarkError::Stop("benchmark authorship fixture exceeds its bound"))?,
        truncated: false,
    })
}

/// Seed the epoch aggregate and one day window at their bound, and assert it.
fn seed_authorship_worst_case<T: Config>(epoch: EpochId, day: u8) -> Result<(), BenchmarkError> {
    let bound = <T as Config>::MaxCollatorAuthorshipEntries::get();
    CollatorAuthorship::<T>::insert(epoch, day, authorship_window::<T>(bound)?);
    CollatorAuthorshipEpoch::<T>::insert(epoch, authorship_window::<T>(bound)?);
    assert_eq!(
        CollatorAuthorship::<T>::get(epoch, day).authors.len() as u32,
        bound,
        "the day authorship window must be seeded at its bound",
    );
    assert_eq!(
        CollatorAuthorshipEpoch::<T>::get(epoch).authors.len() as u32,
        bound,
        "the epoch authorship aggregate must be seeded at its bound",
    );
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
        let epoch = MAX_SNAPSHOTS as u32 + 1;
        T::BenchmarkHelper::prime_finalized_epoch(epoch);
        T::BenchmarkHelper::prime_metric_inputs(MAX_COMPONENTS_PER_SPEC as u16);
        // 05 §4.3: the runtime projection reads this epoch's authorship
        // aggregate, so the fixture presents it at its bound. Indexed first, or
        // try-state would see an aggregate the reaper cannot reach.
        XcmTrafficEpochs::<T>::put(BoundedVec::truncate_from(alloc::vec![epoch]));
        seed_authorship_worst_case::<T>(epoch, 0)?;
        let caller: T::AccountId = whitelisted_caller();
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), epoch, 1);

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
        let epoch = MAX_GATE_FLAGS as u32 + 1;
        T::BenchmarkHelper::prime_finalized_epoch(epoch);
        T::BenchmarkHelper::prime_metric_inputs(MAX_COMPONENTS_PER_SPEC as u16);
        // The day projection reads day 0's authorship window (05 §4.3) and the
        // 05 §4.7 day guard reads the epoch's timing; both are seeded worst-case
        // by `prime_finalized_epoch` and the line below.
        XcmTrafficEpochs::<T>::put(BoundedVec::truncate_from(alloc::vec![epoch]));
        seed_authorship_worst_case::<T>(epoch, 0)?;
        let caller: T::AccountId = whitelisted_caller();
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), epoch, 0, 1);

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
        assert_eq!(GateBreachFlags::<T>::iter().count(), MAX_GATE_FLAGS);
        Ok(())
    }

    /// The 05 §4.3 authorship recorder at its worst case.
    ///
    /// Worst case is **both** windows full to their bound with the author
    /// already in each, at the last position: every scan runs the whole vector
    /// and then still writes. Seeding a full window whose author is *absent*
    /// would scan just as far but drop instead of writing, and seeding a short
    /// one would measure neither — so the fixture pins the one shape that pays
    /// for the full scan and the write, in the day window and in the epoch
    /// aggregate the writer maintains beside it.
    ///
    /// The epoch is pre-indexed because an unindexed one returns before either
    /// map is touched at all (the cheap path, not the dear one).
    #[benchmark]
    fn note_collator_authorship() -> Result<(), BenchmarkError> {
        let epoch: EpochId = 7;
        let day: u8 = 3;
        XcmTrafficEpochs::<T>::put(BoundedVec::truncate_from(alloc::vec![epoch]));

        let bound = <T as Config>::MaxCollatorAuthorshipEntries::get();
        let author: T::AccountId = account("welfare-author", bound, 0);
        let mut authors = Vec::new();
        for index in 0..bound.saturating_sub(1) {
            authors.push((account::<T::AccountId>("welfare-author", index, 0), 1u32));
        }
        // Last position, so `find` scans every preceding entry first.
        authors.push((author.clone(), 1));
        let seeded = AuthorshipWindow::<T> {
            authors: BoundedVec::try_from(authors).map_err(|_| {
                BenchmarkError::Stop("benchmark authorship fixture exceeds its bound")
            })?,
            truncated: false,
        };
        CollatorAuthorship::<T>::insert(epoch, day, seeded.clone());
        CollatorAuthorshipEpoch::<T>::insert(epoch, seeded);
        assert_eq!(
            CollatorAuthorship::<T>::get(epoch, day).authors.len() as u32,
            bound,
        );
        assert_eq!(
            CollatorAuthorshipEpoch::<T>::get(epoch).authors.len() as u32,
            bound,
        );

        #[block]
        {
            Pallet::<T>::note_collator_authorship(epoch, day, author.clone());
        }

        // Both windows advanced, so the measurement covered both writes.
        assert!(CollatorAuthorship::<T>::get(epoch, day)
            .authors
            .iter()
            .any(|(who, blocks)| *who == author && *blocks == 2));
        assert!(CollatorAuthorshipEpoch::<T>::get(epoch)
            .authors
            .iter()
            .any(|(who, blocks)| *who == author && *blocks == 2));
        Ok(())
    }

    /// The 05 §4.3.2 block-production recorder at its worst case.
    ///
    /// Worst case is the shared epoch index **full to its bound with the target
    /// epoch at the last position**, and the `(epoch, day)` slot already
    /// populated: the index scan runs the whole vector before matching, the
    /// index is written back regardless, and the counter read proves an existing
    /// value rather than a default. An unindexed epoch returns before the
    /// counter map is touched at all (the cheap path, not the dear one).
    ///
    /// Both signal arms perform exactly one saturating field update over the
    /// same read/write pair, so measuring either measures both; the authored
    /// arm is used because it is the one every block takes.
    #[benchmark]
    fn note_block_production() -> Result<(), BenchmarkError> {
        let epoch: EpochId = MAX_XCM_TRAFFIC_EPOCHS_BOUND - 1;
        let day: u8 = 3;
        // Last position, so `contains` scans every preceding entry first.
        let indexed = (0..MAX_XCM_TRAFFIC_EPOCHS_BOUND).collect::<Vec<EpochId>>();
        XcmTrafficEpochs::<T>::put(BoundedVec::truncate_from(indexed));
        BlockProduction::<T>::insert(
            epoch,
            day,
            BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 1,
                relay_slots: 2,
            },
        );

        #[block]
        {
            Pallet::<T>::note_block_production(
                epoch,
                day,
                BlockProductionSignal::Authored { empty: false },
            );
        }

        assert_eq!(BlockProduction::<T>::get(epoch, day).non_empty_blocks, 2);
        Ok(())
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
