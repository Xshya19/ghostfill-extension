import { FieldClass } from '../../intelligence/types';
import { FieldType } from '../../types';

/**
 * Maps a classifier `FieldClass` to the canonical `FieldType`.
 * This is exhaustive: adding a new `FieldClass` without handling it here
 * will trigger a compile-time warning/error due to the `never` type guard.
 */
export function mapFieldClassToFieldType(cls: FieldClass): FieldType {
  switch (cls) {
    case 'Email':
      return 'email';
    case 'Username':
      return 'username';
    case 'Password':
      return 'password';
    case 'Target_Password_Confirm':
      return 'confirm-password';
    case 'First_Name':
      return 'first-name';
    case 'Last_Name':
      return 'last-name';
    case 'Full_Name':
      return 'full-name';
    case 'Phone':
      return 'phone';
    case 'OTP':
      return 'otp';
    case 'Unknown':
      return 'unknown';
    default: {
      const _exhaustive: never = cls;
      void _exhaustive;
      return 'unknown';
    }
  }
}

/**
 * Manages domain-specific trusted field selectors (Self-Healing).
 */
export class HistoryManager {
  private static readonly PREFIX = 'gf_trusted_';

  static async getTrustedSelector(domain: string, type: FieldType): Promise<string | null> {
    try {
      const key = `${this.PREFIX}${domain}_${type}`;
      const data = await chrome.storage.local.get(key);
      return data[key] || null;
    } catch {
      return null;
    }
  }

  static async saveTrustedSelector(
    domain: string,
    type: FieldType,
    selector: string
  ): Promise<void> {
    if (!domain || !type || !selector) {
      return;
    }
    try {
      const key = `${this.PREFIX}${domain}_${type}`;
      await chrome.storage.local.set({ [key]: selector });
    } catch {
      /* ignore storage errors */
    }
  }
}


