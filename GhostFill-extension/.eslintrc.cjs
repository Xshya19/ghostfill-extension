module.exports = {
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react/recommended", "plugin:react-hooks/recommended", "plugin:security/recommended-legacy"],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
            jsx: true
        },
        project: "./tsconfig.json"
    },
    plugins: ["@typescript-eslint", "react", "react-hooks", "security", "import"],
    env: {
        browser: true,
        es2022: true,
        webextensions: true,
        node: true
    },
    settings: {
        react: {
            version: "detect"
        }
    },
    rules: {
        // TypeScript
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/strict-boolean-expressions": "off",
        "@typescript-eslint/no-floating-promises": "warn",
        "@typescript-eslint/await-thenable": "off",
        "@typescript-eslint/no-misused-promises": "warn",

        // React
        "react/react-in-jsx-scope": "off",
        "react/prop-types": "off",
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
        "react/no-unescaped-entities": "off",
        "react/jsx-no-target-blank": ["warn", { "allowReferrer": true }],
        "react/no-danger": "warn",

        // Security
        "security/detect-object-injection": "off",
        "security/detect-non-literal-fs-filename": "warn",
        "security/detect-eval-with-expression": "error",
        "security/detect-no-csrf-before-method-override": "error",
        "security/detect-possible-timing-attacks": "off",
        "security/detect-child-process": "off",
        "security/detect-disable-mustache-escape": "error",
        "security/detect-new-buffer": "error",
        "security/detect-pseudoRandomBytes": "off",
        "security/detect-unsafe-regex": "off",
        "security/detect-buffer-noassert": "error",
        "security/detect-non-literal-regexp": "off",
        "security/detect-non-literal-require": "off",

        // Import
        "import/order": ["warn", {
            "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
            "pathGroups": [
                {
                    "pattern": "@services/**",
                    "group": "internal",
                    "position": "after"
                },
                {
                    "pattern": "@utils/**",
                    "group": "internal",
                    "position": "after"
                },
                {
                    "pattern": "@components/**",
                    "group": "internal",
                    "position": "after"
                }
            ],
            "pathGroupsExcludedImportTypes": ["builtin"],
            "alphabetize": { "order": "asc", "caseInsensitive": true }
        }],
        "import/no-duplicates": "error",
        "import/no-unresolved": "off",
        "import/first": "error",
        "import/newline-after-import": "warn",
        // HIGH FIX #6: Warn against barrel exports from main modules
        "no-restricted-imports": ["warn", {
            "paths": [
                {
                    "name": "@services",
                    "message": "Use direct imports (e.g., '@services/emailServices') to avoid circular dependencies and improve tree-shaking"
                },
                {
                    "name": "@utils",
                    "message": "Use direct imports (e.g., '@utils/validators', '@utils/logger') to avoid circular dependencies and improve tree-shaking"
                }
            ],
            "patterns": [
                {
                    "group": ["@services/index", "@utils/index"],
                    "message": "Import directly from the module instead of through barrel exports"
                }
            ]
        }],

        // General
        "no-console": ["warn", { allow: ["warn", "error", "info"] }],
        "no-debugger": "error",
        "no-alert": "error",
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
        "no-return-await": "error",
        "require-await": "off",
        "no-promise-executor-return": "warn",
        "prefer-promise-reject-errors": "error",
        "no-extend-native": "error",
        "no-new-wrappers": "error",
        radix: ["warn", "always"],
        eqeqeq: ["error", "always"],
        curly: ["error", "all"],
        "no-var": "error",
        "prefer-const": "error",
        "no-implicit-coercion": "off",
        "no-label-var": "error",
        "no-shadow": "off",
        "@typescript-eslint/no-shadow": "off",
        "no-undef-init": "error",
        "no-unused-expressions": "off",
        "@typescript-eslint/no-unused-expressions": "off",
        yoda: ["error", "never"]
    },
    overrides: [
        {
            files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/tests/**", "**/mocks/**"],
            rules: {
                "@typescript-eslint/no-explicit-any": "off",
                "@typescript-eslint/no-unused-vars": "off",
                "security/detect-object-injection": "off",
                "no-console": "off",
                "@typescript-eslint/no-floating-promises": "off"
            }
        },
        {
            files: ["**/*.e2e.test.ts", "**/e2e/**"],
            plugins: ["playwright"],
            extends: ["plugin:playwright/recommended"],
            rules: {
                "no-console": "off",
                "@typescript-eslint/no-floating-promises": "off"
            }
        },
        {
            files: ["scripts/**/*.js", "*.config.js", "*.config.ts"],
            rules: {
                "@typescript-eslint/no-var-requires": "off",
                "no-console": "off",
                "security/detect-non-literal-fs-filename": "off"
            }
        }
    ],
    ignorePatterns: ["dist/**", "build/**", "coverage/**", "node_modules/**", "*.min.js"]
};
