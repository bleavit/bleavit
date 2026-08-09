import type { ReactNode } from 'react';
import type { Provenance } from '../provenance/types';
import { PROVENANCE_DESCRIPTION, PROVENANCE_LABEL } from '../provenance/types';
import './provenance.css';

/**
 * Provenance is communicated on three channels, and colour is never one of them.
 *
 *  1. **Glyph** — one 14x14 square family; the *fill pattern* carries the meaning,
 *     so it survives achromatopsia and greyscale printing.
 *  2. **Text** — the canonical spelling in full, never a single letter, never an
 *     icon alone. Always in `aria-label`, and printed inline above caption size.
 *  3. **Chroma clamp plus hatch** on the ground — which never reduces *text*
 *     contrast. An untrusted value stays fully legible; only its ground is
 *     downgraded. Legibility is not the lever for trust.
 */

const GLYPHS: Record<Provenance, ReactNode> = {
  // A seal: solid, with a notch bitten out of the corner.
  spec: <path d="M1 1h12v8l-4 4H1z" fill="currentColor" />,
  // Dotted outline: computed here, not stated anywhere.
  derived: (
    <rect
      x="1.5"
      y="1.5"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    />
  ),
  // Hatched with one corner cut open: filled in, but not closed.
  simulated: (
    <>
      <defs>
        <pattern
          id="prov-hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <path
        d="M1.5 1.5h11v7l-3.5 4h-7.5z"
        fill="url(#prov-hatch)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </>
  ),
};

export interface ProvenanceBadgeProps {
  prov: Provenance;
  /** Print the canonical word beside the glyph. Off in dense table cells. */
  showText?: boolean;
  size?: number;
}

export function ProvenanceBadge({
  prov,
  showText = false,
  size = 14,
}: ProvenanceBadgeProps) {
  const label = PROVENANCE_LABEL[prov];
  return (
    <span
      className={`prov prov--${prov}`}
      title={`${label} — ${PROVENANCE_DESCRIPTION[prov]}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
        className="prov__glyph"
      >
        {GLYPHS[prov]}
      </svg>
      {showText ? (
        <span className="prov__text mono">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

/*
 * The standing disclosure used to live here as its own fixed strip at the bottom
 * edge. It now rides inside `ScenarioTransport` as a permanent chip, because two
 * stacked fixed bars cost 150px of every viewport and read as two pieces of
 * chrome competing for the same attention. The property that actually mattered —
 * always on screen, never dismissable — is unchanged.
 */
