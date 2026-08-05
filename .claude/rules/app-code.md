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
   `app/tools/check-finalized-casts.ts` is the other half of the control, not a
   belt-and-braces extra. Never put the brand in
   `shared-types`: if the universal sink package can construct it, 10 §2.1 is void
   silently, with green CI. UI components reject unlabeled values by type.

   **A third control covers the render edge**: `<Panel title={`Referendum ${id.value}`}>`
   typechecks perfectly and puts a chain read on screen with no badge, because the payload
   of a `Verified<string>` is a `string`. `app/tools/check-render-provenance.ts`
   (+ `:witness`) is type-aware for a reason — a syntactic version fires on `key={...}`,
   on `event.currentTarget.value` and on the verification panel's release-constant rows,
   and a gate that fires on correct code gets switched off. Its **rule B** is the one that
   is easy to write by accident: a value derived from two reads carrying *one* input's
   status promotes provider data to verified **by arithmetic**, which no badge type and no
   firewall rule can see. Use `combine`/`combine2` from `@bleavit/shared-types` — the
   result takes the weakest input's status, and two verified reads at **different blocks**
   refuse outright rather than claiming a block neither describes. Render the refusal with
   `<Derived>`; a missing figure must look missing, since rendering nothing is how "we
   cannot say" becomes indistinguishable from zero.
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
   metadata/storage; the no-literal lint gate fails the release otherwise.
   **`CRITICAL_SURFACE` and `SUPPORTED_RUNTIMES` are generated and compared, never typed** (F4):
   the first re-derives from `tools/release/surface-manifest.json`, the second is checked in
   both directions against `app/fixtures/chain-feed/`. Run `pnpm -C app run surface:generate`;
   never hand-edit the output and never edit a source to match an output. The TS
   protocol math (`packages/protocol`) must match the CI-regenerated vector corpus
   (04 §5, 15 §4.4) — never hand-adjust an expected value. `CRITICAL_SURFACE` is
   generated from `tools/release/surface-manifest.json`, never hand-listed.

   **The rule governs chain *tunables*, not the math kernel** (classified
   2026-08-03, PLAN.md · Decision log). `packages/protocol` compiles in the 64-entry
   `exp2` factor table, `ln 2` to 96 bits, the guard-bit count and
   `LMSR_DOMAIN_BOUND = 48` because the package **is** the 04 §4 kernel: none of
   those has a 02 §9 row, a `Params` key, or a governance track that can move it,
   and there is nowhere to read them from. `USDC_ONE` (D-17 identity pin) and
   `BPS_DENOMINATOR` (the unit 02 §9 publishes `Market::Fee` in) are classified the
   same way. Everything that *is* a tunable — `mkt.fee`, `mkt.kappa`,
   `mkt.obs_interval`, `MinTrade`, `MaxTradeRatio` — is a **function argument with
   no default**, so a caller that forgets one gets a type error rather than a stale
   launch value baked into a quote.

   **The no-literal gate landed with F11**: `pnpm -C app run check:chain-literals`
   (+ `:witness`). It parses 02 §9's own frozen-constant table and applies two rules —
   **A**, a frozen constant's *name* bound to a numeric literal (which stays a defect
   when the value is currently right), and **B**, a distinctive frozen *value* appearing
   bare, restricted to four-digit-plus values because `32` and `64` are hash widths and
   array sizes everywhere. Exemptions are **classified groups** in
   `app/tools/release/sources/chain-literal-classification.json` — a value, in named
   files, for a stated reason — never line waivers, so a new file cannot inherit one by
   copying a number. The kernel constants are one such group, as this rule required.

   **Corollary — the port reproduces the runtime's integer path, deliberately.**
   Arbitrary-precision decimals would be *more accurate* and would be wrong: 04 §6.1
   refuses a trade when `cost + fee > max_cost`, and three roundings decide the last
   base unit (`fx` floors, the ×10⁶ rescale truncates, the charge ceils). Never
   "improve" the precision of `packages/protocol` — a quote a base unit under the
   chain's own figure hands the user a transaction that reverts.
8. **Two ledger domains, never merged (11 §11.2a, 10 §11 — contract v23).** The client serves
   external/hosted books as ordinary S3/S4 surfaces. Domain is a property of the **datum**, derived
   by comparing an id you already hold against the **`ConditionalLedger::ServiceIdBase` metadata
   constant** — never from the call site, the cache key, or a name, and never from the literal
   `1n << 63n`, which rule 7 forbids and which is why 02 §9 gives the boundary a metadata home at
   all. **No selector, store slice or component may produce a cross-domain total**:
   solvency (I-4) holds per instance against its own sovereign account, so a merged figure asserts a
   backing pool that does not exist. `account_positions()` ↔ instance `()`, `service_positions()` ↔
   `ServiceLedger`; the FE-P2 conservative cross-check runs against that domain's own prefix, never
   the other's. **Writes route the same way**: the two ledgers are two pallets, so a service-domain
   split/merge/transfer/redeem is built against `ServiceLedger.*` and a primary one against
   `ledger.*`. Only `market.buy/sell` are domain-agnostic (the market pallet routes internally).
   Never give a transaction builder a default instance — and do not offer the gate or `*_baseline`
   calls on a hosted position, which has neither leg. External activity renders as an operational
   diagnostic, never as governance participation or protocol health.
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
12. **The chain feed is generated, committed and drift-gated — never hand-edited (F2, 10 §5.1).**
    `app/fixtures/chain-feed/<spec_version>/`, `app/fixtures/chainhead/` and
    `app/packages/papi-descriptors/` are all **produced** by `tools/release/` and PAPI,
    and all three are committed because 10 §5.1 requires descriptors committed per
    `spec_version` and because `install --frozen-lockfile && tsc -b` must work offline
    (the Arweave distribution and the INV-FE-4 no-infra run depend on it). Regenerate
    from `app/fixtures/chain-feed/README.md`; never patch a file in place, and never
    "fix" a red drift gate by editing the artifact it is comparing.
    **The pair is not optional**: a primary runtime and its terminal-recovery runtime
    are separate live-capable `spec_version`s and both must be present, because the
    recovery image can become current under `OnlyInherents` and treating its descriptors
    as operator-only strands the canonical frontend during exactly the incident they
    exist for. `tools/ci/check-chain-feed.py` enforces the pairing itself — half a pair
    reads as a complete feed to any consumer that opens one directory.
    **Assert bounds against the specification, not against the recording.** Reading 32
    out of a fixture and asserting it equals 32 proves nothing; 02 §9's frozen table is
    the expected value, so a runtime that changed a bound fails even though its own
    metadata is self-consistent. Likewise a **whitelist is not a surface check**: PAPI's
    `applyWhitelist` filters silently, so an entry naming an absent surface yields a
    smaller descriptor set rather than an error.
13. **One chain connection, one home (10 §2.1/§4.1, F3).** `packages/chain-client` is the only
    package that may import `polkadot-api` or `smoldot`, enforced by
    `only-chain-client-opens-a-chain-connection`. The reason is not tidiness: a second package
    able to construct a chain connection would not need to forge the brand — it could serve reads
    that never passed the finalized-only discipline. `bleavit-client-ts` and `papi-descriptors`
    are exempt because they are not part of the canonical client. Inside the package, the
    transport is **injected** and reads take the block **explicitly** (`storage(at, …)`), so
    "read at the block I pinned" is unbypassable rather than checked around — a guard that
    re-checks the head before issuing a read does not prevent the read happening after it (V-84).
    A chain spec is trusted input to smoldot: verify the **bundled bytes** against the release
    pin first, apply any expert bootnodes after, and treat the §3.1 genesis check as a separate
    obligation the hash pin does not discharge.

    **dependency-cruiser records any specifier it cannot resolve verbatim** (V-86, V-92) — an
    uninstalled external package *and* a workspace subpath export like
    `@bleavit/signing/testing`, whose `exports` map enhanced-resolve does not follow. A rule
    written against only the resolved path can never fire. Use `EXTERNAL()` /
    `WORKSPACE_SUBPATH()` from `app/tools/depcruise-external.ts`, and add a witness module —
    a rule proven only by a green run is not proven.

    **The same applies to the negative-compilation corpus** (V-91): a fixture must declare the
    error it produces (`// expect-error: TSxxxx` on line 1), because "did not compile" is also
    what a missing dependency looks like.
14. **No control characters in source, and `cat -A` is how you find them.** Twice in one
    session a byte below 0x20 reached a source file and broke something in a way that read
    as a logic error: a literal **NUL** in `tests/receipts` (which made git classify the
    file as binary, so its diffs showed no lines and `grep` skipped it silently), and a
    literal **backspace** inside a regex, produced by writing `\b` through a shell heredoc
    — the pattern then matched nothing while the assertion failed on a string that plainly
    contained the word. Neither is visible in an editor or in a diff. **Prefer writing
    files with the Write tool or a Python heredoc over shell interpolation for anything
    containing backslash escapes**, and reach for `cat -A` the moment an assertion fails
    against a value that obviously satisfies it. The tree is currently clean; a sweep is
    four lines of Python over every source file.

15. **Pinned versions.** The stack pins live in 01 §9 / 10 — PAPI 2.x, smoldot 3.x,
    Vite 8, Dexie 4, Tauri 2.x. Do not bump majors without a PLAN.md decision-log
    entry. `app/` is its own pnpm workspace and its own cargo workspace (excluded from
    the root one); never let its dependency tree reach the runtime pins.
16. **The release tree is derived, and its inputs are what you edit (F11, 12 §1/§5).**
    `app/dist/` and `app/release-out/` are build output. The committed inputs are
    `app/tools/release/sources/`: where each `connect-src` class comes from, the
    INV-FE-11 chain-identity pins, the signing keyring, the 15 §4.8 diff baseline.
    **Never widen the allowlist by editing the emitted policy** — it is substituted into
    `index.html` at build time — and never add an external-tool vendor host to any
    source (D-21, 12 §5.1). An intended addition is a diff to *two* files, the source
    and `incumbent-connect-src.json`; that second edit is the entire control, because
    nothing mechanical distinguishes a gateway from a vendor endpoint dressed as one.
    A pin that cannot exist yet is a **readiness blocker**, never a `null` that ships:
    `release:build --production` refuses while any stands.
