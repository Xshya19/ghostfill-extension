import * as ort from 'onnxruntime-web';
import { FIELD_CLASSES, RawFieldFeatures } from '../content/extractor';
import { PageContext } from '../types/form.types';

/**
 * FIXED inference engine.
 *
 * Key corrections vs. the original:
 *  - Feeds BOTH model inputs with the correct names/shapes/dtypes:
 *      text_channels : int64  [1, 8, 80]  (BigInt64Array — required for int64 in ort-web)
 *      structural    : float32[1, 64]
 *    (The original sent a single tensor named "input" of shape [1,128]; the
 *     exported model has no such input and its structural branch is 64-dim.)
 *  - Reads the pinned output name `logits` (training exports exactly this).
 *  - Standardizes the artifact on the single-file int8 model that training
 *    actually produces (`ghostfill_v1_int8.onnx`) — no `.onnx.data` sidecar.
 *  - Suppresses ORT's image-input warning via logSeverityLevel instead of
 *    monkey-patching console.error.
 */

const mlLog = {
  info: (...a: unknown[]) => console.info('[GhostFill ML]', ...a),
  error: (...a: unknown[]) => console.error('[GhostFill ML]', ...a),
};

const MODEL_FILE = 'models/ghostfill_v1_int8.onnx';

// Model I/O contract (must match train_ghostfill_model.py)
const NUM_TEXT_CHANNELS = 8;
const MAX_TEXT_LEN = 80;
const NUM_STRUCTURAL = 64;
const INPUT_TEXT = 'text_channels';
const INPUT_STRUCT = 'structural';
const OUTPUT_LOGITS = 'logits';

ort.env.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('ort-wasm-simd-threaded.mjs'),
  wasm: chrome.runtime.getURL('ort-wasm-simd-threaded.wasm'),
};
// Enable threads only when the document is cross-origin isolated; otherwise 1.
ort.env.wasm.numThreads =
  typeof self !== 'undefined' &&
  (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
// 0=verbose .. 4=fatal. 3 hides the benign "does not support image input" notice.
ort.env.logLevel = 'error';

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;

const MIN_ML_CONFIDENCE = 0.45;

export interface MLPrediction {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export async function initInferenceEngine(): Promise<void> {
  if (session) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const modelUrl = chrome.runtime.getURL(MODEL_FILE);
      mlLog.info('Initializing engine in offscreen document...', modelUrl);

      const modelResp = await fetch(modelUrl);
      if (!modelResp.ok) {
        throw new Error(`Failed to fetch model: ${modelResp.status}`);
      }
      const modelBuffer = await modelResp.arrayBuffer();

      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      // Fail loudly if the artifact does not match the expected contract.
      if (!session.inputNames.includes(INPUT_TEXT) || !session.inputNames.includes(INPUT_STRUCT)) {
        const got = session.inputNames.join(', ');
        session = null;
        throw new Error(
          `Model input contract mismatch. Expected [${INPUT_TEXT}, ${INPUT_STRUCT}], got [${got}]`
        );
      }
      mlLog.info(
        'Engine initialized. Inputs:',
        session.inputNames,
        'Outputs:',
        session.outputNames
      );
    } catch (error) {
      const err = error as Error;
      mlLog.error('Failed to initialize inference engine:', err.message);
      session = null;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

export async function getEngineStatus(): Promise<{
  initialized: boolean;
  hasSession: boolean;
  modelUrl: string;
}> {
  return {
    initialized: !!session,
    hasSession: !!session,
    modelUrl: chrome.runtime.getURL(MODEL_FILE),
  };
}

/** Build the int64 text tensor [1, 8, 80] from the extractor's 8 char-code channels. */
function buildTextTensor(textChannels: ReadonlyArray<ArrayLike<number>>): ort.Tensor {
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

function buildStructTensor(structural: ArrayLike<number>): ort.Tensor {
  const data = new Float32Array(NUM_STRUCTURAL);
  for (let i = 0; i < NUM_STRUCTURAL; i++) {
    data[i] = structural && i < structural.length ? Number(structural[i]) || 0 : 0;
  }
  return new ort.Tensor('float32', data, [1, NUM_STRUCTURAL]);
}

/**
 * Classify a set of field features extracted by extractor.ts.
 * `features` MUST contain both `textChannels` (8×80) and `structural` (64).
 */
export async function classifyField(
  features: Omit<RawFieldFeatures, 'element'>,
  context?: PageContext
): Promise<MLPrediction | null> {
  if (!session) {
    await initInferenceEngine();
  }
  if (!session) {
    return null;
  }

  if (!features || !features.textChannels || !features.structural) {
    mlLog.error('classifyField called without textChannels/structural');
    return null;
  }

  let textTensor: ort.Tensor | null = null;
  let structTensor: ort.Tensor | null = null;
  try {
    textTensor = buildTextTensor(features.textChannels as ReadonlyArray<ArrayLike<number>>);
    structTensor = buildStructTensor(features.structural as ArrayLike<number>);

    const results = await session.run({
      [INPUT_TEXT]: textTensor,
      [INPUT_STRUCT]: structTensor,
    });

    const outputTensor = results[OUTPUT_LOGITS] ?? Object.values(results)[0];
    if (!outputTensor) {
      throw new Error('No output tensor in session results');
    }
    const logitsData = outputTensor.data;
    if (!(logitsData instanceof Float32Array)) {
      throw new Error(`Unexpected output dtype: ${typeof logitsData}`);
    }
    if (logitsData.length < FIELD_CLASSES.length) {
      throw new Error(
        `Model output dim (${logitsData.length}) < FIELD_CLASSES (${FIELD_CLASSES.length})`
      );
    }

    // Numerically stable softmax
    let maxLogit = -Infinity;
    for (let i = 0; i < FIELD_CLASSES.length; i++) {
      if (logitsData[i]! > maxLogit) {
        maxLogit = logitsData[i]!;
      }
    }
    let sumExp = 0;
    const expScores = new Float32Array(FIELD_CLASSES.length);
    for (let i = 0; i < FIELD_CLASSES.length; i++) {
      expScores[i] = Math.exp(logitsData[i]! - maxLogit);
      sumExp += expScores[i]!;
    }

    const probabilities: Record<string, number> = {};
    let bestIdx = 0;
    let bestConf = 0;
    for (let i = 0; i < FIELD_CLASSES.length; i++) {
      const prob = expScores[i]! / sumExp;
      probabilities[FIELD_CLASSES[i]!] = prob;
      if (prob > bestConf) {
        bestConf = prob;
        bestIdx = i;
      }
    }

    // Adaptive threshold (now reachable because callers pass a real context).
    let threshold = MIN_ML_CONFIDENCE;
    if (context) {
      if (context.isVerificationPage || context.is2FAPage) {
        threshold = 0.35;
      } else if (!context.isLoginPage && !context.isSignupPage) {
        threshold = 0.5;
      }
    }
    if (bestConf < threshold) {
      return null;
    }

    return { label: FIELD_CLASSES[bestIdx]!, confidence: bestConf, probabilities };
  } catch (err) {
    mlLog.error('Inference failed in offscreen doc:', err);
    return null;
  } finally {
    textTensor?.dispose();
    structTensor?.dispose();
  }
}
