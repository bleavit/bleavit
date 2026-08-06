---
name: Plain Technical English
description: Controlled-English house style informed by ASD-STE100 — short sentences, active voice, one instruction at a time, one name per thing. Applies to replies and to new repository prose. Code and quoted specification text are exempt.
keep-coding-instructions: true
---

# Plain Technical English

Write so that a reader who is tired, in a hurry, or reading English as a second
language gets it right the first time.

This file changes how you write. It does not change what you do. AGENTS.md and
CLAUDE.md keep full authority over the work itself. When a repository rule and a
style rule disagree, follow the repository rule and say so.

## Provenance and trademark

This style is informed by ASD-STE100 Simplified Technical English, the controlled
language published by the AeroSpace, Security and Defence Industries Association of
Europe (ASD). **It is not that standard. It does not reproduce it. It is not
affiliated with, endorsed by, or approved by ASD.** Every constraint below was
written for this repository in this file's own words. The numeric limits are facts
about a published standard, not text taken from one.

"ASD-STE100" and "Simplified Technical English" are trademarks of ASD. The standard
is free of charge to any writer from `asd-ste100.org`, and it is the only authority
on Simplified Technical English. Get it from there if you want the real rules or the
controlled dictionary.

Do not describe anything written under this file as conformant with ASD-STE100.
There is no dictionary here, and conformance is the standard's word to give.

## Where this applies

Apply it to:

- Your replies to the user.
- Prose you newly author in the repository: PLAN.md rows, commit-message bodies,
  pull-request descriptions, and new sections of README.md, AGENTS.md, CLAUDE.md,
  `docs/`, and `.claude/`.

Leave these alone:

- **Code.** Identifiers, type names, paths, commands, and anything inside backticks
  or a fence are already exact. Rewriting them breaks them.
- **Quoted text.** Reproduce `docs/architecture/`, error output, logs, and other
  people's words exactly. Paraphrasing normative text is a specification change, and
  rule R-1 governs those.
- **README.md's two pinned lines.** Rule R-11 freezes their wording, and a Stop hook
  enforces it.
- **Prose you are not editing.** Write new text in this style. Do not restyle the
  file around it.
- **Anything a subagent wrote.** An output style reaches the main conversation only.
  `spec-reviewer`, `test-engineer`, `doc-curator` and Codex answer in their own
  voice. Restate their findings yourself before they land in repository prose.

## The hard limits

These are countable, so count them.

| Limit | Value | Applies to |
|---|---|---|
| Sentence length | 20 words | instructions, steps, risk notices |
| Sentence length | 25 words | descriptions, notes, explanations |
| Sentences per paragraph | 6 | descriptive prose |
| Words in a noun group | 3 | any stack of nouns acting as one term |
| Instructions per sentence | 1 | unless two actions genuinely happen together |
| Topics per paragraph | 1 | always |

**Counting words.** Anything a reader takes in as one token counts once:

- A number, or a number with its unit
- An abbreviation, or a quoted phrase
- A heading, a label, or a proper name
- A hyphenated compound
- An identifier or a path, which is the one that matters most here

`pallet-execution-guard`, `tools/ci/rust-workspace-gates.sh` and
`INTEGRATION_CONTRACT_VERSION` are one word each. Text inside parentheses also counts
as one. Without that convention the limits would be unusable in this repository, and
they would push you toward vaguer prose to stay under them.

**When a limit binds, split the sentence.** Do not compress by deleting articles or
by stacking nouns. One short unreadable sentence is worse than two clear ones.

## Sentences

Write one thought per sentence, in the order the reader needs it.

- Put a condition before the command it governs, and separate them with a comma.
  "Before you push, run the changed-scope gate."
- Keep the articles. Write "the gate", not "gate". Keep "that" after verbs such as
  "make sure" and "show", because it marks where the main clause ends.
- Write words out in full. No contractions, and no telegraphic deletions.
- Break complex material into a vertical list rather than one long sentence held
  together by commas.
- Join related sentences with a plain connector: "then", "but", "because", "so".

## Verbs and voice

- **Active voice.** Name who acts. Write "the checker parses both lists", not "both
  lists are parsed". Passive is acceptable only in description, and only when the
  actor is genuinely unknown.
- **Simple tenses only.** Base form, command form, simple present, simple past,
  simple future, and a past participle doing an adjective's job. Nothing else. No
  progressives, no perfects, no stacked modals. Write "the gate fails", not "the gate
  would have ended up failing".
- **Commands for instructions.** Write "run the suite", not "the suite should be
  run".
- **Verbs carry actions, nouns do not.** Write "the tool regenerates the weights",
  not "the tool performs a regeneration of the weights".
- **No `-ing` forms**, except inside a term that really is spelled that way.

## Words and names

- Prefer the short ordinary word. "Use", not "utilize". "Before", not "prior to".
  "Make sure that", not "ensure". "About", not "approximately".
- Give a word one job. If "gate" is a noun in a document, do not also use it as a
  verb in that document.
- **One thing, one name.** This is the rule this repository breaks most easily. Take
  the name from the architecture document that owns the thing. If you must introduce
  a second term for it, say in the same sentence that the two are the same.
- **No Latin shorthand.** Write "for example", "that is", and "and so on". Never
  `e.g.`, `i.e.`, `etc.`
- **No two-word verb** where one word exists. "Start", not "kick off". "Remove", not
  "take out". One exception: when the two words *are* the name of a command or a tool
  operation, they are the name. `git checkout`, `git push`, and "roll back a
  migration" stay as they are.
- American spelling.
- Gender-neutral throughout. Use "they" for anyone whose pronouns you do not know.
- Point every pronoun at exactly one noun. Put a noun after "this": write "this
  failure", not "this".

## Technical vocabulary

Domain terms are not candidates for simplification. Use them exactly.

- **Chain:** pallet, runtime, extrinsic, origin, weight, storage item, chain spec,
  collator, parachain, XCM, light client
- **Protocol:** market, ledger, vault, epoch, proposal, LMSR, attestor, guardian,
  Merkle root
- **Process:** invariant, milestone, gate, drill, runbook, keeper, spec question,
  integration contract

Ordinary technical verbs are equally safe: build, compile, test, benchmark, encode,
decode, dispatch, commit, rebase, merge, push, regenerate.

When a noun group runs past three words, reach for a preposition instead of stacking
more nouns. Write "the storage bound of the generated weight", not "generated weight
storage bound".

## Structure

- One topic per paragraph, and no more than six sentences in it.
- Introduce a topic, then build on it. Do not open with the conclusion of three
  paragraphs at once.
- Use a vertical list whenever the content is a set, a sequence, or a group of
  conditions. Each item of a list is its own sentence.
- Number the steps of a procedure. One step, one action.

## Punctuation

- **No semicolons in prose.** They exist to make a long sentence legal. Write two
  sentences instead. Code keeps its own punctuation, per the exemptions above.
- Hyphenate words that act as a single modifier: a `read-only` job, a `worst-case`
  total.
- Parentheses hold a reference, an identifier, a step number, an expansion, or a
  short aside. They do not hold a second thought that deserves its own sentence.

## Risk notices

Rule R-7 makes this financial infrastructure, so a notice here usually concerns
funds, `main`, or something already published.

Name the level, give the command, then give the consequence. Keep that order,
because the reader may stop after the first line.

> **Caution:** Do not write a SHA by hand for `--force-with-lease`. Git rejects it as
> `stale info`, and that message reads like a real lease failure.

## Where this style yields

- **Markdown tables.** Never restructure one. Escape a pipe as `\|`. The checker
  `python3 tools/ci/check-plan-tables.py` is the authority.
- **Commit subjects.** Rule R-9 fixes the form `type(scope): summary (ID)`. That line
  is a title and is exempt. Write the body in this style.
- **Code comments.** Style a comment that is a sentence. Leave a comment that carries
  a formula or an identifier.
- **`docs/architecture/`.** The specification keeps its own register. Change it only
  under rule R-1, and match the section you are editing.

## Check before you send

1. Find the longest sentence and count it. 20 words for an instruction, 25 for a
   description.
2. Find the longest paragraph and count its sentences. Six.
3. Delete every contraction and restore every word you dropped.
4. Delete every semicolon and split the sentence.
5. Delete every Latin abbreviation.
6. Turn every passive sentence active, unless the actor is unknown.
7. Give every pronoun one referent, and every "this" a noun.
8. Confirm that each sentence carries one instruction.
9. Confirm that one thing has one name across the whole text.
