import * as ort from 'onnxruntime-web';
import {
  FIELD_CLASSES,
  NUM_TEXT_CHANNELS,
  MAX_TEXT_LEN,
  RawFieldFeatures,
} from '../content/extractor';
import { PageContext } from '../types/form.types';

// eslint-disable-next-line no-console
const mlLog = {
  info: (...a: unknown[]) => console.info('[GhostFill ML]', ...a),
  error: (...a: unknown[]) => console.error('[GhostFill ML]', ...a),
};

// Tell ONNX where to find the WebAssembly binaries.
// In the offscreen document, these are served relative to the root of the extension.
ort.env.wasm.wasmPaths = '/';
ort.env.wasm.numThreads = 1;
// ort.env.wasm.proxy = true; // Offscreen document CAN use workers/proxy if multi-threading is enabled

let session: ort.InferenceSession | null = null;
let initializing = false;

/** Minimum confidence to trust an ML prediction (below this we return null). */
const MIN_ML_CONFIDENCE = 0.45;

export interface MLPrediction {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
}

// Suppress ONNX Runtime internal errors about image inputs — scoped to init only
const originalConsoleError = console.error;
let suppressingErrors = false;

function scopedConsoleError(...args: unknown[]) {
  const msg = args.map((a) => String(a)).join(' ');
  if (suppressingErrors && msg.includes('image.png') && msg.includes('does not support image input')) {
    console.warn('[GhostFill ML] ONNX model type check (expected for non-image models):', msg);
    return;
  }
  originalConsoleError.apply(console, args);
}

export async function initInferenceEngine(): Promise<void> {
  if (session || initializing) {
    return;
  }
  initializing = true;
  suppressingErrors = true;
  console.error = scopedConsoleError;
  try {
    const modelUrl = chrome.runtime.getURL('models/sentinel_brain_v2.onnx');
    const dataUrl = chrome.runtime.getURL('models/sentinel_brain_v2.onnx.data');

    mlLog.info('Initializing engine in offscreen document...');
    mlLog.info('Model URL:', modelUrl);

    // Fetch model and external data in parallel to ensure complete initialization
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

    mlLog.info(
      'Model files fetched. Model:',
      modelBuffer.byteLength,
      'bytes, Data:',
      dataBuffer.byteLength,
      'bytes'
    );

    // Create session while explicitly providing the external data weights
    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      // Explicitly provide external data to ensure ORT can find weights in extension environment
      externalData: [
        {
          path: 'sentinel_brain_v2.onnx.data',
          data: new Uint8Array(dataBuffer),
        },
      ],
    });

    mlLog.info('Engine initialized successfully.');
  } catch (error) {
    const err = error as Error;
    mlLog.error('Failed to initialize inference engine:', err.message);
    if (err.stack) {
      mlLog.error('Stack:', err.stack);
    }
    session = null;
  } finally {
    suppressingErrors = false;
    console.error = originalConsoleError;
    initializing = false;
  }
}

/**
 * Returns the current status of the inference engine for diagnostics.
 */
export async function getEngineStatus(): Promise<{
  initialized: boolean;
  initializing: boolean;
  hasSession: boolean;
  modelUrl: string;
}> {
  return {
    initialized: !!session,
    initializing,
    hasSession: !!session,
    modelUrl: chrome.runtime.getURL('models/sentinel_brain_v2.onnx'),
  };
}

/**
 * Classifies a set of field features extracted by extractor.ts.
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

  try {
    // 1. Prepare Text Channels Tensor — shape [1, 8, 80]
    // The ONNX model expects int64 (BigInt64Array) for token IDs.
    // This model does not use text channels, but the features object still contains them.
    // const textTensor = new ort.Tensor('int64', flatText, [1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN]);

    // 2. Prepare Structural Features Tensor — shape [1, 128]
    const flatStruct = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      flatStruct[i] = features.structural[i] ?? 0;
    }
    const structuralTensor = new ort.Tensor('float32', flatStruct, [1, 128]);

    // 3. Run Inference - Grandmaster expects 'input' name
    const results = await session.run({
      input: structuralTensor,
    });

    // Fix: Dynamic tensor discovery for both 'logits' and 'output' naming schemes
    const outputTensor = results.logits || results.output || Object.values(results)[0];
    if (!outputTensor) {
      throw new Error('No valid output tensor in session results');
    }
    const logits = outputTensor.data as Float32Array;

    // 4. Softmax
    let maxLogit = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i]! > maxLogit) {
        maxLogit = logits[i]!;
      }
    }

    let sumExp = 0;
    const expScores = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      expScores[i] = Math.exp(logits[i]! - maxLogit);
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

    // Cleanup input tensors to prevent memory leaks in offscreen document
    structuralTensor.dispose();
    // note: 'results' own data will be cleaned up by JS GC,
    // but the underlying ONNX buffers are best managed via dispose if the API supports it.
    // In current onnxruntime-web, input disposal is most critical.

    // ── Dynamic Threshold Logic ─────────────────────
    let threshold = MIN_ML_CONFIDENCE;
    if (context) {
      if (context.isVerificationPage || context.is2FAPage) {
        threshold = 0.35; // Lower bar for high-confidence pages
      } else if (!context.isLoginPage && !context.isSignupPage) {
        threshold = 0.5; // More conservative on random pages
      }
    }

    if (bestConf < threshold) {
      return null;
    }

    return {
      label: FIELD_CLASSES[bestIdx]!,
      confidence: bestConf,
      probabilities,
    };
  } catch (err) {
    mlLog.error('Inference failed in offscreen doc:', err);
    return null;
  }
}
