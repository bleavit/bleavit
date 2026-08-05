# `app/tools/release` — the client release pipeline (F11)

Owning spec: [12 §1](../../../docs/architecture/12-release-and-operations.md) (release
train), [12 §5](../../../docs/architecture/12-release-and-operations.md) (bundle-level
security controls), [10 §5.4](../../../docs/architecture/10-frontend-architecture.md)
(contract binding), [15 §4.8](../../../docs/architecture/15-invariants-and-testing.md)
(the gates).

This directory sits under `app/` deliberately: the repository root already has a
`tools/release/` for **chain**-release tooling, and 10 §10.1 keeps the two apart.

```bash
pnpm -C app run release:build              # build dist/ and run every gate over it
pnpm -C app run release:check              # re-run the gates over an existing tree
node tools/release/build.mjs --check --production   # additionally refuse while blockers stand
```

## The order is the design

1. `vite build` → the asset tree, content-hash-only filenames (12 §1.1).
2. `esbuild` → `dist/sw.js`, IIFE and unminified.
3. **determinism check** — before anything is hashed, so a leaked build path is reported as
   itself rather than as a mismatch two environments later.
4. **`connect-src` allowlist** → substituted into `index.html`.
5. **SRI** → injected into `index.html`.
6. **the per-file SHA-256 map** → substituted into `sw.js`.
7. **`sbom.cdx.json`, then `release.json`** → `app/release-out/`.

4 and 5 precede 6 because the worker's map pins `index.html`, so the file must be final
before it is hashed. 7 is last because `release.json` pins the worker, which 6 rewrote. Get
either backwards and the release ships a map that refuses its own files — fail-closed, but
at the user, which is the wrong place.

## What is committed, and what is derived

| Committed (`sources/`) | Derived |
|---|---|
| `release-sources.json` — where each allowlist class comes from, the INV-FE-11 chain-identity pins, the signing keyring | the emitted `connect-src`, `release.json`, `sbom.cdx.json`, the worker's asset map, every SRI digest |
| `incumbent-connect-src.json` — the 15 §4.8 diff baseline | |
| `chain-literal-classification.json` — the 10 §5.4 gate's classified groups | |

Nothing in the emitted policy is authored. An allowlist somebody can *write* is an allowlist
somebody can add a host to, and 12 §5.1 names the failure: "a vendor host is exactly the
kind of entry that arrives one release at a time".

## Readiness blockers, not silence

Several pins cannot exist before genesis — no production genesis hash, no seated bootnode
operator, no chosen gateway set, no release keyring. Rather than blocking the build or
emitting `null` and hoping, `release.json` carries a **`readiness` block naming every
unresolved blocker**, and `--production` exits non-zero while any remain. This is the same
shape the chain-side `tools/release/` uses, and it keeps the pipeline exercised on every
commit — a release pipeline that only runs at a tag is one first debugged during a release.

## What is deliberately not here

- **The live Arweave upload.** `arweave.mjs` is a pure driver over an injected uploader; the
  Turbo-SDK/permaweb-deploy adapter lands with prototype gate **FE-P7**, whose `[VERIFY]`
  tag covers the exact two-pass flow against live gateway behaviour (12 §1.2). R-2 forbids
  resolving a `[VERIFY]` by assumption, so what is fixed here is the flow's arithmetic —
  which TXID goes where, which file may not be in which pass, and why `M′ ≠ M`.
- **Signing, attestation and the two-environment byte-identical proof.** F13 (12 §1.3,
  §2, INV-FE-10).
- **The `verify-release` CLI.** F13; `packages/verify` already holds the comparison it runs.
