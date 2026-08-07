/**
 * The local index's disclosure, on screen — 10 §6.3, §6.5, §9.2, §9.4; 15 §2 INV-FE-15. F25.
 *
 * ## There is no chain value on this surface, and therefore no badge
 *
 * Everything here is a fact about **this device's own storage**: how many rows a migration
 * emptied, which block spans a range covers, how many events are held undecoded. None of it is
 * a reading of chain state, so none of it carries a `VerificationStatus` and none of it may
 * pretend to. That is the same reasoning `shell.tsx`'s *not read yet* line already uses: the
 * six statuses of 10 §2.1 each describe an observation of the chain, and a count of local rows
 * is not a weak observation of the chain but not an observation of it at all.
 *
 * ## Why an empty copy slot is rendered rather than filled
 *
 * 10 §9.4 requires *"fixed user copy + expert detail + documented recovery per code; no
 * free-text errors"*. `FE-IDX-002` is in that taxonomy and is defined nowhere (SQ-604), it now
 * has two candidate emitters whose recoveries differ (SQ-783), and two further rows are open on
 * what a tier emptied outright may be called (SQ-820) and where that fact belongs in a query's
 * answer (SQ-821). A sentence written here would be a confident claim with no authority behind
 * it — the same defect the records themselves exist to prevent, one level up — and a ruling
 * would then have to *unwrite* it. So the record's own fields are rendered and the slot says
 * what it is waiting for.
 *
 * ## Placement
 *
 * 11 §11.2's screen inventory has **no row for this surface**, so it is not given an S-number
 * here: inventing one would put a screen in the client that the specification does not list,
 * and `app/tests/screens` binds that inventory to doc 11 in both directions. It is rendered as
 * shell furniture instead — a client-wide storage statement, which is what 10 §3.1 makes it by
 * placing `StorageOpen` in the boot machine rather than behind a screen. Whether §11.2 gains a
 * row, or §11.12's E9/E3 rows own the placement, is **SQ-920**.
 */

import { DataTable, Notice, Panel, type ReactNode } from '@bleavit/ui';

import {
  bootDisclosure,
  historyDisclosure,
  type DisclosureItem,
  type IndexBootState,
} from './index-disclosure.js';
import type { CoveredHistory } from '@bleavit/local-index';

/**
 * The words under a disclosure — or the marked absence of them.
 *
 * The `awaiting` arm renders the code and the open rows in the text a user sees, not only in an
 * attribute. A slot whose emptiness were visible to a developer alone would be indistinguishable
 * from a surface that had simply not been finished, and a user reading a list of dropped rows
 * with no sentence beside it would reasonably conclude the client had nothing to say about them.
 */
function DisclosureCopyLine({ item }: { readonly item: DisclosureItem }): ReactNode {
  if (item.copy.kind === 'stated') {
    return (
      <p className="disclosure__copy" data-cite={item.copy.cite}>
        {item.copy.text}
      </p>
    );
  }
  return (
    <p className="disclosure__copy disclosure__copy--awaiting" data-awaiting={item.copy.code}>
      This client has no settled wording for this yet, so it is showing the record instead of a
      sentence. The specification requires fixed wording and a stated remedy for {item.copy.code}{' '}
      and carries neither; what has to be decided is {item.copy.asks}. Open questions:{' '}
      {item.copy.questions.join(', ')}.
    </p>
  );
}

/**
 * One disclosure: the record's fields as a table, then its copy.
 *
 * The fields come first deliberately. They are the part that is true whatever the open rows are
 * ruled, and putting the sentence first would make the sentence the disclosure and the numbers
 * its supporting detail — which is backwards while the sentence is the half that does not exist.
 */
function Disclosure({ item }: { readonly item: DisclosureItem }): ReactNode {
  return (
    <div className="disclosure" data-disclosure={item.id}>
      <Notice severity={item.severity} heading={item.heading}>
        {item.facts.length === 0 ? null : (
          <DataTable
            caption={item.heading}
            headers={['What', 'Detail']}
            rows={item.facts.map((fact, index) => ({
              key: `${item.id}:${index}`,
              cells: [fact.label, fact.value],
            }))}
          />
        )}
        <DisclosureCopyLine item={item} />
      </Notice>
    </div>
  );
}

/**
 * What the boot check found — rendered on every route, because the index is not a screen.
 *
 * Never `null`: `bootDisclosure` returns at least one item for every arm of the state, including
 * the two where no index was opened. An index nothing looked at must not render as one that was
 * looked at and was fine, and rendering nothing is exactly how it would.
 */
export function IndexBootDisclosure({ state }: { readonly state: IndexBootState }): ReactNode {
  const items = bootDisclosure(state);
  return (
    <Panel title="Local history" tone="advanced">
      {items.map((item) => (
        <Disclosure key={item.id} item={item} />
      ))}
    </Panel>
  );
}

/**
 * What a history answer carries beside its rows — 10 §6.3 on the read path.
 *
 * Takes the whole `CoveredHistory<T>` rather than the three fields separately, so a caller
 * cannot hand it the rows and forget the labels: the container is what makes the sibling fields
 * unavoidable at the point the rows are reached.
 *
 * Renders `null` when there is nothing to disclose, which is the one case where silence is the
 * truth: no holes, nothing folded and nothing discarded means the answer really is complete
 * within the ranges beside it.
 */
export function CoveredHistoryDisclosure({
  history,
}: {
  readonly history: CoveredHistory<unknown>;
}): ReactNode {
  const items = historyDisclosure(history);
  if (items.length === 0) return null;
  return (
    <div className="covered-history">
      {items.map((item) => (
        <Disclosure key={item.id} item={item} />
      ))}
    </div>
  );
}
