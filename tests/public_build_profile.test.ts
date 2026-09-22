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

const packageJson = JSON.parse(readProjectFile('package.json')) as {
  scripts: Record<string, string>;
};

const webpackConfig = readProjectFile('webpack.config.cjs');

describe('build profiles', () => {
  it('makes the full profile the default for normal builds and packages', () => {
    expect(packageJson.scripts.build).toContain('profile=full');
    expect(packageJson.scripts['build:dev']).toContain('profile=full');
    expect(packageJson.scripts['build:full']).toBe('npm run build');
    expect(packageJson.scripts['build:full:dev']).toBe('npm run build:dev');
    expect(packageJson.scripts['build:zip']).toContain('npm run build');
    expect(packageJson.scripts['build:public']).toContain('profile=public');
    expect(packageJson.scripts['build:public:dev']).toContain('profile=public');
    expect(packageJson.scripts['build:public:zip']).toContain('npm run build:public');
    expect(webpackConfig).toContain("env.profile === 'public' ? 'public' : 'full'");
  });

  it('keeps the restricted manifest available only through the explicit public profile', () => {
    expect(publicManifest.permissions).not.toContain('identity');
    expect(publicManifest.permissions).not.toContain('scripting');
    expect(publicManifest.oauth2).toBeUndefined();
    expect(publicManifest.host_permissions).not.toContain('https://www.googleapis.com/*');
    expect(publicManifest.host_permissions).not.toContain('https://graph.microsoft.com/*');
    expect(publicManifest.content_security_policy.extension_pages).not.toContain('googleapis.com');
  });

  it('includes Gmail OAuth and provider access in the full profile', () => {
    expect(fullOverrides.permissions).toContain('identity');
    expect(fullOverrides.permissions).toContain('scripting');
    expect(fullOverrides.oauth2).toBeDefined();
    expect(fullOverrides.host_permissions).toContain('https://www.googleapis.com/*');
  });

  it('gates real-mail UI and message routing behind the build profile', () => {
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
