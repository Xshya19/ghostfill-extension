#!/usr/bin/env node

/**
 * Creates a distributable extension ZIP after validating the built package.
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');

const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
const zipFileName = `ghostfill-extension-v${packageJson.version}.zip`;
const zipFilePath = path.join(ROOT_DIR, zipFileName);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(DIST_DIR, fullPath)));
    }
  }

  return files;
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function validateDist() {
  const errors = [];

  if (!fs.existsSync(DIST_DIR)) {
    return ['dist folder not found. Run "npm run build" first.'];
  }

  const distFiles = new Set(walkFiles(DIST_DIR));
  const requiredFiles = new Set([
    'manifest.json',
    'background.js',
    'content.js',
    'content.css',
    'popup.html',
    'popup.js',
    'popup.css',
    'options.html',
    'options.js',
    'options.css',
    'offscreen.html',
    'offscreen.js',
  ]);

  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return [`manifest.json is missing or invalid: ${error.message}`];
  }

  if (manifest.background?.service_worker) {
    requiredFiles.add(manifest.background.service_worker);
  }

  if (manifest.action?.default_popup) {
    requiredFiles.add(manifest.action.default_popup);
  }

  for (const icon of Object.values(manifest.icons || {})) {
    requiredFiles.add(icon);
  }

  for (const icon of Object.values(manifest.action?.default_icon || {})) {
    requiredFiles.add(icon);
  }

  if (manifest.options_ui?.page) {
    requiredFiles.add(manifest.options_ui.page);
  }

  if (manifest.default_locale) {
    requiredFiles.add(`_locales/${manifest.default_locale}/messages.json`);
  }

  for (const script of manifest.content_scripts || []) {
    for (const jsFile of script.js || []) {
      requiredFiles.add(jsFile);
    }
    for (const cssFile of script.css || []) {
      requiredFiles.add(cssFile);
    }
  }

  for (const file of requiredFiles) {
    const filePath = path.join(DIST_DIR, file);
    if (!distFiles.has(file)) {
      errors.push(`Missing required file: ${file}`);
      continue;
    }
    if (fs.statSync(filePath).size === 0) {
      errors.push(`Required file is empty: ${file}`);
    }
  }

  for (const group of manifest.web_accessible_resources || []) {
    for (const resource of group.resources || []) {
      if (resource.includes('*')) {
        const matcher = wildcardToRegExp(resource);
        if (![...distFiles].some((file) => matcher.test(file))) {
          errors.push(`No files match web_accessible_resource: ${resource}`);
        }
      } else if (!distFiles.has(resource)) {
        errors.push(`Missing web_accessible_resource: ${resource}`);
      }
    }
  }

  return errors;
}

const validationErrors = validateDist();
if (validationErrors.length > 0) {
  console.error('Cannot create extension ZIP:');
  for (const error of validationErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

const output = fs.createWriteStream(zipFilePath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeKB = (archive.pointer() / 1024).toFixed(2);
  console.log(`Created ${zipFileName} (${sizeKB} KB)`);
});

archive.on('error', (error) => {
  console.error('Error creating ZIP:', error);
  process.exit(1);
});

archive.on('warning', (warning) => {
  console.warn('ZIP warning:', warning);
});

archive.pipe(output);
archive.directory(DIST_DIR, false);
archive.finalize();

console.log(`Creating ${zipFileName}...`);
