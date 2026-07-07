// Calibration + abstention. A truly strong classifier knows when it is unsure
// and ABSTAINS instead of guessing wrong. This replaces "fall back to
// heuristics" with "abstain / ask the user".
//
// Temperature is fit on a validation set (see eval) so that reported
// probabilities are trustworthy. Thresholds gate FILL vs ABSTAIN.

import type { ClassificationResult, FieldClass } from '../types';

export interface AbstentionPolicy {
  // Minimum top-class probability to act on.
  minProb: number;
  // Minimum margin (top1 - top2) to act on.
  minMargin: number;
  // Safety-critical classes get a STRICTER bar (wrong fill here is dangerous).
  criticalMinProb: number;
  criticalMinMargin: number;
  criticalClasses: FieldClass[];
}

export const DEFAULT_POLICY: AbstentionPolicy = {
  // lowered non-critical thresholds so text-based identity inputs
  // (like Qwen's email input field) are correctly filled.
  minProb: 0.55,
  minMargin: 0.15,
  criticalMinProb: 0.75,
  criticalMinMargin: 0.3,
  criticalClasses: ['Password', 'Target_Password_Confirm', 'OTP'],
};

export interface ConfidenceVerdict {
  confident: boolean;
  reason: string;
}

export function isConfident(
  result: ClassificationResult,
  policy: AbstentionPolicy = DEFAULT_POLICY
): ConfidenceVerdict {
  if (result.top === 'Unknown') {
    return { confident: false, reason: 'top class is Unknown' };
  }
  const critical = policy.criticalClasses.includes(result.top);
  const minProb = critical ? policy.criticalMinProb : policy.minProb;
  const minMargin = critical ? policy.criticalMinMargin : policy.minMargin;
  if (result.topProb < minProb) {
    return {
      confident: false,
      reason:
        'prob ' +
        result.topProb.toFixed(2) +
        ' < ' +
        minProb +
        (critical ? ' (critical class)' : ''),
    };
  }
  if (result.margin < minMargin) {
    return {
      confident: false,
      reason:
        'margin ' +
        result.margin.toFixed(2) +
        ' < ' +
        minMargin +
        (critical ? ' (critical class)' : ''),
    };
  }
  return {
    confident: true,
    reason: 'prob ' + result.topProb.toFixed(2) + ', margin ' + result.margin.toFixed(2),
  };
}
