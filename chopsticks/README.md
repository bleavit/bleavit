<!-- B7 release artifact: 15 §1/§4.7/§5; 02 §11; 06 §6.2; 09 §3.2/§4. -->
# Bleavit Chopsticks environments

These fork-from-generated-genesis configs and manufactured-state cards are the
published Chopsticks environment required by [15 §4.7](../docs/architecture/15-invariants-and-testing.md)
and [02 §11](../docs/architecture/02-integration-contract.md). They contain no
mutable/private upstream endpoint: every scenario starts from the raw chain
spec generated into `zombienet/specs/out/`.

This is the explicit pre-launch form of 02 §11's “fixture state snapshots”:
fork the generated genesis of the release runtime, then apply the checked-in
fixture injections. A live chain does not exist yet. Live-endpoint fork sources
land at Phase ≥ 2 with B8's content-addressed publication pipeline.

## Run

From the repository root, generate specs, source the only pin home, and select
either the base or a scenario:

```bash
tools/env/generate-relay-specs.sh
source tools/env/pins.env
npx "@acala-network/chopsticks@${CHOPSTICKS_VERSION}" --config chopsticks/bleavit.yml
npx "@acala-network/chopsticks@${CHOPSTICKS_VERSION}" --config chopsticks/scenarios/void-epoch.yml
```

Chopsticks at the pinned release requires Node.js **22 or newer**.

Each scenario duplicates the local-only base keys because Chopsticks has no
cross-file include directive, then layers `import-storage` over the same raw
genesis. Raw keys are documented adjacent to their values and are derived from
the real runtime/pallet prefixes (`twox128(module) ++ twox128(item)`, plus the
declared map hashers). Runtime-only PhaseFlags bits 5–7 are injected only in
manufactured drill state under 02 §11's “manufactured precondition failures”
artifact row. Section 02 §7.3 only assigns the bits; 06 §3.3 forbids exposing
their writers as dispatchable calls.

## Scenario map and runnability

| Scenario | Spec | Runnable now | Gated assertions |
|---|---|---|---|
| `upgrade-transition` | 15 §4.7; 02 §11; 09 §2.1 | Paired pending/checkpoint/history image is try-state coherent | authorize→apply, migration, descriptor transition: B6 + A11 runtime slot 62 |
| `stale-queue` | 15 §4.7; 02 §11; 09 §1.2(3) | Genuine bleavit/2-vs-bleavit/1 mismatch, future grace, false expedited marker | `reject_stale`: A11 slot 62 plus A8/B6 queued proposal |
| `void-epoch` | 15 I-26/I-27/§4.7 | Voided vault and real redeem inputs on the current ledger | frontend rendering waits Track F |
| `precondition-failures` | 15 §4.7; 02 §11; 09 §1.2 | Constitution flag injection | complete guard refusal matrix: A11 wiring + B6 driver |
| `pb-depeg` | 06 §6.2 | Accountable Guardian post-entry image; block expiry maintenance runs | downstream `market.freeze_creation`/effect-revert surface |
| `pb-migration` | 06 §6.2; 09 §3.2 | Accountable Guardian image + coherent paired guard checkpoint | B6 migration controls and A11 slot 62; checkpoint question remains logged |
| `pb-oracle-void` | 06 §6.2 | Accountable Guardian post-entry image; block expiry maintenance runs | A8 cohort/ResolveAuthority wiring and downstream effect |
| `pb-halt-intake` | 06 §6.2 | Accountable Guardian image + manufactured machinery bit | A8 wiring and missing intake-pause/effect-revert surface |
| `pb-reserve` | 06 §6.2 | Accountable Guardian image + manufactured reserve bit | missing split-pause/effect-revert call and trigger adapter |
| `pb-ledger-freeze` | 06 §6.2/§6.3; 09 §3.1/§4 | Accountable Guardian/phase image; block expiry maintenance runs | I-4 trigger adapter, missing freeze/effect-revert calls, renewal XCM dispatcher |

The adjacent Markdown card is the normative execution/assertion sequence for
each YAML. NOTE(B7): `Epoch`/`ExecutionGuard` exist as production pallets but
are not instantiated in the current runtime; several 06 §6.2 call names also
have no implemented extrinsic/storage surface. Gated cards remain complete
release definitions and intentionally fail rather than silently weakening an
assertion.

The Guardian pallet is instantiated, and every `pb-*` image injects its real
seven-member council, arithmetic bond ledger, activation review, active expiry,
allowance struct, and cursors. The pallet has no per-playbook allowance field,
registered-playbook/active-hold storage, or downstream effect-revert storage;
cards call those gaps out instead of inventing cells. Review scheduling is a
runtime stub and guardian `CurrentEpoch` stays zero until A8 wiring, while
block-number expiry now runs because `Guardian::load()` can succeed.

## Mandatory closing try-state

For every scenario, after repairing any deliberately manufactured invalid
precondition, run the release-blocking 15 §1 check against the local endpoint:

```bash
try-runtime \
  --runtime target/release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm \
  on-runtime-upgrade --checks try-state --blocktime 6000 \
  live --uri ws://127.0.0.1:8000
```

Use the scenario's configured port instead of `8000`. Upgrade scenarios point
`--runtime` at the candidate Wasm; all others use the release Wasm built with
the `try-runtime` feature. Any failure blocks release.
