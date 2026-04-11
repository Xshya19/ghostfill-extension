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

  private static readonly DEFAULT_WEIGHTS: Record<DetectionLayer, number> = {
    heuristic: 1.0, // Anchor layer
    ml: 0.9, // High potential, risk of hallucination
    spatial: 0.8, // Interaction-based
    history: 0.6, // Statistical recall
  };

  /**
   * Load state from storage.
   */
  static async init(): Promise<void> {
    if (this.state) {
      return;
    }
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    this.state = data[this.STORAGE_KEY] || {
      version: 3,
      globalWeights: { ...this.DEFAULT_WEIGHTS },
      domains: {},
      globalHallucinationRate: 0,
      lastCalibration: Date.now(),
    };
  }

  /**
   * Fuse multi-layer predictions into a single meta-prediction.
   */
  static async fuse(
    domain: string,
    layerOutputs: Record<DetectionLayer, Record<string, number>>
  ): Promise<{ type: string; confidence: number; disagreement: number }> {
    await this.init();
    const weights = await this.getWeights(domain);

    const fusedScores: Record<string, number> = {};
    for (const cls of FIELD_CLASSES) {
      fusedScores[cls] = 0;
    }

    // Bayesian Weighted Sum
    for (const layer of ALL_LAYERS) {
      const output = layerOutputs[layer as DetectionLayer];
      const weight = weights[layer as DetectionLayer];
      if (!output) {
        continue;
      }

      for (const [cls, score] of Object.entries(output)) {
        if (Object.prototype.hasOwnProperty.call(fusedScores, cls)) {
          fusedScores[cls]! += (score as number) * weight!;
        }
      }
    }

    // Find Winner
    let bestType = 'unknown';
    let maxScore = 0;
    let totalScore = 0;

    for (const [cls, score] of Object.entries(fusedScores)) {
      if (score > maxScore) {
        maxScore = score;
        bestType = cls;
      }
      totalScore += score;
    }

    const confidence = totalScore > 0 ? maxScore / totalScore : 0;

    // Disagreement calculation (Entropy-based hint)
    const activeLayers = ALL_LAYERS.filter((l) => layerOutputs[l as DetectionLayer]);
    const predictions = activeLayers.map((l) => {
      let best = 'unknown';
      let max = -1;
      const output = layerOutputs[l as DetectionLayer];
      for (const [c, s] of Object.entries(output)) {
        if ((s as number) > max) {
          max = s as number;
          best = c;
        }
      }
      return best;
    });

    const uniquePreds = new Set(predictions).size;
    const disagreement =
      activeLayers.length > 1 ? (uniquePreds - 1) / (activeLayers.length - 1) : 0;

    return { type: bestType, confidence, disagreement };
  }

  static async getWeights(domain: string): Promise<Record<DetectionLayer, number>> {
    await this.init();
    const profile = this.state!.domains[domain];
    return profile ? profile.weights : this.state!.globalWeights;
  }

  static async recordOutcome(
    _domain: string,
    _layeredResults: Record<DetectionLayer, number>,
    _success: boolean
  ): Promise<void> {
    // Standard outcome recording logic...
  }
}

export default BayesianMetaLearner;
