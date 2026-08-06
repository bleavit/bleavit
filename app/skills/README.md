# `app/skills/` — the portable producer side of the handoff

The client's half of [D-21](../../docs/architecture/00-decision-record.md) is
`packages/{contexts,intents,receipts,llm-handoff}`: it exports a verified capsule and
admits a proposed action. This directory is the **other** half — what a user gives their
analysis tool so that what comes back is something Bleavit will accept.

It is content, not code. Nothing here is imported by any package, it makes no network
request because it cannot, and the client works identically with none of it present
([10 §13.5](../../docs/architecture/10-frontend-architecture.md) — the handoff is
convenience, never load-bearing).

```
bleavit-analysis/
  SKILL.md                  the canonical skill — a Claude Agent Skill directory
  reference/formats.md      the three file formats, and why validating ≠ being accepted
  reference/safety.md       the rules, each with the failure it prevents
  examples/                 one document per refusal class, verified against the parser
  INSTRUCTIONS-chatgpt.md   generated — self-contained, for an instruction box with no files
  INSTRUCTIONS-generic.md   generated — self-contained, for anything else
```

## Under handoff-first, this is a product surface

The [11 §11.2](../../docs/architecture/11-frontend-workflows.md) navigation default puts
*prepare a capsule* and *review and sign* in front, with the analytical screens behind
**Advanced**. So a large share of the explanation, comparison and strategy work that used
to happen on S2/S3/S4 now happens in someone else's tool, reading this.

That makes the prose here load-bearing in a way sample code is not. It is also the one
part of the system with **no mechanical control over its quality** — the client can refuse
a malformed document, and cannot refuse a bad argument. [10 §13.5](../../docs/architecture/10-frontend-architecture.md)
records that as the accepted residual (doc 14, TH-49 class): *"a persuasive tool can shape
a user's judgement… no detection mechanism changes that. The control is the transaction
boundary, not detection."*

Which is why `reference/safety.md` explains the reason behind every rule rather than
listing them. A producer that understands why call bytes are banned in *both* directions
does not need the rule; one following a checklist finds the gap in the checklist.

## Two things are generated, and both for the same reason

`pnpm -C app run skills:generate` writes them; `skills:check` verifies them on every commit.

**The vendor instruction files** are assembled from `SKILL.md` + `reference/`. The same
rules must reach a directory-shaped Agent Skill, a ChatGPT instruction *text box* with no
filesystem, and a plain prompt. Hand-written, that is three copies of the safety rules that
agree on day one and diverge at the first amendment — invisibly, because nobody diffs a
ChatGPT instruction box against a repository. The cross-references are rewritten during
inlining, and the generator **fails** if a pointer to a file the reader cannot open
survives: an instruction that cannot be followed teaches the reader that instructions here
are optional.

**The examples** are emitted with correctly computed digests and then run through the
**real parser**, with the expected outcome in the filename:

```
admitted--prepare-pass-position.json
refused-FE-HANDOFF-004--foreign-key-inside-action.json
```

A published example that no longer does what it says is worse than none: somebody debugging
against a stale corpus concludes the client is wrong, and the natural next move — loosen the
document until it passes — is exactly what `reference/safety.md` rule 7 tells them not to
do. The label lives in the filename rather than a manifest, because a filename cannot drift
from itself.

The corpus covers the nine refusal classes an **inbound document** can cause. It does not
cover `FE-HANDOFF-011` (which needs live chain state at a refreshed block) or `-012`/`-013`
(which are export-side), and the checker names those exclusions rather than quietly
counting the family as covered — both are tested where they live, in
`app/tests/intents` and `app/tests/contexts`.

Every example is judged against a fixed context, published so a reader can reproduce a
verdict: genesis `0x91b171bb…ce90c3`, `spec_version` 2, contract version 28, chain height
1,000,000.

The two version numbers are **read from the release**, not typed into the generator, and
this sentence is checked against them. `admitIntent` compares the binding by exact equality,
so a corpus left behind at the previous contract version stops meaning what its filenames
say — every `admitted--` document is refused with `FE-HANDOFF-005`, and most of the
`refused-` ones return `-005` instead of the code they publish, because the binding
comparison runs before the expiry, closed-shape and limit checks. The genesis hash is not
read live and stays a documentation stand-in: no example here is a request a real client
would admit, which is what keeps a published example from being a ready-to-sign one.

## Editing

Edit `SKILL.md`, `reference/*.md`, or the corpus table in
`app/tools/generate-skill-examples.ts` — then regenerate. Never edit a generated file: a
vendor instruction file edited in place is the drift the generator exists to prevent, and
an example edited to match a changed parser is a published claim nobody re-verified.
