/**
 * otp_service_deep.test.ts
 * Deep test suite for src/services/otpService.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/storageService', () => {
  const store = new Map<string, any>();
  return {
    storageService: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: any) => { store.set(key, value); }),
      remove: vi.fn(async (key: string) => { store.delete(key); }),
      _store: store,
    },
  };
});

vi.mock('../src/services/intelligentExtractor', () => ({
  extractAll: vi.fn(() => ({
    intent: 'verification',
    otp: null,
    link: null,
    debugInfo: { provider: undefined, providerConfidence: 0, intentScores: {}, urlsFound: 0, securityRisk: 'low' },
  })),
}));

vi.mock('../src/services/emailDecisionEngine', () => ({
  assessEmailDecision: vi.fn(() => ({
    purpose: 'verification',
    action: 'fill-otp',
    risk: 'low',
    confidence: 0.9,
    canAutoAct: true,
    reasons: ['intent:verification'],
    warnings: [],
  })),
}));

import { otpService } from '../src/services/otpService';
import { storageService } from '../src/services/storageService';

describe('OTPService deep tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageService as any)._store.clear();
    // Reset internal rate limit state
    (otpService as any).rateLimitTimestamps = [];
    (otpService as any).rateLimitMutex = Promise.resolve();
  });

  // ═══════════════════════════════════════════════════════════════
  // saveLastOTP
  // ═══════════════════════════════════════════════════════════════

  describe('saveLastOTP()', () => {
    it('saves OTP to storage', async () => {
      const result = await otpService.saveLastOTP('123456', 'email');
      expect(result.saved).toBe(true);
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        code: '123456',
        source: 'email',
      }));
    });

    it('includes emailFrom when provided', async () => {
      await otpService.saveLastOTP('123456', 'email', 'noreply@example.com');
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        emailFrom: 'noreply@example.com',
      }));
    });

    it('includes emailSubject when provided', async () => {
      await otpService.saveLastOTP('123456', 'email', undefined, 'Your verification code');
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        emailSubject: 'Your verification code',
      }));
    });

    it('includes custom confidence', async () => {
      await otpService.saveLastOTP('123456', 'email', undefined, undefined, 0.95);
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        confidence: 0.95,
      }));
    });

    it('includes metadata emailId and emailDate', async () => {
      await otpService.saveLastOTP('123456', 'email', undefined, undefined, 0.8, {
        emailId: 'msg-42',
        emailDate: 1700000000000,
      });
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        emailId: 'msg-42',
        emailDate: 1700000000000,
      }));
    });

    it('sets extractedAt timestamp', async () => {
      const before = Date.now();
      await otpService.saveLastOTP('123456', 'email');
      const args = (storageService.set as any).mock.calls[0][1];
      expect(args.extractedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Rate Limiting
  // ═══════════════════════════════════════════════════════════════

  describe('rate limiting', () => {
    it('allows up to MAX_SAVES_PER_MINUTE', async () => {
      for (let i = 0; i < 10; i++) {
        const result = await otpService.saveLastOTP(`code-${i}`, 'email');
        expect(result.saved).toBe(true);
      }
    });

    it('blocks when rate limit exceeded', async () => {
      // Fill up the rate limit
      for (let i = 0; i < 10; i++) {
        await otpService.saveLastOTP(`code-${i}`, 'email');
      }

      // 11th should be blocked
      const result = await otpService.saveLastOTP('code-11', 'email');
      expect(result.saved).toBe(false);
      expect(result.reason).toContain('rate limited');
      expect(result.retryAfterMs).toBeDefined();
    });

    it('resets after window expires', async () => {
      // Fill up the rate limit
      for (let i = 0; i < 10; i++) {
        await otpService.saveLastOTP(`code-${i}`, 'email');
      }

      // Manually expire the timestamps
      (otpService as any).rateLimitTimestamps = [];

      const result = await otpService.saveLastOTP('after-reset', 'email');
      expect(result.saved).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Mutex Serialization
  // ═══════════════════════════════════════════════════════════════

  describe('mutex serialization', () => {
    it('serializes concurrent saves', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        otpService.saveLastOTP(`code-${i}`, 'email')
      );
      const results = await Promise.all(promises);
      const savedCount = results.filter(r => r.saved).length;
      expect(savedCount).toBe(5);
    });

    it('mutex releases on error', async () => {
      // Force an error by breaking storageService
      (storageService.set as any).mockRejectedValueOnce(new Error('Storage failed'));

      try {
        await otpService.saveLastOTP('fail', 'email');
      } catch {
        // Expected
      }

      // Next call should still work (mutex released)
      (storageService.set as any).mockResolvedValue(undefined);
      const result = await otpService.saveLastOTP('after-error', 'email');
      expect(result.saved).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getLastOTP
  // ═══════════════════════════════════════════════════════════════

  describe('getLastOTP()', () => {
    it('returns null when no OTP saved', async () => {
      const result = await otpService.getLastOTP();
      expect(result).toBeNull();
    });

    it('returns saved OTP', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        source: 'email',
        extractedAt: Date.now(),
        confidence: 0.9,
      });

      const result = await otpService.getLastOTP();
      expect(result).not.toBeNull();
      expect(result!.code).toBe('123456');
    });

    it('returns null for expired OTP (> 10 minutes)', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        source: 'email',
        extractedAt: Date.now() - 11 * 60 * 1000,
        confidence: 0.9,
      });

      const result = await otpService.getLastOTP();
      expect(result).toBeNull();
    });

    it('returns null for already-used OTP', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        source: 'email',
        extractedAt: Date.now(),
        confidence: 0.9,
        usedAt: Date.now(),
      });

      const result = await otpService.getLastOTP();
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // clearLastOTP
  // ═══════════════════════════════════════════════════════════════

  describe('clearLastOTP()', () => {
    it('removes OTP from storage', async () => {
      (storageService as any)._store.set('lastOTP', { code: '123456' });
      await otpService.clearLastOTP();
      expect(storageService.remove).toHaveBeenCalledWith('lastOTP');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // isOTPFresh
  // ═══════════════════════════════════════════════════════════════

  describe('isOTPFresh()', () => {
    it('returns false when no OTP', async () => {
      expect(await otpService.isOTPFresh()).toBe(false);
    });

    it('returns true for fresh OTP (< 60s)', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        extractedAt: Date.now() - 30_000,
      });
      expect(await otpService.isOTPFresh()).toBe(true);
    });

    it('returns false for stale OTP (> 60s)', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        extractedAt: Date.now() - 70_000,
      });
      expect(await otpService.isOTPFresh()).toBe(false);
    });

    it('returns false for used OTP', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        extractedAt: Date.now(),
        usedAt: Date.now(),
      });
      expect(await otpService.isOTPFresh()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // markAsUsed
  // ═══════════════════════════════════════════════════════════════

  describe('markAsUsed()', () => {
    it('sets usedAt timestamp', async () => {
      const otp = {
        code: '123456',
        source: 'email',
        extractedAt: Date.now(),
        confidence: 0.9,
      };
      (storageService as any)._store.set('lastOTP', otp);

      await otpService.markAsUsed();
      expect(storageService.set).toHaveBeenCalledWith('lastOTP', expect.objectContaining({
        usedAt: expect.any(Number),
      }));
    });

    it('does nothing when no OTP exists', async () => {
      await otpService.markAsUsed();
      // Should not throw
      expect(storageService.set).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // validateOTP
  // ═══════════════════════════════════════════════════════════════

  describe('validateOTP()', () => {
    it('validates 4-digit OTP', () => {
      expect(otpService.validateOTP('1234')).toBe(true);
    });

    it('validates 6-digit OTP', () => {
      expect(otpService.validateOTP('123456')).toBe(true);
    });

    it('validates 8-digit OTP', () => {
      expect(otpService.validateOTP('12345678')).toBe(true);
    });

    it('validates 10-digit OTP', () => {
      expect(otpService.validateOTP('1234567890')).toBe(true);
    });

    it('validates alphanumeric OTP', () => {
      expect(otpService.validateOTP('ABC123')).toBe(true);
    });

    it('validates OTP with hyphens', () => {
      expect(otpService.validateOTP('123-456')).toBe(true);
    });

    it('validates OTP with spaces', () => {
      expect(otpService.validateOTP('123 456')).toBe(true);
    });

    it('rejects too short (< 4 cleaned)', () => {
      expect(otpService.validateOTP('12')).toBe(false);
    });

    it('rejects too long (> 10 cleaned)', () => {
      expect(otpService.validateOTP('12345678901')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(otpService.validateOTP('')).toBe(false);
    });

    it('rejects special characters', () => {
      expect(otpService.validateOTP('!@#$%^')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // waitForFreshOTP
  // ═══════════════════════════════════════════════════════════════

  describe('waitForFreshOTP()', () => {
    it('returns immediately if fresh OTP exists', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '123456',
        source: 'email',
        extractedAt: Date.now(),
        confidence: 0.9,
      });

      const start = Date.now();
      const result = await otpService.waitForFreshOTP(5000);
      expect(Date.now() - start).toBeLessThan(2000);
      expect(result).not.toBeNull();
      expect(result!.code).toBe('123456');
    });

    it('times out and returns last OTP if not fresh', async () => {
      (storageService as any)._store.set('lastOTP', {
        code: '654321',
        source: 'email',
        extractedAt: Date.now() - 120_000, // 2 minutes old -> not fresh (<60s) but valid (<10min)
        confidence: 0.9,
      });

      const result = await otpService.waitForFreshOTP(1000);
      expect(result).not.toBeNull();
      expect(result!.code).toBe('654321');
    });

    it('times out with null when no OTP at all', async () => {
      const result = await otpService.waitForFreshOTP(500);
      expect(result).toBeNull();
    });
  });
});
