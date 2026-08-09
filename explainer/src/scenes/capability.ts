/**
 * Whether to draw a scene in 3D, and — when not — the honest reason why.
 *
 * The 2D fallback is not a downgrade path bolted on at the end: both renderers
 * consume the same `SceneModel`, so the fallback is literally the same drawing
 * under the same orthographic projection. That is what makes "degrades to 2D" a
 * build-time guarantee rather than a promise.
 *
 * Every rung of the ladder is a named state with one line of user-facing copy.
 * None of them is a spinner or an empty box.
 */

export interface Capability {
  ok: boolean;
  /** User-facing sentence. Present whenever `ok` is false. */
  reason: string | null;
}

const OK: Capability = { ok: true, reason: null };

let webgl2Support: boolean | null = null;

/**
 * Probe for WebGL 2 — **once per session**, and cache it.
 *
 * The caching is not an optimisation, it is a correctness fix. Browsers cap the
 * number of live WebGL contexts (commonly 16) and evict the oldest when a new
 * one is created. This probe creates a context and force-loses it, so calling it
 * repeatedly — as a viewport-width `useMemo` will — churns through that budget
 * and can evict the live scene's own context. Observed in a real browser as
 * `THREE.WebGLRenderer: Context Lost` while nothing was wrong.
 */
export function detectWebgl2(): boolean {
  if (webgl2Support !== null) return webgl2Support;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) {
      webgl2Support = false;
      return false;
    }
    // Release the probe's own context immediately; we only wanted to know.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    webgl2Support = true;
    return true;
  } catch {
    webgl2Support = false;
    return false;
  }
}

/** Test seam: forget the cached probe result. */
export function resetCapabilityProbe(): void {
  webgl2Support = null;
}

/**
 * Evaluate a media query without ever throwing.
 *
 * Presence is not enough: some environments expose `matchMedia` as a property
 * that is not callable, and older WebViews throw on queries they do not
 * recognise. A capability probe that can itself fail is not a capability probe,
 * so every failure resolves to "not matched" and the caller degrades.
 */
function mq(query: string): boolean {
  if (typeof window === 'undefined') return false;
  const fn = (window as Window & { matchMedia?: unknown }).matchMedia;
  if (typeof fn !== 'function') return false;
  try {
    return window.matchMedia(query).matches === true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return mq('(prefers-reduced-motion: reduce)');
}

export function prefersReducedData(): boolean {
  return mq('(prefers-reduced-data: reduce)');
}

function deviceMemoryGb(): number | null {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
}

function isCoarsePointer(): boolean {
  return mq('(pointer: coarse)');
}

/**
 * The ladder, in order. Reduced motion is checked first and is absolute: a user
 * who has asked the platform for less motion gets the static drawing, not a
 * frozen canvas.
 */
export function assessCapability(viewportWidth: number): Capability {
  if (prefersReducedMotion()) {
    return {
      ok: false,
      reason: 'Your system asks for reduced motion, so the static diagram is shown.',
    };
  }
  if (!detectWebgl2()) {
    return {
      ok: false,
      reason: 'WebGL 2 is unavailable here, so the static diagram is shown.',
    };
  }
  if (prefersReducedData()) {
    return {
      ok: false,
      reason: 'Your system asks to save data, so the static diagram is shown.',
    };
  }
  if (viewportWidth < 360) {
    return { ok: false, reason: 'The viewport is too narrow for the 3D stage.' };
  }
  const mem = deviceMemoryGb();
  if (isCoarsePointer() && mem !== null && mem < 4) {
    return {
      ok: false,
      reason: 'This device reports limited memory, so the static diagram is shown.',
    };
  }
  return OK;
}

/** Default the small-viewport case to 2D, while leaving the user an override. */
export function defaultsTo2d(viewportWidth: number): boolean {
  return viewportWidth < 768;
}

/**
 * A running frame-rate watch that bails to 2D if the scene cannot hold a usable
 * rate. Deliberately slow to trigger and one-way: flapping between renderers
 * would be worse than either.
 *
 * The renderer runs `frameloop="demand"`, which makes the naive reading of this
 * wrong in a way that fires constantly: an idle scene draws nothing, so the gap
 * between two consecutive frames is however long the user spent reading —
 * seconds — and the instantaneous rate computed from it is a fraction of a frame
 * per second. A guard built on that degrades a perfectly healthy scene to 2D
 * simply because nobody touched it. `IDLE_GAP` is the fix: a gap longer than
 * that is the loop having been *asleep*, not slow, and it restarts the window
 * instead of poisoning it. What survives is the thing worth measuring — the rate
 * inside a contiguous burst of frames, which is exactly when the GPU is working.
 */
const IDLE_GAP_SECONDS = 0.5;

export class FrameRateWatch {
  private samples: number[] = [];
  private last = 0;
  private tripped = false;

  constructor(
    private readonly minFps = 24,
    private readonly windowSize = 60,
  ) {}

  /** Feed the r3f clock's elapsed time (seconds). Returns true once, on trip. */
  sample(elapsedSeconds: number): boolean {
    if (this.tripped) return false;
    if (this.last === 0) {
      this.last = elapsedSeconds;
      return false;
    }
    const dt = elapsedSeconds - this.last;
    this.last = elapsedSeconds;
    if (dt <= 0) return false;
    if (dt > IDLE_GAP_SECONDS) {
      this.samples = [];
      return false;
    }

    this.samples.push(1 / dt);
    if (this.samples.length < this.windowSize) return false;
    this.samples = this.samples.slice(-this.windowSize);

    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted[mid] ?? 0;
    if (median < this.minFps) {
      this.tripped = true;
      return true;
    }
    this.samples = [];
    return false;
  }

  reset(): void {
    this.samples = [];
    this.last = 0;
    this.tripped = false;
  }
}
