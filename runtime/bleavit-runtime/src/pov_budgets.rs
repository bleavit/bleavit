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
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::{String, ToString};
use frame_support::dispatch::DispatchClass;
use frame_support::traits::{ConstU32, Get, GetCallMetadata};
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
/// 13 §5 item 2: ≤ 32 live + 4 cohorts × 5 settling = 52 vaults. Single-homed
/// in the kernel since SQ-501, where the occupancy screen re-derives it.
const MAX_LIVE_VAULTS: usize = futarchy_primitives::kernel::LIVE_VAULT_ENVELOPE as usize;
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
    assert_eq!(
        book,
        futarchy_primitives::kernel::MARKET_BOOK_MAX_BYTES as usize,
        "MarketBook measured MaxEncodedLen drifted from the 13 §5 item 1 figure"
    );
    assert_eq!(MAX_STORED_MARKETS, 2_240, "stored-market bound drifted");
    let budget = futarchy_primitives::kernel::RETAINED_MARKETS_BUDGET_BYTES as usize;
    assert_eq!(budget, 512 * KIB);
    assert!(
        MAX_STORED_MARKETS * book <= budget,
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
    let pinned = futarchy_primitives::kernel::VAULT_MAX_BYTES as usize;
    assert!(
        vault <= pinned,
        "vault storage value grew past the 13 §5 ~256 B model: {vault} B"
    );
    let budget = futarchy_primitives::kernel::VAULT_OCCUPANCY_BUDGET_BYTES as usize;
    assert_eq!(budget, 13 * KIB);
    // The pinned per-vault ceiling is what sized the budget (52 × 256 B), and
    // it is what the SQ-501 occupancy screen measures a proposed `epoch.slots`
    // against — so assert the budget at the ceiling, not only at the measurement.
    assert!(
        MAX_LIVE_VAULTS * pinned <= budget,
        "52-vault ceiling at the pinned per-vault size exceeds the 13 KiB budget: {} B",
        MAX_LIVE_VAULTS * pinned
    );
    assert!(
        MAX_LIVE_VAULTS * vault <= budget,
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
        // `set_param` composes the `BudgetDerivationGuard` seam's declared cost at
        // its `#[pallet::weight]` attribute (SQ-501): the SQ-501 occupancy screen
        // reads bounded in-flight epoch state, which the generated function does
        // not measure. I-20 is a statement about the **dispatched** weight, so the
        // composed total is what has to fit the class here — the same reason the
        // three clock-syncing cranks add their collator term below.
        pallet_call_weights!(pallet_constitution as pallet_constitution::WeightInfo {
            set_param, set_capability, set_phase_flag, set_release_channel, amend_registry,
        })
        .into_iter()
        .map(|(name, weight)| {
            match name {
            "pallet_constitution::set_param" => (
                name,
                weight.saturating_add(
                    <crate::configs::RuntimeBudgetDerivationGuard as
                        pallet_constitution::BudgetDerivationGuard>::max_weight(),
                ),
            ),
            _ => (name, weight),
        }
        }),
    );
    all.extend(
        pallet_call_weights!(pallet_conditional_ledger as pallet_conditional_ledger::WeightInfo {
            split, merge, split_scalar, merge_scalar, split_gate, merge_gate, transfer,
            split_baseline, merge_baseline, resolve, void, settle_scalar, settle_gate,
            settle_baseline, redeem, redeem_scalar, redeem_scalar_pair, redeem_gate,
            redeem_void, redeem_baseline, redeem_baseline_pair, sweep_dust,
            sweep_dust_baseline, sweep_redemption_fees, set_split_paused, set_frozen,
            reconcile,
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
            buy, sell, crank_observe, sweep_revenue, reap, freeze_creation, set_frozen,
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
            reconcile_insurance, create_community_schedule,
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

// --- I-20 inventory derivation (SQ-490 item 4) --------------------------------
//
// `all_futarchy_call_weights` is a hand-written list, and until SQ-490 its only
// completeness check was a hand-written count of its own length. Two hands
// maintaining one fact detect a *dropped* entry and are structurally blind to a
// *never-added* one — which is exactly what happened: three live Normal-class
// dispatchables (`attestor::remove_for_cause`, `attestor::reap_attestation`,
// `futarchy_treasury::create_community_schedule`) had never appeared in the
// sweep at all, so I-20 never covered them.
//
// The inventory is therefore derived from the runtime's own call metadata
// (`GetCallMetadata`, the surface `construct_runtime!` generates). Every
// dispatchable the runtime can dispatch must be either swept here or
// explicitly classified out, and each classification is itself checked. What
// stays declared is only what call metadata cannot express: block hooks and
// migration steps are not calls, so they are pinned as an exact set instead.
//
// Two limits of this derivation, stated so it is not read as proving more than
// it does:
//
//  * It proves every dispatchable is *present* in the sweep at *some* component
//    argument. It cannot prove the argument is the call's worst admissible one —
//    those are supplied by hand below, and a call swept at less than its maximum
//    passes every assertion here. That remains a review obligation.
//  * A pallet with dispatchables that `construct_runtime!` lists *without* its
//    `Call` part would have no `RuntimeCall` variant and so read as callless.
//    That is sound rather than a hole: a call absent from `RuntimeCall` cannot be
//    dispatched at all, and I-20 is a statement about dispatched weight.

/// Runtime pallet alias → the `crate::weights` module whose generated
/// `WeightInfo` the I-20 sweep charges for that pallet's dispatchables.
///
/// Many-to-one is legitimate and load-bearing: `pallet_registry` is instantiated
/// twice (02 §7 slots 56/57) and both instances bind the *same* generated file
/// (`configs.rs` documents the resulting last-instance-wins hazard, SQ-489), so
/// one sweep entry per call name covers both.
const FUTARCHY_DISPATCHING_MODULES: &[(&str, &str)] = &[
    ("Constitution", "pallet_constitution"),
    ("ConditionalLedger", "pallet_conditional_ledger"),
    ("Market", "pallet_market"),
    ("Welfare", "pallet_welfare"),
    ("Oracle", "pallet_oracle"),
    ("IncidentRegistry", "pallet_registry"),
    ("MilestoneRegistry", "pallet_registry"),
    ("FutarchyTreasury", "pallet_futarchy_treasury"),
    ("Guardian", "pallet_guardian"),
    ("Attestor", "pallet_attestor"),
    ("Epoch", "pallet_epoch"),
    ("ExecutionGuard", "pallet_execution_guard"),
];

/// Bleavit pallets that declare **no** dispatchables at all — asserted, not
/// assumed. `pallet_origins` is an origin/filter shim over 06 §3.2's closed
/// matrix (the same invariant `pallet-constitution`'s call-enum test pins),
/// `pallet_inflow_caps` is the 09 §5.2 state-only shared meter that runs inside
/// its callers' weight envelopes, and `track_origins` is the values-track origin
/// shim.
///
/// `construct_runtime!` gives a pallet a `RuntimeCall` variant only when it has
/// dispatchables, so **absence** from `get_module_names()` is the mechanical
/// proof that these three declare none. If one ever gains a call it appears
/// there, and `every_runtime_module_is_classified_for_the_i20_sweep` fails
/// instead of letting an unswept dispatchable through.
const FUTARCHY_CALLLESS_MODULES: &[&str] = &["Origins", "InflowCaps", "TrackOrigins"];

/// Upstream FRAME/Cumulus/XCM pallets. Their generated weights are regression
/// gated by `check-weight-regression.py` and their class budgets are upstream's
/// concern; I-20 is a statement about *futarchy* calls (15 §4.5). Listed
/// explicitly so a newly wired pallet cannot land unclassified.
const UPSTREAM_MODULES: &[&str] = &[
    "System",
    "Timestamp",
    "ParachainSystem",
    "ParachainInfo",
    "Balances",
    "ForeignAssets",
    "TransactionPayment",
    "AssetTxPayment",
    "Vesting",
    "Referenda",
    "ConvictionVoting",
    "Preimage",
    "Scheduler",
    "Utility",
    "Proxy",
    "Multisig",
    "Migrations",
    // `bootstrap`-only (02 §7 slot 28); absent from a production runtime.
    "Sudo",
    "XcmpQueue",
    "MessageQueue",
    "CumulusXcm",
    "PolkadotXcm",
    "Authorship",
    "CollatorSelection",
    "Session",
    "Aura",
    "AuraExt",
];

/// Dispatchables deliberately absent from the Normal-class sweep because they
/// are dispatched in another class. Every entry is class-verified by
/// `non_normal_exclusions_are_really_non_normal`, so this list cannot be used to
/// quietly drop a Normal call out of its budget.
const NON_NORMAL_DISPATCHABLES: &[&str] = &["pallet_execution_guard::qualify_recovery_image"];

/// Sweep entries that are not dispatchables. Call metadata cannot enumerate
/// these, so they are pinned as an exact set — an undeclared non-call entry
/// appearing in the sweep fails the coverage test, and so does a misspelled call
/// name (it lands here rather than matching a derived name).
///
/// The three `pallet_market` entries are internal operations, not calls: markets
/// are created, seeded and closed through the runtime adapters in `configs.rs`
/// that the epoch cranks drive (`register_decision_window`, `seed_branch_pair`,
/// `allocate_market_id`), and nothing charges these three functions — the
/// enclosing crank's own benchmark measures that work end to end, which is where
/// `decide`'s 745 KB of proof comes from. Charging them again would double-count.
/// They stay in the sweep because I-20 is worth stating per operation: each one
/// fits the Normal class on its own.
const NON_CALL_SWEEP_ENTRIES: &[&str] = &[
    "pallet_conditional_ledger::migration_step",
    "pallet_guardian::on_initialize",
    "pallet_market::close",
    "pallet_market::create_market",
    "pallet_market::seed",
    "pallet_origins::safety_filter",
];

fn runtime_module_names() -> &'static [&'static str] {
    <crate::RuntimeCall as GetCallMetadata>::get_module_names()
}

/// Every dispatchable the runtime declares, named the way the sweep names it.
///
/// Aliases sharing a weights module must declare **identical** call sets, and that
/// is what makes the many-to-one mapping safe rather than merely convenient. Two
/// instances of one pallet do share a call set; a mistyped row pointing some other
/// pallet at an existing module does not, and without this check its calls would
/// normalise onto the existing names and disappear by set deduplication — the
/// derivation would then report full coverage of a call it never evaluated.
fn derived_dispatchable_names() -> BTreeSet<String> {
    let mut by_module: BTreeMap<&str, Vec<(&str, BTreeSet<&str>)>> = BTreeMap::new();
    for (alias, weights_module) in FUTARCHY_DISPATCHING_MODULES {
        let calls = <crate::RuntimeCall as GetCallMetadata>::get_call_names(alias);
        assert!(
            !calls.is_empty(),
            "`{alias}` is classified as a dispatching futarchy pallet but declares no calls; \
             move it to FUTARCHY_CALLLESS_MODULES",
        );
        by_module
            .entry(weights_module)
            .or_default()
            .push((alias, calls.iter().copied().collect()));
    }

    let mut derived = BTreeSet::new();
    for (weights_module, aliases) in by_module {
        let (first_alias, first_calls) = &aliases[0];
        for (alias, calls) in &aliases[1..] {
            assert_eq!(
                calls, first_calls,
                "`{alias}` and `{first_alias}` are both mapped to `{weights_module}` but declare \
                 different calls. A shared weights module is safe only for instances of the same \
                 pallet (which bind the same generated file); otherwise one pallet's calls \
                 normalise onto the other's names and vanish from this derivation.",
            );
        }
        for call in first_calls {
            derived.insert(alloc::format!("{weights_module}::{call}"));
        }
    }
    derived
}

#[test]
fn every_runtime_module_is_classified_for_the_i20_sweep() {
    for module in runtime_module_names() {
        let dispatching = FUTARCHY_DISPATCHING_MODULES
            .iter()
            .any(|(alias, _)| alias == module);
        let callless = FUTARCHY_CALLLESS_MODULES.contains(module);
        let upstream = UPSTREAM_MODULES.contains(module);
        assert_eq!(
            [dispatching, callless, upstream]
                .iter()
                .filter(|hit| **hit)
                .count(),
            1,
            "runtime module `{module}` is not classified exactly once for the I-20 sweep. \
             Add it to FUTARCHY_DISPATCHING_MODULES (and to all_futarchy_call_weights), to \
             FUTARCHY_CALLLESS_MODULES, or to UPSTREAM_MODULES.",
        );
    }
    // A table entry that no longer names a live module would silently stop
    // contributing to the derived set, which is the failure mode this whole
    // derivation exists to remove.
    let live: BTreeSet<&str> = runtime_module_names().iter().copied().collect();
    for (alias, _) in FUTARCHY_DISPATCHING_MODULES {
        assert!(
            live.contains(alias),
            "FUTARCHY_DISPATCHING_MODULES names `{alias}`, which is not a runtime module \
             (renamed or removed?)",
        );
    }
    // A pallet with no dispatchables gets no `RuntimeCall` variant, so absence is
    // the proof. Appearing here means it gained calls, which must be swept.
    for alias in FUTARCHY_CALLLESS_MODULES {
        assert!(
            !live.contains(alias),
            "`{alias}` is classified as having no dispatchables but now has a RuntimeCall \
             variant; move it to FUTARCHY_DISPATCHING_MODULES and sweep its calls in \
             all_futarchy_call_weights",
        );
    }
}

#[test]
fn every_futarchy_dispatchable_is_covered_by_the_class_sweep() {
    let derived = derived_dispatchable_names();
    let swept: BTreeSet<String> = all_futarchy_call_weights()
        .into_iter()
        .map(|(name, _)| name.to_string())
        .collect();
    let non_normal: BTreeSet<String> = NON_NORMAL_DISPATCHABLES
        .iter()
        .map(|name| name.to_string())
        .collect();

    let missing: BTreeSet<&String> = derived
        .difference(&swept)
        .filter(|name| !non_normal.contains(*name))
        .collect();
    assert!(
        missing.is_empty(),
        "dispatchables absent from the I-20 class-fit sweep: {missing:?}. Add each to \
         all_futarchy_call_weights at its worst component arguments, or — only if it is \
         dispatched in another class — to NON_NORMAL_DISPATCHABLES.",
    );

    let non_call: BTreeSet<String> = swept.difference(&derived).cloned().collect();
    let declared_non_call: BTreeSet<String> = NON_CALL_SWEEP_ENTRIES
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(
        non_call, declared_non_call,
        "the sweep's non-dispatchable entries drifted from NON_CALL_SWEEP_ENTRIES. Call \
         metadata cannot enumerate hooks and migration steps, so they are pinned by name; a \
         misspelled call name lands here too.",
    );

    for name in &non_normal {
        assert!(
            derived.contains(name),
            "NON_NORMAL_DISPATCHABLES names `{name}`, which is not a dispatchable of any \
             classified futarchy pallet",
        );
        assert!(
            !swept.contains(name),
            "`{name}` is excluded as non-Normal yet also swept against the Normal budget",
        );
    }
}

#[test]
fn non_normal_exclusions_are_really_non_normal() {
    use frame_support::dispatch::GetDispatchInfo;

    // Building the real `RuntimeCall` is the point: the class lives in the
    // `#[pallet::weight]` attribute, not in metadata, so the only honest check
    // is to ask the runtime what it would charge.
    let verified: BTreeSet<String> = [(
        "pallet_execution_guard::qualify_recovery_image",
        crate::RuntimeCall::ExecutionGuard(pallet_execution_guard::Call::qualify_recovery_image {
            pid: 1,
        }),
    )]
    .into_iter()
    .map(|(name, call)| {
        let class = call.get_dispatch_info().class;
        assert_ne!(
            class,
            DispatchClass::Normal,
            "`{name}` is excluded from the Normal-class sweep but dispatches as Normal",
        );
        name.to_string()
    })
    .collect();

    let declared: BTreeSet<String> = NON_NORMAL_DISPATCHABLES
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(
        verified, declared,
        "every NON_NORMAL_DISPATCHABLES entry needs its class asserted here, against a real \
         RuntimeCall, and every assertion here needs its entry declared",
    );
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
    // Completeness is proved by derivation, not by a pinned count: every
    // dispatchable in `derived_dispatchable_names()` is either swept or
    // class-excluded, and the non-call entries are pinned as an exact set
    // (`every_futarchy_dispatchable_is_covered_by_the_class_sweep`). The
    // hand-written `assert_eq!(all.len(), 115)` this replaces could only catch a
    // *dropped* entry — it passed for however long three live Normal-class
    // dispatchables were missing, because the list and the count were written by
    // the same hand (SQ-490 item 4).
    assert_eq!(
        all.len(),
        derived_dispatchable_names().len() - NON_NORMAL_DISPATCHABLES.len()
            + NON_CALL_SWEEP_ENTRIES.len(),
        "sweep length disagrees with the derived dispatchable inventory",
    );
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
/// `settle_cohort(5)` moved 725,862 -> 727,942 B with E6. That is a
/// **measurement**, not a regression, and it reconciles exactly: the call reads
/// `Epoch::Proposals` at r:33 w:32, and the E6 author/funder split widened
/// `Proposal` by one `AccountId32`, so the estimator's per-key envelope grows
/// 32 B on each of those 65 accesses -- 65 x 32 = 2,080. `decide` is unmoved
/// because its pin is dominated by the collator-compensation term below rather
/// than by its own proposal reads.
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
        727_942,
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
