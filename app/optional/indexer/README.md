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
     because their order is part of §8.2's canonical form, which a page owes: a merge before its
     split is a different history rather than the same one written differently, and one covered set
     has exactly one spelling. (This bullet used to justify the rule by the client's conservation
     replay. A page is not replayed — 10 §8.5.2 — so the obligation survives and the old reason
     does not.)
   - `vaults` carries each vault's full branch set. A vault with one branch is refused.
   - `balances` is the accounts' **actual holdings at the page's last block**, read from state —
     not a fold of the page's own movements. This obligation was the other way round until
     2026-08-07, and 10 §8.5.2 settles it: this route is what §8.4's 1-in-16-page sampling audits,
     and sampling re-verifies rows *against the chain*. A folded balance disagrees with a current
     holding on every honest page that does not start at genesis, which would turn the one live
     control a client has over an indexer into a generator of false mismatches — and a sampling
     mismatch auto-disables the source. `foldedSlice()` remains for fixtures and for a
     **single-page read over a whole short history** — it folds only the movements inside the span
     it was handed, so page two already disagrees even for a splits-only history.
   - Nothing on this server checks `balances`, and that is the design rather than an omission.
     §8.4 gives snapshots screens and live indexers **sampling**, because a page cannot be checked
     against a history it does not carry. The client audits these rows against the chain instead.

4. **A `sha256`.** `(bytes) => hex`. On Node, `createHash('sha256').update(bytes).digest('hex')`.

## Running one

```ts
import { createHash } from 'node:crypto';

import { createIndexer, stateSlice } from './indexer.ts';
import { SUGGESTED_BLOCKS_PER_PAGE, startIndexer } from './serve.ts';

const VAULTS = [{ vault: 'v1', branches: ['FAIL', 'PASS'] }];
const OBSERVED = [{ fromBlock: 10, toBlock: 4_000 }];
const HISTORY = /* your movements, in chain order */ [];

const handle = createIndexer({
  binding: { genesisHash: '0x…', specVersion: 2, contractVersion: 23 },
  coverage: OBSERVED,
  blocksPerPage: SUGGESTED_BLOCKS_PER_PAGE,
  read: (span) => stateSlice(VAULTS, HISTORY, OBSERVED, span),
  sha256: (preimage) => createHash('sha256').update(preimage).digest('hex'),
});

startIndexer(handle, { port: 8_080, host: '127.0.0.1' });
```

`stateSlice()` suits an operator who holds the **whole movement log** — the common case for an index
built by replaying a chain — because it takes the balances from every movement up to the page's last
block rather than from the movements inside the span. If you query a state store at a height
instead, supply the `IndexerSlice` yourself: `balances` is the only member these helpers compute
differently. Where your movements come from — an archive node, an existing indexer, a database you
already run — is not fixed by §8.5.2 and is not fixed here.

## What it refuses, and why that is the useful part

Before answering any page, this server runs the **client's own admission path** over the exact bytes
it is about to write. A page that would be rejected at the user is answered `500` and never served,
with the reason in the body. So the obligations above are enforced rather than documented, and the
failures you will actually hit are these:

- a movement at a block your `coverage` does not claim;
- movements out of block order;
- a coverage range outside the page's own span;
- an amount that is not a canonical decimal string inside the `u128` range — amounts run past 2⁵³,
  so a JSON *number* is silently rounded on load. That is refused as **malformed**, before the
  canonical-form screen runs, because the value never parses into the document at all;
- a **negative** balance, which is the failure you will actually hit if you reach for
  `foldedSlice()` on real history: folding a `transfer` or `merge` of a position created in an
  earlier block yields a negative holding, and §8.2's amount grammar cannot express one, so the
  page is refused as malformed on every span that does not reach back to genesis. Use
  `stateSlice()` or supply the slice yourself.

Note what is **not** on that list: your `balances`. Nothing here checks them, because a page cannot
be checked against a history it does not carry (see below). The client audits them against the
chain by sampling, and a mismatch auto-disables you — so they are the rows to get right.

## The limitation that used to be here is gone

Until 2026-08-07 this server could only answer spans reaching back to the origin of every position
they touched, which is not what `from` and `to` are for: a request for `from=10000&to=11000` over
real history was refused with a `500`. The client ran a snapshot's full screen set over every page,
including §8.4's conservation replay — and that replay starts every holding, supply and escrow at
**zero** and requires non-negativity at each step. A `split` mints from escrow and is self-contained
at any span, but a `merge`, `transfer` or `redeem` of something created in an earlier block replays
negative in a page that does not carry that block.

10 §8.5.2 rules it: a page owes canonical form, §8.2's ordering rules and monotone coverage, and
**not** the conservation replay or the event↔derived-row agreement. §8.4 had already put the
internal-consistency screens on *snapshots* and given live indexers *sampling* instead; §8.5.2 says
so in as many words and names which screens that is. Serve any span you hold.

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
There is no third item, and this list promised one until 2026-08-07: *"diff you against a snapshot
covering the same blocks"*. `FE-PROV-004` is scoped by §8.4 to **two independent snapshots** covering
one range, and §2.3 says the same, so a client never diffs a page against a snapshot. Serving §8.2's
format is still required by §8.5.2 — but the reason is canonical serialization, so that one
implementation of one check serves both artifacts, not a cross-check that was never in scope.
**Sampling is the only check on a live indexer**, which is why the row above matters more than it
looks, and why your `balances` are the rows to get right.
