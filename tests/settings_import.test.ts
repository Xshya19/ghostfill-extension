import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/types/storage.types';
import { normalizeImportedSettings } from '../src/utils/settingsImport';

describe('settings import normalization', () => {
  it('rejects non-object roots', () => {
    expect(normalizeImportedSettings(null)).toBeNull();
    expect(normalizeImportedSettings([])).toBeNull();
    expect(normalizeImportedSettings('settings')).toBeNull();
  });

  it('accepts system theme and known primitive fields', () => {
    const result = normalizeImportedSettings({ darkMode: 'system', notifications: false });
    expect(result?.darkMode).toBe('system');
    expect(result?.notifications).toBe(false);
  });

  it('reconstructs nested password settings from known keys only', () => {
    const result = normalizeImportedSettings({
      passwordDefaults: {
        length: 32,
        uppercase: false,
        unknown: 'discard me',
        symbols: ['wrong type'],
      },
    });

    expect(result?.passwordDefaults.length).toBe(32);
    expect(result?.passwordDefaults.uppercase).toBe(false);
    expect(result?.passwordDefaults.symbols).toBe(DEFAULT_SETTINGS.passwordDefaults.symbols);
    expect(result?.passwordDefaults).not.toHaveProperty('unknown');
  });

  it('drops unknown keys, arrays, and non-finite numbers', () => {
    const result = normalizeImportedSettings({
      unknown: true,
      checkIntervalSeconds: Number.POSITIVE_INFINITY,
      preferredEmailService: ['mailtm'],
    });

    expect(result?.checkIntervalSeconds).toBe(DEFAULT_SETTINGS.checkIntervalSeconds);
    expect(result?.preferredEmailService).toBe(DEFAULT_SETTINGS.preferredEmailService);
    expect(result).not.toHaveProperty('unknown');
  });

  it('cannot import prototype-pollution keys', () => {
    const payload = JSON.parse(
      '{"__proto__":{"polluted":true},"passwordDefaults":{"__proto__":{"polluted":true}}}'
    ) as unknown;

    const result = normalizeImportedSettings(payload);

    expect(result).not.toHaveProperty('__proto__.polluted');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
