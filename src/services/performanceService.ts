// Performance Analytics Service
// Internal tracking for developer analysis - NOT shown to users
// Tracks: AI vs Heuristics performance, latency, success rates, failures

import { createLogger } from '../utils/logger';
import { storageService } from './storageService';

const log = createLogger('PerformanceService');

// ========================
// TYPES
// ========================

interface OperationMetric {
  timestamp: number;
  method: 'heuristics' | 'regex' | 'ai' | 'ai_backup';
  latencyMs: number;
  success: boolean;
  confidence: number;
  errorType?: string;
  details?: string;
}

interface FeatureMetrics {
  totalOperations: number;
  heuristicsCount: number;
  heuristicsSuccess: number;
  heuristicsAvgLatency: number;
  aiCount: number;
  aiSuccess: number;
  aiAvgLatency: number;
  aiBackupCount: number; // Times AI was called as backup
  aiBackupSuccess: number;
  failures: { type: string; count: number }[];
  lastUpdated: number;
}

interface PerformanceReport {
  generatedAt: string;
  sessionStart: string;
  totalRuntime: number;

  formDetection: FeatureMetrics & {
    fieldTypes: { email: number; password: number; name: number; phone: number; other: number };
  };

  otpExtraction: FeatureMetrics & {
    patterns: { numeric: number; alphanumeric: number; spaced: number };
    avgOtpLength: number;
  };

  activationLinks: FeatureMetrics & {
    linksFound: number;
    linksActivated: number;
    avgConfidence: number;
  };

  emailParsing: FeatureMetrics & {
    emailsProcessed: number;
    otpFound: number;
    linksFound: number;
  };

  summary: {
    heuristicsWinRate: number; // % of time heuristics was sufficient
    aiBackupRate: number; // % of time AI was needed
    avgLatencyWithoutAI: number;
    avgLatencyWithAI: number;
    overallSuccessRate: number;
    recommendation: string;
  };

  percentiles: {
    p95: number;
    p99: number;
  };
  regressionDetected: boolean;
  memoryWatchdog: {
    limitBytes: number;
    heapBytes: number;
    percentage: number;
  };
}

// ========================
// PERFORMANCE SERVICE
// ========================

class PerformanceService {
  private sessionStart: number = Date.now();

  // SECURITY/PRIVACY FIX: Disable analytics tracking by default to require explicit opt-in
  private trackingEnabled: boolean = false;

  // In-memory metrics storage
  private readonly MAX_METRIC_ENTRIES = 500;
  private formMetrics: OperationMetric[] = [];
  private otpMetrics: OperationMetric[] = [];
  private linkMetrics: OperationMetric[] = [];
  private emailMetrics: OperationMetric[] = [];

  // Field type counters
  private fieldTypeCounts = { email: 0, password: 0, name: 0, phone: 0, other: 0 };

  // OTP pattern counters
  private otpPatterns = { numeric: 0, alphanumeric: 0, spaced: 0 };
  private otpLengths: number[] = [];

  // Link counters
  private linksFound = 0;
  private linksActivated = 0;
  private linkConfidences: number[] = [];

  // Email counters
  private emailsProcessed = 0;
  private emailOtpFound = 0;
  private emailLinksFound = 0;

  // ========================
  // TRACKING METHODS
  // ========================

  /**
   * Track Form Detection operation
   */
  trackFormDetection(
    method: 'heuristics' | 'ai' | 'ai_backup',
    latencyMs: number,
    success: boolean,
    confidence: number,
    fieldsDetected?: { email: boolean; password: boolean; name: boolean; phone: boolean },
    error?: string
  ): void {
    if (!this.trackingEnabled) {
      return;
    }

    const metric: OperationMetric = {
      timestamp: Date.now(),
      method,
      latencyMs,
      success,
      confidence,
    };
    if (error) {
      metric.errorType = error;
    }
    if (fieldsDetected) {
      metric.details = JSON.stringify(fieldsDetected);
    }

    this.formMetrics.push(metric);

    // Cap metrics array
    if (this.formMetrics.length > this.MAX_METRIC_ENTRIES) {
      this.formMetrics.shift();
    }

    // Count field types
    if (fieldsDetected) {
      if (fieldsDetected.email) {
        this.fieldTypeCounts.email++;
      }
      if (fieldsDetected.password) {
        this.fieldTypeCounts.password++;
      }
      if (fieldsDetected.name) {
        this.fieldTypeCounts.name++;
      }
      if (fieldsDetected.phone) {
        this.fieldTypeCounts.phone++;
      }
    }

    this.logMetric('FormDetection', method, latencyMs, success, confidence);
  }

  /**
   * Track OTP Extraction operation
   */
  trackOtpExtraction(
    method: 'regex' | 'ai' | 'ai_backup',
    latencyMs: number,
    success: boolean,
    confidence: number,
    otp?: string,
    pattern?: string,
    error?: string
  ): void {
    if (!this.trackingEnabled) {
      return;
    }

    const metric: OperationMetric = {
      timestamp: Date.now(),
      method,
      latencyMs,
      success,
      confidence,
    };
    if (error) {
      metric.errorType = error;
    }
    if (otp) {
      metric.details = `OTP: ${otp.length} chars, pattern: ${pattern}`;
    }

    this.otpMetrics.push(metric);

    if (this.otpMetrics.length > this.MAX_METRIC_ENTRIES) {
      this.otpMetrics.shift();
    }

    if (otp) {
      this.otpLengths.push(otp.length);
      if (this.otpLengths.length > this.MAX_METRIC_ENTRIES) {
        this.otpLengths.shift();
      }
      // Classify pattern
      if (/^\d+$/.test(otp)) {
        this.otpPatterns.numeric++;
      } else if (/\s/.test(otp)) {
        this.otpPatterns.spaced++;
      } else {
        this.otpPatterns.alphanumeric++;
      }
    }

    this.logMetric('OTPExtraction', method, latencyMs, success, confidence);
  }

  /**
   * Track Activation Link operation
   */
  trackActivationLink(
    method: 'regex' | 'ai' | 'ai_backup',
    latencyMs: number,
    success: boolean,
    confidence: number,
    activated: boolean,
    error?: string
  ): void {
    if (!this.trackingEnabled) {
      return;
    }

    const metric: OperationMetric = {
      timestamp: Date.now(),
      method,
      latencyMs,
      success,
      confidence,
    };
    if (error) {
      metric.errorType = error;
    }
    metric.details = activated ? 'Link activated' : 'Link found but not activated';

    this.linkMetrics.push(metric);

    if (this.linkMetrics.length > this.MAX_METRIC_ENTRIES) {
      this.linkMetrics.shift();
    }

    this.linksFound++;
    if (activated) {
      this.linksActivated++;
    }
    this.linkConfidences.push(confidence);

    if (this.linkConfidences.length > this.MAX_METRIC_ENTRIES) {
      this.linkConfidences.shift();
    }

    this.logMetric('ActivationLink', method, latencyMs, success, confidence);
  }

  /**
   * Track Email Parsing operation
   */
  trackEmailParsing(
    method: 'regex' | 'ai' | 'ai_backup',
    latencyMs: number,
    success: boolean,
    confidence: number,
    result?: { hasOtp: boolean; hasLink: boolean },
    error?: string
  ): void {
    if (!this.trackingEnabled) {
      return;
    }

    const metric: OperationMetric = {
      timestamp: Date.now(),
      method,
      latencyMs,
      success,
      confidence,
    };
    if (error) {
      metric.errorType = error;
    }
    if (result) {
      metric.details = `OTP: ${result.hasOtp}, Link: ${result.hasLink}`;
    }

    this.emailMetrics.push(metric);

    if (this.emailMetrics.length > this.MAX_METRIC_ENTRIES) {
      this.emailMetrics.shift();
    }

    this.emailsProcessed++;
    if (result?.hasOtp) {
      this.emailOtpFound++;
    }
    if (result?.hasLink) {
      this.emailLinksFound++;
    }

    this.logMetric('EmailParsing', method, latencyMs, success, confidence);
  }

  // ========================
  // HELPER METHODS
  // ========================

  private logMetric(
    feature: string,
    method: string,
    latencyMs: number,
    success: boolean,
    confidence: number
  ): void {
    const emoji = success ? '✅' : '❌';
    const methodEmoji = method === 'heuristics' || method === 'regex' ? '⚡' : '🤖';
    log.debug(
      `${emoji} [${feature}] ${methodEmoji} ${method}: ${latencyMs}ms, conf: ${(confidence * 100).toFixed(0)}%`
    );
  }

  private calculateFeatureMetrics(metrics: OperationMetric[]): FeatureMetrics {
    const heuristicsOps = metrics.filter((m) => m.method === 'heuristics' || m.method === 'regex');
    const aiOps = metrics.filter((m) => m.method === 'ai');
    const aiBackupOps = metrics.filter((m) => m.method === 'ai_backup');

    const failures: { [key: string]: number } = {};
    metrics
      .filter((m) => !m.success && m.errorType)
      .forEach((m) => {
        failures[m.errorType!] = (failures[m.errorType!] || 0) + 1;
      });

    return {
      totalOperations: metrics.length,
      heuristicsCount: heuristicsOps.length,
      heuristicsSuccess: heuristicsOps.filter((m) => m.success).length,
      heuristicsAvgLatency:
        heuristicsOps.length > 0
          ? heuristicsOps.reduce((sum, m) => sum + m.latencyMs, 0) / heuristicsOps.length
          : 0,
      aiCount: aiOps.length,
      aiSuccess: aiOps.filter((m) => m.success).length,
      aiAvgLatency:
        aiOps.length > 0 ? aiOps.reduce((sum, m) => sum + m.latencyMs, 0) / aiOps.length : 0,
      aiBackupCount: aiBackupOps.length,
      aiBackupSuccess: aiBackupOps.filter((m) => m.success).length,
      failures: Object.entries(failures).map(([type, count]) => ({ type, count })),
      lastUpdated: Date.now(),
    };
  }

  // ========================
  // REPORT GENERATION
  // ========================

  /**
   * Generate comprehensive performance report
   */
  generateReport(): PerformanceReport {
    const now = Date.now();
    const totalRuntime = now - this.sessionStart;

    const formMetrics = this.calculateFeatureMetrics(this.formMetrics);
    const otpMetrics = this.calculateFeatureMetrics(this.otpMetrics);
    const linkMetrics = this.calculateFeatureMetrics(this.linkMetrics);
    const emailMetrics = this.calculateFeatureMetrics(this.emailMetrics);

    // Calculate summary stats
    const allMetrics = [
      ...this.formMetrics,
      ...this.otpMetrics,
      ...this.linkMetrics,
      ...this.emailMetrics,
    ];
    const heuristicsOps = allMetrics.filter(
      (m) => m.method === 'heuristics' || m.method === 'regex'
    );
    const aiBackupOps = allMetrics.filter((m) => m.method === 'ai_backup');
    const successOps = allMetrics.filter((m) => m.success);

    const heuristicsWinRate =
      allMetrics.length > 0
        ? (heuristicsOps.filter((m) => m.success).length / Math.max(1, heuristicsOps.length)) * 100
        : 0;
    const aiBackupRate = allMetrics.length > 0 ? (aiBackupOps.length / allMetrics.length) * 100 : 0;
    const avgLatencyWithoutAI =
      heuristicsOps.length > 0
        ? heuristicsOps.reduce((sum, m) => sum + m.latencyMs, 0) / heuristicsOps.length
        : 0;
    const avgLatencyWithAI =
      aiBackupOps.length > 0
        ? aiBackupOps.reduce((sum, m) => sum + m.latencyMs, 0) / aiBackupOps.length
        : 0;

    // Generate recommendation
    let recommendation = '';
    if (heuristicsWinRate >= 95) {
      recommendation =
        '🎯 Excellent! Heuristics are handling 95%+ of cases. Consider disabling AI entirely for maximum speed.';
    } else if (heuristicsWinRate >= 80) {
      recommendation =
        '👍 Good performance. Heuristics handle most cases. AI backup is working well for edge cases.';
    } else if (heuristicsWinRate >= 60) {
      recommendation =
        '⚠️ Moderate performance. Consider strengthening heuristics patterns to reduce AI dependency.';
    } else {
      recommendation =
        '❌ Heuristics are struggling. Review and enhance regex patterns. AI is being used too frequently.';
    }

    const latencies = allMetrics.map((m) => m.latencyMs);
    const p95 = this.getPercentile(latencies, 95);
    const p99 = this.getPercentile(latencies, 99);
    const regressionDetected = this.detectRegression(allMetrics).regressed;
    const memory = this.getMemoryUsage();

    const report: PerformanceReport = {
      generatedAt: new Date().toISOString(),
      sessionStart: new Date(this.sessionStart).toISOString(),
      totalRuntime,

      formDetection: {
        ...formMetrics,
        fieldTypes: { ...this.fieldTypeCounts },
      },

      otpExtraction: {
        ...otpMetrics,
        patterns: { ...this.otpPatterns },
        avgOtpLength:
          this.otpLengths.length > 0
            ? this.otpLengths.reduce((a, b) => a + b, 0) / this.otpLengths.length
            : 0,
      },

      activationLinks: {
        ...linkMetrics,
        linksFound: this.linksFound,
        linksActivated: this.linksActivated,
        avgConfidence:
          this.linkConfidences.length > 0
            ? this.linkConfidences.reduce((a, b) => a + b, 0) / this.linkConfidences.length
            : 0,
      },

      emailParsing: {
        ...emailMetrics,
        emailsProcessed: this.emailsProcessed,
        otpFound: this.emailOtpFound,
        linksFound: this.emailLinksFound,
      },

      summary: {
        heuristicsWinRate,
        aiBackupRate,
        avgLatencyWithoutAI,
        avgLatencyWithAI,
        overallSuccessRate:
          allMetrics.length > 0 ? (successOps.length / allMetrics.length) * 100 : 0,
        recommendation,
      },

      percentiles: {
        p95,
        p99,
      },
      regressionDetected,
      memoryWatchdog: memory,
    };

    return report;
  }

  private getPercentile(latencies: number[], percentile: number): number {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] ?? 0;
  }

  private detectRegression(metrics: OperationMetric[]): { regressed: boolean; percentageIncrease: number } {
    if (metrics.length < 20) return { regressed: false, percentageIncrease: 0 };
    const recent = metrics.slice(-5);
    const baseline = metrics.slice(0, -5);
    const recentAvg = recent.reduce((sum, m) => sum + m.latencyMs, 0) / recent.length;
    const baselineAvg = baseline.reduce((sum, m) => sum + m.latencyMs, 0) / baseline.length;
    if (baselineAvg > 0 && recentAvg > baselineAvg * 1.5) {
      return { regressed: true, percentageIncrease: ((recentAvg - baselineAvg) / baselineAvg) * 100 };
    }
    return { regressed: false, percentageIncrease: 0 };
  }

  private getMemoryUsage(): { limitBytes: number; heapBytes: number; percentage: number } {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      return {
        limitBytes: mem.jsHeapSizeLimit,
        heapBytes: mem.usedJSHeapSize,
        percentage: (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100,
      };
    }
    return { limitBytes: 0, heapBytes: 0, percentage: 0 };
  }

  /**
   * Save report to storage for later retrieval
   */
  async saveReport(): Promise<void> {
    const report = this.generateReport();
    try {
      await storageService.set('performanceReport', report);
      log.info('Performance report saved to storage');
    } catch (error) {
      log.warn('Failed to save performance report', error);
    }
  }

  /**
   * Reset all metrics (for new session)
   */
  reset(): void {
    this.sessionStart = Date.now();
    this.formMetrics = [];
    this.otpMetrics = [];
    this.linkMetrics = [];
    this.emailMetrics = [];
    this.fieldTypeCounts = { email: 0, password: 0, name: 0, phone: 0, other: 0 };
    this.otpPatterns = { numeric: 0, alphanumeric: 0, spaced: 0 };
    this.otpLengths = [];
    this.linksFound = 0;
    this.linksActivated = 0;
    this.linkConfidences = [];
    this.emailsProcessed = 0;
    this.emailOtpFound = 0;
    this.emailLinksFound = 0;
    log.info('Performance metrics reset');
  }
}

// Export singleton
export const performanceService = new PerformanceService();

// =========================================================================
// Centralized Performance & Memory Monitoring (Consolidated from monitoring.ts)
// =========================================================================

// Local Metric type to avoid web-vitals type issues
export interface LocalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  entries: PerformanceEntry[];
  delta?: number;
  id?: string;
  navigationType?: string;
}

// Type aliases for performance entry types
type LayoutShiftEntry = PerformanceEntry & { hadRecentInput: boolean; value: number };
type LongTaskEntry = PerformanceEntry & { duration: number };

// Performance budgets - thresholds for alerts
export const PERFORMANCE_BUDGETS = {
  // Core Web Vitals
  LCP: 2500, // ms
  FID: 100, // ms
  CLS: 0.1, // score
  INP: 200, // ms

  // Extension-specific
  POPUP_LOAD: 500, // ms
  EMAIL_GENERATION: 100, // ms
  PASSWORD_GENERATION: 50, // ms
  OTP_DETECTION: 200, // ms

  // Resource budgets
  BUNDLE_SIZE: 2 * 1024 * 1024, // 2MB
  MEMORY_USAGE: 50 * 1024 * 1024, // 50MB
  CPU_USAGE: 5, // percent
} as const;

// Metric types to track
export type MetricType = keyof typeof PERFORMANCE_BUDGETS;

/**
 * Performance Observer for monitoring
 */
class PerformanceMonitor {
  private metrics: Map<string, LocalMetric[]> = new Map();
  private observers: PerformanceObserver[] = [];
  private reportCallback?: (metric: LocalMetric) => void;

  constructor(reportCallback?: (metric: LocalMetric) => void) {
    if (reportCallback) {
      this.reportCallback = reportCallback;
    }
  }

  /**
   * Initialize all performance observers
   */
  init(): void {
    const isPage = typeof window !== 'undefined' && typeof document !== 'undefined';
    const isExtensionPage =
      isPage && typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

    if (isExtensionPage) {
      this.observeLCP();
      this.observeFID();
      this.observeCLS();
      this.observeINP();
      this.observeLongTasks();
      this.observeResourceTiming();
    }
    if (!isPage) {
      this.observeResourceTiming();
    }
  }

  private observeLCP(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (!lastEntry) return;

      const metric: LocalMetric = {
        name: 'LCP',
        value: lastEntry.startTime,
        rating: this.getRating('LCP', lastEntry.startTime),
        entries: [lastEntry],
      };

      this.recordMetric('LCP', metric);
    });

    try {
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('LCP observer not supported');
    }
  }

  private observeFID(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      entries.forEach((entry) => {
        if (entry.entryType === 'first-input') {
          const fidEntry = entry as PerformanceEventTiming;
          const metric: LocalMetric = {
            name: 'FID',
            value: fidEntry.processingStart - fidEntry.startTime,
            rating: this.getRating('FID', fidEntry.processingStart - fidEntry.startTime),
            entries: [entry],
          };
          this.recordMetric('FID', metric);
        }
      });
    });

    try {
      observer.observe({ type: 'first-input', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('FID observer not supported');
    }
  }

  private observeCLS(): void {
    let clsValue = 0;
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as LayoutShiftEntry[];
      entries.forEach((entry) => {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      });

      const metric: LocalMetric = {
        name: 'CLS',
        value: clsValue,
        rating: this.getRating('CLS', clsValue),
        entries: entries as unknown as PerformanceEntry[],
      };
      this.recordMetric('CLS', metric);
    });

    try {
      observer.observe({ type: 'layout-shift', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('CLS observer not supported');
    }
  }

  private observeINP(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      let longestInteraction = 0;
      entries.forEach((entry) => {
        const duration = entry.duration;
        if (duration > longestInteraction) {
          longestInteraction = duration;
        }
      });

      const metric: LocalMetric = {
        name: 'INP',
        value: longestInteraction,
        rating: this.getRating('INP', longestInteraction),
        entries: entries as unknown as PerformanceEntry[],
      };
      this.recordMetric('INP', metric);
    });

    try {
      observer.observe({ type: 'event', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('INP observer not supported');
    }
  }

  private observeLongTasks(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as LongTaskEntry[];
      entries.forEach((entry) => {
        const metric: LocalMetric = {
          name: 'LongTask',
          value: entry.duration,
          rating:
            entry.duration > 500 ? 'poor' : entry.duration > 200 ? 'needs-improvement' : 'good',
          entries: [entry as unknown as PerformanceEntry],
        };
        this.recordMetric('LongTask', metric);
        if (entry.duration > 500 && (typeof chrome === 'undefined' || !!chrome.runtime?.id)) {
          this.reportLongTask(entry as unknown as PerformanceEntry);
        }
      });
    });

    try {
      observer.observe({ type: 'longtask', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('LongTask observer not supported');
    }
  }

  private static POLLING_ENDPOINTS: readonly string[] = [
    'api.mail.gw/messages',
    'api.guerrillamail',
    'tempmail',
    'mercure.mail.tm',
    'well-known/mercure',
  ];

  private observeResourceTiming(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as PerformanceResourceTiming[];
      entries.forEach((entry) => {
        const isPolling = PerformanceMonitor.POLLING_ENDPOINTS.some((endpoint) =>
          entry.name.includes(endpoint)
        );
        if (!isPolling && entry.duration > 5000) {
          this.reportSlowResource(entry);
        }
      });
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
      this.observers.push(observer);
    } catch {
      log.warn('Resource observer not supported');
    }
  }

  private recordMetric(name: string, metric: LocalMetric): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(metric);
    const metrics = this.metrics.get(name)!;
    if (metrics.length > 100) {
      metrics.shift();
    }
    if (this.reportCallback && (typeof chrome === 'undefined' || !!chrome.runtime?.id)) {
      this.reportCallback(metric);
    }
  }

  private getRating(metric: MetricType, value: number): 'good' | 'needs-improvement' | 'poor' {
    const budget = PERFORMANCE_BUDGETS[metric];
    if (value <= budget * 0.8) return 'good';
    if (value <= budget) return 'needs-improvement';
    return 'poor';
  }

  private reportLongTask(entry: PerformanceEntry): void {
    log.warn(
      'Long task detected',
      JSON.stringify({
        name: entry.name,
        duration: entry.duration,
        startTime: entry.startTime,
      })
    );
  }

  private reportSlowResource(entry: PerformanceResourceTiming): void {
    log.warn(
      'Slow resource detected',
      JSON.stringify({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
      })
    );
  }

  getMetrics(): Map<string, LocalMetric[]> {
    return new Map(this.metrics);
  }

  getAverage(name: string): number | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) return null;
    const sum = metrics.reduce((acc, m) => acc + m.value, 0);
    return sum / metrics.length;
  }

  destroy(): void {
    this.observers.forEach((observer) => {
      try {
        observer.disconnect();
      } catch {
        // ignore
      }
    });
    this.observers = [];
    this.metrics.clear();
  }
}

export interface MemoryUsage {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export type MemoryTrend = 'increasing' | 'decreasing' | 'stable';

export class MemoryMonitor {
  private snapshots: MemoryUsage[] = [];
  private timeoutId?: number;

  start(intervalMs: number = 10000): void {
    const tick = () => {
      this.takeSnapshot();
      this.timeoutId = globalThis.setTimeout(tick, intervalMs) as unknown as number;
    };
    this.stop();
    this.timeoutId = globalThis.setTimeout(tick, intervalMs) as unknown as number;
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      delete this.timeoutId;
    }
  }

  private takeSnapshot(): void {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const memory = (performance as any).memory;
      const snapshot: MemoryUsage = {
        timestamp: Date.now(),
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      };
      this.snapshots.push(snapshot);
      if (this.snapshots.length > 100) {
        this.snapshots.shift();
      }
      this.checkForLeaks();
    }
  }

  private checkForLeaks(): void {
    if (this.snapshots.length < 10) return;
    const recent = this.snapshots.slice(-10);
    const first = recent[0]!.usedJSHeapSize;
    const last = recent[recent.length - 1]!.usedJSHeapSize;
    const increase = first > 0 ? (last - first) / first : 0;
    if (increase > 0.2) {
      log.warn(
        'Potential memory leak detected',
        JSON.stringify({
          increase: `${(increase * 100).toFixed(2)}%`,
          from: first,
          to: last,
        })
      );
    }
  }

  getTrend(): MemoryTrend {
    if (this.snapshots.length < 2) return 'stable';
    const first = this.snapshots[0]!.usedJSHeapSize;
    const last = this.snapshots[this.snapshots.length - 1]!.usedJSHeapSize;
    const change = (last - first) / first;
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  getSnapshots(): MemoryUsage[] {
    return [...this.snapshots];
  }
}

export interface TrackedError {
  type: string;
  message: string;
  filename?: string | undefined;
  lineno?: number | undefined;
  colno?: number | undefined;
  stack?: string | undefined;
  timestamp: number;
}

export class ErrorTracker {
  private errors: TrackedError[] = [];
  private maxErrors = 100;

  init(): void {
    const globalContext =
      typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null;

    if (globalContext) {
      globalContext.addEventListener('error', (event: Event) => {
        const errorEvent = event as ErrorEvent;
        this.trackError({
          type: 'uncaught',
          message: this.sanitizeMessage(errorEvent.message || 'Unknown error'),
          filename: errorEvent.filename,
          lineno: errorEvent.lineno,
          colno: errorEvent.colno,
          stack: errorEvent.error?.stack,
          timestamp: Date.now(),
        });
      });

      globalContext.addEventListener('unhandledrejection', (event: Event) => {
        const rejectionEvent = event as PromiseRejectionEvent;
        const reason = rejectionEvent.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack : undefined;
        this.trackError({
          type: 'unhandledrejection',
          message: this.sanitizeMessage(message),
          stack: stack ? this.sanitizeMessage(stack) : undefined,
          timestamp: Date.now(),
        });
      });
    }
  }

  trackError(error: TrackedError): void {
    const sanitizedError = this.sanitizeError(error);
    this.errors.push(sanitizedError);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }
    if (this.isCritical(error)) {
      this.reportCriticalError(sanitizedError);
    }
  }

  private sanitizeMessage(message: string): string {
    message = message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]');
    message = message.replace(/[a-zA-Z0-9]{32,}/g, '[TOKEN]');
    message = message.replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]');
    return message;
  }

  private sanitizeError(error: TrackedError): TrackedError {
    const result: TrackedError = {
      ...error,
      message: this.sanitizeMessage(error.message),
    };
    if (error.stack) {
      result.stack = this.sanitizeMessage(error.stack);
    }
    return result;
  }

  private isCritical(error: TrackedError): boolean {
    const criticalPatterns = [
      /security/i,
      /authentication/i,
      /authorization/i,
      /permission/i,
      /unauthorized/i,
      /forbidden/i,
    ];
    return criticalPatterns.some((pattern) => pattern.test(error.message));
  }

  private reportCriticalError(error: TrackedError): void {
    log.error('Critical error tracked', error);
  }

  getErrors(): TrackedError[] {
    return [...this.errors];
  }

  getErrorSummary(): Record<string, number> {
    return this.errors.reduce(
      (acc, error) => {
        acc[error.type] = (acc[error.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }
}

export const performanceMonitor = new PerformanceMonitor();
export const memoryMonitor = new MemoryMonitor();
export const errorTracker = new ErrorTracker();

