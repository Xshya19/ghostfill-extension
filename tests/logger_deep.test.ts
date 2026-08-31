/**
 * logger_deep.test.ts
 * Deep test suite for src/utils/logger.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLogger } from '../src/utils/logger';

describe('Logger deep tests', () => {
  let consoleSpy: { debug: any; info: any; warn: any; error: any };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // createLogger
  // ═══════════════════════════════════════════════════════════════

  describe('createLogger()', () => {
    it('creates a logger with a source name', () => {
      const log = createLogger('TestModule');
      expect(log).toBeDefined();
      expect(typeof log.info).toBe('function');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('includes source in log output', () => {
      const log = createLogger('MyService');
      log.info('Hello');
      expect(consoleSpy.info).toHaveBeenCalled();
      const args = consoleSpy.info.mock.calls[0];
      const fullOutput = args.join(' ');
      expect(fullOutput).toContain('MyService');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Log Levels
  // ═══════════════════════════════════════════════════════════════

  describe('log levels', () => {
    it('debug calls console.debug', () => {
      const log = createLogger('Test');
      log.debug('debug message');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });

    it('info calls console.info', () => {
      const log = createLogger('Test');
      log.info('info message');
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('warn calls console.warn', () => {
      const log = createLogger('Test');
      log.warn('warn message');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('error calls console.error', () => {
      const log = createLogger('Test');
      log.error('error message');
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Data Logging
  // ═══════════════════════════════════════════════════════════════

  describe('data logging', () => {
    it('logs message with structured data', () => {
      const log = createLogger('Test');
      log.info('Event occurred', { count: 5, type: 'click' });
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('handles undefined data gracefully', () => {
      const log = createLogger('Test');
      expect(() => log.info('No data', undefined)).not.toThrow();
    });

    it('handles null data', () => {
      const log = createLogger('Test');
      expect(() => log.info('Null data', null)).not.toThrow();
    });

    it('handles Error objects', () => {
      const log = createLogger('Test');
      expect(() => log.error('Failed', new Error('Test error'))).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Sensitive Data Redaction
  // ═══════════════════════════════════════════════════════════════

  describe('sensitive data redaction', () => {
    it('redacts email addresses', () => {
      const log = createLogger('Test');
      log.info('User logged in: user@example.com');
      const args = consoleSpy.info.mock.calls[0];
      const output = args.join(' ');
      expect(output).not.toContain('user@example.com');
      expect(output).toContain('[EMAIL]');
    });

    it('redacts API keys', () => {
      const log = createLogger('Test');
      log.info('api_key=fake_secret_token_12345678901234567890');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('fake_secret_token_12345678901234567890');
      expect(output).toContain('[REDACTED]');
    });

    it('redacts passwords in string context', () => {
      const log = createLogger('Test');
      log.info('password=MySecret123!Password');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('MySecret123!Password');
    });

    it('redacts bearer tokens', () => {
      const log = createLogger('Test');
      log.info('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('redacts SSN patterns', () => {
      const log = createLogger('Test');
      log.info('SSN is 123-45-6789');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('123-45-6789');
      expect(output).toContain('[SSN]');
    });

    it('redacts phone numbers', () => {
      const log = createLogger('Test');
      log.info('Phone: (555) 123-4567');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('(555) 123-4567');
      expect(output).toContain('[PHONE]');
    });

    it('redacts credit card numbers', () => {
      const log = createLogger('Test');
      log.info('Card: 4111111111111111');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('4111111111111111');
      expect(output).toMatch(/\[CARD_NUMBER\]|\[PHONE\]/);
    });

    it('redacts IP addresses', () => {
      const log = createLogger('Test');
      log.info('Client IP: 192.168.1.100');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('192.168.1.100');
      expect(output).toContain('[IP_ADDRESS]');
    });

    it('redacts private keys', () => {
      const log = createLogger('Test');
      log.info('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgk\n-----END PRIVATE KEY-----');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('MIIEvQIBADANBgk');
      expect(output).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('redacts database connection strings', () => {
      const log = createLogger('Test');
      log.info('DSN: postgres://admin:secretpass@db.host.com:5432/mydb');
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('admin:secretpass');
    });

    it('redacts sensitive object keys', () => {
      const log = createLogger('Test');
      log.info('Login attempt', { email: 'user@example.com', password: 'secret123' });
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('secret123');
    });

    it('redacts nested object sensitive keys', () => {
      const log = createLogger('Test');
      log.info('Config', { auth: { token: 'abc123xyz' } });
      const output = consoleSpy.info.mock.calls[0].join(' ');
      expect(output).not.toContain('abc123xyz');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('handles circular objects without crashing', () => {
      const log = createLogger('Test');
      const obj: any = { a: 1 };
      obj.self = obj;
      expect(() => log.info('Circular', obj)).not.toThrow();
    });

    it('handles very long messages', () => {
      const log = createLogger('Test');
      const longMsg = 'A'.repeat(5000);
      expect(() => log.info(longMsg)).not.toThrow();
    });

    it('handles symbols and special types', () => {
      const log = createLogger('Test');
      expect(() => log.info('Data', { key: Symbol('test') })).not.toThrow();
    });

    it('handles empty message', () => {
      const log = createLogger('Test');
      expect(() => log.info('')).not.toThrow();
    });

    it('handles numeric source name', () => {
      const log = createLogger('42');
      expect(() => log.info('test')).not.toThrow();
    });

    it('handles unicode in messages', () => {
      const log = createLogger('Test');
      expect(() => log.info('日本語テスト 🔐 مرحبا')).not.toThrow();
    });

    it('handles array data', () => {
      const log = createLogger('Test');
      expect(() => log.info('Items', [1, 'two', { three: 3 }])).not.toThrow();
    });

    it('multiple loggers with different sources', () => {
      const log1 = createLogger('Service1');
      const log2 = createLogger('Service2');

      log1.info('from service 1');
      log2.info('from service 2');

      const output1 = consoleSpy.info.mock.calls[0].join(' ');
      const output2 = consoleSpy.info.mock.calls[1].join(' ');

      expect(output1).toContain('Service1');
      expect(output2).toContain('Service2');
    });
  });
});
