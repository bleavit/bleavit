---
paths: ["reference-model/**", "simulation/**", "tools/simulation/**", "tools/reference-model/**"]
---

# Reference model rules (independent executable spec)

The Python reference model exists to catch bugs in the Rust implementation by
**independent derivation** (15 §4.4). Its value dies if it mirrors the implementation.

1. **Independence is the point.** Never port, transcribe, or "align" Rust runtime code
   into the model — implement from `docs/architecture/` text alone. When model and
   pallet disagree, that is a finding to investigate against the spec, not a diff to
   silently make green on either side.
2. **Vectors are generated, never hand-maintained.** The normative LMSR vectors V1–V6
   and the MPFR differential corpus are regenerated in CI from this model on every
   change (04 §5); a hand-edited expected value is a defect (the shipped hand-computed
   V1 error is the standing justification).
3. **Determinism.** Fixed seeds, no wall-clock, no environment-dependent behavior;
   byte-identical JSON output for identical inputs (stable key order, explicit precision).
   The transcendental reference math runs at **≥ 256-bit precision** (the model uses
   100-digit `Decimal` ≈ 332-bit; MPFR-256 is an equivalent — the precision is normative,
   the library is not; 15 §4.4).
4. **Corpus schema is owned by `04 §5`.** The JSON vector schema (`reference-model/
   fixtures/vectors.json`, `bleavit.reference-model.vN`) is normatively owned by
   `04-markets-and-pricing.md` §5, not by `02 §11` (02's artifact table deliberately
   covers only the four runtime-surface artifacts — the corpus is consumed by test
   suites, never by the running frontend). Fields are **append-only within a major
   `N`** and need no contract bump; a breaking layout change bumps `N`. Every row must
   carry the inputs needed to replay it standalone. The backend differential suites and
   the frontend TypeScript port both certify against this one artifact.
5. **Scope.** The model covers LMSR cost/pricing, TWAP, the ledger operation semantics
   (incl. gate/Baseline/VOID and rounding), the welfare pipeline, and the decision rule
   with reason codes (05 §4.4 bit-identical requirement), plus the treasury arithmetic
   of 08 (its worked examples are normative for Phase 0).

## What lives here (moved from AGENTS.md · Repository layout, 2026-08-06)

Kept out of the always-loaded `AGENTS.md` because it only matters in these trees;
this file loads whenever a session touches them. Status claims here are point-in-time —
**PLAN.md is the single source of implementation status (R-4)**.

### `reference-model/`

**Status:** M3 done (grown by A4–A9, S1, S4, E5, S6, S7–S11, N12)

Independent Python executable spec + the single vector generator (`tools/reference-model/generate-vectors.py`) and corpus (`fixtures/vectors.json`, schema v4): LMSR/TWAP/decision/welfare/treasury scenarios + the S1 ledger differential families (64 op-sequence scenarios, score-endpoint, sweep, 11-error-class witnesses) replayed exactly by `conditional-ledger-core` and the pallet sweep differential; S4 scoped the `in_cap_prize` NAV floor to upgrade payloads (`upgrade_payload=True` default, vectors byte-stable); **E5 added `sustainability.py`** — the executable form of 08 §10's cost/revenue/runway arithmetic, discharging that document's own standing requirement that all its worked arithmetic be reproduced by this model. Its suite pins every published figure in §10.1–§10.6, so a spec table and the model cannot drift silently; it found two spec defects on its first run. **S6 generalized that precedent to three areas with no executable form at all** (2026-07-31): `lifecycle.py` (05 §2–§3 — the T1–T26 table as data, with termination/terminality/I-15 computed rather than asserted, the §2.2 mermaid diagram parsed out of the doc to check its own edge-set claim, and §3.3's three wedge constants simulated), `disputes.py` (07 §5–§6/§11 — the bond ladder, the §6.3 coverage rule and its directional amendment screen, the latency budget), `occupancy.py` (13 §5 — the four re-derivations, the by-value screen, the in-flight composition, plus an adversarial search over lawful amendment sequences). **Not everything here is differential-tested against Rust, and that is by design**: like `sustainability.py`, these modules are the executable form of spec *arithmetic and claims*, so their counterpart is the document, not a pallet. Prefer adding to them whenever a spec section states a figure, a ladder, a bound or a "this wedges if wrong" claim that nothing re-derives **S7–S11 completed the sweep (2026-08-01)**, taking the same method to every remaining area with no executable form and adding eleven modules: `registry.py` (13 §1/§2 as data — the coupling table with each row's binding site, shortest-breaking-sequence BFS over the joint amendment graph, self-sealing corner search, and the 13 §2 consumed-or-projected hygiene scan), `slate.py` (08 §3/§4/§5/§7 POL commitments, shrink-to-fit, blanking attacks), `rollout.py` (09 §3.1/§5.2/§7 phase gates and expedited-repair latency), `pillars.py` (05 §4.3/§4.5/§5.1 pillar reachability), `threat_costs.py` (doc 14's attack-cost column), `oracle.py` (07 §4/§8 reserve probe and watchtowers), `frontend_budget.py` (10 §9, reconciled against the chain's real emission rates via `occupancy`), `guardians.py` (06 §5/§6.3), `void_pricing.py` (D-1 contamination), `values_layer.py` (06 §2.1 track table differentialled against the runtime, plus 08 §2.1 genesis signability), `release_channel.py` (12 §2.3/§3 with a co-simulation against the shipped monitor in `tools/monitoring/tests/`). They raised eighteen spec questions (SQ-543…SQ-560, PLAN.md batch B7). **Two conventions these modules established and that new ones should follow:** a falsified claim is pinned by asserting the *derived* value with the SQ id in the docstring and the defect exposed through a `check_*` findings accessor — never by asserting the spec's wrong number, and never red-by-design; and any helper that scans the repository must exclude nested worktrees (`.claude/worktrees/`) and `target/`, since a second checkout of the source silently turns an orphan symbol into a consumed one and CI's clean checkout cannot see the difference. **N12 added `service_economics.py`** (2026-08-03) — 16 §5.2/§8.1/§8.2 certification sizing and the two-part tariff, plus 13 §1's fee-floor derivation; it extends `sustainability.py`'s coverage of 08 §10 to instrument D, the one revenue instrument that paragraph left as prose. **Do not set `getcontext().prec` at module import in this package**: it mutates the process-wide Decimal context and changes every other module's arithmetic including the normative LMSR kernel — use `localcontext()` as `lmsr.py` does. `test_imports_do_not_mutate_global_decimal_context` enforces it and caught `service_economics.py` doing exactly this on its first run.

### `simulation/`, `tools/simulation/`

**Status:** S4 (sim done; publication parked) + S10 (inference) + N12 (competing venue)

The 15 §4.9 agent-based Phase-0 economic simulation over the reference model as normative-math source: executed fee-inclusive LMSR trade ledger (informed/noise/arbitrage-A-2/five doc-14 manipulator strategies at 3·InCapPrize-multiple budgets), real Survival/Security gate books, κ-slew segment TWAP (equivalence-tested), pre-registered strata, binary-searched flip brackets, and the deterministic Merkle-bound evidence artifact `simulation/results/phase0-calibration.json` (10,000 proposals). Phase-0 result (committed artifact, schema v4, `designation: published`, `violations: []`): the per-class **decidable-harm** false-pass rates are PARAM 0.000 % / TREASURY 0.145 % / CODE 0.135 % / META 0.563 % — all four strictly below the 15 §4.9 < 1 % gate, which is *per class and decidable-harm*, not the raw wrong-PASS rate (raw would read CODE 1.99 % / META 2.22 % and fail; batch B6 pinned that reading in 15 §4.9 + 09 §7.1, SQ-269). The earlier "PARAM 3.46 % / TREASURY 1.52 % fail" line described the superseded N=3000 pre-calibration artifact and was stale. `sec.prize.*`/`sec.flow_cap` are **published** in the artifact but not yet **adopted** into 13 — those rows still carry `[VERIFY]`, and publication is what the Phase-0 criterion requires (SQ-268). **N12 added the 16 §8.4 competing-venue leg** (2026-08-03): a `competing_venue_diversion` that thins *organic* formation on decision/gate/Baseline books while leaving attacker budgets alone, and a `competing_venue` artifact block measured on a stratified sample against its own 0 % control. Three rules govern it. The run default is **`0.00` and must stay a strict no-op** — Phase 0 has no hosted service, and the published result must not move; the ladder's upper rung is **derived** from 16 §8.4's arming condition (`Σ b_ext ≤ Σ pol.b(live)` ⇒ proportional diversion ≤ ½) and the config refuses a rung above it; and the block's verdict **never enters `violations`**, because a Phase-4 condition cannot retro-invalidate a Phase-0 exit. Read both its legs: diversion *denies* decisions (`NotDecisionGrade`) before it corrupts them, so a false-pass-only reading gets cleaner the more governance is destroyed

