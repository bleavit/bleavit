# 08 — Treasury and Economics

**Status: normative component specification. Supersedes the corresponding sections of BACKEND_PLAN.md/FRONTEND_PLAN.md** (BE §17, §21 economics rows, §27.1–27.4 economics, ADR-14 sizing rule; FE §17.4 fee mechanics).

**Boundary.** This document owns: `pallet-futarchy-treasury` (accounts, NAV, outflow controls, streams, budget lines), genesis economics (VIT supply/allocation/vesting/issuance, initial USDC funding), the minimum-viable-NAV phase gates, the economic-security sizing regime (AttackCost̂ estimator, decide-time cap, Ask-scaled liquidity), transaction-fee economics (`fee.vit_usdc_rate`), keeper economics, intake/bond economics, and the POL seeding flow's economics. It references: ledger mechanics ([03](03-conditional-ledger.md)), book mechanics and `headroom` ([04](04-markets-and-pricing.md)), the decision engine that hosts the `SecuritySizing` step ([05](05-welfare-and-decision-engine.md)), intake/bond lifecycle ([06](06-governance-and-guardians.md)), the reserve-health trigger ([07](07-oracle-and-disputes.md)), rollout phase gates ([09](09-execution-upgrades-and-rollout.md)), and operations funding execution ([12](12-release-and-operations.md)). All parameter values quoted here are normative in [13](13-parameters.md); the arithmetic below is normative in *this* document.

Normative language: RFC 2119. USDC amounts in whole units (6 decimals); `ln 2 = 0.693147…`; all worked arithmetic is shown and MUST be reproduced by the Phase-0 reference model.

**A13 REWARDS extension (2026-07-24):** `REWARDS` is also backed by its dedicated `REWARDS_` real-USDC pot. `fund_budget_line(REWARDS, amount)` therefore performs the same atomic `MAIN`→pot custody sync and the same line≤pot try-state check; unlike the keeper/oracle rebate pots, this pot is consumed by fail-soft execution-time proposer rewards.

---

## 1. `pallet-futarchy-treasury` (carried forward, amended)

### 1.1 Accounts and budget lines

Derived sub-accounts: `MAIN`, `POL`, `INSURANCE`, `KEEPER`, `ORACLE`, `REWARDS`, `COLLATOR`, and (new, D-16) `OPS` — whose budget lines are the lowercase `ops.*` keys used throughout this set (naming normalized with [12](12-release-and-operations.md) §6.1; values consolidated in [13](13-parameters.md)). `COLLATOR` is a dedicated custody pot for the `ops.collators` line; it is not a discretionary ops account. Outflow calls accept only the `FutarchyTreasury` origin (from the execution guard) and MUST name a budget line; per-line budgets are constitution-keyed.

| Line (account) | Purpose | Per-epoch default *(normative value: [13](13-parameters.md))* |
|---|---|---|
| `POL` | Market subsidy commitments (§8) | ≤ `pol.budget_epoch` = 0.75% NAV (kernel ceiling 1.5%) |
| `POL_BASELINE` | Standing Baseline book subsidy (§4.3) | `pol.b_baseline`·ln 2 ≈ 17,329 USDC/epoch, outside `pol.budget_epoch` |
| `KEEPER` | Metered crank rebates (§6) | `keeper.budget_epoch` = 12,000 USDC |
| `ORACLE` | Reporter fees + escalation float | per-epoch line |
| `REWARDS` | Proposer rewards: PARAM 500; TREASURY/CODE min(0.05%·Ask, 25k); META 25k USDC — paid on `Executed`, to the proposal's **author** (`Proposal.proposer`), never to its funder ([05](05-welfare-and-decision-engine.md) §1.5, milestone E6) | — |
| `ops.bootnodes` / `ops.rpc_archive` | ≥8 WSS bootnodes; ≥4 public RPC + ≥2 archive nodes **and the 30-day served-state operator commitment** (D-6, D-16) | funded lines, named operators ([12](12-release-and-operations.md)) |
| `ops.keepers` | Keeper operations **beyond** the metered budget (D-16; §6.3) | funded line |
| `ops.oracle_evidence` | Oracle evidence hosting ([07](07-oracle-and-disputes.md)) | funded line |
| `ops.watchtowers` | ≥ 2 bonded registered watchtowers for the challenge-window quorum ([07](07-oracle-and-disputes.md), [12](12-release-and-operations.md) §6.1) | funded line |
| `ops.monitoring` | §28-equivalent monitoring | funded line |
| `ops.arweave` | Arweave/ArNS permabuy + release hosting (D-16) | funded line |
| `ops.collators` | Collator compensation, `collator.comp_epoch` = 500 USDC/collator/epoch (§2.4) | 5 collators ⇒ 2,500 USDC/epoch at launch |
| `ops.coretime` | Coretime renewal budget; the enumerated renewal call is **exempt from the dead-man freeze** (D-9, mechanics in [09](09-execution-upgrades-and-rollout.md)); USDC-denominated — a renewal debits the full DOT outflow's USDC value at `ops.coretime_dot_rate`, rounded up ([09](09-execution-upgrades-and-rollout.md) §4) | funded line |
| `ops.reserve_probe` | Reserve-transferability probe fee envelope ([07](07-oracle-and-disputes.md) §8); USDC-denominated — each attempted send first debits `ops.probe_fee_dot` at the dedicated `ops.probe_dot_rate`, rounded up, and refuses on insufficient funding. This accounting line does **not** provision the distinct USDC/DOT inventory in Bleavit's sovereign account on Asset Hub | before first arm, local credit covers `res.fail_threshold + res.recover_threshold` full debits (5 at genesis); the remote account separately holds the probe USDC plus the same DOT-envelope minimum and a refill margin; launch amounts **[VERIFY]** in [13](13-parameters.md) / live onboarding evidence |
| `INSURANCE` | Slash proceeds and swept ledger dust — **not** fee income (§1.2, as amended by E1) | inflow-only except by TREASURY decision (`sweep_insurance` to `MAIN`) and the automatic above-target overflow of §1.2 |

Attestor and challenger bond slashes are native VIT custody transfers into `INSURANCE` (06 §7, B19); neither slash is burned or routed through a budget line.

**Where per-line budgets bind (normative).** `fund_budget_line` is an allocation act, not a spend: it moves credit from `MAIN` to a line under a passed TREASURY decision, and is deliberately unmetered beyond `MAIN` solvency and the custody sync of §1.4. Each line's per-epoch budget is enforced by its **consuming mechanism**, never at funding time — the keeper meter for `KEEPER` (§6.3), epoch shrink-to-fit against `pol.budget_epoch` · spendable NAV for `POL` (§4.4, whose T13 rerun top-ups are a stated exception to that budget), and the exact ceil-rounded pre-dispatch debit for `ops.reserve_probe` ([07](07-oracle-and-disputes.md) §8). A line whose consumer is not yet implemented is bounded only by its funded balance and the §1.3 rolling meters; lines carrying a `[VERIFY]`-gated budget in [13](13-parameters.md) §1 are allocation-only until Phase-2/3 ops sizing.

**Bootstrap reserve-line funding (normative).** While the stored `BootstrapOpsFundingClosed` latch is false, `fund_budget_line` additionally accepts the stored operations multisig as a Signed origin for **`OpsReserveProbe` only**. The amount is a top-up, not an allocation discretion: after funding, the line balance MUST NOT exceed `(res.fail_threshold + res.recover_threshold) × ceil(ops.probe_fee_dot × ops.probe_dot_rate / 10^10)`. Every other budget line and every top-up above that live runway ceiling fails closed, so sharing the stored account with the coretime quote authority cannot compose quote authentication into an arbitrary `MAIN` allocator. TREASURY arming alone MUST NOT close this bridge: an F+R runway is only the minimum recovery envelope and can be shorter than the governance refill latency. Instead, the first successful **positive** `fund_budget_line(OpsReserveProbe, amount)` under `FutarchyTreasury` closes the latch irreversibly and atomically with that funding. A zero amount, a failed call or funding any other line does not close it. The call refuses every other Signed account and every Signed attempt after closure; the ordinary `FutarchyTreasury` path remains available thereafter.

There is deliberately no direct Signed or Root rotation call for a lost or compromised stored ops key: `set_coretime_authority` requires the `FutarchyTreasury` custom origin. Before TREASURY is armed, recovery uses the existing bootstrap phase-governance path — bootstrap sudo may set the TREASURY phase bit only through `constitution.set_phase_flag` and its NAV-floor gate; a subsequent TREASURY-class decision positively funds `OpsReserveProbe` to close the bootstrap latch and may rotate the authority. If that path is unavailable before persistent launch, the state is corrected by the pre-launch genesis/redeployment ceremony, not by widening this key. On the intended pre-genesis v0 state, where TREASURY is unarmed, the treasury storage-v1 migration introduces the latch open; if the current TREASURY bit is already armed it initializes the latch closed instead, conservatively avoiding creation of a new Signed authority. The current bit is not a historical witness, so neither branch reconstructs an arbitrary deployed v0 chain that may previously have completed and later retreated from the governed handover. The v1 migration MUST land before persistent launch; otherwise release is blocked until explicit historical evidence or a state-specific migration establishes the correct one-way latch state.

Funding the local accounting line moves no remote asset. Before the reserve probe first arms, `ops.reserve_probe` must cover the runway above and Bleavit's sovereign account on Asset Hub must separately hold the probe USDC plus the same number of governed DOT envelopes and a refill margin ([07](07-oracle-and-disputes.md) §8).

**Fee routing (amended 2026-07-29, milestone E1; supersedes "50% `INSURANCE` / 50% POL offset").** Realized market-fee value routes **100% to `MAIN`**, and the POL-offset leg does not survive. Two reasons, both dispositive:

1. **The superseded rule could not reach spendable NAV.** `INSURANCE` is outside `NavView.total` (§1.2), so half the fee income was, by construction, not treasury income at all — its only exit was a governed `sweep_insurance` that itself consumes a proposal slot and that slot's POL subsidy. A revenue instrument whose collection requires a proposal slot is not a revenue instrument.
2. **The POL-offset leg is subsumed, not lost.** `POL` is funded from `MAIN` by `fund_budget_line`, so fee value arriving in `MAIN` offsets POL exactly as the old leg intended, through the one mechanism that already exists, without a second accounting path and without hard-wiring a ratio that no evidence sizes. Routing to `MAIN` is strictly more flexible than the split it replaces.

Collection is **automatic and permissionless** — it MUST NOT require a proposal slot. Mechanics: [04](04-markets-and-pricing.md) §6.1 (collection) and §2 (the `sweep_revenue` crank that realizes it); [03](03-conditional-ledger.md) §5.3a/§5.4 (the redemption-fee counterpart). Economics and sizing: §10.

### 1.2 NAV (with haircuts and the reserve-health flag)

```
NAV = liquid USDC at par
    + undisbursed stream remainders owed *to* the treasury (cancellation reversions)
    − outstanding obligations (open stream remainders owed *from* the treasury,
      queued in-cap proposal outflows, POL commitments of live books §8.2)
VIT holdings: marked 0. In-flight XCM: marked 0 until arrival (conservative).
```

**Reserve-health haircut (new; B-med “USDC freeze”).** [07](07-oracle-and-disputes.md) defines the deterministic reserve-health sub-metric `R` in `C_onchain`. While the `R` flag is set:

1. the published NAV view carries `reserve_impaired = true` (never silently full-backing);
2. **spendable NAV for all new commitments is 0**: no new POL seeding, no new outflows, no new stream openings, and every minimum-viable-NAV gate of §4 evaluates as failing (fail-static). Existing books and existing stream claims are unaffected. **Three** bounded maintenance debits remain dispatchable under the flag (corrected from "exactly two" 2026-07-31, milestone E7, SQ-540(b) — the text enumerated two while the implementation had always run three, and the third is the one the other two depend on): (a) D-9's `execute_coretime_renewal` debit from `ops.coretime` ([09](09-execution-upgrades-and-rollout.md) §4); (b) one already-funded `ops.reserve_probe` envelope per due probe ([07](07-oracle-and-disputes.md) §8), without which the flag could not recover; and (c) **collator compensation from the already-funded `ops.collators` line** (§2.4). The probe carve-out can debit only that dedicated line by the governed ceil-rounded envelope and cannot reach `MAIN`, any other line, or an arbitrary recipient; (c) is bounded the same way, to the dedicated `COLLATOR` custody pot. NAV carries no DOT term in any of the three;

   **Why (c) is a carve-out and not an oversight.** It is D-9's own wedge argument, applied to the layer beneath it: unpaid collators stop authoring, an unauthored chain produces no blocks, a chain producing no blocks runs no reserve probe — and the flag can then never clear. The coretime carve-out exists so that the chain retains a core; (c) exists so that something is still willing to use it. Like (a) and (b) it is maintenance rather than discretion, it pays for work already performed, and it debits only its own pre-funded pot. **The bound is the pot balance**, not an unlimited draw: `fund_budget_line` deliberately remains dispatchable under the flag — gating it would defeat (a) — so a refill is possible, but only through the `FutarchyTreasury` origin, i.e. as a governed allocation act (§1.1), and §4's fail-static NAV gates prevent a *new* TREASURY decision arming while the flag is set.

   **Proposer rewards are not a fourth carve-out; they are a crystallized obligation, and belong with "existing stream claims are unaffected".** The distinction is load-bearing and is stated because getting it wrong is expensive in the claimant's direction. A proposer reward is owed at the instant the decision passes and its payload executes — the work is complete and the obligation is not discretionary at payout time. It is also paid **once**: the reward is attempted inside the `Executed` transition and its result is deliberately discarded so that an unfunded line cannot make the guard retry a valid payload forever. Gating it on the reserve flag would therefore **not defer the reward, it would destroy it** — a proposer would permanently forfeit a reward over a reserve condition they neither caused nor can influence. That is the opposite of the direction G-1 and R-7 require, which is that a failure must never leave a completed claimant worse off than the status quo. What the reserve flag *does* correctly block is the creation of new such obligations, and it does: no new proposal can arm or qualify while §4's gates are fail-static;
3. playbook `PB-RESERVE` becomes admissible: halts `split` inflows ([03](03-conditional-ledger.md));
4. event `NavHaircutFlagged { epoch, flag }` is emitted on every flag transition. The FE MUST surface the flag on every NAV render ([10](10-frontend-architecture.md), [11](11-frontend-workflows.md)).

`nav()` is the committed [02 §4](02-integration-contract.md) `NavView`: `total` is the NAV above; `spendable_nav` is zero under the reserve-health flag; `meter_utilization_bps` is the rolling-meter utilization; `haircut_flag` is exactly `reserve_impaired`; and `class_floors` carries the §4.1 arming floors in Param/Treasury/Code/Meta order. The remaining fields decompose the treasury accounts, stream remainders and obligations. FE-15 renders the complete view ([11](11-frontend-workflows.md)).

**INSURANCE is outside NAV (normative).** The INSURANCE account is **not** a summand of `NavView.total`: it is not liquid USDC available to the treasury's commitments, and excluding it understates NAV — the fail-static direction for every cap, meter, gate and floor that divides by it. `NavView.insurance` reports the INSURANCE custody balance for transparency only; the account fields are a **partial** view of the treasury's spendable custody — the nine `ops.*` lines carry no `NavView` field of their own — and MUST NOT be presented as an additive decomposition of `total` (a constraint on the FE-15 rendering of [11](11-frontend-workflows.md) §11.8.3). **The INSURANCE spending path (normative; SQ-306).** §1.1's "inflow-only *except by TREASURY decision*" requires a path for the account to be anything other than a sink, and the spec previously named none. It is a single call, `sweep_insurance(amount)` (§1.4), and nothing else:

- **Origin: `FutarchyTreasury` only** — i.e. a passed TREASURY-class futarchy decision, with the dedicated `InsuranceSweep` capability rather than the broader `TreasurySpend` capability. No guardian power, no playbook and no admin origin can reach it.
- **Destination: `MAIN`, and only `MAIN`.** The sweep does not pay a third party. Once the funds are in `MAIN` they are ordinary treasury credit and every existing control applies to spending them — budget lines, the §1.3 rolling meters, stream thresholds, the reserve-health flag.
- **It preserves.** INSURANCE is a treasury sub-account and therefore a genesis-endowed permanent custody account under [03](03-conditional-ledger.md) §7 R-4, whose floor holds only because *every* custody path out of the account preserves. `sweep_insurance` MUST use `Preservation::Preserve`: at most `balance − min_balance` is sweepable, and a request above that fails whole rather than reaping the account (G-1).
- **NAV effect.** The swept amount leaves the excluded INSURANCE balance and enters NAV, raising it by exactly that amount. Because §4.2 compares spendable NAV against the fixed §4.1 arming floors and §5.2 derives the in-cap prize from `trs.cap_proposal · NAV`, the sweep MUST be authorized by a TREASURY decision rather than an administrative transfer: routing it through the market makes the raise a decided act carrying a `DecisionRecord`.

A dedicated `BudgetLine::Insurance` was rejected: budget lines are *funded from* `MAIN` and spent outward, so modelling an inflow-fed reserve as a line inverts the direction of every §1.1 control. Declaring INSURANCE a permanent sink was also rejected — it would contradict §1.1's own text and strand bridged Asset-Hub USDC forever, which is precisely the outcome §7.1's anti-burn rationale exists to avoid. This settles the accounting question **and** the reachability question; the implementation of `sweep_insurance` is tracked separately (SQ-207), and its least-authority capability split is settled by SQ-384.

**INSURANCE has a derived target size, and above it overflows automatically (normative; added 2026-07-29, milestone E1; asset scope corrected the same day).** An inflow-only reserve held outside NAV with no ceiling is a value sink: every USDC that reaches it leaves NAV permanently unless a TREASURY decision spends a proposal slot to retrieve it. The ceiling is not chosen — it is derived from the liability the account backs, and it is **at least** that liability:

```
T_ins = swept_residue_unreclaimed        // the 03 §5.4 / R-5 sweep total, an O(1) maintained counter
      + min_balance                      // the 03 §7 R-4 permanent-account floor
```

**The target and the overflow are scoped to INSURANCE's USDC balance, and only to it (normative).** Both terms of `T_ins` are USDC — swept residue is ledger escrow, `min_balance` is the USDC minimum — so comparing any other asset's balance against `T_ins` is a units error, not a policy choice. `T_ins` bounds `balance(INSURANCE, Usdc)`; the overflow moves USDC and nothing else. **VIT slash proceeds stay in INSURANCE and never overflow.** The attestor and challenger bonds of [06](06-governance-and-guardians.md) §7 (`att.bond` = 25,000 VIT) and the guardian bond of §4 (50,000 VIT) are native VIT custody transfers (§1.1), and §2.2 marks VIT at **0 in NAV** — so moving them to `MAIN` would add exactly nothing to spendable NAV while inventing a second asset's worth of accounting. There is nothing to overflow *for*: the value sink this rule closes is a sink of NAV-bearing capital, and a VIT balance held outside NAV is not one.

`T_ins` is a floor on the liability rather than a match to it, and both slacks run in the safe direction: R-5 residue includes **rounding dust**, which is nobody's live claim yet still raises the target, and R-7 forfeited position deposits arrive in INSURANCE **without** entering `T_ins` at all, so they are surplus from the moment they land. Hence "at least" above, not "exactly" — a reserve that over-states its liability is idle capital, which is the tolerable error; one that under-states it is an unbacked promise, which is not.

Swept residue is the escrow of claims that were never redeemed before `ledger.archive_delay` elapsed, and [03](03-conditional-ledger.md) §5.4 keeps those claims *live*: "after reaping, unredeemed claims remain redeemable through a Merkle-archived claims procedure executed by a TREASURY-class proposal". The residue is therefore a **contingent liability**, and INSURANCE is the reserve against it. Sizing the reserve to it is the only derivation available and the only one that is right: a reserve larger than its liability is idle capital, and one smaller is an unbacked promise. The `min_balance` term is the [03](03-conditional-ledger.md) §7 R-4 floor.

- **USDC** balance **above `T_ins` is surplus and MUST overflow to `MAIN` automatically**, in the same transaction as the inflow that created it, **for every inflow that executes treasury code** — slash proceeds, swept ledger residue, and the E1 fee streams. No governance act, no proposal slot, no crank for those.
- **Direct transfers cannot be intercepted, and the rule does not pretend otherwise (normative; corrected by review, 2026-07-29).** INSURANCE has a deterministic address and `ForeignAssets.transfer`/`transfer_keep_alive`/`transfer_approved`/`transfer_all` are **public** calls ([06](06-governance-and-guardians.md) §3.3 classification), so any account may push USDC to it without any treasury code running. Such a balance sits above `T_ins` until something looks. A **permissionless reconciliation crank** therefore MUST exist alongside the automatic path: it compares the live USDC balance against `T_ins` and moves the excess to `MAIN`, is idempotent, and is a no-op at or below target. The automatic path is the fast path for the inflows the treasury controls; the crank is what makes the bounded-reserve claim true for the ones it does not. Stating "every USDC arrival overflows automatically" without it was unimplementable — there is no interception point.
- **`T_ins` MUST decrement when an archived claim is paid (normative; corrected by review, 2026-07-29).** The counter is named `swept_residue_*unreclaimed*`, and nothing in the earlier rule reclaimed it: it only ever rose. Since [03](03-conditional-ledger.md) §5.4's Merkle-archived claims procedure is what discharges the liability, **that payout path MUST decrement the counter by the amount paid, atomically with the payment**. `sweep_insurance` is *not* that path — it identifies no claim and discharges no liability, so it MUST NOT decrement. **Until the archived-claims procedure is specified in full** (a deliberate v1 compromise, [03](03-conditional-ledger.md) §5.4) the counter is monotone and `T_ins` is an over-estimate: INSURANCE retains more than it owes and less overflows to `MAIN`. That is the safe direction — over-reserving against a liability, never under — and it is recorded as a known conservatism rather than left to be discovered.
- Swept residue raises `T_ins` by its own amount as it arrives, so it never overflows. This is what makes the rule O(1) and self-balancing: the account retains at least what it owes and passes on the remainder.
- `sweep_insurance` is unchanged and remains the **only** way to draw INSURANCE *below* `T_ins`: releasing reserve against a liability that still exists is a decided act, and stays a TREASURY-class one under the `InsuranceSweep` capability.
- **INSURANCE is not an operating buffer** and MUST NOT be re-purposed as one (§10.6). A reserve sized to a liability cannot simultaneously be a buffer sized to an expense; the reserve that carries quiet epochs is the endowment under §10.5.

**NAV effect of the E1 inflows (normative).** Market-fee value, redemption-fee value and transaction-fee value all arrive as liquid USDC in `MAIN` and therefore enter `NavView.total` at par under the §1.2 definition, with no new NAV term and no new haircut. The INSURANCE overflow likewise enters NAV exactly when it crosses into `MAIN`, and by exactly its own amount — the same accounting `sweep_insurance` already has. **No new `NavView` field is required**: the fee streams are not a separate asset class, they are liquid USDC, and the existing `main` field already reports the account they land in. Cumulative fee income is a *diagnostic*, not a solvency input, and is exposed through the monitoring-only `TelemetryApi` of [12](12-release-and-operations.md) §6.3 rather than through the [02](02-integration-contract.md) contract surface — which is why E1 changes `02` for its event and metadata-constant appends but adds nothing to `NavView`.

### 1.3 Outflow controls, streams, meters (carried forward)

- Per-proposal outflow ≤ `trs.cap_proposal` = 5% **spendable** NAV (kernel ceiling 10%); rolling ≤ 10%/30 d and ≤ 30%/180 d of the same base (monotone meters, I-7).
- **Enforcement layering (normative).** `trs.cap_proposal` binds at three layers, and the per-proposal guarantee is the *aggregate* one. The decision engine re-derives a proposal's committed outflow from its own call batch and MUST refuse to qualify or to queue any proposal whose **aggregate** derived ask exceeds `trs.cap_proposal` · spendable NAV; a proposal whose outflow is not statically derivable from its batch MUST fail closed at qualification. The treasury re-checks the cap **per outflow call** at execution, and the rolling meters above bound the chain-wide total. The per-call check is a backstop, not the guarantee — so any class that acquires the treasury-spend capability row of [06](06-governance-and-guardians.md) §3.2, **or** whose `InCapPrize` becomes independently valued (§5.2), MUST be brought under the same decide-time aggregate check. A class granted `TreasurySpend` could otherwise carry many individually-under-cap `spend` calls and never meet the aggregate test.
- Streams mandatory for grants > `trs.stream_threshold` = 1% NAV; linear, recipient-claimable, cancellable by a later TREASURY decision; cancellation reverts the undisbursed remainder to `MAIN`.
- Meter contention: execution waits queued and retries within grace.
- `recover_foreign` (assets sent to pallet accounts outside protocol flows): TREASURY-class only, never admin.

### 1.4 Calls (delta over BE §5.2.7)

Unless a call below says otherwise it requires its stated protocol origin. `fund_budget_line` normally requires `FutarchyTreasury`; its sole Signed exception is §1.1's stored-ops-multisig bootstrap top-up for `OpsReserveProbe`, bounded by the live F+R runway ceiling and permanently closed by the first successful positive `FutarchyTreasury` funding of that line.

`spend(line, dest, amount)`, `open_stream(line, recipient, total, start, duration)`, `cancel_stream(id)`, `claim_stream(id)` (Signed recipient), `fund_budget_line(line, amount)`, `recover_foreign(asset, dest, amount)` — all as before, line-scoped — and **`sweep_insurance(amount)`** (`FutarchyTreasury` origin; INSURANCE → `MAIN` only; emits `InsuranceSwept { amount }`; §1.2, SQ-306), and **`reconcile_insurance()`** (Signed, **permissionless**, milestone E3): it recomputes INSURANCE's derived target `T_ins` (§1.2) and, if the account holds more than that, moves the surplus to `MAIN` and emits **`InsuranceOverflowed { amount }`**. It exists because the automatic overflow runs inside the transaction of an inflow the protocol can *intercept*; a direct `ForeignAssets.transfer` into INSURANCE cannot be intercepted, so without a crank such a balance would sit above target indefinitely. Permissionless for the same reason as the other cranks — it chooses neither source nor destination, both are protocol accounts, and it is a no-op at or below target (G-1). `sweep_insurance` takes no budget line by design: it is an inbound transfer to `MAIN`, not an outflow from it, and like every other protocol-account custody path it **preserves**: INSURANCE is a genesis-endowed permanent account under [03](03-conditional-ledger.md) §7 R-4, so at most `balance − min_balance` is sweepable and an over-large `amount` fails toward the status quo (G-1) rather than reaping the account. **Custody sync (added 2026-07-17, SQ-123):** for lines backed by a dedicated real-USDC custody pot (`KEEPER` and `ORACLE`, the §6.3 rebate pots derived as `bl/trsry` sub-accounts), `fund_budget_line` is custody-synced — the call atomically transfers `amount` USDC from the `MAIN` custody account to the line's pot and fails as a whole (internal credit rolled back) if `MAIN` holds insufficient real USDC, so funding can never make the internal line ledger claim more than its pot holds; **"insufficient" is measured against `MAIN`'s spendable custody, i.e. `balance − min_balance`** — `MAIN` is a genesis-endowed permanent custody account under [03](03-conditional-ledger.md) §7 R-4, so the transfer preserves rather than expends and a funding call that would reap `MAIN` fails toward the status quo (G-1) instead (amended 2026-07-21, milestone B14); the §6.3 try-state drift alarm (line ≤ pot, per payout line) remains as the backstop against every other drift source. Lines without pots keep custody in `MAIN` (their outflow custody wiring is the A9 fungibles follow-up) (every outflow call names a budget line per §1.1; `open_stream` funds the stream from `line` and reverts its remainder there on cancellation; `recover_foreign`'s `amount` allows partial sweeps). New: `issue_vit(amount, line)` (§2.3, `FutarchyTreasury` origin, issuance-metered); vesting-schedule storage (§2.2). The `execute_coretime_renewal(period_index)` call (permissionless Signed keeper, dead-man-freeze exempt per D-9) is specified in [09](09-execution-upgrades-and-rollout.md) §4; its companions (added 2026-07-18, SQ-245/SQ-246 ruling) are `note_coretime_quote(period_index, price)` (Signed, accepted only from the stored coretime quote authority; freeze-exempt), `prune_coretime_quote(period_index)` (Signed: permissionless once the quote's `ops.coretime_quote_ttl` freshness window has expired, quote-authority-anytime otherwise; freeze-exempt), and `set_coretime_authority(quote_authority, renewal_account)` (`FutarchyTreasury` origin) — semantics in [09](09-execution-upgrades-and-rollout.md) §4. Events: `StreamOpened/Claimed/Cancelled`, `BudgetLineFunded`, `VitIssued`, `NavHaircutFlagged`, `ReserveProbeFeeCharged { line, amount }` (the exact `ops.reserve_probe` pre-dispatch debit; rolled back if local send fails), `KeeperBudgetLow { remaining: Balance }` (`remaining` is the metered budget left when the event fires — normally at the §6.3 80% crossing, and the whole remaining budget when Low is force-emitted immediately ahead of `KeeperBudgetExhausted`; both keeper events are diagnostic, drive the RB-KEEPER alarm, and are read by no on-chain decision — neither appears in [02](02-integration-contract.md) §6, so both stay treasury-owned and amendable here without an integration-contract change), `KeeperBudgetExhausted { epoch, spent }` (§6.3), `SlotsShrunk` (§4.4, emitted by the decision engine, [05](05-welfare-and-decision-engine.md)), `NavFloorUnmet` (§4.2, the non-blocking `flag_nav_floor` diagnostic variant), plus `Spent`, `InsuranceSwept { amount }` (§1.2), `InsuranceOverflowed { amount }` (§1.2, the automatic and cranked above-target overflow, E3), `ForeignRecovered`, `CoretimeRenewalCalled`, `CoretimeQuoteNoted { period_index, price }`, `CoretimeQuotePruned { period_index }` and `CoretimeAuthoritySet` ([09](09-execution-upgrades-and-rollout.md) §4).

The `sweep_insurance` call is authorized by the dedicated `InsuranceSweep` capability, not by the broader `TreasurySpend` capability (SQ-384).

Two further calls carry a **PARAM** origin rather than `FutarchyTreasury`, because each spends one fixed genesis allocation pot rather than the ordinary treasury: **`create_community_schedule(beneficiary, amount)`** (`FutarchyParam` origin; the `communty` pot → a named beneficiary's vesting schedule; emits **`CommunityScheduleCreated { beneficiary, amount, start, per_block, remaining }`**; the paragraph below) and **`fund_trading_rewards(amount)`** (`FutarchyParam` origin; the `incentiv` pot → the reward pallet's sovereign account; emits **`TradingRewardsFunded { amount, remaining }`**; §2.6, added 2026-08-10). Both decrement a stored remaining allocation and both are bounded by a lifetime count of successful uses. Neither draws on `MAIN` or any `ops.*` budget line, and neither is reachable through `TreasurySpend`.

---

**Phase-4 community distribution (B20 / SQ-107).** `create_community_schedule(beneficiary, amount)` is one of exactly **two** bounded exceptions to the ordinary treasury-outflow origin — §2.6's `fund_trading_rewards(amount)` is the other, added 2026-08-10, and [06](06-governance-and-guardians.md) §3.2 states the three properties both MUST hold. It is a PARAM leaf, admitted only after the Phase-3→4 arming transition records its exact block, and dispatched with `FutarchyParam`. The source is the genesis-derived `communty` pot; the beneficiary MUST differ from that pot, `amount` MUST be at least the 13 §3.5 minimum vested transfer and no greater than the stored undistributed allocation, and the lifetime successful-schedule count MUST remain below the 13 §4 bound. The runtime calls the SDK `pallet-vesting` `vested_transfer` adapter atomically before decrementing the remaining allocation and incrementing the count. The fixed duration is 24 months in para-blocks; `per_block = floor(amount / duration)` and a zero result fails, so unlocks can never run ahead of the horizon. The arming block is an exact start (no caller-selected start), arming is idempotent, and failures leave both custody and counters unchanged. No direct `vesting.force_*`, signer impersonation, treasury stream, or unbounded schedule list may be used; the per-schedule counter is a lifetime admission bound, not a promise that old completed schedules are deleted.

## 2. Genesis economics (B-14, D-15)

### 2.1 VIT supply and allocation

Total supply **1,000,000,000 VIT, 12 decimals**, fixed at genesis; existential deposit 0.01 VIT *(identity constants: [02](02-integration-contract.md), values frozen in [13](13-parameters.md))*.

| Allocation | Share | Amount | Vesting / control |
|---|---|---|---|
| Treasury reserve | 30% | 300,000,000 | Held in `MAIN`; **marked 0 in NAV**; disbursable only via TREASURY-class decisions post-Phase-5 |
| Community distribution | 25% | 250,000,000 | Linear vest over 24 months from Phase-4 arming *(schedule simulation-gated)* |
| Founding team | 20% | 200,000,000 | **4-year linear vest, 1-year cliff**, from TGE |
| Ecosystem / ops fund | 15% | 150,000,000 | Feeds the `ops.*` lines; per-epoch budgets. Ordinary lines are pre-provisioned by genesis/onboarding until governed funding is live; the ops multisig's only direct allocation power is the runway-capped `OpsReserveProbe` top-up. The first successful positive TREASURY-class funding of that line closes the bootstrap exception; all later funding is TREASURY-class |
| Phase 3–4 incentive programs | 10% | 100,000,000 | Trading/keeper/reporter bootstrap incentives; backstops the reporter loans of §2.5. §2.6 delivers the trading share, exactly as §1.4's `create_community_schedule` delivers the community allocation |

Vesting is enforced on-chain from genesis via SDK **`pallet-vesting`** (stable2606, `=49.0.0`) linear lock schedules on VIT — genesis-configured balances locks, **one schedule per beneficiary with `begin = cliff end`**: nothing is spendable before the cliff — locked VIT cannot even pay transaction fees (beneficiaries pay fees in USDC per §9 until vested) — then the full locked amount unlocks linearly to the end of the vesting horizon. For the founding team that is zero until TGE + 1 year, then linear to TGE + 4 years (the integer per-block unlock floors, so a sub-VIT remainder MAY clear one block after the 4-year mark — rounding is always against the claimant, never ahead of schedule) — everywhere ≤ the idealized `t/4` catch-up-at-cliff curve, i.e. this reading can only unlock *slower* than the alternative, never faster (the conservative direction; a two-schedule catch-up composition is rejected because `pallet-vesting`'s genesis lock is replace-not-accumulate, which would leave the cliff tranche spendable at genesis). Schedules are denominated in para-blocks at the nominal 6 s block time; slower-than-nominal block production delays unlocks and can never accelerate them. *(Resolved at B3: SDK `pallet-vesting` adopted over an in-pallet schedule store — battle-tested lock accounting, genesis-native schedules, permissionless `vest()`; `pallet-futarchy-treasury` keeps only its §1.3 USDC grant streams.)* The community-distribution and incentive allocations, whose schedules cannot start at genesis (Phase-4 arming is not a genesis-known block), are held at genesis in protocol-derived treasury sub-accounts; the community 24-month schedule is created at Phase-4 arming.

**Genesis protocol-account derivations (normative; mirrored in [13 §3.5](13-parameters.md)).** Account identity is derived with Substrate's `PalletId` conversion exactly as follows; a seed is the exact byte string shown, with no padding, normalization or replacement. The VIT allocation pots use `TreasuryPalletId = PalletId(*b"bl/trsry")`: `MAIN` is `TreasuryPalletId::get().into_account_truncating()`, the community pot is `TreasuryPalletId::get().into_sub_account_truncating(b"communty")`, and the Phase-3–4 incentive pot is `TreasuryPalletId::get().into_sub_account_truncating(b"incentiv")`.

Under [03 §7](03-conditional-ledger.md) R-4, `usdc_genesis_endowments()` endows exactly the following thirteen statically derived protocol accounts with exactly the live USDC `min_balance`; the endowment rule is owned there, while this section freezes the account derivations consumed by genesis and deployment tooling:

| Account | Frozen derivation |
|---|---|
| Ledger sovereign | `PalletId(*b"bl/ledgr").into_account_truncating()` |
| Service-ledger sovereign | `PalletId(*b"bl/svclg").into_account_truncating()` |
| `insurance_account()` (`INSURANCE`) | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"INSURANC")` |
| `book_account()` | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"BOOK____")` |
| `pol_account()` (`POL`) | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"POL_____")` |
| `pol_baseline_account()` (`POL_BASELINE`) | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"POL_BASE")` |
| `fee_account()` | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"FEES____")` |
| `treasury_protocol_account()` | `PalletId(*b"bl/ledgr").into_sub_account_truncating(*b"TREASRY_")` |
| `treasury_account()` (`MAIN`) | `PalletId(*b"bl/trsry").into_account_truncating()` |
| `treasury_keeper_account()` (`KEEPER`) | `PalletId(*b"bl/trsry").into_sub_account_truncating(*b"KEEPER__")` |
| `treasury_oracle_account()` (`ORACLE`) | `PalletId(*b"bl/trsry").into_sub_account_truncating(*b"ORACLE__")` |
| `treasury_rewards_account()` (`REWARDS`) | `PalletId(*b"bl/trsry").into_sub_account_truncating(*b"REWARDS_")` |
| `treasury_collators_account()` (`COLLATOR`) | `PalletId(*b"bl/trsry").into_sub_account_truncating(*b"COLLATOR")` |

N9's dynamic client-USDC escrows are deliberately outside those thirteen genesis endowments but
their custody identity is equally fixed:
`PalletId(*b"bl/cdelv").into_sub_account_truncating(client_id: ClientId)` ([16](16-hosted-question-service.md)
§2). A top-up creates the account at or above the live asset minimum; genesis does not.

The set is deliberately exact. Per-market book/fee accounts do not exist until `create_market` and are reaped at close, so they cannot be genesis-endowed. The market, epoch, execution-guard, welfare-settlement, guardian, question-service and both registry sovereign accounts are excluded because [03 §7](03-conditional-ledger.md) R-4 does not name them; question-service and registry payouts deliberately use `Expendable`. The independently instanced service **ledger** sovereign is included because its claimant payouts use `Preserve` exactly like the primary ledger. A derivation or membership change is therefore a genesis/deployment identity change and MUST update this section and [13 §3.5](13-parameters.md) together.

**Where the fee strictness comes from (normative; added 2026-07-20).** "Locked VIT cannot even pay transaction fees" is a property of the **fee-charging path**, not of `pallet-vesting`'s lock metadata. The lock SDK `pallet-vesting` installs carries a withdraw-reason exemption set that a `Currency`-based fee adapter would honor — i.e. under such an adapter unvested VIT *would* pay fees, whatever this document says. The binding requirement is therefore on the adapter: the runtime's transaction-fee path MUST treat a vesting lock as **frozen balance with no fee carve-out**, which is what the `fungible`-based adapters do because that API has no notion of withdraw reasons. Any change to the fee adapter is a change to this rule and MUST be re-proven, not assumed; the runtime pins the behavior with a test that drives the real fee path against a fully locked account and requires it to fail. Stated the other way: the vesting configuration's exemption set is inert under the required adapter, and MUST NOT be read as authorization — if it ever becomes live, this section is violated. The consequence for beneficiaries is unchanged (fees in USDC per §9 until vested), and it is a real dependency: a fully locked account with no USDC fee path configured has no viable fee path at all.

### 2.2 Why 30% reserve is consistent with “VIT marked 0 in NAV”

The reserve exists for values-layer continuity (guardian bonds, conviction depth, future issuance-free grants), not solvency; NAV — the solvency and sizing base — remains USDC-only. No VIT price ever enters NAV, W, or any sizing formula (D-18 reflexivity rule, [05](05-welfare-and-decision-engine.md)).

### 2.3 Issuance mechanism (`iss.inflation_cap`)

- Default issuance schedule: **zero**. VIT is minted only by `issue_vit(amount, line)`, dispatched by a TREASURY-class decision, credited only to `REWARDS` or `ops.*` lines (never to arbitrary accounts).
- Rolling 365-day issuance meter (I-7, monotone): Σ minted ≤ `iss.inflation_cap` × supply-at-window-start; `iss.inflation_cap` = **2%/yr, amendable down only** (kernel bound).
- Every mint emits `VitIssued { amount, line, meter_after }`.

### 2.4 Collator compensation

`collator.comp_epoch` = **500 USDC per collator per epoch** (PARAM-adjustable, *normative value: [13](13-parameters.md)*), paid from `ops.collators` at epoch Housekeeping to the session's registered collators pro-rata to authored-block share. The runtime records one bounded `(collator, authored_blocks)` accumulator for the current epoch (at most the full 120-entry session bound: 100 candidates plus 20 invulnerables); at an epoch boundary the completed accumulator moves into a single bounded pending slot of the same 120-entry bound until its payout settles, so at most **two** such accumulators (current + one pending, 240 entries total) exist transiently. Shares are computed with claimant-adverse floor rounding and the line is debited once. A missing/underfunded line or custody pot is fail-soft: the accumulator remains pending for a later Housekeeping retry, and a successful payout clears it atomically with the custody transfers; there is no second payout for the same epoch. Launch load: 5 invulnerables ⇒ **2,500 USDC/epoch ≈ 43,482 USDC/yr** — 0.17 % of the 25M initial treasury per year; sustainable without issuance. ~~10,000 USDC/epoch ≈ 174,000 USDC/yr~~ was the figure at the superseded 2,000 seed.

**The value this row pays is anchored externally, and the fail-soft clause above does NOT protect it (normative; added 2026-07-31, milestone E5, SQ-536; clause (3) corrected the same day after review).** `collator.comp_epoch` is the one [13](13-parameters.md) §1 default that is a **market price** rather than a derivation, and its error direction is unsafe downward — underpaid collators stop authoring. It is seeded at the registry **minimum** on the strength of published, governance-approved evidence for the same role (Polkadot OpenGov referendum #1870: 38 system-parachain collators at $250/collator/month, $307.24 fully loaded, i.e. **211.97 USDC/epoch** against this row's 21.0-day epoch — so 500 carries a **2.36×** margin and the superseded 2,000 was **9.44×**). The comparison holds because a collator here earns **nothing** from fees or tips (§9 burns collected VIT fees), exactly as a treasury-funded system-parachain collator does.

**The distinction the preceding paragraph's fail-soft clause does and does not cover.** That clause catches a **funding** failure — the line or custody pot cannot pay the pool the configured value implies — and preserves the claim for a later retry. It does **not** cover a **pricing** failure: if the configured value is below what operators accept, the pool is computed from that value, the payout succeeds in full, the accumulator is cleared, and no unpaid difference is retained. An earlier revision of this section cited the first to justify the second; that was wrong, and underpricing degrades to collators leaving rather than to a delayed payment. What bounds the low direction is the 2.36× margin, fast recovery at ×2 per amendment on a 1-epoch cooldown, and the **pre-launch gate** [13](13-parameters.md) §1 places on *every* collator set including the invulnerable launch one — enforced by the `collator.rate_unverified` release blocker rather than by prose — invulnerability governs selection, not willingness to author, so it is not protection from the market rate either (a second correction of the same shape, made the same day). Full derivation, margin, gate and the recorded monitoring gap (SQ-537): [13](13-parameters.md) §1.

### 2.5 Initial USDC treasury and funding sequence

- HRMP to Asset Hub opens Phase 2 (Paseo) / Phase 3 (Polkadot); initial USDC transferred in before Phase-4 arming (BE §27.4 carried forward).
- **Funding target: ≥ 25,000,000 USDC before Phase-5 (TREASURY) arming** (D-15). Adequacy arithmetic against the §4 floors:
  - Phase-4 (binding PARAM): full 5-slot PARAM epoch needs NAV ≥ 5 × 34,657 / 0.75% ≈ **23,104,906 USDC** — the Phase-4 **slate-capacity target**, distinct from the ≥ 25,000,000 USDC funding target above. The §4.2 arming gate itself is the per-class 1 × PARAM floor of §4.1; this larger figure is what makes a *full* five-slot slate viable inside one epoch's budget.
  - At 25M NAV the per-epoch POL budget is 0.75% × 25M = **187,500 USDC**, which fits a full five-PARAM slate (**5 × 34,657 ≈ 173,287 USDC**) or a mixed 1 CODE + 2 PARAM slate at the same commitment, both ≤ 187,500 ✔ (the Baseline book is funded outside this budget, §4.3).
  - 25M > 13.87M = the one-CODE floor, so Phase-6 arming is reachable without further funding **if** NAV has not decayed; the §4 gate re-checks at arming time regardless.

**Reporter-stake bootstrap (B-15-adjacent sequencing, D-15).** Phase-3 arming requires ≥ 3 registered reporters with full `orc.reporter_stake` = 100,000 USDC stakes. The treasury MAY extend **recallable USDC loans** (per-reporter ≤ 75,000 USDC, line backstopped by the 10% incentive allocation) held directly as reporter stake, never withdrawable by the reporter. The reporter MUST post ≥ 25% (≥ 25,000 USDC) of own capital, and **slashing consumes the reporter's own tranche first** — a loan with no reporter skin would deter nothing. Loans are recallable by TREASURY decision or automatically on reporter exit/ejection. Bootstrap line sizing: 3–5 reporters × 75,000 = 225,000–375,000 USDC.

Welfare cold start (`PriorBounds`, epochs 1–12 winsorization) is specified in [05](05-welfare-and-decision-engine.md) (D-15).

### 2.6 Trading accuracy rewards — the incentive pot's delivery mechanism (normative; added 2026-08-10)

The §2.1 allocation names *"Trading/keeper/reporter bootstrap incentives"* and had no delivery
mechanism for the trading share. This subsection is that mechanism. It pays VIT for **realized
forecast accuracy**, and every value it uses is either an existing key or `rwd.rate`
*(normative values: [13](13-parameters.md))*.

**The funding source is the pot, never new issuance.** The program spends the genesis
`incentiv` pot of §2.1 and mints nothing. Three reasons make issuance the wrong instrument
here. The pot already holds the money. `issue_vit` cannot pay a trader at all, because §2.3
credits only `REWARDS` and the `ops.*` lines, which are budget lines rather than accounts. And
`iss.inflation_cap` is amendable **down only**, so spending it on a bootstrap program burns a
one-way resource reserved for cases with no funded alternative.

**Funding one epoch budget at a time.** `fund_trading_rewards(amount)` is a bounded PARAM leaf
that mirrors §1.4's `create_community_schedule`, and it carries the same exception: it moves VIT
out of a treasury-derived pot without being a general treasury-outflow capability
([06](06-governance-and-guardians.md) §3.2). The source is the `incentiv` pot and its stored
remaining allocation. The call transfers VIT to the reward pallet's own sovereign account. An
`amount` above the remaining allocation is refused, and the lifetime successful-authorization
count MUST stay below the bound the *Bounds* paragraph below places on it, exactly as
§1.4's community schedule count does. Unspent budget returns to the pot at
epoch close, so the pallet never accumulates. The per-epoch budget is a call argument rather
than a registry row, which is why the program adds exactly one key. "Program epoch" throughout
this subsection means the protocol epoch of `epoch.length`. The program adds no second clock.
Its resource-domain family key is [05](05-welfare-and-decision-engine.md) §1.4's `0x0D`.

**The bond, and the two separate jobs it does.** `enroll(bond)` holds USDC and opens a
participant record. `top_up_bond(amount)` raises the hold. `withdraw_bond()` releases it. The
bond is denominated in **USDC** rather than VIT, because the only externally signable VIT at
genesis is the founding and ops allocation, and a VIT bond would restrict the program to
insiders. The **earning cap** does the anti-farm work, and the **minimum bond** only prevents
state bloat. `ledger.pos_dep` already prices an entry against bloat, so the minimum reuses that
live row and adds no key.

**Two rules make the bond a real backstop rather than a formality, and both are load-bearing.**
An epoch's cap is fixed by the bond held when that epoch opened, and that amount stays held
until the epoch settles. First, `withdraw_bond` is gated on **epoch settlement**, never on
folding: folding deletes the last score entry while the debit settles at epoch close, so a
fold-based gate would let a participant who folded a losing epoch release the whole bond ahead
of the debit. Second, a top-up takes effect from the **next** epoch: an immediate cap raise
would let a wash operator wait for the outcome, enlarge only the winning account's cap, and
leave the loser at the minimum. No caller-visible action inside an epoch can move either side.

**The score.** Per enrolled account, per market, the book accumulates three unsigned counters and
the net branch position. Unsigned counters keep signed arithmetic out of runtime code and make
claimant-adverse rounding straightforward.

1. A buy adds `cost + fee` to `spent`, rounded up, adds the filled quantity to `book_acquired`
   for that branch, and adds `cost` to **`mirror_principal`** — the mirror-branch branch-USDC the
   trade wrapper leaves with the buyer *(added 2026-08-10, SQ-1051; the paragraph after rule 4
   is why)*.
2. A sell adds proceeds **net of the fee the book withholds** — `proceeds − fee` — to `received`,
   rounded down, **but only for the part of the sale covered by `book_acquired`**, and decrements
   `book_acquired` by that quantity. Proceeds beyond it are ignored. *(Clarified 2026-08-10,
   SQ-1049's sibling SQ-1048: this rule said only "adds proceeds" while rule 1 spelled its arm out
   as `cost + fee`, and the two readings differ by the fee on every sale. Net is what the seller
   actually received. Crediting the gross figure would score a trader on value the protocol took,
   which is the one rounding direction R-7 forbids, and it would break the symmetry with rule 1 —
   a buy is charged more than the book cost and a sale is credited less, so the fee is adverse on
   both sides.)*
3. Settlement adds `min(position, book_acquired) × settled_value` to `received`, rounded down.
   `settled_value` is the branch's terminal redemption value per unit.
4. The market score depends on how the branch ended, and it may be negative.
   - **Branch realized:** `received − spent`.
   - **Branch annulled:** `mirror_principal − spent`. Every `received` credit is discarded.
   - **Proposal VOID:** the entry drops at zero and folds to nothing, exactly as the timeout
     escape below does.

**Rule 4 has three arms because a conditional market pays a buyer in two currencies, and only one
of them survives (added 2026-08-10, SQ-1051).** The score is denominated in plain USDC. A buy
spends plain USDC, but everything the buyer receives is *conditional*: the trade wrapper splits
`cost + fee` of plain USDC into both branches, sends `cost` of the traded branch to the book and
one fee leg from each branch to the fee account, so the buyer walks away holding the scalar
position **and `cost` of mirror-branch branch-USDC**. A sale is paid in traded-branch
branch-USDC, not in plain USDC. So `received` and `mirror_principal` are worth par in exactly
opposite states of the world, and a single-arm rule has to be wrong in one of them.

A one-arm `received − spent` is wrong in the annulled state, and not marginally.
[04](04-markets-and-pricing.md) §6.2 guarantees the opposite outcome as **G-3**: *"A buyer in the
losing branch holds `cost` mirror-branch branch-USDC = winning-branch branch-USDC, redeemable at
par at resolution. The dominant user path therefore loses only fees when its branch is
annulled."* Under the one-arm rule that buyer scores `−(cost + fee)` — the whole notional — while
their realized loss is `fee` alone, roughly one three-hundredth of it at the `mkt.fee` default.
Roughly half of all decision-market trading sits in the branch that does not realize, so the
program would have debited the bonds of accurate traders for holding positions the protocol had
already made whole. That is the opposite of what this subsection pays for, and no defense
elsewhere would have caught it, because every conservation identity and every per-call assertion
holds while it happens.

The annulled arm is exact rather than conservative. Substituting rule 1 gives
`mirror_principal − spent = Σcost − Σ(cost + fee) = −Σfee` over that market's buys, which is
G-3's promise restated. Discarding `received` is what makes it exact: those credits are
traded-branch branch-USDC and are worth nothing once the branch is annulled, so a sale in an
annulled branch neither earns nor costs — matching §6.2's reading that a withheld sell fee there
is a protocol-side income haircut and never a trader-side charge. Both arms stay claimant-adverse
under R-7, since each discards value the trader did not realize rather than crediting value they
did not receive.

**Proposal VOID drops the entry instead of scoring it**, because VOID is a constitutional
emergency rather than a resolved forecast: [04](04-markets-and-pricing.md) §6.2 notes the buyer's
delta there also carries the difference between the package's D-1 neutral value and `cost`, so
neither arm above states it, and no forecast was tested in any case. Dropping at zero is the
same disposition, and the same G-1 direction, as a market that never settles at all.

**`book_acquired` closes a hole rather than accepting a limit.** [03](03-conditional-ledger.md)
gives an account the whole `split*` family and a signed `transfer`, so an enrolled account can receive
a complete branch set created outside the book, sell every leg, and post the whole proceeds
against a `spent` of zero. That manufactures a positive score with no forecast in it and no
dependence on the outcome. Counting only book-acquired units closes it inside the market pallet.
The direction of error is conservative: a trader who funds a position off-book is
under-credited, never over-credited, which is the R-7 direction.

**Both settlement steps are pull-based, and there are exactly two.**
`settle_market_score(who, market)` folds one settled market into the account's epoch total and
deletes the entry. `settle_epoch(who)` then closes one participant's epoch, applying the reward
and debit arithmetic below exactly once. Both are permissionless and both name a target account
rather than the caller, which is safe because each acts only on already-recorded values: any
caller reaches the same result and no caller can choose it. Neither is a hook. No hook iterates
a collection, and [03](03-conditional-ledger.md) §10 keeps its rule that the ledger has no
hooks. The keeper cranks both ([01](01-system-overview.md) §4.2).

`settle_epoch` MUST be idempotent per participant per epoch, MUST refuse an epoch that has not
closed, and MUST refuse while that participant still holds an unfolded score entry for the
epoch — otherwise a partially folded account would settle on part of its own score, which is the
one ordering in which a losing epoch pays a reward.

**Reward and debit, both computed in USDC.** `settle_epoch(who)` applies the following at epoch
close, over that participant's folded markets, with `r` the live `rwd.rate`:

```
net     = epoch_received − epoch_spent               // USDC
cap     = snapshot_bond / (r × rate_headroom)        // USDC
scored  = clamp(net, −cap, +cap)                     // USDC

scored > 0  →  accrue  r × scored  USDC-denominated, paid in VIT at claim
scored < 0  →  debit   r × |scored|  USDC from the snapshot bond
```

`rate_headroom` is the **top of the `fee.vit_usdc_rate` envelope**, which §9 and
[13](13-parameters.md) §1 already fix at 10× the kernel reference. It is a restatement of an
existing bound and not a new constant.

**What the headroom is for, stated precisely, because the obvious reading is the wrong one.**
Converting at claim time already makes the payout worth the accrued USDC figure at that
moment's **governed** rate, so a market reprice between accrual and claim is **not** the
exposure. The exposure is the **governed rate diverging from the market price**, and only in one
direction: a rate that understates VIT hands the claimant more real value than the debit took.
The envelope's width bounds that divergence, so sizing the cap against the top of the envelope
is what keeps reward value at or below debit value. The cost is a conservative cap, and the
alternative is an invariant a governed price can open.

**Both legs are USDC, and only the payout converts.** `claim_rewards()` converts the accrued
USDC figure to VIT once, at the live `fee.vit_usdc_rate`, rounding against the claimant, and
transfers with no vesting. Computing the reward in VIT while debiting in USDC would compare two
different units and would make the anti-farm invariant depend on the VIT price, which is exactly
the reflexivity §2.2 and D-18 keep out of every sizing formula.

Four further rules bind the settlement, and each is a G-1 direction rather than a preference.

- When accruals exceed the authorized budget, **the reward is clamped to the budget's unpromised
  remainder at the rate `r`, and the debit is never reduced by budget pressure** *(amended
  2026-08-10; this bullet required both legs to scale by one factor, and that rule is neither
  implementable here nor safe in any approximation of it)*. Two things defeat the original. **The
  factor does not exist at settlement time:** settlement is pull-based and per-participant, so an
  epoch's total accrual is unknown until the last participant settles, and there is no moment at
  which one `k` could be applied to both legs. **Every per-call approximation of `k` is
  orderable:** a wash operator settles the winning account while the budget is full and takes
  `k = 1`, waits for other participants to exhaust it, then settles the losing account into a
  headroom of zero and takes `k = 0`. The pair nets `+r × scored` — the exact failure the scaling
  rule existed to prevent, reached through the rule itself. The two legs also draw on **different
  pots**, the reward on the authorized VIT budget and the forfeit on `INSURANCE`, so no
  conservation identity ever linked them. The clamp keeps this bullet's second protection intact:
  the rate stays fixed at `r`, so a reward is never more than `r × scored` and no pair can draw
  budget out of proportion to its own score, which is what a pro-rata reward at no fixed rate
  would have allowed. It gives up the first: under budget pressure a losing participant pays in
  full while a winner is clamped. That is the R-7 direction — over-punishing cannot create an
  unbacked claim, and under-punishing funds the farm.

  **What this bullet does *not* do, stated because an earlier revision of it claimed otherwise.**
  Nothing here makes a wash pair net non-positive. The clamp can only lower a reward, never raise
  one, so it cannot open a hole — but the forfeit is sized by the *losing* account's own cap, the
  operator chooses both bonds, and at unequal bonds the pair nets positive with no budget pressure
  involved at all. That invariant rests on the rate coupling `rwd.rate ≤ 2 × mkt.fee / 0.99` and
  on nothing else, as the *rate* paragraph below sets out. Between 2026-08-10 and the correction on
  the same day this bullet said "no pair in a thin epoch can take the whole budget against a fixed
  small forfeit", which is the retired earning-cap claim in a fifth location — added, at that, while
  the four known instances were being corrected.

  **The residual is that a thin budget is first-come-first-served**, so a late settler may receive
  less than `r × scored`. The ordering is **choosable rather than accidental**: the participant who
  gains most from settling first is exactly the one who already knows their own score, and a wash
  operator holding both sides can pre-sign at the epoch boundary and take the whole budget. It
  stays a fairness cost rather than a solvency one, and it is not free — capturing a budget `B`
  requires at least `B × rate_headroom` in held bonds and pays the full unscaled debit plus the
  wash fee spread, so the attacker spends more than they take. Governance's remedy is to authorize
  a budget that covers the epoch.
- A debit never drives the bond below zero. It takes the whole bond and suspends the participant
  until they top up. **Suspension suspends scoring, and the accumulator MUST test the suspension
  flag rather than infer it from a nonzero bond** *(added 2026-08-10, SQ-1050)*. The two are not
  the same condition. A top-up clears the flag only at the minimum bond `enroll` already demands,
  so a **sub-minimum** top-up leaves a suspended participant holding a nonzero bond, and a gate
  reading the balance alone would resume scoring while the flag says otherwise. The bond must be
  tested as well, because a voluntary `withdraw_bond` leaves a retained record at zero bond and
  never sets the flag. The admission condition is therefore **both**: a nonzero bond and no
  suspension. Stating it as a conjunction rather than deriving one side matters, because the
  earning cap is *not* a backstop here — a zero cap makes a reward round to zero, which is an
  arithmetic accident of the floor rather than a refusal, and it is the argument this subsection
  already retired once.
- Forfeited USDC goes to `INSURANCE`, the standing destination for USDC taken from an account
  (§1.2, §1.4).
- Accrued reward is paid from the authorized budget alone. The program never draws on `MAIN`.

**The rate is `rwd.rate`, and it is derived from the wash arithmetic.** A reward paid only to
correct traders is farmable, because the market payoff is symmetric and a bonus on the winning
side alone removes the loss half. Two accounts under one operator supply both sides, and
`phase3.dep_cap` makes splitting across accounts ordinary Phase-3 behaviour. Writing `f` for the
per-leg fee rate and taking the worst case, an extreme price where the winning leg's profit
approaches the whole notional `q`, the pair collects `r × 0.99q` against fees of `2fq`. The
break-even rate is therefore `2f / 0.99`, which is 60.6 bps at the `mkt.fee` default. The
adopted 25 bps sits 2.4× inside it *(normative value: [13](13-parameters.md) §1)*.

**Two independent defenses, and the second one has a boundary.** The bond is rate-independent
and holds at any rate. The rate defense holds only while the fee stays at or above
`r × 0.99 / 2`, which is 12.375 bps per leg, and `mkt.fee` is PARAM-amendable down to 5 bps. At
that floor the break-even falls to about 10 bps and the adopted rate becomes farmable on rate
alone. Nothing breaks, because the bond still covers it, but a fee amendment would silently
retire a defense this subsection relies on. That is why the unsafe direction of `rwd.rate` is
upward and its ceiling stays conservative.

**Why accuracy is nonetheless the right target.** Settlement follows the oracle's reading of the
real outcome rather than the market price. An attacker who moves a decision price holds a
position that loses at settlement, forfeits bond, and collects nothing. Every other reward shape
pays the manipulator alongside everyone else, and this one charges them twice. The open interest
the program attracts is real capital an attacker must overcome, so §5.2's `L̂` rises honestly.

**Failure behaviour (G-1, R-7).** An unset `rwd.rate` fails `enroll` closed with a typed error,
before any hold. An exhausted budget clamps the reward and leaves the debit whole, so nothing
strands and the pot never overdraws. A debit above the bond takes the whole bond and suspends. An
arithmetic edge is a no-op. A fill in a market beyond the per-account score-entry bound **records
no score and never rejects the trade**, because refusing a lawful trade to protect a rewards bound
is the wrong direction under G-1.

**An unset or zero `rwd.rate` also discharges every outstanding debit, and that is a real cost of
the G-1 direction rather than a side effect worth leaving unsaid** *(added 2026-08-10)*. A zero
rate gives a zero earning cap, so `settle_epoch` closes at `Neutral`: a loss already folded into
the epoch accumulator is forgiven in full and the bond is released untouched. The alternative is
worse — refusing would hold a participant's bond behind a governed row they cannot move, which is
the one thing the *bond MUST NOT be locked forever* rule below forbids — so the behaviour stands.
But note the direction. [13](13-parameters.md) §1 calls a zero rate "off, the safe direction",
and that is true only of *new* scoring; for scores already folded it is the under-punishing
direction this subsection names as the one that funds the farm. Reaching zero by amendment takes
roughly 22 steps at the row's one-doubling max-Δ and one-epoch cooldown, so the reachable one-shot
path is an unreadable row, which the provider maps to "unset".

**A market that never settles MUST NOT lock a bond forever.** The escape is an **absolute
block-height timeout measured from the score entry's creation**, independent of the market's
state. On expiry the entry drops at zero and stops blocking withdrawal. Anchoring the escape to
`ledger.archive` instead would be circular: [03](03-conditional-ledger.md) §5.4 admits the
archive sweep only once the vault is terminal, and a market that never settles never becomes
terminal, so the escape could never fire in the one case it exists for. Dropping at zero is safe
for two reasons. The timeout is sized above the longest lawful settlement horizon, so no
settling market can reach it. And settlement is oracle-driven, so no participant can push a
market past it.

**Bounds.** Four bounds constrain the program, and [13](13-parameters.md) §4 is the home of
each value: the lifetime count of budget authorizations, the participant set, the per-account
set of unfolded score entries, and the absolute lifetime of one score entry. Each value is
written into §4 with the call that enforces it, so the [15](15-invariants-and-testing.md) §4.6
coverage registry can bind it to a real dispatch-past-limit test rather than to an exemption.
The sizing rules are fixed here, and they are what a §4 row MUST follow.

- The **authorization count** reuses the community schedule's lifetime bound. Completed
  authorizations do not replenish it.
- The **participant set** reuses the same sibling bound, for the same reason: it caps a
  permissionless roster against one bounded allocation pot.
- The **per-account score-entry bound is `MaxLiveMarkets`**, because a score row tracks an open
  book. `MaxPositionsPerAccount` is the wrong anchor and MUST NOT be used. It counts
  simultaneous nonzero ledger entries, while a score row lives from the first fill until the
  fold, so a trader who sells out of a market frees the ledger slot and keeps the score row.
  Sequential trading across the settlement lag would then hit a bound derived from a quantity it
  does not measure. `MaxLiveExternalMarkets` is **not** added to the anchor, and the reason is the
  exclusion above rather than an omission: an external fill records no score, so no score row can
  exist for one. The anchor is therefore exact, not merely conservative.
- The **score-entry timeout** sits above the longest lawful settlement horizon, per the escape
  above.

**Only primary books are scored, and the hosted service is excluded on purpose (added 2026-08-10,
SQ-1049).** A fill in a `BookKind::External` book records nothing. The exclusion is decided where
the book is already loaded, so it costs no storage read, and it is not a sizing choice.
[16](16-hosted-question-service.md) §6.5 states that a client controlling a majority of its own
named attestors can move the settled value, declines to repair it, and bounds what that costs:
*"the blast radius is that question's own escrow, minus forfeited bonds, with Bleavit's ledger
instance and every Bleavit market untouched."* Paying an accuracy reward on such a book would
break that bound, because the same client could convert an accepted, self-funded residual into a
claim on the `incentiv` pot — risk-free, since neither defense reaches it. The bond does not,
because a client who sets the outcome never loses. The rate coupling does not, because there is no
offsetting loser to pay the other half. Two further reasons agree on their own. The pot buys
Bleavit's **own** decision liquidity, which is the `L̂` argument below, and an external book raises
no `L̂` while its client already pays `svc.fee_bps` for the venue. And rule 3 has no source for
`settled_value` on an external book, which settles through the separate service-ledger instance
this subsection never reads. Should the hosted service ever want a trading incentive, it is the
client's fee that must fund it, not this pot. [14](14-threat-model.md) carries this as **TH-79**,
separately from TH-78's wash farm, because the two share no defense.

**Scope.** Audit scope A is not opened. The conditional ledger is not touched, and no hook is
added where [03](03-conditional-ledger.md) §10 says there is none.
[04](04-markets-and-pricing.md)'s book reports each fill through a loosely-coupled trait, so the
book never depends on the reward program. `pallet-futarchy-treasury` keeps custody authority
over the incentive pot, as it does for the community pot.

**Three accepted costs, stated rather than discovered later.** Every trade pays one extra
storage read, including trades by accounts that never enroll, because the book must check
enrollment before it can skip the accumulator, and that read enters the trade weight. Off-book
inventory earns nothing, per the `book_acquired` rule above. And the earning cap is conservative
by the width of the rate envelope, so a participant at the reference rate earns on less score
than their bond would otherwise support.

---

## 3. POL commitments per proposal (recomputed per D-10)

Book inventory per class under the reconciled bound of ≤ 6 books/proposal (2 decision + 4 gate; *bounds normative in [13](13-parameters.md)*). The **POL commitment** charged to `pol.budget_epoch` is the worst-case subsidy loss, Σ over the proposal's books of `b·ln 2` (per-book worst-case maker loss, I-12) — deliberately conservative: only the realized branch's books can actually lose, but the budget meter charges both branches.

| Class | Books | Commitment formula | Commitment (USDC) |
|---|---|---|---|
| PARAM | 2 decision + 4 gate | (2 × 10,000 + 4 × 7,500) × ln 2 = 50,000 × ln 2 | **34,657** |
| TREASURY (all ask sizes) | 2 decision + 4 gate | (2 × 25,000 + 4 × 7,500) × ln 2 = 80,000 × ln 2 | **55,452** |
| CODE | 2 decision + 4 gate | (2 × 60,000 + 4 × 7,500) × ln 2 = 150,000 × ln 2 | **103,972** |
| META | 2 decision + 4 gate | (2 × 100,000 + 4 × 7,500) × ln 2 = 230,000 × ln 2 | **159,424** |
| Baseline (per epoch) | 1 | 25,000 × ln 2 (`pol.b_baseline`, §4.3) | **17,329** |

Cash seeding at book creation additionally carries the per-book `headroom` margin ([04](04-markets-and-pricing.md) sizes it); seeding mechanics — one `split`, per-branch `split_scalar` into complete sets — are the per-branch walk of §8 and [03](03-conditional-ledger.md). Committed POL withdraws at settlement; realized cost is the live-branch divergence loss only (≤ half the commitment; the §11.10-equivalent worked example is ≈ 180 USDC for a TREASURY book walked 0.5 → 0.56 — corrected value, frozen in [13](13-parameters.md)).

---

## 4. Minimum-viable NAV and the loud phase gate (B-18, D-15)

### 4.1 Per-class NAV floors

With `pol.budget_epoch` = 0.75% NAV, seeding one proposal of class K requires NAV ≥ commitment(K)/0.0075:

| Gate | Requirement | Floor (USDC) |
|---|---|---|
| 1 × PARAM | (50,000 × ln 2) / 0.0075 | **~4,620,989** |
| 1 × TREASURY (all ask sizes) | 55,452 / 0.0075 | **7,393,600** |
| 1 × CODE | 103,972 / 0.0075 | **13,862,944** (~13.9M — the D-15 “one CODE ⇒ ≥ ~14M”) |
| 1 × META | 159,424 / 0.0075 | **21,256,533** |
| Full 5-slot PARAM epoch | (250,000 × ln 2) / 0.0075 | **~23,104,906** |
| 5 concurrent META (worst slate) | 797,119 / 0.0075 | **106,282,533** (~106M) |

**Rounding and tolerance (normative).** The four class floors are **frozen constants**, not quantities an implementation re-derives at read time: the treasury MUST return exactly the values above. They were computed from the §3 commitments at `pol.budget_epoch` = 0.75%, but they do not share one rounding convention — TREASURY and META divide the whole-USDC-rounded commitment, CODE divides the exact commitment, and PARAM sits ~7.8 USDC above its own exact quotient. What is normative is the **direction** and the literals themselves: every class floor is at or above the exact requirement `commitment(K)/0.0075` — residuals PARAM +7.80, TREASURY +30.07, CODE +0.39, META +19.46 USDC — so the §4.2 gate is never more permissive than the arithmetic demands. Conformance testing MUST reproduce the frozen literals **exactly**; a differential harness that re-derives them MUST case-fit the per-class convention above before comparing, and MAY then allow a ±10 USDC display tolerance. A single re-derivation compared against all four rows satisfies **no** convention — the TREASURY and META residuals alone exceed that tolerance — and MUST NOT be used. The two multi-slot rows are **capacity** figures, not §4.2 arming gates: arming is per class and evaluates the four single-class floors above, while a full slate's viability is governed by §4.4 shrink-to-fit against the live per-epoch budget. Those two rows floor at different stages — 5×PARAM floors the quotient, 5×META the commitment — and both sit marginally *below* their exact requirements (−0.02 and −34.69 USDC); they gate nothing, so the at-or-above direction does not apply to them. The treasury additionally returns the META floor for the market-less `Constitutional` class, defensively — outside this table's closed list ([05](05-welfare-and-decision-engine.md) §5.6). §2.5 uses the five-slot PARAM figure as the Phase-4 *slate-capacity* target for exactly that reason — it is the NAV at which a full PARAM slate fits, not the NAV at which the class arms.

**Freeze and re-derivation (normative).** Because the floors are frozen, they do not track the keys they were derived from. A decision that **lowers `pol.budget_epoch` or raises any `pol.b`** invalidates this table in the *unsafe* direction: the true floor rises above the frozen literal, and §4.2 would then arm a class below its real minimum-viable NAV. Because the floors are compile-time constants, **no governance artifact can move them** — re-deriving on paper does not change what the runtime enforces. Such a decision is therefore safe only when paired with a **CODE** proposal that updates the literals. **How that is enforced (normative; SQ-303 resolution, 2026-07-26).** The screening obligation [13](13-parameters.md) §5 item 6 attaches to `pol.budget_epoch`, `pol.b_gate` and the four `pol.b` class keys is evaluated **by value, not by direction**: `constitution.set_param` re-derives the §3/§4.1 floors from the proposed parameter set and refuses exactly when one would exceed the frozen literal, rounding the derived floor up. It is still not a mechanism that re-derives anything — the literals move only by CODE — but it is what makes the pairing usable rather than a convention: a direction test refuses the values change even after the paired CODE has landed, whereas a value test admits it precisely when the literals have become right. `pol.b_baseline` is outside this screen, because §4.3 keeps the Baseline book outside the §4.1 floor arithmetic entirely.

### 4.2 The gate rule (normative, loud)

**Arming a proposal class (at a rollout phase gate, [09](09-execution-upgrades-and-rollout.md)) REQUIRES published `spendable NAV` ≥ the class floor of §4.1.** The check is explicit, machine-evaluated, and **loud**: an arming attempt below floor is refused, the arming bits are left exactly as they were (fail-static, G-1), and the dispatch **fails** with the module error `NavFloorUnmet`. That extrinsic failure is the loud, durable signal — the runtime surfaces it to operators and the frontend as `system::ExtrinsicFailed` for a directly-submitted extrinsic, or as the dispatching pallet's captured-`Err` result event otherwise (bootstrap sudo's `Sudid { Err(NavFloorUnmet) }` on the [09](09-execution-upgrades-and-rollout.md) §5.4 arming path; the scheduler/track dispatch's result event thereafter) — never silently. FRAME cannot both deposit a pallet event **and** return the error from one dispatch — the `Err` rolls any in-dispatch event back — and leaving the arming bits unchanged is precisely what requires the `Err`; so on this **blocking** path the durable signal is that extrinsic failure, not a pallet event (SQ-381 resolution, 2026-07-22). The field-carrying `NavFloorUnmet { class, nav, floor }` treasury event remains available on the non-blocking, `Ok`-returning `flag_nav_floor` variant — for diagnostic pre-checks and the §4.4 "reject as deferred" path, where the event survives — and the `nav()` view exposes `floor(class)` values so the FE can render distance-to-floor continuously (the class the caller tried to arm plus `nav()`/`floor(class)` recover the full `{ class, nav, floor }` triple that the bare module error omits). Below ~13.9M NAV the chain **cannot pass its own runtime upgrades** — this fact is now surfaced, never silent. That figure is a *necessary* condition, not the arming threshold: [02](02-integration-contract.md) §7.3 allocates **one** `PhaseFlags` bit (bit 3) to CODE and META together, and [09](09-execution-upgrades-and-rollout.md) §7.1 arms both classes at the same Phase-6 gate, so the single bit can only be set when **every** class it arms clears its own §4.1 floor. The binding value for bit 3 is therefore **META's 21,256,533 USDC**, not CODE's 13,862,944 (SQ-382 resolution, 2026-07-24; the alternative — splitting bit 3 into per-class arming bits — was refused because it changes a frozen 02 surface, and hence the integration contract, to buy nothing but an earlier CODE arming that the shared Phase-6 gate would not use). CODE's floor still governs on its own wherever a class-scoped check reads it, including the `nav()` view's per-class `floor(class)` values. Under the §1.2 reserve-health flag, `spendable NAV = 0` and every gate fails (fail-static).

### 4.3 The Baseline book is funded outside `pol.budget_epoch`

`pol.b_baseline` = **25,000 USDC** (default; **simulation-gated — [VERIFY via Phase-0/3 calibration]**), commitment 17,329 USDC per instantiated Baseline book from the dedicated `POL_BASELINE` line. There is no separate four-book meter: Baselines share `MaxLiveMarkets = MaxPolCommitments = 196` with proposal books while their archived rows share the independent `MaxStoredMarkets = 2,240` retained-book envelope. Creation fails status-quo if active capacity, retained capacity or treasury funding is unavailable; first terminal observation releases the POL commitment and active slot even though the readable book remains archived. The **logical** Baseline welfare/funding obligation is standing, but the physical book and vault are instantiated lazily during Seed when the first qualified proposal opens markets; an epoch with zero qualified proposals has neither and incurs no Baseline book charge. This does not let proposal subsidies crowd out Baseline funding: any epoch that opens a Baseline uses the dedicated line outside `pol.budget_epoch`, and the one-book-per-epoch capacity derivation remains conservative. The Baseline TWAP is the reject-leg floor input whenever a decision exists; if no book is opened, [05](05-welfare-and-decision-engine.md) §5.3 carry and §7(6) no-op rules apply. Its manipulation resistance must be at least mid-class, hence the TREASURY-tier `b`. This keeps the Baseline commitment outside the §4.1 proposal-class floor arithmetic while its live obligation still enters NAV. Ledger home and settlement path: [03](03-conditional-ledger.md)/[04](04-markets-and-pricing.md) (B-3).

### 4.4 Slots shrink to fit — with an event

Shrink-to-fit stays: if the epoch's qualified slate's total commitment exceeds the POL budget, slots are dropped in reverse bond-priority order until it fits. Every shrink emits `SlotsShrunk { epoch, requested, funded, dropped: Vec<ProposalId> }` and the affected proposals reject as deferred (bond treatment per [06](06-governance-and-guardians.md)); the FE MUST surface shrink events on the epoch dashboard ([11](11-frontend-workflows.md)). Silent zeroing of upgrade capacity is thereby eliminated: capacity loss is always an event plus a rendered NAV-floor distance.

**Reruns are not budget-charged (normative).** A T13 rerun's additional POL ([05](05-welfare-and-decision-engine.md) §2.1, T13: books reopen at 2× POL) is **not** charged against the current epoch's `pol.budget_epoch`. Shrink-to-fit is evaluated once, over the epoch's qualified slate at Seed entry, and a rerun is by construction not part of any slate qualification. No second meter is required, because the exposure is structurally bounded rather than budget-bounded: `delayed_once` and `rerun` are one-way flags, so each proposal admits at most one rerun and therefore at most one POL doubling ([05](05-welfare-and-decision-engine.md) §2.1, *Rerun finality*), capping an epoch's rerun exposure at 2× its qualified commitment. The resulting commitment still enters treasury NAV netting as a POL obligation (§1.2, §8.2), and the rerun seed fails status-quo (G-1) if `POL` cannot fund it.

---

## 5. Economic-security sizing (B-8, D-4)

### 5.1 What was wrong (the review's arithmetic, restated)

ADR-14's rule `AttackCost ≥ 3·MEV` had no mechanism: `pol.b`, `dec.v_min`, δ were flat per class. With the A-2 flow model (arbitrage flow F ≈ L/2 per day against sustained mispricing), a TREASURY decision pair at defaults has depth L = 2 × 25,000 × ln 2 = **34,657 USDC**, F ≈ **17,329 USDC/day**, so holding a decision-flipping displacement through the 72 h decision window bleeds at most ≈ 3 × 17,329 = **51,986 USDC**. Against the maximum in-cap prize `trs.cap_proposal` × NAV: at the BE §30.2 example NAV (200,000/2.1% = 9,523,810 ⇒ prize 476,190) the required cost 3 × 476,190 = 1,428,571 exceeds 51,986 by **27.5×**; at 100M NAV (prize 5M, required 15M) by **288.6×**. That 27–290× shortfall is what this section closes.

### 5.2 Primary mechanism: the decide-time cap

New decision-engine step (inserted after the convergence check, before the meters check, in [05](05-welfare-and-decision-engine.md); reason code `RejectReason::SecuritySizing`):

```
AttackCost̂(p) = F̂(p) · T_dec                         // USDC
  T_dec  = dec.window / 14,400 blocks-per-day           // = 3 days at default
  F̂(p)   = min( L̂(p)/2 ,  F̂_pub )  per day             // conservative minimum
  L̂(p)   = time-averaged effective POL depth of p's decision pair (2·b·ln 2 as seeded, from I-12 telemetry)
          + min( min(ContestCapital_acc(window), ContestCapital_rej(window))
                 ([04](04-markets-and-pricing.md) §7a: time-weighted marked net open interest;
                  the shallower book is binding — the same per-book measure graded against
                  dec.v_min in step 5; SQ-231 amendment: gross traded notional is manipulable
                  by the attacker's own flow and no longer feeds the certificate),
                 sec.flow_cap · (b_acc + b_rej) )       // the C_hold wash ceiling, now gate-bearing
  F̂_pub  = the published measured arbitrage-flow parameter (A-2 obligation,
            measured Phases 3–4); until published, F̂ = L̂/2.

REQUIRE  InCapPrize(p) ≤ AttackCost̂(p) / 3   else Reject(SecuritySizing)
```

`InCapPrize(p)` — the maximum extractable value of a wrongly flipped decision, per class:

| Class | InCapPrize |
|---|---|
| PARAM | certified capability-envelope value of the parameter delta ([05](05-welfare-and-decision-engine.md)) |
| TREASURY | `ask` (already ≤ `trs.cap_proposal`·NAV by the outflow cap) |
| CODE / META | max(`ask`, envelope), conservatively floored at `trs.cap_proposal`·NAV for runtime-upgrade payloads — an upgrade is assumed able to reach the full per-proposal outflow cap. **How conformance is checked (clarification; SQ-173, 2026-07-25):** [05](05-welfare-and-decision-engine.md) §5.4's engine takes no upgrade flag — a caller expresses "not an upgrade" by passing `spendable NAV = 0`, which is what the [15](15-invariants-and-testing.md) §4.9 Phase-0 simulation does for non-upgrade CODE/META proposals, and what the published calibration behind the `sec.prize.*` defaults was run under. Reading that engine's signature in isolation suggests an unconditional floor; it is not, and an implementation that applies the floor unconditionally disagrees with the Phase-0 evidence |

Every TREASURY proposal also undergoes the four gate-book veto checks of [05](05-welfare-and-decision-engine.md) §5, regardless of whether its ask is above or below `trs.stream_threshold`; that threshold continues to govern payout streaming only (§1.3), not gate eligibility.

NAV in this computation is `spendable NAV` (§1.2): under the reserve-health flag it is 0 and — consistently — no new adoption passes sizing. All inputs are decide-time on-chain measurements; the cap therefore **scales with the value at stake by construction**, which the flat defaults never did.

The inner pair reduction is normatively **MIN**, never SUM: an attacker can flip through the cheaper, shallower decision book, so counting the deeper book would overstate security. §5.4(b) is the arithmetic lock: both books must individually clear `dec.v_min = 400,000`, yet the worked `L̂` adds one 400,000 term (`34,657 + 400,000 = 434,657`), not 800,000.

### 5.3 Secondary mechanism: Ask-scaled liquidity (floors = current defaults)

Piecewise-linear per class in `P = InCapPrize(p)`, with `P_ref(class) = AttackCost̂_default(class)/3` (the largest prize default depth supports; see §5.4):

```
dec.v_min(class, P) = max( v_min_floor(class), 2·P )
pol.b(class, P)     = b_floor(class) · max(1, P / P_ref(class))
δ(class, P)         = min( δ_floor(class) · max(1, P / P_ref(class)) , 0.10 )   // hard kernel cap
```

Floors are the current defaults (*normative values: [13](13-parameters.md)*); the `pol.b` and δ slopes are **simulation-gated [VERIFY in Phase-0 calibration]** — the kernel guarantee below rests on the `v_min` term alone, so slope tuning cannot weaken it.

**Why `v_min = 2·P` closes the rule identically.** If the proposal is decision-grade, measured **contest capital** ([04](04-markets-and-pricing.md) §7a) ≥ `dec.v_min` ≥ 2P, and the `sec.flow_cap` ceiling does not bind at exactly-grade organic depth (next paragraph), so:

```
AttackCost̂ = 1.5 · L̂ ≥ 1.5 · (2·b·ln 2 + 2P) = 3P + 3·b·ln 2  >  3P   ∎
```

i.e., every decision-grade, sizing-passing adoption satisfies `AttackCost̂ ≥ 3·InCapPrize` with a margin of `3·b·ln 2` that itself grows under the `pol.b` scaling. Proposals that cannot attract **held** depth 2× their prize are rejected `SecuritySizing` — status-quo default, exactly the intended failure mode. Since the SQ-231 amendment the 2P term is capital genuinely at risk through the window: supplying it as an attacker means holding net exposure the displacement-and-hold theory (§5.5, `C_hold`) already prices, so the certificate can no longer be self-funded by churn.

**Ceiling non-bindingness (kernel-checked at the consuming engine).** The gate ceiling `sec.flow_cap · (b_acc + b_rej)` must not reject honest exactly-grade proposals: under the **normative `pol.b` seeding of this section** (`b = b_floor · max(1, P/P_ref)`), the binding ratio is `2P / (b_acc + b_rej) = P/b` — for `P ≤ P_ref` it is at most `P_ref/b_floor`, and for `P > P_ref` the scaling holds it constant at exactly `P_ref/b_floor` ≤ 6.7 across the §5.4 defaults table (PARAM/TREASURY/CODE 5.7, META 6.7). Any `sec.flow_cap ≥ 7` therefore leaves the identity intact; **7 is the row's hard minimum** (*normative bound: [13](13-parameters.md)*), and the Phase-0-calibrated value (sim-gated) sits above it. A book seeded at floor `b` while `v_min` carries the `2P` scaling (the §5.4(b) illustration as printed) is **not a configuration the normative seeding produces** — there the ratio can reach 8, which is why the illustration below also records its scaled-seeding form.

### 5.4 Worked recomputation at defaults (normative)

**(a) Maximum in-cap prize, CODE at its NAV floor.** NAV = 13,862,944 (§4.1) ⇒ P = 5% × NAV = **693,147 USDC**.
- Scaled `dec.v_min` = max(600,000, 2 × 693,147) = **1,386,294 USDC**.
- **Normative-seeding form.** `P / P_ref(CODE) = 693,147 / 341,589 ≈ 2.029 > 1`, so §5.3 scales the book: `pol.b(CODE, P) = 60,000 × 2.029 ≈ **121,751**`, giving POL depth = 2 × 121,751 × ln 2 = **168,783 USDC**.
- L̂ (at exactly-grade volume) = 168,783 + 1,386,294 = **1,555,077** ⇒ AttackCost̂ = 1.5 × 1,555,077 = **2,332,616 USDC**.
- Requirement 3P ≈ 2,079,442 ≤ 2,332,616 ✔ — holds with margin ≈ 253,174 USDC (= 1.5 × 168,783 = **12.2 %**, the same margin ratio (b) records, since `b_floor·ln 2 / P_ref` is class-invariant across the defaults). Cap check: P = 693,147 ≤ AttackCost̂/3 ≈ 777,539 ✔. The `sec.flow_cap` ceiling at its ×7 minimum is 7 × 243,502 ≈ 1,704,516 ≥ 1,386,294 — **not binding**, which is what makes the non-POL term the full `dec.v_min` above. (Whole-unit figures are rounded; the exact derivation gives `P_ref = 341,588.830834`, `b = 121,751.147128`, depth `168,782.928723`.)
- **Floor-depth counterexample (NOT a conservative bound — it fails).** Seeding at the unscaled floor `b = 60,000` while `v_min` carries the `2P` scaling is the configuration §5.3 excludes, and applying §5.2's ceiling shows why: the non-POL term is `min(1,386,294, sec.flow_cap · (b_acc + b_rej)) = min(1,386,294, 7 × 120,000) = **840,000**`, so L̂ = 83,178 + 840,000 = **923,178** and AttackCost̂ = **1,384,767 < 3P = 2,079,441**. The floor configuration **does not clear sizing**. This is exactly §5.3's non-bindingness bound read in reverse — at floor `b` the binding ratio reaches 8, above the `sec.flow_cap` minimum of 7 — and it is why the scaling is normative rather than advisory. Any statement of this example that omits the ceiling (as the superseded text did, reporting a 6.0 % margin from an uncapped L̂ = 1,469,472) overstates the security certificate.

**(b) The §30.2-equivalent TREASURY example.** Ask 200,000 at NAV 9,523,810:
- `dec.v_min` = max(250,000, 400,000) = **400,000**. **At the unscaled floor this class also fails**, for the same reason as (a): the ceiling gives `min(400,000, 7 × 50,000) = 350,000`, so L̂ = 34,657 + 350,000 = **384,657** and AttackCost̂ = **576,986 < 3P = 600,000**. The uncapped reading (L̂ = 434,657, AttackCost̂ = 651,986, "margin 8.7 %") omits §5.2's ceiling and overstates the certificate; floor seeding is not a conservative illustration of the normative rule but a configuration that misses it.
- Under the old flat defaults this identical proposal had AttackCost ≈ 51,986 vs required 600,000 — an 11.5× shortfall, closed by the scaled form below.
- **Normative-seeding form (the one that holds):** §5.3 scales `b = 25,000 · 200,000/142,329 ≈ 35,130` here, so L̂ = 48,700 + 400,000 = 448,700 and AttackCost̂ = 673,050 ✔ (3P = 600,000, margin 12.2 %); the `sec.flow_cap` ceiling at its ×7 minimum is 7 · 70,260 = 491,820 ≥ 400,000 — not binding, per §5.3's non-bindingness bound. The floor arithmetic above is retained only as the counterexample showing that the scaling is load-bearing.

**(c) PARAM at flat defaults (scaling not binding).** L̂ = 2 × 10,000 × ln 2 + 100,000 = 113,863; AttackCost̂ = 170,794; max passable envelope value = **56,931 USDC**. A PARAM delta whose certified envelope exceeds this must either attract more organic volume or fail sizing. The four PARAM gate books are separate veto inputs and their POL depth is deliberately excluded from `L̂`, exactly as for every other gated class.

**Defaults table `P_ref(class)`** (derived, frozen in [13](13-parameters.md) as derived values): PARAM 56,931 (= 1.5·(13,863 + 100,000)/3); TREASURY 142,329 (= 1.5·(34,657 + 250,000)/3); CODE 341,589 (= 1.5·(83,178 + 600,000)/3); META 669,315 (= 1.5·(138,629 + 1,200,000)/3). Every class term is the **decision-pair** seeded depth `2·b·ln 2` at the [13](13-parameters.md) `pol.b` floors (10k/25k/60k/100k) plus the `dec.v_min` floor — gate-book depth is deliberately excluded from L̂ (§5.2 measures the decision pair only). The superseded PARAM decision-depth cells (27,726 / 63,863) were a doubling slip: the decision pair still uses `2·b·ln 2`; §3's larger total PARAM commitment now adds four distinct `pol.b_gate` books and does not alter this security-depth term.

### 5.5 Honesty clause

`AttackCost̂` is an *upper bound* estimate of the manipulation bleed (F̂·T bounds absorbed adverse flow, not realized loss per unit). The SF = 3 divisor, the conservative `min(·, F̂_pub)`, the requirement to hold displacement through full **and** trailing windows with convergence ([05](05-welfare-and-decision-engine.md)), the `v_min` identity of §5.3, and — since the SQ-231 amendment — the manipulation-resistant contest-capital input with its `sec.flow_cap` ceiling are the compensating margins. Because the gate is an upper bound, the engine also emits the finer *lower-bound* diagnostic **`ManipFloor̂ = C_disp + C_hold`** per decision ([05 §5.6](05-welfare-and-decision-engine.md)); it never gates in v1, but its published series is part of the same calibration obligation as F̂ — if `ManipFloor̂` persistently reads below `3·InCapPrize` for adopted proposals, δ and/or the `dec.v_min`/`pol.b` slopes MUST be tightened before caps rise. A-2 remains an **empirical** assumption: F̂ MUST be measured in Phases 3–4 and published before caps rise; deep-pocketed off-system attackers remain the residual (TM-18, [14](14-threat-model.md)). The Phase-0 exit simulation ([15](15-invariants-and-testing.md) §4.9) validates the `ManipFloor̂`↔`AttackCost̂` envelope at that irreducible line: it scores a causal wrong-PASS flip as a failure only when the *realized* attacker cost is **below the prize** (profitable capture); a flip whose realized cost stays ≥ the prize but below `3·InCapPrize` (e.g. thin-market/gate-suppression griefing) is the TM-18 residual the SF = 3 margin guards against, recorded as a diagnostic.

---

## 6. Keeper economics (B-med, recomputed)

### 6.1 Crank volume (derivation)

Concurrently trading books = 5 slots × 6 + 1 Baseline = **31** (forecast trading is cut, D-8, so measuring cohorts' books are closed; *bounds: [13](13-parameters.md)*). Observation grid = every 10 blocks:

- **Decision-critical** (72 h decision window, 43,200 blocks): 43,200/10 = 4,320 obs/book × 31 = **133,920**, plus decide/tick/settle/snapshot cranks (order 10²) ⇒ **≥ 134k decision-critical cranks/epoch**.
- **Full trading window** (d5–d18, 187,200 blocks): 18,720 obs/book × 31 = **580,320 ≈ 580k cranks/epoch**.

(On-trade updates advance the grid for free, so these are worst-case zero-organic-trade figures.)

### 6.2 Budget sizing

`keeper.budget_epoch` = **12,000 USDC** (raised from 3,000; *normative value: [13](13-parameters.md)*). The old 3,000 budget covered <25% of decision-critical volume — rational keepers would have stopped mid-window and every decision would have rejected `NotDecisionGrade`.

**The fee basis is now measured, and the assumed one was wrong by 353× (normative; corrected 2026-07-30, milestone E5, SQ-531).** This section previously derived the budget as `133,920 × 0.09 ≈ 12,053 USDC` from an **assumed** crank fee of ≈ 0.03 USDC, carrying `[VERIFY against benchmarked weights + fee.vit_usdc_rate at launch]`. Every pallet is now benchmarked, so the assumption is testable — and it fails. Priced from the committed generated weights at the multiplier [09](09-execution-upgrades-and-rollout.md)-adjacent SQ-528 restored:

```
crank_observe call weight       1,240,920,000 ps      (committed weights)
+ TxExtension weight              352,392,000 ps
WeightToFee = IdentityFee         1 ps -> 1 planck
+ ExtrinsicBaseWeight             108,157,000 planck
+ length fee (~120 B)                     120 planck
= 1,701,469,120 planck = 0.00170146912 VIT            (VIT: 12 decimals)
x 0.05 USDC/VIT (§9's documented placeholder reference)
= 0.000085 USDC per sanctioned crank
```

So `keeper.rebate` at 3× is **0.000255 USDC**, not 0.09 — the seeded value was ≈ **1,058×** the fee it claimed to be 3× of. For 0.03 to have been right, VIT would have to trade at ≈ 17.6 USDC. The kernel basis constant moves 30,000 → **85 µUSDC** accordingly.

**Two consequences, and neither is a policy change.** The decision-critical load falls to `133,920 × 0.000255` ≈ **34 USDC/epoch** and the full trading window to ≈ **148 USDC/epoch**; §10.1's two keeper lines fall from 908,408 USDC/yr — 79.3% of the entire annual cost base — to ≈ 2,574. And `keeper.budget_epoch` = 12,000 now over-provisions the decision-critical load by ≈ 350×, which is recorded rather than corrected here: the budget is a **ceiling, not a spend** (§1.1), so an over-large one books no cost, but it also means the meter cannot bind and provides no real protection. Right-sizing it is blocked on the kernel floor `keeper.budget_epoch` ≥ 6,000 (13 §1), itself now ≈ 175× the full-window demand; moving a kernel floor is a CODE change and is raised as **SQ-532** rather than taken here.

**The `[VERIFY]` tag stays, and it is load-bearing — the rebate does NOT auto-track the price (normative; corrected 2026-07-31, before launch).** An earlier revision of this paragraph claimed the tag had narrowed to "the price, not the multiple", on the reasoning that rebate and fee scale together. **They do not.** The fee is fixed in **VIT** by weight (0.0017 VIT per sanctioned crank, invariant to price); `keeper.rebate` is a **stored USDC parameter**. Only one side moves when VIT reprices:

| `fee.vit_usdc_rate` | crank fee (USDC) | `keeper.rebate` ÷ fee |
|---|---|---|
| 0.0125 (¼ × placeholder) | 0.0000213 | 12.0× |
| **0.05 (the derivation price)** | **0.0000851** | **3.0×** |
| 0.20 (4 × placeholder) | 0.000340 | **0.75×** |
| 1.00 (20 × placeholder) | 0.00170 | 0.15× |

**The unsafe direction is VIT appreciation.** Above ≈ 4× the derivation price the rebate falls below the fee itself, cranking becomes loss-making, and A-1 fails silently — the exact failure §6.2 says the 3,000 USDC budget used to cause. Three consequences are normative:

1. `keeper.rebate` **MUST be re-derived at the launch `fee.vit_usdc_rate`**, not merely inherited. That is what the `[VERIFY]` tag now demands, and it is a launch blocker rather than a nicety.
2. The 13 §1 envelope bounds the exposure: the row admits [1×, 10×] of the basis, so the registry can absorb price moves up to ≈ 10× before no admissible value restores a 1× rebate. Beyond that the **basis constant itself** must move, which is a CODE change.
3. The row is PARAM with a 1-epoch cooldown, so governance can track material price moves — but nothing does this automatically, and the monitoring obligation belongs with the keeper-inactivity alarm of [12](12-release-and-operations.md) §6.3.

What the SQ-531 correction did fix is orthogonal and still holds: the derivation is now anchored to a **measured** weight instead of an invented fee, so re-deriving at any price gives the right answer. Before, no price gave the right answer.

**Separately, the budget never covered the load it claimed to (SQ-527).** At the superseded rebate the derivation gave 12,052.80 USDC/epoch and the budget was set to 12,000 — 52.80 short, 0.44%. §6.3 makes exhaustion a **latch**: once `KeeperBudgetExhausted` fires, no further metered rebate is paid for the remainder of that epoch. So on a worst-case (zero-organic-trade) epoch the meter exhausted before the decision-critical load completed, every epoch, and the sentence claiming otherwise was false. The corrected basis makes the shortfall moot — 34 USDC against a 12,000 budget — but the claim is corrected rather than quietly overtaken.

### 6.3 Meter structure and exhaustion behavior

- Two tranches: **≥ 80% reserved for decision-critical cranks** (decision-window observations, `decide`, `settle_cohort`, `tick`, `snapshot`); ≤ 20% general (out-of-window observations, reaping).
- **The decision-critical list is closed (normative).** Exactly the five crank families named above draw on the ≥ 80% reservation. Every other sanctioned permissionless keeper crank draws on the ≤ 20% general tranche — including `epoch.finalize_epoch_baseline`, `execution_guard.execute`, `expire_failed_execution` and `reject_stale`, `welfare.record_daily_gate`, `futarchy_treasury.execute_coretime_renewal` and `prune_coretime_quote`, and all reap/dust sweeps. The orphan Baseline crank requests a rebate only when it actually changes an `Open` vault; its absent/already-settled idempotent no-ops are unrebated. Cranks funded from the `ORACLE` line ([07](07-oracle-and-disputes.md)) sit **outside this meter entirely** and consume neither tranche. Privileged cleanup entry points that are not permissionless keeper surfaces are unrebated. The general tranche is a **partial subsidy by construction** — full-window observation demand exceeds it by roughly an order of magnitude (see the `ops.keepers` bullet below) — so no general-tranche crank may be assumed rebated; `ops.keepers` is its continuity path.
- 80% consumption ⇒ `KeeperBudgetLow`; 100% ⇒ `KeeperBudgetExhausted { epoch, spent }` + RB-KEEPER ops alarm. Cranks remain permissionless and idempotent after exhaustion — rebates stop, nothing else changes.
- **Exhaustion is effective, and it latches (normative).** A literal 100% trigger would almost never fire, since the budget is rarely an exact multiple of `keeper.rebate`. `KeeperBudgetExhausted { epoch, spent }` therefore fires on the **first rebate attempt that does not fit the remaining budget, or on one that exactly exhausts it**, reporting the amount actually spent — 0 in the degenerate case where a single rebate exceeds the whole budget, and the full budget on the exact-fit path, where that final rebate is still paid. `KeeperBudgetLow` always precedes it, and both latch once per epoch. Exhaustion is a **payment latch, not merely an alarm**: once it fires, no further metered rebate is paid for the remainder of that epoch, even if a subsequent `keeper.rebate` or `keeper.budget` amendment would create headroom. Rebates resume at the next epoch boundary. The latch is not a liveness trap — the rebate is an infallible post-effect that never alters its crank, so every crank stays permissionless, idempotent and dispatchable at ordinary transaction fee throughout.
- Beyond-meter continuity is a funded ops line (`ops.keepers`, §1.1): the ≥ 2 committed keeper operators of the node-roles table run through exhaustion. Full-window coverage at 3× rebate would cost ≈ 580,320 × 0.09 ≈ 52,229 USDC/epoch — deliberately **not** metered: out-of-window observation gaps only degrade chart density, never decisions (staleness counts only inside the decision window, [04](04-markets-and-pricing.md)).

**A-1 restated:** at least one rational, funded keeper exists; if none does, the chain adopts nothing — safe but stagnant. The 12,000 USDC meter plus the ops line is what makes A-1 *economically reasonable* rather than aspirational; it still cannot make it a code-enforced guarantee.

---

## 7. Intake and bond economics (B-13 economic side, slot monopolization)

New rules (lifecycle owned by [06](06-governance-and-guardians.md); economics here):

1. **10% bond slash — routed to the INSURANCE account, not burned** (USDC is bridged Asset-Hub USDC; burning it would strand backing reserve on Asset Hub — [06](06-governance-and-guardians.md) §4) — on preimage-missing cancellation and on every non-decision-grade outcome; bonds refund in full only on a decision-grade outcome (adopt or reject — rejection is information).
2. **`request_preimage` pinning at qualification** (hygiene half of B-13, in [06](06-governance-and-guardians.md)).
3. **≤ 4 intake entries per account per epoch** (`intake.max_per_account`).

**Cost of the griefing strategies (before → after).** Before: full slot capture + intake denial locked ≈ 109k USDC of *fully refundable* bonds ≈ **$314/epoch** of time-value (5%/yr × 21 d); pure intake denial ≈ $92/epoch.

After, per epoch, at USDC ≈ $1:

| Strategy | Locked | Slashed/epoch (routed via INSURANCE, overflowing to `MAIN`) | Notes |
|---|---|---|---|
| Intake denial (64 × PARAM bond 1,000, preimage-missing) | 64,000 | **6,400** (10%) | needs ≥ 16 funded accounts (64 ÷ 4-per-account limit) — ~70× the old $92 |
| Slot capture (5 × ≥ TREASURY/CODE bonds ≥ 25,000, ride to non-decision-grade) | ≥ 125,000 | **≥ 12,500** | bond-priority means matching honest class bonds, not minima |
| Combined monopolization | ≈ 189,000 | **≈ 18,900** | ≈ 60× the old all-in $314 |
| “Refund path”: make the junk decision-grade instead | — | ≥ ≈ 18,000 in fees alone | must self-supply `dec.v_min` **contest capital** ([04](04-markets-and-pricing.md) §7a) — *held* net exposure carried through the window, not churn: since the SQ-231 amendment a round trip nets out of `noi_t` by construction, so the 3M is capital the attacker must hold, not turnover it may recycle (5 × CODE = 3M held × 2 × 30 bps entry/exit) — plus the `C_hold` adverse-selection bleed on that held position, plus divergence loss to the POL books, plus 63–66-day scalar capital duration and market risk |

Monopolization is no longer pocket change: every path costs **five figures per epoch, unrecoverable by the attacker** (and NAV-accretive), versus ~$300 of time-value before. Threat row: [14](14-threat-model.md).

**Where the slashed USDC ends up (normative; amended 2026-07-29, milestone E1).** These are **USDC** bonds (`prop.bond`, [13](13-parameters.md) §1), so §1.2's INSURANCE target and automatic overflow apply to them in full: the slash is routed to INSURANCE and is not burned — rule 1 above is unchanged and the anti-burn rationale still governs — but INSURANCE retains it only up to `T_ins`, and every intake slash on this table sits far above that target, so the value overflows to `MAIN` in the same transaction and becomes spendable NAV. The deterrent is identical either way (the offender forfeits the bond regardless); what changed is that the forfeiture is no longer a permanent NAV sink requiring a proposal slot to recover. The VIT bonds of [06](06-governance-and-guardians.md) §4/§7 are **not** on this table and do not overflow (§1.2).

---

## 8. POL seeding flow (per-branch, cap-exempt)

Consistent with the [03](03-conditional-ledger.md) per-branch walk (B-4 fix):

1. `POL` account calls `split(pid, c)` — escrow += c; per-branch supplies `supply(AcceptUsdc) += c`, `supply(RejectUsdc) += c` (dual mint; the mirror is free by construction, so seeding is decision-neutral).
2. Per branch b: `split_scalar(pid, b, c_b)` converts branch-USDC into complete LONG_b+SHORT_b sets held by the book account; gate books receive their per-branch YES/NO complete sets analogously (`GateYes/GateNo` kinds, [03](03-conditional-ledger.md)).
3. Each book's inventory = `b·ln 2 + headroom` of complete sets ([04](04-markets-and-pricing.md) sizes `headroom`); the per-branch identity `escrowed == supply(bUSDC_b) + Q_b` holds at every step — no counter underflows on this flow (the B-4 defect).
4. Book revenue is immediately re-split into complete sets (D-3 revenue recycling), so book solvency is structural, not budgetary.
5. At settlement, POL withdraws; realized subsidy = live-branch divergence loss.

**What "POL withdraws at settlement" means operationally (normative; added 2026-07-29, milestone E1).** The sentence above and §3's "committed POL withdraws at settlement" were read for two milestones as releasing only the NAV *obligation*; they do not. Both halves are mandatory and they are **distinct**:

- **(a) The obligation release.** The book's POL commitment leaves `NavView` obligations at the terminal latch, as today.
- **(b) The custody return.** **Every realizable position the book account holds** MUST be redeemed to real USDC and returned to the funding line: `POL` for decision and gate books, `POL_BASELINE` for the Baseline book. Only the divergence loss stays spent. This is the inverse of step 2 and it is what makes POL a **revolving** balance rather than a per-epoch expense.

  **"Every realizable position", not "every complete set" (corrected by review before implementation, 2026-07-29).** An earlier draft of this clause scoped the return to complete LONG+SHORT (resp. YES+NO) sets, on the reasoning that a set is worth exactly one branch-USDC. That is true of a set and **false of the book's actual inventory.** After any asymmetric walk the book holds complete sets *plus an unmatched residual leg* — delivery removes single legs while revenue recycling mints pairs — and at an interior settlement `0 < s < 1` that leg redeems for `floor(a·s)` or `floor(a·(1−s))`, which is strictly positive. Since [04](04-markets-and-pricing.md) §2 classifies whatever Sweep leaves as worthless and lets reap discard it, a set-only return would send exactly that value to ledger residue and on to `INSURANCE` — **recreating, at smaller scale, the leak this milestone exists to close**, and with it the NAV overstatement. The residual leg is not an edge case: it is the same inventory whose value makes the realized cost `b·[ln 2 − H(p)]` rather than the whole seed, so discarding it would make realized POL cost approach the full commitment — the precise error §10.5 quantifies.

  Operationally: use the atomic **pair** redemption wherever a pair exists, because it pays exactly `a` and avoids double flooring ([03](03-conditional-ledger.md) §6.3), then redeem the remaining unmatched legs individually, and leave for reap **only** positions whose payout is provably zero — losing-branch instruments and the losing side of a settled gate. `ProtocolAccounts` are exempt from the [03](03-conditional-ledger.md) §5.3a redemption fee throughout, so none of this return is haircut.

**(b) without (a) understates NAV; (a) without (b) overstates it, and overstating is the unsafe direction** — every NAV-derived control (`trs.cap_proposal`·NAV, `pol.budget_epoch`·NAV, the §4.1 arming floors) is then computed on capital the treasury no longer holds. The two MUST therefore commit or roll back together, in the same atomic storage layer as the terminal latch of [04](04-markets-and-pricing.md) §2, or the return MUST be a separately cranked step whose completion the obligation release does not presuppose. The seeding side has the mirror obligation: a seed that debits real USDC from `POL` MUST debit the `POL` budget line by the same amount, or NAV counts the line at its pre-seed value forever. §10.5 records what the missing half cost.

The return is **fail-soft and idempotent**: it MUST NOT be able to fail a settlement (G-1), and re-running it after success is a no-op. A book whose return has not yet run is not a solvency problem — the cash is still escrowed in the ledger sovereign and still backs the same claims — it is an NAV-recognition delay, and the try-state check of [15](15-invariants-and-testing.md) §1 is what bounds it.

**Protocol-account exemptions:** the `POL`/book/treasury sub-accounts are exempt from `MaxPositionsPerAccount` = 64 and from the 0.1 USDC per-entry Positions deposit (*bounds: [13](13-parameters.md)*) — a decision pair + 4 gate books across two branches materially exceeds a user cap, and the deposit would be the treasury paying itself. Exemption is by account-list membership in `pallet-constitution`, not by any admin toggle.

---

## 9. Transaction fees (X-14, D-12)

- `pallet-transaction-payment` computes the fee in VIT; `pallet-asset-tx-payment` charges USDC-electing users `fee_usdc = ceil(fee_gov × fee.vit_usdc_rate)`, minimum 1 base unit.
- **`fee.vit_usdc_rate`** (USDC per VIT) is a typed constitution key: bounds **[0.1×, 10×] of the genesis reference** `fee.vit_usdc_rate_ref` (a kernel constant fixed at genesis from the launch reference price — **[VERIFY at TGE pricing; placeholder reference 0.05 USDC/VIT]**), PARAM-adjustable, max Δ ×2, cooldown 1 epoch (*normative row: [13](13-parameters.md)*).
- **USDC-only users are always viable, end-to-end**: the inbound reserve transfer's execution on this chain is paid via the XCM `WeightTrader` selling execution for USDC or DOT; every subsequent local extrinsic — including the outbound `reserve_transfer` exit — is payable in USDC via the rate above. No VIT balance is ever a precondition for any user workflow. The FE fee-currency selector binds to this key ([11](11-frontend-workflows.md)); the guided funding flow is [11](11-frontend-workflows.md)'s D-12 surface.
- Rate-staleness failure mode: if the rate drifts outside honesty (VIT repricing faster than PARAM cadence), the bounded [0.1×, 10×] envelope caps the damage to a 10× fee mispricing in either direction — annoying, never disabling; guardian playbooks are not needed for fee drift.

**Fee destination (normative; added 2026-07-29, milestone E1 — this section previously specified fee *mechanics* and was silent on where the collected fee goes).**

- **USDC transaction fees route to `MAIN`.** They are liquid USDC at par and enter NAV under §1.2 like any other treasury credit. **Burning them is forbidden**, and this is not a policy preference but the same rule the rest of this document already applies to bridged USDC: "burning it would strand backing reserve on Asset Hub" (§7.1), "slashed to INSURANCE, never burned" ([13](13-parameters.md) §1), "would strand bridged Asset-Hub USDC forever, which is precisely the outcome §7.1's anti-burn rationale exists to avoid" (§1.2). USDC on this chain is a claim against a reserve held on Asset Hub; destroying the local claim does not destroy the remote reserve, it orphans it. A fee adapter that drops the collected credit — which is what an unconfigured handler does by default — therefore violates §7.1 even though §7.1 is written about slashes. Any runtime whose USDC fee path discards the credit is non-conforming.
- **VIT transaction fees continue to burn**, deliberately. VIT is natively issued here, not bridged, so burning strands no reserve and orphans no claim; it is a supply reduction against a fixed 1,000,000,000 supply whose only issuance path is the `iss.inflation_cap`-metered `issue_vit` (§2.3). Burning VIT fees is mildly deflationary and needs no destination account, whereas routing them would credit the treasury an asset §2.2 marks at **0 in NAV** — pure accounting noise for no solvency gain. The asymmetry is the bridged/native distinction, and it is the whole of the reason.
- **Adapter constraint carried forward.** §2.1's rule that the fee path MUST treat a vesting lock as frozen balance with no fee carve-out binds the adapter, not the destination. Changing the credit handler does not change the withdraw-reason behaviour, but §2.1's requirement stands: **any change to the fee adapter MUST be re-proven, not assumed**, and the runtime test that drives the real fee path against a fully locked account and requires it to fail is part of that proof.
- **Welfare-metric consequence.** [05](05-welfare-and-decision-engine.md) §4 MetricId 20 is labelled "Fees burned/paid" and glossed "protocol fee sink". Under this rule the USDC leg is no longer burned and no longer a sink; the metric's *measurement* (`N(log1p(fees_USDC))`, fees actually paid by users) is unchanged and remains correct, but the label and gloss are amended there to say "fees paid" without the burn claim. No `MetricSpec` version changes, because the measured quantity does not.

---

## 10. Sustainability (normative accounting; added 2026-07-29, milestone E1)

This section states what it costs to run Bleavit for a year, what the protocol earns, at what volume the two meet, and how long the genesis endowment lasts on the way there. It exists because §§1–9 specify every individual flow and no section put them in one place; §§4.1–4.2's NAV floors and §2.5's funding target were being read as a funding *plan* when they are only a set of gates.

**The four numbers this section is accountable for**, and the one honest headline: **Bleavit is not self-funding at launch, and cannot be.** Launch volume is zero by construction — Phase-4 arms PARAM only, and a proposal earns the protocol nothing until traders show up. Self-funding is a maturity property, and the endowment is the bridge to it. Any statement that the protocol funds itself from block one is false and MUST NOT be made.

**What milestone E5 changed is how far away maturity is, not whether launch is self-funding.** Two corrections, each landing on the other: with the SQ-531 fee-basis correction the crossover fell from held capital of 138.9M to **29.1M** at the central τ = 3, and with the SQ-536 collator re-anchoring it falls again to **13.2M**. Neither was a cut to a service level; both were numbers that had never been checked against evidence (§6.2 and §2.4 respectively).

**Self-funding is conditional on slate OCCUPANCY, not on depth alone, and an earlier revision of this paragraph conflated the two (normative correction; 2026-07-31, raised by review).** That revision called a five-slot PARAM slate at the `dec.v_min` floor "the least activity at which the chain decides anything at all" and concluded the runway was unbounded. Five slots at the floor is the minimum **depth** at which five proposals are decision-grade; the minimum **activity** is *one* proposal, and held capital scales with occupancy. At the central τ = 3:

| Occupied PARAM slots (at the `dec.v_min` floor) | `H`/yr | `R` at τ = 3 | vs superseded `C` = 239,728 | vs **shipped** `C` = 109,281 |
|---|---|---|---|---|
| 1 | 8,522,500 | 70,311 | short 169,417 | short 38,970 |
| 3 | 16,871,071 | 139,186 | short 100,541 | **covers** |
| 5 (`epoch.slots` default, full slate) | 25,219,643 | 208,062 | short 31,665 | **covers** |

At the **superseded** cost base and τ = 3 the break-even was **six** occupied slots — above `epoch.slots` = 5, hence not reachable at the default slate size at all, and reachable only via the `collator.comp_epoch` lever or the measured median all-book τ = 5.8. At the **shipped** base it is **three** slots at τ = 3 and **one** at τ = 5.8, both inside the lawful slate. So the correction stands and the conclusion moved with it: **self-funding is still conditional on occupancy** — an epoch with no qualifying proposal earns nothing at any cost base — but the occupancy it now requires is reachable rather than not. What remains an assumption is *sustained* utilisation, which nothing in this repository evidences (§10.2's provenance note; SQ-506) — not decision-grade depth, which the protocol does enforce. None of it makes launch self-funding either, because launch activity is zero rather than minimal.

**Cost must be read at the same occupancy as revenue, and doing so sharpens the `ops.collators` question into the one that actually matters (normative; added 2026-07-31).** The table above varies revenue with occupancy while holding cost at its full-slate value, which charges five slots' proposer rewards against one slot's trading. Two rows of §10.1 are **per-proposal** rather than standing — `REWARDS`, paid only on `Executed`, and the realized POL divergence, which needs a seeded book — so a consistent comparison scales them and holds the rest. Read that way:

| | superseded `C` (`collator.comp_epoch` = 2,000) | **shipped** `C` (= 500) |
|---|---|---|
| Break-even occupied slots at τ = 3 | **7** (above `epoch.slots` = 5) | **1** |
| Break-even occupied slots at τ = 5.8 | 3 | 1 |

Two readings of "break-even" appear in this section and they must not be conflated — conflating them is what produced the claim the correction above replaces. The table immediately above is the **consistent** one: cost and revenue are both evaluated at the occupancy in question, which is the correct comparison. The earlier table holds cost at its **full-slate** value while varying revenue, which is conservative (it charges five slots' per-proposal rows against one slot's trading) and gives 3 slots at τ = 3 rather than 1. Both are stated because the conservative reading is the one a reader should use when the occupancy of *future* epochs is what is uncertain.

**`ops.collators` is the largest *standing* line — 72.6 % of the superseded base, 39.8 % of the shipped one** — and standing is the salient property: it bills whether or not the chain decides anything, which is the wrong shape for a protocol whose revenue is activity-linked. That single line is what decides whether break-even needs a **full slate and then some**, or a **single proposal**.

**How this question was answered, and why it was answerable after all (normative record; 2026-07-31, SQ-536).** An earlier revision of this paragraph declined to answer it, on the grounds that the value's error direction is unsafe (underpaid collators stop producing blocks) and that "no unit cost exists anywhere in this specification or its deployment tooling". The first clause is true and remains true. The second was true of *this repository* and was mistaken as a statement about the world: R-2 permits a value anchored to **published calibration evidence**, and such evidence exists for precisely this role. Polkadot's own treasury funds the collators of its system parachains through OpenGov referendum **#1870** (passed and executed) at **$250/collator/month**, **$307.24** fully loaded — **211.97 USDC/epoch** at this document's 21.0-day epoch. Against that anchor the superseded 2,000 seed was **9.44×** and the shipped 500 is **2.36×**. The sharper form of the question — "does the protocol carry a standing obligation large enough to require sustained full-slate demand?" — therefore has an answer: **it did, and it no longer does.** The derivation, its one known disanalogy (a system-parachain operator quotes a *marginal* cost), and the three properties that make seeding at the registry floor safe are in [13](13-parameters.md) §1; the value itself is §2.4's. What this section still cannot supply, and does not pretend to, is an operator quote for *this* chain — [12](12-release-and-operations.md) §6.1 gives counts, never costs — which is why the margin is stated as a multiple rather than the anchor being adopted as the value.

**The whole reduction is arithmetic, not austerity.** No service level, mechanism or commitment was reduced to reach it: 79 % of the former cost base was a single unmeasured placeholder (§6.2), and the remainder moves on one PARAM key whose registry minimum was always available. This section is therefore materially more optimistic than it was, and the reason it may be believed is that every figure in it is now re-derived by the reference model on every CI run (15 §4.4) rather than hand-computed — which is precisely how the two figures corrected earlier the same day came to be wrong.

**Normative reproduction requirement (added 2026-07-30).** Every table in this section MUST be reproducible by `bleavit_reference_model.sustainability`, and its test suite pins them. A figure in §10 that the model does not derive is a defect in one of the two, to be investigated rather than reconciled by editing whichever is more convenient.

### 10.1 The annual cost base `C`

Epoch = `epoch.length` = 302,400 blocks at 6 s = **21.0 days**, so **17.393 epochs/year** (365.25/21; the 365-day convention gives 17.381 and nothing here turns on the difference).

| Line | Per epoch (USDC) | Per year (USDC) | Basis |
|---|---|---|---|
| `ops.collators` | 2,500 | 43,482 | §2.4; 5 × `collator.comp_epoch` = 500 (SQ-536; ~~10,000 / 173,929~~ at the superseded 2,000 seed) |
| `KEEPER` metered budget — **actual metered spend, not the budget** | ≈ 148 | ≈ 2,574 | §6.2 as corrected; `580,320 × 0.000255`, i.e. the **whole** trading window |
| `ops.keepers` (continuity **beyond** the metered budget) | **0** | **0** | §6.3; the full-window demand now fits inside `keeper.budget_epoch` with ≈ 81× headroom, so there is nothing beyond the meter to fund |
| `REWARDS` proposer rewards, **PARAM-only ceiling** | 2,500 | 43,482 | §1.1; 5 × 500 |
| POL realized divergence loss (**no-rerun case**; see the note below) | ≈ 1,083 | ≈ 18,830 | §3; the §12-equivalent walk of [04](04-markets-and-pricing.md) §12, `b·[ln 2 − H(0.56)]` |
| `ops.reserve_probe` | ≈ 52 | ≈ 913 | [07](07-oracle-and-disputes.md) §8; 21 probes × `ops.probe_fee_dot`·`ops.probe_dot_rate` |
| **Subtotal (derivable from this doc set)** | **≈ 6,283** | **≈ 109,281** | — |
| Same, with a **META-only** proposer-reward slate (upper bound) | 128,783 | 2,239,906 | §1.1; 5 × 25,000 |
| Memo — the same subtotal **before** the SQ-536 collator re-anchoring | 13,783 | 239,728 | superseded 2026-07-31; `ops.collators` was 10,000/epoch |
| Memo — the same subtotal **before** the SQ-531 fee-basis correction | 65,864 | 1,145,562 | superseded 2026-07-30; keeper rows were 12,000 + 40,229/epoch |

**The keeper rows fell by 353× and that is a correction, not a saving (normative record; 2026-07-30, milestone E5).** Both were derived from `keeper.rebate` = 0.09 USDC, which §6.2 assumed to be 3× a 0.03 USDC crank fee that nobody had measured. The measured fee is 0.000085 USDC, so the rebate was ≈ 1,058× the fee — and the two keeper lines, **79.3 % of this table**, were scaled by that error. Resolving the `[VERIFY]` is what R-2 requires rather than permits; no policy, mechanism or service level changed. The superseded subtotal is retained above so the size of the correction stays visible rather than being quietly absorbed.

**Revenue instrument D — the hosted question service (added 2026-08-01, D-20; owned by [16](16-hosted-question-service.md) §8).** Three of the four paths need no new code: external books generate instrument **A** (`mkt.fee`) and **B** (`ledger.redeem_fee`) because those apply to any book, and client messages generate **C**. **D** is a two-part tariff `fee(q) = max(svc.fee_floor, svc.fee_bps · declared_stake)`, charged **once per question** (a question carries two books, so a per-*market* reading would charge 2× what the arithmetic below justifies) and **earned at `Sealed`** — before settlement risk exists, because the price discovery is delivered there and a VOID does not un-deliver it.

**What D is worth, stated against a corrected derivation.** An earlier draft of this design claimed a certified question carries `H_q ≈ 3S/ε` (60·S at ε = 0.05), making D "≈ 2 % of what hosting earns". That derivation requires `AttackCost = ε·H`, a relation this document set never states, and it assumes organic trading depth that certification explicitly refuses to count. What **is** derivable is the escrow certification forces the client to post — and the cash is `b·ln 2` per book, not `b` ([04](04-markets-and-pricing.md) §2 mints "per-book headroom `b·ln 2`"; §3 sizes `b = SubsidyBudget / ln 2`). At ε = 0.05 that is `2 · b_min · ln 2 = 19.736·S` ([16](16-hosted-question-service.md) §5.2). Instrument B on that escrow is ≈ `0.0296·S` against D at the **adopted 1,000 bps** of `0.100·S` — so **instrument D is ≈ 77 % of the evidenced per-question revenue, not 2 %**. *(At the 100 bps this passage illustrated before the rate was adopted on 2026-08-02, D is `0.010·S` and ≈ 25 %.)* At 1,000 bps the `svc.fee_floor` leg binds only below `S` = 3,930 USDC, so for any consequential question the rate leg is the entire price. *(An earlier revision wrote `2·b_min = 28.5·S`, conflating the liquidity parameter with the cash funding it — corrected 2026-08-01 along with the [16](16-hosted-question-service.md) §8 figures; the correction **raises** D's share.)*

**The division that must be stated this way round.** The *evidenced* revenue is D plus B, both computable from capital the client is contractually required to post. Instrument A — trading fees on external order flow — is the larger term **if** external traders show up, and this repository has no evidence that they will: [15](15-invariants-and-testing.md) §4.9's simulation **cannot** test the demand hypothesis, because its flow is keyed to `dec.v_min`. "The external order flow is the revenue" is therefore a hypothesis about a market and **MUST NOT be presented as a forecast**. §10's standing rule is unchanged and unchallenged by any of this: Bleavit is not self-funding at launch and cannot be.

**Three further bindings.** `phase3.tvl_cap` = 2,000,000 is a **shared** meter, and under the corrected escrow a certified `S` = 100 k question needs **1,973,644** — it *fits*, by 1.3 %, where the superseded figure said it could not. The cap is shared with every other inflow, so one such question exhausts essentially all of it and a second is unreachable; `register` MUST therefore meter against the **live** remaining cap rather than the constant. The marginal cost of hosting one question is `2 · ceil(svc.max_window / mkt.obs_interval) · keeper.rebate` = **15.42 USDC**, and the combined crank load at saturation is **2.667×** the existing 580,320 full-window figure of [13](13-parameters.md) §5 item 4. Revenue pressure on `svc.max_live` **and on the certification threshold** is TH-73; the threshold is protected by `SECURITY_FACTOR` being a kernel constant rather than a key.

**One tabled row is sized at launch scale and grows by mandate (added 2026-07-30, milestone E5).** `ops.collators` above assumes **5** collators, which is the launch set; [12](12-release-and-operations.md) §6.1 mandates growth to **8–12 bonded permissionless collators from Phase 4**. At 12 the row is **6,000/epoch ⇒ 104,357/yr**, i.e. **+60,875/yr** over the tabled figure — which still leaves it the largest line in the table, and roughly doubles the whole subtotal. The growth *schedule* is itself `[VERIFY]` ([13](13-parameters.md) §1 `collator.n_target`), so the mature figure is a range and not a point — but the direction is mandated, not optional, and a table that silently fixed the count at 5 was understating the mature state. `collator.comp_epoch` is PARAM-adjustable within [500, 10,000], so the mature cost is a governed choice rather than a given. ~~24,000/epoch ⇒ 417,429/yr, +243,500/yr~~ was the mature figure at the superseded 2,000 seed. **Note the interaction the SQ-536 re-anchoring makes visible:** the *count* is mandated upward by [12](12-release-and-operations.md) §6.1 while the *rate* is now at its registry floor, so mature `ops.collators` is bounded below by 104,357/yr and cannot be reduced further by amendment — the only remaining lever on this line is the count, which is a liveness posture and not an economics choice.

**One row in that table is a ceiling, not a floor, and is labelled so (corrected 2026-07-29, milestone E1).** §1.1 pays proposer rewards **only on `Executed`**, so an all-pass five-slot PARAM slate is the *most* that line can cost at PARAM rates — a slate that rejects or defers pays less, and an epoch with no execution pays nothing. The row was previously labelled a "floor", which is the opposite of what the payout condition makes it. The subtotal's floor character does not rest on this row: it rests on the eight lines below, which are strictly positive and omitted entirely, and on the fact that a non-PARAM slate raises the reward line rather than lowering it (the META-only bound is the last row).

**Most of the unsized lines are not owed at Phase 4, and funding them at launch would be a choice rather than an obligation (normative guidance; added 2026-07-30, milestone E5).** The eight `[VERIFY]` lines below are frequently read as a standing launch cost. They are not: each is owed from the phase whose mechanism it serves ([09](09-execution-upgrades-and-rollout.md) §7.1), and Phase 4 arms **PARAM only**.

| Line | Owed from | Why |
|---|---|---|
| `ORACLE`, `ops.oracle_evidence` | Phase 3 | No reporter is registered and no attested component is admitted before Phase-3 arming ([07](07-oracle-and-disputes.md) §3) |
| `ops.watchtowers` | Phase 3 | Watchtowers acknowledge oracle rounds and registry filings; neither exists earlier ([07](07-oracle-and-disputes.md) §4) |
| `ops.arweave` | Phase 2/3, and largely **capex** | The ArNS permabuy is a one-time purchase, not a recurring line; per-release Turbo credits recur with releases, not with epochs ([12](12-release-and-operations.md) §4.1) |
| `ops.bootnodes`, `ops.rpc_archive`, `ops.monitoring` | Phase 2 | Required from the first public network, at the ≥ counts of [12](12-release-and-operations.md) §6.1 — these are the genuinely standing ones |
| `ops.coretime` | from the first leased core | The one unavoidable external cost, and see the note below |

**The one line that cannot be *removed* is not thereby a line that cannot be *reduced* (corrected 2026-07-31, milestone E7, SQ-541).** This paragraph previously read "the one line that cannot be reduced", on the grounds that a parachain cannot run without buying coretime. The premise is true and the conclusion does not follow: coretime is unavoidable, but *what Bleavit pays for it* is set by an operational choice this document set had never stated, and the choice is worth more than any parameter in [13](13-parameters.md) §1.

The renewal price is not a quote the protocol merely receives. `pallet-broker::do_renew` computes it (verified 2026-07-31 against `pallet-broker` 0.28.0, the version this workspace's `Cargo.lock` pins — `dispatchable_impls.rs` lines 209–211, `utility_impls.rs::sale_price`, `adapt_price.rs::CenterTargetPrice`):

```
price = min( leadin_factor(t) · end_price ,  max( prev_price · (1 + renewal_bump), end_price ) )
```

where `end_price` is the sale's market floor, `t` is the fraction of the sale's leadin elapsed **at the moment the renewal is submitted**, and `leadin_factor` decays from **100 at `t = 0` to 1 at `t = 1`**. Three consequences, all normative for how this line is operated:

1. **The renewal ratchet is bounded, and the bound is chosen by timing.** The `min` clamps the price to the open market, so the `renewal_bump` ratchet saturates at `leadin_factor(t) · end_price` rather than compounding without limit. Renewing during the **interlude** (`t = 0`, when only renewals may consume cores, so a core is guaranteed) saturates at **100× the market floor**; at 3 %/period that takes 156 renewals ≈ 12.0 years.
2. **Renewing at the end of the leadin pays the market floor exactly, in every period.** At `t = 1` the sale price *is* `end_price` and the `min` always binds, so the price is `end_price` for any prior price and any bump — the ratchet cannot start. It is also **recoverable**: because each renewal rewrites the stored `record.price`, a single late renewal drops an already-saturated 100× price back to the floor.
3. **The price tracks the market down as well as up.** A falling `end_price` lowers the paid price at the next renewal, because the `min` binds against the new sale price.

**What it is worth.** Against §10.1's cost base and the §10.5 zero-revenue runway to the binding META arming floor, with the line at a market floor of 4,000 USDC/yr: interlude renewal gives **14.7 years** and 6,252,022 USDC of cumulative 25-year coretime spend; leadin-end renewal gives **33.1 years** and 100,000 USDC — **+18.3 years of runway and a 62× reduction in cumulative spend** from the scheduling choice alone. At a 25,000 USDC/yr floor the same policy moves 9.7 → 27.9 years. All figures are re-derived by the reference model (`sustainability.py`, `CoretimeRenewalPriceTests`), which transcribes `do_renew`'s rule and checks its leadin curve against that pallet's own unit test.

**It is the largest single lever found, and it is not on its own sufficient — the two must be quoted together.** The figures above are at the **launch** collator count of 5, and §10.5's own qualification is that the zero-revenue goal already fails at the 10–12 bonded collators [12](12-release-and-operations.md) §6.1 mandates from Phase 4+. Jointly, at a 4,000 USDC/yr coretime floor:

| Collators | `C` (USDC/yr) | Interlude renewal | Leadin-end renewal | What the policy buys |
|---:|---:|---:|---:|---:|
| 5 (launch) | 109,281 | 14.7 yr | **33.1 yr** | +18.3 yr |
| 8 | 135,370 | 14.0 yr | **26.9 yr** | +12.9 yr |
| 10 | 152,763 | 13.6 yr | 23.9 yr | +10.3 yr |
| 12 (mandated ceiling) | 170,156 | 13.1 yr | 21.5 yr | +8.4 yr |

So the cheap policy clears 25 years at the launch count and at 8, and **does not clear it at 10 or 12** — while the expensive policy clears it at no mandated count at all, so renewal timing is never what causes the miss. Note also that what the policy buys **shrinks as `C` grows**: a larger constant base ends the runway before the ratchet has time to saturate. The conclusion §10.5 already draws is unchanged and is reinforced rather than replaced — at the mandated count, mature operation depends on revenue rather than on the endowment, and break-even occupancy stays inside the lawful five-slot slate at every mandated count. Pinned jointly by `test_the_coretime_win_does_not_by_itself_save_the_25_year_goal`, so neither half can be quoted alone.

**The cost of the cheap policy is liveness risk, and it is bounded and observable.** After the interlude, new buyers compete for cores and `ensure_cores_for_sale` can return `SoldOut`; a renewal deferred to the end of the leadin can therefore be refused, where an interlude renewal cannot. That risk is *measurable from the same sale state the quote is already read from* (`cores_sold` against `cores_offered`), which is why [09](09-execution-upgrades-and-rollout.md) §4 states the policy as **renew as late as the observed remaining-core margin allows, never later**, rather than as a fixed block. The `renewal_bump`, `interlude_length` and `leadin_length` are relay-governance `ConfigRecord` values, not constants of this repository; they remain `[VERIFY]` and every figure above is stated against Kusama's published 3 % bump as a bracket, never as Polkadot's value.

What survives of the original paragraph: the annual cost of this line is still not derivable from the specification, because `end_price` is a market price. A parachain cannot run without buying coretime; every other line above is a service level the treasury chooses. What is new is that **the multiple of the market price Bleavit pays is also a choice**, and left unstated it defaults to the expensive one — the interlude is the obvious, safe-looking moment to renew.

**Eight lines are not sizeable from any evidence in this repository, and are therefore not sized here.** `ops.bootnodes`, `ops.rpc_archive`, `ops.oracle_evidence`, `ops.watchtowers`, `ops.monitoring`, `ops.arweave`, the `broker.renew` price component of `ops.coretime`, and the `ORACLE` line all carry `[VERIFY — sized in Phase-2/3 ops planning; ops-gated]` in [13](13-parameters.md) §1 and stay that way: what each MUST fund is specified as a **count** ([12](12-release-and-operations.md) §6.1 — ≥ 8 WSS endpoints across ≥ 4 operators on each of two networks, ≥ 4 RPC + ≥ 2 archive nodes serving 30 days of state, ≥ 2 bonded watchtowers, ≥ 2 independent keeper operators, ≥ 2 monitor operators, 3-of-5 ArNS custody), but **no unit cost, hardware profile or headcount figure exists anywhere in the specification or the deployment tooling**. Inventing one would be exactly the fabrication R-2 forbids. The subtotal above is therefore a **floor on `C`, not an operating point**; §10.4 states the crossover at that floor and at two stated ops overlays (+0.5M, +1.5M/yr) so the sensitivity is visible rather than hidden inside a single fabricated total.

**The divergence row is the no-rerun case, and until now nothing said so (added 2026-07-31, milestone E7, SQ-540(d)).** [05](05-welfare-and-decision-engine.md) §2.1 T13 reopens a delayed proposal's books at **2× POL** with positions intact, and §4.4 above states normatively that this top-up is deliberately *not* charged against `pol.budget_epoch` — the exposure is structurally bounded rather than budget-bounded, because `delayed_once` and `rerun` are one-way flags, so each proposal admits at most one rerun. That reasoning is sound and is not disturbed here. What was missing is its consequence for **this table**: realized divergence is `b·[ln 2 − H(p)]` and therefore linear in `b`, so a rerun book costs up to twice a non-rerun one, and the 1,083/18,830 figures are the `rerun_fraction = 0` corner.

The exposure is bounded and worth stating plainly: an epoch whose whole qualified slate reruns costs up to **≈ 2,166 USDC/epoch ≈ 37,660 USDC/yr**, i.e. **+17.2 % on the whole §10.1 cost base**, taking the §10.5 zero-revenue runway from 34.3 to **29.2 years** at the launch collator count. Stacked with the 12-collator mandated ceiling — the pessimistic corner of everything §10 quantifies — `C` reaches **188,986 USDC/yr** and the runway **19.4 years** under the cheap coretime policy. None of that reverses §10.5's standing conclusion; it sharpens it. The renewal-timing term of §10.1 remains larger than the rerun term even in that corner, and the zero-revenue reading still fails at the mandated count for the reason already given: mature operation depends on revenue rather than on the endowment. **An understated `C` flatters every runway figure**, which is why the row is now labelled and the rerun term is re-derivable (`sustainability.py`, `PolRerunExposureTests`) rather than left implicit.

**A ninth line is not a cost at all and must not be counted as one.** The POL *commitment* (§3: 34,657 USDC for PARAM, up to 159,424 for META, plus 17,329 for the Baseline) is a **revolving** obligation, not a spend: §3 and §8 step 5 both say the committed POL **withdraws at settlement** and the realized cost is the live-branch divergence loss only. At the [04](04-markets-and-pricing.md) §12 worked walk that is ≈ 180 USDC for a TREASURY decision book and ≈ 1,083 USDC per epoch for a full PARAM slate plus Baseline — the row already in the table above, three orders of magnitude below the commitment. **An implementation that does not return the seed converts the largest revolving balance in the system into a recurring expense**; §10.5 records that this is exactly what the pre-E1 implementation did, and what it cost.

### 10.2 What the protocol earns: `R(V)`

Two instruments, both paid by traders in USDC, on **two different bases** — which is the point of having two.

**A third instrument was already being charged and thrown away, and is now retained (added 2026-07-31, milestone E7, SQ-540(e)).** The chain prices every inbound XCM message for execution at the governed [13](13-parameters.md) §1 rates through `GovernedWeightTrader`. Until E7 the runtime bound `Trader = GovernedWeightTrader<ConstitutionTraderRates, ()>`, and `TakeRevenue for ()` drops the collected assets when the trader is dropped — so the fee was computed, charged, and discarded. Unlike A and B that was never a design choice about incidence; it was unfinished wiring, and the trader's own comment said so. The revenue is now routed to `MAIN`.

**What "discarded" actually meant, since it bears on how much this is worth.** The dropped fee was not value destroyed. Local USDC issuance is backed by the sovereign reserve on Asset Hub, so burning a fee left the reserve over-backing local issuance — real protocol-owned value, but sitting off-ledger, invisible to `nav()`, and reachable only by a governance reconciliation of the sovereign account. Routing it to `MAIN` leaves local issuance and the reserve in exactly the same relation while making the value **visible and spendable**. That is the gain: not new money, but money the treasury can actually use.

**It is written as a separate additive term, not folded into `R`.** A and B are both proportional to `H`; this one is proportional to inbound message volume, which is an independent driver. So `R_total = R(H) + R_C`, with `R_C = fee_per_message × messages`, and no figure below that is stated per unit of `H` includes it.

The size is derivable from this repository, and only one input is not. Message weight is `FixedWeightBounds<UnitWeightCost, …>` with `UnitWeightCost = (10⁹ ref-time, 64 KiB proof)` **per instruction**; the rates are `xcm.trade_usdc_per_sec` = 50 USDC/s and `xcm.trade_usdc_per_mb` = 5 USDC/MiB. So each instruction is priced at `0.001 s × 50 + 0.0625 MiB × 5 = 0.3625 USDC`, and a minimal four-instruction inbound reserve transfer pays **1.45 USDC**. The input that cannot be derived is **inbound message volume**, so the figure is stated as a break-even rather than as revenue:

| Cost base | Annual `C` | Inbound messages/day at which the discarded fee alone covers `C` |
|---|---:|---:|
| §10.1 subtotal, 5 collators (launch) | 109,281 | **206/day** |
| §10.1 subtotal, 12 collators (mandated ceiling) | 170,156 | **321/day** |

At 100 messages/day it is already ≈ 48 % of the launch cost base. **Two caveats bound how much weight this carries.** First, the level is a property of the *weigher*, not of measured resource use: `FixedWeightBounds` charges a flat 64 KiB of proof per instruction whatever the instruction does, and that term is **86 %** of the fee — replacing it with benchmarked bounds would cut the revenue substantially, and the reference model asserts the 86 % split so a later weigher change cannot silently invalidate this paragraph. Second, this is a **volume the protocol does not control**, so it belongs beside `τ` as a market-behaviour parameter, not beside the endowment. Neither caveat changes the conclusion that a fee already being charged should not be discarded. **Wired in E7**: the runtime now binds `FeesToTreasury`, which deposits the fee through the executor's own asset transactor and recognizes the **USDC portion only** as internal `MAIN` credit (DOT is deposited but not recognized, because §1.2 marks DOT at 0 in NAV). Recognition strictly follows custody, so the path cannot make the internal ledger claim more than the pot holds, and a failed deposit degrades to the previous discarding behaviour rather than to an unbacked claim (G-1, I-33). Derivation and break-even in the reference model (`sustainability.py`, `XcmDiscardedRevenueTests`), which transcribes `GovernedWeightTrader::price_up` including its payer-adverse per-dimension rounding.

Let **`H`** = *held capital*: the escrow attributable to trader positions still open when books freeze at d18. Let **`V`** = *turnover*: the fee-assessed cost volume of `buy` and `sell` (`cost` on buys, `proceeds` on sells), fee-exclusive. Let **`τ = V / H`** be the turnover ratio; `τ ≥ 1` by construction, since every unit of held capital was bought at least once.

**`H` is defined as escrow and computed as marked contest capital, and the two are only approximately equal — the whole revenue model rests on that approximation, so it is stated rather than assumed (normative caveat; added 2026-07-29, milestone E1).** Instrument B's base is escrow: `ledger.redeem_fee` is charged on payouts drawn from `escrowed`, which is *cost paid in*. §10.3 computes `H` a different way — as the sum over books of the [04](04-markets-and-pricing.md) §7a contest-capital measure, which is **marked net open interest** `noi_t = q_long·p + q_short·(1−p)` at live prices. The two coincide exactly only when marked value ≈ cost paid, i.e. when prices have not moved far from the average execution price of the outstanding inventory. They diverge in both directions and the divergence is unbounded in principle: a book that resolves toward one leg marks that leg up and the mirror down, while escrow is unchanged. Every `H`-derived figure in §10.3–§10.6 therefore carries this approximation, and no figure in this section should be read to a precision the approximation does not support. It is used because it is the only bridge available between the security calibration (which is stated in `noi`) and the fee base (which is stated in escrow); a measurement that reported both quantities separately would replace it, and is part of what [15](15-invariants-and-testing.md) §4.9's obligations 2 and 5 would deliver.

```
R_A(V) = mkt.fee · ρ · V            // A — trading fees (04 §6.1)
R_B(H) = ledger.redeem_fee · β · H  // B — redemption fees (03 §5.3a)
R      = H · ( mkt.fee·ρ·τ + ledger.redeem_fee·β )
```

- **`ρ` = 0.75**, the *realized* fraction of nominal trading fees. Buy-side fees are collected as a complete branch-USDC pair and are worth their face value at any settlement — realization 1.0, unconditional ([04](04-markets-and-pricing.md) §6.1). Sell-side fees are withheld single-sided in target-branch bUSDC and follow the branch — realization ≈ 0.5 across a book whose branch is annulled half the time. At an even buy/sell split that is `0.5·1 + 0.5·0.5 = 0.75`. Baseline books realize 1.0 on both sides, so ρ = 0.75 is the conservative reading — but by **two different mechanisms**, and the earlier parenthetical ("their fee is retained as plain USDC") described only one of them (corrected 2026-07-29, milestone E4, SQ-519). The Baseline **sell** fee is retained as plain USDC by the book, which needs no redemption leg. The Baseline **buy** fee is a complete LONG+SHORT set segregated into the fee account at trade time, which realizes at par because a complete set pays exactly 1 USDC at any `s_e` ([04](04-markets-and-pricing.md) §6.1/§8.2). Both reach `MAIN`; only the second was a claim this row made before the code delivered it.
- **`β` = 0.50**, the fee-assessed share of terminal claim mass. Total winning-branch claims equal `E` exactly (§6.5 of [03](03-conditional-ledger.md)), but `redeem` — the par leg — is exempt (03 §5.3a), and for wrapper traffic roughly half the surviving claim mass is mirror branch-USDC redeeming through `redeem` while the other half is scalar and gate legs. β = 0.5 is that split.

  **β = 0.50 is an upper estimate, and the realized base is smaller by an unquantified amount (added 2026-07-29, milestone E1; SQ-509).** The par-leg exemption is not the only escape from instrument B. [03](03-conditional-ledger.md) §5.1 admits `merge_scalar` and `merge_gate` in `Resolved`, and every `merge*` is fee-exempt, so a holder of a **complete** `LONG_w + SHORT_w` set converts it to winning branch-USDC for free at any point in the `Resolved` window — d18 to cohort settlement at e+3, roughly three epochs — and then exits through the exempt `redeem`. A cross-branch complete pair escapes through the exempt `merge` at par more directly still. Charging the pair calls does not close this: `redeem_scalar_pair` is reachable only for a set assembled **after** `ScalarSettled` ([03](03-conditional-ledger.md) §5.3a(1), as corrected). β therefore over-states the assessed share by whatever fraction of terminal claim mass is held as complete sets by holders who bother to merge — a quantity nothing in this repository measures, and one that rises with the sophistication of the holder base. Every `R_B` figure below is an **upper** estimate on that account. Closing the escape is **SQ-509**.
- **`τ` is the one input this specification cannot derive**, because it is a market-behaviour parameter rather than a protocol constant. The [15](15-invariants-and-testing.md) §4.9 Phase-0 **population** supplies a reading of it: all-book turnover runs **5.8× min-book contest capital** (median; mean 7.29, p95 14.32), of which **47.9 % is round-trip churn** that the [04](04-markets-and-pricing.md) §7a contest measure nets out by construction. Excluding churn the ratio is **≈ 3.0** all-book (≈ 2.2 on the decision pair alone). The tables below use **τ = 3 as the central, churn-excluded case** and bracket it with τ = 2 and τ = 5.8.

  **Provenance (normative; corrected 2026-07-29, milestone E1).** Those figures come from an **ad-hoc instrumented run over the Phase-0 population, not from the committed artifact** (**SQ-506**). `simulation/results/phase0-calibration.json` carries no turnover or fee series at all — its only fee-related key is `.config.mkt_fee`, the input rate — because `ExecutedBook.fees` is computed and discarded ([15](15-invariants-and-testing.md) §4.9, obligation 2). Every τ, held-capital-ratio and fee figure in §10.2 and §10.4 is therefore **unpublished evidence**: reproducible from the committed model at the recorded commit, but not part of the Merkle-bound artifact and not covered by its `--check` leg. They MUST be cited with that qualification and MUST NOT be presented as artifact-backed.

  **And they are floors, not point estimates (SQ-506; [15](15-invariants-and-testing.md) §4.9, obligation 3).** `book.events.clear()` truncates the pre-extension trade ledger, so lifetime volume under-reports by **2.5–3.3×** for the **51 %** of proposals that extend. Every volume-derived figure in §10.2 and §10.4 — τ itself, and every gross-fee figure — is low by some fraction of that factor and is a **floor**. The direction is uniformly revenue-understating, hence conservative for this section's purpose: a true τ ≥ the measured one makes `R` larger and `V*` smaller, so §10.4's crossover figures are **upper bounds** on the depth required. The one class of statement the truncation does *not* protect is a claim that revenue is *bounded above* or that a shortfall is *at least* some size; §10.4 flags the single place that matters.

  **The measurement is a consistency check, not a forecast, and MUST NOT be presented as one.** The simulation's flow targets are `dec.v_min × formation_stratum` (`corr(volume, dec.v_min)` = 0.947, r² = 0.90) and nothing in it responds to fee level, proposal salience or trader population. Its fee output is therefore a restatement of the security parameter, and a `mkt.fee` sensitivity sweep run against it would show revenue perfectly linear in the rate with zero volume elasticity — a property of the model, not of any market. What it does establish, and what §10.3–§10.4 rely on, is that the structural relations hold: a decision-grade book carries **1.5–1.8× `dec.v_min`** of held capital (median 1.76 among passing books), and turnover is a low single-digit multiple of it. **Establishing the demand side is an open obligation on the simulation, recorded in [15](15-invariants-and-testing.md) §4.9**, and no claim of self-funding may rest on the present model.

**Instrument B exists because its base is floor-bounded and A's is not.** A decision-grade proposal MUST hold contest capital ≥ `dec.v_min(class)` on **each** decision book and ≥ `gate.v_min(class)` on each gate book through the 72 h decision window ([04](04-markets-and-pricing.md) §7a, [05](05-welfare-and-decision-engine.md) §5.2) — and books freeze at the window's end, so that capital is still held at settlement. `H` therefore has a hard floor per qualified proposal that `V` does not: turnover can be zero while `H` cannot, so B earns in a quiet-but-capitalized epoch where A earns nothing. That is the whole structural argument for a second instrument, and it is not a transformation: at the central τ = 3 and equal 30 bps rates, B's share of `R` is `ledger.redeem_fee·β / (mkt.fee·ρ·τ + ledger.redeem_fee·β)` = `0.0015 / 0.00825` = **18.2 %** — falling as τ rises, since only A's term scales with turnover. (The share is stated here because this is the section that defines both terms; §10.4 tabulates `R` and does not state it. The earlier "about a sixth" understated it.)

### 10.3 Capacity: is `V*` reachable at all?

**Once the Phase-3 exposure caps are lifted (D-13; [09](09-execution-upgrades-and-rollout.md) §5.2) there is no structural ceiling on either `V` or `H`, and the derivation that looks like one does not bind.** The qualifier is not decoration: **during Phase 3 `phase3.tvl_cap` is a hard 2,000,000 USDC global ceiling on local USDC issuance** ([13](13-parameters.md) §1; [09](09-execution-upgrades-and-rollout.md) §5.2) — a *stock* bound on all USDC on this chain at once, which every figure in this section exceeds. It sits **38× below the smallest saturated annual `H` tabulated below** (5 × PARAM at 76,528,571) and below the concurrent held capital of a saturated five-slot slate of any class. None of the depths in this section is reachable while that cap is in force, and no statement here about capacity, crossover or self-funding applies to Phase 3. With that said, and for the post-cap regime the rest of §10 is about: the LMSR domain bound `|q_L − q_S|/b ≤ 48` ([04](04-markets-and-pricing.md) §4) caps *net* displacement, not gross position: balanced two-sided flow leaves the difference at zero while `noi_t = q_long·p + q_short·(1−p)` grows without limit. `MaxTrade = b/4` caps a single extrinsic, not a sequence. `epoch.slots` (5, registry max 12) and ≤ 6 books/proposal cap the number of *books*, not the depth of any one. Block space is nowhere near binding. **`V_max` is an economic quantity, not a protocol constant, and this specification does not get to assert one.**

What the protocol *does* pin is the depth its own security calibration is designed around, and that is the honest capacity reference:

| Class | Held capital at the `dec.v_min` **floor** (2 decision + 4 gate books) | Held capital at **`sec.flow_cap` saturation** — the depth beyond which §5.2's `L̂` counts nothing further |
|---|---|---|
| PARAM | 240,000 | 800,000 |
| TREASURY | 600,000 | 1,280,000 |
| CODE | 1,440,000 | 2,400,000 |
| META | 2,880,000 | 3,680,000 |
| Baseline (per epoch) | 250,000 | 400,000 |

Saturation is `sec.flow_cap · (b_acc + b_rej)` per decision pair and `sec.flow_cap · pol.b_gate` per gate book, at the [13](13-parameters.md) §1 `pol.b` floors. The Baseline row has its own formula and it was previously left unstated: the Baseline book is **unbranched** and carries no gate books ([04](04-markets-and-pricing.md) §8.2), so there is no pair term and no gate term — its saturation is `sec.flow_cap · pol.b_baseline` = 16 × 25,000 = **400,000**. Above it, extra capital buys no additional security certificate — so it is the natural upper end of the band the protocol was calibrated for, not a limit on what a market may do.

Annualized (17.393 epochs), a 5-slot chain runs between:

| Slate | `H` at the `v_min` floors | `H` at `sec.flow_cap` saturation |
|---|---|---|
| 5 × PARAM | 25,219,643 | 76,528,571 |
| 5 × TREASURY | 56,526,786 | 118,271,429 |
| 5 × CODE | 129,576,786 | 215,671,429 |
| 12 × CODE (registry max slots) | 304,896,786 | 507,871,429 |

### 10.4 The crossover, `V*`

At the **current defaults** — `mkt.fee` = 30 bps, `ledger.redeem_fee` = 30 bps (§10.6 derives why they are equal):

| Slate | `H`/yr | `R` at τ=2 | **τ=3 (central)** | τ=5.8 |
|---|---|---|---|---|
| 5 × PARAM @ `v_min` floor | 25,219,643 | 151,318 | 208,062 | 366,946 |
| 5 × PARAM @ saturation | 76,528,571 | 459,171 | 631,361 | 1,113,491 |
| 5 × TREASURY @ saturation | 118,271,429 | 709,629 | **975,739** | 1,720,849 |
| 5 × CODE @ saturation | 215,671,429 | 1,294,029 | 1,779,289 | 3,138,019 |
| 12 × CODE @ saturation — **book-capacity reference, not an operating point** | 507,871,429 | 3,047,229 | 4,189,939 | 7,389,529 |

**The 12-slot row is a capacity reference and MUST NOT be read as a revenue scenario.** `epoch.slots`'s registry maximum is 12, so twelve concurrent *books* is a reachable configuration — but `code.spacing` = 30 d is an **execution** meter ([09](09-execution-upgrades-and-rollout.md) §5), and against a 21.0-day epoch it admits roughly **one CODE execution per 1.43 epochs**. A slate of twelve CODE proposals per epoch cannot execute; the row states what twelve saturated CODE-depth books would earn, which is a bound on book capacity and nothing else. Every conclusion in this section is drawn from the five-slot rows.
Break-even held capital `V*` (and the equivalent turnover `τ·V*`):

| `C` | τ=2 | **τ=3 (central)** | τ=5.8 |
|---|---|---|---|
| **109,281** (post-SQ-531 + post-SQ-536 derivable lines — **the current base**) | `H` = 18,213,518 | **13,246,195** | 7,510,729 |
| ~~239,728~~ (superseded 2026-07-31 — post-SQ-531 but at the 2,000 collator seed) | 39,954,590 | **29,057,883** | 16,476,119 |
| ~~1,145,562~~ (**superseded 2026-07-30** — the pre-SQ-531 fee basis; retained so the size of the correction stays visible) | `H` = 190,926,921 (`V` = 381,853,842) | **138,855,943** (416,567,828) | 78,732,751 (456,649,955) |
| **1,645,562** (+0.5M ops overlay) | 274,260,254 (548,520,509) | 199,462,003 (598,386,009) | 113,097,012 (655,962,670) |
| **2,645,562** (+1.5M ops overlay) | 440,926,921 (881,853,842) | 320,674,124 (962,022,373) | 181,825,534 (1,054,588,100) |

**Read against §10.3's capacity table, the crossover now sits well inside the protocol's own design point (rewritten 2026-07-31 for the post-SQ-536 base; the two superseded readings follow).** At the current `C` = 109,281 and the central τ = 3, `V*` = **13.2M** — **0.11×** the 5 × TREASURY saturated slate, **0.06×** the 5 × CODE one, and **0.53×** a five-slot PARAM slate held at the bare `dec.v_min` floor. At the intermediate post-SQ-531 base it was 29.1M, i.e. **1.15×** that floor slate. **Neither figure means the chain funds itself at minimum activity**, because held capital scales with slate *occupancy* and these compare against a full five-slot slate — see the occupancy tables in the section preamble. At the **shipped** base the consistent break-even is **1** occupied slot at τ = 3 and **1** at τ = 5.8; on the conservative reading that holds cost at its full-slate value it is **3** and **1**. The 7-and-3 pair those tables also carry belongs to the **superseded** 2,000 collator seed and must not be read as current.

**Superseded reading, retained deliberately.** At the pre-SQ-531 `C` = 1.146M the same arithmetic gave `V*` = 138.9M — 1.17× the 5 × TREASURY saturated slate and 0.64× the 5 × CODE one — and concluded that only a mature treasury/code-class chain reached break-even, with a PARAM-only floor slate short by 3.1–7.6×. That conclusion was correct for its cost base and is wrong for this one; it is kept because the gap between the two is the whole measure of what a single unverified parameter was doing to this section.

Equivalently, the rate that would clear `C` at saturated capacity (with `ledger.redeem_fee` = `mkt.fee` per §10.6):

| `C` | 5 × TREASURY @ sat, τ=2 / **3** / 5.8 | 5 × CODE @ sat, τ=2 / **3** / 5.8 |
|---|---|---|
| 1,145,562 | 48.43 / **35.22** / 19.97 bps | 26.56 / **19.31** / 10.95 bps |
| 1,645,562 | 69.57 / **50.59** / 28.69 bps | 38.15 / **27.75** / 15.73 bps |
| 2,645,562 | 111.84 / **81.34** / 46.12 bps | 61.33 / **44.61** / 25.29 bps |

Only one cell in that table exceeds `mkt.fee`'s 100 bps registry maximum, and it is the corner where a +1.5M ops overlay meets the thinnest mature slate at the lowest turnover — a configuration the σ-band rule below already forbids reaching by rate.

**Independent cross-check against the Phase-0 population — from an ad-hoc instrumented run, *not* the committed artifact (SQ-506).** Every figure in this paragraph was produced by re-running the [15](15-invariants-and-testing.md) §4.9 model with fee and volume instrumentation added; `simulation/results/phase0-calibration.json` carries no fee series (§10.2, *Provenance*), so none of it is Merkle-bound, `--check`-covered or reproducible from the artifact alone. At 5 slots and 17.393 epochs the chain decides **87.0 proposals/year**. The instrumented gross fee per proposal is a median of **20,864 USDC** (mean 48,691; decision-grade median 24,686) across a balanced four-class mix at 30 bps — i.e. **1.82M/yr on the median proposal, 4.23M/yr on the mean**, before the ρ = 0.75 realization discount and before excluding the 47.9 % churn component. On a launch-realistic all-at-floor cohort (`b` at the `pol.b` floor, `v_min` at the `dec.v_min` floor) the mean is 12,149 ⇒ **≈ 1.06M/yr gross, ≈ 0.55M ex-churn, ≈ 0.41M realized.**

**What the truncation does to that cross-check.** Every figure above is a **floor**: the `book.events.clear()` defect of [15](15-invariants-and-testing.md) §4.9 obligation 3 truncates lifetime volume for the 51 % of proposals that extend, under-reporting by 2.5–3.3× on those. The two conclusions therefore do not survive equally. **"The mature mixed cohort clears `C`" is robust** — the true figure is at least the measured one, so a cohort that clears at the measured level clears at the true level *a fortiori*. **"The floor cohort is short of `C` by roughly 3×" is not** — it is an *upper bound on the shortfall*, and the true gap is smaller by some fraction of the truncation factor, plausibly much smaller. The honest statement is therefore weaker than the original bracketing claim: the mature cohort clears, the floor cohort's shortfall is bounded above by ≈ 3× and is not otherwise pinned, and the two ends do not bracket the structural model so much as fail to contradict it from either side. **The same caveat applies to all of it: these are the security parameter restated, not measured demand.**

**`mkt.fee`'s [13](13-parameters.md) §1 hard max of 100 bps is not the binding constraint, and no META `amend_registry` raise of that max is required.** Every cell above except one is inside it. The binding constraint is a different one, and it binds well below 100 bps: **fee-induced price-band width.** A round trip through a book costs `2·mkt.fee` of notional, which at `p ≈ 0.5` is a no-arbitrage band of `mkt.fee` **in `s`-units** — 0.0030 at 30 bps, 0.0100 at 100 bps. The decision rule's smallest live tolerance is `dec.sigma` = 0.003 / 0.005 / 0.008 / 0.010 per class ([13](13-parameters.md) §1) — the Baseline-floor slack `r_eff = max(r_f, base − σ(class))` of [05](05-welfare-and-decision-engine.md) §5.3. At the 30 bps default the fee band is **exactly σ_PARAM**; at 100 bps it is 3.3× σ_PARAM and equals σ_META. Raising `mkt.fee` toward its registry ceiling therefore buys revenue by making the price series less able to resolve the differences the decision rule is built to act on.

**Why σ and not δ is the comparator (argued, not assumed; added 2026-07-29, milestone E1).** `dec.delta` is the *margin a decision must clear*; `dec.sigma` is the *finest distinction the rule draws in the same `s`-units*, and by the [13](13-parameters.md) §1 bound `σ ≤ δ/2` it is always the tighter of the two. The failure mode being priced here is **resolution**, not margin: a no-arbitrage band as wide as σ means the smallest difference the rule acts on is inside the interval where the price series is indeterminate, so the distinction is not merely narrowed but unrecoverable. σ is therefore the constraint that binds first, and it is the conservative comparator. **The δ reading is stated too, because it is the one a reader will ask for and it must not be left implicit:** against `dec.delta` = 0.0375 / 0.0375 / 0.060 / 0.090, a 30 bps band is **8 %** of δ_PARAM and a 100 bps band is **27 %** — a material erosion of the decision margin, but on its own not disqualifying. Both readings point the same way and neither supports a raise; the conclusion below is drawn on σ because it is reached first, not because δ was avoided. **The rate SHOULD NOT be raised at launch**; the crossover is to be reached by depth, not by rate, and any raise is evidence-driven against measured `ManipFloor̂`/F̂ series (§5.5), not against a revenue target.

### 10.5 Endowment runway, and the defect that dominated it

`pol.budget_epoch` is 0.75% **of NAV**, so drawdown capacity shrinks with the treasury: below **13,862,944** USDC no CODE proposal fits an epoch's POL budget (**§4.1** — the seeding floors live there; §4.2 is the arming *gate* that reads them) and below **4,620,989** no proposal of any class can be seeded (§4.1). The §4.2 arming bit that CODE and META share binds higher still, at META's **21,256,533**.

**Two floors, two questions — the table below reports both, and joining one to the other is a non-sequitur (corrected 2026-07-29, milestone E1).** Measured against the **arming** bit, a 25M genesis has only ≈ **3.7M** of drawdown before CODE and META could no longer be armed. Measured against CODE's **seeding** floor, the usable envelope is about **11M**. Both figures are right for their own question; the earlier text named META's 21,256,533 as the binding arming floor and then concluded "therefore about 11M", which is `25M − 13,862,944` — the answer to the *other* question. Neither figure is 25M, and that, not the arithmetic joining them, is the point the paragraph exists to make.

| Annual net burn | To the 21.26M shared CODE/META arming floor | To 13.86M | To 4.62M |
|---|---|---|---|
| **`C` = 109,281 (post-SQ-531 + post-SQ-536 derivable lines — the current base)** | **34.3 yr** | **101.9 yr** | **186.5 yr** |
| ~~`C` = 239,728~~ (superseded 2026-07-31 — post-SQ-531 at the 2,000 collator seed) | 15.6 yr | 46.5 yr | 85.0 yr |
| `C` = 1.146M (superseded — the pre-SQ-531 fee basis) | 3.3 yr | 9.7 yr | 17.8 yr |
| `C` = 2.646M (+1.5M ops overlay) | 1.4 yr | 4.2 yr | 7.7 yr |
| `C` = 2.954M (**the pre-E1 implementation** — the derivable base plus the **gross** 1,808,371 diversion below; the net-of-realized-cost 1,789,542 gives 2.935M, which rounds to the same cells at 1 dp) | 1.3 yr | 3.8 yr | 6.9 yr |

**The runway above is stated at the LAUNCH collator count, and the mandated growth erodes it below 25 years (normative qualification; added 2026-07-31, milestone E5, SQ-536).** The 34.3-year figure assumes **5** collators. [12](12-release-and-operations.md) §6.1 mandates growth to **8–12** bonded permissionless collators from Phase 4+, and since SQ-536 put `collator.comp_epoch` on its registry floor the only remaining lever on this line is the **count** — which is a liveness posture, not an economics choice. At zero revenue:

| Collators | `C`/yr | To the 21.26M arming floor | To 13.86M |
|---:|---:|---:|---:|
| 5 (launch) | 109,281 | **34.3 yr** | 101.9 yr |
| 8 | 135,370 | 27.7 yr | 82.3 yr |
| 10 | 152,763 | **24.5 yr** | 72.9 yr |
| 12 (mandated ceiling) | 170,156 | **22.0 yr** | 65.5 yr |

So a 25-year endowment-only horizon holds at 5 and 8 collators and **fails at 10 and 12**. This is stated rather than left for a reader to derive, because the headline figure and the mandated operating point disagree and the specification mandates the operating point. **The conclusion to draw is not that the endowment is too small**: break-even occupancy stays inside the lawful five-slot slate at *every* mandated count (1 slot at 5 collators, 4 at 12, both at the central τ = 3), so zero revenue is the pessimistic bound rather than the expected case. What the table actually shows is that **mature operation depends on revenue, not on the endowment** — which is §10's standing conclusion, now with the count at which it stops being optional. Both halves are pinned by the reference model.

**The POL custody leak (normative record; the reason this section exists).** Until milestone E1 the implementation released the POL *accounting commitment* at settlement — restoring NAV by the full §3 figure — while never recovering the *custody*. The seeded cash stayed escrowed, its protocol positions were discarded at market reap, and the residue swept **wholly to `INSURANCE`**, which §1.2 places outside NAV. Per settled **proposal** the cash at risk is `(pol.b + 2·pol.b_gate)·ln 2` — one `split` funds a branch pair, so for a branched proposal book the cash is exactly half the §3 commitment: **17,328.68 USDC for PARAM**, 27,725.89 TREASURY, 51,986.04 CODE, 79,711.93 META. **The Baseline is not branched ([04](04-markets-and-pricing.md) §8.2) and the halving does not apply to it:** its cash is `pol.b_baseline·ln 2` = **17,328.68 USDC per epoch**, which is its *full* §4.3 commitment, not half of anything. The two figures coincide only because `pol.b_baseline` (25,000) happens to equal PARAM's `pol.b + 2·pol.b_gate`; the number is right and the derivation clause that used to cover both was not. **Both are floors on the custody at risk, not the whole of it:** §8 step 3 seeds each book with `b·ln 2 + headroom` of complete sets, and the `headroom` term ([04](04-markets-and-pricing.md) sizes it, per book) is real cash the same leak diverted and these figures omit. The direction is safe — the defect is understated, never overstated — and the term is left out because it is not a per-class constant this table could carry. On a 5 × PARAM slate that is **103,972 USDC/epoch ≈ 1,808,371 USDC/yr** against a true realized cost of ≈ 18,830 USDC/yr — a **≈ 1,789,542 USDC/yr** diversion of revolving working capital, **156 % of the entire derivable operating cost base**, and larger than either revenue instrument at any launch-realistic volume.

Three consequences are normative, not incidental:

1. **The value is stranded, not destroyed.** `INSURANCE`'s one exit is `sweep_insurance` under a passed TREASURY decision (§1.2), which itself consumes a proposal slot and that slot's POL subsidy — which then leaks in turn. Recovery is possible and is not automatic.
2. **NAV over-states custody, cumulatively, in the over-permissive direction.** Settlement released the obligation while the cash had physically left `POL`, and the POL budget line is never debited when a seed spends real USDC — so `NAV = main_usdc + Σlines + escrow − obligations` counts POL money that is gone. Every NAV-derived control is computed on an inflated base: `trs.cap_proposal`·NAV (the in-cap prize, and hence §5.2's sizing gate), `pol.budget_epoch`·NAV, and the §4.2 arming floors. This is an audit-scope-A accounting defect and is why E1 is scope-A work.
3. **Closing it is worth more than both revenue instruments combined at launch scale**, and it is a *compliance* fix, not a design change: §3 and §8 step 5 already mandate the withdrawal. §8 step 5 is amended **above** to say what "withdraws" means operationally, because saying it without naming a mechanism is how it came to mean nothing.

**What actually closes the gap at the mandated collator count (added 2026-07-31, milestone E7).** Every runway in this section is a **zero-revenue** reading, and the honest joint statement across §10.1's three E7 exposures is that zero revenue does *not* reach the 25-year horizon at the [12](12-release-and-operations.md) §6.1 mandated ceiling: 12 collators and the cheap coretime policy give **21.5 years**, and a fully rerun slate takes it to 19.4. That is the correct pessimistic bound and it should not be softened. What it is *not* is the operating case.

The §10.2 XCM instrument — the fee the chain was already charging and, until E7, discarding — closes it at a traffic level well below its own break-even:

| Inbound XCM messages/day | Annual `R_C` | Runway at 12 collators |
|---:|---:|---:|
| 0 | 0 | 21.5 yr |
| **50** | 26,481 | **25.4 yr** — clears the horizon |
| 100 | 52,961 | 30.9 yr |
| 200 | 105,922 | 54.9 yr |
| **321** | 170,006 | **indefinite** — the endowment is never drawn down |

Two things this does and does not claim. It **does** say that the 25-year goal at the mandated collator count needs roughly **50 inbound messages a day**, and that indefinite sustainability needs the §10.2 break-even rate — both derived, both re-checkable (`sustainability.py`, `XcmDiscardedRevenueTests`). It **does not** forecast that traffic: message volume is market behaviour the protocol does not control, and it belongs beside `τ` rather than beside the endowment, which is why it is stated as required traffic. It also excludes instruments A and B entirely, so it is the answer with the *trading* revenue this whole section is about set to zero — the two are additive (`R_total = R(H) + R_C`), and any positive trading volume lowers the message rate required.

### 10.6 Instrument sizing, and who actually pays

**`ledger.redeem_fee`'s bound is derived from exit-path neutrality, not from a revenue target.** A trader exiting a position before d18 pays `mkt.fee` on proceeds. A trader holding to settlement pays `ledger.redeem_fee` on the payout — **when that payout is a charged one**. If `ledger.redeem_fee > mkt.fee`, holding is more expensive than round-tripping **conditional on the position surviving to a charged redemption**, and the fee schedule then pays traders to close positions before the decision window ends — draining precisely the contest capital §5.2's `L̂` measures and `dec.v_min` requires. That is self-defeating twice over: it destroys instrument B's own base and it degrades the security certificate's input. Hence the coupling **`ledger.redeem_fee ≤ mkt.fee`**, screened at the amendment boundary against the live `mkt.fee` (the same shape [13](13-parameters.md) rule 7 already uses for `gate.v_min` ↔ `dec.v_min`) and asserted in `try-state`. The **unsafe direction is upward**, so the coupling is the ceiling and the default sits at it: `ledger.redeem_fee` = `mkt.fee` = 30 bps, the largest exit-neutral value. It is a **separate key** from `mkt.fee` and not a reuse of it because the two price different acts on different bases with different elasticities — `mkt.fee` prices turnover through the book, `ledger.redeem_fee` prices settlement of held capital — and evidence that one is mis-set must be actionable without moving the other.

**"Dearer in every state of the world" was an over-claim; the true neutral point is nearer `2·mkt.fee` (corrected 2026-07-29, milestone E1).** The comparison above is conditional for a reason: a D-3 wrapper buyer whose branch **loses** redeems the mirror leg through the fee-**exempt** `redeem` ([03](03-conditional-ledger.md) §5.3a(1)) and pays **zero** exit cost on that path, so there is a whole class of states — roughly half of them, by the same split β = 0.50 encodes in §10.2 — in which holding costs nothing at all. The honest form of the comparison is therefore an expectation, not a per-state inequality: `E[hold exit] ≈ ½ · ledger.redeem_fee · payout` against `mkt.fee · proceeds`, which puts exact exit neutrality at roughly **`2 · mkt.fee`**, not at `mkt.fee`.

**The bound and the default do not move, and this is why.** `ledger.redeem_fee ≤ mkt.fee` is kept as a **deliberately conservative** ceiling sitting about a factor of two inside the expected neutral point — conservative in the correct direction for a key whose unsafe direction is upward and whose error is paid in drained contest capital and a degraded security input. The ½ is a population average over an unmeasured mix of wrapper and outright positions, not a per-trader guarantee: an outright scalar holder with no mirror leg faces the *full* rate on exit and is exactly the trader whose depth `dec.v_min` needs. Nothing in this correction licenses raising the key toward `2·mkt.fee`; it records that the ceiling is an intentional margin rather than the exact neutrality point, so that a later reader does not "fix" the apparent factor of two.

**Who actually pays (the central economic hypothesis, stated as such).** POL is an *explicit information subsidy* paid **to** traders ([04](04-markets-and-pricing.md) §10): the realized divergence loss is the treasury buying price discovery. Fees are collected **from** traders. Net, informed traders extract the subsidy and noise, hedging and arbitrage flow pays the fees. **The protocol is therefore solvent on trading revenue only if uninformed flow of order `V*` exists at the fee rates above.** No evidence in this repository establishes that it does. This is a hypothesis with a falsifier, and the falsifier is the [15](15-invariants-and-testing.md) §4.9 Phase-0 simulation, which must publish `τ`, per-class realized fee income and the informed/uninformed split alongside the existing decidable-harm rates before any claim of self-funding is made.

**Effect on the security certificate (§5.2–§5.3): none, by construction.** The `InCapPrize ≤ AttackCost̂/3` gate is a threshold test on *measured* contest capital, and neither instrument changes the measurement: the `v_min = 2P` identity of §5.3 holds unchanged, so every decision-grade, sizing-passing adoption still satisfies `AttackCost̂ ≥ 3·InCapPrize` with the same `3·b·ln 2` margin. Higher round-trip cost *raises* attacker cost — §7's "refund path" row already prices the attacker's `2 × 30 bps` entry/exit on 3M of held capital, and a redemption fee adds `ledger.redeem_fee` to the exit leg of that same held position. What both instruments do reduce is the *supply* of honest depth, which shows up as more `NotDecisionGrade` rejections — fewer decisions, less revenue, unchanged safety (status-quo default). §10.4's σ-band rule is the binding guard on that, and it is why the rate is not raised to chase the crossover.

**Quiet epochs.** Revenue is zero when no proposal qualifies, while collators, keepers and the `ops.*` lines still bill ≈ **2,700** USDC/epoch (updated 2026-07-31 for the post-SQ-536 seed) — `ops.collators` 2,500 + the whole metered keeper spend ≈ 148 + `ops.reserve_probe` 52, i.e. §10.1's subtotal less the two rows a quiet epoch does not incur. ~~10,200~~ was the figure at the superseded 2,000 collator seed. The composition is the point and it is unchanged by the re-anchoring: a quiet epoch is ≈ **93 %** collator compensation, because that is the only materially standing line left. Re-anchoring the rate lowered the bill; it did not change *what the bill is for*, and no available lever changes that — which is why §2.4's fail-soft payout and the mandated growth in collator *count* are the two things to watch here rather than the rate. ~~62,281~~ was the pre-SQ-531 figure (`ops.collators` 10,000 + `KEEPER` 12,000 + `ops.keepers` 40,229 + probe 52) (`REWARDS` 2,500, which §1.1 pays only on `Executed`, and the ≈ 1,083 POL divergence, which needs a seeded book). **This figure read 77,864 until 2026-07-30 and that was an arithmetic error, corrected here (spec-audit minor, closed in the SQ-523 session).** 77,864 is exactly §10.1's 65,864 plus a second copy of `keeper.budget_epoch`: it counted the keeper cost **gross** (`580,320 × 0.09` = 52,229) while also keeping the separate 12,000 row that the gross figure already contains. The error **overstated** cost, so it never supported a self-funding claim the arithmetic did not carry — but it propagated into §10.5's runway (see there) and into a 1,354,279 annualization that appears nowhere in §10.1's table, which is precisely the "does not derive from its own table" symptom. A minimally-qualified epoch — 5 PARAM at exactly `dec.v_min`, τ ≈ 1 — earns ≈ 4,500 USDC against that. **That figure counts the five proposal slates' held capital only and excludes the epoch's Baseline book**, unlike §10.3's and §10.4's `H` figures, which include the Baseline's 250,000 at the `dec.v_min` floors. The exclusion is stated rather than smoothed over; it is conservative — including the Baseline raises the figure — and understating a quiet epoch's revenue is the safe direction for a paragraph whose whole point is that neither instrument saves it. **Neither instrument saves a quiet epoch, and the design does not pretend otherwise**: the reserve that carries quiet epochs is the endowment under §10.5's runway, not `INSURANCE`. `INSURANCE` is not that reserve and MUST NOT be re-purposed as one — §1.2 fixes its size to the liability it actually backs (§1.2, as amended by E1), and a reserve sized to a *liability* cannot also be a buffer sized to an *expense*.

**Should the endowment still be 25M?** Yes, and §2.5's target is unchanged. With the POL leak closed, the SQ-531 fee basis corrected **and the SQ-536 collator rate re-anchored**, the endowment is a wide bridge rather than a narrow one: **101.9 years** to the CODE seeding floor at the derivable cost base — `(25,000,000 − 13,862,944) / 109,281` — against a crossover §10.4 now puts at 13.2M. To the *binding* shared CODE/META arming floor the same base gives **34.3 years**, which is the figure to quote when one figure is wanted: it is the earlier-binding floor and it assumes **zero revenue**. At the intermediate post-SQ-531 base the same two floors gave 46.5 and 15.6 years. **This read 9.7 years until 2026-07-31**, from the superseded 1,145,562 denominator; the correction is the SQ-531 fee basis and not a change of policy, and §2.5's 25M target is unchanged and now carries considerably more margin than it was sized for. **This read 8.2 years until 2026-07-30 and did not derive from that table** (spec-audit minor, closed in the SQ-523 session): 8.2 is the same quotient taken against 1,354,279/yr, the annualization of the erroneous 77,864/epoch §10.6 carried, and 1,354,279 appears in no table in this section. The error was in the conservative direction — a shorter runway than the cost base supports — but a headline figure that cannot be reproduced from its own table is exactly what this section may not ship. The §4.1 class floors are frozen literals movable only by CODE, under the [13](13-parameters.md) §5 item-6 value screen on `pol.budget_epoch` / `pol.b*` — nothing in this section moves them, and nothing here should be read as licence to.

---

## 11. Resolves

| Finding | Resolution in this document |
|---|---|
| B-8 (with [05](05-welfare-and-decision-engine.md)) | §5: decide-time `InCapPrize ≤ AttackCost̂/3` cap from measured depth + Ask-scaled `v_min`/`pol.b`/δ with the `v_min = 2P` identity; worked arithmetic shows the 27–290× shortfall closed at defaults |
| B-13 economic side (with [06](06-governance-and-guardians.md)) | §7: 10% slashes (routed via INSURANCE, overflowing to `MAIN` per §1.2 — never burned) + per-account rate limit priced out — griefing now costs five figures/epoch forfeited vs ~$314 time-value |
| B-14 / D-15 | §2: VIT 1B/12-dec allocation + vesting + zero-default 2%-capped issuance; ≥ 25M USDC target with adequacy arithmetic; collator comp 2,000; reporter bootstrap loans (recallable, skin-first slashing) |
| B-18 / D-15 | §3–§4: recomputed commitments (34,657 / 55,452 / 103,972 / 159,424 for PARAM/TREASURY/CODE/META; 17,329 Baseline), per-class NAV floors, loud `NavFloorUnmet` arming gate, `SlotsShrunk` event + FE surface, Baseline funded off-budget |
| X-14 / D-12 | §9: `fee.vit_usdc_rate` key, bounds, USDC-only viability incl. the on-ramp |
| B-med keeper budget | §6: ≥ 134k/580k crank recomputation, 12,000 USDC budget derivation, tranches, exhaustion alarms, A-1 restated |
| B-med USDC freeze (with [07](07-oracle-and-disputes.md), [10](10-frontend-architecture.md)) | §1.2: reserve-health haircut flag in `nav()`, spendable-NAV = 0 fail-static, PB-RESERVE hook, FE surfacing |
| **E1 — treasury sustainability (2026-07-29)** | §10 (new): the annual cost base, `R(V)` for both revenue instruments, the capacity reference, the crossover `V*`, the endowment runway, and the honest statement that the protocol is **not** self-funding at launch. §1.1: market-fee routing 100 % to `MAIN`, superseding the never-implemented 50 % INSURANCE / 50 % POL-offset split. §1.2: `INSURANCE` gains a **derived** target `T_ins` (unreclaimed swept residue + `min_balance`) with automatic above-target overflow to `MAIN`, and the NAV effect of every E1 inflow is stated with `NavView` deliberately unchanged. §8 step 5: "committed POL withdraws at settlement" given an operational definition splitting the obligation release from the **custody** return, with §10.5 recording the ≈ 1,789,542 USDC/yr the missing half cost and why over-stating NAV is the unsafe direction. §9: the transaction-fee **destination** this section never had — USDC to `MAIN`, VIT still burned, on the bridged-versus-native distinction. §10.6: `ledger.redeem_fee ≤ mkt.fee` derived from exit-neutrality, and the security certificate shown unaffected |
| X-13 partial / D-16 (with [12](12-release-and-operations.md)) | §1.1: named, funded `ops.*` budget lines incl. 30-day operator window, beyond-meter keeper subsidy, ArNS permabuy, coretime line (dead-man exempt per D-9) |
