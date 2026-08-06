/**
 * S5, S6, S7 and S8 — the four core screens 11 §11.2 places behind *Advanced*. F7b.
 *
 * Every refusal, classification and required sentence was decided in `submit-proposal.ts`,
 * `execution-queue.ts`, `welfare-dashboard.ts` and `settlements.ts`. What a *rendering* can
 * still get wrong is narrower, and it is the same four mistakes:
 *
 * ## 1. A warning that is only shown when something else is wrong
 *
 * §11.5 P-10 ends with a **warning surfaced** obligation about two 10 % slashes, and the
 * note that the old "full refund" copy is removed. `SubmitProposal` renders it on the
 * **clean** path as well as the blocked one — which is the only path where it matters,
 * because a blocked form already says something is wrong and a clean one is where a user
 * decides to sign.
 *
 * ## 2. A blocked mandate presented as a dead one
 *
 * §11.5's `execute` row 5: a pre-grace `NotRatified` leaves the proposal `Queued` and
 * retryable, and the FE *"MUST NOT present a pre-grace failure as terminal"*. So
 * `ExecutionQueue` renders the same failing row with different severity and different copy
 * depending on `terminal`, and the ratification route stays offered.
 *
 * ## 3. A raw scalar dressed as a percentage
 *
 * 02 §4 forbids interpreting a `ParamView` scalar as a display unit, and the welfare
 * pillars are on the contract's **1e9** grid while `Ratio` renders parts per million — a
 * factor of a thousand, in the direction that makes a breached gate look healthy. So this
 * file renders pillars through `Datum` at `FIXED_DECIMALS` and parameters through `Count`,
 * and nothing on S7 goes through `Ratio` at all.
 *
 * ## 4. A window rendered as a history
 *
 * Both of S8's rings are FIFO. A full one rendered with no caveat says *"this is
 * everything"*, so `ringCaveat`'s sentence is rendered whenever it exists.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.2, §11.5
 */

import {
  Amount,
  BlockRef,
  Button,
  Count,
  DataTable,
  Datum,
  Field,
  Identifier,
  Notice,
  Panel,
  Phrase,
  Undecodable,
  formatBaseUnits,
  type ReactNode,
} from '@bleavit/ui';
import type { Verified } from '@bleavit/shared-types';
import {
  SUBMIT_SLASH_WARNING,
  checkSubmit,
  submitCaveat,
  withdrawProposalBlocks,
  type SubmitInputs,
  type WithdrawProposalInputs,
} from './submit-proposal.js';
import {
  executeChecks,
  mandateEnded,
  mayExecute,
  type ExecuteInputs,
  type ExecuteRow,
} from './execution-queue.js';
import {
  FIXED_DECIMALS,
  GATE_READING_COPY,
  RAW_SCALAR_NOTE,
  gatesOf,
  snapshotWindowFull,
  type WelfareDashboard as WelfareDashboardModel,
} from './welfare-dashboard.js';
import {
  BASELINE_BOOK_COPY,
  EXECUTION_OUTCOME_COPY,
  VOIDED_COHORT_COPY,
  ringCaveat,
  type BaselineBookState,
  type CohortRow,
  type SettlementsView,
} from './settlements.js';
import type { UndecodableRead } from './core-screen-reads.js';

/** A 1e9-grid fixed-point value, rendered exactly. Never through a ppm formatter. */
function Fixed({ datum, name }: { readonly datum: Verified<bigint>; readonly name?: string }) {
  return (
    <Datum
      datum={datum}
      {...(name === undefined ? {} : { name })}
      render={(value) => formatBaseUnits(value, FIXED_DECIMALS)}
    />
  );
}

/** A chain-read flag. `Verified<boolean>` has no datum component of its own by design. */
function Flag({
  datum,
  yes,
  no,
  name,
}: {
  readonly datum: Verified<boolean>;
  readonly yes: string;
  readonly no: string;
  readonly name?: string;
}) {
  return (
    <Datum
      datum={datum}
      {...(name === undefined ? {} : { name })}
      render={(value) => (value ? yes : no)}
    />
  );
}

/** What a field says when its read did not happen. Copy, never a substituted value. */
const UNREAD_FIELD = 'not read';

function UndecodableRows({ reads }: { readonly reads: readonly UndecodableRead[] }): ReactNode {
  return (
    <>
      {reads.map((read) => (
        <Undecodable key={read.label} label={read.label} rawHex={read.rawHex} reason={read.reason} />
      ))}
    </>
  );
}

// ------------------------------------------------------------------------- S5

export function SubmitProposal({
  inputs,
  decimals,
  symbol,
  undecodable = [],
  onSubmit,
}: {
  readonly inputs: SubmitInputs;
  readonly decimals: number;
  readonly symbol: string;
  readonly undecodable?: readonly UndecodableRead[];
  readonly onSubmit: () => void;
}): ReactNode {
  const check = checkSubmit(inputs);
  const caveat = submitCaveat(check);
  return (
    <Panel title="Submit a proposal">
      <Field label="Epoch phase">
        {inputs.phase === undefined ? UNREAD_FIELD : <Phrase datum={inputs.phase} />}
      </Field>
      <Field label="Intake queue">
        {inputs.intakeQueueLen === undefined ? (
          UNREAD_FIELD
        ) : (
          <Count datum={inputs.intakeQueueLen} name="entries" />
        )}
        <Count datum={inputs.maxIntakeQueue} name="of" />
      </Field>
      <Field label="Class bond">
        <Amount datum={inputs.classBond} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Funder’s free balance">
        <Amount datum={inputs.funderReads.freeBalance} decimals={decimals} symbol={symbol} />
      </Field>
      <Field label="Preimage">
        <Flag datum={inputs.preimage.noted} yes="noted on chain" no="not noted" name="bytes" />
        <Flag
          datum={inputs.preimage.requested}
          yes="pinned by request_preimage"
          no="not pinned"
          name="pin"
        />
      </Field>

      {/* Required by §11.5 P-10, and rendered on the clean path too. A user who is about
          to sign is exactly the reader this is for. */}
      <Notice severity="caution" heading="What happens to the bond">
        <ul>
          <li>{SUBMIT_SLASH_WARNING.preimageMissing}</li>
          <li>{SUBMIT_SLASH_WARNING.nonDecisionGrade}</li>
        </ul>
      </Notice>

      {check.blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      {/* Never only on the blocked path: a condition the client cannot read is a permanent
          property of the contract, and hiding it behind a green form is what turns the
          eventual dispatch error into "the client lied". */}
      {check.uncheckable.length === 0 ? null : (
        <Notice severity="caution" heading="A condition this client cannot check">
          <ul>
            {check.uncheckable.map((condition) => (
              <li key={condition.dispatchError}>
                <strong>{condition.dispatchError}</strong> — {condition.condition}. {condition.why}
              </li>
            ))}
          </ul>
          {check.blocks.length === 0 && caveat !== undefined ? caveat : null}
        </Notice>
      )}

      <UndecodableRows reads={undecodable} />

      <Button
        label="Submit proposal"
        intent="primary"
        onClick={onSubmit}
        disabled={check.blocks.length > 0}
        {...(check.blocks.length > 0
          ? { disabledReason: check.blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

export function WithdrawProposal({
  inputs,
  onWithdraw,
}: {
  readonly inputs: WithdrawProposalInputs;
  readonly onWithdraw: () => void;
}): ReactNode {
  const blocks = withdrawProposalBlocks(inputs);
  return (
    <Panel title="Withdraw this proposal">
      <Field label="State">
        <Phrase datum={inputs.state} />
      </Field>
      <Field label="Proposer">
        <Identifier datum={inputs.proposer} />
      </Field>
      <Field label="Funder">
        <Identifier datum={inputs.funder} />
      </Field>

      <Notice severity="info" heading="Who may withdraw">
        Either the proposer or the funder may withdraw this proposal before it qualifies.
        Restricting it to one of them would strand the other: the funder’s bond behind an
        abandoned proposal, or the proposal behind a funder who has stopped answering.
      </Notice>

      {blocks.map((block) => (
        <Notice severity="danger" heading={block.check} key={block.check}>
          {block.detail}
        </Notice>
      ))}

      <Button
        label="Withdraw"
        onClick={onWithdraw}
        disabled={blocks.length > 0}
        {...(blocks.length > 0
          ? { disabledReason: blocks.map((block) => block.check).join('; ') }
          : {})}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------------- S6

/** How a check's verdict is presented. `unread` is never dressed as a pass. */
const VERDICT_LABEL: Readonly<Record<ExecuteRow['verdict'], string>> = Object.freeze({
  pass: 'passes',
  fail: 'blocks',
  unread: 'not read',
});

export function ExecutionQueue({
  entry,
  inputs,
  onExecute,
}: {
  /** The queue row this screen is about, as read. */
  readonly entry: {
    readonly pid: Verified<string>;
    readonly klass: Verified<string>;
    readonly payloadHash: Verified<string>;
    readonly maturity: Verified<number>;
    readonly graceEnd: Verified<number>;
    readonly ratification: Verified<string>;
    readonly metersClear: Verified<boolean>;
  };
  readonly inputs: ExecuteInputs;
  readonly onExecute: () => void;
}): ReactNode {
  const rows = executeChecks(inputs);
  const blocking = rows.filter((row) => row.verdict !== 'pass');
  const ended = mandateEnded(inputs);
  return (
    <Panel title="Execution queue" subject={<Identifier datum={entry.pid} />}>
      <Field label="Class">
        <Phrase datum={entry.klass} />
      </Field>
      <Field label="Payload hash">
        <Identifier datum={entry.payloadHash} />
      </Field>
      <Field label="Window">
        <BlockRef datum={entry.maturity} name="matures" />
        <BlockRef datum={entry.graceEnd} name="grace ends" />
      </Field>
      <Field label="Ratification">
        <Phrase datum={entry.ratification} />
      </Field>
      <Field label="Rate meters">
        <Flag
          datum={entry.metersClear}
          yes="the chain reports the meters would admit this batch"
          no="the chain reports the meters would not admit this batch"
        />
      </Field>

      {/* The whole table, passing rows included: this is expected-against-actual for all
          fourteen checks (INV-FE-14), not a list of complaints. */}
      <DataTable
        caption="The fourteen checks execute performs at dispatch"
        headers={['#', 'Check', 'Verdict', 'Expected', 'Actual']}
        rows={rows.map((row) => ({
          key: `check-${row.id}`,
          cells: [
            String(row.id),
            row.check,
            `${VERDICT_LABEL[row.verdict]}${row.code === undefined ? '' : ` (${row.code})`}`,
            row.expected,
            row.actual,
          ],
        }))}
      />

      {/* Severity follows terminality, not merely failure. A pre-grace refusal is a wait,
          and presenting it in the same red box as a dead mandate is what makes a user stop
          pursuing the ratification that would still rescue it. */}
      {blocking.map((row) => (
        <Notice
          severity={row.terminal ? 'danger' : 'caution'}
          heading={`${row.id}. ${row.check}`}
          key={`blocking-${row.id}`}
        >
          {row.actual}
        </Notice>
      ))}

      {blocking.length > 0 && !ended ? (
        <Notice severity="info" heading="This mandate is blocked, not finished">
          Nothing above ends it. The proposal stays queued and can be executed by anyone as
          soon as the blocking conditions clear, up to the end of its grace window.
        </Notice>
      ) : null}

      <Button
        label="Execute"
        intent="primary"
        onClick={onExecute}
        disabled={!mayExecute(inputs)}
        {...(mayExecute(inputs)
          ? {}
          : { disabledReason: blocking.map((row) => `${row.id}. ${row.check}`).join('; ') })}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------------- S7

export function WelfareDashboard({
  dashboard,
  undecodable = [],
}: {
  readonly dashboard: WelfareDashboardModel;
  readonly undecodable?: readonly UndecodableRead[];
}): ReactNode {
  const { pillars } = dashboard;
  return (
    <Panel title="Welfare and constitution">
      <Panel title="Pillars">
        <Field label="Epoch">
          <Count datum={pillars.epoch} />
        </Field>
        <Field label="S — liveness">
          <Fixed datum={pillars.sPillar1e9} />
        </Field>
        <Field label="C — on-chain">
          <Fixed datum={pillars.cOnchain1e9} />
        </Field>
        <Field label="C — attested">
          <Fixed datum={pillars.cAttested1e9} />
        </Field>
        <Field label="P">
          <Fixed datum={pillars.pPillar1e9} />
        </Field>
        <Field label="A">
          <Fixed datum={pillars.aPillar1e9} />
        </Field>
        <Field label="Gate multiplier — S">
          <Fixed datum={pillars.gateS1e9} />
        </Field>
        <Field label="Gate multiplier — C">
          <Fixed datum={pillars.gateC1e9} />
        </Field>
        <Field label="W — composite">
          <Fixed datum={pillars.wCurrent1e9} />
        </Field>
        <Notice severity="info" heading="These are fixed-point values on the contract’s grid">
          Each is an exact value between zero and one. W is the product of the two gate
          multipliers and the P/A composite, so a low W is never explained by one figure
          alone.
        </Notice>
      </Panel>

      <Panel title="MetricSpec">
        {dashboard.activeSpec.available ? (
          <Field label="Active version">
            <Count datum={dashboard.activeSpec.version} />
          </Field>
        ) : (
          <Notice severity="caution" heading="No unique active MetricSpec">
            The chain reports that no single active MetricSpec is available for this epoch,
            so there is no version to show. A version number here would be an invention: the
            value the runtime carries in that state does not identify a spec.
          </Notice>
        )}
      </Panel>

      <Panel title="Daily gates">
        {gatesOf(dashboard).map((gate) => (
          <Notice
            severity={gate.reading === 'breached' ? 'danger' : 'info'}
            heading={`${gate.pillar} gate — ${gate.reading}`}
            key={`gate-${gate.pillar}`}
          >
            {GATE_READING_COPY[gate.reading]}
          </Notice>
        ))}
        <Field label="Reserve health">
          <Flag
            datum={dashboard.reserveFlag}
            yes="the reserve-health trigger is set"
            no="the reserve-health trigger is clear"
          />
        </Field>
      </Panel>

      <Panel title="Retained snapshots">
        <DataTable
          caption="Welfare snapshots retained on chain"
          headers={['Epoch', 'MetricSpec version', 'W']}
          rows={dashboard.snapshots.map((snapshot) => ({
            key: `${snapshot.epoch.value}:${snapshot.specVersion.value}`,
            cells: [
              <Count datum={snapshot.epoch} key={`e-${snapshot.epoch.value}-${snapshot.specVersion.value}`} />,
              <Count datum={snapshot.specVersion} key={`v-${snapshot.epoch.value}-${snapshot.specVersion.value}`} />,
              <Fixed datum={snapshot.w1e9} key={`w-${snapshot.epoch.value}-${snapshot.specVersion.value}`} />,
            ],
          }))}
        />
        {snapshotWindowFull(dashboard) ? (
          <Notice severity="info" heading="This is the retained window">
            The chain keeps a bounded number of snapshots and evicts the oldest. Earlier
            epochs existed; they are not on chain any more.
          </Notice>
        ) : null}
      </Panel>

      <Panel title="Constitution parameters" tone="advanced">
        <Notice severity="info" heading="Raw stored values">
          {RAW_SCALAR_NOTE}
        </Notice>
        <DataTable
          caption="Live constitution parameters and their amendment envelope"
          headers={['Key', 'Value', 'Min', 'Max', 'Next min', 'Next max', 'Cooldown', 'Class']}
          rows={dashboard.params.map((param) => ({
            key: param.key.value,
            cells: [
              <Phrase datum={param.key} key={`k-${param.key.value}`} />,
              <Count datum={param.value} key={`v-${param.key.value}`} />,
              <Count datum={param.min} key={`min-${param.key.value}`} />,
              <Count datum={param.max} key={`max-${param.key.value}`} />,
              <Count datum={param.minNext} key={`nmin-${param.key.value}`} />,
              <Count datum={param.maxNext} key={`nmax-${param.key.value}`} />,
              <Count datum={param.cooldownBlocks} key={`cd-${param.key.value}`} />,
              <Phrase datum={param.klass} key={`c-${param.key.value}`} />,
            ],
          }))}
        />
      </Panel>

      <UndecodableRows reads={undecodable} />
    </Panel>
  );
}

// ------------------------------------------------------------------------- S8

function CohortPanel({
  cohort,
  book,
}: {
  readonly cohort: CohortRow;
  readonly book: BaselineBookState;
}): ReactNode {
  return (
    <Panel title={cohort.kind === 'voided' ? 'Cohort — voided' : 'Cohort — settled'}>
      <Field label="Epoch">
        <Count datum={cohort.epoch} />
      </Field>
      <Field label="Settled at">
        <BlockRef datum={cohort.settledAt} />
      </Field>

      {cohort.kind === 'settled' ? (
        <>
          <Field label="Settlement score">
            <Fixed datum={cohort.s1e9} />
          </Field>
          <Field label="Baseline TWAP">
            <Fixed datum={cohort.baselineTwap1e9} />
          </Field>
        </>
      ) : (
        <Notice severity="caution" heading="No score was computed">
          {VOIDED_COHORT_COPY}
        </Notice>
      )}

      <Notice severity="info" heading="Baseline book">
        {BASELINE_BOOK_COPY[book]}
      </Notice>

      <DataTable
        caption="Decisions this cohort recorded"
        headers={['Proposal', 'Class', 'Outcome']}
        rows={cohort.proposals.map((proposal) => ({
          key: proposal.id.value,
          cells: [
            <Identifier datum={proposal.id} key={`p-${proposal.id.value}`} />,
            <Phrase datum={proposal.klass} key={`c-${proposal.id.value}`} />,
            <Phrase datum={proposal.outcome} key={`o-${proposal.id.value}`} />,
          ],
        }))}
      />
    </Panel>
  );
}

export function RecentSettlements({
  view,
  baselineBooks,
  undecodable = [],
}: {
  readonly view: SettlementsView;
  /** Per epoch, whether `BaselineMarketOf(epoch)` still resolves (§11.5, SQ-304). */
  readonly baselineBooks: Readonly<Record<number, BaselineBookState>>;
  readonly undecodable?: readonly UndecodableRead[];
}): ReactNode {
  const caveat = ringCaveat(view);
  // Hoisted out of JSX deliberately: a `.value` read reaching a child expression is what
  // `check-render-provenance` flags, and it is right to — the rule cannot tell a value used
  // as a condition from one about to be printed.
  const anyRolledBack = view.executions.some((record) => !record.succeeded.value);
  const failures = view.executions.filter((record) => record.failure !== undefined);
  return (
    <Panel title="Recent settlements">
      {caveat === undefined ? null : (
        <Notice severity="info" heading="This is a window, not the whole history">
          {caveat}
        </Notice>
      )}

      {view.cohorts.map((cohort) => (
        <CohortPanel
          cohort={cohort}
          book={baselineBooks[cohort.epoch.value] ?? 'reaped'}
          key={`cohort-${cohort.epoch.value}`}
        />
      ))}

      <Panel title="Execution records">
        <DataTable
          caption="Mandates the execution guard recorded"
          headers={['Proposal', 'Class', 'Block', 'Outcome']}
          rows={view.executions.map((record) => ({
            key: `${record.pid.value}:${record.executedAt.value}`,
            cells: [
              <Identifier datum={record.pid} key={`p-${record.pid.value}-${record.executedAt.value}`} />,
              <Phrase datum={record.klass} key={`c-${record.pid.value}-${record.executedAt.value}`} />,
              <BlockRef datum={record.executedAt} key={`b-${record.pid.value}-${record.executedAt.value}`} />,
              // The record exists either way, so the outcome is rendered from the record's
              // own field rather than implied by the row's presence.
              <Flag
                datum={record.succeeded}
                yes="succeeded"
                no="rolled back"
                key={`o-${record.pid.value}-${record.executedAt.value}`}
              />,
            ],
          }))}
        />
        {anyRolledBack ? (
          <Notice severity="caution" heading="Some of these rolled back">
            {EXECUTION_OUTCOME_COPY.failed}
          </Notice>
        ) : null}
        {failures
          .map((record) =>
            record.failure === undefined ? null : (
              <Field
                label="Failure"
                key={`f-${record.pid.value}-${record.executedAt.value}`}
              >
                <Phrase datum={record.failure} />
              </Field>
            ),
          )}
      </Panel>

      <UndecodableRows reads={undecodable} />
    </Panel>
  );
}
