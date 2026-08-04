/**
 * The per-item value mapping for S1's reads — F7's last mile.
 *
 * `chain-client`'s `storageDecoder` returns whatever the runtime's own type decodes to;
 * this maps those shapes into the screen models. It is the one layer that has to know the
 * runtime's field names, and that is why it is small, in one file, and tested against
 * **recorded bytes from the runtime** rather than against a shape written from the docs.
 *
 * ## The shapes are measured, not read off a page
 *
 * `Epoch.EpochOf` decodes to `{ index, phase: { type }, phase_start_block }` — established
 * by decoding `app/fixtures/chainhead/storage.epoch.epoch_of.json`'s recorded
 * `0x010000000000000000` with the real codec. `Constitution.PhaseFlags` decodes to a plain
 * `number`, the u32 bitset of 02 §7.3 — its recorded `0x11000000` is `17`.
 *
 * That distinction matters more than it looks. The previous version of the shell modelled
 * `PhaseFlags` as a governance *phase number* and tested `>= 4`, where the contract freezes
 * a *bitset* whose bit 4 is sudo-present. Reading the recorded value is what exposed it;
 * reading the spec prose again would not have, because the prose says "Phase ≥ 4 (sudo
 * removed)" and the code said `>= 4`.
 *
 * ## Why this is not in `chain-client`
 *
 * `chain-client` is the chain SDK boundary and knows nothing about screens. A mapping from
 * `{index, phase}` to `{epoch, phase}` is a *screen model* decision — the field names on
 * the right belong to `ShellChainState`, which lives here. Putting it below would give
 * `chain-client` an edge to the shell for no gain.
 */

import type { ChainCodecs, DecodeResult } from '@bleavit/chain-client';
import { storageDecoder } from '@bleavit/chain-client';
import { SHELL_READS, type Decoded, type ShellDecoders } from './chain-reads.js';

/** `Epoch.EpochOf` as this runtime encodes it. Measured from the recorded value. */
interface EpochOfValue {
  readonly index: number;
  readonly phase: { readonly type: string };
  readonly phase_start_block: number;
}

/**
 * Narrow a decoded value to the shape S1 needs.
 *
 * A runtime whose `EpochOf` gained or renamed a field decodes fine and then fails here,
 * which is the right place: `Decoded` carries the reason to the screen, and the screen
 * renders the raw bytes beside it. Silently reading `undefined` out of a changed shape
 * would put `NaN` and the word `undefined` on the header instead.
 */
function asEpochOf(value: unknown): Decoded<{ readonly epoch: number; readonly phase: string }> {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'Epoch.EpochOf did not decode to a record' };
  }
  const record = value as Partial<EpochOfValue>;
  const index = record.index;
  const phase = record.phase?.type;
  if (typeof index !== 'number' || typeof phase !== 'string') {
    return {
      ok: false,
      reason:
        'Epoch.EpochOf decoded to a record without a numeric `index` and a `phase.type` ' +
        'string. This runtime encodes the epoch differently than this release expects.',
    };
  }
  return { ok: true, value: { epoch: index, phase } };
}

function asBitset(value: unknown): Decoded<number> {
  // `Number.isInteger` and not `typeof === 'number'`: a u32 that decoded to a float is not
  // a bitset, and testing bits on one silently yields nonsense rather than failing.
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      reason: 'Constitution.PhaseFlags did not decode to an integer, so no bit can be read',
    };
  }
  return { ok: true, value: value as number };
}

/** Lift a `chain-client` decode result through a shape check. */
function through<T>(
  decode: (raw: string) => DecodeResult<unknown>,
  narrow: (value: unknown) => Decoded<T>,
): (raw: string) => Decoded<T> {
  return (raw) => {
    const decoded = decode(raw);
    return decoded.ok ? narrow(decoded.value) : { ok: false, reason: decoded.reason };
  };
}

/**
 * Build S1's decoders from a chain's codecs.
 *
 * The `SHELL_READS` names are split on the dot they already carry, so the storage item a
 * decoder is bound to and the one the read layer fetches are **the same string** — they
 * cannot drift into naming different items.
 */
export function shellDecoders(codecs: ChainCodecs): ShellDecoders {
  const split = (qualified: string): readonly [string, string] => {
    const [pallet, item] = qualified.split('.');
    if (pallet === undefined || item === undefined) {
      throw new Error(`"${qualified}" is not a Pallet.Item name`);
    }
    return [pallet, item];
  };
  const [epochPallet, epochItem] = split(SHELL_READS.epochOf);
  const [flagsPallet, flagsItem] = split(SHELL_READS.phaseFlags);
  return {
    epochOf: through(storageDecoder(codecs, epochPallet, epochItem), asEpochOf),
    phaseFlags: through(storageDecoder(codecs, flagsPallet, flagsItem), asBitset),
  };
}
