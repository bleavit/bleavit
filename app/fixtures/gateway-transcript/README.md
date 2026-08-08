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
| `honest.json` | Two gateways, both serving the signed tree correctly |
| `tampered-gateway.json` | The same, except `beta` serves an altered `assets/app.js` |
| `release.json` | The release document both transcripts serve, kept beside them for readability |
| `registry.json` | A 12 §2.2 registry with **fictional** holders, for these tests only |
| `keyring.json` | The matching public keys, key id to minisign packet |

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
