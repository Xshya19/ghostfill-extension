const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const security = require('eslint-plugin-security');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      '**/*.min.js',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      'scripts/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser, ...globals.es2022, ...globals.webextensions },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      security,
      import: importPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      ...security.configs.recommended.rules,
      // TypeScript - Chrome Extension Context
      '@typescript-eslint/explicit-function-return-type': 'off',
      // any is commonly needed for Chrome extension APIs
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-shadow': 'off',

      // React - Chrome Extension Context
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'react/no-unescaped-entities': 'off',
      'react/jsx-no-target-blank': ['warn', { allowReferrer: true }],
      'react/no-danger': 'warn',
      'react/jsx-key': 'error',

      // Security - Chrome Extension Context
      // These are expected in extension code where dynamic property access is common
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'off',
      'security/detect-child-process': 'off',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-pseudoRandomBytes': 'warn',
      // Regex patterns are intentional for form/email detection
      'security/detect-unsafe-regex': 'off',
      'security/detect-buffer-noassert': 'error',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-non-literal-require': 'off',

      // Import
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            {
              pattern: '@services/**',
              group: 'internal',
              position: 'after',
            },
            {
              pattern: '@utils/**',
              group: 'internal',
              position: 'after',
            },
            {
              pattern: '@components/**',
              group: 'internal',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'off',
      'import/no-cycle': 'warn',
      'import/first': 'error',
      'import/newline-after-import': 'warn',
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: '@services',
              message:
                "Use direct imports (e.g., '@services/emailServices') to avoid circular dependencies and improve tree-shaking",
            },
            {
              name: '@utils',
              message:
                "Use direct imports (e.g., '@utils/validators', '@utils/logger') to avoid circular dependencies and improve tree-shaking",
            },
          ],
          patterns: [
            {
              group: ['@services/index', '@utils/index'],
              message: 'Import directly from the module instead of through barrel exports',
            },
          ],
        },
      ],

      // General - Chrome Extension Context
      // console is needed for extension debugging and logging
      'no-console': 'off',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'error',
      'require-await': 'off',
      'no-promise-executor-return': 'off',
      'prefer-promise-reject-errors': 'error',
      'no-extend-native': 'error',
      'no-new-wrappers': 'error',
      radix: ['warn', 'always'],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': 'off',
      'no-label-var': 'error',
      'no-shadow': 'off',
      'no-undef-init': 'error',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      yoda: ['error', 'never'],
    },
  },
];
