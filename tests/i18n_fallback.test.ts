import { describe, expect, it } from 'vitest';

import { t } from '../src/frontend/i18n';

describe('frontend i18n fallback', () => {
  it('uses bundled English copy when the Chrome i18n API is unavailable', () => {
    expect(t('settingsTitle')).toBe('Settings');
    expect(t('darkModeDescription')).toBe('Choose light, dark, or follow your system');
  });

  it('turns an unknown camel-case key into readable preview copy', () => {
    expect(t('futurePreviewLabel')).toBe('Future preview');
  });
});
