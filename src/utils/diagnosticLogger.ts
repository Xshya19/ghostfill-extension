// Diagnostic Logger — Comprehensive SW Console Diagnostics
// Every step, error, state change, and flow is logged with flow IDs
// Access in SW console: window.ghostfill.exportLogs()

import { createLogger } from './logger';

const log = createLogger('DiagnosticLogger');

// ── Types ───────────────────────────────────────────────────────────

export type DiagLevel = 'step' | 'info' | 'warn' | 'error' | 'state' | 'perf';
export type DiagCategory =
  | 'email'
  | 'otp'
  | 'sse'
  | 'polling'
  | 'messaging'
  | 'storage'
  | 'link'
  | 'notification'
  | 'system'
  | 'field-fill'
  | 'detection';

export interface DiagEntry {
  ts: number;
  time: string;
  level: DiagLevel;
  category: DiagCategory;
  flowId: string | null;
  step: number | null;
  action: string;
  detail: string;
  data?: Record<string, unknown>;
  stack?: string;
}

// ── Ring Buffer ─────────────────────────────────────────────────────

const MAX_ENTRIES = 3000;
const buffer: DiagEntry[] = [];

function push(entry: DiagEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

// ── Flow Counter ────────────────────────────────────────────────────

const flowCounters: Record<string, number> = {};

function nextFlowId(category: string): string {
  flowCounters[category] = (flowCounters[category] || 0) + 1;
  return `${category}-${String(flowCounters[category]).padStart(4, '0')}`;
}

// ── Time Formatter ──────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().substring(11, 23);
}

// ── Public API ──────────────────────────────────────────────────────

export const diag = {
  /**
   * Log a diagnostic entry. Always visible in SW console.
   */
  log(
    level: DiagLevel,
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>,
    flowId?: string | null,
    step?: number | null
  ): string {
    const flow = flowId || null;
    const s = step ?? null;
    const entry: DiagEntry = {
      ts: Date.now(),
      time: fmtTime(Date.now()),
      level,
      category,
      flowId: flow,
      step: s,
      action,
      detail,
    };

    if (data) {
      entry.data = data;
    }

    if (level === 'error' && data?.error instanceof Error) {
      entry.stack = data.error.stack || '';
    }

    push(entry);

    // Always print to SW console with clear formatting
    const prefix = flow ? `[${flow}${s !== null ? `:${s}` : ''}]` : '[diag]';
    const levelIcon =
      level === 'error'
        ? '🔴'
        : level === 'warn'
          ? '🟡'
          : level === 'state'
            ? '🔵'
            : level === 'perf'
              ? '⚡'
              : level === 'step'
                ? '▸'
                : 'ℹ️';

    const catTag = `[${category.toUpperCase()}]`;
    const msg = `${levelIcon} ${prefix} ${catTag} ${action} — ${detail}`;

    switch (level) {
      case 'error':
        console.error(`[GhostFill-DIAG] ${msg}`, data);
        break;
      case 'warn':
        console.warn(`[GhostFill-DIAG] ${msg}`, data);
        break;
      case 'perf':
        console.info(`[GhostFill-DIAG] ${msg}`, data);
        break;
      default:
        console.log(`[GhostFill-DIAG] ${msg}`, data ?? '');
    }

    return flow || '';
  },

  /** Start a new flow trace. Returns flow ID. */
  startFlow(category: DiagCategory, action: string, detail?: string): string {
    const id = nextFlowId(category);
    diag.log('step', category, `▶ START ${action}`, detail || '', undefined, id, 0);
    return id;
  },

  /** End a flow trace. */
  endFlow(
    flowId: string,
    category: DiagCategory,
    action: string,
    success: boolean,
    detail?: string,
    data?: Record<string, unknown>
  ): void {
    const lastEntry = buffer.filter((e) => e.flowId === flowId).pop();
    const stepNum = lastEntry ? (lastEntry.step ?? 0) + 1 : 1;
    const duration = lastEntry ? Date.now() - lastEntry.ts : 0;
    diag.log(
      success ? 'info' : 'error',
      category,
      `◀ END ${action}`,
      `${success ? '✅ Success' : '❌ Failed'} — ${detail || ''} (${duration}ms)`,
      { ...data, durationMs: duration },
      flowId,
      stepNum
    );
  },

  /** Log a step within a flow. */
  step(
    flowId: string,
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    const lastEntry = buffer.filter((e) => e.flowId === flowId).pop();
    const stepNum = lastEntry ? (lastEntry.step ?? 0) + 1 : 1;
    diag.log('step', category, action, detail, data, flowId, stepNum);
  },

  /** Log a state change. */
  state(
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    diag.log('state', category, `STATE: ${action}`, detail, data);
  },

  /** Log a performance measurement. */
  perf(
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    diag.log('perf', category, `PERF: ${action}`, detail, data);
  },

  /** Get all entries (optionally filtered). */
  getEntries(filter?: {
    category?: DiagCategory;
    level?: DiagLevel;
    flowId?: string;
    lastN?: number;
  }): DiagEntry[] {
    let entries = buffer;
    if (filter?.category) entries = entries.filter((e) => e.category === filter.category);
    if (filter?.level) entries = entries.filter((e) => e.level === filter.level);
    if (filter?.flowId) entries = entries.filter((e) => e.flowId === filter.flowId);
    if (filter?.lastN) entries = entries.slice(-filter.lastN);
    return entries;
  },

  /** Export full diagnostic report as formatted text. */
  exportReport(): string {
    const lines: string[] = [];
    const now = new Date().toISOString();

    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  GHOSTFILL DIAGNOSTIC REPORT');
    lines.push(`  Generated: ${now}`);
    lines.push(`  Entries: ${buffer.length}`);
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    const errorCount = buffer.filter((e) => e.level === 'error').length;
    const warnCount = buffer.filter((e) => e.level === 'warn').length;
    const flowIds = [...new Set(buffer.filter((e) => e.flowId).map((e) => e.flowId))];

    lines.push(`📊 SUMMARY`);
    lines.push(`   Errors: ${errorCount}`);
    lines.push(`   Warnings: ${warnCount}`);
    lines.push(`   Active flows traced: ${flowIds.length}`);
    lines.push('');

    // Recent errors
    const errors = buffer.filter((e) => e.level === 'error').slice(-20);
    if (errors.length > 0) {
      lines.push('🔴 RECENT ERRORS (last 20)');
      lines.push('─────────────────────────────────────────────────────');
      for (const e of errors) {
        const flowTag = e.flowId ? `[${e.flowId}${e.step !== null ? `:${e.step}` : ''}]` : '';
        lines.push(`  ${e.time} ${flowTag} [${e.category}] ${e.action}`);
        lines.push(`    ${e.detail}`);
        if (e.stack) {
          lines.push(`    Stack: ${e.stack.split('\n').slice(0, 3).join('\n    ')}`);
        }
        lines.push('');
      }
    }

    // Full log (last 200 entries)
    const recent = buffer.slice(-200);
    lines.push('📋 RECENT LOG (last 200 entries)');
    lines.push('─────────────────────────────────────────────────────');
    for (const e of recent) {
      const flowTag = e.flowId ? `[${e.flowId}${e.step !== null ? `:${e.step}` : ''}]` : '[--]';
      const icon =
        e.level === 'error'
          ? '🔴'
          : e.level === 'warn'
            ? '🟡'
            : e.level === 'state'
              ? '🔵'
              : e.level === 'perf'
                ? '⚡'
                : '  ';
      lines.push(
        `  ${icon} ${e.time} ${flowTag.padEnd(20)} [${e.category.padEnd(14)}] ${e.action} — ${e.detail}`
      );
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  END OF REPORT');
    lines.push('═══════════════════════════════════════════════════════');

    return lines.join('\n');
  },

  /** Print report to console. */
  printReport(): void {
    const report = diag.exportReport();
    console.log('\n' + report);
  },

  /** Copy report to clipboard (works in SW via offscreen or notification fallback). */
  async copyReport(): Promise<void> {
    const report = diag.exportReport();
    try {
      await navigator.clipboard.writeText(report);
      console.log('[GhostFill-DIAG] ✅ Diagnostic report copied to clipboard');
    } catch {
      console.log('[GhostFill-DIAG] ⚠️ Could not copy to clipboard. Report printed below:\n');
      diag.printReport();
    }
  },

  /** Clear the buffer. */
  clear(): void {
    buffer.length = 0;
    Object.keys(flowCounters).forEach((k) => {
      flowCounters[k] = 0;
    });
    console.log('[GhostFill-DIAG] 🗑️ Diagnostic buffer cleared');
  },

  /** Get buffer size. */
  get bufferSize(): number {
    return buffer.length;
  },
};

// ── Global Registration ─────────────────────────────────────────────

// Register on window for console access (works in SW context too via globalThis)
declare global {
  // eslint-disable-next-line no-var
  var __GHOSTFILL_DIAG__: typeof diag | undefined;
}

globalThis.__GHOSTFILL_DIAG__ = diag;

// Install console helper
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).ghostfill = {
    exportLogs: () => diag.printReport(),
    copyLogs: () => void diag.copyReport(),
    clearLogs: () => diag.clear(),
    getLogs: (filter?: Record<string, unknown>) =>
      diag.getEntries(filter as Parameters<typeof diag.getEntries>[0]),
    diag,
  };
}

export default diag;
