/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ML SERVICE V2 — The Grandmaster Inference Engine            ║
 * ║  Loads and runs the 128-dim Residual-Attention ONNX model.     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import * as ort from 'onnxruntime-web';
import { FIELD_CLASSES } from '../../content/extractor';
import { createLogger } from '../../utils/logger';
import { safeSendMessage } from '../../utils/messaging';
import { FeatureExtractorV2 } from './FeatureExtractorV2';

const log = createLogger('MLService');

export class MLService {
  private static session: ort.InferenceSession | null = null;
  private static initPromise: Promise<void> | null = null;
  private static unavailable = false;
  private static extractor = new FeatureExtractorV2();

  static canUseRuntime(): boolean {
    return typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function';
  }

  static isReady(): boolean {
    return this.session !== null;
  }

  static isUnavailable(): boolean {
    return this.unavailable;
  }

  /**
   * Initialize the ONNX session with the Grandmaster V2 model.
   */
  static async initialize(): Promise<void> {
    if (this.session || this.unavailable) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        if (!this.canUseRuntime()) {
          this.unavailable = true;
          return;
        }

        ort.env.wasm.wasmPaths = {
          mjs: chrome.runtime.getURL('ort-wasm-simd-threaded.mjs'),
          wasm: chrome.runtime.getURL('ort-wasm-simd-threaded.wasm'),
        };
        ort.env.wasm.numThreads = 1;

        const modelUrl = chrome.runtime.getURL('models/sentinel_brain_v2.onnx');
        const dataUrl = chrome.runtime.getURL('models/sentinel_brain_v2.onnx.data');

        const [modelResp, dataResp] = await Promise.all([fetch(modelUrl), fetch(dataUrl)]);

        if (!modelResp.ok || !dataResp.ok) {
          throw new Error(
            `Failed to fetch model files: Model=${modelResp.status}, Data=${dataResp.status}`
          );
        }

        const [modelBuffer, dataBuffer] = await Promise.all([
          modelResp.arrayBuffer(),
          dataResp.arrayBuffer(),
        ]);

        this.session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
          externalData: [
            {
              path: 'sentinel_brain_v2.onnx.data',
              data: new Uint8Array(dataBuffer),
            },
          ],
        });

        log.info('ML Service initialized successfully with ONNX model');
      } catch (e) {
        this.unavailable = true;
        console.debug('GhostFill: ML V2 unavailable, falling back to heuristics.', e);
      } finally {
        this.initPromise = null;
      }
    })();

    await this.initPromise;
  }

  /**
   * Classify a DOM element using the 128-dim neural engine.
   */
  static async predict(features: Float32Array): Promise<{ type: string; confidence: number }> {
    // 1. Local Inference (if ready)
    if (this.session) {
      try {
        const tensor = new ort.Tensor('float32', features, [1, 128]);
        const results = await this.session.run({ input: tensor });

        // Fix: Detect tensor name dynamically to match different model versions
        const outputTensor = results.output || results.logits || Object.values(results)[0];
        if (!outputTensor) {
          throw new Error('No output tensor found in results');
        }

        const output = outputTensor.data as Float32Array;
        const probabilities = this.softmax(output);

        let maxIdx = 0;
        for (let i = 1; i < probabilities.length; i++) {
          if (probabilities[i]! > probabilities[maxIdx]!) {
            maxIdx = i;
          }
        }

        // Dispose of the input tensor
        tensor.dispose();

        return { type: FIELD_CLASSES[maxIdx]!, confidence: probabilities[maxIdx]! };
      } catch (e) {
        console.error('GhostFill: Local inference failed', e);
      }
    }

    // 2. Offscreen Proxy (fallback for content scripts)
    if (this.canUseRuntime()) {
      try {
        const response: any = await safeSendMessage({
          action: 'CLASSIFY_FIELD',
          payload: {
            features: { structural: Array.from(features) } as any,
            context: {
              isVerificationPage: false,
              isLoginPage: false,
              isSignupPage: false,
              isPasswordResetPage: false,
              is2FAPage: false,
              framework: 'unknown',
              hasOTPLanguage: false,
              expectedOTPLength: null,
              provider: null,
              pageSignals: [],
            },
          },
        });

        if (response?.success && response.prediction) {
          return {
            type: response.prediction.label,
            confidence: response.prediction.confidence,
          };
        }
      } catch (e) {
        log.warn('GhostFill: Offscreen inference proxy failed', e);
      }
    }

    return { type: 'unknown', confidence: 0 };
  }

  private static softmax(logits: Float32Array): Float32Array {
    let maxLogit = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i]! > maxLogit) {
        maxLogit = logits[i]!;
      }
    }

    const exps = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i]! - maxLogit);
      sum += exps[i]!;
    }

    const results = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      results[i] = exps[i]! / sum;
    }
    return results;
  }
}
