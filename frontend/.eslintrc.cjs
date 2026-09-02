/**
 * ESLint config — added 2026-08-30 while diagnosing a React #310
 * ("Rendered more hooks than during the previous render") that reached a user.
 *
 * `eslint-plugin-react-hooks` was already a declared dependency and `npm run
 * lint` was already in package.json — but there was NO config file, so the lint
 * had never actually run. The one rule that catches #310 by construction,
 * `react-hooks/rules-of-hooks`, was installed and inert.
 *
 * Scoped deliberately: this turns on the hooks rules and TypeScript's
 * recommended set. It is not a style pass — a config that fails on 400
 * formatting nits gets switched off, and then the hooks rule is inert again.
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'e2e', '*.config.*'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh', 'react-hooks'],
  rules: {
    // The two that matter. rules-of-hooks is an ERROR: a violation is a crash
    // in production, not a style opinion.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Noise suppression so the signal above stays visible.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-undef': 'off',
  },
};
