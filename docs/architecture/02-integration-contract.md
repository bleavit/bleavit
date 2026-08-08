# 02 — Integration Contract (Chain ↔ Frontend, FROZEN)

**Status: normative component specification. Supersedes the corresponding sections of BACKEND_PLAN.md/FRONTEND_PLAN.md** (FE §30 in full — all patch items P-1…P-11 are ACCEPTED and applied here; FE §13; BE §7 SCALE surface, BE §25/§26 contract rows).

**Boundary.** This document owns everything the chain and the canonical frontend must agree on byte-for-byte: shared SCALE types, the `FutarchyApi` runtime API and its view types, the frozen event schema, the storage items and names the frontend reads directly, chain identity constants, the constants-binding rules, the WSS bootnode chain-spec requirement, the backend-published test-artifact feed, and the `ReleaseChannel` raw storage key. It does **not** own the *semantics* behind these surfaces (ledger rules → [03](03-conditional-ledger.md), market mechanics → [04](04-markets-and-pricing.md), decision engine → [05](05-welfare-and-decision-engine.md), oracle game → [07](07-oracle-and-disputes.md), upgrade path → [09](09-execution-upgrades-and-rollout.md)) — but where a name or layout appears both here and there, **this document's spelling is canonical**. Normative language per RFC 2119.

**Ownership and freeze (D-2, resolves F-4).** This contract is **jointly owned by the backend and frontend teams**. It is frozen at whichever version **§13's history marks IN FORCE**, and the number itself lives in exactly one place, **§8's chain-identity table**. **This paragraph deliberately names neither the version nor the method count**, for the reason §2 already gives about the same two values: a copy that has to be maintained will be missed. It named both until 2026-08-07 — *contract version 27* and *the fourteen-method `FutarchyApi`* — while §1, §3 and §13 carried sixteen methods and a later version, so the document's opening statement of what is frozen disagreed with the frozen surface itself. Any change — additive or otherwise — REQUIRES sign-off from both teams and a version bump (§13). The contingency for contract breach is the D-6 layer-1 fallback (chain-served ring + TWAP checkpoints), never a third-party service.

---

## 1. Contract surface at a glance

| # | Surface | Section | Origin |
|---|---|---|---|
| 1 | Shared SCALE primitives (`futarchy-primitives`) | §2 | BE §7, repaired per D-1/D-3/B-2/B-3/B-med |
| 2 | `FutarchyApi` — 16 runtime-API methods + view types | §3–§4a | FE §30 P-5/P-7 + D-20, completed |
| 3 | Frozen event schema (ledger, market, epoch, oracle, registry, guardian, attestor, execution, system) | §5–§6 | FE §15.3 + X-11 fixes |
| 4 | Storage items the frontend reads (incl. `RecentCohortSummaries`, `BaselineMarketOf`, `PhaseFlags`, oracle and attestor items) | §7 | X-1c, X-10, X-11b/c |
| 5 | Chain identity constants | §8 | D-17 |
| 6 | Constants & parameter binding (no FE hardcodes) | §9 | X-11e/h |
| 7 | WSS bootnode chain-spec requirement | §10 | D-6, X-4 |
| 8 | Backend-published test artifacts per release | §11 | X-15 |
| 9 | `ReleaseChannel` fixed-layout raw storage key | §12 | D-14 |
| 10 | Change control | §13 | D-2 |

Disposition of FE §30: P-1…P-4, P-6, P-8…P-11 amend the topology, repository, invariant, testing and rollout content now owned by [01](01-system-overview.md), [09](09-execution-upgrades-and-rollout.md), [12](12-release-and-operations.md) and [15](15-invariants-and-testing.md) and are applied there; P-5 and P-7 are the runtime surface and are applied **and completed** here (the P-5 gaps: the `pallet-epoch` storage-list addition for `RecentCohortSummaries`, and the canonical type name `DecisionOutcome` replacing the FE draft's `DecisionOutcomeCode`).

---

## 2. Shared SCALE primitives (`futarchy-primitives`)

All types live in the `no_std` crate `futarchy-primitives`, SCALE-encoded, versioned via a `#[codec(index)]`-stable discipline: **enum variants and struct fields are append-only after genesis**; removals require a new type + storage migration + contract version bump. All collections `BoundedVec`/`BoundedBTreeMap`. Numeric conventions: balances `u128` (USDC 6 decimals, VIT 12 decimals); prices/scores `FixedU64` semantics (1e9 scale) at every API and event boundary; internal LMSR math in 64.64.

The pre-genesis repairs below (relative to the superseded BE §7) are FINAL as of contract v1; `ProposalClass::Emergency` is deleted *before* genesis, so append-only discipline is not violated.

```rust
pub type ProposalId = u64;                  // monotone, never reused
pub type EpochId    = u32;                  // == EpochIndex
pub type CohortId   = EpochId;              // cohort ≡ its origin epoch
pub type MarketId   = u64;                  // monotone
pub type MetricId   = u16;
pub type MetricSpecVersion = u16;
pub type ResourceId = [u8; 8];
pub type ParamKey   = [u8; 16];

pub enum Branch { Accept, Reject }
pub enum ScalarSide { Long, Short }
pub enum GateType { Survival, Security }

/// Enlarged per B-2 (gate instruments) — semantics in 03.
pub enum PositionKind {
    BranchUsdc,
    Long,
    Short,
    GateYes(GateType),
    GateNo(GateType),
}

/// Enlarged per B-3 (Baseline ledger home) — semantics in 03.
pub enum PositionId {
    Proposal { proposal: ProposalId, branch: Branch, kind: PositionKind },
    Baseline { epoch: EpochId, side: ScalarSide },
}

/// `Voided` added per D-1; proposal vaults use `ScalarSettled`, which carries
/// the winning branch (B-low) and settlement score `s` that redemption needs.
/// Baseline epoch vaults have no branch and use `BaselineSettled`.
pub enum VaultState {
    Open,
    Resolved(Branch),
    ScalarSettled { winner: Branch, s: FixedU64 },
    Voided,
    BaselineSettled { s: FixedU64 },
}

/// Five classes — `Emergency` deleted (D-7).
pub enum ProposalClass { Param, Treasury, Code, Meta, Constitutional }

pub enum ProposalState {
    Submitted, Screening, Qualified, Trading, Extended,
    Queued, Suspended, Rerun,
    Rejected(RejectReason), Executed, FailedExecuted,
    Measuring, Settled, Cancelled, Expired,
}

/// Three variants appended per B-med (producers wired in 05/06/09).
pub enum RejectReason {
    NotDecisionGrade, GateVetoSurvival, GateVetoSecurity, HurdleNotMet,
    ConvergenceFailed, SecondExtensionFailed, ProcessHold, ConstitutionViolation,
    ResourceConflict, RateLimited, VetoUpheldByReview, StaleQueue, PayloadReverted,
    NotRatified,            // D-5: values ratification absent/failed at execute
    SecuritySizing,         // D-4: InCapPrize > AttackCost̂ / 3
    AttestationMissing,     // D-18: bonded kernel attestation quorum absent
    RolloverExhausted,      // 05 §2.1 T26: second deferral cancels with full refund (v6)
}

pub enum EpochPhase { Intake, Qualify, Seed, Trade, Decide, Review, Execute, Housekeeping }

/// CANONICAL decision-outcome type (X-11g). The FE draft name
/// `DecisionOutcomeCode` is RENAMED to this; there is no other outcome type.
pub enum DecisionOutcome { Adopt, Reject(RejectReason), Extend }

/// Dispatch result recorded per execution (X-11g; previously referenced, never defined).
pub enum DispatchOutcomeCode {
    Ok,
    /// index of the failing call within the batch + SCALE-truncated DispatchError.
    Failed { call_index: u8, error: [u8; 4] },
}

/// Ratification state surfaced on proposal views (D-5, D-11).
pub enum RatificationStatus {
    NotRequired,
    NoPassedRecord,
    Passed { referendum: u32 },
}

/// Trade direction for quotes and `Traded` events.
pub enum TradeSide { BuyLong, BuyShort, SellLong, SellShort }
```

The `MetricId` assignment registry is owned by [05](05-welfare-and-decision-engine.md) §4.3 and mirrored in [13](13-parameters.md) §3.4; this contract freezes the `u16` type and its keyed surfaces without creating a third assignment table.

`Proposal` gains the fields the decision engine reads (`ask: Balance`, `decide_at: BlockNumber` — B-med, semantics in [05](05-welfare-and-decision-engine.md)); `ExecutionRecord.result` is typed `DispatchOutcomeCode` as above. The full `Proposal`/`ExecutionRecord` structs and their ≤ 512 B / bound arguments are owned by [05](05-welfare-and-decision-engine.md)/[09](09-execution-upgrades-and-rollout.md); their SCALE layouts are part of this contract by inclusion in `futarchy-primitives`.

Proposal positions MUST project a settled proposal vault as `ScalarSettled { winner, s }`; Baseline positions MUST project a settled epoch vault as `BaselineSettled { s }` and MUST NOT fabricate a proposal branch. `RatificationStatus::NoPassedRecord` means only that the execution guard has no passing ratification record. It is deliberately agnostic between no referendum, an in-flight referendum and a failed referendum; the frontend MUST derive that lifecycle from `pallet-referenda` ([06](06-governance-and-guardians.md) §2.2). `Pending` and `Failed` are removed because the guard cannot truthfully produce them in the deployed design. This `RatificationStatus` restructure is a pre-genesis contract-v6 repair; no deployed SCALE value requires migration.

The crate re-exports `INTEGRATION_CONTRACT_VERSION`, exposed as a `pallet-constitution` runtime constant (metadata-readable, §9). **It reads whichever version §13's history marks IN FORCE.** A bump is always atomic with the surface it describes and is never in force ahead of it, so a consumer reads the constant rather than any prose statement of its value. **This sentence no longer names the number, and the second attempt is the point.** It first named the *pending* version and the condition under which it would change; that was corrected on 2026-07-29 (E4) to name the version in force instead — which is still a second copy, and it was two bumps stale by 2026-08-04. A copy that has to be maintained will be missed; exactly one table in this document carries the value, because a table is what the release gates parse. **That table is §8's chain-identity table, not §9's** — this sentence said §9 from 2026-08-04 until 2026-08-07, one section off from the row it was pointing at, which is the second-copy problem arriving as a wrong address rather than as a stale number. §9's rows correctly say *read the constant*, and §13's history is the authority for which version is in force.

---

## 3. `FutarchyApi` runtime API (16 methods, normative)

Declared in the `runtime-api/` crate; **the runtime MUST implement all 16 methods**. All view types are plain SCALE structs in `futarchy-primitives` (§4/§4a) under the append-only discipline, so the TypeScript side decodes them with generated descriptors. API collections use the shipped const-generic `futarchy_primitives::BoundedVec<T, N>` composite wrapper (a `Vec<T>` field under that exact type path), not FRAME's `BoundedVec<T, ConstU32<N>>`; the generated metadata path and composite form are part of the freeze. All methods are read-only, executed by callers via `chainHead_call` through the light client — no dispatch weight; implementations MUST be O(bounded-collection) with the bounds shown (every backing map is bounded).

```rust
sp_api::decl_runtime_apis! {
    pub trait FutarchyApi {
        /// Epoch clock: index, phase, boundaries, dead-man, freeze and phase flags.
        fn epoch_status() -> EpochStatusView;                                        // ≤ 128 B
        /// All live proposals with market ids, states, decide_at, maturity, ratification.
        fn proposal_summaries() -> futarchy_primitives::BoundedVec<ProposalSummaryView, 32>; // ≤ 32 × 256 B
        /// Exact quote incl. fee for a hypothetical trade at current book state (USDC-denominated, D-3 wrapper semantics).
        fn quote(market: MarketId, side: TradeSide, amount: Balance) -> QuoteView;   // ≤ 96 B
        /// Finalized decision statistics from sealed registered windows (incl. D-4 sizing).
        fn decision_stats(pid: ProposalId) -> Option<DecisionStatsView>;             // ≤ 512 B
        /// All positions of an account across proposal, gate and Baseline instruments,
        /// in the **primary** ledger domain (instance `()`) only — see `service_positions`.
        fn account_positions(who: AccountId) -> futarchy_primitives::BoundedVec<PositionView, 64>;
        /// Execution queue incl. maturity/grace/version/ratification state.
        fn execution_queue() -> futarchy_primitives::BoundedVec<QueuedExecutionView, 32>;
        /// Current welfare pillars, gates, breach + reserve flags, active MetricSpec.
        fn welfare_current() -> WelfareView;                                         // ≤ 1 KiB
        /// Typed constitution params (value + bounds + governance metadata) for ≤ 64 keys.
        fn params(keys: futarchy_primitives::BoundedVec<ParamKey, 64>) -> futarchy_primitives::BoundedVec<ParamView, 64>;
        /// Treasury NAV components (matches the treasury definition in 08), incl. haircut flag.
        fn nav() -> NavView;                                                         // ≤ 256 B
        /// Ring of the last 32 cohort settlements (mirrors RecentCohortSummaries, §7.1).
        fn recent_cohorts() -> futarchy_primitives::BoundedVec<CohortSummaryView, 32>;
        /// Oracle rounds currently open.
        fn open_oracle_rounds() -> futarchy_primitives::BoundedVec<OracleRoundView, 192>; // ≤128 live (16×4×2 per-version); cap 192
        /// Immutable hosted-question report projection once the question is sealed.
        fn hosted_report(question_id: QuestionId) -> Option<ReportView>;
        /// All positions of an account in the **service** ledger domain
        /// (`ServiceLedger` = `pallet_conditional_ledger::<Instance1>`, §7.1).
        fn service_positions(who: AccountId) -> futarchy_primitives::BoundedVec<PositionView, 64>;
        /// Whether an account is a reserved protocol destination — the exact predicate
        /// `ledger.transfer` refuses on ([11](11-frontend-workflows.md) §11.5 P-9).
        fn is_reserved_protocol_destination(who: AccountId) -> bool;
        /// What a **not-yet-created** bonded action would hold, priced at the current
        /// block. `None` = not determinable ([07](07-oracle-and-disputes.md) §7).
        fn bond_quote(request: BondQuoteRequest) -> Option<BondQuoteView>;
        /// Every outbound treasury stream whose recipient is `who`, each carrying the
        /// exact amount `claim_stream` would pay now ([11](11-frontend-workflows.md) §11.8.3).
        fn treasury_streams(who: AccountId) -> futarchy_primitives::BoundedVec<StreamView, 128>;
    }
}
```

**`bond_quote` is one method for two bonds, and that is the whole of it (contract v29; SQ-598 and SQ-731).** [07](07-oracle-and-disputes.md) §6.1 and §7 state **one** fold under two names: `StakeAtRisk(c, m)` and `Exposure(kind, m)` are the same sum of `CohortEscrow(k)` over the live cohort schedules, differing only in which cohorts fall in scope. Publishing it twice would let the copies drift, which is the defect class §7.8 and v24 repaired from three other directions.

Three properties are normative.

- **It publishes the amount, not the ingredients.** The method returns the money the action would hold. A client that instead read the exposure and applied `max(floor, ceil(bps × X / 10,000))` itself would own three details [07](07-oracle-and-disputes.md) §6.1 states separately: the division rounds **up**, rounding resolves toward custody, and the `max` applies **after** rounding. Getting any of them wrong under-collateralizes a bond, which is the under-custody direction I-4 and I-28 name as the unsafe one — and this is money a user must post. The challenge side is already symmetric: it reads `OracleRoundView.bond`, the chain's own frozen figure. `exposure` and `read_at` ship beside the amount as **disclosure**, and a client displays `bond` and never recomputes it.
- **It is a quote.** [07](07-oracle-and-disputes.md) §6.1's escrow read point is normative — `CohortEscrow` is read at the block round 1 of the `(c, m)` game is created and frozen for the lifecycle — and §7 freezes a filing's bond at creation the same way. A bond asked for *before* that object exists is therefore the figure at the current block, not the figure that will bind. This is `quote()`'s shape applied to bonds, and a client MUST disclose that the amount is priced at `read_at` and fixes at submission.
- **`None` is a first-class answer, not an error.** [07](07-oracle-and-disputes.md) §7 makes the Milestone exposure **not determinable** until the aggregate is bound to a component, and requires `file` to refuse with `ExposureUnavailable` — *"which is the status-quo default (G-1), not a gap"*. The optional return is what lets the method say so, and a client receiving `None` blocks. The oracle arm answers `None` on the same principle when the live parameters cannot price a round-1 bond at all.

Round 1 is the only round `bond_quote` prices. Every later round derives from the game's stored `B_1` by [07](07-oracle-and-disputes.md) §6.1's doubling rule and is read from the round record; a registry counter-round posts the filing's **stored** bond. So the request set is the three bonds with no record to read, and deliberately not a general bond enumeration.

**`treasury_streams` preserves §7.6's closing rule rather than carving into it (contract v29; SQ-601).** That rule requires every treasury consumer to bind `nav()` rather than raw `pallet-futarchy-treasury::State`, while [11](11-frontend-workflows.md) §11.8.3 requires *"claimable now"* rendered **per stream** and `nav()` publishes only the `stream_remainders` aggregate. The two were read as contradicting each other. They do not: the rule forbids binding **raw storage**, and a published runtime-API projection is not raw storage — `nav()` is itself one. So a per-caller projection satisfies §11.8.3 while keeping [11](11-frontend-workflows.md) §11.4 rule 2's *exact chain read* property, which a stated exception to §7.6 would have given up. **§7.6's text is therefore unchanged**, and no `pallet-futarchy-treasury` storage becomes contract surface.

**Both implementations MUST be bounded, and the bound is structural.** `bond_quote`'s folds walk `Epoch.CohortSchedules`, whose key set is exactly the live cohort epochs — `Cohorts` is capped at four non-terminal (§7.1) and `pallet-epoch`'s `try_state` refuses an orphan schedule — and each schedule carries at most one binding per cohort slot, bounded by the **hard maximum of `epoch.slots`, 12** ([13](13-parameters.md) §1 — the hard max, not its launch default of 5, so a governance raise cannot outgrow the bound). The walk is therefore ≤ 4 schedule reads, ≤ 48 vault reads and ≤ 48 `MetricSpecs` reads, independent of chain age and of how many games exist. That is the bound [07](07-oracle-and-disputes.md) §7's audit-concerns note asks of `F(kind, epoch)`. `treasury_streams` is bounded by the whole stream register, `MaxStreams = 128` (§9) — the register rather than a narrower per-recipient figure, because every stream may lawfully name one recipient, so no caller's rows can be truncated.

**Why `is_reserved_protocol_destination` is a method and not a published derivation.** `ledger.transfer` refuses a recipient that is a protocol destination, and the runtime's test is a `Contains` implementation — a domain-separated address namespace plus a set of `PalletId`-derived singletons — not a storage item. [11](11-frontend-workflows.md) §11.5's P-9 clause therefore had **no chain surface to cite at all**, and the canonical client simply omitted it: a user could be walked to a signature the runtime then refuses (SQ-588). Publishing the namespace as frozen constants was the obvious alternative and is wrong for a *precondition*: [11](11-frontend-workflows.md) §11.4 rule 2 requires every row in that table to be **an exact chain read**, and a client recomputing membership from constants is evaluating a computation. It is the same distinction that makes `ConditionalLedger::ServiceIdBase` correctly a metadata constant — that classifies a datum the client already holds, while this asks the chain about an address the user has just typed. It would also be a second copy of a predicate, maintained in a language that cannot see when the first one moves.

Note it is **not** `MarketProtocolAccounts::contains_key`. That index is ownership/refcount state governing deposit exemption and is strictly narrower: classification does not depend on it, because every canonical future, present and past book address is reserved by namespace whether or not a book currently references it. A client bound to the narrower predicate would pass rows the runtime refuses.

**The two position methods are separate by necessity, not by taste.** `MAX_ACCOUNT_POSITIONS = 64` is a per-account cap enforced *within* each ledger instance, so an account may lawfully hold 64 primary and 64 service positions at once. Merging both domains into one 64-slot return would make truncation reachable for ordinary user accounts — and truncation here is not a display artifact but money the canonical client would not show. The implementations' shared truncation argument ("user accounts cannot exceed the bound; [13](13-parameters.md) §4 exempts only protocol accounts") is instance-scoped, and it stays true only while each domain answers in its own vector. `PositionView` is unchanged and identical in both, and the id bands of [16](16-hosted-question-service.md) §7.1 (`kernel::SERVICE_ID_BASE = 1 << 63`) make a returned position's domain decidable from its id alone, so a consumer that concatenates the two results never has to guess which domain a row came from.

`decision_stats(pid)` MUST return `None` until the proposal's registered decision windows have been sealed and every input required by the decision path is evaluable. It is a finalized decision-statistics view, not an in-Trade projected TWAP.

**Three methods are not client-recomputable, and the closing sentence of the posture below does not reach them (normative; stated at contract v29).** That sentence — *"every value is also recomputable client-side from the storage items of §7"* — is true of every projection method and false of three: `is_reserved_protocol_destination` evaluates a `Contains` implementation that is not storage (v25), and `bond_quote`'s two bond arms are amounts a client is **forbidden** to derive, since deriving them is exactly the rounding ownership §3's `bond_quote` note refuses. This is not a gap being tolerated; it is the point of those methods, and leaving the sentence unqualified would have made the contract assert a fallback that cannot exist.

What replaces recomputation for them is stated rather than assumed. The runtime computes each from the **same function its own dispatch path calls** — `oracle_core::round_bond` for a report, `pallet-registry`'s filing-bond rule for a filing — so a published figure and a frozen one cannot be two numbers. And the dispatch re-derives the amount at inclusion regardless of what was quoted: a wrong quote misleads the client's headroom check and cannot cause the chain to hold the wrong sum. `treasury_streams` is **not** in this set — its `claimable_now` is likewise computed by the dispatch's own function, but the underlying stream fields it projects are recomputable in principle; what §7.6 withholds is the *raw storage binding*, not the arithmetic.

**Verification posture.** Runtime calls execute as `chainHead`-scoped calls: smoldot runs the runtime locally against proof-backed storage for the chosen finalized block. **FE-P2 resolved 2026-08-05, positively, from `smoldot@3.3.2`'s own source at the tag the lockfile pins** — the call is executed locally against a call proof verified against the state root of the header the client pinned, so a hostile peer can withhold entries (a failed call) but cannot forge a value; see [10](10-frontend-architecture.md) §4.2 for the mechanism and its two normative consequences. The cross-check of every `FutarchyApi` result used on the transaction path against direct storage reads is **retained**, no longer as a conservative posture pending this gate but as defence against a client misreading an aggregate API's semantics — which proof verification says nothing about. Runtime APIs are an optimization, never a trust root: every value is also recomputable client-side from the storage items of §7.

---

## 4. View types (normative, `futarchy-primitives`)

```rust
pub struct EpochStatusView {
    pub index: EpochId,
    pub phase: EpochPhase,
    pub phase_start_block: BlockNumber,
    pub next_boundary: BlockNumber,
    pub dead_man_armed: bool,          // dead-man switch engaged (09)
    pub ledger_frozen: bool,           // PB-LEDGER-FREEZE active (D-9)
    pub phase_flags: u32,              // verbatim copy of pallet-constitution::PhaseFlags (§7.3)
}

pub struct ProposalSummaryView {
    pub id: ProposalId,
    pub class: ProposalClass,
    pub state: ProposalState,
    pub proposer: AccountId,
    pub epoch: EpochId,
    pub payload_hash: H256,
    pub ask: Balance,                                   // 0 for non-treasury asks
    pub decision_market: Option<(MarketId, MarketId)>,  // (accept, reject)
    pub gate_markets: Option<[MarketId; 4]>,            // (S,C) × (adopt, reject)
    pub decide_at: BlockNumber,
    pub maturity: Option<BlockNumber>,                  // set once Queued
    pub ratification: RatificationStatus,               // D-5/D-11
    pub funder: AccountId,                              // contract v18 — bond custody; == proposer unless split
}

pub struct QuoteView {
    pub cost: Balance,            // USDC the wrapper charges (buy) / pays (sell), excl. fee
    pub fee: Balance,             // USDC fee at the current mkt.fee
    pub p_after_1e9: FixedU64,    // post-trade instantaneous price
    pub max_trade: Balance,       // current per-trade max for this book
    pub within_domain: bool,      // |q_L − q_S|/b ≤ 48 after the trade
    pub evaluable: bool,
}

pub struct DecisionStatsView {
    pub pid: ProposalId,
    pub twap_accept_1e9: FixedU64,
    pub twap_reject_1e9: FixedU64,
    pub twap_baseline_1e9: FixedU64,
    pub r_eff_1e9: FixedU64,                    // max(reject, baseline − σ)
    pub trailing_accept_1e9: FixedU64,
    pub trailing_reject_1e9: FixedU64,
    pub coverage_pct: u8,
    pub traded_volume: Balance,
    pub v_min_required: Balance,                // Ask-scaled (D-4 secondary)
    pub converged: bool,
    pub gate_twaps_1e9: Option<[FixedU64; 4]>,  // (S,C) × (adopt, reject)
    pub attack_cost_hat: Balance,               // D-4 primary: measured-depth estimate
    pub in_cap_prize: Balance,                  // must satisfy ≤ attack_cost_hat / 3
}

pub struct PositionView {
    pub position: PositionId,       // proposal, gate or Baseline instrument
    pub balance: Balance,
    pub vault_state: VaultState,    // proposal: ScalarSettled; Baseline epoch vault: BaselineSettled
}

pub struct QueuedExecutionView {
    pub pid: ProposalId,
    pub class: ProposalClass,
    pub payload_hash: H256,
    pub maturity: BlockNumber,
    pub grace_end: BlockNumber,
    pub version_constraint: RuntimeVersionConstraint,
    pub cancelled: bool,
    pub ratification: RatificationStatus,
    pub meters_clear: bool,         // rate meters would admit execution now
}

pub struct WelfareView {
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
    pub s_pillar_1e9: FixedU64,
    pub c_onchain_1e9: FixedU64,    // deterministic sub-pillar (D-18)
    pub c_attested_1e9: FixedU64,   // attested sub-pillar (settlement-time only)
    pub p_pillar_1e9: FixedU64,
    pub a_pillar_1e9: FixedU64,
    pub gate_s_1e9: FixedU64,
    pub gate_c_1e9: FixedU64,
    pub w_current_1e9: FixedU64,
    pub s_breached: bool,
    pub c_breached: bool,
    pub reserve_flag: bool,         // reserve-health trigger R (B-med USDC-freeze)
    pub active_spec_available: bool,
}

pub struct ParamView {
    pub key: ParamKey,
    pub value: u128,                // raw inner scalar of the stored ParamValue
    pub min: u128,
    pub max: u128,
    pub max_delta: u128,
    pub cooldown_blocks: u32,
    pub last_change: BlockNumber,
    pub class: ProposalClass,
    pub min_next: u128,
    pub max_next: u128,
}

pub struct NavView {
    pub total: Balance,             // NAV per the definition in 08
    pub main: Balance,
    pub pol: Balance,
    pub insurance: Balance,
    pub keeper: Balance,
    pub oracle: Balance,
    pub rewards: Balance,
    pub stream_remainders: Balance, // undisbursed outbound streams
    pub obligations: Balance,
    pub haircut_flag: bool,         // 08 §1.2 reserve_impaired; true while reserve health is degraded
    pub spendable_nav: Balance,     // 08 §1.2 spendable NAV; 0 while haircut_flag is true
    pub meter_utilization_bps: u32, // 08 §1.3 rolling-meter utilization, in basis points
    pub class_floors: [Balance; 4], // 08 §4.1; Param, Treasury, Code, Meta declaration order
    pub insurance_target: Balance,  // contract v29 — 08 §1.2's derived T_ins (trailing append)
    pub stream_claims_wired: bool,  // contract v29 — is claim_stream's real-asset leg wired?
}

// Every market-bearing proposal carries gate markets. PARAM uses the ≈4,620,989
// USDC class floor and Treasury the 7,393,600-USDC class floor implemented by
// 08 §4.1; the existing four-slot array and optional four-market IDs are unchanged.

/// Stored form == view form (§7.1). FE draft's `DecisionOutcomeCode` is renamed.
pub struct CohortSummary {
    pub epoch: EpochId,
    pub s_1e9: FixedU64,
    pub baseline_twap_1e9: FixedU64,
    pub proposals: futarchy_primitives::BoundedVec<(ProposalId, ProposalClass, DecisionOutcome), 12>,
    pub voided: bool,
    pub settled_at: BlockNumber,
}
pub type CohortSummaryView = CohortSummary;

// The 12-entry proposal bound is the hard maximum of the `epoch.slots` key
// (13 §1), not its launch default. A governance raise can therefore never
// truncate the D-6 chain-served fallback surface.

pub struct OracleRoundView {
    pub component: MetricId,
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,  // per-version game key (contract v3, 07 §2(4))
    pub round: u8,                        // 1..=3
    pub reporter: AccountId,
    pub value_1e9: FixedU64,
    pub evidence_hash: H256,
    pub bond: Balance,                    // value-scaled per D-18
    pub challenge_deadline: BlockNumber,
    pub acked_by_watchtowers: u8,         // quorum progress (D-18)
    pub escalated: bool,                   // round > 1; a prior round advanced the game
}

// Contract v29 — the three bonds a client must price before the record that
// would freeze the amount exists (SQ-598, SQ-731).
pub enum BondQuoteRequest {
    OracleReport { component: MetricId, epoch: EpochId },   // 07 §6.1 B_1(c, m), round 1 only
    IncidentFiling { epoch: EpochId },                      // 07 §7 F(Incident, m)
    MilestoneFiling { epoch: EpochId },                     // 07 §7 F(Milestone, m)
}

pub struct BondQuoteView {
    pub bond: Balance,          // the amount the action would hold — the only presentable figure
    pub exposure: Balance,      // StakeAtRisk(c, m) / Exposure(kind, m); disclosure only
    pub read_at: BlockNumber,   // the block the escrow fold was read at
}

// Contract v29 — one outbound treasury stream as its recipient sees it (SQ-601).
pub struct StreamView {
    pub id: u64,
    pub total: Balance,
    pub claimed: Balance,
    pub start: BlockNumber,
    pub duration: BlockNumber,
    pub cancelled: bool,
    pub claimable_now: Balance, // exactly what claim_stream would pay now
}
```

`BondQuoteRequest`'s registry arms name the two **instances** rather than carrying a `RegistryKind` argument, because that is what a client selects: `pallet-registry` is instantiated twice as `IncidentRegistry` and `MilestoneRegistry`, and the two allocators share no filing-id space (§7.4).

`BondQuoteView.bond` is the figure a client displays, and it MUST NOT be recomputed from `exposure` — see §3. A `None` return is [07](07-oracle-and-disputes.md) §7's *not determinable*, and a client that receives it blocks rather than substituting a floor: the floor is a lower bound on the bond, never the bond, and presenting it as the amount understates what the user is about to commit.

`StreamView.claimable_now` is the chain's own answer to [11](11-frontend-workflows.md) §11.8.3's *"claimable now"*, published rather than derived so that §11.4 rule 2's exact-chain-read property holds for the row. It is **monotone** between the block it was read at and inclusion — vesting never decreases and `claimed` moves only on a claim — so a displayed figure can only understate what a later claim pays. Cancellation is the one discontinuity, and it is a precondition re-read. Zero covers three distinct refusals (cancelled, not started, fully claimed) and the other fields distinguish them; a client MUST render which one applies rather than a bare zero.

`QuoteView.evaluable` MUST be `true` for every successfully computed quote, including a quote whose post-trade state has `within_domain == false`. It MUST be `false` for a missing, closed, trade-inadmissible, inventory-invalid or overflowing book; in that state every price-like field is non-renderable and non-actionable. `within_domain` retains exactly one meaning: the post-trade `|q_L − q_S| / b ≤ 48` predicate.

`WelfareView.spec_version` is meaningful only when `active_spec_available == true`. A selected `MetricSpecVersion` of zero is legal and MUST still set `active_spec_available`; a false flag means that no unique active spec is available under [05](05-welfare-and-decision-engine.md) §4.6.

`ParamView.value`, `.min` and `.max` carry the raw inner scalar of the stored `ParamValue`: `Fixed` uses the 1e9 grid, `Perbill` uses parts per billion, `Percent` uses integer percent, and integer/balance variants use their native scalar. These fields MUST NOT be interpreted as the human/display unit in [13](13-parameters.md). The canonical `Perbill` → basis-points projection divides by 100,000 and floors; fee recomputation MUST use the frozen `Market::Fee` basis-points constant and cross-check it against the raw `mkt.fee` parameter. The identical rule binds `ConditionalLedger::RedemptionFee` against the raw `ledger.redeem_fee` parameter wherever a redemption net payout is displayed (contract v17; [03](03-conditional-ledger.md) §5.3a). `max_delta` remains the conservative symmetric projection `min(upward allowance, downward allowance)` and is intentionally lossy for factor rules. `min_next` and `max_next` are the exact inclusive next-value interval after intersecting the record bounds with its max-Δ rule; no delta rule yields `[min, max]`, and a factor rule rounds the lower end as `ceil(value / factor)` and saturates the upper end as `value × factor`.

`OracleRoundView.escalated` is `round > 1`: it is true iff at least one prior round advanced the game. It MUST be false for a round-1 report even while that round has a live challenger, and MUST NOT be interpreted as “currently challenged”; any future view of that distinct fact requires a separately named field.

**`NavView.stream_claims_wired` is what keeps `treasury_streams` from being a trap, and the two ship together.** [08](08-treasury-and-economics.md) §1.4's A9 fungibles follow-up leaves the real-asset payout leg of `claim_stream` unwired in a runtime that has not bound custody, and such a runtime refuses the call with `OutflowCustodyUnwired` **every time** rather than consuming a stream entitlement and reporting a movement that never happened. Publishing a per-stream `claimable_now` without publishing that fact would open a control whose every use is refused after signature — the defect class this contract version exists to close, reintroduced by the same version. So [11](11-frontend-workflows.md) §11.8.3's row reads it and blocks on it, and the reason shown names the runtime rather than the stream. The field is scoped to the **claim** leg and its name says so: the same seam gates `spend`, `issue_vit` and `recover_foreign`, but those are dispatched by governance rather than signed by a canonical-client user, and a client MUST NOT infer their state from this field.

`NavView.insurance_target` is [08](08-treasury-and-economics.md) §1.2's derived `T_ins` — the unreclaimed swept-residue liability the `INSURANCE` account backs, plus `min_balance` — appended trailing at contract v29 under §13 rule 3 (SQ-602). It exists because [11](11-frontend-workflows.md) §11.8.3 requires `INSURANCE` presented as a **sized reserve against its target** and never as protocol income, and until this field the only client that could make that classification was one that fabricated the target it compares against, which is the INV-FE-1 defect. Two readings are wrong: the field is not a *floor* the account is topped up to (nothing tops it up; §1.2 only overflows the surplus above it to `MAIN`), and a balance sitting flat at the target under continuing inflows is the normal state, not a stalled sweep. `T_ins` is a deliberate over-estimate in v1 — §1.2's archived-claims decrement is unspecified, so the counter is monotone — and a client MUST NOT present the gap between `insurance` and `insurance_target` as a measured shortfall.

### 4a. Hosted question service — contract **v22** (D-20; IN FORCE)

Authored here rather than only in §13's history, because a history entry saying a section "gains"
a surface is not a surface: N7 could not implement a byte-for-byte contract from a changelog, and
two clients reading only the changelog would encode v21 differently. N7 landed that base surface
atomically at v21. N9 retains every v21 type and method byte-for-byte, appends the client delivery
float and freezes the push receiver ABI at v22; the definitions below are the current surface.

```rust
// §3 — the twelfth `FutarchyApi` method (additive; bumps the sp_api version too)
fn hosted_report(question_id: QuestionId) -> Option<ReportView>;

// §4 — exact aliases and enums this surface introduces
pub type QuestionId = u64;
pub type ClientId   = u32;

pub enum VoidReason {          // #[codec(index)]-stable, append-only
    NoQuorum,                  // 0
    MedianOutOfRange,          // 1
    DeadlineMissed,            // 2
    ServicePaused,             // 3
    EscrowInsufficient,        // 4
    AttestorSetCollapsed,      // 5
    ClientUnreachable,         // 6
}                              // registry removal is NOT here — 16 §2/§6.4

pub struct ReportView {
    pub question_id: QuestionId,          // u64
    pub client_id: ClientId,              // u32
    pub sub_id: [u8; 32],                 // opaque; stored, echoed, never interpreted
    pub twap_accept_1e9: FixedU64,        // sealed segment TWAP, 1e9 grid (04 §7)
    pub twap_reject_1e9: FixedU64,
    pub observations: u32,
    pub window_start: BlockNumber,
    pub window_end: BlockNumber,
    pub b_accept: Balance,                // the liquidity actually posted
    pub b_reject: Balance,
    pub manip_floor: Balance,             // 05 §5.6 cash form, rounded DOWN
    pub declared_stake: Balance,          // S, republished verbatim
    pub epsilon_1e9: FixedU64,            // ε, republished verbatim
    pub tolerance_1e9: FixedU64,          // the §6.3 deviation tolerance, FROZEN at
                                          //   registration. It is contract surface
                                          //   because settlement takes it as an
                                          //   argument: without it here a widened
                                          //   value could excuse otherwise-slashable
                                          //   submissions undetectably
    pub certified: bool,                  // C_disp(ε) ≥ 3·S — NOT ManipFloor̂ (16 §5.2)
    pub settlement_trust: SettlementTrust,
    pub provenance_hash: H256,            // blake2_256 over the domain-separated SCALE preimage
}                                         //   separator b"bleavit/hosted-report/v1" (16 §6.3)

pub struct SettlementTrust {
    pub attestors: u32,
    pub quorum: u32,
    pub bond_total: Balance,
}

pub enum QuestionPhase { Registered, Open, Sealed, Settled, Voided }
```

**§6 additions — client-facing events.** These meet criterion (b): [16](16-hosted-question-service.md)
requires a client to observe its own question's terminal state without trusting a push.

| Event | Shape |
|---|---|
| `QuestionRegistered` | `{ question_id: QuestionId, client_id: ClientId, window_end: BlockNumber }` |
| `QuestionSealed` | `{ question_id: QuestionId, provenance_hash: H256 }` |
| `QuestionSettled` | `{ question_id: QuestionId, value_1e9: FixedU64 }` |
| `QuestionVoided` | `{ question_id: QuestionId, reason: VoidReason }` |

Push-failure and ingress-metering events meet none of (a)–(c) and are pallet-local diagnostics.

**§7 additions — storage the frontend may read directly.**

| Key | Value | Bound |
|---|---|---|
| `Clients: map ClientId → ClientRecord` | `{ location: Option<Location>, local_signer: Option<AccountId>, bond: Balance, admitted_at: BlockNumber, questions_live: u32, questions_total: u32, delivery_float: Balance }` — exactly one identity field is `Some`; the trailing v22 field is the client's USDC egress liability, never native bond value (16 §2/§9) | `MaxClients` = 64 (13 §4) |
| `Questions: map QuestionId → QuestionRecord` | `{ client_id: ClientId, phase: QuestionPhase, window_start: BlockNumber, window_end: BlockNumber, declared_stake: Balance, epsilon_1e9: FixedU64, tolerance_1e9: FixedU64, markets: [MarketId; 2] }` | `svc.max_live` live + retention |
| `Reports: map QuestionId → ReportView` | as above | one per sealed question, retained to archive |

**§7.1 scoping (normative; reversed at v23, 2026-08-03).** Every conditional-ledger row named in §7
without qualification is scoped to instance `()`. `ServiceLedger`
(`pallet_conditional_ledger::<Instance1>`) has its own storage prefix, and **its
`{Vaults, BaselineVaults, Positions, PositionTotals}` rows are canonical-frontend ingest surface**
under exactly the shapes, bounds and key orders §7.4 freezes for the primary instance — the two
instances are the same pallet, so no second set of shapes is being frozen here.

Until v23 this paragraph said the opposite, and the exclusion was wrong in a way worth recording
rather than quietly deleting. Every other layer of the system already admits a Bleavit account into
a hosted book: `market.buy` is a `CallDomain::Public` call ([16](16-hosted-question-service.md)
§6.2), `LedgerRoute::for_book` routes such a trade to `Instance1` with no caller-visible difference,
`quote()` prices external books through the same physical `Markets` map (§7.4), and 16's economics
depend on it — the fee term is sized on organic order flow, and an underfunded client is expected to
reach its certificate *out of ordinary trader activity* ([16](16-hosted-question-service.md) §10).
The excluded surface was therefore not an unused one: it was the record of money real users can
already commit, hidden from the one client whose stated purpose is proving what it shows. A client
that cannot read it does not degrade gracefully — it reports a balance that is missing a position,
which INV-FE-1's honesty obligation does not survive.

**What the reversal does not license.** Admission to the ingest surface is a *read* grant and
nothing more. External books remain outside every governance and welfare input: `H` is computed on
primary/system usage, never by subtracting service traffic, and no service-domain row may feed a
decision statistic, a gate, a NAV component or a welfare pillar ([16](16-hosted-question-service.md)
§8.5, [05](05-welfare-and-decision-engine.md)). The client MUST render the two domains as
distinguishable at a glance and MUST NOT aggregate them into a single portfolio total that implies
one solvency pool — [03](03-conditional-ledger.md)'s I-4 solvency invariant holds *per instance,
against its own sovereign account*, which is the whole reason the second instance exists
([16](16-hosted-question-service.md) §7.1), and a merged total would assert a guarantee neither
domain gives. The id bands make this cheap rather than a matter of care: `kernel::SERVICE_ID_BASE
= 1 << 63` partitions every question, book, vault and position id, so domain is a single bit test on
an id the client already holds, not a lookup it could get wrong.

**§9 additions — metadata constants.** `QuestionService::FeeFloor`, `QuestionService::MaxLive`,
`QuestionService::MaxWindow`, `QuestionService::EpsilonMin`, `ClientRegistry::ClientBond`, and
`QuestionService::AttestorsMin` (kernel `3`). The `svc.fee_bps` PARAM row binds through `params()`
like every other tunable. It was **absent from metadata while unset**, and that absence was the
arming gate (16 §8.1); it was **adopted at 1,000 bps on 2026-08-02**, so the key is now present and
the service is armed. This is not a contract change — `params()` takes arbitrary keys and its shape
is unchanged, so no `INTEGRATION_CONTRACT_VERSION` bump is owed for it — but an integrator reading
the previous sentence would have concluded the service was inert, which is why it is corrected here
rather than left to be inferred from 13 §1.

`svc.price_cap` (16 §8.6, N14) binds the same way and owes **no bump** for the same reason. It was
adopted at **4** on 2026-08-04, so an integrator now reads a present key whose value bounds the
scarcity multiplier at 4× the flat two-part tariff. The asymmetry that mattered while it was absent
still governs how a *missing* key must be read, and it runs opposite to the row above: while
`svc.fee_bps` was unset the service was *inert*, but an absent `svc.price_cap` means the multiplier
is `1` — fully **operational**, not a refusal. A client that treats a missing key as "closed" would
be wrong here in the opposite direction from the row above it. Read the live value; do not infer
either state from absence.

**Client transaction and outbound-receiver additions (v22).** `ClientRegistry` appends call index `3`,
`top_up_delivery_float(amount: Balance)`, and call index `4`,
`withdraw_delivery_float(amount: Balance)`. Both derive the exact client, USDC asset and funding
account from origin/registry state; neither admits a caller-selected destination, beneficiary or
asset. Their trailing refusal surface includes `DeliveryFloatBelowMinimum`, which preserves the
USDC asset minimum for every nonzero escrow claim, and `DeliveryFundingWouldDust`, which prevents
an exact top-up from reaping uncredited source dust. Existing call indices do not move. The hosted
push is not a dispatchable on Bleavit: it is
the fixed v5 program of [16](16-hosted-question-service.md) §9, whose sole `Transact.call` is
`[66u8, 0u8] ++ SCALE(ReportView)`. Client runtimes reserve pallet index `66` for the drop-in
`QuestionServiceReceiver` and call index `0` for `receive_report(report)`. **This egress surface adds
no `FutarchyApi` method and does not move its `sp_api` version** — it left the API at the 12 methods
of v22, and v23's separate `service_positions` append is what carries it to 13 (§3);
`transaction_version` remains independent and is unchanged for these additive calls.

---

## 5. pallet-market events (X-1b)

`pallet-market`'s call table gains an explicit **Events** column; the price-history pillar of the frontend is fed exclusively by these events. Emission points are normative.

| Event | Fields | Emitted when |
|---|---|---|
| `Traded` | `{ market: MarketId, who: AccountId, side: TradeSide, amount: Balance, cost: Balance, p_after: FixedU64 }` | Every successful `buy`/`sell` fill (wrapper semantics D-3); `side` is the 4-variant `TradeSide` (§2) and `amount`/`cost` are **unsigned magnitudes** — direction is carried entirely by `side`; `cost` is USDC incl. maker payment, excl. fee; **`p_after` = the post-trade instantaneous `p_L`** (1e9; `p_S = 1 − p_L` is derived; gate books map YES ↦ LONG) |
| `Observed` | `{ market: MarketId, o_t: FixedU64 }` | Every accepted TWAP observation (on-trade and cranked) on the 10-block observation grid *(normative interval: [13](13-parameters.md))* |
| `MarketCreated` | `{ market: MarketId, kind: MarketKind, pid: Option<ProposalId>, epoch: EpochId, b: Balance }` | Primary-domain book deployment at Seed (`MarketKind ∈ { DecisionAccept, DecisionReject, GateS_Adopt, GateS_Reject, GateC_Adopt, GateC_Reject, Baseline }`). External-book discovery is the question service's `QuestionRegistered` event and `Questions.markets: [MarketId; 2]`; it MUST NOT synthesize a `MarketKind`, proposal or epoch |
| `MarketClosed` | `{ market: MarketId }` | Book frozen at decision close / branch resolution (books do NOT reopen — D-8) |
| `MarketReaped` | `{ market: MarketId }` | Post-settlement cleanup |
| `RevenueSwept` | `{ market: MarketId, fee_to_main: Balance, pol_returned: Balance }` | The permissionless Signed keeper crank **`market.sweep_revenue(market)`** succeeded ([04](04-markets-and-pricing.md) §2, contract v17): the fee account's realizable claims were realized to USDC and remitted 100 % to the treasury `MAIN` account, and the book account's every realizable surviving position were returned to `POL` (decision/gate) or `POL_BASELINE` (Baseline) — [08](08-treasury-and-economics.md) §1.1 and §8 step 5. Both amounts are **real USDC**, never branch-USDC or position units; either MAY be `0`. The crank is idempotent, so a repeat run is a silent no-op and exactly one `RevenueSwept` exists per market |
| `ExternalRevenueSwept` | `{ market: MarketId, fee_to_main: Balance, subsidy_returned: Balance }` | Contract v20's external-domain counterpart: fees are service revenue remitted 100 % to treasury `MAIN`, while surviving subsidy inventory returns only to the immutable exact funder recorded when the external pair was created ([04](04-markets-and-pricing.md) §3; [16](16-hosted-question-service.md) §7.3–§7.4). `subsidy_returned` is real USDC and is never POL/NAV; either amount MAY be `0`. Exactly one event exists per successfully swept external book |

The minimal FE ingest set is `Traded` + `Observed`; the lifecycle events bound chart ranges without storage diffing. `RevenueSwept` joins `MarketCreated`/`MarketClosed`/`MarketReaped` as a lifecycle event: [04](04-markets-and-pricing.md) §2 makes the sweep a precondition of reap, so it is the chain-served signal that a closed book has been realized and is now reapable, and its `pol_returned` leg is the market-side record of the POL custody return that `nav()` moves on. For an external book, `ExternalRevenueSwept` carries the deliberately different ownership incidence and the question-service events supply pair creation/terminal discovery; `MarketClosed` and `MarketReaped` remain common to both domains.

---

## 6. Frozen event schema (all pallets the frontend ingests)

This section freezes the **names and field shapes of the events the canonical frontend ingests**. It is exhaustive for that ingest set: the frontend `CRITICAL_SURFACE` list and local-index ingest filter MUST use exactly these names. It is not an exhaustive declaration of every event a pallet may emit.

An event MUST appear here if any of the following holds: (a) the canonical frontend ingests it for a workflow in [11](11-frontend-workflows.md); (b) another architecture document **requires the canonical frontend to read or surface it**; or (c) it is the sole on-chain record of a terminal proposal, vault or cohort state transition. An event meeting none of these conditions MAY be emitted as a pallet-local operational diagnostic; it is not contract surface, and adding, changing or removing one does not bump the contract version.

Criterion (b) is deliberately narrower than "another document specifies its fields". A document may fix an event's name and field semantics *without* making it contract surface — [08](08-treasury-and-economics.md) §1.4 does exactly that for `KeeperBudgetLow`/`KeeperBudgetExhausted`, which stay treasury-owned and amendable there without an integration-contract change. What binds an event here is a frontend read obligation, not the existence of a normative field list.

**Off-contract diagnostics are defined by rule, not by enumeration.** A pallet event that fails (a)–(c) is outside this schema whether or not it is named here; the per-pallet rows below are the complete ingest set, and everything else a pallet emits is outside it by construction. Pallets with no row in this section (`pallet-welfare`, `pallet-futarchy-treasury` beyond the row below, `pallet-constitution`) have no event in the ingest set. Shipped examples of the excluded class, given only to make the boundary concrete: `pallet-execution-guard::PendingOutflowSyncFailed`, `pallet-epoch::IntakePauseSet`/`IntakePauseCleared`, and the ledger and market freeze/pause diagnostics.

Canonical names below are FINAL. **X-11d fix:** the FE draft's four misnamed epoch events are corrected — `Withdrawn` → **`ProposalWithdrawn`**, `Cancelled` → **`ProposalCancelled`**, `Qualified` → **`ProposalQualified`**, `Deferred` → **`ProposalDeferred`**.

| Pallet | Events (canonical) |
|---|---|
| `pallet-conditional-ledger` | `Split`, `Merged`, `ScalarSplit`, `ScalarMerged`, **`GateSplit { pid: ProposalId, branch: Branch, gate: GateType, amount: Balance }`**, **`GateMerged { pid: ProposalId, branch: Branch, gate: GateType, amount: Balance }`**, `PositionTransferred`, **`BaselineSplit { epoch: EpochId, amount: Balance }`**, **`BaselineMerged { epoch: EpochId, amount: Balance }`**, `VaultResolved { pid, branch }`, **`VaultVoided { pid }`** (D-1, X-11f), `ScalarSettlementSet { pid, branch, s }` (carries winning branch — B-low), `GateSettled { pid, branch, gate, outcome }` (B-2), **`BaselineSettled { epoch: EpochId, s: FixedU64 }`**, `Redeemed`, `ScalarRedeemed`, `ScalarPairRedeemed { pid, amount, fee: Balance }` (B-5), **`GateRedeemed { pid: ProposalId, gate: GateType, amount: Balance, fee: Balance }`**, **`VoidRedeemed { pid, kind, amount, payout }`** (D-1), **`BaselineRedeemed { epoch: EpochId, side: ScalarSide, payout: Balance, fee: Balance }`**, `VaultReaped`, **`BaselineVaultReaped { epoch: EpochId, residue: Balance }`**, **`RedemptionFeesSwept { amount: Balance }`** (contract v17) |
| `pallet-market` | §5 table |
| `pallet-epoch` | `ProposalSubmitted`, `ProposalWithdrawn`, `ScreeningStarted`, `ProposalCancelled { pid, reason }`, `ProposalQualified`, `ProposalDeferred`, **`SlotsShrunk { epoch: EpochId, requested: u32, funded: u32, dropped: Vec<ProposalId> }`**, `MarketsOpened`, `DecisionExtended`, `ProposalQueued { pid, payload_hash, maturity }`, `ProposalRejected { pid, reason }`, `ProposalDelayed { pid, justification_hash }`, `RerunScheduled`, `RerunOpened`, `MandateExpired`, `MeasurementStarted { cohort }`, `CohortSettled { epoch, s }`, **`CohortVoided { epoch: EpochId }`**, **`BaselineCarried { pid: ProposalId, epoch: EpochId }`**, **`ProposalForceRejected { pid, reason }`** — emitted by transition T20 (emergency/VOID force-reject), which previously emitted nothing and silently corrupted every event-derived archive (X-11f), `IntakeSlashed { pid, reason, amount }` (accompanies every partial intake-bond slash — [06](06-governance-and-guardians.md) §4). In `SlotsShrunk`, `requested` and `funded` are proposal-slot counts, not USDC amounts; USDC determines which qualified entries fit, while these fields report the pre- and post-shrink entry counts. |
| `pallet-execution-guard` | `Executed { pid, record }`, `ExecutionFailed { pid, outcome: DispatchOutcomeCode }`, `Ratified { pid, referendum_index }` (written by `execution_guard.ratify(proposal_id, referendum_index)`, the sole `ratify`-track governance call — [06](06-governance-and-guardians.md) §2.2), `UpgradeAuthorized { code_hash: H256, authorized_at: BlockNumber }` (system-event mirror carrying `authorized_at` for the `DescriptorLeadTime` check, D-14), **`Enqueued { pid: ProposalId, maturity: BlockNumber }`**, **`Rejected { pid: ProposalId, reason: RejectReason }`**, **`UpgradeApplied { code_hash: H256, spec_version: u32 }`**, **`PreimageUnpinned { pid: ProposalId, payload_hash: H256 }`**, **`UpgradeAborted { code_hash: H256 }`**. `UpgradeAuthorized` remains the two-field public event; `applicable_at` is derived as `authorized_at + DescriptorLeadTime` ([09](09-execution-upgrades-and-rollout.md) §2.1). |
| `pallet-oracle` | §7.2 table |
| `pallet-registry` | `IncidentFiled`, `MilestoneFiled`, `IncidentChallenged`, `MilestoneChallenged`, `IncidentUpheld`, `IncidentRejected`, `MilestoneAccepted`, `MilestoneRejected`, `FilingBondSlashed`, **`RegistryEpochClosed`** — which carries `spec_version: MetricSpecVersion` alongside `kind`/`epoch`/`aggregate` (contract v14), because 07 §7 keys the registry lifecycle by `(epoch, spec_version)` and one epoch therefore closes once per frozen version — (remaining field detail in [07](07-oracle-and-disputes.md); names frozen here), **`WindowAcknowledged { epoch: EpochId, filing_id: FilingId, watchtower: AccountId }`**, **`WindowExtended { epoch: EpochId, filing_id: FilingId, new_deadline: BlockNumber }`**. `FilingId = u32`; these pallet-registry events are distinct from the identically named pallet-oracle events in §7.2, which carry `component`/`round`. |
| `pallet-guardian` | `GuardianAction { action_id, power, target, justification_hash }`, `ForceRerun { pid, justification_hash, window_end }`, `PlaybookActivated { id, trigger, expiry }`, `PlaybookRenewed { id }`, `PlaybookExpired { id }`, `ReviewScheduled { action, referendum }`, **`MembersSet { members: [AccountId; 7] }`**, **`ActionProposed { action_id: ActionId, power: GuardianPower }`**, **`ActionApproved { action_id: ActionId, who: AccountId, approvals: u8 }`**, **`ActionRatified { action: ActionId }`**, **`ReviewFailed { action: ActionId, slashed_each: Balance }`**, **`RecallScheduled { action: ActionId, referendum: u32 }`**, **`RecallEnacted { action: ActionId, removed: BoundedVec<AccountId, ConstU32<7>> }`**, **`PlaybookRegistrationSet { id: PlaybookId, enabled: bool }`** |
| `pallet-attestor` | **`MembersSet { members: Vec<AccountId> }`**, **`AttestationSubmitted { attestation_id: AttestationId, pid: ProposalId, artifact_hash: H256, attestor: AccountId }`**, **`AttestationChallenged { attestation_id: AttestationId, challenger: AccountId, evidence_hash: H256 }`**, **`ChallengeResolved { attestation_id: AttestationId, upheld: bool, loser: AccountId, slashed: Balance }`**, **`AttestorEjected { who: AccountId }`**, **`AttestorRemovedForCause { who: AccountId, cause_hash: H256 }`**, **`AttestationRevoked { attestation_id: AttestationId, pid: ProposalId, attestor: AccountId, cause_hash: H256 }`** |
| `pallet-futarchy-treasury` | **`NavHaircutFlagged { epoch: EpochId, flag: bool }`** — emitted on every reserve-health flag transition; in the ingest set under criterion (b) because [08](08-treasury-and-economics.md) §1.2(4) requires the frontend to surface the flag on every NAV render. The line's other events (`Spent`, `StreamOpened`/`Claimed`/`Cancelled`, `BudgetLineFunded`, `VitIssued`, `KeeperBudgetLow`, `KeeperBudgetExhausted`, `NavFloorUnmet`, the coretime events) are **not** in the ingest set and stay treasury-owned per [08](08-treasury-and-economics.md) §1.4 |
| `frame-system` / upgrade path | `CodeUpdated`, `UpgradeAuthorized` (native), ingested for descriptor switching |

**Redemption-fee field append (normative; contract v17, 2026-07-29, milestone E1).** [03](03-conditional-ledger.md) §5.3a charges `ledger.redeem_fee` on the settlement-payout redemptions, so exactly four ledger events gain a **trailing** `fee: Balance`: `ScalarRedeemed`, `ScalarPairRedeemed`, `GateRedeemed` and `BaselineRedeemed`. Three rules bind:

1. **The field is the deduction, not the payout.** Each event's pre-existing `amount`/`payout` field keeps its exact prior meaning — the **gross** claim value the instrument burned, the quantity by which [03](03-conditional-ledger.md) §5.3 decrements `escrowed` — and `fee` is what that document's §5.3a deducted from it, so a consumer computes `net = payout − fee` and no frozen field changes meaning. That is what makes this a §13 rule-3 append: no existing field's name, type or offset moves.
2. **`fee` is `0` on every exempt path**, and `0` is a truthful value rather than a sentinel: a `ProtocolAccounts` caller, a gross payout below `ledger.min_split`, and an unreadable-or-zero live rate all produce a charged call that charged nothing ([03](03-conditional-ledger.md) §5.3a(1)/(3)/(5)).
3. **`Redeemed` and `VoidRedeemed` do NOT gain it, and MUST NOT.** [03](03-conditional-ledger.md) §5.3a exempts the par leg (`redeem`, on which G-3 rests) and the VOID path (`redeem_void`, the protocol's own failure) outright. A `fee` field on either would be identically zero forever while implying a charge the ledger is forbidden to make.

**`RedemptionFeesSwept { amount: Balance }`** is emitted by the permissionless Signed keeper crank **`conditional_ledger.sweep_redemption_fees()`** ([03](03-conditional-ledger.md) §5.3a(4)/§5.4), which moves the accrued fee balance from the ledger sovereign to the treasury. It is in the ingest set because it is the sole on-chain record of that transfer and `nav()` moves on it; the crank is deliberately separate from redemption so that no redemption can fail because a treasury credit failed (G-1).

`pallet-execution-guard::PendingOutflowSyncFailed { queued: u32, fail_static: bool }` is deliberately outside the ingest set: it is an operations alarm with no canonical frontend workflow. It carries no monitoring binding in [12](12-release-and-operations.md) §6.3 today; adding one is an operations concern that does not touch this contract.

Every terminal proposal/vault/cohort state transition MUST emit exactly one event (the T20 fix closes the last silent transition), so event-derived history is complete by construction — the load-bearing property behind the D-2/D-6 history model.

---

## 7. Storage items the frontend reads directly

Key-hasher choices follow the source pallets (maps `Blake2_128Concat` unless stated). This section freezes **names, key types and value types**; bound arguments live with the owning pallets.

### 7.1 `pallet-epoch` (X-1c)

| Item | Type | Notes |
|---|---|---|
| `Proposals` | `map ProposalId → Proposal` | ≤ `MaxLiveProposals = 32` *(normative value: [13](13-parameters.md))* |
| `EpochOf` | `EpochInfo { index, phase, phase_start_block }` | — |
| `IntakeQueue` | `BoundedVec<ProposalId, 64>` | Pre-qualification scope only (D-10) |
| **`RecentCohortSummaries`** | **`BoundedVec<CohortSummary, ConstU32<32>>`** | **Ring of the last 32 cohorts** (≈ 4.9 KiB at the current 158-byte `CohortSummary`; exact arithmetic in [13](13-parameters.md) §5), pushed at `settle_cohort` completion, FIFO-evicted; one push per ~21 days amortized into the existing settle crank — negligible weight, no new hook. This is the P-5 storage-list addition the FE draft omitted from §5.2.3, applied: a fresh browser renders ~22 months of settlement history with zero infrastructure dependency (D-6 layer 1) |
| `Cohorts` | `map EpochId → CohortInfo` | ≤ 4 non-terminal |
| **`ResourceLocks`** | **`BoundedVec<([u8; 8], ProposalId), 256>`** | The resource-domain lock set, held as one value rather than a map. Bound is `MaxLiveProposals × MaxResourcesPerProposal = 32 × 8`. Frozen at contract v24 because [09](09-execution-upgrades-and-rollout.md) §1.2(8) makes "all declared resource-domain locks are still held by `pid`" a dispatch-time check and [11](11-frontend-workflows.md) §11.5 mirrors it as a client precondition — so a client that cannot read this item cannot compute the row, while §7's closing rule denied it contract status (SQ-580) |
| **`PendingOracleVoids`** **(contract v29)** | **counted `map EpochId → ()`** | The target-keyed pending-VOID latch of [05](05-welfare-and-decision-engine.md) §4.7 / [07](07-oracle-and-disputes.md) §10, ≤ `MaxNonTerminalCohorts = 4` keys. Frozen at v29 because [11](11-frontend-workflows.md) §11.8.2 requires the guardian console to establish a playbook's trigger as **verifiably active at B′**, and this one item answers *two* of the eight `PlaybookTrigger` variants: `OracleDeadlock` is `contains_key(epoch)` for the cohort a `PB-ORACLE-VOID` activation targets, and `VoidInFlight` is a non-empty map. A present key is a *latch*, not an activation record — [06](06-governance-and-guardians.md) §6.2 forbids reading an activation record as a trigger source, and this is the underlying condition that rule points at |
| **`CohortSchedules`** **(contract v29)** | **`map EpochId → CohortSchedule { epoch, creation_epoch_length, measurement_until, settlement_epoch, specs }`** | The frozen per-cohort MetricSpec bindings, `specs: BoundedVec<(ProposalId, MetricSpecVersion), MAX_COHORT_PROPOSALS_BOUND>`. Bounded exactly as §3's `bond_quote` argument already states: the key set is the live cohort epochs, ≤ 4 non-terminal (`Cohorts`, above) with `pallet-epoch`'s `try_state` refusing an orphan schedule, and each schedule carries at most one binding per cohort slot — the **hard maximum of `epoch.slots`, 12** ([13](13-parameters.md) §1, not its launch default). Frozen at v29 because [11](11-frontend-workflows.md) §11.8.6's row **O-8** makes *"`spec_version` among the versions live cohorts froze for `epoch`"* a precondition of `IncidentRegistry.file` / `MilestoneRegistry.file`, and `specs` is the only item that answers it. The near miss is worth naming: `Cohorts[epoch].proposals` plus `Proposals[pid].metric_spec` looks like the same fact and is a client **computation** over two maps, which [11](11-frontend-workflows.md) §11.4 rule 2 forbids for a precondition row — and it reads each proposal's *current* spec rather than the version the cohort froze. §3 already cited this item for `bond_quote`'s boundedness argument while §7 did not freeze it, which is SQ-580's shape one more time: a document requiring a read it had not made contract surface |

### 7.2 `pallet-oracle` (X-11c — canonical names; [07](07-oracle-and-disputes.md) uses these)

Storage:

| Item | Type | Bound |
|---|---|---|
| `Reporters` | `map AccountId → ReporterInfo { stake: Balance, registered_at: BlockNumber, offenses: u8 }` | counted; ≥ 3 required before attested components admit A record survives deregistration and ejection in a pallet-internal store; re-registration carries the offense count forward and, past the second offense, re-seats at half `orc.reporter_stake`; an ejected account is refused (contract v19). |
| `Rounds` | `map (MetricId, EpochId, MetricSpecVersion) → RoundState { component: MetricId, epoch: EpochId, round: u8, spec_version: MetricSpecVersion, reporter: AccountId, value: FixedU64, evidence_hash: H256, bond: Balance, challenge_deadline: BlockNumber, extended: bool, challenger: Option<AccountId>, counter_value: Option<FixedU64>, acks: u8, report_hash: H256, stake_at_risk: Balance, cumulative_reporter_bond: Balance, cumulative_challenger_bond: Balance }` | ≤ **128** = 16 components × ≤ 4 settling epochs × ≤ 2 concurrent frozen versions — one live game per `(component, epoch, spec_version)`. The **triple key** (contract v3) is normative: 07 §2(4) runs an independent game per frozen version, so an activation boundary keeps two games live for one `(component, epoch)`; the pair key of contract v2 could not hold them (it maps one value per key). The value re-embeds `component`/`epoch`/`spec_version` for a `try_state` key-integrity check. `report_hash`/`stake_at_risk`/`cumulative_*_bond` back per-round ack keying, bond-schedule freezing and §5.5 slashing; the FE reads the `OracleRoundView` projection (§4), not this struct |
| `ComponentValues` | `map (MetricId, EpochId, MetricSpecVersion) → SettledComponent { value: FixedU64, path: SettlePath, flagged: bool }` | reaped on an **epoch cutoff**, not at cohort settlement (contract v15): the epoch clock's oracle-boundary crank retires every entry older than `current − 3` measurement epochs, bounded at `ComponentReapBatch` per call ([13](13-parameters.md) §2), except a value a still-retained dispute rests on and each component's newest entry (its [07](07-oracle-and-disputes.md) §10 carry checkpoint), both of which persist. A frontend MUST NOT treat any other value as durable beyond that window. The former "reaped at cohort settlement" rule named a caller that does not read this map at all — `settle_cohort` reads the welfare snapshot ([07](07-oracle-and-disputes.md) §11) — and had no implementation, so entries accumulated to the bound instead (SQ-492); **triple key** (contract v3) — per-version games settle their own cohorts, so one `(component, epoch)` can carry a settled value per frozen version. `SettlePath ∈ { Unchallenged, Recomputed, Adjudicated, ChallengerDefault, Neutral }`; `ChallengerDefault` is **retained for SCALE stability but is no longer produced** (contract v19): a [07](07-oracle-and-disputes.md) §5.3 reporter default now settles `Neutral` with `flagged: true` per that section and §10, because a default decides the bonds and not the value. A frontend MUST NOT expect the variant and MUST render a reporter default as a flagged neutral carry |
| `Watchtowers` | `map AccountId → WatchtowerInfo { stake: Balance, registered_at: BlockNumber, inactive_epochs: u8 }` | counted, ≤ `wt.max = 16` seats; bonded acknowledgment quorum (D-18; registry semantics in [07](07-oracle-and-disputes.md) §4) |
| `ReserveHealth` | `{ consecutive_fails: u8, consecutive_passes: u8, unhealthy: bool, last_query_id: u64, last_probe_at: BlockNumber, pending_since: Option<BlockNumber> }` | single value; the deterministic reserve-probe state (`R`, [07](07-oracle-and-disputes.md) §8). `last_probe_at`/`pending_since` (contract v3) time the probe for the fail-static timeout |

Events:

| Event | Fields |
|---|---|
| `ReporterRegistered` | `{ who, stake }` |
| `Reported` | `{ component, epoch, round, reporter, value, evidence_hash, bond }` |
| `Challenged` | `{ component, epoch, round, challenger, counter_value, evidence_hash, bond }` |
| `RoundEscalated` | `{ component, epoch, round, new_bond }` |
| `RecomputeProven` | `{ component, epoch, value, prover }` |
| `AdjudicationRequested` | `{ component, epoch, referendum }` |
| `Adjudicated` | `{ component, epoch, value }` |
| `ComponentSettled` | `{ component, epoch, value, path }` |
| `NeutralSettlement` | `{ component, epoch, carried_value, flagged_epochs }` |
| `WindowAcknowledged` | `{ component, epoch, round, watchtower }` |
| `WindowExtended` | `{ component, epoch, round, new_deadline }` |
| `QuorumFailed` | `{ component, epoch, round }` — no challenge and no watchtower quorum after the single extension ⇒ neutral path ([07](07-oracle-and-disputes.md) §4) |
| `ReporterSlashed` | `{ who, amount, offense }` / `ReporterEjected { who }` |
| `WatchtowerRegistered` | `{ who, stake }` |
| `WatchtowerInactive` | `{ who, epoch }` |
| `WatchtowerSlashed` | `{ who, amount }` |
| `ReserveProbeSent` | `{ query_id }` |
| `ReserveProbeResult` | `{ query_id, passed: bool }` |
| `ReserveUnhealthy` | `{ }` / `ReserveRecovered { }` — reserve-health state transitions (`R`, [07](07-oracle-and-disputes.md) §8) |
| `RetentionExpired` | `{ component, epoch, round, reporter_bond, challenger_bond }` — the [07](07-oracle-and-disputes.md) §11(1) retention window closed with no terminal verdict: both stacks are refunded to their posters and the retained round reaped (contract v15) |

### 7.3 `pallet-constitution`

| Item | Type | Notes |
|---|---|---|
| `Params` | `map ParamKey → ParamRecord` | read via `params()`; §9 binding rules. `ParamRecord` carries both `last_changed_epoch` (the cooldown clock, [13](13-parameters.md) rule 7) and `last_change_block` (contract v4) — §4's `ParamView.last_change` is a block number, and epochs do not determine it |
| **`PhaseFlags`** | `u32` bitset | **The key the frontend binds trading enablement (and the Phases 0–3 "bootstrap governance — sudo active" banner, D-13) to.** Bit assignments: 0 = shadow mode, 1 = PARAM armed, 2 = TREASURY armed, 3 = CODE/META armed, 4 = sudo present, 5 = ledger frozen (PB-LEDGER-FREEZE), 6 = dead-man engaged, 7 = reserve-health flag; bits 8–31 reserved (append-only) |
| **`Capabilities`** | `map (CallDomain, ProposalClass) → CapabilityRule` | Frozen at contract v26 (SQ-589). [11](11-frontend-workflows.md) §11.5's dispatch check 7 requires the client to verify that each declared domain's rule admits the class origin, which `do_execute` enforces as `CapabilityDenied` (`pallets/execution-guard/src/lib.rs:2020`); §7's closing rule denied it contract status, so the check had no surface to cite |
| **`ReleaseChannel`** | fixed-layout raw value | §12 — NOT ordinary SCALE-metadata-dependent storage |

### 7.4 `pallet-market` (X-10) and other reads

| Item | Type | Notes |
|---|---|---|
| **`BaselineMarketOf`** | **`map EpochId → MarketId`** (in **`pallet-market`** — the pallet home per [04 §8.3](04-markets-and-pricing.md)) | **X-10 fix, contract-v8 retained-book rule**: the declared backing storage for `baseline_market(epoch)`. Written at Baseline book creation; retained for exactly as long as the referenced `MarketBook` exists, including after its terminal latch and for a strictly-past orphan epoch whose Baseline vault is still `Open`; removed atomically only when that book is successfully reaped. Its structural bound is therefore `MaxStoredMarkets = 2,240`, not the active/POL count or `RecentCohortSummaries` ring. A present mapping MUST resolve to a present `BookKind::Baseline` owned by the same epoch; `try-state` enforces the inverse |
| `Markets` | `map MarketId → MarketBook<AccountId>` | One physical map with two independently enforced logical partitions: ≤ `MaxStoredMarkets = 2,240` primary rows, of which ≤ `MaxLiveMarkets = 196` lack a durable terminal latch; plus ≤ `MaxStoredExternalMarkets = 128` external rows, of which ≤ `MaxLiveExternalMarkets = 128` lack the paired service-terminal latch. The physical ceiling is therefore `MaxAllStoredMarkets = 2,368` *(normative values: [13](13-parameters.md))* and external backlog cannot consume the primary POL envelope. Contract v20 appends `BookKind::External { question: QuestionId, client: ClientId, branch: Branch }`; its two rows are created atomically and route only to `ServiceLedger`, while every pre-v20 kind routes only to instance `()`. First terminal observation removes the book's checkpoint/decision-window auxiliaries and releases the applicable domain's live slot; only a primary book releases POL. Once the latch, archive delay **and the book's domain-correct revenue-sweep marker** permit reap, it atomically discards only the book/fee accounts' fixed-universe **residual** inventory, removes their protocol-account registrations, the book and any `BaselineMarketOf` inverse; it neither waits for nor removes the owning ledger vault, marker or claimant rows. `MarketState` is the frame-free core's whole-state aggregate and is not the stored value |
| `pallet-inflow-caps::CumulativeDeposits` | `map AccountId → u128` | Per-account cumulative XCM USDC inflow meter for the Phase-3 deposit-cap precheck ([09](09-execution-upgrades-and-rollout.md) §5.2) |

`pallet-conditional-ledger::{Vaults, BaselineVaults, Positions, PositionTotals}` — note the **key order of `Positions` is `(PositionId, AccountId)`** (per-vault drainable, B-med); a per-account storage prefix scan is therefore NOT available, and the frontend MUST use `account_positions()` (the runtime API iterates the bounded live-vault set) or the per-account key index maintained by the ledger ([03](03-conditional-ledger.md)). **Both statements hold identically for the `ServiceLedger` instance, whose method is `service_positions()`** (§3, §4a scoping): the key order is a property of the pallet, not of the instance, so the service domain is exactly as prefix-unscannable and is enumerable only the same two ways. A frontend operating under the FE-P2 conservative posture — cross-checking every runtime-API result used on the transaction path against direct storage reads (§3) — performs that cross-check per domain against that domain's own prefix, and MUST NOT satisfy a service-domain read with a primary-domain key. `pallet-execution-guard::{Queue, Ratifications, ExecutionRecords}` (a `RatificationRecord` is written by the frozen governance call `execution_guard.ratify(proposal_id, referendum_index)`, binding `(pid, payload_hash)` — [06 §2.2](06-governance-and-guardians.md)); `pallet-welfare::{Snapshots, MetricSpecs, GateBreachFlags}`; `pallet-guardian` membership/allowances, plus **`Guardian.PendingActions`** (`BoundedVec<PendingAction, MaxPendingActions>`) and **`Guardian.Approvals`** (`BoundedVec<(ActionId, AccountId), MaxApprovals>`) **(contract v28)** — [11](11-frontend-workflows.md) §11.8.2's console lists pending actions and their per-member approvals, and until v28 this section named only the two it does not read — and **`Guardian.PlaybookRegistered`** (`map PlaybookId → bool`, `Blake2_128Concat`, value-query default `false`; all six registered at genesis) and **`Guardian.ActivePlaybooks`** (`BoundedVec<ActivePlaybook { id: PlaybookId, expiry: BlockNumber, renewals_used: u8 }, ConstU32<6>>`, value-query default empty) **(contract v30)** — the two reads behind `guardian.approve_action`'s playbook refusals, detailed below; **`ExecutionGuard.PendingUpgrade`** (`Option<PendingUpgrade { hash: H256, authorized_at: BlockNumber, applicable_at: BlockNumber, target_spec_version: u32 }>`) **(contract v28)** — §11.8.4 step 4 requires `now ≥ applicable_at` read from **this stored field** and forbids recomputing it from `authorized_at + DescriptorLeadTime`, and §9's I-30 already states an invariant over it, so the item was load-bearing in this document before it was frozen in it; and, for each of the two `pallet-registry` instances (`IncidentRegistry` and `MilestoneRegistry` — the allocators are independent and share no filing-id space), **`Filings`**, **`ClosedAt`** and **`AckRecords`** **(contract v28)** — §11.8.6 requires filings, challenge windows, watchtower acknowledgments and closure rendered with countdowns, and froze only the events. `System.Account`, `ForeignAssets.Account(USDC_LOCATION, who)` (NOT `Assets.Account(1337, who)` — X-11a; the USDC identifier is the XCM Location of §8).

**`ConditionalLedger.LedgerDrifted`** (`bool`, value-query default `false`) **joins at contract v29**, for the same reason `Epoch.PendingOracleVoids` joins §7.1: it is the **I-4 drift flag** — the permissionless reconciliation crank sets it exactly when `liability > custody` ([03](03-conditional-ledger.md); [06](06-governance-and-guardians.md) §6.3) — and it is the sole condition under which a `PB-LEDGER-FREEZE` activation is admissible, so [11](11-frontend-workflows.md) §11.8.2's trigger precondition cannot be evaluated without it. It is **not** `PhaseFlags` bit 5, and the distinction is exactly the one that makes the freeze for the trigger unusable: bit 5 tracks the *applied effect*, which §6.3's bounded maintenance keeps in step with the latch — so at the moment a guardian proposes the activation the effect is not applied, bit 5 is clear, and a client reading it would refuse the one action the drift authorizes. This is the primary ledger instance's latch; the service instance evaluates its own (§6.3's instance-scope note, I-37).

**`Guardian.PlaybookRegistered` and `Guardian.ActivePlaybooks` join at contract v30, because the refusals they carry fall on the fifth signature.** Both are live governance state — [06](06-governance-and-guardians.md) §6.2 makes registration a `guardian`-track values toggle over the six enumerated routines, and §6.3 makes the active set the record a renewal or an expiry moves — and both are read on the **dispatching** approval, not at propose time: `guardian.approve_action` raises `PlaybookNotRegistered` when the named playbook's toggle is off, and `PlaybookAlreadyActive` when `PB-LEDGER-FREEZE` is already active (every other playbook renews in place). A client that cannot read them cannot evaluate either clause, so it walks a 5-of-7 council through four signatures to a guaranteed revert on the fifth — the same failure mode as v27's `Proxy.Proxies` and v28's `PendingUpgrade`, but paid for with the scarcest signatures the protocol has, on the emergency path. Two readings are forbidden. **Registration is not a trigger** — §6.2's rule that an activation record never sources a trigger is about the *other* direction, and neither of these items may be substituted for the trigger table of [11](11-frontend-workflows.md) §11.8.2; they are admissibility of the activation, not evidence of the condition. And **presence in `ActivePlaybooks` is not uniformly a refusal**: it blocks `PB-LEDGER-FREEZE` alone, while an already-active non-ledger playbook re-activates without consuming a slot, so a client that reads mere presence as blocking refuses five lawful renewals (06 §6.2's *"renew by re-activation while triggered"*).

### 7.5 `pallet-attestor`

The shipped pallet uses value storage rather than keyed maps. The item names and the full SCALE value shapes below are frozen byte-for-byte; “—” means the storage item has no map key.

| Item | Key type | Value type | Notes |
|---|---|---|---|
| `Members` | — | `BoundedVec<AttestorInfo, ConstU32<16>>`, where `AttestorInfo { account: AccountId, bond: Balance, false_count: u8, active: bool }` | Elected bonded member set; value-query default is empty |
| `Attestations` | — | `BoundedVec<Attestation, ConstU32<256>>`, where `Attestation { id: AttestationId, pid: ProposalId, artifact_hash: H256, statement_hash: H256, attestor: AccountId, submitted_at: BlockNumber, challenge_deadline: BlockNumber, challenge: Option<ChallengeStatus> }` and `ChallengeStatus ∈ { Open { challenger: AccountId, evidence_hash: H256, bond: Balance }, Upheld, Rejected }` | Flat shipped attestation ledger; value-query default is empty |
| `Liabilities` | — | `BoundedVec<AttestorLiability, ConstU32<16>>`, where `AttestorLiability { account: AccountId, bond: Balance, false_count: u8, ejected: bool }` | Bond basis for departed/ejected attestors until every record is reaped; value-query default is empty |
| `Revocations` | — | `BoundedVec<AttestationRevocation, ConstU32<256>>`, where `AttestationRevocation { attestation_id: AttestationId, pid: ProposalId, attestor: AccountId, cause_hash: H256 }` | Durable cause markers; the original attestation shape is unchanged |
| `NextAttestationId` | — | `AttestationId = u32` | Monotone cursor; value-query default is 0 |

### 7.6 SDK pallet storage the frontend reads (contract v24; SQ-580 · extended v27, SQ-590 · extended v28)

The items below belong to **upstream FRAME pallets**, not to Bleavit's. They are frozen here for the same reason every other row in §7 is: **the client reads them, so their shape is part of what the client is promised.** Ownership does not change that. What *does* differ is where the change originates — an upstream layout moves on a `polkadot-stableXXXX` release-line bump rather than on a Bleavit pallet edit — but that is a difference in provenance, not in urgency, and it is not a gap in change control: the SDK is `=`-pinned in `Cargo.toml`, so a release-line move is an explicit, reviewable repository change like any other. The earlier form of this paragraph claimed upstream storage needed the freeze *more* than Bleavit's own; that comparison does not survive the pins, and the freeze stands on the reads alone.

What the freeze buys is specific. [10](10-frontend-architecture.md) §5.2's compatibility classifier probes exactly `CRITICAL_SURFACE`, which is generated from this contract's frozen set and MUST NOT be hand-listed. A surface that is not frozen is therefore one **the compatibility lattice cannot fail on**: a runtime upgrade that moved it would leave the classifier reporting `full` while the dependent path silently broke — a dead screen under a green compatibility banner, and the banner is the wrong part.

This is not a new category. §7.4 already freezes `System.Account` and `ForeignAssets.Account(USDC_LOCATION, who)` on exactly this basis.

**v24 claimed to complete this set and did not, which is worth recording rather than quietly amending.** That sweep worked from `Pallet.Item` references appearing in the text of [10](10-frontend-architecture.md) and [11](11-frontend-workflows.md), and `tools/ci/check-client-surface-obligations.py` was built to keep it complete by the same method. Both miss an obligation stated **in prose that never spells the item** — which is exactly how §11.3's proxy mandate survived: it says proxies are supported "under the same precondition system" and names no storage at all, so neither the human sweep nor the gate derived from it had anything to match. `Proxy.Proxies` joins at **v27** (SQ-590). The residual method gap is the finding, not the row: an inverse gate that reads names cannot see a requirement expressed without one. **`System.AuthorizedUpgrade` joins at v28 by the same route, and it arrived with a second defect the freeze exposed.** [11](11-frontend-workflows.md) §11.8.4 step 1 said the authorized code hash is read *"from `parachain-system` storage"*, and `ParachainSystem` carries no such item in this runtime's metadata — the authorize/apply pair lives in `frame_system` on the pinned SDK line. A read bound to a pallet that cannot answer it fails exactly like the missing freeze does, and neither the sweep nor the gate could see it, because the prose named a pallet and never an item. Doc 11 now spells every item this section freezes for it, so the gate can.

| Item | Key | Value | Mandated by |
|---|---|---|---|
| `Multisig.Multisigs` | `(AccountId, [u8; 32])` (`Twox64Concat`, `Blake2_128Concat`) | `Multisig { when: Timepoint { height, index }, deposit: Balance, depositor: AccountId, approvals: BoundedVec<AccountId> }` | [11](11-frontend-workflows.md) §11.3 — "Multisig via `Multisig.as_multi` with approval state read from `Multisig.Multisigs`" |
| `Proxy.Proxies` **(contract v27; SQ-590)** | `AccountId` (`Twox64Concat`) | `(BoundedVec<ProxyDefinition { delegate: AccountId, proxy_type: ProxyType, delay: BlockNumber }, MaxProxies>, Balance)` — the delegation set held **for the delegating account** (`real`), plus the deposit reserved for it. See the `ProxyType` note below | [11](11-frontend-workflows.md) §11.3 — "proxies supported as call wrappers under the same precondition system", whose delegation check reads `Proxy.Proxies(real)` |
| `System.AuthorizedUpgrade` **(contract v28)** | — | `Option<CodeUpgradeAuthorization { code_hash: H256, check_version: bool }>` — the hash `system.apply_authorized_upgrade` will accept. **In `frame_system`, not `cumulus-pallet-parachain-system`**, which carries no such item on the pinned SDK line | [11](11-frontend-workflows.md) §11.8.4 step 1 — the artifact is hash-verified against this value *before* submission and never reaches the wallet without it |
| `Referenda.ReferendumCount` | — | `u32` | [11](11-frontend-workflows.md) §11.7.2 referendum enumeration |
| `Referenda.ReferendumInfoFor` | `u32` | `ReferendumInfo`. The `Ongoing` variant embeds `OriginCaller` **and is the only variant carrying `tally`**; the terminal variants (`Approved`/`Rejected`/`Cancelled`/`TimedOut`) carry the decision block and the two optional deposits, and `Killed` carries only the block. A client MUST NOT expect a final tally from this item — see SQ-585 | [11](11-frontend-workflows.md) §11.7.2; §11.2's S2 detail |
| `Referenda.TrackQueue` | `u16` (`Twox64Concat`) | `BoundedVec<(u32, Balance)>` | [11](11-frontend-workflows.md) §11.7.2 |
| `Referenda.DecidingCount` | `u16` (`Twox64Concat`) | `u32` | [11](11-frontend-workflows.md) §11.7.2 |
| `Preimage.StatusFor` | `H256` (`Identity`) | `OldRequestStatus` | [11](11-frontend-workflows.md) §11.7.2 — the client re-hashes the bytes |
| `Preimage.PreimageFor` | `(H256, u32)` (`Identity`) | `BoundedVec<u8>` | [11](11-frontend-workflows.md) §11.7.2; §11.2's S2 detail |
| `ConvictionVoting.VotingFor` | `(AccountId, u16)` (`Twox64Concat`, `Twox64Concat`) | `Voting` (`Casting` / `Delegating`) | [11](11-frontend-workflows.md) §11.7.2 user votes and delegations |
| `ConvictionVoting.ClassLocksFor` | `AccountId` (`Twox64Concat`) | `BoundedVec<(u16, Balance)>` | [11](11-frontend-workflows.md) §11.7.2 user locks and expiry derivation |
| `Scheduler.Agenda` | `u32` (`Twox64Concat`) | `BoundedVec<Option<Scheduled>>` (embeds `OriginCaller`) | [11](11-frontend-workflows.md) §11.7.2 enactment — **display only**; the frontend never infers execution from schedule presence |
| `System.Events` | — | `Vec<EventRecord { phase, event: RuntimeEvent, topics }>` | [10](10-frontend-architecture.md) §4.2 — events are state, readable only inside smoldot's pinned-block window |

**`ProxyType` is a runtime-defined enum, and a client MUST NOT treat an unrecognised variant as permissive.** `pallet-proxy` takes the type as a `Config` associated type and an `InstanceFilter<RuntimeCall>`; the *shape* frozen above is the container, and the variant set is Bleavit's own. This runtime declares exactly one, `Any`, whose filter admits every call — so today the only lawful reading of a stored delegation is "unrestricted". That is a **value**, not a promise: a later runtime may add restrictive variants, and the failure direction is asymmetric. Reading an unknown variant as permissive lets the client evaluate every precondition against `real`, report a green transaction, and have `pallet_proxy::proxy` refuse it with `Unproxyable` after the user has signed. Reading it as *unproven* refuses early with a stated reason, which is [11](11-frontend-workflows.md) INV-FE-12's rule for exactly this case. The client therefore admits `Any` and refuses every variant whose coverage it cannot establish — and the same holds for `delay`: a non-zero delay makes bare `proxy` unreachable (`Unannounced`), so a delegation carrying one does not satisfy this check.

**The stored `proxy_type` governs, never a caller-supplied one.** The check this row exists for is *may this signer act for `real`* — the identity question the wrapper creates. A client that asks whether a *claimed* proxy type covers the call has verified nothing, because the claim is the part that must come from the chain: the delegation must name **this signer** as `delegate`, and its stored `proxy_type` and `delay` are what the runtime will enforce.

**`System.Events` freezes its container, and what that does and does not buy.** The row freezes `EventRecord { phase, event, topics }` with the `RuntimeEvent` payload left unexpanded. Expanding it would restate every event of every pallet — over two megabytes — and would make this row fire whenever any unrelated pallet gained an event.

**The limit is stated rather than glossed, because the obvious justification is too strong.** §6 freezes the canonical-frontend ingest set event by event, and those events are separately frozen entries; but §6 explicitly does not claim to exhaust pallet-local events, and the runtime's event enum carries substantially more variants than §6 lists. So the elided subtree is *not* fully covered elsewhere. What is true, and all that is claimed: **everything in the elided subtree that this contract freezes is frozen by §6's own entries, and everything else in it is not contract surface** — §6's non-exhaustiveness clause is what makes that second half true rather than convenient. Two consequences a reader should not have to infer. A new **off-contract diagnostic** event may appear without any signal from this row, which is the same latitude §6 already grants. A new event that *should* be in §6 will also not be caught here — and no gate derives §6 obligations from the runtime source, which is a real gap recorded as **SQ-586** rather than closed by this row.

An elision is admissible only where a subtree's contract content is frozen elsewhere; a subtree no other entry covers MUST be expanded. `Referenda.ReferendumInfoFor` and `Scheduler.Agenda` embed `OriginCaller`, which nothing else freezes, so both are expanded in full despite being the two largest entries in the manifest. `tools/release/surface-manifest.json` records each elision with the coverage it claims, and `tools/ci/tests` refuses an elision that is not declared.

Storage items not listed in this section are not contract surface, and their raw decodability through portable metadata is not guaranteed. In particular, every treasury consumer MUST bind `nav()` rather than raw `pallet-futarchy-treasury::State`.

### 7.7 Asset Hub — the foreign-chain surface, pinned per release (SQ-587)

Every other row in §7 lives in **Bleavit's** metadata. The funding flow does not: [11](11-frontend-workflows.md) §11.9.1 opens a **second light-client connection to Asset Hub**, reads the user's USDC there, and constructs an AH-side reserve transfer. Those reads and that call are as compulsory as any row above — and until this section they were frozen nowhere, which is [10](10-frontend-architecture.md) §5.2's blind spot recurring across a **chain** boundary instead of a pallet one. `tools/ci/check-client-surface-obligations.py` cannot see it: that gate keeps only references whose prefix is a real Bleavit `construct_runtime!` pallet, and the restriction is exactly what keeps it quiet enough to stay switched on.

**First, a conflation to remove, because it makes the table below look like a contract violation.** X-11a rules that `Assets.Account(1337, …)` is wrong by contract — **on Bleavit**, where USDC arrives as a `ForeignAssets` entry keyed by the §8 Location. On Asset Hub it is not wrong; it is the same asset seen from the chain that issues it, and §8's own Location says so: `X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337))` decodes to *pallet instance 50 — `Assets` — asset 1337, on parachain 1000*. So [11](11-frontend-workflows.md) §11.9.1's AH-side precondition row and §11.2's S20 row describe one balance from two sides, and neither is a defect.

| Surface | Chain | Shape | Mandated by |
|---|---|---|---|
| `Assets.Account(1337, who)` | Asset Hub | `AssetAccount { balance, status, reason, extra }` | [11](11-frontend-workflows.md) §11.9.1 — "AH USDC balance ≥ amount + AH-side fees" |
| `System.Account(who)` | Asset Hub | `AccountInfo` | [11](11-frontend-workflows.md) §11.9.1 — AH-side existential and fee viability |
| `PolkadotXcm.limited_reserve_transfer_assets` | Asset Hub | dispatchable — `(dest, beneficiary, assets, fee_asset_item, weight_limit)` | [11](11-frontend-workflows.md) §11.9.1 — the deposit leg |

**Both `[VERIFY]` tags on this table are discharged (2026-08-04; PLAN.md V-105/V-106), and the *scope* of the first one is the part worth recording.** V-17 verified asset index 1337 as Circle-native USDC on **Polkadot** Asset Hub in July. That is not this row's question at Phase 2, because this section pins the Asset Hub of the relay the release targets — Paseo — and a testnet Asset Hub's asset registry is its own. `Assets.Metadata(1337)` on Paseo Asset Hub decodes to name `USD Coin`, symbol `USDC`, 6 decimals, unfrozen, identically from two independent operators; `Assets` is pallet instance **50**, which is the same `PalletInstance(50)` §8's Location already names. The second tag verified against the pinned runtime's own metadata: `PolkadotXcm` is pallet **31** and `limited_reserve_transfer_assets` is call **8**, present and **not** deprecated — unlike `teleport_assets` and `reserve_transfer_assets`, which the same runtime marks deprecated in favour of the limited forms. The client's foreign-feed gate reports an upstream deprecation on this row rather than failing on it, because a deprecated call still dispatches and taking the deposit leg offline for a runtime that works is the wrong failure; what must not happen is the deprecation going *unseen* until the call is gone.

**Which Asset Hub is not an open question, and it is not one network.** The rollout phases it: HRMP to Asset Hub opens **Phase 2 on Paseo** and **Phase 3 on Polkadot** ([08](08-treasury-and-economics.md) §2.5; [09](09-execution-upgrades-and-rollout.md) §6.3). A release therefore pins **the Asset Hub of the relay that release targets**, exactly as it already pins the relay — a per-release property, not a standing choice this document could freeze once.

**That is why this section does not bump `INTEGRATION_CONTRACT_VERSION`, and the exception is deliberate rather than an oversight of rule 2.** That constant is stamped into **Bleavit's** runtime. No Bleavit upgrade can move Asset Hub's layout, and no Asset Hub upgrade can move that constant — so bumping it here would assert an attestation the runtime is structurally incapable of making. It would be the compatibility-banner defect one level up: a number that reads as coverage over a surface nothing behind it can observe. The foreign surface is pinned instead **where the release can actually observe it** — the AH genesis hash, `spec_version` and metadata hash carried in the release's own artifact feed (§11), probed by the same [10](10-frontend-architecture.md) §5.2 classifier as a **separate** compatibility verdict. Rule 8 of §13 states the exception normatively.

**Fail-closed, and the direction matters.** An unavailable or unprobed AH surface blocks the funding flow with diagnostics — never a degraded "send anyway", which is [11](11-frontend-workflows.md) E17's existing rule and is restated here because a *foreign* probe failing is the case where "the rest of the app is fine" is most tempting. A **withdraw** (§11.9.2) is unaffected: it is a local `pallet_xcm` call over §7.4's local reads and does not depend on this section.

---

### 7.8 `pallet-execution-guard` — the dispatch checks the client must mirror (contract v26; SQ-589)

[11](11-frontend-workflows.md) §11.5 states **13** dispatch-time checks for `execution_guard.execute` and requires the frontend to re-check **every one** of them at B′. Seven of those checks read storage this contract did not freeze, so the canonical client had nothing to cite and encoded seven broad clauses in place of the thirteen — a user walked to a signature the runtime then refuses with `CapabilityDenied`, `ResourceLockMissing`, `GateSuspended` or `FreezeActive`.

This is the shape v24 repaired for twelve other surfaces (SQ-580), reaching this section from a third direction. It matters for the same reason: [10](10-frontend-architecture.md) §5.2's classifier probes exactly the frozen set, so an unfrozen read is one the **compatibility lattice cannot fail on** — the dependent path breaks silently under a green banner.

**The list is derived from `do_execute` itself** (`pallets/execution-guard/src/lib.rs:1928-2130`), not from the prose, and that distinction changed the answer. A first pass taken from surface *names* produced fourteen items; four of them are already reachable through frozen surfaces, because `ledger_freeze_active()` and `dead_man_freeze_active()` read **`Constitution.PhaseFlags`** bits (§7.3, bits 5 and 6) and `rerun_held()` reads **`Epoch.Proposals`** (`runtime/bleavit-runtime/src/configs.rs:9402`, `:9411`, `:9416`). Freezing them would have added contract surface for reads the runtime does not make.

| Item | Type | The check it serves |
|---|---|---|
| **`HeldResources`** | `BoundedVec<(ProposalId, ResourceId), MAX_HELD_RESOURCES_BOUND>` | `ResourceLockMissing` (`lib.rs:2067`) — every declared resource domain still held by `pid` |
| **`HardGateBreach`** | `bool` | `FreezeActive` (`lib.rs:2084`) — a hard welfare-gate breach blocks execution |
| **`DeadManFreeze`** | `bool` | `FreezeActive` (`lib.rs:2085`) — the guard's own dead-man latch, distinct from §7.3's PhaseFlags bit 6 |
| **`MigrationHalt`** | `bool` | `FreezeActive` (`lib.rs:2089`) — a halted MBM freezes the queue |
| **`Expedited`** | `map ProposalId → bool` | `FreezeActive` (`lib.rs:2091`) — the **exemption**: an expedited proposal executes *through* a triggering freeze, so a client reading only the freeze reports a block that does not apply |
| **`GateSuspension`** | `Option<EpochId>` | `GateSuspended` (`lib.rs:2078`) — read together with **`Epoch.EpochOf`** (§7.1, already frozen — its `index` *is* the current epoch) and `Welfare.GateBreachFlags`, since the suspension is keyed to an epoch and means nothing without it |
| **`AttestationBindings`** | `map ProposalId → (u32, H256)` | `AttestationMissing` (`lib.rs:1980`) — binds the committed attestation set to the payload actually queued |

**Two of these are easy to freeze wrongly, so the reason is stated.** `Expedited` is an *exemption* rather than a check: a client that reads the four freeze flags and not this one is fail-**closed** in the safe direction but tells the user their transaction is blocked when the chain would execute it, which is how a correct refusal becomes a support ticket. And `GateSuspension` alone is undecidable — `Some(epoch)` is a suspension only when that epoch is the current one. The companion read needs **no** new entry: `pallet_epoch::CurrentEpoch` is a `Get<EpochId>` adapter over `EpochOf::<T>::get().index` (`pallets/epoch/src/lib.rs:459`), **not** a storage item, and `EpochOf` is frozen already. It is named here because the first draft of this section froze `Epoch.CurrentEpoch` as though it were storage — a plausible entry for a surface that does not exist, caught by deriving the manifest layouts from the metadata instead of writing them.

**A citation defect this repair also fixes.** [11](11-frontend-workflows.md) §11.5's check 9 named `Epoch.ResourceLocks` as the resource-lock read. `do_execute` reads **`ExecutionGuard.HeldResources`**. `Epoch.ResourceLocks` is the epoch pallet's own lock set and is a real frozen item (§7.1, contract v24), so the citation was plausible and wrong — a client mirroring it would have read a different structure and passed rows the guard refuses. §11.5 now names the item the guard actually reads.

---

## 8. Chain identity constants (D-17; X-11a/b)

Pinned in the frontend's `ChainIdentity` at build time and asserted at boot. These values are frozen; changing any is a contract version bump.

| Constant | Value |
|---|---|
| ss58 prefix | **7777** (ss58-registry submission REQUIRED before Phase 2) |
| paraId | Assigned at onboarding; **all test fixtures use 4242** |
| USDC asset | `pallet-assets` instance **`ForeignAssets`**, keyed by XCM `Location { parents: 1, interior: X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337)) }`. Verified on **both** Asset Hubs this rollout targets: Polkadot 2026-07-16 (PLAN.md V-17) and Paseo 2026-08-04 (V-105), the second because §7.7 pins the Asset Hub of the relay a release targets and a testnet registry is its own. `PalletInstance(50)` is confirmed by the pinned Paseo AH metadata, where `Assets` is pallet 50 |
| USDC decimals | 6 (preserved from Asset Hub); `min_balance = 10^4` (1 cent) |
| VIT decimals | 12 |
| VIT existential deposit | **0.01 VIT** (= 10^10 plancks) |
| Phase flag storage | `pallet-constitution::PhaseFlags` (§7.3) — the trading-enablement key |
| Contract version | `INTEGRATION_CONTRACT_VERSION` (runtime constant) — **`30` in force** (§13's history is the authority; read the constant, never a prose copy of it) |

---

## 9. Constants and parameter binding (X-11e/h — no FE hardcodes)

Two representations exist, and the frontend MUST bind to them and never hardcode:

1. **Kernel constants (class K)** have *no storage representation*; they are exposed as **pallet constants in the runtime metadata** (the constants API) and are readable without any storage query. They change only via Wasm upgrade, which the frontend already tracks through descriptors.
2. **Tunables** live in `pallet-constitution::Params` and are read via `params()` (or the raw `Params` map). Only hard envelopes of keys in [13](13-parameters.md) reading rule 7's exhaustive kernel-bounded set are also metadata constants; META-amendable registry bounds remain in `Params` and bind through `ParamView.min` / `ParamView.max`.

Enumeration of every value the frontend's precondition tables re-check (defaults/bounds are quoted for readability; *normative values: [13](13-parameters.md)*):

| Value | Representation (FE binding target) | Used by FE precondition row |
|---|---|---|
| Live `ledger.min_split` (K floor 0.01 USDC) | `params()` (authoritative live record); the already-wired `MinSplit` metadata constant mirrors that live value | `ledger.split/merge` |
| Per-trade min / max (`mkt.min_trade = 1`, `mkt.max_trade = b/4`) | metadata constants (K) | `market.buy/sell` |
| `MinTransfer` | metadata constant (K) | `ledger.transfer` |
| `MaxPositionsPerAccount = 64` (protocol accounts exempt) | metadata constant | `ledger.transfer` (recipient bound), position views |
| Positions entry deposit (0.1 USDC) | metadata constant | `ledger.split`, `transfer` fee headroom |
| `IntakeQueue = 64` bound | metadata constant | `epoch.submit` queue-cap check |
| `intake.max_per_account` live rate limit (launch default 4; META-amendable bounds [2, 8]) | `params()` — bind `ParamView.value`, `.min`, and `.max`; no metadata constant | `epoch.submit` account-rate check |
| `MaxLiveProposals = 32` | metadata constant | discovery bounds |
| `prop.bond` per class | `params()` for the class **base**; the TREASURY Ask surcharge is the `TreasuryBondAskBps` metadata constant (K, not part of the `Params` row — [13](13-parameters.md) §1) | `epoch.submit` |
| `mkt.fee` (30 bps default) | `Market::Fee` for the basis-points projection used by quote recomputation, cross-checked against the raw `Perbill` inner scalar from `params()` (§4) | quote display, `buy/sell` cost recompute |
| `ledger.redeem_fee` (30 bps default; [08](08-treasury-and-economics.md) §10.6 couples it `≤ mkt.fee`) | `ConditionalLedger::RedemptionFee` for the basis-points projection, cross-checked against the raw `Perbill` inner scalar from `params()` (§4) — placed beside `mkt.fee` because the two are a coupled pair, not because it is a market value | redemption net-payout display; `ledger.redeem_scalar` / `redeem_scalar_pair` / `redeem_gate` / `redeem_baseline` / `redeem_baseline_pair` |
| `mkt.obs_interval` (10 blocks) | `params()` | crank staleness check |
| `dec.window`, `dec.trailing`, `dec.delta`, `dec.sigma`, `dec.coverage`, `dec.v_min`; `dec.extension` (K) | `params()` for tunable values/bounds. Metadata constants exist only for the rule-7 kernel-bounded `dec.window` / `dec.delta` / `dec.sigma` floors and kernel-only `dec.extension`. `dec.trailing` / `dec.coverage` / `dec.v_min` bind through `ParamView.min` / `.max`: respectively 3,600 / 28,800 blocks, 90 / 99 percent, and ×0.1 / ×10 of the per-class schedule; only the effective-v-min `2·InCapPrize` term is K. | finalized decision statistics, `decide` crank |
| `gate.p_max`, `gate.eps` | `params()` (0.10 K ceiling as constant) | gate-market screens |
| `exec.timelock` per class, `exec.grace` | `params()` (K floors as constants) | `execution_guard.execute` |
| `orc.bond_floor`/`orc.rounds`/`orc.window`, `orc.bond_bps` value scaling, `orc.reporter_stake` | `params()` | `oracle.report/challenge` |
| `trs.cap_proposal`/`cap_30d`/`cap_180d`, `trs.stream_threshold` | `params()` | treasury proposal screens |
| Phase-3 deposit caps `phase3.tvl_cap` / `phase3.dep_cap` | `params()` using the canonical keys in [13](13-parameters.md), combined with §7.4 `CumulativeDeposits` | global/per-account deposit-cap precheck |
| `fee.vit_usdc_rate` | `params()` | fee-currency selector (D-12) |
| `epoch.length`, `epoch.slots` | `params()` (live values and record bounds) + applicable metadata floor/bound constants | countdowns, phase headers |
| Phase-offset fractions | `PhaseOffsets` metadata constant only (kernel-fixed `futarchy-primitives::phase_offsets`; never `Params`) | countdowns, phase headers |
| `DescriptorLeadTime = 43,200` blocks | metadata constant | upgrade banners, execute precondition |
| `RecentCohortSummaries` ring size = 32; books/proposal ≤ 6; primary `MaxLiveMarkets = 196` / `MaxStoredMarkets = 2,240`; external `MaxLiveExternalMarkets = 128` / `MaxStoredExternalMarkets = 128`; shared `MaxAllStoredMarkets = 2,368` | metadata constants | active history/chart bounds; domain-separated retained direct-read/discovery bounds |
| `ServiceIdBase = 2^63` — the primary/service id-band boundary (K; [16](16-hosted-question-service.md) §7.1) | `ConditionalLedger::ServiceIdBase` metadata constant (K). **Not a literal:** rule 4 below forbids the frontend the number, and [11](11-frontend-workflows.md) §11.2a requires it to *show* the domain, so the boundary must have a metadata home like any other value the client re-derives | domain labelling of every position, vault, book and question id; which ledger instance an S4 write routes to (§7.1, [11](11-frontend-workflows.md) §11.2a) |
| **Guardian allowance limits (contract v30)** — `delay_once` 2/epoch, `force_rerun` 1/epoch, `pause_intake` 1 per 4-epoch window ([06](06-governance-and-guardians.md) §5.2's table; K) | the four `Guardian::{DelayOnceAllowancePerEpoch, ForceRerunAllowancePerEpoch, PauseIntakeAllowance, PauseIntakeAllowanceWindowEpochs}` metadata constants (K), read **together with** §7.4's `Guardian.Allowances`, which stores the *used* counters alone. A meter is the pair; neither half is a meter | `guardian.propose_action` — [11](11-frontend-workflows.md) §11.8.2's *"allowance remaining for the power (allowance meters displayed)"* precondition, and the approve row that dispatches on it |

### Frozen metadata-constant names (SQ-138)

The tuple/array orders in this table are part of the freeze. Every per-class array is ordered **Param, Treasury, Code, Meta**. `FixedU64` values use the contract's 1e9 grid; `Balance` values use USDC base units where the row is USDC-denominated.

| Pallet | Constant name | Type | Value source |
|---|---|---|---|
| Constitution | `INTEGRATION_CONTRACT_VERSION` | `u32` | `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` (the value §13 marks IN FORCE — read the constant, never a prose copy; §13) |
| Constitution | `MaxParams` | `u32` | `constitution_core::MAX_PARAMS` (= 128) |
| Constitution | `MaxCapabilities` | `u32` | `constitution_core::MAX_CAPABILITIES` (= 64) |
| Constitution | `MaxMeters` | `u32` | `constitution_core::MAX_METERS` (= 16) |
| ConditionalLedger | `MinSplit` | `Balance` | live `Params[ledger.min_split]`, backstopped by `kernel::MIN_SPLIT_USDC` |
| ConditionalLedger | `PositionDeposit` | `Balance` | live `Params[ledger.pos_dep]` (launch 0.1 USDC) |
| ConditionalLedger | `MaxPositionsPerAccount` | `u32` | `bounds::MAX_ACCOUNT_POSITIONS` (= 64) |
| ConditionalLedger | `ArchiveDelay` | `BlockNumber` (`u32`) | live `Params[ledger.archive]` |
| ConditionalLedger | `ReapBatch` | `u32` | `kernel::REAP_BATCH` (= 100) |
| ConditionalLedger | `MinTransfer` | `Balance` | `kernel::MIN_TRANSFER_USDC` (= 10,000 base units) |
| ConditionalLedger | `RedemptionFee` | `u128` | live `Params[ledger.redeem_fee]`, projected in basis points by flooring raw `Perbill / 100,000` (launch 30) |
| ConditionalLedger | `ServiceIdBase` | `u64` | `kernel::SERVICE_ID_BASE` (= 2^63). Published by **both** instances with the identical value — it partitions the shared id space rather than describing either side, so there is exactly one number and no per-instance copy to drift |
| Market | `Fee` | `u128` | live `Params[mkt.fee]`, projected in basis points by flooring raw `Perbill / 100,000` (launch 30) |
| Market | `ObsInterval` | `u64` | live `Params[mkt.obs_interval]`, promoted from `u32` (launch 10 blocks) |
| Market | `Kappa1e9` | `u64` | live `Params[mkt.kappa]` on the 1e9 grid (launch 5,000,000) |
| Market | `ArchiveDelay` | `BlockNumber` (`u32`) | live `Params[ledger.archive]` |
| Market | `MinTrade` | `Balance` | `kernel::MIN_TRADE_USDC` (= 1,000,000 base units) |
| Market | `MaxTradeRatio` | `(u32, u32)` | kernel ratio `(1, 4)` (`b/4`) |
| Market | `MaxLiveMarkets` | `u32` | `bounds::MAX_LIVE_MARKETS` (= 196) |
| Market | `MaxStoredMarkets` | `u32` | `bounds::MAX_STORED_MARKETS` (= 2,240) |
| Market | `MaxLiveExternalMarkets` | `u32` | `bounds::MAX_LIVE_EXTERNAL_MARKETS` (= 128) |
| Market | `MaxStoredExternalMarkets` | `u32` | `bounds::MAX_STORED_EXTERNAL_MARKETS` (= 128) |
| Market | `MaxAllStoredMarkets` | `u32` | `bounds::MAX_ALL_STORED_MARKETS` (= 2,368) |
| Market | `GatePMaxCeiling` | `FixedU64` | `kernel::GATE_P_MAX_CEILING_1E9` (= 100,000,000; 0.10) |
| Market | `GateEpsFloor` | `FixedU64` | [13 §1](13-parameters.md) `gate.eps` K floor (= 5,000,000; 0.005) |
| Oracle | `MaxRoundCloseBatch` | `u32` | `kernel::TICK_BATCH` (= 10) |
| Registry (each instance) | `Kind` | `RegistryKind` | runtime instance `Config::Kind` (`Incident` or `Milestone`) |
| Registry (each instance) | `ArchiveDelay` | `BlockNumber` (`u32`) | `max(live Params[ledger.archive], 21 × BLOCKS_PER_DAY)`; the 21-day floor is independent of the shared ledger tunable |
| Registry (each instance) | `MaxFilingsPerEpoch` | `u32` | `kernel::REG_MAX_FILINGS_EPOCH` (= 64) |
| Registry (each instance) | `MaxEvidenceLen` | `u32` | fixed `H256` evidence-hash width (= 32 bytes) |
| ExecutionGuard | `INTEGRATION_CONTRACT_VERSION` | `u32` | `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` (the value §13 marks IN FORCE — read the constant, never a prose copy; §13) |
| ExecutionGuard | `MaxLiveProposals` | `u32` | `bounds::MAX_LIVE_PROPOSALS` (= 32) |
| ExecutionGuard | `MaxExecutionRecords` | `u32` | `bounds::MAX_EXECUTION_RECORDS` (= 256) |
| ExecutionGuard | `MaxCalls` | `u32` | `kernel::MAX_CALLS` (= 16) |
| ExecutionGuard | `MaxPayloadBytes` | `u32` | `kernel::MAX_BYTES` (= 65,536) |
| ExecutionGuard | `DescriptorLeadTime` | `BlockNumber` (`u32`) | `kernel::DESCRIPTOR_LEAD_TIME_BLOCKS` (= 43,200) |
| ExecutionGuard | `MaxRuntimeCodeBytes` | `u32` | runtime `Config::MaxRuntimeCodeBytes` (`pallet_preimage::MAX_SIZE`) |
| ExecutionGuard | `ExecutionTimelockFloor` | `[u32; 4]` | [13 §1](13-parameters.md) `exec.lock.*` K hard minima, `[14,400; 4]` blocks |
| ExecutionGuard | `ExecutionGraceFloor` | `u32` | [13 §1](13-parameters.md) `exec.grace` K hard minimum (= 100,800 blocks) |
| Epoch | `INTEGRATION_CONTRACT_VERSION` | `u32` | `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` (the value §13 marks IN FORCE — read the constant, never a prose copy; §13) |
| Epoch | `MaxLiveProposals` | `u32` | `bounds::MAX_LIVE_PROPOSALS` (= 32) |
| Epoch | `MaxIntakeQueue` | `u32` | `bounds::INTAKE_QUEUE` (= 64) |
| Epoch | `MaxNonTerminalCohorts` | `u32` | `bounds::MAX_NON_TERMINAL_COHORTS` (= 4) |
| Epoch | `RecentCohortSummariesBound` | `u32` | `bounds::RECENT_COHORT_SUMMARIES` (= 32) |
| Epoch | `TickBatch` | `u32` | `kernel::TICK_BATCH` (= 10) |
| Epoch | `PhaseOffsets` | `[(u32, u32); 7]` | `futarchy_primitives::phase_offsets`: `[(0,21), (3,21), (4,21), (5,21), (15,21), (18,21), (20,21)]` for Intake/Qualify/Seed/Trade/DecideWindow/Decide/Housekeeping |
| Epoch | `MaxBooksPerProposal` | `u32` | `bounds::BOOKS_PER_PROPOSAL` (= 6) |
| Epoch | `MinEpochLength` | `u32` | `kernel::MIN_EPOCH_LENGTH_BLOCKS` (= 201,600) |
| Epoch | `DecisionWindowFloor` | `u32` | [13 §1](13-parameters.md) `dec.window` K hard minimum (= 14,400 blocks) |
| Epoch | `DecisionExtension` | `u32` | `kernel::DEC_EXTENSION_BLOCKS` (= 43,200) |
| Epoch | `DecisionDeltaFloors` | `[FixedU64; 4]` | [13 §1](13-parameters.md) `dec.delta.*` K hard minima (= `[5,000,000; 4]`) |
| Epoch | `TreasuryBondAskBps` | `u128` | `kernel::TREASURY_BOND_ASK_BPS` (= 50; the 08 §7 TREASURY Ask surcharge slope, added in v13 — SQ-186) |
| Epoch | `DecisionSigmaFloors` | `[FixedU64; 4]` | [13 §1](13-parameters.md) `dec.sigma.*` K hard minima (= `[0; 4]`) |
| Welfare | `INTEGRATION_CONTRACT_VERSION` | `u32` | `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` (the value §13 marks IN FORCE — read the constant, never a prose copy; §13) |
| Welfare | `MaxMetricSpecs` | `u32` | `welfare_core::MAX_METRIC_SPECS` (= 16) |
| Welfare | `MaxSnapshots` | `u32` | `welfare_core::MAX_SNAPSHOTS` (= 60 = 20 retained epochs × (`epoch.horizon_k` = 2 frozen versions + the epoch's own active version); contract v16) |
| Welfare | `MaxGateFlags` | `u32` | `welfare_core::MAX_GATE_FLAGS` (= 20) |
| Welfare | `MaxDailyGateSamples` | `u8` | `welfare_core::MAX_DAILY_GATE_SAMPLES` (= 64) |
| FutarchyTreasury | `INTEGRATION_CONTRACT_VERSION` | `u32` | `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` (the value §13 marks IN FORCE — read the constant, never a prose copy; §13) |
| FutarchyTreasury | `MaxStreams` | `u32` | `futarchy_treasury_core::MAX_STREAMS` (= 128) |
| FutarchyTreasury | `MaxBudgetLines` | `u32` | `futarchy_treasury_core::MAX_BUDGET_LINES` (= 32) |
| FutarchyTreasury | `MaxPolCommitments` | `u32` | `futarchy_treasury_core::MAX_POL_COMMITMENTS` (= 196) |
| Guardian | `GuardianSeats` | `u32` | `guardian_core::GUARDIAN_SEATS` (= 7) |
| Guardian | `GuardianThreshold` | `u8` | `guardian_core::GUARDIAN_THRESHOLD` (= 5) |
| Guardian | `GuardianBond` | `Balance` | `guardian_core::GUARDIAN_BOND` (= 50,000 VIT) |
| Guardian | `PlaybookFreezeWindowBlocks` | `BlockNumber` (`u32`) | `kernel::PLAYBOOK_FREEZE_WINDOW_BLOCKS` (= 201,600) |
| Guardian | `DelayOnceAllowancePerEpoch` **(contract v30)** | `u8` | `guardian_core::DELAY_ONCE_ALLOWANCE_PER_EPOCH` (= 2) |
| Guardian | `ForceRerunAllowancePerEpoch` **(contract v30)** | `u8` | `guardian_core::FORCE_RERUN_ALLOWANCE_PER_EPOCH` (= 1) |
| Guardian | `PauseIntakeAllowance` **(contract v30)** | `u8` | `guardian_core::PAUSE_INTAKE_ALLOWANCE` (= 1) |
| Guardian | `PauseIntakeAllowanceWindowEpochs` **(contract v30)** | `EpochId` (`u32`) | `guardian_core::PAUSE_INTAKE_ALLOWANCE_WINDOW_EPOCHS` (= 4) |
| Attestor | `AttMinMembers` | `u32` | `kernel::ATT_MIN_MEMBERS` (= 3) |
| Attestor | `AttQuorum` | `u32` | `kernel::ATT_QUORUM` (= 2) |
| Attestor | `ChallengeWindowBlocks` | `BlockNumber` (`u32`) | `attestor_core::CHALLENGE_WINDOW_BLOCKS` (= 43,200) |

The `PalletId` configuration constants exposed by ConditionalLedger, Market and Registry are intentionally absent: they are internal custody identifiers and no frontend workflow binds them. No placeholder names from external release tooling are normative; this table is the canonical name freeze.

Catch-all rule: **any** [13](13-parameters.md) key a frontend workflow evaluates MUST be sourced from `params()`/metadata at a pinned finalized block. Shipping a numeric copy of any of these values in the frontend bundle is a release-gate failure (frontend CI asserts no literal matches against the constants list).

---

## 10. WSS bootnode chain-spec requirement (D-6, X-4)

The production (and Paseo) chain-spec artifacts in `deploy/` MUST list **≥ 8 browser-reachable WSS multiaddrs across ≥ 4 independent operators, with ≥ 2 endpoints on port 443** (corporate/mobile networks block non-443 WSS). These endpoints are the canonical frontend's guaranteed dial set — the fallback for the open **[VERIFY browser-WSS peer behavior under smoldot 3.x]**. Operators hold the protocol-funded 30-day served-state commitment ([12](12-release-and-operations.md)); the requirement is a rollout phase gate ([01 §7](01-system-overview.md), [09](09-execution-upgrades-and-rollout.md)). Chain-spec updates that would drop the set below any of the three thresholds MUST NOT be released.

---

## 11. Backend-published test artifacts per release (X-15)

The frontend's compatibility controls are release-gated on backend-published inputs. **Every tagged runtime release** MUST publish, as CI artifacts attached to the release in the `futarchy-chain` repository and mirrored content-addressed alongside the frontend release channel:

| Artifact | Contents | Consumed by |
|---|---|---|
| Runtime Wasm + metadata | Reproducibly-built primary `runtime.wasm`, SCALE metadata blob, metadata hash and spec_name/spec_version; for every primary, the same fields for its separately built, exact-next-version terminal-recovery runtime | Descriptor regeneration + drift CI for **both live-capable versions** (FE §12.1-equivalent, [12](12-release-and-operations.md)); a recovery image is ineligible until its descriptor is live |
| Chopsticks environment | Forked-state config + fixture state snapshots for: upgrade transition, StaleQueue, VOID epoch, manufactured precondition failures | Nightly Chopsticks suites |
| Zombienet environment | Relay+para topology files + genesis overrides matching the release | e2e suites driven through the FE data layer |
| chainHead fixtures | Deterministic JSON-RPC transcripts for every screen store's read set | Mock-runtime PR suites |

**Gating rule:** publishing these artifacts is backend WBS row **E15** (mirroring FE-R1); E15 is release-gating for the backend exactly as FE-12 is for the frontend. A runtime release without the full artifact set MUST NOT ship, and runtime changes that break `FutarchyApi` compatibility gates MUST NOT merge without a coordinated frontend release (FE §30 P-10, applied). WBS ownership detail: [15](15-invariants-and-testing.md).

---

## 12. `ReleaseChannel` fixed-layout raw storage key (D-14)

Purpose: pinned-release (stranded) frontends must learn "a newer canonical release exists" **without current metadata** — precisely when they are `ReadOnlyIncompatible`. This replaces the superseded `system.remark` release pointer, which stranded apps could not decode.

- **Raw key (frozen forever):** `twox128("Constitution") ++ twox128("ReleaseChannel")`.
- **Value layout (frozen forever — fixed-width, no length prefixes, readable with a raw `state_getStorage`/chainHead storage proof and no metadata):**

| Offset | Width | Field |
|---|---|---|
| 0 | 1 | `schema: u8` — always `1`; any other value ⇒ layout extended append-only, prefix still valid |
| 1 | 32 | `version: [u8; 32]` — UTF-8 semver, zero-padded (current canonical release) |
| 33 | 43 | `manifest_txid: [u8; 43]` — Arweave base64url TXID, zero-padded |
| 76 | 32 | `release_json_hash: [u8; 32]` — SHA-256 |
| 108 | 4 | `updated_at: u32` LE — block number of last update |
| 112 | 4 | `spec_version: u32` LE — current runtime spec_version |
| 116 | 4 | `pending_authorized_at: u32` LE — block of a pending `UpgradeAuthorized`; 0 if none (D-14 lead-time display, [09](09-execution-upgrades-and-rollout.md)) |
| 120 | 32 | `min_supported_version: [u8; 32]` — UTF-8 semver, zero-padded; oldest release that may sign without a blocking warning ([12 §3.2](12-release-and-operations.md)) |
| 152 | 4 | `keyring_generation: u32` LE — monotone keyring generation ([12 §2.1](12-release-and-operations.md)) |
| 156 | 8 | `revoked_key_bits: u64` LE — bitmask over key indices within the generation's published keyring ([12 §2.3](12-release-and-operations.md)) |
| 164 | 4 | `flags: u32` LE — bit 0 `SECURITY`, bit 1 `EXPEDITED`, bit 2 `URGENT_UPGRADE`; bits 3–31 reserved zero |

Total **168 bytes** (v1.0 baseline — the pre-freeze 78- and 92-byte drafts in earlier drafts of [09](09-execution-upgrades-and-rollout.md)/[12](12-release-and-operations.md) are superseded by this merged layout; no schema bump, this is the first frozen version). Offset 112 `spec_version` is always the currently installed runtime `spec_version`, never the target of a pending upgrade; a stranded reader uses it to determine compatibility with the runtime that is actually installed.

Post-genesis writers and field ownership are exhaustive:

1. Writer (a), the **execution guard**, exclusively owns offsets 112–119 (`spec_version`, `pending_authorized_at`) and flags bit 2 (`URGENT_UPGRADE`). At `UpgradeAuthorized` it MUST set `pending_authorized_at` and bit 2, stamp `updated_at`, and MUST NOT change `spec_version`. At applied-upgrade detection it MUST set `spec_version` to the newly installed version, clear `pending_authorized_at` and bit 2, and stamp `updated_at`. At relay abort it MUST clear `pending_authorized_at` and bit 2, leave `spec_version` unchanged because the old runtime remains installed, and stamp `updated_at`. Both terminal clears are unconditional on the channel's prior contents.
2. Writer (b), the **`ConstitutionalValues` origin** via `constitution.set_release_channel`, owns offsets 1–107 and 120–163 plus flags bits 0–1 on each canonical repoint, `min_supported_version` bump or key revocation ([12](12-release-and-operations.md)). It MUST merge its input with the stored record and preserve offsets 112–119 and flags bit 2 byte-for-byte. Offset 108 `updated_at` is shared write metadata and each writer MUST stamp it. Offset 0 remains the fixed schema byte and flags bits 3–31 remain reserved zero.

No other origin can write the record. The layout MUST NEVER change except by appending fields beyond offset 168 with a schema bump; readers parse by offset, never by SCALE metadata. **I-30:** `ExecutionGuard::PendingUpgrade.is_some()` iff channel `pending_authorized_at != 0` iff flags bit 2 is set; runtime `try_state` MUST enforce both equivalences. With writer ownership enforced, a compromised writer (b) can still cause a false "update available" banner pointing at a TXID users independently verify, or warning/signing friction in old releases, but it cannot suppress or fabricate the execution guard's pending-upgrade indication ([14](14-threat-model.md)).

---

## 13. Change control (D-2; resolves F-4, X-11h)

1. **Joint ownership.** This document is owned by the backend and frontend teams jointly. Every change REQUIRES explicit sign-off from a named owner on each side, recorded in the document history.
2. **Versioning.** `INTEGRATION_CONTRACT_VERSION` (§8) is stamped in `futarchy-primitives`, exposed via the constants API, and echoed in the frontend `release.json`. Any change to §2–§12 bumps it. The `FutarchyApi` itself carries an `sp_api` version; additive methods bump the API version *and* the contract version.
3. **Append-only.** SCALE types, event fields and view types may only gain trailing fields/variants post-genesis. Renames and removals require a new type, a migration, and a major contract bump with a coordinated FE release inside the `DescriptorLeadTime` window (D-14).
4. **No hardcodes (X-11h).** The frontend binds to the constants API and `params()` for every chain-tunable value (§9); frontend CI enforces the no-literal rule. The 64-position bound and every other formerly hardcoded §21-tunable are chain-read.
5. **Release coupling.** Backend E15 and frontend FE-R1 are the two ends of this contract; neither side's release gates pass while the other's contract surface is red (§11).
6. **Contingency.** If a contract regression ships anyway, the frontend degrades to the D-6 layer-1 surface (chain-served `RecentCohortSummaries` + 8-checkpoint TWAP series + direct storage reads) — reduced depth, full correctness; it never falls back to a trusted third-party service.
7. **Independent counters.** `INTEGRATION_CONTRACT_VERSION` and the SDK's `RuntimeVersion.transaction_version` are independent counters. The contract version is exposed through `futarchy-primitives`, the constants API and `release.json`; `transaction_version` denotes compatibility of existing dispatchables as embedded in signed-transaction validity. An additive contract bump MUST NOT change `transaction_version`.
8. **Foreign-chain surfaces are pinned per release, not by this counter (SQ-587).** §7.7 freezes surfaces on a chain **Bleavit's runtime cannot observe**. Rule 2 does not extend to them, and the exception is normative rather than a lapse: `INTEGRATION_CONTRACT_VERSION` is a Bleavit runtime constant, so no Bleavit upgrade moves the foreign layout and no foreign upgrade moves the constant — bumping it for §7.7 would publish coverage nothing behind it can attest. A foreign surface is pinned in the release's own artifact feed (§11) by that chain's genesis hash, `spec_version` and metadata hash, and carries its **own** [10](10-frontend-architecture.md) §5.2 compatibility verdict, reported separately and never folded into the local one. Adding, removing or reshaping a **row** of §7.7 is still a change to this document under rule 1 and requires the same joint sign-off.

9. **Rule 2 is about the *surface*, and a `[VERIFY]` resolution that moves no surface does not bump (2026-08-05).** Rule 2 says "any change to §2–§12", and read as text that includes resolving a verification note. Read for its purpose it does not, and the purpose is what the counter is wired to: `INTEGRATION_CONTRACT_VERSION` is stamped in `futarchy-primitives`, echoed in `release.json` and compared by [10](10-frontend-architecture.md) §5.2's classifier, so a bump is the sentence *"a client built against the previous number may be wrong about what it can call or read."* Resolving FE-P2 changed no SCALE type, method, storage item, event, constant, encoding, ordering or bound — a client compiled against v27 is in no way less correct afterwards — while a bump would have invalidated the committed artifact feed, the descriptor sets and the surface manifest to chase a prose clarification, and published a surface move that nothing behind it can attest. That is the same failure rule 8 refuses for §7.7, arriving from the other direction. **The test is therefore mechanical, not editorial: if no frozen surface element changes and no client's compiled expectations become wrong, the edit does not bump — and the edit must say so where it lands, so the next reader is not left inferring it from a version that did not move.** Ambiguity resolves toward bumping. This rule lives in §13 rather than in §2–§12 deliberately: a rule about the scope of rule 2 that itself triggered rule 2 would be self-defeating.

**Version history.**

- **v30 (2026-08-08) — the guardian allowance limits no surface published, and the two playbook reads the fifth signature is refused on. IN FORCE.** Purely **additive**, and the first of this defect class to be a **constant** rather than a storage item. **The defect.** [11](11-frontend-workflows.md) §11.8.2 names *"allowance remaining for the power (allowance meters displayed)"* as a precondition of `guardian.propose_action`, and §11.4 rule 2 makes every precondition an exact chain read. §7.4 freezes `Guardian.Allowances` — but that item stores `AllowanceState { delay_used_this_epoch, force_rerun_used_this_epoch, pause_window_start, pause_used_in_window }`, which is the **used** half of each meter and never the limit. No constant published the other half. A client can therefore render a *counter* and not a *meter*, and the only way to satisfy the precondition as written was to invent the limits — which [15](15-invariants-and-testing.md) §2's INV-FE-1 forbids twice over: an unsourced value must not be represented as verified, and must not satisfy a precondition. **Why the limits are frozen rather than the precondition dropped.** [13](13-parameters.md) §1's `grd.bond` / allowances row is `entrenched` and scope-K with no amendment path, and its exemption note said in as many words that the allowances "are **not** individually metadata-exposed, so rule 3 is not currently satisfied for them". Two exits existed: publish them, or close the guardian console's propose and approve tiers outright. These are compile-time kernel constants and `pallet-guardian` already carried a `#[pallet::constant_name(...)]` block, so exposure is additive, precedented and changes no behaviour — while closing a guardian's core control because a fixed number had never been published would remove a safety power to repair a publication gap, which is the wrong direction under R-7. [06](06-governance-and-guardians.md) §7 had in fact already mandated the exposure — *"All track parameters, allowances, bonds and deadlines are exposed via the runtime constants API (metadata) — the FE hardcodes nothing (D-2)"* — so 13 §1's note contradicted 06 before it contradicted 11. **What changes.** §9 gains **four** Guardian metadata constants — `DelayOnceAllowancePerEpoch` (2), `ForceRerunAllowancePerEpoch` (1), `PauseIntakeAllowance` (1) and `PauseIntakeAllowanceWindowEpochs` (4) — and §9's parameter-binding table gains the row that binds them **together with** `Guardian.Allowances`, because a meter is the pair and neither half is one alone. The `pause_intake` allowance is two constants and not one for the same reason: a count without its window is not a rate. **§7.4 gains `Guardian.PlaybookRegistered` and `Guardian.ActivePlaybooks` in the same bump, on the same argument at higher cost.** `PlaybookNotRegistered` and `PlaybookAlreadyActive` are raised inside `guardian.approve_action` on the **dispatching** approval, so a client blind to those two items collects four of the five signatures the emergency path is built on and is refused on the fifth. §7.4 states the two readings that are forbidden: registration is admissibility and never a trigger source (§6.2), and presence in `ActivePlaybooks` blocks `PB-LEDGER-FREEZE` alone rather than every playbook. **What does not change.** No existing SCALE type, view type, event, storage key, runtime-API method, `sp_api` version, call index or metadata-constant name; no dispatchable is added, so `transaction_version` is untouched under rule 7. The four constants are new *names*, so no existing constant's name, type or presence moves; both storage items already exist in the runtime, and freezing one adds a *contract obligation*. `INTEGRATION_CONTRACT_VERSION` moves 29 → 30 and the metadata constants that re-export it move with it. **`spec_version` does not move, and that is a rule about deployment rather than about metadata.** Publishing a constant does move the runtime's metadata, so the §11 artifact feed, the descriptor set and the surface manifest are re-recorded at `spec_version` 2 and its paired recovery 3. No runtime is deployed — the counter's contract is that a *replacement* image on a live chain carries a strictly greater value, and there is no chain and no predecessor — and this is the settled practice of this document rather than a new allowance: v13, v21 and v23 each added metadata constants while `spec_version` stayed at 2. A bump would also force the paired recovery image, which [09](09-execution-upgrades-and-rollout.md) requires to sit at exactly primary + 1. Once a runtime is deployed, a change of this shape bumps `spec_version` like any other. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-08, by explicit ruling ("freeze them; do not close S15").**
- **v29 (2026-08-07) — the three amounts an operator must commit and this contract published none of, plus the trigger reads §11.8.2 requires and never named. Superseded by v30.** Purely **additive**, and the last of SQ-580's defect class to reach §3 rather than §7: the previous eight repairs froze reads the client was told to make, while three of these are quantities *nothing publishes at all*. **The defect.** [11](11-frontend-workflows.md) §11.8 binds every operator control to §11.4 discipline, and rule 2 makes each precondition an exact chain read — yet the round-1 oracle report bond (SQ-598), the registry filing bond (SQ-731) and a treasury stream's claimable amount (SQ-601) had no surface. All three are **money a user must commit**, so the canonical client could not offer the control at all, and did not: three of §11.8's tiers shipped closed with the spec-question id named. **What changes.** §3 gains a **fifteenth** and **sixteenth** method — `bond_quote(request) -> Option<BondQuoteView>` and `treasury_streams(who) -> BoundedVec<StreamView, 128>` — appended after `is_reserved_protocol_destination`; the fourteen existing methods keep their names, signatures and order byte-for-byte, and the additive methods bump the `sp_api` version (4 → 5) per rule 2. §4 gains `BondQuoteRequest`, `BondQuoteView` and `StreamView`, and `NavView` gains a **trailing** `insurance_target` (SQ-602) under rule 3. §7.1 gains **`PendingOracleVoids`** and **`CohortSchedules`**, and §7.4 gains **`ConditionalLedger.LedgerDrifted`**. **One method for two bonds, because 07 states one fold.** `StakeAtRisk(c, m)` and `Exposure(kind, m)` are the same sum of `CohortEscrow(k)` over the live cohort schedules, in scope differently; two methods would publish it twice and let the copies drift. It returns the **amount**, not the exposure, because [07](07-oracle-and-disputes.md) §6.1 states three separable normative details — the division rounds up, rounding resolves toward custody, the `max` applies after rounding — and a client applying them itself would own them, in the under-custody direction I-4/I-28 names as unsafe. `None` is a first-class answer: §7's Milestone exposure is not determinable until the aggregate is bound to a component, and `file` MUST then refuse (G-1). **`treasury_streams` needs no §7.6 exception, and that is the finding.** SQ-601 read §7.6's closing rule (*bind `nav()`, never raw `pallet-futarchy-treasury::State`*) as contradicting §11.8.3's per-stream requirement. It does not: the rule forbids binding **raw storage**, and a published projection is not raw storage — `nav()` is itself one. §7.6's text does not move and no treasury storage becomes contract surface. **`CohortSchedules` is the third storage row, and it closes [11](11-frontend-workflows.md) §11.8.6's O-8.** That row makes *"`spec_version` among the versions live cohorts froze for `epoch`"* a precondition of a bonded filing, and no frozen item answered it — so the row claimed complete coverage of a check the client could not evaluate, which `clauseGroupsFor` reports as vacuously passed. `CohortSchedule.specs` answers it directly. Reassembling the same fact from `Cohorts[epoch].proposals` and `Proposals[pid].metric_spec` is not an alternative: it is a client computation where §11.4 rule 2 requires an exact read, and it reads each proposal's *current* spec rather than the version the cohort froze. This section already cited the item in §3's `bond_quote` boundedness argument while §7 did not freeze it. **The two remaining storage rows are the ones SQ-730's mapping table would otherwise have cited into thin air.** §11.8.2 makes a playbook's trigger *"verifiably active at B′"* part of a precondition row and names five conditions in prose, while `guardian_core::PlaybookTrigger` carries **eight**; doc 11 now carries one row per variant naming the item that establishes it, and two of those items — the pending-VOID latch behind `OracleDeadlock`/`VoidInFlight`, and the I-4 drift latch behind `LedgerDrift` — were frozen nowhere. `PhaseFlags` bit 5 does **not** substitute for the second: it tracks the applied *effect*, so at the moment an activation is proposed it is clear, and a client bound to it would refuse the one action the drift authorizes. **What does not change.** No existing SCALE type, view-type field, event, storage key, call index, metadata-constant name or bound; no dispatchable is added, so `transaction_version` is untouched under rule 7; §7.6's items and its closing rule are unchanged. The three view types and the `NavView` field are appends under rule 3, and every storage item frozen here already exists in the runtime — freezing it adds a *contract obligation*. `INTEGRATION_CONTRACT_VERSION` moves 28 → 29 and the metadata constants that re-export it move with it; no constant's name, type or presence changes. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-07, through the standing autonomous-resolution delegation.**
- **v28 (2026-08-06) — the six operator reads [11](11-frontend-workflows.md) §11.8 mandates and this document named nowhere, and the pallet one of them named does not have them. Superseded by v29.** Purely **additive**, and SQ-580's defect class reaching §7 a ninth time. **The defect.** §11.8 binds every operator workflow to §11.4 discipline, and rule 2 makes each precondition **an exact chain read** — yet six of the reads those workflows require appeared in no section of this contract. §11.8.4 gates the single most consequential signature this client can produce on `now ≥ PendingUpgrade.applicable_at` and on the authorized code hash; §11.8.2's guardian console lists pending actions and their approvals; §11.8.6 renders filings, challenge windows, watchtower acknowledgments and closure with countdowns. An unfrozen surface is one [10](10-frontend-architecture.md) §5.2's classifier **cannot fail on**, so a runtime upgrade that moved any of them would leave the client reporting `full` while the dependent console silently broke. **What changes.** §7.4 gains `Guardian.PendingActions`, `Guardian.Approvals`, `ExecutionGuard.PendingUpgrade`, and — per instance, because `pallet-registry` is instantiated twice and the two allocators share no filing-id space — `Filings`, `ClosedAt` and `AckRecords` for `IncidentRegistry` and `MilestoneRegistry`. §7.6 gains `System.AuthorizedUpgrade`. Ten manifest rows in all, each layout **derived from the runtime's own metadata** rather than written by hand. **Two measurements, and both were defects.** §11.8.4 step 1 read the authorized code hash *"from `parachain-system` storage"*; `ParachainSystem` has no such item on the pinned SDK line, where the authorize/apply pair lives in `frame_system` — the same class as the `REGISTRY_PALLET = 'Registry'` defect found two days earlier, a client read bound to a pallet that cannot answer it. And §11.8.4 spelled `PendingUpgrade { hash, authorized_at, applicable_at }` where the stored type carries a fourth field, `target_spec_version`. Both are corrected in doc 11 by this change, and doc 11 now spells each item as `Pallet.Item`, so `tools/ci/check-client-surface-obligations.py` can see obligations that were previously invisible to it. **What this is not.** It does not freeze per-stream `pallet-futarchy-treasury` storage, because §7.6's closing rule requires every treasury consumer to bind `nav()` instead; nor the insurance target `T_ins`, which no surface publishes. Both remain open spec questions rather than silent gaps. **What does not change.** No existing SCALE type, view type, event, storage key, runtime-API method, `sp_api` version or call index; no dispatchable is added, so `transaction_version` is untouched under rule 7. Every item already exists in the runtime — freezing it adds a *contract obligation*, so the only runtime delta is `INTEGRATION_CONTRACT_VERSION` moving 27 → 28 and the metadata constants that re-export it; no constant's name, type or presence changes. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-06, through the standing autonomous-resolution delegation.**
- **v27 (2026-08-04) — the delegation read every proxied transaction depends on, stated in prose and therefore frozen nowhere (SQ-590). Superseded by v28.** Purely **additive**, and SQ-580's defect class reaching §7 an eighth time — but by a route the previous seven did not take, which is the part worth recording. **The defect.** [11](11-frontend-workflows.md) §11.3 admits proxies "as call wrappers under the same precondition system", and §11.4 rule 2 makes every precondition **an exact chain read**. A `Proxy.proxy` call executes its inner call as `real`, so every row of the table is correctly evaluated against `real` — and *nothing established that the signer may act for `real` at all*. The single surface that answers it, `Proxy.Proxies`, appeared nowhere in this document. The consequence is this class's usual one and lands after the signature: all rows pass, the user signs, and `pallet_proxy::proxy` returns `NotProxy`. A client-side `proxyTypeCovers` does not close it — that asks whether a *claimed* proxy type covers the call, and the claim is precisely what must come from the chain. **What changes.** §7.6 gains **`Proxy.Proxies`** (`AccountId` → `(BoundedVec<ProxyDefinition { delegate, proxy_type, delay }, MaxProxies>, Balance)`), with two normative notes: the **stored** `proxy_type` and `delay` govern rather than any caller-supplied claim, and an **unrecognised `ProxyType` variant is unproven, never permissive** — this runtime declares only `Any`, but that is a value a later runtime may change, and the permissive reading fails in the direction that walks a user to a signature the chain refuses. **Why this one escaped both the v24 sweep and the gate built to prevent a recurrence.** Both work from `Pallet.Item` references in the text of [10](10-frontend-architecture.md) and [11](11-frontend-workflows.md); §11.3 states this obligation without naming any storage item, so there was nothing to match. `tools/ci/check-client-surface-obligations.py` is therefore *sound but not complete*, and the residual gap is a method gap rather than a missing row — recorded as such, not closed by this bump. **What does not change.** No existing SCALE type, view type, event, storage key, runtime-API method, `sp_api` version or call index; no dispatchable is added, so `transaction_version` is untouched under rule 7. `Proxy.Proxies` already exists in the runtime — freezing it adds a *contract obligation*, so the only runtime delta is `INTEGRATION_CONTRACT_VERSION` moving 26 → 27 and the metadata constants that re-export it; no constant's name, type or presence changes. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-04, through the standing autonomous-resolution delegation.**
- **v26 (2026-08-04) — the seven dispatch-check surfaces `execution_guard.execute` reads and this contract never froze (SQ-589). Superseded by v27.** Purely **additive**, and SQ-580's defect reaching §7 from a third direction. **The defect.** [11](11-frontend-workflows.md) §11.5 states 13 dispatch-time checks and requires the client to re-check every one; seven of them read storage §7 did not list, so the canonical client encoded **seven broad clauses in place of thirteen** and a user could be walked to a signature the runtime refuses with `CapabilityDenied`, `ResourceLockMissing`, `GateSuspended` or `FreezeActive`. **What changes.** A new **§7.8** freezes `pallet-execution-guard`'s `HeldResources`, `HardGateBreach`, `DeadManFreeze`, `MigrationHalt`, `Expedited`, `GateSuspension` and `AttestationBindings`; and §7.3 gains **`Capabilities`**. §7.1 is unchanged: the companion read `GateSuspension` needs is `EpochOf`, already frozen there. **The list is derived from `do_execute` and its layouts from the metadata, and both steps changed it.** A first pass taken from surface *names* produced fourteen items — four of which are already reachable through frozen surfaces, because `ledger_freeze_active()` and `dead_man_freeze_active()` read §7.3's `PhaseFlags` bits 5 and 6 while `rerun_held()` reads §7.1's `Proposals` (`configs.rs:9402`, `:9411`, `:9416`). Freezing those would have added contract surface for reads the runtime does not make, which is a cost with no corresponding check. **Two entries exist for reasons worth stating.** `Expedited` is an **exemption**, not a check: a client reading the freeze flags without it is fail-closed but tells the user they are blocked when the chain would execute. And `GateSuspension` is undecidable alone — `Some(epoch)` is a suspension only when that epoch is current — which is why `CurrentEpoch` joins in the same bump instead of being inferred. **A citation defect repaired with it:** §11.5's check 9 named `Epoch.ResourceLocks` where the guard reads `ExecutionGuard.HeldResources`. Both items are real, so the citation was plausible and wrong, and a client mirroring it would read a different structure and pass rows the guard refuses. **What does not change.** No existing SCALE type, view type, event, storage key, runtime-API method, `sp_api` version or call index; no dispatchable is added, so `transaction_version` is untouched under rule 7. `INTEGRATION_CONTRACT_VERSION` moves 25 → 26 and the metadata constants that re-export it move with it; no constant's name, type or presence changes. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-04, through the standing autonomous-resolution delegation.**
- **v25 · revision (2026-08-04) — §7.7 Asset Hub, and the first change to this document that deliberately does NOT bump the counter (SQ-587).** The contract version stays **25**. **What changes.** A new **§7.7** freezes the three Asset Hub surfaces [11](11-frontend-workflows.md) §11.9.1's deposit leg depends on, and a new **rule 8** states the non-bump normatively. **Why no bump.** Rule 8 carries the argument: this counter is a *Bleavit runtime constant*, and §7.7's surfaces live on a chain that runtime cannot observe in either direction. A bump would publish coverage nothing behind it can attest — the same defect shape v24 repaired, inverted. The foreign surfaces are pinned instead in the release's artifact feed and probed as a **separate** compatibility verdict. **Two corrections of record, because SQ-587 asserted both wrongly.** (i) X-11a does **not** forbid the AH-side `Assets.Account(1337, who)` read: X-11a is about *Bleavit*, where USDC is a `ForeignAssets` entry, and §8's own Location resolves to `Assets`/1337 *on parachain 1000* — the two rows are one asset seen from two chains. (ii) *Which* Asset Hub was never an open decision for this document: [08](08-treasury-and-economics.md) §2.5 and [09](09-execution-upgrades-and-rollout.md) §6.3 phase it — Paseo at Phase 2, Polkadot at Phase 3 — so a release pins the Asset Hub of the relay it targets, per release. **What does not change.** No SCALE type, view type, event, storage key, constant, call index, runtime-API method or `sp_api` version; no Bleavit storage item is frozen or unfrozen; `transaction_version` is untouched; the artifact feed and its fixtures are unaffected, since nothing in Bleavit's metadata moved. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-04, through the standing autonomous-resolution delegation.**
- **v25 (2026-08-04) — the fourteenth `FutarchyApi` method: the P-9 predicate the client could not read (SQ-588). IN FORCE.** Purely **additive**, and the same shape of defect v24 repaired, reached from the other side. **The defect.** [11](11-frontend-workflows.md) §11.5's `ledger.transfer` row requires "recipient is not a protocol account", and §11.4 rule 2 requires every row in that table to be **an exact chain read**. The runtime enforces the rule as `ensure!(!ReservedProtocolDestinations::contains(&to))` — a `Contains` implementation over a domain-separated address namespace plus a set of `PalletId`-derived singletons, which is *not storage*. So the clause had no surface to cite, no `SurfaceId` to bind, and the canonical client omitted it entirely: a user could be walked to a signature the runtime then refuses. **What changes.** §3 gains a **fourteenth** method, `is_reserved_protocol_destination(who) -> bool`, appended after `service_positions`; the thirteen existing methods keep their names, signatures and order byte-for-byte, and the additive method bumps the `sp_api` version (3 → 4) per rule 2. **Why a method and not published constants.** Publishing the namespace was the obvious alternative and is wrong for a *precondition*: a client recomputing membership from frozen constants is evaluating a computation, not reading the chain, which makes §11.4 rule 2 false for that row. It is the same distinction that made `ConditionalLedger::ServiceIdBase` correctly a metadata constant in v23 — a constant classifies a datum the client already holds, while this asks the chain about an address the user has just typed. The predicate is also two things at once (a byte namespace *and* a singleton list), so constants would mean ~13 frozen entries plus a client reimplementation that can drift; a method can do neither. **What it is deliberately not.** Not `Market.MarketProtocolAccounts`, which SQ-588 originally proposed freezing. That index is ownership/refcount state governing deposit exemption and is strictly narrower than the enforced predicate — classification does not depend on it, because every canonical future, present and past book address is reserved by namespace whether or not a book currently references it. Freezing it would have added a contract surface **and** a per-recipient storage read on every transfer **and** still bound the client to a predicate narrower than the runtime's, passing rows the chain refuses. **What does not change.** No existing SCALE type, view type, storage key, event, constant or call index; no storage item is frozen or unfrozen; no dispatchable is added, so `transaction_version` is untouched under rule 7. `INTEGRATION_CONTRACT_VERSION` moves 24 → 25 and the metadata constants that re-export it move with it. **Pre-genesis revision** — no runtime is deployed, so point 3's migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-04, through the standing autonomous-resolution delegation.**
- **v24 (2026-08-04) — the twelve surfaces the client was told to read and this contract never froze (SQ-580). Superseded by v25.** Purely **additive**, and a repair of a contradiction rather than a new capability. **The defect.** §7's closing rule states that "storage items not listed in this section are not contract surface, and their raw decodability through portable metadata is not guaranteed" — while [10](10-frontend-architecture.md) and [11](11-frontend-workflows.md) mandate twelve reads that §7 did not list. This document therefore denied contract status to reads its own companion documents made compulsory, and every existing gate agreed with it: `check-chain-feed.py` verifies that what *is* declared matches the runtime, `surface:check` re-derives `CRITICAL_SURFACE` from what *is* declared, and `test:mock-runtime` asserts a fixture per declared entry. **None of them asked whether what was required had ever been declared** — which is the shape SQ-552, SQ-577 and SQ-581 also took, and why the inverse gate (`tools/ci/check-client-surface-obligations.py`) ships with this bump rather than after it. **What changes.** (i) §7.1 gains **`ResourceLocks`**, `pallet-epoch`'s own item, omitted from its own table while [09](09-execution-upgrades-and-rollout.md) §1.2(8) makes it a dispatch-time check and [11](11-frontend-workflows.md) §11.5 mirrors it as a client precondition. (ii) A new **§7.6** freezes the eleven upstream-pallet reads: `Multisig.Multisigs` ([11](11-frontend-workflows.md) §11.3, which blocked F6's multisig and proxy paths); the four `Referenda` items, both `Preimage` items, both `ConvictionVoting` items and `Scheduler.Agenda` ([11](11-frontend-workflows.md) §11.7.2); and `System.Events` ([10](10-frontend-architecture.md) §4.2). **Why upstream storage belongs in a Bleavit contract at all.** The freeze matters *more* for an SDK-owned layout than a Bleavit-owned one: Bleavit's own storage moves only when Bleavit changes it, and §13 rule 2 makes that bump this constant, whereas an upstream layout can move on a release-line bump with no Bleavit source change and no counter to notice. §7.4's existing `System.Account` and `ForeignAssets.Account` entries are the same judgement already taken. **The consequence being repaired is not a missing feature:** [10](10-frontend-architecture.md) §5.2's classifier probes exactly the frozen set, so an unfrozen surface is one the lattice cannot fail on, and a runtime upgrade that moved it would leave the client reporting `full` while the dependent path broke. **One representation choice, stated because it is a deliberate loss of expansion.** `System.Events` is frozen as its `EventRecord { phase, event, topics }` container with the `RuntimeEvent` payload unexpanded; expanding it would restate every event of every pallet (2.2 MB of manifest) and make the row fire on any unrelated pallet's new event. **The coverage claim is narrower than it first looks and §7.6 states it exactly:** §6 does not exhaust pallet-local events, so the elided subtree is not fully covered — what is covered is everything in it that this contract freezes, and the remainder is not contract surface. A new event that *should* be in §6 is therefore not caught here, and nothing derives §6 obligations from the runtime source (**SQ-586**). `Referenda.ReferendumInfoFor` and `Scheduler.Agenda` embed `OriginCaller`, which nothing else freezes, and are expanded in full. **What does not change.** No existing SCALE type, view type, event, storage key, runtime-API method or call index; no dispatchable is added, so `transaction_version` is untouched under rule 7; the thirteen `FutarchyApi` methods and their `sp_api` version are unmoved. **One constant does change and saying otherwise would be false:** `INTEGRATION_CONTRACT_VERSION` itself moves 23 → 24, and the metadata constants that re-export it move with it. No constant's *name, type or presence* changes. Freezing an item that already exists in the runtime adds a *contract obligation*, not a runtime change — the only runtime delta is the value of this constant itself. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-04, through the standing autonomous-resolution delegation.**
- **v23 (2026-08-03) — the canonical client serves external books (D-20, SQ-571). Superseded by v24.** A scope ruling by the user, and a repair of a defect it exposed. **What changes.** (i) §4a's **§7.1 scoping paragraph is reversed**: `ServiceLedger`'s `{Vaults, BaselineVaults, Positions, PositionTotals}` become canonical-frontend ingest surface under the *same* shapes, bounds and key orders §7.4 already freezes — two instances of one pallet, so no second shape set is frozen and nothing about instance `()` moves. (ii) §3 gains a **thirteenth** method, `service_positions(who) -> BoundedVec<PositionView, 64>`, appended after `hosted_report`; the twelve existing methods keep their names, signatures and order byte-for-byte, and the additive method bumps the `sp_api` version per §13 rule 2. (iii) §9 gains the `ConditionalLedger::ServiceIdBase` metadata constant (K, = 2^63), because the two clauses above create a client obligation that §9 could not yet satisfy: [11](11-frontend-workflows.md) §11.2a requires the domain of every row to be *shown* and forbids inferring it from the call site, while §13 rule 4 forbids the frontend a chain literal — so without a metadata home the only compliant client would be one that hardcodes `1 << 63`, which is precisely what rule 4 exists to prevent. (iv) [11](11-frontend-workflows.md) §11.2a fixes the **write** side of the same grant: a service-domain position is transferred and redeemed through the `ServiceLedger` pallet instance, never through `ConditionalLedger`, and the reachable call subset is smaller because a hosted question has two books and no gate or Baseline leg ([16](16-hosted-question-service.md) §7.6). **Why a second method and not a wider first one.** `MAX_ACCOUNT_POSITIONS = 64` is enforced per account *per instance*, so 64 primary and 64 service positions are simultaneously lawful; a merged return would make truncation reachable for ordinary users, and the runtime's own truncation-safety argument — that only [13](13-parameters.md) §4-exempt protocol accounts can overflow — is instance-scoped and would silently become false. Truncating here hides money rather than detail, so the shape follows the invariant instead of the aesthetics. **Why it is named for the domain.** `hosted_report` is named for the product a client buys; this is named for the ledger instance the rows live in, matching §7.1's `ServiceLedger` and [16](16-hosted-question-service.md) §7.1's `LedgerRoute::Service`/`SERVICE_ID_BASE` vocabulary, so the method and the storage a consumer cross-checks it against carry the same word. **What does not change.** No existing SCALE type, view type, storage key, event, constant or call index; `PositionView` is untouched and identical across both domains; no dispatchable is added, so `transaction_version` is untouched under rule 7. **What the grant explicitly is not.** Read admission only: external books stay out of every governance and welfare input, `H` remains primary/system-based and never a subtractive service exclusion, and the client MUST NOT present one merged portfolio total — I-4 solvency is per instance against its own sovereign, which is why the instance exists at all ([16](16-hosted-question-service.md) §7.1). **The defect this repairs, stated plainly:** every other layer already admitted Bleavit accounts into hosted books — `market.buy` is `CallDomain::Public`, `LedgerRoute::for_book` routes the trade with no caller-visible difference, `quote()` already prices external books through the shared `Markets` map, and 16's fee economics *assume* organic trader flow — while this document alone forbade the canonical client from reading the resulting position. The client could take a user's money into a hosted book and then not show it. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-03, by explicit ruling ("the canonical app should serve external books too").**
- **v22 (2026-08-02) — client-paid hosted-report egress (D-20, N9). Superseded by v23.** N9 implements both report-delivery legs without changing the v21 `ReportView`, `hosted_report` method, API method count or `sp_api` version. It appends `delivery_float: Balance` to `ClientRecord` after `questions_total`, fixes that field as USDC liability distinct from the native VIT bond, appends exact-client call indices 3/4 for top-up/withdrawal (including the trailing `DeliveryFloatBelowMinimum` and `DeliveryFundingWouldDust` refusals), and freezes the sole outbound receiver call as `[66, 0] ++ SCALE(ReportView)`. The pallet-local push counters and monitoring-only `TelemetryApi` v4 remain outside this contract. No existing field offset, discriminant or call index moves. `INTEGRATION_CONTRACT_VERSION` is **22**; the additive client calls leave `transaction_version` unchanged under rule 7. This is pre-genesis, so the widened storage value needs no deployed-state migration. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-02, through the standing autonomous-resolution delegation.**
- **v21 (2026-08-01) — hosted questions and reports (D-20, N7). Superseded by v22.** N6 made the market half of D-20 real at v20; N7 now lands the remaining surface atomically. It adds the twelfth `FutarchyApi` method `hosted_report(question_id) -> Option<ReportView>` and its §4a types; `QuestionRegistered`, `QuestionSealed`, `QuestionSettled` and `QuestionVoided`; the `Clients`, `Questions` and `Reports` contract storage; and the `svc.*`/client-registry metadata constants. The additive runtime-API method also bumps the `sp_api` version. `INTEGRATION_CONTRACT_VERSION` is **21**; `transaction_version` remains independent. No authored §4a shape changed while implementing it. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-01, through the standing autonomous-resolution delegation.**
- **v20 (2026-08-01) — external market books (D-20, N6). Superseded by v21.** N6 changes the schema a metadata/direct-storage consumer can already observe, so leaving the constant at 19 until the rest of Track N would violate rule 2. Additively: (i) `MarketBook.kind` gains the trailing `External { question, client, branch }` variant and `Markets` gains independently bounded 196-live/2,240-retained primary and 128-live/128-retained external partitions, with `MaxAllStoredMarkets = 2,368`; (ii) the trailing `ExternalRevenueSwept { market, fee_to_main, subsidy_returned }` event distinguishes treasury-owned service fees from exact-funder subsidy return; (iii) §7.1 makes explicit that the existing conditional-ledger keys name instance `()`, while the service `Instance1` prefix is not canonical-frontend ingest; and (iv) §9 adds `MaxLiveExternalMarkets`, `MaxStoredExternalMarkets` and `MaxAllStoredMarkets`. The release runtime binds external creation fail-closed until N7 supplies the service authority/ledger, but the v20 SCALE/storage/metadata surface itself is present. No existing field, key, discriminant or call index moves; no runtime-API method or dispatchable is added; `transaction_version` is untouched. The additive storage and value-shape revisions are pre-genesis, so no deployed state requires migration. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-08-01, through the standing autonomous-resolution delegation.**
- **v19 (2026-08-01) — a reporter default settles neutral, and the §3 ladder survives exit (oracle security PR). Superseded by v20.** *Renumbered from v18 on rebase: E6 (#201) merged onto that number first, and §13 entries are allocated in **merge order, not authoring order** — the number a not-yet-merged branch reserves is provisional until it lands.* Two §7.2 **behaviour** changes, no shape change; listed as a contract change under the v15 precedent, because a frontend reading these maps directly observes something the old notes did not describe. (i) `ComponentValues` no longer produces `SettlePath::ChallengerDefault`. [07](07-oracle-and-disputes.md) §5.3's forward settlement let one economic party occupy both roles — this document freezes no distinctness and 07 §4's "entity registry per 05" does not exist — and terminate a game at round 1 risking `B_1` against a `Δs_max` that 07 §6.3 sized against the full `(2^R_max − 1)·B_1` ladder; against §6.3's own worked example the attacker's net moved from the intended −90,000 to +102,000, at 8.6 % of the required ladder. The repair is on the value side because §5.3's own closing sentences forbid debiting an unfunded stack. The variant is **retained**, so no discriminant moves and `SettlePath`'s SCALE encoding is byte-identical. (ii) `Reporters` gains a retention/continuity rule: the 07 §3 offense record survives `deregister_reporter` and ejection in a pallet-internal, non-§7 store, re-registration carries it forward and re-seats at the 07 §2(5) half stake past the second offense, and an ejected account is refused. Neither the `ReporterInfo` nor the `SettledComponent` value shape changes; the new store is an **additive internal storage item** and is not contract surface (§7's own rule, and the v17 precedent). No event name or field shape moves — the one new pallet event (`ReporterRecordsFull`) fails §6's criteria (a)–(c) and is an off-contract operational diagnostic. Two trailing pallet error variants only (the v8 precedent). No call index moves and no dispatchable is added, so per §13 rule 7 `transaction_version` is untouched. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-31, through the standing autonomous-resolution delegation.**

- **v18 (2026-07-31) — the proposal author/funder split (E6). Superseded by v19.** Implemented and bumped 2026-07-31 together with the surface: `Proposal` and `ProposalSummaryView` carry the trailing `funder` and `INTEGRATION_CONTRACT_VERSION` reads **18**, so a client selecting a schema from chain metadata selects v18 and is correct to. The entry was authored not-in-force one commit earlier, on the v17 precedent recorded below — freezing this document at a version the runtime does not declare makes the metadata constant useless as a schema selector — and flipped here, in the commit that moves the constant. **What changes.** `epoch.submit` no longer requires the submit signer to be the proposal's proposer. The **signer is the funder** — the class bond is held on the signer, so the split cannot be used to force an account into a hold it did not authorize — while `Proposal.proposer` remains the **author**. §4's `ProposalSummaryView` gains a **trailing** `funder: AccountId`; the `Proposal` record it projects (single-homed in `futarchy-primitives`, named by §7's `Proposals` row) gains the same trailing field. No existing field's name, type or offset moves, so both are §13 rule-3 appends, and a consumer that ignores the new field reads exactly what it read at v17. **What does not change.** No storage key, no `FutarchyApi` method, no event shape, and no call index — `submit`'s signature is unchanged because the funder is the origin, not an argument — so per §13 rule 7 `transaction_version` is untouched. Where `funder` is absent from a consumer's model it equals `proposer`, which is the only state reachable before this version. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply. **Incidence, which a client rendering either identity must get right:** the [08](08-treasury-and-economics.md) §1.1 proposer reward pays the **author**; the [06](06-governance-and-guardians.md) §4 bond refund and its 10 % non-decision-grade slash fall on the **funder**; pre-qualification `epoch.withdraw` is admitted for **either**; `epoch.bind_ratification` remains **author-only** ([09](09-execution-upgrades-and-rollout.md) §1.1(4)). The [06](06-governance-and-guardians.md) §4 rule-4 per-account intake cap counts the **funder**. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-31, through the standing autonomous-resolution delegation.**

- **v17 (2026-07-29) — protocol revenue routing and the redemption fee (E1–E4). Superseded by v18.** Implemented and bumped 2026-07-29 with E2/E3/E4: both halves of the surface exist (`market.sweep_revenue` + `RevenueSwept`; `conditional_ledger.sweep_redemption_fees` + `RedemptionFeesSwept` and the four trailing `fee` fields), so the constant and its pinning assertion moved together as this entry required. **Storage shape (corrected by review, 2026-07-29).** This surface cannot be delivered with *no* storage change and must not claim to be: `sweep_redemption_fees` requires the persisted `RedemptionFeesAccrued` counter of [03](03-conditional-ledger.md) §5.3a(4)/L-7, and `sweep_revenue` requires the durable swept marker that [04](04-markets-and-pricing.md) §2 uses to make the crank idempotent and to gate reap. Both are **additive internal storage items**, neither is a §7 contract-surface key. One **existing** internal value shape does change and must be named rather than glossed (corrected again 2026-07-29, on review of the implementation): `Market::SeededMarkets` widens its value `()` → `AccountId`, so the 04 §2 Sweep can return custody to the account that actually funded the book instead of one the caller names. It is an internal (non-§7) key, so §13 rule 3 — which constrains the **frozen contract surface** — is not breached; and it ships without a migration because this is a **pre-genesis** revision, the same clause applied to v15 and v16. Once a runtime is deployed, a further change to this value shape needs a real migration. Stating it as "no storage item" imposed an impossible shape constraint on implementation and release work. The surface below is now implemented; `INTEGRATION_CONTRACT_VERSION` is **17**, so a client reading chain metadata selects the v17 schema and is correct to. **The bump is atomic with the surface.** Corrected 2026-07-29 when the bump was performed: the bump's blast radius was mis-stated twice and is now fixed at the root. It originally said **two** sites; the real count was **six**, and each extra one surfaced only when a bump turned it red — the fifth and sixth from the *exhaustive* gate, after the runtime suite was already green. Two of them were literals left stale through three bumps, one inside a test still named `contract_version_is_v13` while asserting 16. **The remedy is structural, not a longer list:** exactly **one** literal now exists — the constant in `crates/futarchy-primitives/src/lib.rs` and the unit test beside it that pins it — and every other site asserts *agreement* with that constant rather than repeating the number. A drive-by pin in an unrelated genesis-shape test was deleted outright rather than relaxed, since incidental coverage is precisely what goes stale. A future bump therefore moves one place; it now asserts against the constant rather than a literal, so exactly one site pins the number and the others prove agreement. Freezing the document at 17 while the runtime declared 16 would have made the metadata version useless as a schema selector, which is why this entry was marked not-in-force until the code landed rather than the constant being pre-bumped (raised by review on PR #195); both moved together on 2026-07-29. Four changes, one mechanism: the protocol had two revenue instruments specified and no contract surface that collected either. (i) **Fee routing.** Realized market-fee value routes **100 % to the treasury `MAIN` account**; the 50 % `INSURANCE` / 50 % POL-offset split is superseded ([08](08-treasury-and-economics.md) §1.1, [04](04-markets-and-pricing.md) §6.1). This contract never carried the split, but it must carry what realizes the replacement: §5 gains **`RevenueSwept { market, fee_to_main, pol_returned }`**, emitted by the new permissionless Signed keeper crank `market.sweep_revenue(market)`, which in the same atomic effect returns the book's surviving subsidy inventory to `POL`/`POL_BASELINE` ([08](08-treasury-and-economics.md) §8 step 5) and is a precondition of `market.reap` ([04](04-markets-and-pricing.md) §2). Collection is automatic and permissionless by construction: an instrument whose collection consumes a proposal slot is not a revenue instrument, which is exactly what the superseded routing made it. (ii) **The redemption fee.** [03](03-conditional-ledger.md) §5.3a charges `ledger.redeem_fee` on the settlement-payout redemptions, so §6's `ScalarRedeemed`, `ScalarPairRedeemed`, `GateRedeemed` and `BaselineRedeemed` each gain a **trailing** `fee: Balance`; each event's pre-existing `amount`/`payout` field keeps its exact meaning (the gross claim value), so no offset moves and the append satisfies §13 rule 3. `Redeemed` and `VoidRedeemed` do **not** gain it — §5.3a exempts the par leg (G-3) and the VOID path outright. §6 also gains **`RedemptionFeesSwept { amount: Balance }`**, emitted by the second permissionless Signed keeper crank `conditional_ledger.sweep_redemption_fees()`; redemption liveness deliberately does not depend on that treasury credit (G-1). (iii) **Metadata and binding.** §9 exposes `ConditionalLedger::RedemptionFee`, the basis-points projection of the live `Params[ledger.redeem_fee]` `Perbill` (floored division by 100,000; launch 30), mirroring `Market::Fee` exactly, and §9's parameter-binding table binds it beside `mkt.fee` — the two are coupled `ledger.redeem_fee ≤ mkt.fee` by [08](08-treasury-and-economics.md) §10.6, and a frontend that displays a net redemption payout computes it from chain-read values or not at all (§13 rule 4). (iv) **What does not change.** No **existing** SCALE type, storage shape, key, view type or `FutarchyApi` method changes — the two additive internal items above are new storage and are stated as such; `QuoteView` is untouched because the redemption fee is not a trade quote. The two keeper cranks are trailing dispatchables that move no existing call index, so per §13 rule 7 `transaction_version` is untouched. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-29, through the standing autonomous-resolution delegation.**
- **v16 (2026-07-27) — the retained snapshot bound carries its version multiplicity.** §9's `MaxSnapshots` moves **20 → 60**. `Snapshots` is keyed `(epoch, spec_version)` and capacity is enforced against the *record* count, while [13](13-parameters.md) §4 states the bound in **epochs** ("≤ 20 epochs") and [05](05-welfare-and-decision-engine.md) §4.6's prune cutoff evicts by epoch age. At a flat 20 those two rules disagreed by exactly the factor [05](05-welfare-and-decision-engine.md) §3.3 says every derived `× 2` rests on — `epoch.horizon_k ≤ 2` concurrent frozen MetricSpec versions (SQ-496) — so an activation boundary produced more lawful records than slots, and a signed caller could spend the epoch's single spare slot before the deadline-advancing record was written: `SnapshotDeadline` then stopped advancing, the §4.8 dead-man latched, and the frozen epoch clock froze the prune cutoff that would have released the slot, with no origin able to clear the flag (SQ-254). The multiplier is `k + 1` and not `k`: `record_snapshot`'s admissible set is the epoch's frozen versions **∪ its own active version**, and the latter need not be a member of the former — the cohorts measuring epoch `e` were created at `e − 1` and `e − 2`, so a version activating at `e` itself is a lawful third, reachable through two ordinary `register_spec` calls activating in consecutive epochs. The active-version record cannot be dropped from the union instead, because it is the only one that advances `SnapshotDeadline`. The retained **epoch** window is unchanged at 20, so `MaxGateFlags` (epoch-keyed) and the 21-epoch shared prefix index of [13](13-parameters.md) §4 keep their values; only the record bound moves. No SCALE type, key, event, call or view shape changes — a metadata constant's *value* changes, which §13 requires be versioned because the frontend reads it. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply, and `transaction_version` is untouched (§13 rule 7). Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-27, through the standing autonomous-resolution delegation.**
- **v15 (2026-07-25) — bounded oracle retention and settled-value reaping (SQ-492).** Two changes, both in §7.2, both consequences of the same defect: [07](07-oracle-and-disputes.md) §11(1) and §13 each name a reaper that no code drove. (i) A new **trailing** event `RetentionExpired { component, epoch, round, reporter_bond, challenger_bond }`, emitted when §11(1)'s retention window closes with no terminal verdict — the stacks are refunded to their posters rather than forfeited, because the values track's failure to rule is not a finding against either party. Appended last; no existing variant's SCALE discriminant moves. (ii) `ComponentValues`' retention **rule** changes: entries are reaped on an epoch cutoff (`current − 3` measurement epochs, bounded per crank) rather than "at cohort settlement". This is a correction of the note rather than of behaviour, because there *was* no behaviour: `settle_cohort` reads the welfare snapshot, never this map (§11's own SQ-182 resolution establishes it), so the stated trigger named a caller that could not have fired — and the map grew to `MAX_COMPONENT_VALUES`, after which every further settlement fails. It is listed as a contract change and not a silent fix because a frontend reading `ComponentValues` directly can now observe an entry disappear on a schedule the old note did not describe. No SCALE type, key or view-type shape changes. **Pre-genesis revision** — no runtime is deployed, so §13's point-3 migration clause does not apply, and `transaction_version` is untouched (§13 rule 7). Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-25, through the standing autonomous-resolution delegation.**

- **v14 (2026-07-25) — the versioned MetricSpec surface (SQ-175, SQ-341, SQ-141).** Three changes, all **additive**, landing together because none is independently verifiable. (i) `MetricSpec` (read by the frontend through §7.4's `pallet-welfare::MetricSpecs`) gains two **trailing** fields: `target: u32`, the A-pillar milestone divisor of [05](05-welfare-and-decision-engine.md) §4.3's `min(1, points ÷ target)` — previously specified with no home in any struct, so the MilestoneRegistry could not normalize a filing (SQ-175); and `delta_s_max_bps: u32`, the documented maximum single-epoch settlement impact `Δs_max` that [07](07-oracle-and-disputes.md) §6.3's bond-coverage admission rule is stated against — previously unrepresentable, so the rule that makes an attested lie cost more than it can move was unimplementable regardless of where it was called (SQ-341). Both are appended after `prior_bounds`; every existing field keeps its name, type and offset. (ii) §6's `RegistryEpochClosed` gains `spec_version: MetricSpecVersion`, because 07 §7's registry lifecycle is now keyed by `(epoch, spec_version)` — one epoch closes once per frozen version (SQ-141). The other ten registry event shapes, including the `(epoch, filing_id)` key every filing event carries, are untouched: filing-id allocation stays per-epoch precisely so they can be. (iii) No storage **key** in §7 changes: 07 §7's `Aggregates` re-key is a registry-internal item this contract does not freeze. **Pre-genesis revision** — no runtime is deployed, so §13's post-genesis append-only/migration clause (point 3) does not apply, and `transaction_version` is untouched (§13 rule 7). Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-25, through the standing autonomous-resolution delegation.**

- **v13 (2026-07-25) — TREASURY bond Ask-surcharge slope as metadata (SQ-186).** §9 exposes `Epoch::TreasuryBondAskBps`, the kernel `TREASURY_BOND_ASK_BPS = 50` slope of 08 §7's TREASURY intake bond. Purely **additive**: a new name on §9's frozen metadata-constant list, no existing name, type, shape or value changed, so `transaction_version` is untouched (§13 rule 7). It closes the last half of SQ-186 — 13 §1 already states the surcharge is a kernel constant governing the class **base only**, but the frontend had no way to read the slope and would have had to hardcode it. Joint backend+frontend sign-off recorded per §13(2), the user owning both sides.
- **v12 (2026-07-24) — registry archive-delay floor (SQ-76).** Section 9 exposes the registry instances' `ArchiveDelay` metadata constant, and its value is frozen as `max(Params[ledger.archive], 21 × BLOCKS_PER_DAY)`. This preserves the 07 §7 money-deadline floor independently even if the shared ledger archive policy is lowered. Pre-genesis, no migration is required. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-24, through the standing autonomous-resolution delegation.**

- **v11 (2026-07-23) — signed oracle escalation custody (A12).** Section 7.2 adds the explicit `ChallengerDefault` `SettlePath` variant for the §5.3 deadline outcome. The oracle's signed `counter_report` advances a challenged round only with reporter consent; challenger identity and cumulative bond liabilities persist across rounds, and d20 neutralization retains the bounded round record until bond/reputation resolution. This is a pre-genesis additive revision; no migration is required. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-23, through the standing autonomous-resolution delegation.**
- **v10 (2026-07-23) — cause-aware attestor departure and durable revocation (B19).** Section 6 appends the two attestor lifecycle events; §7.5 adds bounded `Liabilities` and `Revocations` auxiliary values while retaining the original `Attestation` shape; §8 exposes `remove_for_cause` (ConstitutionalValues), permissionless `reap_attestation`, the new storage projections and custody events. Queue-time admission continues to require the live ≥3 roster; after a record is committed, execution uses record quorum and durable revocation state. `set_members` holds the live `att.bond` from every newly seated account and carries unsettled bases into `Liabilities`; challenge bonds are held and slash proceeds route to INSURANCE. This is a pre-genesis additive revision; no migration is required. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-23, through the standing autonomous-resolution delegation.**
- **v9 (2026-07-23) — paired-recovery descriptor coverage (B16).** Section 11 extends the runtime-Wasm/metadata artifact row to the exact paired terminal-recovery runtime because that image becomes the live next `spec_version` after recovery. Backend release assembly MUST publish both metadata blobs and frontend descriptor generation/drift CI MUST cover both before the primary is eligible; recovery is no longer an operator-only metadata input. Recovery-only guard calls, internal storage and diagnostics remain outside the canonical frontend ingest set. No SCALE shape, runtime API, storage key, transaction validity or SDK transaction-version change is introduced. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-23, through the explicit B16 repair request and standing autonomous-resolution delegation.**
- **v8 (2026-07-22) — active/retained market-capacity split and bounded reap isolation (SQ-483).** Section 7.4 separates the live/POL obligation envelope (`MaxLiveMarkets = 196`) from total readable book retention (`MaxStoredMarkets = 2,240`), and §9 adds the latter as an additive metadata constant. The retained bound is derived from the independent one-epoch creation maximum, the 14-day epoch floor, the one-year K ceiling on `ledger.archive`, and one boundary batch; terminal observation releases the live/POL slot and deletes auxiliary history while leaving the book readable until archive reap. Market reap is independent of the unbounded claimant-position backlog: at the delay boundary it atomically discards only its book/fee accounts across a fixed 28-cell proposal or four-cell Baseline universe before unregistering them, while ledger claimant cleanup may run before or after. To make that fixed inventory exhaustive, the existing `ledger.transfer` call now rejects every protocol-account recipient; only the `MarketAuthority` internal path may move inventory into protocol custody. Canonical book/fee addresses occupy a domain-separated `AccountId32` namespace classified as protocol custody before creation and after reap; `MarketProtocolAccounts` is ownership/refcount state only, and creation rejects a non-canonical pair before mutation. This is a pre-genesis validity correction: no deployed signed transaction was valid under the prior rule, so `transaction_version` remains at its initial value. The pallet error metadata gains only trailing `ProtocolDestination` / `UnreservedProtocolAccount` variants; no frozen event, API method, view type or storage-key shape changes. `ActiveMarketCount` is a new internal pre-genesis counter and no deployed state exists to migrate. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-22, under the standing autonomous-resolution delegation.**
- **v7 (2026-07-22) — Baseline discovery retention and orphan-settlement liveness (SQ-66/SQ-320).** Section 7.4 replaces the stale ring-coupled `BaselineMarketOf` retention rule with the runtime's market-lifetime rule: the mapping remains present while its referenced Baseline book exists and is removed atomically only with successful book reap. This keeps strictly-past orphan epochs discoverable until their permissionless neutral settlement can write the market-side terminal latch, and it freezes the honest shared structural bound (`MaxLiveMarkets = 196`) instead of the unenforced ≤36 claim. No SCALE type, event, API method, storage key or transaction validity changes; this is a pre-genesis semantic correction to a frozen direct-read item, so no storage migration is required and `transaction_version` remains unchanged. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-22, under the standing autonomous-resolution delegation.**
- **v6 (2026-07-21) — batch C, the contract-reconciliation revision.** Section 6 defines the exhaustive canonical-frontend ingest set (without claiming to exhaust pallet-local events) and adds the shipped epoch, execution-guard, guardian, registry and attestor event shapes. Section 2 appends branch-free `VaultState::BaselineSettled` and restructures `RatificationStatus` to `NotRequired` / `NoPassedRecord` / `Passed`; §§3–4 freeze the const-generic `futarchy_primitives::BoundedVec` API path, append the exact `ParamView` interval, `QuoteView.evaluable` and `WelfareView.active_spec_available`, and define `ParamView` raw units, `OracleRoundView.escalated` and finalized `decision_stats()` availability. Section 7 corrects `Markets` to `MarketBook<AccountId>`, adds `CumulativeDeposits`, and excludes unlisted raw storage from the contract. Section 9 adds the Phase-3 deposit-cap binding, removes the implementation-status column and completes the freeze with the 16 Welfare/FutarchyTreasury/Guardian/Attestor constants. Section 12 assigns exclusive guard ownership of the pending-upgrade bytes, requires merge-preserving `set_release_channel`, freezes current-not-target `spec_version` semantics and adds I-30; §13 declares the contract and transaction-version counters independent. **Pre-genesis revision** — no runtime is deployed, so no migration is required and §13's post-genesis append-only/migration clause (point 3) does not apply; the `RatificationStatus` restructure is taken under that allowance, as v3 and v4 took theirs. Joint backend+frontend sign-off: **the user (owner for both sides under R-1), 2026-07-21, user-delegated batch.**
- **v5 (2026-07-19) — universal market-bearing-class gate markets.** Section 4's class-floor semantics change so every market-bearing proposal carries the existing four-book `(S,C)×(adopt,reject)` gate set: Treasury loses its former ask/NAV threshold and uses **7,393,600 USDC**; PARAM loses its former static-classification exception and its existing `NavView.class_floors` slot rises to **≈4,620,989 USDC**. The frozen `MarketSet.gates: Option<[MarketId; 4]>`, `ProposalSummaryView.gate_markets`, `DecisionStatsView.gate_twaps_1e9`, `NavView.class_floors: [Balance; 4]`, and `MaxLiveMarkets = 196` shapes are unchanged. The PARAM extension is folded into the same pre-genesis v5 revision; no v6 is warranted because no separately deployed contract or SCALE shape intervened. **Pre-genesis revision** — no runtime is deployed, so no migration is required and §13's post-genesis append-only/migration clause (point 3) does not apply. Joint backend+frontend sign-off: the user (owner for both sides under R-1), 2026-07-19.
- **v4 (2026-07-17) — B2 02-amendment batch.** One pre-genesis revision carries the queued SQ-2 residuals — SQ-23's intake representation erratum, SQ-24's phase-fraction representation split, and SQ-26's attestor storage freeze in §7.5 — together with SQ-37's §6 conditional-ledger event completion, SQ-43's 12-entry `CohortSummary.proposals` hard-max bound, SQ-55's three trailing `NavView` fields, SQ-125's phase-fraction metadata-exposure mandate, and SQ-138's frozen metadata-constant names, restricted to genuine kernel values per [13](13-parameters.md) reading rule 7; META-amendable registry bounds bind through `params()`. The batch also lands the storage change the B2 implementation needs to make §4's `ParamView.last_change: BlockNumber` faithful: §7.3's `ParamRecord` gains `last_change_block`, because the record previously stored only `last_changed_epoch` and a block number cannot be reconstructed from an epoch index (historical epoch boundaries are not retained). **Pre-genesis revision** — no runtime is deployed, so §13's post-genesis append-only/migration clause (point 3) does not apply. Joint backend+frontend sign-off: the user (owner for both sides under R-1), 2026-07-17, user-delegated batch.
- **v3 (2026-07-15) — oracle per-version reconciliation (A5).** 07 §2(4) runs one reporting game per `(component, epoch, frozen spec_version)`, so §7.2 `Rounds`/`ComponentValues` take the **triple key** `(MetricId, EpochId, MetricSpecVersion)`. Contract v2's pair key was self-contradictory — its own bound note said per-version games "append a `RoundState` per frozen version," which a one-value-per-key map cannot do; the triple resolves it. `RoundState` additionally carries the ack-keying/bond-freezing/§5.5-slashing fields the protocol requires, `ReserveHealth` its probe-timing fields, and `OracleRoundView` (§4) gains `spec_version`. **Pre-genesis revision** — no runtime is deployed, so §13's post-genesis append-only/migration clause (point 3) does not apply; the change is a straight restructure. Joint backend+frontend sign-off: the user (owner for both sides under R-1), 2026-07-15.
- **v2** — the frozen baseline established at D-2 (all FE §30 patch items applied).

---

## Resolves

| Finding | Resolution in this document |
|---|---|
| X-1a | §3–§4a: the complete 16-method `FutarchyApi` with every view type fully defined in `futarchy-primitives`; light-client-callable; P-5/P-7 and D-20 applied and completed |
| X-1b | §5: `Traded { market, side, amount, cost, p_after }` and `Observed { market, o_t }` with an explicit Events table for `pallet-market` |
| X-1c | §7.1: `RecentCohortSummaries` ring (last **32** cohorts) added to `pallet-epoch` storage — the §5.2.3 storage-list edit P-5 missed — with push point, eviction and weight argument |
| X-10 | §7.4: `BaselineMarketOf: map EpochId → MarketId` declared (in `pallet-market`, per [04 §8.3](04-markets-and-pricing.md)) as the backing storage for Baseline-market discovery, with write point and pruning rule |
| X-11a | §7.4/§8: USDC is `ForeignAssets` keyed by the pinned XCM Location; `ChainIdentity` pins the USDC identifier; `Assets.Account(1337, …)` reads are wrong by contract |
| X-11b | §8: ss58 7777, paraId (fixtures 4242), VIT ED 0.01, `PhaseFlags` storage location all specified |
| X-11c | §7.2: oracle pallet storage-item names and full event set defined canonically; [07](07-oracle-and-disputes.md) uses these names |
| X-11d | §6: four FE §15.3 epoch event names corrected to `ProposalWithdrawn`/`ProposalCancelled`/`ProposalQualified`/`ProposalDeferred`; full canonical set frozen |
| X-11f | §6: T20 now emits `ProposalForceRejected { pid, reason }`; the ledger emits `VaultVoided`/`VoidRedeemed` — no silent terminal transitions remain |
| X-11g | §2: canonical `DecisionOutcome` enum defined (FE's `DecisionOutcomeCode` renamed away); `DispatchOutcomeCode` defined for `ExecutionRecord` |
| X-11h | §9/§13: every FE-re-checked constant enumerated with its chain-side representation; FE binds to constants API/`params()`; no-hardcode rule CI-enforced |
| X-15 | §11: per-release runtime wasm + metadata, Chopsticks/Zombienet environments and chainHead fixtures published as release-gating backend artifacts (WBS E15 mirrors FE-R1) |
| F-4 | Header + §13: contract frozen, jointly owned, version-stamped, change-controlled; contingency is the D-6 layer-1 fallback, not a third-party dependency |
