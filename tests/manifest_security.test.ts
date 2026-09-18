import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
  content_security_policy?: { extension_pages?: string };
  web_accessible_resources?: unknown;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')
) as ExtensionManifest;
const extensionPolicy = manifest.content_security_policy?.extension_pages ?? '';

describe('extension security boundary', () => {
  it('keeps extension-page images and fonts local', () => {
    expect(extensionPolicy).toContain("font-src 'self'");
    expect(extensionPolicy).toContain("img-src 'self' data: blob:");
    expect(extensionPolicy).not.toContain('fonts.gstatic.com');
    expect(extensionPolicy).not.toContain('googleusercontent.com');
  });

  it('allows only same-origin reader frames and publishes no page-readable assets', () => {
    expect(extensionPolicy).toContain("frame-src 'self'");
    expect(manifest.web_accessible_resources).toBeUndefined();
  });
});
