/*
 * Lightweight local guard for GitHub workflow files.
 *
 * It deliberately uses Prettier, which is already a direct development
 * dependency, to parse YAML rather than relying on an undeclared transitive
 * parser. The policy checks catch accidental privilege expansion and mutable
 * action references before a pull request reaches GitHub.
 */
const fs = require('node:fs');
const path = require('node:path');
const prettier = require('prettier');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const DEPENDABOT_FILE = path.join(ROOT, '.github', 'dependabot.yml');
const SHA_PIN = /@[a-f0-9]{40}(?:\s*(?:#.*)?)?$/i;

async function parseYaml(filePath, source) {
  try {
    await prettier.format(source, { filepath: filePath, parser: 'yaml' });
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)} is not valid YAML: ${error.message}`);
  }
}

async function main() {
  const failures = [];
  const workflowFiles = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();

  if (workflowFiles.length === 0) {
    failures.push('No GitHub Actions workflow files were found.');
  }

  for (const workflowFile of workflowFiles) {
    const filePath = path.join(WORKFLOWS_DIR, workflowFile);
    const source = fs.readFileSync(filePath, 'utf8');

    try {
      await parseYaml(filePath, source);
    } catch (error) {
      failures.push(error.message);
      continue;
    }

    if (!/^permissions:/m.test(source)) {
      failures.push(`${path.relative(ROOT, filePath)} must explicitly declare permissions.`);
    }
    if (/^\s*pull_request_target\s*:/m.test(source)) {
      failures.push(`${path.relative(ROOT, filePath)} must not use pull_request_target.`);
    }

    const actionReferences = [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)];
    for (const match of actionReferences) {
      const reference = match[1];
      if (!SHA_PIN.test(reference)) {
        failures.push(
          `${path.relative(ROOT, filePath)} contains a mutable action reference: ${reference}`
        );
      }
    }
  }

  if (!fs.existsSync(DEPENDABOT_FILE)) {
    failures.push('.github/dependabot.yml is missing.');
  } else {
    try {
      await parseYaml(DEPENDABOT_FILE, fs.readFileSync(DEPENDABOT_FILE, 'utf8'));
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (failures.length > 0) {
    console.error('GitHub workflow policy check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`GitHub workflow policy check passed for ${workflowFiles.length} workflow(s).`);
}

void main();
