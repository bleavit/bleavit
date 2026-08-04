import { defineConfig } from 'vite';

/**
 * The deterministic release build — 12 §1.1, F11.
 *
 * Every option below is here because a default would have cost determinism, broken
 * content-addressed serving, or fought the CSP of 12 §5.1. Nothing is set for taste.
 */
export default defineConfig({
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
