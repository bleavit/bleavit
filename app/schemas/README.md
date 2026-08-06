# `app/schemas/` — the published formats

Machine-readable JSON Schema for the three handoff formats
[10 §13.1](../../docs/architecture/10-frontend-architecture.md) defines, plus the producer-tool
input format [10 §8.2](../../docs/architecture/10-frontend-architecture.md) promises anyone can
write against. They exist so somebody writing a producer — an Agent Skill, a script, a hosted
assistant, an archive reader — can check a document before a user ever sees it.

| File | Direction | What it is |
|---|---|---|
| `bleavit.intent.v1.schema.json` | **in** | A proposed action. The only inbound format, and the subsystem's whole attack surface |
| `bleavit.context.v1.schema.json` | out | A verified view of the chain at one finalized block, limited to what the user consented to share |
| `bleavit.receipt.v1.schema.json` | out | What the chain recorded about one finalized extrinsic |
| `bleavit.archive-export.v1.schema.json` | tool input | What an archive reader hands `app/tools/snapshot`. Not a client format — it never reaches the app |

## Why the archive export is here

[10 §8.2](../../docs/architecture/10-frontend-architecture.md) promises snapshots
*"reproducible byte-identically by anyone from `tools/snapshot` against an archive node"*, and
that promise is to **independent producers**: a second person has to be able to write a reader,
feed this tool, and obtain the same pin. An input format that exists only as a TypeScript parser
in this repository is not a format somebody outside it can write against, so the
reproduce-by-anyone claim would hold only for people who read the source.

The tool's own archive-node adapter is deliberately unwritten (`PLAN.md` · *Spec questions*
SQ-604 — no document names which read interface, endpoint, pagination or historical-metadata
policy it binds to). Publishing the boundary it is missing is what lets an operator supply one
today.

**Its `additionalProperties` are `true`, which is the opposite of `bleavit.intent.v1` and is
deliberate.** An intent's `action` is *"precisely where an encoded call would be placed"* by a
hostile third party. An archive export is a file a publisher hands their own tool, and
`parseArchiveExport` reads the fields it names and ignores the rest — so publishing `false`
would tell reader authors to delete annotations this tool happily accepts.

**Generated, never hand-written.** `pnpm -C app run schemas:generate` writes them from the
parser's own declarations; `pnpm -C app run schemas:check` regenerates into memory and
byte-compares on every commit. Editing one of these files by hand is the one change the
gate exists to catch.

## Why generated

A published schema is a promise about what the client accepts, so the promise has to come
from the code that decides. The specific way a hand-written schema breaks is not a missing
field:

**`additionalProperties` defaults to `true` in JSON Schema.** A schema that simply omits it
on `action` publishes the exact opposite of [10 §13.2](../../docs/architecture/10-frontend-architecture.md)'s
asymmetry — it tells every producer that an extra key inside `action` is fine, which is
*"precisely where an encoded call would be placed"*. Absence reads as permission, silently,
in the one file whose entire audience is people writing producers.

So the closed cores come from the parser's `CORE_CONTAINERS` / `*_KEY_NAMES`, the patterns
from the `RegExp` objects it tests with, and the bounds from the same computed constants
§13.2 requires. The generator additionally **fails** if the parser declares a field the
schema does not publish — a schema silently missing a field tells every tool author the
field is forbidden while the client accepts it, so the format grows a member nobody outside
this repository can discover.

## Validating is not being admitted

A schema validates a **file**. It cannot perform a chain read, and four of the parser's
checks are chain reads or recomputations:

- the **digest** must match the document's own bytes;
- the **binding** must equal the live chain's, by exact equality;
- `deadlineBlock` is compared against **B′, the chain clock** — never a device clock;
- every limit is **narrowed** against a value recomputed at a fresh block, and shown as
  asked-vs-encoded.

That is [11 §11.14.1](../../docs/architecture/11-frontend-workflows.md)'s admission-versus-precondition
line, and a schema that pretended to cover it would tell a producer their document is
*accepted* when it is merely *well-formed*. Each such field says so in its own
`description`, and `app/tests/intents/schemas.test.js` asserts the gap sits exactly there:
a stale deadline, a foreign chain and a tampered document each validate and are each still
refused.

## What the differential is for

`schemas:check` proves the committed files match the generator. That is determinism, not
truth — it would stay green for a generator that published a schema describing nothing. The
suite is what makes the schema *true*: one corpus of documents through both the parser and a
validator, asserting

- **everything the parser admits validates** (a stricter schema makes tool authors delete
  fields the client accepts), and
- **a foreign key in a closed core is refused by both** (the published asymmetry).

It caught a real defect on its first run. The first schema published `limits` with every
field optional and `required: []`, while the parser **requires** a monetary limit whose
direction matches the action — a prepare states `maxCost`, a close states `minProceeds`,
and each refuses the other. *"There is no safe default for money"* (§13.2) is a property of
the file, so the schema was obliged to carry it and did not. A producer following the
published version would have emitted `"limits": {}`, validated cleanly, and been refused at
the user; a proceeds floor on a purchase is worse still, because it sits on the confirm
screen looking like protection while binding nothing.

## Nothing here is fetched

`$id` is an identifier, not a retrieval instruction. These files ship inside the signed
release; the client makes no network request on any handoff path (D-21), and never resolves
a `$id`. A producer that resolves one is doing so on its own side.
