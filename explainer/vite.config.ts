import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The explainer ships as a fully self-contained static bundle: no remote fonts,
// no CDN, no telemetry, no analytics. Hash routing keeps it host-agnostic.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    // No manual chunking. three/fiber/drei are reachable only through the lazy
    // `import()` in SceneFrame, so the natural split already puts them behind
    // that boundary — and a manual chunk actively defeats it: forcing them into
    // a named chunk flattens the dynamic edge and Vite then emits a
    // `modulepreload` for it, so a visitor who never enables 3D still downloads
    // ~240 kB gz of renderer. Measured, not assumed: see the README budget.
    chunkSizeWarningLimit: 900,
  },
});
