# `app/fixtures/chainhead/` — the recorded chainHead transcripts

[02 §11](../../../docs/architecture/02-integration-contract.md)'s fourth published
artifact, consumed by the *mock-runtime PR suites*. One JSON file per frozen critical
surface entry, plus `fixtures-report.json`, all recorded at a single pinned block from a
booted release node by `tools/release/record-chainhead-fixtures.py`.

`app/tests/mock-runtime/` replays them; `packages/mock-runtime` is the replay engine.
Together they let every PR exercise the whole 02 §9 surface with no node, no network and
no timers.

## What each file carries

| Key | What it is |
|---|---|
| `chainHead_v1_*` | The real request/response exchange, including the follow-up operation events |
| `state_getStorage` | The same read over the legacy RPC, present only so the no-websockets degradation path ([10 §11](../../../docs/architecture/10-frontend-architecture.md)) has something to exercise — **not** the API the client binds to |
| `metadata_presence` | Whether the surface is in the metadata and whether its layout equals the one `tools/release/surface-manifest.json` freezes |
| `recovery_metadata_presence` | The same, against the **paired terminal-recovery** runtime (10 §5.1) |

## `strict_ready` is the property that matters

`fixtures-report.json` is only `strict_ready` when every *required* surface entry was
recorded on **both** sides of the pair. The suite asserts it, so a recording taken while
something was missing cannot quietly become the committed corpus.

Recording with no recovery runtime built used to report *"0 required surface items
missing"* while failing on 220 — the message counted only the primary. That reads as a
tool bug and invites `--allow-missing`, which is the one wrong response. Both sides are
now counted and named.

## Determinism

`tools/release/transcript.py` normalizes everything the server or the session chose:
subscription ids, operation ids, timestamps, and — since F2 — the **JSON-RPC envelope
`id`**. That last one is a client-side request counter running across the whole recording
session, so the same call recorded while gathering two different surfaces carried two
different ids. Left raw it made the artifact bytes depend on the order surfaces were
recorded in, and made 39 recordings of one block header disagree with each other. Only
the envelope's `id` is renumbered — chain data legitimately contains `id` fields, so the
rewrite keys on the sibling `jsonrpc`, never on the name.

## Regenerating

Needs the built node and both runtime profiles — see `../chain-feed/README.md`, then:

```sh
python3 tools/release/record-chainhead-fixtures.py \
  --node "${CARGO_TARGET_DIR:-target}/release/bleavit-node" \
  --metadata release-work/runtime/metadata.scale \
  --recovery-metadata release-work/runtime/recovery/metadata.scale \
  --out-dir release-work/chainhead
```

and copy the result here. It exits non-zero unless the recording is strictly ready.
