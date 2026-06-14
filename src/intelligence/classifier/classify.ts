// Orchestrator: ONE strong decision path. heuristic ->
// calibrated confidence -> abstain-or-act -> deterministic safety gate.
//
// There is no "fallback classifier". If the primary is not confident, we
// ABSTAIN (skip / ask the user), we do not guess with a weaker brain.

import type { ClassificationResult, FillDecision, RawFieldRecord } from '../types';
import { AbstentionPolicy, DEFAULT_POLICY, isConfident } from './confidence';
import { classifyHeuristic, ClassifyOptions } from './heuristicClassifier';
import { checkSafety } from './safetyGate';

export interface ClassifyConfig extends ClassifyOptions {
  policy?: AbstentionPolicy | undefined;
}

export function classifyField(
  r: RawFieldRecord,
  cfg: ClassifyConfig = {}
): { result: ClassificationResult; decision: FillDecision } {
  const result = classifyHeuristic(r, { temperature: cfg.temperature });

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
