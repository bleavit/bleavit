# Decision Record — Resolution of DESIGN_REVIEW.md v2.0

**Status: normative.** This document resolves every decision point and finding in `DESIGN_REVIEW.md` (v2.0, 2026-07-12). The component documents `01`–`15` in this directory implement these decisions and together supersede `BACKEND_PLAN.md` and `FRONTEND_PLAN.md` as the authoritative architecture. Decisions were made optimizing for the best end-user experience within the protocol's safety guarantees. Normative language: RFC 2119.

Conventions: **D-n** = a decision made here. Finding IDs (X-n, B-n, F-n) refer to DESIGN_REVIEW.md v2.0. Each component document ends with a "Resolves" table listing the finding IDs it implements.

---

## Part 1 — Major decisions

### D-1. VOID redemption: merge-at-par + half-value unpaired redemption (B-1, X-6)

- New `VaultState::Voided` variant, entered by `void(pid)` (ResolveAuthority), emitting `VaultVoided`.
- Under `Voided`: `merge` and `merge_scalar` remain enabled — an **Accept+Reject branch-USDC pair** recovers par (100 %) via `merge`. `merge_scalar`/`merge_gate` pay no USDC; they climb a same-branch set to one same-branch branch-USDC, which is worth 0.5 under VOID until paired across branches.
- New call `redeem_void(pid, kind, amount)`: unpaired **branch-USDC pays `floor(a/2)`**; unpaired **LONG or SHORT pays `floor(a/4)`** (equivalent to branch value 0.5 × neutral s = 0.5). Rounding is against the redeemer; residue swept per the dust rule.
- Conservation: total payout ≤ E in every path (pairs pay 1 per pair; each pair = 1 USDC escrowed).
- PT-2 (annulment) restated honestly (SQ-171): *holders complete through **both** ledger layers — Accept **and** Reject branch-USDC — recover par under VOID via `merge`.* Same-branch completeness alone does not: `merge_scalar`/`merge_gate` pay no USDC, they mint one same-branch branch-USDC, worth 0.5 under VOID. A D-3 wrapper buyer's package — the purchased target scalar leg plus `cost` mirror branch-USDC — recovers its **D-1 neutral value** after pair-first netting; net delta is `neutral recovery − cost − fees`, not `−fees`, and it reaches `−fees` only when the *realized average execution price* is 0.5. That is a property of the executed trade, not of the pre-trade quote: LMSR charges the integral of a rising curve, so a buy opening at a quote of 0.5 still executes above it on average. A deliberately unpaired single-branch holder receives the same neutral valuation (0.5 per branch-USDC, 0.25 per leg). This is the correct price of a voided binary claim, not a loss of principal — but the superseded wording *"market buyers recover full principal under VOID"* over-claimed. What D-1 guarantees is that no claim is valued **below** this schedule, not that a premium is refunded.
- Frontend: redeem screen gains a VOID state — leads with `merge` when the user holds cross-branch pairs (the only 100 % path), `redeem_void` otherwise, and always shows the recovery the user's actual holdings reach. FE precondition table row added.

### D-2. Integration contract: all 11 §30 patch items ACCEPTED; frozen in one owned document (X-1, X-4, X-10, X-11, X-15)

- FE §30 P-1…P-11 are **all accepted** and applied, plus the gaps P-5 missed (the §5.2.3 storage-list edit, `DecisionOutcomeCode` → the canonical type is **`DecisionOutcome`**, FE renames).
- The contract is frozen in **`02-integration-contract.md`**, jointly owned by both teams; changes require sign-off from both. It contains: the `FutarchyApi` runtime API with view types in `futarchy-primitives` (twelve methods as decided here; **sixteen at contract v30** — 02 §13's version history is the authority for the count, and the entries below stop at v17 by design rather than by omission, since an additive bump changes nothing this decision states); `Traded{market, who, side, amount, cost, p_after}` / `Observed{market, o_t}` events (pallet-market gets an Events column); `RecentCohortSummaries` ring (last **32** cohorts) in `pallet-epoch` storage; `BaselineMarketOf: map EpochIndex → MarketId`; oracle pallet storage-item and event names; a `Voided`/T20 event; chain-identity constants (D-17); the WSS bootnode requirement (D-6); and the backend-published test-artifact feed (per-release runtime wasm + metadata, Chopsticks/Zombienet environments, chainHead fixtures).
- **Indexer role**: the FE P-4 position wins — canonical history is **event-derived and chain-served within the committed window**; the indexer is an optional convenience for dashboards, never load-bearing for the canonical frontend. BE §5.2.6 "pruned to indexer" language is replaced accordingly.
- All kernel constants the FE re-checks (`MinSplit`, per-trade min/max, position bound, §21-tunables) are exposed via the runtime **constants API** (metadata) — readable without storage, no hardcoding in the FE.
- Backend WBS gains row **E15** mirroring FE-R1 (contract implementation), release-gating for the backend exactly as FE-12 is for the frontend.
- **Contract v3 (2026-07-15, A5):** the oracle storage surface (§7.2 `Rounds`/`ComponentValues`) moved to the per-version **triple key** `(MetricId, EpochId, MetricSpecVersion)` and `INTEGRATION_CONTRACT_VERSION` bumped 2 → 3 — a **pre-genesis** R-1 correction of a contradiction internal to contract v2 (its pair key could not hold the concurrent per-version games 07 §2(4) requires). Jointly signed off by the user (owner for both sides). Detail in 02 §13 version history + PLAN.md Decision log.
- **Contract v4 (2026-07-17, B2 amendment batch):** the queued intake/phase-representation and attestor-storage reconciliations, conditional-ledger event completion, 12-entry cohort fallback bound, three trailing NAV fields, phase-fraction exposure mandate and frozen metadata-constant names landed together; `INTEGRATION_CONTRACT_VERSION` bumped 3 → 4. This is a **pre-genesis** revision, jointly signed off by the user (owner for both sides under R-1, user-delegated batch). Detail in 02 §13 version history.
- **Contract v5 (2026-07-19, G0 universal market-bearing-class gating):** §4's class-floor semantics use gate-bearing floors for **every** PARAM, TREASURY, CODE, and META proposal; `INTEGRATION_CONTRACT_VERSION` remains 5 after the PARAM extension was folded into the same pre-genesis revision. No SCALE shape changed: the existing optional four-ID gate array and four-slot class-floor array already represent the result. This is a **pre-genesis** revision with no migration, jointly signed off by the user (owner for both backend and frontend sides under R-1). Detail in 02 §13 version history.
- **Contract v6 (2026-07-21, batch C contract reconciliation):** the contract's frontend-ingested event boundary and the epoch/guard/guardian/registry/attestor event set were made exhaustive; the Baseline vault and ratification projections were corrected; parameter, quote and welfare views gained the exact missing availability/range fields and their ambiguous semantics were fixed; storage/constants inventory and `ReleaseChannel` writer ownership were reconciled to the shipped runtime; and the integration-contract and SDK transaction-version counters were made explicitly independent. `INTEGRATION_CONTRACT_VERSION` bumped 5 → 6. This is a **pre-genesis** revision — no runtime is deployed, so no migration is required and the post-genesis append-only clause does not apply; the `RatificationStatus` restructure is taken under that allowance. Jointly signed off by the user (owner for both backend and frontend sides under R-1, user-delegated batch). Detail in 02 §13 version history.
- **Contract v7 (2026-07-22, SQ-66/SQ-320):** `BaselineMarketOf` retention now follows the referenced Baseline book's lifetime and is removed atomically only with successful reap, preserving discovery until orphan settlement can write the terminal latch. The map shares the 196-market aggregate rather than carrying the stale cohort-ring/≤36 bound; the separate unenforced four-Baseline claim is retired across the specification. `INTEGRATION_CONTRACT_VERSION` bumped 6 → 7; no SCALE shape or transaction-validity rule changed. Pre-genesis, no migration required. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history and PLAN.md Decision log.
- **Contract v8 (2026-07-22, SQ-483):** market capacity now separates the 196-book active/POL envelope from a 2,240-row retained-book envelope derived from the one-year K-bounded archive maximum and worst independent creation cadence. First terminal observation releases active/POL capacity and auxiliary history; readable books remain until archive reap, which discards only the book's bounded protocol inventory and is independent of claimant-vault cleanup. `INTEGRATION_CONTRACT_VERSION` bumped 7 → 8; the additive metadata constant and new internal active counter require no pre-genesis migration, and transaction validity is unchanged. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history and PLAN.md Decision log.
- **Contract v9 (2026-07-23, B16):** every primary runtime's exact paired terminal-recovery metadata is now a frontend descriptor input because recovery becomes the live next `spec_version` when used. Publication and descriptor drift CI cover both live-capable images before eligibility; recovery-only calls/internal state remain outside frontend ingest. `INTEGRATION_CONTRACT_VERSION` bumped 8 → 9 with no SCALE, API, storage-key or transaction-version change. Jointly signed off by the user (owner for both sides under R-1, explicit B16 repair request and standing autonomous-resolution delegation). Detail in 02 §13 version history.

- **Contract v10 (2026-07-23, B19):** cause-aware attestor departure, bounded retained liabilities and durable revocation projections were added to the frontend-readable attestor surface. `INTEGRATION_CONTRACT_VERSION` bumped 9 → 10; pre-genesis, no migration required. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history.
- **Contract v11 (2026-07-23, A12):** the oracle `SettledComponent.path` enum gains `ChallengerDefault`, the explicit §5.3 deadline outcome when a reporter does not post a signed `counter_report`. Signed escalation preserves challenger identity and bounded cumulative bond custody across rounds; d20 neutralization retains the bounded round until bond/reputation resolution. `INTEGRATION_CONTRACT_VERSION` bumped 10 → 11; pre-genesis, no migration required. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history. **Superseded by contract v19 (2026-08-01):** the variant is retained for SCALE stability but is no longer produced; a 07 §5.3 default settles `Neutral`/flagged, because a default decides the bonds and not the value.
- **Contract v12 (2026-07-24, SQ-76):** each registry instance now exposes its `ArchiveDelay` metadata constant, bound to `max(Params[ledger.archive], 21 × BLOCKS_PER_DAY)`. The independent 21-day floor keeps closed registry aggregates readable through the §11 money deadline even if the shared ledger archive policy is lowered. `INTEGRATION_CONTRACT_VERSION` bumped 11 → 12; pre-genesis, no migration required. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history.
- **Contract v13 (2026-07-25, SQ-186):** §9 exposes `Epoch::TreasuryBondAskBps`, the kernel `TREASURY_BOND_ASK_BPS = 50` slope of the 08 §7 TREASURY intake bond, so the frontend can read the surcharge rate instead of hardcoding it. `INTEGRATION_CONTRACT_VERSION` bumped 12 → 13; purely additive, pre-genesis, no migration required and `transaction_version` untouched. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). *(Backfilled 2026-07-25 — the v13 revision landed in 02 §13's version history without its entry here; the omission was an R-1 fan-out miss, not a separate decision.)* Detail in 02 §13 version history.
- **Contract v15 (2026-07-25, SQ-492):** bounded oracle retention and settled-value reaping. 07 §11(1) bounds a money-settled round's bond retention by the `OracleResolution` track's own schedule, and §13 says settled component values are reaped — neither had an implementation, so a retained round-`R_max` challenge held its stack and its `MAX_ROUNDS` slot forever, and `ComponentValues` grew until every further settlement failed. 02 §7.2 gains the trailing `RetentionExpired` event and restates `ComponentValues`' retention as an epoch cutoff, correcting a trigger that named a caller (`settle_cohort`) which does not read the map. **Ruled: expiry refunds both stacks, it does not forfeit** — §11(4) prices the griefing move as capital lock-up, and the values track's failure to rule is not a finding against either party (R-7). `INTEGRATION_CONTRACT_VERSION` bumped 14 → 15; additive, pre-genesis, no migration, `transaction_version` untouched. Jointly signed off by the user (owner for both sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history and PLAN.md Decision log.
- **Contract v14 (2026-07-25, SQ-175/SQ-341/SQ-141):** the versioned MetricSpec surface. `MetricSpec` gains two trailing fields — `target` (the A-pillar milestone divisor, which 05 §4.3 specified with no home in any struct) and `delta_s_max_bps` (the `Δs_max` that 07 §6.3's bond-coverage admission rule is stated against, previously unrepresentable) — and `RegistryEpochClosed` gains `spec_version`, because 07 §7's registry lifecycle is now keyed by `(epoch, spec_version)` rather than by epoch alone. `INTEGRATION_CONTRACT_VERSION` bumped 13 → 14; every change is additive, pre-genesis, no migration required and `transaction_version` untouched. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history and PLAN.md Decision log.
- **Contract v16 (2026-07-27, SQ-254/SQ-496):** the retained snapshot bound carries its version multiplicity. §9's `MaxSnapshots` moves **20 → 60**. `Snapshots` is keyed `(epoch, spec_version)` and capacity is enforced against the *record* count, while 13 §4 states the bound in **epochs** — so at a flat 20 the two rules disagreed by exactly the `epoch.horizon_k ≤ 2` concurrent-frozen-version multiplicity, an activation boundary produced more lawful records than slots, and `SnapshotDeadline` could stop advancing with no origin able to clear the resulting dead-man latch. The multiplier is `k + 1` and not `k` because `record_snapshot`'s admissible set is the epoch's frozen versions **∪ its own active version**, and only the active-version record advances the deadline. The retained **epoch** window is unchanged at 20; only the record bound moves, and no SCALE type, key, event, call or view shape changes — a metadata constant's *value* changes, which 02 §13 requires be versioned because the frontend reads it. `INTEGRATION_CONTRACT_VERSION` bumped 15 → 16; pre-genesis, no migration required and `transaction_version` untouched. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). *(Backfilled 2026-07-29 — the v16 revision landed in 02 §13's version history without its entry here; the omission was an R-1 fan-out miss, not a separate decision, and is recorded the same way the v13 entry above was.)* Detail in 02 §13 version history.
- **Contract v17 (2026-07-29, milestone E1):** protocol revenue routing and the redemption fee — the protocol had two revenue instruments specified and no contract surface that collected either. (i) Realized market-fee value routes **100 % to the treasury `MAIN` account**, superseding the 50 % `INSURANCE` / 50 % POL-offset split (08 §1.1, 04 §6.1; the fee-destination ruling of D-12 below is its transaction-fee counterpart). The contract never carried the split but must carry what realizes the replacement: §5 gains **`RevenueSwept { market, fee_to_main, pol_returned }`**, emitted by the new permissionless Signed keeper crank `market.sweep_revenue(market)`, which in the same atomic effect returns the book's surviving POL custody to `POL`/`POL_BASELINE` and is a precondition of `market.reap`. Collection is automatic and permissionless by construction: an instrument whose collection consumes a proposal slot is not a revenue instrument, which is exactly what the superseded routing made it. (ii) 03 §5.3a's new `ledger.redeem_fee` appends a **trailing** `fee: Balance` to exactly four §6 ledger events — `ScalarRedeemed`, `ScalarPairRedeemed`, `GateRedeemed`, `BaselineRedeemed` — each keeping its existing `amount`/`payout` field at its exact prior meaning (the gross claim value), plus **`RedemptionFeesSwept { amount }`** for the second permissionless crank `conditional_ledger.sweep_redemption_fees()`. `Redeemed` and `VoidRedeemed` deliberately do **not** gain it: §5.3a exempts the par leg (D-3, G-3) and the VOID path (D-1) outright. (iii) §9 exposes `ConditionalLedger::RedemptionFee` beside `Market::Fee` under the identical basis-points projection and cross-check, the two coupled `ledger.redeem_fee ≤ mkt.fee` (08 §10.6). (iv) No SCALE type, storage item, key, view type or `FutarchyApi` method changes, and **`NavView` is deliberately untouched** — the fee streams are liquid USDC in `MAIN`, not a new asset class (08 §1.2). The two cranks are trailing dispatchables that move no existing call index, so `transaction_version` is unchanged (02 §13 rule 7). `INTEGRATION_CONTRACT_VERSION` bumped 16 → 17; pre-genesis, no migration required. Jointly signed off by the user (owner for both backend and frontend sides under R-1, standing autonomous-resolution delegation). Detail in 02 §13 version history and PLAN.md Decision log.

### D-3. Trade denomination: branch-USDC books with an auto-split wrapper; buyers keep the mirror (B-7)

- LMSR books are denominated in **branch-USDC**. The user-facing `buy(market, side, amount, max_cost)` accepts **USDC**: the wrapper splits cost `c` USDC into `c` AcceptUsdc + `c` RejectUsdc, pays the target-branch `c` into the book, delivers `q` LONG/SHORT of the target branch, and **credits the mirror-branch `c` branch-USDC to the buyer**. `sell` is the inverse.
- Consequence: on **normal losing-branch annulment** a buyer holds mirror branch-USDC redeemable at par → G-3 holds for the dominant user path, which loses only fees. Under **protocol VOID** the whole buyer package instead receives the D-1 neutral valuation; the difference from its debit is the premium or discount of the *realized average execution price* against the neutral prior, plus fees (SQ-171 — the earlier "VOID recovery (D-1) is par for buyers" conflated the two paths).
- **Revenue recycling**: book revenue (branch-USDC) is immediately `split_scalar` into complete LONG+SHORT sets held by the book — worth exactly 1 branch-USDC per pair at any settlement `s`, so the book is solvent by construction. `headroom = b·ln 2` per book, stated and sized in `04-markets-and-pricing.md`.
- **The par promise is UNCHANGED by the E1 redemption fee, and that scoping is deliberate (normative; added 2026-07-29, milestone E1).** [03](03-conditional-ledger.md) §5.3a charges `ledger.redeem_fee` on **settlement payouts only**, and exempts `redeem` — the winning branch-USDC 1:1 leg, which *is* the mirror credit this decision hands the buyer — together with `redeem_void`, every `merge*` primitive, every `ProtocolAccount`, and any gross payout below `ledger.min_split`. The mirror leg therefore still redeems `cost` at par, "losing only fees" still means **trade fees alone**, and cross-branch complete pairs still recover par under VOID through `merge`. G-3 ([01](01-system-overview.md) §2.1), D-1 above, I-2(b), I-5 and PT-2 are all preserved verbatim rather than weakened. Charging the mirror leg was considered and rejected: it would falsify all five simultaneously and require restating what traders are told, for a factor of about two on an instrument [08](08-treasury-and-economics.md) §10.4 shows is not decisive at any admissible rate. This exemption is a **property of the decision, not an oversight**: any future widening of the charged set into `redeem` or `merge` is a breaking change to D-3 and G-3, not a parameter move.

### D-4. Economic security: decide-time outflow cap (primary) + Ask-scaled liquidity (secondary) (B-8)

- **Primary mechanism**: at decide time, the engine computes `AttackCost̂` from *measured* depth and enforces `InCapPrize ≤ AttackCost̂ / 3` as a new decision-engine step; failing proposals reject with `RejectReason::SecuritySizing`. This scales with the value at stake by construction.
- **Secondary**: `pol.b`, `dec.v_min` and δ scale with the proposal's `ask` (piecewise-linear per class, floors = current defaults). Defaults and the worked recomputation showing `AttackCost ≥ 3·MEV` for the maximum in-cap prize live in `08-treasury-and-economics.md`.
- **Amended 2026-07-18 (SQ-231, Phase-0 simulation finding):** the measured-depth input is **contest capital** — time-weighted marked net open interest (`04` §7a) bounded by the `sec.flow_cap` ceiling — replacing gross window contest notional in both step-5 grading and step-9 sizing. The decision-pair contest term is the conservative **minimum** of the Accept and Reject books (the binding shallower book), as pinned by `08` §5.4's one-`dec.v_min` worked arithmetic; it is never their sum. S4's executed-trade simulation demonstrated the gross measure let attack flow self-certify `AttackCost̂` (TH-4 flips at 0.76–0.90×3P for PARAM/TREASURY); the guarantee itself is unchanged. User-authorized ("mechanism fix first"), same-day; owning text: 04 §7a, 05 §5.2/§5.4/§5.6, 08 §5.2–§5.5.
- **Amended 2026-07-19 (G0 Phase-0 simulation response):** every market-bearing proposal (`PARAM | TREASURY | CODE | META`) carries the existing four-book Survival/Security gate set. The former Treasury ≤1%-NAV and PARAM static-classification exceptions are removed. No gate representation, bound, or parameter changes: the existing `(S,C)×(adopt,reject)` books and `gate.*`/`pol.b_gate` values are reused. PARAM settles on the same system-wide deterministic S/C breach facts; their correlation with delta-specific harm is a hypothesis for the gate-attacking re-calibration, not a claimed closure. User-authorized; owning text: 04 §1/§9, 05 §5, 08 §3–§5.

### D-5. Values-ratification: single execute-time deadline (B-11)

- One deadline: **checked at `execute()` dispatch time**. The ratification referendum is submitted any time after the artifact hash is committed at proposal submission and runs during the market/timelock process.
- Plumbing added: `ratify(proposal_id, referendum_index)` admissible call for the ratify track's `Contains` filter; execution-guard dispatch check; `RejectReason::NotRatified`; a §14.2-equivalent decision-table row; attestation-presence check in the decision pseudocode.

### D-6. Deep history: chain-served recent window + committed operator window + gap-tolerant index (X-3, F-1, F-2, X-4)

Three layers, all truthfully labeled:
1. **Chain-served, light-client-verified**: `RecentCohortSummaries` (32 cohorts) + 8-checkpoint TWAP series per market — every user gets core history with zero infrastructure dependency.
2. **Committed operator window**: protocol-funded bootnode/RPC operators (D-16) commit to serving **30 days** of state/bodies; an honest ops line in the backend topology, wired into phase gates. FE backfill works within this window and is labeled `provider` unless re-read through smoldot within the pinned window.
3. **Local index redesigned gap-tolerant**: explicit holes are first-class; E3's promise is corrected to "gaps are visible and provider-fillable, never silently spliced"; U-3's archive-independence claim is scoped to layer 1.
- **F-2 fix (unconditional)**: RPC-fallback data is **never promoted** to `verified-finalized`. Verified status requires a smoldot re-read; otherwise data stays `provider`-labeled.
- WSS bootnodes: ≥8 browser-reachable WSS across ≥4 operators, ≥2 on port 443 — now a **backend §4.2-equivalent node-roles row and chain-spec requirement**, gated in the rollout phases.

### D-7. `ProposalClass::Emergency` is DELETED (B-batch)

Emergencies are handled by guardian playbooks (which is what the spec already did in practice). The class enum, classifier row and §21 rows are removed. The ADR-3 classifier completeness obligation is now satisfiable.

### D-8. Forecast trading is CUT from v1 (X-5)

Books close at branch resolution; no post-resolution reopening. Removes the un-mintable reopened-book state (the `split_scalar`-requires-`Open` deadlock), removes the FE surface gap, and simplifies the user model. Recorded as deferred work for v2 with the inventory problem stated.

### D-9. Emergency brake: PB-LEDGER-FREEZE + expedited CODE lane (B-17, B-16)

- **PB-LEDGER-FREEZE**: guardian 5-of-7 playbook, admissible only when the I-4 drift flag is set (machine-checked solvency anomaly). Freezes all ledger and market calls (both inflow and outflow). Auto-expires after **14 days**, one renewal only via values referendum; mandatory retro ratification; every activation emits events and costs a review record.
- **Expedited CODE lane**: admissible only while PB-LEDGER-FREEZE is active; 72h gate market + 3-day fast-track values ratification; executes through the normal execution guard (no new privileged origin).
- **Coretime wedge (B-16)**: the enumerated coretime-renewal call (treasury → Coretime chain transfer against a pre-authorized budget line) is **exempt** from the dead-man freeze and keeper-executable during degraded mode; renewal does not consume a recovery epoch.

### D-10. Bounds reconciled (B-batch, X-11h)

- The intake-family bound is **64** and `MaxLiveProposals = 32`; the two bounded storage maps have **disjoint scopes**. The frozen direct-read `IntakeQueue` contains only Submitted IDs, while the internal `IntakeProposals` map retains Submitted/Screening records plus current-epoch Cancelled admission records under the same 64 cap. `Proposals` is the post-qualification non-terminal working set under the 32 cap. The old "(all states)" qualifier and the misleading Screening→Settled shorthand are deleted.
- Books per proposal ≤ **6** (2 decision + 4 gate); Baseline books share both market capacities rather than carrying a separate count cap. `MaxLiveMarkets = 196` bounds books without a terminal latch and their live POL obligations; `MaxStoredMarkets = 2,240` independently bounds every retained `Markets` row through the one-year archive ceiling. All PoV/storage budgets are re-derived from this one table in `13-parameters.md`.

### D-11. The canonical frontend serves the values layer and operator workflows (X-2, X-12)

New FE epic **FE-14 (Governance surface)**: referenda list/detail, vote/delegate/undelegate/unlock with conviction, ratification status on proposal detail, `OracleResolution` ballot. New FE epic **FE-15 (Operator surface)**, an "Advanced" area: reporter registration + `recompute_proof` submission + evidence display; guardian 5-of-7 approval signing; treasury stream claims + `nav()` view; `apply_authorized_upgrade` (Wasm fetched from the release artifact on Arweave, hash-verified against the authorized hash before submission) and `welfare.record_snapshot(epoch, spec_version)` cranks *(the call was written `welfare.snapshot` here until 2026-08-07; SQ-618 trued it to the runtime's own name and pair key)*. All state involved is light-client readable; INV-FE-4 stands unamended.

### D-12. USDC funding is IN SCOPE for the canonical frontend (X-8, X-14)

- **Withdraw (exit)**: `pallet_xcm.reserve_transfer` on the futarchy chain — normal FE screen with precondition row.
- **Deposit (on-ramp)**: a guided funding flow with a second light-client connection to **Asset Hub** and a pinned Asset Hub descriptor set (added to the descriptor pipeline). Shipped in the same release train; the flow is listed in the §26-equivalent WBS.
- **Fees (X-14)**: `pallet-asset-tx-payment` is wired to a constitution key **`fee.vit_usdc_rate`** (typed, bounded [0.1×, 10×] around its reference, PARAM-adjustable, genesis default set from the launch reference price). USDC-only users can always pay fees in USDC. The FE fee-currency selector binds to this key.
- **Fee destination (normative; added 2026-07-29, milestone E1 — this decision previously specified fee *mechanics* and was silent on where the collected fee goes)**: collected **USDC** transaction fees route to the treasury `MAIN` account and enter NAV at par; collected **VIT** transaction fees continue to **burn**. The asymmetry is the bridged/native distinction and nothing else. USDC on this chain is a claim against a reserve held on Asset Hub, so destroying the local claim does not destroy the remote reserve — it orphans it, which is the same anti-burn rule already applied to slashes ("to INSURANCE — burning USDC would strand backing reserve", Part 3 below); a fee adapter that silently drops the collected USDC credit is therefore non-conforming. VIT is natively issued here against the fixed D-15 supply, so burning it strands nothing and is mildly deflationary, whereas routing it would credit the treasury an asset D-15 marks at **0 in NAV**. Owning text: [08](08-treasury-and-economics.md) §9.

### D-13. Phase-3 insider risk contained (X-9)

- The dangerous frame-system calls (`set_storage`, `kill_storage`, `kill_prefix`, `set_code_without_checks`, `authorize_upgrade_without_checks`) are filtered **from genesis** for all origins including sudo (not "post-bootstrap").
- **`sudo.sudo_as` is denied entirely during Phases 0–3** (narrowing; SQ-99). Unlike `sudo`/`sudo_unchecked_weight`, which dispatch as Root and are contained by recursing their inner call, `sudo_as` dispatches as a caller-chosen `Signed(who)` — it can forge any signed origin, including a protocol sovereign, defeating the closed welfare-owned SettleAuthority boundary of [06](06-governance-and-guardians.md) §3.1. Root-dispatching `sudo` covers the entire legitimate bootstrap surface, so denial costs nothing.
- Phase 3 runs under a **real-USDC exposure cap**: global TVL cap + per-account deposit cap (constitution keys, raised only by phase gates).
- The founding multisig is added to the §22 adversary model with a threat row.
- The FE renders a persistent **"bootstrap governance (sudo active)"** banner during Phases 0–3 (chain-read from the phase flag), so sudo-era state is never presented as trust-equivalent to post-sudo state.

### D-14. Upgrade/descriptor coordination: enforced lead time + expedited FE release (X-7, F-mediums)

- Backend: `execute()` for CODE/META requires `now ≥ authorized_at + DescriptorLeadTime` (**43,200 blocks = 72h**) between `UpgradeAuthorized` and permissionless application.
- Frontend: v(N+1) descriptors MUST be generated from the queue-time artifact commitment and live on the release channel **before execute maturity** — a release-gating check, not a convention.
- **Expedited descriptor-only release**: 2 attestations, no 72h soak, 3-of-5 repoint — admissible only for descriptor/metadata updates with zero app-code delta.
- Pinned-release users get an in-app upgrade warning fed by a **fixed-layout raw storage key** (`ReleaseChannel` in `pallet-constitution`, SCALE layout frozen forever), readable without current metadata — this replaces the §24.5 `system.remark` pointer, which stranded apps could not decode.

### D-15. Genesis economics specified (B-14, B-15, B-18)

- **VIT**: total supply 1,000,000,000 (12 decimals). Allocation: 30% treasury reserve; 25% community distribution (vested); 20% founding team (4-year vest, 1-year cliff); 15% ecosystem/ops fund; 10% Phase 3–4 incentive programs. `iss.inflation_cap = 2%/yr`, issuance mechanism specified in `08`.
- **USDC treasury**: initial funding target **≥ 25M USDC** before Phase 5 arming; published **minimum-viable NAV per class** gates phase advancement (one CODE ⇒ NAV ≥ ~14M at floor liquidity; the gate is explicit and loud, not silent). *(Amended 2026-07-29, milestone E1 — the target itself is unchanged.)* [08](08-treasury-and-economics.md) §10 now states what the target buys and what it does not: §10.1 the annual cost base, §10.4 the crossover held capital at which the two revenue instruments meet it, and §10.5 the runway to the class arming floors. The endowment is a **bridge to that crossover, not the funding source** — Bleavit is not self-funding at launch and cannot be, since launch volume is zero by construction, and no statement to the contrary may be made.
- **Phase-4 community distribution (B20 / SQ-107)**: the 250M-VIT community pot is released only through the bounded PARAM-origin `create_community_schedule` path, armed at the exact Phase-3→4 application block and backed by the fixed 24-month SDK vesting schedule, with the 4,096 lifetime schedule bound and claimant-adverse per-block floor.
- **Phase 3–4 trading accuracy rewards (added 2026-08-10)**: the 100M-VIT incentive pot is **one undivided allocation** and this program may draw all of it *(owner ruling 2026-08-11, SQ-1052)*, through the bounded PARAM-origin `fund_trading_rewards` path, one epoch budget at a time and under a lifetime authorization bound — the same shape B20 gave the community pot, and for the same reason. The reporter-loan backstop of §2.5 is therefore **subordinate** to this program rather than reserved against it. The program pays **realized forecast accuracy** at `rwd.rate` = **0.25 %**, mints nothing, and never touches the conditional ledger. **The anti-farm invariant is delivered by the rate coupling** `99 × rwd.rate_ppb ≤ 200 × mkt.fee_ppb`, screened at the amendment boundary *(corrected 2026-08-11)* — **not** by the earning cap, which bounds each account's own exposure and cannot bind a pair one operator funds on both sides. Score, cap and forfeit are all computed in **USDC** against a held USDC bond, so no VIT price enters that invariant (D-18), and conversion to VIT happens once, at claim. Forfeited bond goes to `INSURANCE`. Rate derivation, bond rules and failure behaviour: [08](08-treasury-and-economics.md) §2.6.
- **Collator compensation**: treasury ops line, **500 USDC/collator/epoch** initial (PARAM-adjustable). *(Amended 2026-07-31, milestone E5 — SQ-536. The initial value was 2,000, which this record set with no costing behind it and which nothing subsequently checked.* ***The anchor:*** *Polkadot OpenGov referendum #1870 — passed and executed — funds 38 system-parachain collators at $250/collator/month, $307.24 fully loaded with the bounty's own hosting, curator and coordinator lines. An epoch is 21.0 days, not a month, so that is **211.97 USDC/epoch**: the superseded seed was **9.44×** and this one is **2.36×** a governance-approved rate for the same job.* ***Why it is the same job:*** *a Bleavit collator earns nothing from transaction fees or tips — this record's own fee-destination rule burns collected VIT fees and routes USDC to `MAIN` — so the treasury line is its entire compensation, which is precisely why Polkadot's system parachains are treasury-funded too.* ***Why the floor:*** *seeded at the [13](13-parameters.md) §1 registry minimum, which is unchanged, so every remaining amendment is in the safe direction (20× of headroom, ×2 per step, 1-epoch cooldown). * ***Clause corrected the same day after review:*** *[08](08-treasury-and-economics.md) §2.4's fail-soft accumulator does **not** protect this value. It catches an underfunded* line*; an underpriced* row *pays out in full and retains no unpaid difference, so underpricing degrades to collators leaving, not to a delayed payment. Nor does invulnerability of the launch set: it governs* selection*, not willingness to author. The low direction is bounded by the 2.36× margin plus the* pre-launch *gate [13](13-parameters.md) §1 places on **every** collator set, the launch one included. Derivation and margin are re-derived by the Phase-0 reference model; consequences in [08](08-treasury-and-economics.md) §10.)*
- **Welfare cold start (B-15)**: genesis ships `PriorBounds` (declared from Phase-2 shadow data); epochs 1–12 winsorize against `prior ∪ available` — `s` is deterministically computable from epoch 1.
- **Reporter-stake sequencing**: Phase-3 arming requires ≥3 registered reporters with full stakes; the incentive-program allocation funds reporter-stake bootstrapping loans (recallable).
- **Launch collator-D cap**: the D concentration term uses a phase-scheduled cap so a 5-collator launch set does not crush W (schedule in `05`).

### D-16. Operations layer: owners, funding lines, ArNS permabuy (X-13, F-5, F-mediums)

- Named treasury budget lines: bootnodes/RPC/archive (the 30-day commitment of D-6), keeper subsidies beyond the metered budget (raised to **12,000 USDC/epoch**, recomputed from crank volume), oracle evidence hosting, monitoring, Arweave/ArNS.
- **ArNS: permabuy** (eliminates the lease-lapse takeover). ANT control: 3-of-5. **Prototype FE-P7 resolved the capability question on 2026-08-07 and the answer is negative** — an ANT authorizes by membership, so its controller list is 1-of-m and no native n-of-m exists ([12](12-release-and-operations.md) §4.2; SQ-940). The threshold ceremony is therefore the only path, and it produces one controller principal held 3-of-5. **Single-key custody is prohibited** — if the ceremony does not materialize, launch blocks on this line. The decision is unchanged; only its second option is gone.
- **Signer disjointness required**: ArNS controllers ∩ minisign release keys = ∅, enforced organizationally and listed in the threat model.

### D-17. Chain identity constants (X-11a/b)

| Constant | Value |
|---|---|
| ss58 prefix | **7777** (registry submission required before Phase 2) |
| paraId | assigned at onboarding; test fixtures use 4242 |
| USDC | `ForeignAssets`, XCM `Location {parents: 1, X3(Parachain(1000), PalletInstance(50), GeneralIndex(1337))}` **[VERIFY asset index 1337]** — pinned in FE `ChainIdentity` |
| USDC decimals | 6 |
| VIT decimals | 12 |
| VIT existential deposit | 0.01 VIT |
| Phase flag | `pallet-constitution` storage `PhaseFlags` (bitset), the key the FE binds trading enablement to |

### D-18. Remaining governance/oracle hardening decisions

- **Oracle adjudication track (B-19)**: raised to 60% approval / 10% support / 7-day; tally uses a **pre-cohort conviction snapshot** (VIT locked before cohort creation), excluding capital that entered after the dispute's subject cohort began.
- **Gate determinism (B-9)**: C is split into `C_onchain` (deterministic runtime state: local XCM counters, collator set, runtime panics, and the authenticated fail-static reserve-health state) which alone drives **daily** gate-breach flags and gate-market settlement, and `C_attested` (incidents, external prices) which enters settlement-time W only. Daily evaluation is same-block over already-committed state; reserve health is the sole narrow class-3 input and may advance only through the authenticated asynchronous response/timeout path of [07](07-oracle-and-disputes.md) §8 and I-24.
- **VIT reflexivity (B-10)**: the E component values security collateral as dimensionless **coverage ratios** against VIT-denominated requirements; no VIT price enters W anywhere.
- **Challenge windows (mediums)**: extended to 72h with a bonded-watchtower acknowledgment quorum (2-of-N registered watchtowers co-sign "observed", else the window extends once by 48h); TM-4 row corrected to "delay, and wrong only under watchtower + collator collusion".
- **Kernel attestation (mediums)**: bonded attestor registry (values-elected, ≥3), 2-of-3 signed attestations with challenge window — no longer presence-only.
- **Oracle bonds (mediums)**: challenge/report bonds scale with cohort value-at-stake: `bond = max(flat_floor, bps × cohort_escrow)`.

### D-19. SDK release line: `polkadot-stable2603` → `polkadot-stable2606` (2026-07-17, PLAN B11)

- The pinned Polkadot SDK release line moves from `polkadot-stable2603` (umbrella `polkadot-sdk 2603.0.0`, last adopted at maintenance tag `polkadot-stable2603-1`) to **`polkadot-stable2606`** (umbrella `polkadot-sdk 2606.0.0`). [01 §9](01-system-overview.md)'s pinning regime classifies a line move — unlike a `stable2603-N` maintenance tag — as a project decision recorded here.
- **Motivation ([15 §4.5](15-invariants-and-testing.md) TH-34, the standing supply-chain obligation):** under the `=`-exact pin regime every one of the 25 open dependency advisories was unfixable in place. The stable2606 line clears the only reachable class — all 16 `wasmtime` advisories (35.0.0, a line with no backport, → 36.0.12 under `sc-executor-wasmtime 0.47.0`), the class under the collator's wasm-execution trust boundary — and none of the other 9: `sc-network 0.58.0` still declares `libp2p ^0.54.1` and `sc-tracing 47.0.0` still exact-pins `tracing-subscriber "=0.3.19"`. The survivors stay waived under per-family exit criteria annotated in `.cargo/audit.toml` and `tools/ci/ghsa-waivers.toml`.
- The whole train moved as a unit (~60 `=` pins re-sourced from the 2606.0.0 umbrella manifest, one atomic commit, full gate suite re-run) per the 01 §9 regime; the stable2606 tree no longer needs the vendored `core2 0.4.0` workaround, which was removed with the move.
- Maintenance tags of the new line (`polkadot-stable2606-N`) are adopted as ordinary pin bumps per 01 §9; no new decision entry is required until the line changes again.
- XCM v5 remains the latest stable wire version on stable2606 (re-verified at adoption; `staging-xcm 24.0.0` ships v3/v4/v5); the [02 §8](02-integration-contract.md) v5-frozen surfaces are unaffected.

### D-20. Futarchy as a service: Bleavit hosts conditional markets for external clients (2026-08-01, PLAN Track N)

- **The decision.** Bleavit sells hosted conditional prediction markets to other parachains, contracts
  and services over XCM: the client registers a question and funds it, Bleavit runs a two-book LMSR
  market and publishes the conditional TWAPs with provenance plus a manipulation-cost bound, and the
  **client's own rule, on the client's own chain, decides**. Owned by [16](16-hosted-question-service.md);
  ingress template in [09 §6.5](09-execution-upgrades-and-rollout.md).
- **What is sold is price discovery, not decisions.** This is the load-bearing half of the decision.
  Selling a *decision* would require an external outcome to enter a Bleavit settlement path;
  selling a *price* does not. [05](05-welfare-and-decision-engine.md)'s `W` stays Bleavit-scoped and
  I-24 is untouched, so a hostile client can lose its own money and nothing else.
- **The boundary is structural, not procedural.** A second `pallet-conditional-ledger` **instance**
  with its own sovereign (I-4/L-2 is stated against *the* sovereign account, singular, so shared
  custody would mask an external deficit until Bleavit's own traders were already unbacked, and would
  make an external failure freeze-eligible for Bleavit's own ledger); a separate origin type in a
  separate pallet; a twelfth `CallDomain` reachable by no governance origin; a dedicated egress router
  outside XCM health accounting.
- **The roster remains values-governed.** `client_registry.admit_client` and `remove_client` are
  `ConstitutionalValues` calls on the guardian track; only calls made *by an admitted client* use
  `Origin::ExternalClient(ClientId)`. Giving the roster mutations the client domain would make the
  authority that grants a capability unreachable by construction rather than protect the boundary.
- **Rejected alternatives**, each for a stated reason:
  - *Asset/topic encoding instead of `Transact`* — cannot carry a registration, and abuses a
    transfer path as an RPC.
  - *Generic `Transact` from an origin allowlist* — XCM v5 has **nine** instructions carrying an
    inner program. Six (`TransferReserveAsset`, `DepositReserveAsset`, `InitiateReserveWithdraw`,
    `InitiateTeleport`, `InitiateTransfer`, `ExportMessage`) run theirs **remotely** under Bleavit's
    own sovereign origin; `SetErrorHandler` and `SetAppendix` run theirs **locally** and carry
    `Call`, so they can carry a `Transact`; and `ExecuteWithOrigin` runs its own locally under a
    **descended** origin. No per-instruction predicate distinguishes these without enumerating all
    nine and staying complete as the SDK moves. The positional whole-program template closes every
    one by shape, enumerating none.
  - *A sovereign signed origin for clients* — leaves `SafeCallFilter` as the only thing between a
    client and every `CallDomain::Public` call. A distinct origin keeps the dispatch authority
    structurally separate; the converter's one-success closure is an implementation-and-test
    obligation, not a type-level property ([09 §6.5](09-execution-upgrades-and-rollout.md), I-34).
  - *`DescendOrigin` sub-identity* — makes Bleavit assert claims about who inside a client chain
    asked. Identity is chain-granular; `sub_id` is stored, echoed, and never interpreted.
  - *`QueryResponse` egress* — XCM v5's `Response` carries no arbitrary data, so it is structurally
    not a data channel.
  - *Settlement inside `pallet-oracle`* — its discipline parameters are chain-wide with no
    per-question override, so hosting external questions there is possible **only by degrading
    Bleavit's own oracle economics** (bond 250 → 667 bps, one extra round on every Bleavit dispute),
    and a reporter permanently ejected over a false *external* report becomes unavailable for
    Bleavit's own welfare. Settlement runs in `pallet-question-service` on a client-named bonded
    attestor median instead.
  - *Health-tracked push* — a client that never opens its return channel would drive `X` down at zero
    cost, which is exactly what I-24 forbids. The egress router is dedicated; its outcome is never
    read into XCM health, welfare or protocol outcome state, and only the isolated I-36 diagnostic
    counter observes it.
  - *Certification against measured depth* — would let an external question satisfy its security
    relation using Bleavit's own organic liquidity, turning tenants into competitors for the capital
    `dec.v_min` measures. Certification counts only client-funded `C_disp`.
- **Preserved properties, each with its enforcement:** no external state in any decision, welfare or
  settlement input (I-34/I-37, PT-10); no external `Transact` reaching any non-`ExternalClient` call
  (I-35); no externally-triggered send feeding XCM health (I-36); ingress issuance-neutral (I-38);
  per-domain solvency as the existing invariant evaluated twice (PT-9).
- **Resource-partition residual ruling (2026-08-02).** `Normal.max_total = 100%` is intentional:
  the signed extension and external XCM dispatcher enforce the 75/25 split on extension-traversing
  external calls, while authority-gating protects the three residual Normal paths that bypass both:
  scheduler direct dispatch is `InternalSchedulerOnly` governance/internal work; an
  `ExecutionGuard` queued payload has a permissionless trigger but a governance-authorized payload;
  and guardian emergency playbooks require the five-of-seven council authority. None is externally
  reachable or lets an unprivileged account choose the payload, and a refusal cap could block the
  recovery it exists to protect. Their weight is still folded into `PrimaryUsed`. The local raw
  dispatch inventory is tripwired in the runtime; the SDK scheduler's internal dispatch is guarded
  by its exact origin binding because it is not source-visible here.
- **Cost accepted:** this is the largest relaxation of the chain's XCM posture to date, and G2–G4 gain
  a materially larger surface to prove before sudo removal. Taken deliberately: [10](10-frontend-architecture.md)–[11](11-frontend-workflows.md)
  are unbuilt, so the contract bump is cheap now and expensive after F2 binds.

### D-21. Serverless handoff to external analysis tools; no tool-protocol server of any kind (2026-08-03, PLAN Track F)

- **The decision.** The client can export its *verified* view of the chain as a portable capsule, and
  accept back a *proposed* semantic action. The transport is the user agent and the operating system —
  files, clipboard, share sheet, inbound deep links — and the client makes **no network request on any
  handoff path**. Owned by [10 §13](10-frontend-architecture.md) (architecture and formats) and
  [11 §11.14](11-frontend-workflows.md) (workflow).
- **The invariant dictates the design; it does not excuse it.** INV-FE-6 ends *"features that
  inherently require servers are out of scope rather than centralized"*. A hosted or local
  tool-protocol server, a tunnel, a sidecar, or a direct model-API client is each a server whose
  availability the feature's correctness would depend on. The file/clipboard/share design is therefore
  an **application** of INV-FE-6, not an exception to it.
- **Two INV-FE texts are amended, and an earlier draft of this decision wrongly claimed none were**
  ([15 §2.1](15-invariants-and-testing.md); the joint sign-off is the user's, who owns both sides
  under R-1). **INV-FE-1** now distinguishes values the client *sources* from values the user
  *chooses* — as published it bound "any value whose incorrectness could change what a user signs"
  to finalized chain state, which a typed amount satisfies, so the text forbade the transaction
  screens themselves; that defect pre-dates this work and the handoff only made it unignorable.
  **INV-FE-9**'s enumeration gains `external-proposal`, because a requested ceiling rendered beside
  its chain-derived clamp is a displayed item and the five-status list had no label for it. Both
  changes were first carried as "ratified readings"; an adversarial review called that special
  pleading, and it was right — a reading that changes what an invariant *requires* is an amendment,
  and [15](15-invariants-and-testing.md) §6 binds certification to these texts and nothing else.
- **What is imported is a request, not a fact.** This is the load-bearing half. An imported action
  supplies exactly a choice among a closed action set, an id, and ceilings; every one is re-derived or
  re-validated against `Finalized<T>` chain state at B′ before anything is signed. No inbound field
  asserts anything about the chain, so no capsule can seed a precondition and INV-FE-1 is untouched.
  An imported action is exactly as trusted as keyboard input and travels the same code path: the
  external tool is a keyboard, not a data source.
- **No format carries an encoded call, in either direction.** Not inbound, for the obvious reason —
  and not outbound either, because a receipt containing call bytes teaches a naive tool to echo them
  back. The intent names an economic goal and the client computes the calls, because under D-3 the
  market wrapper splits internally: a tool emitting a call *sequence* would very plausibly emit a
  ledger split *and* a market buy and double-split the user's collateral. The correct call count is a
  function of chain semantics that changes between contract versions.
- **The chain surface is unchanged.** Nothing in [02](02-integration-contract.md) §2–§12 moves — no
  runtime-API method, view type, event, storage key, constant, or dispatchable. A capsule is a
  client-side projection of surfaces 02 already freezes, exactly like a screen.
  `INTEGRATION_CONTRACT_VERSION` stays at 22 and `transaction_version` is untouched.
- **Rejected alternatives**, each for a stated reason:
  - *Hosted tool-protocol server* — a server the feature's correctness depends on, so INV-FE-6 puts it
    out of scope; it would also need an operations row in [12 §6.1](12-release-and-operations.md) and a
    funding line the project does not have.
  - *Local server, sidecar, or tunnel* — breaks the static-bundle property, adds an unverifiable
    background process outside the signed release, and lets behavior change without shipping a release,
    which is precisely what INV-FE-13 forbids.
  - *Browser-extension bridge* — the same, plus a new supply-chain root the release cannot attest.
  - *Direct model-API integration* — needs a credential, a `connect-src` host, and a paid per-user
    dependency; fails INV-FE-4 and INV-FE-6 together.
  - *Signing capsules with the user's chain key* — reuses a signing key for a non-chain purpose and
    manufactures an artifact that looks authoritative. Capsules are deliberately unsigned; what
    verifies one is re-reading the chain, which anyone can do.
  - *Accepting an encoded call from a tool* — the single decision that would defeat every other control
    here. There is no exported function outside `packages/chain-client` that accepts raw call bytes, and
    no inbound field has a type that could carry them.
  - *Rendering tool-authored prose* — a social-engineering surface on the confirm screen. No format
    carries free text or a tool label; a label reading "Bleavit Official Assistant" inside a confirm
    flow would be a phishing primitive.
  - *Tolerating unknown keys inside `action`/`limits`* — at the top level an unknown key is a producer
    annotation no consumer reads; inside `action` it is a proposed semantic, and exactly where an
    encoded call would be placed. Those two objects are closed against the house's own extras rule.
- **Outbound vendor links are permitted, with three obligations** (user ruling, 2026-08-03). They are
  top-level navigations rather than fetches, so they add no `connect-src` entry, but: the vendor list
  ships **inside the signed release** and is never fetched or remotely configured (INV-FE-13); a
  one-time disclosure interstitial names the vendor and what its logs learn; and a capsule exceeding
  the URL bound **falls back to clipboard or file automatically and is never truncated**.
- **Preserved properties, each with its enforcement:** authoritative reads unchanged, because export
  requires `Finalized<T>` and nothing inbound is a chain value (INV-FE-1); the pre-sign gate unchanged,
  because the import path's only output is a `TxPreparation` entering Draft and the structural
  no-bypass assertion is re-run with that entry point enumerated (INV-FE-2); no network primitive in the
  handoff packages and no `connect-src` addition, both CI-gated (INV-FE-6, INV-FE-13); and the
  no-infrastructure certification run executed with these surfaces disabled, proving no INV-FE-4
  workflow depends on them.
- **Cost accepted:** a persuasive tool can shape a user's judgement, and no detection mechanism changes
  that. It is the [14](14-threat-model.md) TH-49 class, recorded as an accepted residual: the control is
  the transaction boundary, not detection. Taken deliberately, because the alternative on offer is not
  "no external tools" — users already paste chain data into them — but "external tools working from
  screenshots and guesses instead of a verified, structured, provenance-bearing capsule."

---

## Part 2 — Finding disposition table

Every DESIGN_REVIEW.md finding, its resolution, and the owning component document.

| ID | Resolution | Doc |
|---|---|---|
| X-1 | D-2: all P-1…P-11 applied; contract frozen | 02 |
| X-2 | D-11: FE-14 governance surface | 11 |
| X-3 | D-6: three-layer history model | 02, 10, 12 |
| X-4 | D-6: bootnode row + phase gate | 01, 02, 12 |
| X-5 | D-8: forecast trading cut | 04 |
| X-6 | D-1: Voided state end-to-end | 03, 11 |
| X-7 | D-14: DescriptorLeadTime + expedited release | 09, 12 |
| X-8 | D-12: funding flow in scope | 11 |
| X-9 | D-13: genesis filter + exposure cap + banner | 09, 14 |
| X-10 | D-2: `BaselineMarketOf` storage | 02, 04 |
| X-11a–j | D-2, D-17: drift items individually fixed (ForeignAssets location, ss58/paraId/ED/phase-flag, oracle names, epoch event names, constants API, T20 `Voided` event, `DecisionOutcome`, no FE hardcodes, execute precondition row completed, phantom §18.6 refs removed) | 02 + owning docs |
| X-12 | D-11: FE-15 operator surface | 11 |
| X-13 | D-16: owners + funding + permabuy | 12 |
| X-14 | D-12: `fee.vit_usdc_rate` | 08 |
| X-15 | D-2: published test artifacts | 02, 15; corpus schema: 04 §5 |
| B-1 | D-1 | 03 |
| B-2 | Gate instruments representable: `PositionKind` gains `GateYes(gate)`, `GateNo(gate)` per branch; `VaultInfo` gains per-branch gate-set supplies; `settle_gate(pid, gate, outcome)` call; conservation identity extended per-branch over the enlarged set | 03 |
| B-3 | Baseline market gets a ledger home: epoch-keyed `BaselineVaults`, `PositionId::Baseline{epoch, Long/Short}`, `pol.b_baseline` param, measured settlement via SettleAuthority at epoch settlement plus the neutral cohort-VOID and orphan-epoch paths | 03, 04, 05 |
| B-4 | Per-branch supply fields; per-branch identity `escrowed == supply(bUSDC_b) + Q_b` checked for both branches; POL seeding flow re-walked | 03 |
| B-5 | Unpaired SHORT redeems `floor(a·(1−s))`; new atomic `redeem_scalar_pair` pays exactly `a` per pair | 03 |
| B-6 | V1 = **512.494795136**, V5 net = **−3.074969**; §11.6 vectors regenerated from the reference model in CI | 04 |
| B-7 | D-3 | 04 |
| B-8 | D-4 | 05, 08 |
| B-9 | D-18 gate split | 05, 07 |
| B-10 | D-18 coverage ratios | 05 |
| B-11 | D-5 | 06 |
| B-12 | Transitions added: T21 `Rejected → Measuring`, T22 `FailedExecuted → Measuring` (retry exhausted), T23 `FailedExecuted → Executed` (retry succeeds); T13 rerun re-enters `Extended` (3 days) then decides | 05 |
| B-13 | 10% bond slash on preimage-missing cancellation; `request_preimage` pinning at qualification | 06, 08 |
| B-14 | D-15 | 08 |
| B-15 | D-15 cold start | 05 |
| B-16 | D-9 coretime exemption | 09 |
| B-17 | D-9 | 06, 09 |
| B-18 | D-15 min-viable NAV, loud gate | 08 |
| B-19 | D-18 track hardening | 06 |
| B-med: sanity band | Gate books exempt from the [0.02, 0.98] band (they get a near-boundary validity rule); band applies to welfare books only; `V_min` ambiguity resolved to per-book | 05 |
| B-med: forecast mint | Moot per D-8 | 04 |
| B-med: ProcessHold | `any_open_dispute_touching` scoped to consumed MetricSpec components with dispute bond ≥ `dis.merit_min`; registry sub-games hold settlement, never decisions | 07 |
| B-med: slot monopolization | Bond refundable only on decision-grade outcome; 10% slashed to INSURANCE otherwise; ≤4 intake entries/epoch/account; TM row added | 06, 14 |
| B-med: IntakeQueue vs MaxLive | D-10 | 13 |
| B-med: Positions map | Key order `(PositionId, AccountId)` (per-vault drainable); per-account bound via counter; deposit 0.1 USDC/entry; protocol accounts exempt from the 64-position cap | 03 |
| B-med: Emergency class | D-7 deleted | 05, 06 |
| B-med: epoch.length | Phase offsets become fractions of epoch length; changes effective next epoch; in-flight cohorts keep creation-time schedule; floor 14 days | 05 |
| B-med: SettleAuthority | One welfare-owned authority boundary, reached only from pallet-epoch through three explicit paths: measured `settle_cohort` → `compute_settlement` → ledger, neutral cohort-VOID `void_cohort` → `settle_baseline_void` → ledger, and neutral orphan-epoch `finalize_epoch_baseline` → `settle_baseline_void` → ledger (SQ-320); §6.1 table updated | 05 |
| B-med: force_rerun | Defined: pre-execution only; TWAP reset, books reopen for 3-day Extended, positions intact, one decide re-run | 06 |
| B-med: EmergencyPlaybook calls | Admissible call set enumerated in the §6.2-equivalent capability table | 06 |
| B-med: Incident/MilestoneRegistry | New `pallet-registry`: bonded filings, challenge windows, slashing, bounds, weights; feeds C_attested | 07 |
| B-med: oracle bonds | D-18 value-scaled | 07 |
| B-med: challenge censorship | D-18 watchtowers | 07, 14 |
| B-med: attestation presence-only | D-18 attestor registry | 06, 09 |
| B-med: keeper budget | Recomputed (≥134k decision-critical cranks/epoch); metered budget 12,000 USDC/epoch + fee rebates; exhaustion alarm | 08 |
| B-med: USDC freeze | Reserve-health trigger R added to C_onchain; PB-RESERVE halts split inflows; NAV haircut flag surfaces in FE | 07, 08, 10 |
| B-med: collator-D cap | Phase-scheduled cap (D-15) | 05 |
| B-med: C/P/A aggregation | Intra-pillar formulas fully specified (weighted geometric, ε-floors, weights in MetricSpec) | 05 |
| B-med: decide() fields | `Proposal` gains `ask`, `decide_at`; canonical `DecisionOutcome` enum defined | 05, 02 |
| B-med: RejectReason | `NotRatified`, `SecuritySizing`, `AttestationMissing` added; `VetoUpheldByReview`/`PayloadReverted`/`SecondExtensionFailed` wired to producers | 05 |
| B-med: threat rows | All missing rows added (dispute-griefing, Baseline-floor suppression, position-cap dusting, preimage sabotage, founder/sudo insider, challenge censorship, ArNS lapse, signer disjointness) | 14 |
| B-med: SafetyFilter | Recursion extended to `proxy_announced`, `as_multi_threshold_1` — the wrapper set is now closed | 06, 09 |
| B-low (all) | `ScalarSettled` carries winning branch; maker loss ~180 USDC; maturity B+288,000; Trade phase d5–d18 labels; TWAP slew per 10-block observation interval; §15.2 latency table reconciled with the D-18 track; dangling refs removed; FGP/SGF/GFP/EFP/AEGIS identified in the bibliography | owning docs |
| F-1 | D-6 | 10 |
| F-2 | D-6: never promote | 10 |
| F-3 | INV-FE-1…15 and all question blocks published verbatim | 15 |
| F-4 | Moot per D-2 (contract frozen); contingency = the D-6 layer-1 fallback | 02, 10 |
| F-5 | D-16: permabuy + no single-key custody | 12 |
| F-med: expedited release | D-14 | 12 |
| F-med: transaction-critical | Definition narrowed: provider charts are declared an accepted residual with provenance labeling; sampling limits stated honestly | 10, 14 |
| F-med: boot machine | Missing states added (worker spawn, WASM, storage errors; boot-time restricted; pre-Ready degradation); relation to compat machine defined | 10 |
| F-med: growth arithmetic | Recomputed at 196-book max load; retention auto-tunes to budget (degrades depth, never correctness); honest depth table | 10 |
| F-med: CSP | `connect-src` allowlist (bootnodes + gateways + opted-in providers), not `*` | 12 |
| F-med: hostile SW | Declared residual + out-of-band attestation monitor; detection claim removed | 12, 14 |
| F-med: ArNS lease | Moot per D-16 permabuy | 12 |
| F-med: system.remark | D-14 fixed-layout raw storage key | 09, 12 |
| F-med: signer disjointness | D-16 | 12, 14 |
| F-med: provider firewall | Structural enforcement inside `app/src` too (build-time import boundary, not lint-only) | 10 |
| F-med: backfill math | Recomputed consistently at 20 blk/s | 10 |
| F-med: txHistory | Ingest fetches extrinsic bodies for blocks containing the user's extrinsics (only) | 10 |
| F-med: proof-size conflation | §14.3 corrected | 10 |
| F-med: metadata blobs | Bounded per the budget with eviction | 10 |
| F-med: multi-tab | Dedicated worker + Web Locks leader election; Android 2× memory budgeted | 10 |
| F-med: Alt-C providers | Ship empty list, opt-in (Alt-C text corrected) | 10 |
| Open [VERIFY]s | All retained verbatim in owning docs; the two no-fallback items get fallbacks: browser-WSS peer behavior → D-6 layer-2 operators are the guaranteed dial set; XCM-health availability → R sub-metric with a fail-static daily C flag (R and X are both `C_onchain` components, 05 §4.3); PB-MIGRATION contents specified in 09 | owning docs |

---

## Part 3 — Document map, shared constants, editorial standard

### Document map

| Doc | Component | Primary sources |
|---|---|---|
| `01-system-overview.md` | Goals, guarantees, topology, pallet map, rollout summary | BE §1–6, §29 |
| `02-integration-contract.md` | **Frozen** chain ↔ frontend contract (D-2, D-17) | FE §30, BE §7/§25 |
| `03-conditional-ledger.md` | Ledger, solvency, VOID, gate instruments, Baseline home | BE §5.2.1, §7, §10 |
| `04-markets-and-pricing.md` | LMSR, TWAP, trade path, gate + Baseline markets | BE §11, §13, §17.3 |
| `05-welfare-and-decision-engine.md` | Welfare function, state machines, decision rule | BE §8, §9, §12, §14 |
| `06-governance-and-guardians.md` | Values layer, tracks, ratification, guardians, playbooks | BE §16, §18.3, §20, §6 |
| `07-oracle-and-disputes.md` | Reporting game, disputes, registries, watchtowers | BE §15 |
| `08-treasury-and-economics.md` | Treasury, POL, genesis, fees, keeper economics, security sizing | BE §17, §21, §27 |
| `09-execution-upgrades-and-rollout.md` | Execution guard, upgrade path, XCM, phases, emergency lanes | BE §18, §19, §29 |
| `10-frontend-architecture.md` | Boot, light client, data layer, verification, budgets | FE §8–§16 |
| `11-frontend-workflows.md` | Screens, preconditions, governance + operator + funding surfaces | FE §17–§19, §30 |
| `12-release-and-operations.md` | Release train, keys, ArNS, bootnodes, ops funding | FE §22–§28, BE §28 |
| `13-parameters.md` | Single reconciled parameter/bounds/constants table | BE §21 |
| `14-threat-model.md` | Combined threat model, all new rows | BE §22, FE §20 |
| `15-invariants-and-testing.md` | I-1…, INV-FE-1…15 verbatim, test/verification regime, artifacts | BE §23–24, FE §23, §32 |

### Frozen shared constants (no document may restate different values)

- Block time 6 s; epoch 21 days = 302,400 blocks; Trading **d5–d18** (offsets 72,000–259,200; 13 days); decide d18; measurement k = 2 epochs; measured cohort settles e+3; maturity example B+288,000.
- Oracle: report window per §15; challenge window **72h** (43,200 blocks) with watchtower quorum; dispute latency table reconciled in 07.
- `IntakeQueue = 64`; `MaxLiveProposals = 32`; books/proposal ≤ 6; `MaxLiveMarkets = 196`; `MaxStoredMarkets = 2,240`; `RecentCohortSummaries` ring = 32; `MaxPositionsPerAccount = 64` (protocol accounts exempt); Positions deposit 0.1 USDC; key order `(PositionId, AccountId)`.
- LMSR: V1 = **512.494795136** USDC; V5 net = **−3.074969**; V2–V4 unchanged; maker worst-case loss `b·ln 2`; §11.10 maker-loss example ≈ 180 USDC; TWAP slew cap per **10-block** observation interval.
- VOID: pairs par via merge; unpaired branch-USDC `floor(a/2)`; unpaired LONG/SHORT `floor(a/4)`.
- Scalar redemption (these are **gross** payouts; the net transferred to a non-protocol claimant is `gross − ceil(gross · ledger.redeem_fee)` per [03](03-conditional-ledger.md) §5.3a, added by E1 — every VOID and `merge*` path above is fee-exempt, as is `redeem`): LONG `floor(a·s)`; unpaired SHORT `floor(a·(1−s))`; paired via `redeem_scalar_pair` = exactly `a`.
- `DescriptorLeadTime = 43,200` blocks (72h). PB-LEDGER-FREEZE ≤ 14 days + one renewal.
- Keeper metered budget 12,000 USDC/epoch. Collator comp 500 USDC/collator/epoch (re-anchored from 2,000, 2026-07-31, SQ-536 — see D-15). Intake: ≤4 entries/epoch/account; 10% bond slash (to INSURANCE — burning USDC would strand backing reserve) on non-decision-grade/preimage-missing outcomes.
- Chain identity per D-17. VIT supply 10⁹ (12 dec); USDC 6 dec; treasury target ≥ 25M USDC; min-viable NAV per class per 08.
- Oracle adjudication track: 60% / 10% support / 7-day / pre-cohort snapshot.
- Bootnodes: ≥8 WSS, ≥4 operators, ≥2 on :443; operator served-state window 30 days.

### Editorial standard

1. Every doc starts with a status header (`Status: normative component specification. Supersedes the corresponding sections of BACKEND_PLAN.md/FRONTEND_PLAN.md.`) and states its **boundary** (what it owns, what it references).
2. One source of truth per fact: constants live in `13-parameters.md` and `02-integration-contract.md`; other docs reference, never restate values (quoting for readability is fine when marked *(normative value: §13)*).
3. RFC 2119 language; `[VERIFY]` tags are retained wherever the underlying uncertainty still exists — honesty over polish.
4. Every doc ends with a **Resolves** table: finding ID → one-line statement of how the text resolves it.
5. Cross-references between docs use relative markdown links.
6. Content fidelity: these docs carry forward everything the review verified as correct ("What the design gets right") — they are a reorganization + repair, not a redesign.
