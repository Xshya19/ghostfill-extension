#!/usr/bin/env node

/**
 * Build ZIP Script
 * 
 * Creates a distributable ZIP file of the extension
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_DIR = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

// Get version from package.json
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));
const version = packageJson.version;
const zipFileName = `ghostfill-extension-v${version}.zip`;
const zipFilePath = path.join(OUTPUT_DIR, zipFileName);

// Check if dist folder exists
if (!fs.existsSync(DIST_DIR)) {
  console.error('❌ dist folder not found. Run "npm run build" first.');
  process.exit(1);
}

// Create output stream
const output = fs.createWriteStream(zipFilePath);
const archive = archiver('zip', {
  zlib: { level: 9 }, // Maximum compression
});

// Handle events
output.on('close', () => {
  const sizeKB = (archive.pointer() / 1024).toFixed(2);
  console.log(`✅ Created ${zipFileName} (${sizeKB} KB)`);
});

archive.on('error', (err) => {
  console.error('❌ Error creating ZIP:', err);
  process.exit(1);
});

archive.on('warning', (warn) => {
  console.warn('⚠️ Warning:', warn);
});

// Pipe archive to file
archive.pipe(output);

// Add all files from dist folder
archive.directory(DIST_DIR, false);

// Finalize archive
archive.finalize();

console.log(`📦 Creating ${zipFileName}...`);
