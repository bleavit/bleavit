---
paths: ["app/**"]
---

# App code rules (canonical cross-platform Bleavit client)

The frontend invariants INV-FE-1…15 (`docs/architecture/15 §2`) are normative and
certification binds to their exact texts. The app lives at `app/` (10 §10.1) — the single client monorepo, moved there from
`frontend/` on 2026-08-03 with N10's `packages/bleavit-client-ts` unchanged.
Practical consequences:

1. **Authoritative reads (INV-FE-1).** Transaction-critical values come only from
   finalized, light-client-verified state. RPC-fallback, provider, or **host-routed
   (Product SDK)** data is never promoted to verified; verified status requires a
   light-client re-read. `transport-host` reads are `provider` forever — there is no
   promotion path, so a host-routed build cannot sign in normal mode.
2. **Provenance typing (INV-FE-9, 10 §2.1).** Every displayed value carries a typed
   status — six of them: `verified-finalized` / `verified-best` / `derived-local` /
   `provider` / `stale-cache` / `external-proposal`. **`Finalized<T>` is constructible
   only inside `app/packages/chain-client`** — its brand is a module-private
   `unique symbol` **in the type itself** (a structural intersection over
   `status.kind` alone is satisfiable by any object literal, which is the defect an
   earlier draft of 10 §2.1 shipped). The single `as Finalized<T>` lives in
   `chain-client/src/provenance.ts`, and `as unknown as` is banned across `app/`.
   **The brand does not stop assertions** — `x as Finalized<T>` is a narrowing
   assertion TypeScript permits, proven empirically by the corpus — so
   `app/tools/check-finalized-casts.mjs` is the other half of the control, not a
   belt-and-braces extra. Never put the brand in
   `shared-types`: if the universal sink package can construct it, 10 §2.1 is void
   silently, with green CI. UI components reject unlabeled values by type.
3. **Package firewall (INV-FE-3, 10 §10).** Respect the dependency-cruiser boundaries:
   `signing` and `transaction-builder` never import `providers`/`local-index`;
   nothing above `chain-client` bypasses it; `src/features/tx/**` never imports
   `src/features/analysis/**` or `src/features/handoff/**`. Provider data never
   satisfies a precondition. These are separate TypeScript projects — a forbidden
   import must fail **compilation**, with dependency-cruiser as the second gate.
4. **Pre-sign refresh (INV-FE-2, 11 §11.4).** Every submit path goes through the
   structural `refreshAndGate` — never add a code path that reaches a signer without
   it. The handoff import path's only output is a `TxPreparation` entering **Draft**;
   it adds no edge to the tx machine.
5. **Zero infrastructure (INV-FE-4/6).** Every protocol workflow must work with no
   indexer, no RPC, no provider, no external tool, cleared storage. If a feature needs
   a server, it is out of scope — do not centralize it. **No MCP** in any form: no
   local or hosted server, no tunnel, no sidecar, no background service (D-21).
   **The handoff is the *default* surface (11 §11.2) but never load-bearing:
   demoting a screen behind "Advanced" is permitted, removing one is not.** The two
   properties are independent, and the one that matters is asserted by the 15 §4.8
   no-infra certification run — which executes with the handoff surfaces disabled, so
   a screen that only exists on the imported-action path fails it. When simplifying the
   front door, move surfaces; never delete them, and never make one reachable *only*
   through an external tool.
6. **No telemetry, no remote config (INV-FE-13).** No analytics, no fetch-to-configure
   patterns; behavior changes only by shipping a new verifiable release. The handoff
   packages contain **no network primitive at all** — `fetch`, `XMLHttpRequest`,
   `WebSocket`, `EventSource`, `sendBeacon` and dynamic URL `import()` are gated out
   by CI. Never add a `connect-src` entry for an external tool vendor (12 §5.1).
7. **No hardcoded chain constants.** Everything in 02 §9 is read from chain
   metadata/storage; the no-literal lint gate fails the release otherwise. The TS
   protocol math (`packages/protocol`) must match the CI-regenerated vector corpus
   (04 §5, 15 §4.4) — never hand-adjust an expected value. `CRITICAL_SURFACE` is
   generated from `tools/release/surface-manifest.json`, never hand-listed.
8. **Two ledger domains, never merged (11 §11.2a, 10 §11 — contract v23).** The client serves
   external/hosted books as ordinary S3/S4 surfaces. Domain is a property of the **datum**, derived
   from `SERVICE_ID_BASE = 1 << 63` on an id you already hold — never from the call site, the cache
   key, or a name. **No selector, store slice or component may produce a cross-domain total**:
   solvency (I-4) holds per instance against its own sovereign account, so a merged figure asserts a
   backing pool that does not exist. `account_positions()` ↔ instance `()`, `service_positions()` ↔
   `ServiceLedger`; the FE-P2 conservative cross-check runs against that domain's own prefix, never
   the other's. External activity renders as an operational diagnostic, never as governance
   participation or protocol health.
9. **Local storage is disposable (INV-FE-7).** The transaction path never reads
   IndexedDB; rebuilds are automatic; treat eviction as a performance event.
10. **Fail safe (INV-FE-12).** Unknown runtime ⇒ explicit `restricted`/`read-only-
    incompatible` modes; undecodable data renders as raw SCALE with a warning; never
    guess at encodings. Platform and signer capabilities are a fail-closed lattice: an
    unproven capability is **absent**, and absence disables the dependent surface with
    a named reason — never a silent fallback.
11. **Imported intents are input, not data (10 §10.2, 11 §11.14).** An intent supplies
    a choice among a closed action set, an id, and ceilings — nothing else. It carries
    no free text and no bytes-typed field; `action` and `limits` are closed objects and
    an unknown key inside them is refused (`FE-HANDOFF-004`). Bleavit **never widens a
    limit, only narrows it**. Never accept an encoded call from any external source.
    A capsule MUST carry a labelled book `kind` so an external book's prices can never
    leave the app looking like a governance market's (11 §11.2a).
12. **Pinned versions.** The stack pins live in 01 §9 / 10 — PAPI 2.x, smoldot 3.x,
    Vite 8, Dexie 4, Tauri 2.x. Do not bump majors without a PLAN.md decision-log
    entry. `app/` is its own pnpm workspace and its own cargo workspace (excluded from
    the root one); never let its dependency tree reach the runtime pins.
