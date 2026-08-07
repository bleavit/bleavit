# The three files

Bleavit exports two formats and accepts one. Nothing else crosses the boundary.

| File | Direction | What it carries |
|---|---|---|
| `bleavit.context.v1` | Bleavit → you | A verified view of the chain at one finalized block |
| `bleavit.receipt.v1` | Bleavit → you | What the chain recorded about one finalized transaction |
| `bleavit.intent.v1` | you → Bleavit | A proposed action. **The only inbound format** |

The machine-readable schemas are in `../../../schemas/`. Validate against them before you
hand a file back — but read the next section first, because validating is not the same as
being accepted.

## Validating is not being accepted

A schema checks the *shape of a file*. Four of the client's checks are not about shape at
all, and no validator can perform them:

- the **digest** must match the document's own bytes;
- the **chain binding** — genesis hash, runtime version, contract version — must equal what
  the client reads live, exactly;
- a `deadlineBlock` is compared against the **chain's** block height, never a clock;
- every limit is re-derived against a freshly read block, and shown to the user as *what
  you asked* beside *what will be encoded*.

So a file can be perfectly well-formed and still be refused. That is not a bug you should
work around; it is where the trust boundary is.

## Reading a context capsule

```
schema    "bleavit.context.v1"
binding   which chain, which runtime, which contract version
anchor    the finalized block every value below was read at
scope     what the user agreed to share for THIS export
proposal  governance proposals, with their lifecycle state
market    books, each labelled `primary` or `service` (see below)
decision  finalized decisions
epoch     the current epoch
positions the user's holdings, KEYED BY DOMAIN
balances  the user's balances, per asset
address   the user's address — absent when they chose pseudonymization
```

Every amount is a **decimal string**, not a number. Base units run past what a JSON number
holds exactly, so a parser that reads them as numbers corrupts them silently. Keep them as
strings; if you do arithmetic, use a big-integer type and say what you did.

USDC has **6 decimals**: `1000000` base units is one USDC.

### Two ledger domains, never added together

Bleavit has two separate ledgers. `primary` books are the governance markets that decide
things. `service` books are hosted questions run for external clients — real markets, real
money, no governance meaning whatsoever.

They are backed by **separate pools**, which is why the capsule keys positions by domain
and carries no combined total. **Do not compute one.** A single figure spanning both asserts
one backing pool where there are two. Show them side by side, and never describe trading a
service book as participating in Bleavit's governance.

### Absent is not empty

A field missing from `scope.included` **was not shared**. A field named in `scope.included`
whose value is an empty array means **there are none**. The capsule keeps these distinct on
purpose, and so should your answer: "you did not export your positions" and "you hold no
positions" are different sentences and only one of them is a fact about the chain.

## Writing an action request

```json
{
  "schema": "bleavit.intent.v1",
  "binding": { "genesisHash": "0x…", "specVersion": 2, "contractVersion": 28 },
  "action": { "kind": "prepare_pass_position", "id": "7", "collateral": "25000000" },
  "limits": { "maxCost": "26000000" },
  "digest": "…"
}
```

Copy `binding` **verbatim from the capsule**. It is compared by exact equality, and it is
what stops a request prepared against one chain from being replayed on another.

`action` and `limits` are **closed objects**: an unknown key inside either is refused
outright. An unknown key at the *top level* is fine — that is where a producer annotation
belongs, and no consumer reads it. The asymmetry is deliberate. Inside `action`, an extra
key would be a proposed *semantic*, and it is exactly where an encoded call would be
hidden.

Ids and amounts are **canonical decimal strings**: no leading zeros, no sign, no exponent,
no whitespace. `"007"`, `"1e6"` and `"+3"` are all refused.

### The digest

Compute SHA-256 over the canonical JSON of `{schema, binding, action, limits}` — keys sorted
by code point, minimal separators, UTF-8 — prefixed by `bleavit.intent.v1` and a single NUL
byte. Render it as 64 lowercase hex characters.

**It authenticates nothing.** It is an integrity check against truncation and copy-paste
damage, and truncation is the real risk: a long request pasted into a chat box gets cut off
at the end, producing a file that is valid JSON up to the cut. Send the file as an
attachment when you can.

## What the client does with what you write

It builds the transaction itself, from the current chain state, and shows the user:

- what the action resolves to — the actual proposal and book your `id` names, read from the
  chain, beside the id;
- your asked limit and the limit that will be encoded, when they differ;
- a fixed, non-dismissible note saying the request came from outside;
- the decoded call, from the bytes it is about to sign.

Then a human decides. That is the whole design, and your file is one input to it.
