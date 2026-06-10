/**
 * BAYESIAN META-LEARNER — FIXED
 *
 * Corrections vs. original:
 *  - All layers now speak the SAME canonical FIELD_CLASSES key space, so the
 *    heuristic and spatial layers actually contribute (previously their keys
 *    never matched fusedScores and were silently dropped).
 *  - Adds `normalizeLayer()` to coerce any layer output into the canonical
 *    class space and clamp negatives to 0.
 *  - Confidence is a proper normalized share in [0,1] (no NaN / >1 from
 *    negative totals).
 *  - `recordOutcome()` is implemented: it nudges per-domain layer weights based
 *    on success/failure and persists them, so per-domain adaptation works.
 */

import { FIELD_CLASSES } from '../../content/extractor';
import { MetaLearnerState, DetectionLayer, ALL_LAYERS } from '../../types/sentinel';

export interface LayerPrediction {
  type: string;
  confidence?: number;
  scores?: Record<string, number>;
}

export class BayesianMetaLearner {
  private static readonly STORAGE_KEY = 'SENTINEL_META_LEARNER_STATE';
  private static state: MetaLearnerState | null = null;

  private static readonly LEARNING_RATE = 0.05;
  private static readonly MIN_WEIGHT = 0.1;
  private static readonly MAX_WEIGHT = 2.0;

  private static readonly DEFAULT_WEIGHTS: Record<DetectionLayer, number> = {
    heuristic: 1.0,
    ml: 0.9,
    spatial: 0.8,
    history: 0.6,
  };

  static async init(): Promise<void> {
    if (this.state) {
      return;
    }
    const fresh: MetaLearnerState = {
      version: 3,
      globalWeights: { ...this.DEFAULT_WEIGHTS },
      domains: {},
      globalHallucinationRate: 0,
      lastCalibration: Date.now(),
    };
    if (typeof chrome === 'undefined' || !chrome.storage) {
      this.state = fresh;
      return;
    }
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    this.state = (data[this.STORAGE_KEY] as MetaLearnerState) || fresh;
  }

  /** Coerce a raw layer output to canonical class keys with non-negative scores. */
  private static normalizeLayer(
    output: Record<string, number> | undefined
  ): Record<string, number> {
    const norm: Record<string, number> = {};
    for (const cls of FIELD_CLASSES) {
      norm[cls] = 0;
    }
    if (!output) {
      return norm;
    }
    for (const [rawKey, rawVal] of Object.entries(output)) {
      const cls = this.canonicalize(rawKey);
      if (cls && rawVal > 0) {
        norm[cls] = Math.max(norm[cls]!, rawVal);
      }
    }
    return norm;
  }

  /** Map legacy lowercase FieldType names onto the canonical FIELD_CLASSES. */
  private static canonicalize(key: string): string | null {
    if ((FIELD_CLASSES as readonly string[]).includes(key)) {
      return key;
    }
    const k = key.toLowerCase();
    const alias: Record<string, string> = {
      email: 'Email',
      username: 'Username',
      user: 'Username',
      password: 'Password',
      confirm_password: 'Target_Password_Confirm',
      target_password_confirm: 'Target_Password_Confirm',
      otp: 'OTP',
      otp_digit: 'OTP',
      phone: 'Phone',
      first_name: 'First_Name',
      last_name: 'Last_Name',
      full_name: 'Full_Name',
      unknown: 'Unknown',
    };
    return alias[k] ?? null;
  }

  static async fuse(
    domain: string,
    layerOutputs: Partial<Record<DetectionLayer, Record<string, number>>>
  ): Promise<{ type: string; confidence: number; disagreement: number }> {
    await this.init();
    const weights = await this.getWeights(domain);

    const fusedScores: Record<string, number> = {};
    for (const cls of FIELD_CLASSES) {
      fusedScores[cls] = 0;
    }

    const normalized: Partial<Record<DetectionLayer, Record<string, number>>> = {};
    for (const layer of ALL_LAYERS) {
      const raw = layerOutputs[layer as DetectionLayer];
      if (!raw) {
        continue;
      }
      const norm = this.normalizeLayer(raw);
      normalized[layer as DetectionLayer] = norm;
      const weight = weights[layer as DetectionLayer] ?? 0;
      for (const cls of FIELD_CLASSES) {
        fusedScores[cls]! += norm[cls]! * weight;
      }
    }

    let bestType = 'Unknown';
    let maxScore = 0;
    let totalScore = 0;
    for (const cls of FIELD_CLASSES) {
      const s = fusedScores[cls]!;
      if (s > maxScore) {
        maxScore = s;
        bestType = cls;
      }
      totalScore += s;
    }
    const confidence = totalScore > 0 ? Math.min(1, maxScore / totalScore) : 0;

    // Disagreement: fraction of active layers whose top class differs from consensus.
    const activeLayers = ALL_LAYERS.filter((l) => normalized[l as DetectionLayer]);
    const topPreds = activeLayers.map((l) => {
      const out = normalized[l as DetectionLayer]!;
      let best = 'Unknown';
      let max = -1;
      for (const cls of FIELD_CLASSES) {
        if (out[cls]! > max) {
          max = out[cls]!;
          best = cls;
        }
      }
      return best;
    });
    const uniquePreds = new Set(topPreds).size;
    const disagreement =
      activeLayers.length > 1 ? (uniquePreds - 1) / (activeLayers.length - 1) : 0;

    return { type: bestType, confidence, disagreement };
  }

  static async getWeights(domain: string): Promise<Record<DetectionLayer, number>> {
    await this.init();
    const profile = this.state!.domains[domain];
    return profile ? profile.weights : this.state!.globalWeights;
  }

  /**
   * Update per-domain layer weights from an observed outcome.
   * `layeredCorrect[layer]` = 1 if that layer's top pick matched the confirmed
   * label, 0 otherwise. Correct layers are reinforced, wrong ones decayed.
   */
  static async recordOutcome(
    domain: string,
    layeredCorrect: Partial<Record<DetectionLayer, number>>,
    success: boolean
  ): Promise<void> {
    await this.init();
    const state = this.state!;
    const base = state.domains[domain]?.weights ?? { ...state.globalWeights };
    const updated: Record<DetectionLayer, number> = { ...base };

    for (const layer of ALL_LAYERS) {
      const correct = layeredCorrect[layer as DetectionLayer];
      if (correct === undefined) {
        continue;
      }
      const target = correct >= 1 ? this.MAX_WEIGHT : this.MIN_WEIGHT;
      const w = updated[layer as DetectionLayer] ?? state.globalWeights[layer as DetectionLayer];
      updated[layer as DetectionLayer] = this.clampWeight(w + this.LEARNING_RATE * (target - w));
    }

    state.domains[domain] = {
      ...(state.domains[domain] ?? {}),
      weights: updated,
    } as MetaLearnerState['domains'][string];

    if (!success) {
      state.globalHallucinationRate = Math.min(1, state.globalHallucinationRate * 0.95 + 0.05);
    } else {
      state.globalHallucinationRate *= 0.95;
    }
    state.lastCalibration = Date.now();

    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        await chrome.storage.local.set({ [this.STORAGE_KEY]: state });
      } catch {
        /* non-critical */
      }
    }
  }

  private static clampWeight(w: number): number {
    return Math.max(this.MIN_WEIGHT, Math.min(this.MAX_WEIGHT, w));
  }
}

export default BayesianMetaLearner;
