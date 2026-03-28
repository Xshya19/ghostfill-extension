import * as ort from 'onnxruntime-web';
import {
  FIELD_CLASSES,
  NUM_TEXT_CHANNELS,
  MAX_TEXT_LEN,
  NUM_STRUCTURAL_FEATURES,
  RawFieldFeatures,
} from '../content/extractor';
import { PageContext } from '../types/form.types';

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

// Suppress ONNX Runtime internal errors about image inputs
const originalConsoleError = console.error;
console.error = function (...args: unknown[]) {
  const msg = args.map((a) => String(a)).join(' ');
  // Suppress ONNX internal image input errors - these are expected for non-image models
  if (msg.includes('image.png') && msg.includes('does not support image input')) {
    console.warn('[GhostFill ML] ONNX model type check (expected for non-image models):', msg);
    return;
  }
  originalConsoleError.apply(console, args);
};

export async function initInferenceEngine(): Promise<void> {
  if (session || initializing) {
    return;
  }
  initializing = true;
  try {
    const modelUrl = chrome.runtime.getURL('models/sentinel_brain_v2.onnx');

    console.log('[GhostFill ML] Initializing engine in offscreen document...');
    console.log('[GhostFill ML] Model URL:', modelUrl);

    // Fetch model as array buffer to ensure proper loading
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
    }
    const modelBuffer = await response.arrayBuffer();
    console.log('[GhostFill ML] Model fetched, size:', modelBuffer.byteLength, 'bytes');

    session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    console.log('[GhostFill ML] Engine initialized successfully.');
  } catch (error) {
    const err = error as Error;
    console.error('[GhostFill ML] Failed to initialize inference engine:', err.message);
    if (err.stack) {
      console.error('[GhostFill ML] Stack:', err.stack);
    }
    session = null;
  } finally {
    initializing = false;
  }
}

/**
 * Classifies a set of field features extracted by extractor.ts.
 * Returns null if the engine is not ready or confidence is too low.
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
    const flatText = new BigInt64Array(NUM_TEXT_CHANNELS * MAX_TEXT_LEN);
    // This model does not use text channels, but the features object still contains them.
    // const flatText = new BigInt64Array(NUM_TEXT_CHANNELS * MAX_TEXT_LEN);
    // for (let i = 0; i < NUM_TEXT_CHANNELS; i++) {
    //   const channel = features.textChannels[i];
    //   for (let j = 0; j < MAX_TEXT_LEN; j++) {
    //     flatText[i * MAX_TEXT_LEN + j] = BigInt(channel[j] ?? 0);
    //   }
    // }
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
      if (logits[i] > maxLogit) {
        maxLogit = logits[i];
      }
    }

    let sumExp = 0;
    const expScores = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      expScores[i] = Math.exp(logits[i] - maxLogit);
      sumExp += expScores[i];
    }

    const probabilities: Record<string, number> = {};
    let bestIdx = 0;
    let bestConf = 0;

    for (let i = 0; i < FIELD_CLASSES.length; i++) {
      const prob = expScores[i] / sumExp;
      probabilities[FIELD_CLASSES[i]] = prob;
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
        threshold = 0.50; // More conservative on random pages
      }
    }

    if (bestConf < threshold) {
      return null;
    }

    return {
      label: FIELD_CLASSES[bestIdx],
      confidence: bestConf,
      probabilities,
    };
  } catch (err) {
    console.error('[GhostFill ML] Inference failed in offscreen doc:', err);
    return null;
  }
}
