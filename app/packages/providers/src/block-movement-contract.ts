/**
 * The contract a {@link BlockMovementRead} must satisfy, as something that runs. 10 §8.4, F9/F23.
 *
 * ## Why a harness and not a paragraph
 *
 * `spotCheckSnapshot` walks a document downward and decides where to stop from the **side** the
 * reader reports. That walk depends on two properties, and until 2026-08-06 nothing in this
 * repository stated either of them, in any file:
 *
 * 1. **The reachable set is one contiguous interval at the head.** The walk stops at the first
 *    `below-window` answer, on the reasoning that every older covered block is unreachable too.
 *    A reader whose window has a hole makes that reasoning false and the walk stops early.
 * 2. **`below-window` is returned only below the pinned floor.** A reader that answers
 *    `below-window` for a block *above* its own head stops the walk at the very top, and the
 *    pass returns an **admitted** document with `compared: 0`, no finding, and the blind-spot
 *    disclosure — a false clean on §8.4's only chain-facing screen.
 *
 * Property 2 is the one that matters under R-7, and its direction is the reason this file exists.
 * The walk used to *infer* the side and failed toward **refusal** — annoying, visible, and safe.
 * It now takes the side from the reader and fails toward **admission**, which is neither visible
 * nor safe. Moving a decision from a guess to a delegate does not remove it; it relocates it to
 * a module that must then be held to something. `BlockMovementRead` has **no production
 * implementation** — every caller in the repository is a test closure, and F23 owns writing the
 * real one — so the obligation had to arrive before its implementer, or F23 would inherit a
 * comment. This is what it inherits instead.
 *
 * ## What it constrains, and what it cannot
 *
 * It constrains the reader's **answers about its own device**: which blocks it says it can read,
 * which side it puts the rest on, and whether the movements it returns are well-formed enough for
 * {@link chainSpotCheck} to order and compare them. It does not, and cannot, check that the
 * movements are the *right* ones — that is the chain's business and the whole point of injecting
 * the reader in the first place (10 §4.1 bars this package from opening a chain connection).
 *
 * *"Never from the document"* needs no check: `BlockMovementRead` takes a block number and
 * nothing else, so a reader structurally cannot see the file it is being asked about. What is
 * checkable is that the answer does not otherwise wander, so the sweep re-asks and requires the
 * same answer twice.
 *
 * ## It refuses rather than sampling
 *
 * A window it cannot exercise on both edges, or one too wide to sweep, throws instead of checking
 * a part and reporting success. A contract test that quietly narrowed itself would be the same
 * defect as the one it exists to catch, one level up.
 *
 * ## Where it lives
 *
 * Behind `@bleavit/providers/testing`, which `no-loosened-sampling-rate-in-production` bars
 * production code from importing. It is test-only by nature rather than dangerous by nature —
 * but a contract harness in the production bundle is dead weight, and the quarantine already
 * exists.
 */

import type { BlockMovementRead, BlockMovements, ObservedMovement } from './snapshot.js';

/**
 * The window a reader claims to serve, as the reader's own device sees it.
 *
 * Both bounds are the **device's**, never the document's: `head` is the newest block this device
 * has, and `floor` is the oldest whose state it can still read (10 §4.2 puts peer pruning at
 * ~256 blocks below the head, so a real window is small).
 */
export interface ReachableWindow {
  /** Oldest readable block, inclusive. Below it every answer must be `below-window`. */
  readonly floor: number;
  /** Newest readable block, inclusive. Above it every answer must be `above-window`. */
  readonly head: number;
}

/** One way a reader broke the contract. `block` is absent when the fault spans the sweep. */
export interface BlockMovementViolation {
  readonly block: number | undefined;
  readonly why: string;
}

/**
 * The widest window this harness will sweep, so a contract test terminates.
 *
 * Four times 10 §4.2's ~256-block pruning depth, then rounded up to a power of two — any window
 * a light client actually serves is far inside it. A caller with a wider one narrows the window
 * under test rather than being given a partial answer.
 */
export const MAX_CONTRACT_SWEEP = 4096;

/** How far past each edge the sweep reaches. Two, so an off-by-one edge cannot hide at one. */
const EDGE_MARGIN = 2;

function positionOf(movement: ObservedMovement): string {
  return `${movement.extrinsicIndex}:${movement.eventIndex}`;
}

/** Everything wrong with one `movements` answer, from {@link chainSpotCheck}'s own rules. */
function movementFaults(block: number, answer: BlockMovements): string[] {
  if (answer.kind !== 'movements') return [];
  const faults: string[] = [];
  const seen = new Set<string>();
  for (const movement of answer.observed) {
    if (!Number.isInteger(movement.extrinsicIndex) || movement.extrinsicIndex < 0) {
      faults.push(
        `an observed movement carries extrinsic index ${String(movement.extrinsicIndex)}, which ` +
          'is not a non-negative integer — chainSpotCheck throws on it and the throw aborts the ' +
          'whole §8.4 pass',
      );
    }
    if (!Number.isInteger(movement.eventIndex) || movement.eventIndex < 0) {
      faults.push(
        `an observed movement carries event index ${String(movement.eventIndex)}, which is not a ` +
          'non-negative integer — chainSpotCheck throws on it and the throw aborts the whole ' +
          '§8.4 pass',
      );
    }
    if (movement.op.block !== block) {
      faults.push(
        `a movement at block ${movement.op.block} was returned for block ${block}. A movement ` +
          'carries the block it happened in, and comparing it against another block reads as a ' +
          "disagreement blamed on the publisher — so chainSpotCheck throws instead",
      );
    }
    const position = positionOf(movement);
    if (seen.has(position)) {
      faults.push(
        `two movements were returned at extrinsic ${movement.extrinsicIndex} event ` +
          `${movement.eventIndex}. One chain position holds one event, and no tie-break between ` +
          'them can be right',
      );
    }
    seen.add(position);
  }
  return faults;
}

/** The side an answer states, or `undefined` when it is not an out-of-reach answer. */
function sideOf(answer: BlockMovements): string | undefined {
  return answer.kind === 'out-of-reach' ? String(answer.where) : undefined;
}

function describe(answer: BlockMovements): string {
  return answer.kind === 'movements'
    ? `movements (${answer.observed.length})`
    : `out-of-reach ${String(answer.where)}`;
}

/**
 * Run the contract against one reader and report **every** way it broke.
 *
 * Returns a list rather than throwing on the first fault, so a suite prints the whole shape of a
 * broken reader instead of one symptom at a time. An empty list is the contract satisfied.
 *
 * @param read the reader under test.
 * @param window the window it claims to serve, from the device's own head and pinned floor.
 * @throws RangeError when the window cannot be exercised — see the module note. A window whose
 * floor is below {@link EDGE_MARGIN} has no blocks under it to probe, so the `below-window` edge
 * would go unchecked, and that edge is the one this harness exists for.
 */
export async function checkBlockMovementRead(
  read: BlockMovementRead,
  window: ReachableWindow,
): Promise<readonly BlockMovementViolation[]> {
  const { floor, head } = window;
  if (!Number.isInteger(floor) || !Number.isInteger(head)) {
    throw new RangeError(`the window bounds must be integers, got floor ${floor} head ${head}`);
  }
  if (floor > head) {
    throw new RangeError(
      `the window floor ${floor} is above its head ${head}. A reachable window is one interval ` +
        'at the head, and an inverted one describes nothing a reader could serve',
    );
  }
  if (floor < EDGE_MARGIN) {
    throw new RangeError(
      `the window floor must be at least ${EDGE_MARGIN} so there are blocks below it to probe, ` +
        `got ${floor}. An unexercised below-window edge is exactly the fault this checks for, ` +
        'so the harness refuses rather than reporting a pass it did not earn',
    );
  }
  const from = floor - EDGE_MARGIN;
  const to = head + EDGE_MARGIN;
  if (to - from + 1 > MAX_CONTRACT_SWEEP) {
    throw new RangeError(
      `sweeping blocks ${from}..${to} is ${to - from + 1} reads, past this harness's bound of ` +
        `${MAX_CONTRACT_SWEEP}. Narrow the window under test — a partial sweep reported as a ` +
        'pass is the defect this file exists to end',
    );
  }

  const violations: BlockMovementViolation[] = [];
  const answers = new Map<number, BlockMovements | undefined>();

  const ask = async (block: number): Promise<BlockMovements | undefined> => {
    try {
      return await read(block);
    } catch (error) {
      violations.push({
        block,
        why:
          `the reader threw for block ${block} (${String(error)}). A throw aborts §8.4's whole ` +
          're-derivation pass, so a reader that throws inside its own declared window turns one ' +
          'unavailable block into no check at all',
      });
      return undefined;
    }
  };

  for (let block = from; block <= to; block += 1) {
    const answer = await ask(block);
    answers.set(block, answer);
    if (answer === undefined) continue;

    const side = sideOf(answer);
    if (side !== undefined && side !== 'above-window' && side !== 'below-window') {
      violations.push({
        block,
        why:
          `the reader answered out-of-reach with side "${side}", which is neither "above-window" ` +
          'nor "below-window". An unrecognised side reads as above-window at every consumer that ' +
          'tests for below-window, which walks the whole document and admits it having compared ' +
          'nothing',
      });
    }

    if (block > head) {
      if (side !== 'above-window') {
        violations.push({
          block,
          why:
            `block ${block} is above this device's head ${head} and the reader answered ` +
            `${describe(answer)}. Above the head the only correct answer is out-of-reach ` +
            'above-window: answering below-window there stops the §8.4 walk at the top and the ' +
            'document is admitted with nothing compared, and answering with movements claims a ' +
            'block this device does not have',
        });
      }
    } else if (block < floor) {
      if (side !== 'below-window') {
        violations.push({
          block,
          why:
            `block ${block} is below this device's pinned floor ${floor} and the reader answered ` +
            `${describe(answer)}. Below the floor the only correct answer is out-of-reach ` +
            'below-window: answering above-window there makes the walk descend forever through ' +
            'history nothing can answer for, until the work ceiling stops it',
        });
      }
    } else if (answer.kind !== 'movements') {
      violations.push({
        block,
        why:
          `block ${block} is inside this device's window ${floor}..${head} and the reader ` +
          `answered ${describe(answer)}. §8.4 mandates re-derivation for every covered block ` +
          'inside light-client-reachable depth, and a reader that declines a block it can read ' +
          'removes it from the mandated set with nothing to show for it',
      });
    }

    for (const fault of movementFaults(block, answer)) violations.push({ block, why: fault });
  }

  // Contiguity, checked over the sweep as a whole rather than per block: every per-block rule
  // above can pass while the window still has a hole, if the reader's own idea of its floor and
  // head disagrees with the one it declared.
  const reachable = [...answers.entries()]
    .filter(([, answer]) => answer !== undefined && answer.kind === 'movements')
    .map(([block]) => block)
    .sort((a, b) => a - b);
  if (reachable.length === 0) {
    violations.push({
      block: undefined,
      why:
        `the reader answered with movements for no block in ${floor}..${head}, so this run ` +
        'compared nothing and proves nothing. A window that serves no block is not a window',
    });
  } else {
    const lowest = reachable[0] ?? 0;
    const highest = reachable[reachable.length - 1] ?? 0;
    if (highest - lowest + 1 !== reachable.length) {
      violations.push({
        block: undefined,
        why:
          `the blocks the reader can serve are not one contiguous interval: it served ` +
          `${reachable.length} blocks spanning ${lowest}..${highest}. §8.4's walk stops at the ` +
          'first below-window answer because every older covered block is then unreachable too, ' +
          'and a window with a hole in it makes that reasoning false — the walk stops at the ' +
          'hole and reports a finished pass',
      });
    }
    if (highest !== head) {
      violations.push({
        block: undefined,
        why:
          `the newest block the reader served is ${highest}, not the head ${head} it declared. ` +
          'The reachable window sits at the head (10 §4.2), and a reader whose real head is ' +
          'below its declared one is one whose caller will believe the wrong blocks are checkable',
      });
    }
    if (lowest !== floor) {
      violations.push({
        block: undefined,
        why:
          `the oldest block the reader served is ${lowest}, not the floor ${floor} it declared. ` +
          'The declared floor is what a caller reasons about when the walk stops, so a reader ' +
          'that serves a narrower window than it states understates what was checked',
      });
    }
  }

  // The same block, asked twice, must answer the same way. A reader whose answer moves inside one
  // pass makes every property above a statement about the moment it was measured.
  for (const block of [head + 1, head, floor, floor - 1]) {
    const first = answers.get(block);
    if (first === undefined) continue;
    const again = await ask(block);
    if (again === undefined) continue;
    if (again.kind !== first.kind || sideOf(again) !== sideOf(first)) {
      violations.push({
        block,
        why:
          `block ${block} answered ${describe(first)} and then ${describe(again)} within one ` +
          'run. §8.4 calls the re-derivation deterministic, and a reader that changes its answer ' +
          'makes the report a statement about when it was taken rather than about the document',
      });
    }
  }

  return violations;
}
