import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/**
 * Makes the dev server runnable at all, without weakening one byte of the release policy.
 *
 * 12 §5.1's meta CSP lives in `index.html`, and a `<meta http-equiv>` policy is enforced
 * wherever that document is served — including by the dev server, which serves the **source**
 * file. Two directives make a dev session impossible as written, and both are correct for the
 * release:
 *
 *  - `connect-src __CONNECT_SRC__`. The placeholder is substituted by `tools/release/build.ts`
 *    into `dist/index.html`, so in dev the directive's source list contains no valid source
 *    expression, which a parser treats as `'none'`. That blocks every connection the page
 *    makes, including Vite's own HMR WebSocket.
 *  - `style-src 'self'` with no inline allowance. The release satisfies this honestly:
 *    Tailwind emits one `assets/[hash].css` and `index.html` links it, same-origin, and it
 *    even picks up an SRI digest. The dev server is the different case — it serves CSS
 *    through a JS module so it can hot-replace it, which means an injected `<style>` element
 *    the policy refuses. Left alone, the dev server renders the application completely
 *    unstyled while the release renders correctly, which is the most misleading split
 *    available.
 *
 * Both relaxations therefore happen in `serve` mode only, in a plugin that **cannot** run at
 * build time (`apply: 'serve'`), rather than by widening the policy in the file that ships.
 * The `--dev-only` marker is there to be greppable: a policy that leaked into a built tree can
 * be found by searching for it, and `app/tests/release/pipeline.test.ts` asserts the built
 * `index.html` still carries `style-src 'self'` exactly and contains no marker.
 *
 * **The marker is an HTML comment, and it used to be inside the policy.** A CSP source list
 * has no comment syntax, so `/* --dev-only *\/` written between sources does not annotate the
 * directive — it parses as the host-source `*` with path `/`, which widens the dev policy to
 * every host rather than to the two things this plugin means to allow. It was a comment only
 * to a human reader. Marking the document instead keeps the greppability and leaves both
 * directives saying exactly what they permit.
 */
function devOnlyCsp(): Plugin {
  return {
    name: 'bleavit:dev-only-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace('<head>', '<head>\n    <!-- bleavit --dev-only CSP relaxation is active -->')
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace('__CONNECT_SRC__', "'self' ws: wss: https:");
    },
  };
}

/**
 * The deterministic release build — 12 §1.1, F11.
 *
 * Every option below is here because a default would have cost determinism, broken
 * content-addressed serving, or fought the CSP of 12 §5.1. Nothing is set for taste.
 */
export default defineConfig({
  plugins: [tailwindcss(), devOnlyCsp()],
  /**
   * **Relative, and this is load-bearing.** The release is served from a content address —
   * `https://<gateway>/<manifest-txid>/index.html` on a path gateway, a sandboxed
   * subdomain elsewhere, `ar://<txid>/` in a wallet browser. Vite's default `base: '/'`
   * would emit `/assets/…` and every asset request would leave the release directory: on a
   * path gateway it would resolve to some other transaction's file, which is the one class
   * of bug where the app keeps working and stops being the app that was published.
   */
  base: './',
  build: {
    target: 'es2022',
    /**
     * No sourcemaps in a release tree. 12 §1.1 records the reproducibility risk they carry
     * — pnpm's virtual store layout is encoded in their relative `sources` paths, so two
     * environments with different install shapes produce identical code and different maps,
     * and the two-environment tree-hash gate fails for a reason with nothing to do with the
     * source. Not shipping them removes that class rather than managing it. Debug builds
     * set this back on; they are not what gets signed.
     */
    sourcemap: false,
    /**
     * Content-hash-only filenames (12 §1.1). Not `[name]-[hash]`: the name half carries the
     * source module's identity into the published tree, which is both an unnecessary
     * disclosure and a second thing that has to be stable across environments for the
     * tree hash to match.
     */
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
    /**
     * Every asset is a file, never inlined. The default inlines below a size threshold,
     * which makes the emitted tree a function of a byte count — an asset that grows by one
     * byte changes *which files exist*. It also puts bytes somewhere SRI and the service
     * worker's per-file map cannot see them.
     */
    assetsInlineLimit: 0,
    /**
     * The module-preload polyfill is an inline `<script>`, which `script-src 'self'`
     * refuses (12 §5.1). Shipping it would mean either a broken console error on every
     * load or a `'unsafe-inline'` that guts the directive.
     */
    modulePreload: { polyfill: false },
    // The report is advisory noise in CI logs; the real budget gate is `check:budget`.
    reportCompressedSize: false,
  },
  /**
   * `public/` is copied verbatim — the PWA manifest lives there because it must keep a
   * fixed name (the `<link rel="manifest">` in `index.html` names it) and so must never be
   * content-hashed.
   */
  publicDir: 'public',
});
