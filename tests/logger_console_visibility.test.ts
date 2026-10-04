import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it('loads the saved debug setting and prints every level without the Verbose filter', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ settings: { debugMode: true } });
  const spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
  const { createLogger, diag } = await import('../src/utils/logger');
  await Promise.resolve();
  const log = createLogger('VisibilityTest');
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    log[level]('Console visibility', { password: 'private-value' });
    expect(spies[level === 'debug' ? 'log' : level]).toHaveBeenCalledWith(
      expect.stringContaining('Console visibility'),
      {
        password: '[REDACTED]',
      }
    );
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

it('keeps routine logs and diagnostic warnings visible with debug mode off', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { logger, diag } = await import('../src/utils/logger');
  logger.debug('Quiet debug');
  diag.log('step', 'otp', 'Quiet step', 'Buffered for a diagnostic report');
  expect(logSpy).not.toHaveBeenCalled();
  expect(debugSpy).not.toHaveBeenCalled();
  expect(logger.getHistory().at(-1)?.message).toBe('Quiet debug');
  expect(diag.getEntries({ lastN: 1 })[0]?.detail).toBe('Buffered for a diagnostic report');
  logger.info('Routine information');
  diag.log('warn', 'otp', 'warning', 'Still visible');
  diag.log('error', 'otp', 'error', 'Still visible');
  expect(infoSpy).toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalled();
});

it('applies settings changes live and ignores a stale startup read and other storage areas', async () => {
  let finishRead!: (value: Record<string, unknown>) => void;
  vi.mocked(chrome.storage.local.get).mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    })
  );
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { logger } = await import('../src/utils/logger');
  const onChange = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0]![0];
  onChange({ settings: { newValue: { debugMode: true } } }, 'local');
  finishRead({ settings: { debugMode: false } });
  await Promise.resolve();
  logger.debug('Enabled live');
  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Enabled live'));
  onChange({ settings: { newValue: { debugMode: false } } }, 'session');
  logger.debug('Still enabled');
  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Still enabled'));
  logSpy.mockClear();
  onChange({ settings: {} }, 'local');
  logger.debug('Disabled live');
  expect(logSpy).not.toHaveBeenCalled();
});

it('masks standalone codes, URL secrets and diagnostic action text before printing or export', async () => {
  vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({ settings: { debugMode: true } });
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { logger, diag } = await import('../src/utils/logger');
  logger.debug('Code result', '009165');
  diag.log(
    'step',
    'link',
    'person@example.com',
    'Open https://claude.ai/magic-link#sensitive-link-token',
    {
      link: 'https://app.notion.com/loginwithemail?password=009165&state=sensitive-state',
    }
  );
  const output = JSON.stringify({ calls: logSpy.mock.calls, report: diag.exportReport() });
  for (const secret of [
    '009165',
    'person@example.com',
    'sensitive-link-token',
    'sensitive-state',
  ]) {
    expect(output).not.toContain(secret);
  }
  expect(output).toContain('[REDACTED]');
});

it('never repeats an OTP capture in its redaction replacement', async () => {
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const { logger } = await import('../src/utils/logger');
  logger.info('OTP detected: 94105 with confidence 82%');
  logger.info('Verification code: 009165');
  const output = JSON.stringify({ console: infoSpy.mock.calls, history: logger.getHistory() });
  expect(output).not.toContain('94105');
  expect(output).not.toContain('009165');
  expect(output).toContain('[REDACTED]');
});

it('copies log history only when the debug surface is read and returns independent snapshots', async () => {
  const { logger } = await import('../src/utils/logger');
  logger.clearHistory();
  const historySpy = vi.spyOn(logger, 'getHistory');
  for (let i = 0; i < 600; i++) logger.debug('Mailbox step', { count: i });
  expect(historySpy).not.toHaveBeenCalled();
  const surface = globalThis as typeof globalThis & { __GHOSTFILL_LOG_HISTORY__: unknown[] };
  const snapshot = surface.__GHOSTFILL_LOG_HISTORY__;
  expect(snapshot).toHaveLength(100);
  expect(historySpy).toHaveBeenCalledTimes(1);
  snapshot.length = 0;
  expect(surface.__GHOSTFILL_LOG_HISTORY__).toHaveLength(100);
  logger.clearHistory();
  expect(surface.__GHOSTFILL_LOG_HISTORY__).toEqual([]);
});
