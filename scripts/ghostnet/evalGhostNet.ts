import fs from 'node:fs';
import path from 'node:path';

import { compileEmailDocument } from '../../src/services/extraction/emailDocument';
import { decodeGhostNetBundle, runGhostNet } from '../../src/services/extraction/ghostNet';
import {
  ACTION_CLASSES,
  type GhostNetActionClass,
  type GhostNetIntentClass,
  INTENT_CLASSES,
} from '../../src/services/extraction/ghostNetTokenizer';
import { GHOSTNET_WEIGHTS } from '../../src/services/extraction/ghostNetWeights';
import type { PageVerificationExpectation } from '../../src/services/types/extraction.types';

import { fetchRealDatasets } from './fetchRealDatasets';
import { debiasRealCorpusMetadata, generateOpenVocabCorpus } from './openVocabCorpus';

interface HardCaseFixture {
  id: string;
  desc: string;
  subject: string;
  sender: string;
  body: string;
  html: string;
  expectedDomains: string[];
  originUrl?: string;
  pageExpectation?: PageVerificationExpectation;
  expect: {
    intent: GhostNetIntentClass;
    otp: string | null;
    link: string | null;
    action: GhostNetActionClass;
  };
}

function computeMacroF1(confusion: number[][], labels: readonly string[]): number {
  let sumF1 = 0;
  let active = 0;
  for (let c = 0; c < labels.length; c++) {
    const tp = confusion[c]![c]!;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < labels.length; i++) {
      if (i !== c) {
        fp += confusion[i]![c]!;
        fn += confusion[c]![i]!;
      }
    }
    const support = tp + fn;
    if (support === 0) {
      continue;
    }
    active += 1;
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec = tp / support;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    sumF1 += f1;
  }
  return active > 0 ? sumF1 / active : 0;
}

function computeEce(confs: Array<{ conf: number; correct: boolean }>, bins = 10): number {
  if (confs.length === 0) {
    return 0;
  }
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = confs.filter((x) =>
      b === bins - 1 ? x.conf >= lo && x.conf <= hi : x.conf >= lo && x.conf < hi
    );
    if (inBin.length === 0) {
      continue;
    }
    const avgConf = inBin.reduce((s, x) => s + x.conf, 0) / inBin.length;
    const avgAcc = inBin.filter((x) => x.correct).length / inBin.length;
    ece += (inBin.length / confs.length) * Math.abs(avgAcc - avgConf);
  }
  return ece;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  if (GHOSTNET_WEIGHTS.trainedSamples < 20000) {
    console.error('[GhostNet Eval] Weights not trained yet. Run `npm run brain:train` first.');
    process.exit(1);
  }

  const net = decodeGhostNetBundle(GHOSTNET_WEIGHTS);
  const real = debiasRealCorpusMetadata(await fetchRealDatasets());
  const ov = generateOpenVocabCorpus(20261119);
  const testSamples = [...real, ...ov].filter((s) => s.split === 'test');

  const intentIdxMap = new Map<string, number>(INTENT_CLASSES.map((c, i) => [c, i]));
  const actionIdxMap = new Map<string, number>(ACTION_CLASSES.map((c, i) => [c, i]));

  const intentConfusion = INTENT_CLASSES.map(() =>
    new Array<number>(INTENT_CLASSES.length).fill(0)
  );
  const actionConfusion = ACTION_CLASSES.map(() =>
    new Array<number>(ACTION_CLASSES.length).fill(0)
  );

  const intentCalib: Array<{ conf: number; correct: boolean }> = [];
  const actionCalib: Array<{ conf: number; correct: boolean }> = [];

  let otpExact = 0;
  let otpTotal = 0;
  let otpFalsePos = 0;
  let otpNullTotal = 0;

  let linkExact = 0;
  let linkTotal = 0;
  let linkFalsePos = 0;
  let linkNullTotal = 0;

  let falseAutoAct = 0;
  let totalNoneOrReview = 0;

  const inferTimesMs: number[] = [];
  const totalTimesMs: number[] = [];

  for (let i = 0; i < Math.min(32, testSamples.length); i++) {
    const s = testSamples[i]!;
    const doc = compileEmailDocument(s.subject, s.body, s.htmlBody, s.sender, s.expectedDomains);
    runGhostNet(
      doc,
      {
        expectedDomains: s.expectedDomains,
        originUrl: s.originUrl,
        pageExpectation: s.pageExpectation,
      },
      net
    );
  }

  const testErrors: string[] = [];

  for (const s of testSamples) {
    const tTotal0 = performance.now();
    const doc = compileEmailDocument(s.subject, s.body, s.htmlBody, s.sender, s.expectedDomains);
    const res = runGhostNet(
      doc,
      {
        expectedDomains: s.expectedDomains,
        originUrl: s.originUrl,
        pageExpectation: s.pageExpectation,
      },
      net
    );
    totalTimesMs.push(performance.now() - tTotal0);
    inferTimesMs.push(res.inferenceMs);

    const trueI = intentIdxMap.get(s.label.intent)!;
    const predI = intentIdxMap.get(res.intent)!;
    intentConfusion[trueI]![predI] = intentConfusion[trueI]![predI]! + 1;
    intentCalib.push({ conf: res.intentConfidence, correct: trueI === predI });

    const trueA = actionIdxMap.get(s.label.action)!;
    const predA = actionIdxMap.get(res.action)!;
    actionConfusion[trueA]![predA] = actionConfusion[trueA]![predA]! + 1;
    actionCalib.push({ conf: res.actionConfidence, correct: trueA === predA });

    const predAuto =
      res.action === 'fill-otp' ||
      res.action === 'open-link' ||
      res.action === 'fill-otp-and-open-link';
    if (s.label.action === 'ignore' || s.label.action === 'show-review') {
      totalNoneOrReview += 1;
      if (predAuto) {
        falseAutoAct += 1;
        if (testErrors.length < 15) {
          testErrors.push(
            `FALSE_AUTO_ACT ${s.id} (${s.source}/${s.category}): expected=${s.label.action}, got=${res.action}, intent=${res.intent}, otp=${res.bestOtp?.candidate.code ?? null}`
          );
        }
      }
    }

    otpTotal += 1;
    const predOtpCode = res.bestOtp?.candidate.code ?? null;
    if (s.label.otp === null) {
      otpNullTotal += 1;
      if (predOtpCode !== null) {
        otpFalsePos += 1;
      } else {
        otpExact += 1;
      }
    } else if (predOtpCode?.toUpperCase() === s.label.otp.toUpperCase()) {
      otpExact += 1;
    }

    linkTotal += 1;
    const predLinkUrl = res.bestLink?.candidate.url ?? null;
    if (s.label.linkSubstring === null) {
      linkNullTotal += 1;
      if (predLinkUrl !== null && !res.ambiguousDualLinks) {
        linkFalsePos += 1;
      } else {
        linkExact += 1;
      }
    } else if (predLinkUrl && predLinkUrl.includes(s.label.linkSubstring)) {
      linkExact += 1;
    }
  }

  const intentAcc = intentConfusion.reduce((sum, row, i) => sum + row[i]!, 0) / testSamples.length;
  const actionAcc = actionConfusion.reduce((sum, row, i) => sum + row[i]!, 0) / testSamples.length;
  const intentMacroF1 = computeMacroF1(intentConfusion, INTENT_CLASSES);
  const actionMacroF1 = computeMacroF1(actionConfusion, ACTION_CLASSES);
  const intentEce = computeEce(intentCalib);
  const actionEce = computeEce(actionCalib);
  const falseAutoActRate = falseAutoAct / Math.max(1, totalNoneOrReview);

  inferTimesMs.sort((a, b) => a - b);
  totalTimesMs.sort((a, b) => a - b);

  // ── 34 Hard Semantic, Discourse & Adversarial Cases ─────────────────────
  const fixturesPath = path.resolve(process.cwd(), 'tests/fixtures/ghostnet-hard-cases.jsonl');
  const lines = fs
    .readFileSync(fixturesPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const hardCases = lines.map((l) => JSON.parse(l) as HardCaseFixture);
  let hardPassed = 0;
  let hardSafetyViolations = 0;
  const hardFailures: string[] = [];

  for (const hc of hardCases) {
    const doc = compileEmailDocument(hc.subject, hc.body, hc.html, hc.sender, hc.expectedDomains);
    const res = runGhostNet(
      doc,
      {
        expectedDomains: hc.expectedDomains,
        originUrl: hc.originUrl,
        pageExpectation: hc.pageExpectation,
      },
      net
    );

    const intentOk = res.intent === hc.expect.intent;
    const actionOk = res.action === hc.expect.action;
    const effOtp =
      res.action === 'ignore' || res.action === 'show-review'
        ? null
        : (res.bestOtp?.candidate.code ?? null);
    const effLink =
      res.action === 'ignore' || res.action === 'show-review'
        ? null
        : (res.bestLink?.candidate.url ?? null);

    const otpOk =
      hc.expect.otp === null
        ? effOtp === null
        : effOtp?.toUpperCase() === hc.expect.otp.toUpperCase();
    const linkOk = hc.expect.link === null ? effLink === null : effLink === hc.expect.link;

    if (
      (hc.expect.action === 'ignore' || hc.expect.action === 'show-review') &&
      (effOtp !== null ||
        effLink !== null ||
        (res.action !== 'ignore' && res.action !== 'show-review'))
    ) {
      hardSafetyViolations += 1;
    }

    if (intentOk && actionOk && otpOk && linkOk) {
      hardPassed += 1;
    } else {
      hardFailures.push(
        `FAIL ${hc.id} (${hc.desc}): got {intent:${res.intent}, otp:${effOtp}, link:${effLink}, action:${res.action}} vs expect ${JSON.stringify(hc.expect)}`
      );
    }
  }

  console.log('────────────────────────────────────────────────────────────────');
  console.log(`GhostNet v2 Evaluation Report (Held-out Test N=${testSamples.length})`);
  console.log('────────────────────────────────────────────────────────────────');
  console.log(
    `Intent Accuracy    : ${(intentAcc * 100).toFixed(2)}% | Macro-F1: ${intentMacroF1.toFixed(4)} | ECE: ${intentEce.toFixed(4)}`
  );
  console.log(
    `OTP Exact Accuracy : ${((otpExact / otpTotal) * 100).toFixed(2)}% | False OTP Rate on Null: ${((otpFalsePos / Math.max(1, otpNullTotal)) * 100).toFixed(2)}%`
  );
  console.log(
    `Link Exact Accuracy: ${((linkExact / linkTotal) * 100).toFixed(2)}% | False Link Rate on Null: ${((linkFalsePos / Math.max(1, linkNullTotal)) * 100).toFixed(2)}%`
  );
  console.log(
    `Action Accuracy    : ${(actionAcc * 100).toFixed(2)}% | Macro-F1: ${actionMacroF1.toFixed(4)} | ECE: ${actionEce.toFixed(4)}`
  );
  console.log(
    `False Auto-Act Rate: ${(falseAutoActRate * 100).toFixed(3)}% (${falseAutoAct}/${totalNoneOrReview})`
  );
  console.log(
    `Neural Latency (ms): P50=${percentile(inferTimesMs, 50).toFixed(3)} P95=${percentile(inferTimesMs, 95).toFixed(3)} P99=${percentile(inferTimesMs, 99).toFixed(3)}`
  );
  console.log(
    `End-to-End AST+Net : P50=${percentile(totalTimesMs, 50).toFixed(3)} P95=${percentile(totalTimesMs, 95).toFixed(3)} P99=${percentile(totalTimesMs, 99).toFixed(3)}`
  );
  console.log(
    `Hard-Case Suite    : ${hardPassed}/${hardCases.length} passed (safetyViolations=${hardSafetyViolations})`
  );
  if (testErrors.length > 0) {
    console.log('\nSample False Auto-Act Test Errors:');
    for (const err of testErrors) {
      console.log(`  - ${err}`);
    }
  }
  if (hardFailures.length > 0) {
    console.log('\nHard Case Failures:');
    for (const fail of hardFailures) {
      console.log(`  - ${fail}`);
    }
  }
  console.log('────────────────────────────────────────────────────────────────');

  const gatesPassed =
    actionAcc >= 0.96 &&
    actionMacroF1 >= 0.95 &&
    otpExact / otpTotal >= 0.97 &&
    falseAutoActRate <= 0.004 &&
    intentEce <= 0.05 &&
    actionEce <= 0.05 &&
    percentile(totalTimesMs, 95) < 4.5 &&
    percentile(inferTimesMs, 50) < 2.0 &&
    hardSafetyViolations === 0 &&
    hardPassed >= Math.max(33, hardCases.length - 1);

  if (!gatesPassed) {
    console.error('[GhostNet Eval] Quality gates FAILED.');
    process.exit(1);
  }
  console.log('[GhostNet Eval] All quality, calibration, safety & latency gates PASSED.');
}

main().catch((err) => {
  console.error('[GhostNet Eval] Failed:', err);
  process.exit(1);
});
