/**
 * 10 §5.2's classifier, running — F26.
 *
 * `tests/descriptors/compat.test.ts` has covered `classify` and `probeCriticalSurface` since
 * F4, and every one of those tests passed while **neither function was ever called by the
 * client**: `probeCriticalSurface` was defined once and called zero times, because it takes a
 * `CompatSurface` and only PAPI's typed api produces one. So the suite that mattered was the
 * one that did not exist — this one, over the module that decides *when* to probe, *which
 * descriptor set* to probe with, and *what to do when the probe cannot be performed at all*.
 *
 * Everything here is driven with the PAPI seam injected, which is `chain-boot.ts`'s pattern:
 * the pulled surface is a fake, and what is under test is every decision on either side of it.
 * The seam itself — `createClient` → `getTypedApi` → `getStaticApis` — needs a running node
 * and is honestly outside what any test here can reach.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CRITICAL_SURFACE,
  FOREIGN_SURFACE,
  ForeignProbeCoverageError,
  ProbeCoverageError,
  SUPPORTED_RUNTIMES,
  type AnyCompatHelper,
  type CompatSurface,
  type ForeignChainPin,
} from '@bleavit/descriptors';
import {
  assetHubBlockReason,
  assetHubCompatible,
  classifyAssetHub,
  classifyLocalRuntime,
  foreignIdentityVerdict,
  verdictAllowsSigning,
  verdictProvesSurface,
  type PulledSurface,
} from '@bleavit/application';
import type { RuntimeVersionReport } from '@bleavit/chain-client';
import { DOC_10, architecture, theLineContaining } from './spec-sources.ts';

const PRIMARY = SUPPORTED_RUNTIMES.find((r) => r.role === 'primary');
const RECOVERY = SUPPORTED_RUNTIMES.find((r) => r.role === 'recovery');
assert.ok(PRIMARY && RECOVERY, 'the release ships a primary/recovery pair (10 §5.1, B16)');

function runtime(specVersion: number): RuntimeVersionReport {
  return { specName: 'bleavit', specVersion, implVersion: 0, transactionVersion: 1 };
}

const helper = (compatible: boolean): AnyCompatHelper => ({
  level: compatible ? 3 : 0,
  isCompatible: () => compatible,
});

/**
 * A compat surface built from a real frozen list.
 *
 * Built from `CRITICAL_SURFACE`/`FOREIGN_SURFACE` themselves rather than from a hand-written
 * pallet map, because the thing under test is that the probe finds every entry where the
 * classifier expects it: a fixture listing its own three pallets would agree with itself and
 * say nothing about the 200-odd real ones.
 */
function surfaceOver(
  entries: readonly { compatGroup: keyof CompatSurface; pallet: string; member: string; id: string }[],
  broken: readonly string[] = [],
  absent: readonly string[] = [],
): CompatSurface {
  const groups: { [K in keyof CompatSurface]: Record<string, Record<string, AnyCompatHelper>> } = {
    apis: {},
    query: {},
    constants: {},
    event: {},
    tx: {},
  };
  for (const entry of entries) {
    if (absent.includes(entry.id)) continue;
    const pallet = (groups[entry.compatGroup][entry.pallet] ??= {});
    pallet[entry.member] = helper(!broken.includes(entry.id));
  }
  return groups;
}

const CODE_HASH = `0x${'c0de'.repeat(16)}`;

function pulled(compat: CompatSurface, closed: { count: number }): PulledSurface {
  return {
    compat,
    codeHash: CODE_HASH,
    close: () => {
      closed.count += 1;
    },
  };
}

/** The runtime re-read after the pull. Steady by default — a moving one is the test's subject. */
const steady = (report: RuntimeVersionReport) => (): RuntimeVersionReport => report;

/* ------------------------------------------------------------------ the local verdict */

test('a supported runtime with every surface intact classifies `full` and permits signing', async () => {
  const closed = { count: 0 };
  const keys: string[] = [];
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async (descriptorKey) => {
      keys.push(descriptorKey);
      return pulled(surfaceOver(CRITICAL_SURFACE), closed);
    },
  });
  assert.equal(verdict.kind, 'classified');
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'full');
  assert.equal(verdict.classification.proven.length, CRITICAL_SURFACE.length);
  assert.ok(verdictAllowsSigning(verdict));
  assert.ok(verdictProvesSurface(verdict, CRITICAL_SURFACE[0]!.id));
  // The descriptor set is chosen by the chain, and named by the **committed `descriptorKey`**
  // rather than by the role — 10 §5.1 makes the artifact a per-`spec_version` fact, and a
  // role-keyed lookup is correct only while the table happens to be one primary and one
  // recovery.
  assert.deepEqual(keys, [PRIMARY.descriptorKey]);
  // And the verdict names the runtime it examined, not only the label it was given.
  assert.equal(verdict.codeHash, CODE_HASH);
  // The transient client is always closed — a second `chainHead_follow` left open for the
  // life of the tab is the resource this seam exists to avoid.
  assert.equal(closed.count, 1);
});

test('the paired recovery runtime is probed with the recovery descriptors, not the primary set', async () => {
  const keys: string[] = [];
  const verdict = await classifyLocalRuntime({
    runtime: runtime(RECOVERY.specVersion),
    runtimeNow: steady(runtime(RECOVERY.specVersion)),
    pullFor: async (descriptorKey) => {
      keys.push(descriptorKey);
      return pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 });
    },
  });
  // 10 §5.1 / B16: recovery can become current under `OnlyInherents`, so it is a live-capable
  // entry. A client that fell back to the primary set here would compare the recovery runtime
  // against descriptors that do not describe it, and report the difference as a broken chain.
  assert.deepEqual(keys, [RECOVERY.descriptorKey]);
  assert.ok(verdict.kind === 'classified' && verdict.classification.mode === 'full');
});

test('a broken surface is `restricted` and names itself — it is never `read-only-incompatible`', async () => {
  const broken = CRITICAL_SURFACE[3]!;
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE, [broken.id]), { count: 0 }),
  });
  assert.ok(verdict.kind === 'classified');
  // The rule that is easy to get backwards: `read-only-incompatible` is about the
  // `spec_version`, not about how much broke.
  assert.equal(verdict.classification.mode, 'restricted');
  assert.deepEqual(
    verdict.classification.disabled.map((d) => d.id),
    [broken.id],
  );
  assert.equal(verdictProvesSurface(verdict, broken.id), false);
  assert.equal(verdictAllowsSigning(verdict), false);
});

test('an absent surface is refused rather than skipped, so it cannot pass by not being asked about', async () => {
  const absent = CRITICAL_SURFACE[7]!;
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE, [], [absent.id]), { count: 0 }),
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'restricted');
  const disabled = verdict.classification.disabled.find((d) => d.id === absent.id);
  assert.ok(disabled, 'a surface the compat object does not carry must be reported, not dropped');
  assert.equal(disabled.level, 'incompatible');
});

test('an unsupported spec_version is `read-only-incompatible` and is never probed', async () => {
  let pulls = 0;
  const verdict = await classifyLocalRuntime({
    runtime: runtime(999_999),
    runtimeNow: steady(runtime(999_999)),
    pullFor: async () => {
      pulls += 1;
      return pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 });
    },
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'read-only-incompatible');
  // Not an optimisation: 10 §5.1 commits descriptors per `spec_version`, so there is no
  // descriptor set to probe *with*. Probing anyway would compare a runtime against
  // descriptors that do not describe it and publish the result as a compatibility verdict.
  assert.equal(pulls, 0, 'a runtime with no committed descriptor set must not be probed');
  assert.equal(verdictAllowsSigning(verdict), false);
});

test('a runtime the client could not read is `unestablished` — never a default spec_version', async () => {
  let pulls = 0;
  const verdict = await classifyLocalRuntime({
    runtime: undefined,
    runtimeNow: () => undefined,
    pullFor: async () => {
      pulls += 1;
      return pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 });
    },
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.equal(pulls, 0);
  assert.ok(verdict.kind === 'unestablished' && verdict.reason.includes('could not read'));
  // The whole point of the arm: nothing is proven and nothing may be signed, and no surface
  // is reported as "absent from this runtime" about a runtime nothing examined.
  assert.equal(verdictAllowsSigning(verdict), false);
  assert.equal(verdictProvesSurface(verdict, CRITICAL_SURFACE[0]!.id), false);
});

test('a failed pull is `unestablished`, not a synthesised `restricted` with every surface disabled', async () => {
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async () => {
      throw new Error('the metadata request timed out');
    },
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.ok(verdict.kind === 'unestablished');
  assert.ok(verdict.reason.includes('the metadata request timed out'));
  // The failure this asserts against: turning "we could not look" into a list of surfaces
  // reported absent, which puts a claim about the runtime on screen that nothing supports.
  assert.ok(!verdict.reason.includes('is absent from this runtime'));
});

test('a probe that throws is `unestablished`, and the transient client is still closed', async () => {
  // **PAPI computes compat on property access**, so every failure its metadata layer can have
  // on a runtime it cannot map happens *inside* the probe rather than inside the pull. The
  // first version of this suite asserted the rejection propagated, which is what shipped —
  // and `openDepositLeg` rejected with it, so the deposit screen never rendered at all. E17
  // wants the flow blocked *with diagnostics*, so the throw is now a verdict.
  const closed = { count: 0 };
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async () =>
      pulled(
        new Proxy(surfaceOver(CRITICAL_SURFACE), {
          get() {
            throw new Error('the compat object came apart mid-probe');
          },
        }) as CompatSurface,
        closed,
      ),
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.ok(verdict.kind === 'unestablished' && verdict.reason.includes('came apart mid-probe'));
  assert.equal(closed.count, 1, 'a throw past the pull must still close the transient client');
});

test('a release-manifest defect stays LOUD — it is not a chain that could not be read', async () => {
  // The one exception to the catch above. A coverage error means this release's own frozen
  // surface list and its own probe disagree about how many entries exist, which is a
  // packaging defect in the artifact the client shipped; reporting it as *"the chain could
  // not be read"* would hide a broken release behind a message about somebody else's network.
  //
  // **Stated honestly: this cannot currently happen in production.** `classifyLocalRuntime`
  // hands `probeCriticalSurface` and `classify` the same default `CRITICAL_SURFACE`, so the
  // two lists cannot diverge and the coverage refusal is unreachable from here. The
  // classification of the error is still real and still worth pinning — it is what decides
  // whether a future caller passing a narrowed surface gets a loud failure or a polite one —
  // so it is exercised directly rather than through a production path that cannot produce it.
  const closed = { count: 0 };
  await assert.rejects(
    () =>
      classifyLocalRuntime({
        runtime: runtime(PRIMARY.specVersion),
        runtimeNow: steady(runtime(PRIMARY.specVersion)),
        pullFor: async () =>
          pulled(
            new Proxy(surfaceOver(CRITICAL_SURFACE), {
              get() {
                throw new ProbeCoverageError('2 of 200 entries were never probed');
              },
            }) as CompatSurface,
            closed,
          ),
      }),
    ProbeCoverageError,
  );
  assert.equal(closed.count, 1, 'the transient client leaked while a manifest defect was reported');
});

test('the label is refused when the runtime moves while it is being examined', async () => {
  // `runtime` is read from the transport before the pull; the surface comes from a *separate*
  // client at *its* finalized head. Nothing binds them, so an upgrade landing inside that
  // window would stamp a `full` verdict with the `spec_version` of a runtime that is no longer
  // current — the stale-runtime defect arriving from the other side.
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: () => runtime(RECOVERY.specVersion),
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.ok(verdict.kind === 'unestablished' && verdict.reason.includes('changed while'));
});

test('a runtime swap that keeps the spec_version is refused too', async () => {
  // 02 §13 rule 7: `transaction_version` and the contract counter are **independent**. A
  // `spec_version`-only comparison agrees across exactly the swap it exists to notice.
  const before = runtime(PRIMARY.specVersion);
  const verdict = await classifyLocalRuntime({
    runtime: before,
    runtimeNow: () => ({ ...before, transactionVersion: before.transactionVersion + 1 }),
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.ok(verdict.kind === 'unestablished' && verdict.reason.includes('transaction_version'));
});

test('a runtime that stops being readable mid-check is refused, not assumed unchanged', async () => {
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: () => undefined,
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
  });
  assert.equal(verdict.kind, 'unestablished');
});

test('a pull that never answers is abandoned at the deadline rather than awaited forever', async () => {
  // `getStaticApis` waits for its own client's first finalized block, so a second chain handle
  // that never syncs leaves the promise pending for the life of the tab — the deposit leg
  // never settles, the screen never renders, and the caller's release never runs. The deadline
  // is what makes the signal a deadline rather than one that defaults to never.
  const seen: AbortSignal[] = [];
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    deadlineMs: 5,
    pullFor: async (_key, signal) => {
      seen.push(signal);
      return new Promise<PulledSurface>((_resolve, reject) => {
        // `AbortSignal.timeout`'s own timer is deliberately unref'd, so with nothing else
        // pending Node exits before it fires and the test is cancelled rather than run. That
        // is the documented behaviour of the production path — a deadline must not hold a tab
        // open — so the *test* supplies the liveness instead of the subject being changed.
        const keepAlive = setTimeout(() => undefined, 1_000);
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          const abort = new Error('Abort Error');
          abort.name = 'AbortError';
          reject(abort);
        });
      });
    },
  });
  assert.equal(seen.length, 1, 'no signal reached the pull');
  assert.equal(seen[0]?.aborted, true);
  assert.equal(verdict.kind, 'unestablished');
  assert.ok(verdict.kind === 'unestablished' && verdict.reason.includes('gave up'));
});

/* ---------------------------------------------------------------- the foreign verdict */

const AH_PIN: ForeignChainPin = {
  label: 'Asset Hub',
  genesisHash: `0x${'d6'.repeat(32)}`,
  supportedSpecVersions: [2004002],
};

function ahRuntime(specVersion = 2004002): RuntimeVersionReport {
  return { specName: 'asset-hub-paseo', specVersion, implVersion: 0, transactionVersion: 16 };
}

test('Asset Hub with every frozen surface intact classifies `full`, and the deposit row holds', async () => {
  const closed = { count: 0 };
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE), closed),
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'full');
  assert.equal(verdict.classification.domain, 'foreign');
  assert.deepEqual(
    [...verdict.classification.proven].sort(),
    FOREIGN_SURFACE.map((e) => e.id).sort(),
  );
  assert.equal(assetHubCompatible(verdict), true);
  assert.equal(assetHubBlockReason(verdict), undefined);
  assert.equal(closed.count, 1);
});

test('the frozen AH **call** is probed, and losing it blocks the deposit', async () => {
  const call = FOREIGN_SURFACE.find((entry) => entry.kind === 'call');
  assert.ok(call, '02 §7.7 freezes a dispatchable, and it must be probeable');
  // Its helper lives in PAPI's `tx` group, which `CompatSurface` did not carry before F26 —
  // so this row was structurally unprobeable and `classifyForeign` could only ever have been
  // handed a short list, which it refuses. The deposit leg is the one that would have failed.
  assert.equal(call.compatGroup, 'tx');
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE, [call.id]), { count: 0 }),
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'restricted');
  assert.deepEqual(
    verdict.classification.disabled.map((d) => d.id),
    [call.id],
  );
  assert.equal(assetHubCompatible(verdict), false);
  assert.match(assetHubBlockReason(verdict) ?? '', /Deposits are disabled/);
});

test('a wrong chain is terminal, keeps the observed genesis, and is never probed', async () => {
  const observed = `0x${'11'.repeat(32)}`;
  let pulls = 0;
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: observed,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => {
      pulls += 1;
      return pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 });
    },
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'wrong-chain');
  assert.match(assetHubBlockReason(verdict) ?? '', /retrying will not change this/);
  // **Identity before compatibility, and before the probe.** The first version pulled a
  // surface from the wrong chain and then discarded it, and this line pinned that as
  // `pulls === 1` — a suite agreeing with a defect the subject's own docstring described.
  // `foreign.ts`'s ordering exists because *"a spec_version verdict computed against the wrong
  // chain describes a runtime this app was never talking to"*, and computing one in order to
  // throw it away still spends a connection and a metadata fetch on a refused chain.
  assert.equal(pulls, 0, 'a surface was pulled from a chain this release has already refused');
  assert.equal(assetHubCompatible(verdict), false);
  // No probe means no examined runtime to name, which the verdict says rather than implies.
  assert.equal(verdict.codeHash, undefined);
});

test('an Asset Hub that was never reached is `unreachable` and is never probed', async () => {
  let pulls = 0;
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: undefined,
    runtime: undefined,
    runtimeNow: () => undefined,
    pull: async () => {
      pulls += 1;
      return pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 });
    },
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'unreachable');
  assert.equal(pulls, 0, 'there is nothing to pull a surface from');
  assert.equal(assetHubCompatible(verdict), false);
});

test('an Asset Hub runtime this release has no descriptors for is `unsupported`, not `wrong-chain`', async () => {
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(9_999_999),
    runtimeNow: () => ahRuntime(9_999_999),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 }),
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  // The same chain further along is a state a user can wait out; a different chain is not.
  assert.equal(verdict.classification.mode, 'unsupported');
  assert.equal(assetHubCompatible(verdict), false);
});

test('an Asset Hub probe that fails is `unestablished`, and the deposit row carries the reason', async () => {
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => {
      throw new Error('the Asset Hub metadata request failed');
    },
    pins: [AH_PIN],
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.equal(assetHubCompatible(verdict), false);
  assert.match(assetHubBlockReason(verdict) ?? '', /the Asset Hub metadata request failed/);
  // 02 §7.7's direction: it blocks deposits and says so, and it says nothing about the rest
  // of the app — the case where "the rest of the app is fine" is most tempting to omit.
  assert.match(assetHubBlockReason(verdict) ?? '', /nothing else in the app is affected/);
});

test('an Asset Hub PROBE that throws is `unestablished` too — not only a failing pull', async () => {
  // The foreign half of the same defect, and the half a suite is most likely to miss: the
  // other tests here fail the **pull**, which is a different code path from the probe. PAPI
  // computes compat on property access, so an Asset Hub runtime its metadata layer cannot map
  // throws inside `probeForeignSurface`, after the pull has already succeeded. Unwrapped, that
  // rejection reached `openDepositLeg` and the deposit screen never rendered.
  const closed = { count: 0 };
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () =>
      pulled(
        new Proxy(surfaceOver(FOREIGN_SURFACE), {
          get() {
            throw new Error('the Asset Hub compat object came apart');
          },
        }) as CompatSurface,
        closed,
      ),
    pins: [AH_PIN],
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.match(assetHubBlockReason(verdict) ?? '', /came apart/);
  assert.match(assetHubBlockReason(verdict) ?? '', /nothing else in the app is affected/);
  assert.equal(assetHubCompatible(verdict), false);
  assert.equal(closed.count, 1, 'the transient Asset Hub client leaked when the probe threw');
});

test('an Asset Hub manifest defect stays loud on the foreign path as well', async () => {
  const closed = { count: 0 };
  await assert.rejects(
    () =>
      classifyAssetHub({
        chainLabel: AH_PIN.label,
        genesisHash: AH_PIN.genesisHash,
        runtime: ahRuntime(),
        runtimeNow: () => ahRuntime(),
        pull: async () =>
          pulled(
            new Proxy(surfaceOver(FOREIGN_SURFACE), {
              get() {
                throw new ForeignProbeCoverageError('1 of 3 frozen Asset Hub surfaces was never probed');
              },
            }) as CompatSurface,
            closed,
          ),
        pins: [AH_PIN],
      }),
    ForeignProbeCoverageError,
  );
  assert.equal(closed.count, 1);
});

test('a foreign runtime that moves mid-check is refused rather than labelled', async () => {
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(2004003),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 }),
    pins: [AH_PIN],
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.match(assetHubBlockReason(verdict) ?? '', /changed while/);
});

test('the identity-only verdict is the same call, for a caller that never got a probe', async () => {
  const observed = `0x${'22'.repeat(32)}`;
  const wrong = foreignIdentityVerdict(AH_PIN.label, observed, [AH_PIN]);
  assert.ok(wrong.kind === 'classified');
  assert.equal(wrong.classification.mode, 'wrong-chain');
  const unreachable = foreignIdentityVerdict(AH_PIN.label, undefined, [AH_PIN]);
  assert.ok(unreachable.kind === 'classified');
  assert.equal(unreachable.classification.mode, 'unreachable');
});

test('an unpinned foreign chain is `unreachable` — a release that pins nothing verifies nothing', async () => {
  const verdict = await classifyAssetHub({
    chainLabel: 'Asset Hub',
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 }),
    pins: [],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'unreachable');
});

/* ------------------------------------------------------ the two verdicts stay separate */

test('the local and foreign verdicts are different types and neither answers for the other', async () => {
  const local = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    runtimeNow: steady(runtime(PRIMARY.specVersion)),
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
  });
  const foreign = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
    runtimeNow: () => ahRuntime(),
    pull: async () => pulled(surfaceOver(FOREIGN_SURFACE, FOREIGN_SURFACE.map((e) => e.id)), { count: 0 }),
    pins: [AH_PIN],
  });
  // 02 §13 rule 8: reported separately, never folded. A healthy Bleavit runtime must not be
  // able to vouch for a chain its own metadata cannot describe.
  assert.ok(verdictAllowsSigning(local));
  assert.equal(assetHubCompatible(foreign), false);
  assert.ok(foreign.kind === 'classified' && foreign.classification.domain === 'foreign');
  // @ts-expect-error — a foreign classification carries no `mode` the local gate accepts.
  assert.equal(verdictAllowsSigning(foreign), false);
});

/* ------------------------------------ FE-COMPAT-003: the code the boot machine now owns */

/**
 * SQ-1011 / SQ-1012, ruled 2026-08-08.
 *
 * The ruling kept the lattice at three modes and gave the fourth outcome a **state** instead
 * — 10 §3.1's `CompatUnavailable`, under a new code. The code is a literal type on the arm,
 * so a construction site that omits it or writes another one does not compile. That makes an
 * assertion of the literal here **vacuous**: it would restate what the compiler already
 * proved, and it would agree with the type while both drifted from the specification
 * together. So the expected value is **read out of doc 10** instead, and what these tests
 * check is the one relation neither the compiler nor the document can check alone.
 */
function publishedCompatUnavailableCode(): string {
  const state = theLineContaining(architecture(DOC_10), '**`CompatUnavailable`**');
  const codes = [...new Set([...state.matchAll(/FE-COMPAT-\d{3}/g)].map((m) => m[0]))];
  assert.deepEqual(codes.length, 1, `10 §3.1 must name exactly one code for CompatUnavailable, found ${codes.join(', ') || 'none'}`);
  const [code] = codes;
  assert.ok(code !== undefined);
  return code;
}

test('every unestablished verdict this module can produce carries the code doc 10 publishes', async () => {
  const ah = () => ({ ...AH_PIN });
  const verdicts = [
    // No runtime reported at all.
    await classifyLocalRuntime({ runtime: undefined, runtimeNow: () => undefined, pullFor: async () => { throw new Error('unreachable'); } }),
    // The pull itself failed.
    await classifyLocalRuntime({
      runtime: runtime(PRIMARY.specVersion),
      runtimeNow: steady(runtime(PRIMARY.specVersion)),
      pullFor: async () => { throw new Error('no metadata'); },
    }),
    // The runtime moved under the probe.
    await classifyLocalRuntime({
      runtime: runtime(PRIMARY.specVersion),
      runtimeNow: steady(runtime(RECOVERY.specVersion)),
      pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
    }),
    // The foreign half, one chain over — 02 §7.7's "unavailable or unprobed".
    await classifyAssetHub({
      chainLabel: ah().label,
      genesisHash: ah().genesisHash,
      runtime: ahRuntime(),
      runtimeNow: () => ahRuntime(),
      pull: async () => { throw new Error('no metadata'); },
      pins: [ah()],
    }),
  ];
  const unestablished = verdicts.filter((v) => v.kind === 'unestablished');
  assert.equal(unestablished.length, verdicts.length, 'every case above is meant to be unestablished');
  const published = publishedCompatUnavailableCode();
  for (const verdict of unestablished) {
    assert.equal(verdict.code, published);
    // The reason is a diagnosis, not a code. An empty one would satisfy the assertion above
    // and tell an operator nothing, which is the shape 10 §9.4 forbids.
    assert.ok(verdict.reason.length > 0);
  }
});

test('the code doc 10 §3.1 publishes is inside the range §9.4 declares', () => {
  const published = publishedCompatUnavailableCode();
  // §9.4's taxonomy line read `FE-COMPAT-001..002` until the ruling. A code outside the
  // declared range is one no error table can own, and the two lines are far enough apart in
  // the document that only a check binds them. Parsed rather than matched against a literal,
  // so extending the family again keeps this test honest instead of merely green.
  const taxonomy = theLineContaining(architecture(DOC_10), 'Error taxonomy: as reviewed');
  const range = /`FE-COMPAT-(\d{3})\.\.(\d{3})`/.exec(taxonomy);
  assert.ok(range, `10 §9.4 declares no FE-COMPAT range: ${taxonomy}`);
  const [, low, high] = range;
  const ordinal = Number(published.slice('FE-COMPAT-'.length));
  assert.ok(ordinal >= Number(low) && ordinal <= Number(high), `${published} is outside FE-COMPAT-${low}..${high}`);
});

test('10 §3.1 states the two clauses the ruling turns on, and the client obeys both', async () => {
  const state = theLineContaining(architecture(DOC_10), '**`CompatUnavailable`**');
  // Clause 1 — no surface may be named as disabled, because none was examined. A client that
  // listed surfaces here would fabricate exactly the finding the coverage refusal one layer
  // up exists to prevent.
  assert.match(state, /no surface is named as disabled/i);
  // Clause 2 — the state is non-terminal and retries, which is what distinguishes it from
  // `WrongChain`. Both are read from the document rather than restated.
  assert.match(state, /non-terminal/i);
  assert.match(state, /retries into `CompatCheck`/);
  // And the client's own half of clause 1: an unestablished verdict proves no surface and
  // permits no signature. Driven through the real predicates, not asserted about the shape.
  const verdict = await classifyLocalRuntime({
    runtime: undefined,
    runtimeNow: () => undefined,
    pullFor: async () => { throw new Error('unreachable'); },
  });
  assert.equal(verdict.kind, 'unestablished');
  assert.equal(verdictAllowsSigning(verdict), false);
  for (const entry of CRITICAL_SURFACE) assert.equal(verdictProvesSurface(verdict, entry.id), false);
});
