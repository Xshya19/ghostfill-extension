import { createLogger } from '../utils/logger';

const log = createLogger('GmailFastWatch');

export type TriggerReason =
  | 'gmail_alias_resolved'
  | 'gmail_alias_generated'
  | 'registration_form_submitted'
  | 'otp_page_detected';

const GMAIL_FAST_WATCH_INTERVAL_MS = 2_000;
const GMAIL_FAST_WATCH_DURATION_MS = 60_000;

let gmailFastWatchTimer: ReturnType<typeof setInterval> | null = null;
let gmailFastWatchStopTimer: ReturnType<typeof setTimeout> | null = null;
let gmailFastWatchUntil = 0;
let gmailFastWatchRunning = false;

/**
 * Starts fast-watch polling for Gmail events.
 */
export function startGmailFastWatch(
  triggerEventDrivenPolling: (reason: string) => void,
  reason: TriggerReason,
  options?: { intervalMs?: number; durationMs?: number }
): void {
  const intervalMs = options?.intervalMs ?? GMAIL_FAST_WATCH_INTERVAL_MS;
  const durationMs = options?.durationMs ?? GMAIL_FAST_WATCH_DURATION_MS;
  const now = Date.now();
  const nextUntil = now + durationMs;

  // Extend an existing fast-watch window instead of creating duplicate timers.
  gmailFastWatchUntil = Math.max(gmailFastWatchUntil, nextUntil);

  if (gmailFastWatchRunning) {
    log.debug('[GmailFastWatch] extended', {
      reason,
      intervalMs,
      until: new Date(gmailFastWatchUntil).toISOString(),
    });
    triggerEventDrivenPolling(`gmail_fast_extend:${reason}`);
    return;
  }

  gmailFastWatchRunning = true;
  log.info('[GmailFastWatch] started', {
    reason,
    intervalMs,
    durationMs,
    until: new Date(gmailFastWatchUntil).toISOString(),
  });

  // Run immediately.
  triggerEventDrivenPolling(`gmail_fast_start:${reason}`);

  gmailFastWatchTimer = setInterval(() => {
    if (Date.now() >= gmailFastWatchUntil) {
      stopGmailFastWatch('duration_expired');
      return;
    }
    triggerEventDrivenPolling('gmail_fast_tick');
  }, intervalMs);

  gmailFastWatchStopTimer = setTimeout(() => {
    stopGmailFastWatch('stop_timer');
  }, durationMs + 1_000);
}

export function stopGmailFastWatch(reason = 'manual'): void {
  if (gmailFastWatchTimer) {
    clearInterval(gmailFastWatchTimer);
    gmailFastWatchTimer = null;
  }
  if (gmailFastWatchStopTimer) {
    clearTimeout(gmailFastWatchStopTimer);
    gmailFastWatchStopTimer = null;
  }
  if (gmailFastWatchRunning) {
    log.info('[GmailFastWatch] stopped', { reason });
  }
  gmailFastWatchRunning = false;
  gmailFastWatchUntil = 0;
}
