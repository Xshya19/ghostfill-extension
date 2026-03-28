/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ACTIVE LEARNING CONTROLLER — Continuous Optimization Loop    ║
 * ║  Captures difficult real-world edge cases (disagreements).     ║
 * ║  Prepares data for local or remote model fine-tuning.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { LayerPrediction } from '../meta/BayesianMetaLearner';
import { FieldType } from '../ml/FeatureExtractorV2';

export interface DifficultCase {
  id: string;
  timestamp: number;
  domain: string;
  domSnapshot: string; // Serialized DOM with inline styles
  predictions: LayerPrediction[];
  disagreementScore: number;
  userLabel?: FieldType;
}

export class ActiveLearningController {
  private static readonly DISAGREEMENT_THRESHOLD = 0.7;
  private static capturedCases: DifficultCase[] = [];

  /**
   * Capture a difficult case for analysis (Disagreement conflict).
   */
  public static captureConflict(el: HTMLElement, predictions: any[], disagreement: number): void {
    if (disagreement < this.DISAGREEMENT_THRESHOLD) {return;}
    
    const domain = window.location.hostname;
    const domSnapshot = el.outerHTML;

    const difficultCase: DifficultCase = {
      id: Math.random().toString(36).slice(2, 9),
      timestamp: Date.now(),
      domain,
      domSnapshot,
      predictions: predictions as any,
      disagreementScore: disagreement
    };

    this.capturedCases.push(difficultCase);
    this.saveToStorage();
  }

  private static saveToStorage(): void {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ sentinel_difficult_cases: this.capturedCases });
    }
  }
}
