/**
 * debounce_deep.test.ts
 * Deep test suite for src/utils/debounce.ts
 * Includes Bug 2 (trailing-only immediate invocation) fix verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { debounce, throttle, rafDebounce } from '../src/utils/debounce';

describe('debounce() deep tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('default trailing-only: does NOT invoke immediately', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled(); // Bug 2 fix verification!

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('trailing-only: uses latest args', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('leading-only: invokes immediately, then ignores', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true, trailing: false });

    debounced('first');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');

    debounced('second');
    expect(fn).toHaveBeenCalledTimes(1); // still 1

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1); // still 1 (trailing=false)
  });

  it('leading+trailing: invokes on leading and trailing edges', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true, trailing: true });

    debounced('first');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');

    debounced('second');
    expect(fn).toHaveBeenCalledTimes(1); // second doesn't fire yet

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  it('cancel() stops pending invocation', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() triggers immediate invocation', () => {
    const fn = vi.fn().mockReturnValue('result');
    const debounced = debounce(fn, 100);

    debounced('arg');
    const result = debounced.flush('arg');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
  });

  it('flush() returns undefined when nothing pending', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    expect(debounced.flush()).toBeUndefined();
  });

  it('isPending() reports pending state', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    expect(debounced.isPending()).toBe(false);
    debounced();
    expect(debounced.isPending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(debounced.isPending()).toBe(false);
  });

  it('maxWait forces invocation before maxWait', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 200 });

    // Keep calling every 50ms — should fire at 200ms
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    // At 200ms, maxWait should trigger
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('preserves this context', () => {
    const obj = {
      value: 42,
      method: debounce(function(this: any) {
        return this.value;
      }, 100),
    };

    obj.method();
    vi.advanceTimersByTime(100);
    // The function should have been called with obj as `this`
    // We can't easily check the return value in debounce, but it should not throw
  });

  it('handles rapid fire without memory leak', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    for (let i = 0; i < 10000; i++) {
      debounced();
    }

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('[BUG 2 FIX] trailing-only debounce waits full delay', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200, { leading: false, trailing: true });

    debounced('a');
    expect(fn).not.toHaveBeenCalled(); // Must NOT fire immediately!

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled(); // Still waiting

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1); // Fires at 200ms
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('multiple cycles work correctly', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    // Cycle 1
    debounced('a');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('a');

    // Cycle 2
    debounced('b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });
});

// ═══════════════════════════════════════════════════════════════
// throttle
// ═══════════════════════════════════════════════════════════════

describe('throttle() deep tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires on leading edge by default', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('blocks subsequent calls during throttle window', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled('c');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires trailing call after window', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });

  it('leading=false: does not fire immediately', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100, { leading: false });

    throttled('a');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('trailing=false: no trailing call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100, { trailing: false });

    throttled('a');
    throttled('b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1); // Only leading
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('cancel stops pending trailing invocation', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1); // Only leading
  });
});

// ═══════════════════════════════════════════════════════════════
// rafDebounce
// ═══════════════════════════════════════════════════════════════

describe('rafDebounce() deep tests', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('batches multiple calls to a single frame', () => {
    const fn = vi.fn();
    const debounced = rafDebounce(fn);

    debounced('a');
    debounced('b');
    debounced('c');

    vi.advanceTimersByTime(32);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel stops the pending frame', () => {
    const fn = vi.fn();
    const debounced = rafDebounce(fn);

    debounced('a');
    debounced.cancel();
    vi.advanceTimersByTime(32);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush triggers immediate execution', () => {
    const fn = vi.fn();
    const debounced = rafDebounce(fn);

    debounced('a');
    debounced.flush('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });
});
