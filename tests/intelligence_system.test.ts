import { describe, expect, it, vi } from 'vitest';

const mockStorage: Record<string, any> = {};

vi.mock('../src/services/storageService', () => ({
  storageService: {
    init: vi.fn().mockResolvedValue(undefined),
    get: vi.fn((key: string) => Promise.resolve(mockStorage[key])),
    set: vi.fn((key: string, val: any) => {
      mockStorage[key] = val;
      return Promise.resolve();
    }),
  },
}));

import { IntelligenceCore } from '../src/intelligence/IntelligenceCore';
import { AdaptiveStrategyEngine } from '../src/intelligence/AdaptiveStrategyEngine';
import { RawFieldRecord } from '../src/intelligence/types';

describe('GhostFill Intelligence System Tests', () => {
  describe('IntelligenceCore classification accuracy', () => {
    const core = new IntelligenceCore();

    it('classifies email fields correctly', () => {
      const emailField: RawFieldRecord = {
        url: 'https://example.com/login',
        selector: '#email',
        tag: 'input',
        type: 'email',
        autocomplete: 'email',
        name: 'email',
        id: 'email',
        placeholder: 'Enter your email',
        ariaLabel: 'Email address',
        labelText: 'Email',
        surroundingText: 'Enter your email to sign in',
        maxLength: 100,
        inputMode: '',
        pattern: '',
        required: true,
        visible: true,
        widthPx: 250,
        focused: false,
        opacityZero: false,
        offscreen: false,
        tiny: false,
        className: 'input-email',
        isSecondPasswordField: false,
        structural: new Array(64).fill(0),
      };

      const result = core.classify(emailField);
      expect(result.fieldType).toBe('email');
      expect(result.decision).toBe('FILL');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('classifies OTP verification fields correctly', () => {
      const otpField: RawFieldRecord = {
        url: 'https://example.com/verify',
        selector: '#otp',
        tag: 'input',
        type: 'text',
        autocomplete: 'one-time-code',
        name: 'code',
        id: 'verification-code',
        placeholder: 'Enter 6-digit code',
        ariaLabel: 'OTP code',
        labelText: 'Verification Code',
        surroundingText: 'We sent a code to your phone',
        maxLength: 6,
        inputMode: 'numeric',
        pattern: '[0-9]{6}',
        required: true,
        visible: true,
        widthPx: 120,
        focused: false,
        opacityZero: false,
        offscreen: false,
        tiny: false,
        className: 'input-otp',
        isSecondPasswordField: false,
        structural: new Array(64).fill(0),
      };

      const result = core.classify(otpField);
      expect(result.fieldType).toBe('otp');
      expect(result.decision).toBe('FILL');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('handles safety gates for honeypot traps', () => {
      const honeypotField: RawFieldRecord = {
        url: 'https://example.com/login',
        selector: '#hidden_user_field',
        tag: 'input',
        type: 'text',
        autocomplete: '',
        name: 'email',
        id: 'confirm_email_address_honeypot',
        placeholder: '',
        ariaLabel: '',
        labelText: '',
        surroundingText: '',
        maxLength: -1,
        inputMode: '',
        pattern: '',
        required: false,
        visible: false, // Hidden
        widthPx: 0,
        focused: false,
        opacityZero: true,
        offscreen: true,
        tiny: true,
        className: 'honeypot',
        isSecondPasswordField: false,
        structural: new Array(64).fill(0),
      };

      const result = core.classify(honeypotField);
      expect(result.decision).toBe('BLOCK');
      expect(result.safetyReason).toContain('honeypot');
    });
  });

  describe('AdaptiveStrategyEngine profiling', () => {
    it('ranks strategies based on telemetry success ratings', async () => {
      const engine = new AdaptiveStrategyEngine();
      await engine.init();

      const strategies = [
        { name: 'strategy-react' },
        { name: 'strategy-vue' },
        { name: 'strategy-native' },
      ];

      // Get initial ranking
      const initial = engine.getOptimalStrategyOrder('https://mykeeta.com', strategies);
      expect(initial.map(s => s.name)).toEqual(strategies.map(s => s.name));

      // Report a success for strategy-native
      await engine.recordOutcome('https://mykeeta.com', 'strategy-native', 'otp', true, 10);

      // Get updated ranking
      const updated = engine.getOptimalStrategyOrder('https://mykeeta.com', strategies);
      expect(updated[0].name).toBe('strategy-native'); // Ranked first due to success
    });
  });
});
