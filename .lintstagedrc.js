/**
 * Lint-staged Configuration for GhostFill
 *
 * Runs linters and formatters on staged files only.
 * This ensures fast pre-commit hooks while maintaining code quality.
 *
 * SECURITY: Includes security linting rules
 * PERFORMANCE: Only processes staged files
 */

module.exports = {
  // ==========================================
  // TypeScript/JavaScript Files
  // ==========================================
  '*.ts': [
    // Fix ESLint issues
    'eslint --fix',
    // Fix Prettier formatting
    'prettier --write',
    // Run security linting
    'eslint --rule "security/detect-unsafe-regex: error"',
    // Run type check on staged files
    () => 'tsc --noEmit',
  ],

  '*.tsx': [
    'eslint --fix',
    'prettier --write',
    'eslint --rule "security/detect-unsafe-regex: error"',
    () => 'tsc --noEmit',
  ],

  '*.js': ['eslint --fix', 'prettier --write'],

  '*.jsx': ['eslint --fix', 'prettier --write'],

  '*.mjs': ['eslint --fix', 'prettier --write'],

  '*.cjs': ['eslint --fix', 'prettier --write'],

  // ==========================================
  // JSON Files
  // ==========================================
  '*.json': [
    'prettier --write',
    // Validate JSON syntax
    (files) => files.map((file) => `node -e "JSON.parse(require('fs').readFileSync('${file}'))"`),
  ],

  // ==========================================
  // CSS/SCSS Files
  // ==========================================
  '*.css': ['prettier --write'],

  '*.scss': ['prettier --write'],

  '*.sass': ['prettier --write'],

  '*.less': ['prettier --write'],

  // ==========================================
  // Markdown Files
  // ==========================================
  '*.md': [
    'prettier --write',
    // Check for broken links (if markdown-link-check is installed)
    // 'markdown-link-check',
  ],

  '*.mdx': ['prettier --write', 'eslint --fix'],

  // ==========================================
  // HTML Files
  // ==========================================
  '*.html': ['prettier --write'],

  // ==========================================
  // YAML Files
  // ==========================================
  '*.yml': ['prettier --write'],

  '*.yaml': ['prettier --write'],

  // ==========================================
  // Shell Scripts
  // ==========================================
  '*.sh': ['shellcheck'],

  // ==========================================
  // Test Files - Run related tests
  // ==========================================
  '*.test.ts': [],
  '*.test.tsx': [],
  '*.spec.ts': [],
  '*.spec.tsx': [],

  // ==========================================
  // Ignore binary and generated files
  // ==========================================
  '*.png': false,
  '*.jpg': false,
  '*.jpeg': false,
  '*.gif': false,
  '*.svg': false,
  '*.ico': false,
  '*.webp': false,
  '*.woff': false,
  '*.woff2': false,
  '*.ttf': false,
  '*.eot': false,
  '*.mp4': false,
  '*.mp3': false,
  '*.avi': false,
  '*.mov': false,
  '*.pdf': false,
  '*.zip': false,
  '*.tar': false,
  '*.gz': false,
  '*.lock': false,

  // ==========================================
  // Ignore generated directories
  // ==========================================
  'dist/**/*': false,
  'build/**/*': false,
  'coverage/**/*': false,
  'node_modules/**/*': false,
  '.next/**/*': false,
  'out/**/*': false,
};
