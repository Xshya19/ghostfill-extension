import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDirectory = join(process.cwd(), '.github', 'workflows');

const readWorkflow = (name: string): string => readFileSync(join(workflowsDirectory, name), 'utf8');

describe('GitHub workflow policy', () => {
  it('pins every referenced action to an immutable full commit SHA', () => {
    const workflowFiles = readdirSync(workflowsDirectory).filter((file) => file.endsWith('.yml'));
    const actionReferences = workflowFiles.flatMap((file) => {
      const workflow = readWorkflow(file);
      return [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map(
        (match) => `${file}: ${match[1]}`
      );
    });

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const actionReference of actionReferences) {
      expect(actionReference).toMatch(/@[a-f0-9]{40}$/i);
    }
  });

  it('keeps CI bounded and validates the workflow policy before product checks', () => {
    const workflow = readWorkflow('ci.yml');

    expect(workflow).toContain('concurrency:');
    expect(workflow).toContain('timeout-minutes:');
    expect(workflow).toContain('npm run workflow:check');
    expect(workflow).toContain('npm run type-check');
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run bundle:check');
  });

  it('provides dependency review, CodeQL, and an idempotent tag-release recovery path', () => {
    expect(existsSync(join(workflowsDirectory, 'security.yml'))).toBe(true);

    const securityWorkflow = readWorkflow('security.yml');
    expect(securityWorkflow).toContain('dependency-review-action');
    expect(securityWorkflow).toContain('codeql-action');
    expect(securityWorkflow).toContain('security-events: write');

    const releaseWorkflow = readWorkflow('release.yml');
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('tag:');
    expect(releaseWorkflow).toContain('permissions:\n  contents: read');
    expect(releaseWorkflow).toContain('contents: write');
    expect(releaseWorkflow).toContain('gh release view');
    expect(releaseWorkflow).toContain('ghostfill-extension-${RELEASE_TAG}.zip.sha256');
    expect(releaseWorkflow).toContain('GH_REPO: ${{ github.repository }}');
  });
});
