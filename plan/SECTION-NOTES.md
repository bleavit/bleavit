# Pre-split section notes

## Milestones

### Track M — Foundations


### Track A — Protocol pallets

**Re-scoped 2026-07-14 (user-directed; see Decision log): Track A delivers production
Polkadot-SDK FRAME pallets, not frame-free models. A1–A11 are reopened ⬜.** Their logic
already exists as **frame-free functional-core models** (state struct + `fn op(&mut self)
-> Result` + typed Event/Error + `try_state`); that code is **kept as the functional
core**, relocated to `crates/<name>-core/` (`no_std`, no `frame` deps — rule 9 / 01 §5.2),
and preserved as the differential oracle (Python M3 ≡ Rust core ≡ FRAME runtime) and the
WASM-portable / auditor-consumable port. A milestone is ✅ only once its pallet ships in
full FRAME production style — the **necessary parts** per pallet:

- **`crates/<name>-core/`** — the relocated frame-free model (functional core; today's
  `pallets/<name>` logic, unchanged in behavior).
- **`pallets/<name>/src/lib.rs`** — a `#[frame_support::pallet]` shell: a `Config` trait
  (`RuntimeEvent`, `WeightInfo`, constants via `Get<…>`, `Params`/currency/asset + origin
  bounds); `#[pallet::storage]` items as `BoundedVec`/`BoundedBTreeMap` (`MaxEncodedLen`,
  bounds from 13 §4, names + SCALE shapes matching 02 byte-for-byte — rule 5);
  `#[pallet::event]` / `#[pallet::error]` mapped 1:1 from the core; `#[pallet::call]`
  extrinsics that enforce an explicit origin (`EnsureOrigin` over `pallet-origins`, one
  SafetyFilter authority-matrix row per call — 06 §3) then load storage → call the core →
  persist → deposit events, each carrying `#[pallet::weight(T::WeightInfo::…)]`;
  `#[pallet::hooks]` with the mandatory `try_state` (15 §1) and only the cursor-bounded
  cranks the spec allows (none where it says none — the ledger has no hooks, 03 §10);
  `#[pallet::genesis_config]` / `genesis_build` where the pallet has genesis state.
- **`pallets/<name>/src/mock.rs`** — a mock runtime (`construct_runtime!`: `System` + the
  pallet + its dependencies, with test `Config` impls).
- **`pallets/<name>/src/tests.rs`** — per-extrinsic × error-path × origin-misuse tests
  through the closed wrapper set, limit/boundary coverage, and a `try_state` assertion
  (15 §4.1, §1). Audit-scope-A pallets (A1, A2, A11 — R-7) add the adversarial /
  rounding-against-the-claimant / solvency suites.
- **`pallets/<name>/src/benchmarking.rs`** + **`weights.rs`** — `#[benchmarks]` for every
  extrinsic and hook, a `WeightInfo` trait, a generated `weights.rs`, and the
  `runtime-benchmarks` feature. PoV-calibrated weights land with B5; the harness + stubs
  are part of the milestone.
- **`Cargo.toml`** — `frame-support` / `frame-system` / `frame-benchmarking` on the
  `polkadot-stable2603` pins (01 §9), the `std` / `runtime-benchmarks` / `try-runtime`
  features, and the `<name>-core` dependency.

Scaffold via `/new-pallet` (already emits this shape); `test-engineer` authors the 15 §4
suites; a `spec-reviewer` pass with no blockers precedes ✅ (R-6). Per-pallet FRAME wrapping
lives here; runtime-level `construct_runtime!` / `impl_runtime_apis!` assembly is B1a/B2.


### Track B — Runtime, node and chain

Doc-09 WBS delta rows map here and to Track A: E15→B2/B8 · E16→A2 · E17→A3 · E18→A6 ·
E19→A5 · E20→A10/B6 · E21→B4 · E22→A11/B1. (E1–E14 definitions live in git history —
superseded `BACKEND_PLAN.md` §26; their scope is covered by Tracks M/A/B.)


### Track E — Protocol revenue and treasury sustainability

Opened 2026-07-29 on the "self-funding permanent institution" work order. Spec layer (03, 04, 08, 13, 14, 15, 02 → contract **v17**) landed in one pass as **PR #195** (`feat/e1-treasury-sustainability`), together with the reference-model implementation of 03 §5.3a; the code layer shipped as E1 → E4 in value order across #195, #197 and #196, all merged 2026-07-29. Normative arithmetic: **08 §10 (Sustainability)** — PLAN carries only the status and the headline figures (R-4).

**E5 opens the cost side (added 2026-07-30).** E1–E4 are the revenue half of 08 §10's crossover; they cannot close it alone, and the arithmetic says the other half is cheaper to move. The derivable cost base is **94.5 % two lines** — keepers 908,408/yr and collators 173,929/yr — and the largest single line, `ops.keepers` at 699,694/yr (61.1 %), funds coverage that 08 §6.3 itself classes as chart density rather than decision quality. E5 derives a reduced operating point for those, re-derives 08 §10's tables from it, and phase-gates the `ops.*` lines Phase 4 does not need. It is a **values-layer** milestone: no protocol code, every figure derived under R-1/R-2, and the frozen 08 §4.1 class floors untouched.

*Two verification obligations in the work order name artifacts that do not exist in this repository and are therefore not dischargeable here: there is no `explainer/` directory (so no third certified `src/protocol/` port to re-certify, and no `npm run verify`), and `frontend/` is still the `.gitkeep` placeholder of Track F (so the 04 §5 TypeScript LMSR port has no code to update). The 04 §5 obligations bind whenever those land; recorded so a later session does not read their absence as a skipped step.*

**The contract is spec-ahead-of-code, deliberately, and must not ship that way.** `02` and `00` now declare **v17**, while `futarchy_primitives::INTEGRATION_CONTRACT_VERSION` is still **16** (`crates/futarchy-primitives/src/lib.rs:12`, pinned by the assertion at `:1694`). That is the normal spec-first state under R-2 — the v17 surface is the *appended* events, calls and metadata constant that E1–E4 implement — but it is a real divergence while it lasts: **no release may go out with the runtime declaring 16 against a v17 spec.** The bump and its assertion land with the last of E1–E4, in the same change as the event field appends, not before. **Four things move in that one change and none of them is optional** (established while fixing the PR #195 review): `crates/futarchy-primitives/src/lib.rs:12`; the assertion pinning it at `runtime/bleavit-runtime/src/tests.rs:2050`; the **64 legacy `ledger_sequence_scenarios` corpus rows**, which still emit the v16 event shape and flip to v17 by one `contract_version` default plus a regeneration; and the `Event::ScalarRedeemed`/`ScalarPairRedeemed`/`GateRedeemed`/`BaselineRedeemed` variants in `crates/conditional-ledger-core/tests/differential_vectors.rs`, which need the trailing `fee`. The corpus is now **explicitly versioned** rather than implicitly v16: the 11 `ledger_fee_scenarios` rows carry `params.contract_version: 17` because they exist to pin the target surface, the legacy rows stay v16 because that is what is in force, and a v16 model that charged a fee raises rather than silently dropping it. That is why the split is safe to hold — but it is exactly the kind of two-sided obligation that gets half-done, so it is written out here rather than left to the diff.

**Milestone-id convention (read this before citing a marker).** The spec layer landed as **one** amendment batch and its `(added/amended 2026-07-29, milestone E1)` markers date the batch, not the implementing milestone: **E1 owns the whole Track E spec layer** as well as its own code. E2, E3 and E4 implement parts of spec that E1 landed, so a marker reading `milestone E1` on redemption-fee text is correct and is *not* a claim that E1 implements it.



### Track N — External clients: futarchy as a service over XCM

Opened 2026-08-01 on the "make the futarchy infrastructure accessible to other parachains,
smart contracts and services via XCM" work order. Bleavit hosts conditional decision markets
for external clients and **sells price discovery, not decisions**: it publishes the conditional
TWAPs with provenance plus a manipulation-cost bound, and the client's own on-chain rule decides
and executes locally. Bleavit never runs foreign code, and no external state reaches any Bleavit
decision, welfare or settlement input. v1 scope by user decision — the spec batch, contract bump
and threat rows land together. Full approved design: `.claude/plans/` (session plan, 2026-08-01).


### Track S — Systemic verification and simulation


### Track F — The canonical cross-platform client (`app/`)

Epic IDs from 11 §11.13. FE-P1…P11 prototype gates from 10 §12 (+FE-P10/FE-P11, 11 §11.13).
Rooted at **`app/`** (10 §10.1, amended 2026-08-03); the `frontend/` placeholder is retired.

**Phase grouping** (2026-08-03). **Phase 0** = F19, the spec batch and its two proofs. **Phase 1**
= F0, F2–F6, F20, F21, F7, F10, F11, F22 — web + PWA canonical plus a **direct-download** desktop
Tauri build; no app store, no iOS, no Android, no Product target, therefore **no INV-FE-8/-10
amendment needed**, since store re-signing is the only thing that makes those texts false.
**Phase 2** = F7b, F8, F9, F12, F14, F16–F18 + mobile shells. **Phase 3** = the store question
(scope INV-FE-8/-10 to the canonical channel, add INV-FE-16 channel honesty) + the Product target,
which ships fail-closed read-only until PROD-1/PROD-2 pass.

**Handoff-first navigation** (user ruling, 2026-08-03 — 11 §11.2). The client's two *primary*
surfaces are **prepare a capsule** (S21) and **review/confirm/sign** (§11.3–§11.4 + S22); the
analytical depth and the whole FE-14/FE-15 set sit behind **Advanced**. This reorders Phase 1 —
the handoff packages and the Skill set (F20/F21) now precede the screens (F7) instead of trailing
them — and it is a **presentation change only**: every screen in the 11 §11.2 inventory still
ships, still works with no external tool present, and the no-infrastructure certification run
still executes with the handoff surfaces disabled. Demoting a surface is permitted; removing one
would falsify INV-FE-4 and the 15 §2.1 reading that admits the handoff at all. **Two consequences
are not free and are tracked, not assumed:** SQ-552 (the missing 09 §1.2 ↔ 11 §11.5 precondition
diff) now blocks a *primary* surface rather than a deferrable one, and doc 14's TH-74 residual was
re-assessed for its enlarged exposure (§3.9 preamble).


### Track O — Release and operations


### Track G — Rollout phase gates (evidence + META decision + values ratification each)


Deferred (🅿, post-v1, do not implement): forecast trading / reopened books (N-8, D-8 — 04 §13);
order-book layer (04); Mode A binding; combinatorial futarchy (01 §2.4).

---

## Spec questions

Open ambiguities/contradictions found in `docs/architecture/`. Record them here first;
under rule R-1 a genuine defect may be corrected in the spec directly, but log
non-obvious semantic changes and confirm with the user before diverging.
Format: `| ID | Question | Spec ref | Raised | Status |`

### Resolution batches (triage sweep, 2026-07-20)

Every **open** row is assigned to exactly one batch below, so the backlog can be
retired in coherent units instead of one row at a time. The assignment is checked
mechanically by `python3 tools/ci/check-spec-question-batches.py` (docs CI job):
ids are unique, each open id appears in exactly one batch, no batch names a
closed or non-existent id, and a batch declaring **0** rows is closed — its
Members cell is prose explaining where the rows went, not a member list. Run it
after closing rows. Batches **B1–B6** are
ratify-as-shipped — the row already carries the conservative G-1/R-7-safe
behaviour and resolution is a ruling plus a doc sentence, no production code.
**D** is doc-truing (the spec contradicts itself and the code is demonstrably
right). **C** is the single integration-contract bump. **X** is real code.
**E** (added 2026-07-29 with Track E) is evidence and values work that blocks a
*claim* rather than a milestone — simulation fidelity, ops sizing, artifact
provenance — and is separated from **X** because none of its rows is waiting on
protocol code.


Priority inside **X**: the release-manifest `release_blockers` rows (SQ-205, SQ-263,
SQ-261, and the SQ-173/174/175/177/180/181/182 adoption-input family) and the
self-locking liveness traps (SQ-215, SQ-235) lead; SQ-233 gained
urgency at G1 as the named blocker for drill 08. **B4 added eight rows and two of
them outrank most of that list:** SQ-40 (every non-TREASURY proposal fails the
`decide` *dispatch* instead of returning `Reject(SecuritySizing)`, so it can never
resolve — and the reference model independently adopts at prize 0, a live oracle
divergence) and SQ-36 (one in-bounds META raise of `ledger.pos_dep` permanently
wedges every count-decreasing ledger call, stranding ~90 % of holders' escrow).
SQ-64 remains a frozen-02 fidelity defect; SQ-42 is a kernel↔oracle
non-equivalence the differential corpus is structurally blind to. **Batch D added four
rows and one of them is a truth defect:** SQ-314 (`void_cohort` overwrites the recorded
decisions of Measuring cohort members, so the archive records a rejection the market never
produced) ranks with SQ-40/SQ-36; SQ-316 (the 09 §6.1 TREASURY trap-recovery path is
unreachable through screening) and SQ-313 (θ⁻ knees have no directional authorization)
follow; SQ-315 is a dead-variant tidy.


**SQ-320 status correction (2026-07-22):** the earlier synchronization note that kept this row open is superseded by the bounded follow-up summarized in its row and the current Session log. The documentation/API fan-out, proposal-map proof, keeper completeness/rebate work and contract-v7 retention dependency are included in one reviewed liveness component; SQ-320 and SQ-66 are no longer batch-X members. The distinct capacity defect discovered during that review is SQ-483.

## Verification log

`[VERIFY]` tags resolved against live sources (rule R-2), plus the standing backlog
lifted from the spec. Format: `| ID | Item | Spec ref | Status | Result |`

## Decision log

Spec changes and other project decisions (rule R-1, AGENTS.md).

## Audit log

`/spec-audit` runs. Format: `| Date | Scope | Verdict | Pointer |`

## Unplanned changes

Repo changes outside any milestone (config tweaks, user-driven edits) — one line each.

- 2026-07-12 — Added `docs/design/claude-design-kit/` (user-requested): 7-file non-normative context pack for Claude Design (docs 10/11 copied verbatim with derived-copy headers; 00/01–09/13/14/15 distilled read-only) + `PROMPT.md`. Spec untouched; README/AGENTS repo maps updated.
- 2026-07-13 — Project renamed "Bleevit" → "Bleavit" (user-requested): literal replace across the same 10 living/derived files. `docs/architecture/` still contains zero occurrences, so no frozen-doc amendment was needed.
- 2026-07-17 — Added `.github/dependabot.yml` (user-requested), then simplified it in a follow-up PR: monthly Cargo updates for the root workspace plus weekly Cargo updates for the keeper workspace and weekly GitHub Actions updates. Specification and milestone status untouched.
- 2026-07-17 — Documented a `git rerere` recommendation in AGENTS.md R-9 (user-requested): recurring `PLAN.md` merge conflicts across concurrent PRs (every PR touches `Current focus`/`Milestones`/`Session log`) prompted the note to enable `rerere.enabled` locally so repeated conflict shapes auto-resolve. Local git config only — nothing enforceable via a committed file; no spec or milestone status touched.
- 2026-07-29 — Fixed two **pre-existing** Markdown table defects in `docs/architecture/`, found incidentally during the Track E sweep and unrelated to E1. `00-decision-record.md` D-17's chain-identity table carried a three-cell row in a two-column table (`\| USDC decimals \| 6 · VIT decimals \| 12 \|` — two rows merged by a stray `·`), split into the two rows it was meant to be. `05-welfare-and-decision-engine.md` §5's decision table had two rows (`Full/trailing disagreement (first)`, `Disagreement/fail after extension`) carrying 10 check columns against an 11-column header; the missing cell is unambiguous from every sibling row's shape, so one `–` was added to each. Both render wrong in GFM today. **Note for tooling:** `tools/ci/check-plan-tables.py` already accepts path arguments but CI only ever passes `PLAN.md`, so nothing gates table structure in `docs/architecture/` — which is how both survived. Running it over the spec set (`python3 tools/ci/check-plan-tables.py docs/architecture/*.md`) is a one-line CI change and is now clean **except** for one pre-existing backlog left deliberately unfixed: **15 rows of `13-parameters.md` §4** (lines 258–277 at this commit) collapse the table's separate *Scope* and *Doc* columns into a single cell against its 4-column header. Every one renders wrong today. It is unrelated to E1, each row needs a per-row judgement about where Scope ends and Doc begins, and folding 15 edits to the values document into a solvency change would have been the wrong trade — so it is recorded here rather than swept in. Fix it and turn the gate on in the same pass.
- 2026-07-17 — Added a Cargo `ignore` block to `.github/dependabot.yml` for the polkadot-stable2603 family (`sp-*`, `frame-*`, `pallet-*`, `cumulus-*`, `staging-*`, `polkadot-*`, `parachains-common`, `substrate-wasm-builder`). The root workspace `=`-exact-pins that family deliberately (root `Cargo.toml` `[workspace.dependencies]` header: "so `cargo update` cannot silently drift the SDK mix"), so a per-crate bot bump fractures the release train and cannot compile; the train moves as a unit via a deliberate milestone, never a Dependabot PR. `keeper/` (separate workspace, caret ranges) stays auto-updated. Prompted by open PRs #81–85, each targeting a pinned key. No spec or milestone status touched.
- 2026-08-10 — **Redesigned the visual layer (user-requested: a more beautiful modern design, optimised for simplicity and understanding).** `app/src/styles/app.css` rewritten whole, no other file changed. The class vocabulary is unchanged, so `check:style-coverage` binds the same 104 classes in both directions and no gate-parsed `.tsx` file moved. Substantive changes: provenance badge loudness inverted so the baseline status is quiet and the four weaker ones carry chips; six marks instead of two, so the notation holds without hue; a margin rail replaces the three value underlines, one of which read as a browser spellcheck error; panels lose their cards in favour of a heading, a hairline and space; one shared column measurement replaces three gutters; the palette drops from five hues to four. Two rendering defects fixed on the way: the sudo band was invisible in dark mode, and the positions table overflowed onto `body` on a phone, sliding refusals off screen. No milestone status and no specification text touched — F28 stays ✅ and its open items are unchanged.
- 2026-07-17 — **PLAN.md table-structure gate added (user-requested: "the formatting for the tables in PLAN.md should never drift / break").** The trigger: a blank line inside the Track B milestones table had severed the B10/B11 rows from their header (rendering as raw pipe-text); the same defect orphaned V-25/V-30 in the Verification log and the last two Decision-log rows, and a sweep found three more GFM-broken rows (SQ-54/SQ-50 missing their `Raised` cell; unescaped `|` inside backtick spans in SQ-7/SQ-212 and two session-log rows — GFM splits cells on pipes even inside code spans, only `\|` escapes). All fixed. Enforcement: `tools/ci/check-plan-tables.py` (strict GFM cell splitting; orphaned-row / missing-header / cell-count / stray-separator rules; fence-aware) + 11 unit tests in `tools/ci/tests/`, wired as a third Stop hook (`.claude/hooks/guard-plan-tables.sh`, blocks session end on a malformed table) and as a step in the `docs` CI job. No spec or milestone status touched.
- 2026-07-25 — **Consolidated the six open `chore(deps)` Dependabot PRs (#160–#165) into one batch (user-requested: "fix all chore(deps) PRs … merged if necessary, otherwise close").** All six were green except the `Weight regression` job, and that failure was **not** theirs: their CI ran 2026-07-24 23:04 against main at `1aeba11`, which still carried 15 weight-regression acknowledgements, 4 of which had already expired for a branch cut from that main (`pallet_epoch::{set_next_epoch_length,submit,withdraw}`, `pallet_registry::file`). #159 merged six hours later at `60495b5` and pruned the acks file to zero entries, so a rebase alone clears the gate — no ack edit was needed (the recurring shape recorded in AGENTS.md R-9's rerere note; `tools/ci/check-weight-regression.py` defaults its base to `merge-base HEAD origin/main`). Consolidated rather than merged one-by-one because all five Cargo PRs rewrite the same `keeper/Cargo.lock` with **overlapping** transitive edits (`syn 2.0.119` re-pointing in #162/#163, `syn 3.0.3` added by `clap_derive` 4.6.4, `windows-sys 0.59.0` under #165), so each sequential merge would have forced the remaining PRs to rebase and re-run a ~2.5 h CI cycle. One `cargo update -p anyhow -p serde -p clap -p futures -p tokio` in the keeper workspace reproduced the exact union of all five targets (anyhow 1.0.104, serde/serde\_core/serde\_derive 1.0.229, clap/clap\_derive 4.6.4, the futures 0.3.33 family, tokio 1.53.1, plus `syn 3.0.3`); every bump is inside the existing caret ranges in `keeper/Cargo.toml`, so no manifest changed. #160's `actions/setup-python` 6→7 rode along unchanged (all 10 call sites across `ci.yml`/`release.yml`/`sweep.yml`); v7's only breaking change is the removal of the `pip-install` input, which this repo never used, and all 10 sites pin `python-version: '3.12'` explicitly. Root workspace `Cargo.lock` deliberately untouched — the stable2606 train stays `=`-exact pinned and Dependabot-ignored. No spec, no runtime code, and no milestone status touched.
- 2026-07-25 — **Grouped all three `.github/dependabot.yml` ecosystems into one PR per run (user-requested follow-up to the #160–#165 batch above, so the bot produces the batch itself).** Added a catch-all `groups:` block to each `updates` entry — `root-workspace` (cargo `/`, monthly), `keeper-workspace` (cargo `/keeper`, weekly — the entry that produced #161–#165), `github-actions` (weekly). The recurrence being fixed: same-ecosystem PRs all rewrite the *same* file (one `Cargo.lock` per cargo entry; the three `.github/workflows/*.yml` for the actions entry), and because each is cut from the main of its own creation, merging one staleifies the rest — forcing a rebase and a fresh ~2.5 h CI cycle each, with overlapping lockfile edits a 3-way merge can silently resolve into an inconsistent lock. Both `ignore` lists are untouched (8 root SDK-train patterns, 1 `dtolnay/rust-toolchain`), so grouping composes with them rather than replacing them; for the root entry the eligible remainder is per-crate rather than workspace-level (`parity-scale-codec`, `scale-info`, `serde`, `serde_json`, `proptest`, `bounded-collections`), all landing in one lock. **`applies-to` deliberately left at its default of `version-updates`, so security updates are NOT grouped** — advisory-driven bumps keep arriving one per PR, individually reviewable and revertable, per R-7. Validated by parsing the file and asserting the key set against Dependabot's documented group schema. No spec, no runtime code, and no milestone status touched.
- 2026-07-31 — **Added `rust-analyzer` to `rust-toolchain.toml`'s `components` (user-reported VS Code dialog).** The extension ships its own rust-analyzer binary built against a newer rustc than the pinned `1.89.0`, so its proc-macro server refused this workspace; listing the component makes the extension run `rustup run 1.89.0 rust-analyzer` instead, which matches the pin exactly (verified locally: `rust-analyzer 1.89.0 (2948388 2025-08-04)`). **No CI effect** — every workflow uses `dtolnay/rust-toolchain@1.89.0` with an explicit `components: rustfmt, clippy` input, which ignores `rust-toolchain.toml`; the cost is a one-off ~30 MB component fetch for contributors resolving the toolchain through bare `rustup`. `fuzz/rust-toolchain.toml` (nightly-2025-11-24) is deliberately untouched: it is *newer* than the bundled server, so it does not trip the same check. No spec, no runtime code, and no milestone status touched.
- 2026-08-06 — **Added `.claude/output-styles/plain-technical-english.md` (user-requested: an ASD-STE100 output style for Claude Code), then rewrote it so that what ships is original work.** The user asked, unprompted, whether the first draft could live in a public GPL-3.0 repository, and the answer was no: ASD-STE100's notice forbids reproduction "in whole or in part" without ASD's written authority, its enumerated free-usage grant covers aerospace/defence bodies and universities rather than projects like this one, and distribution "through different websites or portals" is expressly prohibited — so a commit would have published ASD-derived material *and* purported to relicense it under GPL. Obtaining the standard is free to any writer from `asd-ste100.org` (the copy consulted here came from that official site); only redistribution is restricted. The shipped file is organised around enforceable limits instead of the standard's nine sections, carries no rule numbering, states every constraint in its own words, is renamed **Plain Technical English** so it does not take the trademark as its title, and opens with a provenance-and-trademark notice disclaiming affiliation and endorsement. Verified rather than asserted: a shingle comparison against the specification text finds **no shared 5-word sequence** except the publisher's legal name and the standard's title, both of which an attribution notice must state. Selected locally through `outputStyle` in the gitignored `.claude/settings.local.json`; CLAUDE.md carries a pointer section plus the do-not-paste-rule-text constraint. Specification and milestone status untouched.
- 2026-08-10 — **Whole-repository security review (user-requested), and the two findings that survived it, fixed.** Scope was the repository rather than a diff: `pallets/` + `crates/`, `runtime/` + `runtime/bleavit-xcm/` + `runtime-api/` + `node/`, `app/` + `explainer/`, every `.py` under `tools/`, the three workflows plus the 18 shell scripts and `keeper/`, and a cross-language sweep of every trust-decision path. Eight candidates, six rejected on re-verification with stated reasons, two fixed. **Neither is live today** — the keeper's fail-open default needed a hostile RPC endpoint an operator had pointed at, and the oracle's broken commitment sits behind a set nothing populates — which is exactly why they were worth closing now, before something depends on the answer. The fixes are described in the *Decision log* and the *Session log*; the code touches `crates/oracle-core/`, `pallets/oracle/`, `runtime/bleavit-runtime/src/configs.rs`, `keeper/bleavit-keeper/`, `keeper/README.md` and `zombienet/scripts/keeper-node.sh` (which gains the opt-out, earned by the loopback-URL check it already performs). No specification file changed and no milestone status moved. **One thing found and deliberately not fixed:** `cargo test -p pallet-oracle --features runtime-benchmarks` fails `bench_report` on its own fixture assertion, identically at `615c9ba8` in a pristine worktree — pre-existing, unrelated, and folding a benchmark-fixture repair into a security change would have been the wrong trade. CI's `Rust workspace` leg does not run that feature for the pallet, which is how it went unseen.

- 2026-08-08 — **Merged the two open `chore(deps)` Dependabot PRs (#276, #277), and found a main commit that carries no CI record (user-requested: "resolve them and merge if necessary").** Both arrived green: 18 CI checks SUCCESS each, CodeQL NEUTRAL, and `mergeStateStatus` CLEAN. Both branched from `6bd20937`, four merges behind main, so neither run had seen today's tree. Main's own `ci.yml` moved in that range, and #276 edits that same file. The merged result was therefore verified before the merge rather than after. Both commits went onto `36de7ac2` in a scratch branch, and the 377-test `tools/ci/tests` suite passed over the result — the suite that reads the workflow's own wiring.

  The keeper leg was deliberately not rebuilt. Main never touched `keeper/` in that range, and #277's own `Rust workspace` run had already exercised that exact lockfile (R-12). After both merges, the new main tip `dba34593` diffs empty against the verified scratch branch.

  **Dependabot's title for #277 is wrong, and the squash subject corrects it.** The bot announced `clap` 4.6.4 → 4.6.5. The lockfile it committed resolves 4.6.6, because clap published 4.6.6 between the metadata generation and the lock update. `clap_builder` moved 4.6.2 → 4.6.6 alongside it, and `keeper/Cargo.toml` requires `4.5.54`, so the range accepts both. #276 bumps `actions/setup-java` 5.6.0 → 5.7.0 for its single consumer, the `model-checking` job. That release deprecates the legacy Adopt distributions and the job asks for `temurin`, so the deprecation misses it — proven rather than argued, because the `Run actions/setup-java@v5.7.0` step succeeded and TLC then ran 2 hours 11 minutes and passed.

  **The finding: `ba7a2d8b`, the intermediate main commit from #276, carries no CI record at all.** Its run reports `cancelled` with `total_jobs = 0`, so it never started a job. CLAUDE.md said main never cancels, because there each run is the record for its own commit. That holds for a **running** run, and it held here — `36de7ac2`'s run stayed in progress through both merges and survived untouched. It does not hold for a **queued** one. GitHub keeps at most one pending run per concurrency group, so `cancel-in-progress: false` protects what runs and cannot protect what waits.

  `ba7a2d8b` sat pending for 32 seconds, and the newer commit displaced it 3 seconds after #277 merged. Two main commits landing inside one CI cycle therefore leave the earlier one untested. A full run here exceeds two hours, so that window is wide rather than theoretical. CLAUDE.md's concurrency note now says so. No spec, no runtime code, and no milestone status touched.
- 2026-08-11 — **Fixed the open Dependabot alerts, and closed the gate class that hid one of them (user-requested).** Neither alert was fixable by a bump: `glib` 0.18.5 (#27, medium) is forced by the archived `gtk 0.18.2` and is provably unreachable, and `@opentelemetry/core` (#28) keeps its 2026-08-07 waiver by the user's ruling. What did move: `event-listener` 5.4.1 → 5.4.2 in the root and keeper lockfiles (RUSTSEC-2026-0221), found only because the whole `unsound` class was triaged; a fifth gate leg (`tools/ci/check-unsound-advisories.py` + `tools/ci/unsound-waivers.toml`) that fails on any untriaged `unsound` advisory; supply-chain summary schema v4 → v5; and the R-1 amendment to 15 §4.5 (SQ-1048) the change required. Rejected: bumping Lighthouse across a major to clear #28, which would re-baseline a published performance budget.

## Session log

Append-only; newest last. Format: `| Date | Milestone(s) | Done | Next |`
