import { afterEach, describe, expect, it, vi } from 'vitest';

import { VerificationLoop } from '../src/intelligence/IntelligenceCore';
import { createLogger, logger } from '../src/utils/logger';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('credential logging boundaries', () => {
  it.each(['482913', 'A7B9Q2'])(
    'redacts numeric and mixed OTPs from retained history: %s',
    (code) => {
      createLogger('OTPRegression').info(`Cognitive OTP: ${code} (90%)`);
      expect(JSON.stringify(logger.getHistory().at(-1))).not.toContain(code);
    }
  );

  it('does not record expected or actual password values during correction', async () => {
    vi.useFakeTimers();
    const element = document.createElement('input');
    element.type = 'password';
    element.value = 'actual-secret-regression';
    document.body.append(element);
    const pending = new VerificationLoop(1, 1).verifyAndCorrect(
      { fill: vi.fn().mockResolvedValue({ success: true, strategy: 'native' }) },
      { element },
      'expected-secret-regression'
    );
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ success: false });
    const warning = JSON.stringify(logger.getHistory().at(-1));
    expect(warning).not.toContain('expected-secret-regression');
    expect(warning).not.toContain('actual-secret-regression');
    expect(warning).toContain('Verification failed');
  });
});
