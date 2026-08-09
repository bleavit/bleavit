---
paths: ["explainer/**"]
---

# Explainer rules (the teaching site, not the client)

`explainer/` is an interactive explanation of the whole runtime: fourteen scenes in
three acts, each an animated model of one machine. Read `explainer/README.md` before
changing anything here — it carries the design decisions, the measured budgets and the
reasoning behind the 3D boundary, and this file carries only what binds.

**It is not the canonical client.** That is `app/` (10 §10.1, Track F). The explainer
reads no chain, embeds no light client and ships no signing affordance, so INV-FE-1…15
do not bind it. Nothing here may be cited as evidence for a Track F milestone, and no
Track F budget applies to it. The confusion runs the other way too: do not "fix" this
app by making it look more like the client.

1. **No number reaches the screen untagged.** `src/provenance/` types every value as
   `spec()`, `derived()` or `simulated()`, and provenance never strengthens — anything
   computed over a simulated input stays simulated. A bare number in JSX is a defect
   even when it is correct, because the page's whole claim is that a reader can tell
   which numbers are real.

2. **`src/protocol/` is a third independent port of the spec arithmetic**, beside the
   Rust pallets and the Python reference model. It certifies against
   `reference-model/fixtures/vectors.json` — the same corpus the Rust differential
   suites replay — plus `crates/market-core/fixtures/chain-quote-agreement.json`, which
   records what this runtime's quote surface *answers*, including its refusals. A list
   of numbers cannot record a refusal, which is why the second artifact exists.

3. **Fixtures are derived, never hand-authored.** `npm run fixtures` copies trimmed
   versions in so the suites never read outside `explainer/`. `npm run verify` runs
   `npm run fixtures -- --check`, which re-derives and compares byte-for-byte. When it
   fails, read the diff before regenerating: a moved source is a protocol change.

4. **Mirrored constants are the recurring defect class.** `src/protocol/constants.ts`
   and `params.ts` restate kernel constants and doc 13 §1 rows. They go stale on their
   own schedule, silently, and every suite stays green while they do — the integration
   contract version was three bumps behind and nothing failed. When touching either
   file, re-derive against the owning source rather than editing the number you can see.

5. **Derive, do not transcribe.** Where a scene can compute a published figure from the
   runtime's own components, it must. That is not neatness: recomputation is what caught
   doc 13 §5 dividing a proof size by the block-*length* ceiling and publishing every
   share at twice its true value (corrected 2026-08-09). A transcribed number agrees with
   its source forever, including when its source is wrong.

6. **Terms are defined once, in `src/ui/glossary.ts`.** Use `<Jargon word="collator" />`
   at first use in a scene. The lower-level `<Term>` is only for a definition genuinely
   local to one scene. `glossary()` throws on an unknown word on purpose — a silent
   fallback ships a term that looks defined and explains nothing.

7. **Four boundaries are ESLint rules, not conventions.** `protocol/` and `sim/` may not
   import React or three. `ui/` may not import three. Nothing under `scenes/` outside
   `scenes/r3f/` may import three — that one guards the lazy edge, and a `type` keyword
   lost in a refactor would otherwise land the renderer on every first paint.
   `Math.random`, `Date.now()` and `new Date()` are banned outright, because the
   simulation must replay identically.

8. **Its dependencies are audited like the client's.** `explainer/package-lock.json` is
   classified in `tools/ci/audited-workspaces.toml`, so the release-blocking **Supply
   chain** job scans it every commit. An advisory here turns the repository's CI red;
   update the package. A waiver declaring `reaches_bundle = "yes"` is refused, and a
   browser executes this bundle. Keep it a standalone npm project — outside `app/`'s
   pnpm workspace — so a dependency added for an animation can never enter the tree the
   canonical client resolves from.

## Gates

`npm run verify` from `explainer/` is the whole gate, and it is local: this project adds
no job to `ci.yml`. It chains the fixture check, the generated-math check, ESLint, `tsc
--noEmit`, the Vitest suites and a production `vite build`. Run it before handing work
back, and never report a subset as the gate.

Two checks are deliberately outside it. The no-text-overlap sweep is an instrumented
browser harness rather than a unit test, so re-run it by hand after adding or reflowing a
scene. The measured bundle budgets in `explainer/README.md` come from reading a real
`npm run build`, so update that table when the shell moves rather than leaving a figure
that was true once.
