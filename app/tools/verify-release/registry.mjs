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
 */

export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** The populations §2.2 keeps apart, and the one it does not. */
export const POPULATIONS = Object.freeze(['release-signer', 'arns-controller', 'monitor-operator', 'attestor']);

/**
 * Pairs that MUST be disjoint, with the reason each exists. Data rather than branches,
 * because the reason is what a reviewer needs when the check fires — "these two roles
 * overlap" is not actionable, "one quorum could then ship and self-verify" is.
 */
export const DISJOINT_PAIRS = Object.freeze([
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
export function parseRegistry(document) {
  const entries = document?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RegistryError('the signer registry lists no entries; the disjointness check would compare nothing');
  }
  const seen = new Set();
  const parsed = [];
  for (const [index, entry] of entries.entries()) {
    const where = `entries[${index}]`;
    if (typeof entry?.id !== 'string' || entry.id.length === 0) {
      throw new RegistryError(`${where} has no id`);
    }
    if (!POPULATIONS.includes(entry.population)) {
      throw new RegistryError(`${where} (${entry.id}) declares population ${entry.population}`);
    }
    if (typeof entry.operator !== 'string' || entry.operator.trim().length === 0) {
      // Refused rather than skipped: an unmapped key is not a key outside the check, it is a
      // key the check cannot see — and §2.2's whole mechanism is the mapping.
      throw new RegistryError(
        `${where} (${entry.id}) names no operator. 12 §2.2 evaluates disjointness over ` +
          'natural persons; a key with no operator is invisible to the check rather than exempt from it.',
      );
    }
    const key = `${entry.population}:${entry.id}`;
    if (seen.has(key)) throw new RegistryError(`${entry.id} is listed twice in ${entry.population}`);
    seen.add(key);
    parsed.push({ id: entry.id, population: entry.population, operator: entry.operator.trim() });
  }
  return parsed;
}

/** Operators holding at least one identity in a population. */
export function operatorsIn(entries, population) {
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
export function checkDisjointness(entries) {
  const violations = [];
  const empty = [];
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
export function checkControllerQuorum(entries, threshold = 3, seats = 5) {
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
