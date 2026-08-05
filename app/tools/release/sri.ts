/**
 * Subresource Integrity — 12 §5.3, F11.
 *
 * Build-generated SHA-384 `integrity` attributes on every `<script>` and stylesheet
 * `<link>`. What it buys is narrow and 12 §5.3 says so: it protects sub-asset integrity
 * *when honest HTML is served with tampered assets*. It complements content addressing and
 * never replaces it — a gateway that serves tampered HTML strips the attribute along with
 * everything else, and that case is caught by the T-1 controls, not here.
 *
 * ## Only the elements the browser actually checks
 *
 * `integrity` is honoured on `<script>`, on `<link rel="stylesheet">` and on
 * `<link rel="modulepreload">`. It is **not** honoured on `<link rel="manifest">`, on
 * images, or on `<link rel="icon">`. Emitting it there would look like coverage and be
 * enforced by nothing — a decorative attribute is worse than an absent one, because a
 * reader counts it. So the injector refuses to touch a `rel` it cannot name a browser
 * behaviour for, and reports what it skipped rather than silently doing nothing.
 */

import { createHash } from 'node:crypto';

/**
 * `rel` values whose `integrity` a browser enforces.
 *
 * Matched **token-wise**, because `rel` is a space-separated token list: `rel="modulepreload
 * preload"` is a module preload the browser does check, and comparing the whole attribute
 * as one string skipped it — leaving a genuinely protectable subresource unprotected while
 * the build reported it as a deliberate skip.
 */
const SRI_RELS = new Set(['stylesheet', 'modulepreload', 'preload']);

export class SriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SriError';
  }
}

export function sha384(bytes: Uint8Array | string): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

/** The emitted bytes for a same-tree reference, or `undefined` if it was never emitted. */
export type ResolveBytes = (href: string) => Uint8Array | undefined;

export interface ProtectedRef {
  readonly href: string;
  readonly integrity: string;
}

/** A `<link>` whose `rel` no browser enforces `integrity` for. Reported, never silent. */
export interface SkippedRef {
  readonly href: string;
  readonly rel: string;
}

export interface SriInjection {
  readonly html: string;
  readonly protectedRefs: readonly ProtectedRef[];
  readonly skipped: readonly SkippedRef[];
}

/** `actual` is `null` when the reference could not be resolved to any bytes at all. */
export interface SriMismatch {
  readonly href: string;
  readonly declared: string;
  readonly actual: string | null;
}

const TAG = /<(script|link)\b([^>]*)>/gi;
/**
 * Double-quoted, single-quoted and unquoted attribute values.
 *
 * The first draft matched only `name="value"`, so `<script src='./assets/evil.js'>` and
 * `<script src=./assets/evil.js>` — both valid HTML the browser loads — were parsed as
 * having no `src` at all and left without an `integrity`. A subresource this parser cannot
 * read is now a build failure rather than a silent skip (see `injectSri`), because "I did
 * not understand this tag" and "this tag needs no protection" must not have the same
 * outcome in a security control.
 */
const ATTR = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

type Attributes = ReadonlyMap<string, string>;

function attributes(raw: string): Attributes {
  const out = new Map<string, string>();
  for (const match of raw.matchAll(ATTR)) {
    out.set((match[1] ?? '').toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
}

function relTokens(attrs: Attributes): string[] {
  return (attrs.get('rel') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Add `integrity` and `crossorigin` to every subresource the browser will check.
 *
 * `resolveBytes(href)` returns the emitted file's bytes, or `undefined` for a reference the
 * build did not emit. An unresolvable **same-tree** reference throws: an asset the release
 * links to and does not contain is a broken release, and the alternative — skipping it —
 * would produce an `index.html` whose unprotected subresources are exactly the ones nobody
 * noticed were missing.
 */
export function injectSri(html: string, resolveBytes: ResolveBytes): SriInjection {
  const protectedRefs: ProtectedRef[] = [];
  const skipped: SkippedRef[] = [];
  const out = html.replace(TAG, (whole: string, tag: string, rawAttrs: string) => {
    const attrs = attributes(rawAttrs);
    const isScript = tag.toLowerCase() === 'script';
    const href = isScript ? attrs.get('src') : attrs.get('href');
    if (href === undefined) {
      // An inline `<script>` has no `src` and nothing to protect. A `<link>` with no `href`
      // loads nothing. Both are legitimately untouched — but a tag that *looks* like it
      // references something and whose reference this parser could not read must not land
      // here silently, so the raw text is checked for the attribute name.
      if (new RegExp(`\\b${isScript ? 'src' : 'href'}\\b`, 'i').test(rawAttrs)) {
        throw new SriError(
          `a <${tag}> declares ${isScript ? 'src' : 'href'} in a form this parser cannot read: ` +
            `<${tag}${rawAttrs}>. A subresource that cannot be read must not be treated as one ` +
            'that needs no protection.',
        );
      }
      return whole;
    }
    if (href === '') throw new SriError(`a <${tag}> declares an empty reference`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      // An absolute or protocol-relative URL is not this release's file. It also cannot
      // legitimately appear: `default-src 'none'` plus an enumerated `connect-src` mean a
      // release that referenced one would be broken on arrival, so this is a refusal
      // rather than a skip.
      throw new SriError(`${href} is an off-release subresource reference`);
    }
    if (!isScript) {
      const tokens = relTokens(attrs);
      if (!tokens.some((token) => SRI_RELS.has(token))) {
        skipped.push({ href, rel: attrs.get('rel') ?? '' });
        return whole;
      }
    }
    if (attrs.has('integrity')) throw new SriError(`${href} already carries an integrity attribute`);
    const bytes = resolveBytes(href);
    if (bytes === undefined) throw new SriError(`${href} is linked but was not emitted`);
    const digest = sha384(bytes);
    protectedRefs.push({ href, integrity: digest });
    const withCrossorigin = attrs.has('crossorigin') ? '' : ' crossorigin="anonymous"';
    return `<${tag}${rawAttrs} integrity="${digest}"${withCrossorigin}>`;
  });
  return { html: out, protectedRefs, skipped };
}

/**
 * Re-derive every declared digest from the file it names, and report the mismatches.
 *
 * The presence check the pipeline also runs — *is there an `integrity` attribute at all* —
 * can only catch an injector that did not run. It cannot catch the case that matters more:
 * a digest that is present and **wrong**, from a tree edited after the injection or
 * assembled by something other than this pipeline. A browser would refuse to execute the
 * script and the app would be blank, which is fail-closed and completely opaque. So
 * `release:check` recomputes rather than counts.
 */
export function verifySri(html: string, resolveBytes: ResolveBytes): SriMismatch[] {
  const mismatches: SriMismatch[] = [];
  for (const [, tag, rawAttrs] of html.matchAll(TAG)) {
    // `TAG` has two capture groups and both are unconditional, so a match without them is
    // a regex change rather than an input the scan should tolerate.
    if (tag === undefined || rawAttrs === undefined) continue;
    const attrs = attributes(rawAttrs);
    const declared = attrs.get('integrity');
    if (!declared) continue;
    const href = tag.toLowerCase() === 'script' ? attrs.get('src') : attrs.get('href');
    const bytes = href === undefined ? undefined : resolveBytes(href);
    if (bytes === undefined) {
      mismatches.push({ href: href ?? '<no reference>', declared, actual: null });
      continue;
    }
    const actual = sha384(bytes);
    if (actual !== declared) mismatches.push({ href: href ?? '<no reference>', declared, actual });
  }
  return mismatches;
}
