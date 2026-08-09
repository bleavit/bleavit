/**
 * The signer registry and its disjointness check — 12 §2.2, F13.
 *
 * D-16's control, stated by 12 §2.2 as a requirement rather than a preference:
 * `ArNS controllers ∩ release signers = ∅`, **evaluated over natural persons, not key IDs**.
 * Without it, roughly three insiders holding two ANT shares and two release keys ship a
 * fully self-verifying malicious release; with it, that requires colluding across two
 * organizationally separated groups.
 *
 * ## The clause that decides whether this check does anything
 *
 * *Over natural persons.* A check that intersected **key identifiers** would pass
 * unconditionally and forever: a minisign key id is never also an Arweave address, so the
 * two sets are disjoint by construction and the checker would report success having compared
 * nothing. That is not a hypothetical failure mode — it is the obvious implementation, and
 * it is why §2.2 point 1 requires every key to be *mapped to a stable operator identifier*
 * before point 2 can mean anything.
 *
 * So this module refuses a registry entry with no operator, rather than skipping it. An
 * unmapped key is not a key outside the check; it is a key the check cannot see.
 *
 * ## Three populations, not two
 *
 * §2.2 adds a third: out-of-band attestation-monitor operators MUST NOT be ArNS controllers.
 * The monitor is §5.2's compensating control for a hostile service worker, and a controller
 * who also runs the monitor watching their own repoint is not an independent observer.
 * Attestors are release-side and may overlap the release signers.
 *
 * ## The residual, declared rather than hidden
 *
 * §2.2 records it: the mechanical check operates on **declared** identities, and one person
 * under two identities defeats it. That is an organizational-honesty limit with a threat row
 * of its own, and nothing in this file narrows it. What the file does is make the declaration
 * exist, be complete, and be checkable — which is the part that can be mechanized.
 *
 * ## Why an entry carries an organization, a generation and a revocation index
 *
 * Each of the three is a field some **other** rule of doc 12 counts, and each was the
 * caller's word until this registry carried it. That is the shape `releaseSignatureFrom`
 * already had to close once for `ReleaseSignature.valid`.
 *
 * - **organization.** §1.4 gate 2 counts attestations by *different organizations*, and
 *   `countAttestations` reads `Attestation.organization`. Nothing produced one. D-16's whole
 *   claim is that a malicious release needs collusion across two *organizationally* separated
 *   groups, so the organization is part of the declaration rather than a note beside it.
 * - **generation.** §2.1 tags every keyring by a monotonically increasing `u32`, and §1.4's
 *   floor counts keys *of the current keyring generation*. A registry listing every active
 *   key must therefore say which keyring each key is active in.
 * - **revocationIndex.** §2.3 revokes a key by setting its bit in `ReleaseChannel`, and
 *   [02](../../../docs/architecture/02-integration-contract.md) §12 defines `revoked_key_bits`
 *   as *a bitmask over key indices within the generation's published keyring*. A verifier
 *   holding those 64 bits and no index map cannot name a single revoked key, so §2.3 point 2
 *   is unimplementable without it. `tools/monitoring/attestation_monitor.py` requires the
 *   same field of its own keyring, which is what lets the two implementations agree.
 *
 * Only the two minisign populations carry a generation and a revocation index. An ANT
 * controller address belongs to no keyring and no bitmask, so declaring one for it would be
 * a claim §2.1 does not make — it is refused rather than ignored.
 */

import type { Keyring } from './verdict.ts';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** The populations §2.2 keeps apart, and the one it does not. */
export const POPULATIONS = Object.freeze([
  'release-signer',
  'arns-controller',
  'monitor-operator',
  'attestor',
] as const);

export type Population = (typeof POPULATIONS)[number];

/**
 * The two populations §2.1 describes as minisign keys, and therefore the two that belong to
 * a keyring generation and can be named by a `revoked_key_bits` index.
 */
export const KEYED_POPULATIONS: readonly Population[] = Object.freeze(['release-signer', 'attestor'] as const);

/** The width of `ReleaseChannel.revoked_key_bits` (02 §12), which bounds a revocation index. */
export const REVOCATION_BITS = 64;

/** Every field an entry may declare. An unknown one is refused — see `parseRegistry`. */
const ENTRY_KEYS = Object.freeze(['id', 'population', 'operator', 'organization', 'generation', 'revocationIndex']);

/** One declared identity: a key id or ANT address, its population, and who holds it. */
export interface RegistryEntry {
  readonly id: string;
  readonly population: Population;
  /** §2.2 point 1's stable operator identifier — a named person, or a role held by one. */
  readonly operator: string;
  /** The organization §1.4 gate 2 counts by and D-16 separates. Never derived from the name. */
  readonly organization: string;
  /** §2.1's keyring generation. Present exactly for `KEYED_POPULATIONS`. */
  readonly generation?: number | undefined;
  /** 02 §12's index into `revoked_key_bits`. Present exactly for `KEYED_POPULATIONS`. */
  readonly revocationIndex?: number | undefined;
}

export interface DisjointPair {
  readonly a: Population;
  readonly b: Population;
  readonly reason: string;
}

export interface DisjointnessViolation {
  readonly operator: string;
  readonly populations: readonly [Population, Population];
  readonly reason: string;
  readonly detail: string;
}

/** A pair that passes for want of members. A different claim, and not one a release rests on. */
export interface UnpopulatedPair {
  readonly pair: DisjointPair;
  readonly detail: string;
}

/**
 * Pairs that MUST be disjoint, with the reason each exists. Data rather than branches,
 * because the reason is what a reviewer needs when the check fires — "these two roles
 * overlap" is not actionable, "one quorum could then ship and self-verify" is.
 */
export const DISJOINT_PAIRS: readonly DisjointPair[] = Object.freeze([
  Object.freeze({
    a: 'release-signer',
    b: 'arns-controller',
    reason:
      'D-16: without it, ~3 insiders holding 2 ArNS shares and 2 release keys ship a fully ' +
      'self-verifying malicious release. With it, that requires colluding across two ' +
      'organizationally separated groups.',
  }),
  Object.freeze({
    a: 'monitor-operator',
    b: 'arns-controller',
    reason:
      '12 §5.2: the out-of-band monitor is the compensating control for a hostile service ' +
      'worker and for a hostile-but-consistent repoint. A controller who also runs the ' +
      'monitor watching their own repoint is not an independent observer.',
  }),
]);

/**
 * Parse the registry, refusing every shape that would make the check vacuous.
 *
 * `entries` are `{ id, population, operator }` — a key id or ANT address, which population it
 * belongs to, and the **stable operator identifier** §2.2 point 1 requires (a named person,
 * or a named organizational role held by a named person).
 */
export function parseRegistry(document: unknown): RegistryEntry[] {
  const entries = isRecord(document) ? document['entries'] : undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RegistryError('the signer registry lists no entries; the disjointness check would compare nothing');
  }
  const seen = new Set<string>();
  const bits = new Map<string, string>();
  const parsed: RegistryEntry[] = [];
  for (const [index, raw] of entries.entries()) {
    const where = `entries[${index}]`;
    const entry = isRecord(raw) ? raw : {};
    const id = entry['id'];
    const population = entry['population'];
    const operator = entry['operator'];
    const organization = entry['organization'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new RegistryError(`${where} has no id`);
    }
    // An unknown field is refused rather than ignored. A misspelled `organisation` would
    // otherwise leave the entry with no organization at all, and §1.4 gate 2 counts by that
    // field — so the silent reading of a typo is "this attestation is independent of none".
    for (const field of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(field)) {
        throw new RegistryError(`${where} (${id}) declares an unknown field ${field}`);
      }
    }
    if (!isPopulation(population)) {
      throw new RegistryError(`${where} (${id}) declares population ${String(population)}`);
    }
    if (typeof operator !== 'string' || operator.trim().length === 0) {
      // Refused rather than skipped: an unmapped key is not a key outside the check, it is a
      // key the check cannot see — and §2.2's whole mechanism is the mapping.
      throw new RegistryError(
        `${where} (${id}) names no operator. 12 §2.2 evaluates disjointness over ` +
          'natural persons; a key with no operator is invisible to the check rather than exempt from it.',
      );
    }
    if (typeof organization !== 'string' || organization.trim().length === 0) {
      throw new RegistryError(
        `${where} (${id}) names no organization. 12 §1.4 gate 2 counts attestations by ` +
          'organization and D-16 separates two organizationally distinct groups, so an entry ' +
          'without one cannot be shown independent of any other.',
      );
    }
    const keyed = KEYED_POPULATIONS.includes(population);
    const generation = readKeyedField(entry, 'generation', where, id, keyed, 0, Number.MAX_SAFE_INTEGER);
    const revocationIndex = readKeyedField(entry, 'revocationIndex', where, id, keyed, 0, REVOCATION_BITS - 1);

    const key = `${population}:${id}`;
    if (seen.has(key)) throw new RegistryError(`${id} is listed twice in ${population}`);
    seen.add(key);
    if (revocationIndex !== undefined) {
      // 02 §12 indexes `revoked_key_bits` into the generation's published keyring. Two keys
      // at one index means one bit names two keys, so revoking either revokes both — and a
      // verifier reading that bit cannot say which key the operator meant.
      const bit = `${String(generation)}#${String(revocationIndex)}`;
      const holder = bits.get(bit);
      if (holder !== undefined) {
        throw new RegistryError(
          `${id} and ${holder} both claim revocation index ${String(revocationIndex)} of keyring ` +
            `generation ${String(generation)}; one bit cannot name two keys`,
        );
      }
      bits.set(bit, id);
    }
    parsed.push({
      id,
      population,
      operator: operator.trim(),
      organization: organization.trim(),
      generation,
      revocationIndex,
    });
  }
  return parsed;
}

/**
 * Read `generation` or `revocationIndex`, which are required exactly for the minisign
 * populations and forbidden for the rest.
 *
 * Forbidden rather than ignored, for the same reason the unknown-field rule exists: an ANT
 * controller address carrying a keyring generation is a claim §2.1 does not make, and a
 * reader that dropped it would let the registry state something no rule can check.
 */
function readKeyedField(
  entry: Readonly<Record<string, unknown>>,
  field: 'generation' | 'revocationIndex',
  where: string,
  id: string,
  keyed: boolean,
  low: number,
  high: number,
): number | undefined {
  const value = entry[field];
  if (!keyed) {
    if (value !== undefined) {
      throw new RegistryError(
        `${where} (${id}) declares ${field}, which 12 §2.1 gives only to minisign keys; an ` +
          'ANT controller address and a monitor operator belong to no keyring generation.',
      );
    }
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new RegistryError(
      `${where} (${id}) must declare ${field} as an integer in ${String(low)}..${String(high)}`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPopulation(value: unknown): value is Population {
  return typeof value === 'string' && (POPULATIONS as readonly string[]).includes(value);
}

/** Operators holding at least one identity in a population. */
export function operatorsIn(entries: readonly RegistryEntry[], population: Population): Set<string> {
  return new Set(entries.filter((entry) => entry.population === population).map((entry) => entry.operator));
}

/**
 * §2.2 point 2, mechanically. Returns violations; the caller decides, so the same function
 * serves the release gate and the `signers audit` subcommand.
 *
 * Each pair is also checked for **being populated at all**: a disjointness check between an
 * empty set and anything passes, and passing because a population is empty is not the same
 * claim as passing because two populations do not overlap. The first is a launch blocker
 * (12 §4.2 prohibits single-key ANT custody outright), the second is the control working.
 */
export function checkDisjointness(entries: readonly RegistryEntry[]): {
  violations: DisjointnessViolation[];
  empty: UnpopulatedPair[];
} {
  const violations: DisjointnessViolation[] = [];
  const empty: UnpopulatedPair[] = [];
  for (const pair of DISJOINT_PAIRS) {
    const a = operatorsIn(entries, pair.a);
    const b = operatorsIn(entries, pair.b);
    if (a.size === 0 || b.size === 0) {
      empty.push({
        pair,
        detail:
          `${a.size === 0 ? pair.a : pair.b} has no declared operators, so this pair is ` +
          'disjoint for want of members rather than by separation — a different claim, and ' +
          'not one a release may rest on',
      });
      continue;
    }
    for (const operator of a) {
      if (b.has(operator)) {
        violations.push({
          operator,
          populations: [pair.a, pair.b],
          reason: pair.reason,
          detail: `${operator} holds identities in both ${pair.a} and ${pair.b}`,
        });
      }
    }
  }
  return { violations, empty };
}

/**
 * 12 §4.2's prohibition, which is about *counts* rather than overlap: single-key custody of
 * the production ANT is forbidden "under any circumstance, including temporarily during
 * bootstrap", and launch blocks if neither native n-of-m nor the FROST ceremony materialises.
 * Checked here because a registry is the only place it can be seen before a ceremony.
 */
/**
 * Turn `ReleaseChannel.revoked_key_bits` into the key ids `countReleaseSignatures` excludes.
 *
 * 02 §12 stores revocation as 64 bits over *key indices within the generation's published
 * keyring*, and `Keyring.revokedKeyIds` is a list of ids. Something has to be the index map,
 * and §2.2 point 1 makes the registry the published list of every active key. Without this
 * function a caller holding the on-chain bits would have to name the revoked keys itself,
 * which is the caller's word again — the defect `releaseSignatureFrom` closed for `valid`.
 *
 * Only keys of `generation` are considered. A bit set for an index no key of that generation
 * claims is **refused**: §2.3 sets a bit to invalidate a specific key, so a bit naming nobody
 * means the registry and the chain disagree about the keyring, and continuing would count a
 * key the operator may have meant to revoke.
 */
export function keyringFor(
  entries: readonly RegistryEntry[],
  generation: number,
  revokedKeyBits: bigint,
): Keyring {
  if (!Number.isInteger(generation)) {
    throw new RegistryError('a keyring generation is a u32 (12 §2.1), not ' + String(generation));
  }
  if (revokedKeyBits < 0n || revokedKeyBits >= 1n << BigInt(REVOCATION_BITS)) {
    throw new RegistryError(`revoked_key_bits is a u64 (02 §12); ${String(revokedKeyBits)} is outside it`);
  }
  const byIndex = new Map<number, string>();
  for (const entry of entries) {
    if (entry.generation !== generation || entry.revocationIndex === undefined) continue;
    byIndex.set(entry.revocationIndex, entry.id);
  }
  const revokedKeyIds: string[] = [];
  for (let index = 0; index < REVOCATION_BITS; index += 1) {
    if ((revokedKeyBits & (1n << BigInt(index))) === 0n) continue;
    const id = byIndex.get(index);
    if (id === undefined) {
      throw new RegistryError(
        `ReleaseChannel revokes index ${String(index)} of keyring generation ${String(generation)} and no ` +
          'declared key claims it. The registry and the chain disagree about which keyring is published.',
      );
    }
    revokedKeyIds.push(id);
  }
  return { generation, revokedKeyIds };
}

/**
 * The organization §1.4 gate 2 counts this key under, or `undefined` when the registry does
 * not list the key at all.
 *
 * `undefined` rather than a throw because the caller is counting credentials that arrived
 * from outside: an attestation signed by a key nobody declared is a *rejected* attestation
 * with a reason, which is what `countAttestations` already reports, and not an error that
 * stops the verdict.
 */
export function organizationOf(
  entries: readonly RegistryEntry[],
  population: Population,
  id: string,
): string | undefined {
  return entries.find((entry) => entry.population === population && entry.id === id)?.organization;
}

/**
 * The entry for a declared key, or `undefined`. Used where a caller needs the generation a
 * signature must be counted under, so that value comes from the published registry rather
 * than from whoever supplied the signature.
 */
export function entryFor(
  entries: readonly RegistryEntry[],
  population: Population,
  id: string,
): RegistryEntry | undefined {
  return entries.find((entry) => entry.population === population && entry.id === id);
}

export function checkControllerQuorum(
  entries: readonly RegistryEntry[],
  threshold = 3,
  seats = 5,
): string[] {
  const controllers = operatorsIn(entries, 'arns-controller');
  if (controllers.size === 0) return [`no ArNS controller is declared (12 §4.2 — launch blocks on this line)`];
  if (controllers.size < seats) {
    return [
      `${controllers.size} ArNS controller operator(s) declared; 12 §4.2 specifies ` +
        `${threshold}-of-${seats}, and single-key custody is prohibited under any circumstance`,
    ];
  }
  return [];
}
