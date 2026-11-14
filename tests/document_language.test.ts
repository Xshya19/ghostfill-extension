import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The entry points boot the whole UI; stub the heavy parts so importing them
// only exercises the document bootstrap.
vi.mock('../src/shared/theme', () => ({ initTheme: vi.fn() }));
vi.mock('../src/utils/logger', () => ({ initRemoteLogger: vi.fn() }));
vi.mock('../src/frontend/popup/App', () => ({ default: () => null }));
vi.mock('../src/frontend/options/OptionsApp', () => ({ default: () => null }));

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const setUiLanguage = (language: string | undefined) => {
  const api = chrome as unknown as { i18n?: { getUILanguage?: () => string } };
  if (language === undefined) {
    delete api.i18n;
    return;
  }
  api.i18n = { getUILanguage: () => language };
};

afterEach(() => {
  setUiLanguage(undefined);
  vi.resetModules();
  document.documentElement.lang = 'en';
});

describe('extension document language', () => {
  it('applies the browser UI locale to the popup document', async () => {
    setUiLanguage('es-ES');
    vi.resetModules();

    await import('../src/frontend/popup/index');

    expect(document.documentElement.lang).toBe('es-ES');
  });

  it('applies the browser UI locale to the options document', async () => {
    setUiLanguage('es-ES');
    vi.resetModules();

    await import('../src/frontend/options/index');

    expect(document.documentElement.lang).toBe('es-ES');
  });

  it('falls back to the browser language when the extension runtime is missing', async () => {
    setUiLanguage(undefined);
    vi.resetModules();

    await import('../src/frontend/popup/index');

    expect(document.documentElement.lang).toBe(navigator.language);
    expect(document.documentElement.lang).not.toBe('');
  });

  it('keeps the language in the bundled entry code, not in an inline script', () => {
    const popupHtml = readSource('src/frontend/popup/index.html');
    const optionsHtml = readSource('src/frontend/options/index.html');
    const manifest = JSON.parse(readSource('manifest.json')) as {
      content_security_policy?: { extension_pages?: string };
    };

    // The manifest CSP only allows bundled scripts.
    expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
    expect(popupHtml).not.toMatch(/<script/i);
    expect(optionsHtml).not.toMatch(/<script/i);

    // The locale is applied from the entry bundle of both pages.
    expect(readSource('src/frontend/popup/index.tsx')).toContain(
      'document.documentElement.lang = resolveDocumentLanguage()'
    );
    expect(readSource('src/frontend/options/index.tsx')).toContain(
      'document.documentElement.lang = resolveDocumentLanguage()'
    );
  });
});
