/**
 * Fixture-transcript test double (02 §11 row 4; 15 §4.8).
 *
 * Replays the deterministic chainHead-v1 transcripts recorded by
 * `tools/release/record-chainhead-fixtures.py` against a booted release node. No
 * network, no chain, no timers — a request either matches a recorded one exactly or it
 * is refused.
 *
 * **Refusing an unrecorded request is the whole point.** A mock that returns `null`,
 * `undefined` or an empty result for anything it was not taught turns a missing surface
 * into a passing test, which is the failure mode 02 §11 publishes these fixtures to
 * prevent. `respond()` throws on a miss, and `assertNoUnusedFixtures()` catches the
 * other direction — a suite that silently stopped exercising a surface.
 *
 * devDependency of everything, dependency of nothing.
 */

/** A recorded JSON-RPC exchange. `method` is the RPC name, or one of the two synthetic
 *  metadata-assertion kinds the recorder emits. */
export interface RecordedRequest {
  readonly method: string;
  readonly params: unknown;
  readonly response: unknown;
}

export interface Fixture {
  readonly surface: string;
  readonly headers: { readonly pinned_block: string };
  readonly requests: readonly RecordedRequest[];
}

/** One entry of the recorder's missing-surface list. */
export interface MissingSurface {
  readonly surface: string;
  readonly required: boolean;
  readonly reason: string;
}

/** The recorder's per-run report. `strict_ready` is false unless every *required*
 *  surface entry — primary and paired-recovery — was recorded. */
export interface FixturesReport {
  readonly schema: string;
  readonly mode: string;
  readonly metadata_sha256: string;
  readonly metadata_version: number | null;
  readonly pinned_block: string | null;
  readonly recorded: readonly string[];
  readonly missing: readonly MissingSurface[];
  readonly recovery_missing: readonly MissingSurface[];
  readonly recovery_metadata_present?: boolean;
  readonly strict_ready: boolean;
}

export interface FixtureBundle {
  readonly report: FixturesReport;
  readonly fixtures: ReadonlyMap<string, Fixture>;
}

export class UnrecordedRequestError extends Error {
  constructor(method: string, params: unknown) {
    super(
      `mock-runtime has no recorded response for ${method} ${JSON.stringify(params)}. ` +
        `Re-record the chainHead fixtures rather than relaxing the mock — a mock that ` +
        `answers what it was never taught cannot detect a missing surface.`,
    );
    this.name = "UnrecordedRequestError";
  }
}

/**
 * Build a bundle from already-parsed JSON.
 *
 * Kept separate from any filesystem read so the package stays environment-free: the
 * caller decides how the bytes arrive (Node test runner, bundler, browser fixture).
 */
export function createFixtureBundle(
  report: FixturesReport,
  fixtures: Iterable<Fixture>,
): FixtureBundle {
  const bySurface = new Map<string, Fixture>();
  for (const fixture of fixtures) {
    if (bySurface.has(fixture.surface)) {
      throw new Error(`duplicate fixture for surface ${fixture.surface}`);
    }
    bySurface.set(fixture.surface, fixture);
  }
  return { report, fixtures: bySurface };
}

/** Stable key for request matching. Params are compared structurally, not by identity. */
function requestKey(method: string, params: unknown): string {
  return `${method} ${JSON.stringify(params ?? null)}`;
}

export interface MockRuntime {
  /** Replay one recorded exchange. Throws `UnrecordedRequestError` on a miss. */
  respond(method: string, params?: unknown): unknown;
  /** Surfaces this bundle can serve. */
  surfaces(): readonly string[];
  /** The single block every fixture is pinned to. */
  pinnedBlock(): string;
  /** Recorded exchanges never replayed — a suite that stopped exercising a surface. */
  unusedRequests(): readonly string[];
  /** Throw unless every recorded exchange was replayed at least once. */
  assertNoUnusedFixtures(): void;
}

export function createMockRuntime(bundle: FixtureBundle): MockRuntime {
  const responses = new Map<string, unknown>();
  const used = new Set<string>();
  const pinned = new Set<string>();

  for (const fixture of bundle.fixtures.values()) {
    pinned.add(fixture.headers.pinned_block);
    for (const request of fixture.requests) {
      // Identical exchanges recur across fixtures (the same constant read by two
      // surfaces, say). Recording them once is correct; disagreeing on the response
      // for one key is not, and would make replay order-dependent.
      const key = requestKey(request.method, request.params);
      const existing = responses.get(key);
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(request.response)
      ) {
        throw new Error(
          `fixture conflict: ${request.method} has two different recorded responses ` +
            `(surface ${fixture.surface}). Replay would depend on load order.`,
        );
      }
      responses.set(key, request.response);
    }
  }

  if (pinned.size !== 1) {
    throw new Error(
      `fixtures span ${pinned.size} pinned blocks; a transcript set must be recorded ` +
        `at one block or the reads are not mutually consistent`,
    );
  }
  const pinnedBlock = [...pinned][0] as string;

  return {
    respond(method, params) {
      const key = requestKey(method, params);
      if (!responses.has(key)) throw new UnrecordedRequestError(method, params);
      used.add(key);
      return responses.get(key);
    },
    surfaces: () => [...bundle.fixtures.keys()].sort(),
    pinnedBlock: () => pinnedBlock,
    unusedRequests: () => [...responses.keys()].filter((k) => !used.has(k)).sort(),
    assertNoUnusedFixtures() {
      const unused = [...responses.keys()].filter((k) => !used.has(k));
      if (unused.length > 0) {
        throw new Error(
          `${unused.length} recorded exchange(s) were never replayed. Either the suite ` +
            `stopped exercising a surface, or the fixtures carry a dead recording:\n  ` +
            unused.slice(0, 10).join("\n  "),
        );
      }
    },
  };
}

/** The recorder's synthetic metadata-layout assertion for one surface. */
export interface MetadataPresence {
  readonly present: boolean;
  readonly layout_matches: boolean | null;
  readonly detail: string;
  readonly layout: unknown;
  readonly expected_layout: unknown;
}

export function metadataPresence(
  runtime: MockRuntime,
  surface: string,
  kind: string,
): MetadataPresence {
  return runtime.respond("metadata_presence", { kind, surface }) as MetadataPresence;
}

/** The same assertion against the paired terminal-recovery runtime (10 §5.1). */
export function recoveryMetadataPresence(
  runtime: MockRuntime,
  surface: string,
  kind: string,
): MetadataPresence {
  return runtime.respond("recovery_metadata_presence", {
    kind,
    surface,
  }) as MetadataPresence;
}

/**
 * Read a storage value back through the chainHead-v1 transcript.
 *
 * Deliberately goes through `chainHead_v1_storage` rather than the recorded
 * `state_getStorage` fallback: 10 §2 binds the client to chainHead, and the legacy RPC
 * is present in the fixtures only so the no-websockets degradation path (§11) has
 * something to exercise. A suite that read the easy one would certify the wrong API.
 */
export function chainHeadStorageValue(
  runtime: MockRuntime,
  key: string,
  type: "value" | "descendantsValues" = "value",
): readonly { key: string; value?: string; hash?: string }[] {
  const response = runtime.respond("chainHead_v1_storage", [
    "subscription-1",
    runtime.pinnedBlock(),
    [{ key, type }],
    null,
  ]) as { events?: { event: string; items?: { key: string; value?: string }[] }[] };
  const items: { key: string; value?: string }[] = [];
  for (const event of response.events ?? []) {
    if (event.event === "operationStorageItems") items.push(...(event.items ?? []));
  }
  return items;
}

/** Read a runtime-API result back through the chainHead-v1 transcript. */
export function chainHeadCall(runtime: MockRuntime, api: string, args = "0x"): string {
  const response = runtime.respond("chainHead_v1_call", [
    "subscription-1",
    runtime.pinnedBlock(),
    api,
    args,
  ]) as { events?: { event: string; output?: string; error?: string }[] };
  for (const event of response.events ?? []) {
    if (event.event === "operationCallDone" && typeof event.output === "string") {
      return event.output;
    }
    if (event.event === "operationError") {
      throw new Error(`${api} failed in the recorded transcript: ${event.error}`);
    }
  }
  throw new Error(`${api} produced no operationCallDone in the recorded transcript`);
}
