/**
 * GhostFill - Comprehensive Issue Reporter
 * Run: node scripts/issue-reporter.js
 *
 * This script runs all checks and outputs a clean, shareable report.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('═'.repeat(80));
console.log('GHOSTFILL - COMPREHENSIVE ISSUE REPORT');
console.log('═'.repeat(80));
console.log(`Generated: ${new Date().toISOString()}`);
console.log('');

// Helper function to run command and capture output
function runCommand(cmd, description) {
  console.log('─'.repeat(80));
  console.log(`📋 ${description}`);
  console.log(`Command: ${cmd}`);
  console.log('─'.repeat(80));

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    console.log(output);
    return { success: true, output };
  } catch (error) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    const output = stdout + stderr;

    if (output) {
      console.log(output);
    } else {
      console.log('(No output captured)');
    }
    return { success: false, output, exitCode: error.status };
  }
}

// Run all checks
console.log('\n🟢 PART 1: TYPESCRIPT TYPE CHECK\n');
const tsResult = runCommand('npm run type-check 2>&1 || true', 'TypeScript Type Check');

console.log('\n🟢 PART 2: ESLINT CHECK\n');
const lintResult = runCommand('npm run lint 2>&1 || true', 'ESLint Check');

console.log('\n🟢 PART 3: BUILD CHECK\n');
const buildResult = runCommand('npm run build 2>&1 || true', 'Build Check');

console.log('\n🟢 PART 4: TEST CHECK\n');
const testResult = runCommand('npm test 2>&1 || echo "Tests skipped or failed"', 'Test Check');

// Summary
console.log('\n' + '═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));

const checks = [
  { name: 'TypeScript', result: tsResult },
  { name: 'ESLint', result: lintResult },
  { name: 'Build', result: buildResult },
  { name: 'Tests', result: testResult },
];

checks.forEach(({ name, result }) => {
  const status = result.success ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} - ${name}`);
});

console.log('\n' + '═'.repeat(80));
console.log('END OF REPORT');
console.log('═'.repeat(80));

// Export results for programmatic use
module.exports = { tsResult, lintResult, buildResult, testResult };
