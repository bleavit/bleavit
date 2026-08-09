/**
 * The Bleavit mark.
 *
 * Traced from `assets/Bleavit-logo.png` — the four ink components isolated,
 * boundary-traced, and reduced to their true corners, with the two bowls'
 * outer edges restored as ellipse arcs rather than kept as the polygons a
 * bitmap trace produces. The result is the real mark, crisp at any size, and it
 * inherits `currentColor` so it works in both themes without a second asset.
 *
 * The geometry earns its place in this app rather than just sitting in the
 * corner: the mark is a **B split by a vertical seam**, with a chevron notch
 * meeting that seam from either side. That is the same axis the whole product
 * is built on — ACCEPT above, REJECT below, and the seam between them where a
 * deposit becomes a claim in both futures at once. The Kernel Dial's fixed
 * index is drawn as the same seam, so the instrument and the mark rhyme.
 */

const MARK_PATH =
  // The centre seam, with the diamond where the two chevrons meet.
  'M34.33 0 L43 0 L43 42.5 L49.67 49.17 L43 55.83 L43 100 L34.33 100 ' +
  'L34.33 55.83 L27.67 49.17 L34.33 42.5 Z ' +
  // The left slab, notched by the chevron.
  'M0 4.5 L27 4.5 L27 34.5 L12.5 48.67 L27 63.33 L27 94.33 L0 94.33 Z ' +
  // Upper bowl: outer arc, angular inner counter.
  'M50.17 4.5 L72.33 4.5 A17.4 20.35 0 0 1 72.33 45.2 L57.17 45.33 ' +
  'L52.17 40.33 L72 23.83 L50.17 23.67 Z ' +
  // Lower bowl: the same, mirrored.
  'M57.5 53.33 L72.5 53.33 A18 20.6 0 0 1 72.5 94.5 L50.17 94.5 ' +
  'L50.17 74 L72 73.83 L52.33 58.33 Z';

export interface BrandMarkProps {
  size?: number;
  /** Decorative beside a wordmark; titled when it stands alone. */
  title?: string;
}

export function BrandMark({ size = 28, title }: BrandMarkProps) {
  return (
    <svg
      className="brandmark"
      width={(size * 90.33) / 100}
      height={size}
      viewBox="0 0 90.33 100"
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
