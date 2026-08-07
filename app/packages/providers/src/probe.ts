/**
 * §8.3's health probe, as the thing that actually issues it — 10 §8.5.3. F24.
 *
 * `sampling.ts` already carries both halves of the ladder's *arithmetic*: {@link probeDue} says
 * when a probe is owed, {@link afterProbe} advances the ladder from one outcome. Neither of them
 * ever asked an endpoint anything, so until this module every provider a user accepted stayed
 * `unprobed` forever — and because `canServeReads` refuses `unprobed`, an accepted source served
 * nothing at all. That is the consequence F24's PLAN.md row states rather than leaves to be
 * discovered: the ladder was a complete mechanism with no driver.
 *
 * ## What counts as an answer, and why a wrong chain is not one
 *
 * 10 §8.5.3 fixes three conditions, all of which must hold: status `200`, a body that parses as
 * §8.2's `binding` object, and a `genesisHash` equal to the chain this client is on. The third is
 * the one worth stating, because a server that answers promptly *about another chain* is
 * healthy by every network measure and can never supply a usable row. Counting it as an answer
 * parks it on the ladder in `healthy` indefinitely, where it is indistinguishable from a source
 * that works — so the failure surfaces later, as rows that never arrive, rather than now, as the
 * refusal it is. §8.2's import path already compares `binding.genesisHash` for exactly this
 * reason, and this is the same comparison moved to the same question's other end.
 *
 * ## The driver never contacts a disabled source, and that is not what `afterProbe` covers
 *
 * {@link afterProbe} returns a `disabled` provider unchanged — it will not let a healthy probe
 * resurrect what the user or the sampler switched off. That protects the *ladder*. It does not
 * protect the *user*, because by the time it runs the request has already been sent, and 10 §8.1
 * makes the request itself the disclosure: accepting a suggestion discloses "exactly what the
 * operator learns (the addresses/objects you query)". A client that kept probing a source the
 * user switched off would keep telling that operator it is still here, every ten minutes, after
 * being told to stop. So {@link runProbeRound} filters `disabled` out **before** the request
 * rather than relying on the outcome being discarded afterwards.
 *
 * The same reasoning excludes a source with no endpoint. §8.5.3 scopes the ladder to a provider
 * that *has* one; a file the user supplies is admitted or refused entirely by its content pin and
 * §8.4's screens, and there is nobody to ask.
 */

import { providerUrl } from './endpoint.js';
import { LADDER, type LadderThresholds, type Provider } from './health.js';
import { afterProbe, probeDue, type ProbeOutcome } from './sampling.js';

/**
 * The transport, injected.
 *
 * It returns the body as **text**. A transport that parsed JSON would have already decided what a
 * malformed body means, and §8.5.3 makes that this module's decision: an unparseable body is a
 * failed probe, not an exception the caller sees.
 */
export interface ProbeResponse {
  readonly status: number;
  readonly body: string;
}

export type HttpGet = (url: string) => Promise<ProbeResponse>;

/** A provider that can be probed: an endpoint, and the chain the answer must be about. */
export interface ProbeTarget {
  readonly endpoint: string;
  /** The genesis hash of the chain this client is on (§8.5.3). */
  readonly genesisHash: string;
}


/** Whether a parsed body is §8.2's `binding` object. Shape only — the chain check is separate. */
function bindingGenesis(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const genesis = record['genesisHash'];
  if (typeof genesis !== 'string' || genesis === '') return null;
  if (typeof record['specVersion'] !== 'number') return null;
  if (typeof record['contractVersion'] !== 'number') return null;
  return genesis;
}

/**
 * Issue one probe (§8.5.3) and report what it found.
 *
 * Never throws. A transport that rejects is a failed probe — that is the ordinary case (a
 * timeout, a refused connection, DNS), and letting it propagate would stop a round part-way and
 * leave the remaining providers unprobed with no record of why.
 *
 * `clock` is injected so a test can measure latency without waiting. A **backwards** clock is
 * clamped to zero rather than reported as a negative latency: `slow` is defined as an observation
 * above a threshold, and a negative measurement is not a fast answer, it is no measurement. The
 * clamp is safe in the direction that matters because §8.3 forbids `slow` from disabling anything.
 */
export async function probe(
  target: ProbeTarget,
  get: HttpGet,
  clock: () => number,
): Promise<ProbeOutcome> {
  const url = providerUrl(target.endpoint, 'chain');
  if (url === null) {
    return { kind: 'failed', why: `${target.endpoint} is not an http(s) endpoint` };
  }

  const startedAt = clock();
  let response: ProbeResponse;
  try {
    response = await get(url);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', why: why === '' ? 'the request failed' : why };
  }
  const latencyMs = Math.max(0, clock() - startedAt);

  if (response.status !== 200) {
    return { kind: 'failed', why: `answered ${response.status}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return { kind: 'failed', why: 'answered something that is not JSON' };
  }

  const genesis = bindingGenesis(parsed);
  if (genesis === null) {
    return { kind: 'failed', why: 'answered without a chain binding' };
  }
  if (genesis !== target.genesisHash) {
    // `disqualified`, NOT `failed` — see `ProbeOutcome`, and 10 §8.5.3. This endpoint answered
    // promptly and well-formed, and the answer proves it serves another chain. Routed through
    // `failed` it became `failing`, which serves, so **answering gained it the read eligibility
    // `unprobed` had withheld**. An R-6 review reproduced that against the built code on
    // 2026-08-07. Every other chain-identity mismatch in the doc set is terminal — §3.1's
    // `WrongChain` ("terminal, no override"), §6.3's range invalidation, §13.3's refusal — and
    // this one is now terminal with them.
    return {
      kind: 'disqualified',
      why: `describes genesis ${genesis}; this client is on ${target.genesisHash}`,
    };
  }

  return { kind: 'responded', latencyMs };
}

/** What a round was given, and what it hands back. */
export interface ProbeRound {
  readonly providers: readonly Provider[];
  /** Endpoint + chain per provider id. A provider absent from this map is never contacted. */
  readonly targets: ReadonlyMap<string, ProbeTarget>;
  /** Last probe time per provider id. Absent or `null` means never probed — due now (§8.3). */
  readonly lastProbeMs: ReadonlyMap<string, number | null>;
}

export interface ProbeRoundResult {
  readonly providers: readonly Provider[];
  readonly lastProbeMs: ReadonlyMap<string, number | null>;
  /** Which providers were actually contacted this round, for the disclosure surface (§8.1). */
  readonly probed: readonly string[];
}

/**
 * Run §8.3's *"on enable + every 10 min"* round.
 *
 * A caller ticks this; it decides per provider whether a probe is owed and issues only those. It
 * is a pure function of its inputs plus the injected transport and clock, so the scheduler that
 * drives it — a timer, a visibility change, an explicit refresh — is not this module's concern
 * and cannot be baked in.
 *
 * Three providers are skipped without a request, and each skip is a property rather than an
 * optimisation:
 *
 *  - **`disabled`** — the request is itself the §8.1 disclosure. See the module note.
 *  - **no endpoint** — §8.5.3 scopes the ladder to providers that have one.
 *  - **not due** — {@link probeDue}, which treats *never probed* as due now, so a source accepted
 *    a moment ago is probed on this tick rather than in ten minutes.
 */
export async function runProbeRound(
  round: ProbeRound,
  get: HttpGet,
  nowMs: number,
  clock: () => number,
  thresholds: LadderThresholds = LADDER,
): Promise<ProbeRoundResult> {
  const lastProbeMs = new Map(round.lastProbeMs);
  const probed: string[] = [];

  const providers = await Promise.all(
    round.providers.map(async (provider) => {
      if (provider.health.kind === 'disabled') return provider;
      const target = round.targets.get(provider.id);
      if (target === undefined) return provider;
      if (!probeDue(round.lastProbeMs.get(provider.id) ?? null, nowMs, thresholds)) return provider;

      const outcome = await probe(target, get, clock);
      lastProbeMs.set(provider.id, nowMs);
      probed.push(provider.id);
      return afterProbe(provider, outcome, thresholds);
    }),
  );

  return { providers, lastProbeMs, probed: probed.sort() };
}
