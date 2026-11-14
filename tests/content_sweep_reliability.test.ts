import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/messaging', () => ({
  safeSendMessage: vi.fn(),
  safeSendTabMessage: vi.fn(),
}));

import { safeSendMessage } from '../src/utils/messaging';
import { AutoFiller } from '../src/content/autoFiller';
import { FloatingButton } from '../src/content/floatingButton';

/**
 * Reliability sweep of the content layer:
 * 1. Duplicate OTP deliveries (background retry schedule / queued re-fill)
 *    must not write the same code twice.
 * 2. Smart Fill must not race the background OTP delivery on the same
 *    split-group fields (fillLock ownership).
 * 3. The OTP-waiting scan interval must self-clean when its state is gone.
 */

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SPLIT_OTP_FORM = '<form>' + '<input name="otp" maxlength="1">'.repeat(6) + '</form>';

const countSplitInputs = (): HTMLInputElement[] =>
  [...document.querySelectorAll<HTMLInputElement>('form input')];

describe('duplicate OTP delivery suppression', () => {
  it('writes a repeated identical code only once within the dedupe window', async () => {
    // Fails on the old code: the second AUTO_FILL_OTP delivery re-ran the full
    // fill pipeline and re-wrote every split box, doubling the input events.
    document.body.innerHTML = SPLIT_OTP_FORM;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    const clock = { value: 1_000 };
    vi.spyOn(Date, 'now').mockImplementation(() => clock.value);
    vi.mocked(safeSendMessage).mockImplementation(async () => ({ success: true }) as never);

    const inputs = countSplitInputs();
    const events: string[] = [];
    inputs.forEach((input) => input.addEventListener('input', () => events.push(input.value)));
    const filler = new AutoFiller();
    try {
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...'451612']);

      // The background delivery engine re-sends the same code when the first
      // fill's response is slow or lost; a moment later it must be a no-op.
      clock.value = 1_500;
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...'451612']);
      expect(inputs.map((input) => input.value)).toEqual([...'451612']);
    } finally {
      filler.destroy();
    }
  });

  it('lets the same code be refilled once the dedupe window has expired', async () => {
    // Fails on a broken dedupe that never expires: a manual refill of an
    // older code would be suppressed forever instead of rewritten.
    document.body.innerHTML = SPLIT_OTP_FORM;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    const clock = { value: 1_000 };
    vi.spyOn(Date, 'now').mockImplementation(() => clock.value);
    vi.mocked(safeSendMessage).mockImplementation(async () => ({ success: true }) as never);

    const inputs = countSplitInputs();
    const events: string[] = [];
    inputs.forEach((input) => input.addEventListener('input', () => events.push(input.value)));
    const filler = new AutoFiller();
    try {
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      clock.value = 2_000; // inside the window → suppressed
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...'451612']);

      clock.value = 7_000; // > 5s after the successful fill → real refill
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...('451612' + '451612')]);
    } finally {
      filler.destroy();
    }
  });

  it('never arms the dedupe window from a failed fill', async () => {
    // Fails on an implementation that marks the code as delivered before the
    // fill actually succeeds: the retry after the widget grew to six boxes
    // would be suppressed and the fields would stay empty.
    document.body.innerHTML =
      '<form>' + '<input name="otp" maxlength="1">'.repeat(4) + '</form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    vi.mocked(safeSendMessage).mockImplementation(async () => ({ success: true }) as never);

    const form = document.querySelector('form')!;
    const filler = new AutoFiller();
    try {
      // A 6-digit code cannot land in a 4-box widget (length mismatch, fields
      // untouched) — this delivery failed and must not suppress the next one.
      expect(await filler.fillOTP('451612', undefined, true)).toBe(false);
      expect(countSplitInputs().map((input) => input.value).join('')).toBe('');

      for (let i = 0; i < 2; i++) {
        const box = document.createElement('input');
        box.name = 'otp';
        box.maxLength = 1;
        form.append(box);
      }
      const inputs = countSplitInputs();
      const events: string[] = [];
      inputs.forEach((input) => input.addEventListener('input', () => events.push(input.value)));

      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...'451612']);
      expect(inputs.map((input) => input.value)).toEqual([...'451612']);
    } finally {
      filler.destroy();
    }
  });

  it('keeps the dedupe marker armed even when MARK_OTP_USED messaging fails', async () => {
    // Fails on the old code twice over: no marker existed at all (immediate
    // rewrite), and an unhandled messaging rejection would surface as an
    // unhandled rejection instead of a debug log.
    document.body.innerHTML = SPLIT_OTP_FORM;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    vi.mocked(safeSendMessage).mockImplementation(async (message: { action: string }) => {
      if (message.action === 'MARK_OTP_USED') {
        throw new Error('extension context invalidated');
      }
      return { success: true } as never;
    });

    const inputs = countSplitInputs();
    const events: string[] = [];
    inputs.forEach((input) => input.addEventListener('input', () => events.push(input.value)));
    const filler = new AutoFiller();
    try {
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(await filler.fillOTP('451612', undefined, true)).toBe(true);
      expect(events).toEqual([...'451612']);
    } finally {
      filler.destroy();
    }
  });
});

describe('smart fill vs background OTP delivery race', () => {
  it('defers the OTP group write while a delivery holds the fill lock', async () => {
    // Fails on the old code: smartFill wrote the six split boxes itself while
    // the background AUTO_FILL_OTP fill was still running, interleaving two
    // per-digit writers on the same group.
    document.body.innerHTML = SPLIT_OTP_FORM;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    vi.mocked(safeSendMessage).mockImplementation(async (message: { action: string }) => {
      if (message.action === 'GET_IDENTITY') {
        return { success: true, identity: {} } as never;
      }
      if (message.action === 'GET_LAST_OTP') {
        return { success: true, lastOTP: { code: '491827' } } as never;
      }
      return { success: true } as never;
    });

    const inputs = countSplitInputs();
    const events: string[] = [];
    inputs.forEach((input) => input.addEventListener('input', () => events.push(input.value)));
    const filler = new AutoFiller();
    const internal = filler as unknown as { fillLock: boolean };
    try {
      // Simulate an in-flight background AUTO_FILL_OTP delivery holding the lock.
      internal.fillLock = true;
      const blocked = await filler.smartFill();
      expect(blocked.success).toBe(false);
      expect(blocked.filledCount).toBe(0);
      expect(events).toEqual([]);
      expect(inputs.map((input) => input.value)).toEqual(['', '', '', '', '', '']);

      // Once the delivery finishes (lock released) the next smart fill writes
      // the group normally — the deferral is temporary, not a permanent block.
      internal.fillLock = false;
      const result = await filler.smartFill();
      expect(result.success).toBe(true);
      expect(result.filledCount).toBe(6);
      expect(events).toEqual([...'491827']);
      expect(inputs.map((input) => input.value)).toEqual([...'491827']);
    } finally {
      filler.destroy();
    }
  });
});

describe('OTP waiting indicator lifecycle', () => {
  const exposeIndicatorInternals = (fab: FloatingButton) =>
    fab as unknown as {
      button: HTMLElement | null;
      shadowRoot: ShadowRoot | null;
      destroyed: boolean;
      isWaitingForOTP: boolean;
      otpWaitingIndicator: HTMLElement | null;
      otpWaitingInterval: ReturnType<typeof setInterval> | null;
      showOTPWaitingIndicator: () => void;
      getPageAnalysis: () => { pageType: string; hasOTPField: boolean };
    };

  it('stops the 2s scan loop once waiting has ended without an explicit hide', async () => {
    // Fails on the old code: the tick only returned, so the interval kept
    // firing every 2s forever whenever the OTP_PAGE_LEFT bookkeeping was missed.
    vi.useFakeTimers();
    const fab = new FloatingButton({} as AutoFiller);
    const internal = exposeIndicatorInternals(fab);
    try {
      const button = document.createElement('div');
      document.body.append(button);
      internal.button = button;
      internal.shadowRoot = button.attachShadow({ mode: 'open' });
      internal.getPageAnalysis = () => ({ pageType: 'other', hasOTPField: false });

      internal.isWaitingForOTP = true;
      internal.showOTPWaitingIndicator();
      expect(internal.otpWaitingInterval).not.toBeNull();
      expect(internal.otpWaitingIndicator).not.toBeNull();

      // While still waiting the scan loop keeps running (no premature cleanup).
      await vi.advanceTimersByTimeAsync(2_000);
      expect(internal.otpWaitingInterval).not.toBeNull();

      // Waiting ended but the hide bookkeeping was missed → the next tick
      // must clean itself up instead of ticking forever.
      internal.isWaitingForOTP = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(internal.otpWaitingInterval).toBeNull();
      expect(internal.otpWaitingIndicator).toBeNull();
      expect(button.querySelector('.gf-otp-waiting-indicator')).toBeNull();
    } finally {
      fab.destroy();
    }
  });

  it('stops the 2s scan loop after destruction without an explicit hide', async () => {
    // Fails on the old code: same leak, exercised through the destroyed flag.
    vi.useFakeTimers();
    const fab = new FloatingButton({} as AutoFiller);
    const internal = exposeIndicatorInternals(fab);
    try {
      const button = document.createElement('div');
      document.body.append(button);
      internal.button = button;
      internal.shadowRoot = button.attachShadow({ mode: 'open' });
      internal.getPageAnalysis = () => ({ pageType: 'other', hasOTPField: false });

      internal.isWaitingForOTP = true;
      internal.showOTPWaitingIndicator();
      expect(internal.otpWaitingInterval).not.toBeNull();

      internal.destroyed = true;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(internal.otpWaitingInterval).toBeNull();
      expect(internal.otpWaitingIndicator).toBeNull();
    } finally {
      fab.destroy();
    }
  });
});
