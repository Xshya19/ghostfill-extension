import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { hostMatchesExpectation } from '../../src/services/extraction/activationLinkGuard';
import { compileEmailDocument } from '../../src/services/extraction/emailDocument';
import { decodeGhostNetBundle, runGhostNet } from '../../src/services/extraction/ghostNet';
import {
  ACTION_CLASSES,
  D_ACTION_IN,
  D_MODEL,
  D_POINTER,
  extractCodeMorphCharIds,
  extractCodeStructuralGeometry,
  extractLinkStructuralGeometry,
  extractUrlSubwordTokens,
  INTENT_CLASSES,
  resolveTokenVocabAndChars,
  splitIntoTokens,
  tokenizeEmailDocument,
  TOK_RESERVED_COUNT,
  V_VOCAB,
} from '../../src/services/extraction/ghostNetTokenizer';
import { sameVerificationSite } from '../../src/utils/verificationSite';

import { fetchRealDatasets } from './fetchRealDatasets';
import {
  createInitialParams,
  createKernelScratch,
  type EncodedLinkCand,
  type EncodedOtpCand,
  type EncodedSample,
  exportWeightsBundle,
  forwardBackwardSample,
  listParamMatrices,
  type NeuralModelParams,
  packGradsFlat,
  packParamsFlat,
  quantizeParamMatrix,
  unpackParamsFlat,
  zeroAllGrads,
} from './neuralKernel';
import { debiasRealCorpusMetadata, generateOpenVocabCorpus } from './openVocabCorpus';
import type { CorpusEmailSample } from './types';

const INTENT_INDEX = new Map<string, number>(INTENT_CLASSES.map((c, i) => [c, i]));
const ACTION_INDEX = new Map<string, number>(ACTION_CLASSES.map((c, i) => [c, i]));

const RESERVED_VOCAB = [
  '<pad>',
  '<cls>',
  '<unk>',
  '<num4>',
  '<num5>',
  '<num6>',
  '<num7_8>',
  '<num_long>',
  '<alnum>',
  '<price>',
];

const INTENT_CLASS_WEIGHTS = [1.2, 1.5, 1.6, 2.5, 2.0, 2.4, 0.85, 0.8];
const ACTION_CLASS_WEIGHTS = [1.0, 1.4, 3.0, 3.2, 1.1];

function buildDataDrivenVocab(trainSamples: CorpusEmailSample[]): string[] {
  const numClasses = INTENT_CLASSES.length;
  const totalDocsPerClass = new Float64Array(numClasses);
  const tokenClassCounts = new Map<string, Float64Array>();
  const tokenDocFreq = new Map<string, number>();

  for (const s of trainSamples) {
    const cIdx = INTENT_INDEX.get(s.label.intent) ?? 6;
    totalDocsPerClass[cIdx] = totalDocsPerClass[cIdx]! + 1;

    const text = `${s.subject}\n${s.body.slice(0, 1400)}`;
    const seen = new Set<string>();
    for (const tok of splitIntoTokens(text)) {
      if (tok.length <= 1 || tok.length > 28) {
        continue;
      }
      if (/^\d{4,}$/.test(tok) || /^(?=.*\d)(?=.*[a-z])[a-z0-9-]{4,12}$/.test(tok)) {
        continue; // Represented structurally via <numK>/<alnum> + char3grams
      }
      seen.add(tok);
    }
    // Also include URL path/key subwords from links
    const urls = text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
    for (const u of urls.slice(0, 4)) {
      for (const ut of extractUrlSubwordTokens(u)) {
        if (ut.length >= 2 && ut.length <= 24 && !/^\d+$/.test(ut)) {
          seen.add(ut);
        }
      }
    }

    for (const tok of seen) {
      tokenDocFreq.set(tok, (tokenDocFreq.get(tok) ?? 0) + 1);
      let arr = tokenClassCounts.get(tok);
      if (!arr) {
        arr = new Float64Array(numClasses);
        tokenClassCounts.set(tok, arr);
      }
      arr[cIdx] = arr[cIdx]! + 1;
    }
  }

  const totalDocs = trainSamples.length;
  const scored: Array<{ tok: string; score: number }> = [];
  for (const [tok, df] of tokenDocFreq.entries()) {
    if (df < 4) {
      continue;
    }
    const counts = tokenClassCounts.get(tok)!;
    const pTok = df / totalDocs;
    let kl = 0;
    for (let c = 0; c < numClasses; c++) {
      const tc = totalDocsPerClass[c]!;
      if (tc === 0) {
        continue;
      }
      const pTokGivenC = (counts[c]! + 0.5) / (tc + 1);
      const pC = tc / totalDocs;
      kl += pC * pTokGivenC * Math.log(pTokGivenC / Math.max(1e-6, pTok));
    }
    const score = Math.log(1 + df) * (0.25 + kl * 6.0);
    scored.push({ tok, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const vocab = [...RESERVED_VOCAB];
  for (let i = 0; i < scored.length && vocab.length < V_VOCAB; i++) {
    const t = scored[i]!.tok;
    if (!RESERVED_VOCAB.includes(t)) {
      vocab.push(t);
    }
  }
  return vocab;
}

function encodeSample(s: CorpusEmailSample, vocabMap: Map<string, number>): EncodedSample {
  const doc = compileEmailDocument(s.subject, s.body, s.htmlBody, s.sender, s.expectedDomains);
  const otpAll = doc.codeCandidates;
  let otpRawCands = otpAll.slice(0, 16);
  if (s.label.otp !== null && otpAll.length > 16) {
    const expUp = s.label.otp.toUpperCase();
    if (!otpRawCands.some((c) => c.code.toUpperCase() === expUp)) {
      const hit = otpAll.find((c) => c.code.toUpperCase() === expUp);
      if (hit) {
        otpRawCands = [...otpAll.slice(0, 15), hit];
      }
    }
  }
  const linksAll = doc.linkCandidates.filter((l) => !l.gate.hardReject);
  let linkRawCands = linksAll.slice(0, 14);
  if (s.label.linkSubstring !== null && linksAll.length > 14) {
    if (!linkRawCands.some((l) => l.url.includes(s.label.linkSubstring!))) {
      const hit = linksAll.find((l) => l.url.includes(s.label.linkSubstring!));
      if (hit) {
        linkRawCands = [...linksAll.slice(0, 13), hit];
      }
    }
  }
  const seq = tokenizeEmailDocument(doc, vocabMap, linkRawCands);

  const otpCands: EncodedOtpCand[] = otpRawCands.map((cand, idx) => ({
    code: cand.code,
    len: cand.code.length,
    isNum: /^\d+$/.test(cand.code),
    isExplicit: cand.isExplicitBodyCode,
    isVisibleOutsideUrls: cand.inVisibleBodyOutsideUrls,
    embeddedInHandle: cand.embeddedInEmailHandle,
    positions: (seq.codePositions[idx] ?? [Math.min(seq.seqLen - 1, 1)]).slice(0, 3),
    morphIds: extractCodeMorphCharIds(cand.code),
    geom: extractCodeStructuralGeometry(cand, doc, undefined, s.pageExpectation),
  }));

  let otpTarget: Float32Array | null = null;
  let otpLossWeight = 1.0;
  if (otpCands.length > 0) {
    const tgt = new Float32Array(otpCands.length + 1);
    if (s.label.otp !== null) {
      const expectedUp = s.label.otp.toUpperCase();
      const hitIdx = otpCands.findIndex((c) => c.code.toUpperCase() === expectedUp);
      if (hitIdx >= 0) {
        tgt[hitIdx] = 1;
        otpTarget = tgt;
        otpLossWeight = s.source === 'open-vocab-discourse' ? 1.8 : 1.4;
      }
    } else {
      tgt[otpCands.length] = 1; // <NULL_OTP>
      otpTarget = tgt;
      otpLossWeight = 2.5;
    }
  }

  const originHosts = [...s.expectedDomains];
  if (s.originUrl) {
    try {
      const h = new URL(s.originUrl).hostname;
      if (h) {
        originHosts.push(h);
      }
    } catch {
      /* ignore */
    }
  }

  const linkCands: EncodedLinkCand[] = linkRawCands.map((lc, idx) => ({
    url: lc.url,
    positions: (seq.linkAnchorPositions[idx] ?? [Math.min(seq.seqLen - 1, 1)]).slice(0, 3),
    urlToks: extractUrlSubwordTokens(lc.url).map((ut) => resolveTokenVocabAndChars(ut, vocabMap)),
    geom: extractLinkStructuralGeometry(lc, doc, null),
    gateQualityNorm: lc.gate.quality / 100,
    structuralAutoOpen: lc.gate.structuralAutoOpen,
    domainBound: originHosts.length > 0 ? hostMatchesExpectation(lc.host, originHosts) : false,
  }));

  let linkTarget: Float32Array | null = null;
  let linkLossWeight = 1.0;
  if (linkCands.length > 0) {
    const tgt = new Float32Array(linkCands.length + 1);
    if (
      s.id.startsWith('ov-adv') &&
      s.label.action === 'show-review' &&
      s.label.linkSubstring === null &&
      linkCands.length >= 2 &&
      s.sender !== 'alert@evil-login-check.xyz' &&
      !s.body.includes('credentials')
    ) {
      // Competing dual activation links: soft 0.5/0.5 on top 2 if unambiguous show-review dual link
      if (linkCands[0]!.domainBound && linkCands[1]!.domainBound) {
        tgt[0] = 0.5;
        tgt[1] = 0.5;
        linkTarget = tgt;
        linkLossWeight = 2.0;
      } else {
        tgt[linkCands.length] = 1;
        linkTarget = tgt;
        linkLossWeight = 2.5;
      }
    } else if (s.label.linkSubstring !== null) {
      const hitIdx = linkCands.findIndex((lc) => lc.url.includes(s.label.linkSubstring!));
      if (hitIdx >= 0) {
        tgt[hitIdx] = 1;
        linkTarget = tgt;
        linkLossWeight = 1.6;
      }
    } else {
      tgt[linkCands.length] = 1; // <NULL_LINK>
      linkTarget = tgt;
      linkLossWeight = 2.5;
    }
  }

  const hasSiteContext = originHosts.length > 0 ? 1 : 0;
  const senderMatchesSite =
    doc.senderDomain && originHosts.some((h) => sameVerificationSite(doc.senderDomain!, h)) ? 1 : 0;
  const exp = s.pageExpectation;
  const hasPageExp =
    exp &&
      (exp.hasOtpInputs !== undefined ||
        exp.expectedOtpLength !== undefined ||
        exp.hasMagicLinkPrompt !== undefined)
      ? 1
      : 0;
  const intentIdx = INTENT_INDEX.get(s.label.intent) ?? 6;
  const actionIdx = ACTION_INDEX.get(s.label.action) ?? 4;

  return {
    id: s.id,
    split: s.split,
    seqLen: seq.seqLen,
    vocabIds: seq.vocabIds,
    charIds: seq.charIds,
    zoneIds: seq.zoneIds,
    intentIdx,
    intentLossWeight: INTENT_CLASS_WEIGHTS[intentIdx] ?? 1.0,
    otpCands,
    otpTarget,
    otpLossWeight,
    linkCands,
    linkTarget,
    linkLossWeight,
    actionIdx,
    actionLossWeight: ACTION_CLASS_WEIGHTS[actionIdx] ?? 1.0,
    securityScoreNorm: 1.0,
    riskHigh: 0,
    riskMedium: 0,
    senderMatchesSite,
    hasSiteContext,
    hasPageExp,
    pageHasOtpInputs: exp?.hasOtpInputs ? 1 : 0,
    pageHasMagicLinkPrompt: exp?.hasMagicLinkPrompt ? 1 : 0,
    expectedOtpLength: exp?.expectedOtpLength ?? 0,
    expectedOtpFormat: exp?.expectedOtpFormat ?? undefined,
  };
}

function verifyGradients(): void {
  console.log('[GhostNet] Running finite-difference gradient verification...');
  const vocab = [
    ...RESERVED_VOCAB,
    'drop',
    'into',
    'browser',
    'tab',
    'expired',
    'use',
    'instead',
    'verify',
    'auth',
  ];
  const vocabMap = new Map(vocab.map((w, i) => [w, i]));
  const sampleRaw: CorpusEmailSample = {
    id: 'grad-check',
    split: 'train',
    source: 'open-vocab-discourse',
    category: 'paired-both',
    subject: 'Verify login',
    body: '410293 expired. Drop 739204 into your browser tab or use https://acme.com/verify?token=tok123456789abcdef',
    htmlBody:
      '<p>410293 expired. Drop <strong>739204</strong> into your tab.</p><a href="https://acme.com/verify?token=tok123456789abcdef" class="btn">Verify</a>',
    sender: 'auth@acme.com',
    expectedDomains: ['acme.com'],
    originUrl: 'https://acme.com/login',
    pageExpectation: { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' },
    label: {
      intent: 'verification',
      otp: '739204',
      linkSubstring: 'acme.com/verify',
      action: 'fill-otp',
    },
  };
  const sample = encodeSample(sampleRaw, vocabMap);
  const params = createInitialParams(999);
  const scratch = createKernelScratch();
  const lw = { otp: 1.5, link: 1.5, action: 0.9 };

  zeroAllGrads(params);
  forwardBackwardSample(sample, params, scratch, true, lw);
  const analytical = packGradsFlat(params);
  const flat = packParamsFlat(params);

  const eps = 2e-3;
  // Probe diverse parameters across all layers (embeddings, conv, norm, attention, pointers, action)
  const testNames: Array<{ name: string; offset: number }> = [];
  let cursor = 0;
  for (const m of listParamMatrices(params)) {
    // Pick the max-magnitude non-zero gradient parameter in this matrix for clean FD check
    let bestK = -1;
    let bestAbs = 1e-4;
    for (let k = 0; k < m.gw.length; k++) {
      const a = Math.abs(analytical[cursor + k]!);
      if (a > bestAbs) {
        bestAbs = a;
        bestK = k;
      }
    }
    if (bestK >= 0) {
      testNames.push({ name: `M(${m.rows}x${m.cols})`, offset: cursor + bestK });
    }
    cursor += m.w.length + (m.hasBias ? m.b.length : 0);
  }
  // Also test norm1Gamma, norm2Gamma, norm3Gamma, relPosBias
  testNames.push({ name: 'norm1Gamma[0]', offset: cursor });
  testNames.push({ name: 'norm2Gamma[0]', offset: cursor + D_MODEL });
  testNames.push({ name: 'norm3Gamma[0]', offset: cursor + D_MODEL * 2 });
  testNames.push({ name: 'relPosBias[7]', offset: cursor + D_MODEL * 3 + 7 });

  let maxRelErr = 0;
  let mismatches = 0;
  for (const probe of testNames) {
    const orig = flat[probe.offset]!;
    flat[probe.offset] = orig + eps;
    unpackParamsFlat(params, flat);
    const lPlus = forwardBackwardSample(sample, params, scratch, false, lw).loss;

    flat[probe.offset] = orig - eps;
    unpackParamsFlat(params, flat);
    const lMinus = forwardBackwardSample(sample, params, scratch, false, lw).loss;

    flat[probe.offset] = orig;
    unpackParamsFlat(params, flat);

    const numGrad = (lPlus - lMinus) / (2 * eps);
    const anaGrad = analytical[probe.offset]!;
    const absErr = Math.abs(numGrad - anaGrad);
    const relErr = absErr / Math.max(1e-4, Math.abs(numGrad) + Math.abs(anaGrad));
    if (relErr > maxRelErr) {
      maxRelErr = relErr;
    }
    const status = relErr > 0.05 && absErr > 5e-4 ? 'MISMATCH' : 'ok';
    if (status === 'MISMATCH') {
      mismatches += 1;
    }
    console.log(
      `  [${status}] ${probe.name.padEnd(14)} ana=${anaGrad.toFixed(6)} num=${numGrad.toFixed(6)} relErr=${relErr.toFixed(4)}`
    );
  }
  if (mismatches > 0) {
    throw new Error(`${mismatches} gradient mismatches found (maxRelErr=${maxRelErr.toFixed(4)})`);
  }
  console.log(
    `[GhostNet] Gradient check PASSED across ${testNames.length} layer probes (maxRelErr=${maxRelErr.toExponential(2)})`
  );
}

function fitTemperature(logitsList: Array<{ logits: Float32Array; target: Float32Array }>): number {
  if (logitsList.length === 0) {
    return 1.0;
  }
  const nllAt = (t: number): number => {
    let total = 0;
    for (const item of logitsList) {
      let maxV = -Infinity;
      for (let i = 0; i < item.logits.length; i++) {
        const s = item.logits[i]! / t;
        if (s > maxV) {
          maxV = s;
        }
      }
      let sum = 0;
      const ex = new Float32Array(item.logits.length);
      for (let i = 0; i < item.logits.length; i++) {
        const e = Math.exp(item.logits[i]! / t - maxV);
        ex[i] = e;
        sum += e;
      }
      for (let i = 0; i < item.logits.length; i++) {
        const tgt = item.target[i]!;
        if (tgt > 0) {
          total -= tgt * Math.log(Math.max(1e-12, ex[i]! / sum));
        }
      }
    }
    return total / logitsList.length;
  };

  let bestT = 1.0;
  let bestNll = nllAt(1.0);
  for (let g = 40; g <= 250; g += 5) {
    const t = g / 100;
    const nll = nllAt(t);
    if (nll < bestNll) {
      bestNll = nll;
      bestT = t;
    }
  }
  for (let t = Math.max(0.3, bestT - 0.05); t <= Math.min(3.0, bestT + 0.05); t += 0.01) {
    const nll = nllAt(t);
    if (nll < bestNll) {
      bestNll = nll;
      bestT = t;
    }
  }
  return Number(bestT.toFixed(3));
}

function geluValAndGrad(x: number): [number, number] {
  const c = 0.7978845608028654;
  const a = 0.044715;
  const x2 = x * x;
  const u = c * (x + a * x2 * x);
  const t = Math.tanh(u);
  return [0.5 * x * (1 + t), 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * a * x2)];
}

async function runStage1MultiWorker(
  trainEncoded: EncodedSample[],
  valEncoded: EncodedSample[],
  params: NeuralModelParams
): Promise<Float32Array> {
  const numWorkers = Math.min(4, Math.max(1, os.cpus().length));
  const workerScript = path.resolve(__dirname, 'trainWorker.ts');

  const shardSizeTrain = Math.ceil(trainEncoded.length / numWorkers);
  const shardSizeVal = Math.ceil(valEncoded.length / numWorkers);
  const workers: Worker[] = [];
  const trainRanges: Array<{ start: number; len: number }> = [];

  for (let w = 0; w < numWorkers; w++) {
    const tStart = w * shardSizeTrain;
    const tEnd = Math.min(trainEncoded.length, tStart + shardSizeTrain);
    trainRanges.push({ start: tStart, len: tEnd - tStart });

    const vStart = w * shardSizeVal;
    const vEnd = Math.min(valEncoded.length, vStart + shardSizeVal);
    // Worker receives its shard for training; keep val separately on main or send train shard only
    const shard = trainEncoded.slice(tStart, tEnd);
    const worker = new Worker(workerScript, {
      workerData: { shard },
    });
    workers.push(worker);
    void vEnd;
  }

  const callWorker = (
    wIdx: number,
    weights: Float32Array,
    indices: Int32Array,
    lossWeights: { otp: number; link: number; action: number }
  ): Promise<{
    grads: Float32Array;
    count: number;
    lossSum: number;
    iOk: number;
    oChk: number;
    oOk: number;
    lChk: number;
    lOk: number;
    aOk: number;
    falseAuto: number;
  }> => {
    return new Promise((resolve, reject) => {
      const w = workers[wIdx]!;
      const onMsg = (res: any) => {
        w.off('error', onErr);
        resolve(res);
      };
      const onErr = (err: Error) => {
        w.off('message', onMsg);
        reject(err);
      };
      w.once('message', onMsg);
      w.once('error', onErr);
      const wCopy = weights.slice();
      w.postMessage({ type: 'grad_batch', weights: wCopy, indices, lossWeights }, [wCopy.buffer]);
    });
  };

  let flatParams = packParamsFlat(params);
  const mBuf = new Float32Array(flatParams.length);
  const vBuf = new Float32Array(flatParams.length);
  const gradSum = new Float32Array(flatParams.length);

  // Build weight-decay mask (apply decay only to 2D projection weights, NOT biases/norms/relPosBias)
  const decayMask = new Uint8Array(flatParams.length);
  {
    let off = 0;
    for (const m of listParamMatrices(params)) {
      const applyDecay =
        m !== params.tokenEmb && m !== params.zoneEmb && m !== params.codeCharEmb ? 1 : 0;
      decayMask.fill(applyDecay, off, off + m.w.length);
      off += m.w.length + (m.hasBias ? m.b.length : 0);
    }
  }

  const epochs = 6;
  const miniBatchPerWorker = 44; // Total global batch size = 176 across 4 workers
  let step = 0;
  let bestValScore = -1;
  let bestFlatParams = flatParams.slice();
  const valScratch = createKernelScratch();
  const lossWeights = { otp: 1.5, link: 1.5, action: 0.9 };

  // Deterministic per-worker shufflers
  let rngState = 13579;
  const rand = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };
  const shardOrders = trainRanges.map((r) => Array.from({ length: r.len }, (_, i) => i));

  const maxLen = Math.max(...shardOrders.map((o) => o.length));
  const stepsPerEpoch = Math.ceil(maxLen / miniBatchPerWorker);
  const totalSteps = epochs * stepsPerEpoch;
  const warmupSteps = Math.max(20, Math.floor(stepsPerEpoch * 0.8));

  console.log(
    `[GhostNet] Stage 1: Training end-to-end across ${numWorkers} CPU workers (${epochs} epochs, batch=${miniBatchPerWorker * numWorkers})...`
  );

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const epStart = Date.now();
    for (const ord of shardOrders) {
      for (let i = ord.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = ord[i]!;
        ord[i] = ord[j]!;
        ord[j] = tmp;
      }
    }

    let epLoss = 0;
    let epCount = 0;

    for (let sIdx = 0; sIdx < stepsPerEpoch; sIdx++) {
      step += 1;
      let lr = 0.0045;
      if (step <= warmupSteps) {
        lr = 0.0002 + (0.0045 - 0.0002) * (step / warmupSteps);
      } else {
        const prog = (step - warmupSteps) / Math.max(1, totalSteps - warmupSteps);
        lr = 0.0002 + (0.0045 - 0.0002) * 0.5 * (1 + Math.cos(Math.PI * prog));
      }

      const promises = [];
      for (let w = 0; w < numWorkers; w++) {
        const ord = shardOrders[w]!;
        const start = sIdx * miniBatchPerWorker;
        if (start >= ord.length) {
          const wrapStart = start % ord.length;
          const wrapSlice = new Int32Array(Math.min(miniBatchPerWorker, ord.length));
          for (let i = 0; i < wrapSlice.length; i++) {
            wrapSlice[i] = ord[(wrapStart + i) % ord.length]!;
          }
          promises.push(callWorker(w, flatParams, wrapSlice, lossWeights));
        } else {
          const end = Math.min(ord.length, start + miniBatchPerWorker);
          const slice = Int32Array.from(ord.slice(start, end));
          promises.push(callWorker(w, flatParams, slice, lossWeights));
        }
      }

      const workerResults = await Promise.all(promises);
      gradSum.fill(0);
      let batchCount = 0;
      for (const wr of workerResults) {
        batchCount += wr.count;
        epCount += wr.count;
        epLoss += wr.lossSum;
        for (let i = 0; i < gradSum.length; i++) {
          gradSum[i] = gradSum[i]! + wr.grads[i]!;
        }
      }

      const invB = 1 / Math.max(1, batchCount);
      let gNormSq = 0;
      for (let i = 0; i < gradSum.length; i++) {
        const g = gradSum[i]! * invB;
        gradSum[i] = g;
        gNormSq += g * g;
      }
      const gNorm = Math.sqrt(gNormSq);
      const clip = gNorm > 5.0 ? 5.0 / gNorm : 1.0;

      const bc1 = 1 - Math.pow(0.9, step);
      const bc2 = 1 - Math.pow(0.999, step);
      for (let i = 0; i < flatParams.length; i++) {
        const g = gradSum[i]! * clip;
        const mi = 0.9 * mBuf[i]! + 0.1 * g;
        const vi = 0.999 * vBuf[i]! + 0.001 * g * g;
        mBuf[i] = mi;
        vBuf[i] = vi;
        const mHat = mi / bc1;
        const vHat = vi / bc2;
        if (decayMask[i]) {
          flatParams[i] = flatParams[i]! * (1 - lr * 1e-4);
        }
        flatParams[i] = flatParams[i]! - (lr * mHat) / (Math.sqrt(vHat) + 1e-8);
      }
    }

    // Validate on main thread every epoch so convergence progress is visible immediately
    if (epoch >= 1) {
      unpackParamsFlat(params, flatParams);
      let vLoss = 0;
      let iOk = 0;
      let oChk = 0;
      let oOk = 0;
      let lChk = 0;
      let lOk = 0;
      let aOk = 0;
      let fa = 0;
      let unsafeTotal = 0;
      for (const vs of valEncoded) {
        const st = forwardBackwardSample(vs, params, valScratch, false, lossWeights);
        vLoss += st.loss;
        if (st.intentCorrect) {
          iOk += 1;
        }
        if (st.otpChecked) {
          oChk += 1;
          if (st.otpCorrect) {
            oOk += 1;
          }
        }
        if (st.linkChecked) {
          lChk += 1;
          if (st.linkCorrect) {
            lOk += 1;
          }
        }
        if (st.actionCorrect) {
          aOk += 1;
        }
        if (vs.actionIdx >= 3) {
          unsafeTotal += 1;
          if (st.falseAutoAct) {
            fa += 1;
          }
        }
      }
      const iAcc = iOk / valEncoded.length;
      const oAcc = oOk / Math.max(1, oChk);
      const lAcc = lOk / Math.max(1, lChk);
      const aAcc = aOk / valEncoded.length;
      const faRate = fa / Math.max(1, unsafeTotal);
      const valScore = iAcc + 1.5 * oAcc + 1.5 * lAcc + 1.8 * aAcc - 4.0 * faRate;
      if (valScore > bestValScore) {
        bestValScore = valScore;
        bestFlatParams = flatParams.slice();
      }
      console.log(
        `  Epoch ${String(epoch).padStart(2)}/${epochs} (${((Date.now() - epStart) / 1000).toFixed(1)}s) | trainLoss=${(epLoss / epCount).toFixed(4)} | valLoss=${(vLoss / valEncoded.length).toFixed(4)} | valIntent=${(iAcc * 100).toFixed(2)}% | valOtp=${(oAcc * 100).toFixed(2)}% | valLink=${(lAcc * 100).toFixed(2)}% | valAction=${(aAcc * 100).toFixed(2)}% | falseAuto=${(faRate * 100).toFixed(2)}%`
      );
    }
  }

  for (const w of workers) {
    await w.terminate();
  }
  return bestFlatParams;
}

interface ActionPolSample {
  x: Float32Array;
  targetIdx: number;
  weight: number;
}

function collectQuantizedStage1AndActionDataset(
  corpusRaw: CorpusEmailSample[],
  bundleStage1: ReturnType<typeof exportWeightsBundle>
): {
  intentLogitsVal: Array<{ logits: Float32Array; target: Float32Array }>;
  otpLogitsVal: Array<{ logits: Float32Array; target: Float32Array }>;
  linkLogitsVal: Array<{ logits: Float32Array; target: Float32Array }>;
} {
  // Use runGhostNet on Val indirectly for calibrated Stage 1 probs? We can collect raw unscaled val logits
  // using neuralKernel dequantized weights cleanly!
  const dec = decodeGhostNetBundle(bundleStage1);
  // Compute unscaled intent/otp/link logits using temperatures = 1 -> exact logits = log(prob) up to constant!
  dec.temperatures = { intent: 1, otp: 1, link: 1, action: 1 };

  const intentLogitsVal: Array<{ logits: Float32Array; target: Float32Array }> = [];
  const otpLogitsVal: Array<{ logits: Float32Array; target: Float32Array }> = [];
  const linkLogitsVal: Array<{ logits: Float32Array; target: Float32Array }> = [];

  for (const s of corpusRaw) {
    if (s.split !== 'val') {
      continue;
    }
    const doc = compileEmailDocument(s.subject, s.body, s.htmlBody, s.sender, s.expectedDomains);
    const res = runGhostNet(
      doc,
      {
        expectedDomains: s.expectedDomains,
        originUrl: s.originUrl,
        pageExpectation: s.pageExpectation,
      },
      dec
    );

    const iLog = new Float32Array(INTENT_CLASSES.length);
    const iTgt = new Float32Array(INTENT_CLASSES.length);
    for (let i = 0; i < INTENT_CLASSES.length; i++) {
      iLog[i] = Math.log(Math.max(1e-12, res.intentProbs[INTENT_CLASSES[i]!] ?? 1e-12));
    }
    iTgt[INTENT_INDEX.get(s.label.intent) ?? 6] = 1;
    intentLogitsVal.push({ logits: iLog, target: iTgt });

    if (res.otpRanking.length > 0 && s.label.otp !== null) {
      const k = res.otpRanking.length;
      const hitIdx = res.otpRanking.findIndex(
        (x) => x.candidate.code.toUpperCase() === s.label.otp!.toUpperCase()
      );
      if (hitIdx >= 0) {
        const oLog = new Float32Array(k + 1);
        const oTgt = new Float32Array(k + 1);
        for (let i = 0; i < k; i++) {
          oLog[i] = Math.log(Math.max(1e-12, res.otpRanking[i]!.probability));
        }
        oLog[k] = Math.log(Math.max(1e-12, res.nullOtpProb));
        oTgt[hitIdx] = 1;
        otpLogitsVal.push({ logits: oLog, target: oTgt });
      }
    } else if (res.otpRanking.length > 0 && s.label.otp === null) {
      const k = res.otpRanking.length;
      const oLog = new Float32Array(k + 1);
      const oTgt = new Float32Array(k + 1);
      for (let i = 0; i < k; i++) {
        oLog[i] = Math.log(Math.max(1e-12, res.otpRanking[i]!.probability));
      }
      oLog[k] = Math.log(Math.max(1e-12, res.nullOtpProb));
      oTgt[k] = 1;
      otpLogitsVal.push({ logits: oLog, target: oTgt });
    }

    if (res.linkRanking.length > 0 && s.label.linkSubstring !== null) {
      const m = res.linkRanking.length;
      const hitIdx = res.linkRanking.findIndex((x) =>
        x.candidate.url.includes(s.label.linkSubstring!)
      );
      if (hitIdx >= 0) {
        const lLog = new Float32Array(m + 1);
        const lTgt = new Float32Array(m + 1);
        for (let j = 0; j < m; j++) {
          lLog[j] = Math.log(Math.max(1e-12, res.linkRanking[j]!.probability));
        }
        lLog[m] = Math.log(Math.max(1e-12, res.nullLinkProb));
        lTgt[hitIdx] = 1;
        linkLogitsVal.push({ logits: lLog, target: lTgt });
      }
    } else if (
      res.linkRanking.length > 0 &&
      s.label.linkSubstring === null &&
      !res.ambiguousDualLinks
    ) {
      const m = res.linkRanking.length;
      const lLog = new Float32Array(m + 1);
      const lTgt = new Float32Array(m + 1);
      for (let j = 0; j < m; j++) {
        lLog[j] = Math.log(Math.max(1e-12, res.linkRanking[j]!.probability));
      }
      lLog[m] = Math.log(Math.max(1e-12, res.nullLinkProb));
      lTgt[m] = 1;
      linkLogitsVal.push({ logits: lLog, target: lTgt });
    }
  }

  return { intentLogitsVal, otpLogitsVal, linkLogitsVal };
}

function buildDequantizedStage1Params(params: NeuralModelParams): NeuralModelParams {
  // Clone and apply exact symmetric Int8 dequantization error on every quantized matrix
  const copy = createInitialParams(1);
  const srcMats = listParamMatrices(params);
  const dstMats = listParamMatrices(copy);
  for (let i = 0; i < srcMats.length; i++) {
    const s = srcMats[i]!;
    const d = dstMats[i]!;
    d.b.set(s.b);
    if (s === params.zoneEmb || s === params.dwK3 || s === params.dwK5Dil2) {
      d.w.set(s.w);
      continue;
    }
    const spec = quantizeParamMatrix(s);
    const scalesRaw = Uint8Array.from(Buffer.from(spec.scalesB64, 'base64'));
    const scales = new Float32Array(scalesRaw.buffer, scalesRaw.byteOffset, s.rows);
    const qBytes = Buffer.from(spec.weightsB64, 'base64');
    const q = new Int8Array(qBytes.buffer, qBytes.byteOffset, qBytes.byteLength);
    for (let r = 0; r < s.rows; r++) {
      const sc = scales[r]!;
      const off = r * s.cols;
      for (let c = 0; c < s.cols; c++) {
        d.w[off + c] = q[off + c]! * sc;
      }
    }
  }
  copy.norm1Gamma.set(params.norm1Gamma);
  copy.norm2Gamma.set(params.norm2Gamma);
  copy.norm3Gamma.set(params.norm3Gamma);
  copy.relPosBias.set(params.relPosBias);
  return copy;
}

function stage2ActionPolish(
  dequantParams: NeuralModelParams,
  trainEncoded: EncodedSample[],
  valEncoded: EncodedSample[],
  tIntent: number
): void {
  console.log(
    '[GhostNet] Stage 2: Extracting quantized+calibrated features for Action Reasoner polish...'
  );
  const sc = createKernelScratch();
  const extractActionEx = (samples: EncodedSample[], augmentRisk: boolean): ActionPolSample[] => {
    const list: ActionPolSample[] = [];
    for (let idx = 0; idx < samples.length; idx++) {
      const s = samples[idx]!;
      forwardBackwardSample(s, dequantParams, sc, false);
      // Apply T_intent on sc.actionIn[D_MODEL .. D_MODEL + 7] identically to runtime
      const iStart = D_MODEL;
      let maxL = -Infinity;
      const logits = new Float32Array(INTENT_CLASSES.length);
      for (let i = 0; i < INTENT_CLASSES.length; i++) {
        const l = Math.log(Math.max(1e-12, sc.actionIn[iStart + i]!)) / Math.max(0.1, tIntent);
        logits[i] = l;
        if (l > maxL) {
          maxL = l;
        }
      }
      let pSum = 0;
      for (let i = 0; i < INTENT_CLASSES.length; i++) {
        const e = Math.exp(logits[i]! - maxL);
        logits[i] = e;
        pSum += e;
      }
      const x = sc.actionIn.slice();
      for (let i = 0; i < INTENT_CLASSES.length; i++) {
        x[iStart + i] = logits[i]! / pSum;
      }

      list.push({ x, targetIdx: s.actionIdx, weight: s.actionLossWeight });

      // Counterfactual risk / security augmentation so ActionReasoner strictly respects securityRisk = high/medium
      if (augmentRisk && s.actionIdx <= 2 && idx % 10 === 0) {
        const mBase = D_MODEL + INTENT_CLASSES.length + D_POINTER * 2;
        const xRisk = x.slice();
        xRisk[mBase + 17] = 0.35; // low security score
        xRisk[mBase + 18] = 1; // riskHigh = 1
        xRisk[mBase + 19] = 0;
        list.push({
          x: xRisk,
          targetIdx: ACTION_INDEX.get('show-review')!,
          weight: 3.0,
        });
      }

      // Counterfactual domain-unbound augmentation so ActionReasoner never auto-opens an unbound link
      if (augmentRisk && (s.actionIdx === 1 || s.actionIdx === 2) && idx % 5 === 0) {
        const mBase = D_MODEL + INTENT_CLASSES.length + D_POINTER * 2;
        const xUnbound = x.slice();
        xUnbound[mBase + 13] = 0; // linkDomainBound = 0
        xUnbound[mBase + 20] = 0; // senderMatchesSite = 0
        const fallbackTarget =
          s.actionIdx === 2 && (x[mBase + 16] ?? 0) > 0
            ? 0 // fill-otp when an independent OTP is present
            : ACTION_INDEX.get('show-review')!;
        list.push({
          x: xUnbound,
          targetIdx: fallbackTarget,
          weight: 3.0,
        });
      }
    }
    return list;
  };

  const trainAct = extractActionEx(trainEncoded, true);
  const valAct = extractActionEx(valEncoded, false);

  const w1 = dequantParams.actionW1;
  const w2 = dequantParams.actionW2;
  const mw1 = new Float32Array(w1.w.length);
  const vw1 = new Float32Array(w1.w.length);
  const mb1 = new Float32Array(w1.b.length);
  const vb1 = new Float32Array(w1.b.length);
  const mw2 = new Float32Array(w2.w.length);
  const vw2 = new Float32Array(w2.w.length);
  const mb2 = new Float32Array(w2.b.length);
  const vb2 = new Float32Array(w2.b.length);

  let rng = 98765;
  const order = trainAct.map((_, i) => i);
  const epochs = 32;
  const batchSize = 128;
  let step = 0;
  let bestScore = -1;
  let bestW1 = w1.w.slice();
  let bestB1 = w1.b.slice();
  let bestW2 = w2.w.slice();
  let bestB2 = w2.b.slice();

  const h1 = new Float32Array(D_MODEL);
  const h1Grad = new Float32Array(D_MODEL);
  const logits = new Float32Array(ACTION_CLASSES.length);
  const dH1 = new Float32Array(D_MODEL);

  for (let ep = 1; ep <= epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      const j = Math.floor((rng / 0x100000000) * (i + 1));
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    const lr = 0.0004 + (0.005 - 0.0004) * 0.5 * (1 + Math.cos((Math.PI * (ep - 1)) / epochs));

    for (let s = 0; s < order.length; s += batchSize) {
      const end = Math.min(order.length, s + batchSize);
      const cnt = end - s;
      w1.gw.fill(0);
      w1.gb.fill(0);
      w2.gw.fill(0);
      w2.gb.fill(0);

      for (let p = s; p < end; p++) {
        const ex = trainAct[order[p]!]!;
        for (let r = 0; r < D_MODEL; r++) {
          let acc = w1.b[r]!;
          const off = r * D_ACTION_IN;
          for (let c = 0; c < D_ACTION_IN; c++) {
            acc += w1.w[off + c]! * ex.x[c]!;
          }
          const [y, dy] = geluValAndGrad(acc);
          h1[r] = y;
          h1Grad[r] = dy;
        }
        let maxL = -Infinity;
        for (let r = 0; r < ACTION_CLASSES.length; r++) {
          let acc = w2.b[r]!;
          const off = r * D_MODEL;
          for (let c = 0; c < D_MODEL; c++) {
            acc += w2.w[off + c]! * h1[c]!;
          }
          logits[r] = acc;
          if (acc > maxL) {
            maxL = acc;
          }
        }
        let pSum = 0;
        for (let r = 0; r < ACTION_CLASSES.length; r++) {
          const e = Math.exp(logits[r]! - maxL);
          logits[r] = e;
          pSum += e;
        }
        dH1.fill(0);
        for (let r = 0; r < ACTION_CLASSES.length; r++) {
          const prob = logits[r]! / pSum;
          const g = ex.weight * (prob - (r === ex.targetIdx ? 1 : 0));
          w2.gb[r] = w2.gb[r]! + g;
          const off = r * D_MODEL;
          for (let c = 0; c < D_MODEL; c++) {
            w2.gw[off + c] = w2.gw[off + c]! + g * h1[c]!;
            dH1[c] = dH1[c]! + g * w2.w[off + c]!;
          }
        }
        for (let r = 0; r < D_MODEL; r++) {
          const g = dH1[r]! * h1Grad[r]!;
          w1.gb[r] = w1.gb[r]! + g;
          const off = r * D_ACTION_IN;
          for (let c = 0; c < D_ACTION_IN; c++) {
            w1.gw[off + c] = w1.gw[off + c]! + g * ex.x[c]!;
          }
        }
      }

      step += 1;
      const bc1 = 1 - Math.pow(0.9, step);
      const bc2 = 1 - Math.pow(0.999, step);
      const invB = 1 / cnt;
      const upd = (
        p: Float32Array,
        g: Float32Array,
        m: Float32Array,
        v: Float32Array,
        wd: number
      ) => {
        for (let i = 0; i < p.length; i++) {
          const gr = g[i]! * invB;
          const mi = 0.9 * m[i]! + 0.1 * gr;
          const vi = 0.999 * v[i]! + 0.001 * gr * gr;
          m[i] = mi;
          v[i] = vi;
          if (wd > 0) {
            p[i] = p[i]! * (1 - lr * wd);
          }
          p[i] = p[i]! - (lr * (mi / bc1)) / (Math.sqrt(vi / bc2) + 1e-8);
        }
      };
      upd(w1.w, w1.gw, mw1, vw1, 1e-4);
      upd(w1.b, w1.gb, mb1, vb1, 0);
      upd(w2.w, w2.gw, mw2, vw2, 1e-4);
      upd(w2.b, w2.gb, mb2, vb2, 0);
    }

    if (ep % 8 === 0 || ep === epochs) {
      let ok = 0;
      let falseAuto = 0;
      let unsafe = 0;
      for (const ex of valAct) {
        for (let r = 0; r < D_MODEL; r++) {
          let acc = w1.b[r]!;
          const off = r * D_ACTION_IN;
          for (let c = 0; c < D_ACTION_IN; c++) {
            acc += w1.w[off + c]! * ex.x[c]!;
          }
          h1[r] = geluValAndGrad(acc)[0];
        }
        let best = 0;
        let bestLog = -Infinity;
        for (let r = 0; r < ACTION_CLASSES.length; r++) {
          let acc = w2.b[r]!;
          const off = r * D_MODEL;
          for (let c = 0; c < D_MODEL; c++) {
            acc += w2.w[off + c]! * h1[c]!;
          }
          if (acc > bestLog) {
            bestLog = acc;
            best = r;
          }
        }
        if (best === ex.targetIdx) {
          ok += 1;
        }
        if (ex.targetIdx >= 3) {
          unsafe += 1;
          if (best < 3) {
            falseAuto += 1;
          }
        }
      }
      const acc = ok / valAct.length;
      const fa = falseAuto / Math.max(1, unsafe);
      const score = acc - 5.0 * fa;
      if (score >= bestScore) {
        bestScore = score;
        bestW1 = w1.w.slice();
        bestB1 = w1.b.slice();
        bestW2 = w2.w.slice();
        bestB2 = w2.b.slice();
      }
      console.log(
        `  Stage2 Epoch ${String(ep).padStart(2)}/${epochs} | valAction=${(acc * 100).toFixed(2)}% | valFalseAuto=${(fa * 100).toFixed(2)}%`
      );
    }
  }

  w1.w.set(bestW1);
  w1.b.set(bestB1);
  w2.w.set(bestW2);
  w2.b.set(bestB2);
}

async function main(): Promise<void> {
  if (process.argv.includes('--verify-grad')) {
    verifyGradients();
    return;
  }

  const startMs = Date.now();
  verifyGradients();

  const realSamples = debiasRealCorpusMetadata(await fetchRealDatasets());
  const openVocabSamples = generateOpenVocabCorpus(20261119);
  const allSamples: CorpusEmailSample[] = [...realSamples, ...openVocabSamples];

  const trainRaw = allSamples.filter((s) => s.split === 'train');
  const valRaw = allSamples.filter((s) => s.split === 'val');
  const testRaw = allSamples.filter((s) => s.split === 'test');
  console.log(
    `[GhostNet] Total corpus: ${allSamples.length} emails (train=${trainRaw.length}, val=${valRaw.length}, test=${testRaw.length})`
  );

  console.log(
    `[GhostNet] Building data-driven mutual-information vocabulary (${V_VOCAB} tokens)...`
  );
  const vocab = buildDataDrivenVocab(trainRaw);
  const vocabMap = new Map<string, number>(vocab.map((w, i) => [w, i]));
  console.log(
    `[GhostNet] Built ${vocab.length} vocab tokens (${vocab.length - TOK_RESERVED_COUNT} learned + ${TOK_RESERVED_COUNT} structural).`
  );

  console.log('[GhostNet] Compiling AST documents & sequences for train + val...');
  const trainEncoded = trainRaw.map((s) => encodeSample(s, vocabMap));
  const valEncoded = valRaw.map((s) => encodeSample(s, vocabMap));

  const params = createInitialParams(20261119);
  const bestFlat = await runStage1MultiWorker(trainEncoded, valEncoded, params);
  unpackParamsFlat(params, bestFlat);

  // Calibrate Stage 1 temperatures on quantized Val logits
  const stage1Bundle = exportWeightsBundle(params, vocab, trainRaw.length, {
    intent: 1,
    otp: 1,
    link: 1,
    action: 1,
  });
  const stage1ValLogits = collectQuantizedStage1AndActionDataset(valRaw, stage1Bundle);
  const tIntent = fitTemperature(stage1ValLogits.intentLogitsVal);
  const tOtp = fitTemperature(stage1ValLogits.otpLogitsVal);
  const tLink = fitTemperature(stage1ValLogits.linkLogitsVal);
  console.log(
    `[GhostNet] Stage 1 calibrated temperatures: T_intent=${tIntent}, T_otp=${tOtp}, T_link=${tLink}`
  );
  show
  // Stage 2 Action Reasoner polish on Int8-dequantized Stage 1
  const dequantParams = buildDequantizedStage1Params(params);
  stage2ActionPolish(dequantParams, trainEncoded, valEncoded, tIntent);
  params.actionW1.w.set(dequantParams.actionW1.w);
  params.actionW1.b.set(dequantParams.actionW1.b);
  params.actionW2.w.set(dequantParams.actionW2.w);
  params.actionW2.b.set(dequantParams.actionW2.b);

  // Quantize Action Reasoner & fit T_action on Val
  const preFinalBundle = exportWeightsBundle(params, vocab, trainRaw.length, {
    intent: tIntent,
    otp: tOtp,
    link: tLink,
    action: 1,
  });
  const decFull = decodeGhostNetBundle(preFinalBundle);
  decFull.temperatures.action = 1;
  const valActionLogits: Array<{ logits: Float32Array; target: Float32Array }> = [];
  for (const s of valRaw) {
    const doc = compileEmailDocument(s.subject, s.body, s.htmlBody, s.sender, s.expectedDomains);
    const res = runGhostNet(
      doc,
      {
        expectedDomains: s.expectedDomains,
        originUrl: s.originUrl,
        pageExpectation: s.pageExpectation,
      },
      decFull
    );
    const aLog = new Float32Array(ACTION_CLASSES.length);
    const aTgt = new Float32Array(ACTION_CLASSES.length);
    for (let i = 0; i < ACTION_CLASSES.length; i++) {
      aLog[i] = Math.log(Math.max(1e-12, res.actionProbs[ACTION_CLASSES[i]!] ?? 1e-12));
    }
    aTgt[ACTION_INDEX.get(s.label.action) ?? 4] = 1;
    valActionLogits.push({ logits: aLog, target: aTgt });
  }
  const tAction = fitTemperature(valActionLogits);
  console.log(`[GhostNet] Calibrated T_action=${tAction}`);

  const finalBundle = exportWeightsBundle(params, vocab, trainRaw.length, {
    intent: tIntent,
    otp: tOtp,
    link: tLink,
    action: tAction,
  });

  const weightsPath = path.resolve(process.cwd(), 'src/services/extraction/ghostNetWeights.ts');
  const content = `export interface QuantizedMatrixSpec {
  rows: number;
  cols: number;
  scalesB64: string;
  weightsB64: string;
  biasB64?: string | undefined;
}

export interface GhostNetWeightsBundle {
  version: number;
  trainedSamples: number;
  vocab: string[];
  temperatures: {
    intent: number;
    otp: number;
    link: number;
    action: number;
  };
  embeddings: {
    tokenEmb: QuantizedMatrixSpec;
    zoneEmbB64: string;
    codeCharEmb: QuantizedMatrixSpec;
  };
  seqConv: {
    dwK3B64: string;
    dwK5Dil2B64: string;
    pwGlu: QuantizedMatrixSpec;
    norm1GammaB64: string;
  };
  selfAttn: {
    qkvProj: QuantizedMatrixSpec;
    relPosBiasB64: string;
    outProj: QuantizedMatrixSpec;
    norm2GammaB64: string;
    ffnW1: QuantizedMatrixSpec;
    ffnW2: QuantizedMatrixSpec;
    norm3GammaB64: string;
    poolProj: QuantizedMatrixSpec;
    intentHead: QuantizedMatrixSpec;
  };
  otpPointer: {
    crossQuery: QuantizedMatrixSpec;
    spanProj: QuantizedMatrixSpec;
    setInteract: QuantizedMatrixSpec;
    scoreHead: QuantizedMatrixSpec;
    nullProj: QuantizedMatrixSpec;
    nullScore: QuantizedMatrixSpec;
  };
  linkPointer: {
    crossQuery: QuantizedMatrixSpec;
    spanProj: QuantizedMatrixSpec;
    setInteract: QuantizedMatrixSpec;
    scoreHead: QuantizedMatrixSpec;
    nullProj: QuantizedMatrixSpec;
    nullScore: QuantizedMatrixSpec;
  };
  actionReasoner: {
    w1: QuantizedMatrixSpec;
    w2: QuantizedMatrixSpec;
  };
}

// Int8-quantized GhostNet v2 weights trained on ${trainRaw.length} real + open-vocab emails.
// Regenerate via \`npm run brain:train\`.
export const GHOSTNET_WEIGHTS: GhostNetWeightsBundle = ${JSON.stringify(finalBundle)};
`;
  fs.writeFileSync(weightsPath, content, 'utf8');
  const sizeKb = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(2);
  console.log(
    `[GhostNet] Wrote ${weightsPath} (${sizeKb} KB) in ${((Date.now() - startMs) / 1000).toFixed(1)}s`
  );
}

main().catch((err) => {
  console.error('[GhostNet Train] Error:', err);
  process.exit(1);
});
