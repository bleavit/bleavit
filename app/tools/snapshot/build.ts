/**
 * `app/tools/snapshot` — the snapshot producer, as a thin driver over the shared format.
 *
 * > **snapshots** (deterministic, canonically-serialized, content-addressed exports
 * > reproducible byte-identically by anyone from `tools/snapshot` against an archive node)
 * > — 10 §8.2
 *
 * It sits under `app/` because 10 §10.1 puts it there in as many words: the repository root
 * already has a `tools/release/` for chain-release tooling and the two must not be confused.
 *
 * ## It writes nothing of its own
 *
 * Serialization, the content pre-image and the fold all come from `@bleavit/providers` — the
 * module the *client* imports. A producer with its own serializer agrees on the day it is
 * written and diverges at the first field, and the symptom is every snapshot from that
 * producer failing its pin, which a user reads as a corrupt download. So this file contains no
 * JSON assembly, no hashing rule and no balance arithmetic; what it contains is ordering,
 * refusals, and the self-check below.
 *
 * ## The balances are a differential against chain state, not a restatement of the fold
 *
 * This is the design decision that makes the tool worth having. If the producer computed
 * `balances` by folding its own `ops`, §8.4's event↔derived-row screen could never fail on
 * anything this tool emits — the document would agree with itself by construction, and the
 * screen would be live only against a hostile publisher editing the file afterwards. The
 * failure that actually happens to a snapshot tool is an **incomplete op set**: a missed event
 * variant, a range the archive node answered short, a pallet whose events were not subscribed.
 * That produces a perfectly self-consistent document describing a history that is missing
 * movements, and folding-your-own-ops cannot see it.
 *
 * So {@link ArchiveExport} carries balances read **independently from chain state at
 * `range.toBlock`**, and the driver refuses to publish when the fold disagrees with them. The
 * chain is the oracle; the fold is the claim.
 *
 * ## It publishes nothing its own consumer would reject
 *
 * The last step runs `admitSnapshot` over the bytes it just produced, with the pin it just
 * computed. That is cheap and closes the loop through the client's own screens, so the tool
 * cannot ship a document that fails at the user — including for reasons this file does not
 * know about, which is the point of running the real consumer rather than a checklist of what
 * the consumer was believed to check.
 *
 * ## What is deliberately absent
 *
 * The **archive-node adapter**. This driver is pure over an injected {@link ArchiveExport}, and
 * the code that turns an archive node's RPC into one is not written here: doing it by
 * assumption is what R-2 forbids, and the client's own `chain-client` deliberately offers no
 * archive path (smoldot serves `chainHead` only — 10 §4.2). The CLI beside this file reads an
 * export produced elsewhere, so an operator with an archive reader in the documented shape can
 * produce a pinned snapshot today, and the missing piece is named rather than approximated.
 */

import {
  admitSnapshot,
  deriveBalances,
  isCanonicalAmount,
  serializeSnapshot,
  snapshotPreimage,
  type Sha256,
  type SnapshotBalance,
  type SnapshotDocument,
  type SnapshotOp,
  type SnapshotRange,
  type SnapshotVault,
  SNAPSHOT_FORMAT,
} from '@bleavit/providers';
import { byCodePoint, canonicalJson, type ChainBinding } from '@bleavit/handoff-envelope';

/**
 * Where a movement sits in the chain's own order.
 *
 * Required, and required to be complete, because the document has no ordering field: `ops` are
 * ordered by their position in the array and the conservation replay walks them in that order.
 * A merge before its split is a *different history* from the same pair the other way round —
 * an invalid one — so an exporter that emitted ops in whatever order its archive queries
 * resolved would produce a document that fails its own replay, intermittently, for reasons
 * that read as forgery.
 */
export interface ChainPosition {
  readonly block: number;
  readonly extrinsicIndex: number;
  readonly eventIndex: number;
}

export interface PositionedOp {
  readonly at: ChainPosition;
  readonly op: SnapshotOp;
}

/** What an archive reader hands the driver. */
export interface ArchiveExport {
  readonly binding: ChainBinding;
  /** The span the export set out to cover. */
  readonly range: SnapshotRange;
  /**
   * What the reader **actually observed**, which is not the same thing.
   *
   * A reader that fails part-way through a range and reports the requested span anyway
   * publishes a document claiming to have observed history it never saw — and that document
   * passes every screen, because the movements it does carry are consistent. It is a forgery
   * produced by accident, and the only place it can be prevented is here, at the boundary
   * where the difference is still known.
   */
  readonly observed: readonly SnapshotRange[];
  readonly vaults: readonly SnapshotVault[];
  readonly ops: readonly PositionedOp[];
  /** Read from chain state at `range.toBlock`, independently of `ops`. See the module note. */
  readonly balances: readonly SnapshotBalance[];
}

export class MalformedExport extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedExport';
  }
}

function field(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MalformedExport(`${where}: expected an object, got ${JSON.stringify(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function list(raw: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(raw)) {
    throw new MalformedExport(`${where}: expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function u32(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 0xffff_ffff) {
    throw new MalformedExport(`${where}: expected a u32, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function label(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new MalformedExport(`${where}: expected a non-empty string, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function money(raw: unknown, where: string): string {
  if (!isCanonicalAmount(raw)) {
    throw new MalformedExport(
      `${where}: an amount is a canonical decimal string, got ${JSON.stringify(raw)}. A JSON ` +
        'number here would be rounded past 2^53 by the reader and folded as the rounded value, ' +
        'with nothing thrown — the snapshot would then be quietly wrong about the largest ' +
        'positions in it (V-74).',
    );
  }
  return raw;
}

function range(raw: unknown, where: string): SnapshotRange {
  const record = field(raw, where);
  return {
    fromBlock: u32(record['fromBlock'], `${where}.fromBlock`),
    toBlock: u32(record['toBlock'], `${where}.toBlock`),
  };
}

/**
 * Validate an archive export at the boundary where operator input enters.
 *
 * TypeScript's types stop at compile time and this file's input is a JSON document somebody
 * else's reader produced, so the checks that matter are runtime ones. It is deliberately
 * separate from `parseSnapshot`: the export is a *different shape* — it carries chain positions
 * and observed ranges, neither of which appears in the published document — and reusing the
 * document parser here would mean either weakening it or pretending the two are one format.
 */
export function parseArchiveExport(raw: unknown): ArchiveExport {
  const root = field(raw, 'export');
  const bindingRaw = field(root['binding'], 'export.binding');
  const ops = list(root['ops'], 'export.ops').map((entry, i): PositionedOp => {
    const record = field(entry, `ops[${i}]`);
    const at = field(record['at'], `ops[${i}].at`);
    const opRaw = field(record['op'], `ops[${i}].op`);
    const kind = opRaw['kind'];
    const common = {
      block: u32(opRaw['block'], `ops[${i}].op.block`),
      vault: label(opRaw['vault'], `ops[${i}].op.vault`),
      account: label(opRaw['account'], `ops[${i}].op.account`),
      amount: money(opRaw['amount'], `ops[${i}].op.amount`),
    };
    const position: ChainPosition = {
      block: u32(at['block'], `ops[${i}].at.block`),
      extrinsicIndex: u32(at['extrinsicIndex'], `ops[${i}].at.extrinsicIndex`),
      eventIndex: u32(at['eventIndex'], `ops[${i}].at.eventIndex`),
    };
    if (kind === 'split' || kind === 'merge') return { at: position, op: { kind, ...common } };
    if (kind === 'transfer') {
      return {
        at: position,
        op: {
          kind,
          ...common,
          to: label(opRaw['to'], `ops[${i}].op.to`),
          branch: label(opRaw['branch'], `ops[${i}].op.branch`),
        },
      };
    }
    if (kind === 'redeem') {
      return {
        at: position,
        op: { kind, ...common, branch: label(opRaw['branch'], `ops[${i}].op.branch`) },
      };
    }
    throw new MalformedExport(
      `ops[${i}].op.kind: expected split, merge, transfer or redeem, got ${JSON.stringify(kind)}. ` +
        'The scalar, gate and Baseline instruments are outside bleavit.snapshot.v1; a range ' +
        'containing one cannot be published as a v1 snapshot, and the differential below is ' +
        'what stops an exporter silently dropping it instead.',
    );
  });
  return {
    binding: {
      genesisHash: label(bindingRaw['genesisHash'], 'binding.genesisHash'),
      specVersion: u32(bindingRaw['specVersion'], 'binding.specVersion'),
      contractVersion: u32(bindingRaw['contractVersion'], 'binding.contractVersion'),
    },
    range: range(root['range'], 'export.range'),
    observed: list(root['observed'], 'export.observed').map((entry, i) =>
      range(entry, `observed[${i}]`),
    ),
    vaults: list(root['vaults'], 'export.vaults').map((entry, i) => {
      const record = field(entry, `vaults[${i}]`);
      return {
        vault: label(record['vault'], `vaults[${i}].vault`),
        branches: list(record['branches'], `vaults[${i}].branches`).map((branch, j) =>
          label(branch, `vaults[${i}].branches[${j}]`),
        ),
      };
    }),
    ops,
    balances: list(root['balances'], 'export.balances').map((entry, i) => {
      const record = field(entry, `balances[${i}]`);
      return {
        vault: label(record['vault'], `balances[${i}].vault`),
        account: label(record['account'], `balances[${i}].account`),
        branch: label(record['branch'], `balances[${i}].branch`),
        amount: money(record['amount'], `balances[${i}].amount`),
      };
    }),
  };
}

export type BuildResult =
  | {
      readonly kind: 'built';
      readonly document: SnapshotDocument;
      /** Exactly the bytes to write. The pin addresses these. */
      readonly text: string;
      readonly pin: string;
    }
  | { readonly kind: 'refused'; readonly why: readonly string[] };

function holdingKey(row: SnapshotBalance): string {
  return canonicalJson([row.vault, row.account, row.branch]);
}

function orderPositions(left: ChainPosition, right: ChainPosition): number {
  return (
    left.block - right.block ||
    left.extrinsicIndex - right.extrinsicIndex ||
    left.eventIndex - right.eventIndex
  );
}

/**
 * Build a snapshot from one archive export.
 *
 * Refuses rather than throwing: a producer that cannot publish needs to say *what is wrong
 * with the export*, and an exception carries one reason where there are usually several.
 */
export function buildSnapshot(read: ArchiveExport, sha256: Sha256): BuildResult {
  const why: string[] = [];

  // --- ordering, which is the producer's whole contribution to byte-identical reproduction

  const vaults: SnapshotVault[] = read.vaults
    .map((vault) => ({ vault: vault.vault, branches: [...vault.branches].sort(byCodePoint) }))
    .sort((left, right) => byCodePoint(left.vault, right.vault));

  const positioned = [...read.ops].sort((left, right) => orderPositions(left.at, right.at));
  for (const [i, entry] of positioned.entries()) {
    if (entry.at.block !== entry.op.block) {
      why.push(
        `ops[${i}]: the movement says block ${entry.op.block} and its chain position says ` +
          `${entry.at.block}. One of the two is wrong and neither is safe to prefer.`,
      );
    }
    if (i === 0) continue;
    const previous = positioned[i - 1] as PositionedOp;
    if (orderPositions(previous.at, entry.at) === 0) {
      why.push(
        `ops[${i}]: two movements share chain position ` +
          `${entry.at.block}/${entry.at.extrinsicIndex}/${entry.at.eventIndex}. Their order is ` +
          'then undefined, and the replay is order-sensitive, so no tie-break here can be ' +
          'right — the export is wrong.',
      );
    }
  }

  // Coverage: sorted, then adjacent ranges joined, so one covered set has one spelling.
  const coverage: SnapshotRange[] = [];
  for (const range of [...read.observed].sort((left, right) => left.fromBlock - right.fromBlock)) {
    if (range.fromBlock > range.toBlock) {
      why.push(`observed range ${range.fromBlock}..${range.toBlock} is inverted`);
      continue;
    }
    const last = coverage[coverage.length - 1];
    if (last !== undefined && range.fromBlock <= last.toBlock + 1) {
      if (range.fromBlock <= last.toBlock) {
        why.push(
          `observed ranges ${last.fromBlock}..${last.toBlock} and ${range.fromBlock}..` +
            `${range.toBlock} overlap; a reader that observed a block twice has a defect, and ` +
            'silently merging it would hide that',
        );
        continue;
      }
      coverage[coverage.length - 1] = { fromBlock: last.fromBlock, toBlock: range.toBlock };
      continue;
    }
    coverage.push(range);
  }

  // --- the differential: the fold against an independent read of chain state

  const ops = positioned.map((entry) => entry.op);
  const folded = new Map(deriveBalances(vaults, ops).map((row) => [holdingKey(row), row]));
  const stated = new Map<string, SnapshotBalance>();
  for (const row of read.balances) {
    const key = holdingKey(row);
    if (stated.has(key)) {
      why.push(`the chain read states ${key} twice; a holding is one total`);
      continue;
    }
    stated.set(key, row);
  }
  for (const [key, row] of folded) {
    const chain = stated.get(key);
    if (chain === undefined) {
      why.push(
        `the movements leave ${key} holding ${row.amount}, and the chain read at block ` +
          `${read.range.toBlock} has no such holding — the export carries a movement the chain ` +
          'does not agree happened',
      );
    } else if (chain.amount !== row.amount) {
      why.push(
        `${key}: the movements produce ${row.amount}, the chain read at block ` +
          `${read.range.toBlock} says ${chain.amount}`,
      );
    }
  }
  for (const [key, row] of stated) {
    if (!folded.has(key)) {
      why.push(
        `the chain holds ${row.amount} for ${key} and no movement in this export produces it — ` +
          'the export is missing movements, which is the failure a self-folded balance sheet ' +
          'cannot see',
      );
    }
  }

  if (why.length > 0) return { kind: 'refused', why };

  // --- assemble, pin, and run the client's own screens over the result

  const document: SnapshotDocument = {
    format: SNAPSHOT_FORMAT,
    binding: read.binding,
    range: read.range,
    coverage,
    vaults,
    ops,
    // The chain's rows, ordered as the format requires. Identical to the fold by the check
    // above — taking them from the chain read rather than the fold keeps the document a
    // statement about chain state.
    balances: [...stated.values()].sort((left, right) =>
      byCodePoint(holdingKey(left), holdingKey(right)),
    ),
  };
  const text = serializeSnapshot(document);
  const pin = sha256(snapshotPreimage(document));

  const verdict = admitSnapshot(text, { expectedPin: pin, binding: read.binding }, sha256);
  if (verdict.kind === 'rejected') {
    return {
      kind: 'refused',
      why: verdict.findings.map((finding) => `[${finding.screen}] ${finding.why}`),
    };
  }
  return { kind: 'built', document, text, pin };
}
