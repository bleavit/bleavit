# `optional/indexer` — the reference live indexer

The reference implementation [10 §8.2](../../../docs/architecture/10-frontend-architecture.md)
names in as many words, serving the two routes
[§8.5.2](../../../docs/architecture/10-frontend-architecture.md) fixes. Running one is optional in
every sense: the Bleavit client ships an **empty** provider list, works with no indexer at all, and
never lets a row an indexer served satisfy a precondition (§8.1, INV-FE-3).

An indexer makes deep history load faster. That is the whole of what it does.

## The interface, in full

| Route | Answers |
|---|---|
| `GET /chain` | The chain binding — `genesisHash`, `specVersion`, `contractVersion` — and the coverage you currently serve |
| `GET /range?from=<block>&to=<block>&cursor=<opaque>` | One page: a §8.2 snapshot document over a prefix of the requested span, plus a continuation token when more pages follow |

There is **no error vocabulary**. Any status other than `200` is a failed read, and so is any body
that is not a canonical §8.2 document. You implement no error codes and the client parses none.

The continuation token travels in the `bleavit-next-cursor` response header, and its content is
yours. The client passes back exactly the token you gave it and never constructs, parses or
increments one, so you may encode whatever your index needs. This server encodes the next block.

## What you must supply

Four things, and the third is the one that surprises people.

1. **A chain binding.** The `genesisHash` of the chain you index, plus the `specVersion` and
   `contractVersion` you are serving. A client on another chain treats your endpoint as a failure
   rather than as a source, so this must be right or nothing you serve is usable.

2. **Your served coverage.** The blocks you actually hold. Not the blocks you intend to hold, and
   not the range a client asked about — a client establishes what it has from the coverage your
   pages carry, so overstating it is how a gap becomes invisible history.

3. **A slice reader** — `(span) => { coverage, vaults, ops, balances }`. Called once per page with
   a sub-span this server chose. Four obligations:

   - `coverage` is what you **observed** inside that span, not the span. If you saw blocks 10–14
     and 18–20 of a 10–20 page, say so; the gap is a first-class, rendered fact on the client and
     filling it in is the one thing you must not do.
   - `ops` is in **chain order** — block, then extrinsic, then event. This server never sorts them,
     because their order is semantic: the client replays them and checks that no account ever goes
     negative, so a merge before its split is a different, invalid history rather than the same one
     written differently.
   - `vaults` carries each vault's full branch set. A vault with one branch is refused.
   - `balances` is the fold of **that page's own movements**, not the accounts' holdings at the
     page's last block. The client checks them against a replay of the document it received, so a
     page carrying real chain balances alongside a partial op set is rejected. If you hold an
     independent balance read, supply it — that is what keeps the check meaningful. If you do not,
     `foldedSlice()` derives them from your movements, and the README of that function says plainly
     what the shortcut costs.
   - **A page must be a self-contained history.** Read the limitation below before you build a
     reader: this is the obligation that decides what spans you can serve at all.

4. **A `sha256`.** `(bytes) => hex`. On Node, `createHash('sha256').update(bytes).digest('hex')`.

## Running one

```ts
import { createHash } from 'node:crypto';

import { createIndexer, foldedSlice } from './indexer.ts';
import { SUGGESTED_BLOCKS_PER_PAGE, startIndexer } from './serve.ts';

const VAULTS = [{ vault: 'v1', branches: ['FAIL', 'PASS'] }];
const OBSERVED = [{ fromBlock: 10, toBlock: 4_000 }];
const HISTORY = /* your movements, in chain order */ [];

const handle = createIndexer({
  binding: { genesisHash: '0x…', specVersion: 2, contractVersion: 23 },
  coverage: OBSERVED,
  blocksPerPage: SUGGESTED_BLOCKS_PER_PAGE,
  read: (span) => foldedSlice(VAULTS, HISTORY, OBSERVED, span),
  sha256: (preimage) => createHash('sha256').update(preimage).digest('hex'),
});

startIndexer(handle, { port: 8_080, host: '127.0.0.1' });
```

Replace `foldedSlice` with your own reader when you have one. Where your movements come from — an
archive node, an existing indexer, a database you already run — is not fixed by §8.5.2 and is not
fixed here.

## What it refuses, and why that is the useful part

Before answering any page, this server runs the **client's own admission path** over the exact bytes
it is about to write. A page that would be rejected at the user is answered `500` and never served,
with the reason in the body. So the obligations above are enforced rather than documented, and the
failures you will actually hit are these:

- balances that do not match the fold of the page's movements;
- a movement at a block your `coverage` does not claim;
- movements out of block order;
- a coverage range outside the page's own span;
- an amount that is not a canonical decimal string inside the `u128` range — amounts run past
  2⁵³, so a JSON *number* is silently rounded on load and the page then fails its own replay.

## The limitation you will hit first, and it is unresolved

**A page must be a self-contained history, so today you can only serve spans that reach back to the
origin of every position they touch.**

The client replays the movements in each page and checks that no account, supply or escrow ever goes
negative, starting from zero. A `split` mints a complete set out of escrow, so a page of splits
replays cleanly whatever its span. Every other movement *consumes* a position: a `merge`, a
`transfer` or a `redeem` of something created in an earlier block replays negative in a page that
does not carry the earlier block, and the page is refused. That is not a defect in your index, and
this server will tell you so with a `500` rather than serving bytes the client would reject.

The consequence is blunt: a request for `from=10000&to=11000` over real history cannot be answered
conformantly, which is most of what `from` and `to` are for. §8.4 may already resolve it — it
assigns the internal-consistency screens (conservation replay, event↔derived-row agreement) to
**snapshots** and gives live indexers *sampling* instead, which would leave a page owing canonical
form and §8.2's ordering rules and not the replay. §8.5.2 does not say, the client takes the
fail-closed reading until it does, and the ruling is filed as a spec question. Until it lands, serve
spans that begin at the start of the history you hold.

## What it does not do

No writes, no transaction relay, no query language, no authentication, no rate limiting, no TLS.
`GET` and `HEAD` are the only methods it answers and it never reads a request body. Anything more is
yours to add in front of it, and none of it is part of the interface a client depends on.

It also collects nothing. A client that reads from you discloses the blocks it asks about, and
Bleavit tells its user exactly that before they accept your endpoint (§8.1). Logging beyond what you
need to operate is a choice you are making about somebody else's privacy.

## What the client will do to you

- **Probe you every ten minutes** with `GET /chain`, and on the tick a user first accepts your
  endpoint (§8.3, §8.5.3). Consecutive failures switch you off; a slow answer never does.
- **Re-verify roughly one row in every sixteen pages** against the chain itself (§8.4). One row that
  disagrees switches you off permanently until the user turns you back on. This is not a threat
  model of you specifically — it is that nothing a third party serves is ever treated as verified,
  and sampling is the honest, limited check available.
- **Diff you against a snapshot** covering the same blocks, when the user has one. Both are the same
  format for exactly this reason. A disagreement is reported as a disagreement: neither side wins,
  and the range is left as a visible gap.
