/**
 * S1's reads — `Epoch.EpochOf` and `Constitution.PhaseFlags` into `ShellChainState`.
 *
 * ## The decode is injected, and that is a boundary rather than a convenience
 *
 * `packages/chain-client` is the only package permitted to import `polkadot-api` (10 §10.1,
 * app-code rule 13), so the typed SCALE decode belongs there and cannot be done here. This
 * module therefore takes a decoder as an argument. That is also what makes it testable
 * without a chain — the same discipline `decodeForConfirm` follows on the confirm surface.
 *
 * ## Every leaf of one screen comes from one block
 *
 * `FinalizedReader` pins its block once at `open()` and every read it serves belongs to
 * that block. This module preserves that: it never takes two readers, and
 * `assertOnePin` re-checks the finished model rather than trusting the invariant to have
 * been maintained through the mapping. A header showing the epoch at one block and the
 * phase at another is not a stale display — it is a *view that never existed*, and the
 * user has no way to tell it apart from one that did.
 *
 * ## Undecodable is a first-class outcome, not an error to swallow
 *
 * INV-FE-12 and app-code rule 10: *"undecodable data renders as raw SCALE with a warning;
 * never guess at encodings."* So a decode returns a result rather than throwing, the model
 * carries the failed reads alongside the good ones, and the shell renders `Undecodable`.
 * The alternative — a `try`/`catch` that substitutes a zero — is the guess the rule forbids,
 * and it is indistinguishable on screen from a chain that really says zero.
 */

import type { Finalized, FinalizedBlockRef, StorageItem } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';
import type { ShellChainState } from './shell.js';

/** What an injected decoder returns. A failure is data, not an exception. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** A value the client read but could not interpret. Rendered, never substituted. */
export interface UndecodableRead {
  readonly label: string;
  readonly rawHex: string;
  readonly reason: string;
}

/**
 * The decoders S1 needs, each a pure function over the raw bytes.
 *
 * Named individually rather than as one `decode(type, bytes)` because a single generic
 * entry point invites a call site to pass the wrong type name for the wrong key, and
 * nothing would catch it — the bytes would decode to *something*.
 */
export interface ShellDecoders {
  readonly epochOf: (raw: string) => Decoded<{ readonly epoch: number; readonly phase: string }>;
  readonly phaseFlags: (raw: string) => Decoded<number>;
}

/** The frozen 02 §7 keys this screen reads. Names, never re-derived hashes. */
export const SHELL_READS = Object.freeze({
  epochOf: 'Epoch.EpochOf',
  phaseFlags: 'Constitution.PhaseFlags',
} as const);

export interface ShellRead {
  readonly state: ShellChainState;
  /** Empty when everything decoded. Non-empty is a rendering obligation, not a warning. */
  readonly undecodable: readonly UndecodableRead[];
}

function firstValue(items: readonly StorageItem[]): string | undefined {
  return items[0]?.value;
}

/**
 * Re-check that every leaf belongs to the reader's pin.
 *
 * Redundant by construction today, and kept because the failure it catches is silent: a
 * future refactor that reads one field from a cache, or from a second reader opened a
 * moment later, produces a model that looks completely normal.
 *
 * **Exported so it can be tested directly, and that is the honest arrangement.** No input
 * to `readShellState` can produce a mixed model — every leaf is stamped from `reader.at` —
 * so a test driving the public API can only assert that two hashes it wrote itself are
 * different, which proves nothing about this function. A defensive check whose test cannot
 * reach it is the same vacuous control this repository keeps finding; exporting it is the
 * smaller cost.
 */
export function assertOnePin(state: ShellChainState, blockHash: string): void {
  const leaves: readonly Verified<unknown>[] = [
    state.epoch,
    state.phaseLabel,
    state.finalizedHeight,
    ...(state.phaseFlags === undefined ? [] : [state.phaseFlags]),
  ];
  for (const leaf of leaves) {
    const at = 'blockHash' in leaf.status ? leaf.status.blockHash : undefined;
    if (at !== blockHash) {
      throw new Error(
        'the shell model mixes blocks: a leaf carries ' +
          `${String(at)} while the reader is pinned at ${blockHash}. A header assembled from ` +
          'two blocks shows a state that never existed, and nothing on screen distinguishes ' +
          'it from one that did.',
      );
    }
  }
}

/**
 * Read S1's state at the reader's pinned block.
 *
 * `bootstrapPhase` is `undefined` when the read or the decode failed — which
 * `sudoBannerFor` treats as *show the banner*, per INV-FE-12. The failure is additionally
 * reported in `undecodable`, because a warning banner and a rendered raw-bytes row answer
 * different questions: one says the client cannot vouch for the governance phase, the
 * other says exactly what it read.
 */
/**
 * What this function needs from a reader: one pin and finalized storage reads.
 *
 * Structural rather than the `FinalizedReader` class, because a class with `#private`
 * fields is **nominal** in TypeScript — nothing but a real reader satisfies it, so a suite
 * could only reach this code through the transport, the codecs and a recorded transcript,
 * and a defect in any of those would make the suite agree with it. Narrowing also states
 * the real dependency: `reader.at` is the single source of every leaf's pin, which is the
 * property `assertOnePin` re-checks.
 */
export interface ShellStateReader {
  readonly at: FinalizedBlockRef;
  storage(
    key: string,
    type?: 'value' | 'descendantsValues',
  ): Promise<Finalized<readonly StorageItem[]>>;
}

export async function readShellState(
  reader: ShellStateReader,
  decoders: ShellDecoders,
): Promise<ShellRead> {
  const at = reader.at;
  const undecodable: UndecodableRead[] = [];
  const finalized = <T,>(value: T): Verified<T> => ({
    value,
    status: { kind: 'verified-finalized', blockHash: at.blockHash, blockNumber: at.blockNumber },
  });

  const epochRaw = firstValue((await reader.storage(SHELL_READS.epochOf)).value);
  const epochDecoded =
    epochRaw === undefined
      ? ({ ok: false, reason: 'the storage key returned no value' } as const)
      : decoders.epochOf(epochRaw);
  if (!epochDecoded.ok) {
    undecodable.push({
      label: SHELL_READS.epochOf,
      rawHex: epochRaw ?? '0x',
      reason: epochDecoded.reason,
    });
  }

  const flagsRaw = firstValue((await reader.storage(SHELL_READS.phaseFlags)).value);
  const flagsDecoded =
    flagsRaw === undefined
      ? ({ ok: false, reason: 'the storage key returned no value' } as const)
      : decoders.phaseFlags(flagsRaw);
  if (!flagsDecoded.ok) {
    undecodable.push({
      label: SHELL_READS.phaseFlags,
      rawHex: flagsRaw ?? '0x',
      reason: flagsDecoded.reason,
    });
  }

  const state: ShellChainState = {
    // A failed epoch decode renders 0 with the raw bytes shown beside it, rather than the
    // header disappearing. `undecodable` is what says the number is not to be believed.
    epoch: finalized(epochDecoded.ok ? epochDecoded.value.epoch : 0),
    phaseLabel: finalized(epochDecoded.ok ? epochDecoded.value.phase : 'unknown'),
    finalizedHeight: finalized(at.blockNumber),
    // Unread and undecodable collapse here deliberately: both mean the client cannot
    // establish that sudo is gone, and INV-FE-12 gives them the same fail-closed answer.
    // The raw u32 bitset of 02 §7.3, deliberately not pre-interpreted: a screen handed a
    // boolean could not show which other flags are set.
    phaseFlags: flagsDecoded.ok ? finalized(flagsDecoded.value) : undefined,
  };

  assertOnePin(state, at.blockHash);
  return { state, undecodable };
}
