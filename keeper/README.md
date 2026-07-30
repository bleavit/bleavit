# Bleavit keeper

`bleavit-keeper` is the untrusted, permissionless off-chain crank service from
[`01-system-overview.md` §4.2](../docs/architecture/01-system-overview.md). It watches finalized
Bleavit blocks, derives an honest snapshot of actionable work, and submits the signed calls that
keep epochs, observations, decisions, settlement, execution, data rounds, cleanup, renewal, and
welfare recording moving.

The keeper uses Subxt's dynamic API only. It downloads live metadata at connection time, reads
storage as dynamic SCALE values, and constructs calls from live pallet/call names. It has no
generated runtime bindings or bundled metadata. A role whose required pallet or call is absent is
disabled with one structured startup log line. This is expected today for the reserved `Epoch` and
`ExecutionGuard` runtime slots.

The service is not trusted by the protocol. Its planner is deterministic, calls are permissionless
and idempotent on-chain, and another keeper winning a state race is normal. Such extrinsic failures
are logged at `debug`; the next finalized snapshot ordinarily removes the work. Transport failures
are warned and trigger ordered endpoint failover. Priority-ordered transactions are submitted to
the pool with consecutive local nonces before their finality subscriptions are awaited concurrently,
so observation throughput is not limited to one crank per finalized block.

## Run against a development node

From the repository root, generate the development chain spec and start the repository's branded
omni-node. These commands build the root workspace and are intentionally separate from the keeper
workspace:

```sh
tools/deploy/generate-chain-specs.sh
cargo build -p bleavit-node --release --locked
target/release/bleavit-node \
  --chain deploy/chain-specs/out/bleavit-dev.json \
  --dev-block-time 3000 \
  --tmp \
  --rpc-port 9944
```

In another terminal, run the keeper from its own workspace:

```sh
cd keeper
cargo run --locked -p bleavit-keeper -- \
  --node-url ws://127.0.0.1:9944 \
  --signer-uri //Alice \
  --metrics-bind 127.0.0.1:9616
```

`//Alice` is for local development only. In an operator environment, pass an appropriately funded
keeper account via `--signer-uri` or put one Substrate secret URI in a permission-restricted file
and use `--signer-file`. The file is read as text; it is not an encrypted keystore container.
Live mode refuses to start unless one of those signer flags (or its config-file equivalent) is
explicitly set. Use `--dry-run` to extract, plan, and log without loading a signer or submitting anything. Run
`cargo run -p bleavit-keeper -- --help` for all CLI options.

## Configuration

CLI options override an optional TOML file:

```toml
node_urls = ["wss://rpc-a.example/wss", "wss://rpc-b.example/wss"]
signer_file = "/run/secrets/bleavit-keeper.suri"
# Chain identity. Without it the keeper signs for whichever chain the endpoint
# claims to be: `PolkadotConfig::default()` carries no genesis hash, so subxt
# falls back to the node's own answer.
genesis_hash = "0x…"
enabled_roles = [
  "tick",
  "observe",
  "decide",
  "settle",
  "execute",
  "oracle-close",
  "registry-close",
  "cleanup",
  "renewal",
  "welfare",
]
# Optional live-Params overrides; omit them in ordinary production operation.
# obs_interval = 10
# decision_window = 43200
# reserve_probe_interval = 14400
# reserve_probe_timeout = 600
dry_run = false
metrics_bind = "127.0.0.1:9616"
every_n_blocks = 1
startup_jitter_secs = 20
cooldown_depth = 3
tx_timeout_secs = 90
max_retries = 2
retry_base_ms = 500

# The calls this keeper will sign. Every byte it signs is derived from metadata
# the node serves, `dynamic::tx` payloads carry no validation hash, and subxt
# 0.50.2 encodes RFC-78's `CheckMetadataHash` as `Disabled` on every signature
# — so a compromised endpoint can keep the real genesis, spec and transaction
# versions and forge only the call. Pinning is what closes that; the genesis pin
# alone does not, because the forgery never leaves this chain. Start the keeper
# with no pins and it logs every observed value for you to adopt.
#
# Each value binds the call's metadata shape *and* the pallet/call index pair
# the encoder prepends. Both are needed: subxt's call hash covers only the
# variant name and its field types, so it does not identify the dispatchable —
# in this runtime `IncidentRegistry` and `MilestoneRegistry` hash identically in
# all six of their calls, and the keeper cranks both.
[call_hashes]
"Epoch.tick" = "0x…"
"Market.crank_observe" = "0x…"
```

Start it with `cargo run --locked -p bleavit-keeper -- --config keeper.toml`. Node URLs are tried in
the listed order. Observation, decision-window, and reserve-probe timing uses the precedence
explicit CLI/TOML override → live `Constitution.Params` row → documented fallback. The dynamic
reads use the canonical 16-byte keys `mkt.obs_interval`, `dec.window`, `res.probe_int`, and
`res.probe_to`; their fallbacks are 10, 43,200, 14,400, and 600 blocks respectively. The cooldown
ledger suppresses an accepted call with the same role, pallet, call, and arguments for the
configured finalized-block depth. Tick planning reads `Epoch.TickBatch` from live metadata and
falls back to 10 only when that constant is unavailable or invalid; these numeric copies are
compatibility defaults, not alternate parameter homes.

The exact role names used by configuration, logs, and metric labels are `tick`, `observe`,
`decide`, `settle`, `execute`, `oracle-close`, `registry-close`, `cleanup`, `renewal`, and
`welfare`. All are enabled by default, subject to live-metadata capability detection.

On chain, 05 §6 admits exactly three `pallet-epoch` entry paths into one welfare-owned
SettleAuthority boundary. The `settle` keeper role drives the two permissionless ones:
`settle_cohort → compute_settlement` on the measured path, and the
permissionless `finalize_epoch_baseline → settle_baseline_void` neutral passthrough of 05 §7(6) —
the repair for an epoch that opened a
Baseline vault but never formed a cohort, so the measured e+3 settlement is never scheduled and its
single-sided holders would otherwise be stranded forever (SQ-320). The third entry path is the
cohort-VOID transition `void_cohort → settle_baseline_void` of 05 §7(5); it is not a standing keeper
crank. All three share the same SettleAuthority origin, never a second authority; the two
permissionless paths therefore share one role and one set of metric labels. Because the orphan call
is idempotent and no-op-safe, it is planned only against a
Baseline vault that is still `Open` **and** whose epoch satisfies all three §7(6) preconditions
(strictly past, no `CohortInfo`, no non-terminal proposal of that epoch) — never as a standing
per-block no-op. It is prioritized above `cleanup` because it writes the terminal-block latch that
the Baseline dust sweep and the book reap both require.

The `cleanup` role drives the two-stage end of the
[`04-markets-and-pricing.md` §2](../docs/architecture/04-markets-and-pricing.md) market lifecycle.
`sweep_revenue(market)` realizes a settled book's revenue and returns its subsidy custody to the
treasury's `POL`/`POL_BASELINE` lines
([08](../docs/architecture/08-treasury-and-economics.md) §8 step 5); `reap(market)` then discards
the provably worthless residue that leaves behind. Sweep is admissible from the terminal block with
no delay, reap only after `ledger.archive_delay` **and** the swept marker — so the keeper plans a
sweep for every latched, unswept book and withholds that book's reap until the marker is visible,
rather than submitting a `NotReapable` it can predict. Sweep is prioritized above the rest of
cleanup for a second reason: the ledger's `sweep_dust*` is independent of the market and routes
residual escrow to `INSURANCE` ([03](../docs/architecture/03-conditional-ledger.md) §5.4), so a book
that reaches its ledger archive delay unswept loses its return to exactly that account. The two
stages are bounded a whole `ledger.archive_delay` apart and the priority ordering gives the sweep
the lower nonce in any batch carrying both, but neither of those is a lock, so the keeper does not
leave the order to chance. Both calls are permissionless and idempotent, and both are rebated from
the general keeper tranche — 08 §6.3's decision-critical list is closed and does not include them.
A runtime predating the Sweep stage exposes neither the call nor the marker map; its reaps keep
their earlier preconditions and no sweep is planned.

The same "do not submit what the chain will refuse" rule is extended to **three** calls under the
[`06`](../docs/architecture/06-governance-and-guardians.md) §6.3 freeze latches — deliberately not to
the whole refusal surface. `ExecutionGuard::execute` (09 §1.2(10)) and, for seeded books, the
transitively-refused `ledger.sweep_dust*` are **not** suppressed; extending to them is a separate
question, tracked as such. What is covered: `sweep_revenue` and
`crank_observe` error `Frozen` while `Market::FrozenUntil` is live, and `sweep_redemption_fees` while
`ConditionalLedger::FrozenUntil` is — two independent latches, read per pallet and never conflated.
The keeper suppresses exactly those calls for exactly that window: the test is `now < until`, the
precise negation of the pallets' own guard, so a call the chain would accept on the block a freeze
lapses is still planned on that block. An **unreadable** latch is treated as absent and the call is
submitted, which is deliberate — it reproduces the behaviour that predates these reads, whereas
treating an unreadable latch as frozen would let one persistently failing storage read stall the
revenue cranks indefinitely, a liveness loss the freeze itself never asked for.

Some roles are deliberately conservative. `record_snapshot` is submitted only when the active
welfare specification and a missing completed-epoch snapshot are directly visible. For every live
cohort, the extractor also follows its frozen `CohortSchedules` metric specification and catches up
missing `(cohort epoch + 1)` and `(cohort epoch + 2)` snapshots, including across later spec
activations. Daily gate planning reads the pallet-internal `Welfare.SampledGateDays` marker and
fills unsampled days across the bounded welfare lookback. The marker is separate from the frozen
`GateBreachFlags` surface, whose bitmap continues to identify breach days only. Older runtimes
without `SampledGateDays` retain honest degradation: the subtask emits its one `not yet plannable`
startup line and plans nothing. The keeper reads `Welfare.MaxGateFlags` and
`Welfare.MaxDailyGateSamples` from live metadata, with compatibility fallbacks of 20 epochs and 64
day indices matching welfare-core. Internal-only pruning, upgrade-proof recomputation, and other
calls whose arguments cannot be proved from storage are likewise never guessed. Zero-filing
registry epochs are deliberately unclosable on-chain under the
A6 dual-review ruling: `close_epoch` requires a live `FilingCount` entry — or, once the epoch's
first version has closed and dropped that epoch-wide counter, some version's aggregate —
preventing a reaped/never-filed epoch from being (re-)closed to the favorable
`no filings => 1` aggregate. Welfare instead applies its pull-side `no record => 1` default, so
the keeper never plans these epochs.

Per [`07-oracle-and-disputes.md` §7](../docs/architecture/07-oracle-and-disputes.md), the registry
lifecycle is keyed by `(epoch, spec_version)`: a MetricSpec activation boundary leaves two cohorts
measuring one epoch under different frozen specs, and their filings must never be folded into one
aggregate. The registry snapshot therefore buckets records per version — filings by the
`spec_version` of their own record, `Aggregates` and `ClosedAt` by their second storage key — and
plans `close_epoch(epoch, spec_version)` and `reap_epoch(epoch, spec_version)` once per version.
`crank_close(epoch, batch)` and the `FilingCount` id allocator stay epoch-keyed on chain, so the
planner still emits one `crank_close` per epoch covering both versions' due filings. A record
whose version cannot be resolved from storage is dropped rather than defaulted: cranking the wrong
version would act on a sibling cohort's record.

## Concurrent operation and economics

Production assumes at least two independent funded operator instances plus permissionless public
keepers. Use different signer accounts, RPC providers, process supervisors, and failure domains.
A small `startup_jitter_secs` reduces synchronized startup bursts; cooldown reduces repeat traffic,
but neither creates coordination or a leader. Do not alert on ordinary race-loss debug logs.

Per [`08-treasury-and-economics.md` §6](../docs/architecture/08-treasury-and-economics.md), the
on-chain keeper meter is 12,000 USDC per epoch. At least 80% is reserved for decision-critical
cranks and at most 20% is available for general work. At exhaustion, rebates stop but
permissionless/idempotent cranking does not.
Continuing through exhaustion is part of the funded operator commitment, backed by the
`ops.keepers` line—not a reason to stop the daemon.

## Metrics and alerts

When `metrics_bind` is set, Prometheus text is served at `/metrics` (and `/`). The endpoint exports:

- `bleavit_keeper_planned_total{role=...}`
- `bleavit_keeper_submitted_total{role=...}`
- `bleavit_keeper_succeeded_total{role=...}`
- `bleavit_keeper_failed_total{role=...}`
- `bleavit_keeper_last_successful_crank_timestamp_seconds{role=...}`
- `bleavit_keeper_stale_decision_window_books{role=...}`
- `bleavit_keeper_connected`
- `bleavit_keeper_current_block`
- `bleavit_process_start_time_seconds` (Zombienet-compatible process liveness)

These daemon rows pair with the chain-side monitoring rows in
[`12-release-and-operations.md` §6.3](../docs/architecture/12-release-and-operations.md): epoch
progress/tick lag, TWAP coverage and staleness, keeper activity, and meter utilization. A basic
RB-KEEPER inactivity expression is:

```promql
(time() - bleavit_keeper_last_successful_crank_timestamp_seconds{role="observe"}) > 3600
and on() bleavit_keeper_connected == 1
```

Instantiate that expression per required role in production so activity in a cleanup role cannot
mask an hour without a decision-critical crank — 12 §6.3 ("Keeper inactivity") makes the per-role,
daemon-side reading normative. A role that has never succeeded since process start keeps a zero
timestamp and is indistinguishable from a disabled role, so the shipped rule excludes it
(`... > 0 and bleavit_keeper_planned_total > 0`) rather than paging on it; that stuck-since-start-up
case is the declared blind spot and the keeper's own liveness series must cover it. Also wire the on-chain
`KeeperBudgetLow` (>80%) and `KeeperBudgetExhausted` events to RB-KEEPER, and alert on
finalized-head lag independently of the keeper process's `connected` gauge.

## Keeper-local quality gates

Run these only from this directory; this is a separate Cargo workspace with its own lock file:

```sh
cd keeper
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```
