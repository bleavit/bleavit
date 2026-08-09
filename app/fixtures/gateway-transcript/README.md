# Gateway transcript fixture — 12 §1.3 (F13)

`tests/release/compare.test.ts` replays these files in place. They let `verify-release compare`
run its whole decision path with no network: the fetch loop, the byte comparison, the
cross-gateway divergence check, the minisign verification, the signature and attestation
counting, and the verdict.

## This transcript is constructed, not recorded

Every other transcript corpus here was recorded from a running system. `fixtures/chainhead/`
came from a booted node. This one cannot come from anywhere equivalent, and saying so is part
of the fixture.

[12 §1.2](../../../docs/architecture/12-release-and-operations.md) carries an unresolved
`[VERIFY]` against live gateway behaviour, which is prototype gate **FE-P7**.
[12 §4.2](../../../docs/architecture/12-release-and-operations.md) records that the naming
platform moved from AO to Solana, and that FE-P7's remaining halves must be re-asked against
the new platform rather than carried over. Recording a live session and committing it would
assert an answer to that open tag, and rule R-2 forbids resolving a `[VERIFY]` by assumption.

So the fixture asserts nothing about what an ar.io gateway answers. Its URLs come from the
gateway templates the transcript itself declares, and its bodies are bytes the generator
defines. `compare.ts` never contains a URL shape for the same reason: the templates are
operator configuration, exactly as `tools/monitoring/attestation_monitor.py` already takes them.

## The files

| File | What it is |
|---|---|
| `honest.json` | Two gateways, both serving the signed tree correctly, under both 12 §1.2 manifests |
| `tampered-gateway.json` | The same, except `beta` serves an altered `assets/app.js` |
| `refused-status.json` | The same, except `beta` answers 404 with the **correct** bytes |
| `release.json` | The release document those transcripts serve, kept beside them for readability |
| `registry.json` | A 12 §2.2 registry with **fictional** holders, for these tests only |
| `keyring.json` | The matching public keys, key id to minisign packet, tagged generation 4 |

### The CLI family

`tests/release/verify-release-cli.test.ts` drives `verify-release compare` as the command,
rather than through a helper that reproduces what the command does. The transcripts above
serve a **hand-written** release document, and four defects lived behind them for exactly that
reason: the counting only ever ran against a document shape this repository does not produce.

| File | What it is |
|---|---|
| `cli-release.json` | The document `tools/release/release-json.ts` really builds, patched as 12 §1.2's second pass patches it. It names **no** signature or attestation transactions, because it cannot: 12 §2.1 signs its own bytes, so an id written back into it invalidates every signature over it |
| `cli-honest.json` | Two gateways serving that document, its tree, **both** 12 §1.2 path manifests, and the four credential transactions 12 §1.4 gate 4 publishes in the release notes |
| `cli-extra-payload.json` | The same, except `beta` lists and serves one extra file nobody signed. Nothing pinned is missing or altered, which is why a fetch loop driven by the signed map reports it clean |
| `cli-final-poisoned.json` | The same, except the **repointed** manifest `M′` serves application code nobody signed. `M` — the address `release.json` pins — is impeccable |
| `cli-final-substituted.json` | The same, except `M′` resolves `release.json` to a sibling nobody signed. Its bytes are the signed document's, so only the address differs |
| `cli-final-omits-release-json.json` | The same, except `M′` contains no `release.json` at all — the release naming a manifest that does not contain it |
| `cli-local-tree/` | The `--local dist/` side of §1.3's command: the tree a third party built |

### The two manifest addresses

12 §1.2 produces two, and says the verification CLI checks both. Every transcript here serves
all three of them:

- **`M`** (`MMM…`) — the asset-tree manifest `release.json` pins. What the release *authorized*.
- **`M′`** (`FFF…`) — the manifest the ArNS name is repointed to, which is `M` plus the
  `release.json` sibling. What a browser *loads*.
- An **impostor** (`NNN…`) serving the release's own bytes at the release's own paths. Not a
  tampered tree — every file under it verifies — and the only way to ask whether `compare`
  binds the manifest it was pointed at to the one `release.json` pins.

The three `cli-final-*` transcripts exist because that pair can disagree: each serves the
signed bytes at every path of `M`, so a verifier that stops at the pinned address prints
`MATCH` for a release whose users are being handed something else.

The path manifests carry `manifest`, `version`, `index` and `paths` because a real one does.
The `paths` **keys** are read by `fetchManifestPaths` here and by
`tools/monitoring/attestation_monitor.py`, which has consumed the same key since O5. One
per-path `id` is read and only one: `M′`'s entry for `release.json`, which must be the
transaction the signatures were verified over. The rest are placeholders nothing resolves, and
`M` and `M′` deliberately carry **different** ones for the shared paths — whether an uploader
mints new data items when the second pass re-uploads identical bytes is inside FE-P7's open
`[VERIFY]`, so a fixture whose two manifests agreed on ids would invite a checker to compare
them and pass, which is an assumption about the uploader wearing a green test.

Nothing here is a key, a person or an organization of this project. The real registry is
[`app/tools/release/sources/signers.json`](../../tools/release/sources/signers.json) and it is
deliberately empty until a ceremony is held. The human mirror is
[`SIGNERS.md`](../../../SIGNERS.md).

## Regenerating

```
node tools/verify-release/make-transcript.ts
```

The keys come from fixed seeds, so the output is byte-stable. The suite does not trust the
generator: it re-verifies every signature and re-hashes every body, so a fixture that stopped
describing itself fails rather than passing quietly.
