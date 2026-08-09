import { KernelDial, DialReadout } from './KernelDial';
import { BrandMark } from './Brand';
import { ThemeToggle } from './ThemeController';
import { useUi } from '../state/store';
import type { SimState } from '../sim/types';

/**
 * The header carries the mark and the clock, because time pressure is ambient in
 * this protocol: every deadline is block-denominated, and the dial is the app's
 * one persistent instrument. Blocks and human time always appear together.
 *
 * The mark and the dial sit side by side deliberately — the mark's vertical seam
 * and the dial's fixed index are the same line, drawn at two sizes.
 */
export function AppHeader({ sim }: { sim: SimState }) {
  const motionEnabled = useUi((s) => s.motionEnabled);
  const setMotionEnabled = useUi((s) => s.setMotionEnabled);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <a className="app-header__brand" href="#/epoch-clock">
          <BrandMark size={26} />
          <span className="app-header__wordmark">Bleavit</span>
          <span className="app-header__sub">how it decides</span>
        </a>

        <div className="app-header__clock">
          <KernelDial
            variant="nav"
            size={34}
            epochLength={sim.epochLength}
            blockInEpoch={sim.blockInEpoch}
            epochIndex={sim.epoch}
            paused={sim.flags.deadManEngaged}
            frozen={sim.flags.ledgerFrozen}
          />
          <DialReadout
            epochLength={sim.epochLength}
            blockInEpoch={sim.blockInEpoch}
            epochIndex={sim.epoch}
            paused={sim.flags.deadManEngaged}
          />
        </div>

        <div className="app-header__tools">
          {/* Not a renderer switch: five scenes carry an animated view, and this
              decides whether they open on it. The diagram is always a tab away
              either way, so this is a starting preference and says so. */}
          <button
            type="button"
            className="tgl"
            aria-pressed={motionEnabled}
            onClick={() => setMotionEnabled(!motionEnabled)}
          >
            <span className="tgl__dot" aria-hidden="true" />
            {motionEnabled ? 'Animation on' : 'Animation off'}
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
