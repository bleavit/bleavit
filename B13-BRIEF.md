# B13 work package — runtime telemetry surfaces for the 9 O5 monitoring seam series

You are the implementation author for PLAN.md milestone **B13** in this repository
(a spec-first Polkadot FRAME workspace — read `AGENTS.md` and
`.claude/rules/runtime-code.md` first; they bind you).

The governing spec text was committed this session: read
`docs/architecture/12-release-and-operations.md` §6.3, especially the new paragraph
**"Runtime telemetry source (added 2026-07-18, B13)"** — it defines the monitoring-only
`TelemetryApi` (explicitly OUTSIDE the frozen 02 contract), and PLAN.md · Decision log
(second row, 2026-07-18). Series semantics anchor to 12 §6.3's alert tables, 04 §5
(b·ln2 loss bound), and 08 §4 (POL floors).

## Goal

Replace all **9 `owner = "B13"` seam entries** in `tools/monitoring/series-inventory.toml`
with live, audited sources:

| Series | Source you must build |
|---|---|
| `bleavit_market_book_loss_usdc` | per live book: realized maker loss in USDC |
| `bleavit_market_lmsr_loss_bound_usdc` | per live book: `seed_headroom(b)` = b·ln2 (04 §5 V4) |
| `bleavit_market_mid_window_coverage_percent` | live projection over UNSEALED decision windows |
| `bleavit_market_effective_pol_usdc` | funded POL (POL + POL_BASELINE line balances) |
| `bleavit_market_pol_floor_usdc` | required POL (Σ live-book commitments + baseline requirement) |
| `bleavit_ledger_collateral_drift_usdc` | custody − (Σ escrow + DepositsHeld), signed |
| `bleavit_runtime_migration_cursor_stalled` | the canonical stall detector state |
| `bleavit_runtime_storage_max_utilization_ratio` | the metadata-invisible storage-bound remainder |
| `bleavit_runtime_numeric_anomaly_spike` | LMSR domain rejections + anomalous rounding dust |

## Architecture (fixed decisions — follow them)

1. **`TelemetryApi`** — a new `sp_api::decl_runtime_apis!` trait in the
   `futarchy-runtime-api` crate (`runtime-api/src/`), in its own module (e.g.
   `telemetry.rs`), clearly doc-commented as monitoring-only/non-contract. Return
   types: define them in the runtime-api crate (NOT in `futarchy-primitives` — that
   crate is the 02 contract-type home), bounded (`BoundedVec` with existing
   `futarchy_primitives::bounds` where sensible), `Encode/Decode/TypeInfo`.
2. **Implementation** in `runtime/bleavit-runtime/src/telemetry.rs` (stub exists with
   the doc header; keep it) as free functions mirroring the `views.rs` style, wired in
   `runtime/bleavit-runtime/src/apis.rs` via a new `impl ... TelemetryApi` block
   (mirror the `FutarchyApi` block).
3. **Exporter** (`tools/monitoring/chain_alerts_exporter.py`): new fail-closed
   domain families calling `TelemetryApi_*` via the existing `state_call` machinery,
   decoding SCALE per the existing patterns; register the 9 series in `SERIES`
   (labels where per-book/per-map: e.g. `market`/`map` labels — the existing alert
   rule exprs in `deploy/monitoring/prometheus/rules/bleavit-alerts.yml` must still
   evaluate; do NOT rename any series; only add labels compatible with the exprs
   (aggregations like `max(...)` already handle labeled families — verify each expr
   against your label choice and keep unlabeled any series whose expr does a direct
   cross-series comparison, e.g. book loss vs bound must carry IDENTICAL label sets,
   and `effective_pol` vs `pol_floor` likewise)).
4. **`series-inventory.toml`**: flip the 9 entries from `source = "seam"` to
   `source = "chain-exporter"` (drop owner/rationale). `python3
   tools/monitoring/check_alert_coverage.py` must pass (note: PLAN.md still shows B13
   as 🔨 right now — the orchestrator flips it to ✅ later; the gate only requires
   seams' owners to be non-✅, and after your change there are no B13 seams left).

## Per-series implementation guidance (verify each in code before building)

- **Book loss**: `MarketBook` (`crates/market-core/src/lib.rs:433`) has
  `b, q_long, q_short, fees_accrued` but no cost anchor. Derive the realized maker
  loss from the LMSR cost function per 04 §3/§6.3's solvency-by-construction
  accounting (`C(q) − C(0,0)` net of premiums held — inspect how the book account
  custody and `seed_headroom` interact at seeding and trading; the book's USDC
  account balance is readable on-chain). Document the derivation in a comment; it
  must satisfy: loss = 0 at open, loss → b·ln2 as the book approaches worst case
  (04 §5 V4), loss never exceeds `seed_headroom(b)`. Use `futarchy-fixed` math only
  (no floats), rounding per 04 §4. Test against the 04 §5 vector states (V1/V3
  states have exactly computable losses — assert within the §4 error bound).
- **Loss bound**: `market_core::seed_headroom(b)` per live book. Pair labels with
  the loss series.
- **Mid-window coverage**: unsealed `TwapWindow`s in `pallet_market::DecisionWindows`;
  projection = `min(100, observations·100 / (elapsed/interval))` with
  `interval = mkt.obs_interval` (see `decision_book_window_stats` in `configs.rs:1866`
  for the sealed-window analogue — you may NOT edit configs.rs; reimplement the small
  arithmetic in telemetry.rs reading `crate::configs`' public items:
  `MarketObsInterval` is `pub`). Only windows with `start ≤ now < end`.
- **Effective POL / floor**: effective = `line_balance(Pol) + line_balance(PolBaseline)`
  (`pallet_futarchy_treasury::Pallet` pub fns); floor = Σ `pol_commitments` from
  `Pallet::treasury()` snapshot + the standing Baseline requirement
  (`pol.b_baseline`·ln2 — compute via `seed_headroom` on the live baseline book's b,
  or the Params key via existing pub helpers; verify which is the honest 08 §4.3
  reading and document).
- **Collateral drift**: add ONE read-only pub helper to
  `pallets/conditional-ledger/src/lib.rs` computing exactly the quantities of the L-2
  try-state comparison (lib.rs ~1836-1857: Σ vault escrow + baseline escrow +
  `DepositsHeld` vs the sovereign USDC balance) — same checked math, returning both
  sides (no behavioral change; try-state itself untouched). TelemetryApi returns
  custody and liability; the exporter computes/exports the signed drift.
- **Migration stall**: `crate::configs::active_migration_stall_is_live` +
  `MigrationHaltSources` & `crate::configs::MIGRATION_STALL_HALT` over
  `pallet_migrations::Cursor` — all already `pub(crate)`/`pub` (made visible this
  session). Stalled = halt bit set OR live-stall predicate true.
- **Storage remainder**: the bounded shapes invisible to the exporter's
  metadata-driven prefix counting (BoundedVec-in-StorageValue / const-generic bounds
  without paired `#[pallet::constant]`s). Cover at least: `TwapCheckpoints` inner
  rings, `DecisionWindows` inner vecs, `DecisionWindowOwners`, the treasury `State`
  BoundedVecs (streams, pending_outflows, pol_commitments, budget lines, coretime
  sets), the epoch recent-cohorts ring, oracle rounds if unpaired. Return
  (name, entries, bound) rows; exporter emits ratio per `map` label. Name the maps
  with stable snake_case strings. NOTE: another author is concurrently extending the
  treasury coretime storage — read the treasury via its PUBLIC snapshot
  (`Pallet::treasury()`) and bounds constants so your code composes with whatever
  shape lands; if a field you expected is missing at build time, cover what exists.
- **Numeric anomalies**: two components, exported with a `kind` label
  (`domain_rejection` / `rounding_dust`), rules expr is `> 0` so both label rows work:
  1. Domain rejections: counted by the EXPORTER from finalized `System.ExtrinsicFailed`
     events whose `DispatchError` resolves to `pallet_market::Error::PriceBoundExceeded`
     (resolve the module index + error index from metadata, never hardcode) — per-block
     gauge (count in the scraped finalized block). Failed extrinsics roll back storage,
     so an on-chain counter is impossible; the event stream is the audited source.
     Document this in the exporter.
  2. Rounding dust: TelemetryApi reports ANOMALOUS dust only — residue beyond what the
     ledger's own invariants admit (derive the admissible bound from the ledger's
     dust/rounding invariants (03 §6, I-5/I-26 vicinity) — inspect `sweep_dust` and
     the try-state residue checks; normal operating dust must NOT trip the alert).
     If, after inspection, no honest "anomalous dust" bound exists short of the drift
     series itself, export the component as the excess of (custody − liability)
     beyond zero — i.e. 0 whenever conservation holds — and document why.

## Hard constraints

- `.claude/rules/runtime-code.md` binds all Rust: no unwrap/expect/panic/unsafe,
  checked math, no floats (fixed-point via `futarchy-fixed`), bounded returns, no new
  hooks, XCM isolation (rule 7) untouched.
- **The 02 contract, `FutarchyApi`, and `futarchy-primitives` view types must NOT
  change.** `crates/market-core` may gain ADDITIVE pub helpers only — do not change
  any existing signature (a separate nightly fuzz workspace consumes these crates;
  signature changes break it invisibly).
- **Files you must NOT touch**: `PLAN.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`,
  anything under `docs/`, `runtime/bleavit-runtime/src/configs.rs`, `lib.rs`,
  `classifier.rs`, `genesis.rs`, `tests.rs`, `tests_s5*.rs`, `views.rs`,
  `pov_budgets.rs`, `runtime/bleavit-runtime/src/weights/`, `pallets/futarchy-treasury/`,
  `crates/futarchy-treasury-core/`, `crates/constitution-core/`, `runtime/bleavit-xcm/`,
  `tools/limit-coverage/`, `keeper/`, `deploy/` EXCEPT nothing —
  (`deploy/monitoring/` rule files: read-only; if an expr is incompatible with your
  labels, adjust YOUR label design, not the rules; if truly impossible, report it).
- Your runtime tests go in `runtime/bleavit-runtime/src/tests_telemetry.rs` (stub
  exists). Build the mock/externalities the way `tests.rs` does (you may read it, not
  edit it).
- **Another author is working concurrently in this same tree** on the treasury/
  coretime scope. NEVER revert, clean up, stash, or `git checkout/restore` changes you
  did not make; no destructive git commands; do not attempt to commit (read-only index).
- Python: stdlib only (plus the deps the monitoring suite already uses); follow the
  exporter's existing fail-closed patterns exactly (`clear_family`, never healthy zeros).

## Verification you must run before reporting

- `cargo fmt --all` (then ensure `--check` passes)
- `cargo test -p futarchy-runtime-api -p pallet-conditional-ledger -p market-core`
- `cargo test -p bleavit-runtime tests_telemetry` (plus the full
  `cargo test -p bleavit-runtime` if runtime-wide effects are plausible)
- `cargo clippy -p futarchy-runtime-api -p bleavit-runtime -p pallet-conditional-ledger -p market-core --all-targets -- -D warnings`
- `python3 -m unittest discover -s tools/monitoring/tests` (needs pyyaml==6.0.2 — present)
- `python3 tools/monitoring/check_alert_coverage.py`

## Report (your final message)

List: files changed; each of the 9 series with its exact audited source and semantics;
the book-loss derivation summary; every test/gate command you ran with its result;
residuals or spec ambiguities found (do NOT edit spec/PLAN — report them); your
intended conventional-commit message.
