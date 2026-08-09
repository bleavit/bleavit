import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Local echo of the doc 10 §10 dependency firewall.
 *
 * `protocol/` and `sim/` are the accuracy core: pure TypeScript, no framework.
 * If React or three can reach into them, the protocol math stops being
 * independently testable. `ui/` is the design system and must not know about 3D.
 */
const firewall = (patterns) => ({
  rules: {
    'no-restricted-imports': ['error', { patterns }],
  },
});

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'src/protocol/__fixtures__/*.json'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'The simulation must be deterministic and replayable. Use sim/rng.ts.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'No wall-clock dependence: simulated time is driven by block numbers.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'No wall-clock dependence: simulated time is driven by block numbers.',
        },
      ],
    },
  },

  {
    files: ['src/protocol/**/*.ts', 'src/sim/**/*.ts'],
    ...firewall([
      { group: ['react', 'react-dom', 'react/*'], message: 'protocol/ and sim/ must stay framework-free.' },
      { group: ['three', 'three/*', '@react-three/*'], message: 'protocol/ and sim/ must stay 3D-free.' },
      { group: ['*.css'], message: 'protocol/ and sim/ must stay presentation-free.' },
    ]),
  },

  {
    files: ['src/ui/**/*.{ts,tsx}'],
    ...firewall([
      { group: ['three', 'three/*', '@react-three/*'], message: 'ui/ is the 2D design system; 3D lives in scenes/r3f.' },
    ]),
  },

  /**
   * The lazy boundary, made structural.
   *
   * `SceneFrame` reaches the renderer through a single dynamic `import()`, which
   * is what keeps three/fiber/drei out of the app shell entirely. One static
   * import from a scene module — even a type-only one that got its `type` keyword
   * dropped in a refactor — collapses that boundary silently: the build still
   * succeeds, and the 245 kB chunk lands on every first paint. Scenes name a
   * motion through `scenes/motion.ts`, which is deliberately three-free.
   */
  {
    files: ['src/scenes/**/*.{ts,tsx}'],
    ignores: ['src/scenes/r3f/**'],
    ...firewall([
      {
        group: ['three', 'three/*', '@react-three/*'],
        message:
          'Only scenes/r3f may import three — everything else reaches it through the lazy import in SceneFrame.',
      },
    ]),
  },

  {
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
