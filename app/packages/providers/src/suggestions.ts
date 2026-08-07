/**
 * The curated provider suggestions — 10 §8.1; INV-FE-13. F9.
 *
 * > A curated suggestions file ships *inside the release* (auditable, not remote config);
 * > accepting a suggestion is an explicit user action with a disclosure of exactly what the
 * > operator learns (the addresses/objects you query).
 *
 * Three obligations in one sentence, and the middle one is what makes the other two checkable.
 *
 * ## In the release, which means a static import and nothing else
 *
 * INV-FE-13 forbids *"any remote-configuration channel: every provider suggestion, locale,
 * bootnode list, default and text ships inside the signed release"*. A suggestions **file** is
 * the exact artefact that invariant names, so the way it is loaded is the invariant rather than
 * an implementation detail: this module is a frozen `const`, reachable by `import`, with no
 * network call, no dynamic module load, no URL and no path. `app/tests/providers/suggestions.test.ts`
 * asserts that mechanically — the module's own source contains no network primitive — because
 * *"it is in the bundle"* is a claim about how it got there and the source is where that shows.
 *
 * A remote suggestions list would be worse than remote config generally: it is a channel that
 * chooses **who sees your queries**, delivered to a client whose whole provider design is built
 * on the user picking that party themselves.
 *
 * ## Curated is not enabled
 *
 * §8.1's first sentence still governs: *"the app ships an EMPTY provider list"*. A suggestion is
 * a name and an address the release vouches for having reviewed; it is not a provider. Nothing
 * here reaches {@link defaultProviders}, and {@link acceptSuggestion} is a function a user
 * action calls — it returns a `Provider`, it does not install one.
 *
 * ## The list is empty in this release, and that is a fact rather than a placeholder
 *
 * No third-party provider exists to curate: the chain has not launched, so there is no operator
 * whose endpoint could be reviewed, and naming one would be R-2 fabrication of exactly the kind
 * this repository refuses — an address a user would send their queries to, invented to make a
 * list look populated. What F9 owes is the **mechanism**: the type, the in-bundle load, the
 * disclosure, and the explicit accept. Adding rows later is a data change to this file, which is
 * a diff in the signed release — which is precisely the property §8.1 is asking for.
 */

import type { Provider } from './health.js';

/**
 * One reviewed provider, as the release vouches for it.
 *
 * Every field is required. An optional `operator` or `learns` would let a row ship without the
 * two things the disclosure is made of, and a disclosure assembled from missing parts is a
 * disclosure the user cannot act on.
 */
export interface ProviderSuggestion {
  /** Stable id. Becomes `Provider.id`, and ends up on every row this source ever supplies. */
  readonly id: string;
  readonly kind: 'snapshot' | 'indexer';
  /** What the user sees in the list. */
  readonly name: string;
  /** Who runs it, named plainly. "A community operator" is not an answer to *who learns this*. */
  readonly operator: string;
  /** Where it is. Displayed before acceptance, because the host is half of what is disclosed. */
  readonly endpoint: string;
  /** Why this release reviewed it, in the release's own words. */
  readonly why: string;
}

/**
 * The curated set. Frozen, in-bundle, empty in this release — see the module note.
 *
 * `Object.freeze` rather than a `readonly` type alone: the type stops a *compile-time* write and
 * this stops a runtime one, and the list is exactly the kind of value a screen is tempted to
 * sort or filter in place.
 */
export const SUGGESTED_PROVIDERS: readonly ProviderSuggestion[] = Object.freeze([]);

/**
 * §8.1's disclosure, as fixed copy.
 *
 * It states what the operator learns — *"the addresses/objects you query"* — in the terms a
 * user holds them: the account they are looking at, and which markets and proposals they open.
 * That is a linkage disclosure, and it is deliberately blunt about the part people underestimate:
 * the queries are a pattern over time, not a single lookup, and an operator sees all of them
 * from one place.
 *
 * The sentence about what the operator *cannot* do is here for accuracy, not reassurance. It is
 * the true bound — INV-FE-3 makes provider data structurally unable to satisfy a precondition —
 * and omitting it would leave a user weighing a privacy cost against an unstated risk, which is
 * how people decline something harmless and accept something that is not.
 *
 * ## The heartbeat sentence, added 2026-08-07 (F24, 10 §8.5.3)
 *
 * §8.1's obligation is *"exactly what the operator learns"*, and until F24 this copy described
 * **queries only** — which was complete while nothing drove §8.3's probe. It is not complete now.
 * The probe is a request every ten minutes for as long as the source stays enabled, sent whether
 * or not the user reads anything, and it discloses presence, uptime and IP continuity rather than
 * interest in any object. A user who read this copy and then went idle would reasonably believe
 * the operator stopped hearing from them. 14 TH-60 mitigates on the same footing, and its
 * mitigation column names the query linkage only, so the gap was in both places.
 */
export function disclosureFor(suggestion: ProviderSuggestion): string {
  return (
    `${suggestion.name} is run by ${suggestion.operator} at ${suggestion.endpoint}. If you turn ` +
    'it on, that operator sees which accounts, markets and proposals this device asks about, ' +
    'and it sees them over time rather than one at a time — together they identify you about as ' +
    'well as an address does. It also hears from this device every ten minutes while it stays ' +
    'on, even when you are reading nothing, because that is how the app checks it is still ' +
    'answering — so it learns when this device is switched on and roughly where it is. It never ' +
    'sees your keys and never sees a transaction before you ' +
    'sign it. What it supplies is older history, always labelled as coming from it, and never ' +
    'used to decide whether anything you sign is allowed. You can switch it off at any time, ' +
    'and switching it off stops the ten-minute check as well as the queries, ' +
    'and leaves the gaps it was filling visible as gaps.'
  );
}

/**
 * Accept one suggestion. The explicit user action §8.1 requires.
 *
 * Returns the `Provider` and the disclosure **together**, so a call site cannot enable a source
 * without holding the sentence it was supposed to have shown. That is the only enforcement
 * available to a pure function, and it is worth having: the alternative shape — `accept(id)` —
 * makes the disclosure a separate call somebody can forget, and a forgotten disclosure looks
 * exactly like a provider that was enabled correctly.
 *
 * The new provider starts **`unprobed`**, which is a state that cannot serve a read
 * ({@link canServeReads}) rather than one that merely says a probe is due. It started `healthy`
 * until 2026-08-06, and that was §8.3's *"health probe on enable"* implemented as a comment: the
 * source was described as healthy before anything asked it anything, so every read taken between
 * the user's click and the scheduler's first tick came from an endpoint that might not exist.
 * `probeDue(null, now)` answering `true` is not the control it looks like — it says a probe is
 * *due*, and nothing stops a caller reading first.
 *
 * It is not started in a `slow` or `failing` state either: an unprobed source has no observations
 * at all, and inventing a pessimistic one is as wrong as inventing an optimistic one. What
 * `unprobed` says is exactly what is true — nobody has asked yet, so nothing may be read from it.
 */
export function acceptSuggestion(suggestion: ProviderSuggestion): {
  readonly provider: Provider;
  readonly disclosure: string;
} {
  return {
    provider: { id: suggestion.id, kind: suggestion.kind, health: { kind: 'unprobed' } },
    disclosure: disclosureFor(suggestion),
  };
}
