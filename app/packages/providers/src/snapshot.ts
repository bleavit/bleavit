/**
 * The snapshot format, its content pin and its internal-consistency screens — 10 §8.2/§8.4. F9.
 *
 * > **snapshots** (deterministic, canonically-serialized, content-addressed exports
 * > reproducible byte-identically by anyone from `tools/snapshot` against an archive node)
 *
 * ## One module, both sides
 *
 * The producer (`app/tools/snapshot`) and the consumer (this client) must agree on *which
 * bytes are hashed*, byte for byte, or the pin is decoration. So the format lives here once
 * and the producer is a thin driver over it — the same single-generator discipline the vector
 * corpus, the quote-agreement fixture and the storage-key fixture already follow. A producer
 * with its own serializer would agree on the day it was written and diverge at the first
 * field, and the symptom would be *every* snapshot from that producer failing its pin, which
 * reads as a corrupt download.
 *
 * `canonicalJson`/`digestPreimage` come from `handoff-envelope` for the same reason they were
 * put there: 10 §13.1 gives the repository exactly one answer to *"which bytes"*, and a
 * second one here would be a second answer. The domain tag differs (`bleavit.snapshot.v1`),
 * which is what keeps a snapshot digest from ever validating a capsule.
 *
 * ## Amounts are strings, and that is not a style choice
 *
 * A `positionAmount` is `u128` base units. `JSON.parse` silently corrupts an integer past
 * 2^53 (V-74, measured on the 64.64 vector corpus), so a snapshot that wrote amounts as JSON
 * *numbers* would round them on load and then fail its own conservation replay for reasons
 * that look like a forgery. The wire form is a decimal string; the model is `bigint`; nothing
 * in between is a `number`.
 *
 * ## What these screens catch, and the one they do not
 *
 * §8.4 is explicit and the honest half is the load-bearing one: the screens catch **malformed,
 * internally inconsistent and shallow** forgeries. They do **not** catch a self-consistent
 * forgery of history at a depth the light client cannot reach. Everything below is written to
 * that boundary — `replayConservation` is a bookkeeping identity, so a forger who fabricates
 * a *complete and consistent* history passes it, by construction and by design. The corpus in
 * `app/tests/providers` contains such a document and asserts that it is **admitted**, because
 * a corpus that only contains documents we reject would be evidence for a guarantee this
 * mechanism declines to make ([14](14-threat-model.md) TH-50).
 */

import { byCodePoint, canonicalJson, digestPreimage, equalBinding } from '@bleavit/handoff-envelope';
import type { ChainBinding } from '@bleavit/handoff-envelope';

import { providerRefusal } from './refusals.js';
import type { ProviderRefusal } from './refusals.js';

/** The domain-separation tag. Distinct from every handoff tag — see the module note. */
export const SNAPSHOT_FORMAT = 'bleavit.snapshot.v1';

// ------------------------------------------------------------------ the document

/** A ledger movement, as exported. The alphabet is the 03 §5 one, and no larger. */
export type SnapshotOp =
  | { readonly kind: 'split'; readonly block: number; readonly vault: string; readonly account: string; readonly amount: string }
  | { readonly kind: 'merge'; readonly block: number; readonly vault: string; readonly account: string; readonly amount: string }
  | {
      readonly kind: 'redeem';
      readonly block: number;
      readonly vault: string;
      readonly account: string;
      readonly branch: string;
      readonly amount: string;
    };

/** A vault's branch set, frozen at creation. `split` mints one unit of every branch. */
export interface SnapshotVault {
  readonly vault: string;
  readonly branches: readonly string[];
}

/** A derived holding at `toBlock` — what the exporter claims the fold produces. */
export interface SnapshotBalance {
  readonly vault: string;
  readonly account: string;
  readonly branch: string;
  readonly amount: string;
}

/** A contiguous covered range. 10 §6.3's ranges, exported. */
export interface SnapshotRange {
  readonly fromBlock: number;
  readonly toBlock: number;
}

/**
 * The document.
 *
 * Everything here is hashed — there is no unhashed member and no place for one. A field
 * outside the pre-image is a field a publisher can change after the pin is quoted, and the
 * only honest way to have one is not to.
 */
export interface SnapshotDocument {
  readonly format: string;
  readonly binding: ChainBinding;
  readonly range: SnapshotRange;
  readonly coverage: readonly SnapshotRange[];
  readonly vaults: readonly SnapshotVault[];
  readonly ops: readonly SnapshotOp[];
  readonly balances: readonly SnapshotBalance[];
}

/**
 * The bytes the content pin is taken over.
 *
 * Returned rather than hashed, exactly as `digestPreimage` is: the primitive differs per
 * platform (`SubtleCrypto` in the browser, `createHash` in the producer) while the pre-image
 * — the part that must not vary — is one implementation.
 */
export function snapshotPreimage(document: SnapshotDocument): Uint8Array {
  return digestPreimage(SNAPSHOT_FORMAT, document);
}

/** The canonical serialization, for writing the file the pin describes. */
export function serializeSnapshot(document: SnapshotDocument): string {
  return canonicalJson(document);
}

// ------------------------------------------------------------------ the screens

/**
 * The classes §8.4 names, kept as distinct outcomes rather than one boolean.
 *
 * A single `valid: false` would make the forged corpus untestable *per class*, which is the
 * form 15 §4.8 asks for — and it is the difference between "we reject bad snapshots" and
 * knowing which screen is load-bearing when one of them regresses.
 */
export type SnapshotFinding =
  | { readonly screen: 'malformed'; readonly why: string }
  | { readonly screen: 'canonical'; readonly why: string }
  | { readonly screen: 'pin'; readonly why: string }
  | { readonly screen: 'binding'; readonly why: string }
  | { readonly screen: 'coverage'; readonly why: string }
  | { readonly screen: 'derived-rows'; readonly why: string }
  | { readonly screen: 'conservation'; readonly why: string };

export type SnapshotVerdict =
  | { readonly kind: 'admitted'; readonly document: SnapshotDocument }
  | { readonly kind: 'rejected'; readonly refusal: ProviderRefusal; readonly findings: readonly SnapshotFinding[] };

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * Whether a value is an amount in this format's wire form.
 *
 * Exported because the **producer** needs the same test at its own input boundary and needs it
 * to be the same test. `BigInt` is quietly permissive in both directions that matter here: it
 * accepts a `number`, so a JSON amount past 2^53 folds as its rounded value with nothing
 * thrown (V-74), and it accepts `"007"`, which folds correctly and then makes the finished
 * document fail its own `parseSnapshot`. A second copy of this rule in the tool would drift
 * from this one exactly when the format grew.
 */
export function isCanonicalAmount(raw: unknown): raw is string {
  return typeof raw === 'string' && DECIMAL.test(raw);
}

function amount(raw: unknown, where: string): bigint {
  if (!isCanonicalAmount(raw)) {
    throw new MalformedSnapshot(
      `${where}: an amount must be a canonical decimal string, got ${JSON.stringify(raw)}. ` +
        'Base units run past 2^53, so a JSON number here would be rounded on load and the ' +
        'document would then fail its own conservation replay.',
    );
  }
  return BigInt(raw);
}

class MalformedSnapshot extends Error {}

function u32(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 0xffff_ffff) {
    throw new MalformedSnapshot(`${where}: expected a u32 block height, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function text(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new MalformedSnapshot(`${where}: expected a non-empty string, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function array(raw: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(raw)) {
    throw new MalformedSnapshot(`${where}: expected an array, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function object(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MalformedSnapshot(`${where}: expected an object, got ${JSON.stringify(raw)}`);
  }
  return raw as Record<string, unknown>;
}

/**
 * Parse an untrusted document.
 *
 * Strict about **shape** and nothing else: this is the screen that must run before any other
 * one can be meaningful, and a screen that reasons about a field it has not typed is reading
 * whatever the publisher put there.
 *
 * It says nothing about unknown keys, and it does not have to. §8.2 does not merely ask for a
 * canonical *serializer* — it asks for exports *"reproducible byte-identically by anyone"*, so
 * being in canonical form is a property of the **file**, and {@link admitSnapshot} checks it
 * by round-trip. That check subsumes the unknown-key question and gives a better answer than a
 * key allowlist would: it also catches reordered keys, re-indented output, a transport that
 * re-serialized on the way through, and a producer whose serializer diverged from this one in
 * any respect at all — which is the property that actually has to hold, since the pin is
 * useless the moment two honest producers can emit different bytes for one history.
 */
export function parseSnapshot(raw: unknown): SnapshotDocument {
  const root = object(raw, 'document');
  if (root['format'] !== SNAPSHOT_FORMAT) {
    throw new MalformedSnapshot(
      `document.format: expected ${SNAPSHOT_FORMAT}, got ${JSON.stringify(root['format'])}`,
    );
  }
  const bindingRaw = object(root['binding'], 'document.binding');
  const binding: ChainBinding = {
    genesisHash: text(bindingRaw['genesisHash'], 'binding.genesisHash'),
    specVersion: u32(bindingRaw['specVersion'], 'binding.specVersion'),
    contractVersion: u32(bindingRaw['contractVersion'], 'binding.contractVersion'),
  };
  const rangeRaw = object(root['range'], 'document.range');
  const range: SnapshotRange = {
    fromBlock: u32(rangeRaw['fromBlock'], 'range.fromBlock'),
    toBlock: u32(rangeRaw['toBlock'], 'range.toBlock'),
  };
  const coverage = array(root['coverage'], 'document.coverage').map((entry, i) => {
    const record = object(entry, `coverage[${i}]`);
    return {
      fromBlock: u32(record['fromBlock'], `coverage[${i}].fromBlock`),
      toBlock: u32(record['toBlock'], `coverage[${i}].toBlock`),
    };
  });
  const vaults = array(root['vaults'], 'document.vaults').map((entry, i) => {
    const record = object(entry, `vaults[${i}]`);
    const branches = array(record['branches'], `vaults[${i}].branches`).map((branch, j) =>
      text(branch, `vaults[${i}].branches[${j}]`),
    );
    if (branches.length < 2) {
      throw new MalformedSnapshot(
        `vaults[${i}]: a vault has at least two branches; one branch is not a conditional ` +
          'instrument and its conservation identity is vacuous',
      );
    }
    return { vault: text(record['vault'], `vaults[${i}].vault`), branches };
  });
  const ops = array(root['ops'], 'document.ops').map((entry, i): SnapshotOp => {
    const record = object(entry, `ops[${i}]`);
    const kind = record['kind'];
    const block = u32(record['block'], `ops[${i}].block`);
    const vault = text(record['vault'], `ops[${i}].vault`);
    const account = text(record['account'], `ops[${i}].account`);
    const value = amount(record['amount'], `ops[${i}].amount`);
    if (value === 0n) {
      throw new MalformedSnapshot(
        `ops[${i}]: a zero-amount movement is not a movement. Admitting them would let a ` +
          'publisher pad a snapshot with rows that survive every screen and mean nothing.',
      );
    }
    if (kind === 'split' || kind === 'merge') {
      return { kind, block, vault, account, amount: record['amount'] as string };
    }
    if (kind === 'redeem') {
      return {
        kind,
        block,
        vault,
        account,
        branch: text(record['branch'], `ops[${i}].branch`),
        amount: record['amount'] as string,
      };
    }
    throw new MalformedSnapshot(
      `ops[${i}].kind: expected split, merge or redeem, got ${JSON.stringify(kind)}`,
    );
  });
  const balances = array(root['balances'], 'document.balances').map((entry, i) => {
    const record = object(entry, `balances[${i}]`);
    amount(record['amount'], `balances[${i}].amount`);
    return {
      vault: text(record['vault'], `balances[${i}].vault`),
      account: text(record['account'], `balances[${i}].account`),
      branch: text(record['branch'], `balances[${i}].branch`),
      amount: record['amount'] as string,
    };
  });
  return { format: SNAPSHOT_FORMAT, binding, range, coverage, vaults, ops, balances };
}

/**
 * §8.4's *monotone coverage* check.
 *
 * Three properties, and the third is the one a forger reaches for: ranges are ordered and
 * non-overlapping, they sit inside the declared span, and **every op falls inside a covered
 * range**. Without the third, a publisher declares coverage of blocks 1–100 and ships
 * movements at block 900 — history the document does not even claim to have observed,
 * imported as though it did.
 */
function checkCoverage(document: SnapshotDocument): readonly SnapshotFinding[] {
  const findings: SnapshotFinding[] = [];
  const { fromBlock, toBlock } = document.range;
  if (fromBlock > toBlock) {
    findings.push({ screen: 'coverage', why: `the declared span ${fromBlock}..${toBlock} is inverted` });
  }
  let previousEnd = -1;
  for (const range of document.coverage) {
    if (range.fromBlock > range.toBlock) {
      findings.push({ screen: 'coverage', why: `range ${range.fromBlock}..${range.toBlock} is inverted` });
      continue;
    }
    if (range.fromBlock <= previousEnd) {
      findings.push({
        screen: 'coverage',
        why:
          `range ${range.fromBlock}..${range.toBlock} starts at or before the previous range's ` +
          `end (${previousEnd}); coverage must be ordered and non-overlapping`,
      });
    }
    if (range.fromBlock < fromBlock || range.toBlock > toBlock) {
      findings.push({
        screen: 'coverage',
        why: `range ${range.fromBlock}..${range.toBlock} is outside the declared span ${fromBlock}..${toBlock}`,
      });
    }
    previousEnd = Math.max(previousEnd, range.toBlock);
  }
  const covered = (block: number): boolean =>
    document.coverage.some((range) => block >= range.fromBlock && block <= range.toBlock);
  for (const [i, op] of document.ops.entries()) {
    if (!covered(op.block)) {
      findings.push({
        screen: 'coverage',
        why: `ops[${i}] is at block ${op.block}, which no declared range covers`,
      });
    }
  }
  return findings;
}

interface Replay {
  /** vault → branch → outstanding supply */
  readonly supply: Map<string, Map<string, bigint>>;
  /** vault → account → branch → holding */
  readonly holdings: Map<string, Map<string, Map<string, bigint>>>;
  /** vault → escrowed collateral */
  readonly escrow: Map<string, bigint>;
  readonly findings: SnapshotFinding[];
}

function bump(into: Map<string, bigint>, key: string, delta: bigint): bigint {
  const next = (into.get(key) ?? 0n) + delta;
  into.set(key, next);
  return next;
}

function holdingsOf(replay: Replay, vault: string, account: string): Map<string, bigint> {
  let byAccount = replay.holdings.get(vault);
  if (byAccount === undefined) {
    byAccount = new Map();
    replay.holdings.set(vault, byAccount);
  }
  let byBranch = byAccount.get(account);
  if (byBranch === undefined) {
    byBranch = new Map();
    byAccount.set(account, byBranch);
  }
  return byBranch;
}

/**
 * §8.4's *conservation-identity replay*, over the 03 identities the exported alphabet reaches.
 *
 * Folded op by op, and checked **at every step rather than only at the end** — a forger who
 * drives an account negative and back again is exactly the case a final-state check waves
 * through, and the intermediate state is the one that could never have existed on chain.
 *
 * Three identities, all of them 03 §5's bookkeeping rather than anything about prices:
 *
 *  1. no account's holding of any branch is ever negative (03 §5.2: you cannot merge or
 *     redeem what you do not hold);
 *  2. no vault's escrow is ever negative, and every unit leaving escrow burns exactly one
 *     unit of some branch (I-1's conservation half);
 *  3. at every step, Σ over accounts of a branch's holdings equals that branch's supply —
 *     the identity a fabricated balance row cannot satisfy without a matching fabricated op.
 *
 * **What it deliberately does not assert** is I-1's *equality across branches*
 * (`supply[b] == escrow` for every `b`), which holds only until settlement: `redeem` burns the
 * winning branch alone, so after the first redemption the losing branches sit above escrow and
 * a check written the obvious way would report every settled vault as a forgery. Conservation
 * is the part of the identity that survives settlement, and it is the part a forger has to
 * work to satisfy.
 */
function replayConservation(document: SnapshotDocument): Replay {
  const replay: Replay = { supply: new Map(), holdings: new Map(), escrow: new Map(), findings: [] };
  const branchesOf = new Map(document.vaults.map((v) => [v.vault, v.branches]));
  for (const [i, op] of document.ops.entries()) {
    const branches = branchesOf.get(op.vault);
    if (branches === undefined) {
      replay.findings.push({
        screen: 'conservation',
        why: `ops[${i}] moves vault "${op.vault}", which the document does not declare`,
      });
      continue;
    }
    let supply = replay.supply.get(op.vault);
    if (supply === undefined) {
      supply = new Map(branches.map((branch) => [branch, 0n]));
      replay.supply.set(op.vault, supply);
    }
    const held = holdingsOf(replay, op.vault, op.account);
    const value = BigInt(op.amount);
    if (op.kind === 'split') {
      bump(replay.escrow, op.vault, value);
      for (const branch of branches) {
        bump(supply, branch, value);
        bump(held, branch, value);
      }
      continue;
    }
    if (op.kind === 'merge') {
      for (const branch of branches) {
        const remaining = bump(held, branch, -value);
        if (remaining < 0n) {
          replay.findings.push({
            screen: 'conservation',
            why:
              `ops[${i}] merges ${op.amount} of vault "${op.vault}" for an account holding less ` +
              `than that of branch "${branch}" (${remaining} after the movement)`,
          });
        }
        bump(supply, branch, -value);
      }
      const escrow = bump(replay.escrow, op.vault, -value);
      if (escrow < 0n) {
        replay.findings.push({
          screen: 'conservation',
          why: `ops[${i}] takes vault "${op.vault}" escrow negative (${escrow})`,
        });
      }
      continue;
    }
    if (!branches.includes(op.branch)) {
      replay.findings.push({
        screen: 'conservation',
        why: `ops[${i}] redeems branch "${op.branch}", which vault "${op.vault}" does not have`,
      });
      continue;
    }
    const remaining = bump(held, op.branch, -value);
    if (remaining < 0n) {
      replay.findings.push({
        screen: 'conservation',
        why:
          `ops[${i}] redeems ${op.amount} of branch "${op.branch}" for an account holding less ` +
          `than that (${remaining} after the movement)`,
      });
    }
    bump(supply, op.branch, -value);
    const escrow = bump(replay.escrow, op.vault, -value);
    if (escrow < 0n) {
      replay.findings.push({
        screen: 'conservation',
        why: `ops[${i}] takes vault "${op.vault}" escrow negative (${escrow})`,
      });
    }
  }
  // Identity 3, at the end of the fold: a branch's supply is exactly what its holders hold.
  for (const [vault, supply] of replay.supply) {
    const byAccount = replay.holdings.get(vault) ?? new Map<string, Map<string, bigint>>();
    for (const [branch, total] of supply) {
      let summed = 0n;
      for (const held of byAccount.values()) summed += held.get(branch) ?? 0n;
      if (summed !== total) {
        replay.findings.push({
          screen: 'conservation',
          why:
            `vault "${vault}" branch "${branch}": holders sum to ${summed} against a supply of ` +
            `${total} — the two are the same quantity counted two ways`,
        });
      }
    }
  }
  return replay;
}

/**
 * §8.4's *event↔derived-row agreement*.
 *
 * The exported `balances` are a **claim about the fold**, not an independent fact, so the
 * check is exact in both directions: a balance the ops do not produce is fabricated, and a
 * holding the ops produce with no balance row is an omission — and the omission direction is
 * the one that matters, because a snapshot that quietly drops a holder's rows renders that
 * account as holding nothing, which is a false statement about the chain rather than a
 * missing one.
 */
/**
 * A `(vault, account, branch)` triple as one map key.
 *
 * `JSON.stringify` of a tuple rather than a joined string, because **any separator character
 * can appear inside an account label**, and two holdings that collide on one key silently
 * become one row — in the screen whose entire job is to notice a missing row. The first draft
 * joined with a separator and the byte that reached disk was an invisible one (app-code rule
 * 14); removing the separator removes both defects at once.
 */
function holdingKey(vault: string, account: string, branch: string): string {
  return JSON.stringify([vault, account, branch]);
}

interface Holding {
  readonly vault: string;
  readonly account: string;
  readonly branch: string;
  readonly held: bigint;
}

function checkDerivedRows(document: SnapshotDocument, replay: Replay): readonly SnapshotFinding[] {
  const findings: SnapshotFinding[] = [];
  const claimed = new Map<string, { readonly row: SnapshotBalance; readonly amount: bigint }>();
  for (const [i, row] of document.balances.entries()) {
    const key = holdingKey(row.vault, row.account, row.branch);
    if (claimed.has(key)) {
      findings.push({
        screen: 'derived-rows',
        why: `balances[${i}] repeats ${row.vault}/${row.account}/${row.branch}; a derived row is a total, and two totals for one holding is not one`,
      });
      continue;
    }
    claimed.set(key, { row, amount: BigInt(row.amount) });
  }
  const derived = new Map<string, Holding>();
  for (const [vault, byAccount] of replay.holdings) {
    for (const [account, byBranch] of byAccount) {
      for (const [branch, held] of byBranch) {
        // A zero holding is the absence of a row, not a row saying zero — otherwise every
        // merged-out position would owe a row forever and two honest producers would disagree.
        if (held !== 0n) {
          derived.set(holdingKey(vault, account, branch), { vault, account, branch, held });
        }
      }
    }
  }
  for (const [key, holding] of derived) {
    const stated = claimed.get(key);
    if (stated === undefined) {
      findings.push({
        screen: 'derived-rows',
        why:
          `the movements leave ${holding.account} holding ${holding.held} of ` +
          `${holding.vault}/${holding.branch}, and no balance row states it`,
      });
    } else if (stated.amount !== holding.held) {
      findings.push({
        screen: 'derived-rows',
        why:
          `${holding.account}'s ${holding.vault}/${holding.branch}: the movements produce ` +
          `${holding.held}, the document states ${stated.amount}`,
      });
    }
  }
  for (const [key, stated] of claimed) {
    if (!derived.has(key)) {
      findings.push({
        screen: 'derived-rows',
        why:
          `balance row for ${stated.row.account}'s ${stated.row.vault}/${stated.row.branch} is ` +
          'not produced by any movement in this document',
      });
    }
  }
  return findings;
}

/**
 * §8.2's canonical form, for the arrays — the half canonical JSON cannot supply.
 *
 * `canonicalJson` sorts object **keys** and leaves array order exactly as given, so a document
 * whose `vaults` or `balances` arrive in one order from one producer and another order from a
 * second producer serializes to two different files describing one history. Both pass every
 * other screen. Both hash to a different pin. The published property — *"reproducible
 * byte-identically by anyone"* — is then simply false, and the way anyone would find out is a
 * user being told a correct snapshot is corrupt.
 *
 * So the order is a rule, and being a rule it is **checked** rather than documented: a rule two
 * producers must follow and nobody verifies is a rule they will diverge on.
 *
 * **`ops` is deliberately exempt.** Its order is the *chain's* — block, then extrinsic, then
 * event — which is semantic rather than presentational: the conservation replay checks
 * non-negativity at every step, so a merge before its split is a different (and invalid)
 * history than the same two the other way round. Sorting ops would destroy that and would let
 * an invalid history be reordered into a valid-looking one. Two honest producers reading one
 * chain already agree on it, which is what determinism requires; a producer that cannot supply
 * chain order cannot supply a snapshot.
 */
function checkCanonicalOrder(document: SnapshotDocument): readonly SnapshotFinding[] {
  const findings: SnapshotFinding[] = [];
  const ordered = (label: string, keys: readonly string[]): void => {
    for (let i = 1; i < keys.length; i += 1) {
      const previous = keys[i - 1] as string;
      const current = keys[i] as string;
      const order = byCodePoint(previous, current);
      if (order === 0) {
        findings.push({ screen: 'canonical', why: `${label}: "${current}" appears twice` });
      } else if (order > 0) {
        findings.push({
          screen: 'canonical',
          why:
            `${label}: "${current}" follows "${previous}", but this array is ordered by code ` +
            'point. Canonical JSON sorts keys and not array members, so two producers emitting ' +
            'one history in two orders would emit two files and two pins (10 §8.2)',
        });
      }
    }
  };
  ordered(
    'vaults',
    document.vaults.map((vault) => vault.vault),
  );
  for (const vault of document.vaults) ordered(`vaults["${vault.vault}"].branches`, vault.branches);
  ordered(
    'balances',
    document.balances.map((row) => canonicalJson([row.vault, row.account, row.branch])),
  );
  // Coverage is **maximally merged**: `checkCoverage` permits [1,10] beside [11,20] and also
  // permits [1,20], so without this rule one covered set has two legal spellings and two
  // honest producers emit two pins for one history — the same divergence as an unsorted array,
  // reached through a rule that was about truthfulness rather than form.
  for (let i = 1; i < document.coverage.length; i += 1) {
    const previous = document.coverage[i - 1] as SnapshotRange;
    const current = document.coverage[i] as SnapshotRange;
    if (current.fromBlock === previous.toBlock + 1) {
      findings.push({
        screen: 'canonical',
        why:
          `coverage: ${previous.fromBlock}..${previous.toBlock} and ${current.fromBlock}..` +
          `${current.toBlock} are adjacent and must be written as one range ` +
          `${previous.fromBlock}..${current.toBlock}; a covered set has one spelling`,
      });
    }
  }
  return findings;
}

/**
 * The fold, as the producer must perform it and the consumer replays it.
 *
 * Exported so `app/tools/snapshot` derives `balances` through **this** code rather than its
 * own: the producer's whole cross-check is that an independent read of chain state agrees with
 * the fold the *consumer* will run, and a producer that folded its own way would be comparing
 * the chain against an algorithm no client uses. Same single-generator discipline as the
 * serializer above, one layer up.
 *
 * Returns rows in the canonical order {@link checkCanonicalOrder} requires, so a producer
 * cannot emit a document that its own consumer rejects on ordering.
 */
export function deriveBalances(
  vaults: readonly SnapshotVault[],
  ops: readonly SnapshotOp[],
): readonly SnapshotBalance[] {
  const replay = replayConservation({
    format: SNAPSHOT_FORMAT,
    binding: { genesisHash: '', specVersion: 0, contractVersion: 0 },
    range: { fromBlock: 0, toBlock: 0 },
    coverage: [],
    vaults,
    ops,
    balances: [],
  });
  const rows: SnapshotBalance[] = [];
  for (const [vault, byAccount] of replay.holdings) {
    for (const [account, byBranch] of byAccount) {
      for (const [branch, held] of byBranch) {
        if (held !== 0n) rows.push({ vault, account, branch, amount: held.toString() });
      }
    }
  }
  return rows.sort((left, right) =>
    byCodePoint(
      canonicalJson([left.vault, left.account, left.branch]),
      canonicalJson([right.vault, right.account, right.branch]),
    ),
  );
}

/** A hash over the pre-image. Injected — see {@link admitSnapshot}. */
export type Sha256 = (preimage: Uint8Array) => string;

export interface SnapshotAdmission {
  /** The content pin obtained from the publisher, out of band. */
  readonly expectedPin: string;
  /** The chain this client is on. Exact equality, as every other Bleavit binding gate is. */
  readonly binding: ChainBinding;
}

/**
 * The only entry point that admits a snapshot.
 *
 * Takes the **file text**, not a parsed object, and that is the whole of the canonical-form
 * check: §8.2 asks for exports *"reproducible byte-identically by anyone"*, which is a claim
 * about bytes, and a function handed an already-parsed object could never evaluate it. A
 * consumer that parsed first and admitted whatever came out would accept two different files
 * for one history — at which point the content pin no longer addresses content.
 *
 * `sha256` is a **required argument**, not an option with a default, for the reason F20's
 * `admitIntent` made structural: an optional hash function is a content pin that defaults
 * off, and a pin that defaults off is indistinguishable from one that passed. The screens run
 * in a fixed order and all of them run — a rejected document reports **every** class it failed
 * rather than the first, because "this snapshot is malformed" and "this snapshot is malformed
 * *and* its balances are fabricated" are different facts about a publisher.
 *
 * Ordering note: the pin is checked **before** the substantive screens. Bytes the publisher
 * did not commit to describe a different document, and reporting a conservation failure in
 * unpinned bytes tells the user something about a file nobody claims authorship of. Same shape
 * as the release self-check running its chain-spec comparison before its genesis comparison
 * (F10).
 */
export function admitSnapshot(text: string, admission: SnapshotAdmission, sha256: Sha256): SnapshotVerdict {
  const findings: SnapshotFinding[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return reject([{ screen: 'malformed', why: `the file is not JSON: ${String(error)}` }]);
  }
  let document: SnapshotDocument;
  try {
    document = parseSnapshot(parsed);
  } catch (error) {
    if (error instanceof MalformedSnapshot) {
      return reject([{ screen: 'malformed', why: error.message }]);
    }
    throw error;
  }
  const canonical = serializeSnapshot(document);
  if (canonical !== text) {
    findings.push({
      screen: 'canonical',
      why:
        'this file is not in canonical form, so it is not a byte-identical reproduction of the ' +
        'history it describes (10 §8.2). Two producers of one history must emit one file; a ' +
        'reordered key, different spacing, an extra annotation or a transport that re-serialized ' +
        'on the way through all break that, and any of them makes the content pin address ' +
        'something other than these bytes.',
    });
  }
  const pin = sha256(snapshotPreimage(document));
  if (pin !== admission.expectedPin) {
    findings.push({
      screen: 'pin',
      why: `the file hashes to ${pin}; the publisher's pin is ${admission.expectedPin}`,
    });
  }
  if (!equalBinding(document.binding, admission.binding)) {
    findings.push({
      screen: 'binding',
      why:
        `this snapshot describes genesis ${document.binding.genesisHash} at spec ` +
        `${document.binding.specVersion}/contract ${document.binding.contractVersion}; this ` +
        `client is on ${admission.binding.genesisHash} at ${admission.binding.specVersion}/` +
        `${admission.binding.contractVersion}`,
    });
  }
  findings.push(...checkCanonicalOrder(document));
  findings.push(...checkCoverage(document));
  const replay = replayConservation(document);
  findings.push(...replay.findings);
  findings.push(...checkDerivedRows(document, replay));
  if (findings.length > 0) return reject(findings);
  return { kind: 'admitted', document };
}

function reject(findings: readonly SnapshotFinding[]): SnapshotVerdict {
  return {
    kind: 'rejected',
    refusal: providerRefusal(
      'FE-PROV-003',
      findings.map((finding) => `[${finding.screen}] ${finding.why}`).join('; '),
    ),
    findings,
  };
}

// ------------------------------------------------------------------ the two-snapshot diff

export interface SnapshotDisagreement {
  readonly key: string;
  readonly left: string | undefined;
  readonly right: string | undefined;
}

export type DiffVerdict =
  | { readonly kind: 'agree'; readonly overlap: SnapshotRange | undefined }
  | {
      readonly kind: 'disagree';
      readonly refusal: ProviderRefusal;
      readonly overlap: SnapshotRange;
      readonly disagreements: readonly SnapshotDisagreement[];
    };

/**
 * §8.4's only cross-check for depths the light client cannot reach: diff two independent
 * producers over the range they both claim.
 *
 * **It flags the pair, never a member.** The diff proves at least one is wrong and cannot say
 * which; a client that picked the "better" one — the newer, the larger, the one from the
 * publisher already enabled — would be manufacturing exactly the confidence §8.4 declines to
 * offer. So a disagreement leaves the disputed range as a labelled hole.
 *
 * Two snapshots with **no overlap** agree *vacuously*, and that is reported as `overlap:
 * undefined` rather than as a clean bill: two producers covering disjoint history have not
 * cross-checked anything, and "agree" with nothing compared is the shape a user reads as
 * confirmation. Comparing them anyway would be worse — every row of each would be missing
 * from the other and the pair would read as maximally contradictory.
 */
export function diffSnapshots(left: SnapshotDocument, right: SnapshotDocument): DiffVerdict {
  const fromBlock = Math.max(left.range.fromBlock, right.range.fromBlock);
  const toBlock = Math.min(left.range.toBlock, right.range.toBlock);
  if (fromBlock > toBlock) return { kind: 'agree', overlap: undefined };
  const overlap: SnapshotRange = { fromBlock, toBlock };
  const project = (document: SnapshotDocument): Map<string, string> => {
    const rows = new Map<string, string>();
    for (const op of document.ops) {
      if (op.block < fromBlock || op.block > toBlock) continue;
      const branch = op.kind === 'redeem' ? op.branch : '*';
      rows.set(JSON.stringify([op.block, op.kind, op.vault, op.account, branch]), op.amount);
    }
    return rows;
  };
  const leftRows = project(left);
  const rightRows = project(right);
  const disagreements: SnapshotDisagreement[] = [];
  for (const [key, value] of leftRows) {
    const other = rightRows.get(key);
    if (other !== value) disagreements.push({ key, left: value, right: other });
  }
  for (const [key, value] of rightRows) {
    if (!leftRows.has(key)) disagreements.push({ key, left: undefined, right: value });
  }
  if (disagreements.length === 0) return { kind: 'agree', overlap };
  return {
    kind: 'disagree',
    refusal: providerRefusal(
      'FE-PROV-004',
      `${disagreements.length} movement(s) differ over blocks ${fromBlock}..${toBlock}`,
    ),
    overlap,
    disagreements,
  };
}
