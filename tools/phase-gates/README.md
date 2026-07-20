# Phase-0 exit gate

This directory machine-checks and publishes the Phase-0 exit evidence required by
[09 §7.1](../../docs/architecture/09-execution-upgrades-and-rollout.md):
"reference model ≡ pallets on shared vectors; sim false-pass < 1%; δ/POL
calibration published." Advancement still requires published evidence, a META
decision, and values ratification.

Run the real gate with a pre-generated full sweep:

```sh
python3 tools/reference-model/generate-vectors.py --sweep-out release-work/sweep
python3 tools/phase-gates/check-phase0-exit.py \
  --sweep-dir release-work/sweep \
  --sim-evidence release-work/sim-calibration.json \
  --report-out release-work/phase0-evidence.json
```

If `--sweep-dir` is omitted, the checker generates the full ≥10⁷-point corpus
in a temporary directory before testing it. That path is deterministic but
hours-long. For a fast, deliberately non-qualifying check:

```sh
python3 tools/phase-gates/check-phase0-exit.py \
  --reduced \
  --report-out /tmp/phase0-evidence.json
```

Reduced mode records both full-sweep legs as `skipped`, caps reference equivalence
at a non-qualifying status, sets `phase0_exit` to false, and exits 1. Should a
corpus family ever lose its Rust consumer binding, `pass-partial` takes precedence
over `pass-reduced`; with every family bound (the current state), a reduced run
reports `pass-reduced`. All other incomplete, pending-S4, or failed criteria also
exit 1; setup/tool failures exit 2.

The evidence-producing path refuses any tracked or untracked tree change before
the legs run and re-checks after they finish. Only the resolved report, supplied
simulation-evidence, and supplied sweep paths (and descendants) are exempt. For
an in-repository `--sweep-dir`, the checker also requires that the directory
contain no tracked paths; a sweep directory equal to or containing the repository
root is rejected. This prevents an artifact exemption from covering the source
bytes being tested. For local diagnosis on a dirty worktree, `--allow-dirty` is
accepted only together with `--reduced`; that combination is structurally unable
to set `phase0_exit` to true and records `tree_clean: false` when the tree is dirty:

```sh
python3 tools/phase-gates/check-phase0-exit.py \
  --reduced --allow-dirty \
  --report-out /tmp/phase0-evidence.json
```

The exact Rust differential commands recorded by the checker are:

```sh
cargo test -p futarchy-fixed --release --locked --lib reference_model_vectors
cargo test -p conditional-ledger-core --release --locked --test differential_vectors
cargo test -p epoch-core --release --locked --test decision_vectors
cargo test -p welfare-core --release --locked --test welfare_vectors
cargo test -p futarchy-treasury-core --release --locked --test treasury_vectors
cargo test -p market-core --release --locked --test twap_vectors
cargo test -p pallet-conditional-ledger --release --locked differential_matches_frame_free_core
cargo test -p pallet-conditional-ledger --release --locked generated_sweep_vectors_match_real_pallet_housekeeping
BLEAVIT_SWEEP_DIR=<dir> BLEAVIT_SWEEP_REQUIRE_FULL=1 cargo test -p futarchy-fixed --release --locked --test sweep -- --ignored --nocapture
```

Test-command success is not enough: the checker captures output and requires
positive executed-test floors (Python reference model 26; fixed vectors 4; ledger
core vectors 4; decision/welfare/treasury vectors 1 each; market TWAP+contest
vectors 2; each pallet differential 1; full sweep 1). Every test leg records
`tests_executed`; missing output, a zero-test success, or a floor regression fails
the leg.

The vector corpus family mapping is exhaustive, and every actual family is
Rust-attested (G0 criterion A, SQ-244): `lmsr_vectors`, `lmsr_maker_example`,
`high_precision_corpus`, and `transcendental_corpus` bind to the futarchy-fixed
leg; `ledger_scenarios`, `ledger_error_scenarios`, `ledger_score_scenarios`, and
`ledger_sequence_scenarios` to the ledger-core leg; `ledger_sweep_scenarios` to
the pallet sweep; `decision_scenarios` to the epoch-core decision replay;
`welfare_scenarios` to the welfare-core grid-exact replay; `treasury_scenarios`
to the treasury-core replay; and `twap_scenarios` plus `contest_scenarios` to the
market-core accumulator replays. A family losing its consumer caps criterion A at
`pass-partial` again; an unknown or renamed family is a loud drift error. Two
decision rows and both settlement-score welfare rows currently pin documented
spec-vs-implementation divergences inside their suites (see the KNOWN DIVERGENCE
comments in `crates/epoch-core/tests/decision_vectors.rs` and
`crates/welfare-core/tests/welfare_vectors.rs`); the pins are exact and
self-destruct on any behavioral change.

S4 owns production of `bleavit.sim-calibration.v1`. G0 only freezes and validates
that consumer schema; its `git_commit` must equal the repository HEAD checked by
G0. An omitted `--sim-evidence` is `pending-s4`; an explicitly supplied missing or
unreadable path is `fail`. This checker publishes
`bleavit.phase0-evidence.v1`, including the repository HEAD, every reference leg,
the corpus-family coverage, clean-tree result, three criterion statuses, overall
exit decision, and SHA-256 of a present simulation artifact. Doc-13 table-header,
tag, key-list, or corpus-family mapping drift is an operator/setup error (exit 2),
not ordinary unpublished evidence.
