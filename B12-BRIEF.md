# B12 work package — coretime renewal funding activation

You are the implementation author for PLAN.md milestone **B12** in this repository
(a spec-first Polkadot FRAME workspace — read `AGENTS.md` and `.claude/rules/runtime-code.md`
first; they bind you). The spec ruling that unblocked this milestone was committed this
session — read it before writing code:

- `docs/architecture/09-execution-upgrades-and-rollout.md` §4, especially the new
  block **"Quote authority, freshness and denomination (SQ-245/SQ-246 ruling, 2026-07-18)"**.
- `docs/architecture/08-treasury-and-economics.md` §1.1 (ops.coretime row) and §1.4
  (new calls/events sentence).
- `docs/architecture/13-parameters.md` §1: the three new TREASURY keys
  `ops.coretime_dot_rate` (key `ops.ct_dot_rate`), `ops.coretime_fee_dot` (key
  `ops.ct_fee_dot`), `ops.coretime_quote_ttl` (key `ops.ct_quote_ttl`), and §4 row
  "Treasury coretime obligations".
- PLAN.md · Decision log, first row (2026-07-18) — the full ruling rationale.

## Deliverables (all normative behavior traces to the spec text above)

1. **Treasury core** (`crates/futarchy-treasury-core/src/lib.rs`, frame-free `no_std`):
   - Extend the open-quote representation with a noted-at timestamp (the core takes
     `now: u64`-style parameters; it must not gain frame deps). Supersession in place
     (re-noting a period replaces price + noted-at; the ≤ 8 bound counts periods).
   - `execute_coretime_renewal`: reject expired quotes (age > ttl) with a typed error;
     debit `ops.coretime` by the **USDC value of (price + fee_budget) DOT planck at
     rate µUSDC/DOT, rounded UP** (`ceil((price+fee)*rate / 10^10)`, checked u128 math,
     fail closed on overflow/zero-rate); keep period idempotency + eviction exactly as
     they are. The function returns the DOT-planck price for the dispatcher.
   - Expired-quote prune: permissionless prune allowed only when expired; the quote
     authority may prune any open quote (model as a boolean `authority` parameter —
     account identity stays in the pallet).
   - New/adjusted typed errors (e.g. `QuoteExpired`, `QuoteNotExpired`,
     `RateUnset`/reuse of existing error taxonomy where honest) + events
     `CoretimeQuoteNoted { period_index, price }`, `CoretimeQuotePruned { period_index }`.
   - Keep the existing core unit tests green; extend them for TTL/supersession/
     conversion-rounding (rounding must be asserted UP, against the spender).

2. **Pallet** (`pallets/futarchy-treasury/src/`):
   - New storage: `CoretimeQuoteAuthority: StorageValue<AccountId, OptionQuery>` and
     `CoretimeRenewalAccount: StorageValue<[u8; 32], OptionQuery>` + genesis config
     fields (dev presets: the existing dev ops stand-in account; unset = fail closed).
   - New extrinsics (append-only call indices):
     - `note_coretime_quote(period_index, price)` — Signed; rejects unless the caller
       equals the stored quote authority (`NotQuoteAuthority` error); unset authority
       fails closed. Calls the core note path with `now`.
     - `prune_coretime_quote(period_index)` — Signed; permissionless once the quote's
       TTL has expired; the quote authority may prune anytime; otherwise
       `QuoteNotExpired`. Keeper-crankable ⇒ self-rebate via
       `do_keeper_rebate(CrankClass::General)` mirroring `execute_coretime_renewal`
       (check the existing pattern first and follow it).
     - `set_coretime_authority(quote_authority, renewal_account)` — `T::TreasuryOrigin`
       only; sets both storage values; event `CoretimeAuthoritySet`.
     The existing internal pub fns may be reshaped/absorbed — they are runtime-internal,
     not 02-frozen (verify nothing you rename appears in
     `docs/architecture/02-integration-contract.md`; 02 must NOT change).
   - `execute_coretime_renewal` passes `now`, ttl, rate, fee (read via `T::Params` or
     new Config Gets wired from the runtime — follow how other 13-keys reach this
     pallet; parameters are NEVER hardcoded, rule 4) and dispatches with the
     DOT-planck price.
   - try-state: extend for the new storage (e.g. every open quote has price > 0,
     noted-at ≤ now, set sizes ≤ 8 — follow the existing try-state style).
   - Benchmarks + WeightInfo entries for the three new extrinsics
     (`benchmarking.rs`, `weights.rs`, and
     `runtime/bleavit-runtime/src/weights/pallet_futarchy_treasury.rs` — follow the
     existing generated style; the SQ-261 weight-regeneration sweep will regenerate).
   - Tests (`tests.rs`): origin misuse (non-authority note, non-treasury
     set_coretime_authority, wrapper-negative per the repo pattern), TTL expiry path,
     supersession, permissionless-prune-only-when-expired, conversion debit rounding,
     unset authority/renewal-account fail-closed, freeze exemption for note/prune
     (mirror the existing `execute_coretime_renewal` freeze-exempt test at
     tests.rs ~317), dispatch-past-limit for the 9th open quote via the real extrinsic.

3. **Constitution keys** (`crates/constitution-core/src/lib.rs`):
   - Three `row(...)` entries in `genesis_params()` matching 13 §1 exactly:
     `ops.ct_dot_rate` Balance default 5_000_000 min 500_000 max 500_000_000,
     `ops.ct_fee_dot` Balance default 5_000_000_000 min 100_000_000 max 100_000_000_000,
     `ops.ct_quote_ttl` u32 default 100_800 min 7_200 max 403_200; all TREASURY class,
     ×2 max delta, cooldown 1 — copy the exact encoding conventions of neighboring
     TREASURY rows (e.g. the `ops.*` line keys) for delta/cooldown/class flags.

4. **Runtime** (`runtime/bleavit-runtime/src/`):
   - `configs.rs`: replace `PendingRenewalDispatch` with the real
     `bleavit_xcm::coretime::XcmRenewalDispatcher` wiring: XcmExecutor, treasury
     origin Location (see `TreasuryOriginToLocation`), fee budget read live from
     `ops.ct_fee_dot` (Params-backed Get, genesis-default fallback like
     `balance_param`), renewal account read from the treasury storage — **change the
     dispatcher/bleavit-xcm signature to accept `Get<Option<[u8;32]>>` and fail closed
     (typed error, no state change) when None** (`runtime/bleavit-xcm/src/coretime.rs`
     is yours to edit; keep its unit tests green in `runtime/bleavit-xcm/src/tests.rs`
     + `mock.rs`). Weight limits: conservative `parameter_types!` constants with a
     comment citing SQ-261's weight-placeholder status. Keep `BenchmarkRenewalDispatch`
     for the benchmark path.
   - `classifier.rs`: `note_coretime_quote` + `prune_coretime_quote` →
     `CallDomain::Public`; `set_coretime_authority` → `CallDomain::Treasury`; extend
     the proposal-outflow sizing table in `configs.rs` (~line 2771): the two public
     calls `return false`, `set_coretime_authority` contributes 0 — mirror
     `fund_budget_line`.
   - Dead-man freeze exemption: find where `execute_coretime_renewal` is exempted
     (grep the freeze filter / classifier paths + the tests) and extend the exemption
     to `note_coretime_quote` and `prune_coretime_quote` exactly per 09 §4.
   - `genesis.rs` presets: set the dev quote authority + a dev renewal account.
   - `tests.rs`: an e2e path — treasury sets authority (via the guard origin route used
     elsewhere in tests), authority notes a quote, keeper executes renewal, the line is
     debited by the converted amount (assert exact ceil rounding), the XCM leg is
     exercised (or its executor mocked the way other runtime XCM tests do); plus a
     dead-man-freeze-active test proving note/prune/execute all still dispatch.
   - `tests_s5.rs` / `tests_s5_behavior.rs`: extend the pinned call inventory for the
     three new calls (public/treasury leaf rows) — deliberate, documented updates.

5. **Limit coverage** (`tools/limit-coverage/`):
   - `registry.toml`: reclassify `"Treasury coretime obligations"` from `unwired` to
     `dispatch-limit` bound to a real `// limit-coverage: Treasury coretime obligations`
     marked test (the 9th-quote rejection through the real extrinsic); add entries for
     the three new §1 keys (follow the `xcm.dot_per_sec` param-bounds precedent,
     `genesis = true`).
   - `genesis-keys.json`: add the three key strings (byte-asserted fixture — the
     constitution test will tell you if ordering matters).
   - Run `python3 tools/limit-coverage/check-limit-coverage.py` and
     `python3 -m unittest discover -s tools/limit-coverage/tests` until green.

6. **Keeper** (`keeper/` — separate cargo workspace): check whether the planner cranks
   `execute_coretime_renewal`; if yes, add `prune_coretime_quote` planning for expired
   quotes following the same pattern (its own fmt/clippy/test leg must stay green). If
   the planner has no coretime role, report that as a residual instead of inventing one.

7. If the deploy chain-spec validator or genesis-allocation template
   (`deploy/`, `tools/deploy/`) structurally validates treasury genesis fields, extend
   them; run `python3 -m unittest discover -s tools/deploy/tests`.

## Hard constraints

- Rules in `.claude/rules/runtime-code.md` are binding: no unwrap/expect/panic/unsafe,
  checked math only, bounded storage, typed errors, G-1 fail-closed everywhere,
  parameters never hardcoded (kernel constants from `futarchy-primitives`, tunables
  from constitution Params), origins narrow, 02 contract untouched.
- **02 (`docs/architecture/02-integration-contract.md`) must not change.** If you
  believe it must, STOP that sub-task and report it.
- **Files you must NOT touch**: `PLAN.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`,
  anything under `docs/`, `runtime/bleavit-runtime/src/telemetry.rs`,
  `runtime/bleavit-runtime/src/tests_telemetry.rs`, `runtime/bleavit-runtime/src/apis.rs`,
  `runtime-api/`, `pallets/conditional-ledger/`, `pallets/market/`, `crates/market-core/`,
  `tools/monitoring/`, `deploy/monitoring/`.
- **Another author is working concurrently in this same tree** on the disjoint scope
  above (telemetry). NEVER revert, clean up, stash, or `git checkout/restore` changes
  you did not make; do not run destructive git commands at all. Do not attempt to
  commit (the git index is read-only in your sandbox).
- Match surrounding code style and comment density; spec citations in comments only
  where the surrounding code does the same.

## Verification you must run before reporting

- `cargo fmt --all` (then ensure `--check` passes)
- `cargo test -p futarchy-treasury-core -p pallet-futarchy-treasury -p bleavit-xcm -p constitution-core -p pallet-constitution`
- `cargo test -p bleavit-runtime` (the full runtime suite)
- `cargo clippy -p pallet-futarchy-treasury -p futarchy-treasury-core -p bleavit-xcm -p bleavit-runtime --all-targets -- -D warnings`
- The two limit-coverage commands above; deploy tests if touched; keeper leg if touched.

## Report (your final message)

List: files changed; behaviors implemented mapped to their 09 §4/08/13 spec lines;
every test/gate command you ran with its result; residuals or spec ambiguities found
(do NOT edit spec/PLAN — report them); your intended conventional-commit message.
