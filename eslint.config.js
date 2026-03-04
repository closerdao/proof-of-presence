import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: [
      'export/',
      'deployments/',
      'artifacts/',
      'cache/',
      'coverage/',
      'node_modules/',
      'typechain/',
      'types/',
      'generated/',
      '.yalc/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      'no-empty': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'},
      ],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
