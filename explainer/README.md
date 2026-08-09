# Bleavit Explainer

An educational web application that explains the Bleavit futarchy protocol: labelled flat
diagrams beside dense conventional UI, five purpose-built animated 3D views, and a
deterministic client-side simulation underneath all of it.

> **This is not the canonical Bleavit client.**
>
> The canonical decentralized frontend is Track F, specified in
> [docs/architecture/10-frontend-architecture.md](../docs/architecture/10-frontend-architecture.md)
> and [docs/architecture/11-frontend-workflows.md](../docs/architecture/11-frontend-workflows.md).
> It must read exclusively from an embedded smoldot light client over finalized,
> proof-verified state, ship no telemetry, and build reproducibly for Arweave
> distribution under a hard initial-JS budget. Its home is `app/`, which this
> project deliberately leaves untouched.
>
> This explainer reads no chain at all. Every value it shows is a specification
> constant, something its protocol core computed, or a number invented to make a
> mechanism concrete — and each is labelled as such, on screen, by type.

## What it covers

**Fourteen scenes in three acts**, and six interactive scenarios: normal execution, gate
failure, oracle dispute, registry dispute, delayed resolution and blocked execution.

| Act | Scenes | What it answers |
| --- | --- | --- |
| The chain itself | The chain · The upgrade | What Bleavit is before it is a futarchy: a Polkadot parachain that can replace its own code |
| A proposal's life | The clock · The journey · The markets · The escrow · The decision · The score · The disputes · The guard | One decision, from filing to execution — or to refusal |
| The edges | The border · The service · The referees · The window | Where the chain meets money, other chains, the people it trusts, and the programs that read it |

The middle act is the original app. The two outer acts were added because the first version
explained the *mechanism* thoroughly and the *machine* not at all: it never said what a
parachain is, who produces blocks, what limits a block, how dollars reach the chain, who is
allowed to act, or what an outside program may read. A reader could follow a proposal end to
end and still not know what they were looking at.

The three acts are a route rather than a menu. Somebody who only wants the futarchy can start
at *A proposal's life* and never open the substrate; somebody integrating against the chain
can go straight to *The edges*.

None of the six scenario names is a specification term. Each one names, in the app, the real
mechanism it exercises.

## Vocabulary

Terms are defined where the reader meets them, not on a separate page. `src/ui/glossary.ts`
holds every definition exactly once and `<Jargon word="collator" />` renders it inline, so a
word cannot come to mean two things in two scenes — the "one thing, one name" rule applied to
the reader's vocabulary rather than to the protocol's. `glossary.test.ts` enforces the
properties that matter: one entry per word, at most two sentences, no circular definitions,
and a loud throw on an unknown word rather than a silently empty tooltip.

## How the accuracy claim is made testable

`src/protocol/` is a third independent implementation of the specification's arithmetic,
alongside the Rust pallets and the Python reference model. It is certified against
[reference-model/fixtures/vectors.json](../reference-model/fixtures/vectors.json) — the same
corpus the Rust differential suites replay.

[.claude/rules/reference-model.md](../.claude/rules/reference-model.md) names this pattern
directly: *"The backend differential suites and the frontend TypeScript port both certify
against this one artifact."*

`npm run fixtures` derives a trimmed, checked-in copy so tests never reach outside this
directory — and `npm run verify` runs `npm run fixtures -- --check`, which re-derives in
memory and compares byte-for-byte. Without that leg the certification claim decays silently:
regenerate the corpus, add a genesis key, re-record the quote fixture, and every suite here
keeps replaying yesterday's copy and keeps passing. The check names the source that moved,
never the copy that did not, and it never writes.

Tolerance policy, stated in each test file:

| Family | Tolerance |
| --- | --- |
| Ledger payouts (integer µUSDC) | exact equality |
| Values computed on the floored 1e9 grid | absolute 2e-9 |
| Transcendental LMSR results | relative 1e-12 |

**A second artifact certifies something the corpus structurally cannot.**
[crates/market-core/fixtures/chain-quote-agreement.json](../crates/market-core/fixtures/chain-quote-agreement.json)
records what *this runtime's* quote surface answers for eight books on all four sides, and
`src/protocol/chain-quotes.test.ts` replays all 32 rows. The corpus states the arithmetic; a
list of numbers cannot record a **refusal**, so a port can agree with every vector and still
show a reader a price the chain would never quote. That is exactly what had happened: `buy()`
priced an out-of-domain post-state and reported it as a real quote, while the chain maps the
domain error to `PriceBoundExceeded` and returns a zero sentinel. One row out of thirty-two
was the whole finding.

## Measured budgets

From `npm run build`, gzipped:

| Payload | Size | When it loads |
| --- | --- | --- |
| App shell (JS) | 248 kB | always |
| Styles (incl. trimmed KaTeX) | 16 kB | always |
| Fonts (Archivo Variable + Plex Mono, latin) | 105 kB | always |
| Maths faces (KaTeX woff2) | ≤ 26 kB each | only the faces a formula uses |
| three + fiber + drei + the five motions | 249 kB | **only when a motion is opened** |

The renderer sits behind the lazy `import()` in `SceneFrame`, so a visitor who
never opens an animated view — on a phone, under reduced motion, or without WebGL —
never downloads it. That is verified, not assumed: an earlier `manualChunks` config
looked like it isolated three.js while actually flattening the dynamic edge, and
Vite then emitted a `modulepreload` that pulled the whole renderer onto the
critical path. Removing the manual chunk fixed it. Check `dist/index.html` after
a build: it should preload the app chunk and the stylesheet, and nothing else.

The shell grew from 182 kB to 248 kB when the app went from eight scenes to
fourteen, and that is the honest cost of the two new acts rather than a
regression to chase. This app is deliberately **not** under the canonical
client's 350 kB initial-JS budget — that budget belongs to `app/`, which reads a
chain over a light client and must load on a phone in the field. What matters
here is the lazy edge, which is unchanged: the renderer is still a separate
248.83 kB chunk that a reader who never opens a motion never downloads.

ESLint keeps the boundary structural rather than customary: nothing under
`src/scenes/` outside `src/scenes/r3f/` may import three, so a type-only import
that loses its `type` keyword in a refactor fails the lint rather than silently
landing 249 kB on every first paint.

## Commands

```bash
npm install
npm run fixtures    # regenerate test fixtures from the repository's corpus
npm run math        # re-typeset the formulas (KaTeX, at build time)
npm run dev
npm run verify      # fixture check · generated-math check · lint · typecheck · test · build
```

Node `^20.19 || >=22.12`. This project runs **no CI job of its own**: it adds nothing to
[.github/workflows/ci.yml](../.github/workflows/ci.yml), and `npm run verify` is a local gate.

It is not outside every gate, and the exception is worth knowing before adding a dependency.
`package-lock.json` is a committed lockfile, so `tools/ci/audited-workspaces.toml` classifies
it and the release-blocking **Supply chain** job scans it on every commit — the same terms
`app/` gets. An advisory in anything here therefore turns the whole repository's CI red, and
the fix is to update the package. `tools/ci/npm-advisory-waivers.toml` refuses a waiver whose
`reaches_bundle` is `"yes"`, and a browser executes this bundle.

## Architecture

```
src/protocol/    pure TypeScript, no framework — the certified arithmetic
src/sim/         the deterministic scenario engine; scenarios are data, not code
src/provenance/  Tagged<T>: no number reaches the screen without a label
src/ui/          the design system, the Kernel Dial, the mark, the disclosure primitives
src/ui/glossary.ts    every term defined once; `<Jargon>` renders it where it is met
src/scenes/      fourteen scenes, each a SceneModel plus an authoritative DOM panel
src/scenes/registry.ts  the scene list, its three chapters, and each scene's chrome hue
src/scenes/labels.ts  label placement: deals labels into bands, drops what will not fit
src/scenes/motion.ts  which scenes carry an animated view, its inputs, and its readout
src/scenes/r3f/  the only place three.js may be imported
```

Four boundaries are enforced by ESLint rather than by convention: `protocol/` and `sim/`
may not import React or three; `ui/` may not import three; nothing under `scenes/` outside
`scenes/r3f/` may import three; and `Math.random`, `Date.now()` and `new Date()` are banned
outright, because the simulation must be replayable.

## Where 3D earns its place, and where it does not

The first build rendered every scene in 3D from the flat diagram's own `SceneModel`, under
the same orthographic projection. That made "degrades to 2D" a build-time guarantee, and it
also made the 3D view a strictly worse copy: same content, fewer labels — screen-space
labels cannot be placed the way the SVG pass places them — plus a tilt. A reader who
switched to it lost information.

So the mirroring is gone. The flat diagram is *the* diagram: complete, labelled, and the
fallback for everything. An animated view is a separate visual that exists only where a
relation cannot survive being flattened, and it has to name what it adds on screen.

| Scene | The animated view | What a plane loses |
| --- | --- | --- |
| The clock | Turning clock | A cycle is a rotation, and three cohorts in flight need an axis to be concurrent along |
| The markets | Cost surface | The LMSR cost is a function of two quantities; a chart spends both axes before it can show the cost |
| The escrow | Both futures | Side by side reads as a choice; stacked on one axis it reads as both at once |
| The decision | The corridor | How far a proposal travelled before something stopped it |
| The score | The cliff | A product of two gates is a plateau with two sheer drops, not a weighted average |

The other three — the state graph, the dispute timeline and the guard's checklist — offer
no animated view at all. That is not a gap: a graph, a timeline and an ordered list are all
*better* on a plane, and an empty tab would be worse than no tab. `motion.test.tsx` asserts
exactly which five have one, so the rule cannot erode a scene at a time.

Two of the five draw their surface from the certified protocol core per vertex — `cost()`
and `priceLong()` for the cost landscape, `gate()` for the cliff — so the shape is the
arithmetic rather than an illustration of it. Every motion prints its numbers as ordinary
DOM beside the canvas: a moving picture is a bad place to read a quantity off, a screen
reader cannot reach geometry, and a pure function of the motion's inputs is testable
without a GPU.

## Design notes

**The mark.** `assets/Bleavit-logo.png` traced to a path in `ui/Brand.tsx`, so it takes
`currentColor` and stays crisp at any size. It is a **B split by a vertical seam**, with a
chevron notch meeting that seam from either side — the same axis the product is built on,
and the same line the Kernel Dial draws as its fixed index.

**The signature element** is that dial: 21 teeth, because Bleavit's phase boundaries are
kernel fractions with denominator 21, so every boundary lands on an integer tooth at any
legal epoch length.

**Type** is Archivo Variable on both axes it ships — weight 100–900 and **width 62–125%**.
The width axis is the typographic signature: labels run condensed at 88%, titles and
headline numbers expanded at 112–118%. IBM Plex Mono carries parameter keys, storage keys,
citations and hashes, where a fixed advance is the point.

**Colour** is a five-material palette on a deep indigo field: blue for time, teal for the
ACCEPT branch, amber for REJECT, violet for judgement, rose for genuine safety states.
Three of those are reserved and load-bearing. ACCEPT and REJECT belong to branch instruments
and are forbidden on outcomes — a `Rejected(...)` chip is never amber, because rejection
followed by measurement is the most common healthy path in this protocol and colouring it as
failure would misteach it. The alarm hue is exhaustively reserved to safety states.

Four further hues do page wayfinding only — never data — and every scene takes one, so the
page recolours as you move through the machine. They sit at least 39° away from every
reserved hue, since a reserved colour spent as chrome stops being a signal. The four used to
carry two scenes each, which was a fact about there being eight scenes rather than a rule; the
39° clearance is the rule, and adding a fifth chrome hue to keep the counts even would spend a
reserved one.

**Provenance** is carried on three channels — glyph, full text, and a hatch on the ground —
and never on colour alone. It never strengthens: a computation over simulated inputs stays
simulated.

**Formulas are typeset**, not spelled out in monospace. KaTeX runs in
`scripts/build-math.mjs` at build time and the app ships the rendered markup, so
the 272 kB renderer never reaches a browser — every formula here is fixed prose
written by an author, not an expression a reader types. The stylesheet is
trimmed to the six font families the output actually references, and the ten
woff2 faces are copied next to it. `npm run math -- --check` is part of `verify`,
so the committed output cannot drift from the table that produced it.

**No text overlaps anywhere.** That is checked rather than asserted: an
instrumented sweep walks every scene across all six scenarios, every step,
every drawer open, at four viewport widths, in both themes and with every
animated view forced on, comparing per-line client rects for collision, clipping
and escape from a clipping ancestor. It found nine real defects — among them a
`letter-spacing` inherited into SVG as an absolute length, a band allocator that
treated different anchor rows as independent, and a dial whose rotating labels
collided at rotations nobody had looked at. Each fix carries a unit test.

The auditor needs three exclusions to be worth running, and each one is a class
of false positive rather than a tolerance: a closed `<details>` reports every one
of its children at the summary's rect; anything inside a `position: fixed`
container is a separate paint layer and is *meant* to sit over scrolled content;
and KaTeX assembles tall delimiters from glyph pieces that overflow their own
clip box on purpose. Without those three the sweep reports about 2,300 collisions
that no reader can see, which is the same as reporting none.

**Progressive disclosure** is structural, not decoration. Every rail opens with a
plain-language `Lede`, then `KeyFacts`, then `Depth` drawers that are closed by default.
Nothing is deleted; the expert material is one click away, and the click is the reader
saying they want it.

## Known limits

- The app ships no signing affordance. The canonical client re-reads every declared
  precondition at one finalized block immediately before signature; half-implementing that
  ritual here would teach it wrongly, so it is out of scope rather than approximated.
- No projected outcome is ever rendered during trading, mirroring the chain's own refusal to
  return decision statistics before the decision windows seal.
- Parameters that the specification has not settled — `[VERIFY]`-tagged or bound to a
  simulation artifact — are marked as unsettled wherever they appear.
