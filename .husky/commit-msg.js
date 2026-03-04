#!/usr/bin/env node

/**
 * Commit Message Validator
 * 
 * Enforces conventional commit format:
 * type(scope): description
 * 
 * Types: feat, fix, docs, style, refactor, test, chore, security, perf
 */

const fs = require('fs');
const path = require('path');

const commitMessageFile = process.argv[2] || '.git/COMMIT_EDITMSG';
const commitMessage = fs.readFileSync(commitMessageFile, 'utf-8').trim();

// Skip validation for merge commits
if (commitMessage.startsWith('Merge ')) {
  process.exit(0);
}

// Conventional commit regex
const commitPattern = /^(feat|fix|docs|style|refactor|test|chore|security|perf|ci|build|revert)(\([a-z0-9-]+\))?: .{1,100}$/;

// Security-related commits require more detail
const securityPattern = /^security: .{20,}$/;

if (!commitPattern.test(commitMessage)) {
  console.error('\n❌ Invalid commit message format!');
  console.error('\nExpected format: type(scope): description');
  console.error('\nValid types:');
  console.error('  feat     - New feature');
  console.error('  fix      - Bug fix');
  console.error('  docs     - Documentation changes');
  console.error('  style    - Code style changes (formatting)');
  console.error('  refactor - Code refactoring');
  console.error('  test     - Adding/updating tests');
  console.error('  chore    - Maintenance tasks');
  console.error('  security - Security fixes');
  console.error('  perf     - Performance improvements');
  console.error('  ci       - CI/CD changes');
  console.error('  build    - Build system changes');
  console.error('  revert   - Reverting changes');
  console.error('\nExamples:');
  console.error('  feat(auth): add OAuth2 support');
  console.error('  fix(otp): resolve detection issue with Gmail');
  console.error('  security(crypto): upgrade to AES-256-GCM');
  console.error('\n');
  process.exit(1);
}

// Additional security commit validation
if (commitMessage.startsWith('security:') && !securityPattern.test(commitMessage)) {
  console.error('\n⚠️ Security commits require detailed descriptions (min 20 chars)');
  console.error('Example: security(crypto): upgrade password hashing to argon2id');
  console.error('\n');
  process.exit(1);
}

console.log('✅ Commit message validated');
process.exit(0);
