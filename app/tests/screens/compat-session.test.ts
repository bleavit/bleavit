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

function pulled(compat: CompatSurface, closed: { count: number }): PulledSurface {
  return {
    compat,
    close: () => {
      closed.count += 1;
    },
  };
}

/* ------------------------------------------------------------------ the local verdict */

test('a supported runtime with every surface intact classifies `full` and permits signing', async () => {
  const closed = { count: 0 };
  const roles: string[] = [];
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
    pullFor: async (role) => {
      roles.push(role);
      return pulled(surfaceOver(CRITICAL_SURFACE), closed);
    },
  });
  assert.equal(verdict.kind, 'classified');
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'full');
  assert.equal(verdict.classification.proven.length, CRITICAL_SURFACE.length);
  assert.ok(verdictAllowsSigning(verdict));
  assert.ok(verdictProvesSurface(verdict, CRITICAL_SURFACE[0]!.id));
  // The descriptor set is chosen by the chain: a primary runtime is probed with the primary
  // set, never with whichever one happened to be imported first.
  assert.deepEqual(roles, ['primary']);
  // The transient client is always closed — a second `chainHead_follow` left open for the
  // life of the tab is the resource this seam exists to avoid.
  assert.equal(closed.count, 1);
});

test('the paired recovery runtime is probed with the recovery descriptors, not the primary set', async () => {
  const roles: string[] = [];
  const verdict = await classifyLocalRuntime({
    runtime: runtime(RECOVERY.specVersion),
    pullFor: async (role) => {
      roles.push(role);
      return pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 });
    },
  });
  // 10 §5.1 / B16: recovery can become current under `OnlyInherents`, so it is a live-capable
  // entry. A client that fell back to the primary set here would compare the recovery runtime
  // against descriptors that do not describe it, and report the difference as a broken chain.
  assert.deepEqual(roles, ['recovery']);
  assert.ok(verdict.kind === 'classified' && verdict.classification.mode === 'full');
});

test('a broken surface is `restricted` and names itself — it is never `read-only-incompatible`', async () => {
  const broken = CRITICAL_SURFACE[3]!;
  const verdict = await classifyLocalRuntime({
    runtime: runtime(PRIMARY.specVersion),
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

test('the transient client is closed even when the classifier itself throws', async () => {
  const closed = { count: 0 };
  await assert.rejects(
    () =>
      classifyLocalRuntime({
        runtime: runtime(PRIMARY.specVersion),
        // A surface carrying nothing at all: the probe reports every entry `incompatible`,
        // which classifies. To reach `classify`'s own throw the *probe list* must be short,
        // which only a surface argument can do — so this drives the coverage refusal through
        // a surface whose group lookup throws instead.
        pullFor: async () =>
          pulled(
            new Proxy(surfaceOver(CRITICAL_SURFACE), {
              get() {
                throw new Error('the compat object came apart mid-probe');
              },
            }) as CompatSurface,
            closed,
          ),
      }),
    /came apart mid-probe/,
  );
  assert.equal(closed.count, 1, 'a throw past the pull must still close the transient client');
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
    pull: async () => {
      pulls += 1;
      return pulled(surfaceOver(FOREIGN_SURFACE), { count: 0 });
    },
    pins: [AH_PIN],
  });
  assert.ok(verdict.kind === 'classified');
  assert.equal(verdict.classification.mode, 'wrong-chain');
  assert.match(assetHubBlockReason(verdict) ?? '', /retrying will not change this/);
  // Identity before compatibility: a compat verdict computed against the wrong chain
  // describes a runtime the app was never talking to.
  assert.equal(pulls, 1, 'the pull is attempted only because identity is judged inside classifyForeign');
  assert.equal(assetHubCompatible(verdict), false);
});

test('an Asset Hub that was never reached is `unreachable` and is never probed', async () => {
  let pulls = 0;
  const verdict = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: undefined,
    runtime: undefined,
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
    pullFor: async () => pulled(surfaceOver(CRITICAL_SURFACE), { count: 0 }),
  });
  const foreign = await classifyAssetHub({
    chainLabel: AH_PIN.label,
    genesisHash: AH_PIN.genesisHash,
    runtime: ahRuntime(),
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
