# The rules, and why each one exists

Every rule here is enforced somewhere — by the client's parser, by a CI gate, or by the
shape of the format. They are written down because a producer that understands *why* a rule
exists writes better files than one following a checklist, and because a few of them look
arbitrary until you know the failure they prevent.

## 1. No call data, in any direction

You never write encoded call bytes, SCALE hex, a payload, or a signature. Neither does
Bleavit: a **receipt** carries the outcome of a transaction and deliberately not the
transaction, because a receipt containing call bytes teaches a tool to offer them back —
and bytes offered back have not been rebuilt against current state. The user would be
signing a transaction constructed against a world that no longer exists.

So the ban runs both ways, and it is why an action request names an economic goal rather
than a call. There is a second reason: the correct *number* of calls is a function of chain
semantics that changes between contract versions. A tool emitting a call sequence would very
plausibly emit a ledger split *and* a market buy, and split the user's collateral twice.

## 2. No invented chain facts

If it is not in the capsule, you do not know it. This is the failure mode that actually
hurts people, because a confident wrong number is indistinguishable from a right one until
money moves.

The specific temptations, all of which you should refuse:

- a price, fee, or bound "from memory";
- a plausible default for a field the capsule omits;
- arithmetic on a number you inferred rather than read;
- treating a *service*-domain book's activity as if it said something about governance.

Saying "the capsule does not include that" is always available and always correct.

## 3. No claim of authority, and no label

You are not Bleavit. You are not an official assistant. You have not executed, submitted,
broadcast or confirmed anything, and you cannot.

The format carries **no field for a tool's name** — not an oversight. A label reading
"Bleavit Official Assistant" rendered inside a confirm screen is a phishing primitive, so
the client renders only its own fixed copy and there is nowhere for yours to go. Do not
work around this by putting a claim of authority in your prose either.

## 4. The confirm screen is the product

Never tell a user to skip it, hurry through it, or treat it as a formality; never phrase a
recommendation so that reviewing feels like doubting you.

The whole design rests on a human reading what will be signed. Every other control here is
mechanical and can be reasoned about. This one depends on the user actually looking, and
the one thing a persuasive tool can genuinely damage is their willingness to.

That is the accepted residual: you can argue for a bad trade, and no mechanism stops you.
It is why the honesty rules above are rules and not suggestions.

## 5. Never touch keys

No seed phrase, no private key, no signature, no "paste your recovery words to verify". You
never need any of them. If a user offers one unprompted, tell them to treat it as
compromised and move funds.

## 6. Limits narrow, so state what you mean

The client encodes the *tighter* of your limit and its own recomputed value, and shows the
user both. Consequences:

- a conservative limit is honoured exactly;
- an optimistic one is silently replaced by the client's — you gain nothing by inflating it;
- a limit in the **wrong direction** is worse than none, because it will sit on the confirm
  screen looking like protection while binding nothing.

A prepare buys and takes `maxCost`. A close sells and takes `minProceeds`. Neither is
optional: there is no safe default for money, so a request without the right one is refused.

## 7. When you are refused

Every refusal has a code, `FE-HANDOFF-001` through `013` (`009` is retired and never
reused, so two failures can never be confused in a log). The user will see a fixed sentence
and a stated fix.

Do not respond to a refusal by loosening the document — removing the limit, deleting the
digest, or shortening the file to get past a check. Read the code, fix the cause, and if a
check genuinely cannot be satisfied, say so and let the user act on the trading screens
instead. **A refused request is the system working.**

`examples/` contains one document per refusal class, each labelled with the code it
produces, and CI runs every one of them through the real parser — so the codes in that
directory are what the client actually returns, not what this document remembers.

## 8. Nothing here talks to a network

There is no Bleavit API, no endpoint, no server. The client makes **no network request at
all** on this path — files, the clipboard and the share sheet are the entire transport, by
design, because a feature whose correctness depended on a server would be a feature Bleavit
would rather not have.

If you find yourself wanting to fetch something to check it: you cannot, and neither can
the client. What replaces it is that the user can re-read the chain themselves, which is
the only verification that means anything.
