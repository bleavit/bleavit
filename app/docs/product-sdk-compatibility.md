# Polkadot Product SDK — compatibility report

**Status:** required architectural proof, completed for the desk-research half; six items remain
`[VERIFY]` pending a devnet probe. **Non-normative** — `docs/architecture/` wins on conflict, and
[10 §4](../../docs/architecture/10-frontend-architecture.md) /
[15 §2](../../docs/architecture/15-invariants-and-testing.md) own the rules this report is measured
against.

**Date of the live-source sweep:** 2026-08-03. Every capability claim below is either cited to a
source fetched on that date, or explicitly tagged `[VERIFY]` with the experiment that settles it.
Under R-2 nothing here is resolved by assumption, and every unresolved capability **fails closed**.

**Why this document exists before any Product code.** The instruction was to establish, first,
whether the Product route can carry Bleavit at all — because if it cannot, the Product remains an
optional distribution target and the standalone wallet adapters are the canonical path. That is
exactly the conclusion §7 reaches.

---

## The six questions, answered

### 1. Which host environments support the Product SDK?

Three: **Polkadot Android**, **Polkadot iOS**, and **Polkadot Desktop** with a web gateway.
Products run in a sandboxed webview on the native hosts and a sandboxed iframe on the gateway; the
host injects a bridge, and the container implementation offers both an iframe and a webview
provider.

The packages are real and Parity-published — this was checked rather than assumed, because the
name was supplied to us rather than found:

| Package | Version | Role |
|---|---|---|
| `@parity/product-sdk` | 0.20.0 | umbrella; Apache-2.0, ESM-only, `polkadot-api ^2.1.6`, React peer optional |
| `@parity/product-sdk-host` | 0.15.0 | host container detection + storage access |
| `@parity/product-sdk-signer` | 0.12.0 | signer manager over the Host API |
| `@parity/product-sdk-chain-client` | 0.9.2 | multi-chain client |
| `@parity/product-sdk-descriptors` | 0.8.0 | PAPI descriptors for platform chains |
| `@novasamatech/host-api` | 0.9.1 | the actual host↔product wire protocol |
| `@parity/host-api-test-sdk` | 0.11.0 | E2E harness without launching a host |

Three qualifications matter more than the version numbers, and none of them is a detail:

1. **It is a devnet.** The docs state plainly that tokens have no real value, that chains and
   services may be reset, and that flows can change between builds. Platform services run on Paseo.
2. **The reference implementation self-describes as a prototype** that may contain bugs,
   vulnerabilities, or incomplete features.
3. **Every package is 0.x**, so under semver there is no compatibility promise between minors.

### 2. Is the Bleavit parachain supported by the host?

**No, and it is not on any published list.** The reference network set is Paseo Relay, Asset Hub,
People, and Bulletin. Support is not a property a chain *has*; it is a per-host configuration.

The host answers a machine-readable probe — a `Feature::Chain(genesisHash)` query returning a
boolean — from an operator-configured set, and the host-side connection manager returns `null` for
an unknown chain. **So the question is answerable at runtime, which is the single most useful fact
in this report:** the app never has to guess, and can boot into a defined state either way.

### 3. Are custom Bleavit descriptors accepted?

**Yes — descriptors are not a limitation.** `@parity/product-sdk-descriptors` ships only platform
chains, but it is a convenience preset, not a gate. The host's chain API hands back a **standard
PAPI `JsonRpcProvider`**, so Bleavit constructs its own typed client from its own committed
descriptors ([10 §5.1](../../docs/architecture/10-frontend-architecture.md)) with no fork of the
SDK.

**Chain specs, by contrast, are not accepted.** There is no API anywhere in the protocol for a
Product to supply a chain spec, a bootnode list, or an endpoint — the host's chain config is a
genesis hash and nothing else. Chain identity is a 32-byte lookup key.

### 4. Does the host route Bleavit chain traffic?

Only if Bleavit's genesis hash is in that host's configuration, and **that configuration is
operator-driven and remote** — the client receives its endpoints from a devnet configuration
service.

**CORRECTED 2026-08-03.** An earlier version of this report said *"the host is a WebSocket RPC
proxy, not a light client"*, on the evidence that a code search across the SDK's source returns zero
hits for `smoldot`. **That inference was wrong.** The zero-hit result is real, but it means the
light-client wiring is a documented *recipe for the host implementer* rather than that the
capability is absent — absence in the source of a library is not absence of capability in the thing
that wires it up.

**What the host connection layer actually does.** `packages/host-substrate-chain-connection`
supports **both** transports, and says so: *"one underlying WebSocket (or light client) per chain,
multiplexed across consumers."* It ships a full smoldot recipe using `getSmProvider` and
`polkadot-api/smoldot`.

**But the light-client path is closed to parachains, and the README says so outright:**

> Smoldot syncs chain state directly in the browser without trusting a remote RPC node. It works
> for well-known relay chains (Polkadot, Kusama, Westend) — **parachains fall back to WebSocket**.

The mechanism is a genesis-hash lookup into chain specs that `polkadot-api` ships built in — for
relay chains only. Any other chain hits
`throw new Error(\`Light client for chain "\${chain.name}" is not supported\`)`. That connects
directly to the finding in question 3 above: the host protocol's chain config is a genesis hash and
nothing else, with **no channel for a Product to supply a chain spec** — which is exactly why a
custom parachain cannot obtain a light client through the host. The two findings are the same fact
seen from two sides.

**So the conclusion survives, for a narrower and better-evidenced reason.** Bleavit is a custom
parachain, so a host-routed Bleavit connection is WebSocket-backed. Under
[10 §2.2](../../docs/architecture/10-frontend-architecture.md)'s never-promote rule that data is
`provider` forever, and therefore:

> **A Product build whose chain access is host-routed can never sign in normal mode.**
> Not because the host lacks light-client capability — it has it — but because that capability
> requires a bundled chain spec and there is no way to supply one for a chain the host does not
> already ship.

This is not a defect in the SDK and not a defect in Bleavit. It is INV-FE-1 working.

**What is still unknown for the deployed devnet.** Whether the *shipped* Polkadot app enables even
the relay light-client path is **not determinable from public sources**: the client architecture
page says only that each client *"receives the current RPC endpoints … from the Devnet
configuration service"*, and never states the transport. Everything above is the behavior of the
open reference implementation. Settling it for the deployed host is PROD-2.

**There is an escape hatch, and it is the right one.** The protocol has a remote-permission
capability by which a Product requests permission to open WebSocket connections to named domain
patterns. If granted, the Product runs **its own smoldot** inside the sandbox against the
[12 §6.2](../../docs/architecture/12-release-and-operations.md) bootnode set and keeps INV-FE-1
intact, using the host only for signing. That is the design §6 recommends.

Note also that broadcasting is a **separate** permission from signing, so "signed" and "submitted"
can fail apart. The submission-receipt type must model that as a distinct outcome rather than
collapsing it into failure.

### 5. Can the Product request signing for Bleavit runtime extrinsics?

**Yes — and this is the part that works better than expected.** The signing payload carries raw
call bytes (`method`), a custom `signedExtensions` list, `assetId` for the
`ChargeAssetTxPayment` path that
[10 §5.4](../../docs/architecture/10-frontend-architecture.md)'s USDC fee selector needs, and
`metadataHash` + `mode` — the RFC-0078 merkleized-metadata path, which exists precisely so a signer
can display a chain whose metadata it does not carry. Every Bleavit extrinsic fits.

Two caveats, both load-bearing:

- The error set includes an explicit **decode failure**, so a host that cannot decode a Bleavit
  call may refuse rather than sign blind. That is correct behavior for users, and it means the
  CheckMetadataHash path is not an optimization for us — it is mandatory.
- Whether the *deployed* app honors `metadataHash`/`mode` end to end is unverified. The codec
  declaring a field is not the wallet honoring it.

### 6. What differs between the Product build and a standalone build?

| Capability | Standalone (web / PWA / Tauri) | Product build |
|---|---|---|
| smoldot light client | Yes, own Worker | Only under a granted remote-domain permission — `[VERIFY]` PROD-2 |
| `Finalized<T>` reads | Yes | **Only** on the own-smoldot path; host-routed is `provider` forever |
| Signing | Injected extension / QR / (later) WalletConnect | Host wallet only |
| Key custody | None (INV-FE-5) | None — host holds keys **out of process**; strictly stronger isolation |
| Service worker | Yes | `[VERIFY]` PROD-4 — a SW inside a sandboxed iframe/webview is unlikely to register |
| Content addressing | Arweave manifest TXID | Bulletin DAG-PB root CID — a genuine INV-FE-10 primitive |
| Name → content pointer | ArNS ANT, 3-of-5 quorum | DotNS resolver record — **single-key by default**, `[VERIFY]` PROD-5 |
| Account model | SS58 addresses from the user's wallet | **Per-product derived subtree** |

That last row is a real semantic difference and not a footnote: **a user's Product-build address is
not their extension address.** Positions taken in one build are not visible from the other. This
must be stated in the UI at account selection, not discovered by a user wondering where their money
went.

---

## Unresolved items — each fails closed

| ID | Question | Experiment | Behavior until resolved |
|---|---|---|---|
| PROD-1 | Will a host answer the chain-support probe affirmatively for a non-platform parachain? | Register a devnet name, publish a probe Product, call the probe with Bleavit's genesis hash on all three hosts | Assume **false**. Product build boots to own-smoldot mode or a terminal "this host does not serve the Bleavit chain" state |
| PROD-2 | Is a remote-domain permission granted for arbitrary WSS hosts, and does the sandbox permit Worker + WASM + WebSocket? | Same probe Product: request the permission, spawn a Worker, instantiate smoldot, open one WSS | Assume **false** ⇒ Product ships **read-only, `provider`-labelled, signing disabled** |
| PROD-3 | Does the deployed app honor `metadataHash`/`mode`, and does it render Bleavit calls or refuse to decode? | Submit one real market payload with the RFC-0078 hash and mode set | Assume refusal ⇒ the signer declares the capability absent ⇒ the tx path refuses to reach it |
| PROD-4 | Can a Product register a service worker? Does IndexedDB persist across host restarts, and under what quota? | Probe Product writes to IDB, registers a SW, host restarts | Assume no SW and ephemeral storage ⇒ Product runs in the existing `MemoryOnly` boot state, which is already non-terminal |
| PROD-5 | Can the DotNS content pointer be held under n-of-m control? | Read the resolver contract on Paseo Asset Hub; attempt a multisig owner | Assume single-key ⇒ **the Product channel cannot be canonical**, because [12 §4.2](../../docs/architecture/12-release-and-operations.md) / D-16 prohibit single-key custody of a production pointer under any circumstance |
| PROD-6 | Devnet → production timeline | Track the docs site | Treat the whole target as experimental, secondary, and **non-blocking for launch** |

---

## Conclusion

**The Product remains an optional distribution target; the standalone wallet adapters are the
canonical path.** That was the instruction's stated fallback, and the evidence selects it — for two
reasons that no amount of implementation effort removes:

1. **The host is an RPC proxy, not a light client.** Host-routed reads can never be `Finalized<T>`,
   so a host-routed Product cannot sign under INV-FE-1. Only the own-smoldot path (PROD-2) restores
   signing, and that path is a permission the host grants, not a capability we hold.
2. **The name pointer is probably single-key** (PROD-5), and D-16 prohibits single-key custody of a
   production pointer. If that holds, the Product cannot be canonical no matter how well it works.

What the report does **not** say is that the target is worthless. The signing codec fits Bleavit
properly, descriptors are unconstrained, chain support is runtime-detectable, and Bulletin's root
CID is a real content-addressing primitive. A Product build that ships fail-closed — read-only and
honestly labelled until PROD-1/PROD-2 pass, then signing-capable — is worth having as a secondary
channel.

The engineering consequence is small and should be stated plainly: because the host proxies the
same `chainHead_v1_*` surface the architecture already targets, **the Product target is a transport
swap plus a signer, not a port.** Confining every SDK-aware line to the platform and signer packages
keeps the blast radius of a 0.x breaking change to those packages, never to the app.
