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
 *
 * ## The one screen that asks the chain
 *
 * {@link spotCheckSnapshot} is §8.4's *"deterministic spot re-derivation for the covered blocks
 * that fall inside light-client-reachable depth"*, and it is the only thing here that compares
 * the document against anything but itself. It is asynchronous and injected, so it lives beside
 * {@link admitSnapshot} rather than inside it; the streamed importer runs both in order.
 *
 * ## An admitted document is a branded value, not a boolean somebody checked
 *
 * {@link admitSnapshot} returns an {@link AdmittedSnapshot} whose brand this module alone can
 * write, and `mint.ts` takes that type. So *"nothing becomes a layer-3 row without passing every
 * screen"* is a property of the type system rather than a rule a call site is trusted to follow.
 */

import { byCodePoint, canonicalJson, digestPreimage } from '@bleavit/handoff-envelope';
import type { ChainBinding } from '@bleavit/handoff-envelope';

import { providerRefusal, snapshotRefusal } from './refusals.js';
import type { ProviderRefusal, SnapshotRejectionCause } from './refusals.js';

/** The domain-separation tag. Distinct from every handoff tag — see the module note. */
export const SNAPSHOT_FORMAT = 'bleavit.snapshot.v1';

// ------------------------------------------------------------------ the document

/**
 * A ledger movement, as exported.
 *
 * ## What v1 covers, and why the boundary is enforced rather than trusted
 *
 * The **branch-USDC complete-set alphabet** of 03 §5: `split` and `merge` (mint and burn a
 * complete set against escrow), `transfer` (`PositionTransferred` — a holding changes hands
 * with **no** escrow and **no** supply movement), and `redeem` (burn a winning branch at par).
 *
 * It does **not** cover the scalar, gate and Baseline instruments or their redemption variants
 * (`redeem_scalar`, `redeem_scalar_pair`, `redeem_gate`, `redeem_void`, `redeem_baseline*`).
 * Those are not simply more `kind` strings: their escrow movement is not equal to the amount
 * burned — `redeem_scalar` pays `floor(a·s)` and `redeem_void` `floor(a/2)` or `floor(a/4)` —
 * so a replay would need each vault's settlement value, which this document does not carry.
 * Widening the format to hold it is a v2, not a field.
 *
 * **The boundary is enforced at the producer, not assumed.** A missing movement is invisible to
 * every screen here — the remaining ops stay perfectly self-consistent — so a parser cannot
 * catch it. What catches it is `app/tools/snapshot`'s differential: `balances` are read from
 * chain state independently of the movements, so a range containing a movement v1 cannot
 * express fails to reconcile and the build **refuses**. That is the whole argument for reading
 * the balance sheet from the chain rather than folding the exporter's own ops.
 *
 * `transfer` is in v1 rather than deferred with the rest because omitting it makes the format
 * unable to encode *ordinary* history: after a transfer the terminal holder differs with no
 * escrow or supply change at all, so an exporter could only drop the event — and then the
 * balances fail replay — or misrepresent it as a split and a merge, which moves escrow that
 * never moved.
 */
export type SnapshotOp =
  | { readonly kind: 'split'; readonly block: number; readonly vault: string; readonly account: string; readonly amount: string }
  | { readonly kind: 'merge'; readonly block: number; readonly vault: string; readonly account: string; readonly amount: string }
  | {
      readonly kind: 'transfer';
      readonly block: number;
      readonly vault: string;
      readonly account: string;
      /** Who receives it. The movement is `account → to` of `branch`. */
      readonly to: string;
      readonly branch: string;
      readonly amount: string;
    }
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

/**
 * The same pre-image, from a serialization the caller already holds.
 *
 * `digestPreimage` serializes internally, so a consumer that has just produced the canonical
 * form in order to compare it against the file would otherwise build a second copy of it — at
 * the 400 MB import ceiling that duplicate is the difference between a slow import and a dead
 * tab. Asserted equal to {@link snapshotPreimage} in the corpus, because a second construction
 * of the pre-image is exactly the *"two answers to which bytes"* this module exists to avoid.
 */
export function preimageOfSerialized(canonical: string): Uint8Array {
  const encoder = new TextEncoder();
  const tag = encoder.encode(SNAPSHOT_FORMAT);
  const body = encoder.encode(canonical);
  const preimage = new Uint8Array(tag.length + 1 + body.length);
  preimage.set(tag, 0);
  // The NUL separator, written as a **byte** rather than inside a string. Typing it into
  // source puts a raw control character on disk: invisible in an editor, and it makes git
  // and grep treat the whole file as binary (app-code rule 14 — this function was written
  // that way first, and `grep preimageOfSerialized` on this file returned nothing at all).
  preimage[tag.length] = 0;
  preimage.set(body, tag.length + 1);
  return preimage;
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
  | { readonly screen: 'conservation'; readonly why: string }
  /** §8.4's *deterministic spot re-derivation* — see {@link spotCheckSnapshot}. */
  | { readonly screen: 'spot-check'; readonly why: string };

/**
 * The brand that makes "this document passed every screen" a thing a caller cannot assert.
 *
 * Declared here and **not exported**, so no module outside this one can name the field and
 * therefore no module outside this one can produce an `AdmittedSnapshot` by object literal,
 * spread or `satisfies`. Exactly the device 10 §2.1 uses for `Finalized<T>`, one layer down
 * and for a smaller claim: not *"the light client verified this"* but *"every §8.4 screen ran
 * over these bytes and none of them fired"*.
 *
 * It exists because {@link mintSnapshotRows} — the one place a document becomes layer-3 rows
 * — takes this type rather than a `SnapshotDocument`. Without the brand the mint's argument
 * is a structural shape any caller can build, and *"the mint is the only way an admitted
 * document becomes rows"* would be a comment rather than a property.
 */
declare const ADMITTED: unique symbol;

/** A document that passed {@link admitSnapshot}. Constructible only inside this module. */
export type AdmittedSnapshot = {
  readonly kind: 'admitted';
  readonly document: SnapshotDocument;
  readonly [ADMITTED]: true;
};

export interface RejectedSnapshot {
  readonly kind: 'rejected';
  readonly refusal: ProviderRefusal;
  readonly findings: readonly SnapshotFinding[];
}

export type SnapshotVerdict = AdmittedSnapshot | RejectedSnapshot;

/**
 * The wire form of an amount, as a pattern.
 *
 * Exported because the published JSON Schema for the producer's input format is **generated**
 * from it (`app/schemas/`), and a schema carrying its own copy of this regex would publish a
 * rule that agreed with {@link isCanonicalAmount} on the day it was written. The u128 bound the
 * function additionally applies is not expressible as a pattern, which the schema says in words
 * rather than leaving a reader to infer.
 */
export const CANONICAL_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/;

const DECIMAL = CANONICAL_AMOUNT_PATTERN;

/**
 * The chain's `Balance` ceiling.
 *
 * Written as a shift rather than the 39-digit literal: it is a **type width**, not a chain
 * tunable — there is no 02 §9 row, no `Params` key and nothing to read it from, the same
 * classification `packages/protocol`'s kernel constants carry (app-code rule 7).
 */
const MAX_BALANCE = (1n << 128n) - 1n;

/**
 * Whether a value is an amount in this format's wire form.
 *
 * Exported because the **producer** needs the same test at its own input boundary and needs it
 * to be the same test. `BigInt` is quietly permissive in three directions that matter here: it
 * accepts a `number`, so a JSON amount past 2^53 folds as its rounded value with nothing
 * thrown (V-74); it accepts `"007"`, which folds correctly and then makes the finished document
 * fail its own `parseSnapshot`; and it is **unbounded**, so a value at or above `2^128` parses,
 * conserves and reconciles perfectly while describing a quantity no chain event or balance can
 * hold. A second copy of this rule in the tool would drift from this one exactly when the
 * format grew.
 */
export function isCanonicalAmount(raw: unknown): raw is string {
  return typeof raw === 'string' && DECIMAL.test(raw) && BigInt(raw) <= MAX_BALANCE;
}

function amount(raw: unknown, where: string): bigint {
  if (!isCanonicalAmount(raw)) {
    throw new MalformedSnapshot(
      `${where}: an amount must be a canonical decimal string within the u128 Balance range, ` +
        `got ${JSON.stringify(raw)}. Base units run past 2^53, so a JSON number here would be ` +
        'rounded on load and the document would then fail its own conservation replay; and a ' +
        'value at or above 2^128 describes a quantity no chain event or balance can hold, ' +
        'while replaying and reconciling perfectly.',
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
    if (kind === 'transfer') {
      const to = text(record['to'], `ops[${i}].to`);
      if (to === account) {
        throw new MalformedSnapshot(
          `ops[${i}]: a transfer to the sending account is not a movement. Admitting one would ` +
            'let a publisher pad a snapshot with rows that survive every screen and mean nothing.',
        );
      }
      return {
        kind,
        block,
        vault,
        account,
        to,
        branch: text(record['branch'], `ops[${i}].branch`),
        amount: record['amount'] as string,
      };
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
      `ops[${i}].kind: expected split, merge, transfer or redeem, got ${JSON.stringify(kind)}. ` +
        'The scalar, gate and Baseline instruments are outside bleavit.snapshot.v1 — their ' +
        'escrow movement is not the amount burned, so a replay would need each vault\'s ' +
        'settlement value, which this document does not carry.',
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
    if (op.kind === 'transfer') {
      // `PositionTransferred` moves a holding and touches neither escrow nor supply — which is
      // exactly why the format needs it: expressing a transfer as a merge plus a split would
      // move escrow that never moved, and dropping it makes the balances fail their own replay.
      if (!branches.includes(op.branch)) {
        replay.findings.push({
          screen: 'conservation',
          why: `ops[${i}] transfers branch "${op.branch}", which vault "${op.vault}" does not have`,
        });
        continue;
      }
      const remaining = bump(held, op.branch, -value);
      if (remaining < 0n) {
        replay.findings.push({
          screen: 'conservation',
          why:
            `ops[${i}] transfers ${op.amount} of branch "${op.branch}" from an account holding ` +
            `less than that (${remaining} after the movement)`,
        });
      }
      bump(holdingsOf(replay, op.vault, op.to), op.branch, value);
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
 * **`ops` may not be sorted, and that is not the same as leaving it unchecked** — a distinction
 * an earlier version of this comment collapsed, and the collapse was a defect. Its order is the
 * *chain's* — block, then extrinsic, then event — which is semantic: the conservation replay
 * checks non-negativity at every step, so a merge before its split is a different, invalid
 * history rather than the same one written differently. Sorting would destroy that and would
 * let an invalid history be reordered into a valid-looking one.
 *
 * But §8.2 says *"Consumers check these on import"* of all three rules, and leaving this one
 * unchecked has a measured consequence: a document whose `ops` run block 13, 10, 12 is admitted,
 * the same history in block order is admitted, the two pins differ, and `diffSnapshots` of the
 * pair reports `disagree` with `FE-PROV-004` — which is exactly the failure this paragraph
 * exists to prevent, and it makes §8.2's *"reproducible byte-identically by anyone"* false for
 * any producer that is not this repository's own tool.
 *
 * So the **block-level consequence is checked** — `ops` must be non-decreasing in `block` — which
 * refuses the divergence without reordering anything. The finer half of chain order, extrinsic
 * then event, is **not checkable against this format**: `SnapshotOp` carries no
 * `extrinsicIndex` or `eventIndex`, though the producer computes both and discards them. A
 * consumer therefore cannot check the rule as §8.2 states it, which is a format question rather
 * than a code one (see the spec-question row) and is why this check is the block half alone.
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
  // §8.2's third rule, in the half this format can express. Not a sort: a document that is
  // out of block order is refused, never rewritten, so an invalid history cannot be reordered
  // into a valid-looking one.
  for (let i = 1; i < document.ops.length; i += 1) {
    const previous = document.ops[i - 1] as SnapshotOp;
    const current = document.ops[i] as SnapshotOp;
    if (current.block < previous.block) {
      findings.push({
        screen: 'canonical',
        why:
          `ops: entry ${i} is at block ${current.block} and follows block ${previous.block}. ` +
          'The movement list is in chain order (10 §8.2), so one history has one spelling; two ' +
          'orders would be two files and two pins, and every honest cross-check of the pair ' +
          'would raise FE-PROV-004',
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
  /**
   * The chain this client is on. **Only `genesisHash` is compared** — see {@link admitSnapshot}.
   *
   * The whole binding is carried rather than the hash alone so a caller passes the same
   * `ChainBinding` it holds everywhere else, and so the two unused members are visibly
   * *declined* here rather than absent from a type that could never have had them.
   */
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
 *
 * ## The chain binding is `genesisHash` only, and the narrowing is the correction
 *
 * This screen used `equalBinding`, whose exact `specVersion`/`contractVersion` equality
 * 10 §13.1 states **for the three handoff formats** — documents describing *one block*, where a
 * runtime the client cannot decode makes the document unreadable. §8 states no chain binding
 * for a snapshot at all, and a snapshot is the opposite shape: §6.4 assigns it *"deep history
 * beyond 30 days … by design, not by omission"*, which is history that necessarily predates the
 * current runtime. Under exact equality the **first runtime upgrade refuses every snapshot ever
 * published**, and it refuses them with `FE-PROV-003`, whose recovery told the user to check
 * their download — for a file that was never damaged.
 *
 * What a snapshot must still not be is a document about **another chain**: 10 §7 gives one
 * local database per chain identity, so importing one would file another network's history
 * under this one's. That is `genesisHash`, and it is the whole of the binding here.
 *
 * The two version fields are not silently dropped: they stay on the admitted document, where a
 * caller reads them and renders the difference as an advisory line. A screen is a refusal, and
 * a version difference is not a reason to refuse. Filed as PLAN.md · *Spec questions* SQ-610,
 * because whether §8 wants a binding at all — and which fields — is 10's to say, not this
 * module's; the conservative reading is in force until it answers.
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
  const inCanonicalForm = canonical === text;
  if (!inCanonicalForm) {
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
  // Hash the serialization already in hand rather than building a third one. For any document
  // that can be admitted the canonical form *is* the file, so `canonical` and a fresh
  // `serializeSnapshot` inside `digestPreimage` are the same string — and at the 400 MB import
  // ceiling an avoidable duplicate of it is the difference between a slow import and a dead
  // tab. See the memory note on {@link admitSnapshot}.
  const pin = sha256(preimageOfSerialized(canonical));
  if (pin !== admission.expectedPin) {
    findings.push({
      screen: 'pin',
      why: `the file hashes to ${pin}; the publisher's pin is ${admission.expectedPin}`,
    });
  }
  if (document.binding.genesisHash !== admission.binding.genesisHash) {
    findings.push({
      screen: 'binding',
      why:
        `this snapshot describes genesis ${document.binding.genesisHash}; this client is on ` +
        `${admission.binding.genesisHash}`,
    });
  }
  findings.push(...checkCanonicalOrder(document));
  findings.push(...checkCoverage(document));
  const replay = replayConservation(document);
  findings.push(...replay.findings);
  findings.push(...checkDerivedRows(document, replay));
  if (findings.length > 0) return reject(findings);
  // The one construction site of the brand. An assertion rather than a literal because the
  // phantom field has no runtime representation and cannot be written — same shape, and the
  // same single-site discipline, as `chain-client`'s `Finalized<T>` mint (10 §2.1).
  return { kind: 'admitted', document } as AdmittedSnapshot;
}

/**
 * Which fixed remediation `FE-PROV-003` leads with, chosen from the findings.
 *
 * Precedence, and it is not arbitrary: **wrong chain wins**, because a document about another
 * network will also fail whichever substantive screens happen to notice, and telling the user
 * about a conservation defect in a file that was never about their chain sends them to the
 * publisher with the wrong complaint. **Chain disagreement is next**, because a document that
 * is internally consistent and contradicts the chain is the one case where the remediation is
 * *do not trust this publisher* rather than *download it again*. Everything else is `integrity`.
 */
function causeOf(findings: readonly SnapshotFinding[]): SnapshotRejectionCause {
  if (findings.some((finding) => finding.screen === 'binding')) return 'wrong-chain';
  if (findings.some((finding) => finding.screen === 'spot-check')) return 'chain-disagreement';
  return 'integrity';
}

function reject(findings: readonly SnapshotFinding[]): RejectedSnapshot {
  return {
    kind: 'rejected',
    refusal: snapshotRefusal(
      causeOf(findings),
      findings.map((finding) => `[${finding.screen}] ${finding.why}`).join('; '),
    ),
    findings,
  };
}

/**
 * Reject a document that passed the file screens and then failed a chain comparison.
 *
 * Exported because {@link spotCheckSnapshot} runs **after** admission — it is asynchronous and
 * `admitSnapshot` is not — so the streamed importer needs to produce the same refusal shape
 * from findings raised outside this function. It is the same `reject`, not a second one.
 */
export function rejectSnapshot(findings: readonly SnapshotFinding[]): RejectedSnapshot {
  return reject(findings);
}

// ------------------------------------------------------- §8.4's deterministic spot re-derivation

/**
 * How many covered blocks one re-derivation pass compares.
 *
 * A **release constant**, and a bound on work rather than on trust: a snapshot may cover
 * millions of blocks and the light client can serve a few hundred, so an unbounded walk would
 * spend the whole budget asking about history nothing can answer for. The pass walks **downward
 * from the newest covered block**, which is where the pinned window is (10 §4.2), so the bound
 * is spent on exactly the blocks that can be answered.
 *
 * It is not a sampling rate and deliberately not drawn at random: §8.4 says *"deterministic"*,
 * and determinism is what makes a rejected snapshot reproducible for the publisher who has to
 * fix it. Sampling here would also buy nothing — the window is the *whole* set of blocks the
 * client can check, so checking a random subset of it would be strictly less evidence for the
 * same number of reads.
 */
export const SPOT_CHECK_MAX_BLOCKS = 128;

/** What the document claims happened at one block, as the checker will compare it. */
export interface SpotClaim {
  readonly block: number;
  /**
   * Every movement the document places at this block, canonically projected, in chain order.
   *
   * **Empty is a claim too**, and it is the one that matters: a covered block with no
   * movements is the document asserting that nothing happened there. A checker handed only
   * the blocks that carry movements could never catch an omission, which is the forgery a
   * publisher produces by *deleting* rather than by inventing.
   */
  readonly movements: readonly string[];
}

export type SpotVerdict =
  /** The chain agrees, movement for movement, in order. */
  | { readonly kind: 'agrees' }
  /** The chain says something else. `derived` is what this device read. */
  | { readonly kind: 'disagrees'; readonly derived: readonly string[] }
  /** Outside light-client-reachable depth (§8.4's own condition). Evidence of nothing. */
  | { readonly kind: 'out-of-reach' };

/**
 * Re-derive one covered block from chain state.
 *
 * Injected, in the same shape {@link RowCheck} already uses and for the same structural reason:
 * `packages/providers` may not open a chain connection (10 §4.1), so the module that decides
 * **which** blocks to re-derive cannot be the module that knows **how**. It also keeps the
 * comparison honest — the checker returns what *it* read, and this module never learns a way to
 * produce a chain value of its own.
 */
export type SnapshotSpotCheck = (claim: SpotClaim) => Promise<SpotVerdict>;

export interface SpotCheckReport {
  /** Blocks the chain actually answered for. */
  readonly compared: number;
  /** Blocks the light client could not reach. Not a pass and not a failure. */
  readonly outOfReach: number;
  readonly findings: readonly SnapshotFinding[];
}

/**
 * §8.4's *"deterministic spot re-derivation for the covered blocks that fall inside
 * light-client-reachable depth"*.
 *
 * This is the one screen in this module that compares the document against **the chain** rather
 * than against itself, and it is a named mitigation in 14 TH-50. Everything else here is
 * internal consistency, which a competent forger satisfies by construction; a shallow forgery —
 * one inside the window the client can still read — is precisely what internal consistency
 * cannot see and this can.
 *
 * Two properties are load-bearing:
 *
 * 1. **The claim carries the block's whole movement list, including when it is empty.** A
 *    checker asked *"is this movement real"* can only catch fabrication. Asked *"is this the
 *    complete set at this block"* it catches deletion too, and deletion is the cheaper forgery:
 *    a publisher who drops one `redeem` produces a document that replays, reconciles and pins
 *    perfectly while overstating a holder's balance forever.
 * 2. **`out-of-reach` is neither a pass nor a failure.** The report counts it separately, and a
 *    caller that treated a wholly-out-of-reach pass as clean would be reporting §8.4's stated
 *    blind spot as a verification result — which is the exact claim 10 §2.3 and TH-50 decline
 *    to make.
 *
 * A checker that throws aborts the pass rather than being swallowed. That is the opposite of
 * {@link runSamplingRound}'s rule and the difference is the adversary: there, the reference is
 * *provider-supplied*, so a publisher can plant one that reliably errors and discard the round's
 * findings; here the block numbers come from coverage this module already validated, so a throw
 * is the client's own failure and continuing past it would report a smaller comparison than was
 * attempted.
 */
export async function spotCheckSnapshot(
  document: SnapshotDocument,
  check: SnapshotSpotCheck,
  maxBlocks: number = SPOT_CHECK_MAX_BLOCKS,
): Promise<SpotCheckReport> {
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1) {
    throw new RangeError(`maxBlocks must be a positive integer, got ${maxBlocks}`);
  }
  const byBlock = new Map<number, string[]>();
  for (const op of document.ops) {
    const at = byBlock.get(op.block);
    if (at === undefined) byBlock.set(op.block, [projectOp(op)]);
    else at.push(projectOp(op));
  }
  const findings: SnapshotFinding[] = [];
  let compared = 0;
  let outOfReach = 0;
  for (const block of newestCoveredBlocks(document.coverage, maxBlocks)) {
    const verdict = await check({ block, movements: byBlock.get(block) ?? [] });
    if (verdict.kind === 'out-of-reach') {
      outOfReach += 1;
      continue;
    }
    compared += 1;
    if (verdict.kind === 'disagrees') {
      findings.push({
        screen: 'spot-check',
        why:
          `block ${block}: this device re-derived ${verdict.derived.length} movement(s) from the ` +
          `chain and the snapshot states ${(byBlock.get(block) ?? []).length}. Chain: ` +
          `${canonicalJson(verdict.derived)}; snapshot: ${canonicalJson(byBlock.get(block) ?? [])}`,
      });
    }
  }
  return { compared, outOfReach, findings };
}

/** The newest `limit` covered blocks, descending — the pinned window is at the top (§4.2). */
function newestCoveredBlocks(
  coverage: readonly SnapshotRange[],
  limit: number,
): readonly number[] {
  const blocks: number[] = [];
  const descending = [...coverage].sort((a, b) => b.toBlock - a.toBlock);
  for (const range of descending) {
    for (let block = range.toBlock; block >= range.fromBlock; block -= 1) {
      blocks.push(block);
      if (blocks.length === limit) return blocks;
    }
  }
  return blocks;
}

// ------------------------------------------------------------------ the two-snapshot diff

export interface SnapshotDisagreement {
  /** Position in the compared sequence, so two identical movements stay two. */
  readonly at: number;
  readonly left: string | undefined;
  readonly right: string | undefined;
}

export type DiffVerdict =
  /** Jointly observed history was compared, and every movement matched. */
  | { readonly kind: 'agree'; readonly overlap: readonly SnapshotRange[] }
  /**
   * **Nothing was compared**, because the two documents share no covered block.
   *
   * Its own discriminant rather than an `agree` with an empty overlap, which is what this
   * returned until 2026-08-06. The empty array was there and carried the whole fact, and a
   * caller writing the obvious `if (verdict.kind === 'agree') showCrossChecked()` — the shape
   * every other verdict in this package invites — turns two producers who have never covered
   * one block into a cross-check that passed. §8.4 offers the two-snapshot diff as *"the only
   * available cross-check"* for depth; reporting a vacuous one as agreement manufactures
   * exactly the confidence it declines to offer, in the case where a forger picks the ranges.
   */
  | { readonly kind: 'no-overlap' }
  | {
      readonly kind: 'disagree';
      readonly refusal: ProviderRefusal;
      readonly overlap: readonly SnapshotRange[];
      readonly disagreements: readonly SnapshotDisagreement[];
    };

/**
 * One movement, canonically projected for comparison.
 *
 * Shared by the two-snapshot diff and {@link spotCheckSnapshot} deliberately: they compare the
 * same thing against different oracles — a second producer, and the chain — and two projections
 * would let a movement that differs by a field one of them omits read as equal to one of them.
 */
export function projectOp(op: SnapshotOp): string {
  return canonicalJson(
    op.kind === 'redeem'
      ? [op.block, op.kind, op.vault, op.account, op.branch, op.amount]
      : op.kind === 'transfer'
        ? [op.block, op.kind, op.vault, op.account, op.to, op.branch, op.amount]
        : [op.block, op.kind, op.vault, op.account, op.amount],
  );
}

/**
 * The blocks **both** documents claim to have observed.
 *
 * Intersecting the `coverage` arrays, not the outer `range` spans, and the difference is not
 * cosmetic: 10 §6.3 makes holes first-class, so two snapshots can each declare blocks 1–100 and
 * observe disjoint halves of it. Comparing over the declared spans then reports every movement
 * in either half as a disagreement — `FE-PROV-004` on an honest pair, over history neither
 * producer contradicts — and with no movements at all reports the pair as agreeing over 100
 * blocks that were never jointly seen. Only mutually covered history can be cross-checked.
 */
function coverageIntersection(
  left: readonly SnapshotRange[],
  right: readonly SnapshotRange[],
): readonly SnapshotRange[] {
  const shared: SnapshotRange[] = [];
  for (const a of left) {
    for (const b of right) {
      const fromBlock = Math.max(a.fromBlock, b.fromBlock);
      const toBlock = Math.min(a.toBlock, b.toBlock);
      if (fromBlock <= toBlock) shared.push({ fromBlock, toBlock });
    }
  }
  return shared.sort((a, b) => a.fromBlock - b.fromBlock);
}

/**
 * §8.4's only cross-check for depths the light client cannot reach: diff two independent
 * producers over the history they **both observed**.
 *
 * **It flags the pair, never a member.** The diff proves at least one is wrong and cannot say
 * which; a client that picked the "better" one — the newer, the larger, the one from the
 * publisher already enabled — would be manufacturing exactly the confidence §8.4 declines to
 * offer. So a disagreement leaves the disputed range as a labelled hole.
 *
 * Two snapshots with **no shared coverage** are reported as `no-overlap`, a third discriminant
 * rather than an `agree` carrying an empty overlap array: two producers covering disjoint
 * history have not cross-checked anything, and "agree" with nothing compared is the shape a
 * user reads as confirmation.
 *
 * **The comparison is over ordered sequences, not a keyed map.** One account may perform the
 * same operation on the same vault twice in one block, and a map keyed by the movement's
 * identity collapses those two into one — after which `[split 100, split 200]` and
 * `[split 50, split 200]` both project to `200` and the pair reports agreement. That defeats
 * the only cross-check §8.4 offers for depth, in exactly the case where a forger is free to
 * choose the movements. `ops` is already in chain order (see {@link checkCanonicalOrder}), so
 * the ordered projection is well-defined for both documents without any extra field.
 */
export function diffSnapshots(left: SnapshotDocument, right: SnapshotDocument): DiffVerdict {
  const overlap = coverageIntersection(left.coverage, right.coverage);
  if (overlap.length === 0) return { kind: 'no-overlap' };
  const covered = (block: number): boolean =>
    overlap.some((range) => block >= range.fromBlock && block <= range.toBlock);
  const project = (document: SnapshotDocument): readonly string[] =>
    document.ops.filter((op) => covered(op.block)).map(projectOp);
  const leftRows = project(left);
  const rightRows = project(right);
  const disagreements: SnapshotDisagreement[] = [];
  for (let at = 0; at < Math.max(leftRows.length, rightRows.length); at += 1) {
    const a = leftRows[at];
    const b = rightRows[at];
    if (a !== b) disagreements.push({ at, left: a, right: b });
  }
  if (disagreements.length === 0) return { kind: 'agree', overlap };
  const span = overlap.map((range) => `${range.fromBlock}..${range.toBlock}`).join(', ');
  return {
    kind: 'disagree',
    refusal: providerRefusal(
      'FE-PROV-004',
      `${disagreements.length} movement(s) differ over jointly observed blocks ${span}`,
    ),
    overlap,
    disagreements,
  };
}
