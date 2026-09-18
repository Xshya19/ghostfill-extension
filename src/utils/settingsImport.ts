import { DEFAULT_SETTINGS, UserSettings } from '../types/storage.types';

export const MAX_SETTINGS_IMPORT_BYTES = 256 * 1024;

type JsonRecord = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSafePrimitive = (value: unknown, expected: unknown): boolean => {
  if (typeof value !== typeof expected || value === null) {
    return false;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return value.length <= 2048;
  }
  return typeof value === 'boolean';
};

/**
 * Rebuild a settings import from the known schema instead of trusting parsed
 * JSON. Unknown keys, arrays, non-finite numbers, and nested prototype keys are
 * discarded. Domain-specific ranges are validated by the settings form before
 * the result is persisted.
 */
export const normalizeImportedSettings = (input: unknown): UserSettings | null => {
  if (!isPlainRecord(input)) {
    return null;
  }

  const merged: UserSettings = {
    ...DEFAULT_SETTINGS,
    passwordDefaults: { ...DEFAULT_SETTINGS.passwordDefaults },
  };

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }

    const value = input[key];
    if (key === 'passwordDefaults') {
      if (!isPlainRecord(value)) {
        continue;
      }
      for (const nestedKey of Object.keys(DEFAULT_SETTINGS.passwordDefaults) as Array<
        keyof UserSettings['passwordDefaults']
      >) {
        if (!Object.prototype.hasOwnProperty.call(value, nestedKey)) {
          continue;
        }
        const nestedValue = value[nestedKey];
        const nestedDefault = DEFAULT_SETTINGS.passwordDefaults[nestedKey];
        if (isSafePrimitive(nestedValue, nestedDefault)) {
          // Every nested field is reconstructed from an explicitly known key.
          (merged.passwordDefaults as unknown as Record<string, unknown>)[nestedKey] = nestedValue;
        }
      }
      continue;
    }

    if (key === 'darkMode') {
      if (typeof value === 'boolean' || value === 'system') {
        merged.darkMode = value;
      }
      continue;
    }

    const defaultValue = DEFAULT_SETTINGS[key];
    if (isSafePrimitive(value, defaultValue)) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
};
