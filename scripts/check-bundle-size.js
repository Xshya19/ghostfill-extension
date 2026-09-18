#!/usr/bin/env node
/**
 * Bundle budget gate for the complete unpacked extension.
 *
 * Webpack does not emit dist/stats.json in the normal production build, so
 * this checker reads it when supplied by analysis tooling and otherwise walks
 * dist directly. That keeps `npm run build && node scripts/check-bundle-size.js`
 * useful locally and in CI.
 */

const { existsSync, readFileSync, readdirSync, statSync } = require('fs');
const { join, relative, sep } = require('path');

const DIST_DIR = join(process.cwd(), 'dist');
const STATS_FILE = join(DIST_DIR, 'stats.json');
const TOTAL_LIMIT_KB = Number.parseInt(process.env.BUNDLE_SIZE_LIMIT_KB || '4096', 10);
const TOTAL_WARNING_KB = Number.parseInt(process.env.BUNDLE_SIZE_WARNING_KB || '3072', 10);
const ASSET_LIMIT_KB = Number.parseInt(process.env.BUNDLE_ASSET_LIMIT_KB || '1024', 10);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function walkAssets(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkAssets(absolutePath, root);
    }
    if (!entry.isFile() || entry.name === 'stats.json' || entry.name.endsWith('.map')) {
      return [];
    }
    return [
      {
        name: relative(root, absolutePath).split(sep).join('/'),
        size: statSync(absolutePath).size,
      },
    ];
  });
}

function readAssets() {
  if (existsSync(STATS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(STATS_FILE, 'utf8'));
      if (Array.isArray(parsed.assets) && parsed.assets.length > 0) {
        return { assets: parsed.assets, source: 'dist/stats.json' };
      }
    } catch (error) {
      log(colors.yellow, `Ignoring unreadable stats.json: ${error.message}`);
    }
  }

  if (!existsSync(DIST_DIR)) {
    throw new Error(`Build directory not found: ${DIST_DIR}. Run "npm run build" first.`);
  }

  return { assets: walkAssets(DIST_DIR), source: 'dist directory' };
}

function checkBundleSize() {
  log(colors.blue, '========================================');
  log(colors.blue, 'Bundle Size Checker');
  log(colors.blue, '========================================');

  let result;
  try {
    result = readAssets();
  } catch (error) {
    log(colors.red, `ERROR: ${error.message}`);
    process.exit(1);
  }

  const assets = result.assets
    .map((asset) => ({ name: String(asset.name), size: Number(asset.size) || 0 }))
    .sort((a, b) => b.size - a.size);
  const totalSize = assets.reduce((sum, asset) => sum + asset.size, 0);
  const oversizedAssets = assets.filter((asset) => asset.size / 1024 > ASSET_LIMIT_KB);

  log(colors.cyan, `Source: ${result.source}`);
  log(colors.cyan, 'Largest assets:');
  for (const asset of assets.slice(0, 12)) {
    log(colors.cyan, `  ${asset.name}: ${formatSize(asset.size)}`);
  }

  log(colors.blue);
  log(colors.cyan, `Unpacked total: ${formatSize(totalSize)}`);
  log(colors.cyan, `Warning threshold: ${TOTAL_WARNING_KB} KB`);
  log(colors.cyan, `Total limit: ${TOTAL_LIMIT_KB} KB`);
  log(colors.cyan, `Per-asset limit: ${ASSET_LIMIT_KB} KB`);

  const totalKB = totalSize / 1024;
  if (oversizedAssets.length > 0) {
    log(colors.red, `FAIL: ${oversizedAssets.length} asset(s) exceed the per-asset limit.`);
    process.exit(1);
  }
  if (totalKB > TOTAL_LIMIT_KB) {
    log(colors.red, 'FAIL: unpacked extension exceeds the total bundle limit.');
    process.exit(1);
  }
  if (totalKB > TOTAL_WARNING_KB) {
    log(colors.yellow, 'WARNING: unpacked extension is approaching the total bundle limit.');
  } else {
    log(colors.green, 'PASS: bundle is within its size budgets.');
  }

  // Machine-readable final line retained for CI consumers.
  console.log(Math.round(totalKB));
}

checkBundleSize();
