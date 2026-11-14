import { readFileSync } from 'node:fs';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailTab } from '../src/frontend/options/components/OptionsTabs';
import { DEFAULT_SETTINGS } from '../src/types/storage.types';
import {
  assertCustomEndpointPermission,
  getCustomEndpointPermission,
  requestCustomEndpointPermission,
} from '../src/utils/customEndpoint';

afterEach(() => vi.unstubAllGlobals());

describe('private custom endpoint access', () => {
  it('permits optional HTTPS endpoints in both build policies without granting every host', () => {
    const base = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const full = { ...base, ...JSON.parse(readFileSync('manifest.full-overrides.json', 'utf8')) };
    for (const manifest of [base, full]) {
      expect(manifest.optional_host_permissions).toContain('https://*/*');
      expect(manifest.host_permissions).not.toContain('https://*/*');
      expect(
        manifest.content_security_policy.extension_pages
          .split(';')
          .find((directive: string) => directive.trim().startsWith('connect-src '))
          ?.trim()
          .split(/\s+/)
      ).toContain('https:');
    }
  });

  it('requests only the configured host directly from the user action', async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('chrome', { permissions: { request } });
    const result = requestCustomEndpointPermission('https://mail.private.example/api?mode=inbox');
    expect(request).toHaveBeenCalledWith({ origins: ['https://mail.private.example/*'] });
    await expect(result).resolves.toBe(true);
  });

  it.each([
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/#secret',
    'bad-url',
  ])('rejects an unsafe endpoint %s before requesting access', (endpoint) => {
    expect(() => getCustomEndpointPermission(endpoint)).toThrow();
  });

  it('blocks provider access until the user grants the configured host', async () => {
    const contains = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('chrome', { permissions: { contains } });
    await expect(assertCustomEndpointPermission('https://worker.example/api')).rejects.toThrow(
      /Allow endpoint access/
    );
    expect(contains).toHaveBeenCalledWith({ origins: ['https://worker.example/*'] });
    contains.mockResolvedValue(true);
    await expect(
      assertCustomEndpointPermission('https://worker.example/api')
    ).resolves.toBeUndefined();
  });

  it('asks for access only after the settings button is clicked and explains denial', async () => {
    const request = vi.fn().mockResolvedValue(false);
    const previousChrome = globalThis.chrome;
    vi.stubGlobal('chrome', { ...previousChrome, permissions: { request } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(
          React.createElement(EmailTab, {
            settings: {
              ...DEFAULT_SETTINGS,
              preferredEmailService: 'custom',
              customDomainUrl: 'https://worker.example/api',
            },
            sessionSecrets: { customDomainKey: '' },
            onSettingChange() {},
            onSessionSecretChange() {},
            fieldHasError: () => false,
            getFieldError: () => undefined,
            onFieldBlur() {},
          })
        )
      );
      expect(request).not.toHaveBeenCalled();
      const button = Array.from(container.querySelectorAll('button')).find(
        (element) => element.textContent === 'Allow endpoint access'
      )!;
      button.click();
      expect(request).toHaveBeenCalledWith({ origins: ['https://worker.example/*'] });
      await vi.waitFor(() => expect(container.textContent).toContain('Access was not granted.'));
      request.mockResolvedValue(true);
      button.click();
      await vi.waitFor(() => expect(container.textContent).toContain('Endpoint access allowed.'));
    } finally {
      flushSync(() => root.unmount());
      container.remove();
    }
  });
});
