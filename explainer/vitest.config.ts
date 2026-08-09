import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
    /**
     * The scene tests render a whole rail once per simulation state, and a rail
     * now mounts several typeset formulas. Each one is a few kilobytes of
     * pre-rendered KaTeX markup that jsdom has to parse from a string on every
     * mount — roughly 100 ms apiece, which pushes the widest of those tests past
     * the 5 s default even though nothing is hanging.
     *
     * Raised rather than worked around: the alternative is stubbing `Formula` in
     * tests, and then the suite stops exercising the markup the app ships.
     */
    testTimeout: 30_000,
  },
});
