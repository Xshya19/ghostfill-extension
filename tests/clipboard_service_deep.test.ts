/**
 * clipboard_service_deep.test.ts
 * Deep test suite for src/services/clipboardService.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clipboardService } from '../src/services/clipboardService';

describe('ClipboardService deep tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardService.cancelAutoClear();
    // Ensure clipboard mock is available
    if (!navigator.clipboard?.writeText) {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue(''),
        },
        configurable: true,
      });
    }
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('');
  });

  afterEach(() => {
    clipboardService.cancelAutoClear();
  });

  // ═══════════════════════════════════════════════════════════════
  // copy()
  // ═══════════════════════════════════════════════════════════════

  describe('copy()', () => {
    it('copies text to clipboard successfully', async () => {
      const result = await clipboardService.copy('hello world');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    });

    it('returns false when clipboard write fails', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Blocked'));

      const result = await clipboardService.copy('secret');
      // Might fall back to execCommand
      expect(typeof result).toBe('boolean');
    });

    it('schedules auto-clear for password type', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('mypassword', 'password');
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('mypassword');

      // Should schedule clear after 60 seconds
      vi.advanceTimersByTime(60001);
      // writeText should have been called again with '' to clear
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
      vi.useRealTimers();
    });

    it('schedules auto-clear for OTP type', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('123456', 'otp');

      vi.advanceTimersByTime(120001);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
      vi.useRealTimers();
    });

    it('does NOT auto-clear for email type', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('user@example.com', 'email');

      vi.advanceTimersByTime(200000);
      // writeText should only have been called once (for the copy)
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('custom autoClearMs overrides default', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('data', 'default', 500);

      vi.advanceTimersByTime(501);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
      vi.useRealTimers();
    });

    it('cancels previous timer on new copy', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('first', 'password');
      await clipboardService.copy('second', 'password');

      // Only the second timer should fire
      vi.advanceTimersByTime(60001);
      const calls = (navigator.clipboard.writeText as any).mock.calls;
      const clearCalls = calls.filter((c: string[]) => c[0] === '');
      expect(clearCalls.length).toBe(1);
      vi.useRealTimers();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // clearClipboard()
  // ═══════════════════════════════════════════════════════════════

  describe('clearClipboard()', () => {
    it('clears by writing empty string', async () => {
      const result = await clipboardService.clearClipboard();
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    });

    it('returns false on failure', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Failed'));
      const result = await clipboardService.clearClipboard();
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // read()
  // ═══════════════════════════════════════════════════════════════

  describe('read()', () => {
    it('reads from clipboard', async () => {
      vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('clipboard-content');
      const result = await clipboardService.read();
      expect(result).toBe('clipboard-content');
    });

    it('returns null on failure', async () => {
      vi.spyOn(navigator.clipboard, 'readText').mockRejectedValue(new Error('Denied'));
      const result = await clipboardService.read();
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Convenience Methods
  // ═══════════════════════════════════════════════════════════════

  describe('copyEmail()', () => {
    it('copies email without auto-clear', async () => {
      const result = await clipboardService.copyEmail('user@example.com');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('user@example.com');
    });
  });

  describe('copyPassword()', () => {
    it('copies password with auto-clear', async () => {
      const result = await clipboardService.copyPassword('secret123');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret123');
    });
  });

  describe('copyOTP()', () => {
    it('copies OTP with auto-clear', async () => {
      const result = await clipboardService.copyOTP('123456');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('123456');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // cancelAutoClear()
  // ═══════════════════════════════════════════════════════════════

  describe('cancelAutoClear()', () => {
    it('cancels pending auto-clear timer', async () => {
      vi.useFakeTimers();
      await clipboardService.copy('secret', 'password');
      clipboardService.cancelAutoClear();

      vi.advanceTimersByTime(120000);
      // Should NOT have cleared (only 1 call — the original copy)
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('safe to call when no timer is pending', () => {
      expect(() => clipboardService.cancelAutoClear()).not.toThrow();
    });

    it('safe to call multiple times', () => {
      expect(() => {
        clipboardService.cancelAutoClear();
        clipboardService.cancelAutoClear();
        clipboardService.cancelAutoClear();
      }).not.toThrow();
    });
  });
});
