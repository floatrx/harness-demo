import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '.work/**', '**/.harness/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Node runs harness/ by type stripping: only erasable TypeScript is allowed.
    files: ['harness/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'No enums in harness/: use an `as const` array and a union type.' },
        { selector: 'TSModuleDeclaration[kind!="global"]', message: 'No namespaces in harness/.' },
        { selector: 'TSParameterProperty', message: 'No parameter properties in harness/.' },
      ],
    },
  },
);
