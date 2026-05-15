/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', '@nx'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    '@nx/enforce-module-boundaries': [
      'error',
      {
        enforceBuildableLibDependency: true,
        allow: [],
        depConstraints: [
          {
            sourceTag: 'scope:contract',
            onlyDependOnLibsWithTags: [],
          },
          {
            sourceTag: 'scope:runtime',
            onlyDependOnLibsWithTags: ['scope:contract'],
          },
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    '.nx',
    '*.config.ts',
    '*.config.cjs',
    'coverage',
  ],
  overrides: [
    {
      files: ['*.test.ts', '*.spec.ts', '*.test-d.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
