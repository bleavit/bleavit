/**
 * The `BlockMovementRead` contract, and proof that the harness enforcing it is not vacuous.
 * 10 §8.4, 15 §2 INV-FE-3/15 (F9, for F23).
 *
 * ## What is being defended
 *
 * `spotCheckSnapshot` walks a document downward and takes the **side** of every out-of-reach
 * answer from the reader. That delegation fixed a blocker — the walk used to infer the side and
 * refused the ordinary deep-history document — but it moved the decision rather than removing
 * it, and it moved it into a module with **no production implementation**: every caller of
 * `BlockMovementRead` in this repository is a test closure, and F23 owns the real one.
 *
 * The failure direction flipped with the move. The old guess failed toward **refusal**: loud,
 * visible, and safe. The delegate fails toward **admission** — a reader that answers
 * `below-window` for a block above its own head stops the walk at the very top, and the pass
 * returns an admitted document with `compared: 0`, no finding, and the blind-spot disclosure. A
 * false clean on §8.4's only chain-facing screen, indistinguishable from the honest deep-history
 * case it was written to serve.
 *
 * So the two properties the walk depends on are written as an executable contract, and this
 * suite's job is to show the contract **catches** each violation rather than accompanying it.
 * The first test is the positive control; every other test hands the harness a reader broken in
 * one specific way and asserts it says so. A harness that passed everything would be the same
 * defect one level up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SNAPSHOT_FORMAT, chainSpotCheck, spotCheckSnapshot } from '@bleavit/providers';
import type {
  BlockMovementRead,
  BlockMovements,
  ObservedMovement,
  SnapshotDocument,
} from '@bleavit/providers';
import { MAX_CONTRACT_SWEEP, checkBlockMovementRead } from '@bleavit/providers/testing';

const FLOOR = 1_000;
const HEAD = 1_040;
const WINDOW = { floor: FLOOR, head: HEAD } as const;

function movementAt(block: number): ObservedMovement {
  return {
    extrinsicIndex: 1,
    eventIndex: 0,
    op: { kind: 'split', block, vault: 'v1', account: 'alice', amount: '1000' },
  };
}

/** A reader that satisfies the contract, parameterised so each case can break one thing. */
function reader(
  answer: (block: number) => BlockMovements = (block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block)] },
): BlockMovementRead {
  return async (block: number) => answer(block);
}

const HONEST = reader();

function whys(violations: readonly { readonly why: string }[]): string {
  return violations.map((violation) => violation.why).join(' | ');
}

// ------------------------------------------------------------------ the positive control

test('a correct reader satisfies the contract, and the harness reports exactly nothing', async () => {
  // Anti-vacuity in the other direction: a harness that reported a violation for every reader
  // would be as useless as one that reported none, and every test below asserts a NON-empty
  // list, so this is the one that keeps them meaningful.
  assert.deepEqual(await checkBlockMovementRead(HONEST, WINDOW), []);
});

// ------------------------------- property 2: the side comes from the device's head and floor

test('BELOW-WINDOW above the head is caught — the false-clean case, in its exact shape', async () => {
  // The violation this file exists for. A reader that puts an above-head block on the below
  // side stops the walk at the top, and the document is ADMITTED having compared nothing.
  const broken = reader((block) =>
    block >= FLOOR && block <= HEAD
      ? { kind: 'movements', observed: [movementAt(block)] }
      : { kind: 'out-of-reach', where: 'below-window' },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.ok(violations.length > 0, 'the harness must catch it — this is the whole point');
  assert.match(whys(violations), /above this device's head/);
  assert.match(whys(violations), /admitted with nothing compared/);

  // And measured end to end, so *"the harness catches something real"* is not an assertion about
  // the harness. Driven through `chainSpotCheck`, the same reader turns a document whose whole
  // coverage sits inside the window into a clean pass over zero blocks.
  const document = documentOver(HEAD + 4, HEAD + 1);
  const report = await spotCheckSnapshot(document, chainSpotCheck(broken));
  assert.deepEqual(report.findings, [], 'no finding — which is what makes it a FALSE clean');
  assert.equal(report.compared, 0);
  assert.equal(report.reach, 'window-floor', 'the blind-spot disclosure, on blocks above the head');
});

test('ABOVE-WINDOW below the floor is caught — the walk would descend forever', async () => {
  const broken = reader((block) =>
    block >= FLOOR && block <= HEAD
      ? { kind: 'movements', observed: [movementAt(block)] }
      : { kind: 'out-of-reach', where: 'above-window' },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.ok(violations.length > 0);
  assert.match(whys(violations), /below this device's pinned floor/);
  assert.match(whys(violations), /descend forever/);
});

test('an out-of-enum side is caught, not silently read as above-window', async () => {
  // A single assertion between the two literal types, never `as unknown as` — the double
  // assertion is banned workspace-wide by `check:casts` (10 §2.1), and a test that reached for
  // it would be asking for the one escape hatch the brand cannot survive.
  const broken = reader((block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'unknown' as 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /neither "above-window" nor "below-window"/);
});

test('declining a block INSIDE the declared window is caught', async () => {
  // Quiet in production and load-bearing: a block dropped from the mandated set is one §8.4
  // required this device to re-derive, and nothing anywhere would record that it was skipped.
  const broken = reader((block) =>
    block === FLOOR + 5
      ? { kind: 'out-of-reach', where: 'below-window' }
      : block > HEAD
        ? { kind: 'out-of-reach', where: 'above-window' }
        : block < FLOOR
          ? { kind: 'out-of-reach', where: 'below-window' }
          : { kind: 'movements', observed: [movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /inside this device's window/);
});

// -------------------------------------- property 1: one contiguous interval, at the head

test('a HOLE in the window is caught — the walk stops at the hole and calls itself finished', async () => {
  // The property the walk's early stop rests on. With a hole, *"every older covered block is
  // unreachable too"* is false, and a pass that stopped there reports a finished mandated set
  // while blocks below it were readable all along.
  //
  // The hole answers `above-window` so that no per-block rule fires on it: the harness must
  // catch this from the SHAPE of the sweep, not from one answer.
  const broken = reader((block) =>
    block === FLOOR + 5
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block > HEAD
        ? { kind: 'out-of-reach', where: 'above-window' }
        : block < FLOOR
          ? { kind: 'out-of-reach', where: 'below-window' }
          : { kind: 'movements', observed: [movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /not one contiguous interval/);
});

test('a window that does not reach its declared HEAD is caught', async () => {
  const broken = reader((block) =>
    block > HEAD - 3
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /not the head \d+ it declared/);
});

test('a window that does not reach its declared FLOOR is caught', async () => {
  const broken = reader((block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR + 3
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /not the floor \d+ it declared/);
});

// ------------------------------------------------- what `chainSpotCheck` throws on, checked here

test('a movement returned for ANOTHER block is caught before it aborts a real pass', async () => {
  const broken = reader((block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block === HEAD ? block - 1 : block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /was returned for block/);
});

test('two movements at ONE chain position are caught', async () => {
  const broken = reader((block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : { kind: 'movements', observed: [movementAt(block), movementAt(block)] },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /One chain position holds one event/);
});

test('a negative or fractional index is caught', async () => {
  const broken = reader((block) =>
    block > HEAD
      ? { kind: 'out-of-reach', where: 'above-window' }
      : block < FLOOR
        ? { kind: 'out-of-reach', where: 'below-window' }
        : {
            kind: 'movements',
            observed: [{ ...movementAt(block), extrinsicIndex: -1, eventIndex: 0.5 }],
          },
  );
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /extrinsic index -1/);
  assert.match(whys(violations), /event index 0.5/);
});

test('a reader that THROWS inside its own window is caught — a throw ends the whole pass', async () => {
  const broken: BlockMovementRead = async (block: number) => {
    if (block === FLOOR + 2) throw new Error('the light client is not started');
    return HONEST(block);
  };
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /the reader threw for block/);
  assert.match(whys(violations), /no check at all/);
});

test('a reader whose answer MOVES within one run is caught — §8.4 says deterministic', async () => {
  let asks = 0;
  const broken: BlockMovementRead = async (block: number) => {
    asks += 1;
    if (block === HEAD && asks > HEAD + 2 - (FLOOR - 2) + 1) {
      return { kind: 'out-of-reach', where: 'above-window' };
    }
    return HONEST(block);
  };
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /within one\s+run|within one run/);
});

// ------------------------------------------------------- the harness refuses what it cannot check

test('a window with no blocks under its floor is REFUSED, not passed', async () => {
  // The below-window edge is the one this exists for, and a window at block 0 or 1 has nothing
  // below it to probe. Reporting a pass there would be the defect one level up: a check that
  // narrowed itself and said nothing.
  await assert.rejects(
    () => checkBlockMovementRead(HONEST, { floor: 1, head: 40 }),
    /the window floor must be at least/,
  );
});

test('a window too wide to sweep is REFUSED rather than sampled', async () => {
  await assert.rejects(
    () => checkBlockMovementRead(HONEST, { floor: 10, head: 10 + MAX_CONTRACT_SWEEP }),
    /past this harness's bound/,
  );
});

test('an inverted or non-integer window is refused', async () => {
  await assert.rejects(() => checkBlockMovementRead(HONEST, { floor: 40, head: 10 }), RangeError);
  await assert.rejects(() => checkBlockMovementRead(HONEST, { floor: 10.5, head: 40 }), RangeError);
});

test('a reader serving NO block in its declared window is refused as proving nothing', async () => {
  const broken = reader(() => ({ kind: 'out-of-reach', where: 'above-window' }));
  const violations = await checkBlockMovementRead(broken, WINDOW);
  assert.match(whys(violations), /is not a window/);
});

// ------------------------------------------------------------------ fixture

/** A document covering `from..to` with no movements, for driving a real pass end to end. */
function documentOver(to: number, from: number): SnapshotDocument {
  return {
    format: SNAPSHOT_FORMAT,
    binding: { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 },
    range: { fromBlock: from, toBlock: to },
    coverage: [{ fromBlock: from, toBlock: to }],
    vaults: [],
    ops: [],
    balances: [],
  };
}
