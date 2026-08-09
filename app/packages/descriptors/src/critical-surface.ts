/**
 * GENERATED — do not edit. Source: `tools/release/surface-manifest.json` (contract v30).
 * Regenerate: `pnpm -C app run surface:generate`; verified by `pnpm -C app run surface:check`.
 *
 * 10 §5.2's `CRITICAL_SURFACE`: every runtime API, storage item, constant and event the
 * app binds to, in the form a PAPI compatibility probe can ask about. Hand-listing it is
 * banned (app-code rule 7) because a hand-maintained copy of a frozen surface is
 * consistent with everyone who reads it and compared to nothing.
 *
 * **What is not here, and why.** The manifest carries no `call` entries — doc 02 freezes
 * the *read* contract (APIs, views, events, storage, constants, identity) and has no
 * extrinsic section at all — while 10 §5.2 names calls as part of `CRITICAL_SURFACE` and
 * 10 §3.2 makes `restricted` signing "per-surface", whose unit is exactly the call. That
 * gap is SQ-577. Until it closes, `callIsProven()` answers `false` for every call, which
 * is INV-FE-12's fail-closed reading: an unproven capability is *absent*, and absence
 * disables the dependent surface with a named reason.
 */

/** The PAPI compat group that answers for a surface (`api.getStaticApis().compat[group]`). */
export type CompatGroup = 'apis' | 'query' | 'constants' | 'event';

export interface CriticalSurfaceEntry {
  readonly id: string;
  readonly compatGroup: CompatGroup;
  /** Pallet name, or runtime-API trait name for `apis`. */
  readonly pallet: string;
  readonly member: string;
  readonly required: boolean;
  readonly citation: string;
}

export const INTEGRATION_CONTRACT_VERSION = 30;

/** Manifest entries with no metadata surface to probe (raw fixed-layout key, chain properties). */
export const UNPROBED_MANIFEST_ENTRIES = 2;

/**
 * Every published surface id, as a **literal union**.
 *
 * Generated rather than derived from `CRITICAL_SURFACE` with
 * `(typeof CRITICAL_SURFACE)[number]['id']`, which looks equivalent and is not: the array
 * carries an explicit `readonly CriticalSurfaceEntry[]` annotation, so its `id`s widen to
 * `string` and any consumer indexing into it gets a type that accepts every string. That
 * version shipped, and a clause citing `storage.epoch.nonexistent` compiled clean — a
 * binding that reads as a compile-time check and is not one.
 */
export type SurfaceId =
  | "api.account_positions"
  | "api.bond_quote"
  | "api.decision_stats"
  | "api.epoch_status"
  | "api.execution_queue"
  | "api.hosted_report"
  | "api.is_reserved_protocol_destination"
  | "api.nav"
  | "api.open_oracle_rounds"
  | "api.params"
  | "api.proposal_summaries"
  | "api.quote"
  | "api.recent_cohorts"
  | "api.service_positions"
  | "api.treasury_streams"
  | "api.welfare_current"
  | "constant.attestor.att_min_members"
  | "constant.attestor.att_quorum"
  | "constant.attestor.challenge_window_blocks"
  | "constant.client_registry.client_bond"
  | "constant.constitution.max_capabilities"
  | "constant.constitution.max_meters"
  | "constant.constitution.max_params"
  | "constant.decision.delta_floors"
  | "constant.decision.extension"
  | "constant.decision.sigma_floors"
  | "constant.decision.window_floor"
  | "constant.epoch.books_per_proposal"
  | "constant.epoch.integration_contract_version"
  | "constant.epoch.length_floor"
  | "constant.epoch.max_intake_queue"
  | "constant.epoch.max_live_proposals"
  | "constant.epoch.max_non_terminal_cohorts"
  | "constant.epoch.phase_offsets"
  | "constant.epoch.recent_cohorts"
  | "constant.epoch.tick_batch"
  | "constant.epoch.treasury_bond_ask_bps"
  | "constant.execution_guard.descriptor_lead_time"
  | "constant.execution_guard.grace_floor"
  | "constant.execution_guard.integration_contract_version"
  | "constant.execution_guard.max_calls"
  | "constant.execution_guard.max_execution_records"
  | "constant.execution_guard.max_live_proposals"
  | "constant.execution_guard.max_payload_bytes"
  | "constant.execution_guard.max_runtime_code_bytes"
  | "constant.execution_guard.timelock_floor"
  | "constant.guardian.delay_once_allowance_per_epoch"
  | "constant.guardian.force_rerun_allowance_per_epoch"
  | "constant.guardian.guardian_bond"
  | "constant.guardian.guardian_seats"
  | "constant.guardian.guardian_threshold"
  | "constant.guardian.pause_intake_allowance"
  | "constant.guardian.pause_intake_allowance_window_epochs"
  | "constant.guardian.playbook_freeze_window_blocks"
  | "constant.identity.contract_version"
  | "constant.identity.ss58_prefix"
  | "constant.identity.vit_existential_deposit"
  | "constant.ledger.archive_delay"
  | "constant.ledger.max_positions_per_account"
  | "constant.ledger.min_split"
  | "constant.ledger.min_transfer"
  | "constant.ledger.position_deposit"
  | "constant.ledger.reap_batch"
  | "constant.ledger.redemption_fee"
  | "constant.ledger.service_id_base"
  | "constant.market.archive_delay"
  | "constant.market.fee"
  | "constant.market.gate_eps_floor"
  | "constant.market.gate_p_max_ceiling"
  | "constant.market.kappa1e9"
  | "constant.market.max_all_stored_markets"
  | "constant.market.max_live_external_markets"
  | "constant.market.max_live_markets"
  | "constant.market.max_stored_external_markets"
  | "constant.market.max_stored_markets"
  | "constant.market.max_trade_ratio"
  | "constant.market.min_trade"
  | "constant.market.obs_interval"
  | "constant.oracle.max_round_close_batch"
  | "constant.question_service.attestors_min"
  | "constant.question_service.epsilon_min"
  | "constant.question_service.fee_floor"
  | "constant.question_service.max_live"
  | "constant.question_service.max_window"
  | "constant.registry.archive_delay.incident"
  | "constant.registry.archive_delay.milestone"
  | "constant.treasury.integration_contract_version"
  | "constant.treasury.max_budget_lines"
  | "constant.treasury.max_pol_commitments"
  | "constant.treasury.max_streams"
  | "constant.welfare.integration_contract_version"
  | "constant.welfare.max_daily_gate_samples"
  | "constant.welfare.max_gate_flags"
  | "constant.welfare.max_metric_specs"
  | "constant.welfare.max_snapshots"
  | "event.attestor.attestation_challenged"
  | "event.attestor.attestation_revoked"
  | "event.attestor.attestation_submitted"
  | "event.attestor.attestor_ejected"
  | "event.attestor.attestor_removed_for_cause"
  | "event.attestor.challenge_resolved"
  | "event.attestor.members_set"
  | "event.epoch.baseline_carried"
  | "event.epoch.cohort_settled"
  | "event.epoch.cohort_voided"
  | "event.epoch.decision_extended"
  | "event.epoch.intake_slashed"
  | "event.epoch.mandate_expired"
  | "event.epoch.markets_opened"
  | "event.epoch.measurement_started"
  | "event.epoch.proposal_cancelled"
  | "event.epoch.proposal_deferred"
  | "event.epoch.proposal_delayed"
  | "event.epoch.proposal_force_rejected"
  | "event.epoch.proposal_qualified"
  | "event.epoch.proposal_queued"
  | "event.epoch.proposal_rejected"
  | "event.epoch.proposal_submitted"
  | "event.epoch.proposal_withdrawn"
  | "event.epoch.rerun_opened"
  | "event.epoch.rerun_scheduled"
  | "event.epoch.screening_started"
  | "event.epoch.slots_shrunk"
  | "event.execution_guard.enqueued"
  | "event.execution_guard.executed"
  | "event.execution_guard.execution_failed"
  | "event.execution_guard.preimage_unpinned"
  | "event.execution_guard.ratified"
  | "event.execution_guard.rejected"
  | "event.execution_guard.upgrade_aborted"
  | "event.execution_guard.upgrade_applied"
  | "event.execution_guard.upgrade_authorized"
  | "event.guardian.action"
  | "event.guardian.action_approved"
  | "event.guardian.action_proposed"
  | "event.guardian.action_ratified"
  | "event.guardian.force_rerun"
  | "event.guardian.members_set"
  | "event.guardian.playbook_activated"
  | "event.guardian.playbook_expired"
  | "event.guardian.playbook_registration_set"
  | "event.guardian.playbook_renewed"
  | "event.guardian.recall_enacted"
  | "event.guardian.recall_scheduled"
  | "event.guardian.review_failed"
  | "event.guardian.review_scheduled"
  | "event.ledger.baseline_merged"
  | "event.ledger.baseline_redeemed"
  | "event.ledger.baseline_settled"
  | "event.ledger.baseline_split"
  | "event.ledger.baseline_vault_reaped"
  | "event.ledger.gate_merged"
  | "event.ledger.gate_redeemed"
  | "event.ledger.gate_settled"
  | "event.ledger.gate_split"
  | "event.ledger.merged"
  | "event.ledger.position_transferred"
  | "event.ledger.redeemed"
  | "event.ledger.redemption_fees_swept"
  | "event.ledger.scalar_merged"
  | "event.ledger.scalar_pair_redeemed"
  | "event.ledger.scalar_redeemed"
  | "event.ledger.scalar_settlement_set"
  | "event.ledger.scalar_split"
  | "event.ledger.split"
  | "event.ledger.vault_reaped"
  | "event.ledger.vault_resolved"
  | "event.ledger.vault_voided"
  | "event.ledger.void_redeemed"
  | "event.market.closed"
  | "event.market.created"
  | "event.market.external_revenue_swept"
  | "event.market.observed"
  | "event.market.reaped"
  | "event.market.revenue_swept"
  | "event.market.traded"
  | "event.oracle.adjudicated"
  | "event.oracle.adjudication_requested"
  | "event.oracle.challenged"
  | "event.oracle.component_settled"
  | "event.oracle.neutral_settlement"
  | "event.oracle.quorum_failed"
  | "event.oracle.recompute_proven"
  | "event.oracle.reported"
  | "event.oracle.reporter_ejected"
  | "event.oracle.reporter_registered"
  | "event.oracle.reporter_slashed"
  | "event.oracle.reserve_probe_result"
  | "event.oracle.reserve_probe_sent"
  | "event.oracle.reserve_recovered"
  | "event.oracle.reserve_unhealthy"
  | "event.oracle.retention_expired"
  | "event.oracle.round_escalated"
  | "event.oracle.watchtower_inactive"
  | "event.oracle.watchtower_registered"
  | "event.oracle.watchtower_slashed"
  | "event.oracle.window_acknowledged"
  | "event.oracle.window_extended"
  | "event.question_service.question_registered"
  | "event.question_service.question_sealed"
  | "event.question_service.question_settled"
  | "event.question_service.question_voided"
  | "event.registry.epoch_closed.incident"
  | "event.registry.epoch_closed.milestone"
  | "event.registry.filing_bond_slashed.incident"
  | "event.registry.filing_bond_slashed.milestone"
  | "event.registry.incident_challenged"
  | "event.registry.incident_filed"
  | "event.registry.incident_rejected"
  | "event.registry.incident_upheld"
  | "event.registry.milestone_accepted"
  | "event.registry.milestone_challenged"
  | "event.registry.milestone_filed"
  | "event.registry.milestone_rejected"
  | "event.registry.window_acknowledged.incident"
  | "event.registry.window_acknowledged.milestone"
  | "event.registry.window_extended.incident"
  | "event.registry.window_extended.milestone"
  | "event.system.code_updated"
  | "event.system.upgrade_authorized"
  | "storage.attestor.attestations"
  | "storage.attestor.liabilities"
  | "storage.attestor.members"
  | "storage.attestor.next_attestation_id"
  | "storage.attestor.revocations"
  | "storage.client_registry.clients"
  | "storage.constitution.capabilities"
  | "storage.constitution.params"
  | "storage.constitution.phase_flags"
  | "storage.conviction_voting.class_locks_for"
  | "storage.conviction_voting.voting_for"
  | "storage.epoch.cohort_schedules"
  | "storage.epoch.cohorts"
  | "storage.epoch.epoch_of"
  | "storage.epoch.intake_queue"
  | "storage.epoch.pending_oracle_voids"
  | "storage.epoch.proposals"
  | "storage.epoch.recent_cohort_summaries"
  | "storage.epoch.resource_locks"
  | "storage.execution_guard.attestation_bindings"
  | "storage.execution_guard.dead_man_freeze"
  | "storage.execution_guard.execution_records"
  | "storage.execution_guard.expedited"
  | "storage.execution_guard.gate_suspension"
  | "storage.execution_guard.hard_gate_breach"
  | "storage.execution_guard.held_resources"
  | "storage.execution_guard.migration_halt"
  | "storage.execution_guard.pending_upgrade"
  | "storage.execution_guard.queue"
  | "storage.execution_guard.ratifications"
  | "storage.foreign_assets.account"
  | "storage.guardian.active_playbooks"
  | "storage.guardian.allowances"
  | "storage.guardian.approvals"
  | "storage.guardian.members"
  | "storage.guardian.pending_actions"
  | "storage.guardian.playbook_registered"
  | "storage.identity.parachain_id"
  | "storage.identity.usdc_asset"
  | "storage.identity.usdc_metadata"
  | "storage.incident_registry.ack_records"
  | "storage.incident_registry.closed_at"
  | "storage.incident_registry.filings"
  | "storage.ledger.baseline_vaults"
  | "storage.ledger.ledger_drifted"
  | "storage.ledger.position_totals"
  | "storage.ledger.positions"
  | "storage.ledger.vaults"
  | "storage.market.baseline_market_of"
  | "storage.market.markets"
  | "storage.milestone_registry.ack_records"
  | "storage.milestone_registry.closed_at"
  | "storage.milestone_registry.filings"
  | "storage.multisig.multisigs"
  | "storage.oracle.component_values"
  | "storage.oracle.reporters"
  | "storage.oracle.reserve_health"
  | "storage.oracle.rounds"
  | "storage.oracle.watchtowers"
  | "storage.preimage.preimage_for"
  | "storage.preimage.status_for"
  | "storage.proxy.proxies"
  | "storage.question_service.questions"
  | "storage.question_service.reports"
  | "storage.referenda.deciding_count"
  | "storage.referenda.referendum_count"
  | "storage.referenda.referendum_info_for"
  | "storage.referenda.track_queue"
  | "storage.scheduler.agenda"
  | "storage.service_ledger.baseline_vaults"
  | "storage.service_ledger.position_totals"
  | "storage.service_ledger.positions"
  | "storage.service_ledger.vaults"
  | "storage.system.account"
  | "storage.system.authorized_upgrade"
  | "storage.system.events"
  | "storage.welfare.gate_breach_flags"
  | "storage.welfare.metric_specs"
  | "storage.welfare.snapshots";

export const CRITICAL_SURFACE: readonly CriticalSurfaceEntry[] = [
  { id: "api.account_positions", compatGroup: "apis", pallet: "FutarchyApi", member: "account_positions", required: true, citation: "02 §3" },
  { id: "api.bond_quote", compatGroup: "apis", pallet: "FutarchyApi", member: "bond_quote", required: true, citation: "02 §3; 07 §6.1, §7; 11 §11.5 P-13, §11.8.6 O-8" },
  { id: "api.decision_stats", compatGroup: "apis", pallet: "FutarchyApi", member: "decision_stats", required: true, citation: "02 §3" },
  { id: "api.epoch_status", compatGroup: "apis", pallet: "FutarchyApi", member: "epoch_status", required: true, citation: "02 §3" },
  { id: "api.execution_queue", compatGroup: "apis", pallet: "FutarchyApi", member: "execution_queue", required: true, citation: "02 §3" },
  { id: "api.hosted_report", compatGroup: "apis", pallet: "FutarchyApi", member: "hosted_report", required: true, citation: "02 §3; 02 §4a" },
  { id: "api.is_reserved_protocol_destination", compatGroup: "apis", pallet: "FutarchyApi", member: "is_reserved_protocol_destination", required: true, citation: "02 §3; 11 §11.5 P-9" },
  { id: "api.nav", compatGroup: "apis", pallet: "FutarchyApi", member: "nav", required: true, citation: "02 §3" },
  { id: "api.open_oracle_rounds", compatGroup: "apis", pallet: "FutarchyApi", member: "open_oracle_rounds", required: true, citation: "02 §3" },
  { id: "api.params", compatGroup: "apis", pallet: "FutarchyApi", member: "params", required: true, citation: "02 §3" },
  { id: "api.proposal_summaries", compatGroup: "apis", pallet: "FutarchyApi", member: "proposal_summaries", required: true, citation: "02 §3" },
  { id: "api.quote", compatGroup: "apis", pallet: "FutarchyApi", member: "quote", required: true, citation: "02 §3" },
  { id: "api.recent_cohorts", compatGroup: "apis", pallet: "FutarchyApi", member: "recent_cohorts", required: true, citation: "02 §3" },
  { id: "api.service_positions", compatGroup: "apis", pallet: "FutarchyApi", member: "service_positions", required: true, citation: "02 §3; 02 §7.1" },
  { id: "api.treasury_streams", compatGroup: "apis", pallet: "FutarchyApi", member: "treasury_streams", required: true, citation: "02 §3; 11 §11.8.3" },
  { id: "api.welfare_current", compatGroup: "apis", pallet: "FutarchyApi", member: "welfare_current", required: true, citation: "02 §3" },
  { id: "constant.attestor.att_min_members", compatGroup: "constants", pallet: "Attestor", member: "AttMinMembers", required: true, citation: "02 §9" },
  { id: "constant.attestor.att_quorum", compatGroup: "constants", pallet: "Attestor", member: "AttQuorum", required: true, citation: "02 §9" },
  { id: "constant.attestor.challenge_window_blocks", compatGroup: "constants", pallet: "Attestor", member: "ChallengeWindowBlocks", required: true, citation: "02 §9" },
  { id: "constant.client_registry.client_bond", compatGroup: "constants", pallet: "ClientRegistry", member: "ClientBond", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.constitution.max_capabilities", compatGroup: "constants", pallet: "Constitution", member: "MaxCapabilities", required: true, citation: "02 §9" },
  { id: "constant.constitution.max_meters", compatGroup: "constants", pallet: "Constitution", member: "MaxMeters", required: true, citation: "02 §9" },
  { id: "constant.constitution.max_params", compatGroup: "constants", pallet: "Constitution", member: "MaxParams", required: true, citation: "02 §9" },
  { id: "constant.decision.delta_floors", compatGroup: "constants", pallet: "Epoch", member: "DecisionDeltaFloors", required: true, citation: "02 §9" },
  { id: "constant.decision.extension", compatGroup: "constants", pallet: "Epoch", member: "DecisionExtension", required: true, citation: "02 §9" },
  { id: "constant.decision.sigma_floors", compatGroup: "constants", pallet: "Epoch", member: "DecisionSigmaFloors", required: true, citation: "02 §9" },
  { id: "constant.decision.window_floor", compatGroup: "constants", pallet: "Epoch", member: "DecisionWindowFloor", required: true, citation: "02 §9" },
  { id: "constant.epoch.books_per_proposal", compatGroup: "constants", pallet: "Epoch", member: "MaxBooksPerProposal", required: true, citation: "02 §9" },
  { id: "constant.epoch.integration_contract_version", compatGroup: "constants", pallet: "Epoch", member: "INTEGRATION_CONTRACT_VERSION", required: true, citation: "02 §9" },
  { id: "constant.epoch.length_floor", compatGroup: "constants", pallet: "Epoch", member: "MinEpochLength", required: true, citation: "02 §9" },
  { id: "constant.epoch.max_intake_queue", compatGroup: "constants", pallet: "Epoch", member: "MaxIntakeQueue", required: true, citation: "02 §9" },
  { id: "constant.epoch.max_live_proposals", compatGroup: "constants", pallet: "Epoch", member: "MaxLiveProposals", required: true, citation: "02 §9" },
  { id: "constant.epoch.max_non_terminal_cohorts", compatGroup: "constants", pallet: "Epoch", member: "MaxNonTerminalCohorts", required: true, citation: "02 §9" },
  { id: "constant.epoch.phase_offsets", compatGroup: "constants", pallet: "Epoch", member: "PhaseOffsets", required: true, citation: "02 §9" },
  { id: "constant.epoch.recent_cohorts", compatGroup: "constants", pallet: "Epoch", member: "RecentCohortSummariesBound", required: true, citation: "02 §9" },
  { id: "constant.epoch.tick_batch", compatGroup: "constants", pallet: "Epoch", member: "TickBatch", required: true, citation: "02 §9" },
  { id: "constant.epoch.treasury_bond_ask_bps", compatGroup: "constants", pallet: "Epoch", member: "TreasuryBondAskBps", required: true, citation: "02 §9; 08 §7" },
  { id: "constant.execution_guard.descriptor_lead_time", compatGroup: "constants", pallet: "ExecutionGuard", member: "DescriptorLeadTime", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.grace_floor", compatGroup: "constants", pallet: "ExecutionGuard", member: "ExecutionGraceFloor", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.integration_contract_version", compatGroup: "constants", pallet: "ExecutionGuard", member: "INTEGRATION_CONTRACT_VERSION", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.max_calls", compatGroup: "constants", pallet: "ExecutionGuard", member: "MaxCalls", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.max_execution_records", compatGroup: "constants", pallet: "ExecutionGuard", member: "MaxExecutionRecords", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.max_live_proposals", compatGroup: "constants", pallet: "ExecutionGuard", member: "MaxLiveProposals", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.max_payload_bytes", compatGroup: "constants", pallet: "ExecutionGuard", member: "MaxPayloadBytes", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.max_runtime_code_bytes", compatGroup: "constants", pallet: "ExecutionGuard", member: "MaxRuntimeCodeBytes", required: true, citation: "02 §9" },
  { id: "constant.execution_guard.timelock_floor", compatGroup: "constants", pallet: "ExecutionGuard", member: "ExecutionTimelockFloor", required: true, citation: "02 §9" },
  { id: "constant.guardian.delay_once_allowance_per_epoch", compatGroup: "constants", pallet: "Guardian", member: "DelayOnceAllowancePerEpoch", required: true, citation: "02 §9" },
  { id: "constant.guardian.force_rerun_allowance_per_epoch", compatGroup: "constants", pallet: "Guardian", member: "ForceRerunAllowancePerEpoch", required: true, citation: "02 §9" },
  { id: "constant.guardian.guardian_bond", compatGroup: "constants", pallet: "Guardian", member: "GuardianBond", required: true, citation: "02 §9" },
  { id: "constant.guardian.guardian_seats", compatGroup: "constants", pallet: "Guardian", member: "GuardianSeats", required: true, citation: "02 §9" },
  { id: "constant.guardian.guardian_threshold", compatGroup: "constants", pallet: "Guardian", member: "GuardianThreshold", required: true, citation: "02 §9" },
  { id: "constant.guardian.pause_intake_allowance", compatGroup: "constants", pallet: "Guardian", member: "PauseIntakeAllowance", required: true, citation: "02 §9" },
  { id: "constant.guardian.pause_intake_allowance_window_epochs", compatGroup: "constants", pallet: "Guardian", member: "PauseIntakeAllowanceWindowEpochs", required: true, citation: "02 §9" },
  { id: "constant.guardian.playbook_freeze_window_blocks", compatGroup: "constants", pallet: "Guardian", member: "PlaybookFreezeWindowBlocks", required: true, citation: "02 §9" },
  { id: "constant.identity.contract_version", compatGroup: "constants", pallet: "Constitution", member: "INTEGRATION_CONTRACT_VERSION", required: true, citation: "02 §8; 02 §13" },
  { id: "constant.identity.ss58_prefix", compatGroup: "constants", pallet: "System", member: "SS58Prefix", required: true, citation: "02 §8" },
  { id: "constant.identity.vit_existential_deposit", compatGroup: "constants", pallet: "Balances", member: "ExistentialDeposit", required: true, citation: "02 §8" },
  { id: "constant.ledger.archive_delay", compatGroup: "constants", pallet: "ConditionalLedger", member: "ArchiveDelay", required: true, citation: "02 §9" },
  { id: "constant.ledger.max_positions_per_account", compatGroup: "constants", pallet: "ConditionalLedger", member: "MaxPositionsPerAccount", required: true, citation: "02 §9" },
  { id: "constant.ledger.min_split", compatGroup: "constants", pallet: "ConditionalLedger", member: "MinSplit", required: true, citation: "02 §9" },
  { id: "constant.ledger.min_transfer", compatGroup: "constants", pallet: "ConditionalLedger", member: "MinTransfer", required: true, citation: "02 §9" },
  { id: "constant.ledger.position_deposit", compatGroup: "constants", pallet: "ConditionalLedger", member: "PositionDeposit", required: true, citation: "02 §9" },
  { id: "constant.ledger.reap_batch", compatGroup: "constants", pallet: "ConditionalLedger", member: "ReapBatch", required: true, citation: "02 §9" },
  { id: "constant.ledger.redemption_fee", compatGroup: "constants", pallet: "ConditionalLedger", member: "RedemptionFee", required: true, citation: "02 §9" },
  { id: "constant.ledger.service_id_base", compatGroup: "constants", pallet: "ConditionalLedger", member: "ServiceIdBase", required: true, citation: "02 §9" },
  { id: "constant.market.archive_delay", compatGroup: "constants", pallet: "Market", member: "ArchiveDelay", required: true, citation: "02 §9" },
  { id: "constant.market.fee", compatGroup: "constants", pallet: "Market", member: "Fee", required: true, citation: "02 §9" },
  { id: "constant.market.gate_eps_floor", compatGroup: "constants", pallet: "Market", member: "GateEpsFloor", required: true, citation: "02 §9" },
  { id: "constant.market.gate_p_max_ceiling", compatGroup: "constants", pallet: "Market", member: "GatePMaxCeiling", required: true, citation: "02 §9" },
  { id: "constant.market.kappa1e9", compatGroup: "constants", pallet: "Market", member: "Kappa1e9", required: true, citation: "02 §9" },
  { id: "constant.market.max_all_stored_markets", compatGroup: "constants", pallet: "Market", member: "MaxAllStoredMarkets", required: true, citation: "02 §9" },
  { id: "constant.market.max_live_external_markets", compatGroup: "constants", pallet: "Market", member: "MaxLiveExternalMarkets", required: true, citation: "02 §9" },
  { id: "constant.market.max_live_markets", compatGroup: "constants", pallet: "Market", member: "MaxLiveMarkets", required: true, citation: "02 §9" },
  { id: "constant.market.max_stored_external_markets", compatGroup: "constants", pallet: "Market", member: "MaxStoredExternalMarkets", required: true, citation: "02 §9" },
  { id: "constant.market.max_stored_markets", compatGroup: "constants", pallet: "Market", member: "MaxStoredMarkets", required: true, citation: "02 §9" },
  { id: "constant.market.max_trade_ratio", compatGroup: "constants", pallet: "Market", member: "MaxTradeRatio", required: true, citation: "02 §9" },
  { id: "constant.market.min_trade", compatGroup: "constants", pallet: "Market", member: "MinTrade", required: true, citation: "02 §9" },
  { id: "constant.market.obs_interval", compatGroup: "constants", pallet: "Market", member: "ObsInterval", required: true, citation: "02 §9" },
  { id: "constant.oracle.max_round_close_batch", compatGroup: "constants", pallet: "Oracle", member: "MaxRoundCloseBatch", required: true, citation: "02 §9" },
  { id: "constant.question_service.attestors_min", compatGroup: "constants", pallet: "QuestionService", member: "AttestorsMin", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.question_service.epsilon_min", compatGroup: "constants", pallet: "QuestionService", member: "EpsilonMin", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.question_service.fee_floor", compatGroup: "constants", pallet: "QuestionService", member: "FeeFloor", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.question_service.max_live", compatGroup: "constants", pallet: "QuestionService", member: "MaxLive", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.question_service.max_window", compatGroup: "constants", pallet: "QuestionService", member: "MaxWindow", required: true, citation: "02 §4a; 02 §9" },
  { id: "constant.registry.archive_delay.incident", compatGroup: "constants", pallet: "IncidentRegistry", member: "ArchiveDelay", required: true, citation: "02 §9" },
  { id: "constant.registry.archive_delay.milestone", compatGroup: "constants", pallet: "MilestoneRegistry", member: "ArchiveDelay", required: true, citation: "02 §9" },
  { id: "constant.treasury.integration_contract_version", compatGroup: "constants", pallet: "FutarchyTreasury", member: "INTEGRATION_CONTRACT_VERSION", required: true, citation: "02 §9" },
  { id: "constant.treasury.max_budget_lines", compatGroup: "constants", pallet: "FutarchyTreasury", member: "MaxBudgetLines", required: true, citation: "02 §9" },
  { id: "constant.treasury.max_pol_commitments", compatGroup: "constants", pallet: "FutarchyTreasury", member: "MaxPolCommitments", required: true, citation: "02 §9" },
  { id: "constant.treasury.max_streams", compatGroup: "constants", pallet: "FutarchyTreasury", member: "MaxStreams", required: true, citation: "02 §9" },
  { id: "constant.welfare.integration_contract_version", compatGroup: "constants", pallet: "Welfare", member: "INTEGRATION_CONTRACT_VERSION", required: true, citation: "02 §9" },
  { id: "constant.welfare.max_daily_gate_samples", compatGroup: "constants", pallet: "Welfare", member: "MaxDailyGateSamples", required: true, citation: "02 §9" },
  { id: "constant.welfare.max_gate_flags", compatGroup: "constants", pallet: "Welfare", member: "MaxGateFlags", required: true, citation: "02 §9" },
  { id: "constant.welfare.max_metric_specs", compatGroup: "constants", pallet: "Welfare", member: "MaxMetricSpecs", required: true, citation: "02 §9" },
  { id: "constant.welfare.max_snapshots", compatGroup: "constants", pallet: "Welfare", member: "MaxSnapshots", required: true, citation: "02 §9" },
  { id: "event.attestor.attestation_challenged", compatGroup: "event", pallet: "Attestor", member: "AttestationChallenged", required: true, citation: "02 §6" },
  { id: "event.attestor.attestation_revoked", compatGroup: "event", pallet: "Attestor", member: "AttestationRevoked", required: true, citation: "02 §6" },
  { id: "event.attestor.attestation_submitted", compatGroup: "event", pallet: "Attestor", member: "AttestationSubmitted", required: true, citation: "02 §6" },
  { id: "event.attestor.attestor_ejected", compatGroup: "event", pallet: "Attestor", member: "AttestorEjected", required: true, citation: "02 §6" },
  { id: "event.attestor.attestor_removed_for_cause", compatGroup: "event", pallet: "Attestor", member: "AttestorRemovedForCause", required: true, citation: "02 §6" },
  { id: "event.attestor.challenge_resolved", compatGroup: "event", pallet: "Attestor", member: "ChallengeResolved", required: true, citation: "02 §6" },
  { id: "event.attestor.members_set", compatGroup: "event", pallet: "Attestor", member: "MembersSet", required: true, citation: "02 §6" },
  { id: "event.epoch.baseline_carried", compatGroup: "event", pallet: "Epoch", member: "BaselineCarried", required: true, citation: "02 §6" },
  { id: "event.epoch.cohort_settled", compatGroup: "event", pallet: "Epoch", member: "CohortSettled", required: true, citation: "02 §6" },
  { id: "event.epoch.cohort_voided", compatGroup: "event", pallet: "Epoch", member: "CohortVoided", required: true, citation: "02 §6" },
  { id: "event.epoch.decision_extended", compatGroup: "event", pallet: "Epoch", member: "DecisionExtended", required: true, citation: "02 §6" },
  { id: "event.epoch.intake_slashed", compatGroup: "event", pallet: "Epoch", member: "IntakeSlashed", required: true, citation: "02 §6" },
  { id: "event.epoch.mandate_expired", compatGroup: "event", pallet: "Epoch", member: "MandateExpired", required: true, citation: "02 §6" },
  { id: "event.epoch.markets_opened", compatGroup: "event", pallet: "Epoch", member: "MarketsOpened", required: true, citation: "02 §6" },
  { id: "event.epoch.measurement_started", compatGroup: "event", pallet: "Epoch", member: "MeasurementStarted", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_cancelled", compatGroup: "event", pallet: "Epoch", member: "ProposalCancelled", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_deferred", compatGroup: "event", pallet: "Epoch", member: "ProposalDeferred", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_delayed", compatGroup: "event", pallet: "Epoch", member: "ProposalDelayed", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_force_rejected", compatGroup: "event", pallet: "Epoch", member: "ProposalForceRejected", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_qualified", compatGroup: "event", pallet: "Epoch", member: "ProposalQualified", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_queued", compatGroup: "event", pallet: "Epoch", member: "ProposalQueued", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_rejected", compatGroup: "event", pallet: "Epoch", member: "ProposalRejected", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_submitted", compatGroup: "event", pallet: "Epoch", member: "ProposalSubmitted", required: true, citation: "02 §6" },
  { id: "event.epoch.proposal_withdrawn", compatGroup: "event", pallet: "Epoch", member: "ProposalWithdrawn", required: true, citation: "02 §6" },
  { id: "event.epoch.rerun_opened", compatGroup: "event", pallet: "Epoch", member: "RerunOpened", required: true, citation: "02 §6" },
  { id: "event.epoch.rerun_scheduled", compatGroup: "event", pallet: "Epoch", member: "RerunScheduled", required: true, citation: "02 §6" },
  { id: "event.epoch.screening_started", compatGroup: "event", pallet: "Epoch", member: "ScreeningStarted", required: true, citation: "02 §6" },
  { id: "event.epoch.slots_shrunk", compatGroup: "event", pallet: "Epoch", member: "SlotsShrunk", required: true, citation: "02 §6" },
  { id: "event.execution_guard.enqueued", compatGroup: "event", pallet: "ExecutionGuard", member: "Enqueued", required: true, citation: "02 §6" },
  { id: "event.execution_guard.executed", compatGroup: "event", pallet: "ExecutionGuard", member: "Executed", required: true, citation: "02 §6" },
  { id: "event.execution_guard.execution_failed", compatGroup: "event", pallet: "ExecutionGuard", member: "ExecutionFailed", required: true, citation: "02 §6" },
  { id: "event.execution_guard.preimage_unpinned", compatGroup: "event", pallet: "ExecutionGuard", member: "PreimageUnpinned", required: true, citation: "02 §6" },
  { id: "event.execution_guard.ratified", compatGroup: "event", pallet: "ExecutionGuard", member: "Ratified", required: true, citation: "02 §6" },
  { id: "event.execution_guard.rejected", compatGroup: "event", pallet: "ExecutionGuard", member: "Rejected", required: true, citation: "02 §6" },
  { id: "event.execution_guard.upgrade_aborted", compatGroup: "event", pallet: "ExecutionGuard", member: "UpgradeAborted", required: true, citation: "02 §6" },
  { id: "event.execution_guard.upgrade_applied", compatGroup: "event", pallet: "ExecutionGuard", member: "UpgradeApplied", required: true, citation: "02 §6" },
  { id: "event.execution_guard.upgrade_authorized", compatGroup: "event", pallet: "ExecutionGuard", member: "UpgradeAuthorized", required: true, citation: "02 §6" },
  { id: "event.guardian.action", compatGroup: "event", pallet: "Guardian", member: "GuardianAction", required: true, citation: "02 §6" },
  { id: "event.guardian.action_approved", compatGroup: "event", pallet: "Guardian", member: "ActionApproved", required: true, citation: "02 §6" },
  { id: "event.guardian.action_proposed", compatGroup: "event", pallet: "Guardian", member: "ActionProposed", required: true, citation: "02 §6" },
  { id: "event.guardian.action_ratified", compatGroup: "event", pallet: "Guardian", member: "ActionRatified", required: true, citation: "02 §6" },
  { id: "event.guardian.force_rerun", compatGroup: "event", pallet: "Guardian", member: "ForceRerun", required: true, citation: "02 §6" },
  { id: "event.guardian.members_set", compatGroup: "event", pallet: "Guardian", member: "MembersSet", required: true, citation: "02 §6" },
  { id: "event.guardian.playbook_activated", compatGroup: "event", pallet: "Guardian", member: "PlaybookActivated", required: true, citation: "02 §6" },
  { id: "event.guardian.playbook_expired", compatGroup: "event", pallet: "Guardian", member: "PlaybookExpired", required: true, citation: "02 §6" },
  { id: "event.guardian.playbook_registration_set", compatGroup: "event", pallet: "Guardian", member: "PlaybookRegistrationSet", required: true, citation: "02 §6" },
  { id: "event.guardian.playbook_renewed", compatGroup: "event", pallet: "Guardian", member: "PlaybookRenewed", required: true, citation: "02 §6" },
  { id: "event.guardian.recall_enacted", compatGroup: "event", pallet: "Guardian", member: "RecallEnacted", required: true, citation: "02 §6" },
  { id: "event.guardian.recall_scheduled", compatGroup: "event", pallet: "Guardian", member: "RecallScheduled", required: true, citation: "02 §6" },
  { id: "event.guardian.review_failed", compatGroup: "event", pallet: "Guardian", member: "ReviewFailed", required: true, citation: "02 §6" },
  { id: "event.guardian.review_scheduled", compatGroup: "event", pallet: "Guardian", member: "ReviewScheduled", required: true, citation: "02 §6" },
  { id: "event.ledger.baseline_merged", compatGroup: "event", pallet: "ConditionalLedger", member: "BaselineMerged", required: true, citation: "02 §6" },
  { id: "event.ledger.baseline_redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "BaselineRedeemed", required: true, citation: "02 §6" },
  { id: "event.ledger.baseline_settled", compatGroup: "event", pallet: "ConditionalLedger", member: "BaselineSettled", required: true, citation: "02 §6" },
  { id: "event.ledger.baseline_split", compatGroup: "event", pallet: "ConditionalLedger", member: "BaselineSplit", required: true, citation: "02 §6" },
  { id: "event.ledger.baseline_vault_reaped", compatGroup: "event", pallet: "ConditionalLedger", member: "BaselineVaultReaped", required: true, citation: "02 §6" },
  { id: "event.ledger.gate_merged", compatGroup: "event", pallet: "ConditionalLedger", member: "GateMerged", required: true, citation: "02 §6" },
  { id: "event.ledger.gate_redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "GateRedeemed", required: true, citation: "02 §6" },
  { id: "event.ledger.gate_settled", compatGroup: "event", pallet: "ConditionalLedger", member: "GateSettled", required: true, citation: "02 §6" },
  { id: "event.ledger.gate_split", compatGroup: "event", pallet: "ConditionalLedger", member: "GateSplit", required: true, citation: "02 §6" },
  { id: "event.ledger.merged", compatGroup: "event", pallet: "ConditionalLedger", member: "Merged", required: true, citation: "02 §6" },
  { id: "event.ledger.position_transferred", compatGroup: "event", pallet: "ConditionalLedger", member: "PositionTransferred", required: true, citation: "02 §6" },
  { id: "event.ledger.redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "Redeemed", required: true, citation: "02 §6" },
  { id: "event.ledger.redemption_fees_swept", compatGroup: "event", pallet: "ConditionalLedger", member: "RedemptionFeesSwept", required: true, citation: "02 §6" },
  { id: "event.ledger.scalar_merged", compatGroup: "event", pallet: "ConditionalLedger", member: "ScalarMerged", required: true, citation: "02 §6" },
  { id: "event.ledger.scalar_pair_redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "ScalarPairRedeemed", required: true, citation: "02 §6" },
  { id: "event.ledger.scalar_redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "ScalarRedeemed", required: true, citation: "02 §6" },
  { id: "event.ledger.scalar_settlement_set", compatGroup: "event", pallet: "ConditionalLedger", member: "ScalarSettlementSet", required: true, citation: "02 §6" },
  { id: "event.ledger.scalar_split", compatGroup: "event", pallet: "ConditionalLedger", member: "ScalarSplit", required: true, citation: "02 §6" },
  { id: "event.ledger.split", compatGroup: "event", pallet: "ConditionalLedger", member: "Split", required: true, citation: "02 §6" },
  { id: "event.ledger.vault_reaped", compatGroup: "event", pallet: "ConditionalLedger", member: "VaultReaped", required: true, citation: "02 §6" },
  { id: "event.ledger.vault_resolved", compatGroup: "event", pallet: "ConditionalLedger", member: "VaultResolved", required: true, citation: "02 §6" },
  { id: "event.ledger.vault_voided", compatGroup: "event", pallet: "ConditionalLedger", member: "VaultVoided", required: true, citation: "02 §6" },
  { id: "event.ledger.void_redeemed", compatGroup: "event", pallet: "ConditionalLedger", member: "VoidRedeemed", required: true, citation: "02 §6" },
  { id: "event.market.closed", compatGroup: "event", pallet: "Market", member: "MarketClosed", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.created", compatGroup: "event", pallet: "Market", member: "MarketCreated", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.external_revenue_swept", compatGroup: "event", pallet: "Market", member: "ExternalRevenueSwept", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.observed", compatGroup: "event", pallet: "Market", member: "Observed", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.reaped", compatGroup: "event", pallet: "Market", member: "MarketReaped", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.revenue_swept", compatGroup: "event", pallet: "Market", member: "RevenueSwept", required: true, citation: "02 §5; 02 §6" },
  { id: "event.market.traded", compatGroup: "event", pallet: "Market", member: "Traded", required: true, citation: "02 §5; 02 §6" },
  { id: "event.oracle.adjudicated", compatGroup: "event", pallet: "Oracle", member: "Adjudicated", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.adjudication_requested", compatGroup: "event", pallet: "Oracle", member: "AdjudicationRequested", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.challenged", compatGroup: "event", pallet: "Oracle", member: "Challenged", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.component_settled", compatGroup: "event", pallet: "Oracle", member: "ComponentSettled", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.neutral_settlement", compatGroup: "event", pallet: "Oracle", member: "NeutralSettlement", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.quorum_failed", compatGroup: "event", pallet: "Oracle", member: "QuorumFailed", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.recompute_proven", compatGroup: "event", pallet: "Oracle", member: "RecomputeProven", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reported", compatGroup: "event", pallet: "Oracle", member: "Reported", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reporter_ejected", compatGroup: "event", pallet: "Oracle", member: "ReporterEjected", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reporter_registered", compatGroup: "event", pallet: "Oracle", member: "ReporterRegistered", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reporter_slashed", compatGroup: "event", pallet: "Oracle", member: "ReporterSlashed", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reserve_probe_result", compatGroup: "event", pallet: "Oracle", member: "ReserveProbeResult", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reserve_probe_sent", compatGroup: "event", pallet: "Oracle", member: "ReserveProbeSent", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reserve_recovered", compatGroup: "event", pallet: "Oracle", member: "ReserveRecovered", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.reserve_unhealthy", compatGroup: "event", pallet: "Oracle", member: "ReserveUnhealthy", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.retention_expired", compatGroup: "event", pallet: "Oracle", member: "RetentionExpired", required: true, citation: "02 §6; 02 §7.2; 07 §11(1)" },
  { id: "event.oracle.round_escalated", compatGroup: "event", pallet: "Oracle", member: "RoundEscalated", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.watchtower_inactive", compatGroup: "event", pallet: "Oracle", member: "WatchtowerInactive", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.watchtower_registered", compatGroup: "event", pallet: "Oracle", member: "WatchtowerRegistered", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.watchtower_slashed", compatGroup: "event", pallet: "Oracle", member: "WatchtowerSlashed", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.window_acknowledged", compatGroup: "event", pallet: "Oracle", member: "WindowAcknowledged", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.oracle.window_extended", compatGroup: "event", pallet: "Oracle", member: "WindowExtended", required: true, citation: "02 §6; 02 §7.2" },
  { id: "event.question_service.question_registered", compatGroup: "event", pallet: "QuestionService", member: "QuestionRegistered", required: true, citation: "02 §4a; 02 §6" },
  { id: "event.question_service.question_sealed", compatGroup: "event", pallet: "QuestionService", member: "QuestionSealed", required: true, citation: "02 §4a; 02 §6" },
  { id: "event.question_service.question_settled", compatGroup: "event", pallet: "QuestionService", member: "QuestionSettled", required: true, citation: "02 §4a; 02 §6" },
  { id: "event.question_service.question_voided", compatGroup: "event", pallet: "QuestionService", member: "QuestionVoided", required: true, citation: "02 §4a; 02 §6" },
  { id: "event.registry.epoch_closed.incident", compatGroup: "event", pallet: "IncidentRegistry", member: "RegistryEpochClosed", required: true, citation: "02 §6" },
  { id: "event.registry.epoch_closed.milestone", compatGroup: "event", pallet: "MilestoneRegistry", member: "RegistryEpochClosed", required: true, citation: "02 §6" },
  { id: "event.registry.filing_bond_slashed.incident", compatGroup: "event", pallet: "IncidentRegistry", member: "FilingBondSlashed", required: true, citation: "02 §6" },
  { id: "event.registry.filing_bond_slashed.milestone", compatGroup: "event", pallet: "MilestoneRegistry", member: "FilingBondSlashed", required: true, citation: "02 §6" },
  { id: "event.registry.incident_challenged", compatGroup: "event", pallet: "IncidentRegistry", member: "IncidentChallenged", required: true, citation: "02 §6" },
  { id: "event.registry.incident_filed", compatGroup: "event", pallet: "IncidentRegistry", member: "IncidentFiled", required: true, citation: "02 §6" },
  { id: "event.registry.incident_rejected", compatGroup: "event", pallet: "IncidentRegistry", member: "IncidentRejected", required: true, citation: "02 §6" },
  { id: "event.registry.incident_upheld", compatGroup: "event", pallet: "IncidentRegistry", member: "IncidentUpheld", required: true, citation: "02 §6" },
  { id: "event.registry.milestone_accepted", compatGroup: "event", pallet: "MilestoneRegistry", member: "MilestoneAccepted", required: true, citation: "02 §6" },
  { id: "event.registry.milestone_challenged", compatGroup: "event", pallet: "MilestoneRegistry", member: "MilestoneChallenged", required: true, citation: "02 §6" },
  { id: "event.registry.milestone_filed", compatGroup: "event", pallet: "MilestoneRegistry", member: "MilestoneFiled", required: true, citation: "02 §6" },
  { id: "event.registry.milestone_rejected", compatGroup: "event", pallet: "MilestoneRegistry", member: "MilestoneRejected", required: true, citation: "02 §6" },
  { id: "event.registry.window_acknowledged.incident", compatGroup: "event", pallet: "IncidentRegistry", member: "WindowAcknowledged", required: true, citation: "02 §6" },
  { id: "event.registry.window_acknowledged.milestone", compatGroup: "event", pallet: "MilestoneRegistry", member: "WindowAcknowledged", required: true, citation: "02 §6" },
  { id: "event.registry.window_extended.incident", compatGroup: "event", pallet: "IncidentRegistry", member: "WindowExtended", required: true, citation: "02 §6" },
  { id: "event.registry.window_extended.milestone", compatGroup: "event", pallet: "MilestoneRegistry", member: "WindowExtended", required: true, citation: "02 §6" },
  { id: "event.system.code_updated", compatGroup: "event", pallet: "System", member: "CodeUpdated", required: true, citation: "02 §6" },
  { id: "event.system.upgrade_authorized", compatGroup: "event", pallet: "System", member: "UpgradeAuthorized", required: true, citation: "02 §6" },
  { id: "storage.attestor.attestations", compatGroup: "query", pallet: "Attestor", member: "Attestations", required: true, citation: "02 §7.5" },
  { id: "storage.attestor.liabilities", compatGroup: "query", pallet: "Attestor", member: "Liabilities", required: true, citation: "02 §7.5" },
  { id: "storage.attestor.members", compatGroup: "query", pallet: "Attestor", member: "Members", required: true, citation: "02 §7.5" },
  { id: "storage.attestor.next_attestation_id", compatGroup: "query", pallet: "Attestor", member: "NextAttestationId", required: true, citation: "02 §7.5" },
  { id: "storage.attestor.revocations", compatGroup: "query", pallet: "Attestor", member: "Revocations", required: true, citation: "02 §7.5" },
  { id: "storage.client_registry.clients", compatGroup: "query", pallet: "ClientRegistry", member: "Clients", required: true, citation: "02 §4a; 02 §7" },
  { id: "storage.constitution.capabilities", compatGroup: "query", pallet: "Constitution", member: "Capabilities", required: true, citation: "02 §7.3" },
  { id: "storage.constitution.params", compatGroup: "query", pallet: "Constitution", member: "Params", required: true, citation: "02 §7.3" },
  { id: "storage.constitution.phase_flags", compatGroup: "query", pallet: "Constitution", member: "PhaseFlags", required: true, citation: "02 §7.3" },
  { id: "storage.conviction_voting.class_locks_for", compatGroup: "query", pallet: "ConvictionVoting", member: "ClassLocksFor", required: true, citation: "02 §7.6" },
  { id: "storage.conviction_voting.voting_for", compatGroup: "query", pallet: "ConvictionVoting", member: "VotingFor", required: true, citation: "02 §7.6" },
  { id: "storage.epoch.cohort_schedules", compatGroup: "query", pallet: "Epoch", member: "CohortSchedules", required: true, citation: "02 §7.1; 11 §11.8.6" },
  { id: "storage.epoch.cohorts", compatGroup: "query", pallet: "Epoch", member: "Cohorts", required: true, citation: "02 §7.1" },
  { id: "storage.epoch.epoch_of", compatGroup: "query", pallet: "Epoch", member: "EpochOf", required: true, citation: "02 §7.1" },
  { id: "storage.epoch.intake_queue", compatGroup: "query", pallet: "Epoch", member: "IntakeQueue", required: true, citation: "02 §7.1" },
  { id: "storage.epoch.pending_oracle_voids", compatGroup: "query", pallet: "Epoch", member: "PendingOracleVoids", required: true, citation: "02 §7.1; 11 §11.8.2" },
  { id: "storage.epoch.proposals", compatGroup: "query", pallet: "Epoch", member: "Proposals", required: true, citation: "02 §7.1" },
  { id: "storage.epoch.recent_cohort_summaries", compatGroup: "query", pallet: "Epoch", member: "RecentCohortSummaries", required: true, citation: "02 §7.1" },
  { id: "storage.epoch.resource_locks", compatGroup: "query", pallet: "Epoch", member: "ResourceLocks", required: true, citation: "02 §7.1" },
  { id: "storage.execution_guard.attestation_bindings", compatGroup: "query", pallet: "ExecutionGuard", member: "AttestationBindings", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.dead_man_freeze", compatGroup: "query", pallet: "ExecutionGuard", member: "DeadManFreeze", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.execution_records", compatGroup: "query", pallet: "ExecutionGuard", member: "ExecutionRecords", required: true, citation: "02 §7.4" },
  { id: "storage.execution_guard.expedited", compatGroup: "query", pallet: "ExecutionGuard", member: "Expedited", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.gate_suspension", compatGroup: "query", pallet: "ExecutionGuard", member: "GateSuspension", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.hard_gate_breach", compatGroup: "query", pallet: "ExecutionGuard", member: "HardGateBreach", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.held_resources", compatGroup: "query", pallet: "ExecutionGuard", member: "HeldResources", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.migration_halt", compatGroup: "query", pallet: "ExecutionGuard", member: "MigrationHalt", required: true, citation: "02 §7.8" },
  { id: "storage.execution_guard.pending_upgrade", compatGroup: "query", pallet: "ExecutionGuard", member: "PendingUpgrade", required: true, citation: "02 §7.4 execution-guard pending upgrade; 11 §11.8.4 step 1/step 4" },
  { id: "storage.execution_guard.queue", compatGroup: "query", pallet: "ExecutionGuard", member: "Queue", required: true, citation: "02 §7.4" },
  { id: "storage.execution_guard.ratifications", compatGroup: "query", pallet: "ExecutionGuard", member: "Ratifications", required: true, citation: "02 §7.4" },
  { id: "storage.foreign_assets.account", compatGroup: "query", pallet: "ForeignAssets", member: "Account", required: true, citation: "02 §7.4; 02 §8" },
  { id: "storage.guardian.active_playbooks", compatGroup: "query", pallet: "Guardian", member: "ActivePlaybooks", required: true, citation: "02 §7.4 guardian active playbooks; 11 §11.8.2 approve row (PlaybookAlreadyActive)" },
  { id: "storage.guardian.allowances", compatGroup: "query", pallet: "Guardian", member: "Allowances", required: true, citation: "02 §7.4 guardian allowances" },
  { id: "storage.guardian.approvals", compatGroup: "query", pallet: "Guardian", member: "Approvals", required: true, citation: "02 §7.4 guardian approvals; 11 §11.8.2 row 3" },
  { id: "storage.guardian.members", compatGroup: "query", pallet: "Guardian", member: "Members", required: true, citation: "02 §7.4 guardian membership" },
  { id: "storage.guardian.pending_actions", compatGroup: "query", pallet: "Guardian", member: "PendingActions", required: true, citation: "02 §7.4 guardian pending actions; 11 §11.8.2 row 1" },
  { id: "storage.guardian.playbook_registered", compatGroup: "query", pallet: "Guardian", member: "PlaybookRegistered", required: true, citation: "02 §7.4 guardian playbook registry; 11 §11.8.2 approve row (PlaybookNotRegistered)" },
  { id: "storage.identity.parachain_id", compatGroup: "query", pallet: "ParachainInfo", member: "ParachainId", required: true, citation: "02 §8" },
  { id: "storage.identity.usdc_asset", compatGroup: "query", pallet: "ForeignAssets", member: "Asset", required: true, citation: "02 §8" },
  { id: "storage.identity.usdc_metadata", compatGroup: "query", pallet: "ForeignAssets", member: "Metadata", required: true, citation: "02 §8" },
  { id: "storage.incident_registry.ack_records", compatGroup: "query", pallet: "IncidentRegistry", member: "AckRecords", required: true, citation: "02 §7.4 watchtower acknowledgments; 11 §11.8.6" },
  { id: "storage.incident_registry.closed_at", compatGroup: "query", pallet: "IncidentRegistry", member: "ClosedAt", required: true, citation: "02 §7.4 registry closure; 11 §11.8.6" },
  { id: "storage.incident_registry.filings", compatGroup: "query", pallet: "IncidentRegistry", member: "Filings", required: true, citation: "02 §7.4 registry filings; 11 §11.8.6" },
  { id: "storage.ledger.baseline_vaults", compatGroup: "query", pallet: "ConditionalLedger", member: "BaselineVaults", required: true, citation: "02 §7.4" },
  { id: "storage.ledger.ledger_drifted", compatGroup: "query", pallet: "ConditionalLedger", member: "LedgerDrifted", required: true, citation: "02 §7.4; 11 §11.8.2" },
  { id: "storage.ledger.position_totals", compatGroup: "query", pallet: "ConditionalLedger", member: "PositionTotals", required: true, citation: "02 §7.4" },
  { id: "storage.ledger.positions", compatGroup: "query", pallet: "ConditionalLedger", member: "Positions", required: true, citation: "02 §7.4" },
  { id: "storage.ledger.vaults", compatGroup: "query", pallet: "ConditionalLedger", member: "Vaults", required: true, citation: "02 §7.4" },
  { id: "storage.market.baseline_market_of", compatGroup: "query", pallet: "Market", member: "BaselineMarketOf", required: true, citation: "02 §7.4" },
  { id: "storage.market.markets", compatGroup: "query", pallet: "Market", member: "Markets", required: true, citation: "02 §7.4" },
  { id: "storage.milestone_registry.ack_records", compatGroup: "query", pallet: "MilestoneRegistry", member: "AckRecords", required: true, citation: "02 §7.4 watchtower acknowledgments; 11 §11.8.6" },
  { id: "storage.milestone_registry.closed_at", compatGroup: "query", pallet: "MilestoneRegistry", member: "ClosedAt", required: true, citation: "02 §7.4 registry closure; 11 §11.8.6" },
  { id: "storage.milestone_registry.filings", compatGroup: "query", pallet: "MilestoneRegistry", member: "Filings", required: true, citation: "02 §7.4 registry filings; 11 §11.8.6" },
  { id: "storage.multisig.multisigs", compatGroup: "query", pallet: "Multisig", member: "Multisigs", required: true, citation: "02 §7.6" },
  { id: "storage.oracle.component_values", compatGroup: "query", pallet: "Oracle", member: "ComponentValues", required: true, citation: "02 §7.2" },
  { id: "storage.oracle.reporters", compatGroup: "query", pallet: "Oracle", member: "Reporters", required: true, citation: "02 §7.2" },
  { id: "storage.oracle.reserve_health", compatGroup: "query", pallet: "Oracle", member: "ReserveHealth", required: true, citation: "02 §7.2" },
  { id: "storage.oracle.rounds", compatGroup: "query", pallet: "Oracle", member: "Rounds", required: true, citation: "02 §7.2" },
  { id: "storage.oracle.watchtowers", compatGroup: "query", pallet: "Oracle", member: "Watchtowers", required: true, citation: "02 §7.2" },
  { id: "storage.preimage.preimage_for", compatGroup: "query", pallet: "Preimage", member: "PreimageFor", required: true, citation: "02 §7.6" },
  { id: "storage.preimage.status_for", compatGroup: "query", pallet: "Preimage", member: "StatusFor", required: true, citation: "02 §7.6" },
  { id: "storage.proxy.proxies", compatGroup: "query", pallet: "Proxy", member: "Proxies", required: true, citation: "02 §7.6" },
  { id: "storage.question_service.questions", compatGroup: "query", pallet: "QuestionService", member: "Questions", required: true, citation: "02 §4a; 02 §7" },
  { id: "storage.question_service.reports", compatGroup: "query", pallet: "QuestionService", member: "Reports", required: true, citation: "02 §4a; 02 §7" },
  { id: "storage.referenda.deciding_count", compatGroup: "query", pallet: "Referenda", member: "DecidingCount", required: true, citation: "02 §7.6" },
  { id: "storage.referenda.referendum_count", compatGroup: "query", pallet: "Referenda", member: "ReferendumCount", required: true, citation: "02 §7.6" },
  { id: "storage.referenda.referendum_info_for", compatGroup: "query", pallet: "Referenda", member: "ReferendumInfoFor", required: true, citation: "02 §7.6" },
  { id: "storage.referenda.track_queue", compatGroup: "query", pallet: "Referenda", member: "TrackQueue", required: true, citation: "02 §7.6" },
  { id: "storage.scheduler.agenda", compatGroup: "query", pallet: "Scheduler", member: "Agenda", required: true, citation: "02 §7.6" },
  { id: "storage.service_ledger.baseline_vaults", compatGroup: "query", pallet: "ServiceLedger", member: "BaselineVaults", required: true, citation: "02 §7.1; 02 §7.4" },
  { id: "storage.service_ledger.position_totals", compatGroup: "query", pallet: "ServiceLedger", member: "PositionTotals", required: true, citation: "02 §7.1; 02 §7.4" },
  { id: "storage.service_ledger.positions", compatGroup: "query", pallet: "ServiceLedger", member: "Positions", required: true, citation: "02 §7.1; 02 §7.4" },
  { id: "storage.service_ledger.vaults", compatGroup: "query", pallet: "ServiceLedger", member: "Vaults", required: true, citation: "02 §7.1; 02 §7.4" },
  { id: "storage.system.account", compatGroup: "query", pallet: "System", member: "Account", required: true, citation: "02 §7.4" },
  { id: "storage.system.authorized_upgrade", compatGroup: "query", pallet: "System", member: "AuthorizedUpgrade", required: true, citation: "02 §7.6; 11 §11.8.4 step 1" },
  { id: "storage.system.events", compatGroup: "query", pallet: "System", member: "Events", required: true, citation: "02 §7.6" },
  { id: "storage.welfare.gate_breach_flags", compatGroup: "query", pallet: "Welfare", member: "GateBreachFlags", required: true, citation: "02 §7.4" },
  { id: "storage.welfare.metric_specs", compatGroup: "query", pallet: "Welfare", member: "MetricSpecs", required: true, citation: "02 §7.4" },
  { id: "storage.welfare.snapshots", compatGroup: "query", pallet: "Welfare", member: "Snapshots", required: true, citation: "02 §7.4" },
];
