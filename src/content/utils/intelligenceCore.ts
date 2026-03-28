import { FieldType } from '../../types';

/**
 * Manages domain-specific trusted field selectors (Self-Healing).
 */
export class HistoryManager {
  private static readonly PREFIX = 'gf_trusted_';

  static async getTrustedSelector(domain: string, type: FieldType): Promise<string | null> {
    try {
      const key = `${this.PREFIX}${domain}_${type}`;
      const data = await chrome.storage.local.get(key);
      return data[key] || null;
    } catch {
      return null;
    }
  }

  static async saveTrustedSelector(domain: string, type: FieldType, selector: string): Promise<void> {
    if (!domain || !type || !selector) {return;}
    try {
      const key = `${this.PREFIX}${domain}_${type}`;
      await chrome.storage.local.set({ [key]: selector });
    } catch {
      /* ignore storage errors */
    }
  }
}

/**
 * Unified Scoring Model (Weighted Ensemble).
 */
export class EnsembleScorer {
  static calculate(
    heuristic: number,
    ml: number,
    spatial: number,
    history: number,
    pageContext: { isAuth: boolean; isVerification: boolean }
  ): number {
    // Dynamic Weighting based on page type
    let w_h = 0.4;
    let w_ml = 0.4;
    const w_spatial = 0.15;
    const w_history = 0.05;

    if (pageContext.isVerification || pageContext.isAuth) {
      w_ml = 0.55;
      w_h = 0.25;
    }

    const score = (heuristic * w_h) + (ml * w_ml) + (spatial * w_spatial) + (history * w_history);
    return Math.min(1.0, Math.max(0.0, score));
  }
}
