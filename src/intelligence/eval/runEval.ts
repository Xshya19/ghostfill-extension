/// <reference types="node" />

// Runs the classifier over a labeled JSONL set and prints a full report PLUS
// the MODEL DECISION GATE: a data-driven verdict on whether the heuristic is
// already good enough or needs a future narrow model.
//
// Usage: tsx src/eval/runEval.ts [labeled.jsonl]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyField } from '../IntelligenceCore';
import type { FillDecision, LabeledFieldRecord } from '../IntelligenceCore';
import { evaluate } from './metrics';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLE_ROWS: LabeledFieldRecord[] = [
  {
    url: 'https://example.test/signup',
    selector: '#email',
    tag: 'input',
    type: 'email',
    autocomplete: 'email',
    name: 'email',
    id: 'email',
    placeholder: 'Email address',
    ariaLabel: '',
    labelText: 'Email address',
    surroundingText: 'Create account Email address',
    maxLength: -1,
    inputMode: '',
    pattern: '',
    required: true,
    visible: true,
    widthPx: 320,
    label: 'Email',
  },
  {
    url: 'https://example.test/verify',
    selector: '#otp',
    tag: 'input',
    type: 'text',
    autocomplete: 'one-time-code',
    name: 'verification_code',
    id: 'otp',
    placeholder: 'Verification code',
    ariaLabel: '',
    labelText: 'Verification code',
    surroundingText: 'Enter the 6 digit verification code',
    maxLength: 6,
    inputMode: 'numeric',
    pattern: '\\d{6}',
    required: true,
    visible: true,
    widthPx: 180,
    label: 'OTP',
  },
  {
    url: 'https://example.test/search',
    selector: '#search',
    tag: 'input',
    type: 'search',
    autocomplete: '',
    name: 'q',
    id: 'search',
    placeholder: 'Search',
    ariaLabel: 'Search',
    labelText: '',
    surroundingText: 'Search the site',
    maxLength: -1,
    inputMode: '',
    pattern: '',
    required: false,
    visible: true,
    widthPx: 260,
    label: 'Unknown',
    hardNegative: 'Search',
  },
];

function load(path: string): LabeledFieldRecord[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI eval reads a caller-supplied dataset path.
  const raw = readFileSync(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((l: string) => l.trim())
    .map((l: string) => JSON.parse(l) as LabeledFieldRecord);
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + '%';
}

function main(): void {
  const arg = (process as any).argv[2];
  const useSample = !arg || arg === '--sample';
  const path = useSample ? 'built-in smoke sample' : resolve(arg);
  const rows = useSample ? SAMPLE_ROWS : load(path);
  const decisions: FillDecision[] = rows.map((r) => classifyField(r));
  const rep = evaluate(rows, decisions);

  console.log('============================================================');
  console.log(' GhostFill classifier eval  (' + rows.length + ' fields)');
  console.log(' dataset: ' + path);
  console.log('============================================================');
  console.log('Fillable fields: ' + rep.shouldFill + '   No-fill fields: ' + rep.shouldReject);
  console.log(
    'Actions: ' +
      rep.filled +
      ' filled, ' +
      rep.abstained +
      ' abstained, ' +
      rep.blocked +
      ' blocked'
  );
  console.log('');
  console.log('Fill precision  (right class / filled):      ' + pct(rep.fillPrecision));
  console.log('Fill coverage   (right class / fillable):    ' + pct(rep.fillCoverage));
  console.log('Rejection acc.  (declined / no-fill fields): ' + pct(rep.rejectionAccuracy));
  console.log('Macro-F1 (fillable classes): ' + rep.macroF1.toFixed(3));
  console.log('False fills (filled a no-fill field): ' + rep.falseFills);
  console.log('Hard-negative leaks (acted on a trap/payment/etc): ' + rep.hardNegativeLeaks);
  console.log('');
  console.log('Per-class (support / P / R / F1):');
  for (const p of rep.perClass) {
    if (p.support === 0 && p.tp + p.fp === 0) {
      continue;
    }
    console.log(
      '  ' +
        p.class.padEnd(24) +
        ' n=' +
        String(p.support).padEnd(4) +
        ' P=' +
        p.precision.toFixed(2) +
        ' R=' +
        p.recall.toFixed(2) +
        ' F1=' +
        p.f1.toFixed(2)
    );
  }
  console.log('');
  if (rep.dangerousErrors.length) {
    console.log('!! DANGEROUS ERRORS (' + rep.dangerousErrors.length + '):');
    for (const e of rep.dangerousErrors.slice(0, 25)) {
      console.log(
        '   [' + e.expected + ' -> ' + e.got + '] ' + (e.selector || '') + '  (' + e.reason + ')'
      );
    }
  } else {
    console.log('No dangerous errors. ✅');
  }

  // ---------------- MODEL DECISION GATE ----------------
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(' MODEL DECISION GATE');
  console.log('------------------------------------------------------------');
  const GATE = {
    minMacroF1: 0.95,
    minFillPrecision: 0.99,
    minFillCoverage: 0.85,
    minRejectionAcc: 0.98,
    maxDangerous: 0,
  };
  const gaps: string[] = [];
  if (rep.macroF1 < GATE.minMacroF1) {
    gaps.push('macro-F1 ' + rep.macroF1.toFixed(3) + ' < ' + GATE.minMacroF1);
  }
  if (rep.fillPrecision < GATE.minFillPrecision) {
    gaps.push('fill-precision ' + pct(rep.fillPrecision) + ' < ' + pct(GATE.minFillPrecision));
  }
  if (rep.fillCoverage < GATE.minFillCoverage) {
    gaps.push('fill-coverage ' + pct(rep.fillCoverage) + ' < ' + pct(GATE.minFillCoverage));
  }
  if (rep.rejectionAccuracy < GATE.minRejectionAcc) {
    gaps.push(
      'rejection-accuracy ' + pct(rep.rejectionAccuracy) + ' < ' + pct(GATE.minRejectionAcc)
    );
  }
  if (rep.dangerousErrors.length > GATE.maxDangerous) {
    gaps.push(rep.dangerousErrors.length + ' dangerous errors > ' + GATE.maxDangerous);
  }

  const weak = rep.perClass.filter((p) => p.support >= 3 && p.f1 < 0.9).map((p) => p.class);

  if (gaps.length === 0) {
    console.log('VERDICT: Heuristic already meets the bar. DO NOT train a model yet.');
    console.log('Spend effort on harvesting more real-world pages + the audit P0 fixes instead.');
  } else {
    console.log('VERDICT: Heuristic has real gaps. A NARROW distilled model may be justified.');
    console.log('Unmet thresholds (note: a tiny sample set makes these noisy):');
    for (const g of gaps) {
      console.log('  - ' + g);
    }
    if (weak.length) {
      console.log('Target the model ONLY at these weak fillable classes: ' + weak.join(', '));
    } else {
      console.log(
        'No single fillable class is weak with enough support -- harvest more eval data first.'
      );
    }
  }
  console.log('============================================================');
}

main();
