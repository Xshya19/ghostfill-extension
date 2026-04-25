/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ACTIVE LEARNING CONTROLLER — Continuous Optimization Loop    ║
 * ║  Captures difficult real-world edge cases (disagreements).     ║
 * ║  Prepares data for local or remote model fine-tuning.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { getRandomString } from '../../utils/encryption';
import { LayerPrediction } from '../meta/BayesianMetaLearner';
import { FieldType } from '../ml/FeatureExtractorV2';

export interface DifficultCase {
  id: string;
  timestamp: number;
  domain: string;
  elementSummary: {
    tagName: string;
    type?: string;
    autocomplete?: string;
    inputMode?: string;
    role?: string;
  };
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
    if (disagreement < this.DISAGREEMENT_THRESHOLD) {
      return;
    }

    const domain = window.location.hostname;
    const input = el instanceof HTMLInputElement ? el : null;
    const elementSummary: DifficultCase['elementSummary'] = {
      tagName: el.tagName.toLowerCase(),
    };
    if (input?.type) {
      elementSummary.type = input.type;
    }
    if (input?.autocomplete) {
      elementSummary.autocomplete = input.autocomplete;
    }
    if (input?.inputMode) {
      elementSummary.inputMode = input.inputMode;
    }
    const role = el.getAttribute('role');
    if (role) {
      elementSummary.role = role;
    }

    const difficultCase: DifficultCase = {
      id: getRandomString(7, 'abcdefghijklmnopqrstuvwxyz0123456789'),
      timestamp: Date.now(),
      domain,
      elementSummary,
      predictions: predictions as any,
      disagreementScore: disagreement,
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
