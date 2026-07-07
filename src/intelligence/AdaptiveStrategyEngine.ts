import { storageService } from '../services/storageService';
import { FieldType } from '../types/form.types';

export interface StrategyStats {
  attempts: number;
  successes: number;
  avgLatency: number;
  lastUsed: number;
}

export class AdaptiveStrategyEngine {
  private successRates: Map<string, Map<string, StrategyStats>> = new Map();
  private explorationRate = 0.1;
  private readonly STORAGE_KEY = 'adaptive_strategy_stats';
  private initialized = false;

  constructor(explorationRate = 0.1) {
    this.explorationRate = explorationRate;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await storageService.get(this.STORAGE_KEY as any);
      if (stored && typeof stored === 'object') {
        const rawStats = stored as Record<string, Record<string, StrategyStats>>;
        for (const [site, strategies] of Object.entries(rawStats)) {
          const innerMap = new Map<string, StrategyStats>();
          for (const [strategy, stats] of Object.entries(strategies)) {
            innerMap.set(strategy, stats);
          }
          this.successRates.set(site, innerMap);
        }
      }
    } catch (e) {
      // safe fallback
    }
    this.initialized = true;
  }

  async recordOutcome(
    site: string,
    strategy: string,
    fieldType: FieldType,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    await this.init();

    let siteMap = this.successRates.get(site);
    if (!siteMap) {
      siteMap = new Map();
      this.successRates.set(site, siteMap);
    }

    let stats = siteMap.get(strategy);
    if (!stats) {
      stats = { attempts: 0, successes: 0, avgLatency: 0, lastUsed: 0 };
    }

    stats.attempts++;
    if (success) stats.successes++;
    stats.lastUsed = Date.now();

    // Exponentially weighted moving average for latency
    stats.avgLatency = stats.avgLatency === 0 ? latencyMs : stats.avgLatency * 0.9 + latencyMs * 0.1;

    siteMap.set(strategy, stats);
    await this.persist();
  }

  getOptimalStrategyOrder<T extends { name: string }>(
    site: string,
    strategies: T[]
  ): T[] {
    const siteMap = this.successRates.get(site);

    const scored = strategies.map((strategy) => {
      const stats = siteMap?.get(strategy.name);
      let score = 0.5; // default score for unseen strategy

      if (stats && stats.attempts > 0) {
        const successRate = stats.successes / stats.attempts;
        // Exploration bonus for strategy with low attempts
        const explorationBonus = stats.attempts < 5 ? this.explorationRate : 0;
        // Latency penalty (small subtraction for slow strategies)
        const latencyPenalty = Math.min(stats.avgLatency / 5000, 0.2);

        score = successRate + explorationBonus - latencyPenalty;
      } else {
        // High priority exploration bonus for completely unseen strategies
        score += this.explorationRate;
      }

      return { strategy, score };
    });

    // Sort descending by score
    return scored.sort((a, b) => b.score - a.score).map((x) => x.strategy);
  }

  private async persist(): Promise<void> {
    try {
      const plainObj: Record<string, Record<string, StrategyStats>> = {};
      for (const [site, strategies] of this.successRates.entries()) {
        plainObj[site] = {};
        for (const [strategy, stats] of strategies.entries()) {
          plainObj[site][strategy] = stats;
        }
      }
      await storageService.set(this.STORAGE_KEY as any, plainObj);
    } catch (e) {
      // safe fallback
    }
  }
}
