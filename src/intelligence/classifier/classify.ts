// Orchestrator: ONE strong decision path. heuristic (+ optional model) ->
// calibrated confidence -> abstain-or-act -> deterministic safety gate.
//
// There is no "fallback classifier". If the primary is not confident, we
// ABSTAIN (skip / ask the user), we do not guess with a weaker brain.
//
// `modelScorer` is the plug point for the distilled SLM later: if provided,
// its probabilities are blended with the heuristic via a simple weighted
// ensemble. Until then the heuristic stands alone.

import { FIELD_CLASSES } from '../contract';
import type { ClassificationResult, FieldClass, FillDecision, RawFieldRecord } from '../types';
import { AbstentionPolicy, DEFAULT_POLICY, isConfident } from './confidence';
import { classifyHeuristic, ClassifyOptions } from './heuristicClassifier';
import { checkSafety } from './safetyGate';

export type ModelScorer = (r: RawFieldRecord) => Record<FieldClass, number>;

export interface ClassifyConfig extends ClassifyOptions {
  policy?: AbstentionPolicy | undefined;
  modelScorer?: ModelScorer | undefined;
  modelWeight?: number | undefined; // 0..1 weight on the model when blending (default 0.5)
}

function blend(
  a: Record<FieldClass, number>,
  b: Record<FieldClass, number>,
  wB: number
): ClassificationResult {
  const scores = {} as Record<FieldClass, number>;
  for (const c of FIELD_CLASSES) {
    scores[c] = (a[c] ?? 0) * (1 - wB) + (b[c] ?? 0) * wB;
  }
  const ranked = FIELD_CLASSES.map((c) => ({ c, p: scores[c] ?? 0 })).sort((x, y) => y.p - x.p);
  const topRanked = ranked[0]!;
  return {
    scores,
    top: topRanked.c,
    topProb: topRanked.p,
    margin: topRanked.p - (ranked[1]?.p ?? 0),
    signals: ['model+heuristic ensemble (wModel=' + wB + ')'],
  };
}

export function classifyField(
  r: RawFieldRecord,
  cfg: ClassifyConfig = {}
): { result: ClassificationResult; decision: FillDecision } {
  const heur = classifyHeuristic(r, { temperature: cfg.temperature });
  let result = heur;

  if (cfg.modelScorer) {
    const modelProbs = cfg.modelScorer(r);
    const blended = blend(heur.scores, modelProbs, cfg.modelWeight ?? 0.5);
    blended.hardNegative = heur.hardNegative; // hard-negative detection stays deterministic
    blended.signals = heur.signals.concat(blended.signals);
    result = blended;
  }

  const policy = cfg.policy ?? DEFAULT_POLICY;
  const verdict = isConfident(result, policy);

  // safety gate runs regardless -- even a confident prediction can be blocked
  const safety = checkSafety(r, result, result.top);

  let decision: FillDecision;
  if (!safety.allow) {
    decision = {
      action: 'BLOCK',
      class: result.top,
      confidence: result.topProb,
      reason: 'blocked by safety gate',
      safety: safety.reason,
      signals: result.signals,
    };
  } else if (!verdict.confident) {
    decision = {
      action: 'ABSTAIN',
      class: result.top,
      confidence: result.topProb,
      reason: 'not confident: ' + verdict.reason,
      signals: result.signals,
    };
  } else {
    decision = {
      action: 'FILL',
      class: result.top,
      confidence: result.topProb,
      reason: verdict.reason,
      signals: result.signals,
    };
  }
  return { result, decision };
}
