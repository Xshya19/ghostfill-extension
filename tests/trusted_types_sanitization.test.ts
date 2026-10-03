import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('does not create a passthrough ghostfill policy on pages that disallow it', async () => {
  const createPolicy = vi.fn((name: string) => {
    if (name === 'ghostfill') {
      throw new TypeError('Policy ghostfill disallowed');
    }
    return { createHTML: (value: string) => value, createScriptURL: (value: string) => value };
  });
  vi.stubGlobal('trustedTypes', { createPolicy });
  vi.resetModules();
  const { sanitizeHtml } = await import('../src/utils/sanitization.core');
  const safe = sanitizeHtml('<p>Safe</p><script>alert(1)</script>');
  expect(createPolicy.mock.calls.some(([name]) => name === 'ghostfill')).toBe(false);
  expect(safe).toContain('Safe');
  expect(safe).not.toContain('<script');
});
