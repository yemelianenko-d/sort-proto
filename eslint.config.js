import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // mock analytics logs to console by design
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  // Architectural boundaries (see ARCHITECTURE.md + docs/MECHANIC_SDK.md):
  // a mechanic talks outward ONLY via EventBus + the shared core/ui/config
  // public API. It must never import the platform layer, nor another mechanic.
  // Turns the rule from a convention into a build failure. A new mechanic adds
  // its own cross-mechanic block below (and lists siblings to ban).
  {
    files: ['src/mechanics/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/platform/**', '**/platform'],
              message:
                'Mechanics must not import the platform layer. Emit an EventBus event; the app wires platform services.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/mechanics/sorting/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/platform/**', '**/platform'],
              message: 'Mechanics must not import the platform layer (use EventBus).',
            },
            {
              group: ['**/mechanics/blocks', '**/mechanics/blocks/**', '../blocks', '../blocks/**'],
              message: 'A mechanic must not import another mechanic. Communicate via EventBus.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/mechanics/blocks/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/platform/**', '**/platform'],
              message: 'Mechanics must not import the platform layer (use EventBus).',
            },
            {
              group: ['**/mechanics/sorting', '**/mechanics/sorting/**', '../sorting', '../sorting/**'],
              message: 'A mechanic must not import another mechanic. Communicate via EventBus.',
            },
          ],
        },
      ],
    },
  },
  {
    // dist/build output + local art-tooling scratch (not part of the pipeline)
    ignores: [
      'dist/**',
      'node_modules/**',
      'tools/art/_preview/**',
      'tools/art/montage.mjs',
      'tools/art/montage-current.mjs',
      'tools/art/render-blocks.mjs',
    ],
  },
);
