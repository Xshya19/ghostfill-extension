/**
 * Polling CircuitBreaker — graduated 429 cooldown.
 *
 * Regression suite for the failure cascade where ONE provider 429 (e.g.
 * YOPmail's throttled token page) froze the entire polling engine for 30s+:
 * a lone 429 must cost only a short breather, with escalation reserved for
 * sustained streaks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CircuitBreaker } from '../src/background/pollingManager';

describe('Polling CircuitBreaker — graduated 429 cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a lone 429 costs a short breather, not a 30s freeze', () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure(new Error('YOPmail home session: HTTP error 429'));
    expect(breaker.currentState).toBe('open');
    const cooldown = breaker.getState().nextRetryTime - Date.now();
    expect(cooldown).toBeGreaterThan(0);
    expect(cooldown).toBeLessThanOrEqual(10_000);
  });

  it('recovers quickly after a lone 429 once the cooldown lapses', () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure(new Error('HTTP error 429'));
    expect(breaker.allowsRequest()).toBe(false);
    vi.setSystemTime(1_000_000 + 15_000);
    expect(breaker.allowsRequest()).toBe(true);
    expect(breaker.currentState).toBe('half-open');
    breaker.recordSuccess();
    expect(breaker.currentState).toBe('closed');
  });

  it('sustained 429 streaks escalate to the long floor', () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure(new Error('HTTP error 429'));
    breaker.recordFailure(new Error('HTTP error 429'));
    const cooldown = breaker.getState().nextRetryTime - Date.now();
    expect(cooldown).toBeGreaterThanOrEqual(30_000);
  });

  it('a success resets the streak so the next 429 is short again', () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure(new Error('HTTP error 429'));
    breaker.recordSuccess();
    breaker.recordFailure(new Error('HTTP error 429'));
    const cooldown = breaker.getState().nextRetryTime - Date.now();
    expect(cooldown).toBeLessThanOrEqual(10_000);
  });

  it('auth errors still never trip the engine circuit', () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure(new Error('401 Unauthorized'));
    breaker.recordFailure(new Error('403 Forbidden'));
    expect(breaker.currentState).toBe('closed');
  });

  it('generic transport errors still need a full streak to open', () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error('fetch failed'));
    }
    expect(breaker.currentState).toBe('closed');
    breaker.recordFailure(new Error('fetch failed'));
    expect(breaker.currentState).toBe('open');
  });
});
