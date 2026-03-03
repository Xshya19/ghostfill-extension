#!/usr/bin/env node
/**
 * Bundle Size Checker for GhostFill
 *
 * This script verifies that the extension bundle size is within acceptable limits.
 * Chrome extensions have a 10MB limit for unpacked extensions and stricter
 * limits for Chrome Web Store submissions.
 *
 * Usage:
 *   node scripts/check-bundle-size.js
 *
 * Environment variables:
 *   BUNDLE_SIZE_LIMIT_KB - Maximum bundle size in KB (default: 2048)
 *   BUNDLE_SIZE_WARNING_KB - Warning threshold in KB (default: 1536)
 *
 * Exit codes:
 *   0 - Bundle size within limits
 *   1 - Bundle size exceeds limits
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ==========================================
// Configuration
// ==========================================

const STATS_FILE = join(process.cwd(), 'dist', 'stats.json');
const BUNDLE_SIZE_LIMIT_KB = parseInt(process.env.BUNDLE_SIZE_LIMIT_KB || '2048', 10);
const BUNDLE_SIZE_WARNING_KB = parseInt(process.env.BUNDLE_SIZE_WARNING_KB || '1536', 10);

// ==========================================
// Colors for output
// ==========================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

// ==========================================
// Main function
// ==========================================

function checkBundleSize() {
  log(colors.blue, '========================================');
  log(colors.blue, '📦 Bundle Size Checker');
  log(colors.blue, '========================================');
  log(colors.blue, '');

  // Check if stats file exists
  if (!existsSync(STATS_FILE)) {
    log(colors.red, '❌ Bundle stats file not found!');
    log(colors.yellow, `Expected: ${STATS_FILE}`);
    log(colors.yellow, 'Run "npm run build" first.');
    process.exit(1);
  }

  // Read stats
  let stats;
  try {
    const statsContent = readFileSync(STATS_FILE, 'utf-8');
    stats = JSON.parse(statsContent);
  } catch (error) {
    log(colors.red, '❌ Failed to parse stats file!');
    log(colors.yellow, error.message);
    process.exit(1);
  }

  // ==========================================
  // Calculate total bundle size
  // ==========================================

  const assets = stats.assets || [];
  let totalSize = 0;
  let largestAsset = null;
  let largestSize = 0;

  log(colors.cyan, 'Bundle Assets:');
  log(colors.cyan, '--------------');

  assets.forEach((asset) => {
    const size = asset.size || 0;
    totalSize += size;

    if (size > largestSize) {
      largestSize = size;
      largestAsset = asset.name;
    }

    const sizeFormatted = formatSize(size);
    log(colors.cyan, `  ${asset.name}: ${sizeFormatted}`);
  });

  log(colors.blue, '');

  // ==========================================
  // Check limits
  // ==========================================

  const totalSizeKB = totalSize / 1024;
  const limitKB = BUNDLE_SIZE_LIMIT_KB;
  const warningKB = BUNDLE_SIZE_WARNING_KB;

  log(colors.cyan, 'Bundle Summary:');
  log(colors.cyan, '---------------');
  log(colors.cyan, `  Total size: ${formatSize(totalSize)}`);
  log(colors.cyan, `  Largest asset: ${largestAsset} (${formatSize(largestSize)})`);
  log(colors.cyan, `  Warning threshold: ${warningKB} KB`);
  log(colors.cyan, `  Limit: ${limitKB} KB`);
  log(colors.blue, '');

  // ==========================================
  // Determine status
  // ==========================================

  let status = 'pass';
  let statusColor = colors.green;
  let statusMessage = '✅ Bundle size within limits!';

  if (totalSizeKB > limitKB) {
    status = 'fail';
    statusColor = colors.red;
    statusMessage = '❌ Bundle size exceeds limit!';
  } else if (totalSizeKB > warningKB) {
    status = 'warning';
    statusColor = colors.yellow;
    statusMessage = '⚠️  Bundle size approaching limit!';
  }

  log(statusColor, '========================================');
  log(statusColor, statusMessage);
  log(statusColor, '========================================');

  // ==========================================
  // Recommendations
  // ==========================================

  if (status !== 'pass') {
    log(colors.blue, '');
    log(colors.yellow, 'Recommendations to reduce bundle size:');
    log(colors.yellow, '  - Enable code splitting');
    log(colors.yellow, '  - Tree-shake unused code');
    log(colors.yellow, '  - Use dynamic imports for large dependencies');
    log(colors.yellow, '  - Optimize images and assets');
    log(colors.yellow, '  - Remove unused dependencies');
    log(colors.yellow, '  - Use production builds');
    log(colors.yellow, '');
    log(colors.yellow, 'View detailed analysis:');
    log(colors.yellow, '  npm run analyze');
  }

  // ==========================================
  // Output size for CI
  // ==========================================

  console.log(`\n${Math.round(totalSizeKB)}`);

  // ==========================================
  // Exit with appropriate code
  // ==========================================

  if (status === 'fail') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// ==========================================
// Run
// ==========================================

checkBundleSize();
