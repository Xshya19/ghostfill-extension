// Performance Analytics Service
// Internal tracking for developer analysis - NOT shown to users
// Tracks: AI vs Heuristics performance, latency, success rates, failures

import { createLogger } from '../utils/logger';

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
    };

    return report;
  }

  /**
   * Save report to storage for later retrieval
   */
  async saveReport(): Promise<void> {
    const report = this.generateReport();
    try {
      await chrome.storage.local.set({ performanceReport: report });
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
