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
node tools/release/build.ts --check --production   # additionally refuse while blockers stand
pnpm -C app run release:manifest -- --environment <id>   # publish this environment's digests
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

## The two-environment proof (12 §1.1, INV-FE-10; F13)

12 §1.1 requires that **two independent CI environments produce an identical tree hash**.
Both builds already happened — `ci.yml`'s `app` job and its `desktop-shell` job — and
nothing compared them, because neither published anything a comparison could read.

`repro-manifest.ts` is what each one publishes: a per-file SHA-256 map over `dist/` **and**
the two `release-out/` files 12 §1.1 counts as output, a **tree digest** over that map, the
source commit, the build-recipe digest, and the environment's own facts.
`tools/ci/check-release-reproducibility.py` compares the two and names every differing path
with both digests — a reproducibility gate that reports only "not identical" leaves the
person who has to fix it with a whole tree to bisect.

Three things about it are not obvious:

- **The environment facts are recorded to be *different*.** A "two-environment" gate whose
  two environments are one environment proves that a build is repeatable on one machine,
  which is a weaker claim and looks identical in a green log. So the comparator requires at
  least one *substantive* axis to differ, and `desktop-shell` checks out into its own path —
  absolute build path depth is the axis 12 §1.1's own recorded measurement varied, and the
  one this pipeline is most exposed to, since pnpm's virtual store lives inside the project.
  The facts that differ between any two runners for uninteresting reasons (hostname, runner
  name) are held apart where they cannot satisfy that requirement.
- **The tree digest is `sha256(path \0 <file digest> \n …)` over sorted paths** — the framing
  `buildRecipeDigest` already uses, so there is one convention here rather than two. It is
  implemented twice, in TypeScript and in Python, and `app/fixtures/tree-digest-cases.json`
  is read in place by both suites so the two cannot drift.
- **What it does not prove.** Both jobs run the same runner image, the same Node pin and the
  same pnpm pin, so this is evidence about the *build*, not about *builders*. 12 §1.4 gate 2
  wants two attestations from different organizations, and CI is one organization holding no
  keys (§1.4). That half is the key ceremony's, not this gate's.

## What is committed, and what is derived

| Committed (`sources/`) | Derived |
|---|---|
| `release-sources.json` — where each allowlist class comes from, the INV-FE-11 chain-identity pins, the signing keyring | the emitted `connect-src`, `release.json`, `sbom.cdx.json`, the worker's asset map, every SRI digest |
| `incumbent-connect-src.json` — the 15 §4.8 diff baseline | |
| `chain-literal-classification.json` — the 10 §5.4 gate's classified groups | |

Nothing in the emitted policy is authored. An allowlist somebody can *write* is an allowlist
somebody can add a host to, and 12 §5.1 names the failure: "a vendor host is exactly the
kind of entry that arrives one release at a time".

**The two descriptor sets are read from their feeds, never declared here.** Bleavit's comes
from `app/fixtures/chain-feed/` and the Asset Hub set 12 §1.1 requires from
`app/fixtures/foreign-chain-feed/` — the same artifacts `.papi/polkadot-api.json` generates
descriptors from and `foreign:check` gates. Both are **re-hashed** rather than copied out of
the neighbouring `runtime-info.json`: INV-FE-11 makes these *pins*, and a pin taken from a
sibling record pins that record's opinion of a blob rather than the blob. The Asset Hub set
was a hand-declared field until F11 wired it, which is how it stayed empty while its
artifacts sat committed in the tree.

## Readiness blockers, not silence

Several pins cannot exist before genesis — no production genesis hash, no seated bootnode
operator, no chosen gateway set, no release keyring. Rather than blocking the build or
emitting `null` and hoping, `release.json` carries a **`readiness` block naming every
unresolved blocker**, and `--production` exits non-zero while any remain. This is the same
shape the chain-side `tools/release/` uses, and it keeps the pipeline exercised on every
commit — a release pipeline that only runs at a tag is one first debugged during a release.

**Every blocker expires mechanically, and its stated cause has to expire with it.** The
condition is always a property the build re-derives — an operator list that is no longer
empty, a pin that is now well-shaped, a feed that now carries a runtime — so no blocker
needs deleting by hand. The cause is the half that rotted: the Asset Hub descriptor blocker
read "blocked on SQ-587" for three days after that question was ruled *and* after every
artifact it waited on had landed, because neither side can see the other — the pipeline
cannot know a question closed, and PLAN.md cannot know who cites it.
`tools/ci/check-release-blocker-citations.py` binds the two: every `SQ-nnn` appearing
anywhere under this directory must be a PLAN.md spec-question row that is still **open**.
The breadth is deliberate — the stale claim sat in a doc comment as well as in the emitted
string — and the cost is that this directory may not carry a closed question as history.
Record a ruling in PLAN.md's decision log, which is what reads it back.

## What is deliberately not here

- **The live Arweave upload.** `arweave.mjs` is a pure driver over an injected uploader; the
  Turbo-SDK/permaweb-deploy adapter lands with prototype gate **FE-P7**, whose `[VERIFY]`
  tag covers the exact two-pass flow against live gateway behaviour (12 §1.2). R-2 forbids
  resolving a `[VERIFY]` by assumption, so what is fixed here is the flow's arithmetic —
  which TXID goes where, which file may not be in which pass, and why `M′ ≠ M`.
- **Signing and attestation.** F13 (12 §1.3, §2). Both need the key ceremony: CI holds no
  minisign keys and no ANT controller shares by design (§1.4), so nothing here can sign, and
  §1.4 gate 2's two attestations are two *organizations* rebuilding the tree — which is what
  the two-environment gate above is evidence for and not a substitute for.
- **The `verify-release compare` subcommand.** F13; it needs a published keyring and FE-P7's
  gateway behaviour, and `packages/verify` already holds the comparison it will run. Its
  `signers audit` and `diff-scope` halves are live.
