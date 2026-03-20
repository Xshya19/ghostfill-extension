import * as ort from 'onnxruntime-web';
import {
  FIELD_CLASSES,
  NUM_TEXT_CHANNELS,
  MAX_TEXT_LEN,
  NUM_STRUCTURAL_FEATURES,
  RawFieldFeatures,
} from '../content/extractor';

// Tell ONNX where to find the WebAssembly binaries.
// In a Chrome extension, they must be served from the extension's root directory
// (copied via Webpack's CopyWebpackPlugin).
ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
ort.env.wasm.numThreads = 1; // Service workers run better with 1 thread

let session: ort.InferenceSession | null = null;
let initializing = false;

/** Minimum confidence to trust an ML prediction (below this we return null). */
const MIN_ML_CONFIDENCE = 0.45;

export interface MLPrediction {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export async function initInferenceEngine(): Promise<void> {
  if (session || initializing) return;
  initializing = true;
  try {
    const modelUrl = chrome.runtime.getURL('models/ghostfill_v1_int8.onnx');
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    console.log('[GhostFill ML] Engine initialized. Fast local inference ready.');
  } catch (error) {
    console.error('[GhostFill ML] Failed to initialize inference engine:', error);
    session = null; // Ensure session stays null so next call can retry
  } finally {
    // Always reset the flag so a future call can retry if init failed
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
  // Lazy-init on first classify call (fallback if warm-up hadn't run yet)
  if (!session) {
    await initInferenceEngine();
  }

  if (!session) return null;

  try {
    // 1. Prepare Text Channels Tensor — shape [1, 8, 80]
    const flatText = new Int32Array(NUM_TEXT_CHANNELS * MAX_TEXT_LEN);
    for (let i = 0; i < NUM_TEXT_CHANNELS; i++) {
      const channel = features.textChannels[i];
      for (let j = 0; j < MAX_TEXT_LEN; j++) {
        flatText[i * MAX_TEXT_LEN + j] = channel[j] ?? 0;
      }
    }
    // ONNX model uses int32 embeddings (matching PyTorch CharCNN with torch.long → onnx int32)
    const textTensor = new ort.Tensor('int32', flatText, [1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN]);

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

    // 4. Softmax for probabilities (numerically stable)
    let maxLogit = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > maxLogit) maxLogit = logits[i];
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

    // 5. Confidence threshold — return null if model is not confident enough
    if (bestConf < MIN_ML_CONFIDENCE) {
      return null;
    }

    return {
      label: FIELD_CLASSES[bestIdx],
      confidence: bestConf,
      probabilities,
    };
  } catch (err) {
    console.error('[GhostFill ML] Inference failed:', err);
    return null;
  }
}
