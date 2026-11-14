/**
 * Delivery funnel instrumentation (2026-11-12).
 *
 * Why: "sometimes the OTP does not arrive" was the single most reported
 * problem, and it was impossible to reason about — the failure could be
 * in the transport (email never fetched), the extraction (code not
 * recognised), the decision (code judged unsafe to fill) or the delivery
 * (no tab to fill). The funnel measures every stage so "sometimes"
 * becomes a number with a stage attached.
 *
 * Stages:
 *   received  → a new email entered the pipeline
 *   extracted → the extractor produced a code and/or a link
 *   decided   → the decision engine chose an action
 *   delivered → the action reached the user (code filled / link opened)
 *
 * Everything is in-memory and cheap (four counters plus a few fields);
 * the service worker can lose it on suspension without any consequence.
 */

export type FunnelOutcome = 'delivered' | 'dropped';

export interface DeliveryFunnelSnapshot {
  /** Emails that entered the pipeline. */
  received: number;
  /** Emails where extraction produced a code or a link. */
  extracted: number;
  /** Emails where a decision was taken. */
  decided: number;
  /** Emails whose action reached the user. */
  delivered: number;
  /** Emails that were actionable but never delivered. */
  dropped: number;
  /** Why an email was dropped (count per reason). */
  dropReasons: Record<string, number>;
  /** The most recent decision action. */
  lastAction: string | null;
  /** Milliseconds from "received" to "delivered" for the last delivery. */
  lastDeliveryLatencyMs: number | null;
  /** Average received → delivered latency. */
  avgDeliveryLatencyMs: number | null;
  /** Timestamp of the last stage transition. */
  lastTransitionAt: number | null;
}

const state = {
  received: 0,
  extracted: 0,
  decided: 0,
  delivered: 0,
  dropped: 0,
  dropReasons: {} as Record<string, number>,
  lastAction: null as string | null,
  lastDeliveryLatencyMs: null as number | null,
  avgDeliveryLatencyMs: null as number | null,
  lastTransitionAt: null as number | null,
  /** When the most recent email was received (for latency measurement). */
  receivedAt: 0,
  latencySamples: 0,
  latencyTotalMs: 0,
};

/** A new email entered the pipeline. */
export function recordReceived(): void {
  state.received++;
  state.receivedAt = Date.now();
  state.lastTransitionAt = state.receivedAt;
}

/** The extractor produced a code and/or a link. */
export function recordExtracted(hasCode: boolean, hasLink: boolean): void {
  if (!hasCode && !hasLink) {
    return;
  }
  state.extracted++;
  state.lastTransitionAt = Date.now();
}

/** The decision engine chose an action. */
export function recordDecided(action: string): void {
  state.decided++;
  state.lastAction = action;
  state.lastTransitionAt = Date.now();
}

/**
 * The action reached the user (or did not).
 *
 * @param outcome 'delivered' when the code was filled / the link opened.
 * @param reason  why it was dropped (e.g. 'no-waiting-tab', 'review-only').
 */
export function recordOutcome(outcome: FunnelOutcome, reason?: string): void {
  if (outcome === 'delivered') {
    state.delivered++;
    if (state.receivedAt > 0) {
      const latency = Date.now() - state.receivedAt;
      state.lastDeliveryLatencyMs = latency;
      state.latencySamples++;
      state.latencyTotalMs += latency;
      state.avgDeliveryLatencyMs = Math.round(state.latencyTotalMs / state.latencySamples);
    }
  } else {
    state.dropped++;
    const key = reason && reason.length > 0 ? reason : 'unknown';
    state.dropReasons[key] = (state.dropReasons[key] ?? 0) + 1;
  }
  state.lastTransitionAt = Date.now();
}

/** Current funnel counters. */
export function getDeliveryFunnel(): DeliveryFunnelSnapshot {
  return {
    received: state.received,
    extracted: state.extracted,
    decided: state.decided,
    delivered: state.delivered,
    dropped: state.dropped,
    dropReasons: { ...state.dropReasons },
    lastAction: state.lastAction,
    lastDeliveryLatencyMs: state.lastDeliveryLatencyMs,
    avgDeliveryLatencyMs: state.avgDeliveryLatencyMs,
    lastTransitionAt: state.lastTransitionAt,
  };
}

/** Human-readable funnel section for the diagnostic report. */
export function exportFunnelReport(): string {
  const f = getDeliveryFunnel();
  const lines: string[] = [];
  lines.push('📥 DELIVERY FUNNEL');
  lines.push(`   Received:  ${f.received}`);
  lines.push(`   Extracted: ${f.extracted}`);
  lines.push(`   Decided:   ${f.decided}`);
  lines.push(`   Delivered: ${f.delivered}`);
  lines.push(`   Dropped:   ${f.dropped}`);
  if (f.lastAction) {
    lines.push(`   Last action: ${f.lastAction}`);
  }
  if (f.avgDeliveryLatencyMs !== null) {
    lines.push(`   Avg received→delivered: ${f.avgDeliveryLatencyMs}ms`);
  }
  const reasons = Object.entries(f.dropReasons);
  if (reasons.length > 0) {
    lines.push('   Drop reasons:');
    for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) {
      lines.push(`     - ${reason}: ${count}`);
    }
  }
  return lines.join('\n');
}

/** Reset the counters (used by diagnostics tooling and tests). */
export function resetDeliveryFunnel(): void {
  state.received = 0;
  state.extracted = 0;
  state.decided = 0;
  state.delivered = 0;
  state.dropped = 0;
  state.dropReasons = {};
  state.lastAction = null;
  state.lastDeliveryLatencyMs = null;
  state.avgDeliveryLatencyMs = null;
  state.lastTransitionAt = null;
  state.receivedAt = 0;
  state.latencySamples = 0;
  state.latencyTotalMs = 0;
}
