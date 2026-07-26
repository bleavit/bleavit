//! B5 PoV-budget enforcement (15 §4.5; 13 §4–§5; I-20).
//!
//! Two layers:
//! 1. **Storage-shape budgets** — the 13 §5 derived-value cross-checks,
//!    recomputed from the real `MaxEncodedLen` figures (resolving 13 §5's
//!    "[VERIFY] at benchmark time" tags). The asserted byte models are pinned
//!    so silent struct growth reopens the 13 §5 derivation (its item 6
//!    parameter-coupling rule).
//! 2. **Per-call PoV tracking** — every futarchy-pallet call and hook weight,
//!    as generated into `crate::weights` by `frame-omni-bencher`, must fit the
//!    normal-class block budget at its worst component arguments; and the two
//!    calls 13 §5 item 1 singles out (`decide`, `settle_cohort`) carry pinned
//!    proof-size regression ceilings proving per-call PoV stays bounded
//!    independent of the retained-market map ceiling.

use crate::configs::RuntimeBlockWeights;
use crate::{AccountId, Runtime};
use frame_support::dispatch::DispatchClass;
use frame_support::traits::{ConstU32, Get};
use frame_support::weights::Weight;
use pallet_epoch::{MAX_COHORT_PROPOSALS_BOUND, TICK_BATCH_BOUND};
use pallet_execution_guard::MAX_CALLS_BOUND;
use pallet_oracle::MAX_PROOF_BYTES_BOUND;
use parity_scale_codec::MaxEncodedLen;

const KIB: usize = 1024;

/// 13 §4: `MaxLiveMarkets` = 196 = 32·6 + 4.
const MAX_LIVE_MARKETS: usize = futarchy_primitives::bounds::MAX_LIVE_MARKETS as usize;
/// 13 §4: archive-derived present `Markets` rows, including terminal books.
const MAX_STORED_MARKETS: usize = futarchy_primitives::bounds::MAX_STORED_MARKETS as usize;
/// 13 §5 item 2: ≤ 32 live + 4 cohorts × 5 settling = 52 vaults.
const MAX_LIVE_VAULTS: usize = 52;
/// 04 §7 / 13 §4: `TwapCheckpoints: BoundedVec<(BlockNumber, Cum), 8>` at
/// its implemented maximum:
/// 8 × (4 B `u32` block + 32 B u256 two-limb cumulative) + 1 length byte.
const SPEC_TWAP_CHECKPOINTS_BYTES: usize = 8 * (4 + 32) + 1;
/// The benchmark fixture ceiling for `apply_authorized_upgrade` code blobs
/// (`BENCHMARK_RUNTIME_CODE_BYTES_BOUND` in the execution-guard benchmarks;
/// benchmark-cfg'd, so restated here): 4 MiB.
const RUNTIME_CODE_BYTES_BOUND: u32 = 4_194_304;

/// The normal-class total budget: 75 % of the relay `MAX_POV_SIZE` /
/// 2-second ref-time block (`configs::MAXIMUM_BLOCK_WEIGHT`).
fn normal_class_budget() -> Weight {
    RuntimeBlockWeights::get()
        .get(DispatchClass::Normal)
        .max_total
        .unwrap_or_else(|| RuntimeBlockWeights::get().max_block)
}

fn operational_class_budget() -> Weight {
    RuntimeBlockWeights::get()
        .get(DispatchClass::Operational)
        .max_total
        .unwrap_or_else(|| RuntimeBlockWeights::get().max_block)
}

fn assert_fits(name: &str, w: Weight) {
    let m = normal_class_budget();
    assert!(
        w.ref_time() <= m.ref_time(),
        "{name}: ref_time {} exceeds the normal-class budget {}",
        w.ref_time(),
        m.ref_time()
    );
    assert!(
        w.proof_size() <= m.proof_size(),
        "{name}: proof_size {} exceeds the normal-class budget {}",
        w.proof_size(),
        m.proof_size()
    );
}

// --- 13 §5 item 1: market map ceiling ----------------------------------------

#[test]
fn market_map_ceiling_within_13_5_budget() {
    let book = market_core::MarketBook::<AccountId>::max_encoded_len();
    assert_eq!(book, 205, "MarketBook measured MaxEncodedLen drifted");
    assert_eq!(MAX_STORED_MARKETS, 2_240, "stored-market bound drifted");
    assert!(
        MAX_STORED_MARKETS * book <= 512 * KIB,
        "stored-market map ceiling exceeds the 512 KiB budget: {} B",
        MAX_STORED_MARKETS * book
    );
}

// --- 13 §5 item 2: vault ceiling ----------------------------------------------

#[test]
fn vault_ceiling_within_13_5_budget() {
    // What the runtime actually stores per vault: `Vaults: ProposalId →
    // VaultInfo` and `BaselineVaults: EpochId → BaselineVaultInfo`; the
    // conservative per-entry figure is the larger of the two.
    let vault = conditional_ledger_core::VaultInfo::max_encoded_len()
        .max(conditional_ledger_core::BaselineVaultInfo::max_encoded_len());
    assert!(
        vault <= 256,
        "vault storage value grew past the 13 §5 ~256 B model: {vault} B"
    );
    assert!(
        MAX_LIVE_VAULTS * vault <= 13 * KIB,
        "52-vault ceiling exceeds the 13 KiB budget: {} B",
        MAX_LIVE_VAULTS * vault
    );
}

// --- 13 §5 item 7: chain-served history budget ---------------------------------

#[test]
fn chain_served_history_within_13_5_budget() {
    let summary = futarchy_primitives::CohortSummary::max_encoded_len();
    assert!(
        summary <= 256,
        "CohortSummary grew past the 13 §5 ~256 B model: {summary} B"
    );
    let cohort_history = pallet_epoch::Recent::max_encoded_len();
    assert_eq!(
        cohort_history, 5_057,
        "RecentCohortSummaries measured MaxEncodedLen drifted",
    );
    type TwapCheckpointRing = frame_support::BoundedVec<
        (
            futarchy_primitives::BlockNumber,
            market_core::TwapCumulative,
        ),
        ConstU32<8>,
    >;
    let checkpoints = TwapCheckpointRing::max_encoded_len();
    assert_eq!(
        checkpoints, SPEC_TWAP_CHECKPOINTS_BYTES,
        "TwapCheckpoints measured MaxEncodedLen drifted",
    );
    let total = cohort_history + MAX_LIVE_MARKETS * checkpoints;
    assert_eq!(total, 61_701, "chain-served history byte model drifted");
    assert!(
        total <= 70 * KIB,
        "chain-served history exceeds the 70 KiB D-6 layer-1 budget: {total} B"
    );
}

// --- Per-call PoV tracking (every futarchy call and hook, worst-case args) -----

macro_rules! pallet_call_weights {
    ($module:ident as $trait_:path { $($f:ident $(($arg:expr))?),+ $(,)? }) => {
        [$((
            concat!(stringify!($module), "::", stringify!($f)),
            <crate::weights::$module::WeightInfo<Runtime> as $trait_>::$f($($arg)?),
        )),+]
    };
}

fn all_futarchy_call_weights() -> alloc::vec::Vec<(&'static str, Weight)> {
    let round_close_batch = <Runtime as pallet_oracle::Config>::MaxRoundCloseBatch::get();
    let mut all = alloc::vec::Vec::new();
    all.extend(
        pallet_call_weights!(pallet_origins as pallet_origins::WeightInfo {
            safety_filter,
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_constitution as pallet_constitution::WeightInfo {
            set_param, set_capability, set_phase_flag, set_release_channel, amend_registry,
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_conditional_ledger as pallet_conditional_ledger::WeightInfo {
            split, merge, split_scalar, merge_scalar, split_gate, merge_gate, transfer,
            split_baseline, merge_baseline, resolve, void, settle_scalar, settle_gate,
            settle_baseline, redeem, redeem_scalar, redeem_scalar_pair, redeem_gate,
            redeem_void, redeem_baseline, redeem_baseline_pair, sweep_dust,
            sweep_dust_baseline, set_split_paused, set_frozen, reconcile,
        }),
    );
    all.push((
        "pallet_conditional_ledger::migration_step",
        <crate::weights::pallet_conditional_ledger::WeightInfo<Runtime> as
            pallet_conditional_ledger::WeightInfo>::migration_step_row()
        .max(
            <crate::weights::pallet_conditional_ledger::WeightInfo<Runtime> as
                pallet_conditional_ledger::WeightInfo>::migration_step_terminal(),
        ),
    ));
    all.extend(
        pallet_call_weights!(pallet_market as pallet_market::WeightInfo {
            buy, sell, crank_observe, reap, freeze_creation, set_frozen,
            create_market, seed, close,
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_welfare as pallet_welfare::WeightInfo {
            register_spec, record_snapshot, record_daily_gate,
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_oracle as pallet_oracle::WeightInfo {
            register_reporter, deregister_reporter, register_watchtower, report,
            challenge, counter_report, adjudicate, ack_observed, crank_reserve_probe,
            recompute_proof(MAX_PROOF_BYTES_BOUND),
            crank_round_close(round_close_batch),
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_registry as pallet_registry::WeightInfo {
            file, challenge_filing, ack_observed, crank_close, close_epoch, reap_epoch,
            resolve_challenge,
        }),
    );
    all.extend(
        // `create_community_schedule` was missing from this sweep until SQ-490.
        pallet_call_weights!(pallet_futarchy_treasury as pallet_futarchy_treasury::WeightInfo {
            spend, open_stream, claim_stream, cancel_stream, fund_budget_line, issue_vit,
            recover_foreign, execute_coretime_renewal, note_coretime_quote,
            prune_coretime_quote, set_coretime_authority, sweep_insurance,
            create_community_schedule,
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_guardian as pallet_guardian::WeightInfo {
            set_members, propose_action, approve_action, ratify_action, renew_playbook,
            uphold_veto, recall, set_playbook_registered, on_initialize,
        }),
    );
    all.extend(
        // `remove_for_cause` and `reap_attestation` were missing from this sweep
        // until SQ-490 — both are live dispatchables, so I-20 covers them, and
        // `remove_for_cause` is the heaviest call in the pallet (it revokes every
        // unexecuted record of the removed member, 261 reads at the full
        // `MAX_ATTESTATIONS` ledger). Its hand-written weight had declared 8.
        pallet_call_weights!(pallet_attestor as pallet_attestor::WeightInfo {
            set_members, attest, challenge_attestation, resolve_challenge,
            remove_for_cause, reap_attestation,
        }),
    );
    // The three clock-syncing cranks charge the A13 collator payout on top of
    // their own benchmarked work, composed at each `#[pallet::weight]` attribute
    // (SQ-490). The generated function is therefore only *one addend* of what the
    // chain dispatches, and I-20 is a statement about the dispatched weight — so
    // the composed total is what has to fit the class here.
    let collator_payout = <crate::weights::pallet_epoch::WeightInfo<Runtime> as pallet_epoch::WeightInfo>::collator_compensation();
    all.extend(
        pallet_call_weights!(pallet_epoch as pallet_epoch::WeightInfo {
            submit, withdraw, decide, set_next_epoch_length, delay_once,
            mark_executed, mark_failed_executed, retry_exhausted_to_measurement,
            expire_or_stale_queue, force_reject_process_hold, finalize_epoch_baseline,
            drive_oracle_boundaries, bind_ratification,
            tick(TICK_BATCH_BOUND),
            settle_cohort(MAX_COHORT_PROPOSALS_BOUND),
            void_cohort(MAX_COHORT_PROPOSALS_BOUND),
            set_intake_paused,
        })
        .into_iter()
        .map(|(name, weight)| match name {
            "pallet_epoch::tick" | "pallet_epoch::decide" | "pallet_epoch::settle_cohort" => {
                (name, weight.saturating_add(collator_payout))
            }
            _ => (name, weight),
        }),
    );
    all.extend(
        // `qualify_recovery_image` is deliberately absent: it is
        // `DispatchClass::Operational`, and `recovery_qualifier_and_mandatory_hooks_
        // fit_absolute_class_budgets` already checks it against the Operational
        // budget. Adding it here would assert the wrong class.
        pallet_call_weights!(pallet_execution_guard as pallet_execution_guard::WeightInfo {
            ratify, reject_stale, expire_failed_execution,
            execute(MAX_CALLS_BOUND),
            apply_authorized_upgrade(RUNTIME_CODE_BYTES_BOUND),
            commit_recovery_image, authorize_phase_four,
        }),
    );
    all
}

/// I-20 / 15 §4.5: every production-dispatched futarchy call and block hook, at
/// its worst component arguments, fits the normal dispatch class. The
/// `try-runtime`-only market `try_state` hook is deliberately excluded: it is
/// executed out of band against a state snapshot, never included in a normal
/// block, and its saturated 2,240-book weight remains generated and regression
/// gated separately.
#[test]
fn every_futarchy_call_and_hook_fits_the_normal_class() {
    let all = all_futarchy_call_weights();
    // Exact count of the 12 futarchy pallets' WeightInfo functions — update
    // in lockstep when a trait gains or loses a function, so a silently
    // dropped inventory entry cannot pass.
    //
    // 112 -> 115 with SQ-490: three live Normal-class dispatchables had never
    // been listed here at all (`attestor::remove_for_cause`,
    // `attestor::reap_attestation`, `futarchy_treasury::create_community_schedule`).
    // This pin detects a *dropped* entry but could not detect a *never-added*
    // one, because the list and the count were maintained by the same hand —
    // which is why SQ-490 item (4) should derive the list from call metadata.
    assert_eq!(all.len(), 115, "call inventory drifted");
    for (name, w) in all {
        assert_fits(name, w);
    }
}

/// `claim_assets` is Public after B10's trap-recovery opening. Keep its
/// generated proof bound in the same worst-case audit as the futarchy calls.
#[test]
fn xcm_claim_assets_fits_the_normal_class() {
    let claim =
        <crate::weights::pallet_xcm::WeightInfo<Runtime> as pallet_xcm::WeightInfo>::claim_assets();
    assert_eq!(
        claim.proof_size(),
        5_469,
        "claim_assets proof bound drifted"
    );
    assert_fits("pallet_xcm::claim_assets", claim);
}

#[test]
fn recovery_qualifier_and_mandatory_hooks_fit_absolute_class_budgets() {
    let qualifier =
        <crate::weights::pallet_execution_guard::WeightInfo<Runtime> as pallet_execution_guard::WeightInfo>::qualify_recovery_image(
            RUNTIME_CODE_BYTES_BOUND,
        );
    let operational = operational_class_budget();
    assert!(
        qualifier.all_lte(operational),
        "recovery qualifier {qualifier:?} exceeds Operational {operational:?}",
    );

    let generated_schedule_floor = qualifier
        .saturating_add(
            <<Runtime as frame_system::Config>::SystemWeightInfo as frame_system::WeightInfo>::authorize_upgrade(),
        )
        .saturating_add(
            <<Runtime as frame_system::Config>::SystemWeightInfo as frame_system::WeightInfo>::apply_authorized_upgrade(),
        );
    let charged_schedule = crate::configs::recovery_schedule_hook_weight(RUNTIME_CODE_BYTES_BOUND);
    assert!(
        generated_schedule_floor.all_lte(charged_schedule),
        "mandatory recovery schedule {charged_schedule:?} omits generated qualification/authorize/apply floor {generated_schedule_floor:?}",
    );

    let mandatory = RuntimeBlockWeights::get().max_block;
    for (name, weight) in [
        (
            "combined recovery validation-data mandatory path",
            crate::configs::migration_validation_hook_weight()
                .saturating_add(crate::configs::dead_man_detector_hook_weight())
                .saturating_add(crate::configs::recovery_schedule_hook_weight(
                    RUNTIME_CODE_BYTES_BOUND,
                ))
                // Cumulus may call `on_validation_code_applied` and then
                // `on_validation_data` in one inherent. The application
                // callback therefore adds the bounded installed-code
                // read/hash path to the full scheduling charge.
                .saturating_add(crate::configs::recovery_hook_weight(
                    RUNTIME_CODE_BYTES_BOUND,
                )),
        ),
        (
            "phase-four transition",
            crate::migrations::phase_four_transition_weight(),
        ),
        (
            "terminal recovery transition",
            crate::migrations::terminal_recovery_transition_weight(),
        ),
    ] {
        assert!(
            weight.all_lte(mandatory),
            "{name} {weight:?} exceeds mandatory block budget {mandatory:?}",
        );
    }
}

/// 13 §5 item 1: "`decide(pid)` reads ≤ 6 proposal books + 1 Baseline + O(10)
/// params — PoV per call bounded regardless of map ceiling." Pinned regression
/// ceilings over the **dispatched** weight — i.e. the generated function plus the
/// A13 collator-compensation term each of these calls composes at its
/// `#[pallet::weight]` attribute (SQ-490). Read through `get_dispatch_info()` on
/// purpose: pinning the generated method alone would pin one addend of what the
/// chain actually charges, which is what this test did before the composition
/// moved out of the generated file.
///
/// `decide` moved 231,055 -> 404,514 B with SQ-494, then 404,514 -> 745,551 B
/// with SQ-490. Both moves are **measurements**, not regressions. SQ-494's: the
/// benchmark seeded no `Rounds`, so 07 §12's ProcessHold predicate scanned an
/// empty map. SQ-490's: the collator-compensation term stopped being a
/// hand-written 48,000 B guess and became a benchmark, which returned an
/// **estimated** 389,037 B.
///
/// That 8x jump is the generator's synthetic per-key envelope, not a real proof:
/// the payout touches `ForeignAssets::Account` for 120 payees and the estimator
/// charges each as an independent maximum-depth trie path, ignoring their shared
/// asset prefix — the same behavior `tick`'s `pov_mode` annotation already
/// documents for an unbounded double map. The benchmark's *recorded* proof was
/// 17,874 B, ~22x smaller. It is kept at the estimate anyway, because the
/// directions of error are not symmetric: over-declaring PoV costs block
/// capacity, while under-declaring it produces blocks that exceed their proof
/// budget at execution. A sparse benchmark trie under-represents production path
/// depth, so `Measured` here would be optimistic about the wrong thing.
///
/// The capacity cost that buys is real and quantified: `decide` is now 19.0 % of
/// the 3,932,160 B normal-class budget and `settle_cohort(12)` 23.9 %, so a
/// crank charges ~389 KB of proof for a payout that fires once an epoch. The fix
/// is the post-dispatch refund 15 §4.5 already mandates for payload-executing
/// extrinsics; it is recorded as its own row rather than done here.
#[test]
fn decide_and_settle_cohort_pov_pinned_below_map_scaling() {
    use frame_support::dispatch::GetDispatchInfo;

    let decide = crate::RuntimeCall::Epoch(pallet_epoch::Call::decide { pid: 1 })
        .get_dispatch_info()
        .call_weight;
    assert_eq!(
        decide.proof_size(),
        745_551,
        "decide proof_size drifted from the 13 §5 dispatched-weight estimate"
    );
    assert!(
        decide.proof_size() <= 1024 * KIB as u64,
        "decide proof_size regressed past its pinned ceiling: {}",
        decide.proof_size()
    );
    let settle_five =
        crate::RuntimeCall::Epoch(pallet_epoch::Call::settle_cohort { epoch: 1, batch: 5 })
            .get_dispatch_info()
            .call_weight;
    assert_eq!(
        settle_five.proof_size(),
        725_862,
        "settle_cohort(5) proof_size drifted from the 13 §5 dispatched-weight estimate"
    );
    let settle = crate::RuntimeCall::Epoch(pallet_epoch::Call::settle_cohort {
        epoch: 1,
        batch: MAX_COHORT_PROPOSALS_BOUND,
    })
    .get_dispatch_info()
    .call_weight;
    assert!(
        settle.proof_size() <= 1280 * KIB as u64,
        "settle_cohort proof_size regressed past its pinned ceiling: {}",
        settle.proof_size()
    );
}
