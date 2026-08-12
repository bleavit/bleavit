# Unsorted current-focus history

> **F24 — the provider wire — is done, and Track F has no buildable item left.**
>
> **Done 2026-08-07**: PR #265 (`track-f/provider-wire`) at `e1949d9e`, **22/22 checks SUCCESS**,
> verified per check rather than from the rollup. R-6 is satisfied on both conjuncts — the R-6
> re-review returned **0 blockers**.
>
> §8.5.1's archive reader, §8.5.2's indexer client with `optional/indexer/`, and §8.5.3's probe
> driver all ship. Along the way this session ruled **SQ-612, SQ-613, SQ-771, SQ-982, SQ-983 and
> SQ-984** under R-1, and wrote the new **10 §8.5** they live in.
>
> **Four review rounds in one day, and every round found the same shape**: individually correct
> functions whose defect existed only in their composition, under a suite that covered each half
> separately. `readRange` ran the full snapshot screen set, so every ranged read that did not
> reach genesis was refused — the route's own parameters were unusable. Fixing that exposed
> `samplingPages` feeding a **fold** into a comparison against **chain state**, which would have
> auto-disabled every honest operator; it was unreachable only because the first defect masked it.
> Fixing *that* left the `claimed` contract still naming the wrong representation with **no test
> composing the two halves at all**, so the defect could be rewritten from its own documentation.
> And the §8.1 disclosure asserted a ten-minute heartbeat the shipped app does not perform.
>
> **Eight questions ship open rather than answered** — SQ-986…SQ-993. The sharpest is **SQ-986**:
> this milestone's own `balances` ruling is **not expressible** with the current sampler types,
> because `ChainRead` takes a key and no block. It is recorded, not coded around.
>
> **PARKED:** — **audited 2026-08-07 and largely WRONG. The corrected list is below.**
>
> This block claimed seven Track F rows *"cannot close by any amount of work"*. An audit of every
> claim, run because a Stop hook refused to accept the assertion twice in one day, found that the
> park was written on top of **a finished commit nobody proposed**. `7dcb9a81` on
> `track-f/f1-prototype-gates` resolves **eight of F1's twelve prototype gates**, and
> `gh pr list --state all` shows no pull request was ever opened for it. It is now **PR #266**.
>
> **The tell was in this file.** `main` cited **SQ-940** four times and carried **zero rows** for
> it — the same for SQ-941, V-300, V-301, V-303 and V-306. Earlier squash merges kept the prose
> and dropped the table rows, and this block was then written on the stale F1 row. So the
> statement *"SQ-940 blocks launch"* was repeated for a row not in the repository.
>
> **What the three audits established, per row:**
>
> - **F1** — *buildable, now in flight.* PR #266. Its content retires the FE-P10 claim that held
>   F17: `apply_authorized_upgrade` is `DispatchClass::Operational`, so the ceiling is 5,242,880 B
>   against a ~1.89 MB image, and smoldot's 1 MiB notification cap is inbound-only.
> - **F14** — *its blocker sentence was false on both halves.* Its first-ever R-6 review returned
>   **0 blockers**. §9.2's auto-tuner does **not** need the device lab: `[VERIFY — FE-P4]` sits on
>   §6.4's *backfill throughput*, a different quantity, and the measured-rate computation already
>   exists from the database (`quota.ts:586,596`). Three majors are buildable, one of them large —
>   **the quota manager has no production caller**, so §9.2's 300 MB/75 MB caps are not held on a
>   running client at all.
> - **F17** — *not held by FE-P10.* Its first-ever R-6 review returned **2 blockers**, both fixed
>   here, plus five majors. Its four "closed" controls are **decidable**, not blocked: SQ-730 is
>   doc-truing that moves no surface, and SQ-598/601/602/731 need a `FutarchyApi` addition, which
>   R-1 delegates outright — the precedent is contract v28 in this branch's own base.
> - **F11** — the readiness blockers number **13**, not ten (`pnpm -C app release:check`). Seven
>   are external; **three are decidable** under R-1 and **three are buildable** — the Asset Hub
>   descriptor set still says *"blocked on SQ-587"*, and SQ-587 was ruled on 2026-08-04.
> - **F13** — half buildable. Both `release:build` runs already happen on independent runners
>   (`ci.yml:816`, `:952`); no artifact is uploaded, so nothing compares them. The compare step is
>   the missing part, not the second environment.
> - **F15** — buildable. `deploy/ops-handbook/README.md` has no §6.3 and no §6.4 section, and both
>   are role-keyed procedure writable with every holder still `VACANT`.
> - **F18** — decidable, then buildable. A chain-spec generator exists
>   (`tools/deploy/generate-chain-specs.sh`) with a `dev`/`local` validator profile, and no spec
>   sentence requires production provenance for a pin. The ruling is whether a dev pin channel may
>   exist beside the production one.
>
> **What is genuinely external, and it is a much shorter list than seven milestones:** the key
> ceremony and its ≥2 attestations, the bootnode operator programme, genesis and paraId, hardware
> wallets for the Ledger leg, the ar.io custody commitment (the *only* part of SQ-940 that is
> the user's — the platform facts are not), and four device-lab rows in 10 §9.4 (memory mobile,
> mobile CPU, ingest throughput, sync latency) plus FE-P10's memory and liveness halves.
>
> **The lesson, since this is the second false park in one day:** a park is a claim about the
> world and it decays. Re-test it before repeating it, and never state it about a whole milestone
> when the evidence is about one named half.


> ### ⇨ CURRENT (2026-08-07, latest) — **F23/F25's R-6 review: one range answered two ways, and the guard that was supposed to notice had been scoped around the drift a second time**
>
> **Branch `integration/track-f-v2`. Neither F23 nor F25 is marked ✅ by this work** — F23 moves
> ⬜ → 🔨, which is what it should have been since 2026-08-07 morning, and F25 stays 🔨. The review
> found 1 blocker, 2 majors and 11 minors; this round clears the blocker, the first major and two
> named minors, files two spec questions and settles neither.
>
> **The blocker — the same range read as *checked against the chain* on one surface and *could not
> be checked* on the other.** `coverage-view.tsx` rendered a `checked` edge as *"this device read the
> block hash and runtime version at this range's edge, and both are checked against the chain"*,
> under a column headed *"What was checked at its edge"*. 10 §6.3 defines that arm as *"all three
> facts, all three checks **can** run"* — the facts are **falsifiable**, not compared — and the
> verdict of a comparison lives in `CoverageVerification`, which `CoveredHistory` **does not carry**
> (V-340). §6.3 says an `ok` verdict must never be inferred, and the column inferred one. It was not
> a hypothetical: nothing in this release pins a genesis (V-260), so `cannotObserve` is the observer
> and **every** range verdicts `unchecked` — the same range that F25's boot surface lists under
> *"Ranges this client could not check"*.
>
> The column now states what the edge **records**: *"a genesis binding, the block hash and the
> runtime version at this range's edge, so this range can be compared against the chain"*, with the
> `unverifiable` arm as *"a genesis binding only — «why»"* (§6.3's one surviving check, plus the
> reason the other two facts are absent), under the header *"What its edge records"* and beside a
> new `EDGE_IS_NOT_A_VERDICT` sentence saying the answer carries no verdict. **The stronger reading
> — that the surface should say *was* compared — needs the verdict to travel with `CoveredHistory`,
> which is a shape change nobody has authorised: filed as SQ-980 and left open.**
>
> **The `checked` branch had no fixture, and that is what hid it.** Every coverage fixture used
> `EDGE = { kind: 'unverifiable' }` — including `selfRange(70, 80, 0, EDGE)`, a `self` range with a
> provider's edge, which is a combination §6.3 does not describe. `self` ranges now carry a
> `checked` edge and the rendered note is asserted, positively and negatively.
>
> **Major 1 — the normative copy drifted again, and the binding was scoped around it again.**
> `SAMPLING_GUARANTEE` said *"comparing two independent **sources**"* where 10 §8.4 and §2.3 both say
> *"two independent **snapshot producers**"*. In this client's vocabulary a *source* is any provider
> (`Provider.kind` is `snapshot | indexer`; the panel is headed *"Optional data sources"*), so the
> one sentence telling a user what to **do** about the blind spot named a cross-check `FE-PROV-004`
> does not implement — that code fires on two snapshots of one range, and two indexers produce
> nothing to diff. **The clause table in `tests/providers/health.test.ts` paired §8.4's clause with
> the substituted rendering** (V-342), which is the second time that table has been scoped around
> the drift it exists to catch — `labels` for `recommends` was the first. Copy fixed, pair
> re-pointed, and F23's check gained the **constant → document** direction it lacked: it was doc→doc
> only, so it asserted what the *document* says and nothing about the shipped string.
>
> **Minor A — a guard reported to the user as sound, which could not fire.** F23's badge assertion
> `badges.size === 1` carried the message *"the three no longer share one badge — re-point this
> test"*, but `badgeCopyFor` is a pure switch and all three calls passed `providerStatus('pub-1',
> false)` — byte-identical arguments, so the size was 1 unconditionally, and the scenario the
> message describes needs a third `ProviderStatus` field that would break the call site at
> **compile** time. The three statuses now come from `mintSnapshotRows`' own output over three
> really-admitted documents, so the assertion is about the mint. **Proven either way** (V-341): under
> a mint mutant that badges two of the three `sampled`, the old form did **not** fire and the new
> one fails with exactly its own message.
>
> **Minor B — one §6.3 sentence, two implementations.** `distinctSources` walked the ranges itself in
> first-seen order while `coverageBoundarySet` sorted, and `coverage.ts` warns against exactly that
> immediately above its own delegation. `distinctSources` is now `boundarySet(...).map(humanSource)`
> — the set comes from the one place that decides it, and the human phrasing lives in one function
> that the per-row *Source* cell also goes through, so a source cannot end up with two names on one
> screen.
>
> **Gates:** `pnpm -C app install --frozen-lockfile` · `build` · `check:types` · `pnpm -C app test`
> exit 0 at **1,835 tests** across 20 suites, 0 failures · `depcruise` 0 errors (2 pre-existing
> orphan warnings) · `depcruise:witness` fired · `check:casts` (+ witness) · `check:chain-literals`
> (+ witness) · `check:render-provenance` (+ witness) · `check:provenance-mints` (+ witness) ·
> `check:covered-history` (+ witness) · `check:no-html-sinks` (+ witness) · `check:above-fold` ·
> `check-plan-tables.py` · `check-spec-question-batches.py`. Control-character sweep clean over every
> changed file. **10 mutants, 0 survived**, plus the M7 control that measures the old badge
> assertion surviving the mutant the new one kills. **Next:** CI on `integration/track-f-v2`, then
> the review's second major and its nine remaining minors.

> ### ⇨ CURRENT (2026-08-07) — **F7b's R-6 review: two blockers cleared, and both were defect classes this milestone had already repaired once — on the surfaces the earlier rounds did not reach**
>
> **Branch `integration/track-f-v2`. F7b stays 🔨 and is not marked ✅ by this work.** The review
> found 2 blockers and 3 majors; this round clears the two blockers and the first major, files the
> five spec questions the review raised without settling any of them, and leaves the second and
> third majors open.
>
> **Blocker 1 — a provider read could satisfy a payout precondition.** `redemption-ticket.ts` typed
> every leaf `Verified<T>`, which admits `provider`, `stale-cache`, `derived-local` and
> `external-proposal`. So an operator snapshot's rate and `MinSplit` produced a `charged` quote and
> `mayPrepareRedemption() === true` — on the net payout §11.5 rule 3 makes the headline and §11.2
> constraint 3 emits above the fold. 11 §11.4 rule 4 and §11.5 rule 5 both forbid it. **This is the
> defect closed on `trade-ticket.ts`, and the reason it survived here is that the trade ticket had a
> `tests/firewall` fixture and this module did not** — so a provider read compiled. Every leaf is now
> `Finalized<T> | undefined`, and
> `tests/firewall/fixtures/provider-cannot-satisfy-a-redemption-precondition.ts` mirrors the trade
> fixture (V-320, V-321).
>
> **The first form of the test that guards it was itself the defect.** `assert.match(source,
> /minSplit: Finalized<bigint>/)` matched the *interface* one screen up, so a mutant that reverted
> only `redemptionRateBlocks`' own **parameter** survived it. The assertion is now *this module names
> `Verified<` nowhere*, which is complete over the signatures too — and both evaluators are exported
> deliberately, so a leaf in either is a provider read entering by another door.
>
> **Blocker 2 — three mandated reads were declared and never performed.** `POSITION_READS` named
> `ConditionalLedger.Vaults`, `ConditionalLedger.BaselineVaults` and `ServiceLedger.Vaults` under a
> comment calling them *"the frozen 02 surfaces this screen reads"*, and nothing built a key, a
> decoder or a read for any of the three. So vault state reached the VOID layout and the
> redemption-call selection through `PositionView.vault_state` alone, with no FE-P2 cross-check — on
> the one field that decides which redemption call is offered. **And the test written to prevent
> exactly that asserted `'baselineVaults' in POSITION_READS.primary`**, a check on an object literal
> in the same file: this repository's defining defect sitting inside its own guard (V-322). All three
> are read now, per domain, and the suite asserts the **recorded `storage` calls on the reader port**
> rather than the fields of a frozen record.
>
> **Major — a badged zero the chain never returned.** A failed `quote()` decode substituted
> `{cost: 0n, fee: 0n}`, `derive`d it from the read, and rendered `0.000000 USDC` with a
> `verified-finalized` badge under *"What the chain says this costs"*. 10 §2.2 gives that status only
> to values read through smoldot or computed purely from them; §11.5 forbids rendering a fail-closed
> zero quote as a market price. **This is V-183's defect** — repaired in `balance-reads.ts` as *absent
> figure, not badged zero* — surviving one module over (V-323). The chain-side quote is now
> **absent** on a decode failure, the screen renders a `BalanceUnreadable`-shaped refusal, and the
> ticket still blocks — on a `P-1 quote()` row that deliberately carries **no** `FE-CHAIN-005`,
> because E6's code and this client's recovery copy both assert a *disagreement*, which is not what
> an undecoded quote is.
>
> **Five spec questions filed and none settled** (SQ-960…SQ-964): the `quote()` cross-check
> tolerance, P-7's stale `fee(a)` text against rule 2's `fee_pair`, which `PhaseFlags` bit means
> trading-enabled, whether P-1/P-2 owe P-3's fee-headroom clause, and what *"holds a pair"* means in
> §11.6 step 1. **A sixth is mine** (SQ-965): an undecodable `PhaseFlags` fails closed and the screen
> then states *"a ledger freeze is active"*, which is a sentence about chain state the chain never
> made — the same defect class as the major, on a boolean rather than on a figure.
>
> **Gates:** `pnpm -C app install --frozen-lockfile` · `build` · `check:types` · `pnpm -C app test`
> exit 0 at **1,834 tests** across 20 suites, which is every gate in the aggregate ·
> `test:firewall` 28 fixtures (27 forbidden + the positive control) · `depcruise` 0 errors (2 pre-existing orphan warnings) ·
> `check:embedded-tree` (+ witness) · `check-plan-tables.py` · `check-spec-question-batches.py` ·
> `check-client-surface-obligations.py` · `check-dispatch-mirror.py` · `check-chain-feed.py`.
> **16 mutants, 0 survived** — one survived the first pass (M3) and killed the assertion that let
> it, which is recorded above rather than quietly repaired. **Next:** CI on
> `integration/track-f-v2`, then the review's second and third majors.

> ### ⇨ CURRENT (2026-08-07, latest) — **F25: the disclosures F8 kept producing finally have a reader, and what a user sees today is *no index was opened***
>
> **Branch `track-f/f25-index-disclosure`. F25 stays 🔨 by instruction — GitHub Actions has been in a
> major outage all session, so no run has executed against this work and R-6's gate conjunct has no
> evidence.**
>
> **The row existed because five review rounds of F8 each found the same shape one layer down: a
> checker with no call site, an error code with no emitter, a record on a channel no query reads.**
> `checkIndexAtBoot` now has a production call site, `boot()` runs it, and `IndexBootDisclosure`
> renders what it returns as the shell's **unconditional first child** — outside the outlet, so on
> every route.
>
> **The wiring did not need a chain, and that is the part worth knowing.** 10 §3.1 puts `StorageOpen`
> before `WorkerSpawn`, and §6.3 already defines the answer for a chain that cannot be reached —
> *cannot say*, which **keeps** the range. So `cannotObserve` is the honest observer rather than a
> stub (V-262: nothing in this client calls `startLightClient`), and every range verdicts `unchecked`
> by construction, which is exactly the set a surface must not drop.
>
> **What a user reaches today is `not-opened`.** `release-sources.json` pins
> `genesisHashes.para: null` (V-260) and 10 §7 gives the index one database per chain identity with
> no default, so there is nothing to open. That is a third arm rather than an absent report, because
> *an index nothing opened* may not render as *an index that was opened and was fine* — §6.3's
> asymmetry applied to the boot path itself. The claim is bound to the release file, so a pin fails
> the suite rather than leaving the wiring unreached.
>
> **The copy rule is a type, not a convention.** `DisclosureCopy` is `stated` (a sentence plus the
> section whose rule it discharges) or `awaiting` (the record's own fields, the slot marked, the open
> rows named), and there is no third arm. **Four slots wait, all on `FE-IDX-002`**: `ranges-dropped`,
> `ranges-invalidated`, `raw-blobs-evicted` and `chart-rows-discarded`. Both halves are
> machine-checked — a citation must resolve to a real section, and a waiting slot must name rows
> PLAN.md still lists as **open**, which fails the day SQ-604 is ruled.
>
> **Three findings the row did not name.** `unchecked` has two causes with different futures and
> `CoverageVerification` carries no discriminator (**SQ-922**, V-261); a coverage entry dropped by
> `sanitizeCoverage` is a **third** `FE-IDX-002` candidate with a third recovery (**SQ-921**); and the
> surface has **no 11 §11.2 inventory id**, the same gap F23 found in the provider UI, so none was
> minted (**SQ-920**).
>
> **Gates (local only):** `build` · `check:types` · `pnpm -C app test` exit 0 at **1,766 tests**
> (`test:analysis` 9 → 35) · all 27 `app/` gates · `depcruise` 0 errors · PLAN tables ·
> spec-question batches. **24 mutants, 0 survived** — three re-expressed (one stale anchor, two
> `tsc` refusals). **Next:** CI and an R-6 review of F25; `CoveredHistoryDisclosure` reaches no route
> until a history screen is wired (F7b/F23).

> ### ⇨ CURRENT (2026-08-07) — **F8's fifth review: three rounds of repairs each landed where the finding pointed, and the harm had moved**
> ### ⇨ CURRENT (2026-08-07, latest) — **F7b's named remainder is built: S2's finalized decision dashboard and the four composition roots — and building the roots is what falsified three shipped models**
>
> **Branch `track-f/f7b-close`, cut from `integration/track-f-v2`. F7b stays 🔨 and must not be
> marked ✅ yet**: GitHub Actions has been out all session, so **no CI run has executed against any
> of this** and R-6's gate conjunct has no evidence. Everything below is local.
>
> **What landed.** `app/src/features/tx/src/screen-composition.ts` — the keys, decoders and call
> arguments for S2, S3, S4 and S20, built from this chain's own metadata and descriptors. Four
> readers had been declaring them and nothing in `app/src` was building any of them, so each was
> a function no caller could reach. `packages/chain-client` gained the runtime-API half of its
> codec surface (`apiDecoder`, `apiArgs`, `decodeApiResult`, `concatDigestBytes`), because
> `FinalizedReader.call` returns opaque hex and only the chain's own codecs can read it. S2's
> dashboard renders 02 §4's `DecisionStatsView` whole.
>
> **Writing a decoder is what falsifies a model, and it did so three times.** Each defect was a
> field with no chain behind it, and each was invisible while nothing had to produce a value for
> it. `DecisionStats` carried `outcome` and `upliftPpm`, **neither a field of the view** — the
> outcome is the proposal's own `state`, so a second string beside it was a client-authored
> verdict wearing a `verified-finalized` badge. `ProposalSummary.title` had no source anywhere on
> this chain (**SQ-860**). `STATS_REQUIRE_SEALED` named three states that are not `ProposalState`
> variants and missed four that are; `trade-ticket.ts`'s union named five more that do not exist
> (**V-221**). All three were fail-closed and none was harmless.
>
> **Two measured traps closed at the root (V-220).** An SS58 address handed to the position views'
> `[u8; 32]` argument codec encodes to **25 well-formed bytes with no error**, and
> `account_positions()` answers it with an empty portfolio — on the screen whose whole job is
> holdings. And a `(PositionId, AccountId)` storage key must be split by decoding then
> **re-encoding** the id to learn its length: the runtime's own fixture publishes the two variants
> precisely because their encodings differ, 11 bytes against 6.
>
> **The screens stay `built-unwired`, deliberately.** A composition root is not a runtime path.
> `app/tools/release/sources/release-sources.json` declares `chainSpecs: []` with both
> `chainSpecHashes` null and nothing calls `startLightClient`, so no transport exists to reach
> them — F18's artifact-blocked remainder, not F7b's. Moving a screen to wired on the strength of
> a root alone would be a claim nothing can honour.
>
> **Local evidence:** 18 mutants, 0 survived (one re-run in a compiling form). App suite **1,758
> tests, 0 fail**, plus build, types, depcruise, descriptors, `check-chain-feed.py`,
> `check-plan-tables.py` and `check-spec-question-batches.py`.
>
> **Next:** run CI on `track-f/f7b-close` the moment Actions returns, and close F7b if green.
> **SQ-860 needs a ruling only the user can give** — derive a proposal description from the
> payload preimage, add a bounded label to 02's `Proposal` (a contract bump with a spam surface),
> or state that a proposal is identified by its commitment, which is what the client implements
> today.
> ### ⇨ CURRENT (2026-08-07, latest) — **F23 opens the provider surface, and the field it exists to render was collapsing at the badge**
>
> **Branch `track-f/f23-provider-surface`. F23 stays 🔨 — GitHub Actions has been in a major
> outage all session, so R-6's gate conjunct has no CI evidence for this commit.**
>
> **Nothing in `app/src` had ever imported `@bleavit/providers`** (V-242, measured before writing
> anything). Every 10 §8 mechanism existed, was tested, and was called by nobody. Seven modules in
> `app/src/features/analysis/src/` are its first consumers, with a 36-test suite.
>
> **`SpotCheckReport.reach` is the centrepiece, and it is now a named deliverable of the F23 row
> rather than an implied one.** The reason is measured (V-240): `badgeCopyFor`'s `provider` arm
> reads only `providerId` and `sampled`, so an honest deep-history snapshot, a document ahead of
> this device's head, and a pass that spent its ceiling above that head all badge **byte-identically**
> as *unverified — X*. `SpotCheckReach` was split into four arms so those three would stop
> collapsing, and it collapsed again one layer up — which made F9's *admit rather than refuse*
> choice circular, since the justification for admitting is that the limit is **disclosed**. The
> test asserts both halves: the badge set has size 1, and the three disclosures are distinct.
>
> **Four arms, five readings** (V-241). `spotCheckSnapshot` rewrites `whole-document` only when
> `outOfReach > 0`, and `checkCoverage` admits an empty `coverage` array — so a document covering
> nothing ends at the one arm a screen may read as *fully re-derived*, having compared nothing.
> `reachReading` is therefore a total function of the arm **and** the counts, every arm renders
> `compared`/`outOfReach` so `compared: 0` is never bare, and `wouldBadgeSampled` is bound to
> `mintSnapshotRows`' own expression by parsing both files.
>
> **Gates:** all 26 `app/` gates green (`pnpm -C app test` exit 0, 1,755 assertions), `depcruise`
> 0 errors, `depcruise:witness` fired, `check-plan-tables` and `check-spec-question-batches` green.
> **27 mutants, 0 survived** (7 re-written after `tsc` rejected them as orphaned imports).
>
> **Next:** most of the F23 row is still open and it says so — the **two §8.4 chain readers**, the
> **layer-3 write** of the minted rows, and a history query that calls the coverage renderer. Then
> **SQ-880**, raised here: 10 §8 mandates a provider UI and 11 §11.2's inventory does not contain
> one, so none of these seven screens is reachable from `routes.tsx` and none can even be declared
> pending — `PENDING_SCREENS` is keyed by inventory id.
> ### ⇨ CURRENT (2026-08-07, latest) — **F8's fifth review: three rounds of repairs each landed where the finding pointed, and the harm had moved**
>
> **Branch `integration/track-f-v2`. F8 stays 🔨 by instruction — GitHub Actions has been in a
> major outage all session, so no run has executed against these commits and no milestone may be
> called done on local evidence alone (R-6, R-10).**
>
> **Four majors, all closed, plus one carried in from F9's review of the same package.** The
> pattern is worth naming once because it is now five rounds old: each repair was correct about the
> sentence it cited and pointed at the wrong object. Round one emptied the chart tables silently;
> round two recorded the discard on a channel `coveredQuery` does not read; round three made the
> query read it — **and pointed the whole apparatus at `priceSamples`, the tier SQ-782 records as
> having no producer in production**, leaving `candles1h`, which the ingest loop fills on every
> block carrying a fill, with no covered read at all.
>
> **Major 1 — the tier with a producer had no covered path.** `coveredQuery` is generic and takes a
> `read` callback precisely so a second call site could exist; it was never written. So the only
> way to draw a chart was `db.candles1h.toArray()` — which typechecks, needs no cast, crosses no
> firewall edge, and returns an array indistinguishable from a complete history. `coveredCandles`
> closes it, and the rule is now **enforceable rather than remembered**: `check:covered-history`
> (+ `:witness`) fails on any chart-tier reference outside a `coveredQuery(…)`, anywhere in
> `app/`, with two named internals and **no exemption for the module that owns the query**.
>
> **Major 2 — the read side reassembled the splice §9.2 obligation 1 forbids on the write side.**
> Four separate IndexedDB transactions, so a fold committing between them returns rows already
> deleted beside labels that predate the deletion. One `db.transaction('r', …)`, rows before labels
> (labels only grow, so that order can only over-explain), proven through Dexie's own DBCore seam
> as **one transaction identity** rather than by racing a scheduler.
>
> **Major 3 — the round-three repair moved a corrupt-record crash onto the render path.**
> `readChartDiscard` returned `row.record` unchecked while its two siblings sanitize; before round
> three a corrupt row could only spoil the boot report, and afterwards `discardOver` dereferences it
> on **every** history query. INV-FE-7 makes corruption here *"a performance and convenience event
> only"*, and a chart that throws is not that.
>
> **Major 4 — `readTradeTape` reported a quiet market**, and the module's own doc-comment already
> refuses an *inverted* window for exactly that reason without applying it to a gap. The
> conservative reading ships and **the question is filed rather than settled**: **SQ-900** (does
> §6.3 bind a read §9.1 makes deliberately not layer 3?) and **SQ-901** (per query, per tier, or per
> screen?).
>
> **Carried in from F9's review:** `runIngest` dropped `verifyRanges`' `unchecked` set, and §6.3's
> last bullet says placement in neither list means *"one that genuinely passed"*. Since the
> `unverifiable` edge arm landed **every** provider range verdicts `unchecked`, so the per-session
> path reported every one of them as chain-agreed while the boot report told the truth. This is the
> third instance this session of a verdict landing in no list and being read as success.
>
> **Gates (local only):** `build` · `check:types` · `test:local-index` **202 tests** · the 27
> `app/` gates · PLAN tables · spec-question batches · frontend budgets. **17 mutants, 4 survived
> their first run** — three refused by `tsc` rather than by a test, one on a stale anchor; all four
> re-expressed and killed. **Next:** F25 is still the disclosure's reader; SQ-820/821/900/901 are
> rulings, not code.

> ### ⇨ CURRENT (2026-08-06) — **F9's adversarial R-6 re-review: 0 blockers, 4 majors, all four closed — and the sharpest one is that a guess did not go away, it moved and changed direction**
>
> **Branch `track-f/providers-close` (PR #256). F9 stays 🔨; the ✅ is the user's call.** The
> blocker fixed in the previous pass is genuinely fixed and was not touched.
>
> **M-1 — the ceiling still refused a valid snapshot, on a cause §8.4 does not list.** The fixed
> blocker's own defect class with a narrower trigger, and **two** live configurations reach it: a
> device more than 512 blocks behind the document's newest covered block, and a document with more
> than 512 *reachable* covered blocks — where the remedy copy (*"try again when this device has
> caught up"*) was **false** and the refusal permanent. The ceiling now **admits** with
> `reach: 'ceiling'` and the mint refuses to badge those rows `sampled` however many blocks agreed.
> `spot-check-incomplete` and its `incomplete-check` remedy are deleted, so every remaining
> `FE-PROV-003` cause is a statement about the **document**. Its own disposition, not the
> blocker's: **SQ-811** asks §8.4 whether an unfinished re-derivation refuses or discloses.
>
> **M-2 — the guess moved instead of going away, and its failure direction flipped.** The walk now
> takes the out-of-reach **side** from `BlockMovementRead`, which has **no production producer**
> (every caller is a test closure) and which F23 owns, and nothing anywhere stated the two
> properties the walk depends on. The old inference failed toward **refusal**; the delegate fails
> toward **admission** — a reader answering `below-window` above its own head yields an admitted
> document with `compared: 0`, no finding and the blind-spot disclosure, indistinguishable from an
> honest deep-history pass. Fixed twice: F23's row now carries the reader's contract as four
> explicit obligations, and F9 ships **`checkBlockMovementRead`**, an executable contract behind
> `@bleavit/providers/testing`, with 16 cases — one positive control and fifteen deliberately
> broken readers — so F23 inherits a test rather than a comment.
>
> **M-3 — `SpotCheckReach` had three arms and four producing situations.** A document entirely
> above this device's head and smaller than the ceiling returned `whole-document`, the arm a screen
> reads as *fully re-derived*, having verified nothing. Fourth arm **`above-window-only`**, kept
> apart from `window-floor` because that one is permanent and this one is transient.
>
> **M-4 — the normative UI copy was substituted and the gate was scoped around it.** *"supports and
> **recommends**"* shipped as *"supports and labels"*, and the clause binding extracted the four
> clauses around it. **The spec question under it was ruled first**: doc 10 spelled the clause two
> ways (§8.4 *recommends*, §2.3 *discloses*), §2.3 is amended to §8.4's verb under R-1, and a second
> test now asserts both sections agree — see the Decision log for the four grounds.
>
> **Gates:** all 26 `app/` gates green (`pnpm -C app test` exit 0, 1,279 assertions; providers
> 210/210), `depcruise` 0 errors, `depcruise:witness` fired, plus `check-plan-tables`,
> `check-spec-question-batches`, `check-doc-links` and `check-verbatim-copies`. **21 mutants, 0
> survived** — and the battery's *first* run reported 17 survivors, which was the harness's own
> defect and not the tests': the suites import `dist/`, so a mutant in `src/` that is not rebuilt
> is never executed. Fixed and re-run. GitHub Actions is in a major outage, so there is **no CI
> evidence** for this commit.
>
> **Next:** the user's R-6 sign-off on F9; then F23's two chain readers (wire the production one to
> `checkBlockMovementRead`), and F24 once SQ-612/SQ-613/SQ-771 are ruled.

> ### ⇨ CURRENT (2026-08-06) — **F9's R-6 re-review: the deep-history snapshot, which is the format's primary use, was being rejected**
>
> **Branch `track-f/providers-close` (PR #256). F9 stays 🔨 — the ✅ is the user's call, not this
> session's.** An R-6 spec-compliance review of the closed row returned **1 blocker and 4 majors**.
> The blocker and two majors are fixed with mutation proof; the rest are written into the F9 row
> rather than carried silently.
>
> **The blocker.** 10 §8.4 scopes spot re-derivation to *"the covered blocks that fall inside
> light-client-reachable depth"* and states the depth limit as **disclosed**, not as a refusal;
> §6.4 assigns snapshots *"deep history beyond 30 days — by design, not by omission"*. The walk
> had a single undirected `out-of-reach` verdict and inferred the direction from whether anything
> had been compared, so a document sitting entirely **below** the window — every covered block
> unreachable, the ordinary case — was treated as one entirely **above** it: 512 asks with a known
> answer, the work ceiling, `spot-check-incomplete`, `FE-PROV-003`. Reproduced on the shipped code
> before touching anything: a valid **216,000-block snapshot refused**. The verdict now carries a
> **direction** and the report a **`reach`** field, so the blind spot and an unfinished pass are
> different values rather than the same `compared: 0`.
>
> **Major 2, and a defect it exposed that the review did not name.** `canServeReads` was consulted
> by nothing. Wiring it in made its exact predicate load-bearing, and it excluded `failing` —
> against §8.3's own normative sentence, *"only `Disabled` stops reads"*. `failing` and `slow` now
> serve; `unprobed` does not, and the import path is gated on a **second, narrower** predicate
> because a pinned file the user already holds asks no endpoint anything and nothing in this
> release drives §8.3's probe (SQ-771, SQ-773).
>
> **Next**, in order: the user's R-6 sign-off on F9; then the three write-down-only items now owned
> — **F23** gained `BlockMovementRead`/`ChainRead` (nothing turns `System.Events` into
> `SnapshotOp`s, so §8.4's re-derivation still cannot reach a chain in production), and the new
> **F24** owns §8.2's archive reader, `optional/indexer/` and §8.3's probe driver, all three parked
> on SQ-612/SQ-613/SQ-771 because R-2 forbids inventing an interface. Four questions raised:
> **SQ-770…SQ-773**. Gates: all 26 `app/` gates green locally; GitHub Actions is in a major outage,
> so there is no CI evidence for this commit.

> ### ⇨ CURRENT (2026-08-06) — **F8's fourth review: the explanation existed, was true, and was written where the surface that renders the absence never looks**
>
> **One blocker, four majors, five minors — blocker and all four majors closed; F8 stays 🔨 by
> instruction.** The blocker is the third round's blocker one layer down, and the shape is the one
> this package has now produced four times: **a control that exists and is not reachable from the
> thing it protects.** A checker with no call site; an error code with no emitter; a `CoveredResult`
> with no producer; and now a record with no reader on the path that renders the absence.
>
> **Measured, after the third round's repair:** `coveredSamples(db, 'book-1', 1..9)` answered
> `{ data: [], ranges: [1..9 self], holes: [] }` and `meta.downsampled` was empty. `covered()` reads
> `CoverageRef` and nothing else, so the migration's `ChartDiscardRecord` — written inside the
> upgrade transaction, surfaced by `checkIndexAtBoot` — could not be seen by the query. That is
> *complete* over an emptied tier, which is exactly the reading 10 §6.3's opening rule exists to
> forbid (*"bare rows render as a complete series"*) and which INV-FE-15 calls a silent splice.
> **No ruling can make it true**, so it was repaired now rather than parked on SQ-780/SQ-783.
>
> **The repair keeps the spec's own interface and makes the sibling fields unforgettable.** The
> store's query path returns a **`CoveredHistory<T>`** — §6.3's `CoveredResult` *inside* a container
> that also carries `downsampled` (§9.2's ladder folded these blocks; a coarser rung survives) and
> `chartDiscard` (a migration or repair emptied them; nothing survives), each bounded by the span
> asked about. A discard whose envelope could not be named is reported for **every** span, because
> overlap cannot be ruled out and dropping an explanation on *cannot say* is how an announced loss
> becomes a silent one again. §6.3's published shape is untouched: **which** repair is right —
> a field on `CoveredResult`, trimming `CoverageRange`, or an obligation on every consumer — is
> SQ-821, and `CoveredResult` is declared in doc 10 only, so it is a doc-10 ruling and not a
> contract bump. SQ-820 is its other half: §9.2 has *"downsampled"* and §6.3 has *"hole"*, and
> neither names *ingested, still covered, held at no resolution*.
>
> **Major 1 was introduced by the previous round's own repair**, which is worth stating plainly.
> The per-rung `catch` that stopped one refusal ending the whole pass also removed the throw that
> had been preventing a phantom label: `degradeOldestBucket` merged into the shared accumulator
> *before* opening its transaction, so an aborted fold left the label there and the next committing
> rung persisted it — rows present, `meta.downsampled` claiming they were folded. §9.2 obligation 1
> binds the label to the delete; it is now merged and written inside the `rw` callback and returned
> from it, so the caller can only learn the new set from a transaction that resolved.
>
> **Major 2: the regression fixture exercised the one tier production never fills.** 130,000
> `priceSamples` — the tier SQ-782 records as having no producer at all — while the crash
> arithmetic was about `candles1h` (159 books × 24 h = 3,816 rows/day, ~33 days), which is a
> **separate call site**. Both tiers are seeded past V8's spread limit now, and the comment
> claiming *"the budget here is over the raw share, so the ladder runs"* was false and is corrected
> with `stepsPerformed` asserted at zero. The ladder is deliberately not run over a tier that size,
> for a **measured** reason: one 3,600-key `bulkDelete` against a 130,000-row table had not
> returned after nine minutes under `fake-indexeddb`, while the inserts take ~10 s and ~7 s.
>
> **Major 3 is F25**, a new milestone row rather than prose in a neighbour: `local-index` has no
> production consumer — nothing in `app/src` constructs a `LocalIndex` — so no work inside F8 can
> give `IndexBootReport` a reader. The row names its obligations one by one, `ChartDiscardRecord`
> included, and records that what blocks it is the `FE-IDX-002` copy (SQ-604/SQ-783), not code.
> **Major 4:** the withdrawn §7 citation was still in the code and in a thrown message, 600 lines
> from a comment stating the truth — both now cite `SCHEMA_V3` and SQ-607.
>
> **Mutation found a gap the review did not.** The existing transaction test proves
> `writeDownsampled` joins an *ambient* transaction and never that the ladder's own write is in the
> *fold's* — so moving it after the `rw` block survived all 185 tests. Closed by a test that
> refuses the label write and asserts the delete rolled back with it, which is §9.2 obligation 1 in
> the only failure that distinguishes the two.
>
> **Gates (local — GitHub Actions is in a major outage):** `pnpm -C app build` · `check:types` ·
> `test:local-index` **186 tests** · `pnpm -C app test` exit 0 at **1,248 tests** · `depcruise`
> (2 pre-existing orphan warnings, 0 errors) · PLAN tables · spec-question batches ·
> frontend budgets **47 cells**. **12 mutants, 0 survived.** **Next:** F25 is the disclosure's reader;
> SQ-820/SQ-821 are rulings, not code.
> ### ⇨ CURRENT (2026-08-06) — **Both of #254's P1s are valid, and both are a gate measuring something other than what it claims — the defect class F14 exists to remove**
>
> **Neither could have been caught by a number.** `check-frontend-budgets.py` binds every §9.4
> threshold to its published cell and proved both gates carried the right ones. They did. What
> was wrong was *which statistic* one compared and *which bytes* the other weighed.
>
> **The render row publishes p50 and p95, and the gate compared a median against both.** A
> median says nothing about a tail: with three runs, samples of 2 s, 2 s and 20 s have a 2 s
> median and pass the 6 s mobile p95 threshold while a third of the sample sits over three times
> above it. Three honest options existed — sample enough runs to estimate p95, gate the tail
> conservatively, or declare the row unenforced — and §9.4's enforcement column does not say
> unenforced. So the p95 cell is now gated on the sample's **p95 tail** and the p50 cell on its
> **median**. The tail is nearest-rank, `sorted[⌈0.95·n⌉ − 1]`, which selects the slowest run for
> every sample of **nineteen or fewer** — written out rather than hardcoded as "the maximum", so
> raising the run count to twenty starts estimating a real percentile instead of quietly keeping
> a maximum under a p95 label. The boundary is nineteen and not twenty, and the test found that:
> ⌈0.95·n⌉ = n only while 0.05·n < 1.
>
> **The chain-spec row budgets what a browser lazily fetches, and the gate weighed the source
> tree.** `release-sources.json` declares repository paths; the only other consumer opens them at
> build time for bootnode multiaddrs, and `build.ts` copied `schemas/` and `skills/` and nothing
> else. So the release genuinely emits **no chain-spec bytes**, no client path fetches one, and
> the gate would have gone green the moment a hash was pinned. Both halves are fixed: the build
> emits declared specs into `dist/chain-specs/` **before hashing**, so the service worker pins
> them like every other file, and the gate measures the emitted tree — declaration ⇔ emission in
> both directions, every pinned role matched by **SHA-256**, and the pre-genesis exemption now
> requires the emitted tree to be empty too rather than only the blocker to stand.
>
> **Binding the roles surfaced a third gap (SQ-720).** §9.4 budgets *"relay + para + Asset Hub"*
> and `chainSpecHashes` has room for two. 11 §11.9.1 boots a second light client against Asset
> Hub and `attachAssetHub` verifies its bundled bytes against a `PinnedChainSpec`, so the pin is
> required and has nowhere to live. Filed in batch X with the format change it needs, and
> `build.ts` emits a mechanically expiring readiness blocker so no release can be assembled
> without stating it.
>
> **Verification.** New `app/tests/budgets` suite — **18 tests**, and every fix is
> mutation-proved: reverting the tail comparison, the declared-but-not-emitted refusal, the
> emitted-but-undeclared refusal, the pin-match refusal and the absent-tree refusal each fails
> exactly the case written for it and nothing else. The artifact witness grew **5 → 8** cases and
> gained a **positive control**, because eight refusals are all satisfied by a checker that
> refuses everything.
>
> **Gates (GitHub Actions is in an outage — every result below is local).** `pnpm -C app run
> build` (`tsc -b`) green · `check:types` green · **app suites 1,167 tests, 0 failures** ·
> `check:artifact-budget` + its 8-case witness green · `check:render-budget` measured **desktop
> 0.40 s / mobile 1.80 s** FCP at the p95 tail against 3 s / 6 s, witness fired · `tools/ci` **264
> OK** · `check-frontend-budgets.py` **60 cells** · doc links, PLAN tables, spec-question batches,
> verbatim copies, dispatch mirror and client-surface obligations all green. #254's red checks are
> the outage, not the code.
>
> **Next:** F14 stays 🔨 on the same eight rows — four need a chain the client can boot against,
> one needs §9.2's quota manager, three need the device lab.

> ### ⇨ CURRENT (2026-08-06, latest) — **The SQ-557 repair counted one resource partition and there are two: hosted books emit the same events, at a higher duty cycle, and nothing in §9 saw them**
> ### ⇨ CURRENT (2026-08-06) — **PR #252: a capability said `proven` three lines under the check that had just disproved it**
>
> The `chatgpt-codex-connector` bot filed one P2 on `app/packages/platform/src/adapter.ts:302`.
> **Confirmed, and it is the branch's own design that makes it reachable.** `desktopPlatform`
> deliberately *returns* an adapter when the host reports a divergent embedded tree, because
> INV-FE-8 surfaces divergence and never repairs it and a thrown adapter is a divergence nobody
> can render. The capability written beside that branch was the literal `proven()`, so every
> surface guarded by `requireCapabilities(..., ['embedded-tree-attestation'])` was enabled in
> exactly the state where the host had said the embedded tree failed verification. App-code rule
> 10 is the rule it breaks: an unproven capability is **absent**, and absence disables the
> dependent surface with a named reason.
>
> **The fix is a derivation rather than a corrected literal.** `embeddedTreeCapability` is a
> total `switch` over `AttestationState`, and all three constructors take their value from it, so
> the capability and the arm cannot fall out of step and a fourth arm fails to compile rather
> than inheriting whichever branch was written first. The absent reason names the divergence,
> keeps the count exact, and caps the list at three files — the full list stays on
> `PlatformAdapter.attestation`, which is what a verification panel renders.
>
> **Two siblings of the same shape were in the same function and are fixed here.** The desktop
> channel's `external-navigation` was `proven()`, the web adapter's argument copied to a channel
> it does not cover: that argument is about *browsers*, while a downloaded application opens an
> external URL only where its host grants it — and this shell registers no host plugin, with
> `src-tauri/gen/schemas/capabilities.json` an empty object. It offered a control that would do
> nothing when clicked, and it is a `HostReport` field now, like the three transports beside it.
> And a `reported-verified` attestation over **zero pinned files** was believed: the exact mirror
> of the empty-findings refusal three lines above, and the vacuous pass this repository keeps
> rediscovering. No honest release reaches it, because `readPerFileHashes` and the Rust `attest`
> both refuse an empty manifest, so the state means the report is wrong. It is refused.
>
> **Mutation-proven one revert at a time**, each with a rebuild first because a stale `dist/`
> has already made a suite pass for the wrong reason: the literal `proven()` fails 3 of the new
> tests, deleting the zero-pin refusal fails 1, and the copied `external-navigation` fails 1.
>
> **Gates (GitHub Actions is in a major outage, so all of this is local):** `build` (`tsc -b`) ·
> `depcruise` · `depcruise:witness` (24 violations, rules live) · `descriptors:check` (19 files) ·
> `check-chain-feed.py` · the aggregate `pnpm test` — **1,185 app tests, 0 failures** ·
> `release:build` · `release:check` · `check:bundle-budget` (63.3 KB gz) · `check:embedded-tree`
> (30/30) · `check:embedded-tree:witness` (fired on every mutation) · `signers:audit`. No spec
> question opened: the capability set is F22's own, app-code rule 10 owns the posture, and
> 10 §13.4 already routes external-link availability to prototype gate FE-P11.

> ### ⇨ CURRENT (2026-08-06) — **The provenance sweep's last two files, and one of them badged the user's own account as a chain read**
>
> `audit/provenance-mints` (#260) swept `main` for helpers that **manufacture** a status rather
> than obtain one — a hand-written `status: { kind: 'verified-finalized', … }` is a complete
> provenance claim with no read behind it, because the badge on screen is read off `status.kind`.
> It fixed six sites and left three files it could not reach, because they live on this stack.
> #258 had already closed `core-screen-reads.ts`; these are the other two.
>
> **`position-reads.ts` was benign in substance and wrong in direction (V-184).** All seven
> leaves — `positionId`, `instrument`, `balance` and the four vault-projection fields — really
> were part of what `crossCheckedCall` returned, so nothing on S4 was false. But the pin came
> from `reader.at` rather than from the answer, and the stamping helper was passed **into**
> `projectVault` as an argument, so a closure that had never seen a read decided a settlement
> branch's provenance. `derive(raw, …)` reverses the dependency. The test needed a **disagreeing**
> double to exist at all: the reader's field and the call's status are equal in every real
> reading, which is exactly why the stamp survived review.
>
> **`balance-reads.ts` was not benign (V-183).** It badged `who` — the **key** its two frozen maps
> are read at, never a value either returned — `verified-finalized` at the reader's pin, and S20
> renders that string through `<Identifier>` in the panel subject. 10 §5 forecloses it by name:
> *"a selected account"* is a chosen value and *"can never be represented as verified"*. It is now
> a caller-supplied `Verified<string>` passed through, the treatment `market-reads.ts` gives
> `bookId`. Its second defect was one #260 had already ruled on elsewhere: an **undecodable**
> balance contributed a badged `0n`, defended by a comment saying the `undecodable` row beside it
> was what said not to believe the figure. INV-FE-9 attaches the label to the **datum**, so an
> explanation in a sibling array never reaches the field. The figure is absent now and S20 renders
> a refusal — an **absent** record stays a badged zero, because the chain did answer.
>
> **SQ-830 came out of the repair and is not fixed here.** INV-FE-9 has no status for a value this
> user chose. 10 §2.1 gives `external-proposal` for a chosen value displayed as a data item, and
> its in-bundle badge copy reads *"A value an external tool asked for"* — false for an account the
> user picked in their own wallet, in the opposite direction to the defect just repaired. Nothing
> ships wrong today: no composition root supplies this datum, so the status is chosen only in
> `app/tests/screens`. Rule it before wiring S20.
>
> **9 mutations, 0 survived** (one re-run because `noUnusedLocals` caught the first form, which
> does not count). #260's gate was fetched and run unmodified rather than copied onto this branch:
> **7 findings before the fix, 5 after**, both of this branch's gone. The five that remain are
> `main`'s own — `boot.tsx`, `chain-reads.ts`, `review.tsx`, `funding-reads.ts`,
> `proposal-reads.ts` — each repaired by #260 and none reachable from here, so this branch cannot
> make that gate green on its own and should not try.
>
> **Gates (GitHub Actions in a major outage, so all evidence is local):** `pnpm test` exit 0 —
> **1,378 tests across 18 suites, 0 fail**, `test:screens` 420; build and `check:types` clean;
> `depcruise` 0 errors with both witnesses firing; `check-plan-tables`,
> `check-spec-question-batches` green; control-character sweep clean over every changed file.
>
> ### ⇨ CURRENT (2026-08-06) — **#258's five review findings: the S3 defect class reached S5 and S6, and under it were a wrong deadline, four invented reason codes and a dashboard reading a record that does not hold its fields**
>
> All five are confirmed. Two of them — the retry deadline and the reason codes — were verified
> against `pallets/execution-guard/src/lib.rs` before any code moved, and the pallet decided both.
>
> **1 and 2 — `SubmitInputs` and `ExecuteInputs` accepted `Verified<T>`.** #250's finding, one
> row family over and then a second time on the execution gate, which R-7 puts in the strictest
> class: a `provider` read is a well-formed `Verified<T>`, so a P-10 snapshot or a fourteen-row
> P-12 model assembled from an operator's answers evaluated normally and enabled signing. Every
> leaf is `Finalized<T>` now, **including the nested capability, suspension, lock, retry and
> bounds structures** — a gate is only as strong as its weakest leaf — and two `tests/firewall`
> fixtures prove a provider read does not compile, one of them deliberately nesting it. §11.4's
> single-B′ rule is a row in both gates, because the brand carries a block and cannot compare
> two: `P-10 read pin`, `P-11 read pin`, and S6's row **0**, numbered outside the fourteen
> because it is a statement about this client's reads rather than a dispatch check.
>
> **3 — the client's execution window was `grace_end`, and the runtime's is not always that.**
> `pallets/execution-guard/src/lib.rs:1956` matches on `failed_at`: `None ⇒ now ≤ grace_end`,
> `Some(f) ⇒ now ≤ f + RETRY_WINDOW`. The retry clock **replaces** `grace_end` rather than
> extending it, so ignoring it is wrong in **both** directions — the review named the lock-out
> (a lawful retry after `grace_end` presented as terminal) and the other one is worse: a retry
> whose window closed *before* `grace_end` read as live, walking the user to a `GraceExpired`.
> The spec stated neither: **09 §1.2(1) read `maturity ≤ now ≤ grace_end` unqualified**,
> contradicting 05 §2.1's own T18/T23 rows, so it is corrected under R-1 along with 11 §11.5
> row 2, and the value gets its first values-layer home in 13 §2. `failed_at` **is** readable
> (the frozen `ExecutionGuard.Queue` entry carries it); **`RETRY_WINDOW` is not readable at
> all** — SQ-790 — so a stamped `failed_at` with no window length is a third window state that
> blocks **without** declaring the mandate over.
>
> **4 — four of the client's eleven reason codes were names the runtime has never returned.**
> `NotQueued` for `NotFound`/`Cancelled`, `VersionMismatch` for `StaleQueue`, `MeterExceeded`
> for `MetersBlocked`, and `GateSuspended` for the `delay_once` hold's `GuardianHold`. Three
> more the review did not name: row 2's past-grace arm said `NotMature`, row 7's ⊆-declared arm
> said `CapabilityDenied` where the guard raises `BadDomainDeclaration`, and all four of row
> 14's bounds said `BadPreimage` where the guard raises `TooManyCalls` / `PayloadTooLarge` /
> `SafetyFilter` / `CapabilityDenied`. Eighteen codes now, each a real variant.
> **`tools/ci/check-execute-error-codes.py` binds them to `pallet_execution_guard::Error<T>`**,
> and a suite test binds them to `do_execute`'s **body** — the stronger claim, since `QueueFull`
> is a real variant `execute` never returns.
>
> **5 — S7 read raw `Constitution.Params` and asked a decoder for three fields it does not
> hold.** `min_next`, `max_next` and `cooldown_blocks` exist only in the runtime's projection,
> computed from `admissible_next_interval()` and the live `epoch.length`
> (`runtime/bleavit-runtime/src/views.rs`). 11 §11.2's own S7 row names `params()`, 02 §7.3 says
> the item is *"read via `params()`"*, and 11 §11.4 rule 2 forbids the client computation the
> raw read would have forced. It is a cross-checked `params(keys)` call now, against that same
> prefix, and a key the chain does not answer for is reported rather than silently absent.
>
> **The producer-side mint this branch owned, found and fixed with them.** `core-screen-reads.ts`
> carried a `stamp(at, value)` helper that wrapped any value in a hand-written
> `verified-finalized` object — V-182's defect, in the file that feeds both precondition gates.
> It was *invisible because the consumers were weak*: with `Verified<T>` leaves the helper
> typechecked. `derive(read, compute)` is ported **byte-identical** from `track-f/f7b-render`
> so the stacked rebase reconciles to one definition.
>
> **15 compiling mutants, 0 survived**, plus 5 more in the new gate's own unit tests. Two
> further mutations were rejected as invalid because they do not compile, and one of those is
> itself the report: restoring the `stamp()` helper is now a type error.
>
> **Gates (GitHub Actions in a major outage, so all evidence is local):** app **1,273 tests
> across 18 suites, 0 fail**; `pnpm test` exit 0 — build, `check:types`, firewall **27**,
> screens **318**, casts, chain-literals, render-provenance, depcruise + witness, surface and
> handoff gates all green with their witnesses. `tools/ci` suites **251 tests, 0 fail**;
> `check-plan-tables`, `check-spec-question-batches`, `check-dispatch-mirror`,
> `check-client-surface-obligations`, `check-verbatim-copies` and the new
> `check-execute-error-codes` all green.
>
> ### ⇨ CURRENT (2026-08-06) — **The S3 trade ticket had three P-1 rows that passed while measuring nothing, and review on #250 found all three**
>
> **All three are the repository's recurring defect class**, and each is invisible under a fully
> green run because the *shape* of the check is right and its *input* is not. Confirmed against
> 11 §11.5's P-1 row and 04 §6.1, fixed in `app/src/features/tx/src/trade-ticket.ts`, and
> mutation-proven. No spec text changed: P-1 already mandates every row that was missing, so
> SQ-700/701/702 were reserved for this work and are **not** used.
>
> **1. The preconditions accepted `Verified<T>`, which is every provenance there is.** A
> `provider` read is a perfectly well-formed `Verified<T>`, so a ticket assembled from an
> operator snapshot evaluated normally, found nothing wrong, and returned an **empty** block
> list — which `mayPrepareTrade` reads as *every precondition passed*. 11 §11.4 rule 4 says
> provider data never satisfies a precondition, and `transaction-builder`'s `evaluate` already
> made that a type rather than a review obligation. The leaves are `Finalized<T>` now, with a
> `tests/firewall` fixture proving the provider read does not compile. **The type carries the
> block but cannot compare two of them**, so one pin across every leaf is a row: §11.4 pins a
> single B′, and rows read at two blocks are each true about a state that never existed.
>
> **2. P-1's slippage recheck had no input to check against.** The row says *"recheck
> `max_cost`/`min_proceeds` still satisfiable"* and `TradeInputs` carried neither the direction
> nor the encoded bound — so a buy drafted at `max_cost` 1,002,000 whose refreshed charge is
> 1,003,000 passed every implemented row and came back `SlippageExceeded` from the runtime's own
> check (04 §6.1 step 4), after the user paid a transaction fee to find out. `TradeOrder` is a
> union: a buy carries the ceiling, a sell the floor, and a ticket with no bound at all does not
> typecheck.
>
> **3. The balance row was written for a buy and applied to both directions.** P-1 reads *"user
> USDC balance (buy) / position balance (sell)"*, which are different quantities in different
> assets: a sell delivers positions and receives USDC. Comparing a seller's holdings against the
> quoted proceeds passed a user holding 900,000 units of a 1,000,000 sale whenever the sale paid
> less than they held, and the runtime then refused it for inventory.
>
> **Two consequences beyond the three findings.** `QuoteView`'s `cost` and `fee` are carried
> **apart** and compared field by field, because 04 §6.1 combines them differently per direction
> and one summed comparison hides two offsetting differences — `(100, 3)` against `(101, 2)`
> agrees on a buy's total and disagrees on a sell's net. And `orderTotal` is the **single**
> derivation of `cost + fee` / `cost − fee`, since two would be two chances to combine them the
> wrong way round.
>
> **7 mutations, 0 survived.** The first two were caught by `tsc` rather than by a suite, which
> proves the compiler noticed and not that the new tests measure anything, so both were re-run as
> **compiling** mutants: `spendable` alone unbranded (caught by the firewall fixture) and a pin
> key that names the chain and forgets the block (caught by the same-B′ test).
>
> **Gates (GitHub Actions was in a major outage, so every one of these was run locally):** app
> **1,210 tests across 18 suites, 0 fail**; `pnpm test` exit 0 — build, `check:types`, firewall
> 25, screens 257, tx 140, casts, chain-literals, render-provenance, handoff and surface gates
> all green with their witnesses; `depcruise` 0 errors (2 pre-existing `no-orphans` warnings);
> PLAN tables green; control-character sweep clean.
>
> ### ⇨ CURRENT (2026-08-06) — **The S3 render layer was asserting finality it had never established, and a rebase with no conflict is what exposed it**
>
> **`track-f/f7b-render` rebased onto #250's fixed tip (`7bc77318`) and stopped compiling — ten
> errors, zero merge conflicts.** The two sides had changed different files, so git had nothing
> to say. #250 made every `TradeInputs` leaf `Finalized<T>` (11 §11.4 rule 4: provider data never
> satisfies a precondition) and split `QuoteAgreement` into `cost` and `fee`; the render branch's
> reader was still building `Verified<T>` leaves and one summed charge.
>
> **Under the build errors was the real finding (V-182).** `market-reads.ts` defined a local
> `finalized` helper that wrapped any value in a hand-written finalized status object. It is
> brand-less — `Finalized<T>`'s brand is a non-exported `unique symbol` in `packages/chain-client`
> — so it was *asserting* finality rather than establishing it, and it covered **nine** values.
> Two were caller-supplied inputs the chain was never asked about (the book id, the epoch). Two
> more took the **payload** of a caller-supplied `Verified<T>` and discarded its status, so a
> `provider` bounds read went in and a finalized-looking `MinTrade` came out: INV-FE-1's promotion
> performed by a formatting convenience, on a value a §11.5 row reads. Neither sibling control
> could see it — `check:casts` looks for an assertion and there was none, and the render gate's
> rule B matches a borrowed `.status` access where this one wrote the status out longhand.
>
> **The root cause is a missing spelling, not a careless author.** 10 §2.2 admits values
> *"computed client-side purely from"* finalized reads, and `chain-client` exported that
> capability for **two** reads (`meet`) and for none for one. A reader needing a
> `Finalized<boolean>` out of a `Finalized<readonly StorageItem[]>` had no sanctioned path at all,
> so it wrote its own. `derive(read, compute)` closes it and widens nothing: `meet(a, a, …)` is
> the same function, and both require a `Finalized<A>` only a read produces. `finalize` stays
> withheld from the barrel for V-118's reason — it mints from a value and a pin the caller
> supplies, and there is no read anywhere in that.
>
> **Every S3 leaf now descends from a read that was made.** The book, the flags and the quote are
> decoded *inside* the derivation rather than stamped after it; `maxTrade` is the one genuine
> two-read leaf and goes through `meet`; `minTrade` projects the caller's own bounds reading.
> Caller-supplied readings are `Finalized<T>` and are checked against the reader's pin up front —
> **`MixedPinError` throws**, because a reading from another block is a defect in whatever
> assembled the call rather than a state of the chain, which is the answer `readDepositInputs` and
> `FinalizedReader.domained` already give. The two rendered inputs (book id, epoch) are **passed
> through under the caller's provenance**: this module reads neither, so it cannot make either
> more verified by holding it.
>
> **What the screen shows changed, and collapsing it would have been the easy mistake.** 02 §4
> publishes `cost` and `fee`; 04 §6.1 debits `cost + fee` on a buy and credits `cost − fee` on a
> sell. A chain answer of `(100, 3)` against a client answer of `(101, 2)` **agrees** on a buy's
> total and disagrees on a sell's net, so one figure per side would show agreement for a pair that
> blocks the ticket under `FE-CHAIN-005`. Both fields therefore render on both sides with the
> direction's own combination beneath them — six figures — and the labels are keyed by direction,
> because "total debited" over a payout reverses the sign of the trade in a reader's head.
>
> **6 mutations, 0 survived, and every one was made to compile first** (the standard #250 set):
> the mint re-added behind an `as Finalized<T>` (caught by `check:casts` *and* a source assertion
> in `tests/screens`), the book id re-stamped, the epoch re-stamped, the quote normalised to one
> figure (7 tests died), the direction defaulted in two different places, and `derive` altering the
> pin it carries. **Gates, all local — GitHub Actions is in a major outage:** `pnpm test` **exit 0,
> 1,363 tests across 18 suites, 0 fail**; `depcruise` 0 errors (2 pre-existing `no-orphans`
> warnings) with its witness firing on 20 edges; PLAN tables green; control-character sweep clean.
> **No spec question was raised — SQ-740…SQ-744 stay unused.** Nothing here needed a reading doc 11
> or doc 10 does not already give.
>
> ### ⇨ CURRENT (2026-08-06) — **F7b opened: the two ledger domains, and the redemption arithmetic a screen decides on**
>
> **#248 merged as `b0851ca8`; #249 is rebased onto it and converging** (16 pass, 5 pending,
> 0 failed at hand-off). The rebase's only conflict was PLAN.md, in the four places nearly
> every branch touches; the branch's diffstat against the new base is byte-identical to its
> diffstat against the old one, so nothing moved but line positions.
>
> **F7b is the only ⬜ Track F milestone with satisfied dependencies and no external blocker**,
> which is why it is next: F1/F8/F9/F11/F13/F15/F17/F18's residue is all Arweave, hardware,
> credentials or a ruling. Two of its load-bearing pieces landed here — the ones every S3/S4
> screen will sit on, and the ones where a wrong answer is silent.
>
> **`packages/protocol` gained `redemption.ts` (03 §5.3a).** 11 §11.5 makes `net` the headline
> figure on a charged redemption exactly as a quote is on a trade, so this is the second thing
> the client must be able to say before a user signs. Three properties carry it and each is a
> case where the obvious implementation disagrees with the chain: the waiver tests the **net**
> (a gross test disagrees across the whole boundary band — at 30 bps a gross of 10,000 is paid
> in full by the runtime and shown a 30 fee by a gross-based client, on ordinary traffic); a
> pair charges **what its legs would charge**, not `fee(a)`; and the fee rounds up, against the
> claimant.
>
> **It deliberately does not mirror the runtime in one place, and that is spec'd.** The chain's
> `effective_redeem_fee` fails **open** — an unreadable or out-of-domain rate waives the fee,
> because taking value on the strength of an unparseable record is worse (03 §5.3a(5)). 11
> §11.5 rule 5 says a client must do the opposite: disable the figure and block. So an
> out-of-domain rate **throws** here where the chain would waive, and the corpus row that runs
> at `1_000_000_001` perbill is asserted from **both** sides so the divergence is a known
> difference rather than a latent bug.
>
> **Certified against the generated corpus, not against expectations written beside it.**
> `app/tests/protocol` replays `ledger_fee_scenarios` — 11 scenarios, two rates, every
> redemption call — through the same in-place loader the LMSR differential uses, and binds a
> third artifact: **doc 03 §5.3's own `Fee (§5.3a)` column is parsed** for the charged/exempt
> verdict rather than restated, because a charged-set list written beside the port agrees with
> the port and with nothing else. The protocol-account exemption is proven **non-vacuous** (the
> skipped rows *would* have been charged), which is the check that stops a skip from hiding a
> mismatch.
>
> **The measurement corrected my own first assertion (V-174).** I wrote that `fee(a)` on a pair
> overstates the fee — §5.3a(2a)'s worked example says so — and the corpus refuted it: `fee(a)`
> errs in **both** directions, understating at `a = 1,000,000` (3,000 against 3,001) because two
> independent per-leg ceilings can exceed one. That is the direction a client must fear, since a
> fee below the chain's puts a net **above** what the account receives on the deciding screen,
> and the spec's example only shows the safe direction.
>
> **`src/features/tx/ledger-domain.ts` is 11 §11.2a's rules 1, 2 and 5.** Domain is a bit test
> on an id against `ConditionalLedger.ServiceIdBase` — a **required argument** everywhere, since
> `1 << 63` as a literal is exactly what 02 §9 gave the boundary a metadata home to prevent. The
> service call subset is **derived from the rule** (a hosted question has no gate structure and
> no Baseline book, 16 §7.6) while doc 11 §11.2's S4 row states it as a **list**, and the suite
> compares the two in both directions — two independent statements of one claim rather than a
> list checked against itself. Rule 2 is a **type**: `totalOf` marks its rows `NoInfer<D>`, so a
> mixed array cannot compile, proven by a negative-compilation fixture rather than by a green
> run. Every refusal here is a silent failure otherwise — a zero boundary would label a user's
> whole primary portfolio hosted, with every downstream badge agreeing.
>
> **Also corrected: the SS58 prefix (V-173).** #248 fixed five `app/` comments; two survivors
> outranked them — `.claude/rules/app-code.md`, loaded into every session that opens `app/**`,
> and **V-164's own row**, the findings table a later session trusts. Measured before
> correcting. A CI gate was scoped and **rejected on measurement**: over the whole repository,
> "a number near ss58/prefix" is 42 real hits against 200+ false positives, because `prefix`
> here nearly always means a storage, key, byte or hash prefix.
>
> **Gates:** app **1,173 tests across 18 suites, 0 fail** (protocol 58, screens 221, firewall
> 24); build, `check:types`, depcruise 0 errors + witness, casts, chain-literals,
> render-provenance + witness, handoff gates, surface/foreign/smoldot checks all green; PLAN
> tables green; control-character sweep clean.
>
> **§11.6's VOID decomposition landed in the same session** (`void-recovery.ts`). That section is
> almost entirely a list of ways to overstate a recovery, so the module is a decomposition rather
> than a payout function: consolidate same-branch sets (value-neutral — `merge_scalar` pays no
> USDC and presenting it under a 100 % heading is the named defect), pair across branches at par,
> then redeem the residue at `floor(a/2)` for branch-USDC and `floor(a/4)` for a leg. **The order
> is forced, not preferred**, and that is what makes the total lawful as *the* headline §11.6 step
> 3 demands: consolidating trades `2·floor(a/4)` for `floor(a/2)`, never less; pairing trades
> `2·floor(a/2)` for `a`. Both are asserted rather than argued.
>
> **SQ-171 is two fields, because collapsing them is how the wrong one gets used.**
> `mayOfferParMerge` is the *action* and is true whenever a cross-branch pair exists;
> `parCopyPermitted` is the *copy* and requires the decomposition to have left **no residue** —
> a portfolio of one unit of pair and ninety-nine of residue recovers far under par, and a
> headline quoting the pairs alone is exactly the promise SQ-171 forbids. No fee appears anywhere
> on this path and a test asserts the absence: `redeem_void` and every `merge*` are exempt (03
> §5.3a(1)), so a fee line here would be wrong rather than redundant.
>
> **The S3 ticket's precondition rows landed too** (`trade-ticket.ts`, §11.5 P-1/P-2). Two of its
> rows are where a client can be *confidently* wrong, so they get the care: **the two published
> forms of the trade fee must agree** under 02 §9 rule 4's floored `Perbill / 100,000` projection
> — they are one number from two surfaces, so a disagreement means one is stale and neither may
> be quoted from — and **`quote()` must equal the client recompute exactly**, which is a stronger
> reading than P-1's *"within the fixed-point bounds"* on purpose: `packages/protocol` reproduces
> the runtime's integer path and `chain-quote-agreement.json` certifies the same base unit, so a
> tolerance would admit a disagreement the port is built not to have. The balance row checks the
> **charge**, not the amount — on a buy they differ by the fee, and checking the amount passes a
> trade the runtime refuses for want of the last few base units, after the user signed. Every
> failing row is returned rather than the first (§11.4 rule 5), an unread input blocks, and a
> ticket that mixes the decision and Baseline models is refused rather than half-checked.
> **A hosted book relaxes no row** (§11.2a rule 4): the domain is carried so the caller must have
> established it, and the suite asserts both domains produce identical verdicts.
>
> **Resume state (2026-08-06, session close).** `main` is at `c17f3bef` (#248, then #251's output
> style). **Both open PRs are rebased onto it, mergeable, and had zero failures at close, but
> neither was green yet** — that is the whole of what is outstanding, and it is CI wall-clock
> rather than work:
>
> - **#249** `track-f/frontend-budgets` — SQ-557's budget repair and the two-partition follow-up.
>   Ready for review, not draft. Merge it **first**; it is the older branch and #250 is the one
>   that rebases more cheaply.
> - **#250** `track-f/advanced-surface` — F7b's model layer (this block) plus V-173. **Still a
>   draft**: mark it ready once its exhaustive run is green (R-12), then merge.
>
> Both edit PLAN.md's *Current focus*, *Verification log* and *Session log*, so whichever merges
> second needs a rebase with the usual append-only resolutions; `rerere` already holds this
> session's. Verify a rebase the way this session did — the branch's diffstat against the new
> base must equal its diffstat against the old one, or something moved that should not have.
>
> **Next work after the merges:** F7b's remainder is the render layer plus its reads — S4's
> position reads across both domains, S20 balances, S2's finalized decision dashboard, and the
> components over all of it. The model layer they sit on is done and covered.
>
> **Two rulings only the user can give**, both filed and neither guessed at: **SQ-600** (may a
> half-stake reporter still report — it decides whether audit-scope oracle code gains a check or
> doc 11 §11.5's P-13 clause is corrected) and **SQ-599** (a 02 §4 contract addition for a
> separately named *currently challenged* field, which is a contract bump with joint sign-off and
> was deliberately not ridden inside a client fix).
> ### ⇨ CURRENT (2026-08-06) — **PR #257: the operator surface's gate proved less than its holders assumed, and a resolved spec question had locked three screens shut**
>
> Six `chatgpt-codex-connector` findings on **#257** (F17, `track-f/operator-surface-close`),
> five P1 and one P2. **All six confirmed; none refuted.** Four of them are one theme — a token
> that certifies less than its holder believes — and each is repaired at the type level rather
> than by a runtime guard a later caller can forget.
>
> - **`GatePassed` named nothing it proved.** It carried a block and a result set, so it
>   attested that *some* call to `gate()` succeeded. `TxSession` is structural, so an authentic
>   window could be paired with a different preparation — or with **none**, which
>   `declarationBlock` explicitly accepted — and a privileged operator control then enabled
>   against unrelated bytes. It now carries `prep`, `reduce` refuses to enter
>   `AwaitingSignature` with a proof minted for another preparation, and `operatorGate` refuses
>   both the missing preparation and the crossed proof.
> - **One read satisfied a whole row.** Every clause of `O-1` carried the id `O-1`, and coverage
>   compared row ids — so the registry check alone minted a signing window for a 100,000-USDC
>   stake whose amount, balance and fee headroom were never evaluated. Coverage is now per
>   clause: `ClauseId` is a `` `${string}/${string}` `` template type a bare row id **cannot**
>   satisfy, `TxPreparation` carries the fee asset the obligation set depends on, and every
>   `anyOf` group is one obligation with one id. The hole was never operator-specific — `P-1`
>   and `P-12` had it too.
> - **`readonly bytes: Uint8Array` is not immutable data.** A holder of a valid
>   `VerifiedArtifact` could write `artifact.bytes[i]` after verification and keep the brand, so
>   `UpgradeSubmission` would accept a runtime whose hash was never compared with the chain's
>   authorization. The bytes are now a `#` private field behind `copyBytes()`, which returns a
>   fresh copy per call; the class's private field also makes the type nominal, closing the
>   `as` hole the phantom symbol left open.
> - **The streamed chunks were retained by reference.** `ArtifactSource` permits a reader that
>   reuses one buffer between yields; the hasher consumed each chunk's contents immediately
>   while `parts` kept pointing at the same memory, so the concatenation could return the last
>   chunk repeated — as a branded artifact whose hash described different bytes. Every chunk is
>   now snapshotted before it is hashed **and** retained, one object for both.
>
> **P-13 fails closed, and that is a ruling rather than only a fix.** The row checked the bond
> *floor* and offered the report. For any component with non-zero stake at risk the runtime
> holds `ceil(orc.bond_bps × StakeAtRisk / 10,000)`, which is strictly more — so an account
> passing that check is short at dispatch or has more taken than the screen showed, on a
> slashable action, against a figure the user reasonably reads as the price. §11.5 already rules
> the case one rule over: the redemption-fee rule 5 says *"Unreadable ⇒ no figure, never a
> default … the transaction blocked"* and forbids mirroring the runtime's own fail-open read.
> P-13's obligation is now `blocking`. **No spec text was amended**: the honest repair is the
> missing surface (SQ-598), not a doc edit blessing the floor, so SQ-620 stays open.
>
> **And S17 had never been reachable.** `UNREADABLE['O-6']` still declared
> `ExecutionGuard.PendingUpgrade` and `System.AuthorizedUpgrade` unfrozen and `blocking` —
> **contract v28 froze both in this branch's own base** and PLAN.md marks SQ-615 resolved. Since
> `operatorGate` turns a blocking obligation into a refusal, the upgrade crank could not reach
> `ready` in any state, and its suite had settled for asserting the block. The same was true of
> S15 (SQ-616) and S19's challenge panel (SQ-619). All three seams are retired and replaced with
> ordinary clauses over the v28 surfaces; `O-5`'s citation moved to **SQ-601**, the open row that
> actually owns the per-stream treasury read, and two genuinely open gaps are filed anew —
> **SQ-730** (§11.8.2 never binds a `PlaybookTrigger` variant to the item that answers it) and
> **SQ-731** (the registry filing bond scales off an exposure no surface publishes — SQ-598 one
> pallet over).
>
> **The expiry claim is now mechanical.** `rows.ts` had always said these declarations expire
> *"by the row closing, not by somebody remembering to delete a comment"*, and the only checker
> asserted the cited id was *a row* and never read its status.
> `tools/ci/check-unreadable-obligations.py` (CI `docs` job, plus `tools/ci/tests`) fails when a
> cited question is not open, and the app-side test now reads the status cell too.
>
> **Verification.** `pnpm -C app test` **1,204 tests, 0 failures**; `build`, `check:types`,
> `depcruise` + witness, `test:firewall` (24/24), `check:casts`, `check:render-provenance`,
> `check:above-fold`, `check:chain-literals`, `check:no-html-sinks`, `surface:check`,
> `test:protocol` all green. Root: `check-plan-tables.py`, `check-spec-question-batches.py`,
> `check-dispatch-mirror.py`, `check-client-surface-obligations.py`, `check-doc-links.py`,
> `check-unreadable-obligations.py`, `python3 -m unittest discover -s tools/ci/tests` (251
> tests). **9 mutants, 0 survived** — one per finding plus the two expiry checkers, each
> reverted, watched fail, restored, watched pass. Control-character sweep clean over all 19
> touched files. **GitHub Actions was in a major outage for this round, so nothing was verified
> by CI; every result above is local.**

> ### ⇨ CURRENT (2026-08-06) — **The published skill corpus stayed at contract v27, and 12 of its 16 documents stopped meaning what their filenames say**
>
> **The `chatgpt-codex-connector` P1 on #253 is valid, and the measured consequence is larger than
> the finding states.** `admitIntent` compares `binding.contractVersion` against the live one by
> exact equality (`app/packages/intents/src/admission.ts:588`) and refuses a mismatch with
> `FE-HANDOFF-005`. Run against a v28 binding, **12 of the 16 published examples stop doing what
> their filename claims**: all five `admitted--` documents are refused, and seven `refused-`
> documents return `-005` instead of the code they publish, because the binding comparison runs
> ahead of the expiry, closed-shape and limit checks. Only `-001`, `-002`, `-005` and `-010`
> survive, and those four are decided before the binding is read.
>
> **The honest qualifier, stated rather than smoothed over: this is a documentation surface, not
> a live client path.** The corpus carries a fixed documentation genesis hash, so no example was
> admissible by a real client at v27 either, and nothing in `app/` imports `app/skills/`. What the
> bump broke is what a producer author copies and debugs against. A published example that names
> the wrong refusal is exactly the stale-corpus failure `reference/safety.md` rule 7 exists to
> prevent, and it fails in the direction that blames the client.
>
> **Why a green gate did not see it.** The generator emitted the corpus from a hardcoded
> `contractVersion: 27` and then judged that same corpus against the same hardcoded number, so
> `skills:check` agreed with itself at any version. The repair is the binding, not the number.
> `app/tools/generate-skill-examples.ts` now reads `INTEGRATION_CONTRACT_VERSION` and the primary
> runtime's `specVersion` from `@bleavit/descriptors`, so the corpus moves with the release by
> construction. The two hand-written documents that restate the same context in prose —
> `app/skills/README.md` and `reference/formats.md`, the second inlined verbatim into both
> `INSTRUCTIONS-*.md` — are held to it by a new check that **fails when it finds no match**, so a
> reworded paragraph is a failure rather than a silent pass. The genesis hash stays a
> documentation stand-in on purpose: it is what keeps a published example from being a
> ready-to-sign request.
>
> **Mutation-proved in three directions.** Moving the constant to 27 produces two `STALE` lines and
> 16 `DRIFT` lines. Rewording the published sentence produces `UNBOUND`. Both revert to green. The
> two test fixtures still pinned at 27 (`tests/contexts/capsule.test.ts`,
> `tests/screens/screens.test.ts`) are **deliberately left alone**: neither is compared against the
> live constant, and the suites around them carry 23, 24 and 25 for the same reason.
>
> **Gates:** app `pnpm test` — 41 gates, 18 suites, **0 fail** — plus `depcruise` (0 errors),
> `descriptors:check` (19 files byte-identical) and `check-chain-feed.py` (contract v28, paired
> feed). **Next:** the reply is posted on #253. The exhaustive Rust gate for this branch runs
> under the main session, which owns the merge order for #253 and the stacked #257.
>
> ### ⇨ CURRENT (2026-08-06) — **The SQ-557 repair counted one resource partition and there are two: hosted books emit the same events, at a higher duty cycle, and nothing in §9 saw them**
>
> **Both P1s Codex filed on #249 are valid, and both are the *same defect one layer down* from
> the one the PR fixes.** SQ-557's repair replaced a wrong book count (196) with a right one (31)
> and then modelled that count as though it were the whole population. It is the primary
> partition's count. Doc 11 §11.2a is normative that *"the canonical client **serves external
> books**"*, 02 §5 states `Traded`/`Observed` with **no domain filter**, and
> `market_call_targets_external_book` routes a hosted fill by book kind — so hosted traffic is
> this client's cost, and §9 counted none of it.
>
> **The fill ceiling was 25 % low, and the reason is structural rather than arithmetic.**
> `normal_class_budget()` is `primary_capacity()` — the 75 % reservation. `side_fits` checks only
> its own side's capacity and the sole joint constraint is `before + amount ≤ max_block`, so both
> partitions are consumable in the same block. Measured off the live runtime rather than derived:
> primary `(1.5e12, 7,864,320)` → **70** fills, external `(5e11, 2,621,440)` → **23**, `max_block`
> `(2e12, 10,485,760)` → **93** — and 70 + 23 = 93 exactly, so the two shares saturate the block
> rather than being capped by it. **1,008,000 → 1,339,200 `Traded` rows/day ≈ 160.7 MB/day**;
> the desktop events share drains in **6.7 h**, not 8.9.
>
> **The book count is worse, because the hosted duty cycle is not the primary one.** A primary
> book trades only inside Trade (`[5/21, 18/21)` ⇒ duty 13/21 ⇒ 891.43 rows/day). A hosted book
> trades while its question is `Open` (16 §7.6) — a window of its own, up to `svc.max_window` =
> 302,400 blocks = one full epoch — so its duty is **1** and it emits **1,440** rows/day, 1.6× a
> primary book. 13 §2's fee-floor derivation counts it the same way, at
> `2 · ceil(svc.max_window / mkt.obs_interval)` = 2 × 30,240 cranks per question. Population:
> `MaxLiveExternalMarkets` = `2·svc.max_live` ≤ 128, and `svc.max_live` is `[VERIFY]`-tagged at
> **16 provisional** against a registry maximum of **64** — a PARAM row with max-Δ ×2 and a
> 2-epoch cooldown, so governance reaches the ceiling in two amendments and the client must be
> budgeted against **159** books, not 31.
>
> **Corrected depths, and the honest reading is that this cuts both ways.** Desktop raw
> 54 d → **7.1 d** at the registry maximum (20 d at today's provisional); mobile 13.6 → **1.8 d**;
> hourly candles 672 → **131 d**. The previous revision's *"deep raw history is not achievable
> within the caps"* was still false **for the reason it gave** — it followed from 196 — but
> quoting only the 54-day primary figure would have repeated the original error in the opposite
> direction, so §9.2 now states both columns and says which one the client plans against.
>
> **The gate is what should have caught this and did not, so it was the thing to fix.**
> `check-frontend-budgets.py` re-derived §9 from doc 13 and the runtime — and had no concept of a
> second partition, so it confirmed a one-partition model with complete conviction. It now derives
> per partition and sums: **47 cells** (was 29), reading `svc.max_live`'s default *and* its
> registry max, cross-checking `MaxLiveExternalMarkets` = `2·svc.max_live`, binding the runtime's
> 70/23/93 split three ways, and **failing on a §9.1 row it cannot parse or a §9.2 depth table
> with fewer than four columns** — because the way this defect survived was a column that was
> never there to be checked. **31 mutation tests** (was 19), including the exact Codex finding:
> publish 70 as the block ceiling and the gate now says the runtime pins 93.
>
> **Also fixed: PR #249's red Reference-model job.** Two `test_frontend_budget.py` cases pinned
> SQ-557's *defects* — that §9.4 had no metadata row and that one doc-13 citation dangled — and
> the repair made both false. Inverted to assert the repaired state, each paired with a fresh
> anti-vacuity case proving the check can still go red; the old anti-vacuity test had itself
> become vacuous, since it appended a doc-13 row to fix a citation that no longer dangles.
>
> **Gates:** runtime 457 tests / 12 `pov_budgets` green · `tools/ci` **245 OK** · reference-model
> **701 OK** · frontend-budgets 47 cells · fmt + clippy clean · doc links, PLAN tables,
> spec-question batches, verbatim copies green (the verbatim gate caught doc 10's own drift and
> repaired it). **Next:** #248 merged 2026-08-06 as `b0851ca8`; this branch is rebased onto it
> and merges when green.
>
> ### ⇨ CURRENT (2026-08-06) — **SQ-557 ruled: 10 §9 sized the browser against a book count the chain cannot reach, and omitted the larger half of the event stream**
>
> *(Superseded above on the same day: the fill ceiling below reads 70/block and the depth cells
> are primary-partition-only. Both are corrected in the block above; the reasoning here still
> stands for the 196 → 31 half.)*
>
> **F14 was the last ⬜ Track F milestone with a stated blocker, and the blocker was a spec
> question: *"SQ-557 invalidates the budget numbers — re-derive first."* Ruled here under R-1
> rather than deferred, because a budget table measured in CI against wrong targets is worse
> than no table.**
>
> **The count was wrong by 6.3×, and doc 13 already said so.** §9.1 sized every retention
> figure on **196** concurrently-observing books, citing `MaxLiveMarkets`. But that bound counts
> books **without a durable terminal latch** — a book that closed at d18 holds its slot until its
> vault settles at e+3 — while 04 §2 admits trading and observation **only** in
> `Trading`/`Extended`. Live-but-closed books provably emit nothing. The emitting set is one
> epoch's trading books, and Trade (`[5/21, 18/21)`) does not overlap the next epoch's, so the
> sustained count is `epoch.slots·6 + 1` = **31** — the identical figure 13 §5 item 4 already
> derives, from the identical parameters, for the keeper crank load. Two documents, one model,
> different answers, and nothing compared them.
>
> **31 is a maximum, not a typical**, and that took deriving rather than asserting: `epoch.slots`
> has a registry ceiling of 12, but 13 §5 item 2 freezes the vault envelope at 52 =
> `MaxLiveProposals + MaxSettlingCohorts·epoch.slots`, so the occupancy screen refuses every raise
> above 5 and no reachable parameter history admits a sixth slot. Corrected cells: desktop raw
> depth **8.5 d → 54.3 d**, mobile 2.1 → 13.6, hourly candles 106 d → **672 d**. All
> capacity-*safe* — but §9.2 concluded from them that deep raw history is *"not achievable within
> the caps"*, and that published limitation was simply false.
>
> **The unsafe half is the omission.** 02 §5 freezes the minimal client ingest set as `Traded`
> **+** `Observed`; §9.1 modelled only `Observed`. Unlike observations, the trade stream is not
> paced by a grid — it is paced by what a block can hold, and the client cannot decline it. The
> runtime now pins that ceiling: **70 fills/block**, where **proof size binds** (111,860 B of PoV
> against the 7,864,320 B primary reservation) while ref_time would admit 153. At 14,400
> blocks/day that is **1,008,000 `Traded` rows/day ≈ 121 MB/day**, about **36× the entire sample
> stream at maximum slate**, consuming the desktop events share in **8.9 h** and mobile in
> **2.2 h**. So the events share is a share, not a depth promise, and the index retains
> watched-account events only — which is §6.5's own rule (*"worst-case overhead is proportional
> to the user's own activity, not chain activity"*) applied to storage as well as to body
> fetches, and is what F8's scanner already implements.
>
> **SQ-557's own arithmetic was wrong in the unsafe direction and the pin caught it.** The filed
> row derived 36 fills/block from a 5 MiB PoV; `polkadot-primitives 25.0.0` pins `MAX_POV_SIZE`
> at **10 MiB**, so the true ceiling is twice as permissive and the events share drains in half
> the stated time. My own hand-derivation was wrong too, and differently — it read the generated
> weight file and got 72, missing that `buy`'s `#[pallet::weight]` adds two reads and
> `EXTERNAL_TRADE_ROUTE_PROOF_SURCHARGE` on top, which is the whole 72 → 70 gap. Both errors are
> the same shape as the defect being fixed: a number derived once, by hand, from a source that
> was not the one the chain charges. The pin is therefore taken through `get_dispatch_info()`.
>
> **What stops it recurring is that nothing now holds the answer alone.**
> `tools/ci/check-frontend-budgets.py` re-derives all **25** published cells from 13 §1/§3.1/§4/§5
> and the runtime's pin, and the runtime test proves that pin against the live block budget — a
> three-way binding in which the checker carries no load model of its own. That is the V-169
> lesson one level up: a constant plus fixtures built from that constant agree with each other
> and never with reality. It has already earned it — it caught one of my own depth cells rounded
> to 13.5 where the derivation gives 13.6. **16 mutation tests, all caught; `tools/ci` 222 OK.**
>
> Also corrected: §9.3's metadata cap **exceeded its own §9.2 share** in both cases (16 > 15 MB
> desktop, 6 > 3.75 MB mobile) — a bound above its share cannot bind — against a **measured**
> 0.14 MB gz blob rather than the assumed "~1–2 MB"; §9.4 gained the bundle row release-shipped
> fallback metadata never had; and §9.2's citation of doc 13 for the 300/75 MB quota caps is
> dropped, because a browser quota is not a chain parameter and doc 13 has no such row — §9 owns
> every other budget value in it, and that line was the anomaly.
>
> **A second closed loop turned up while auditing which §9.4 rows are actually gated.** Only
> one is — `app/tools/check-smoldot-budget.ts` — and it cited **§9.3** (metadata blobs) for a
> row that lives in §9.4, while holding **its own copy** of the bound and reading it as
> **MiB**: `3.5 * 1024 * 1024`. §9's other arithmetic is decimal — §9.2's depth tables are
> only reproducible at MB = 10⁶ — so the gate was quietly enforcing 5 % more budget than the
> document allots, and nothing could notice because the document and the gate each held the
> number separately. §9 now states the convention once, the constant is `3.5e6`, the citation
> is §9.4 in both the tool and the CI step, and the checker **evaluates** the constant's
> expression rather than matching its spelling — a literal match would have reported the MiB
> form as *"anchor missing"* instead of as the over-grant it is. 26 cells bound; 17 mutation
> tests; `tools/ci` 223 OK. Measured smoldot 3.3.2 is 2.21 MiB gz, comfortably inside either
> reading, so this is a latent defect rather than a live one.
>
> **Regenerating the design kit twice by hand exposed a third instance of the same class,
> and this one had already drifted.** `docs/design/claude-design-kit/` ships two
> `*-VERBATIM.md` files, each declaring itself byte-identical to a `docs/architecture/`
> document and each ending *"if this copy and the source ever differ, the source wins"*.
> AGENTS.md obliges a regeneration after any spec change. `check-doc-links.py` even
> **special-cases** these files so their relative links are not resolved against the wrong
> directory — so the file class was known to the tooling, and still **nothing compared the
> bytes**. `04-frontend-workflows-and-screens-VERBATIM.md` was three lines behind doc 11: a
> resolved `[VERIFY asset index 1337]` had become a stated per-release pin in the source
> while the kit still published the unresolved tag. **The failure is quiet by construction**
> — a design tool is fed the copy, not the source, so a wrong copy is indistinguishable from
> a wrong source to whoever reads it, and the reader has no way to tell which they are
> looking at. `tools/ci/check-verbatim-copies.py` now compares the bodies byte-for-byte,
> `--write` regenerates them, and the header note stays hand-written because a gate over
> prose is either vacuous or stops people writing it. **8 tests, 3 of them anti-vacuity**
> (no copies found, a copy naming no source, a copy naming a source that does not exist);
> `tools/ci` **231 OK**.
>
> **One input was still a label rather than a value, and it is now cross-checked.** Every rate
> in §9 scales with blocks/day, which the checker derived from the *parenthetical* `(21 d)` on
> 13 §1's `epoch.length` row — the weakest link in a gate whose whole point is that numbers
> have owners. `futarchy-primitives` publishes `BLOCKS_PER_DAY = 14_400` as a kernel constant,
> so the two are now compared and a disagreement refuses before any cell is derived rather
> than silently rescaling all of them. **27 cells; 19 mutation tests; `tools/ci` 233 OK.**
>
> **F14's first row is now built rather than unblocked.** §9.4's enforcement column has said
> *"bundle-size CI gate"* since the reviewed design, CI has built the release tree per commit
> for as long as `release:build` has existed, and **nothing measured what it emitted** — the
> same shape as SQ-557 one row up. `app/tools/check-bundle-budget.ts` measures the entry
> chunk's **static** import closure, gzipped: a dynamic `import(` is not followed, because that
> is exactly the lazy boundary the smoldot and chain-spec rows are budgeted on separately and a
> gate summing all of `assets/` would charge first render for code it never touches, then get
> relaxed until it stopped complaining. Both of §9.4's thresholds are enforced and both are
> bound to the published cell — a target nobody checks is how *"≤ 350 KB"* becomes decoration.
> Measured today: **63.2 KB gz**, 387 KB below the hard fail. Runs in the same CI step as
> `release:build`, since `dist/` exists only within it.
>
> **Next:** §9.4 now has thirteen rows and **two are gated** — initial JS and smoldot, both
> pure size measurements over committed artifacts. Of the eleven left: the chain-spec row is
> artifact-blocked (no chain-spec bytes are committed for any chain), the release-metadata row
> waits on the FE-P5 fallback blobs, the IndexedDB row waits on F8's quota manager, and the
> remaining **eight are timing, memory and throughput rows that need §9.4's reference hardware**
> — a mid-2023 laptop at 4× throttle and a Moto G-class Android. That is F14's honest residue:
> device-blocked, not derivation-blocked, and now measured against targets that are correct.
> Rebase #248 onto `main` and merge when green.

> ### ⇨ CURRENT (2026-08-06) — **F17's PLAN row was stale in every remaining item, and behind it sat a filter bound to a pallet that does not exist**
>
> **The row's *Remaining* list named three things and all three were built** — §11.8.1's
> `oracle.recompute_proof` (branded `RecomputedProof`, one mint site, a throwing mismatch),
> §11.8.2's pending-action `target` and resolved justification, §11.8.6's filing bond, bounds
> and pallet-bound ingest filter. V-120 had already recorded them closed on 2026-08-05 and the
> milestone row was never updated behind it. Corrected here rather than trusted in either
> direction: each was read against §11.8 before the row was touched.
>
> **What that read found instead is a defect nothing could have caught (V-169).**
> `registry-filing.ts` shipped with `REGISTRY_PALLET = 'Registry'`, and the suite built its
> fixtures out of **that same constant** — so the two agreed with each other while neither
> agreed with the chain. **There is no pallet named `Registry`.** `pallet-registry` is
> instantiated twice, as `IncidentRegistry` (56) and `MilestoneRegistry` (`Instance1`, 57), and
> 02 §6 freezes the window events under **both** instance names with separate rows each. So the
> filter matched nothing: every real `WindowAcknowledged`/`WindowExtended` was rejected, and
> §11.8.6's countdown adjustments could never happen.
>
> The failure direction is the one the module's own note names. A challenge window that was
> extended by watchtower quorum would render at its **base** deadline, so a challenger is told
> they are out of time while the window is still open — losing them exactly the window the
> extension exists to grant. And it is invisible today, because no live event stream is wired
> yet: a filter that rejects everything and a chain that emits nothing look identical.
>
> **V-120 is not wrong, and that is the lesson.** It verified the *shape* — that the check binds
> a pallet, and in both directions — which is real and still holds. What no test asked was
> whether the name it binds to exists. A constant plus a fixture built from it is a closed loop,
> and the repair is to break the loop rather than to fix the value: the pallet names are now a
> **required argument**, the module holds no chain identifier at all (asserted by absence, after
> stripping comments — the same tokenizer hole `check:chain-literals` had to close), and the
> suite takes the names from `tools/release/surface-manifest.json`, which `surface:check`
> byte-binds to `CRITICAL_SURFACE` and `test:mock-runtime` binds to real recorded metadata.
> The oracle fixture's *fields* come from the manifest too, so the refusal is proven against the
> event the chain really emits.
>
> **An admitted event now names which registry allocated the id.** The two instances allocate
> filing ids independently, so incident 42 and milestone 42 are different filings — a bare
> `filingId` would let a consumer key them together and put one filing's extension on the
> other's countdown, which is the same defect the pallet binding exists to prevent, re-entering
> one level down. Two registries configured under one name **throw**, because a mis-wired ingest
> filter that reported *rejected* for every event would look exactly like a quiet chain.
>
> **§11.8.1's second row was genuinely unbuilt: P-13/P-14 had no model anywhere.**
> `oracle-reporting.ts` is it, and the whole module is *read, never derive*:
>
> - **No bond arithmetic exists in this client, and a test asserts the absence.** P-14 says the
>   escalation bond *"doubles per round"*, which invites `B_1 << (round − 1)`. 07 §6.1 freezes
>   `B_1` and `R_max` **per game** at creation and forbids re-reading `orc.bond_floor`,
>   `orc.bond_bps` or `orc.rounds` on escalation — so a client that doubled would price the round
>   off *today's* parameters while the chain prices it off the frozen ones, and after any lawful
>   META amendment the number on screen is not the charge. 02 §4's `OracleRoundView.bond` is the
>   chain's own figure for the round; it is read. Same for `challenge_deadline`, which already
>   carries any extension: recomputing it from `orc.window` is the identical defect one field over.
>   This is SQ-552's shape, and `upgrade-crank.ts`'s `applicable_at` rule is its precedent.
> - **The round-1 report bond cannot be computed at all, and the client says so (SQ-598).** For a
>   fresh report there is no round to read, and the formula needs `StakeAtRisk(c, m)` — the sum of
>   cohort escrow over every cohort whose frozen MetricSpec consumes that component. 02 freezes no
>   surface carrying it, and reassembling it would be a client *computation* where 11 §11.4 rule 2
>   requires an exact chain read. So `reportBondFloor` returns a value **labelled a lower bound**,
>   `ReportCheck.bondUnknown` is a **required** field (SQ-564's device, applied to an amount of
>   money rather than to eligibility), and the screen renders the caveat on the **clean** path —
>   the only path where it matters, because a blocked form already says why.
> - **A reporter may not challenge their own round.** 07 §5.2 grants `challenge` to *"anyone other
>   than the round's own reporter"*; §11.5's P-14 row does not list it, but `OracleRoundView`
>   carries `reporter`, so it is an exact chain read and 11 §11.4's discipline is to refuse what
>   the chain will refuse. Left out it costs a fee and returns an error nobody can map to anything
>   they did.
>
> **Three screens landed with it** — `SubmitReport`, `ChallengeRound`, and `RecomputeProof` with
> its two **separate** refusals: a non-deterministic component is not a reporter behaving badly,
> and one message for both would be a false accusation in that direction. `RecomputeProof` takes a
> `RecomputeSubmission`, so there is no arm of the component in which the client's own
> recomputation contradicts the value — the spec's *"never submit"* is a property of the type.
>
> **9 mutations, 0 survived. 1,027 app tests, 0 fail**, plus build, `check:types`, depcruise +
> witness, firewall, casts, render-provenance, chain-literals, no-html-sinks, above-fold and the
> handoff gates. Control-character sweep clean.
>
> **F8's scanner landed in the same session — the join nothing owned.** `event-accounts.ts`
> and `ingest.ts` were each built and each tested, and **nothing connected them**: the loop
> consumes a `FinalizedBlockScan` and no code produced one. The join could not live in either
> package — `local-index` may not import the chain SDK (which is why `IndexedEvent.accounts`
> was injected in the first place) and `chain-client` may not import anything above it
> (`nothing-bypasses-chain-client`) — so it is `src/features/analysis`, the one compilation
> unit that depends on both and the one the §10.2 firewall keeps out of the transaction path,
> exactly as INV-FE-7 wants of anything reading the local index. That package had been an
> `export {}` placeholder since F0.
>
> Its safety property is a **refusal**, and it is one line of code either way: an empty
> `events` array is a *well-formed* answer meaning *no event in this block names anyone*, so a
> `System.Events` blob that fails to decode must **throw** rather than degrade to one —
> otherwise no body is fetched, the block is recorded as ingested, the coverage range claims
> it was seen, and the user's transaction is simply absent from their history with nothing
> anywhere reporting a problem. Same for an unrecognised phase, where **every available
> default is wrong in its own direction**: `finalization` drops the attribution silently, and
> `apply-extrinsic` needs an index nobody supplied — a made-up one attributes the event to a
> *different* extrinsic, which `loop.ts` then decodes and renders as the user's.
>
> `extrinsicCount` is a pass-through and is **never derived** (SQ-595: `max index + 1` makes
> `ingest.ts`'s bounds check vacuous by construction), asserted by absence. `watchedAccounts`
> ships beside the scanner so both sides of `watched.has(account)` go through `accountKey` —
> V-164's failure is a *string comparison* that matches nothing ever and presents as an empty
> history. The suite's negative oracle is the recorded transcript, which really is a block of
> inherents and must attribute nobody; the positive cases round-trip through the runtime's own
> `System.Events` codec. **6 mutations, 0 survived.**
>
> **F13's minisign verification landed too, and it closed a `valid` boolean nothing produced.** `verdict.ts` counted §1.4's floor over `{ keyId, generation, valid }` and no
> code anywhere computed that third field — a signature check that defaults to whatever the
> caller believes, which is `admitIntent`/`admitEvidence`/`admitSnapshot`'s shape for the
> fourth time. `tools/verify-release/minisign.ts` is the missing half, and
> `releaseSignatureFrom` is now the one function that produces a `ReleaseSignature`.
>
> **The load-bearing rule is the second signature.** A `.minisig` carries two Ed25519
> signatures over *different* messages: the primary over the artifact (or its BLAKE2b-512
> digest under the `ED` tag), and the **global** one over `primary ++ trusted_comment`. The
> trusted comment is covered by **nothing else** — and it is the only part of the file a
> person reads, the sentence they use to decide *what* they are trusting rather than whether
> the bytes are intact. A verifier that checks the primary signature and skips the global one
> passes every file check while that claim is entirely unauthenticated: anyone holding a
> validly signed artifact can restate its comment as anything at all and the verdict does not
> move. Both are checked, the refusal **says which failed** (a restated comment leaves the
> bytes intact, and *"the signature does not verify"* would send an operator to check bytes
> that are fine), and `ReleaseSignature.why` now carries that reason into
> `countReleaseSignatures`' rejection list.
>
> **The oracle is the other implementation, not a fixture written beside this one.** This
> repository already verifies minisign in Python — `tools/monitoring/attestation_monitor.py`,
> the 12 §5.2 out-of-band monitor, written earlier and independently. Every case runs through
> **both** and must agree: two parsers over the same bytes and two Ed25519 verifiers
> (`node:crypto`'s OpenSSL binding against a pure-stdlib RFC 8032 implementation). That is
> the only available check on my *reading of the format*, since minisign is not installed
> here and a hand-written fixture would assert the layout against the same reading it tests.
>
> **The mutation run found a hole in my suite rather than in the code**, which is what it is
> for. Deleting either packet-length check left every test green: a *short* packet fails
> anyway further down, so testing only that made the guard look redundant. The case it really
> carries is the **over-long** one — base64 decoding is permissive, `subarray(10, 74)` takes
> the first 64 bytes whatever follows, and a signature file with bytes appended would verify
> *identically to the original*. Two different files, one verdict, in the artifact whose whole
> job is to be the thing you compare against. Both directions are now tested. **8 mutations,
> 0 survived** after that; 12 tests in the differential; **1,046 app tests, 0 fail.**
>
> **Next:** F17's remaining items are the two external ones it always named — **FE-P10** (an
> in-browser measurement R-2 forbids resolving by assumption) and **SQ-564** — now joined by
> **SQ-598**, which is the same shape and the same console. The open 🔨 rows are F1 (PARKED),
> F8, F9, F11, F13, F15, F17, F18. F1 stays **PARKED** on external resources.

> ### ⇨ CURRENT (2026-08-06) — **#245 merged; F9 is complete — the sampling loop and the producer, and the format's arrays were not canonical**
>
> **`main` is at `d2262482`** (the user merged #245). Both stacked branches were rebased onto it,
> and **PR #247** now carries all of F9 against `main`. `git diff` proves the rebase touched no
> app code — the only content it moved is the gate text #246 relocated out of `AGENTS.md`.
>
> **F9's last two pieces are in, and the second one found a defect in the first.**
>
> **The live sampling loop** (`packages/providers/src/sampling.ts`) — §8.3's ladder and §8.4's
> 1-row-per-16-pages re-verification. Nothing here reads a chain: the comparison is an injected
> `RowCheck`, so the module that decides *which* rows to verify is separate from the one that
> knows *how*. Four refusals carry it, each a case where correct-looking code silently produces
> a client that reports a source as healthy when it is not:
>
> 1. **The sample is drawn from something the provider does not control.** `selectSample` takes
>    `random: () => number` — a function of **no argument**, the same device `defaultProviders()`
>    and `defaultScope()` use, and here it makes *"seeded from the data"* unwritable rather than
>    discouraged. A selection derived from page position, a row id, or a hash of the page for
>    *"deterministic, reproducible sampling"* is one the provider knows in advance, and it then
>    serves honest rows at exactly those positions for a cost of one row per 16 pages. The suite
>    asserts the source is called with zero arguments, which is the property rather than the
>    consequence.
> 2. **Stratified, not uniform.** One row from each window of 16 pages, not N draws over the
>    whole set. Same expected count, different adversarial property: uniform draws leave a
>    clustered forgery unsampled with probability that grows with the dataset. The count rounds
>    **up**, because rounding down lets any import below 16 pages verify nothing and report a
>    clean round.
> 3. **`disabled` is terminal in both arms.** A healthy probe does not resurrect a
>    user-disabled source, and it does not resurrect an auto-disabled one either — §8.4 makes
>    re-enabling an explicit user action, because the source that failed a sampling round is
>    exactly the one whose next probe succeeds. A ladder written as a pure function of the
>    latest outcome switches it straight back on and never says so. `Failing` counts
>    **consecutive** failures (a cumulative counter disables every provider given enough
>    uptime), and `Slow` never disables at all.
> 4. **A check that throws is `unverifiable`, and the round continues.** Aborting looks safer
>    and is not: the reference is provider-supplied, so a publisher can embed one whose re-read
>    reliably errors and thereby discard the mismatches found earlier in the same round. A round
>    where nothing was comparable is `inconclusive` — its own outcome, not folded into `clean`,
>    because *"verified nothing"* and *"verified everything"* are the two facts a caller most
>    needs to tell apart.
>
> **The producer** (`app/tools/snapshot/`) is a thin driver over the shared format, and its one
> substantive decision is that **`balances` are a differential against chain state rather than a
> restatement of the fold**. A producer that folded its own ops would agree with itself by
> construction, and §8.4's event↔derived-row screen could never fail on anything it emitted —
> while the failure that actually happens to a snapshot tool is an **incomplete op set** (a
> variant not decoded, a range answered short), which is perfectly self-consistent and invisible
> to a self-fold. So `ArchiveExport` carries balances read independently at `range.toBlock` and
> the driver refuses to publish when the two disagree. Coverage is what the reader **observed**,
> never the requested span, for the same reason: a reader that fails part-way and reports the
> request anyway publishes a document claiming history it never saw, and it passes every screen.
> The last step runs the **client's own `admitSnapshot`** over the bytes just produced, so
> nothing the tool writes can fail at the user.
>
> **The format's arrays were not canonical, and the producer is where that surfaced.** Canonical
> JSON sorts object *keys* and leaves array order exactly as given, so `vaults`, each vault's
> `branches` and `balances` each had two legal spellings — and `coverage` had two more, since
> `checkCoverage` permitted `10..11` beside `12..13` **and** `10..13`. Two honest producers would
> have published two pins for one history, which makes §8.2's *"reproducible byte-identically by
> anyone"* simply false, and the way anyone would have found out is a user being told a correct
> snapshot is corrupt. The rule is now stated in 10 §8.2 (R-1) and **checked** at import, because
> a rule two producers must follow and nobody verifies is a rule they will diverge on. `ops` is
> deliberately **exempt**: its order is the chain's and it is semantic, so sorting it would let an
> invalid history be reordered into a valid-looking one — a case the corpus asserts.
> `byCodePoint` moved out of `handoff-envelope`'s private scope rather than being reimplemented,
> since a second comparator agrees on every ASCII label and diverges at the first astral one.
>
> **The firewall corpus caught the same class of mistake twice, and was right twice.** Reaching
> `@bleavit/providers` from `app/tools/snapshot/build.ts` needs a dependency somewhere;
> declaring it at the **app root** hoists it and turns
> `tests/firewall/fixtures/forbidden-package-edge.ts` from TS2307 into TS2305, voiding the
> fixture whose entire proof is that the package is *unresolvable* there. The tool is its own
> workspace package instead, so the dependency is scoped to the directory that needs it — the
> same shape as every test suite here.
>
> **The workflow-wiring gate fired on its own account.** `test:snapshot-tool` existed in
> `package.json` and in `pnpm test` but had no `ci.yml` step, which is exactly the V-90 hole
> `tools/ci/tests/test_workflow_wiring.py` was built for. Wired.
>
> **Gates: 1,108 app tests across 17 suites, 0 fail** (85 providers, 20 snapshot-tool);
> `pnpm install --frozen-lockfile`, `tsc -b`, `check:types`, `depcruise` (0 errors) all green;
> `check-chain-feed.py`, `descriptors:check`, `check-plan-tables.py` green; `tools/ci/tests`
> 206 tests OK; **zero control characters** across `app/`. The CLI was exercised end to end:
> two builds of one export are byte-identical, a differential mismatch refuses and writes no
> file, and `verify` admits the result at its own pin.
>
> **The Codex connector reviewed #247 and found six real things; all six are fixed.** Three
> P1: the format could not encode `PositionTransferred` at all (an honest history containing
> a transfer had no representation — drop it and the balances fail replay, fake it as a
> merge-plus-split and escrow moves that never moved), `diffSnapshots` took its overlap from
> the declared **`range`** rather than the **`coverage`** arrays (so two producers each
> declaring 1..100 and observing disjoint halves would raise `FE-PROV-004` on an honest
> pair, and with no movements would report agreement over blocks neither had seen), and the
> diff keyed movements into a **map**, collapsing two identical movements in one block — so
> `[split 100, split 200]` and `[split 50, split 200]` both projected to `200` and compared
> equal, defeating the only cross-check §8.4 offers at depth in exactly the case a forger
> chooses the movements. Three P2: amounts were unbounded above (`BigInt` has no ceiling, so
> `2^128` replayed and reconciled perfectly while describing a quantity no chain balance can
> hold), `FE-PROV-004`'s recovery copy called a third snapshot *"the only thing that resolves
> it"* — contradicting the §8.4 table this same PR added, which leaves the range a hole and
> rejects resolution by majority — and admission holds the whole file in memory. The last is
> **partly** fixed and partly disclosed: one of the two full re-serializations is gone
> (`preimageOfSerialized` hashes the canonical form already in hand, bound to
> `snapshotPreimage` by a test), but a genuinely streamed parse/replay is not built, so the
> §8.4 quota's 400 MB ceiling is not servable end to end and now says so.
>
> **V-168 — app-code rule 14's fourth NUL, and the first the sweep caught rather than a
> failing assertion.** Writing `` `${SNAPSHOT_FORMAT}\0` `` through the Edit tool put a raw
> NUL on disk; the tell was `grep preimageOfSerialized` on the file returning **nothing at
> all**, which is the documented symptom (git classifies the file binary) and reads as *the
> symbol is not there*. Repaired by writing the separator as a **byte** into the array
> rather than into a string.
>
> **Next:** F17's rendered operator consoles (its model layer is complete). F18's remainder stays
> artifact-blocked — no chain-spec bytes are committed for any chain. F1 stays **PARKED**.

> ### ⇨ CURRENT (2026-08-06) — **F9's snapshot format; git and `gh` were down under the Bash sandbox**
>
> **PR #245 is open, CI ran, and it cannot be read or merged from this session.** Enabling the
> Bash tool's sandbox mid-session broke both git and `gh` (**V-166**), so the merge is deferred
> to a session with the sandbox off. Nothing is wrong with the branch; the tooling to inspect it
> is unavailable. **Everything below this line is uncommitted** — it lives in the working tree at
> `track-f/funding-reads` and needs a commit as its first act once git works.
>
> **F9's snapshot half is built.** `packages/providers/src/{refusals,snapshot}.ts`: the
> `FE-PROV-001..004` family with fixed copy and recovery per code, and `bleavit.snapshot.v1` —
> the format, its content pin and §8.4's three internal-consistency screens, in **one module the
> producer and the consumer share**. That is the single-generator discipline the vector corpus and
> the Rust-written fixtures already follow, and here it is load-bearing: producer and client must
> agree on *which bytes are hashed* or the pin is decoration, and a second serializer would fail
> every pin from that producer, which reads to a user as a corrupt download.
>
> **Two spec readings were settled by reading the spec rather than by choosing.**
>
> 1. **`tools/snapshot` is `app/tools/snapshot`.** 10 §10.1 says so in as many words — *"Its
>    `tools/{release, verify-release, snapshot}` sit under `app/` deliberately: the repository
>    root already has a `tools/release/` for chain-release tooling, and the two must not be
>    confused."*
> 2. **The sampling rate is ~1 row per 16 pages, not one page in sixteen.** 10 §8.4's
>    *"1-in-16-page row re-verification"* is ambiguous read alone; 14 TH-49 states it outright and
>    draws the conclusion — *"sampling (~1 row per 16 pages) quantitatively verifies almost
>    nothing at depth"*. That sparseness is **why TH-49 is an accepted residual**, so the looser
>    reading would have had the client overstate the guarantee the threat model declines to make.
>
> **A real spec gap closed under R-1** (Decision log): §10.4 declares `FE-PROV-001..004` and
> requires copy + expert detail + recovery *per code*, but only 002 and 004 were ever bound to a
> mechanism — and both bindings lived in **other documents**. An unbound code has no copy, so the
> mechanism that should raise it emits free text, which §10.4 forbids. 10 §8.4 now carries the
> table, with 001 and 003 **derived** from the two mechanisms §8.3/§8.4 already describe rather
> than picked. §8.3 also now classifies its ladder thresholds as release constants (§5.4's
> no-literal rule governs what governance can move; a third-party endpoint's latency is not that).
>
> **Three refusals in the format that the obvious implementation gets wrong**, all silent:
>
> - The conservation replay checks **at every step**, not at the end. A forger who drives an
>   account negative and back again is exactly what a final-state check waves through, and the
>   intermediate state is the one that could never have existed on chain.
> - It asserts conservation but **not** I-1's cross-branch equality (`supply[b] == escrow` for
>   every branch). That holds only until settlement — `redeem` burns the winning branch alone — so
>   the obvious check reports **every settled vault** as a forgery.
> - `admitSnapshot` takes its hash function as a **required argument**. An optional one is a
>   content pin that defaults off, which no green run distinguishes from one that passed — the
>   same defect F20 fixed in `admitIntent`.
>
> **The forged corpus is in and it is the honest shape.** 54 tests over the snapshot format,
> rejecting per **named class** rather than by a boolean — `malformed`, `canonical`, `pin`,
> `binding`, `coverage`, `conservation`, `derived-rows` — because a corpus proving only *"bad
> snapshots are rejected"* cannot say which screen was load-bearing when one regresses, and a
> screen that has stopped firing is invisible under a green run. **One document in it is
> admitted**: a self-consistent deep forgery, exactly what 10 §8.4 and 14 TH-50 say is not
> detected. A corpus made only of rejections would be evidence for a guarantee the mechanism
> declines to make.
>
> **`admitSnapshot` takes the file text, not a parsed object**, and that is the whole of the
> canonical-form check. §8.2 asks for exports *"reproducible byte-identically by anyone"* —
> a claim about **bytes** — so a consumer that parsed first could never evaluate it, and would
> accept two different files for one history, at which point a content pin no longer addresses
> content. Pretty-printed and annotated files are both refused by round-trip.
>
> **`cat -A` found six raw NUL bytes in my own new source** (`snapshot.ts` ×5,
> `snapshot.test.ts` ×1) — app-code rule 14's third instance, and the first to arrive through
> the Write tool rather than a shell heredoc. Every suite passed with them present; the only
> reason they surfaced is that an assertion claiming the separator was a *space* also passed,
> which is the tell. Five of the six were a composite map **key separator**, so the repair was
> to delete the separator rather than fix it: `JSON.stringify([vault, account, branch])` has
> nothing to corrupt, and it closes a second defect the obvious space would have left — any
> account label containing a space would have collided two holdings into one row, in the screen
> whose entire job is to notice a missing row.
>
> **Two gates caught me and both were right.** `check:casts` is unrelated here, but the
> **negative-compilation corpus** refused the arity fixture I tried to add: declaring
> `@bleavit/providers` as a dependency of `tests/firewall` turned `forbidden-package-edge.ts`
> from TS2307 into TS2305, because that fixture's entire proof is that the package is
> **unresolvable** there (10 §10.1's CI-fatal edge). The required-hash check moved into the
> providers suite as a `@ts-expect-error` — which `check:types` enforces in both directions,
> since an unused directive is itself an error — plus a runtime arity assertion, because the
> type check cannot see a signature that grew an *optional* parameter.
>
> **Gates: 1,057 app tests across 16 suites, 0 fail**; `tsc -b`, `depcruise` (+ witness),
> `check:types`, `check:casts`, `check:chain-literals`, `check:render-provenance`,
> `check:above-fold`, `check:no-html-sinks`, `check:handoff-network`, `check:handoff-emitted`
> all green; PLAN tables well-formed; docs links resolve; `check-client-surface-obligations.py`
> green; **zero control characters** across `packages/`, `src/`, `tests/`, `tools/`.
>
> **Next:** the live sampling loop (needs F8's transport) and the `app/tools/snapshot` producer
> driver, which is a thin driver over the format module now in place.

> ### ⇨ CURRENT (2026-08-06) — **#244 merged; F18's composition root is in and the remainder is artifact-blocked**
>
> **`main` is at `acc128a4`** and there are **no open PRs**. #244 landed with all 21 checks green
> (16 CI jobs read per-job, plus 5 CodeQL), no audit-scope-A file touched, and the squash verified
> **lossless** — `git diff acc128a4 17db74b4` is empty, so the merged tree is byte-identical to the
> branch tip. That check is cheap and worth keeping: it turns *"the merge looked clean"* into
> *"the merge changed nothing"*.
>
> **F18's pure half is complete.** `storageKeyBuilder(codecs, metadata, pallet, item)` plus
> `fundingKeys`/`fundingDecoders`, all buildable and tested offline against the two committed
> chain feeds and the Rust-written key fixture read in place. **1,004 app tests, 16 suites, 0 fail.**
>
> **Three of my own claims were corrected by measuring them.** This keeps happening in the same
> shape — a statement about an artifact, checked against my reasoning rather than against the
> artifact — and it is now four days running (V-159, V-160, V-162, V-163):
>
> 1. **PAPI *can* supply per-key-position encodings.** `args.enc` is the whole tuple, but
>    **`args.inner`** is one codec per hashed position. Verified over **739** storage items on both
>    pinned chains and all 11 fixture entries, including `Welfare.Snapshots`, where it is **1 and
>    not 2** — the single case where a logical-argument count and a hashed-position count could
>    differ. The design it supposedly justified survives; only the reason was wrong.
> 2. **The SS58→32-byte encoder named as "the only unbuilt input" did not need building.** The
>    position codec takes the address directly. The useful half is what a hand-written one would
>    have got wrong: `getSs58AddressInfo` calls **20-byte and 33-byte** public keys valid, so
>    *"check `isValid`, take `publicKey`"* would hash a 20-byte key into `System.Account` and
>    produce a well-formed key returning no value — *this account holds nothing*.
> 3. **One decoder was serving two chains.** `FundingDecoders.assetAccount` covered both Asset
>    Hub's `Assets.Account` and this chain's `ForeignAssets.Account`. It worked by coincidence:
>    measured, the two types are byte-identical on the pinned pair. Split per surface.
>
> **`args.inner` is an SDK internal with no compatibility promise**, so it is not simply trusted:
> the builder **refuses unless metadata and codecs agree on the key arity**, neither presumed
> right, and that agreement is re-checked per commit across both chains' entire storage surfaces.
> This is the `check:smoldot-surface` posture applied to a second `node_modules` seam — derive
> both sides, verify, and fail closed rather than assume.
>
> **Two mutation sweeps, 14 mutations, 13 killed.** The single survivor is honest and documented:
> binding the *local* USDC decoder to Asset Hub is undetectable while the two `AssetAccount` types
> are identical — which is precisely the argument for having split them. Three earlier survivors
> were real gaps and are now tested; the sharpest is **viability read from `providers` alone**, a
> reading that blocks exactly the users S12 exists for, since a user holding only USDC has
> `providers: 0, sufficients: 1` and USDC is a *sufficient* asset.
>
> **What remains for F18 is an artifact, not code.** No chain-spec bytes are committed for any
> chain and nothing calls `startLightClient` — the production boot path does not exist for the
> relay or the parachain either, not just Asset Hub. 10 §5.1 puts the Asset Hub spec on the same
> release discipline as the futarchy set, and 10 §9.4's *second* ≤ 3.5 MB row (chain specs,
> distinct from smoldot's own) has no gate because the artifact does not exist. So S12/S13 stay
> `built-unwired` on a missing release input.
>
> **F8's per-event account extraction landed the same day** (`chain-client/src/event-accounts.ts`),
> which corrected a stale *"next: F16's form widgets"* — **F16 is ✅**, its forms closed it. It is
> metadata-driven as required: the account is one resolved type id, and the walk descends the
> declared type tree beside the decoded value, so collections are not a special case.
>
> **Two more findings, and the second is the design's own justification arriving as evidence:**
>
> - **V-164** — PAPI renders a decoded account in **this chain's** SS58 prefix (22622), not the
>   generic 42. The ingest decision is `watched.has(account)`, a *string* comparison, so a
>   watched set in any other rendering matches **nothing, ever** — presenting as an empty
>   transaction history with no error anywhere. Accounts now leave as a branded `AccountKey`
>   (the 32-byte public key), which is what `local-index` already compared against.
> - **V-165** — the cross-check found **two** events a name-based table would have missed:
>   `Session.ValidatorDisabled` / `ValidatorReenabled` carry `T::ValidatorId`, and `configs.rs`
>   declares `type ValidatorId = AccountId`. The type-id walker is right; the obvious
>   implementation is wrong, and wrong silently.
>
> **Next:** F9's `tools/snapshot` and live sampling loop, which needed F8's transport, then F17's
> rendered consoles (its model layer is complete). The open 🔨 rows are F1 (PARKED), F8, F9, F11,
> F13, F15, F17, F18. F1 stays **PARKED** on external resources (device lab, testnet, ar.io
> credentials) — the note below still stands.

> ### ⇨ CURRENT (2026-08-05, latest) — **the five-PR split stack is fully merged**; two flat PRs remain; F18's key builder is complete
>
> **#236…#240 are all merged**; `main` is at `140517fe`. The user merged #239 mid-session and the
> drill ran immediately; #240 was merged here once all 16 jobs were green. **There is no stack
> any more** — both remaining PRs target `main` directly:
>
> | PR | Branch → base | State |
> |---|---|---|
> | **#244** | `track-f/ts-migration` → `main` | Task #31 + F18. Replaces #243 (see below); 24 commits, rebased onto `140517fe` |
> | **#242** | `track-f/f1-gate-sweep` → `main` | F1/FE-P2. Rebased **twice** today as `main` moved under it |
>
> **`gh pr merge --delete-branch` closes a PR stacked on that branch, and GitHub will not let
> you reopen it.** Merging #240 deleted `split/5-docs-and-tooling`, which was #243's base;
> #243 went `CLOSED` immediately. Recreating the branch at its old tip restored the PR's
> `MERGEABLE` computation but `reopenPullRequest` still refused, and a closed PR's base cannot
> be retargeted either. So #243's branch was re-proposed as **#244** against `main`, with the
> two cross-linked. **Next time: retarget the stacked PR to `main` first (`gh pr edit <n>
> --base main`), then merge, then delete the branch** — or merge without `--delete-branch` and
> clean up afterwards.
>
> **The rebases were verified content-neutral, which is stronger than "replayed clean".** For
> #240 and #243, `git diff <old-tip> <new-tip>` is **empty** — the trees are byte-identical, so
> the rebase provably dropped exactly the merged commit and changed nothing else. That check is
> available because `81ca8691` (the old `split/4` tip) has a tree identical to the squash
> `6157f643`, confirmed before touching anything.
>
> **#242's conflicts recur on every rebase of that branch, and the rule is always *take `main`'s
> side wholesale and splice in only what #242 adds*.** It collides in `app/package.json`,
> `.github/workflows/ci.yml` and `AGENTS.md`, and every collision is the same shape: the branch
> forked before a long run of additions, so its side is an **ancestor**, not an alternative.
> Measured on the second rebase: `main`'s AGENTS.md App-gates row is 31,831 characters and
> #242's is 9,208 — choosing a side either loses #242's gate or silently reverts the row by
> ~22k characters. The `test` chain is the sharpest case: taking both whole `"test":` lines
> yields a **duplicate JSON key** where the last silently wins, dropping gates while `pnpm test`
> still exits 0. Resolve by parsing, not by hunk — assert the chain starts with `check:types`,
> ends with the two new legs, and that **every leg names a script that exists**. Verified after
> both resolutions: `tools/ci/tests` 204/204, PLAN tables well-formed, 37 test legs, no script
> still carrying `--experimental-strip-types`.
>
> **Two mechanical rules earned today.** Never hand-type a lease SHA — `--force-with-lease`
> correctly rejected a fabricated one (*stale info*); derive it with
> `git rev-parse origin/<branch>`. And never use an **unquoted** heredoc for a script
> containing backticks or backslashes: `<<PY` let bash expand a regex mid-script. Write the
> file with an editor tool and run it by path (app-code rule 14, met twice in one hour — see
> V-159's NUL byte).
>
> `main` takes **squash merges**, so each merge orphans everything stacked behind it — the same
> content under a new SHA. #238's merge did exactly that, and the drill each time is
> `git rebase --onto origin/main <merged-branch> <next-branch>` (dropping the now-duplicated
> commit), a **patch-id** check that nothing was lost, then a pinned
> `--force-with-lease=<branch>:<sha>` — never the bare form, which reads its expected SHA from the
> remote-tracking ref that `git fetch` silently refreshes. The three split rebases replayed clean
> and verified lossless (1 / 3 / 14 patches identical).
>
> **#242 needed real conflict resolution and the shape is worth knowing**, because it recurs on
> every rebase of this branch: `app/package.json` and `.github/workflows/ci.yml` both collide, and
> in both files *both sides are additive* — `main` carries the migrated `run-suite.ts` script forms
> plus #238's `test:ui`/`test:screens`/`check:above-fold`, while #242 adds
> `check:smoldot-surface{,:witness}`. Take `main`'s side wholesale and add only #242's new gates.
> **The trap is the `test` chain**: `git` presents two whole `"test":` lines and taking both
> produces a *duplicate JSON key*, where the last one silently wins — on the first attempt that
> would have dropped 14 gates from every run while `pnpm test` still exited 0. Keep `main`'s
> chain and append the two new gates to it; a duplicate-key scan is now part of the drill.
> Verified after resolution on the rebased branch: `tsc -b` clean, `check:smoldot-surface` green
> over the pinned pair, its witness fires on an invented method, and `check:above-fold` survives.
>
> Task #31's early slices found **V-140** (the `chain-client` barrel handed the transaction path
> the `Finalized<T>` mint, and the corpus fixture that swore otherwise tested the deep-import
> route while the front door stood open) and **V-141** (six suites' own `test` scripts globbed
> `*.test.js` and reported `# tests 0` with exit 0). Both are the shape this repo keeps
> rediscovering: *a control that passes because it cannot fail*. **The migration is finding them
> because the types refuse to lie** — a fixture that cannot be built is a claim that could not be
> made, and asking why is where both defects were.
>
> **Task #31 is complete.** Every test slice and every tool under `app/` is TypeScript, and
> `pnpm run check:types` covers all of it — 19 suites plus `tools/*.ts`, `tools/release/**`
> and `tools/verify-release/**`. Full chain green: **910 tests across 16 suites**, every
> checker gate and every witness leg. Three hand-written JavaScript files remain and each is
> structurally required to be one:
>
> | File | Why it cannot be TypeScript |
> |---|---|
> | `app/.dependency-cruiser.mjs` | dependency-cruiser reads its config with `import()` only for `.js`/`.cjs`/`.mjs` and JSON5-parses every other extension, so a `.ts` config is read as data and fails. The *logic* moved out to `tools/depcruise-external.ts` and `tools/handoff-packages.ts`, reached through a dynamic `import()` Node 22.18 type-strips (measured). What is left is rule data. |
> | `app/tests/depcruise-witness/.dependency-cruiser.mjs` | Same, and it imports the production config so the witness shares the object it witnesses. |
> | `app/tools/fixtures/release-tree-witness/assets/leaked.js` | A fixture standing in for an *emitted release chunk*. `assertNoTestOnlySigner` scans `\.(js\|css\|html)$` over a built tree; as `.ts` it would witness nothing. |
>
> Both depcruise legs were compared before and after the ESM conversion and are byte-identical
> in what they see: 159 modules / 291 dependencies / 3 pre-existing warnings, witness 14 errors.
>
> **F1 continued after #31 closed, and its pivotal gate fell to analysis.** FE-P2 was recorded
> as riding the B7 drills; 10 §12's experiment column actually asks for *"smoldot docs/source"*
> first, and nobody had read the source. Resolved **positively** against the lockfile-pinned tag
> (V-150), which also produced a second normative rule the question had not asked for, and an
> R-1 ruling on 02 §13 rule 2's scope (Decision log). Contract stays **v27**.
>
> **The note below said no further analysis moves F1. That was wrong, and 2026-08-07 moved eight
> of the eleven gates without leaving this workstation.** The claim is struck rather than edited,
> because how it failed is the lesson. Each row's *Experiment* column is a **plan** — *"2-day
> spike against Paseo"*, *"hardware test"*, *"probe"*, *"ar.io testnet dry run"* — and a status
> note that repeats it as *"needs hardware"* converts a plan into a blocker. In every case the
> load-bearing half was a name, a default, a branch, or an authorization rule that someone had
> already published. Read the pinned source first. See the F1 row and V-300 through V-306.
>
> **F1's true remainder is external, so it stays parked and the next milestone is F18.**
>
> **PARKED:** what remains of F1 needs a resource this environment does not have.
> `FE-P3`'s three device halves (Safari Web Locks, BroadcastChannel latency, Android
> dual-instance memory), `FE-P4`'s remainder (sync latency, per-instance memory, the 20 blk/s
> ingest anchor, proof sizes, mobile CPU), `FE-P6`'s device half (whether a Ledger app
> blind-signs when a chain offers no metadata digest), `FE-P10`'s memory and liveness halves,
> and `FE-P11`'s share matrix each need a **device lab or a live chain**. `FE-P7`'s four
> platform halves need **ar.io credentials**, and its ruling needs the user (**SQ-940**).
> `FE-P9` is **externally blocked on infrastructure**, and this block said the opposite until
> 2026-08-07. It read *"a spec ruling, not infrastructure … defined only in a superseded document
> this repository does not contain"*. Both halves were false. `git show 6657f438:FRONTEND_PLAN.md`
> prints §31, which defines T1–T4 verbatim, and `git merge-base --is-ancestor` confirms that commit
> is in main's own ancestry — doc 00 **superseded** that file rather than deleting it, and a
> superseded document is still readable. T1–T3 need a live Bulletin Chain, an authorization path
> and a published price, so FE-P9 waits on the same class of thing its neighbours do. Only T4 is
> ours, and it is tooling. **What would unblock the set:** a device lab or hosted browser matrix, a
> running testnet with a collator, hardware wallets, ar.io credentials, and one user ruling
> (**SQ-940**). Analysis is genuinely exhausted on the named halves above — but the lesson of this
> paragraph is that *"exhausted"* is a claim about the world, so run the command that falsifies it
> before writing it down, and never state it about a whole gate.
>
> **F18 opened, and its note was half wrong (V-151).** The S12/S13 screens it listed as remaining
> are built, exported and tested; `routes.tsx` said so all along in a **machine-checked** field
> (`built-unwired` + `waitingOn`, both directions gated by `screens.test.ts`), while the PLAN prose
> beside it had gone stale. Second instance of V-147's class in two days, and the repair it argues
> for is *cite the machine-checked artifact, don't restate it*.
>
> **The Asset Hub connection landed 2026-08-05 — and it does not go in the boot reducer, which
> is what the sentence above used to say (V-153).** 11 E17: *"the AH chain is **not connected at
> boot**"*; 10 §9.3 budgets its chain spec as lazy in the same breath. So it is
> `Topology.attachAssetHub`, called on entering the funding flow — a method, so it closes over
> this topology's client, relay `Chain` object and teardown list, and `stop()` reaches a lazily
> attached chain with nobody registering it. **Every** Asset Hub failure is a returned value that
> leaves relay and parachain running; the refusing arms of `AssetHubLeg` carry no `chain` field,
> and `wrong-chain` keeps the observed genesis so `classifyForeign` can tell a permanent
> condition from a transient one. `asset-hub.ts` holds the connect step, out of `light-client.ts`
> and injected, so its two silent rules are executed per commit: a failed transport **detaches**
> its chain, and a second connect never hands the same chain to `getSmProvider` twice.
>
> **The readers landed too** (`funding-reads.ts`). Two readers, two chains, and the pair is
> **branded** so `readDepositInputs(reader, reader, …)` — a slip that typechecks — cannot be
> assembled by hand; a negative-compilation fixture proves it. `assertOnePin` deliberately has
> no analogue, since a deposit model whose leaves shared one pin would be one that had mixed
> the chains. Withdraw takes **no Asset Hub reader at all**, which is §11.9.2 written into a
> signature rather than remembered.
>
> **The key builder is complete (V-156 closed).** The prefix half shipped alone because the
> chainhead corpus was measured as verifying only prefixes — a reading corrected the same day
> (V-159: 65 of its 67 key items are prefixes, and **two are full `Blake2_128Concat` keys**, which
> the measurement missed by taking `requests.find(…)` per file). The conclusion survived the
> correction, because those two exercise one hasher on one key type in one pallet, and the two
> obvious routes to the rest were both measured and both fall short — PAPI's `getTypedCodecs`
> gives `{args, value}` where `args` is the SCALE args codec only (no hasher, no prefix), and
> deriving vectors from `@polkadot-api/substrate-bindings` tests that library against itself.
> The oracle is therefore **Rust**: `runtime/bleavit-runtime/fixtures/storage-keys.json`, written
> by the runtime's own `hashed_key_for` and read in place, the third file in this repo built that
> way. `storageKey(pallet, item, keys)` now ships beside `storagePrefix`.
>
> **Its signature is a spec distinction, not an ergonomic choice.** Keys arrive **pre-encoded**,
> one per key position, because each is hashed **separately** — and PAPI's `args` codec encodes
> the whole tuple as one buffer, which is the right pre-image for a single map over a tuple key
> and the wrong one for a double map. Doc 02 writes both as `(A, B) → V`: `Welfare.Snapshots` is
> the first shape and `ConditionalLedger.Positions` the second. The fixture carries both, so a
> caller that confuses them fails rather than building a well-formed key belonging to nobody.
>
> **The near miss is worse than the miss, and has its own test.** `Blake2_128Concat` is a digest
> **followed by its input**; a client emitting the digest alone produces a strict *prefix* of the
> right key, which `descendantsValues` answers with the **whole map**. That is not a missing
> balance, it is everybody's — so an unknown hasher throws rather than degrading to a prefix.
>
> **What is left for F18, stated after measuring rather than before.** The composition root's
> inputs are now known: **hashers come from metadata**, not from a declaration —
> `getTypedCodecs` exposes only `{value, args}`, but `@polkadot-api/substrate-bindings`
> decodes the shipped `metadata.scale` and carries them, including the one-vs-two hasher
> distinction `storageKey`'s signature exists for. Decoders are already served by
> `storageDecoder(codecs, pallet, item)`, whose return shape matches `FundingDecoders`. The
> only unbuilt input is the SS58→32-byte account encoding.
>
> **Its *live* half is artifact-blocked, and that is a correction to the note above.**
> Measured: **no chain-spec bytes are committed for any chain**, and nothing in the app calls
> `startLightClient` — the production boot path does not exist for the relay or the parachain
> either, not just Asset Hub. 10 §5.1 puts the Asset Hub spec on the same release discipline
> as the futarchy set, and 10 §9.4's *second* ≤ 3.5 MB row (chain specs, distinct from
> smoldot's own) has no gate precisely because the artifact does not exist. So S12/S13 stay
> `built-unwired` on an artifact, not on code.
>
> **Then:** F17 once F11 closes.

> ### ⇨ CURRENT (2026-08-05) — Track F **12 ✅ · 6 🔨 · 5 ⬜**
>
> **Track F's work is in review as a five-PR stack, #236 → #240**, replacing the closed
> #234. Merge them **in order**; each is based on the one before it, so merging out of
> order rebases the rest. #240's tree byte-compares equal to `track-f/feed-surface-gate`,
> which is what makes the split lossless rather than merely plausible. The generated bulk
> (26,208 lines of regenerated PAPI descriptors) is isolated in #236 and is reviewable as
> *"does `descriptors:check` reproduce it byte-for-byte?"* — it does.
>
> **Closed this session: F4, F7, F10, F12.** F16 is 🔨 with only its form widgets left —
> every safety property it carries is already in the model layer.
>
> **The method that paid, stated so it survives this session.** Every time a claim was
> checked against the *runtime, the SDK or the registry* instead of against my own
> reasoning, it was wrong:
>
> - **V-109 corrected** — the JSX import is invisible to *both* firewall gates, not merely a
>   compile error. `tsc` is satisfied by a hoisted `@types` package and dependency-cruiser
>   cruises source, so a compiler-injected import is in neither. New gate:
>   `check:handoff-emitted`.
> - **The sudo banner was wrong.** `PhaseFlags` is a bitset with *bit 4* = sudo present; the
>   shell tested `phase >= 4`. The recorded value `17` would have **hidden the banner on a
>   chain running sudo**. Found by decoding the real fixture, not by re-reading the code.
> - **SQ-593** — the degradation matrix was 25 rows by name and 12 by text. Ruled and
>   executed; `check-degradation-matrix.py` now counts them.
> - **FE-P8 resolved** from the relay's own constants (V-112), producing 10 §2.4.
>
> **And twice a first grep was wrong in the *alarming* direction** (V-113, V-114): searching
> 02 for a bare item name misses the qualified `` `Pallet.Item` `` form the document uses,
> and both times the fix was to check `tools/release/surface-manifest.json` instead. Two
> false spec questions were avoided that way. **Search 02 by the qualified name.**
>
> **~110 mutations run, none surviving after repair.** Nine exposed defects in my own
> *tests* rather than my code — the recurring shape being an assertion that passes for a
> second reason (a phrase that also appears elsewhere on the page, a session missing the
> stale field that made the mutation dangerous, a `never` type that is assignable to
> anything).
>
> **Next:** F16's form widgets, then F17/F18 — both verified buildable (V-114), with F17's
> read surface stated in prose rather than enumerated, which is **SQ-591**'s instance rather
> than a new gap. The rest of Track F is gated on things only the user can supply: the F13
> key ceremony, Arweave/ArNS credentials, a device lab (F1, F14), an independent second
> build environment, and seated operator roles (F15).

> ### ⇨ CURRENT (2026-08-04) — #232 merged, contract v25 reconciled, **PR #234 open (draft)**
>
> **The parked branch is unparked.** PR #232 landed, so the chain feed can finally be regenerated
> against a runtime that includes its `ClientBond` surface — the thing this branch waited for rather
> than regenerating early and shipping a feed that omitted it while passing locally.
>
> **The merge was 273 conflicts and 272 of them were generated artifacts.** All took main's version,
> per app-code rule 12: `metadata.scale` is binary, the transcripts and descriptors are produced
> together from one runtime, and a hand-merged generated file is a file nothing produced. They are
> regenerated wholesale in the next commit.
>
> **Two resolutions needed judgement rather than a rule.**
>
> 1. **`surface-manifest.json` was reconciled entry by entry.** The five contract-version constant
>    layouts come from this branch (they encode the number itself, `0x18` → `0x19`);
>    `constant.client_registry.client_bond` comes from **main**, because it carries #232's adopted
>    100,000 VIT. Taking this branch's copy wholesale would have silently reverted the value #232
>    exists to adopt — which is exactly the loss this branch waited to avoid, arriving from the
>    direction nobody was watching.
> 2. **Spec-question ids collided**, which an append-only index cannot absorb. #233 took SQ-583 and
>    SQ-584 while this branch already used them, so this branch's four renumber **+2 → SQ-585…588**
>    across PLAN.md, 02 §3/§6/§7.6/§13, the manifest and `app/tools/release/build.mjs`. Same remedy
>    as the Track N collision on SQ-574/575/576, and the second time it has happened.
>
> **PR #234 is open as a draft, and the draft state is the honest one:** three gates are red by
> construction — the manifest is at contract **v25** and the committed feed at **v23** — and the
> regeneration in flight is what reconciles them. It was opened late; twenty-four commits sat on a
> local branch when R-12 asks for a draft PR as soon as the code state is coherent, which it had
> been for several milestones.
>
> **The feed is regenerated and #234 is ready for review.** Both profiles rebuilt from this tree —
> primary `spec 2 / bootstrap`, recovery `spec 3 / bootstrap-recovery`, both **contract v25**,
> metadata v15, 45 pallets — with **272 chainHead transcripts** re-recorded from the same pair
> (including the new `api.is_reserved_protocol_destination` recording P-9 reads), 16 PAPI descriptor
> files reproducing byte-for-byte, `critical-surface.ts` at 269 probed entries, and `spec-versions.ts`
> picking up both metadata hashes. `spec_version` does not move: v25 adds a runtime API rather than a
> dispatchable, so `transaction_version` is untouched under 02 §13 rule 7.
>
> **One expectation moved with the contract rather than with the recording.**
> `tests/mock-runtime/fixtures.test.js` asserts FE-R1's bounds against 02 §9's frozen table, so
> `constant.identity.contract_version` reads 25 there *because §9 freezes 25* — not because the
> fixture says so. Reading it out of the recording would prove nothing, which is exactly what
> app-code rule 12 says and why that file is hand-maintained rather than generated.
>
> **All 24 app gates green**, including the three this branch carried red since the bump.
>
> **SQ-587 is ruled (2026-08-04), and the correction is the useful part.** This block previously
> called it "the one open question only the user can answer — Paseo or Polkadot Asset Hub". That was
> wrong twice over, and both errors were under-research rather than genuine uncertainty. *Which*
> Asset Hub is already phased by the spec — 08 §2.5 and 09 §6.3 open HRMP to Paseo's at Phase 2 and
> Polkadot's at Phase 3 — so a release pins the Asset Hub of the relay it targets, per release, and
> there is no standing choice to make. And SQ-587's claim that the AH-side `Assets.Account(1337, who)`
> read contradicts X-11a is false: X-11a governs *Bleavit*, where USDC is a `ForeignAssets` entry,
> while 02 §8's own Location resolves to `Assets`/1337 **on parachain 1000** — one asset, two chains.
> The real gap stood, and 02 **§7.7** now freezes the three AH surfaces the deposit leg reads and
> writes. **It is the first revision to 02 that deliberately does not bump the counter**, under a new
> §13 rule 8: `INTEGRATION_CONTRACT_VERSION` is a *Bleavit runtime* constant, so no Bleavit upgrade
> moves the foreign layout and no foreign upgrade moves the constant — a bump would publish coverage
> nothing behind it can attest, which is v24's defect inverted. The foreign surface is pinned in the
> release feed by the AH genesis hash / `spec_version` / metadata hash and probed as a **separate**
> 10 §5.2 verdict. No fixture, feed or descriptor moves, because nothing in Bleavit's metadata did.
>
> **The exhaustive Rust gate is green** — `RUST GATE EXIT=0`, 3,496 tests across 108 suites, zero
> failures, plus the release/`runtime-benchmarks`/`try-runtime` builds, `no_std`, the keeper
> workspace, the runtime-profile matrix and the generated-weight purity and limit-coverage legs. It
> ran at `d0ddd061`, and every commit since touches only `app/` TypeScript, `docs/architecture/` and
> this file — **no `.rs` or `Cargo.*` has moved**, checked rather than assumed, so the result still
> describes HEAD's Rust state.
>
> **F6 did NOT close, and that is the session's most useful outcome.** The adversarial Codex review
> R-6 requires (`gpt-5.6-luna`, `max`, read-only) returned **20 findings — 3 blockers, 16 major,
> 1 minor**. The sharpest was real and I verified it in the source before accepting it: **`gate()`
> returned `proceed` over an empty result set.** Every check inside it is a filter over `results`,
> and every filter over an empty array is empty — so *"every precondition holds"* and *"nobody read
> one"* were **the same value**, on the single edge that reaches a signer. Worse, `txTransitionEdges()`
> minted its own passing gate exactly that way: the enumerator whose job is to prove there is no
> bypass was itself using one, which is how the hole stayed invisible. Fixed, with five tests that
> had been passing *through* it given real coverage, and mutation-proven (reverting the check kills
> four). **Two blockers stand** — gate-to-signature staleness, and P-12 carrying 7 of the 13 checks
> 11 §11.5 states while its test asserts `length < 13`. The delegation to `check-dispatch-mirror.py`
> does not cover the second: that gate parses the two *documents* and never reads `rows.ts`.
>
> **Landed alongside:** `packages/descriptors/src/foreign.ts` (F4's §7.7 verdict, 32 tests, 6
> mutations), `packages/receipts` (F20, 18 tests, 4 mutations) and `packages/llm-handoff` (F20, 17
> tests, 5 mutations) — plus a repair to `check:handoff-network`, which matched raw text and so
> tripped on a module *documenting why it makes no network request*; it now blanks comments through
> the pinned TypeScript scanner, comments only, with witness controls in both directions.
>
> **Chasing the P-12 blocker found its root cause, and it is a spec gap rather than a coding one —
> `SQ-589`.** 11 §11.5 states 13 dispatch checks; `rows.ts` encodes 7. The code comment blamed the
> 15 §4.8 mirror gate, and **that was false**: `check-dispatch-mirror.py` parses the two *documents*
> and never reads `rows.ts`. The real obstacle is that the surfaces do not exist to bind to —
> **nine** surfaces are unfrozen in 02 §7. The list is derived from `do_execute` itself
> (`pallets/execution-guard/src/lib.rs:1928-2130`), each tied to the `ensure!` that reads it — and
> that mattered: **a first pass by surface name produced fourteen and was wrong.** Four dropped out
> on reading the code, because `ledger_freeze_active()` and `dead_man_freeze_active()` read
> **`Constitution.PhaseFlags`** bits and `rerun_held()` reads **`Epoch.Proposals`**, all already
> frozen. Which also means **review finding #8 is wrong for this call path** — PhaseFlags genuinely
> *is* the ledger-freeze source for `execute`; #8 concerns P-1/P-2/P-3, a different path, and is
> tracked separately rather than folded in. **A doc defect surfaced on the way:** 11 §11.5 check 9
> cites `Epoch.ResourceLocks` while `do_execute` reads `ExecutionGuard.HeldResources`, so the client
> would mirror whichever one is wrong. The gate built to catch this family stayed silent because
> 11 §11.5 names these surfaces in **prose**, not as `Pallet.Item` — the residual SQ-588 already
> recorded. SQ-580's defect class, seventh instance.
>
> **Ruled and executed (R-1): contract v26 freezes eight surfaces, and each derivation corrected the
> last.** By *name*: fourteen. From `do_execute` itself: nine — four dropped because
> `ledger_freeze_active()`/`dead_man_freeze_active()` read `Constitution.PhaseFlags` bits and
> `rerun_held()` reads `Epoch.Proposals`, all frozen already. From the **metadata**, deriving each
> layout through the same `surface_layout()` the checker uses: **eight** — `Epoch.CurrentEpoch` is
> not storage at all but a `Get<EpochId>` adapter over `EpochOf::<T>::get().index`, so freezing it
> would have published a surface no metadata contains. Writing that entry by hand would have looked
> completely reasonable.
>
> Shipped: 02 **§7.8** + §7.3 `Capabilities`, `INTEGRATION_CONTRACT_VERSION` 25 → 26, manifest at 277
> entries, feed + 280 transcripts + 16 descriptors + `critical-surface.ts` regenerated, and **P-12
> rewritten from 7 clauses to 20 covering all 13 checks** — asserted **by surface, not by count**,
> since a count is satisfied by thirteen copies of the cheapest clause. 11 §11.5's check 9 cited
> `Epoch.ResourceLocks` where the guard reads `ExecutionGuard.HeldResources`; both are real frozen
> items, so it was plausible and wrong, and it is corrected. All 24 app gates green; changed-scope
> Rust gate 476 tests, 0 warnings.
>
> **The staleness blocker is closed too.** 11 §11.3 is normative — *"era 64 blocks from B′;
> nonce from finalized `System.Account(who).nonce` at B′"* — and `mortalityFor` took a bare
> `number` while `nonceFor` accepted a nonce read at **any** block. The era *is* the staleness
> bound: the gate reads preconditions at one finalized block, the user then spends an unbounded
> time at a wallet prompt while balances and freezes move, and nothing re-checks afterwards —
> what stops a stale signature being *included* is that it expires. Anchored to the wrong block
> the bound is simply not applied, and the transaction still looks valid. Both now take
> **`GatePassed`**, which only `gate()` can mint, so "signed against the block that was gated" is
> structural rather than a convention a caller must honour. The nonce compares the block **hash,
> not the height**, because a reorg can reuse a height and the gate pinned one sibling. Three
> mutations caught (binding removed; height compared instead of hash; a plausible +1 off-by-one),
> and a fourth that failed to compile was redone rather than counted.
>
> **F6 is ✅. All 20 review findings are fixed — 3 blockers, 16 majors, 1 minor.**
>
> The order that made this work was *verify against the enforcing pallet, then code*, and it
> earned itself three times over. Finding #8 was **refuted** for the `execute` path
> (`Constitution.PhaseFlags` genuinely is what the guard reads — it is the *ledger* rows that
> were wrong). Four findings needed **no contract bump**, because the surfaces already
> existed and the rows cited the wrong ones: `EpochStatusView.ledger_frozen` answers the
> freeze, `account_positions().len()` is the per-account count where `PositionTotals` is
> per-*position* supply, and `ProposalSummaryView` has carried both `proposer` and `funder`
> since v18. And **two findings were defects in 11 §11.5 itself**, repaired under R-1 rather
> than implemented faithfully.
>
> **What the round says about the tests, which is the part worth carrying forward.** The
> suite was green before and after, and in two places it *asserted the defect*:
> `rowsFor('P-12').length < 13`, and a test requiring `decoded-payload` on a descriptor built
> with no decode channel at all. Both passed for a trivial reason and both certified the
> thing they were named for. 18 mutations were run against the fixes; **four failed to
> compile and were redone rather than counted**, which is the same trap as last session.
>
> **SQ-590 was parked fail-closed and is now executed: contract v27 freezes `Proxy.Proxies`.**
> The eighth instance of SQ-580's class, and the first that `check-client-surface-obligations.py`
> structurally could not catch — §11.3 states the obligation in prose that never names the item,
> so neither the v24 human sweep nor the gate derived from it had anything to match.
>
> The row is the small half. The **evidence type changed**: `DelegationEvidence`'s `read`
> branch now carries `Finalized<ProxyRead>` and is **keyed on `real`**, which was not merely
> deferred but unreachable before — 11 §11.4 rule 4 forbids provider data from satisfying a
> precondition, and with no frozen surface the one wrapper check that decides whether a
> signature is lawful was the single place a cached answer would have been believed. Four
> mutations, all caught, one of them the compile-time binding itself: delete the manifest entry
> and `PROXY_DELEGATION_SURFACE` fails with `TS2322` at its declaration rather than decaying
> into a comment.
>
> **The method gap is filed as SQ-591, not absorbed.** Naming the item in §11.3 fixes this
> instance; the gate is *sound but not complete*, and quietly amending the doc would have
> retired the symptom while keeping the cause. Two prose copies of the version number were
> also two bumps stale — 02's Ownership line and the §7 crate note, the latter having been
> "corrected" once already in E4 — so that sentence no longer names a number at all.
>
> **Then F4's Asset Hub artifacts landed, and both 02 §7.7 `[VERIFY]` tags are discharged.**
> The pin is `paseo-network/runtimes` v2.4.2 — Paseo, because 08 §2.5 phases the connection
> and a release pins the Asset Hub of the relay it targets. The chain is closed rather than
> asserted: the published wasm's sha256 matches its srtool digest, and that digest's
> `core_version` matches what two independent live operators report, so the artifact the
> descriptors come from and the chain the surfaces were verified on are the same runtime.
> The asset-index tag's **scope** was the surprise — V-17 had verified 1337 on *Polkadot*
> Asset Hub, and Paseo's registry is its own.
>
> **Two things worth carrying forward.** `.papi/README.md` promised an Asset Hub whitelist,
> and that design is not implementable: PAPI hardcodes the generated package name, so one
> workspace means one global whitelist, and a per-chain one guts every chain it does not
> name — `bleavit.ts` **458,662 → 43,258 bytes**, measured, with `papi generate` reporting
> nothing wrong. And the foreign presence gate **cannot be Python**: PAPI reads v16 from the
> wasm and `scale_metadata.py` stops at v15, which turns out to be the better home anyway.
>
> **F4 stays 🔨 on one item**, and its dependency moved rather than cleared: the probe's
> assignability binding needs `createClient`, which `light-client.ts` still excludes on
> purpose. Descriptors were the other half of that deferral and are done; where
> `createClient` goes is an F3/F7 boot-sequence decision.
>
> **Then F20 closed** — the context exporter and the published `schemas/`. Two findings are
> worth carrying past the milestone. **`FE-HANDOFF-012` was defined and unreachable**, the
> same shape as the digest gate two sessions ago: a code with zero emitting call sites, which
> no green run can distinguish from a code that never fires. And the family had **two homes**
> whose copy for `FE-HANDOFF-013` already disagreed, because `receipts` could not import the
> inbound parser across the §10.1 firewall and wrote its own sentence — invisible to the
> compiler, since no call site takes both. It now lives in `handoff-envelope` and carries the
> **`recovery` 10 §13.3 requires per code** and nothing had.
>
> **The exporter's rule is that scope is checked in both directions**, and the second one is
> the one that lies. Filtering cannot leak, so it looks safe; it also emits a capsule that
> announces `positions` and carries none, which reads as *this user holds no positions* — a
> false claim about the chain from the document whose only job is true ones. Empty is data,
> absent is not.
>
> **`app/schemas/` is generated and differentialled, and the differential earned itself
> immediately**: the schema published `limits` with everything optional while the parser
> *requires* a direction-matching monetary limit. A producer following the published version
> would have shipped `"limits": {}` and been refused at the user. Two tests in this session
> also **passed for the wrong reason** and were rewritten only because mutation testing said
> so — one asserted bigint parsing through a field that is echoed verbatim, the other asserted
> a string type where the pattern was the control.
>
> **Then F21 closed too** — `app/skills/`, the producer side. Under handoff-first this is a
> **product** surface rather than a sample: a large share of the explanation and strategy
> work now happens in someone else's tool reading these files, and it is the one part of the
> system with no mechanical control over its quality (the client can refuse a malformed
> document; it cannot refuse a bad argument — 10 §13.5's accepted residual). Two artifacts
> are generated for the same reason: three hand-written copies of the safety rules diverge
> at the first amendment, *invisibly*, because nobody diffs a ChatGPT instruction box
> against a repository. The examples carry their verdict in the filename and are run through
> the **real parser**, since a stale published example leads its reader to conclude the
> client is wrong and then to loosen the document — the exact behaviour the safety rules
> forbid.
>
> **One scope call made rather than deferred:** `skills/` and `schemas/` now ship *in the
> release tree*, pinned by the service worker. A skill nobody can obtain from the client
> they are running is not delivered, and the documented route would otherwise depend on
> fetching from a code host.
>
> Track F: **8 ✅ · 7 🔨 · 9 ⬜**.

> ### ⇨ CURRENT (2026-08-04) — F11: the release train, built and gated per commit rather than first debugged at a tag
>
> **The v25 work is still parked on PR #232** (see the row below it): three app gates stay red for
> one reason — the committed chain feed describes v24 and the fourteenth `FutarchyApi` method is
> v25 — and regenerating from this tree would omit #232's `ClientBond` surface while passing
> locally, which is the silent direction. So this session took the largest **unblocked** Track F
> milestone instead: **F11, distribution**, whose only dependency is F0 and which unblocks F13, F15,
> F17 and F22.
>
> **What was built is the pipeline, not the payload.** F11 owns the *document and the release
> train*; F7 owns what renders inside it. `index.html`, `vite.config.ts` (Vite **8.1.4** — the 01 §9
> pin, not `latest`), a shell package carrying the service-worker entry, the PWA manifest, and
> `app/tools/release/` with 53 tests. It runs on **every commit**, which is the point: a release
> pipeline exercised only at a tag is one first debugged during a release.
>
> **Three things here are worth more than the code, and each is a rule about how a control fails.**
>
> 1. **The order of the pipeline is the design.** The CSP substitution and the SRI injection must
>    precede the service worker's baked hash map — the map pins `index.html`, so the file has to be
>    final before it is hashed — and `release.json` must be written last, because it pins `sw.js`,
>    which the map substitution rewrote. Get either backwards and the release ships a worker that
>    refuses its own entry document: fail-closed, and *at the user*, which is the wrong place for a
>    build error to surface. Both orderings are asserted end to end rather than left to a comment.
> 2. **A control that cannot be made to fail has not been verified.** Nine mutations, each reverted:
>    a gateway added to the sources aborts the build naming it; a removed placeholder aborts; an
>    `integrity` attribute stripped from a built tree fails `release:check`; a *tampered asset* fails
>    it too, because the check **recomputes rather than counts** — a present-but-wrong digest makes
>    the browser refuse to execute and the app go blank, which is opaque in a way a missing attribute
>    is not; `MockSigner` in a chunk throws; and the no-literal gate catches both an injected named
>    constant and an injected bare value in a real package.
> 3. **The one thing nothing mechanical can do is stated rather than papered over.** D-21 forbids a
>    vendor host in `connect-src`, and no checker can tell an ar.io gateway from a vendor endpoint
>    dressed as one. So the allowlist is *derived* from declared sources and *diffed against a
>    committed incumbent*: an addition costs a second, reviewable file. That is the whole control,
>    and the README says so in those words.
>
> **A ruling that took some thought.** 12 §5.2 says the worker's cache name is the manifest TXID —
> which cannot be baked, since 12 §1.2 only learns it after uploading the tree the worker is part of.
> Deriving it from `location` would have meant guessing gateway URL shapes, which is precisely what
> prototype gate **FE-P7** holds a `[VERIFY]` on. So it is **fetched from `release.json` at install**,
> and it is safe for a reason worth stating exactly: the field **names a cache and does not authorize
> a byte** — every asset is still checked against the baked map — and it fails closed rather than to
> a constant name two releases would share.
>
> **Three adversarial Codex reviews found 25 defects in my own work; all are fixed.** The five that
> mattered most, each of which would have shipped a control that looks present and is not:
>
> - **The worker returned a non-2xx response unhashed.** A gateway answering `404` with
>   attacker-controlled HTML for `index.html` is a response the browser *renders* — the status code
>   decides nothing about what a user sees, so the one path an attacker fully controls was the one
>   path the worker did not check.
> - **The worker returned cached responses without re-verifying them.** `caches` is same-origin
>   storage that any script on the origin can write; a forged entry would have been served as
>   verified from then on. It now hashes on read and evicts on mismatch — bytes are believed on
>   content, never on provenance.
> - **`{ type: ACTIVATE_MESSAGE }` with no `pinned` field activated a pinned release**, because a
>   missing boolean defaulted to `false`. The shortest message anyone would try overrode the one
>   user statement the pin exists to protect. An absent field now refuses.
> - **The literal gate was a line scanner, and every hole in it was a tokenizer hole**: `const open
>   = "/*"` made it treat the next lines as a comment and skip a real hardcode; `/[//]/` read as a
>   line comment; template interpolation — executable code — was blanked; `1n << 63n` and `0x10000`
>   were invisible, and app-code rule 8 names the first of those *by name*. Rewritten on the
>   TypeScript AST, which the workspace already pins: comments and string bodies are simply not
>   literal nodes, and both rules constant-fold.
> - **`release.json` emitted `arweaveManifestTxId` and the consumer requires `releaseTxid`.** The
>   test that should have caught it compared the producer against a hand-written list beside the
>   producer, so it agreed with itself. The required fields are now parsed out of
>   `packages/verify`'s `ReleaseIdentity` declaration.
>
> Also fixed: the `connect-src` wildcard check ran before `new URL()` percent-decodes the host, so
> `https://%2A.example` would have emitted `https://*.example`; the policy had **no `'self'`**, which
> would have left the bundle unable to `fetch` its own `release.json` or chain-spec bytes and
> silently disabled INV-FE-8's self-check; SRI parsed only double-quoted attributes and compared
> `rel` as one string rather than as a token list; the two-pass driver would publish any object it
> was handed and never bound the sibling TXID into the final manifest; the SBOM skipped tarball and
> git dependencies; the determinism probe skipped binaries; a duplicated key id satisfied 12 §1.4's
> *distinct*-key floor; a malformed-but-present genesis pin counted as pinned; and a dirty worktree
> was recorded as a clean `HEAD`.
>
> **Two of the reviews' points are answered by making the test real rather than by changing code.**
> The service-worker suite tested only pure policy — deleting the worker's digest check left it
> green — so `worker-runtime.test.js` now loads the **built `dist/sw.js`** into a `vm` with a
> fabricated global scope and drives its handlers against a tampered body, a `404` carrying HTML, a
> forged cache entry and an unknown path. And the allowlist suite asserted that the *diff function*
> reports an addition, which stays green with the `throw` deleted — so the enforcement is now its
> own exported call and the production path and the tested path are the same one.
>
> **F11 stays 🔨, honestly.** The live Arweave adapter is FE-P7's (`arweave.mjs` is a pure driver
> over an injected uploader and its arithmetic is pinned; the Turbo-SDK half needs a gateway), and
> `release.json` names **ten readiness blockers** — no seated bootnode operator, no gateway set, no
> production genesis or chain-spec hash, no paraId, no keyring, version still `0.0.0` — each of
> which `--production` refuses on. Signing, attestation and the two-environment byte-identical proof
> are F13.
>
> **Next:** F10's remaining `release.json` binding is now unblocked (the producer exists and its
> field set is checked against `packages/verify`'s consumer). Then F8's ingestion loop, and F6/F4
> when #232 lands.

> ### ⇨ CURRENT (2026-08-04) — SQ-580 ✅ at contract v24: the client's reads are contract surface, and the gate that noticed is now permanent
>
> **The four-question pattern is closed, and closing it needed a new kind of gate rather than a
> fourth fix.** SQ-552, SQ-577, SQ-580 and SQ-581 were all one shape: a client obligation written
> in docs 10/11 that does not create the frozen 02 surface it needs, with every existing checker
> agreeing because **every one of them verifies that what *is* declared matches the runtime, and
> none asked whether what is *required* was ever declared.**
> `tools/ci/check-client-surface-obligations.py` asks the inverse question and now runs per commit.
>
> Asking it turned SQ-580 from one missing surface into **twelve**, including
> **`Epoch.ResourceLocks` — pallet-epoch's own storage, absent from its own §7.1 table** while
> 09 §1.2(8) makes it a dispatch-time check. All twelve are frozen at **contract v24**: §7.1 gains
> one row, a new **§7.6** carries the eleven upstream reads.
>
> **Why upstream SDK storage belongs in a Bleavit contract** — the ruling, since it reads
> backwards at first. It belongs *more* than Bleavit's own storage, not less. Bleavit storage moves
> only when Bleavit changes it, and §13 rule 2 makes that change bump this counter. An SDK
> release-line bump moves an upstream layout with **no Bleavit source change and no counter to
> notice** — and 10 §5.2's classifier probes exactly the frozen set, so an unfrozen read is one the
> compat lattice *cannot fail on*: a dead screen under a green banner, and the banner is the wrong
> part. §7.4 already took this judgement for `System.Account`/`ForeignAssets.Account`.
>
> **What was given up, stated as a weakening rather than a footnote.** `System.Events` expands to
> **2,265,785 characters** — `Vec<EventRecord<RuntimeEvent>>` contains every event of every pallet,
> 12× the whole manifest, and its drift signal would fire on any unrelated pallet's new event. It is
> frozen as its container with `RuntimeEvent` elided (236 chars). That is sound **only** because §6
> freezes the subtree event-by-event, so the admissibility rule is *elide only what another frozen
> entry covers* — and `OriginCaller`, frozen by nothing, keeps `Referenda.ReferendumInfoFor` and
> `Scheduler.Agenda` fully expanded at ~29 KB each despite being the file's two largest entries.
>
> **Weigh this too.** SQ-581 and SQ-582 were carrying status cells that said `open` **and**
> `**RESOLVED 2026-08-04.**` simultaneously. The batch checker tests the status *prefix* — correctly,
> since an open row's prose legitimately contains the word "resolved" — so it believed the wrong
> half, and only spoke when closing SQ-580 made it look. The canonical status record disagreed with
> itself for a day, and shape-checking cannot see that.
>
> **Next:** F6's multisig/proxy, which SQ-580 existed to unblock. The sharp part is not the encoding
> but the identity split: a wrapper makes the call act as the **multisig or proxied account** while
> the **signer** pays the fee, so a precondition table that checks one account for both checks the
> wrong one — and `Multisig.Multisigs` must be read to know whether an approval is the first (no
> timepoint) or a subsequent one (the recorded `when`, or the call fails). Then F4's Asset Hub set
> (still needs the network decision) and F1's seven open gates.

> ### ⇨ CURRENT (2026-08-04) — F3 ✅ · F6: both signers landed; four questions of one shape are what blocks the rest
>
> Merged `origin/main` (Track N complete, N1–N15) into this branch. **Track N had taken
> SQ-574/575/576 for its own questions while this branch used the same three**, so this
> branch's five renumbered +3 — now **SQ-577 … SQ-581** — in PLAN.md and in the five app
> files that cite them. A colliding id is the one thing an append-only index cannot absorb.
>
> **The throughline is not any single fix.** It is that **a client obligation written in
> docs 10/11 does not create the frozen 02 surface it needs, and nothing in the gate set
> notices** — every checker verifies that what *is* declared agrees; none asks whether what
> is *required* was ever declared. Four instances, found four different ways:
>
> - **SQ-552** (resolved) — 09 §1.2 and 11 §11.5 each mandate a precondition diff and each
>   credit a contract test in doc 15 with running it. Doc 15 mandated no such test. That is
>   how an `execute` precondition on a clock `execute` itself starts survived since X-11i.
>   The missing test now exists as the 15 §4.8 *Dispatch-check mirror*.
> - **SQ-577** — 10 §5.2 names calls in `CRITICAL_SURFACE`; 02 freezes none.
> - **SQ-580** — 11 §11.3 reads `Multisig.Multisigs`; 02 mentions Multisig zero times.
>   Blocks F6's multisig/proxy. Not coded around: inventing a `SurfaceId` would be the
>   hand-listing app-code rule 7 forbids.
> - **SQ-581** (**money path**) — 02 §9 declares 65 frozen metadata constants; the manifest
>   carries 39. `Market::Fee` and `ConditionalLedger::RedemptionFee` are among the gaps, so
>   nothing probes the two rates 11 §11.5 mandates. A rename leaves the classifier reporting
>   `full` while every quote loses its rate.
>
> **Shipped this session:** the SQ-552 ruling + mirror gate; the reference-model re-point it
> forced; three chainHead transport defects from Codex review (V-93 boot hang, V-94 a refused
> query read as an empty result, V-95 pins never released); the P-1…P-15 tables; the
> fee-currency selector and mortality/nonce; the `polkadot-api` firewall narrowed to the
> connection surface; and both signer adapters.
>
> **Weigh this most.** Six vacuous controls surfaced in this session's own work, every one
> found by mutating rather than re-reading — including two inside tests that read as careful,
> and a P-1 clause citing `constant.market.min_trade` because the right constant was not
> citable. **A test that names the right property is not evidence it exercises it.**
>
> **Next:** rule SQ-580 to unblock F6's multisig/proxy; reconcile the manifest against 02 §9
> (SQ-581) and ship the set-diff gate that would have caught it — 02 §9's table is
> structured, so it needs no prose heuristic. Then F7. F1 still has seven open gates; F4
> needs a decision on which network's Asset Hub a release pins.

> ### ⇨ CURRENT (2026-08-03) — Track N complete: futarchy as a service over XCM, N1–N15 ✅
>
> Bleavit now hosts decision markets for external clients over XCM, and every milestone of the
> track is closed. The last to close was **N7**, and it closed on the compliance review that was
> holding it rather than by deciding the review no longer mattered — two blockers and one major
> verification gap, all three discharged. **The lesson from those two blockers is the one worth
> carrying into the next track:** both sat behind green gates, and in both cases what hid them was
> an artifact that *looked like* coverage. External trading fees could not reach `MAIN` at all
> because `pallet-market`'s mock was more permissive than production, so the hosted `sweep_revenue`
> tests exercised a path that fails on chain; a runtime assertion had gone further and stated the
> bug as a requirement. A green suite is evidence about the suite.
>
> **N14/N15 added a demand-responsive price** to slot admission, replacing first-come-first-served:
> the tariff carries a multiplier that rises instantly on admission and falls only gradually toward
> 1, including after a slot frees, so immediacy is what a sniper pays for — and rises again when
> Bleavit's *own* decision books run thin, which makes 16 §8.4's "the values layer MUST reduce
> `svc.max_live`" an automatic graduated response instead of a vote demanded exactly when revenue
> argues the other way. Both halves share one ceiling (`svc.price_cap`), so **one adopted row arms
> the whole mechanism** and until it is adopted the fee is bit-identical to before.
>
> **The whole track ships inert on values, by design.** `svc.fee_bps` is adopted; `svc.client_bond`,
> `svc.price_cap` and `svc.max_live`'s sizing evidence are `[VERIFY]`, so the service refuses
> admission today. That is R-2's legitimate state, not unfinished work — the code is complete and
> the numbers are a values-layer decision with no derivable anchor.
>
> Carried open and none of it N-blocking: **SQ-576** (a `[VERIFY]`-unset row whose consumer
> short-circuits is benchmarked on its inert path, so adopting the row silently under-declares
> weight — instance fixed, class unswept), **SQ-575**'s continuous half, **SQ-574** (TH-72's cost
> cell unpriced).

> ### ⇨ CURRENT (2026-08-03) — F2 🔨: the artifact feed had never been produced, and producing it found three defects
>
> 02 §11 makes the frontend's compatibility controls release-gated on four backend-published
> artifacts. The first thing F2 established is that **none of them has ever been published** —
> `git tag` is empty, no release exists — so the milestone's "consume the feed" is really "produce
> it, then consume it". Running the existing `tools/release/` producers for the first time found
> three defects, each invisible to every gate in the repository:
>
> 1. **V-75 — the tooling published metadata v14.** `extract-metadata.py` read through
>    `state_getMetadata`, the *legacy* RPC that returns v14 whatever the runtime supports. v14 has
>    no runtime-APIs section at all, so the artifact 02 §11 designates as the input to descriptor
>    regeneration could not describe a single one of 02 §3's frozen thirteen `FutarchyApi` methods.
>    The runtime advertises 14/15/16; v15 carries 19 runtime APIs including `FutarchyApi`. This was
>    also why the committed keeper blob was v14 — symptom, not a separate bug.
> 2. **V-77 — `surface-manifest.json` had drifted from the runtime on 8 of its 222 frozen entries**:
>    contract v17's trailing `fee` on four redemption events, contract v14's `spec_version` on two
>    registry events, and two `Attestor` rows calling `cause_hash` an `H256` when the type is
>    `[u8; 32]`. The runtime is right in all eight. 10 §5.4 generates the app's `CRITICAL_SURFACE`
>    from that file, so a client built from it would have expected the wrong shape for four
>    redemption events.
> 3. **`build-runtime.sh` ignored `CARGO_TARGET_DIR`**, making it unusable under the setup AGENTS.md
>    itself mandates on this workstation.
>
> **The common shape is worth carrying forward.** In every case the artifact was perfectly
> consistent with everyone who read it, and nothing compared it back to the source that had moved.
> `record-chainhead-fixtures.py` already *had* the layout comparison that catches (2) — it had
> simply never been run, because there has never been a release to run it for. A capability that is
> never executed is indistinguishable from one that does not exist.
>
> So the new gate `tools/ci/check-chain-feed.py` is deliberately cheap — no build, no node, about a
> second — because the expensive rebuild-and-diff leg runs rarely and this class of defect wants
> catching on every commit. Its four checks each independently catch the live defect, and
> anti-vacuity is proved **both ways**: exit 1 on the stale keeper blob (which declares contract
> **v9** against the runtime's **23**), exit 0 on the fresh v15 feed.
>
> **Next:** commit the feed under `app/fixtures/chain-feed/<spec_version>/` (wasm excluded, D2),
> then `packages/descriptors` — which adds `polkadot-api` as a **real** dependency, since it turns
> out to be an unsatisfied *peer* of `bleavit-client-ts` rather than something already in the
> lockfile. Then the release-blocking diff leg, `packages/mock-runtime`'s transcript suites, and
> FE-R1's Zombienet bounds acceptance.
> ### ⇨ CURRENT (2026-08-03) — F5 ✅: the client can now say what a trade will cost
>
> `app/packages/protocol` is the TypeScript port of Bleavit's market math, and the design decision
> worth carrying forward is that it **reproduces the runtime's integer path rather than
> out-precisioning it**. Arbitrary-precision decimals would be more accurate and would be the wrong
> answer: 04 §6.1 refuses a trade when `cost + fee > max_cost`, three separate roundings decide the
> last base unit, and a quote one unit under the chain's own figure hands the user a transaction
> that reverts. So `bigint` reproduces the guarded-Q96 kernel exactly, `u128` ceilings included, and
> every chain tunable is an argument with no default (15 §5.4).
>
> 45 tests certify it, against two artifacts. `reference-model/fixtures/vectors.json` is **read in
> place** — the single generated corpus the backend certifies against too (04 §5, rule 1), never a
> copy. But that corpus certifies *mathematics* and is blind to the layer above it, so a second gate
> was added mid-session: the runtime's own `quote()` writes
> `crates/market-core/fixtures/chain-quote-agreement.json`, Rust checks the file still describes the
> runtime, and the client checks it still agrees with the file. It immediately found two defects that
> had passed all 1,286 corpus rows — the port refused an order above `MaxTrade` that the runtime
> prices, and mislabelled an oversized sell — while the raw kernel values agreed bit-for-bit. The math
> was right; the layering was not. Anti-vacuity was proved on ten mutations, both defects included.
>
> One finding is worth every future JS consumer's attention (**V-74**):
> the corpus stores raw 64.64 integers as JSON numbers past 2⁵³, so `JSON.parse` corrupts them
> silently — V1's raw loads 891,088 off, which is >100,000× the error bound being asserted, so a
> *wrong* implementation would have passed. The loader now recovers exact digits from parser source
> text and fails closed.
>
> **Next:** **F2** is the critical path — F3 → F4 → F6 → F7 all hang off the release-artifact feed —
> and its first decision is that F4's "bootstrap descriptors from the committed metadata blob, no
> node boot needed" is **stale**: `keeper/.../runtime-metadata.scale` is B16-era (42 pallets, no
> `ClientRegistry`/`QuestionService`/`ServiceLedger`, and now no `ServiceIdBase`). **F1** (the
> FE-P1…FE-P11 prototype gates) and **F11** (distribution) are unblocked and independent of it.

> ### ⇨ CURRENT (2026-08-03) — F2 ✅: the 02 §11 artifact feed exists, is consumed, and is gated
>
> 02 §11's four published artifacts had never been produced, because no release has ever been
> tagged. F2 produced them at HEAD with the same scripts a tag release runs, wired the consuming
> side, and gated the pair in both directions. `git tag` is still empty and that is deliberate —
> blocking the client on a tag inverts the dependency graph, since 12 §1's release train needs
> frontend milestones that descend from this one.
>
> **The pair, not just the primary.** 10 §5.1 makes a primary runtime ineligible until its exact
> paired terminal-recovery runtime has published descriptors, because a recovery image can become
> current under `OnlyInherents` — treating its descriptors as operator-only would strand the
> canonical frontend during the incident they exist for. So the feed holds `bootstrap` (spec 2) and
> `bootstrap-recovery` (spec 3), and the gate enforces the pairing itself: half a pair reads as a
> complete feed to any consumer that opens one directory.
>
> **What running it for the first time cost, and what that says.** Four defects, all one shape —
> an artifact internally consistent with every consumer, never compared back to the source that
> moved. The tooling published metadata **v14**, the one version with no runtime-APIs section, so
> the blob designated as the input to descriptor regeneration could not describe a single frozen
> `FutarchyApi` method (V-75). The 222-entry frozen surface had drifted on 8 layouts, and the
> comparison that would have caught it *already existed* and had simply never been run (V-77). The
> recorder's strict failure counted half of what it gates on, and its "deterministic" transcripts
> embedded a session counter (V-78). The 13 frozen API signatures were the one part of the surface
> no gate compared at all (V-79). None of these were hypotheses; three were sitting in the tree.
>
> **Next:** F3 — `packages/chain-client`, the smoldot worker and the sole `Finalized<T>` home. It
> is the next unblocked Track F row and gates F4 and F6. Two known blockers stay named against
> their milestones: **SQ-552** gates F7's precondition tables, **SQ-557** invalidates F14's budget
> numbers.

> ### ⇨ CURRENT (2026-08-03) — Track F Phase 0 ✅: the client is specified and rooted at `app/`
>
> The canonical client moves from `frontend/` to **`app/`** and gains a serverless LLM handoff
> (D-21) — verified context out, semantic intent in, and Bleavit re-derives and reconstructs every
> transaction itself. INV-FE-6's "features that inherently require servers are out of scope rather
> than centralized" is what *selects* the file/clipboard/share transport, so the design is an
> application of the invariant, not an exception to it. The contract stays **v22** — no 02 surface
> moves. **Two INV-FE texts are amended** (15 §2.1): INV-FE-1 now separates values the client
> *sources* from values the user *chooses*, repairing a pre-existing defect whereby its published
> text bound "any value whose incorrectness could change what a user signs" to finalized chain
> state — which a typed amount satisfies, so as written it forbade the transaction screens; and
> INV-FE-9's enumeration gains `external-proposal`. Both were first carried as "ratified readings"
> and an adversarial review called that special pleading, correctly.
>
> Two proofs landed with the batch rather than after it. **V-72:** two pnpm/Vite builds at
> different absolute paths with separate stores are byte-identical with zero absolute paths — but
> the emitted sources encode the store *layout*, so `node-linker` became part of the pinned recipe.
> **V-73:** `@parity/product-sdk` is real and its signing codec fits Bleavit properly, yet the host
> is an RPC proxy rather than a light client, so host-routed reads can never be `Finalized<T>` and a
> host-routed Product build cannot sign. The Product stays optional; standalone adapters are canonical.
>
> One pre-existing defect was repaired on the way: 10 §10.2 asserted that *all* transaction form
> state is `Finalized<T>`, which is unsatisfiable — a user-typed amount could not then inhabit tx
> state. Restated without weakening the firewall.
>
> **Next:** F0 — the `app/` scaffold, with the negative-compilation corpus that proves the firewall
> *rejects* rather than only that the app works. Two known blockers are already named against their
> milestones: **SQ-552** (the 09 §1.2 ↔ 11 §11.5 precondition diff does not exist and fails on five
> rows) gates F7, and **SQ-557** (doc 10 §9's budget model uses a book count 6.32× the chain's real
> one) invalidates the numbers F14 would gate on.

> ### ⇨ CURRENT (2026-08-02) — N7 FIX ROUND 🔨: four adversarial-review defects under repair
>
> The orchestrator's review findings are being repaired in the authored worktree. The
> implementation keeps the existing two-dimensional refusal/refund ledger, external attribution
> for nested ledger work, no-sample ⇒ absent behavior, and the no-new-parameter boundary. `H` now
> stays in physical `max_block` coordinates and calls the original integer formula with the
> original kernel target; zero external usage is therefore bit-identical on the full 1e9 grid.
> The total and primary utilization paths share one max-of-normalized-dimensions helper, including
> proof-size-bound blocks. Operational/Mandatory remain measured residual primary work without a
> partition refusal. The replay is honestly named a finite containment sample (not PT-10): it
> covers the required mechanical clauses over two bounded schedules, while the unrestricted
> admissible service alphabet/interleaving space remains uncovered. The requested gates pass on
> the final generated artifacts; the orchestrator's compliance re-review remains open, and N7 is
> **not ✅**.
> ### ⇨ CURRENT (2026-08-02) — N11 ✅; N10 implemented but 🔨 on unspawned drills
> ### ⇨ CURRENT (2026-08-02) — N10/N11 🔨; PR #220 review repairs landed, live drill not-run
>
> The drop-in client pallet, runtime-independent ABI/builder, finalized-proof TypeScript facade and
> standalone client-para runtime are implemented, and the client pallet is deliberately not wired
> into Bleavit's runtime. **N10/N11 remain open** after the four adjudicated PR #220 findings:
> spending calls are now fail-closed on a configurable origin, the ingress builder withdraws only
> the XCM fee envelope, callback weight is declared by the client runtime, and drill 11 now contains
> the full lifecycle plus the `Welfare.XcmTraffic` no-change assertion. Structural checks are green.
> **The live execution leg is not-run**: every HRMP topology still stalls both parachains at block #0
> on the pinned Cumulus DMQ-head mismatch, so no execution result is claimed. The docs and drills
> therefore remain in progress until the topology blocker is repaired and the live variants run.

> ### ⇨ CURRENT (2026-08-02) — N9 ✅: hosted-report egress closed; N10 next
>
> The authoritative v21 pull row remains unchanged. The optional push now uses a fixed outbound
> `Transact` on bare `TopicRouter`, prepaid from separately custodied client USDC, and records only
> isolated service diagnostics; the local full-epoch no-channel regression leaves every welfare
> counter and `X` unchanged. Contract v22 is active for the trailing client float/calls and receiver
> ABI. Both affected pallet weights were regenerated at 50×20; every mandated gate is green and the
> independent compliance review found no blocker. N10 owns the receiver runtime/harness and therefore
> the live Zombienet both-way and return-channel-absent drills.

> ### ⇨ CURRENT (2026-08-01) — N8 ✅: exact XCM client-ingress intersection closed
>
> The six-position barrier template, exact registered-`Location`/`OriginKind::Xcm` converter and
> classifier-derived `ExternalClient` safe-call filter are runtime-bound. The legacy three-deny
> barrier remains an explicit frozen alias and its recursively generated no-`Transact` differential
> is byte-identical across result, instruction mutations and properties. Runtime drills cover the
> complete origin matrix, all three independent intersection failures, the seven named forbidden
> calls and issuance neutrality. The exact requested Rust, fuzz and reference gates are green;
> the independent compliance review found no blocker. N9 is the next pending Track N milestone.

> ### ⇨ CURRENT (2026-08-02) — N7 🔨: resource partition repair in progress
>
> Runtime slots 66/67, the complete question lifecycle, instance-local custody/freeze routing,
> contract-v21 `hosted_report`, per-instance telemetry, generated weights and the N7 verification
> suites are implemented. The user authorized the previously parked `pallet-welfare` scope on
> 2026-08-02. The second repair round now uses the physical-coordinate H/original integer formula,
> one shared two-dimensional utilization helper, and a proof-size-bound regression. The replay is
> named `n7_service_traffic_containment_sample`, not PT-10: registration is measured, every
> snapshot and decision input is byte-encoded, observe uses the real dispatcher, and the two
> finite schedules interleave service traffic at every primary boundary; the full arbitrary PT-10
> state space remains uncovered and is recorded below. Normal residual paths, the raw-dispatch
> tripwire, and saturating Mandatory accounting are documented. The requested gates pass on the
> final generated artifacts; compliance re-review is pending, and N7 is **not ✅**. Genesis
> `svc.fee_bps` remains absent, so `register` still fails closed with `ServiceRateUnset`.
>
> **Third round (PR #221 automated review).** The partition classified only the client's
> *authenticated* calls as external, so an ordinary signed trade in a hosted book — the largest
> term by volume — was booked as primary work and moved `H` after all, through the very channel
> 16 §8.5 exists to close. The resource domain is now specified as distinct from the authority
> domain and covers the hosted ledger instance, the question service and any market call naming an
> `External` book, with emergency and governance authority excluded so that a saturated client
> quota can never block a Bleavit pause or freeze. The extension's own declared weight was 2r/2w
> against an enumerated worst case of 8r/2w.

> ### ⇨ CURRENT (2026-08-01) — S7–S11: the S6 grounding method run across every uncovered area of the spec
>
> **`main` is `0b160ab`** (#203, the oracle security fix). The working tree carries **S7, S8, S9, S11 and
> the evidence half of S10 — all fifteen deliverables authored, merged and green.** Nothing is parked
> mid-air; what is deliberately *not* done is listed under *Next*.
>
> Suites: `reference-model` **290 → 611**, `simulation` 53 → 68, `tools/monitoring` 107 → 108. Eleven new
> reference-model modules, one new simulation module, three extended modules and one monitoring
> co-simulation — ~9,500 lines of module code and ~4,800 of tests. **No Rust changed and no
> `docs/architecture/` text changed.** This pass produces the executable form and the findings; every
> ruling it raises is parked as an open spec question (**SQ-543…SQ-560, batch B7**) rather than decided
> in passing, because a third of them are values-layer calls and two are normative changes to 15 §4.9.
>
> **Method — S6 named its own successor and this is it.** S6 picked its targets by *measuring* which
> spec sections the Python trees cite and then going where the documents make claims **about behaviour
> over time or over a space of inputs**: wedges, ladders, admission screens, "by construction", "≈",
> "we assume". A 21-agent audit ran that measurement across the whole doc set — **docs 01, 06, 09, 10,
> 11 and 14 had zero Python citations anywhere** — and produced 51 candidates that survived an
> adversarial verification pass. Fifteen Codex authors (`gpt-5.6-sol`, `xhigh`, one isolated git
> worktree each so no job could revert another's writes; R-13 `--sandbox workspace-write` verified from
> each job log) then implemented them **from the documents alone** per `.claude/rules/reference-model.md`
> rule 1.
>
> **The audit was wrong often enough to matter, and that is the more useful half of the result.** Codex
> corrected a load-bearing fact in nine of the fifteen briefs before implementing it. The four that
> changed a conclusion: **PARAM is not an upgrade-payload class** under 08 §5.2, so the POL wedge is not
> the universal four-class claim the audit wrote; the **cheapest slate-blanking attack is five
> earlier-PID PARAM entries at 500 USDC/epoch**, not one META at 5,000, which is 12.8× *below* 08 §7's
> own cheapest priced row rather than 3.8× below; the expedited-repair **global worst case is 82 days**,
> not 46, once every lawful `epoch.length` is swept rather than only the default; and the audit's claim
> that the Phase-0 `AttackCost̂` leg "measured nothing" was **false** — it measured 62 causal wrong-PASS
> flips and dispositioned every one as unprofitable, so the proposed violation would have failed a
> spec-compliant artifact.
>
> **What the arithmetic found. Seven items are wedges or unsafe-direction errors, and three of the
> seven are live in shipped Rust rather than only in prose.** In rough order of severity:
>
> 1. **SQ-543 — at the shipped `pol.budget_epoch` the chain cannot fund a CODE runtime upgrade at any
>    NAV.** 08 §5.3's Ask-scaled `pol.b` drives the §3 commitment to 1.6233485828× the §4.4 budget
>    asymptotically (META 1.3808096786×); at §5.4's own worked CODE point it is 189,577.34 against a
>    103,972.08 budget. The smallest budget that ever funds CODE is **1.2175115 %**, and at the 1.5 %
>    kernel ceiling it funds above 7,361,153.03 NAV. A maximum lawful TREASURY ask carries the same
>    slope, so this is not upgrade-specific.
> 2. **SQ-544 — the chain cannot leave Phase 3.** `phase3.tvl_cap` bounds *all* local USDC issuance,
>    every positive NAV term is local USDC, and the Phase-4 arming gate reads a NAV floor above the cap:
>    2,000,000 against 4,620,989. Genesis seeds 0.12 USDC, not an endowment; the ProtocolAccounts
>    exemption bypasses only the per-account meter; a cap raise is refused before arming. Derived
>    minimum caps: Phase 4 **4,620,989**, Phase 5 25,000,000, Phase 6 21,256,533. Both cap values carry
>    `[VERIFY]`, so the deliverable is a lower bound the spec states nowhere.
> 3. **SQ-545 — the expedited CODE lane force-rejects the proposal it exists to ship.** Under
>    `PB-LEDGER-FREEZE` the 06 §6.3 T20 sweep covers `Queued`, and the frozen market cannot accrue the
>    TWAP the mandatory 72 h gate needs; **no lawful trace reaches `Executed`**. The lane is also
>    unreachable in production — its only enqueue caller passes a literal `false`. And 09 §3.1's
>    "≈ 9–10 days, inside the 14-day freeze envelope" is false at **every** lawful configuration: best
>    **14 d + 1 block**, worst **82 d**; the sentence omits the 05 §3.1 pipeline entirely and substitutes
>    the 24 h kernel floor for `exec.timelock.code`'s 7 d default.
> 4. **SQ-556 — two doc-14 rows are inverted, and one of them is the only mitigation there is.** TH-64
>    prices redemption-fee avoidance at "≈ 1,000×" against the griefer; priced from the committed
>    `redeem_scalar` weight it is **8.8667×**, and at the exact 08 §9 rate floor it is **9/10** — the
>    grief pays for itself *inside the lawful envelope*, and TH-64 states the arithmetic **is** the
>    mitigation. TH-11's "deposits make third-party dusting uneconomic" is inverted ~9.7:1: 03 §4 charges
>    the `Positions` deposit to the **recipient**, so 0.662656 USDC of attacker outlay locks 6.4 USDC of
>    a victim's balance and all 64 slots, with no consent gate.
> 5. **SQ-560 — A-3 does not hold at genesis, by construction.** 350M VIT is directly signable, all of it
>    founding or ecosystem/ops, against **zero externally signable opposition**: insiders alone clear
>    every one of the six tracks including `entrenched`, whose 20 % starting support the founding
>    allocation supplies exactly. The Phase-3→4 arming ratification is therefore insider-ratified by
>    construction. Separately, 06 and 13 publish support percentages and **never name the denominator**;
>    the runtime picks total supply, which is not normative text.
> 6. **SQ-551 — a lawful key revocation raises a `severity: page` false alarm, and cannot express what
>    12 §1.3 requires.** Executing 12 §2.3 literally drives the shipped monitor to
>    `release/keyring/ReleaseChannel generation mismatch` for the whole revocation window at 0 byte
>    mismatches and 0 resolver divergences. And the frozen 02 §12 layout addresses the mask at the *new*
>    generation's keyring, so a key compromised at generation 7 is **not refused** at 8–11.
> 7. **SQ-555 / SQ-557 / SQ-553 / SQ-554 / SQ-558 / SQ-559 / SQ-552** — the remaining rows: launch-
>    configuration gate inertness and the unqualified §4.5 five-collator claim (false in phases 4+); doc
>    10 §9.1's 196-book load model at **6.32×** the chain's real observing count while omitting the
>    `Traded` stream 02 §5 freezes; §11's latency budget failing 19 of 117 lawful configurations and the
>    §7 incident aggregate's 9,999.68 bps swing against 1,750 bps of coverage; the reserve-probe line
>    funded at exactly 365.2 envelopes against 365 probe-days with `res.recover_thr` reaching 255 in one
>    unscreened amendment; guardian liability saturating to zero with no gate refusing a zero-bond
>    member; VOID contamination flipping a true REJECT to ADOPT under asymmetric branch weights; and
>    09 §1.2 ↔ 11 §11.5 failing the item-for-item bijection both documents mandate, with
>    `Rejected(BadPreimage)` naming a terminal state that cannot be constructed.
>
> **Verification.** Every module is exact-arithmetic (`Decimal`/`Fraction`), and a sweep confirms **zero**
> `float`, `random` or wall-clock use across all eleven. Falsified claims use the SQ-527 pattern — assert
> the derived truth, name the SQ in the docstring, expose the defect through a `check_*` findings
> accessor — so the suites are green rather than red-by-design. **Mutation-proven, not merely green:**
> perturbing a real module constant turns the owning suite red in every case tried
> (`POL_BUDGET_DEFAULT` → 39 failures, `GATE_P_MAX_DEFAULT` → 13, `BYTES_PER_MB` → 14, `GUARDIAN_SEATS`
> → 2, `RELEASE_CHANNEL_PREFIX_BYTES` → 1); the only no-op mutations were `WORK_PREC`, which correctly
> cannot change an exact-decimal result. `git diff --check` clean; vector freshness, the LMSR
> documentation table, limit coverage (194 keys, unwired 0), PLAN tables and spec-question batches all
> still green.
>
> **S7 landed last and found the widest class of risk, plus one integration defect of its own.**
> `registry.py` reaches `gate.p_max = 0` in five lawful amendments over 20 epochs, and there is **no
> finite-price escape**: the exact inward-rounded κ bound bottoms at one raw 1e-9 unit and never zero,
> so the strict `adopt > p_max` veto is unconditional and the META amendment that would repair it vetoes
> too. Rule 7's "bind at the consuming engine" is false for **five** relations breakable in one
> amendment (all four sigma/δ pairs and `gate.eps ≤ p_max/2`), each unsafe-permissive because it lowers
> an adoption hurdle, plus three more the audit never found (both treasury-cap orderings and the reserve
> timeout/interval pair). `dec.trailing` reaches past `dec.window` in **three** amendments and four
> epochs. And `sec.prize.meta`'s published "stalls that class's own proposals **and nothing else**" is
> false: at the 21,256,533 META NAV floor the maximum seedable prize is 669,315.42, so **one** lawful
> doubling freezes the whole META surface after two epochs. It also corrected the brief on artifact
> counts (**107 seeded / 194 classified**, not 98/179), on which document owns the NAV floors (08 §4.1,
> not 13 §4.1), and on three of the audit's numbers.
>
> **One defect was mine, not Codex's, and it is the reason to integrate rather than trust a green
> worktree.** `registry.py`'s kernel-hygiene scan walks the repository for Rust consumers of each 13 §2
> symbol. It passed in its own isolated worktree and **failed on merge**: this repository has git
> worktrees checked out *inside* it at `.claude/worktrees/`, so a second copy of
> `futarchy-primitives/src/lib.rs` made the `QUOTE_CLAMP_*` orphans read as consumed and the orphan set
> came back empty. Fixed by excluding `worktrees`/`.git` paths from the scan, with the reasoning in a
> comment; the fix is mutation-proven (removing it fails the suite). **CI would never have caught it** —
> a clean checkout has no nested worktrees — so it was a latent environment dependency in a module whose
> whole value is determinism.
>
> **Next.** Take the rulings: SQ-543 and SQ-544 are the two that block a launch story and
> both are values-layer calls the user owns. Deliberately **not** done here: the S10 engine repair
> (attacker best-response allocation and the Baseline-anchor coupling) — it changes the committed
> `bleavit.sim-calibration.v1` artifact that G0 consumes fail-closed, and wiring a confidence bound or a
> power criterion into `normative_violations` is a normative 15 §4.9 change that needs SQ-549/SQ-550
> ruled first. `market.py`'s V5 integer-conformance residue is also deferred: it touches the generated
> normative vector corpus, which is the one change here with real blast radius.
> ### ⇨ PREVIOUS (2026-08-01) — the oracle security fix, merged as #203; the E6 and S6 blocks below are prior entries and the 2026-07-30 one is kept for its E5 context
> ### ⇨ CURRENT (2026-08-01) — Track N: **N1 spec batch landed**; N2 (ledger instancing) is next and lands alone
> **New work order, user-approved design, no spec text written yet.** Bleavit will host conditional
> decision markets for external parachains, smart contracts and services over XCM, selling **price
> discovery rather than decisions**: the conditional TWAPs with provenance plus a manipulation-cost
> bound, with the client's own on-chain rule deciding and executing locally. Bleavit never runs
> foreign code, and no external state reaches any Bleavit decision, welfare or settlement input.
> v1 scope by user decision, so the contract bump (v19 → **v20**), the new threat rows (TH-66…73)
> and the new invariants (I-34…38) land in the same change set as the code.
> **Two design corrections already adopted, both from an independent second pass.** The conditional
> ledger becomes a second FRAME **instance** rather than a domain-tagged third vault family — I-4/L-2
> is stated against *the* sovereign account, singular, so shared custody masks an external-domain
> deficit until Bleavit's own traders are already unbacked, and instancing makes per-domain solvency
> the existing invariant evaluated twice while leaving `models/tla/ledger` valid verbatim. And
> settlement runs in its own pallet rather than inside `pallet-oracle`.
> **N1 is deliberately blocked on a verification round.** Four read-only `codex exec` jobs
> (`gpt-5.6-sol`, `max` effort, explicit `--sandbox read-only` confirmed from each job log per R-13)
> are refuting the load-bearing numbers before any normative text is written, because R-2 forbids
> writing spec on unverified figures. One independent finding is already in ahead of them: the
> revenue table's `H_q ≈ 3S/ε` follows from `C_hold ≥ 3S`, but certification counts **only**
> client-funded `C_disp` — so that figure is an assumption about organic depth, not a consequence of
> the design, and instrument D may be materially more load-bearing than drafted.
> **Tree state:** `CLAUDE.md` (Codex model/effort → `max`, plus the rule that two *authoring* Codex
> jobs must never share a worktree) and PLAN.md only. No code and no `docs/architecture/` files
> touched. Docs gates green.
> ### ⇨ CURRENT (2026-08-01) — Track N: futarchy as a service over XCM
> **The track.** Bleavit hosts conditional decision markets for external parachains, contracts and
> services over XCM, selling **price discovery rather than decisions**: the conditional TWAPs with
> provenance plus a manipulation-cost bound, with the client's own on-chain rule deciding and
> executing locally. Bleavit never runs foreign code, and no external state reaches any Bleavit
> decision, welfare or settlement input. Owned by `docs/architecture/16-hosted-question-service.md`.
> **What the verification round changed, before any of it was written.** Four read-only `codex exec`
> jobs were asked to *refute* the approved plan; three of four verdicts refuted load-bearing claims,
> and two `main` defects fell out that shipped as their own PRs first (SQ-561 oracle ban-store
> saturation, SQ-562 the `ManipFloor̂` shares-vs-USDC error). The oracle-exclusion argument lost
> three of five reasons — the false ones are recorded in 16 §6.2 rather than deleted, because a
> boundary defended by a wrong argument is one correction away from being reopened for the wrong
> reason. `b_min` is **1.928× larger** than drafted. The revenue case **inverted**: instrument D is
> ≈ 25 % of evidenced per-question revenue, not 2 %. And `ε_max` was **deleted from the product**
> rather than caveated, because it is not an upper bound under the real backward-crediting κ-slew
> accumulator, and a false security claim is worse than none.
> **Two structural corrections carried from the design pass.** The ledger became a second FRAME
> *instance* rather than a third vault family — I-4/L-2 is stated against *the* sovereign account,
> singular, so shared custody masks an external-domain deficit until Bleavit's own traders are
> already unbacked. And settlement runs in its own pallet rather than inside `pallet-oracle`, whose
> discipline keys are chain-wide, so hosting there is possible only by degrading Bleavit's own
> oracle economics.
> **`ServiceLedger`** (`pallet_conditional_ledger::<Instance1>`, index 67) is **wired in N7**, not
> N2 — instancing the shell and adding a second instance are separate milestones, and were conflated
> in the original N2 row.
>
> **Status for every milestone lives in the Track N table below, and per-session detail in the
> session log.** This block deliberately no longer restates which PRs are open: it was rewritten by
> every branch in the stack and conflicted on every rebase, which is duplicated status (R-4) rather
> than orientation.
> ### (prior) 2026-08-01 — security fix in flight, rebased onto E6; the E6 and S6 blocks below are prior entries and the 2026-07-30 one is kept for its E5 context
>
> **`main` is `4bd81f0`** (E6 #201 merged on top of E5 #198, S6 #200 and the SQ-535 collator re-anchor #199). Branch `fix/oracle-self-challenge-and-offense-ladder`
> carries a security fix for **two confirmed oracle vulnerabilities**, found by a whole-repository
> review of `main` and each confirmed by an independent adversarial refutation pass. Contract
> **v18 → v19** (renumbered on rebase: E6 took v18 first).
>
> **VULN 1 (HIGH) — self-challenge.** `challenge` never checked the challenger differs from the
> round's reporter, and a §5.3 reporter default settled the *challenger's* counter-value forward
> with `flagged: false`, bypassing the watchtower quorum. One account could
> `utility.batch_all([report, challenge])` — both leaves are `CallDomain::Public`, so the wrapper is
> admissible and the front-running window is **zero** — monopolize the game via `AlreadyChallenged`,
> and land its own false value unflagged in `C_attested` and therefore `W`. `adjudicate` is
> unreachable below `round_cap`, so nothing could rescue the round. Against 07 §6.3's own worked
> example the attacker nets **+102,000 instead of the intended −90,000**: 8.6 % of the required
> ladder, repeatable every epoch, with no post-settlement remedy (I-18).
>
> **The fix is on the value side, and that is the load-bearing judgement.** 07 §5.3's own closing
> sentences forbid debiting a stack a party has not funded, so no rule can make a defaulting party
> forfeit the full ladder — the money side is closed to repair. A default now takes the §10 neutral
> path (carry-last, **flagged**) at *every* round, so the attacker's gain is exactly **0**; the
> round-1 stack routes 100 % to INSURANCE (paying a bounty there would make griefing an honest
> *offline* reporter profitable), and 40/60 applies from round 2 where consented
> escalation-then-abandonment evidences a real contest. Neutralizing at **all** rounds rather than
> only round 1 is deliberate: preserving forward settlement at round ≥ 2 would leave the attack
> alive at 1.8·B₁. `challenge` also refuses the reporter — necessary but **not sufficient**, since a
> second funded account defeats it, which is exactly why the value-side fix carries the weight.
>
> **VULN 2 (MEDIUM) — the §3 ladder reset.** `deregister_reporter` + `register_reporter` erased the
> offense count for the price of two extrinsics, making the second-offense slash and the
> third-offense ejection unreachable. A bounded internal `ReporterRecords` store now retains the
> ladder across exit and ejection (the attestor's SQ-262 pattern), re-registration re-seats at the
> 07 §2(5) half stake past the second offense, and ejection is permanent. Deregistration is also now
> refused while the account is a live round's **challenger** — a third defect found on the way, and
> the thing that keeps a late verdict from landing on a departed account.
>
> **State:** `oracle-core` 52 tests, `pallet-oracle` 126, both green; fmt/clippy clean; release
> tooling 86 green; plan-tables, spec-question-batches, limit-coverage (**unwired = 0, no registry
> churn — no new 13 key**) and doc-links green.
>
> **Both pre-merge obligations are now discharged (PR #203, head `e1c6e25`, rebased onto `48e59f3`):**
> 1. **Regenerated `pallet_oracle` weights — landed, at 50×20.** `load()` now reads `ReporterRecords`
>    on *every* dispatch, so all 12 functions moved; and `crank_round_close`'s fixture was reseeded
>    onto the §5.3 default branch, which was **never measured** before (saturated acks sent every
>    round down the `Unchallenged` arm) and is now strictly the heavier one — **+4 reads / +2 writes**
>    and ref_time `2,341,966,339 → 2,988,538,778` (**+27.61 %** against the rebased base). The
>    growth-only regression gate cannot see work that was never measured, so this is the SQ-490 class
>    and the movement is a **fixture correction, not a slowdown**; it is value-pinned in
>    `tools/ci/weight-regression-acks.toml` with that reasoning, and `check-weight-regression.py`
>    reports `PASS WITH ACKNOWLEDGEMENTS`.
> 2. **The one exhaustive `tools/ci/rust-workspace-gates.sh` — green on the coherent post-rebase
>    state (`GATES_EXIT=0`).** Includes the runtime release/`runtime-benchmarks`/`try-runtime`
>    builds, the runtime-profile matrix, `no_std`, both weight checkers, and the limit-coverage leg
>    (194 keys, unwired = 0). Per R-12 this state does not owe a second exhaustive rerun.
>
> **A completeness sweep over the change set then found three more things (2026-07-31, post-gate):**
>
> 1. **A benchmark-fixture gap this PR itself introduced — real, but smaller than it first looked.**
>    Making `load()` read `ReporterRecords` on every dispatch means every benchmark whose dispatch
>    hydrates the aggregate must fill that store to its bound — but `fill_reporter_records()` was
>    reached by only 8 of the 12, via `fill_hydration` plus `crank_round_close`'s explicit call.
>    `register_watchtower` and `ack_observed` build their own fixtures, go through `mutate_core` →
>    `load()` anyway, and so measured an **empty** record store. The helper's own doc comment claimed
>    "every benchmark", which is how it read as covered. Both now call it, and each gains exactly
>    **+2,201 B** of measured state (64 × 34 B + encoding overhead) — the deterministic signal.
>
>    **Three corrections to the first reading, all recorded because the obvious framing was wrong
>    each time.** (a) **The charged PoV was never understated.** `ReporterRecords` is declared
>    `MaxEncodedLen`, so the `Estimated:` figure — the proof size actually charged — already carried
>    the full 64-record bound while the fixture was empty. Only `Measured:` (informational) and
>    `ref_time` moved; reads and writes did not. (b) **It was two functions, not four.**
>    `crank_reserve_probe` and `reserve_probe_result` go through the narrow `mutate_reserve_health`
>    path, never `mutate_core`, and their generated weights carry no `Oracle::ReporterRecords` read
>    at all. They were briefly given the fixture too; it was removed, because seeding a store the
>    dispatch provably never touches is the same misleading-fixture pattern this PR exists to fix.
>    Both now carry a comment saying why they are the exception. (c) **Do not trust a contended
>    ref_time.** An intermediate regeneration ran while another session benchmarked in a sibling
>    worktree and read `recompute_proof` +59.8 % and `register_watchtower` +11.4 %; on a quiet re-run
>    both collapsed to +2.1 % and +6.9 %. So this fixture fix is a **fidelity correction with no
>    charged-weight consequence** for those two functions — worth making because the artifact should
>    describe the state the dispatch really sees, not because it crossed a regression line. The
>    acknowledgement in `weight-regression-acks.toml` now carries that caution explicitly.
>
>    The one genuine regression remains `crank_round_close`, re-pinned at
>    `ref_time=3193098962` (+36.34 % worst case at the component high `n = 10`). Its evidence is the
>    *shape of the fit*, not the headline: the per-round slope moves **51,312,035 → 123,620,566
>    (2.4×)** while the intercept moves only +7.0 %, and the Standard Error *tightens* 1,366,514 →
>    469,648. Unmeasured per-round work moves a slope; noise moves an intercept.
>
>    **A cross-pallet consumer was missed, and CI caught it.** Regenerating only
>    `pallet_oracle` was not enough: `pallet-epoch::drive_oracle_boundaries` — the 07 §11/SQ-182
>    crank that drives the oracle's settle deadline — calls into the oracle and therefore also pays
>    the new `load()` read. `benchmark-smoke` failed with the single line
>    `STALE drive_oracle_boundaries: worst_case.reads 715 -> 716`, the **only** stale entry across
>    all 32 pallets, and a local 50×20 regeneration reproduced it exactly: the function's storage
>    list now carries `Oracle::ReporterRecords (r:1 w:0)`, `max_size: Some(2178)` = 64 × 34 + 2.
>    +0.14 % needs no acknowledgement. Two lessons worth keeping. **(i)** A new read in a shared
>    hydration path is a *cross-pallet* weight change; `--pallet <one>` is the wrong scope, and
>    `--changed` would not have found it either, since `pallets/epoch/` never moved. **(ii)** CI's
>    `2×1` run reported `settle_cohort: worst_case.proof_size 552,103 -> 568,303 (+2.9 %)` as
>    advisory; the quiet 50×20 regeneration did **not** reproduce it, confirming it as a
>    low-fidelity artifact of a component-bearing function and not this change — which is exactly
>    the distinction the constant-weight/component-bearing split in the drift gate exists to draw.
>
>    **Operational gotcha (cost one failed regeneration):** `rust-workspace-gates.sh` and
>    `regenerate-weights.py` share `CARGO_TARGET_DIR`, and the gate's plain-release runtime build
>    **overwrites** the `runtime-benchmarks` wasm at
>    `release/wbuild/bleavit-runtime/bleavit_runtime.compact.compressed.wasm`. A regeneration run
>    after the gate aborts with "Did not find the benchmarking runtime api". Regenerate weights
>    *before* the exhaustive gate, or rebuild with `--features runtime-benchmarks` after it. It
>    fails loudly rather than mis-measuring, which is the right failure mode.
> 2. **The security claim is now executable, not asserted.** The rebase brought in S6's
>    `reference-model/src/bleavit_reference_model/disputes.py` — the executable form of 07 §5–§6 —
>    which models §5.5's 40/60 split and §6.3's coverage rule but knew nothing about a *default*.
>    Added `default_slash_split()` (the v18 round-1 exception) and `self_challenge_outcome()`, which
>    re-derives every number this PR and 02 §13 publish: pre-v18 **+102,000** net at **8.6 %** of the
>    required ladder against the honest attacker's −90,000, and post-v18 **−30,000** with zero gross
>    gain. Suite **253 → 263**. One new test deliberately pins the *residual* rather than hiding it:
>    neutralization removes the gain, not the move, so an attacker may still burn `B_1` to force a
>    neutral flagged settlement — which is exactly what §11(4) prices and §10's two-consecutive-flag
>    renormalization absorbs. Another sweeps every lawful `(bond_floor, bond_bps, rounds)` triple, so
>    unprofitability does not rest on the defaults (`orc.rounds` carries no max-Δ).
> 3. **Supporting evidence the old behavior was a defect, not a design choice.** 07 §13's
>    already-existing try-state list admits exactly four `ComponentValues` categories —
>    quorum-acknowledged, challenge-resolved, adjudicated, neutral-flagged. `ChallengerDefault` is
>    none of them, so the pre-v18 path violated the spec's own invariant text. The new try-state
>    assertion is therefore a *strengthening consistent with* 07 §13, and needs no doc-15 edit
>    (15 §1's coverage rule delegates per-pallet invariants to the owning doc).
>
> Checked and found **not** owed: 07 §13 needs no `ReporterRecords` row (it lists 6 of the pallet's
> 14 storage items and 7 of its 27 errors — `RoundSchedules`, `AckRecords`, `MoneySettled`,
> `RoundActivity` and two more internal items are already absent, so the list is the contract-frozen
> surface, not an enumeration); 13 §4 needs no bound row (`Reporters` itself has none — the ≤ 64 is
> anchored at 07 §13 — and the new store reuses that same bound); and `ReporterRecordsFull` needs no
> `surface-manifest.json` entry, because the manifest is checked **manifest → metadata**, so an
> off-contract event is out of its scope by construction.
>
> **RUSTSEC-2026-0222 (wasmtime): fixed here, then superseded by `main` on rebase.** The
> `Supply chain` job passed at 15:0x and failed at 16:40 on a commit touching only `PLAN.md` and a
> weights file — because the advisory database refreshed and picked up an advisory **published the
> same day (2026-07-31)**: `wasmtime 36.0.12`, *"Stores can mix up type indices between engines"*,
> severity 3.8 (low), reached via `sc-executor-wasmtime 0.47.0`. This branch never touched a
> lockfile, so the condition was repo-wide and hit `main` and every open branch equally. It was
> **fixed rather than waived** (`cargo update -p wasmtime --precise 36.0.13`), because unlike every
> entry in `.cargo/audit.toml` this fix is semver-reachable and nothing pins the vulnerable
> version — a waiver would have documented a constraint that does not exist.
>
> **The E6 session reached the same conclusion independently and landed it first**, so after the
> rebase onto `4bd81f0` this branch's lockfile is byte-identical to `main` and the commit carries
> no dependency change at all. Recorded rather than deleted because the reasoning is the same one
> the next same-day advisory will need, and because two sessions converging on *patch, not waive*
> is the useful signal. The duplicate work is the cost of two branches meeting a live advisory
> feed at the same hour; it is not avoidable by either branch acting alone.
>
> **Pre-existing red, reported not absorbed:** `cargo test -p pallet-oracle --features
> runtime-benchmarks` fails `bench_report` identically on unmodified `HEAD` (137 passed / 1 failed
> both ways). Not caused here, not fixed here.
>
>
> ### ⇨ PRIOR ENTRY (2026-07-31) — S6 done (#200 merged); superseded on status by the security fix above, kept for its verification context
> ### ⇨ PRIOR ENTRY (2026-07-31) — E6, the proposal author/funder split (merged as #201)
>
> **Branch `feat/e6-proposal-funder-split`, rebased onto `48e59f3` (E5 pass 2, #199).** New milestone,
> user-requested: `epoch.submit` requires `proposal.proposer == who`, so a proposal's author
> and the party locking its 1k–50k USDC class bond must be the same address. E6 separates
> them — signer becomes the **funder**, `proposal.proposer` stays the **author**.
>
> The four incidence rulings are the user's and are recorded in the *Decision log*
> (reward → author, withdrawal → either, slash → funder, intake cap → re-keyed to funder).
> **The cap re-keying is load-bearing, not cosmetic:** `crates/epoch-core/src/lib.rs:776`
> counts the ≤4/epoch cap on the *author*, which is safe only while `submit` forces
> author == signer. Landing the split without it lets one funder back 16 throwaway authors
> and take the whole 64-entry `IntakeQueue`. **The sybil regression is therefore the first
> test to write and it must fail on the pre-fix keying** — a green suite that never
> exercised the old key would prove nothing.
>
> Contract goes **v17 → v18** (trailing `funder` on `Proposal` and `ProposalSummaryView`).
> Sequencing: plan → spec → core/pallet → runtime + weights + tests.
>
> **Status — complete, PR #201.** Spec layer (02, 05, 06, 08, 14, 15). Code:
> `Proposal`/`ProposalSummaryView` carry the trailing `funder`,
> `INTEGRATION_CONTRACT_VERSION` is **18**, `submit` requires `proposal.funder == who`,
> the intake cap keys on the funder and T2 admits both identities.
> `ProposalBond.proposer` renamed `.funder` — the field always tracked whoever the hold
> was placed on, and leaving it misnamed once the identities diverge is how a later
> change routes the reward through custody.
>
> **All Verify-column obligations are discharged.** The reward leg was the one parked
> across the session boundary and it needed a **PARAM** fixture, not the TREASURY one:
> TREASURY/CODE pay `min(0.05 %·Ask, 25k)`, which is 0 at the `ask = 0` every existing
> execution fixture carries, and a payout of zero pins no recipient. PARAM's flat
> `trs.reward.param` is `ask`-independent. Execution settles both incidences in one
> transaction, so the fixture pins the whole split by exact equality — author credited
> the reward and only the reward, funder credited the bond release and only the bond.
> Mutation-proven: routing to `&proposal.funder` fails it.
>
> **Two things the closing pass found that the earlier commits had not.**
> **(1) The `runtime-benchmarks` build was red** and #201 as first pushed would have
> failed CI's Rust workspace job. Both `Proposal` constructions in `configs.rs` sit
> behind that cfg, so `clippy --workspace --all-targets` never compiled them — the
> earlier "runtime-benchmarks cfg compiles" line was not evidenced by any command that
> had been run, and is corrected here rather than quietly dropped.
> **(2) try-state did not bind bond custody to the funder.** The split made a mis-keyed
> bond representable for the first time, and every other assertion passes on one: it is
> collateralized, inside its liability bound and not orphaned, while its refund *and*
> its slash reach the wrong party. Added, with a test that passes on the honest state
> and fails once the bond is re-keyed. 15 §4.1 now carries this as a **general** rule
> for any identity split, not a one-off. Four fixtures that set `proposer` alone were
> building records `submit` cannot produce; they now set both.
>
> **The weight drift was real, and the fidelity choice mattered.** `worst_case.proof_size`
> moved +2,080 B on 11 `pallet_epoch` functions — exactly **65 × 32**, one extra
> `AccountId32` propagating through `MaxEncodedLen` into the bounded proposal set. That
> is the block-bounding dimension, so it is a hard gate rather than jitter. Regenerated
> at the committed **50×20** fidelity, *not* the 2×1 the check runs at: at 2×1 the
> component fit collapses — `settle_cohort` reported a 2.5 × 10¹⁹ proof size — and
> committing that would have destroyed a linear term the growth-only regression gate
> cannot see. The regenerated file keeps its `n * (171 ±0)` slopes, which is the
> confirmation that the fit survived.
>
> **And it moved five pallets, not one — which the obvious selector cannot find.**
> `Epoch::Proposals`/`IntakeProposals` are read by the benchmarks of `pallet_attestor`,
> `pallet_execution_guard`, `pallet_guardian` and `pallet_market` too, and each records
> the item's `max_size` in its own proof annotations. `regenerate-weights.py --changed`
> selects pallets whose **local source** moved, and none of those four had any source
> change — the driver was a type in `futarchy-primitives`, one dependency edge away. A
> shared-type change moves proof sizes in every pallet that *reads* the affected storage,
> so the pallet set has to come from the storage item, not from the diff. **The cheap
> decisive check is not re-running benchmarks:** the committed `max_size: Some(N)`
> annotations encode `MaxEncodedLen` directly, so grepping them finds the complete set in
> one pass. 51 annotations across the five files went 326 → **358**.
>
> **Then the weight-regression gate — which I had not run — showed the PR would fail CI,
> and my own weight commits were the cause.** Two separate errors, both mine, both worth
> recording because neither is obvious from the diff.
>
> **(a) Two of the four extra pallets should never have been regenerated.**
> `pallet_guardian` and `pallet_market` had **zero** proof-size change — only the stale
> `max_size` *comment*. Regenerating them rewrote `ref_time` and produced +54 % and +65 %
> regressions on code this branch does not touch. The lesson is narrower than "regenerate
> the readers": regenerate a pallet when a **charged dimension** moves, and a stale
> annotation on unchanged charges is not that.
>
> **(b) The remaining regressions were measurement error, not signal.**
> `pallet_epoch::void_cohort` +51 %, `pallet_execution_guard::execute` +58 % — same host,
> same CPU as the committed values, so not hardware. Cause: a full 32-pallet benchmark
> sweep was left running **concurrently** with the regeneration (found at 204 % CPU, 58
> minutes in). Killed it, re-measured on an idle box, and the gate went to **zero
> regressions** — storage dimensions were identical throughout, because those are
> load-independent and `ref_time` is not.
>
> **Acknowledging those regressions was the wrong fix and was considered and rejected.**
> The repo has that pattern and even a precedent entry citing re-measurement variance, but
> an acknowledgement is for a change one understands and intends. These were artifacts of
> how the tool was run; committing a 58 % inflated `ref_time` would permanently overcharge
> a real dispatch and waste block capacity, and justifying it in prose would make the
> weight set less trustworthy rather than more. **Never benchmark under concurrent load** —
> and the gate that catches it is `check-weight-regression.py`, which is *not* part of
> `rust-workspace-gates.sh` and has to be run deliberately. Re-measured idle, all five
> files are coherent and the gate reports **zero regressions** across 364 shared
> functions; the genuine +32-per-read proof-size increases are carried in full.
>
> **CI then found a third site the v17 remedy was supposed to have eliminated.**
> The `Reference model` job failed on `tools/release/tests` — `17 != 18`. The 02 §13
> v17 entry claims "exactly **one** literal now exists", and that is true of the Rust
> workspace but not of the **release surface manifest**, which lives outside it and
> carries the contract surface in three places: the declared
> `integration_contract_version`, the SCALE-encoded `constant.identity.contract_version`
> layout (`0x11000000` → `0x12000000`), and the `storage.epoch.proposals` layout string,
> which spells out **every field of `Proposal`** and so needed the trailing `funder`
> appended. All three fixed derivationally (version read from the Rust constant, bytes
> from the version, field position from the verified declaration order) rather than
> hand-typed. **Only the first two are test-covered:** the layout string is validated
> against a *booted node* at release time, so a wrong field there fails no local gate —
> which is why it was derived from the declaration order rather than edited by eye.
> The lesson for the next bump is that 02 §13's one-literal claim needs the words "in
> the Rust workspace"; `tools/release/surface-manifest.json` is a fourth, fifth and
> sixth site and the only thing that catches it is `tools/release/tests`, which is in
> the **Reference model** CI job — a name that gives no hint it gates the contract.
>
> **Then `Rust workspace` failed too, and the three CI failures share one shape.**
> `pov_budgets::decide_and_settle_cohort_pov_pinned_below_map_scaling` pins
> `settle_cohort(5)`'s proof size at an exact value derived from `get_dispatch_info()`.
> It read 727,942 against a pinned 725,862 — **+2,080, the same 65 × 32**:
> `settle_cohort` touches `Epoch::Proposals` at r:33 w:32 and the `funder` field adds
> 32 B to the estimator's per-key envelope on each. Pin updated with that reconciliation
> written out, in the file's existing convention of narrating every move's cause.
> `decide`'s pin is genuinely unmoved — it is dominated by the collator-compensation
> term, not by its own proposal reads, which is worth saying because a reader would
> otherwise expect both to shift.
>
> **The process error, stated plainly: weights were regenerated four times and the suite
> that consumes them was never re-run.** The "417/417" recorded above was measured
> *before* the first regeneration. **All three CI failures are the same mistake** — each
> was a *consumer* one edge away from what changed: the PoV pin consumes generated
> weights; the release manifest consumes the contract constant; four other pallets'
> benchmarks consume `Epoch::Proposals`. Widening a shared type reaches further than the
> diff shows, and per-package verification is structurally blind to exactly that. The
> correct response is the one now running rather than another targeted re-run:
> **`tools/ci/rust-workspace-gates.sh` in full.**
>
> **It passed, exit 0** — the first full run of the exhaustive gate for E6, and the step
> that should have preceded the first push rather than following three CI failures:
> `cargo test --workspace`, the release / `runtime-benchmarks` / `try-runtime` builds and
> the try-runtime suite, `no_std`, the runtime-profile matrix, generated-weight purity and
> storage bounds, limit coverage (`unwired = 0`), the keeper leg (85) and the reference
> model (253).
>
> Gates: fmt clean; `clippy --workspace --all-targets -D warnings` clean;
> `pallet-epoch` **120/120**; `bleavit-runtime` **417/417**; release
> `runtime-benchmarks` build exit 0; weight storage bounds, generated-weight purity,
> limit coverage (`unwired = 0`), PLAN tables, spec-question batches all green.
> The exhaustive `rust-workspace-gates.sh` is not run locally; CI on #201 is that pass.
>
> Not attempted this session: weight regeneration. `submit`'s signature is unchanged
> (the funder is the origin, not an argument) and the record grew by one `AccountId32`,
> so the expected movement is small — but "expected small" is not evidence, and
> `tools/ci/regenerate-weights.py --check --changed` has not been run.
>
> ### ⇨ PREVIOUS (2026-07-31) — S6 done; the 2026-07-30 block below is superseded on status and kept for the E5 context
>
> **`main` is `055cf54` (E5 merged, #198). S6 is ✅ on PR #200, Codex review answered.** Track E's five
> milestones are all merged; this session did **S6 — reference-model grounding**, a
> verification milestone rather than a protocol one: three areas of normative prose
> that no executable artifact covered are now Python. Three modules and 120 tests in
> `reference-model` (suite **125 → 245**), **no Rust touched**. The PR's Codex review
> raised 3 × P2; all three were valid and all three are fixed, and one of them
> falsified a second spec claim — see the 2026-07-31 *S6 (Codex review response)*
> session-log row, which is the more useful read of the two.
>
> **Read the S6 row for the substance.** The short version is that executing prose
> found things reading it did not: **two** spec defects and four unstated facts.
> The first defect is **SQ-535**: 13 §3.1 rendered the
> decision window as the fixed fraction `[15/21, 18/21)` where 05 §3.1 anchors it
> absolutely, and the two agree at exactly one of the 19,201 lawful `epoch.length` values.
> Doc half fixed here, contract half in batch X because
> `phase_offsets::DECIDE_WINDOW_NUM` sits in the frozen 02 §9 `Epoch::PhaseOffsets`
> list). The second surfaced only under the PR's Codex review: **05 §3.3's `k = 3`
> claim was false** — it said every `qualify` fails permanently, where the machine
> actually admits four epochs in five forever, failing at period `k + 2`. Corrected
> under R-1; the kernel ceiling stands on the corrected argument. The four unstated
> facts: the honest challenger's break-even confidence is **5/7**, not 1/2; 07 §6.2's `17.5 %` is a constant only above
> `StakeAtRisk = 400,000`; 13 §5 item 2 caps `epoch.slots` at **5**, making seven of
> that row's twelve published values nominal; and item 1's frozen **2,240** dominates a
> reachable maximum of **1,064**.
>
> **The method is the transferable part, and it is the E5 precedent generalized.**
> `sustainability.py` earned its keep by making 08 §10's tables re-derivable; S6 picked
> its three targets by *measuring* which spec sections the reference model cited and
> which it did not, then going where the spec makes claims **about behaviour over
> time** — wedges, ladders, admission screens. Those claims are the ones prose holds
> worst. Where 05 §3.3 says a wrong constant "permanently jams" something, S6 runs the
> queue and watches it jam; where 13 §5 claims "composing against reality closes the
> class", S6 searches the lawful amendment graph instead of trusting the two worked
> examples. Both paid: the search found a **shorter** breach than either documented
> case.
>
> **Next, by the same measurement:** **06** (governance tracks, intake economics,
> guardians) and **09** (execution guard, inflow caps, phase table) have **no Python at
> all**. 06 §4's slot-monopolization pricing and 09 §5.2's Phase-3 exposure caps are
> the two with real arithmetic behind them. Neither is a milestone yet.
>
> ### ⇨ SUPERSEDED (2026-07-30) — kept for its E5 context and lessons
>
> **`main` is `76ee39e`. Working tree clean. E1, E2, E3 and E4 are all ✅ and merged**
> — #195 (`bdec21d`) + the #197 hotfix (`af2e5a0`) + #196 (`76ee39e`). Contract **v17 in
> force**, limit coverage `unwired = 0`, exhaustive `rust-workspace-gates.sh` green
> (92 suites, 3,155 tests, 0 failures), CI 14/14 on both of #196's commits. The block
> below still says "do not merge #196" and "#196 is NOT ready to merge" — **that is
> stale**; every item it names was closed before the merge. Its three durable lessons
> are not stale and are why it is kept: the `fuzz/` and `keeper/` workspaces are invisible
> to the main gate, `check-weight-regression.py` is blind to functions its own PR base
> introduces, and **CI green is not the merge bar while a review you commissioned is
> still running**.
>
> **Next milestone: E5 — reduce the recurring cost base** (Track E table). E1–E4 worked
> the *revenue* side of the crossover; E5 works the *cost* side, which is where the
> leverage is. The finding that motivates it: of the 1,145,562 USDC/yr derivable base,
> **keepers are 79.3 % and collators 15.2 %** — and `ops.keepers` alone is **61.1 %**,
> buying out-of-window observation coverage that 08 §6.3 itself says "only degrade[s]
> chart density, never decisions". Both keeper lines are linear in `1 / mkt.obs_interval`,
> so a single PARAM key at its *admitted* direction cuts ≈ 40 % of the base. Working
> levers 1 + 3 takes `C` to ≈ 560,907 and the crossover `V*` from 138.9M to **68.0M** —
> from 1.17× a saturated 5×TREASURY slate to **0.89× a saturated 5×PARAM one**. That
> changes what the endowment must bridge *to*, not just how long it lasts, and it needs
> no fee-rate raise (which 08 §10.4's σ-band rule forbids chasing revenue with anyway).
> E5's row carries the full derivation, the two levers deliberately **refused**, and the
> one cost that is both unavoidable and absent from 08 §10.1's table (`ops.coretime`'s
> `broker.renew` price). **E5 is a values-layer milestone under R-1/R-2: derive every
> figure, pick none.**
>
> **SQ-526 (open, batch E)** was raised by the same work and is adjacent, not blocking:
> `mkt.obs_interval`'s registry max (50) equals the kernel staleness threshold
> (`MKT_STALE_GAP_BLOCKS = 50`, CODE-only), so the top of the row's own range guarantees
> staleness events, and unlike the two couplings 13 rule 7 screens, nothing refuses it at
> the amendment boundary. Safe error direction; E5 targets 20 and leaves 2.5× margin.
>
> ### ⇨ HAND-OFF (2026-07-29, end of the Track E implementation session)
>
> **`main` is `af2e5a0`.** #195 (E1) merged as `bdec21d`; #197 (the POL_BASELINE hotfix)
> merged on top. `main` carries no known release-blocking defect.
> **PR #196 (E2–E4) targets `main`, is MERGEABLE**, head `2cab7bb`, merge base `af2e5a0`
> so its diff is the true remaining delta (53 files / +5,794). CI green-so-far, nothing
> failing. **Do not merge it yet** — three items below are open, one of them a major.
> Working tree **clean**, everything committed and pushed. The repo is checked out on
> `feat/e2-e4-revenue-instruments` (I switched back to it from `main` to land the fuzz fix).
>
> **Three gates exist that no local `rust-workspace-gates.sh` run can see. All three
> caught a real defect today; none of them is optional.**
> 1. **`fuzz/`** — a separate nightly workspace the gate deliberately does not build. It
>    failed on SQ-519 (`mock inventory diverged from exact 04 §6.3 drain accounting`)
>    *after* a green 1,737-test workspace run. Run `cd fuzz && cargo test` after any
>    `market-core` or ledger-custody change.
> 2. **`keeper/`** — same shape, but it *is* run by the exhaustive leg.
> 3. **`check-weight-regression.py`** — diffs against `git merge-base HEAD origin/main`,
>    so **a stacked PR's weight gate is blind to every function its own base introduces**.
>    `sweep_revenue` had no baseline until #195 merged; the regression appeared within
>    minutes of the base moving, having been invisible for the branch's whole life.
>
> **The merge-bar lesson, which cost a hotfix (2026-07-29).** #195 merged on **20/20
> green CI** — genuinely complete, nothing pending — while a `spec-reviewer` audit of
> 03/04/08/13/15 was *still running against that same code*. That audit found a
> release-blocking defect in what #195 had just shipped. **CI green is not the merge bar
> when a deeper review is in flight**: a full CI pass says the suites that exist agree,
> not that they cover the case. Here every existing test seeded at most one Baseline
> book and the defect needs two, so no amount of CI would have caught it. Wait for a
> review you deliberately commissioned before merging the code it is auditing.
>
> **Squash-merging the base of a stacked PR needs one deliberate step, and skipping it
> silently doubles the review surface.** #195 was squashed, so `main` gained one commit
> whose tree is byte-identical to the E1 tip but which shares **no ancestry** with it.
> #196's merge base stayed at the pre-E1 commit, so GitHub's three-dot diff showed
> **73 files / +14,543** — all of E1 again — where only **53 files / +5,695** were
> actually left to review. Retargeting the PR does *not* fix that; the base has to move.
> Merging `main` in (`2a16288`) did it: 18 files conflicted because E2–E4 had modified
> E1's lines after the earlier `febe7a3` merge, and **every one resolves to `ours`** —
> provably, because `theirs` is a tree identical to a commit already in our ancestry.
> The check that proves it is tree equality, not a clean-looking merge: the merged tree
> is byte-identical to the pre-merge tree, so the merge changed no content at all.
>
> **#196 had never run CI at all until 2026-07-29, and the cause is worth knowing.**
> The PR was `CONFLICTING` against its base, and GitHub builds `pull_request` events on
> the *merge* ref — which it cannot create while the merge conflicts. So the workflow
> never dispatched, and `statusCheckRollup` was an empty list rather than a failure.
> **An empty check list is not "CI is pending"; it is "CI never started."** Merging the
> base in (`febe7a3`, one conflict: both branches acknowledged the same
> `pallet_market::try_state` weight growth — the E2 pin measures the superset state and
> supersedes E1's, and the checker rejects duplicate `(file, function)` acks) cleared it.
>
> **State: E1–E4 are implemented, integrated, weight-measured and spec-reviewed.**
> Contract is **v17 in force**. Limit coverage is `unwired = 0`. Package suites:
> ledger 85, market 89, treasury 90, constitution 61, primitives 112, runtime `--lib`
> 411, keeper 83 — all 0 failed.
>
> **Regression cover for `0e5e798` (2026-07-29):** the runtime suite now
> seeds distinct Baseline books through the real Seed transition in two consecutive
> epochs, without re-running the fixture's custody-line sync after either seed. It pins
> the POL_BASELINE line debit as `2 × (headroom + min_balance)`, asserts line ≤ pot and
> runs treasury try-state. Mutation evidence is exact: removing only
> `debit_pol_custody` makes the test fail with `treasury: POL_BASELINE line exceeds real
> USDC custody pot`; restoring it passes. The existing full-cycle NAV assertion was
> corrected by the same `min_balance`: Sweep returns all recoverable seed custody, while
> the Baseline R-4 floor deliberately remains permanently debited. Requested gates are
> green: runtime `--lib` 411/0, fmt, Clippy. `configs.rs` is restored to the committed fix.
>
> **The exhaustive gate is GREEN** — `tools/ci/rust-workspace-gates.sh` (no arguments)
> exits **0** with **92 test suites passing, zero failures**, and limit coverage at
> `unwired = 0`. Measured against the code at `118f812`; the only commit after it
> (`593f9a2`) is documentation-only, so R-12 does not require a rerun for it.
>
> Getting there took **seven** runs and every failure was real, which is the reason
> to trust this one: clang-sys ×2, a clippy error the package-scoped runs never
> compile, a benchmark fixture measuring state the new ordering guard makes
> unreachable, and two stale contract-version pins the runtime suite structurally
> could not see. **On this workstation the gate cannot run at all without three
> environment variables** — full incantation in AGENTS.md · *Quality gates*; short
> form: `CARGO_TARGET_DIR` on ext4 (`$HOME` is ecryptfs), `LIBCLANG_PATH` at a dir
> containing a symlink literally named `libclang.so`, and `WASM_BUILD_WORKSPACE_HINT`
> at the repo root.
>
> **SQ-515 is closed** (2026-07-29). PT-2 and PT-6 now run at both rates through the
> existing `sequence_rates()` helper — five loops in the file, one each in
> `exercise_sequence`, PT-2, PT-3, PT-6 and PT-7. PT-2's `rate > 0` precondition was
> **hoisted, not deleted**: it asserts `registry_redeem_fee() > 0` once, because it
> guards against 13 §1 seeding zero (which would make the non-zero leg vacuous), and it
> is not a claim about the loop variable. That was the only non-mechanical part of the
> change. It also exposed a **self-contradiction in the spec text that mandates it** —
> see the Decision log row for the 15 §4.3 correction.
>
> ### Both reviews are in, and #196 is NOT ready to merge
>
> **Round-2 adversarial Codex** (no P0): 1×P1, 1×P2, 1×P3 — and it verified all four
> round-1 fixes are *genuinely wired*, checking specifically that `note_swept_residue`
> is called and that `sweep_redemption_fees` calls the MAIN sink.
> **Spec-reviewer on 03/04/08/13/15**: **1 blocker, 2 majors, 6 minors** — and it
> independently corroborated Codex's P1.
>
> **Closed this session:**
> - **Blocker — POL_BASELINE endowment with no line debit** (`0e5e798` + `e4c2112` on
>   this branch; shipped to `main` on its own as **#197**/`af2e5a0`, because a
>   release-blocking try-state defect should not wait on a large PR's review).
>   The R-4 `min_balance` endowment moved real USDC out of the POL_BASELINE pot while
>   `pallet_market::seed` debited only the LMSR `headroom`. The pot carries exactly one
>   `min_balance` of genesis slack, so the *second* Baseline book made the try-state this
>   same milestone added false. **Every existing test seeds at most one Baseline book** —
>   which is why nothing caught it. The regression proves itself by mutation: removing
>   only `debit_pol_custody` fails on `treasury: POL_BASELINE line exceeds real USDC
>   custody pot`. A stale NAV expectation moved with it, and that is the same defect
>   class rather than an accommodation — "NAV exactly restored" held *only* because the
>   line was never debited, i.e. NAV overstated custody by one `min_balance` per Baseline
>   book, the same over-permissive direction as the POL leak.
> - **P2 — two stale "v16 in force" statements in 02** (`5892af8`). Fourth instance of
>   the stale-version-copy shape this session; the phrasing was fixed, not just the digit.
>
> **Closed since, with evidence:**
> - **SQ-519 (P1)** — Baseline buy-side fee now routes to `MAIN` (`9abdedb`). Baseline
>   buys segregate the fee as a complete set in `fees_account` *before* the buyer's leg
>   is paid; terminal Sweep redeems the minimum complete set to `MAIN` uncharged, and the
>   independent reference model and corpus cover both the custody path and the thin-book
>   fail-static path. Verified independently, not on report: `cargo test --workspace`
>   exit 0, **1,737 passed / 39 suites / 0 failed**, plus reference-model 84, vector
>   freshness, doc-table, phase-gates and limit-coverage. `pallet_market` weights
>   regenerated at 50x20. Its fuzz fallout is fixed too (`2cab7bb`) — see below.
> - **SQ-517 (P1, corroborated three ways)** — both Track-E revenue cranks now refuse
>   under `PB-LEDGER-FREEZE`. The ruling needed no values judgement: **L-7 supplies a
>   proof.** Its bound is `RedemptionFeesAccrued ≤ balance(sovereign) − TotalEscrowed −
>   held_deposits − min_balance`, and the I-4 drift flag — the sole admission condition
>   for the freeze — asserts exactly `TotalEscrowed + held_deposits > balance(sovereign)`,
>   so the bound is **negative under precisely the state that authorizes a freeze**.
>   "Moves surplus, never escrow" is therefore a theorem about the healthy state, not a
>   property of the crank. `sweep_revenue` fails for the sibling reason — its fee leg
>   redeems through the ledger's *internal* path, which carries no `Frozen` check.
>   Freezing both strands nothing (neither is a terminal transition; both are retryable;
>   value stays collateralized in place), so the settlement carve-out does not reach
>   them. Amended 06 §6.3, 03 §5.4 + L-7, 04 §2. Both new tests are **mutation-proven**.
>   `sweep_dust*` deliberately left live and unchanged.
>
> **OPEN WORK, in the order I would take it:**
>
> 1. **SQ-518 (major) — written, verified, deliberately reverted from #196.** The
>    `note_insurance_inflow()` seam and both USDC slash-adapter call sites are correct
>    and need **no ruling**: 08 §1.2 already says slash proceeds overflow "automatically
>    ... **no crank for those**", and introduces the crank one bullet later only for
>    un-interceptable *direct* transfers. It is reverted because verifying it showed the
>    size: **6 runtime tests fail**, all asserting INSURANCE's *end-state* balance after a
>    slash. Their expectations encode pre-fix routing — the routing itself is right (the
>    slash still lands in INSURANCE; §1.2's surplus then overflows to `MAIN` in the same
>    transaction), so the assertions are stale, not the change. Landing it needs those 6
>    rewritten **plus** `pallet_epoch`/`pallet_oracle` weights regenerated, since the seam
>    adds storage access to every slashing dispatch. **Do it as its own PR, on the #197
>    precedent.** VIT proceeds must stay untouched (§1.2 scopes overflow to USDC; §2.2
>    marks VIT at 0 in NAV).
>
> 2. **SQ-520 — `buy` is one weight for three book kinds, benchmarked on one.** Filed
>    this session. `fn buy()` seeds `seeded_decision` and the harness has **no Baseline
>    helper at all**, so `buy_baseline`'s two new transfers are unmeasured — the
>    regenerated `pallet_market.rs` showed *no* storage change precisely because the
>    fixture cannot see them. A clean "PASS" was the symptom. Same shape as the audit's
>    note that `sweep_revenue`'s fixture measures the settled Decision path while `Voided`
>    is strictly heavier. Add a Baseline seeding helper, measure both kinds, pin each
>    fixture to the worst.
>
> 3. **#196 round-3 review, then merge** — only after 1-2 are disposed of.
>
> **Spec-audit minors — four of the six named here are now closed (2026-07-30).** Done:
> 15 §1's L-7 restatement (the `- min_balance` term is restored, and the copy mandated a
> *weaker* bound than the invariant it restates); the `sweep_revenue` `Voided`-path
> benchmark (SQ-520); the unweighted `PendingMainCredit` access in
> `pallet_asset_tx_payment`'s post-dispatch (SQ-523 — and the mechanism was not the one
> written here: the refund path exists, it is just computed from the same `WeightInfo` it
> charged); plus I-31, which did not carry the freeze condition SQ-517 gave it.
> **Still open:** 03 §3 `ProtocolAccounts` is wider than the normative enumeration, and
> the two 08 §10 figures that did not derive from their own tables are **fixed** — and they
> were **one** error, not two: 77,864/epoch is 65,864 plus a second copy of
> `keeper.budget_epoch` (it counted keepers gross at 52,229 while keeping the 12,000 row
> the gross figure contains), and "8.2 years" is just that mistake annualized to
> 1,354,279 and divided into the same 11.14M envelope. Corrected to **62,281/epoch** for
> the set that paragraph names and **9.7 years**, both now reproducible from §10.1's table.
> Both errors ran in the conservative direction, so no self-funding claim was ever
> overstated. The sixth — 03 §3's `ProtocolAccounts` — is fixed too: the implementation
> was right and the spec's "closed set" of six was short by nine, so §3 now states the
> ownership **criterion** as normative with the list marked as its derived membership.
> **All six of the minors named here are now closed.**
>
>
> **Older rulings, still open and still not coded around:**
> - **SQ-513** — the POL seed is subtracted from NAV **twice** (the seed-time
>   `POL` line debit *and* the `obligations()` commitment), making live-book drag 1.5×
>   the 08 §3 commitment for a branched proposal and 2× for the Baseline. Direction is
>   safe (understatement, fail-static) but no §3/§4.1/§10.1 figure computes it, and it
>   silently tightens the §4.2 arming gate. **08 must rule which term is the exposure;
>   §4.1's floors then need re-deriving against whichever wins.**
> - **SQ-514** — 15 §4.6's `ledger.redeem_fee` obligation contradicts itself
>   (`param-bounds` treatment vs. a demand for a `// limit-coverage:` marked test,
>   which the gate rejects on non-`dispatch-limit` keys).
>
> **Do not re-litigate these; they are settled and recorded:** `Archived => Ok(0)` is
> deliberately retained (making it an error strands already-archived books — the 03
> §5.4a ordering guard prevents the bad ordering instead); `SeededMarkets`' `()` →
> `AccountId` widening ships without a migration because the chain is **pre-genesis**
> (same clause 02 §13 applies to v15/v16/v17), and that reasoning is pinned at the
> storage item and written to **expire at genesis**.
>
> **The honest headline, unchanged:** Bleavit is **not** self-funding at launch and
> cannot be. What the arithmetic supports is that the crossover sits *at* the chain's
> own security-calibrated depth rather than beyond it. See *Track E — crossover
> arithmetic and the self-funding statement* (its own top-level section, deliberately
> not under *Milestones* — the monitoring coverage checker parses every table there as
> a milestone table).


**Track E is open and is the active work (2026-07-29; E1–E4 closed 2026-07-29, E5 opened 2026-07-30).** The "self-funding permanent institution" work order landed its **spec layer in full** — 03, 04, 08 (new **§10 Sustainability**), 13, 14, 15, 02 (contract **v16 → v17**), 00, 01, 05, 10, 11 — and the code layer shipped as **E1 → E4** in value order. **E5 is the open row**: it works the *cost* side of the same crossover, where 94.5 % of the base is two lines. Read **08 §10** for the normative arithmetic; Track E's own section carries the status and the headline figures.

The single most important finding is not one of the work order's: **the POL custody leak (E1)**. 08 §3 and §8(5) mandate that committed POL *withdraws* at settlement; the implementation releases only the NAV **obligation** and never recovers the cash, which is discarded at market reap and swept wholly to `INSURANCE` — **≈ 1.79M USDC/yr** on a 5×PARAM slate, **156 % of the entire derivable operating cost base**, and, worse, `lines[Pol]` is never debited at seed, so **NAV over-states custody cumulatively in the over-permissive direction**. That is audit scope A (R-7) and it outranked both revenue instruments at any launch-realistic volume. **Fixed and merged 2026-07-29** (E1, #195 + the #197 POL_BASELINE hotfix); the equivalent statement for the *cost* side is now E5.

**Honest status on the goal itself:** Bleavit is **not** self-funding at launch and cannot be — see the statement in Track E, which is the R-10 record. What the arithmetic supports is that the crossover sits *at* the chain's own security-calibrated depth rather than beyond it, and is reached by depth rather than by raising fee rates. Open: **SQ-506** (the Phase-0 simulation cannot falsify the revenue hypothesis — its flow is keyed to `dec.v_min`), **SQ-507** (eight `ops.*` lines have no unit cost anywhere in the repo and stay `[VERIFY]`), **SQ-508** (`run-calibration.py --check` red on stale provenance, pre-existing), **SQ-509** (a complete-set holder escapes the redemption fee for free in `Resolved` via the exempt `merge_scalar`/`merge_gate`, so 08 §10.2's β = 0.50 is an upper estimate).

**A14's spec layer is merged; its code sits in four open PRs.** `main` is `e48e48d`: **#186** landed 05 §4.3.2 (the `U` denominator, the `F` constants, `Π`'s qualifying failure class, `H`'s utilization reading) and §4.7's measurable-day set; **#185** replaced 13's superseded direction rule with the occupancy refusal rule and raised SQ-501; **#188** implemented the 05 §4.6 normalization kernel. Contract stays **v15**. Batch **X** holds SQ-181, SQ-502, SQ-503, SQ-504 and SQ-505 — **SQ-501 closed** with #189 (`ed23c80`). Full `cargo check --workspace --all-targets` green on the merged content. **SQ-501 was re-opened on 2026-07-27**: its status claimed "✅ resolved (PR #189)" while #189 is unmerged *and* carrying an open P1 that falsified the screen's central soundness argument — an optimistic status line is exactly the debt R-10 forbids.

**A14 is ✅ and the queue is drained — #185, #186, #188, #189, #187, #190, #192 and #191 are all merged.** Contract stays **v15**. Four producers shipped: `K`, `U`, `H`, `Π`. `F` is ruled out of v1; `E` and `D_eff` are blocked on non-code inputs (an unseeded `collator.bond`, and a rollout-phase ordinal `PhaseFlags` cannot supply). **Resume here — the open findings, in this order.** (1) **SQ-503** — one PR covering every family co-indexed on `XcmTrafficEpochs`, plus the `xcm_traffic_epoch` and `reserve_probe_epoch_value` folds still unmeasured inside `record_snapshot`; #187 measured the reaper's own contribution (`tick` writes 640 → 642, `settle_cohort` proof +2.9 %) and all three branches deliberately left `pallets/epoch/src/benchmarking.rs` alone for it. (2) The **`SnapshotDeadline` activation-tie wedge** — `register_metric_spec` has no cross-version check on max `activation_epoch`, so two lawful registrations wedge the deadline permanently; the dead-man then latches and later goes **silent** once `EpochTimings` reaps the wedged epoch. (3) **SQ-504**, (4) **SQ-505**, (5) **SQ-502**, (6) **SQ-181's residual** — the genesis `MetricSpec` set, now unblocked. **The lesson worth carrying more than any row:** across this queue, two of the sharpest defects were found by reading a branch's own generated weights against `main`, not by any gate — the growth-only regression check cannot see a read that was never measured, and `--all-targets` does not imply `--all-features`. Read the artifact, not the status.

**The seven-versus-three split still stands, with one amendment and two blocks.** Of the seven natively-bounded producers, **`F` is admissible but deliberately not registered in v1** — 05 §4.3.2 withdrew `Λ_max` for want of an anchor, since a median cannot see the tail the dead-man already latches on, and the weight-sum check spans `[C_onchain, C_attested]`, `[P]`, `[A]` but never `S`, so `S` may ship a proper subset for free. **`E`** is blocked on an unseeded `[VERIFY]` `collator.bond` (its coverage ratio has no denominator until the collator program lands) and **`D_eff`** on #187 plus a rollout-phase **ordinal** that `PhaseFlags` cannot supply (it distinguishes exact-3, exact-4 and post-sudo, not Phase 5 from 6+). So A14's v1 producers are **`U`, `H`, `Π`, `K`** — the other three are recorded blocks, not omissions. SQ-502 still owns the raw `P` triple; the kernel it needed is now merged.

**Registering the genesis `MetricSpec` set is not blocked by any of this** — established by the Codex review of #185, and it removes a protocol change from the table. `register_spec` validates and stores records without consulting `RuntimeMetricInputs`, so the conforming v1 set, all three `P` entries at their 05 §4.3 weights, can be registered before its producers exist; snapshots then fail closed on the missing components, which is the intended direction. An earlier version of this brief argued that no conforming set could ship without the qualified-users sketch and proposed re-weighting the `P` pillar to get around it. That was wrong on the premise, and the re-weighting it recommended is not needed.

**The one thing to know before touching weights again:** `tools/ci/regenerate-weights.py --check` is a CI gate (`benchmark-smoke`), it compares **worst-case totals** rather than the intercept/slope split, and its hard/advisory line is *measured*: constant-weight functions are fidelity-invariant and hard-gated at any `--steps`/`--repeat`, component-bearing ones are hard only at the committed file's own fidelity, because a 2-point fit can lose a linear term outright (`new_session`: worst-case writes 100 at 50×20 against 3 at 2×1). Full-fidelity coverage of component functions is therefore a **release-time obligation**, per the 15 §4.5 amendment and the release-blocking `Component weights at committed fidelity` job — the per-commit run does not claim it. `tools/ci/generated-weight-overrides.toml` no longer exempts `pallet_guardian::on_initialize`: SQ-500 gave the sweep a real bound, so the function is a real measurement again.

**SQ-493 in one line:** the oracle had been writing a flag nobody read, so a component that failed twice running kept voting its last good number at full weight — the exact case §10 says must be dropped. The fix records the flagged set beside each snapshot (with the `I_e` and tunables needed to replay that epoch) and recomputes both of a cohort's `W` values without the twice-flagged components, weights renormalized.

**Three things it surfaced that were larger than the row.**

1. **The interesting question was not how to drop a component, but which groups may be left empty.** `S` and `C` reach `W` only through `g(S)`, `g(C)`, and a gate has no weight to renormalize away — while an empty `min` and an empty weighted product both evaluate to **1**, the most favourable value there is. So the fail-closed-looking reading ("drop it, whatever the group") converts total unavailability of the security pillar into a perfect score. Those groups decline the drop; `P`/`A` renormalize one level up, and a dark `A` leaves `W = g(S)·g(C)·P`.

2. **A latent one-ulp error in the aggregation, found by my own test and confirmed independently by the reference model.** A weighted-geometric group with a single participating term at weight exactly 1 was evaluated as `exp2(1 · log2 x)`, which must truncate an irrational `log2` to the mandated 64.64 exponent grid and lands one 1e-9 ulp *below* `x`. **Both** conforming implementations do it, so no differential could ever have caught it — the reference model measured the same 0.599999999 at 332-bit precision. It was live for any single-component pillar; renormalization is what makes it reachable by construction. 05 §4.4 rule 3 now makes the exact reading normative, with the correct justification: not precision, not divergence — flooring a multiplication with no arithmetic content.

3. **`record_snapshot`'s benchmark measured none of the arithmetic.** Its fixture fabricated every component at exactly 1.0, at which every geometric term is skipped and both gates saturate; and the 16-slot spec set spent 12 slots on `S`, which is a `min`. Sixth instance of the fixture-instead-of-work shape. Now interior values with 12 weighted terms instead of 4 — which is most of why three welfare calls regressed 21–26 %.

**One defect caught in self-review before it shipped:** the recompute first re-validated the stored tunables with `WelfareParams::validate`, which compares against the *live* kernel floors. A lawful CODE amendment raising `welfare.thetaS` would then have made every in-flight cohort with a flagged streak unsettleable — and the identical check in `try-state` would have halted the chain. Stored records are now checked for internal consistency only (`validate_recorded`), with a regression test that raises a floor past the record.

**SQ-494 in one line:** 07 §12 held a decision on any challenged round above the merit floor, including one whose money leg is already neutral — so a §11(1)-retained round kept holding for its whole retention window while I-18 had already fixed the value the hold protects. The exclusion tests the spec's own definition of non-money-bearing (a settled `ComponentValues` entry for the round's triple), which keeps the decision path off the oracle's internal latch and let this land **independently of #175**.

**Two things it surfaced that were larger than the row:**

1. **`process_hold` is terminal, not a pause.** It reaches `Rejected(ProcessHold)` (T10/T20), so proposals reaching their decide window are killed and must be resubmitted. The row called it an "8-day decision freeze"; the §11(4) griefer was buying the death of every proposal consuming that component, not a delay.
2. **`decide`'s benchmark seeded zero `Rounds`**, so the whole §12 predicate — a 128-round scan with two reads per matching round — has never been charged on a decision-critical permissionless crank. Fifth instance of the fixture-instead-of-work shape. Honest fixture: 270 → 655 reads, of which only 128 are this change.

**One 13 §5 derivation reopened and was re-derived rather than relaxed.** The `decide` PoV pin fired exactly as its own comment says it should. 231,055 → 404,514 B, ceiling 384 → 512 KiB — 10.3 % of the normal-class budget beside `settle_cohort(5)`'s 9.8 %, so ~8× headroom remains and the pin stays a detector. 13 §5 item 1 now names the round scan and states why "bounded regardless of map ceiling" still holds: `MAX_ROUNDS` is a kernel constant, not a growing map.

**The Codex review found one P1 and it was right.** Adding `SnapshotContexts` without a migration leaves every snapshot an upgrading chain already retains without its context, and the new bidirectional try-state pairing then rejects the upgrade outright. `MigrateWelfareSnapshotContextsV1` backfills one per retained snapshot (storage version 0 → 1, all three `SingleBlockMigrations` profiles, single-block so it engages no 09 §3.2 lockdown). The backfill is **exact, not a stand-in**: its flagged set is empty, which is precisely the history those snapshots have, and the other two fields are provably unreadable for them — the drop set is `flagged(e+1) ∩ (flagged(e) ∪ flagged(e+2))`, so an empty `flagged(e+1)` empties it for every window containing that epoch. The same round exposed a `needless_return` inside the `runtime-benchmarks` arm of `flagged_components`, which the targeted `clippy --all-targets` run did not have the feature enabled to see — the exhaustive gate caught it. Both fixed in `7d2bbe0`.

*(Superseded — SQ-234, SQ-181's scope split, SQ-303 and SQ-490's sweep all closed; SQ-497 closed too. The live queue is the four PRs named at the top of this section.)*

**Four items are owed once that queue drains, and the first is a defect, not an improvement.** (1) `note_snapshot_recorded`'s early bails can leave `SnapshotDeadline` pinned to a stale `due_epoch`, which feeds the dead-man's snapshot-overdue cause — a **permanently latched dead-man with no re-derivation path** (R-7; fix before A14 closes). (2) `Π`'s six surveyed-but-uninstrumented sites; the real gap is `pallets/execution-guard/src/lib.rs:931` and `:1656`, where `MigrationHalt::put(true)` bypasses `MigrationHaltSources` and so misses the runtime's activation-edge recorder. (3) `IntegrityFailureRecorded` needs its doc-12 §6.3 alert row, a `series-inventory.toml` entry and a `TelemetryApi` series before monitoring can see it. (4) Recording `dec.window` at creation time, which is what would lift #189's raise-only rule on `mkt.obs_interval`.

**A13 ✅ done 2026-07-25 — certified class security envelopes, phase-gate hardening, and a 34-row verification sweep.** The milestone's last scope item was the certified PARAM/CODE/META capability-envelope source: `in_cap_prize` returned `None` for those classes, so **every non-TREASURY proposal was unresolvable at decision step 9**. Three kernel-bounded `sec.prize.*` rows now supply it from the Phase-0 published calibration, consumed exactly as 08 §5.2 and the reference model specify — which also makes the already-shipped prize-scaled `pol.b`/δ machinery live for those classes for the first time (SQ-173, SQ-270, SQ-300). Also landed: **SQ-383** (the Phase-3→4 migration bypassed 08 §4.2's minimum-viable-NAV floor at exactly the point the chain retires sudo), **SQ-197** (`phase3.*` raises refused before PARAM arming, lowering always legal), **SQ-318** and **SQ-319** (both ruled from code evidence), **SQ-382** (shared CODE/META bit binds at META's floor, no contract bump), **SQ-195** (the 07 §8 reserve-health input `R` is fed for the first time), **SQ-420**, **SQ-342** and the **SQ-360/361/362** ratifications. **The session opened by verifying all 34 open batch-X rows against HEAD, and 8 were stale** — including the entire flagged-critical reserve-probe chain (SQ-380, SQ-205, SQ-385, SQ-233), whose production wiring had shipped and never been closed out. **Closed under R-6 by a ten-round review.** Rounds 2–9 each found something real: a chain-bricking recovery-lane blocker, a missing storage migration, a rounding divergence, a reversal of correct behaviour, and — repeatedly — defects in this session's own fixes, three of which arose from two earlier fixes interacting. Round 10 returned **`A13 MAY BE MARKED DONE`, 0 blockers / 0 majors / 0 minors / 0 nits**, and confirmed SQ-303, SQ-486 and SQ-186 are outside this milestone's scope. Exhaustive Rust gate green (90 suites, 0 failures); PR **#159**. Open batch-X rows: **34 → 14**. **Two decisions are user-gated:** SQ-486 (`sec.flow_cap` ×7 conservative vs ×16 Phase-0 calibrated — the one value whose error direction is unsafe) and SQ-186 (needs integration contract v12→v13 with joint sign-off).
**A13 🔨 — certified class security envelopes, phase-gate hardening, and a 34-row verification sweep (2026-07-24).** All 34 open batch-X rows were checked against HEAD before any code was written; **6 are stale**, including the entire flagged-critical reserve-probe chain (SQ-380, SQ-205, SQ-385, SQ-233) whose production wiring shipped and was never closed out, plus SQ-263 and SQ-293. **Implemented:** **SQ-173** — the A13 blocker: `in_cap_prize` returned `None` for PARAM/CODE/META, so every non-TREASURY proposal was unresolvable at decision step 9; three kernel-bounded `sec.prize.*` rows now carry the certified capability-envelope proxies from the Phase-0 published calibration, consumed exactly as 08 §5.2 and the reference model specify, which also makes the shipped SQ-270/SQ-300 prize-scaling live for those classes. **SQ-383** — the Phase-3→4 migration bypassed 08 §4.2's NAV floor at exactly the point the chain retires sudo. **SQ-197** — `set_param` now refuses *raises* to `phase3.*` before PARAM arming (`PhaseCapRaiseRefused`, not `BadOrigin`); lowering stays legal and the migration writes the arming bits first so its scheduled raise passes the ordinary gate. **SQ-318** — T10 now releases resource locks in both arms, after verifying neither rerun entry admits `Rejected`. **Ruled:** SQ-382, SQ-319, SQ-318. **Ratified as implemented:** SQ-360, SQ-361, SQ-362. **The review round earned its keep:** two independent adversarial reviewers agreed on a blocker this branch introduced — the SQ-383 gate also bound `TerminalRecoveryTransition`, which shares the function, so a below-floor install would have been unrecoverable forever under `OnlyInherents`; the gate is now scoped to the primary path and pinned by a regression verified to fail with it enforced. They also caught that the new rows were genesis-only (an upgrading chain would have failed every PARAM/CODE/META proposal forever → `MigrateConstitutionSecurityPrizeV3` + a `try_state` requirement) and that the CODE/META upgrade floor floored where 05 §5.4 rounds up. The exhaustive gate then caught a **weight understatement** the weight checker could not: SQ-197's added `PhaseFlags` read was unmeasured, so `pallet_constitution` was regenerated at the pinned 50×20 rather than acknowledged (proof 1,057 → 1,071 B, no ack). **One value is deliberately not adopted:** `sec.flow_cap` stays at its conservative kernel floor ×7 pending a user values decision — raising it to the published ×16 is the one change in this batch whose error direction is unsafe (**SQ-486**). Runtime **344**, constitution **59**, epoch-core **36** / pallet-epoch **104**, phase-four **21**, recovery green, limit coverage **186/186**, weight regression/storage-bound and all docs checks pass. Draft **PR #159**. Open batch-X rows: **34 → 18**.
**A13 🔨 — frozen security terms, prize-scaled seeding, proposer rewards, least-authority treasury custody, and temporary budget admission control (2026-07-24).** The epoch-owned `ProposalSecurityTermsOf` certificate is captured atomically at qualification (with bounded direct-seed backfill), read by decision and POL seeding, retained through `Measuring`, and reaped with terminal state. Runtime TREASURY certificates use the exact ask; checked claimant-adverse `P_ref` arithmetic scales `pol.b` and the frozen decision δ. The REWARDS budget line is custody-backed end to end: the frame-free treasury core debits only that line, the pallet's fail-soft payout adapter preserves execution state on an unfunded pot, runtime genesis provisions the dedicated pot, and T17 execution callbacks compute live PARAM/TREASURY/CODE/META schedule values (Constitutional remains fail-closed). `sweep_insurance` now has a dedicated `InsuranceSweep` capability, separate from ordinary `TreasurySpend`, with the governance and treasury specifications aligned. SQ-303's temporary fail-closed `BudgetDerivationRequired` screen is enforced consistently by the frame-free constitution oracle and production runtime for unsafe timing/capacity and POL-floor directions; the final artifact schema/verifier/pairing remains owed. PARAM/CODE/META security capability-envelope extraction and adoption of published `sec.prize.*` values remain intentionally fail-closed. This slice adds bounded, claimant-adverse collator authored-share compensation from the dedicated `COLLATOR` custody pot, paid once at Housekeeping with deferred retry on underfunding and atomic cleanup. ORACLE-line dispute cranks (`ack_observed`, `crank_close`, and their registry analogue) are already metered through the custody-backed oracle rebate path; only the certified PARAM/CODE/META envelope source remains unresolved. Focused treasury core **28**, pallet-futarchy-treasury **62**, pallet-epoch **103**, constitution-core **21**, pallet-constitution **58**, runtime **333**, changed-scope Clippy, fmt/diff and all Cargo legs of the exhaustive Rust gate are green; the late limit-coverage metadata check was corrected to **186/186** with zero unwired keys. Draft PRs **#145** and **#146** remain open; the collator slice is ready for review in **PR #148** (stacked on #147). A13 remains 🔨.
**A13 🔨 — frozen security terms, prize-scaled seeding, proposer rewards, least-authority treasury custody, and temporary budget admission control (2026-07-24).** The epoch-owned `ProposalSecurityTermsOf` certificate is captured atomically at qualification (with bounded direct-seed backfill), read by decision and POL seeding, retained through `Measuring`, and reaped with terminal state. Runtime TREASURY certificates use the exact ask; checked claimant-adverse `P_ref` arithmetic scales `pol.b` and the frozen decision δ. The REWARDS budget line is custody-backed end to end: the frame-free treasury core debits only that line, the pallet's fail-soft payout adapter preserves execution state on an unfunded pot, runtime genesis provisions the dedicated pot, and T17 execution callbacks compute live PARAM/TREASURY/CODE/META schedule values (Constitutional remains fail-closed). `sweep_insurance` now has a dedicated `InsuranceSweep` capability, separate from ordinary `TreasurySpend`, with the governance and treasury specifications aligned. The runtime now has SQ-303's temporary fail-closed `BudgetDerivationRequired` screen for unsafe timing/capacity and POL-floor directions; the final artifact schema/verifier/pairing remains owed. PARAM/CODE/META security capability-envelope extraction and adoption of published `sec.prize.*` values remain intentionally fail-closed. This slice adds bounded, claimant-adverse collator authored-share compensation from the dedicated `COLLATOR` custody pot, paid once at Housekeeping with deferred retry on underfunding and atomic cleanup. ORACLE-line dispute cranks (`ack_observed`, `crank_close`, and their registry analogue) are already metered through the custody-backed oracle rebate path; only the certified PARAM/CODE/META envelope source remains unresolved. Focused treasury core **28**, pallet-futarchy-treasury **62**, pallet-epoch **103**, runtime **333**, changed-scope Clippy, fmt/diff and all Cargo legs of the exhaustive Rust gate are green; the late limit-coverage metadata check was corrected to **186/186** with zero unwired keys. Draft PRs **#145** and **#146** remain open; the collator slice is ready for review in **PR #148** (stacked on #147). A13 remains 🔨.
**SQ-261 ✅ — pallet-XCM benchmark/PoV closure (2026-07-24).** The runtime benchmark registry includes `pallet_xcm`; benchmark-only delivery/router/transactor fixtures exercise every reachable call while production routing, barriers and filters remain unchanged. The pinned 50×20 XCM sweep produced the wired weights, including Public `claim_assets` (6 reads/4 writes, 5,275-byte estimated proof), and the PoV census asserts that bound; disabled `execute`/`teleport_assets` remain fail-closed at `Weight::MAX`. The epoch fixture was repaired and its full 50×20 output regenerated last; constitution, registry and market outputs were refreshed, and `check-weight-storage-bounds.py` is now a gate. The final exhaustive Rust gate is green with scoped weight acknowledgements; docs checks pass. Draft PR #158 carries the implementation; no CI poll was performed.
**SQ-323 ✅ — `settle_cohort` PoV pin reconciliation (2026-07-24).** A fresh pinned 50×20 `pallet_epoch::settle_cohort` benchmark confirms the generated estimate is `183,055 + n × 30,754`, so `settle_cohort(5)` is **336,825 B**, not the stale 359,385-B figure inherited from the superseded 35,266-B slope. The normative 13 §5 derivation, runtime PoV comment and exact regression assertions now agree; the 768-KiB worst-case budget remains unchanged. No production behavior or contract surface changed.
**SQ-363 ✅ — queue-time domain-admission precondition (2026-07-24).** 09 §1.1 now enumerates the preimage-derived domain-admission check already enforced by screening and `enqueue`: class capability admission plus exclusion of `InternalRootApplyUpgrade`. The one-shot Phase-3→4 recovery-image exception remains bounded by 09 §7.2, and 05's decision pseudocode names the same live check. No runtime behavior or contract surface changed.
**SQ-321 ✅ — C_daily Q64 renormalization rule (2026-07-24).** 05 §4.4 and 15 §4.4 now pin the existing implementation's exact operation: sum `FixedU64` weights on the 1e9 grid, convert numerator and denominator to unsigned Q64.64 with floor, floor the quotient before multiplying by the weighted `log2` term, then apply the signed 64.64 product rule. Runtime and reference-model regression vectors already exercise this path; no code or contract surface changed.
**SQ-322 ✅ — ledger error-surface reconciliation (2026-07-24).** 03 §8 now lists the exact ordered public FRAME pallet error metadata (20 variants), distinguishes the core's two internal names mapped into that surface, and removes five superseded unreachable names. The existing metadata regression is the authoritative reachability check; no code or contract surface changed.
**SQ-324 ✅ — lazy Baseline provisioning ruling (2026-07-24).** The logical Baseline funding obligation remains standing and outside `pol.budget_epoch`, but the physical book/vault is instantiated during Seed only when the first qualified proposal opens markets. A zero-qualified epoch therefore has no `BaselineMarketOf` entry or Baseline charge; 05 §5.3 carry and §7(6) no-op behavior cover the absent case, while the one-book capacity derivation remains conservative. No runtime behavior or contract surface changed.
**SQ-64 ✅ — MarketCreated epoch fidelity (2026-07-24).** The frozen 02 §5 event now receives the owning epoch explicitly for every decision/gate book, while Baseline creation checks the embedded epoch against the caller-provided value before any storage mutation. Production epoch market access, benchmark fixtures and runtime tests are threaded through `proposal.epoch`; the pallet/runtime targeted suites, changed-scope Clippy, and one exhaustive Rust gate are green. This is a pre-genesis event-fidelity correction; no network drill or contract bump applies.
**SQ-75 ✅ — Registry wrapper-negative coverage (2026-07-24).** The existing authority matrix remains unchanged; the runtime now explicitly covers both registry instances’ ResolutionAuthority-only leaves under `dispatch_as`, `dispatch_as_fallible`, and `as_derivative`. Targeted/full runtime tests, changed-scope Clippy, and the exhaustive Rust gate are green. Tests-only; no contract or network drill applies.
**SQ-76 ✅ — Registry archive-delay floor and contract-v12 binding (2026-07-24).** Registry reaping now uses `max(live Params[ledger.archive], 21 × BLOCKS_PER_DAY)` for both instances, and both expose the frozen `ArchiveDelay` metadata constant. Integration contract v12, architecture decision/history, design-pack mirrors, runtime metadata/floor regressions, targeted suites, changed-scope Clippy, and the one exhaustive Rust gate are green. Pre-genesis contract correction; no network drill applies.
**SQ-88 ✅ — Baseline carry reads the sealed market snapshot (2026-07-24).** The market pallet now captures the latest valid Baseline full-window TWAP at the immutable seal boundary, retains it for the Baseline book's lifetime, and removes it atomically on reap. Runtime carry decisions use that snapshot instead of waiting for the e+3 cohort summary or accidentally reading a later in-flight window. Market/epoch/runtime regressions, changed-scope Clippy, and the exhaustive Rust gate are green. No contract bump or network drill applies.
**SQ-104 ✅ — Phase-3→4 authorization bridge verified (2026-07-24).** The merged B16 recovery lane supplies the ruled one-shot bridge: only the live bootstrap sudo Signed origin can select an exact, ratified shadow META mandate; the guard re-validates its attestation, committed primary/recovery pair, cap plan and Phase-3 flags before performing the sole internal-Root authorization. Bare or wrapped `system.authorize_upgrade` remains filtered, migration/XCMP/collator classifications match the amended matrix, relay Abort restores the unused bridge, and installed Phase-4 code consumes it permanently. The bridge, filter, application/Abort and phase-removal regressions were already covered by B16's focused and exhaustive green gates; this is a status correction only. A13/SQ-173 remains a separate release-adoption blocker, not an SQ-104 implementation gap. No contract bump or network drill applies.
**SQ-114 ✅ — Reserve-probe fee envelope verified (2026-07-24).** B15 already implements the ruled dedicated `ops.reserve_probe` line and bounded `ops.probe_fee_dot`/`ops.probe_dot_rate` conversion: each send validates the live envelope, requires the full fail-plus-recovery runway, debits the line before routing, forbids JIT withdrawal, and rolls the debit/event back on local send failure. Runtime/XCM tests cover exact ceil-rounded debits, funding/arm floors, live parameter amendments, underfunding and the production response route. The remaining `[VERIFY]` values are explicitly ops-gated live Asset Hub fee/DOT-rate calibration and onboarding evidence (07 §8), not a missing code path; synthetic HRMP tests are not being misreported as live evidence. No contract bump applies.
**SQ-125 ✅ — Keeper phase-fraction binding (2026-07-24).** The keeper now reads the frozen `Epoch::PhaseOffsets` metadata constant into each snapshot, validates all seven ordered fractions and their common denominator, and derives phase boundaries from that metadata rather than a mirrored numerator table. Missing, malformed, non-monotonic or inconsistent metadata yields no phase schedule; tick and settlement planning fail closed in that state. Keeper **56/56**, changed-scope Clippy, the single exhaustive Rust gate (including runtime profiles, reference-model/doc-table and limit coverage **186/186**) and documentation checks are green. No contract bump or network drill applies.
**SQ-125 ✅ — Keeper phase-fraction binding (2026-07-24).** The keeper now reads the frozen `Epoch::PhaseOffsets` metadata constant into each snapshot, validates all seven ordered fractions and their common denominator, and derives phase boundaries from that metadata rather than a mirrored numerator table. Missing, malformed, non-monotonic or inconsistent metadata yields no phase schedule; tick and settlement planning fail closed in that state. Keeper **56/56**, changed-scope Clippy, the single exhaustive Rust gate (including runtime profiles, reference-model/doc-table and limit coverage **186/186**) and documentation checks are green. Draft **PR #154** is open stacked on #153; its connector review/thread scan is empty. No contract bump or network drill applies.
**SQ-218 ✅ — Narrow epoch status reader (2026-07-24).** `epoch_status()` now projects directly from the bounded epoch clock/schedule and the three live status flags instead of hydrating proposals, cohorts, ring history, locks and parameters. The frame-free projection preserves the existing phase-boundary semantics, and pallet parity coverage exercises all eight phases against the full aggregate projection. Focused core/pallet/runtime tests, changed-scope Clippy, the single exhaustive Rust gate (runtime profiles, keeper, reference-model/doc-table and **186/186** limit coverage) and docs checks are green. No contract bump or network drill applies.
**SQ-218 ✅ — Narrow epoch status reader (2026-07-24).** `epoch_status()` now projects directly from the bounded epoch clock/schedule and the three live status flags instead of hydrating proposals, cohorts, ring history, locks and parameters. The frame-free projection preserves the existing phase-boundary semantics, and pallet parity coverage exercises all eight phases against the full aggregate projection. Focused core/pallet/runtime tests, changed-scope Clippy, the single exhaustive Rust gate (runtime profiles, keeper, reference-model/doc-table and **186/186** limit coverage) and docs checks are green. Draft **PR #155** is open stacked on #154; its thread-aware connector scan found no conversation comments, reviews or review threads. No contract bump or network drill applies.
**SQ-213 ✅ — Decision-statistics Baseline carry parity (2026-07-24).** `decision_input_snapshot` now marks a view complete when the live Baseline is decision-grade, or — matching `decide()`'s 05 §5.3 fallback — when the exact live Baseline window is registered, sealed, and failed decision-grade and the previous sealed carry is available. A missing or unsealed Baseline window keeps the view incomplete (`decision_stats()` is `None`), mirroring what `seal_decision_window` can evaluate; the runtime regression covers the missing-window, unsealed-window, and sealed-failed-grade+carry states. Targeted epoch/runtime tests, changed-scope Clippy, the single exhaustive Rust gate (runtime profile **342**, keeper **56/56**, reference-model/doc-table and **186/186** limit coverage) and docs checks are green. No contract bump or network drill applies.
**SQ-213 ✅ — Decision-statistics Baseline carry parity (2026-07-24).** `decision_input_snapshot` now marks a view complete when the live Baseline is decision-grade, or — matching `decide()`'s 05 §5.3 fallback — when the exact live Baseline window is registered, sealed, and failed decision-grade and the previous sealed carry is available. A missing or unsealed Baseline window keeps the view incomplete (`decision_stats()` is `None`), mirroring what `seal_decision_window` can evaluate; the runtime regression covers the missing-window, unsealed-window, and sealed-failed-grade+carry states. Targeted epoch/runtime tests, changed-scope Clippy, the single exhaustive Rust gate (runtime profile **342**, keeper **56/56**, reference-model/doc-table and **186/186** limit coverage) and docs checks are green. Draft **PR #156** is open stacked on #155; its thread-aware connector scan found no conversation comments, reviews or review threads. No contract bump or network drill applies.
**SQ-251 ✅ — Protocol-account inflow-cap exemption verified (2026-07-24).** Merged B15 already implements the ruled exemption: the canonical `ProtocolAccounts` predicate bypasses only the per-account `phase3.dep_cap` meter while the global `phase3.tvl_cap` remains enforced; `note_inflow`, `inflow_admissible`, `escrow_admissible` and try-state share the rule. `pallet-inflow-caps` **14/14** and the production Treasury protocol-keyed trap-recovery regression are green. Draft **PR #157** is open stacked on #156; its thread-aware connector scan is empty. This is a status correction only; no contract, network or Rust change applies.

**A12 oracle custody substrate ✅ — 2026-07-23.** The coherent kernel is complete: signed `counter_report` consent, durable challenger identity, bounded cumulative reporter/challenger bond custody, challenger-default settlement, d20 money-neutral retention and late bond-only verdicts, alongside the earlier atomic real-USDC registration-stake adapter and liability `try_state`. Because `SettledComponent.path` gains the explicit `ChallengerDefault` variant, the frontend contract is amended to **v11** with the user's standing joint backend/frontend sign-off; the derived design pack and runtime version assertions are synchronized. Frozen `StakeAtRisk` snapshots, registry versioning/value-scaled filing, ejection disposition and daily source stores remain parked successors. Targeted oracle/runtime tests, changed-scope Clippy, benchmark smoke and the final exhaustive gate are green. No network drill is required for this pre-genesis custody/core slice; final PLAN/docs-only updates are made under R-12 without waiting for redundant CI.

**B20 Phase-4 community distribution ✅ — 2026-07-23.** B19 remains complete in ready-for-review PR **#141** (`ea330b0`). B20 resolves SQ-107 with a treasury-owned, bounded `create_community_schedule` PARAM leaf: it is unavailable before the exact Phase-4 arming block, can draw only from the derived community pot and remaining 250M VIT allocation, invokes the real pallet-vesting adapter atomically, uses a claimant-adverse per-block floor over the fixed 24-month duration, and permits at most 4,096 successful schedules for the lifetime. The mechanism is outside the frozen 02 ingest surface, so no integration-contract bump is required. Focused pallet **59**, runtime **328** (including the real adapter), changed-scope Clippy, the exhaustive Rust gate and limit coverage **185/185** are green. Draft PR **#142** is open stacked on the B19 branch; its connector review/thread reads are empty. Final PLAN/docs changes are status-only under AGENTS.md R-12, so no redundant CI wait is planned.

**SQ-483 retained-market capacity ✅ CLOSED — 2026-07-22.** Built on the newest fetched `origin/main` at `65f581e` and stacked on the reviewed SQ-320/SQ-66 contract-v7 prerequisite (draft PR #137). Integration contract **v8** now separates the 196-book live admission/POL envelope from the 2,240-row retained archive, hard-bounds the archive tunable at one year, and retires live-only state on first durable terminal observation. Reap is independent of unbounded claimant cleanup: it atomically discards only the two protocol owners' fixed 28-cell proposal/four-cell Baseline inventory, while either cleanup ordering preserves claimant rows and collateral. Canonical book/fee addresses occupy a permanently reserved `AccountId32` namespace; creation and `try_state` enforce the exact market-id/role pair, Signed ingress is rejected before/during/after ownership registration, and MarketAuthority remains the sole ingress. Active and retained capacity are monitored independently. The final benchmark fixtures exercise 100 distinct ledger owners and saturate all 2,240 market/seed/rerun rows, 4,480 custody accounts, 196 active books/POL commitments and every bounded active auxiliary; reference-host weights were regenerated. Full Rust gates, release/monitoring/docs checks and both independent final reviews are green (**0 blockers / 0 majors / 0 minors**). Zombienet/Chopsticks were not run: this is a pre-genesis storage/account/`try_state` validity correction with no deployed-state transition or network interaction; mock/runtime corruption, exact-custody, lifecycle and saturated snapshot checks are the owning verification layer.

**SQ-320/SQ-66 Baseline-liveness follow-up ✅ CLOSED — 2026-07-22.** Work is based on the newest fetched `origin/main` at `65f581e`. PR #129's orphan-epoch finalizer is closed out as one bounded liveness component: complete authority/spec fan-out, both internal proposal maps in the dispatch and keeper proofs, fail-closed keeper decoding, useful-work-only General rebates, and contract-v7 market-lifetime `BaselineMarketOf` retention with two-way `try-state`/reap enforcement. The full Rust gate, model checks, release/docs checks and merged contract-version tests are green; the compliance pass found no implementation/spec issue after its sole remaining R-3 blocker — this status/log update — was corrected. SQ-320 and its direct SQ-66 dependency are resolved. The review exposed **SQ-483**, a distinct critical aggregate-market-capacity/archive-delay mismatch; that is the next component, not hidden inside this one.

**PR #136 synchronization complete locally — 2026-07-22.** Current `origin/main` at `f825081` is merged into `fix/migration-guard-b16`; the `PLAN.md` and runtime module-list conflicts were resolved by composing B15, B16 and B17 without dropping either branch's behavior or history. The Codex connector's P2 is fixed end-to-end: RB-UPGRADE and 12 §6.3 now use the live `cursor.started_at` elapsed-budget/Stuck detector, treat `MigrationHalted` as an event-time snapshot (including the expected `Active` → `Stuck` transition), and no longer refer to the retired progress marker. Review also pinned the diagnostic cursor bound against the full SDK cursor envelope and reconciled failed-abort-cleanup as the fourth closed trigger; final spec review is **0 blockers / 0 majors / 0 minors**. B16 stays 🔨 because SQ-309 and SQ-104 remain intentionally parked. The exact post-merge Rust gate, all three fuzz targets, affected deploy/CI/docs/monitoring checks, and the 10-gate CI-parity helper are green; no 02 surface changed, so the contract remains v6. Local merge commit: `f12f159`; **not pushed**. **Next:** push the synchronized branch when requested, then let GitHub CI evaluate the new head.

**PR #133 synchronization complete — 2026-07-22. Current `origin/main` at `b12e8de` is merged into `fix/treasury-reserve-health`; the four textual conflicts are resolved by composing both branches.** The required compliance review found one production-build composition blocker (a missing `#[cfg(test)]` on the incoming welfare test module), a stale SQ-150 spec fan-out, and a T4 target-validation gap for `constitution.amend_registry`; all are fixed with focused regressions and the final recheck is **0 blocker / 0 major / 0 minor**. Local CI is green, including the three ≥10⁶-case property shards and all **311** executable runtime benchmarks; benchmark smoke caught and the session fixed a missing NAV-prime fixture for `constitution.set_phase_flag` before the clean rerun passed. No 02 surface changed; the integration contract remains v6. **Next:** GitHub CI on the synchronized PR head.

**Batch X wave 1 (code) — 2026-07-21. All 77 rows verified against HEAD; 14 disposed, 63 remain with owners, 6 new rows raised (X: 77 → 69).** X is the last batch and the only one that is real implementation work, so it cannot close in a single pass — but it *can* stop being an undifferentiated pile. Every row was checked against the code before anything was written, and that pass did what it has done in every previous batch, only at larger scale: **verification broke or materially corrected load-bearing facts in 27 of the 77 rows.** Seven rows were disproved outright and closed with no code at all — **SQ-307** claimed the epoch-VOID Baseline path writes a terminal marker without latching, when the `WelfareLedger` adapter it dispatches through has composed `with_storage_layer` + `observe_baseline_terminal` since B10 (the row stopped tracing one layer too early); **SQ-93** was overtaken by B6; **SQ-257**'s "unfundable at Seed" defect is refused by a bond precheck before any custody moves; **SQ-177**'s central premise (that `2P` is a proxy awaiting removal) is simply false. Nine more were fixed in code — but **the review round then backed two of them out**, so seven ship. That is the batch's second lesson and it cost more than the first: **SQ-197**'s fix foreclosed a spec-mandated path (13 §115 makes arming a Phase-3 sentinel an *ordinary* `set_param` amendment, and with no phase-transition writer in existence the fix made both caps permanently un-raisable), and **SQ-66** shipped a `CountedStorageMap` with no storage migration, a prune that could never reach an epoch that never forms a cohort, and a `create_market` weight explosion (reads 3 → 115). Both reopen with their findings recorded. A third undeclared change — releasing T10 resource locks ~3 epochs early — was reverted as out of scope and raised as SQ-318. Twenty-five were **ruled** under the standing user delegation, and nineteen routed to nine newly created milestones (**A12, A13, B15–B20, O6** — B15–B19 fulfil the rows batch B2 promised in its closure and never wrote). The single most consequential finding is not a code defect at all: **batch D left doc 05 contradicting itself.** §2.1 mandated preserving an already-decided proposal's `DecisionOutcome` through cohort VOID; §7(4) mandated overwriting it for *every* affected proposal. Docs 03 §2.3 and 07 §10 back §2.1, so §7(4) was amended to match and the code now partitions the affected set — **SQ-314**, a truth defect, because the cohort archive is the only durable record of what the market concluded. **The review round is the other half of the story.** Three adversarial passes plus a spec-compliance audit returned **1 blocker and 6 majors**, most of them defects this batch introduced — including a **weight-regression CI gate that was red and that `rust-workspace-gates.sh` never ran**, so the first commit's "all gates green" claim was wrong. That checker is now wired into the local gate script. The reviewers also split 2–1 on SQ-314's partition; the shipped code takes the conservative reading (cohort membership, changing nothing but the `Measuring` case the row named) and the contested population is raised as **SQ-319** rather than settled by fiat. **Next:** wave 2 — the runtime/XCM cluster (SQ-129, SQ-205, SQ-207, SQ-244/SQ-316, SQ-308) leads on severity, and **SQ-320** (an epoch that never forms a cohort strands its Baseline holders forever) is the most severe thing the batch found and did not fix.

**Batch C (integration contract v6 — the single contract bump) ✅ CLOSED 2026-07-21 — all 35 rows disposed; open 108 → 77 on the merged base.** 32 resolved, 3 ruled and reclassified to X. Batch D landed on main mid-flight and **routed three more rows into C** (SQ-83, SQ-94, SQ-166); they were disposed with the rest rather than left for a successor batch — SQ-83 turned out to be already fixed by this batch's own dual-review remediation, SQ-94 trued 09 §1.1's `QueuedExecution` sketch (and recorded, rather than hid, the still-wired `pre_upgrade_checkpoint` that 09 §3.2 retired), and SQ-166 needed a new frozen `RejectReason::RolloverExhausted` so a terminal second deferral stops reporting itself as a deferral. Landed as **`INTEGRATION_CONTRACT_VERSION = 6`** with joint backend+frontend sign-off (the user, owner for both sides under R-1). The batch is the strongest evidence yet for verification-before-amendment: seven parallel Codex agents checked every row against the code first, and **18 of the 32 rows did not survive contact with it**. **Six were already resolved by contract v4 and had simply never been closed out** (SQ-37, SQ-43, SQ-55, SQ-87, SQ-138, SQ-198) — a fifth of the batch was phantom work. **Twelve more carried false or stale load-bearing claims**, each corrected before a word of spec text was written: SQ-212's "300×" fee error is really **100,000×** (raw `Perbill` is parts-per-billion, not bps); SQ-106's entire residual is false — FRAME's `BoundedVec` renders in real runtime metadata as a *composite* exactly like the primitives type, so the composite-vs-sequence `TypeInfo` decision it asked for does not exist; SQ-217 names two metadata constants that are not constants (`ReviewDeadlineEpochs` is a live `Config::Get` seam, `AttestorBond` does not exist) and misses the one that is (`PlaybookFreezeWindowBlocks`) — 16 omissions, not ~17; SQ-210's claim that an out-of-domain book yields the zero sentinel is false (only a computation error does); and SQ-134's "permanent / no writer ever clears" is persistent-until-next-write. **Two findings the rows understated, both now the batch's real value.** **SQ-134** — 02 §12 claims a compromised release-channel writer can only raise a false "update available" banner. Untrue: all eight combinations of (guard `PendingUpgrade`, channel `pending_authorized_at`, `URGENT_UPGRADE`) were reachable, including **suppressing a live pending upgrade**, which defeats the D-14 descriptor-lead-time warning outright. Root cause was a genuine 02 §12 self-contradiction — offset 112 called "current runtime spec_version" in the field table and written as the "target" one paragraph later. Ruled to **currently installed, always**, which is the direction a stranded metadata-less reader needs and which dissolves the stale-after-abort problem instead of needing a restore path; guard ownership of offsets 112–119 and flag bit 2 is now normative, `set_release_channel` merges instead of replacing, the content predicate that latched the clears is deleted, and new **I-30** binds the three together in try-state. **SQ-88** — the row claims A8 sources the previous settled Baseline TWAP "via a market seam"; the production adapter actually reads `RecentCohortSummaries` for epoch e−1, which cannot settle until e+2, so **05 §5.3's carry path is unreachable in production** and the pallet test passes only because the mock injects the value. Contract half landed; the source fix is X. **Process finding worth keeping:** the doc authors were launched before the code and two of them *refused to write spec text describing unshipped types* — correctly, since that is the exact drift this programme exists to remove. The order was flipped to code-first, and on the re-run all three authors reported **zero discrepancies** against shipped code. Merged main's **B14** (`73b9f6d`) mid-batch; it independently corroborated the SQ-108 ruling ("No 02 surface") while broadening its facts from three VIT pots to ten genesis-endowed protocol accounts, so 08 §2.1 was written against post-merge reality. Narrative in the Decision log; this paragraph is status only. **Next:** batch **D** closed on main the same day, so the backlog is **X** alone (code, 77) — no ratify or contract batch remains. In X, SQ-40 and SQ-36 still lead, now joined by SQ-88 and the SQ-317 weights sweep the dual review surfaced.
**Batch D (doc-truing) ✅ CLOSED 2026-07-21 — all 30 rows disposed; open 131 → 108.** 26 ratified with spec amendments, 1 closed with no amendment, 3 moved to **C**. Method as in B4/B6: every row verified against the implementation by five parallel Codex passes with file:line evidence **before a word of spec text was written** — and that broke or materially corrected **13 of 30 rows**. Two premises were false in the row's own favour. **SQ-32** asserted that governance/scheduler enactment *bypasses* `BaseCallFilter`; it does not — the pinned `pallet-scheduler` dispatches through the filter, which is exactly why the runtime carries a closed bare-values-enactment admission set, and 06 §3.3/§3.4 now state the real two-path enforcement instead of an origin-matching property `Contains<RuntimeCall>` cannot express. **SQ-83** claimed its fix needed "no contract bump" when 02 §6 is the frozen event schema — one of three rows refused as genuinely frozen-surface and routed to C (with SQ-94 and SQ-166). The largest amendment was **SQ-171**: *"market buyers recover par under VOID" was false.* A wrapper buyer's package recovers its D-1 **neutral value**, which equals the debit only at the neutral prior 0.5 — VOID refunds no premium. That false claim had propagated into **two decision-record entries (D-1 and D-3)**, G-3, and six further sites, all corrected. Five rows split doc-half-here / code-half-to-X (SQ-69, SQ-78, SQ-162, SQ-170, SQ-250), raising **SQ-313…SQ-316**; **SQ-314 leads them** — `void_cohort` overwrites the recorded decisions of Measuring cohort members, so the archive records a rejection the market never produced. Five values calls were ruled outright (Decision log), the load-bearing one being **SQ-306**: INSURANCE gains exactly one outflow, `sweep_insurance` to `MAIN` under a TREASURY decision, preserving `min_balance` per B14's R-4. Docs only; no Rust touched; the contract stays at **v5**. **Dual adversarial review of the batch's own amendments then returned 5 blockers / 12 majors — and three blockers were defects this batch introduced, all fixed in-session.** The sharpest: the SQ-171 amendment itself over-claimed, twice. It said a buyer's VOID recovery equals `cost` "at the neutral prior 0.5" — but LMSR charges the integral of a rising curve, so a buy *opening* at a 0.5 quote still executes above 0.5 on average and recovers strictly less (the repo's own V1 vector buys 1,000 units from p = 0.5 for 512.49 against a VOID recovery of ≈ 506.25); the condition is the **realized average execution price**, not the quote. And it preserved the inherited claim that "complete pairs recover par", which is false for a *same-branch* LONG+SHORT set — `merge_scalar` pays no USDC, it mints one same-branch branch-USDC worth 0.5 under VOID — a claim the frontend was about to render as a headline "100 % recovery". The third blocker was arithmetic: **08 §5.4's floor-depth illustrations do not clear sizing at all** once §5.2's `sec.flow_cap` ceiling is applied (CODE: AttackCost̂ 1,384,767 < 3P 2,079,441; TREASURY: 576,986 < 600,000), so calling them "conservative lower bounds" was wrong in both (a) — this batch's own text — and the pre-existing (b). Both restated as counterexamples showing the scaling is load-bearing, which is what §5.3's own non-bindingness bound had implied all along. Majors fixed too: the 06 §3.3 pseudocode still admitted `scheduler`/`sudo_as` while the table above it denied them; the SQ-154 origin table had false cells (`vest_other` is *not* self-scoped) and omissions; `referenda.submit` was missing from the carrier set; and the "admission set derived from §3.2" claim was untrue. **Codex PR review of #123 then landed two valid P2s, both fixed.** (i) 11 §11.6's VOID step 1 still *titled* the primary action "Merge pairs → 100 % recovery" and lumped `merge`/`merge_scalar` together, so a same-branch-only holder was routed under exactly the headline SQ-171 exists to remove — split into `merge` (the only 100 % path) and a new step 1a marking `merge_scalar`/`merge_gate` as **value-neutral consolidation that pays no USDC**, with §11.12 E16's required-UX row and the mixed-holdings decomposition aligned. (ii) The **derived** `docs/design/claude-design-kit/` pack was left stale, which AGENTS.md forbids — the doc-11 verbatim copy is regenerated, and four distillations were corrected by hand (`PROMPT.md`'s VOID layout, the domain-model payout matrix, the data-naming VOID row, and the trust-safety I-2 copy baseline, whose "buyers recover par / no loss of principal" text is now explicitly retired). Fixing the pack also caught a **stale E-numbering caution** the kit still carried — SQ-1 had just resolved it — and a sibling of SQ-236: `oracle.recompute_proof` was still specified as `(round_id, proof)` in 07 §5/§9 and 11 §11.8.1 while the shipped call takes the same `(component, epoch, spec_version, …)` triple, so it was corrected in the same pass. **Next:** batch **C** — the single v6 bump, now **35** rows (plus a new one-line residual: 02 §2's `NotRatified` gloss, superseded by SQ-163) — then **X** at **73**.

**Milestone B14 ✅ done 2026-07-21 — the R-4 genesis endowment, and a book-account ruling that went the other way.** 03 §7 R-4 has always required the ledger sovereign, treasury sub-accounts and book accounts to be "genesis-endowed and can never be reaped". Nothing endowed anything: genesis set `accounts: vec![]`, so the last full redeemer of the last open vault hit `Token(NotExpendable)` on a redemption 03 §5.3 makes legal. Ten statically derived protocol accounts are now endowed with exactly `min_balance`, and the regression is proven in both directions rather than asserted — restore `accounts: vec![]` and the test fails with the real error. Writing the rule around its *mechanism* (under `Preserve`, reducible balance is `balance − min_balance`, so the endowment binds only where every custody path preserves) immediately exposed a second gap the old wording hid: MAIN's one custody outflow used `Expendable`, which ignores the floor entirely, so endowing MAIN would have accomplished nothing. **The milestone's own open sub-question was the interesting part, and the convenient answer was wrong.** The row asked whether R-4 can bind *book* accounts at all, since they are created at Seed rather than genesis, and flagged that R-4 "may need truing". It does — but not in the direction that lets the milestone off. Per-market accounts genuinely cannot be genesis-endowed, yet a **Baseline** book holds plain USDC, because with no mirror leg to merge against the book itself funds the payout and retains the sell-side fee. Below `min_balance` that retention is unpayable under the same `Preserve` rule, and a binary search against real `pallet-assets` custody put the boundary at 6,349,782 planck (fails) → 6,349,783 (passes, retaining exactly `min_balance`): with `MinTrade` = 1 USDC, the entire band of ordinary Baseline sells up to ≈6.35 USDC was being rejected. It was **doubly masked** — the market pallet's mock genesis-endows its shared BOOK account, and the in-memory differential oracle models no custody at all, so `market-core`'s own `minimum_trades_with_dust_fees_are_admissible` cheerfully asserts the trade routes while production rejects it. That is the same blindness class the reference-model differential is supposed to catch, and it did not. Fixed by endowing the Baseline book at Seed from `POL_BASELINE`, inside epoch `tick`'s storage layer so a failed endowment rolls the seed back. `Expendable` was evaluated for that path and rejected: it folds the sub-minimum dust into the debit, sweeping the book's accrued fee into the sovereign as excess escrow where L-2 (`liability ≤ custody`) cannot detect it — silently wrong beats loudly wrong only for the attacker. **Two independent reviews then caught a critical defect in the fix itself, plus a false claim in my own spec text.** The Baseline endowment was first written as a hard `?`. If `POL_BASELINE` held exactly `min_balance + headroom`, the seed consumed the headroom and the `Preserve` transfer then found reducible = 0, propagating `CoreError::Ledger` out of `tick`'s storage layer and reverting **every proposal in the batch** — permanently, since each retry fails identically. Reachable in practice precisely because the protocol's own POL floor telemetry carried no per-book allowance, so an operator funding to the reported floor lands exactly on the cliff. That is a worse failure than the one B14 set out to fix: I had traded a bounded trading limitation for a chain-wide liveness wedge. It is now best-effort and idempotent behind an affordability pre-check — a shortfall degrades to the pre-B14 small-sell rejection and the book simply opens unendowed — and the floor computation carries the allowance; the wedge is pinned by a regression that failed `ModuleError { index: 61, error: [15,…] }` before the fix and passes after. The reviews also **disproved my own R-4 text** where it claimed the reaped Baseline residue is "recoverable under R-6": `recover_foreign` refuses `Usdc` outright and moves no custody at all, so the residue is simply **unrecoverable**, and the rule now says that plainly rather than pointing at a path that does not exist. R-4's blanket "every custody path MUST preserve" was an over-claim too — the ledger `TREASURY` sub-account is deliberately XCM-addressable and the SDK's `FungiblesAdapter` withdraws `Expendable` unconditionally — so that seam is now named instead of wished away. Spec trued per R-1 across 03 §1 (its "1-unit genesis endowment" was a flat contradiction — below `min_balance`, protects nothing), 03 §7 R-4, 04 §6.1 and 08 §1.4; **no 02 surface touched, so no contract bump**. Carried forward, not filed as new rows on standing instruction: `Market::reap` does not require ledger positions to be swept before it unregisters a book's protocol-account status, and the Baseline book's floor plus accrued fee stay in the account after reap, recoverable only under R-6. **Next:** the remaining ratification batches (B5/B6) and the X-row backlog, led by SQ-40, SQ-36 and SQ-309.

**Batch B6 (ratify 13/15 — parameters and the testing regime) ✅ CLOSED 2026-07-20 — all 19 rows disposed; open 149 → 131 on the merged base.** 18 ratified with spec amendments, 1 refused and reclassified to batch X. Taken out of order because 13/15 are the two docs the CI gates are generated from, so drift there is drift in what CI actually enforces — and the merge proved the point: the batch's own rule-6 edit broke a generated gate (below). Merged onto post-B2/B3/B4/B5 main — and with B6 closed, **all six ratify batches B1–B6 are done**: the ratify-as-shipped programme is complete. B1's lesson held again and harder: **verification broke or materially corrected 9 of the 19 rows** before a word of spec text was written. Three rows carried false load-bearing facts — **SQ-273** claimed a 3× exit threshold would reopen "14" griefing flips when the ratified artifact records **62** (the 14 was a superseded N=3000 mini-run, and the "thin-capture/gate-suppression" label was wrong too: the mix is displace-and-hold 29 / thin-capture 21 / belief-capture 12, with *zero* baseline-suppression); **SQ-269** silently dropped the word **decidable-harm** from its quote of the 15 §4.9 criterion, which is the difference between a passable gate and one that CODE (1.99 %) and META (2.22 %) fail outright; and **SQ-227** asked where to assign I-13's fuzz obligation when I-13 already had a ≥10⁶-case property suite against an exact-rational oracle — landed in S1 the same day the S2 reviewer raised the question, from a different worktree. That suite had already found and fixed a real production defect. **SQ-158 was refused ratification and split:** `grd.bond` is faithfully a kernel constant, but ratifying `dis.merit_min` as "derived at consumer" would have silently deleted an independent values-layer raise that *two* spec texts assert — the shipped code hardcodes equality to `B_1` — so it moves to X as code, not a ruling. One genuinely new finding rode the batch: `UndecidingTimeout` binds at **zero margin** against the 7-day entrenched track prepare period, benign today but a trap for anyone raising that period later — now pinned normatively in 13 §3.4 **and machine-checked** by a runtime test. **The dual review then caught three things the ratification itself got wrong** (1 blocker + 2 blockers across the two reviewers, all fixed): the SQ-194 rationale sentence appended to 13 rule 6 **broke the G0 Phase-0 gate** (its extractor read trailing prose as phantom class suffixes — fixed structurally, with a regression test), and two of my own amendments over-ratified — `grd.bond`'s metadata claim silently covered allowances that carry no metadata surface, and the sentinel note claimed "every inflow is admissible" when the two phase-3 caps gate independent checks. The review also exposed a real cross-doc contradiction: **05 §5.2** still asserted `gate.v_min` as an identity while the key is amendable, now amended to bind the live value. Because of the gate fix and the new test the batch is **no longer docs-only**. Narrative in the Decision log; this paragraph is status only. **Next:** no ratify batch remains — the backlog is now **D** (doc-truing, 30), **C** (the single integration-contract v6 bump, 32) and **X** (code, 69).

**Batch B5 (ratify 12 — ops, monitoring, release evidence) ✅ CLOSED 2026-07-20 — all 16 rows disposed; open 165 → 149 on the merged base.** The batch was worth more as an audit than as a ratification, exactly as B1 predicted: **six of the sixteen rows described the code inaccurately**, and each was ruled on what ships rather than on what the row claimed. SQ-109 credited a strict vesting lock for the no-fees-before-cliff property, but `UnvestedFundsAllowedWithdrawReasons = TRANSACTION_PAYMENT` literally *permits* fee payment — the strictness is emergent from `FungibleAdapter` ignoring withdraw reasons, so 08 §2.1 now binds the **adapter** and an adapter swap becomes a spec violation instead of a silent regression. SQ-137 would have ratified "real `System.Events` bytes" as per-variant evidence when all 90 event entries record the *same* blob at the *same* block. SQ-124's `for: 1h` guard is neither Alertmanager's nor shipped. SQ-238's "600 blocks" is doc 12's own §1.4(6) deadline, not a 13/08 value. SQ-239's default rule is not what the checker enforces, and left RB-BOOTNODE's two-owner span undetermined. SQ-243(b) claims an alert that cannot fire — its series is an O3 seam with no producer. **Two rows were strengthened rather than ratified**, because fail-closed there is also *silent*: SQ-242 fixes a **≥ 2 release-key signature floor** (12 previously fixed ≥ 2 attestations but left release signatures unquantified, and the monitor would accept an operator-configured 1), and SQ-264 turns the coretime genesis seats into a **Phase-3 entry gate** with explicit unfilled seats in the template and validator, since a genesis that forgets them is indistinguishable from one awaiting the ceremony. Three consumer gaps were closed in tooling rather than papered over: env-evidence `tier` was produced but unvalidated (a `g1` file satisfied the release gate), the monitor's signature floor, and the missing genesis seats. SQ-241 was settled **in doc 12 alone** — 02 §12 is already complete on the writer side and only reader behaviour was open — so `INTEGRATION_CONTRACT_VERSION` stays at **v5** and no 02 §13 change-control cycle was triggered (the new 12 §3.1 rules do bind frontend readers, and ride the user's standing dual-side authority under R-1). SQ-135 was deliberately written **source-agnostic** so it cannot pre-empt SQ-219 (batch B6). No runtime code touched. Rebased onto main after B2/B3/B4 landed concurrently; the one semantic conflict was RB-UPGRADE's escalation, where B2 had refuted "guardians own the `PB-MIGRATION` activation" — main's correction is kept and the paging-on-arrival rule composed onto it. **Next: batch B6** (ratify 13/15, 19 rows) — the last ratify batch, since B1–B5 are now all closed; then D (30), C (32) and X (68).

**Batch B3 (ratify 07 — oracle and registry) worked 2026-07-20 — all 9 rows closed, 6 of the 9 successors fixed in the same session, backlog 178 → 173 on top of main's B1 close, and the oracle's escalation ladder found to be unimplementable as specified.** Seven rows ratified into spec text, one split-ruled, one refused. As in B1, verification-before-amendment was what the batch was worth: it corrected or broke the premise of **five of the nine rows**. An adversarial review then caught a **blocker in the amendments themselves** — the registry ack row had been given `WindowAcknowledged` as its event, which is frozen in 02 §7.2 for the *oracle*, is deliberately not emitted by the registry, and would have pre-empted open contract row SQ-68. Exactly the B1 failure shape, caught and fixed before close; the same review also forced 05 §4.3 to actually *own* the milestone `target` field rather than 07 declaring it remotely.

Ratified: 07 §6.1's per-game freeze of `{B_1, R_max}` (SQ-249) and the previously *unspecified* bond divisor and rounding direction (SQ-260 — ruled **ceil**, on the custody principle I-4/I-28 make explicit: over-custody is dust, under-custody an unbacked claim); the registry's 72 h / quorum-2 kernel floors as a deliberate divergence from the META-tracking oracle (SQ-74); the watchtower ack row §7 never had (SQ-121); welfare-pulls-not-registry-pushes with a normative reap floor replacing a borrowed one (SQ-72); the milestone `target` as a frozen per-MetricSpec field (SQ-71); and **I-28** in 15 §1 for registry bond custody (SQ-73).

**Fixed in-session rather than carried as successors:** the ceil base-unit product with a pinning test (SQ-289), `reap_epoch` moved to the general tranche (SQ-297), a zero milestone target now fail-closed at *both* entry points instead of fabricating an aggregate of 0.0 (SQ-291), and negative tests pinning the registry's non-tracking of `orc.window`/`wt.quorum` (SQ-290). SQ-292 folded into SQ-175 (neither half is independently verifiable), and SQ-76 was reclassified **D → X** — its "or reuse `ledger.archive_delay`" option is foreclosed by the new independent-pin MUST, and the runtime's current `ArchiveDelay = LedgerArchiveDelay` binding is safe on the numbers but non-conforming.

**The two hard findings.** **SQ-293** — oracle round bonds, reporter stakes and watchtower stakes are numeric bookkeeping: no fungible type on the `Config`, and no path escrows, forfeits or transfers value, so §5.5's 40/60 forfeiture and §3/§4's "held" stakes are notional. It is masked only because SQ-174 makes `StakeAtRisk` return `Balance::MAX`, overflowing `round_bond` and refusing every exposure-bearing report. Designing the fix exposed that the ladder is **unimplementable as written**: §6.2 prices rounds 2–3 "(each side)" but no call let the *reporter* post their half, and §11(1) destroyed the bond stack that §11(2) and §11(4) both dispose of. Both are now amended — §5.3 gains `counter_report` with non-defense resolving against the reporter, §11(1) retains the round non-money-bearing until the verdict — and **neither needed a contract bump**, since 02 §7.2 freezes the oracle's storage and events, not its call list. The implementation is fully specified and sized as its own audit-scope-A milestone. **SQ-296** — ruled: value-scale the filing bond and retire §7's unimplemented escalation-time re-bond, since pricing a claim when it is made beats pricing it only if someone escalates. The §12 merit-floor objection was checked and does **not** bind (ProcessHold gates on `is_oracle_round()`; registry filings cannot hold decisions at any bond size), so the bps is pure S4 calibration; implementation blocked on SQ-174.

**Next:** B2 (ratify 06/09, 15 rows); SQ-293's implementation and the SQ-92 ledger fix as audit-scope-A milestones.

**Batch B4 (ratify 04/08) worked 2026-07-20 — 12 of 23 ratified, 3 closed, 8 refused; open 178 → 168 on the merged base.** All 23 rows were verified against the implementation by five parallel subagents before any amendment was written, and the refusal rate is the batch's main result: **a third of B4 was not ratify-as-shipped at all**, so the triage sweep's "conservative reading already shipped, no production code" classification does not survive code verification and should not be trusted for B2/B3/B5/B6 without the same pass. Ratified into spec text: 08 §4.1 gained rounding/tolerance *and* freeze/re-derivation paragraphs (SQ-39, SQ-56) — the floors are frozen constants that mix three rounding conventions, so the doc now fixes the safe *direction* (every class floor ≥ the exact requirement, ±10 USDC conformance) rather than inventing a rule, and SQ-56 was only ratifiable **with** its 13 §5 rider, since `pol.budget_epoch` (min `Perbill(0)`, `max_delta: None`) can be lowered by one META decision and push the true floor above the frozen literal; 08 §1.1 where per-line budgets bind (SQ-52), §1.2 INSURANCE outside NAV (SQ-207's accounting half), §1.3 enforcement layering — the aggregate ask cap is **not** orphaned, `static_check`/`queue_time_check` both bind it pre-decide (SQ-51), §1.4 `KeeperBudgetLow { remaining }` (SQ-119), §4.4 reruns not budget-charged because `delayed_once`/`rerun` are one-way flags capping exposure at 2× (SQ-247), §6.3 the closed decision-critical list with the ORACLE-line carve-out and effective-exhaustion-plus-latch (SQ-115, SQ-120), §7 the contest-capital truing SQ-231 left behind (SQ-185); 04 §2 reap ordering with its 03 §5.4 companion (SQ-258), §7 the clamp index `k` (SQ-41), §8.3 `BaselineMarketOf` retention (SQ-66's doc half); 05 §4.7 recording cardinality (SQ-122). Three rows closed without amendment: SQ-65 (B1b already collapsed seeding to one split per pair; the row's premise conflated the commitment meter with escrow) and SQ-85/SQ-184 (both obsoleted by contract v5, which deleted the TREASURY ask/NAV threshold outright — 13 explicitly declines to own a key that no longer exists). **Eight rows refused ratification and moved to X, two of them serious.** **SQ-40:** the spec already rules twice that an undefined prize proxy MUST NOT pass, but the runtime turns it into `Err(BadDecisionInput)` and fails the `decide` *dispatch* instead of returning `Reject(SecuritySizing)`, so every non-TREASURY proposal is unresolvable — lock held, POL standing against NAV, vault unresolved, bond unrefunded — while the reference model independently **adopts** at prize 0; the differential corpus is blind to both halves because it coerces absent envelopes to 0 and re-implements the prize table inside the harness. **SQ-36:** one in-bounds META raise of `ledger.pos_dep` (0.1 → 1.0, `max_delta: None`) drains the shared deposit pool 10× faster than it filled, and after the underflow every count-decreasing ledger call fails permanently — no migration hook exists. The rest: SQ-64 and SQ-66(b) publish wrong data on frozen 02 surfaces (`MarketCreated.epoch` ≡ 0; `BaselineMarketOf` deleted ~307 days before ring eviction), SQ-42 is a kernel↔oracle precision non-equivalence, SQ-114's own premise is false (probe response delivery draws unbounded sovereign DOT outside `res.probe_amount`), SQ-207's INSURANCE balance is unreachable by any dispatchable forever, and SQ-251 is a permanent phase-gated lock on protocol trap recovery. **SQ-298** raised: `ORACLE`, `REWARDS` and `ops.collators` carry normative budgets with no consumer implementation at all. **An adversarial Codex pass over the finished rulings then caught a defect in this batch's own amendment**: the new §4.1 text called the multi-slot rows non-arming, which contradicts §2.5's own words ("the Phase-4 arming floor") — both were reworded to separate the per-class §4.2 arming gate from the full-slate funding target. The same pass closed SQ-185's last thread (05 §5.6's `C_hold` gloss still described `V_win` as organic flow *merely capped* against wash trading, the framing SQ-231 retired) and raised three rows outside B4's scope: **SQ-299** (04 §7a describes a storage-read POL exclusion the code achieves structurally), **SQ-300** (08 §5.3's prize-scaled `pol.b`/δ are normative but the runtime seeds flat values — precisely the configuration §5.3 says its own non-bindingness bound does not cover) and **SQ-301** (§5.4(a)'s CODE example seeds the unscaled `b` its own §5.3 rule forbids).  **Rebased onto main after #117/#119 landed:** main allocated SQ-286/287/288 and then batch B3 took SQ-289…SQ-297 concurrently, so B4's ten new rows were renumbered to SQ-298…SQ-307 (main wins, per the standing collision rule). The rebase also surfaced **SQ-307** — applying B4's freshly-ratified 04 §2 / 03 §5.4 reap-ordering rule to `d77b6f5` shows the epoch-VOID Baseline path writes its terminal marker with no latch, so a voided epoch's Baseline book can never be reaped and its POL commitment stays a live NAV obligation forever. SQ-92's fix closed a stranded-funds leak and opened a standing-obligation one; the rule B4 ratified is what makes it visible. **Next:** B3 (ratify 07, 9 rows) is unblocked and untouched; B2 is in flight; the B4-sourced X rows want an owner, led by SQ-40 and SQ-36.

**Batch B2 (ratify 06/09) ✅ CLOSED 2026-07-20 — all 15 rows disposed; open 178 → 174.** 8 ratified as shipped, 6 refused as code defects and then **ruled** rather than left open, 1 to the contract bump, 4 raised. The batch reads as a case against rubber-stamping, twice over. Verification broke the "ratify-as-shipped" premise on **7 of 15 rows**; a second adversarial pass over those refusals then **refuted three claims the refusals themselves had made**, and all three corrections are recorded in the rows: SQ-97's recommended fix (gate the attestation branch on `grace_end`) would have introduced a *new* deviation, since 05 §1.3 T16 attaches a grace clause to `NotRatified` and none to `AttestationMissing`; SQ-132(d)'s "will kill a live, lawfully-progressing cursor" is structurally unreachable, because a cursor's existence forces `OnlyInherents`; and SQ-45(a)'s "widening" is fail-closed in production, since the trigger it reads has no writer. Ratified into spec text: **06** §3.3's node-counting rule for `MAX_NESTED` with its reference pseudocode corrected (SQ-31), §6.2's no-effect activation and activation-expiry bounds (SQ-278, SQ-45a), §6.3's renewal-from-renewal-block edge (SQ-45b), §7's held-bond challenge basis (SQ-248); **09** §1.2(11)'s decode-depth invariant plus a new 13 §2 kernel row (SQ-225), §2.1(7)'s relay-Abort arm (SQ-131), §2.3's `updated_at` semantics (SQ-133), §3.2's trigger-list amendment (SQ-132a–c), §5.2's split-path and mint-step scopes (SQ-252, SQ-253). **Ruled on re-verification, each staying open in X until its code lands:** SQ-97 — the attestation dispatch check is over the *record*, never the roster, so a routine attestor rotation can no longer terminally kill a ratified, matured upgrade; SQ-132(d) — "stalled" is a time budget, not a cursor-motion test; SQ-129 — inflow caps bind before the mint; SQ-45(c) — the review deadline is a duration, not an epoch index, so five approvers can no longer lose 25,000 VIT each up to an epoch early; SQ-127 + SQ-144 jointly — the PB-MIGRATION audit anchor moves to code-application time and drops its incoherent state-root component. None of the five needs a contract bump. Each row carries its implementation scope and stays **open** in X: the question is answered, the code is not written, and marking them resolved would assert otherwise. **One of the four new rows is serious: SQ-309** — with `KeepStuck`, any live migration cursor forces `ExtrinsicInclusionMode::OnlyInherents`, so 09 §3.2(3)'s designated recovery lane cannot be included in a block at all, and §3.2(1) forecloses the SDK's own `ForceUnstuck` escape; latent behind `type Migrations = ()`, it arms with the first real multi-block migration. Also SQ-308 (screening/guard `enqueue` parity), SQ-310 (T12's review window), SQ-311 (T24 unreachable at the deadline). **The R-6 review of these amendments then found 3 blockers in my own text, all fixed before the batch closed** — and that is the third time this session adversarial review caught me. (i) The SQ-97 ruling as first written left for-cause revocation *conditional* and omitted recall, so it opened a hole the shipped roster read had closed; revocation is now a mandatory MUST that the relaxation explicitly depends on. (ii) The new try-state rule was unsatisfiable — `PendingUpgrade ⇒ anchor` fails for the ≥ 72 h `DescriptorLeadTime` window on every healthy chain; it is now one-way in the other direction. (iii) 15 I-19, 14 TH-28 and 11 §11.5 still asserted the roster reading, so R-1 consistency was broken until they were amended too. Nine majors went with them, including an off-by-one in RB-UPGRADE's reconstructed anchor and a `max_steps ≤ 900` bound that had to become strict. **A second R-6 pass on 2026-07-21 then retracted the SQ-97 relaxation before it could ship** — it keys on a "for-cause" departure that the frozen 02 §7.5 surface cannot express, which would have made it strictly weaker than the roster read it replaces. 06 §7 and 09 §1.2(5) now forbid implementing it; the shipped check and its liveness trap stand, and the way out is **SQ-312** in batch C, escalated rather than ruled because one option needs a contract bump and the other redefines recall. **Next:** B4 (ratify 04/08, 23 rows) — B3 merged as PR #118. In X, SQ-309 leads (the `OnlyInherents` recovery trap); in C, SQ-312 gates the SQ-97 fix.

**Batch B1 (ratify 05/03) ✅ CLOSED 2026-07-20 — all 13 rows disposed; open 190 → 178.** 8 ratified with spec amendments, 3 refused as code defects, 2 deferred rows closed on the follow-up cleanup pass. What the batch was actually worth is the verification, not the ratification: every row was checked against the code before any amendment was written, which improved five rulings beyond what the rows claimed and **broke three outright**. Two of those three were live defects, both now fixed (PR #117): **SQ-92** left the 03 §2.3/§5 Baseline VOID settlement unwired, so single-sided Baseline holders of a voided epoch could never redeem — invisible to every solvency invariant because pair holders still exit at par via `merge_baseline`; **SQ-98** was a crank-order race in which a ledger freeze par-voided via `tick` but Reject-resolved via `decide`, deciding whether Accept-branch holders recovered ½ or nothing. The third, **SQ-79**, is a genuine G-1 question and stays open in batch X. Adversarial review earned its keep twice: it caught a fourth over-ratification in the SQ-90 amendment before #114 merged, and three real defects in the #117 patch — including a stale TLA⁺ T20 binding whose obvious fix turns out to break `Cardinality(matches) = 1` and was therefore reverted and documented. **The cleanup pass then corrected an over-raising habit** (user challenge: "why did you add new SQ questions instead of just reducing"): SQ-285/286/287 were re-examined and **ratified as shipped** rather than left open, and SQ-288 was reclassified out of *Spec questions* into milestone **B14** because it is a defect against an unambiguous spec, not a question. B1's own tail (SQ-187, SQ-188) closed the same way — verified against `pallet-market` and `epoch-core`, both under-documented rather than defective. Narrative detail for all of it is in the Decision log and Session log; this paragraph is status only. **Next: batch B2** (ratify 06/09, 15 rows). Milestone **B14** is queued in Track B.

**Spec-questions triage sweep ✅ (2026-07-20, worktree `spec-question-fixes`) — the backlog is now sorted, sized and honest.** Scope framing first: with G0 and G1 ✅, the pre-G2 work that is *not* frontend is exactly **O3 + the spec-questions backlog** — O1 depends on F11 and O2 on FE-P7, and G2 itself depends on the F-launch set, so no other non-FE milestone stands between here and G2. The sweep verified 16 stale/partial rows against the actual implementation (4 parallel Explore subagents, file:line evidence — no row closed on assumption): **13 closed** and **4 narrowed to their exact residual**, taking the table from **203 open to 190** (89 resolved). The closures were all work later milestones had already done without the row being updated — B10's treasury obligation mirrors and `Params` rebinding (SQ-47, SQ-159), B9's keeper meter (SQ-49), B12's quote TTL (SQ-53), B1b's fallible guardian schedulers (SQ-143), B10/B12 emptying the limit-coverage exemption class (SQ-155), G0's 14 bound corpus families (SQ-267), and the 2026-07-19 R2 gates ruling (SQ-271). The narrowings matter more than the closures: SQ-142 is down to a single unwritten input (`published_flow_per_day`, riding the *specified* L̂/2 fallback), SQ-180's shrink-to-fit is complete but its loud companion never fires (`flag_nav_floor`/`ensure_nav_floor` have zero production callers), and SQ-75 is a wrapper-negative *coverage* gap rather than the vulnerability it read as. One production change rode the sweep: `pallet-epoch`'s `GenesisConfig::default()` moved `index: 0 → 1` (+ pinning test) so a chain spec omitting the `epoch` patch section can no longer seat the live clock on the epoch-0 pre-launch sentinel and inherit the genesis activation relaxation (SQ-82; 05 §4.6, I-16) — the residual ambient-sentinel coupling in `welfare-core` is recorded, not papered over. The section now carries a **mechanically-checked resolution-batch index**: all 190 open rows assigned to exactly one of **B1–B6** (ratify-as-shipped — the row already holds the conservative reading, so resolution is a ruling plus a doc sentence, ~95 rows, **no production code**), **D** (doc-truing, 26), **C** (one integration-contract bump, 30) and **X** (real code, 39). Three delegated rulings logged (SQ-267 suite ownership, SQ-230 label retirement, SQ-82 genesis default) — ratification requested. **Next:** the B1–B6 ratification batches are the largest single unblock; then C (the contract is already at **v5**, so the next bump is **v6**); then X, led by the four release-manifest blockers (SQ-205 — still no production caller of `set_reserve_impaired`; SQ-263; SQ-261; the SQ-173/174/175/177/180/181/182 adoption-input family) and the self-locking liveness traps (SQ-215, SQ-235), with SQ-233 promoted by G1 as the named blocker for drill 08.

**G1 ✅ — Phase-1 exit reached 2026-07-20 (worktree `milestone-G1`, branch `feat/g1-phase1-drills`). The 09 §7.1 Phase-1 exit drill set passes end-to-end: 01/02/03/06 + compressed 09 6/6 (SQ-128) + 04 dead-man 18/18 + 05 coretime-under-dead-man 19/19. SQ-282 resolved (SDK-verified: the relay GRANDPA finalized head is not parachain-runtime-observable on stable2606 → 05 §4.6/§4.8, 13 §2, 14 TH-37 re-scoped to the observable relay-parent-gap trigger, detector code already correct; drills 04/05 re-pointed to a collator outage → relay-parent gap → engage); SQ-279/280/281 reconciled (PB-MIGRATION docs); spec-reviewer 0 blocker; no runtime-code change; docs gates green. Drills 07/08 + the `bleavit.env-evidence.v1` bundle re-scoped to their actual Phase-2/Phase-3/release-train gates (09 §7.1 lines 283/284) — not Phase-1. Carried forward: SQ-283 (off-chain relay-finality monitor, O5), SQ-284 (raw-`TreasuryState` polkadot-js decode quirk, tooling), SQ-233 (cross-milestone trigger feeds), drills 07/08 + evidence (G2/G3). Full detail in the G1 milestone row + the 2026-07-20 Decision log + Session log. Prior-session history below.** **Prior session (fast-timing 04 & 08)** (user: "Can we also use fast-runtime for 04 and 08? … I don't want to wait 3 days and also not 16 hours"): extended the default-off `fast-timing` feature (SQ-128) to two more kernel constants — **`DEAD_MAN_RELAY_BLOCKS` 4,800→48** (drill 04) and **`DESCRIPTOR_LEAD_TIME_BLOCKS` 43,200→12** (drill 08) — after an Explore coupling audit confirmed both compress in isolation (one production consumer each; no invariant/property/try-state/TLA/limit-coverage magnitude dependence). Release arms are byte-identical; `production_epoch_timing_floors_are_frozen` pins 4,800/43,200 and the `--verify` genesis check passed on the compressed wasm. **Drill 04's first-ever run compressed the finality stall ~16 h→~8 min** (it reached the 48-relay-block gap in ~8 min — timing proven) but `assert-dead-man engaged` **fails on a pre-existing detector/scenario mismatch (SQ-282), not timing**: `observe_dead_man` fires on a relay-**parent** jump between consecutive parachain blocks (an outage/catch-up signal), while the drill induces a relay-**finality** stall where the parachain keeps producing (05 §4.8 `F`-signal `[VERIFY]` — validation data exposes `relay_parent_number`, not the relay finalized head); drill 04 re-gated on SQ-282. **Drill 08**: the ~3-day D-14 lead wait is eliminated (the drill reads the live `descriptorLeadTime` metadata constant), leaving only its freeze/expedited genesis **staging (SQ-233)** as the blocker. **Prior 2026-07-20 session** (SQ-274 + #105 merge): Merging main (#105) cleared G1's last upstream dependency (G0). **(1) SQ-274 resolved** — no production `migrations.force_failure`/`retry` surface (R-7); the PB-MIGRATION drill stages the guard trigger `MigrationHalt = true` at genesis via a new benign `pallet-execution-guard` `migration_halt` field (defaults false; the drill spec stays PLAIN so the pinned zombienet schedules it — a raw storage-injected spec is not, the first-run finding), and **drill 06 passes 3/3**: `assert-halt` plus a guardian 5-of-7 recovery whose dispatching approval correctly **fails closed** with `Other` (the Migration playbook has no EmergencyPlaybook-safe call — distinct from the pre-SQ-274 `TriggerInactive`). **(2)** drill-07's stale `spec_version === 1` sentinel is retired (capability probe on the genesis Location-keyed USDC), but its first real run surfaced the pinned Paseo `asset-hub-paseo-runtime` trapping on its parachain-system inherent — a Paseo-CSG/system-runtime issue, re-gated with attribution. **(3)** drill-05's staged-renewal exit-form code landed (its funded `ops.coretime` line + treasury custody need genesis seeding via the unreachable `FutarchyTreasury` origin, and the run is g1-tier ~8 h dead-man — both named in the gate). A drill-spec-regeneration blocker (the merged B1b seat-bond genesis assert panicked because `development_genesis` funds only 4 of the 7 seeded guardians) was fixed by genesis-funding all seven bonds within the 08 §2.1 1B/150M/200M invariants. Orchestrated with **two parallel Codex authors** (disjoint scopes) + orchestrator integration/verification. SQ rulings under the decide-yourself delegation: SQ-274 resolved, SQ-275/276/277 ruled, SQ-278 raised. Node + runtime Wasm rebuilt; specs regenerated; execution-guard tests 51/0 incl. the new genesis test; env/js/bash/doc/table gates green. **G1 stays 🔨** — residuals to ✅: **SQ-282** (drill-04 dead-man detector/scenario mismatch — the drill-04 blocker now that its timing is proven), **drill-08 staging (SQ-233)**, drill-05 genesis seeding + run, drill-07 Asset Hub topology, evidence emission (SQ-202/SQ-204/SQ-203), the SQ-279/280/281 doc reconciliation. **Next:** the SQ-282 resolution (recommend either the collator-outage drill scenario, or a relay finalized-head detector input if the state proof exposes it), then drill-05/07/08 staging + evidence emission.

**G0 ✅ + S4 ✅ (2026-07-19, worktree `milestone-G0`, branch `feat/g0-phase0-exit-gate`) — Phase-0 exit PASSED; both milestones flipped.** The V-12 decoupled-δ recalibration (per-class `dec.delta` **0.0375/0.0375/0.060/0.090** — PARAM ×2.5, others ×1.5) over the sim-faithfulness fix (proposal effect-scale frozen + decoupled from `decision_delta`, making 15 §4.9's "calibrate δ" a real lever) + the 15 §4.9 profitable-exploit criterion drives every class's decidable-harm false-pass **< 1 %** (param 0.000 / trs 0.145 / code 0.135 / meta 0.563 %) with **0 profitable sub-3P exploits** and all four classes adopting; artifact `designation: published`, `--check` green; `check-phase0-exit.py` full clean-tree exit → **`phase0_exit: true`**. **Next:** ratify the V-12 Decision-log amendment + SQ-273 (1× vs 3× exit threshold); production PARAM adoption remains SQ-173-gated. Full detail in the S4/G0 milestone rows + newest Session/Decision logs. *Historical (superseded) SQ-231 mechanism-round context follows.* Criterion A is fully closed: all 14 corpus families carry true-equivalence Rust differential consumers (SQ-267), after a defect sweep fixed three real decide-path bugs (gate-veto ordering/bond slash, first-pass-Invalid free extension, `settlement_score` ulp — the last shared by the Python model at the ε corner). The SQ-231 contest-capital mechanism (04 §7a accumulator; step-5/step-9 grading over held capital with the gate-bearing `sec.flow_cap` ceiling, hard min ×7) is specified, implemented in the reference model, runtime (audit-scope-A treatment) and simulation, and fully re-calibrated (10,000 proposals): decidable-harm false-pass **PARAM 3.81 % / TREASURY 1.64 %, CODE/META 0.000 %** — the churn seam is closed, but **held-exposure self-certification survives (SQ-271)**: capital the attacker holds through the window is genuine contest capital at market-risk cost, not 3P; gate books (which CODE/META have and PARAM/TREASURY lack) catch exactly what the depth certificate cannot. Evidence machinery is complete and waiting: `bleavit.sim-calibration.v1` producer (consumer-proven), 10⁷ sweep corpus, all-green gate checker. SQ-232 resolved (Baseline at `dec.v_min.trs`); SQ-270 logs the 08 §5.3 P-scaled-seeding runtime gap. **Next (2026-07-19 completion drive, IN FLIGHT — see the newest Session-log row):** the prior "δ-calibration is a no-op" finding was testing the WRONG lever — raising `DELTA_FLOORS` rescales the sim population (harm ∝ δ), but the **decoupled** decision margin δ (the one that flows into `decide()`) is a genuine lever. This session implemented, under a user ruling: **(1)** a sim-faithfulness fix — the proposal true-effect magnitude is anchored to a frozen `EFFECT_SCALE` (byte-identical at the old calibration), DECOUPLED from `decision_delta`, so 15 §4.9's "calibrate δ" is no longer scale-invariant; **(2)** a **V-12 `dec.delta` recalibration** — per class 0.015/0.025/0.040/0.060 → **0.0375/0.0375/0.060/0.090** (13 §1 genesis; ×1.5 TREASURY/CODE/META, ×2.5 PARAM after the first full 10k left one profitable PARAM flip id=3568 on an unbacked SQ-173 prize; 0.005 kernel floor unchanged) that drives every class's decidable-harm false-pass < 1 % and makes the marginal-flip exploits (CODE-5996, PARAM id=3568) unprofitable; **(3)** a 15 §4.9 **profitable-exploit criterion** — the sub-3P/AttackCost̂ gate scores only flips with realized cost < prize, deep-pocket griefing (cost ≥ prize, δ-immune, TM-18-accepted) is a diagnostic. Verified green: reference-model (38 + vectors + doc-table), targeted Rust (constitution/epoch/treasury), all 7 sim test modules, limit-coverage, phase-gates. RUNNING: full 10k `run-calibration.py --full`, full Rust workspace gates, spec-review, 10⁷ sweep pre-generated. Then: confirm the artifact publishes (0 profitable exploits, per-class < 1 %) → commit → export `bleavit.sim-calibration.v1` → `check-phase0-exit.py` full exit → flip S4+G0 ✅. Liveness cost reported honestly: honest clearly-good adoption in the adversarial sim ~28 % → ~16 % (not the R1 reject-everything mode). **Neither milestone flips until the full 10k + G0 confirm.**

**B12 + B13 ✅ (2026-07-18, worktree `milestone-B12-13`) — coretime renewal funding activated and the 9 O5 telemetry seams closed, in one dual-milestone session under the user's explicit both-milestones directive.** B12: the SQ-245/SQ-246 rulings were made in-session under the user's decide-yourself delegation (Decision log ×2, ratification requested) and implemented end-to-end — ops-multisig quote authority as stored, `FutarchyTreasury`-rotatable treasury state (`note_coretime_quote`/`prune_coretime_quote`/`set_coretime_authority`, freeze-exempt noting/pruning, unset-fails-closed), DOT-planck quotes with inclusive-TTL freshness (`ops.ct_quote_ttl`), in-place supersession and expiry-only permissionless pruning, ceil-rounded USDC line debits of price + `ops.ct_fee_dot` at `ops.ct_dot_rate` (three new 13 §1 TREASURY keys, constitution-core rows + generated bounds suites + genesis fixture), and the `RenewalDispatch` swap from the fail-closed stub to `bleavit_xcm::coretime::XcmRenewalDispatcher` (fail-closed on unset renewal account, rollback-for-retry proven); registry `Treasury coretime obligations` unwired → dispatch-limit with a real marked 9th-quote rejection test; keeper plans execute-fresh/prune-expired. B13: the monitoring-only **`TelemetryApi`** (12 §6.3 amendment; explicitly non-02) implemented over audited state — per-book loss vs b·ln2 bound (loss-over-bound is *emitted*, never suppressed), unsealed mid-window coverage projection, per-component POL vs floor (SQ-266 ruling: `pol`/`baseline` labels, no cross-masking), ledger collateral drift via the single `collateral_totals()` L-2 bookkeeping now shared with try-state, migration-stall union incl. `Stuck` (SQ-265 ruling), the metadata-invisible storage-bound remainder, and numerics anomalies (cumulative metadata-resolved `ExtrinsicFailed` domain-rejection counter + `increase()` rule; anomalous-dust gauge) — all 9 seams live, coverage gate 20 rows/32 metrics with only O3's 3 seams left. Dual R-6 spec audits (B12 0/1/5, B13 0/2/4) drove one 10-item Codex remediation round (post-fix review 0/0/0); the B12 major resolved by deliberate 09 §4 freeze-scope truing + 08 §1.2 reserve-health carve-out (FRAME MBM lockdown makes the PB-MIGRATION leg unsatisfiable — Decision log). SQ-264…SQ-266 logged. Gates green on the final tree, orchestrator-verified. **Next:** ratify this session's four Decision-log amendments; SQ-256/SQ-259 02-bump batch; SQ-261 weight sweep; B1b residuals, S4 seam, or Track F.

**B10 ✅ (2026-07-18, worktree `milestone-B10`) — runtime wiring closure: every S3 `unwired`/`consumer_binding` exemption is cleared or honestly re-owned (full inventory in the B10 milestone row).** The 15 SQ-159 keys read live `Params` (genesis-default fallback, per-game schedule freeze), phase-3 caps are armed end-to-end (production transactor + barrier + trap/claim recovery + the 09 §6.2 exit + the ledger split gate), the dead-man detector raises the flag it always only consumed, the treasury obligation mirrors track the guard queue and the market lifecycle transactionally, `pol.budget_epoch` shrinks slates loudly (`SlotsShrunk` + T6 deferral), and `TwapCheckpoints` matches its spec shape. The one honest remainder — an authenticated coretime quote source (SQ-245/SQ-246) — is re-owned to the new **B12** row, keeping the S3 expiry ratchet armed. Dual review (3× spec-reviewer + adversarial Codex) drove 2 remediation rounds; the surviving cross-cutting risks are release-blocked (`oracle.bond_custody_absent` — SQ-263; `xcm.pallet_xcm_weights_placeholder` — SQ-261) rather than papered over. Gates green on the merged stable2606 tree. **Next:** the SQ-256/SQ-259 02-bump batch (joint sign-off), B12 rulings (SQ-268/269), B1b residuals, S4, or Track F.

**O5 ✅ (2026-07-18, worktree `milestone-O5`, branch `feat/o5-monitoring-alerting`) — the 12 §5.2/§6.3 monitoring/alerting layer: Prometheus + on-chain-event alerting + the out-of-band attestation monitor.** Codex-authored to a spec-first brief, orchestrator-verified. `deploy/monitoring/` carries the Prometheus/Alertmanager stack with one alert rule per 12 §6.3 row (all 20, verbatim spec thresholds, exact RB-* runbook labels, `severity: page` + release-integrity routing on the two page-immediately rows); `tools/monitoring/` carries the on-chain-event alerting exporter (frozen `FutarchyApi` `state_call` views, raw 168-byte `ReleaseChannel` decode, prefix counts vs metadata bounds, finalized guardian/upgrade events — per-family fail-closed: failures degrade to absent series, never healthy zeros), the 12 §5.2 attestation monitor (≥3 gateways, by-TXID and by-name fetches, byte-compare vs the signed `release.json` map, pure-stdlib RFC 8032/minisign verification incl. `revoked_key_bits` and keyring-generation triple-equality, ≥2 attestations, hourly + finalized-head triggers), and the spec-anchored `check_alert_coverage.py` gate (strict §6.3 two-table extractor, rule↔row↔inventory↔SERIES-registry binding, 12 declared seam series — 9 owned by B13 (re-owned from B10 at the B10↔O5 merge — B10 closed concurrently), 3 by O3 — with mechanical expiry once the owning milestone flips ✅, the S3 idiom). **Native spec-reviewer pre-✅ audit (0 blocker/2 major/5 minor) — all findings fixed in a Codex fix round and re-verified**; SQ-240…SQ-243 log the four surfaced spec ambiguities. Gates green (monitoring 59/59, coverage gate, deploy/release/ci/env suites, env validator, doc links, PLAN tables); no Rust touched. The frontend still ships no telemetry (12 §6.3). **Next:** O4 (runbooks-as-code — the RB-* documents these alerts reference), O1 (release train tooling — freezes the `release.json` schema the monitor consumes provisionally), or O3 (bootnode program — owns the 3 probe seam series).

**S4 🔨 (2026-07-18, worktree `milestone-S4`) — the 15 §4.9 agent-based economic simulation is built and its Phase-0 evidence committed; sim-gated publication parked on a surviving spec seam.** Full inventory in the S4 milestone row: executed-trade-ledger simulation (10,000 proposals, five doc-14 manipulator strategies at rational-attacker budgets, real Survival/Security gate books), Codex author → dual review (spec-reviewer 0/2/5 + adversarial 6/4) → F1–F10 remediation, deterministic Merkle-bound evidence artifact. Honest result: CODE/META δ floors confirmed (0.000 % decidable-harm false-pass); PARAM 3.46 % and TREASURY 1.52 % fail the < 1 % gate via executed TH-4 thin-capture flips at 0.76–0.90×3P — the SQ-231 seam (attack flow both satisfies step-5 grading and inflates step-9 `L̂`). `sec.prize.*`/`sec.flow_cap` stay candidates-only; the runtime keeps the conservative `None` prize default (PARAM/CODE/META hard-reject at step 9). **Next:** answer SQ-231/SQ-232, re-run calibration under the chosen mechanism, publish per the artifact eligibility gates (V-12); else B10 or Track F.
**O4 ✅ (2026-07-17, worktree `milestone-O4`) — runbooks-as-code shipped.** `deploy/runbooks/`: README + all 13 runbooks RB-KEEPER…RB-RELEASE from 12 §6.3's two alert tables, machine-readable frontmatter bound to the doc, R-7 status-quo-first remediation, the four 12 §6.4 incident playbooks inside RB-RELEASE, PB-MIGRATION's operational face in RB-UPGRADE, B9's real keeper metrics in RB-KEEPER — plus the gate: `tools/deploy/check-runbooks.py` (live §6.1/§6.3 parse, bidirectional binding, fail-loud on doc drift), 53 fixture tests, a `docs`-job CI step. Three parallel Codex authors → dual review (spec-reviewer 0/0/5 + adversarial Codex 2/5/5) → one fix round closing all 17 findings (re-review 0/0/0). SQ-235…SQ-239 logged — **SQ-235 matters beyond ops** (every `claim_assets` trap-recovery route is undispatchable in the shipped runtime: runtime classifier vs B4 library classifier vs empty `ExecuteXcmOrigin` converter). Gates green; Rust untouched. **Next:** user rulings on SQ-235…SQ-239; Track-O backlog O1/O2/O3/O5.

**B11 ✅ (2026-07-17, worktree `milestone-B11`, branch `chore/b11-stable2606-train-bump`) — the SDK release line moved `polkadot-stable2603-1` → `polkadot-stable2606` as one atomic unit (D-19; V-34), including the benchmark-execution repair.** 65 `=` pin sites re-sourced from the `polkadot-sdk 2606.0.0` umbrella map; `wasmtime` 36.0.12 closes **all 16 wasmtime advisories**; both waiver files re-triaged from scratch to exactly the 7 predicted survivors + the yamux GHSA entry, each re-proven pin-forced under its per-family exit criterion; vendored `core2` removed; API delta minimal with **zero new SDK call variants**; deprecated `StorageWeightReclaim` retained deliberately (SQ-228). Round B restored benchmark-only B5 seams and cross-pallet worst-case fixtures after the stable2606 execution smoke exposed 49 failures; the exact CI command now executes **311/311 with 0 failures** (312 registered minus the pre-existing inapplicable assets migration exclusion), with no new exclusions and no production behavior changes. The Round-B delta then passed a **native spec-reviewer delta audit (0 blocker/1 major/2 minor)** and all three findings were fixed in-session: the guardian trigger-reader's bench arm now performs production's four storage reads before forcing the trigger bits (DB-op parity for future weight regens — the major), the bench no-op stubs carry FIXME-owner marks (SQ-205/B10 renewal, guardian downstream-effects — the latter labelled "SQ-144-effects" at the time, retired under the SQ-230 ruling and closed by B1b/SQ-143), and the oracle bond fixture moved strictly above the floor knee (500,000 USDC) with an honest comment; SQ-229 (`UndecidingTimeout` spec home) + SQ-230 (SQ-144 label collision) logged. **Gates green on the final tree, orchestrator-verified independently of the author runs:** `rust-workspace-gates.sh` end-to-end ×2 on the finished bytes (70 suites, 1122 passed/0 failed) · the exact CI benchmark-smoke on the final artifact (**311 executed/0 failed**; codex's pre-fix artifact independently re-validated 311/0 as well) · supply-chain (7-ignore bijection · keeper exception-free · GHSA leg 1 waived/0 stale) · fuzz (3 targets, corpus regression, smokes 0 crashes) · all Python tooling + env validator · doc links · PLAN tables. SQ-135 stays open. **Next:** squash into the single atomic commit → PR; then ratify SQ-135/SQ-219 + assign SQ-228/SQ-229/SQ-230 homes; B10, B1b residuals, S4, or Track F.

**S2 ✅ (2026-07-17, worktree `milestone-S2`) — cargo-fuzz targets per 15 §4.5 (full inventory in the S2 milestone row).** `fuzz/` is a separate nightly-pinned cargo workspace (root `exclude` extended, keeper precedent) with three invariant-asserting libFuzzer targets: `payload_scale_decode` (raw + structured `Payload` generation, guard bound/hash invariants), `nested_wrapper_filter` (I-8/I-10/I-11 — differential vs an ordered oracle **and** an independent property predicate + a hand truth-table, both origin paths; discharges the A4-deferred fuzz obligation), and `lmsr_trade_paths` (I-12 `drain ≤ ceil(b·ln2)` over real market-core trades). Curated corpora + `tools/ci/fuzz-gates.sh` (CI job `fuzz`, smoke writes to a git-ignored dir). **A real guard blocker was surfaced by the decode-fuzz lens and fixed** (both reviewers): `decode_batch` had an unbounded-recursion preimage decode (audit-scope-A, G-1/R-7) — hardened with kernel `MAX_PAYLOAD_DECODE_DEPTH` + `decode_all_with_depth_limit` + a runtime regression (SQ-225). A fuzz-found harness bug (fail-closed-trade tolerance) was fixed with a regression seed+test. Author run via Codex hit the standing "fuzz/cybersecurity" moderation false-positive after applying a partial skeleton; the orchestrator completed authoring, the dual review (spec-reviewer + adversarial), and all remediation directly (a delegated harness-strengthening subagent's oracle-independence/payload-generator/bound work was taken over by hand; its later Gate/Baseline coverage additions were re-gated and integrated). Gates green (root workspace incl. runtime 60 + guard 42 · fuzz fmt/clippy/10 tests + 3 targets build + corpus regression + 90s smoke ×3 with 0 crashes · reference-model 21 · doc links). SQ-225…SQ-227 logged; R-1/R-7 decision-log entry for the kernel-constant hardening. **Next:** S1 (TLA⁺/Quint — deps A2/A8 ✅), S3 (generated limit-coverage, deps A1/B1 ✅), S5 (filter-exhaustiveness over `RuntimeCall`, dep B1 ✅), or the standing A8/A11 runtime-wiring follow-up; S4 awaits M3-sim/S-track economics.

**B2 ✅ (2026-07-17, worktree `milestone-B2-completion`).** The `FutarchyApi` is live: all **11 methods implemented** in `impl_runtime_apis!` over `runtime/bleavit-runtime/src/views.rs` (epoch-backed ones on the merged B1b wiring), and the queued **02 amendment batch landed as contract v4** (SQ-2 residuals, SQ-37, SQ-43, SQ-55, SQ-125, SQ-138 + `ParamRecord.last_change_block`) with 15 metadata constants wired — the release manifest's 17 B2 readiness gaps are closed and its api/epoch entries are unblocked. Dual review (spec-reviewer 0/6/7 + adversarial Codex 3 blocker/5 major) found what the gates could not, and **every in-scope finding is fixed**: two contract surfaces contradicting each other on ratification, `welfare_current` reading a snapshot the chain can never write (always zeros, breach flags false), `quote` approving trades `buy` rejects, an R-7 `max_delta` overstatement, and 11 v4-frozen surfaces missing from the manifest. Residuals are logged SQ-205…SQ-218. **A real tag release still fails closed by design** — now on B7 evidence, SQ-101, the B1b compliance row, and **SQ-205** (the oracle→treasury reserve-health seam `set_reserve_impaired`'s own comment claims B1a wired: 08 §1.2's fail-static NAV is unenforced; B2 deliberately did not paper over it in the view). **Next:** SQ-205 is the highest-value follow-up (release-blocking, solvency-relevant); then the SQ-206…SQ-218 contract decisions, several of which want a single 02 bump.

**B1b ✅ (2026-07-17, worktree `milestone-B1b`) — the milestone is complete; the three blockers are implemented.** **SQ-172/SQ-183**: the canonical `RuntimeCall`→`[u8;8]` resource-key mapping is defined normatively (new 05 §1.4 — family-tag byte + truncated `blake2_256`, `batch_all`-only recursion, collision-domain analysis) and implemented: set-equality screening with the exact T4 refund-vs-slash taxonomy, real lock acquisition, and a zero-collision CI test — production payloads can finally qualify. **SQ-178/SQ-189**: the 06 §2.1 six-track table is live (runtime-internal `track_origins` at index 64; bare CV rides the entrenched track; per-scope EnsureOrigin adapters; the constitution↔entrenched key-class scope enforced after the adversarial review caught the escalation), guardian seat bonds are real `SeatBond` fungible holds with try-state, the review flow fronts **both** referendum deposits pro-rata through the guardian sovereign — fixing a latent bug where reviews could never reach deciding and every honest council would have been slashed — and `guardian.recall` (vacancy semantics, absolute 5-of-7) plus `guardian.uphold_veto` (T24's single producer; `epoch.veto_upheld` demoted to internal) complete the accountability loop. **SQ-176**: all five guardian powers dispatch real effects — epoch intake pause, guard gate suspension (epoch-bound, auto-releasing), and the six kernel-enumerated 06 §6.2 playbook routines producing the `EmergencyPlaybook` origin over new expiry-bounded market/ledger freeze endpoints (R-7 treatment; kernel 14-day windows; one LedgerFreeze renewal). Orchestrated with **Codex subagents (xhigh)**: three authors (one isolated worktree; transient capacity failures auto-resumed) → full-gate verification → adversarial Codex review (**7 P1/3 P2; 8 fixed with mutation-checked regressions** — among them the constitution→entrenched track escalation, a PB-RESERVE market-buy bypass, an unbounded screening decode, a duplicate-declaration lock wedge, an uphold-vs-open-review rollback and a concurrent-review slash rollback — 2 honest residuals logged SQ-233/SQ-234); the native spec pass ran in-loop (subagent credits exhausted mid-session) over the track table, fund flows and encoding. **Merged onto post-B11 stable2606 main in-session** (3 semantic conflicts composed). Gates green (V-35). The four spec amendments (`14d2eee`) await user ratification (Decision log). A real tag release still fails closed on B7 evidence, SQ-205 and the remaining adoption-input SQs (SQ-173…SQ-175, SQ-177, SQ-180…SQ-182) — the manifest's b1b.compliance row was narrowed accordingly.

**S1 ✅ (2026-07-17, worktree `milestone-S1`) — Track S opens with the systemic-verification layer live.** The 15 §4.1 TLA⁺ models (ledger + T1–T24 proposal machine, both TLC-exhaustive with anti-vacuity floors, reachability witnesses and constant-controlled mutation configs that must violate), the full 03 §11 PT-1…PT-8 property suites at the normative ≥10⁶ cases plus the I-12/I-13/I-6/I-7 suites, and the ledger↔Python differential (64 op-sequence scenarios + sweep/score/error families, schema v4) — see the S1 milestone row for the full inventory. The honest suites found and fixed **five production defect families**: stale terminal supply decrements in the ledger core, amount-sized (instead of payout-sized) sell merges that failed legal trades, a TWAP lower clamp below the exact (1−κ)^k envelope, zero-sized ledger legs tripping legal zero-payout trades, and a Python Voided-liability under-valuation. Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: 4 parallel authors → dual review (spec-reviewer 0/1/5 + adversarial **5 blockers/12 majors**, two contested blockers adjudicated by direct model inspection) → 4 fix agents + orchestrator surgery (fingerprint-view partition after a 315M-state explosion, witness harness, TLC `-metadir`) → focused re-pass 19/20 FIXED with its 5 residuals fixed in-session. I-27 amended per R-1 (sweeps in Voided post-archive-delay); SQ-161…SQ-171; V-30. All gates green on final code (workspace 67 · model gate 7+16 · property 10⁶ in 50m local · reference-model · env · deploy · doc links). **Next:** wire A8 `pallet-epoch` (slot 61) or B5 (weights/PoV) / B8 (publication pipeline — also owns the CI-cadence call for the two new heavy jobs); S2 (fuzz) and S3 (limit-coverage) are now unblocked-adjacent on this track.


**S3 ✅ (2026-07-17, worktree `milestone-S3`) — the 15 §4.6 generated limit-coverage suite is the new CI gate (I-22's CI half).** `tools/limit-coverage/`: a strict, drift-alarming extractor over 13's three registry tables (§1 keys with full rule-6 ParamKey semantics, §2 kernel constants incl. per-bound expansion of every multi-limit row, §4 storage bounds) + an exhaustive checked-in classification manifest (`registry.toml`, **175 keys** as S3 shipped it: 59 dispatch-limit / 72 param-bounds / 36 value / 1 diagnostic / 7 unwired — **current tree: 179 keys, 67 / 75 / 36 / 1 / 0 unwired over 98 seeded records**, B10 and B12 having since cleared the whole exemption class; figures below are S3-historical) + a coverage checker (23 unit tests) that fails CI on any unmatched, misclassified, unowned, or untested key. Coverage binding: `// limit-coverage:` markers on 45+ tests (each dispatch-limit key lexically pinned to its specific Module error or — where the spec enforces by clamp/no-op/latch/eviction — its specified `behavior` token, `#[ignore]` rejected), a **generated per-key amendment-bounds suite** iterating all 95 genesis-seeded Params records (hard min/max ±1, max-Δ+1, cooldown, kernel-bounded `amend_registry` refusal — the 35-record kernel-bounded set verified equal to 13 rule 7 both directions), the committed `genesis-keys.json` fixture byte-asserted against `constitution_core::genesis_params()`, and a real-runtime `UncheckedExtrinsic` admission test for `orc.max_proof_bytes`. Honesty machinery: 7 `unwired` keys (`pol.budget_epoch`, 3 treasury sync bounds, `TwapCheckpoints` — a surfaced pre-existing A3/A5 gap, both phase-3 caps behind `AssetTransactor = ()`) + 15 `consumer_binding = "kernel-constant"` keys are printed on **every** checker run, owner-validated against PLAN.md milestone IDs, and **mechanically expire** (the checker fails once the owner milestone flips ✅) — all owned by the new **B10** wiring-closure milestone. Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: author → dual review (spec-reviewer 0/1/2 + adversarial 2/7/2) → remediation (11 dispositions, 2 honest adjustments) → focused re-pass (**0 blockers/1 major/0 minors** — all dispositions verified landed; the residual grouped-key split fixed by hand with per-bound keys). Gates green (workspace · runtime + try-runtime suites · wasm legs · no_std · keeper 34 · reference-model 21 · limit-coverage 175 · doc links). SQ-155…SQ-160 logged (renumbered around main's concurrent B8/B5 batch at merge). **Merged onto post-B5/B8 main in-session** — B5's groundwork landed the A8/A11 runtime wiring (epoch at index 61), so the manifest's TickBatch/epoch wording was re-trued at merge; the full gate script re-ran green on the merged tree. **Next:** B10 (wiring closure — re-arms the unwired/consumer-binding keys), the remaining Track-S rows (S1/S2/S4/S5), or Track F.
**S5 ✅ (2026-07-17, worktree `milestone-S5`).** The 06 §3.3/15 §1 verification layer is live in the runtime test suite (tests-only; production and `docs/architecture/` untouched): a hand-pinned **256-row metadata inventory** (242 at first review; +14 `Epoch` rows on the A8 merge) over the real `RuntimeCall` with bidirectional new-call/stale-row tripwires (a new pallet, call, or call-carrying variant without a deliberate row fails CI — the 06 §3.3 mandate), carrier detection that traverses **both** `TypeDef` fields and generic `type_params` plus a name-based opaque-carrier detector (`DoubleEncoded`/`VersionedXcm`) — **21 carriers pinned**: 19 typed wrapper rows (20 wrapper-set rows incl. the hash-only `approve_as_multi` negative control, now also proven at real dispatch: approval dispatches nothing, the call-carrying terminal `as_multi` is the recursed one) + 2 semantic carriers (`referenda.submit` via `Bounded<RuntimeCall>` — Public by design, enactment re-enters the filter per 06 §3.4; `pallet_xcm.execute` — nobody). Active suites: the **full origin-aware authority matrix** (`contains_for(origin, leaf) == (origin == matching origin)` for every privileged/conditional row × all 8 class origins — compile-time-exhaustive origin universe — and per-wrapper spec treatment: same-origin-only recursion through utility batch/`with_weight`/sudo per 06 §3.3's recursion rows, categorical privileged-inner denial for proxy/multisig, outright denial for `dispatch_as`/`as_derivative`/`if_else`/`dispatch_as_fallible`/scheduler/`sudo_as`), nobody×wrapper×composition matrices with `WrapperShape`-keyed constructor closure asserted against the inventory, kernel-exact nesting/count boundaries, real-dispatch `CallFiltered` negatives, values-enactment set equality derived **from the inventory** (not the predicate under test), and the I-8 disjointness proof. **19 S5 tests: 15 active, 4 ignored regressions** pinning the two real findings — the `amend_registry` dual-scope I-8 crossing (SQ-150, a **contested three-way spec contradiction**: 06 §2.1 authorizes CV amendment within meta-bounds; 06 §3.2's exclusive columns + 13 rule 7 read against) and the unreachable `ForeignAssets.create` values path (SQ-151, genuine fail-closed reachability defect). Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: author → dual review (spec-reviewer 1/2/4 — the blocker + 1 major being the pre-existing production defects S5 correctly pinned — + adversarial Codex **2 blockers/4 majors/1 minor**, incl. the carrier type-param hole and the then-inactive origin matrix) → remediation round (every finding fixed or adjudicated; the one wrong-criterion ignored test deleted — SQ-152 resolved by both reviewers' spec reading in favor of current production behavior, pinned active) → internal re-review 0/0/0 + orchestrator spot-verification. Gates green (fmt · runtime clippy `-D warnings` · runtime 74 passed/4 ignored · full workspace script). SQ-150…SQ-154 logged. **Next:** resolve SQ-150/SQ-151 in a production/spec milestone after user rulings; A8 runtime wiring, B5, B8 remain the dependency-ready backlog.

**SQ-101 ✅ (2026-07-17, worktree `SQ-101`).** The 02 §7.4/§8 X-11a contract violation is resolved: runtime `ForeignAssets` is keyed by XCM v5 `Location`, the canonical USDC constructor is single-homed in `bleavit-xcm` (`usdc_location()` = `asset_hub_asset_location(USDC_ASSET_INDEX)`; benchmark helpers reuse the parametric form), genesis/fees/rebates/benchmarks use that key, and the release manifest plus Chopsticks fixture now carry the frozen Location-keyed surface. The exact 10-byte SCALE identity and Asset/Metadata raw keys are regression-pinned. Dual review: Codex self-review clean + native spec-reviewer **0 blocker/0 major/1 minor** (a third inline Location construction site in the benchmark helper — fixed by the parametric constructor). Verified end-to-end: full workspace gates ×2 (incl. release/benchmarks wasm + no_std); all tooling suites; regenerated dev/local chain specs pass the deploy validators with the Location-keyed genesis; **real-node recorder e2e: all three SQ-101 surface rows RECORDED** (frozen layout matches live metadata; exact-key reads decode decimals 6 / min_balance 10⁴), recorded surface 89→99 (pre-B5 base; every remaining gap then attributed to B2/A8/A11 — B5's A8/A11 wiring landed concurrently and owns shrinking those). No protocol pallet or XCM-executor wiring changed. Older SQ-101 blocker/readiness-gap prose below records its pre-fix milestone state and is superseded by this resolution.

**B5 ✅ (2026-07-17).** The 15 §4.5 benchmark/weight/PoV regime is live end-to-end. **Groundwork:** the B1a-declared A8/A11 runtime wiring landed first (next paragraph) — without it "every call and hook" was unmeasurable. **Benchmarks:** `define_benchmarks!` covers all 12 futarchy pallets (both registry instances) + the standard/Cumulus set; the `Benchmark` runtime API is real; all **121** initially-failing runtime benchmarks were repaired **benchmark-only** (bench origins, `BenchmarkHelper` seams, worst-case fixtures; zero pallets dropped; 312 benchmarks execute). **Weights:** `frame-omni-bencher` (50 steps × 20 repeats) generated weights for 30 pallets into `runtime/…/weights/`, wired into every runtime `Config` (documented exceptions: `pallet_xcm` = `TestWeightInfo` until the B4 runtime integration; tx-payment pallets have no dispatchables; `pallet_vesting` weights ride upstream `SubstrateWeight` until the next regeneration sweep). **PoV (the review's big catch):** `Preimage::PreimageFor`'s 4 MiB `MaxEncodedLen` made `decide`/`tick`/`execute` estimate ~4.2 MiB/call — AND the fetch seam was genuinely exploitable to force a 4 MiB PoV read (fetch-then-validate). Fixed at both layers: the guard/epoch preimage seam now fetches by `(hash, recorded_len)` with the 64 KiB kernel cap enforced at record time on both paths (a mismatch rejects **without** the read; epoch `submit` gained the missing cap → `BadProposalShape`), and `pov_mode = Measured` overrides are justified on exactly those three benchmarks (tick fixtures carry **distinct** 64 KiB payloads per item — honest slope 68,329 B/item, tick(10) ≈ 846 KiB); `execute` now **pre-charges** `prop.max_weight` + overhead (2.83 MiB proof ceiling) and refunds actuals via `DispatchResultWithPostInfo`. The 06 §4 **qualification-time preimage pin** shipped too (SQ-140 resolved): pin at T5, release at every pre-queue terminal, atomic T9 handoff to A11. **PoV budgets:** `pov_budgets.rs` recomputes 13 §5 items 1/2/7 from measured `MaxEncodedLen` (MarketBook **189 B**, VaultInfo **160 B**, CohortSummary **81 B** — the three `[VERIFY]` tags resolved in 13 §5, Verification log), asserts all 94 futarchy WeightInfo fns at worst args fit the normal class (75 % × (2 s, 10 MiB)), and pins `decide`/`settle_cohort` proof ceilings. **Weight-regression CI (15 §4.5):** deterministic diff gate on committed weight files — full-expression parser (split ref/proof `from_parts`, db read/write counts, component slopes), the >10 % rule applied to **worst-case totals** at component maxima, removals require acks, main-push falls back to `HEAD~1`, 16 self-tests; CI jobs `weights` + `benchmark-smoke` (pinned omni-bencher 0.15.0, wasm32v1-none). **Dual review:** spec-reviewer (0 blocker/3 major/7 minor) + adversarial Codex (4 blocker/3 major/4 minor) — every actionable finding fixed in-session with regressions; the one non-actionable major is the pre-existing SQ-93 apply-surface conflict (now extended with the 09 §2.2 ↔ 11 §11.8.4/S17 FE-workflow evidence; user/joint sign-off required). **Merged onto post-B2/B3/B4/B7/B9 main in-session** (SQ-140…SQ-146 renumbered to clear the concurrent audits; keeper rebates composed with the pre-charge/refund execute and the pinning tick). New SQ-147…SQ-149; `keeper.rebate`'s fee basis (SQ-117) is now derivable from the generated weights but stays a user-gated 13 §1 edit. **Next: B6** (upgrade path e2e) is the only remaining ⬜ B-milestone before B8.

**B1a A8/A11 follow-up complete (2026-07-16).** The production runtime now includes `pallet-epoch = 61` and `pallet-execution-guard = 62`, real epoch/guard sovereign origins, the live epoch clock across constitution/welfare/oracle/registry/treasury/guardian, the A8↔A11 enqueue/dequeue handoff, live 2-of-N attestor quorum checks, and a concrete class-origin dispatcher that re-applies the closed SafetyFilter and rejects best-effort `utility.batch`/`force_batch` (SQ-96). Remaining unavailable sources are explicitly G-1 fail-closed and logged as SQ-140…SQ-146. This paragraph supersedes the pending-state snapshot in the historical B1a paragraph immediately below. **Next: B5 can proceed; B4 still owns SQ-101 and the external reserve/inflow probes.**
**B8 ✅ (2026-07-17, worktree `milestone-B8`).** The release-artifact publication pipeline (backend row E15) exists end-to-end: `.github/workflows/release.yml` (tag-triggered; dry-run dispatch mode; supply-chain + workspace + tooling gates → artifact build → strict content-addressed assembly → atomic draft→upload→verify→publish as **prerelease pending operator Arweave mirror evidence**) over `tools/release/` (reproducible-recipe wasm build; booted-node metadata extraction with fail-closed `:code`↔wasm binding; a 156-entry critical-surface manifest across 02 §3/§6–§9/§12 with frozen layout expectations on wired surface, a metadata-independent raw `ReleaseChannel` fixture, and exact-key 02 §8 USDC value assertions; a deterministic chainHead recorder; an assembler enforcing the 15 §5 artifact set (1)–(5) with the new `bleavit.env-evidence.v1` contract B7 must satisfy and wasm/metadata/spec/commit corruption checks that fail even dry-runs). The two B8-owned inheritances landed with it: the **≥10⁷-point release sweep** (single-generator `--sweep-out` mode, exp2/log2/ln/cost; verified full run worst case log2 0/ln 1/cost 2 ulp, V-26; release-gated + `sweep.yml` kernel-change CI) and the **15 §4.5 supply-chain gates** (pinned cargo-audit per-commit job; annotated pin-forced `.cargo/audit.toml` disclosed in every release manifest, SQ-135). **A real tag release today fails strict assembly by design** — every gap attributed to its owner (B2 API/constants, A8/A11 wiring, B7 env evidence, SQ-101 Location-keyed USDC). Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: 2 parallel authors → dual review (spec-reviewer 0/4/3 + adversarial Codex 11) → 1 Codex fix round (16 items) → focused re-review (12 residuals) → **manual orchestrator fix round** (Codex usage limit hit; 11 fixed + 1 documented non-fix). SQ-135…SQ-139 logged. Gates green (workspace ×3 · 10⁷ sweep ×2 · 75 tooling unittests · real-node e2e dry-run). **Next:** B1a A8/A11 wiring (largest readiness-gap owner), B2 `FutarchyApi` impl, B7 (envs + evidence producer), B5; SQ-135/128/131 await user ratification.

**B6 ✅ (2026-07-17, worktree `milestone-B6`) — the upgrade path is live end-to-end in the real runtime.** `ExecutionGuard` wired at frozen index 62 (see the B6 milestone row for the full inventory): the two-phase 09 §2.1 flow runs through real dispatch — internal Root reaches exactly the one committed `system.authorize_upgrade(hash)` (I-10), the SafetyFilter's DescriptorLeadTime gate reads real `PendingUpgrade` state behind a five-condition Cumulus preflight (a doomed apply can never consume the frame-system authorization, V-25), the attestor 2-of-N quorum and the live capability table gate execute, ReleaseChannel writer (a) writes the frozen 02 §12 bytes (offsets single-homed in `constitution-core`), and the e2e tests drive the REAL `ParachainSystem::set_validation_data` inherent with sproof-built relay `GoAhead`/`Abort` signals. Two protocol edges were closed under G-1 and logged for ratification: relay-**Abort** status-quo cleanup (SQ-131) and the PB-MIGRATION machine-trigger bridge (failed-step + `>900`-block stall detector; source-scoped halt clearing; SQ-132). Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: author → dual review (spec-reviewer 0/1/6 + adversarial 2/6/2) → remediation → focused re-pass → remediation 2 → final verify (0 blockers; its 2 majors + 1 minor fixed by hand with regressions). Gates green (workspace · runtime 57 + try-runtime 59 · wasm legs · reference-model 21 · doc links). SQ-131…SQ-134 + SQ-104 extension logged; R-1 amendments to 06 §3.2 (guard-call matrix rows) and 13 (migration single-homing). **Next:** wire A8 `pallet-epoch` (reserved index 61, swaps the fail-closed `EnqueueAuthority`/`EpochHandoff` seams and completes I-9 enqueue), then B5 (weights/PoV) / B7 (zombienet — now also owed the snapshot try-runtime leg and the real-MBM failure drill).

**B7 ✅ (2026-07-17, worktree `milestone-B7`).** The 15 §4.7 / 02 §11 environment definitions shipped as release artifacts (see the B7 milestone row for the full inventory): `zombienet/` (two topologies over generated `paseo-local` relay specs, nine drills + js helpers covering the whole 09 §7.1 Phase-1/2 drill set with block-measured — never wall-clock — thresholds and loud gating on the unwired A8/A11/B6/B9 surfaces), `chopsticks/` (base + 10 forked-state scenarios: every upgrade path and all six 06 §6.2 playbooks, every injected cell byte-verified against the real pallets — 123/123 on the re-pass), and `tools/env/` (six-pin provenance home incl. the paseo chain-spec-generator repinned to v1.9.2 tag+commit after the adversarial review proved it absent from v2.4.1, fetch/generate scripts with digest/commit hard-fails, structural validator + CI job). Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: author → dual review (spec-reviewer 1/6/5 + adversarial Codex **6 blockers/11 majors**) → remediation round → focused re-pass **0 blocker/0 major** (4 residuals fixed directly). V-21…V-24 verified; SQ-127…SQ-130 logged. Gates green (env validator + 10 tests · deploy 16 · doc links · shell/js syntax · fmt; Rust workspace untouched). **Next:** B5 or B6 (both ⬜ on B1a ✅); B8 (publication pipeline) now has both of its B7 inputs; the A8/A11 runtime wiring remains the standing B1a follow-up that unlocks the gated drill assertions.

**B9 ✅ (2026-07-16, worktree `milestone-B9`).** The keeper layer exists on both sides of the chain boundary (full inventory in the B9 milestone row). On-chain: the 08 §6.3 keeper meter (two tranches, latch-once alarms + post-exhaustion payment latch, per-epoch reset) resolving SQ-49, the frame-free `KeeperRebateSink` seam, and strictly state-advancing rebate call sites in **every** crank pallet — both reviews' drain vectors (welfare daily-gate re-records, registry file→refund→close farming, paid no-op probes under the pending `()` dispatcher) are closed with regression tests, and the 07 §4 `ack_observed` keeper-class rebate is live. Real USDC payouts ride a narrow `RebatePayout` seam from the `KEEPER__`/`ORACLE__` pots with a try-state custody-drift alarm; everything is fail-soft (a rebate can never affect its crank) and pays 0 until `keeper.rebate` is calibrated (SQ-117, B5). Off-chain: `keeper/bleavit-keeper`, a separate-workspace subxt-dynamic reference keeper — pure tested planner (due-predicates mirror the on-chain guards; absent pallets degrade to disabled roles), race-tolerant nonce-pipelined submitter, 12 §6.3-aligned Prometheus metrics, dry-run, signer-required live mode, operator README. Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: 2 parallel authors → triple review (2× spec-reviewer + adversarial Codex, 2 blockers/7 majors/11 minors combined) → 2 fix rounds + 1 surgical revert (the off-chain review's one major was wrong at the pallet layer — A6's deliberate `FilingCount` guard makes zero-filing epochs unclosable; the keeper must not plan them) → re-review 0/0. SQ-115…SQ-126 logged. Gates green (workspace + keeper workspace + benchmarks/try-runtime legs + no_std + reference-model + doc links). **Next:** the open B1a A8/A11 runtime wiring (binds `InDecisionWindow`, the meter's epoch clock and the epoch/guard rebate seams), B5 (weights incl. registry `WeightInfo=()` + `keeper.rebate` calibration), B6/B7.

**B4 ✅ (2026-07-16, worktree `milestone-B4`).** The XCM layer shipped as `runtime/bleavit-xcm`, a runtime-independent library crate B1a wires (see the B4 milestone row for the full inventory): the 09 §6.1 default-deny rule-table components, the 07 §8 probe with querier authentication + query-id partition + refund-capturing appendix, the 09 §4 coretime funding leg on the **verified relay-teleport route** (V-19 — the spec's reserve-transfer wording would have failed `UntrustedReserveLocation` against the live Coretime config; 09 §4/§6.1 amended), mint-leg-first 09 §5.2 caps, the `pallet_xcm` call classifier (exit pinned to AH; `claim_assets` self-scoped per the amended trapped-assets row), and two new xcm-free seams in `pallet-oracle`/`pallet-futarchy-treasury` (`ProbeDispatch`/`RenewalDispatch`) with ready dispatcher impls — closing the dual review's "the pass paths are unreachable by assembly alone" majors. Orchestrated with **Codex subagents (gpt-5.6-sol/xhigh)**: author → dual review (spec-reviewer 0/3/5 + adversarial Codex **7 blockers/5 majors**) → one remediation round → focused re-pass **all CLOSED, 0 blocker/0 major** (its 4 minors also fixed). V-3/V-6/V-16…V-19 verified; SQ-110…SQ-114 logged; four R-1 doc amendments in the Decision log. Gates green (bleavit-xcm 33 · oracle 75 · treasury 28 · full workspace script · no_std · benchmarks/try-runtime legs · I-24 lint · reference-model 21 · doc links). **Merged onto post-B1a/B2/B3 main in-session** (see the follow-up session-log row): the runtime now wires the two B4 seams, and the PR-review P1s on the renewal leg are fixed. Remaining seam bindings (Params-backed `TraderRates` — needs new 13 keys first, SQ-112 — caps meters SQ-110/SQ-111, health→welfare SQ-113) stayed follow-ups → **closed 2026-07-17 by the B4-residual session** (next paragraph).

**B4 residual bindings (2026-07-17, worktree `B4-residual`) — Author A scope complete.** SQ-110/SQ-111/SQ-112 are now code-backed: the four governed XCM-rate rows are seeded in `constitution-core`; the runtime's `GovernedWeightTrader` reads them live from `Params`; and `pallet-inflow-caps` at index 63 owns the Phase-3 per-account meter plus the total-local-USDC-issuance admission adapter. `AssetTransactor = ()` deliberately remains fail-closed until SQ-101's Location-keyed `ForeignAssets` re-key, after which the ready `PhaseInflowCaps` adapter can be composed into `CappedInflows`. The parallel Author B health/welfare/treasury scope and the integration review remain part of this same residual session.

**B4-residual ✅ (2026-07-17, worktree `B4-residual`).** The four B4 seam residuals are bound in the runtime: **SQ-112** — 13 §1 gained the four governed trader-rate keys and `GovernedWeightTrader<ConstitutionTraderRates, ()>` is live in the XcmConfig (revenue-drop documented; routing lands with SQ-101); **SQ-110/111** — 09 §5.2 re-based to total local USDC issuance, new state-only `pallet-inflow-caps` (index 63) owns the per-account meter + issuance admission with try-state (global + per-account legs), `PhaseInflowCaps` ready for the SQ-101 `CappedInflows` composition (`AssetTransactor` stays `()` until then); **SQ-113** — 09 §6.4 `[VERIFY]` closed, welfare `XcmTraffic` per-epoch double map (bounded 21-epoch window, prefix reaping wired to cohort reap + epoch roll via the new epoch↔welfare prune seam), `HealthTrackingRouter` wraps both router slots, oracle `ProbeTimeoutSink` fires at the timeout fold, `MetricInputs` emits **X only** (canonical v1 `MetricId` table in 05 §4.3 + 13 §3.4 + `futarchy_primitives::metric_ids`; R deliberately unbound — SQ-195); **SQ-123** — 08 §1.4 custody sync: `fund_budget_line` atomically moves real USDC MAIN→KEEPER/ORACLE pot (`PotFunding` seam, `Preservation::Expendable`, rollback on failure; drift alarm retained as backstop). **Merged onto post-A8/A11+B5 main in-session** (live epoch clock drives epoch/day attribution; weight-regression gate green, 305 shared fns). Orchestrated with **Codex subagents (xhigh)**: 2 parallel authors → integration round → dual review (spec-reviewer 0/0/6 + adversarial Codex 2 blockers/6 majors) → merge+fix round → focused re-pass (1 new blocker: the welfare prune-cutoff settlement deadlock — fixed + regression-tested; 3 minors fixed). SQ-195…SQ-201 raised; five R-1 amendments in the Decision log. Follow-ups: SQ-101 re-key composes the ready transactor/trader-revenue/probe-dispatch paths; B5-recal measures the new runtime-boundary costs; A8's v1 spec registration must exclude R (SQ-195).

**B3 ✅ (2026-07-16) — the chain boots.** `node/bleavit-node` (thin `polkadot-omni-node-lib =0.14.1` branding — the runtime rides the chain spec, 02 §11) + the `deploy/` chain-spec pipeline (pinned `chain-spec-builder 17.0.0`; structural validator enforcing the 02 §8 identity, the 02 §10 distinct-peer bootnode thresholds and the full 08 §2.1 genesis-allocation gate) + genesis presets carrying the exact five-group 1B-VIT allocation with `pallet-vesting =46.0.0` founding-team schedules (conservative 0%-at-cliff curve; index 14; D-13 force_* nobody rows). The previously-unbuildable node dependency closure was unblocked by vendoring the fully-yanked `core2 0.4.0` (`[patch.crates-io]`, V-15) + the stable2603-1 maintenance pins. **End-to-end verified: a dev node imports blocks from a freshly generated spec.** Dual review (spec-reviewer + Codex adversarial) — all majors/highs fixed in-session, most notably the deliberate **removal** of a bespoke fee-past-the-vesting-lock adapter (strict "unvested VIT pays no fees" ruling; USDC fee path per 08 §9) and the validator's distinct-peer-ID + genesis gates. 08 §2.1 [VERIFY] resolved; SQ-107…SQ-109 logged for ratification. **Next:** wire A8/A11 into the runtime (the B1a follow-up: Config + pending-seam swap + SQ-96), then **B2** (`FutarchyApi`); B7 (zombienet/chopsticks) is now unblocked by B3.

**B1a ✅ (2026-07-16) — the runtime exists.** `runtime/bleavit-runtime` is now a real Cumulus parachain runtime (`construct_runtime!` over the 10 production pallets A1–A7/A9/A10 + the standard/system/Cumulus set, `frame_executive`, the `CheckMetadataHash`-carrying TxExtension stack, `BaseCallFilter = SafetyFilter<BleavitSafetyClassifier>`, stable2603 `=`-exact pins, genesis presets, `impl_runtime_apis!` — **not** `FutarchyApi`, that's B2), replacing the frame-free B1 composition model. It **builds to Wasm** (`wasm32v1-none`). **A8 (`pallet-epoch`) + A11 (`pallet-execution-guard`) landed on `main` (#56) mid-session** — this runtime holds their documented `construct_runtime!` index slots (61/62) + **G-1 fail-closed pending seam adapters** (authorize/settle/file/report nothing); **wiring the two now-available pallets into the runtime — Config + swapping the pending seams (`PendingA8Authority`/`PendingEpochClock`/`PendingReporting`/`PendingRegistryEpoch`/`PendingGuardian*`/`PendingUpgradeProvider`) + tests — is the immediate follow-up**, kept out of this PR to preserve B1a's reviewed scope. Orchestrated with **Codex subagents** (author → dual review → fix): the dual review's **1 blocker + 1 major + 1 P1 + P2s** and the **PR #57 Codex-bot's 3 findings** were triaged — fixed in-session with regressions: **`sudo.sudo_as` denied** (forges arbitrary `Signed(who)` → impersonates the welfare settlement sovereign / steals VIT; SQ-99), the **floor/ceil-swapped referenda support curves** (would `Perbill::sub`-underflow and brick every values track), the **CONST/entrenched `set_param` values-enactment gap**, **try-runtime error-masking**, **genesis `PhaseFlags`↔sudo-key consistency**, a **latent no_std `Vec`-import defect** in two pallets' `benchmarking.rs`, plus the **bot P2** (`referenda.cancel/kill` added to the values-enactment allowlist) and **bot P1** (the five `ConstitutionalValues` referenda tracks collapsed onto one track — the shared track now uses the **strongest/entrenched thresholds** so no values action can enact below its required bar; full per-track discrimination is the values-layer milestone, SQ-103). The **bot's phase3-cap P1** is an A2-ledger/B4-XCM obligation (09 §5.2 enforces the caps at the ledger split path + XCM inflow leg — **no live inflow path exists in B1a**; SQ-105). **One open blocker routes to B4:** USDC `ForeignAssets` is `u32`-id-1337-keyed (matching every A2/A3/A6 pallet) but 02 §7.4/§8 freeze it XCM-`Location`-keyed (**SQ-101**). No `docs/architecture/` edits — every divergence is fail-closed/stricter-than-spec and logged **SQ-99…SQ-105**. Gates green (fmt · clippy `-D warnings` · workspace suites · runtime tests + try-runtime · release wasm + runtime-benchmarks wasm builds · reference-model 21/21 · doc links). **Next: wire A8/A11 into the runtime; B4 resolves SQ-101; B2 wires `FutarchyApi` over this shell.**

**B1a CI follow-up (2026-07-16, draft PR #59):** CI uses the pinned Rust 1.89.0 toolchain and installs both runtime targets (`wasm32v1-none` preferred, `wasm32-unknown-unknown` fallback). The branch preserves B3's Rust cache and installs its native build dependencies (`libclang-dev` and `protobuf-compiler`). Full workspace gates and the canonical runtime-Wasm build are green.

**Track M (M0–M3) is finished — M1, M2, M3 all ✅ as of 2026-07-15; one PR (`feat/track-m-finish-m1-m2-m3`) carries all three and fully remediates the 2026-07-15 Track M audit.** **M2:** `exp2`/`log2`/`ln` reworked at guarded Q96 precision — **0 ulp over 10⁶ dense-bit points** (was 10.11); per-commit 1,286-point dense-bit single-generator corpus (`tools/fixed` retired, both CSVs gone); exact-u256 domain compare; f64 gated out of `no_std`; real `--no-default-features` CI gate; spec-reviewer **0 blocker / 0 major** + Codex **0 defects**. **M3:** the fresh spec-reviewer's **blocker** (percentile → 1e9-grid round-down), **major** (decision vectors → standalone-replayable) and per-gate-veto-order minor fixed; welfare pipeline now grid-exact end-to-end. **M1:** `Proposal`(21-field)/`ExecutionRecord`/`MarketSet`/`MarketKind`/`phase_offsets` single-homed in `futarchy-primitives`; `wt.quorum` double-copy + ~14 core constant duplications collapsed; `MaxEncodedLen`/golden-order/view-size regression tests; spec-reviewer major + all actionable minors fixed. **Also:** 15 §4.4 MPFR wording clarified (≥256-bit; the model's 100-digit `Decimal` ≈ 332-bit satisfies it) and the stale `.claude/rules/reference-model.md` re-trued (corpus schema owned by 04 §5). **Open follow-ups:** the ≥10⁷ MPFR sweep + supply-chain CI legs are B8; new **SQ-39…SQ-43** (08 §4.1 nav-floor rounding, `sec.prize.*` default, 04 §7 clamp-k, 05 §4.4 C_daily weight grid, `CohortSummary` bound) await a future 02/05/08 touch — **SQ-44** (`MarketKind` variant spelling) was **resolved** this session by conforming the code to 02 §5's canonical `GateS_Adopt`/… names (PR #49 rebased onto A2/#48 + Codex-comment triage).

**Track A COMPLETE — A1–A11 are all production `#[frame_support::pallet]`s ✅ (A8 + A11 landed 2026-07-16, by Codex subagents at gpt-5.6-sol/xhigh).** Each has a relocated frame-free functional core in `crates/<name>-core/` and a FRAME shell over it (bounded storage matching 02 byte-for-byte, origin-checked extrinsics, try-state hooks, benchmarks/weights, Doc-15 suites). **A5 (`pallet-oracle`) carried the 02 §7.2 contract reconciliation (triple key, `INTEGRATION_CONTRACT_VERSION` 2→3) early to break the A5 → B2 → B1a → A1–A11 circular dependency.** **A8 (`pallet-epoch`)** = the epoch/phase clock + T1–T24 proposal machine + the 11-step `decide()` engine + cohorts + `RecentCohortSummaries` ring. **A11 (`pallet-execution-guard`, audit-scope-A/R-7)** = the queue + permissionless atomic `execute()` (13-item dispatch, class origins, internal Root only for `authorize_upgrade`) + two-phase upgrade + `DescriptorLeadTime` + the A8↔A11 `dequeue_terminal` cleanup handoff. **B1a runtime assembly is now unblocked** — it owns `construct_runtime!` + wiring every Track-A seam (the guard's `Dispatcher`/SafetyFilter/attestor/epoch seams, the best-effort-wrapper rejection SQ-96, the class-origin `RuntimeCall` projection); B2–B6 follow.

**A7 ✅ (2026-07-16).** `pallets/welfare` is a production `#[frame_support::pallet]` over `welfare-core`: three **02 §7.4-frozen** `StorageMap`s (`MetricSpecs`/`Snapshots`/`GateBreachFlags`; `GateBreachFlags: map EpochId→flags` per 05 §4.7) via a scoped `load`(sorted)→core→`checked` `persist` adapter; a **rule-4 Params consumer** (θS/θC lo/hi + wP/wA from `pallet-constitution::Params`, threaded into a behavior-preserving core `WelfareParams`); `register_spec` (ConstitutionalValues) + `record_snapshot`/`record_daily_gate` (Signed keeper cranks, activation-checked) + the internal SettleAuthority `compute_settlement` (05 §6, `with_storage_layer`-atomic, class-gated `settle_gate`) + `prune` (rolling-20 reap). Orchestrated with **Codex subagents** (author → dual review → fix → regression pass): the dual review's 1 blocker + 6 majors (storage-shape→maps, no-pruning→reap, MetricSpec validation, settlement atomicity, inactive-spec, seam versioning, class-gated gates) + a regression minor all fixed in-session with tests; final Codex review **0 blocker/0 major**. On the PR the **Codex-connector** flagged **2 more**, both fixed: **P1** — the keeper cranks accepted an unfinalized/future `epoch`, so an early call could lock a wrong `W` or consume the bounded window before the counters exist; a pallet `epoch < CurrentEpoch` guard (`EpochNotFinalized`, 05 §4.6 finalized-epoch rule) now rejects them. **P2** — genesis specs were forced to `activation ≥ 2`, so `record_snapshot(1, …)` was rejected and W₁ was uncomputable; genesis registration (epoch-0 sentinel) now activates at epoch 1 (05 §4.6 cold start; the two-epoch lead only guards post-genesis version changes). R-1: 06 §3.2 keeper-crank rows added; SQ-77…82 logged. Gates green (workspace 498; welfare 32 pallet + 18 core). **Next: A8/A11 per the Track-A DoD, then B1a** (which wires the welfare `MetricInputs`/`Ledger` seams + epoch-driven snapshot/prune/settlement triggers + the I-16 cohort→spec_version binding).

**A3 ✅ (2026-07-15).** `pallets/market` is a production `#[frame_support::pallet]` over `market-core`: `Markets` (`CountedStorageMap`, 196-cap enforced at dispatch) + `BaselineMarketOf` (02 §7.4), the frozen 02 §5 event set, `buy`/`sell`/`crank_observe`/`reap` (Signed) + internal `create_market`/`seed`/`close` (`MarketAdmin`), a `LedgerOps` shim driving the real `pallet-conditional-ledger` `do_*` API (the market *is* the ledger's `MarketAuthority`; atomicity via `with_storage_layer`), live `mkt.fee`/`obs_interval`/`kappa` via Config, seed idempotency, and a `try_state` covering I-12 structural collateralization + I-13 accumulator sanity. The `market-core` refactor (`LedgerOps` trait + `MarketParams` + `buy_book`/`sell_book`/`seed_book`/`observe_book`) is behavior-identical at default params (differential preserved). Implemented by a **Codex background task** to a 6-phase brief, then dual-reviewed (adversarial `codex exec` + `spec-reviewer`) and hardened (`test-engineer`); both reviews' blockers were fixed with regression tests — **multi-book proposals shared one vault** (create was per-book) and **Baseline sells charged the seller** (the seller funded their own payout against the real ledger; the book now funds it) — plus the crank/196-cap/seed-idempotency/try-state majors, and the **PR #53 Codex-bot P1s** (Baseline seeding funded from `treasury` not the book; internal `seed`/`create_market` wrapped in `with_storage_layer`). Deferred by design: **SQ-64**–**SQ-67** and the A8 (TWAP window/checkpoints, settlement-anchored reap) / B1a (`create_market` epoch/spec params, deterministic book/fee sub-accounts, `Params` binding) items. All gates green (26 pallet tests, `runtime-benchmarks`, `try-runtime`, reference-model 21/21). PR #53.

**A1 ✅ (2026-07-15).** `pallets/constitution` is a production `#[frame_support::pallet]` over `constitution-core`: frozen 02 §7.3/§12 surface (D-14 raw key test-pinned), five spec-named origin-checked extrinsics (incl. `amend_registry`) with the 06 §3.2 authority matrix, the 87-key 13 §1 registry, bit-scoped phase-flag writers, genesis, try-state, mock, 15 §4.1 suites + 600-step randomized shell-vs-core differential, v2 benchmarks ×6, exact stable2603 pins. Dual review (spec-reviewer ×3 + Codex adversarial): all blockers/majors fixed; SQ-4…SQ-13 resolved by user-delegated R-1 decisions (06/13/15 edited, 02 untouched — no contract bump).

**A2 ✅ (2026-07-15).** `pallets/conditional-ledger` is a production `#[frame_support::pallet]` over `conditional-ledger-core`: bounded scoped-state adapter (load ≤14/2 storage cells → core op → persist), origin-checked calls (Signed + Resolve/Settle/Market-authority, 03 §5), the §5.5 `MarketAuthority` internal API, the new §5.4 `sweep_dust` reaping, real USDC custody with a single-sourced position deposit, `try_state`, benchmarks/weights, 28 unit tests incl. the mandated §6.3/§6.4 named regression vectors. Two independent reviews (Codex + spec-reviewer) converged on the same top defects (partial-reap `PositionTotals` corruption, dual-sourced deposit, self-transfer double-refund); all fixed and re-verified with no blockers remaining. Reconciled onto post-#46 main (adopted A1's exact-pin `=` SDK wiring and dropped the direct `polkadot-sdk` umbrella dependency, which drags in the unbuildable node stack). **Next**: A4 (`pallet-origins`) is already in progress in parallel (PR #47, deps M1 only); A3 (`pallet-market`) needs M2/M3 first per its Depends column (both reopened 🔨) — pick up whichever unblocks first, then the rest of A5–A11, then B1a.

**A9 ✅ (2026-07-15, PR #51).** `pallets/futarchy-treasury` is a production `#[frame_support::pallet]` over `futarchy-treasury-core` — the first Params *consumer* pallet: rule-4 caps read from `pallet-constitution::Params` via a `TreasuryParams` provider, a single bounded `StorageValue<TreasuryState>` aggregate, 8 origin-checked extrinsics + runtime-internal APIs, NAV/reserve-haircut fail-static, mandatory streams, a rolling trailing-365-day issuance meter, coretime renewal (freeze-exempt), genesis (fixed 1B VIT), try-state, 24-test suite + 600-step shell-vs-core differential, v2 benchmarks ×8. Triple review (spec-reviewer ×2 + Codex `codex:codex-rescue`) + the PR #51 Codex-bot round (2 × P2): 0 blockers; all majors + correctness findings fixed. SQ-47…SQ-57 logged; two spec edits (13 §4 treasury bounds, 08 §1.4 signatures). Rebased onto post-#50 main (treasury pallet/core untouched by #46–#50; only PLAN.md conflicts each time; SQs renumbered to clear the concurrent audits, now 47–57).

**A5 ✅ (2026-07-15, this session).** `pallets/oracle` is a production `#[frame_support::pallet]` over `oracle-core` (shell-over-core): 02 §7.2 storage on the `(component,epoch,version)` triple, 21 frozen events, 10 §13 extrinsics (`adjudicate` = OracleResolution via `EnsureOrigin`), a `ReportingContext` provider for `report`'s cross-pallet inputs, no-XCM reserve probe, the newly-live 07 §4 watchtower liveness discipline, try-state, mock, v2 benchmarks ×10. Dual-reviewed (Codex ×24 + `spec-reviewer` ×13); all in-scope blockers/majors fixed, incl. the **Codex PR-review P1** — `force_neutralize_expired(m, expected)` now neutral-settles no-report components so welfare never reads an absent value at the money deadline (07 §11(1); SQ-63). SQ-59/60/61/62 resolved by user-delegated R-1 amendments (07/13). **SQ-58 resolved too:** rather than wait on B2 (a circular A5 → B2 → B1a → A1–A11 dependency), the 02 §7.2 contract was reconciled **now** — pre-genesis, no FE yet, so the contract is made correct and B2/Track-F conform to it. Triple key + full `RoundState`/`ReserveHealth` shapes, `OracleRoundView` gains `spec_version`, `INTEGRATION_CONTRACT_VERSION` 2→3, 00 D-2 recorded, drift-lock test added (user's joint backend+frontend sign-off, R-1). **A5 is ✅.** Rebased onto post-#51 main (kernel-constant single-home; SQ renumber 39–43 → 58–63); PR #52. Gates green (oracle-core 17 · pallet-oracle 82 · workspace fmt/clippy/test · try-runtime · no_std · reference-model · doc links). **Next: A3/A6–A8/A11** by the same pattern, then B1a runtime assembly.

**A6 ✅ (2026-07-15).** `pallets/registry` is a production **instantiable** `#[frame_support::pallet]<T, I>` over `registry-core` — the 07 §7 IncidentRegistry + MilestoneRegistry as two instances (the repo's first FRAME-instanced pallet). Combines the ledger's `fungibles`-bond custody + scoped `load→core→persist→drain` adapter with the guardian's injected cross-pallet seams: decomposed 07 §7 storage (`Filings`/`FilingCount`/`Aggregates` + internal `AckRecords`/`ClosedAt`), 7 origin-checked calls (`file`/`challenge_filing`/`ack_observed`/`crank_close`/`close_epoch`/`reap_epoch` Signed + `resolve_challenge` via `ResolutionAuthority`), real USDC bond escrow→refund/40-60-slash (split single-sourced from the core, R-7), 5 B1a-wired seams (`Watchtowers`/`Welfare`/`Epoch`/`Params`/`ResolutionAuthority`) keeping A6 independent of A5/A7/A8, `try_state` (custody-solvency + bounds), no block hooks (I-20), v2 instance-benchmarks ×7. Core refactor (behavior-preserving, R-1/rule-4): bonds + milestone-target → `Params`/MetricSpec seams, `kernel::ORC_WINDOW_BLOCKS` single-home, exact insurance complement. Orchestrated with **Codex subagents** (user directive): I authored the fidelity-critical code; a Codex `codex:codex-rescue` adversarial review ran alongside the native `spec-reviewer` — both found real bugs (reap→re-close replay, milestone aggregate >1.0, a self-caught vacuous `SpecVersionMismatch`), **all fixed in-session with regression tests** and cleared by a focused re-pass; the **PR #54 Codex-bot P2** (acks on an *already-challenged* filing bypassed the `WT_QUORUM` cap → unbounded `AckRecords`) also fixed — 07 §4's "a challenge supersedes the quorum requirement" makes further acks moot, so `ack_observed` now rejects challenged filings. SQ renumbered 58–66 → **68–76** on the post-#52/#53 rebase (A5 claimed 58–63, A3 64–67). **Next milestone:** A7/A8/A11 per Track-A DoD, then B1a (which owns the SafetyFilter matrix rows SQ-75 + wiring the 5 seams).

**A4 (2026-07-15, this session — user asked for A4 next, not A2).** `pallets/origins` is now a production `#[frame_support::pallet]` **stateless shim** over `origins-core`: the 8 `#[pallet::origin]` variants (06 §3.1), the `EnsureOrigin` set (`decl_unit_ensure!` ×8 + `EnsureFutarchyOrigin`), and `SafetyFilter` as a classifier-parameterized `Contains` (the concrete `RuntimeCall` projection is the one explicit B1a extension point → wrapper set stays closed). All gates green. Dual review by the user's request: **spec-reviewer** cleared it (0 blockers; its single major — `origins-core` re-declaring the `MAX_NESTED` kernel constant, the Track-M audit's routed "tunables baked into cores → A4" — **fixed** by single-homing to `futarchy_primitives::kernel` per 01 §5.2 / SQ-25, which also cleared the naming minor; fuzz minor→S2, exhaustiveness test→B1a). **A4 ✅ 2026-07-15** after both reviews triaged: spec-reviewer 0 blockers; Codex's 1 "blocker" resolved to a **B1a dispatch-protocol/spec-clarity** item (the guard already uses the origin-aware path; **SQ-32** pins 06 §3.3), its majors 2/3 to documented **B1a classifier constraints**, its major 4 to **B1a/S5** runtime-level proofs + **S2** fuzz (with the one cheap nobody-under-every-wrapper test gap fixed), its minor to **SQ-31**. Two spec questions logged (SQ-31 count semantics, SQ-32 base-filter dispatch protocol) — both spec-clarity for B1a, neither a code defect. After A4: A2, then the rest of Track A, then B1a (which must honor the SafetyFilter dispatch protocol + classifier constraints A4 documented).
**A10 ✅ (2026-07-15).** `pallet-guardian` + `pallet-attestor` shipped as production `#[frame_support::pallet]`s over their frame-free cores by the same shell-over-core pattern (orchestrated with Codex + `spec-reviewer` + `test-engineer` subagents; attestor Codex-authored). Guardian: 5 origin-checked calls, 02 §6 frozen events via injected seams, bounded `on_initialize` crank with terminal reaping, I-23 try_state, a 500-step × 20-seed shell-vs-core differential; attestor: 4 calls, 2-of-N quorum view. Two spec-reviewer passes + a Codex adversarial pass — every major fixed in-session with tests (guardian reaping/re-election-clear/recall-seam/I-23; attestor try_state-relax/NoOpenChallenge/single-home). Full workspace gates green (54 test suites). SQ-45/SQ-46 raised; A10 design decisions logged. **Next: A2** (`pallet-conditional-ledger`, audit-scope-A) by the same pattern — expect the same `DecodeWithMemTracking`/mock/benchmark wiring plus the R-7 adversarial/solvency suites; then A3–A9/A11, then B1a.
