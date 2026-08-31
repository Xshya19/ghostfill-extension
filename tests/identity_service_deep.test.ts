/**
 * identity_service_deep.test.ts
 * Deep test suite for src/services/identityService.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/storageService', () => {
  const store = new Map<string, any>();
  return {
    storageService: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getFresh: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: any) => { store.set(key, value); }),
      remove: vi.fn(async (key: string) => { store.delete(key); }),
      _store: store,
    },
  };
});

vi.mock('../src/services/passwordService', () => ({
  passwordService: {
    generate: vi.fn(() => ({
      password: 'MockP@ssw0rd123!',
      strength: { score: 80, level: 'strong', entropy: 70, crackTime: '1000 years', suggestions: [] },
      options: {},
      generatedAt: Date.now(),
    })),
  },
}));

import { identityService } from '../src/services/identityService';
import { storageService } from '../src/services/storageService';
import { STORAGE_KEYS } from '../src/types';

describe('IdentityService deep tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (storageService as any)._store.clear();
    // Reset internal state
    (identityService as any).currentIdentity = null;
  });

  // ═══════════════════════════════════════════════════════════════
  // generateIdentity()
  // ═══════════════════════════════════════════════════════════════

  describe('generateIdentity()', () => {
    it('returns a complete identity object', () => {
      const identity = identityService.generateIdentity();
      expect(identity.firstName).toBeDefined();
      expect(identity.lastName).toBeDefined();
      expect(identity.fullName).toBeDefined();
      expect(identity.username).toBeDefined();
      expect(identity.emailPrefix).toBeDefined();
    });

    it('fullName is firstName + lastName', () => {
      const identity = identityService.generateIdentity();
      expect(identity.fullName).toBe(`${identity.firstName} ${identity.lastName}`);
    });

    it('username contains first and last name (lowercase)', () => {
      const identity = identityService.generateIdentity();
      expect(identity.username).toBe(identity.username.toLowerCase());
      expect(identity.username).toContain(identity.firstName.toLowerCase());
      expect(identity.username).toContain(identity.lastName.toLowerCase());
    });

    it('emailPrefix contains first and last name', () => {
      const identity = identityService.generateIdentity();
      expect(identity.emailPrefix).toContain(identity.firstName.toLowerCase());
      expect(identity.emailPrefix).toContain(identity.lastName.toLowerCase());
    });

    it('generates unique identities', () => {
      const usernames = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const identity = identityService.generateIdentity();
        usernames.add(identity.username);
      }
      // At least 45/50 should be unique (random suffix makes collisions extremely rare)
      expect(usernames.size).toBeGreaterThan(45);
    });

    it('sets currentIdentity internally', () => {
      const identity = identityService.generateIdentity();
      expect((identityService as any).currentIdentity).toBe(identity);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCurrentIdentity()
  // ═══════════════════════════════════════════════════════════════

  describe('getCurrentIdentity()', () => {
    it('returns cached identity if available', async () => {
      const generated = identityService.generateIdentity();
      const current = await identityService.getCurrentIdentity();
      expect(current).toBe(generated);
    });

    it('loads from storage when cache is empty', async () => {
      const stored = {
        firstName: 'Stored',
        lastName: 'User',
        fullName: 'Stored User',
        username: 'storeduser42',
        emailPrefix: 'stored.user.42',
      };
      (storageService as any)._store.set(STORAGE_KEYS.CURRENT_IDENTITY, stored);

      const current = await identityService.getCurrentIdentity();
      expect(current.firstName).toBe('Stored');
    });

    it('generates new identity when storage is empty', async () => {
      const current = await identityService.getCurrentIdentity();
      expect(current).toBeDefined();
      expect(current.firstName).toBeDefined();
      expect(storageService.set).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // resolveEmailForActiveTab()
  // ═══════════════════════════════════════════════════════════════

  describe('resolveEmailForActiveTab()', () => {
    it('returns disposable email when preferredEmailType is disposable', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');
      (storageService as any)._store.set('disposableEmail', {
        fullEmail: 'temp@mailinator.com',
        domain: 'mailinator.com',
        service: 'catchmail',
      });

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('temp@mailinator.com');
      expect(result.preferredEmailType).toBe('disposable');
      expect(result.source).toBe('disposable');
    });

    it('returns gmail when preferredEmailType is gmail', async () => {
      (storageService as any)._store.set('preferredEmailType', 'gmail');
      (storageService as any)._store.set('currentEmail', {
        fullEmail: 'user@gmail.com',
        domain: 'gmail.com',
        service: 'gmail',
      });

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('user@gmail.com');
      expect(result.preferredEmailType).toBe('gmail');
      expect(result.source).toBe('gmail-alias');
    });

    it('never leaks gmail into disposable tab', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');
      (storageService as any)._store.set('disposableEmail', {
        fullEmail: 'user@gmail.com',
        domain: 'gmail.com',
        service: 'gmail',
      });

      const result = await identityService.resolveEmailForActiveTab();
      // Gmail account should be rejected in disposable mode
      expect(result.email).not.toBe('user@gmail.com');
    });

    it('returns empty when no email configured (disposable)', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('');
      expect(result.source).toBe('none');
    });

    it('returns empty when no email configured (gmail)', async () => {
      (storageService as any)._store.set('preferredEmailType', 'gmail');

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('');
      expect(result.source).toBe('none');
    });

    it('falls back to gmailBase when currentEmail is not gmail', async () => {
      (storageService as any)._store.set('preferredEmailType', 'gmail');
      (storageService as any)._store.set('gmailBase', 'fallback@gmail.com');

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('fallback@gmail.com');
      expect(result.source).toBe('gmail-base');
    });

    it('falls back to gmailProfile email', async () => {
      (storageService as any)._store.set('preferredEmailType', 'gmail');
      (storageService as any)._store.set('gmailProfile', { email: 'profile@gmail.com' });

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('profile@gmail.com');
      expect(result.source).toBe('gmail-base');
    });

    it('falls back to currentEmail in disposable mode', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');
      (storageService as any)._store.set('currentEmail', {
        fullEmail: 'fallback@example.com',
        domain: 'example.com',
      });

      const result = await identityService.resolveEmailForActiveTab();
      expect(result.email).toBe('fallback@example.com');
      expect(result.source).toBe('current');
    });

    it('handles googlemail.com as gmail', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');
      (storageService as any)._store.set('disposableEmail', {
        fullEmail: 'user@googlemail.com',
        domain: 'googlemail.com',
      });

      const result = await identityService.resolveEmailForActiveTab();
      // googlemail.com should be treated as gmail and rejected in disposable mode
      expect(result.email).not.toBe('user@googlemail.com');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getCompleteIdentity()
  // ═══════════════════════════════════════════════════════════════

  describe('getCompleteIdentity()', () => {
    it('returns identity with email and password', async () => {
      (storageService as any)._store.set('preferredEmailType', 'disposable');
      (storageService as any)._store.set('disposableEmail', {
        fullEmail: 'test@example.com',
        domain: 'example.com',
        service: 'catchmail',
      });

      const complete = await identityService.getCompleteIdentity();
      expect(complete.firstName).toBeDefined();
      expect(complete.email).toBe('test@example.com');
      expect(complete.password).toBeDefined();
      expect(complete.preferredEmailType).toBe('disposable');
    });

    it('caches password in identity', async () => {
      const complete = await identityService.getCompleteIdentity();
      const cachedPw = complete.password;

      // On second call, should return same cached password
      const complete2 = await identityService.getCompleteIdentity();
      expect(complete2.password).toBe(cachedPw);
    });

    it('uses fallback password on generation failure', async () => {
      const { passwordService } = await import('../src/services/passwordService');
      (passwordService.generate as any).mockImplementationOnce(() => {
        throw new Error('Generation failed');
      });

      // Reset cache to force re-generation
      (identityService as any).currentIdentity = null;
      (storageService as any)._store.delete(STORAGE_KEYS.CURRENT_IDENTITY);

      const complete = await identityService.getCompleteIdentity();
      // Fallback password should contain hex + suffix
      expect(complete.password).toBeDefined();
      expect(complete.password.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // saveIdentity() / clearIdentity() / refreshIdentity()
  // ═══════════════════════════════════════════════════════════════

  describe('saveIdentity()', () => {
    it('saves to storage and updates cache', async () => {
      const identity = identityService.generateIdentity();
      await identityService.saveIdentity(identity);
      expect(storageService.set).toHaveBeenCalledWith(STORAGE_KEYS.CURRENT_IDENTITY, identity);
      expect((identityService as any).currentIdentity).toBe(identity);
    });
  });

  describe('clearIdentity()', () => {
    it('clears cache and storage', async () => {
      identityService.generateIdentity();
      await identityService.clearIdentity();
      expect((identityService as any).currentIdentity).toBeNull();
      expect(storageService.remove).toHaveBeenCalledWith(STORAGE_KEYS.CURRENT_IDENTITY);
    });
  });

  describe('refreshIdentity()', () => {
    it('generates new identity and saves it', async () => {
      const old = identityService.generateIdentity();
      const refreshed = await identityService.refreshIdentity();
      expect(refreshed).not.toBe(old);
      expect(storageService.set).toHaveBeenCalled();
    });
  });
});
