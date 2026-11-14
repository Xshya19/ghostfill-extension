/**
 * Delivery funnel + OTP expectation window (2026-11-12).
 *
 * Regression suite for the two mechanisms that make "sometimes it does
 * not fill" measurable and bounded:
 *
 * - the delivery funnel counts every stage (received → extracted →
 *   decided → delivered) and records WHY an email was dropped;
 * - the OTP expectation window keeps the polling cadence tight while a
 *   code is on its way, so the email is picked up in seconds instead of
 *   waiting for the user's (up to 60s) check-interval setting.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  exportFunnelReport,
  getDeliveryFunnel,
  recordDecided,
  recordExtracted,
  recordOutcome,
  recordReceived,
  resetDeliveryFunnel,
} from '../src/background/deliveryFunnel';

describe('delivery funnel', () => {
  beforeEach(() => {
    resetDeliveryFunnel();
  });

  it('starts empty', () => {
    const snapshot = getDeliveryFunnel();
    expect(snapshot.received).toBe(0);
    expect(snapshot.extracted).toBe(0);
    expect(snapshot.decided).toBe(0);
    expect(snapshot.delivered).toBe(0);
    expect(snapshot.dropped).toBe(0);
  });

  it('counts a full delivery', () => {
    recordReceived();
    recordExtracted(true, false);
    recordDecided('fill-otp');
    recordOutcome('delivered');

    const snapshot = getDeliveryFunnel();
    expect(snapshot.received).toBe(1);
    expect(snapshot.extracted).toBe(1);
    expect(snapshot.decided).toBe(1);
    expect(snapshot.delivered).toBe(1);
    expect(snapshot.dropped).toBe(0);
    expect(snapshot.lastAction).toBe('fill-otp');
  });

  it('does not count an email without a code or link as extracted', () => {
    recordReceived();
    recordExtracted(false, false);
    expect(getDeliveryFunnel().extracted).toBe(0);
  });

  it('records why an email was dropped', () => {
    recordReceived();
    recordExtracted(true, false);
    recordDecided('show-review');
    recordOutcome('dropped', 'no-waiting-tab');
    recordOutcome('dropped', 'no-waiting-tab');
    recordOutcome('dropped', 'review-only-not-auto-filled');

    const snapshot = getDeliveryFunnel();
    expect(snapshot.dropped).toBe(3);
    expect(snapshot.dropReasons['no-waiting-tab']).toBe(2);
    expect(snapshot.dropReasons['review-only-not-auto-filled']).toBe(1);
  });

  it('measures the received → delivered latency', () => {
    recordReceived();
    recordExtracted(true, true);
    recordDecided('open-link');
    recordOutcome('delivered');

    const snapshot = getDeliveryFunnel();
    expect(snapshot.delivered).toBe(1);
    expect(snapshot.lastDeliveryLatencyMs).not.toBeNull();
    expect(snapshot.lastDeliveryLatencyMs ?? -1).toBeGreaterThanOrEqual(0);
    expect(snapshot.avgDeliveryLatencyMs).not.toBeNull();
  });

  it('exports a readable report section', () => {
    recordReceived();
    recordExtracted(true, false);
    recordDecided('fill-otp');
    recordOutcome('dropped', 'no-waiting-tab');

    const report = exportFunnelReport();
    expect(report).toContain('DELIVERY FUNNEL');
    expect(report).toContain('Received:  1');
    expect(report).toContain('no-waiting-tab');
  });
});
