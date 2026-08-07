/**
 * §8.1's in-release suggestion list, and the accept interstitial it requires. F23.
 *
 * > A curated suggestions file ships *inside the release* (auditable, not remote config);
 * > accepting a suggestion is an explicit user action with a **disclosure of exactly what the
 * > operator learns** (the addresses/objects you query). — 10 §8.1
 *
 * F9 shipped the file, the disclosure and `acceptSuggestion`; nothing rendered any of them, so
 * the sentence *"with a disclosure"* had no surface to hold it. This is that surface, and the
 * whole of it is ordering: the disclosure must be **in front of** the control that accepts, and
 * a user must be able to decline from the same screen.
 *
 * ## The disclosure is derived, never a prop
 *
 * {@link AcceptInterstitial} takes the suggestion and calls `disclosureFor` itself. A
 * `disclosure` prop would be a sentence a caller supplies — at which point a caller can supply
 * a shorter one, an empty one, or the wrong suggestion's, and a forgotten disclosure looks
 * exactly like a source that was enabled correctly. The package's own `acceptSuggestion` uses
 * the same device one layer down by returning the provider and the disclosure **together**.
 *
 * ## An empty list is a statement, not an empty region
 *
 * `SUGGESTED_PROVIDERS` is empty in this release and that is a fact rather than a placeholder:
 * no operator exists to curate, and naming one would invent an address users send their queries
 * to. A screen that rendered nothing would read as a list that failed to load — which is the
 * one reading that invites a user to go and find a source somewhere else.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.1
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-13
 */

import { Button, DataTable, Notice, Panel, type ReactNode } from '@bleavit/ui';
import {
  SUGGESTED_PROVIDERS,
  acceptSuggestion,
  disclosureFor,
  type Provider,
  type ProviderSuggestion,
} from '@bleavit/providers';

/** Why this release's curated list is empty, said plainly rather than left as a blank panel. */
export const NO_SUGGESTIONS =
  'This release suggests no optional sources. That is not a list that failed to load: no ' +
  'third-party source has been reviewed for this chain yet, and naming one that had not been ' +
  'reviewed would be handing you an address to send your queries to on no evidence. Any source ' +
  'suggested here in future arrives as a change to the release you can read in the diff — it ' +
  'is never fetched, and Bleavit has no channel that could fetch one.';

/** What accepting costs, stated once above the per-suggestion disclosure. */
export const ACCEPT_MEANS =
  'Turning a source on tells that operator which accounts, markets and proposals this device ' +
  'asks about. It never speeds up anything you sign and it can never decide whether an action ' +
  'is allowed — what it supplies is older history, labelled as coming from it wherever it is ' +
  'shown.';

/**
 * The list. Renders each reviewed source with **the operator and the endpoint**, before any
 * accept control exists, because the host is half of what §8.1 says is disclosed.
 */
export function SuggestionList({
  suggestions = SUGGESTED_PROVIDERS,
  onReview,
}: {
  readonly suggestions?: readonly ProviderSuggestion[];
  /** Opens the interstitial. Deliberately not "accept": one click may not enable a source. */
  readonly onReview: (suggestion: ProviderSuggestion) => void;
}): ReactNode {
  return (
    <Panel title="Optional sources this release has reviewed" tone="advanced">
      {suggestions.length === 0 ? (
        <Notice severity="info" heading="None in this release">
          {NO_SUGGESTIONS}
        </Notice>
      ) : (
        <>
          <Notice severity="caution" heading="What turning one on means">
            {ACCEPT_MEANS}
          </Notice>
          <DataTable
            caption="Reviewed sources"
            headers={['Name', 'Kind', 'Run by', 'Address', 'Why it was reviewed', '']}
            rows={suggestions.map((suggestion) => ({
              key: suggestion.id,
              cells: [
                suggestion.name,
                suggestion.kind,
                suggestion.operator,
                suggestion.endpoint,
                suggestion.why,
                <Button
                  key={`${suggestion.id}-review`}
                  label="Read what this shares"
                  onClick={() => onReview(suggestion)}
                />,
              ],
            }))}
          />
        </>
      )}
    </Panel>
  );
}

/**
 * The interstitial — §8.1's *"explicit user action with a disclosure"*.
 *
 * The disclosure is rendered **before** the accept control in the markup, and the suite asserts
 * that by position rather than by presence: a disclosure below the button is one a user reaches
 * after deciding.
 *
 * `onAccept` receives what `acceptSuggestion` returns — the provider **and** the sentence that
 * was shown — so a caller storing the provider cannot fail to record what the user agreed to.
 */
export function AcceptInterstitial({
  suggestion,
  onAccept,
  onCancel,
}: {
  readonly suggestion: ProviderSuggestion;
  readonly onAccept: (accepted: {
    readonly provider: Provider;
    readonly disclosure: string;
  }) => void;
  readonly onCancel: () => void;
}): ReactNode {
  // Derived here. See the module note: a prop is a sentence a caller can get wrong.
  // `reads-only`, because it is true of this release: nothing here schedules `runProbeRound`, so
  // the operator hears from this device when the user reads and not otherwise. The provider panel
  // says the same thing in its own words. When a scheduler lands, this becomes `'probes'` and both
  // sentences change together — which is why the argument is required rather than defaulted.
  const disclosure = disclosureFor(suggestion, 'reads-only');
  return (
    <Panel title="Before you turn this on" subject={suggestion.name} tone="advanced">
      <Notice severity="caution" heading="What this operator will learn">
        {disclosure}
      </Notice>
      <p className="interstitial__state">
        A source you turn on starts as “not checked yet”. Bleavit reads nothing from it until it
        has answered a check, and this release does not yet run those checks — so it will stay
        that way. A snapshot file you already hold can still be imported: that path asks the
        operator nothing.
      </p>
      <Button
        label="Turn this source on"
        intent="primary"
        onClick={() => onAccept(acceptSuggestion(suggestion, 'reads-only'))}
      />
      <Button label="Not now" onClick={onCancel} />
    </Panel>
  );
}
