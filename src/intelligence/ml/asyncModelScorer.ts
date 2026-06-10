/**
 * GhostFill — Async ML Scorer Bridge
 *
 * Connects the synchronous `ModelScorer` plug-point in classify.ts to the
 * ONNX inference engine running in the offscreen document (via the background
 * service-worker proxy).
 *
 * Design decisions:
 *  - Only invokes ML when heuristic confidence is BELOW the threshold (0.70).
 *    For clear-cut fields (obvious email/password), heuristics are fast & right;
 *    ML only adds latency. ML is the tie-breaker for ambiguous fields.
 *  - LRU cache keyed by a field fingerprint (type+name+id+placeholder+autocomplete).
 *    Avoids re-running inference on the same field when the FAB re-renders or
 *    the user focuses/blurs repeatedly.
 *  - Hard timeout of 800 ms. If the offscreen doc is still loading ONNX WASM,
 *    we silently fall back to heuristics rather than blocking the fill action.
 *  - Never throws — all errors are caught and return null (graceful degradation).
 *
 * Channel layout MUST match training/train_ghostfill_model.py:
 *   ch0 = placeholder
 *   ch1 = aria-label
 *   ch2 = label text
 *   ch3 = name + id (space-joined)
 *   ch4 = autocomplete
 *   ch5 = surrounding text (first 80 chars — approximates floating-label)
 *   ch6 = surrounding text (next 80 chars — approximates nearby context)
 *   ch7 = '' (form heading slot — not yet extracted, reserved)
 */

import { FIELD_CLASSES } from '../contract';
import type { FieldClass, RawFieldRecord } from '../types';
import { safeSendMessage } from '../../utils/messaging';
import { createLogger } from '../../utils/logger';

const log = createLogger('AsyncModelScorer');

// ── Configuration ────────────────────────────────────────────────────────────

/** Heuristic topProb below this → invoke ML as a tiebreaker. */
export const ML_INVOKE_THRESHOLD = 0.70;

/** Max wait for the offscreen ML response before falling back to heuristics. */
const ML_TIMEOUT_MS = 800;

/** Each channel is padded/truncated to this fixed length (matches model input). */
const MAX_TEXT_LEN = 80;

/** How many text channels the model expects. */
const NUM_TEXT_CHANNELS = 8;

/** Cache TTL — discard stale scores after 60 s. */
const CACHE_TTL_MS = 60_000;

/** Maximum cache entries (LRU-lite: evict oldest when full). */
const MAX_CACHE_ENTRIES = 50;

// ── LRU Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  scores: Record<FieldClass, number>;
  ts: number;
}

const scoreCache = new Map<string, CacheEntry>();

function cacheGet(key: string): Record<FieldClass, number> | null {
  const entry = scoreCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    scoreCache.delete(key);
    return null;
  }
  return entry.scores;
}

function cacheSet(key: string, scores: Record<FieldClass, number>): void {
  // Evict oldest if at capacity
  if (scoreCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = scoreCache.keys().next().value;
    if (firstKey !== undefined) {
      scoreCache.delete(firstKey);
    }
  }
  scoreCache.set(key, { scores, ts: Date.now() });
}

// ── Feature Encoding ─────────────────────────────────────────────────────────

/**
 * Encode a text string as an array of character codes, padded/truncated to
 * MAX_TEXT_LEN. Lowercased and trimmed. Values > 255 are clamped to 1.
 */
function encodeText(text: string): number[] {
  const s = (text || '').toLowerCase().trim();
  const out = new Array<number>(MAX_TEXT_LEN).fill(0);
  const len = Math.min(s.length, MAX_TEXT_LEN);
  for (let i = 0; i < len; i++) {
    const code = s.charCodeAt(i);
    out[i] = code < 256 ? code : 1;
  }
  return out;
}

/**
 * Build the 8-channel text tensor from a RawFieldRecord.
 * Channel assignment must stay in sync with the Python training script.
 */
function buildTextChannels(r: RawFieldRecord): number[][] {
  const surrounding = r.surroundingText || '';
  return [
    encodeText(r.placeholder),                              // ch0
    encodeText(r.ariaLabel),                                // ch1
    encodeText(r.labelText),                                // ch2
    encodeText(`${r.name} ${r.id}`.trim()),                 // ch3
    encodeText(r.autocomplete),                             // ch4
    encodeText(surrounding.slice(0, MAX_TEXT_LEN)),         // ch5
    encodeText(surrounding.slice(MAX_TEXT_LEN, MAX_TEXT_LEN * 2)), // ch6
    encodeText(''),                                         // ch7 (reserved)
  ];
}

/** Stable fingerprint of the field's metadata (NOT its value). */
function fingerprintRecord(r: RawFieldRecord): string {
  return `${r.type}|${r.name}|${r.id}|${r.placeholder}|${r.autocomplete}|${r.labelText}`;
}

// ── Response Mapping ─────────────────────────────────────────────────────────

/**
 * Map the offscreen inference result (keyed by label strings) to the
 * canonical `Record<FieldClass, number>` type used by classify.ts.
 */
function mapToFieldClassScores(
  probs: Record<string, number>
): Record<FieldClass, number> {
  const scores = {} as Record<FieldClass, number>;
  for (const cls of FIELD_CLASSES) {
    scores[cls] = probs[cls] ?? 0;
  }
  return scores;
}

// ── Core Async Invocation ────────────────────────────────────────────────────

type MLResponse = {
  success: boolean;
  prediction?: {
    label: string;
    confidence: number;
    probabilities: Record<string, number>;
  };
};

/**
 * Invoke the ONNX model via the offscreen document proxy.
 *
 * Returns a `Record<FieldClass, number>` probability distribution, or `null`
 * if:
 *   - heuristicTopProb >= ML_INVOKE_THRESHOLD (no ML needed)
 *   - cache hit from a previous call for the same field
 *   - the offscreen response times out (> 800 ms)
 *   - any error occurs (graceful degradation)
 *
 * The returned scores can be passed directly as `modelScorer` config to
 * `classifyField()` in classify.ts.
 */
export async function invokeMLScorer(
  record: RawFieldRecord,
  heuristicTopProb: number
): Promise<Record<FieldClass, number> | null> {
  // Fast path: heuristics are already highly confident — skip ML entirely
  if (heuristicTopProb >= ML_INVOKE_THRESHOLD) {
    return null;
  }

  // Cache hit?
  const key = fingerprintRecord(record);
  const cached = cacheGet(key);
  if (cached) {
    log.debug('ML score served from cache', { key });
    return cached;
  }

  try {
    const textChannels = buildTextChannels(record);
    const structural = Array.from(record.structural ?? new Array<number>(64).fill(0));

    const payload = {
      features: {
        textChannels,
        structural,
        isVisible: record.visible,
      },
    };

    // Race the background proxy call against a hard timeout
    const timeoutPromise: Promise<null> = new Promise((resolve) =>
      setTimeout(() => resolve(null), ML_TIMEOUT_MS)
    );

    const responsePromise = safeSendMessage(
      { action: 'CLASSIFY_FIELD', payload } as unknown as Parameters<typeof safeSendMessage>[0]
    );


    const raw = await Promise.race([responsePromise, timeoutPromise]);

    if (!raw) {
      log.debug('ML scorer timed out or context invalid — using heuristics only');
      return null;
    }

    const response = raw as unknown as MLResponse;
    if (!response.success || !response.prediction?.probabilities) {
      log.debug('ML scorer returned no usable prediction');
      return null;
    }

    const scores = mapToFieldClassScores(response.prediction.probabilities);
    cacheSet(key, scores);

    log.debug('ML score received', {
      top: response.prediction.label,
      confidence: response.prediction.confidence.toFixed(3),
    });

    return scores;
  } catch (err) {
    // Never propagate — classifier falls back to heuristics silently
    log.debug('ML scorer error (non-fatal)', err);
    return null;
  }
}

/**
 * Trigger a background warm-up of the ONNX model in the offscreen document.
 * Call this on page load so the model is already loaded when the user clicks.
 * Fire-and-forget — never awaited, never throws.
 */
export function prewarmMLModel(): void {
  safeSendMessage({ action: 'PREWARM_ML' } as unknown as Parameters<typeof safeSendMessage>[0]).catch(
    () => { /* intentionally ignored */ }
  );

}

/** Clear the in-memory score cache (e.g. on page navigation). */
export function clearMLScoreCache(): void {
  scoreCache.clear();
}
