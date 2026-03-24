import * as ort from 'onnxruntime-web';
import {
  FIELD_CLASSES,
  NUM_TEXT_CHANNELS,
  MAX_TEXT_LEN,
  NUM_STRUCTURAL_FEATURES,
  RawFieldFeatures,
} from '../content/extractor';

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
    const modelUrl = chrome.runtime.getURL('models/ghostfill_v1_int8.onnx');

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
  features: Omit<RawFieldFeatures, 'element'>
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
    for (let i = 0; i < NUM_TEXT_CHANNELS; i++) {
      const channel = features.textChannels[i];
      for (let j = 0; j < MAX_TEXT_LEN; j++) {
        flatText[i * MAX_TEXT_LEN + j] = BigInt(channel[j] ?? 0);
      }
    }
    const textTensor = new ort.Tensor('int64', flatText, [1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN]);

    // 2. Prepare Structural Features Tensor — shape [1, 64]
    const flatStruct = new Float32Array(NUM_STRUCTURAL_FEATURES);
    for (let i = 0; i < NUM_STRUCTURAL_FEATURES; i++) {
      flatStruct[i] = features.structural[i] ?? 0;
    }
    const structuralTensor = new ort.Tensor('float32', flatStruct, [1, NUM_STRUCTURAL_FEATURES]);

    // 3. Run Inference
    const results = await session.run({
      text_channels: textTensor,
      structural: structuralTensor,
    });

    const logits = results['logits'].data as Float32Array;

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

    if (bestConf < MIN_ML_CONFIDENCE) {
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
