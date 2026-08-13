# PLAN.md — Implementation Roadmap and Status

**`PLAN.md` and the `plan/` tree are the single source of implementation
status.** The files reference `docs/architecture/` and never restate normative
behaviour (AGENTS.md R-4).

Work the active milestone, otherwise the first pending milestone whose
dependencies are done. A milestone is done only after its verification gates
and blocker-free spec-compliance review. Record each session in
`plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md`.

Legend: ⬜ pending · 🔨 active · ✅ done · ⛔ blocked

## Current focus

> **ACTIVE: 2026-08-13 — remediate the whole-repository security review in
> draft PR #304.** The immutable review checkpoint is published at commit
> `3b70e09e`; all 15 findings have implementation fixes in the local commit series.
> A final independent pass also closed two late source blockers: the signing gate
> now has no caller-controlled evidence port and stays fail-closed until its closed
> evaluator exists, while the monitor consumes the real app release schema and
> distinguishes asset manifest M from final manifest M′. The first genuine
> artifact pass then caught a downstream host rebuild substituting different
> Wasm into canonical and drill specs; both generators now carry the exact OCI
> primary end to end. Its closure review also made the N10 client-para spec an
> explicit release prerequisite while keeping that separate runtime out of the
> primary-Wasm binding. The source closure is committed at `a4983e85`; the
> digest-pinned primary/recovery pair, v31 chain feed, chainHead fixtures,
> descriptors and downstream generated consumers have been regenerated from that
> exact commit, with zero assembly corruption and their focused gates green.
> The generated-artifact/status closure is committed at `40475015`. Current
> `main`'s single app plan-consumer repair has been integrated and its overlap
> gates pass. Draft-PR CI then exposed four closure defects: container checkout
> ownership prevented deterministic app epoch derivation, one benchmark-only
> Rust import was unconditional, the public-XCM router change left generated
> `pallet_xcm` weights stale, and a newly published unpatched `extract-zip`
> advisory needed an evidence-backed tooling-only waiver. All four fixes and the
> committed-fidelity weight regeneration are in the final verification/artifact
> refresh loop before one replacement push.

> **PARKED: 2026-08-09 — Track F's code is complete; four milestones wait on
> external inputs.** F1 needs the user's SQ-940 ruling plus a device lab/live
> chain/hardware/ar.io credentials. F11 needs the production rollout inputs and
> FE-P7 evidence. F13 needs the key ceremony, real signer identities/keys and a
> live gateway. F14 needs the physical device lab and Playwright probe. The
> merged implementation is `acf9c1ae`; Track F is 26/30 done.

> The complete historical focus stack is archived in
> `plan/log/2026/08/2026-08-09.md` and
> `plan/log/unsorted-current-focus.md`. The latter is intentionally unsorted:
> its first bold lead contains no date, and the migration never inferred one
> from position.

## Track E — crossover arithmetic and the self-funding statement

A top-level section, **not** a subsection of *Milestones* (moved 2026-07-29): the
monitoring coverage checker parses every table under `## Milestones` as a milestone
table, so a `Quantity | Value | Source` table nested there fails
`tools/monitoring/check_alert_coverage.py` and the CI jobs that run its suite. The
work order requires PLAN.md to carry this table, so it is kept and relocated rather
than deleted. Normative home remains 08 §10 (R-4).

**Crossover arithmetic (headline; normative in 08 §10).** `C` = annual cost base, `H` = held capital at settlement, `τ` = turnover / held capital, `R = H·(mkt.fee·0.75·τ + ledger.redeem_fee·0.50)`.

| Quantity | Value | Source |
|---|---|---|
| `C`, derivable lines only (collators 173,929 + keeper meter 208,714 + `ops.keepers` **beyond-meter** 699,694 + PARAM-floor rewards 43,482 + realized POL 18,830 + probe 913) | **1,145,562 USDC/yr** | 08 §10.1 |
| `C`, eight unsizeable `ops.*` lines | **not sized — no unit cost, hardware profile or headcount figure exists anywhere in the repo**; counts only | 13:89; 12 §6.1 |
| `τ`, measured | 5.8 median all-book, **≈ 3.0 excluding the 47.9 % round-trip churn** the 04 §7a measure nets out | 15 §4.9 sim |
| `V*` at `C` = 1.146M, τ = 3 | `H` = **138,855,943**/yr (turnover 416,567,828) | 08 §10.4 |
| `V_max` | **no structural ceiling exists** — the LMSR domain bound caps net displacement, not gross position; balanced two-sided flow grows `noi_t` without limit. Reachability is economic, not structural | 08 §10.3 |
| Capacity reference: 5 × TREASURY at `sec.flow_cap` saturation | `H` = 118,271,429/yr ⇒ `V*` is **1.17×** it; 5 × CODE ⇒ **0.64×** | 08 §10.3–§10.4 |
| Endowment runway, POL leak closed, `C` = 1.146M | **3.3 yr** to the shared CODE/META arming floor (21.26M), 9.7 yr to 13.86M, 17.8 yr to 4.62M | 08 §10.5 |
| Endowment runway, POL leak **open** (`C` = 2.95M) | 1.3 yr / 3.8 yr / 6.9 yr | 08 §10.5 |

**Honest statement on self-funding at launch (R-10).** **Bleavit is not self-funding at launch and cannot be, and no document in this repository may claim otherwise.** Launch volume is zero by construction: Phase-4 arms PARAM only, and a proposal earns nothing until traders arrive. A PARAM-only slate at the bare `dec.v_min` floor earns **151k–367k USDC/yr** against a cost base of **at least 1,145,562** — a **3.1–7.6× shortfall** that no rate inside the 13 §1 registry closes. What the arithmetic does support is narrower and still worth stating: at the depth the chain's own security calibration assumes (`sec.flow_cap` saturation) with a treasury/code-weighted slate and the measured τ ≈ 3, revenue reaches **0.98M–1.78M/yr at today's 30 bps** — i.e. the crossover sits **at** the design point, not far beyond it, and is reached by depth rather than by raising rates. **`mkt.fee`'s 100 bps registry max is not the binding constraint and no META `amend_registry` raise is needed**; the binding constraint is that a round trip costs `mkt.fee` in `s`-units, which at 30 bps is exactly `dec.sigma`(PARAM) = 0.003 and at 100 bps is 3.3× it — raising the rate buys revenue by degrading the price series the decision rule reads. The endowment is the bridge, and closing the E1 leak roughly **halves** the burn that bridge has to cover.

<!-- BEGIN GENERATED PLAN INDEX -->

## Plan index

| What | Index file | Directory |
|---|---|---|
| Milestones | [plan/MILESTONES.md](plan/MILESTONES.md) | [plan/milestones/](plan/milestones/) |
| Spec questions | [plan/QUESTIONS.md](plan/QUESTIONS.md) | [plan/questions/](plan/questions/) |
| Question batches | none | [plan/batches/](plan/batches/) |
| Verification records | [plan/VERIFICATIONS.md](plan/VERIFICATIONS.md) | [plan/verifications/](plan/verifications/) |
| Decisions | [plan/DECISIONS.md](plan/DECISIONS.md) | [plan/decisions/](plan/decisions/) |
| Session log | none | [plan/log/](plan/log/) |
| Audits | none | [plan/audits/](plan/audits/) |
| Unplanned changes | none | [plan/changes/](plan/changes/) |
| Pre-split section notes | [plan/SECTION-NOTES.md](plan/SECTION-NOTES.md) | [plan/](plan/) |

<!-- END GENERATED PLAN INDEX -->
