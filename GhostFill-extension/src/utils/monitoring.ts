/**
 * Performance Monitoring Configuration
 *
 * Privacy-respecting performance monitoring for GhostFill
 * No PII collected, all data anonymized
 */

// Local Metric type to avoid web-vitals type issues
interface LocalMetric {
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
    this.reportCallback = reportCallback;
  }

  /**
   * Initialize all performance observers
   */
  init(): void {
    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeINP();
    this.observeLongTasks();
    this.observeResourceTiming();
  }

  /**
   * Observe Largest Contentful Paint
   */
  private observeLCP(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];

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
      console.warn('LCP observer not supported');
    }
  }

  /**
   * Observe First Input Delay
   */
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
      console.warn('FID observer not supported');
    }
  }

  /**
   * Observe Cumulative Layout Shift
   */
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
      console.warn('CLS observer not supported');
    }
  }

  /**
   * Observe Interaction to Next Paint
   */
  private observeINP(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();

      // Get the longest interaction
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
      console.warn('INP observer not supported');
    }
  }

  /**
   * Observe long tasks (> 50ms)
   */
  private observeLongTasks(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as LongTaskEntry[];

      entries.forEach((entry) => {
        const metric: LocalMetric = {
          name: 'LongTask',
          value: entry.duration,
          rating: entry.duration > 500 ? 'poor' : entry.duration > 200 ? 'needs-improvement' : 'good',
          entries: [entry as unknown as PerformanceEntry],
        };

        this.recordMetric('LongTask', metric);

        // Alert on very long tasks
        if (entry.duration > 500) {
          this.reportLongTask(entry as unknown as PerformanceEntry);
        }
      });
    });

    try {
      observer.observe({ type: 'longtask', buffered: true });
      this.observers.push(observer);
    } catch {
      console.warn('LongTask observer not supported');
    }
  }

  /**
   * Observe resource timing for network performance
   */
  private observeResourceTiming(): void {
    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as PerformanceResourceTiming[];

      entries.forEach((entry) => {
        // Track slow resources
        if (entry.duration > 1000) {
          this.reportSlowResource(entry);
        }
      });
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
      this.observers.push(observer);
    } catch {
      console.warn('Resource observer not supported');
    }
  }

  /**
   * Record metric internally
   */
  private recordMetric(name: string, metric: LocalMetric): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(metric);

    // Keep only last 100 metrics per type
    const metrics = this.metrics.get(name)!;
    if (metrics.length > 100) {
      metrics.shift();
    }

    // Report to callback
    if (this.reportCallback) {
      this.reportCallback(metric);
    }
  }

  /**
   * Get rating based on threshold
   */
  private getRating(metric: MetricType, value: number): 'good' | 'needs-improvement' | 'poor' {
    const budget = PERFORMANCE_BUDGETS[metric];
    if (value <= budget * 0.8) { return 'good'; }
    if (value <= budget) { return 'needs-improvement'; }
    return 'poor';
  }

  /**
   * Report long task for investigation
   */
  private reportLongTask(entry: PerformanceEntry): void {
    // In production, send to monitoring service
    console.warn('Long task detected:', {
      name: entry.name,
      duration: entry.duration,
      startTime: entry.startTime,
    });
  }

  /**
   * Report slow resource for investigation
   */
  private reportSlowResource(entry: PerformanceResourceTiming): void {
    console.warn('Slow resource detected:', {
      name: entry.name,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    });
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): Map<string, LocalMetric[]> {
    return new Map(this.metrics);
  }

  /**
   * Get average for a metric type
   */
  getAverage(name: string): number | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) { return null; }

    const sum = metrics.reduce((acc, m) => acc + m.value, 0);
    return sum / metrics.length;
  }

  /**
   * Clean up observers
   */
  destroy(): void {
    this.observers.forEach((observer) => {
      try {
        observer.disconnect();
      } catch {
        // Ignore
      }
    });
    this.observers = [];
    this.metrics.clear();
  }
}

/**
 * Memory monitoring utilities
 */
export class MemoryMonitor {
  private snapshots: MemoryUsage[] = [];
  private intervalId?: number;

  /**
   * Start memory monitoring
   */
  start(intervalMs: number = 10000): void {
    // FIX: use globalThis to avoid window undefined errors in Service Worker
    this.intervalId = globalThis.setInterval(() => {
      this.takeSnapshot();
    }, intervalMs) as unknown as number;
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Take memory snapshot
   */
  private takeSnapshot(): void {
    // @ts-expect-error - performance.memory is Chrome-specific
    if (typeof performance !== 'undefined' && performance.memory) {
      // @ts-expect-error - memory property is Chrome-specific
      const memory = performance.memory;
      const snapshot: MemoryUsage = {
        timestamp: Date.now(),
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      };

      this.snapshots.push(snapshot);

      // Keep only last 100 snapshots
      if (this.snapshots.length > 100) {
        this.snapshots.shift();
      }

      // Check for memory leak indicators
      this.checkForLeaks();
    }
  }

  /**
   * Check for memory leak indicators
   */
  private checkForLeaks(): void {
    if (this.snapshots.length < 10) { return; }

    const recent = this.snapshots.slice(-10);
    const first = recent[0].usedJSHeapSize;
    const last = recent[recent.length - 1].usedJSHeapSize;

    // If memory increased by more than 20% in last 10 snapshots
    const increase = (last - first) / first;
    if (increase > 0.2) {
      console.warn('Potential memory leak detected:', {
        increase: `${(increase * 100).toFixed(2)}%`,
        from: first,
        to: last,
      });
    }
  }

  /**
   * Get memory usage trend
   */
  getTrend(): MemoryTrend {
    if (this.snapshots.length < 2) { return 'stable'; }

    const first = this.snapshots[0].usedJSHeapSize;
    const last = this.snapshots[this.snapshots.length - 1].usedJSHeapSize;
    const change = (last - first) / first;

    if (change > 0.1) { return 'increasing'; }
    if (change < -0.1) { return 'decreasing'; }
    return 'stable';
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): MemoryUsage[] {
    return [...this.snapshots];
  }
}

interface MemoryUsage {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

type MemoryTrend = 'increasing' | 'decreasing' | 'stable';

/**
 * Error tracking with privacy protection
 */
export class ErrorTracker {
  private errors: TrackedError[] = [];
  private maxErrors = 100;

  /**
   * Initialize error tracking
   */
  init(): void {
    // FIX: Handle both window (popup/content) and self (service worker) environments
    const globalContext = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);

    if (globalContext) {
      globalContext.addEventListener('error', (event: any) => {
        this.trackError({
          type: 'uncaught',
          message: this.sanitizeMessage(event.message || 'Unknown error'),
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack,
          timestamp: Date.now(),
        });
      });

      globalContext.addEventListener('unhandledrejection', (event: any) => {
        this.trackError({
          type: 'unhandledrejection',
          message: this.sanitizeMessage(String(event.reason)),
          timestamp: Date.now(),
        });
      });
    }
  }

  /**
   * Track error
   */
  trackError(error: TrackedError): void {
    // Sanitize error to remove PII
    const sanitizedError = this.sanitizeError(error);

    this.errors.push(sanitizedError);

    // Keep only last N errors
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Alert on critical errors
    if (this.isCritical(error)) {
      this.reportCriticalError(sanitizedError);
    }
  }

  /**
   * Sanitize error message to remove PII
   */
  private sanitizeMessage(message: string): string {
    // Remove potential emails
    message = message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]');
    // Remove potential tokens
    message = message.replace(/[a-zA-Z0-9]{32,}/g, '[TOKEN]');
    // Remove potential passwords
    message = message.replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]');
    return message;
  }

  /**
   * Sanitize entire error object
   */
  private sanitizeError(error: TrackedError): TrackedError {
    return {
      ...error,
      message: this.sanitizeMessage(error.message),
      stack: error.stack ? this.sanitizeMessage(error.stack) : undefined,
    };
  }

  /**
   * Check if error is critical
   */
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

  /**
   * Report critical error
   */
  private reportCriticalError(error: TrackedError): void {
    // In production, send to error tracking service
    console.error('Critical error:', error);
  }

  /**
   * Get all tracked errors
   */
  getErrors(): TrackedError[] {
    return [...this.errors];
  }

  /**
   * Get error count by type
   */
  getErrorSummary(): Record<string, number> {
    return this.errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
}

interface TrackedError {
  type: string;
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  timestamp: number;
}

// Export singleton instances
export const performanceMonitor = new PerformanceMonitor();
export const memoryMonitor = new MemoryMonitor();
export const errorTracker = new ErrorTracker();
