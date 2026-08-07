/**
 * §8.4's import surface — progress, the eviction preview, and every refusal. F23.
 *
 * > Import quotas (≤ 400 MB uncompressed, ≤ 4 M rows, **streamed**, **eviction preview before
 * > import**) — unchanged. — 10 §8.4
 *
 * `importSnapshotStream` already makes the preview unskippable: `confirmEviction` is a required
 * dependency, so an import that cannot ask has no path to the mint. What was missing is the
 * screen that asks. This module is that screen plus the refusal surface for every arm the
 * importer can return.
 *
 * ## The preview is a question, except when there is nothing to decide
 *
 * `plan.infeasible` means evicting everything listed still leaves the import over budget. There
 * is no answer a user could give that changes it, and a confirm dialog for an impossible action
 * is a dialog that teaches people to click through. So {@link EvictionPreview} renders **no
 * confirm control at all** in that arm — the difference is structural rather than a disabled
 * button, because a disabled *Continue* still reads as *there is a way through this*.
 *
 * ## Four outcomes, three of which are not errors about the file
 *
 * `over-quota` is about this file's size; `rejected` is `FE-PROV-003` about the file's contents,
 * and may additionally carry `FE-PROV-002` about the **source** when the chain is what
 * disagreed; `declined` is the user's own decision or this device's budget and deliberately
 * carries **no** `FE-PROV-*` code — labelling it `FE-PROV-003` would tell somebody their file
 * was rejected when what happened is that they kept their own history. The screen preserves
 * that distinction instead of rendering one generic failure.
 *
 * A rejected import that also disabled the source renders **both** refusals. One of them is a
 * fact about the document and the other is a fact about the publisher, and a screen that showed
 * only the first would leave a source caught contradicting the chain still on the settings panel
 * with no explanation of why it stopped serving.
 *
 * ## The imported rows carry their badge from the mint
 *
 * Every balance arrives as a `Verified<ProviderBalanceRow>` whose status the mint fixed, so the
 * origin reaches the pixel (INV-FE-15) by being handed to a `ui` data component rather than by
 * this screen labelling anything. Nothing here constructs a status; there is no path from this
 * module to one.
 *
 * @see docs/architecture/10-frontend-architecture.md §8.4, §6.3
 * @see docs/architecture/15-invariants-and-testing.md §2 — INV-FE-3, INV-FE-15
 */

import { Button, DataTable, Datum, Notice, Panel, Refusal, type ReactNode } from '@bleavit/ui';
import {
  IMPORT_MAX_ROWS,
  IMPORT_MAX_UNCOMPRESSED_BYTES,
  type ImportOutcome,
  type ImportPlan,
  type MintedImport,
  type QuotaBounds,
  type QuotaState,
} from '@bleavit/providers';

import { ReachDisclosure } from './spot-check-reach.js';

/**
 * §8.4's two ceilings, said once so the progress line can be read against something.
 *
 * They are the **specification's** figures, not this device's bound: a caller may bound an
 * import further and never looser, so the progress line names both — what this device admitted
 * and what §8.4 allows at most.
 */
export const QUOTA_NOTE =
  `An import is limited to ${IMPORT_MAX_UNCOMPRESSED_BYTES} bytes and ${IMPORT_MAX_ROWS} rows, ` +
  'and this device may set a smaller limit than that. Both are checked while the file is being ' +
  'read rather than after: a limit checked at the end is a limit the memory has already been ' +
  'spent on.';

/**
 * What has been read so far, against the bound this device chose.
 *
 * The row figure is deliberately labelled as an **upper bound**. The streaming meter counts
 * JSON objects, which over-counts and never under-counts, and presenting it as an exact row
 * count would show a user a number that then falls when the document parses.
 */
export function ImportProgress({
  quota,
  bounds,
}: {
  readonly quota: QuotaState;
  readonly bounds: QuotaBounds;
}): ReactNode {
  return (
    <div className="import-progress" data-bytes={quota.bytes} data-rows={quota.rows}>
      <p className="import-progress__line">
        Read so far: {quota.bytes} of at most {bounds.maxBytes} bytes, and at most {quota.rows} of{' '}
        {bounds.maxRows} rows. The row figure is an upper bound while the file is still being
        read; the exact count is taken once the document parses.
      </p>
      <p className="import-progress__note">{QUOTA_NOTE}</p>
    </div>
  );
}

/**
 * §8.4's *"eviction preview before import"*.
 *
 * `copy` is the importer's own `previewCopy(plan)` and is passed through rather than rebuilt —
 * a second sentence describing the same eviction is how the screen and the refusal drift.
 */
export function EvictionPreview({
  plan,
  copy,
  onConfirm,
  onCancel,
}: {
  readonly plan: ImportPlan;
  readonly copy: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <Panel title="This import needs room" tone="advanced">
      <Notice
        severity={plan.infeasible ? 'danger' : 'caution'}
        heading={plan.infeasible ? 'It does not fit' : 'What would be deleted'}
      >
        {copy}
      </Notice>
      {plan.wouldEvict.length === 0 ? null : (
        <DataTable
          caption="Local data that would be deleted, oldest first"
          headers={['Table', 'Rows', 'Bytes', 'Through block']}
          rows={plan.wouldEvict.map((line) => ({
            key: line.table,
            cells: [line.table, String(line.rows), String(line.bytes), `#${line.throughBlock}`],
          }))}
        />
      )}
      {/* No confirm control on the infeasible arm — there is no decision to make. Rendering a
          disabled *Continue* would still read as a way through. */}
      {plan.infeasible ? null : (
        <Button label="Delete that and import" intent="danger" onClick={onConfirm} />
      )}
      <Button label={plan.infeasible ? 'Close' : 'Keep my history'} onClick={onCancel} />
    </Panel>
  );
}

/** The minted rows, each badged by the mint rather than by this screen. */
function MintedRows({ minted }: { readonly minted: MintedImport }): ReactNode {
  return (
    <>
      <p className="import-result__record">
        Imported from file {minted.record.id}, supplied by {minted.record.providerId}, covering
        blocks #{minted.record.fromBlock} to #{minted.record.toBlock}.
      </p>
      <DataTable
        caption="Holdings this file supplied"
        headers={['Vault', 'Account', 'Branch', 'Amount']}
        rows={minted.balances.map((row, at) => ({
          key: `${row.value.vault}:${row.value.account}:${row.value.branch}:${at}`,
          cells: [
            // Each cell is the row's own `Verified<T>`, so the badge comes from the status the
            // mint fixed. A screen-level label here would be the origin chosen by the renderer.
            <Datum key="vault" datum={row} render={(value) => value.vault} />,
            <Datum key="account" datum={row} render={(value) => value.account} />,
            <Datum key="branch" datum={row} render={(value) => value.branch} />,
            <Datum key="amount" datum={row} render={(value) => value.amount} />,
          ],
        }))}
      />
    </>
  );
}

/**
 * Every arm of `ImportOutcome`, rendered as what it is.
 *
 * The `switch` is exhaustive with a `never` default: an arm added to the importer fails to
 * compile here rather than falling through to whichever branch is last, which on this surface
 * would be a refusal rendered as a success or the reverse.
 */
export function ImportOutcomeView({ outcome }: { readonly outcome: ImportOutcome }): ReactNode {
  switch (outcome.kind) {
    case 'over-quota':
      return (
        <Panel title="This snapshot is too large to import" tone="advanced">
          {/* The meter's own copy. No sentence is composed here. */}
          <Notice severity="caution" heading={`Over the ${outcome.breach} limit`}>
            {outcome.message}
          </Notice>
          <p className="import-result__note">
            Nothing was imported and nothing local was deleted — the file was refused at the
            point it crossed the limit, before the rest of it was read.
          </p>
        </Panel>
      );
    case 'rejected':
      return (
        <Panel title="This snapshot was not imported" tone="advanced">
          <Refusal
            code={outcome.refusal.code}
            message={outcome.refusal.message}
            recovery={outcome.refusal.recovery}
            detail={outcome.refusal.detail}
          />
          {/* Two facts about two subjects. The second exists only when the **chain** is what
              disagreed, and omitting it would leave a publisher caught contradicting this
              device still serving every other screen with nothing saying why it stopped. */}
          {outcome.disabled === undefined ? null : (
            <Refusal
              code={outcome.disabled.code}
              message={outcome.disabled.message}
              recovery={outcome.disabled.recovery}
              detail={outcome.disabled.detail}
            />
          )}
          <DataTable
            caption="Which checks failed"
            headers={['Check', 'What it found']}
            rows={outcome.findings.map((finding, at) => ({
              key: `${finding.screen}-${at}`,
              cells: [finding.screen, finding.why],
            }))}
          />
        </Panel>
      );
    case 'declined':
      return (
        <Panel title="Nothing was imported" tone="advanced">
          {/* Deliberately no `FE-PROV-*` code: neither arm is an error about the snapshot. */}
          <Notice
            severity="info"
            heading={
              outcome.why === 'user'
                ? 'You kept your local history'
                : 'It does not fit on this device'
            }
          >
            {outcome.message}
          </Notice>
        </Panel>
      );
    case 'imported':
      return (
        <Panel title="Snapshot imported" tone="advanced">
          {/* The disclosure first. §8.4 states the depth limit as a **disclosure**, and a
              success panel that put it below the rows would announce a verification the pass
              may not have performed. */}
          <ReachDisclosure report={outcome.spotCheck} />
          <MintedRows minted={outcome.minted} />
        </Panel>
      );
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
