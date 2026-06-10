/**
 * ML SERVICE — FIXED
 *
 * Corrections vs. original:
 *  - Consumes RawFieldFeatures (textChannels + structural), matching both the
 *    extractor and the trained model. (Original sent a single [1,128] tensor
 *    named "input" — incompatible with the two-input model.)
 *  - Feeds text_channels(int64 [1,8,80]) + structural(float32 [1,64]); reads
 *    the `logits` output; maps via the 10 capitalized FIELD_CLASSES.
 *  - predict() returns `null` for "no usable prediction" so callers can tell it
 *    apart from a genuine `Unknown` verdict.
 *  - Offscreen proxy message uses the protocol offscreen.ts actually matches
 *    ({ target:'offscreen-doc', type:'CLASSIFY_FIELD' }) and forwards the full
 *    features (textChannels + structural) plus a real PageContext.
 *  - Standardized model filename `ghostfill_v1_int8.onnx`.
 */

import * as ort from 'onnxruntime-web';
import { FIELD_CLASSES, RawFieldFeatures } from '../../content/extractor';
import { PageContext } from '../../types/form.types';
import { createLogger } from '../../utils/logger';
import { safeSendMessage } from '../../utils/messaging';

const log = createLogger('MLService');

const MODEL_FILE = 'models/ghostfill_v1_int8.onnx';
const NUM_TEXT_CHANNELS = 8;
const MAX_TEXT_LEN = 80;
const NUM_STRUCTURAL = 64;
const INPUT_TEXT = 'text_channels';
const INPUT_STRUCT = 'structural';
const OUTPUT_LOGITS = 'logits';

export interface FieldPrediction {
  type: string;
  confidence: number;
}

export type PredictFeatures = Omit<RawFieldFeatures, 'element'>;

export class MLService {
  private static session: ort.InferenceSession | null = null;
  private static initPromise: Promise<void> | null = null;
  private static unavailable = false;

  static canUseRuntime(): boolean {
    return typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function';
  }

  static isReady(): boolean {
    return this.session !== null;
  }

  static isUnavailable(): boolean {
    return this.unavailable;
  }

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
        ort.env.logLevel = 'error';

        const modelUrl = chrome.runtime.getURL(MODEL_FILE);
        const modelResp = await fetch(modelUrl);
        if (!modelResp.ok) {
          throw new Error(`Failed to fetch model: ${modelResp.status}`);
        }
        const modelBuffer = await modelResp.arrayBuffer();

        this.session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });

        if (
          !this.session.inputNames.includes(INPUT_TEXT) ||
          !this.session.inputNames.includes(INPUT_STRUCT)
        ) {
          const got = this.session.inputNames.join(', ');
          this.session = null;
          throw new Error(`Model input contract mismatch; got [${got}]`);
        }
        log.info('ML Service initialized with two-input model');
      } catch (e) {
        this.unavailable = true;
        console.debug('GhostFill: ML unavailable, falling back to heuristics.', e);
      } finally {
        this.initPromise = null;
      }
    })();

    await this.initPromise;
  }

  private static buildTextTensor(textChannels: ReadonlyArray<ArrayLike<number>>): ort.Tensor {
    const data = new BigInt64Array(NUM_TEXT_CHANNELS * MAX_TEXT_LEN);
    for (let c = 0; c < NUM_TEXT_CHANNELS; c++) {
      const ch = textChannels[c];
      for (let i = 0; i < MAX_TEXT_LEN; i++) {
        const v = ch && i < ch.length ? ch[i]! | 0 : 0;
        data[c * MAX_TEXT_LEN + i] = BigInt(v);
      }
    }
    return new ort.Tensor('int64', data, [1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN]);
  }

  private static buildStructTensor(structural: ArrayLike<number>): ort.Tensor {
    const data = new Float32Array(NUM_STRUCTURAL);
    for (let i = 0; i < NUM_STRUCTURAL; i++) {
      data[i] = structural && i < structural.length ? Number(structural[i]) || 0 : 0;
    }
    return new ort.Tensor('float32', data, [1, NUM_STRUCTURAL]);
  }

  /**
   * Classify a field. Returns null when there is no usable prediction
   * (no session, bad features, or inference error). A real low-confidence
   * verdict is still returned so callers can apply their own threshold.
   */
  static async predict(
    features: PredictFeatures,
    context?: PageContext
  ): Promise<FieldPrediction | null> {
    if (!features?.textChannels || !features?.structural) {
      return null;
    }

    // 1. Local inference (offscreen/background where a session exists)
    if (this.session) {
      let textTensor: ort.Tensor | null = null;
      let structTensor: ort.Tensor | null = null;
      try {
        textTensor = this.buildTextTensor(
          features.textChannels as ReadonlyArray<ArrayLike<number>>
        );
        structTensor = this.buildStructTensor(features.structural as ArrayLike<number>);
        const results = await this.session.run({
          [INPUT_TEXT]: textTensor,
          [INPUT_STRUCT]: structTensor,
        });
        const outputTensor = results[OUTPUT_LOGITS] ?? Object.values(results)[0];
        if (!outputTensor) {
          throw new Error('No output tensor found');
        }
        const probs = this.softmax(outputTensor.data as Float32Array);
        let maxIdx = 0;
        for (let i = 1; i < FIELD_CLASSES.length && i < probs.length; i++) {
          if (probs[i]! > probs[maxIdx]!) {
            maxIdx = i;
          }
        }
        const type = maxIdx < FIELD_CLASSES.length ? FIELD_CLASSES[maxIdx]! : 'Unknown';
        return { type, confidence: probs[maxIdx]! };
      } catch (e) {
        console.error('GhostFill: Local inference failed', e);
        return null;
      } finally {
        textTensor?.dispose();
        structTensor?.dispose();
      }
    }

    // 2. Offscreen proxy (content scripts). Protocol must match offscreen.ts.
    if (this.canUseRuntime()) {
      try {
        // We cast the payload features to `RawFieldFeatures` to satisfy the discriminated-union
        // type. The `element` field is intentionally omitted before serialization; the
        // offscreen receiver uses `Omit<RawFieldFeatures, 'element'>` so this is safe.
        const proxyFeatures: import('../../types/message.types').ClassifyFieldMessage['payload']['features'] =
          {
            textChannels: (features.textChannels as ReadonlyArray<ArrayLike<number>>).map((c) =>
              Array.from(c)
            ) as unknown as import('../../content/extractor').RawFieldFeatures['textChannels'],
            structural: new Float32Array(Array.from(features.structural as ArrayLike<number>)),
            isVisible: features.isVisible ?? true,
            element:
              null as unknown as import('../../content/extractor').RawFieldFeatures['element'],
          };
        // exactOptionalPropertyTypes: use spread to omit 'context' entirely when undefined
        const proxyPayload: import('../../types/message.types').ClassifyFieldMessage['payload'] =
          context ? { features: proxyFeatures, context } : { features: proxyFeatures };
        const rawResponse = await safeSendMessage({
          action: 'CLASSIFY_FIELD',
          payload: proxyPayload,
        });
        const response = rawResponse as
          | import('../../types/message.types').ClassifyFieldResponse
          | null;
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

    return null;
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
    const out = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      out[i] = exps[i]! / sum;
    }
    return out;
  }
}

export default MLService;
