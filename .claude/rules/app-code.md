---
paths: ["app/**"]
---

# App code rules (canonical cross-platform Bleavit client)

The frontend invariants INV-FE-1…15 (`docs/architecture/15 §2`) are normative and
certification binds to their exact texts. The app lives at `app/` (10 §10.1); the
former `frontend/` placeholder is retired. Practical consequences:

1. **Authoritative reads (INV-FE-1).** Transaction-critical values come only from
   finalized, light-client-verified state. RPC-fallback, provider, or **host-routed
   (Product SDK)** data is never promoted to verified; verified status requires a
   light-client re-read. `transport-host` reads are `provider` forever — there is no
   promotion path, so a host-routed build cannot sign in normal mode.
2. **Provenance typing (INV-FE-9, 10 §2.1).** Every displayed value carries a typed
   status (`verified-finalized` / `verified-best` / `derived-local` / `provider` /
   `stale-cache`). **`Finalized<T>` is constructible only inside
   `app/packages/chain-client`** — its brand is a module-private `unique symbol`, the
   single `as Finalized<T>` cast lives in `chain-client/src/finalize.ts`, and
   `as unknown as` is banned repo-wide in `app/`. Never put the brand in
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
8. **Local storage is disposable (INV-FE-7).** The transaction path never reads
   IndexedDB; rebuilds are automatic; treat eviction as a performance event.
9. **Fail safe (INV-FE-12).** Unknown runtime ⇒ explicit `restricted`/`read-only-
   incompatible` modes; undecodable data renders as raw SCALE with a warning; never
   guess at encodings. Platform and signer capabilities are a fail-closed lattice: an
   unproven capability is **absent**, and absence disables the dependent surface with
   a named reason — never a silent fallback.
10. **Imported intents are input, not data (10 §10.2, 11 §11.14).** An intent supplies
    a choice among a closed action set, an id, and ceilings — nothing else. It carries
    no free text and no bytes-typed field; `action` and `limits` are closed objects and
    an unknown key inside them is refused (`FE-HANDOFF-004`). Bleavit **never widens a
    limit, only narrows it**. Never accept an encoded call from any external source.
11. **Pinned versions.** The stack pins live in 01 §9 / 10 — PAPI 2.x, smoldot 3.x,
    Vite 8, Dexie 4, Tauri 2.x. Do not bump majors without a PLAN.md decision-log
    entry. `app/` is its own pnpm workspace and its own cargo workspace (excluded from
    the root one); never let its dependency tree reach the runtime pins.
