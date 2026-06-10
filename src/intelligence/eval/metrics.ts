// Classification metrics tuned for an AUTOFILL tool, where the costs are
// asymmetric:
//   - correctly ABSTAINING/BLOCKING a no-fill field (true Unknown) is GOOD.
//   - FILLING a field that should not be filled is BAD (and dangerous if it is
//     a payment/captcha/honeypot/etc).
//   - filling a real field with the WRONG class is the worst (dangerous on
//     Password/OTP).
//
// So we measure positives (fillable classes) separately from rejections
// (Unknown / hard-negatives), instead of lumping them together.

import { FIELD_CLASSES } from '../contract';
import type { FieldClass, FillDecision, LabeledFieldRecord } from '../types';

export interface PerClass {
  class: FieldClass;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface EvalReport {
  total: number;
  shouldFill: number; // rows whose true label is a fillable class
  shouldReject: number; // rows whose true label is Unknown (incl. hard-negatives)
  filled: number;
  abstained: number;
  blocked: number;
  correctFills: number; // filled with the right class
  wrongFills: number; // filled positive-but-wrong-class OR filled a no-fill field
  falseFills: number; // filled a row that should have been rejected
  correctRejections: number; // abstained/blocked a true no-fill field
  fillPrecision: number; // correctFills / filled
  fillCoverage: number; // correctFills / shouldFill  (recall over fillable fields)
  rejectionAccuracy: number; // correctRejections / shouldReject
  macroF1: number; // over fillable classes with support (excludes Unknown)
  perClass: PerClass[];
  confusion: Record<string, Record<string, number>>;
  dangerousErrors: Array<{
    selector?: string | undefined;
    expected: FieldClass;
    got: FieldClass;
    reason: string;
  }>;
  hardNegativeLeaks: number;
}

const CRITICAL: FieldClass[] = ['Password', 'Target_Password_Confirm', 'OTP'];

export function evaluate(rows: LabeledFieldRecord[], decisions: FillDecision[]): EvalReport {
  const tp: Record<string, number> = {};
  const fp: Record<string, number> = {};
  const fn: Record<string, number> = {};
  const support: Record<string, number> = {};
  for (const c of FIELD_CLASSES) {
    tp[c] = 0;
    fp[c] = 0;
    fn[c] = 0;
    support[c] = 0;
  }
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of FIELD_CLASSES) {
    confusion[a] = {};
    for (const b of FIELD_CLASSES) {
      const row = confusion[a];
      if (row) {
        row[b] = 0;
      }
    }
  }

  let shouldFill = 0,
    shouldReject = 0;
  let filled = 0,
    abstained = 0,
    blocked = 0;
  let correctFills = 0,
    wrongFills = 0,
    falseFills = 0,
    correctRejections = 0,
    hardNegativeLeaks = 0;
  const dangerousErrors: EvalReport['dangerousErrors'] = [];

  rows.forEach((row, i) => {
    const d = decisions[i]!;
    const expected = row.label;
    const isPositive = expected !== 'Unknown';
    if (isPositive) {
      shouldFill++;
      support[expected] = (support[expected] ?? 0) + 1;
    } else {
      shouldReject++;
    }

    if (d.action === 'BLOCK') {
      blocked++;
    } else if (d.action === 'ABSTAIN') {
      abstained++;
    }

    if (d.action === 'FILL') {
      filled++;
      const got = d.class;
      if (isPositive) {
        const confRow = confusion[expected];
        if (confRow) {
          confRow[got] = (confRow[got] ?? 0) + 1;
        }
        if (got === expected) {
          tp[got] = (tp[got] ?? 0) + 1;
          correctFills++;
        } else {
          fp[got] = (fp[got] ?? 0) + 1;
          fn[expected] = (fn[expected] ?? 0) + 1;
          wrongFills++;
          if (CRITICAL.includes(got) || CRITICAL.includes(expected)) {
            dangerousErrors.push({
              selector: row.selector,
              expected,
              got,
              reason: 'wrong critical class',
            });
          }
        }
      } else {
        // filled a row that should have been rejected -> always bad
        falseFills++;
        wrongFills++;
        if (got !== 'Unknown') {
          fp[got] = (fp[got] ?? 0) + 1;
        }
        const reason = row.hardNegative
          ? 'filled hard-negative (' + row.hardNegative + ')'
          : 'filled a no-fill field';
        dangerousErrors.push({ selector: row.selector, expected, got, reason });
        if (row.hardNegative) {
          hardNegativeLeaks++;
        }
      }
    } else {
      // ABSTAIN or BLOCK
      if (isPositive) {
        fn[expected] = (fn[expected] ?? 0) + 1; // missed a fillable field (safe but unhelpful)
      } else {
        correctRejections++;
      } // correctly declined a no-fill field (good)
    }
  });

  const perClass: PerClass[] = FIELD_CLASSES.map((c) => {
    const classTp = tp[c] ?? 0;
    const classFp = fp[c] ?? 0;
    const classFn = fn[c] ?? 0;
    const classSupport = support[c] ?? 0;
    const precision = classTp + classFp > 0 ? classTp / (classTp + classFp) : 0;
    const recall = classTp + classFn > 0 ? classTp / (classTp + classFn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      class: c,
      tp: classTp,
      fp: classFp,
      fn: classFn,
      precision,
      recall,
      f1,
      support: classSupport,
    };
  });

  const scored = perClass.filter((p) => p.class !== 'Unknown' && p.support > 0);
  const macroF1 = scored.length ? scored.reduce((a, p) => a + p.f1, 0) / scored.length : 0;

  return {
    total: rows.length,
    shouldFill,
    shouldReject,
    filled,
    abstained,
    blocked,
    correctFills,
    wrongFills,
    falseFills,
    correctRejections,
    hardNegativeLeaks,
    fillPrecision: filled > 0 ? correctFills / filled : 1,
    fillCoverage: shouldFill > 0 ? correctFills / shouldFill : 1,
    rejectionAccuracy: shouldReject > 0 ? correctRejections / shouldReject : 1,
    macroF1,
    perClass,
    confusion,
    dangerousErrors,
  };
}
