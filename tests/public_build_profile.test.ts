import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const publicManifest = JSON.parse(readProjectFile('manifest.json')) as {
  permissions: string[];
  host_permissions: string[];
  oauth2?: unknown;
  content_security_policy: { extension_pages: string };
};

const fullOverrides = JSON.parse(readProjectFile('manifest.full-overrides.json')) as {
  permissions: string[];
  host_permissions: string[];
  oauth2?: unknown;
};

describe('public build profile', () => {
  it('keeps the default package temporary-email-only', () => {
    expect(publicManifest.permissions).not.toContain('identity');
    expect(publicManifest.permissions).not.toContain('scripting');
    expect(publicManifest.oauth2).toBeUndefined();
    expect(publicManifest.host_permissions).not.toContain('https://www.googleapis.com/*');
    expect(publicManifest.host_permissions).not.toContain('https://graph.microsoft.com/*');
    expect(publicManifest.content_security_policy.extension_pages).not.toContain('googleapis.com');
  });

  it('keeps the legacy real-mail manifest isolated to the full profile', () => {
    expect(fullOverrides.permissions).toContain('identity');
    expect(fullOverrides.permissions).toContain('scripting');
    expect(fullOverrides.oauth2).toBeDefined();
    expect(fullOverrides.host_permissions).toContain('https://www.googleapis.com/*');
  });

  it('gates public UI and message routing behind the build profile', () => {
    expect(readProjectFile('src/frontend/popup/components/Hub.tsx')).toContain(
      'IS_GMAIL_ENABLED && <div className="hub-email-selector"'
    );
    expect(readProjectFile('src/frontend/options/components/OptionsTabs.tsx')).toMatch(
      /IS_GMAIL_ENABLED\s*&&\s*\(?\s*<SettingsSection\s+id="gmail-oauth"/
    );
    expect(readProjectFile('src/background/messageHandler.ts')).toContain(
      'Real-mail integrations are unavailable in the public build.'
    );
  });

  it('enables automatic verification-link opening by default', () => {
    expect(readProjectFile('src/types/storage.types.ts')).toContain('autoConfirmLinks: true');
    expect(readProjectFile('src/utils/validation.ts')).toContain(
      'autoConfirmLinks: safeBoolean.default(true)'
    );
  });
});
