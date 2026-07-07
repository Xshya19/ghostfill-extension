import { TelemetryCollector } from './TelemetryCollector';

export interface DiagnosticsReport {
  successRate: number;
  totalFills: number;
  avgLatencyMs: number;
  mostSuccessfulStrategy: string;
  status: 'healthy' | 'degraded';
  recommendations: string[];
}

export class SelfDiagnostics {
  private telemetry: TelemetryCollector;

  constructor(telemetry = new TelemetryCollector()) {
    this.telemetry = telemetry;
  }

  async run(): Promise<DiagnosticsReport> {
    const events = await this.telemetry.getEvents();
    const fillEvents = events.filter((e) => e.action === 'fill' || e.action === 'verify');

    if (fillEvents.length === 0) {
      return {
        successRate: 100,
        totalFills: 0,
        avgLatencyMs: 0,
        mostSuccessfulStrategy: 'none',
        status: 'healthy',
        recommendations: ['No fill outcomes recorded yet. Interact with forms to populate statistics.'],
      };
    }

    const successes = fillEvents.filter((e) => e.outcome === 'success').length;
    const successRate = Math.round((successes / fillEvents.length) * 100);
    const avgLatencyMs = Math.round(fillEvents.reduce((sum, e) => sum + e.latencyMs, 0) / fillEvents.length);

    // Compute most successful strategy
    const strategyCounts = new Map<string, number>();
    for (const e of fillEvents) {
      if (e.outcome === 'success' && e.strategy) {
        strategyCounts.set(e.strategy, (strategyCounts.get(e.strategy) || 0) + 1);
      }
    }

    let mostSuccessfulStrategy = 'none';
    let maxCount = 0;
    for (const [strategy, count] of strategyCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostSuccessfulStrategy = strategy;
      }
    }

    const recommendations: string[] = [];
    if (successRate < 90) {
      recommendations.push(
        'Fill success rate is below 90%. Consider checking page custom fields or reporting the site framework.'
      );
    }
    if (avgLatencyMs > 1000) {
      recommendations.push(
        'Average fill latency is high. Consider using less heavy typing simulation delays.'
      );
    }

    return {
      successRate,
      totalFills: fillEvents.length,
      avgLatencyMs,
      mostSuccessfulStrategy,
      status: successRate >= 80 ? 'healthy' : 'degraded',
      recommendations,
    };
  }
}
