# 04 — Markets and Pricing

**Status: normative component specification. Supersedes the corresponding sections of BACKEND_PLAN.md/FRONTEND_PLAN.md** (BE §11, §13 market mechanics, §17.3 seeding hooks, §5.2.2). Normative language per RFC 2119. Implements [00-decision-record.md](./00-decision-record.md) decisions **D-3** (trade denomination) and **D-8** (forecast-trading cut), and the dispositions for **B-6, B-7, B-3/X-10 (market side), X-5**, the forecast-mint medium, and the maker-loss and ADR-11 lows.

**Boundary.** This document owns: the LMSR mechanism and its fixed-point contract, the trade path and its denomination, market-side solvency (revenue recycling, headroom), the authoritative test vectors and their CI regime, the TWAP accumulator, the market-side specification of decision, gate, and Baseline books, the market lifecycle, and the `Traded`/`Observed` events. It references, and does not own: ledger custody, mint/burn, VOID and gate-instrument semantics ([03-conditional-ledger.md](./03-conditional-ledger.md)); the decision rule and decision-grade evaluation, breach-flag computation ([05-welfare-and-decision-engine.md](./05-welfare-and-decision-engine.md), doc 07); POL budgets and per-class economics (doc 08); frozen event/storage/API shapes ([02-integration-contract.md](./02-integration-contract.md)); parameter values ([13-parameters.md](./13-parameters.md)).

---

## 1. Market inventory and bounds

### 1.1 Inventory per proposal class

| Class | Markets | Books |
| --- | --- | --- |
| PARAM, TREASURY, CODE, META | decision pair + 4 gate books (S,C)×(adopt,reject) | 6 |
| Per epoch (unconditional) | Baseline welfare market on `s_e` (§8) | 1 |
| CONSTITUTIONAL | none (referendum path) | 0 |

There is no `Emergency` class (deleted per D-7). Decision and Baseline books are scalar LONG/SHORT on the settlement score `s ∈ [0,1]`; gate books are binary YES/NO on the deterministic breach fact (§9).

### 1.2 Bounds (normative; single derivation)

Books per proposal ≤ **6** (2 decision + 4 gate). Live Baseline books ≤ **4** (one per live epoch; ≤ 4 epochs are non-terminal at once). With `MaxLiveProposals = 32` spanning Screening→Settled across all live cohorts:

```
MaxLiveMarkets = 32·6 + 4 = 196
```

Universal gating of every market-bearing class does not change this maximum: six books was already the per-proposal upper bound. Typical per-epoch creation load is `N_active·6 + 1 = 31` books. All PoV/storage budgets derive from the 196 bound (re-derivation table in [13-parameters.md](./13-parameters.md)). The prior 121/225/7-books figures are superseded (D-10).

---

## 2. Market lifecycle

| Stage | When (epoch offsets; *normative values: §13*) | Actor | Semantics |
| --- | --- | --- | --- |
| **Create** | Seed, d4–d5 (57,600–72,000) | `pallet-epoch` tick work list | Vaults, decision pair, gate books for slotted proposals; Baseline(e) book; `BaselineMarketOf[e]` written (§8.3) |
| **Seed** | same window, atomic with create | treasury POL flow | Per-book headroom `b·ln 2` minted as complete sets via the ledger (§6.3, §10) |
| **Trade** | Trading, **d5–d18** (72,000–259,200; 13 days); per-pair `Extended` adds 3 days once | Signed users via `buy`/`sell` (§6) | Observations every `mkt.obs_interval = 10` blocks (§7). Trading is permitted **only** while the owning proposal is `Trading`/`Extended` (Baseline: §8.4) — this matches the frontend's pre-sign precondition rows exactly (X-5 closure) |
| **Close** | decision close (d18, or extended close) | internal (`pallet-epoch` → `close(market)`) | Book freezes: `q` immutable, TWAP accumulator sealed at the window boundary. **Books MUST NOT reopen after branch resolution — there is no post-resolution forecast trading in v1 (D-8; §13)** |
| **Settle** | cohort settlement at e+3 Housekeeping | SettleAuthority path (single path: `pallet-epoch` → `pallet-welfare::compute_settlement` → ledger; its entry points are enumerated in [05-welfare-and-decision-engine.md](./05-welfare-and-decision-engine.md) §6) | Winning-branch scalar books settle at `s`; gate books at the recorded daily breach flags (realized branch only; unrealized-branch instruments void); Baseline at `s_e`, or neutrally at `s = 0.5` on the two paths of [05-welfare-and-decision-engine.md](./05-welfare-and-decision-engine.md) §7(5)–(6) (§8.4). Voided-branch branch-USDC refunds principal per [03-conditional-ledger.md](./03-conditional-ledger.md) |
| **Reap** | settlement + `ledger.archive_delay` | keeper `reap(market)` | Bounded cleanup; `Markets` entry removed; history survives via events (§11) and `RecentCohortSummaries` (doc 02) |

The Trade phase is **d5–d18** (offsets 72,000–259,200 = 13 days). The former "d4–d18" label was arithmetic drift; d4–d5 is Seed (maker-loss low batch, Part 3 frozen constants).

**Reap ordering (normative).** The ledger's vault reap and the market's book reap are both permissionless and MUST be safe under any interleaving. The ledger's terminal markers are themselves swept state and MUST NOT serve as the market's POL-obligation predicate. Instead, every ledger transition that records a terminal block (`void`, `settle_scalar`, `settle_baseline` — [03](./03-conditional-ledger.md) §5.4) MUST, in the same atomic storage layer, latch that block into the owning market for each of the vault's books, and the latch is durable until the book is reaped. A seeded book's POL obligation is live **iff** no latch is recorded; reap MUST require the latch plus `ledger.archive_delay` elapsed since the latched terminal block. Because the latch is written in the same block as the marker, and the ledger sweep cannot run before `terminal + ledger.archive_delay`, no ordering can resurrect a settled book's obligation or wedge its slot. The latch MUST be idempotent, and marker and latch MUST commit or roll back **together**: a latch failure MUST roll the terminal transition back (status-quo default, G-1) and MUST NEVER leave a marker standing without a latch — the sweep would later delete that marker while the obligation predicate still reads live, wedging the slot permanently, which is the very outcome this rule exists to prevent.

---

## 3. LMSR mathematics

Two-outcome LMSR per book with subsidy parameter `b` (USDC):

```
C(q_L, q_S) = b · ln(e^{q_L/b} + e^{q_S/b})
p_L = e^{q_L/b} / (e^{q_L/b} + e^{q_S/b});   p_S = 1 − p_L
cost(buy Δ LONG) = C(q_L + Δ, q_S) − C(q_L, q_S)
displacement:  Δ = b·(logit p′ − logit p);   cost = b · ln((1 − p)/(1 − p′))
worst-case maker loss = b · ln 2   (from symmetric start)
```

Subsidy sizing: `b = SubsidyBudget / ln 2` per book; per-class `b` defaults (`pol.b`, `pol.b_gate`, `pol.b_baseline`) are constitution keys in [13-parameters.md](./13-parameters.md); the security-scaled sizing of D-4 (Ask-scaled `pol.b`) is owned by doc 08. Gate books use the identical mechanism with YES ↦ LONG, NO ↦ SHORT.

Every LMSR obligation is pre-collateralized in the conditional ledger: the book account holds complete sets covering its worst-case delivery and loss (§6.3). Invariant I-12 ties book state to held sets; a total failure of `pallet-market` can produce bad prices but can neither mint claims nor move escrow.

---

## 4. Fixed-point implementation (`futarchy-fixed` crate)

- Representation: unsigned 64.64 (`u128`; 64 integer + 64 fractional bits); signed ops on `i128` with explicit domain checks. `sp_arithmetic::FixedU128` at API boundaries; it lacks exp/ln, hence the custom crate.
- Domain: enforce `|q_L − q_S| / b ≤ 48` (prices confined to ≈ `[1.4e-21, 1 − 1.4e-21]`, practically clamped to `[0.001, 0.999]` for quoting). Trades that would exit the domain MUST be rejected (`PriceBoundExceeded`).
- `exp2`/`log2` via range reduction to `[1,2)`, the reduced-argument kernel evaluated at **guarded internal precision**: intermediates MUST carry enough guard bits beyond the 64 fractional result bits that the error bounds below hold in the worst case (64-bit-wide intermediates provably cannot; the reference configuration is ≥ 32 guard bits with a single final rounding, and a documented worst-case error analysis is part of the crate's conformance). The kernel form — minimax polynomial, table-product, digit recurrence — is implementation-free; **the bounds, not the method, are normative**. `ln x = log2 x · ln 2` with `ln 2` a 64.64 constant; log-sum-exp `C = max(q_L,q_S) + b·ln(1 + e^{−|q_L−q_S|/b})` for stability.
- **Maximum approximation error (normative; 1 ulp = 2⁻⁶⁴ throughout):** `exp2` ≤ 2 ulp of the range-reduced `[1,2)` kernel result — equivalently **relative error ≤ 2⁻⁶³** after the left shift (an absolute full-range 2-ulp bound is unattainable for integer parts ≥ 1 and is not meant); `log2`/`ln` ≤ 2 ulp **absolute** on the output over the full domain (range reduction is exact in binary; the fractional part inherits the kernel bound); marginal price ≤ 8 ulp absolute; composed cost-function error ≤ 8 ulp; per-trade cost error ≤ `8·2⁻⁶⁴·b` USDC — below one base unit for every `b ≤ 10⁹` USDC. **Verification cadence (normative):** per-commit CI regenerates and asserts an adversarial corpus (≥ 10³ points; MUST include dense-bit fractional inputs — not only few-set-bit fracs — and domain edges) derived from the §5 reference generator; the full ≥ 10⁷-point MPFR-256 sweep runs in the release pipeline and additionally whenever the fixed-point kernel or the reference model's numerics change (doc 15 §4.4).
- Rounding: every charge rounds **up**, every payout/proceed rounds **down** (maker-adverse from the trader's perspective, escrow-favoring); cumulative maker benefit ≤ 1 base unit per trade, swept as dust per the ledger dust rule.
- Overflow: all intermediate products in two-limb `u256` emulation; checked throughout; overflow aborts the extrinsic, never wraps.

---

## 5. Authoritative test vectors (B-6)

Normative; independent implementations MUST reproduce to stated precision. `b = 10,000` USDC (64.64). Start `q = (0,0)`, `p_L = 0.5`, `C(0,0) = 10,000·ln 2 = 6,931.47180560…`

| # | Action | Exact result (≥ 12 sig. figs) |
| --- | --- | --- |
| V1 | cost of buying 1,000 LONG | `C(1000,0) − C(0,0) = 10000·ln((e^{0.1}+1)/2) =` **`512.494795136…`** USDC |
| V2 | price after V1 | `p_L = e^{0.1}/(e^{0.1}+1) = 0.524979187479…` |
| V3 | displace p 0.5 → 0.6 | `Δ = 10000·ln 1.5 = 4054.65108108…` LONG; cost `= 10000·ln(0.5/0.4) = 2231.43551314…` USDC |
| V4 | worst-case loss | `10000·ln 2 = 6931.47180560…` USDC |
| V5 | round trip: V1 then sell 1,000 | proceeds = V1 cost (path independence); net **`−3.074969…`** USDC = 2 × 30 bps × 512.494795136 = 2 × 1.53748439 (fees only) |
| V6 | domain edge | a buy pushing `q_L − q_S > 48·b` MUST be rejected (`PriceBoundExceeded`) |

On-chain results MUST match within the §4 error bound plus one base unit of rounding. V1's former value (512.925…) and V5's former net (−3.077552) were computation errors ~14 orders of magnitude above the §4 precision bound at `b = 10⁴`; V2–V4 were and remain exact (B-6).

**CI regeneration rule (normative).** The vector table above is *generated*, not hand-maintained: CI regenerates every §5-equivalent vector from the reference model (`reference-model/`, MPFR at 256-bit) on every commit and MUST fail if the committed table, the runtime implementation, or the exported JSON corpus disagree beyond the stated bound. Consequences:

1. **Differential corpus.** The ≥ 10⁷-point MPFR corpus is exported as JSON from `reference-model/` and published with each release as a backend test artifact (D-2/X-15). **Schema and location (normative; owned here — [02 §11](./02-integration-contract.md)'s table deliberately covers only the four runtime-surface artifacts, since the corpus is consumed by test suites, never by the running frontend):** in-repo the corpus lives at `reference-model/fixtures/vectors.json`; releases publish it content-addressed alongside the 02 §11 artifact set; the top-level `schema` string `bleavit.reference-model.vN` versions it — fields are append-only within a major `N`, breaking layout changes bump `N`, and every vector row MUST carry the inputs needed to replay it standalone (a rejection row without its triggering state is non-conforming). **Single-generator rule:** every fixture that any implementation certifies against — the `futarchy-fixed` crate's committed corpora included — MUST be derived from this one reference-model generator; parallel generators are forbidden.
2. **Frontend port.** The frontend's TypeScript LMSR/TWAP port (`packages/protocol`, BigInt 64.64, maker-adverse rounding, domain clamp) differential-tests against V1–V6 *and* the JSON corpus. Because V1/V5 were wrong in the superseded parent, any FE snapshot pinned to the old values MUST be regenerated; conformance is defined against this document's table only.

---

## 6. Trade path and denomination (B-7, D-3)

### 6.1 Denomination and the auto-split wrapper

LMSR books are denominated in **branch-USDC** of their branch. The user-facing calls accept and return **USDC**; the wrapper performs the branch plumbing atomically inside the extrinsic (all-or-nothing with the ledger moves):

```
buy(market, side, amount, max_cost)   // side ∈ {Long, Short} (gate books: Yes ↦ Long, No ↦ Short)
  1. ensure market phase == Trading and owning proposal ∈ {Trading, Extended}
  2. ensure MinTrade ≤ amount ≤ MaxTrade = b/4          // |Δlogit| ≤ 0.25 per extrinsic
  3. cost = ceil(C(q + Δ_side) − C(q));  fee = ceil(mkt.fee · cost)   // 30 bps
  4. ensure cost + fee ≤ max_cost                        // mandatory slippage bound
  5. ledger.split(vault, cost + fee): (cost+fee) USDC → (cost+fee) AcceptUsdc + (cost+fee) RejectUsdc
  6. target branch:  cost bUSDC → book;  fee bUSDC → fees_accrued
     mirror branch:  cost bUSDC → buyer; fee bUSDC → fees_accrued        // fee held as a complete pair
  7. book delivers amount LONG/SHORT (target branch) from inventory → buyer
  8. book recycles: split_scalar(cost bUSDC) → cost complete LONG+SHORT sets into inventory (§6.3)
  9. update q; record observation from the previous block's stored quote (§7); emit Traded (§11)
```

`sell(market, side, amount, min_proceeds)` is the inverse: the seller delivers `amount` position units; `proceeds = floor(C(q) − C(q − Δ))`, `fee = ceil(mkt.fee · proceeds)` withheld from proceeds in target-branch bUSDC to `fees_accrued`; the book raises the payout by `merge_scalar` of complete sets (the received instruments pair against inventory); the wrapper then automatically merges the net target-branch proceeds with the seller's mirror-branch bUSDC balance, up to `min(net, mirror balance)`, into USDC. Any unmatched remainder stays with the seller as target-branch branch-USDC (redeemable per doc 03). `min_proceeds` bounds the USDC-equivalent net.

Buyer's net position after `buy`: `amount` LONG/SHORT of the target branch **plus `cost` mirror-branch branch-USDC**. Total debit: `cost + fee` USDC.

**Fees.** `mkt.fee = 30 bps` (*normative value: §13*), non-refundable on all paths. On `buy` the fee is collected as a **complete branch-USDC pair** (both legs to `fees_accrued`) — worth exactly `fee` USDC at any settlement, so fee income is unconditional. Under **branch annulment** the buyer's loss is exactly the fee; under **protocol VOID** it is not — total buyer delta also carries the difference between the package's D-1 neutral value and `cost`, so PT-2 MUST NOT collapse VOID delta to `−fees` alone (§6.2; SQ-171). On `sell` the fee is withheld single-sided in target-branch bUSDC; its realized value follows the branch (0 if voided — a protocol-side income haircut, never a trader-side charge beyond 30 bps). Realized fee value routes 50% INSURANCE / 50% POL offset at settlement (economics owned by doc 08).

**Baseline books** are unconditional: the wrapper degenerates — `cost + fee` USDC pays in directly, `split_scalar` against the epoch's Baseline vault mints unconditional LONG+SHORT sets, and there is no mirror credit (§8.2). The sell side degenerates too, and in a way that matters for custody: with no mirror leg to merge against, the **book** (not the seller) funds the payout set, so it merges `net + fee` and re-splits `net`, **retaining the fee as plain USDC** rather than as branch-USDC. A Baseline book is therefore the one per-market account that holds real collateral, which is why [03](./03-conditional-ledger.md) §7 R-4 endows it with `min_balance` at Seed: below that floor the re-split fails on the ledger's `Preservation::Preserve` custody rule and an ordinary small sell is rejected.

### 6.2 Annulment and VOID for buyers (G-3)

- **Branch annulment (normal resolution).** A buyer in the losing branch holds `cost` mirror-branch branch-USDC = winning-branch branch-USDC, redeemable **at par** at resolution. The dominant user path therefore loses only fees when its branch is annulled — G-3 holds by construction of the wrapper, not by trader diligence.
- **Protocol VOID (D-1).** Under `VaultState::Voided`, `merge`/`merge_scalar` stay enabled and every instrument redeems at its neutral-prior value (unpaired branch-USDC `floor(a/2)`, unpaired LONG/SHORT `floor(a/4)`; pairs always 100% — normative rules in [03-conditional-ledger.md](./03-conditional-ledger.md)). A buyer's package is `amount` target scalar units plus `cost` mirror bUSDC. Exact pairs merge at par first; only residual claims are floored. For an isolated buy with no pairable offsets, recovery is `R = floor(amount/4) + floor(cost/2)` and net delta against the `cost + fee` debit is `R − cost − fee`. Ignoring integer dust, the non-fee term is `(amount/2 − cost)/2`, so it vanishes **iff the average execution price `cost/amount` is 0.5** — a property of the *realized* trade, **not** of the pre-trade quote. A finite LMSR buy pays the integral of a rising price curve, so a buy opening at a quote of exactly 0.5 still executes above 0.5 on average and recovers strictly less than `cost` (the normative V1 vector buys 1,000 units from `p = 0.5` for 512.494795136, against a VOID recovery of ≈ 506.25). A below-neutral average execution price yields a positive non-fee term, and the buyer gains overall only if it exceeds fees and rounding dust. What D-1 guarantees is that **no instrument is valued below the neutral-prior schedule** — not that a premium paid over it is refunded.

### 6.3 Revenue recycling, headroom, and solvency by construction (B-7)

**Revenue recycling (normative).** All book revenue (branch-USDC) is **immediately `split_scalar` into complete LONG+SHORT sets held by the book** (step 8 above). A complete set is worth exactly 1 branch-USDC at every settlement `s ∈ [0,1]` (LONG pays `s`, SHORT pays `1 − s`), so recycled revenue never carries price risk.

**Headroom (normative sizing).** At book creation the treasury seeds `headroom = b·ln 2` branch-USDC through the vault, scalar-split into `b·ln 2` complete sets held by the book.

**Pre-collateralization argument (the `ln 2` bound).** Consider the worst one-sided walk: buyers take `Δ = x·b` LONG from a symmetric start. The book's net LONG-inventory outflow is delivery minus recycled revenue:

```
drain(x) = Δ − [C(Δ,0) − C(0,0)] = b·[x − ln((e^x + 1)/2)] = b·[ln 2 − ln(1 + e^{−x})]
sup_x [x − ln((e^x + 1)/2)] = ln 2,  approached strictly from below
```

So with revenue recycling, cumulative one-sided drain is `< b·ln 2` for every finite walk (and the domain clamp §4 bounds `x ≤ 48`): the `b·ln 2` seed can never be exhausted; the book can always deliver from held inventory and never issues an unbacked claim. At settlement every remaining set redeems 1 branch-USDC per pair, so the book's realized loss equals net sets consumed `≤ b·ln 2` — exactly the V4 worst case and exactly the seed. **The book is solvent by construction**; maker-adverse rounding (§4) keeps the residual on escrow's side, and the ≤ 1-base-unit-per-trade dust is swept per the ledger dust rule. Invariant I-12: `maker loss per book ≤ b·ln 2 + rounding_bound`.

### 6.4 Trading rules

`MinTrade = 1 USDC`, `MaxTrade = b/4` per extrinsic (single-trade impact `|Δlogit| ≤ 0.25`); `max_cost`/`min_proceeds` are mandatory; per-trade bounds are readable via the runtime constants API (no FE hardcoding — doc 02). `buy`/`sell` are atomic with all ledger moves; weight is O(1). Trading outside `Trading`/`Extended` MUST fail — there is no other trading window in v1 (D-8).

---

## 7. TWAP accumulator (ADR-11 low, corrected)

Per book: observation `o_t = clamp(p_prev_block, o_{t−1}·(1−κ), o_{t−1}·(1+κ))`, recorded at most once per **10-block observation interval** (`mkt.obs_interval`; *normative value: §13*), from on-trade updates and keeper `crank_observe` calls. **The slew cap κ applies per 10-block observation interval** — the superseded ADR-11 text saying "per 60-block interval" was drift; §5.2.2/§21-equivalent always defined the 10-block grid, and this document is now the single statement (Part 3 frozen constant).

- The observation reads the **previous block's stored quote** — a trade in block `n` can never contribute its own price to the observation recorded in block `n`, removing intra-block manipulation from the decision statistic.
- κ = 0.005 per interval ⇒ recorded-series slew ≤ ~0.5%/min. Over a gap of `Δblocks` since the previous recorded observation the clamp widens to `(1±κ)^k`, where **`k = max(1, ⌊Δblocks / mkt.obs_interval⌋)`** — the *total* number of **whole** observation intervals elapsed; the count floors, so a 60-block gap gives `k = 6` and a 65-block gap also gives 6 — never 5, never 7. Implementations MUST round the widened bounds **inward** on their fixed-point grid (lower bound up, upper bound down) so the admitted band never exceeds the exact real-arithmetic envelope (I-13). Moving a 72 h window mean by δ requires holding displacement for hours against arbitrage: the cap converts manipulation into capital × time.
- Accumulator `A += o_t·Δblocks` in u256 (two-limb), where **`Δblocks` is the number of blocks elapsed since the previous recorded observation** (or since the window start for the first): the newly recorded (clamped) observation `o_t` is weighted **backward over the interval that ends at its record block**; an observation never covers time after itself. `TwapCheckpoints: BoundedVec<(BlockNumber, Cum), 8>` (the [13 §4](13-parameters.md) registry spelling) at decision-window and trailing-window boundaries give O(1) `TWAP(w) = (A(end) − A(start))/blocks`.
- Staleness: any observation gap > 50 blocks inside the decision window increments `stale_events`; first event extends the pair once by 3 days, second forces reject (status-quo default). Missing cranks produce staleness accounting, never wrong data.
- Every recorded observation emits `Observed{market, o_t}` (§11).

### 7a. Contest-capital accumulator (SQ-231 amendment, 2026-07-18)

Alongside each price observation, every book records **contest capital** — the marked USDC value of net outstanding **trader** positions against the maker:

```
noi_t = q_long · p + q_short · (1 − p)                                // previous block's stored
                                                                      // q and quote, same discipline
N    += noi_t · Δblocks                                               // u256 two-limb, same
                                                                      // checkpoint grid as A
ContestCapital(w) = (N(end) − N(start)) / blocks                      // O(1) via the §7 checkpoints
```

When step 9 needs one scalar for a decision pair, the normative reduction is **`PairContestCapital(w) = min(ContestCapital_accept(w), ContestCapital_reject(w))`**: the shallower book is the binding security depth because an attacker can move the cheaper side. The two books are never summed for this term; only the separate flow ceiling retains `b_acc + b_rej`. [08 §5.4(b)](08-treasury-and-economics.md) pins the arithmetic by adding exactly one 400,000 `dec.v_min` term to pair POL depth, yielding `L̂ = 34,657 + 400,000 = 434,657`.

`q_long`/`q_short` are the maker's net sold **trader** quantities (the LMSR cost-function state), marked at the **raw previous-block stored quote** (LONG at `p`, SHORT at `1 − p`; the κ-clamped observation `o_t` is a price-series property and takes no part here). **POL exclusion is structural, not subtractive (SQ-299):** POL enters as complete-set inventory held by the book account (§10) and seeding MUST NOT mutate `q_long`/`q_short`, so the protocol-seeded position is identically zero in this accumulator and no POL storage is read here. The separate decision-grade "POL undisturbed" check keys on the seeded-market marker and the book's `b`, and reads no quantity state. **Differential fixtures MAY represent the same state in gross coordinates** — gross `q` plus an explicit `q_pol` — provided the adapter normalizes to net trader `q` before invoking the production kernel; that fixture convenience MUST NOT be read as implying a production POL storage read. The fixed-point grid for `noi_t` is the USDC base-unit grid ([02](./02-integration-contract.md) §8). Because LMSR trading is path-independent, a round-trip trade restores `q` exactly: **churn and wash flow net out of `noi_t` by construction, and the time-weighting prices held exposure in capital × time** — the same units the slew cap κ already enforces for prices. Inflating `ContestCapital` therefore requires genuinely holding net exposure across recorded observations for a sustained fraction of the window, which is precisely the adverse-selection bleed `C_hold` prices ([05](./05-welfare-and-decision-engine.md) §5.6). The accumulator rides the existing observation grid and per-book state — no per-account telemetry. **Accrual-grid admissibility:** the 10-block grid is the *coarsest* admissible recording; an implementation MAY integrate on a finer per-event grid (each segment priced and sized from the previous block's stored state), which is strictly conservative — it only ever under-counts relative to the backward interval sample. The literal backward sample MUST NOT be used to *credit* a position across a boundary it did not span: a 1-block position straddling an observation boundary earning a full backward interval would re-open exactly the flash-inflation this measure exists to close. The runtime uses the per-event integral; the reference accumulator is grid-agnostic (record blocks are caller-supplied), so differential agreement is unaffected. Rounding: `noi_t` rounds **down** on the fixed-point grid (the measure feeds validity floors and the step-9 certificate; under-counting is the conservative direction). Try-state: `N` is monotone non-decreasing and checkpoint-consistent (I-13 accumulator sanity, market pallet).

**Windows and checks (summary; the decision rule owns evaluation — [05-welfare-and-decision-engine.md](./05-welfare-and-decision-engine.md)):** full decision window = final 72 h (`dec.window`); trailing window = final 24 h (`dec.trailing`); convergence `|spot_close − TWAP| ≤ Δ_max = 0.05`; coverage ≥ 95% of scheduled intervals; POL floor met and undisturbed; non-POL **contest capital (§7a)** ≥ `V_min(class)` **per book**; sanity band `TWAP ∈ [0.02, 0.98]` applies to **welfare (scalar) books only** — gate books are exempt and carry a near-boundary validity rule instead (doc 05). Invariant I-13: recorded drift per interval ≤ κ; a single block cannot move a decision TWAP by more than κ; the contest-capital accumulator obeys the same checkpoint discipline.

---

## 8. Baseline market (B-3, X-10 — market side)

### 8.1 Definition

One **unconditional** scalar book per epoch `e` on the epoch's realized welfare score `s_e = GeoMean(W_{e+1}, W_{e+2})` — the same statistic that settles epoch-e cohorts. LONG pays `s_e`, SHORT pays `1 − s_e` per unit; complete set = 1 USDC at any `s_e`.

### 8.2 Ledger home and collateral

Collateral is plain USDC (no branch, no mirror). The ledger home is normative in [03-conditional-ledger.md](./03-conditional-ledger.md): epoch-keyed `BaselineVaults`, `PositionId::Baseline{epoch, Long|Short}`, escrow/supply identity extended over the baseline set. The trade path is §6.1's degenerate (unbranched) form; revenue recycling and the `b·ln 2` headroom argument of §6.3 apply verbatim (sets pay 1 USDC at any `s_e`).

### 8.3 Subsidy and discoverability

- Subsidy parameter: **`pol.b_baseline`** constitution key (*value: [13-parameters.md](./13-parameters.md)*), funded from the dedicated **`POL_BASELINE`** treasury line, **outside `pol.budget_epoch`** ([08 §4.3](./08-treasury-and-economics.md)) — the Baseline book never competes with proposal subsidies under shrink-to-fit; seeding mechanics are otherwise those of every book (§10).
- **`BaselineMarketOf: map EpochIndex → MarketId`** — declared in `pallet-market` storage, written at Baseline book creation (Seed, epoch e). The mapping **outlives the Baseline book**: it MUST be retained while epoch `e` is present in the `RecentCohortSummaries` ring or is a live epoch, and is pruned in lockstep with ring eviction (≤ 36 entries) — reaping the Baseline market MUST NOT remove it. The superseded "reaped with the market" wording was drift: `ledger.archive_delay` (~1 yr) elapses roughly ten months *before* the 32-cohort ring evicts, so reap-time deletion would leave the frozen contract advertising a mapping the chain had already dropped. Shape, name and retention rule are **frozen in [02-integration-contract.md](./02-integration-contract.md) §7.4**; the decision engine's `baseline_market(epoch)` accessor and the frontend's Baseline reads both resolve through it (X-10 closure). The frontend precondition row for Baseline trading exists in doc 11.
- **Semantics of a retained id whose book has been reaped (normative; SQ-304).** Because the mapping outlives the book, `BaselineMarketOf[e]` MAY resolve to a `MarketId` for which no `MarketState` exists. That id is then **historical correlation data only** — it names which book *was* the epoch's Baseline, and nothing more. Consumers MUST treat the absent book as absent rather than as a book quoting zero: the decision engine's accessor and every runtime view MUST fail closed (no quote, no depth, `within_domain = false`), and the frontend MUST label the book reaped, MUST NOT render a zero quote as a market price, and MUST disable every trade action on it (precondition rows in doc 11). Retaining a bounded `MarketState` tombstone was rejected — it would grow always-served state and re-open reap semantics for no consumer benefit, since cohort history is already served by `RecentCohortSummaries`.

### 8.4 Lifecycle and settlement

Created and seeded during epoch e's Seed window; trades d5–d18 alongside decision books and **remains open through the last epoch-e decision, including per-pair 3-day extensions** (its TWAP is consumed over each deciding pair's own window); then freezes. Settlement at **e+3** Housekeeping via the single SettleAuthority path (`pallet-epoch::settle_cohort` → `pallet-welfare::compute_settlement` → ledger), when `snapshot(e+2)` has finalized and survived its challenge window; reaped after settlement + archive delay.

**Every Baseline book reaches a terminal latch (normative; SQ-320).** The measured e+3 settlement is not the only way the epoch's Baseline vault terminates, and the book's reapability depends on it terminating: §2's reap ordering makes a seeded book's POL obligation live until `settle_baseline` writes the terminal-block latch, so a Baseline vault that never settles leaves its book permanently un-reapable and its POL permanently committed. The two neutral paths of [05-welfare-and-decision-engine.md](./05-welfare-and-decision-engine.md) §7(5)–(6) — the epoch-VOID cohort void, and the permissionless orphan-epoch finalization for an epoch whose cohort never formed — settle the vault at `s = 0.5` and write the same latch through the same `settle_baseline` call, so no market-side rule changes and no third path exists. Ledger-side ownership of the neutral settlement is [03-conditional-ledger.md](./03-conditional-ledger.md) §5.2.

**Which Baseline window a decision reads, including late reruns (normative; SQ-187 resolution, 2026-07-20).** "Each deciding pair's own window" is exact, and the shared book carries **one registered window per distinct boundary triple `(start, trailing_start, end)`, with per-proposal ownership on top**. Consequences, in order:

1. **Sharing is by identity of boundaries, not by epoch.** Proposals of epoch e whose windows coincide — the ordinary case — share a *single* registered window and hold separate ownership records against it. Proposals whose boundaries differ get separate windows on the same book.
2. **A rerun registers its own window.** Both rerun kinds ([05](./05-welfare-and-decision-engine.md) §5.4; [06](./06-governance-and-guardians.md) §5.3) recompute `start` and `trailing_start` from the rerun's fresh `decide_at` and register that triple. A rerun never reuses, mutates or inherits the window it had before, and never reads a sibling proposal's boundaries: every read matches on the exact triple the reader owns.
3. **An already-sealed earlier window is not an obstacle.** It stays as a distinct entry and is *not* rewritten. A proposal's terminal decision consumes **every** window it owns at once — its sealed pre-rerun window and its rerun window together — which is why sealing blocks neither the rerun's registration nor its read.
4. **Eviction is reference-counted.** A window and its checkpoints are dropped only once the *last* Baseline-sharing proposal has consumed them; one proposal deciding never removes a boundary another still needs.
5. **Capacity is bounded and fails closed.** The distinct boundaries a book may carry share the same **8-per-market** ceiling as its checkpoint ring (the `TwapCheckpoints` row of [13](./13-parameters.md) §4; §7 above), since each boundary is what a checkpoint is keyed on. Registration checks the post-insert boundary count **before any mutation** and rejects the excess rather than truncating or overwriting. Deadline shifts (the [05](./05-welfare-and-decision-engine.md) §4.8 dead-man resume) therefore **shift the existing record in place** rather than registering a second one, which is what keeps a shared Baseline from momentarily needing one boundary more than the bound allows.

### 8.5 Role in the decision rule

Every `decide()` consumes the Baseline TWAP as the reject-leg floor (evaluation owned by doc 05):

```
r_eff = max(r_f, base − σ_class)        // adopt must beat max(reject leg, Baseline − σ)
```

This is the capture-resistance adaptation of the reject-leg floor: suppressing the reject book below the economy's own unconditional forecast cannot lower the hurdle below `base − σ`. The Baseline book is also the standing **"priced second opinion"**: an always-on, unconditional market estimate of next-horizon welfare used for entrenchment-path calibration and phase-graduation evidence (doc 06/09 ownership). Degradation rules when the Baseline book fails decision-grade checks are owned by doc 05; the Baseline-floor-suppression threat row lives in doc 14.

---

## 9. Gate markets

For **every market-bearing class — PARAM, TREASURY, CODE, and META**: **four binary books per proposal** — question: "Conditional on ADOPT (resp. REJECT), will the `g` daily floor-breach flag be set on ≥ 1 day during epochs e+1…e+2?", for `g ∈ {S, C}`.

- **Instruments.** YES/NO complete sets against branch-USDC in the corresponding branch: `PositionKind::GateYes(g)` / `GateNo(g)` per branch, with per-branch gate-set supplies in `VaultInfo` and the conservation identity extended over the enlarged set — the B-2 ledger fix makes the four-book set representable; normative instrument semantics in [03-conditional-ledger.md](./03-conditional-ledger.md).
- **Mechanism.** Identical LMSR (§3–§4) with YES ↦ LONG, NO ↦ SHORT; subsidy `b = pol.b_gate` (*value: §13*); same wrapper, recycling, and `b·ln 2` headroom (§6); a complete YES+NO set is worth 1 branch-USDC at either flag outcome.
- **Settlement.** On **deterministic daily breach flags computed from `C_onchain`/`S` sub-components only** (D-18 gate split: `C_attested` never drives daily flags or gate settlement). Flag computation is owned by docs 05/07; the market consumes the recorded flags via `settle_gate(pid, gate, outcome)` (doc 03) on the realized branch. Unrealized-branch gate instruments void (pay 0); that branch's branch-USDC refunds principal per the ledger rules. There is no oracle discretion anywhere in gate settlement.
- **PARAM interpretation.** PARAM books settle on these same system-wide `S_daily`/`C_daily` breach facts. They are a correlated-harm proxy, not an attribution that the parameter delta caused the breach; whether that correlation deters profitable PARAM capture is a simulation hypothesis to be re-calibrated, not a property claimed by this specification.
- **Consumption.** The veto tests (`p̂ᵍ_adopt > p_max(g)`; `p̂ᵍ_adopt > p̂ᵍ_reject + ε(g)`) read gate-book TWAPs before any welfare comparison — kernel-ordered, owned by doc 05. Healthy gate books trade near the boundary by design and are therefore **exempt from the [0.02, 0.98] sanity band**; their near-boundary validity rule is in doc 05.

---

## 10. POL seeding hooks

POL enters as **dual-minted complete sets on both branches at book creation**: the treasury splits USDC through the proposal's vault (one split funds both branches' books — the mirror branch's seed is the free image of the live one, decision-neutral by construction), then `split_scalar`s each branch leg into the branch's book inventories, `b·ln 2` per book (§6.3). The seeding flow MUST satisfy the **per-branch** escrow/supply identity walk of [03-conditional-ledger.md](./03-conditional-ledger.md) (the B-4 fix: per-branch supply fields; no single `branch_pairs` counter exists to underflow). Baseline seeding is the unbranched form against `BaselineVaults`.

- POL MUST remain undisturbed through the decision window (a decision-grade condition, doc 05) and withdraws at settlement; realized cost = divergence loss in the live branch = the explicit information subsidy.
- **POL and book accounts are protocol accounts: exempt from `MaxPositionsPerAccount = 64` and from the per-entry Positions deposit** (doc 03) — seeding 196 books cannot collide with user-facing position caps.
- Per-class budget arithmetic, the 0.75%-NAV epoch cap, minimum-viable NAV, and Ask-scaled `b` (D-4) are owned by doc 08; fee routing (50% INSURANCE / 50% POL offset) likewise.

---

## 11. Events (normative here; shapes frozen in [02-integration-contract.md](./02-integration-contract.md))

`pallet-market` MUST emit:

| Event | Fields | Semantics |
| --- | --- | --- |
| `Traded` | `{ market: MarketId, who: AccountId, side: TradeSide, amount: Balance, cost: Balance, p_after: FixedU64 }` | One per executed `buy`/`sell`. `side` is the frozen 4-variant **`TradeSide { BuyLong, BuyShort, SellLong, SellShort }`** ([02 §2/§5](./02-integration-contract.md)) — derived from the call (`buy`/`sell`) and its `Long`/`Short` parameter (gate books: Yes ↦ Long, No ↦ Short). `amount` and `cost` are **unsigned magnitudes**: `amount` in position units, `cost` the USDC flow (trader → book on buys, book → trader on sells), fee-exclusive — direction is carried entirely by `side`, which is clearer for indexers than signed values. `p_after` = post-trade `p_L` (1e9 fixed); `p_S = 1 − p_L` is derived |
| `Observed` | `{ market: MarketId, o_t: FixedU64 }` | One per recorded (capped) observation, on-trade or crank |

These two events are the frontend's entire price-history pillar (event-derived, chain-served — D-2/D-6); they are load-bearing and MUST NOT be gated behind an indexer. Emission is unconditional on success paths; `close`/`reap` and settlement events are enumerated in doc 02.

---

## 12. Worked numerical example

TREASURY proposal, decision pair, `b = 25,000` USDC/branch. Books open at 0.5/0.5; headroom seeded per book `= 25,000·ln 2 = 17,328.68` USDC of complete sets. Over the **d5–d18** Trading phase, informed flow moves ACCEPT-LONG to 0.560 and REJECT-LONG to 0.520.

- Decision-window TWAPs: `P̄_acc = 0.5620`, `P̄_rej = 0.5210`, Baseline TWAP `= 0.5230`.
- Reject-leg floor: `r_eff = max(0.5210, 0.5230 − σ=0.005) = 0.5210`. Uplift `= 0.0410 ≥ δ_TREASURY = 0.0375` (V-12) ✔.
- Trailing 24 h TWAPs 0.5620 / 0.5222 ⇒ uplift 0.0398 ≥ 0.0375 ✔; convergence `|0.560 − 0.5620| = 0.0020 ≤ 0.05` ✔.
- Gate books: breach TWAPs S: 0.011 acc / 0.009 rej; C: 0.017 / 0.015 — under `p_max = 0.05`, within `ε = 0.02` ✔. **Adopt.**
- **Maker loss realized (ACCEPT book walked 0.5 → 0.56):** with revenue recycled, expected divergence subsidy at final price `p` is `b·[ln 2 − H(p)]`, `H(p) = −p·ln p − (1−p)·ln(1−p)`:

```
loss = 25,000 · (0.693147 − 0.685930) ≈ 180.4 USDC  (≈ 180 USDC)
check: Δ = b·logit(0.56) = 6,029.05 LONG; revenue = 3,195.83; E[payout at s=0.56] = 3,376.27; diff = 180.4 ✔
bound: ≤ b·ln 2 = 17,328.68 USDC
```

The superseded worked example's "≈ 1,507 USDC" was a computation error (maker-loss low); the subsidy actually paid to informed traders for a 6-point move is two orders of magnitude below the worst-case bound.

---

## 13. Deferred work

**Forecast trading is CUT from v1 (X-5, D-8).** Books close at branch resolution and never reopen; there is no post-decision "running forecast" trading of the live branch through measurement. This simultaneously removes: (a) the frontend surface gap (no screen or precondition row existed; FE pre-sign preconditions only construct `market.buy/sell` in `Trading`/`Extended` — the windows now agree across the boundary); and (b) the **inventory problem that made reopened books unable to function at all**: `split_scalar` requires the vault to be `Open`, and post-resolution vaults are not — a reopened book could neither recycle revenue into complete sets nor replenish delivery inventory, so the §6.3 solvency construction breaks the moment the vault leaves `Open` (the forecast-mint medium, moot by this cut). A v2 design MUST solve resolved-state minting first — e.g., a winning-branch-scoped mint rule (winning branch-USDC is par, so complete sets remain fully backed) or an inventory-only frozen-float book — and MUST ship the FE surface in the same release train. Recorded here as the single deferred-work statement; do not partially re-enable.

**Order-book / batch-auction layer.** A 60 s frequent-batch-auction layer remains excluded from v1 (weight at hostile-controllable order counts, resting-order state growth, implementation risk in the solvency-adjacent path; the previous-block observation rule already removes decision-relevant intra-block manipulation, leaving ordinary fill MEV bounded by `MaxTrade` impact ≤ 0.25 logit). Phase-6+ optimization behind a META proposal.

---

## Resolves

| Finding | Resolution in this document |
| --- | --- |
| **B-6** | §5: V1 corrected to **512.494795136…**, V5 net to **−3.074969** (V2–V4 unchanged); vectors CI-regenerated from the reference model; differential corpus and FE TypeScript port re-anchored to the corrected table |
| **B-7** | §6 (D-3): books denominated in branch-USDC; `buy`/`sell` USDC wrapper with auto-split and mirror credit; revenue recycling into complete sets; `headroom = b·ln 2` stated and sized via `sup_x[x − ln((e^x+1)/2)] = ln 2`; book solvent by construction |
| **B-3** (market side) | §8: Baseline market fully specified — unconditional book on `s_e`, `pol.b_baseline` subsidy, lifecycle, settlement at e+3 via the single SettleAuthority path, reject-leg-floor and priced-second-opinion roles (ledger home in doc 03; value in doc 13) |
| **X-10** | §8.3: `BaselineMarketOf: map EpochIndex → MarketId` declared, written at Seed, frozen in doc 02 — the Baseline id is discoverable by engine and frontend alike |
| **X-5** | §2, §6.4, §13 (D-8): forecast trading cut; books close at branch resolution and never reopen; trading windows now agree with the FE precondition rows (`Trading`/`Extended` only) |
| Forecast-mint medium | §13: moot by the D-8 cut; the `split_scalar`-requires-`Open` deadlock is recorded as the blocking constraint for any v2 revival |
| Maker-loss low | §12: worked example corrected to ≈ **180 USDC** (`b·[ln 2 − H(0.56)]` at b = 25,000), not ~1,507; §2: Trade phase labeled **d5–d18** matching offsets 72,000–259,200 |
| ADR-11 low | §7: slew cap κ normatively applies per **10-block observation interval** (60-block drift removed); observation reads the previous block's stored quote; full-window/trailing/convergence checks summarized with ownership in doc 05 |
