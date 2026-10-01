import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it('prints every structured and diagnostic level in production with secrets redacted', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
  const { createLogger, diag } = await import('../src/utils/logger');
  const log = createLogger('VisibilityTest');
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    log[level]('Console visibility', { password: 'private-value' });
    expect(spies[level]).toHaveBeenCalledWith(expect.stringContaining('Console visibility'), {
      password: '[REDACTED]',
    });
  }
  for (const level of ['step', 'state', 'info', 'perf', 'warn', 'error'] as const) {
    const spy =
      level === 'perf'
        ? spies.info
        : level === 'warn'
          ? spies.warn
          : level === 'error'
            ? spies.error
            : spies.log;
    spy.mockClear();
    diag.log(level, 'otp', 'Visibility', 'Diagnostic visibility', { password: 'private-value' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Diagnostic visibility'), {
      password: '[REDACTED]',
    });
  }
});
