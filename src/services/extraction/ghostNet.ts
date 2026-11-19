import { sameVerificationSite } from '../../utils/verificationSite';
import type { PageVerificationExpectation } from '../types/extraction.types';

import { hostMatchesExpectation } from './activationLinkGuard';
import type {
  CompiledEmailDocument,
  DocumentCodeCandidate,
  DocumentLinkCandidate,
} from './emailDocument';
import {
  ACTION_CLASSES,
  D_ACTION_IN,
  D_FFN,
  D_HEAD,
  D_LINK_RAW,
  D_MODEL,
  D_MORPH_EMB,
  D_POINTER,
  D_SPAN_RAW,
  extractCodeMorphCharIds,
  extractCodeStructuralGeometry,
  extractLinkStructuralGeometry,
  extractUrlSubwordTokens,
  type GhostNetActionClass,
  type GhostNetIntentClass,
  INTENT_CLASSES,
  MAX_SEQ_LEN,
  N_HEADS,
  resolveTokenVocabAndChars,
  tokenizeEmailDocument,
} from './ghostNetTokenizer';
import {
  GHOSTNET_WEIGHTS,
  type GhostNetWeightsBundle,
  type QuantizedMatrixSpec,
} from './ghostNetWeights';

export interface DecodedMatrix {
  rows: number;
  cols: number;
  weights: Float32Array;
  bias: Float32Array;
}

export interface DecodedGhostNet {
  version: number;
  vocabMap: Map<string, number>;
  temperatures: {
    intent: number;
    otp: number;
    link: number;
    action: number;
  };
  tokenEmb: DecodedMatrix;
  zoneEmb: Float32Array;
  codeCharEmb: DecodedMatrix;
  dwK3: Float32Array;
  dwK5Dil2: Float32Array;
  pwGlu: DecodedMatrix;
  norm1Gamma: Float32Array;
  qkvProj: DecodedMatrix;
  relPosBias: Float32Array;
  outProj: DecodedMatrix;
  norm2Gamma: Float32Array;
  ffnW1: DecodedMatrix;
  ffnW2: DecodedMatrix;
  norm3Gamma: Float32Array;
  poolProj: DecodedMatrix;
  intentHead: DecodedMatrix;
  otpCrossQuery: DecodedMatrix;
  otpSpanProj: DecodedMatrix;
  otpSetInteract: DecodedMatrix;
  otpScoreHead: DecodedMatrix;
  otpNullProj: DecodedMatrix;
  otpNullScore: DecodedMatrix;
  linkCrossQuery: DecodedMatrix;
  linkSpanProj: DecodedMatrix;
  linkSetInteract: DecodedMatrix;
  linkScoreHead: DecodedMatrix;
  linkNullProj: DecodedMatrix;
  linkNullScore: DecodedMatrix;
  actionW1: DecodedMatrix;
  actionW2: DecodedMatrix;
}

export interface GhostNetRunOptions {
  providerOtpLength?: number | undefined;
  securityScore?: number | undefined;
  securityRisk?: 'low' | 'medium' | 'high' | undefined;
  expectedDomains?: string[] | undefined;
  originUrl?: string | undefined;
  pageExpectation?: PageVerificationExpectation | undefined;
  bundleOverride?: GhostNetWeightsBundle | undefined;
}

export interface GhostNetResult {
  intent: GhostNetIntentClass;
  intentConfidence: number;
  intentProbs: Record<GhostNetIntentClass, number>;
  bestOtp: { candidate: DocumentCodeCandidate; probability: number } | null;
  otpRanking: Array<{ candidate: DocumentCodeCandidate; probability: number }>;
  nullOtpProb: number;
  bestLink: { candidate: DocumentLinkCandidate; probability: number } | null;
  linkRanking: Array<{ candidate: DocumentLinkCandidate; probability: number }>;
  nullLinkProb: number;
  ambiguousDualLinks: boolean;
  action: GhostNetActionClass;
  actionConfidence: number;
  actionProbs: Record<GhostNetActionClass, number>;
  inferenceMs: number;
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function decodeFloat32(b64: string): Float32Array {
  const bytes = decodeBase64Bytes(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
}

function decodeMatrix(spec: QuantizedMatrixSpec): DecodedMatrix {
  const scales = decodeFloat32(spec.scalesB64);
  const bias = spec.biasB64 ? decodeFloat32(spec.biasB64) : new Float32Array(spec.rows);
  const rawBytes = decodeBase64Bytes(spec.weightsB64);
  const q = new Int8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const weights = new Float32Array(spec.rows * spec.cols);

  for (let r = 0; r < spec.rows; r++) {
    const scale = scales[r] ?? 0;
    const off = r * spec.cols;
    for (let c = 0; c < spec.cols; c++) {
      weights[off + c] = (q[off + c] ?? 0) * scale;
    }
  }
  return { rows: spec.rows, cols: spec.cols, weights, bias };
}

export function decodeGhostNetBundle(bundle: GhostNetWeightsBundle): DecodedGhostNet {
  const vocabMap = new Map<string, number>();
  for (let i = 0; i < bundle.vocab.length; i++) {
    vocabMap.set(bundle.vocab[i]!, i);
  }
  return {
    version: bundle.version,
    vocabMap,
    temperatures: { ...bundle.temperatures },
    tokenEmb: decodeMatrix(bundle.embeddings.tokenEmb),
    zoneEmb: decodeFloat32(bundle.embeddings.zoneEmbB64),
    codeCharEmb: decodeMatrix(bundle.embeddings.codeCharEmb),
    dwK3: decodeFloat32(bundle.seqConv.dwK3B64),
    dwK5Dil2: decodeFloat32(bundle.seqConv.dwK5Dil2B64),
    pwGlu: decodeMatrix(bundle.seqConv.pwGlu),
    norm1Gamma: decodeFloat32(bundle.seqConv.norm1GammaB64),
    qkvProj: decodeMatrix(bundle.selfAttn.qkvProj),
    relPosBias: decodeFloat32(bundle.selfAttn.relPosBiasB64),
    outProj: decodeMatrix(bundle.selfAttn.outProj),
    norm2Gamma: decodeFloat32(bundle.selfAttn.norm2GammaB64),
    ffnW1: decodeMatrix(bundle.selfAttn.ffnW1),
    ffnW2: decodeMatrix(bundle.selfAttn.ffnW2),
    norm3Gamma: decodeFloat32(bundle.selfAttn.norm3GammaB64),
    poolProj: decodeMatrix(bundle.selfAttn.poolProj),
    intentHead: decodeMatrix(bundle.selfAttn.intentHead),
    otpCrossQuery: decodeMatrix(bundle.otpPointer.crossQuery),
    otpSpanProj: decodeMatrix(bundle.otpPointer.spanProj),
    otpSetInteract: decodeMatrix(bundle.otpPointer.setInteract),
    otpScoreHead: decodeMatrix(bundle.otpPointer.scoreHead),
    otpNullProj: decodeMatrix(bundle.otpPointer.nullProj),
    otpNullScore: decodeMatrix(bundle.otpPointer.nullScore),
    linkCrossQuery: decodeMatrix(bundle.linkPointer.crossQuery),
    linkSpanProj: decodeMatrix(bundle.linkPointer.spanProj),
    linkSetInteract: decodeMatrix(bundle.linkPointer.setInteract),
    linkScoreHead: decodeMatrix(bundle.linkPointer.scoreHead),
    linkNullProj: decodeMatrix(bundle.linkPointer.nullProj),
    linkNullScore: decodeMatrix(bundle.linkPointer.nullScore),
    actionW1: decodeMatrix(bundle.actionReasoner.w1),
    actionW2: decodeMatrix(bundle.actionReasoner.w2),
  };
}

let cachedDefaultNet: DecodedGhostNet | null = null;

function getDefaultNet(): DecodedGhostNet {
  if (!cachedDefaultNet) {
    cachedDefaultNet = decodeGhostNetBundle(GHOSTNET_WEIGHTS);
  }
  return cachedDefaultNet;
}

export function resetGhostNetCache(): void {
  cachedDefaultNet = null;
}

function gelu(x: number): number {
  if (x >= 3.0) {
    return x;
  }
  if (x <= -3.0) {
    return 0;
  }
  const c = 0.7978845608028654;
  const inner = c * (x + 0.044715 * x * x * x);
  return 0.5 * x * (1 + Math.tanh(inner));
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

// Reusable scratch buffers (zero GC allocation on hot inference path)
const SCRATCH = {
  E: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  X1: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  QKV: new Float32Array(MAX_SEQ_LEN * D_MODEL * 3),
  A: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  H: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  convCatSeq: new Float32Array(MAX_SEQ_LEN * D_MODEL * 2),
  gluRawSeq: new Float32Array(MAX_SEQ_LEN * D_MODEL * 2),
  attnOutSeq: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  ffnHiddenSeq: new Float32Array(MAX_SEQ_LEN * D_FFN),
  ffnOutSeq: new Float32Array(MAX_SEQ_LEN * D_MODEL),
  convCat: new Float32Array(D_MODEL * 2),
  gluRaw: new Float32Array(D_MODEL * 2),
  attnScores: new Float32Array(MAX_SEQ_LEN),
  attnOut: new Float32Array(D_MODEL),
  ffnHidden: new Float32Array(D_FFN),
  ffnOut: new Float32Array(D_MODEL),
  poolWeights: new Float32Array(MAX_SEQ_LEN),
  zDoc: new Float32Array(D_MODEL),
  hSpan: new Float32Array(D_MODEL),
  hLeft: new Float32Array(D_MODEL),
  hRight: new Float32Array(D_MODEL),
  lrPair: new Float32Array(D_MODEL * 2),
  crossQ: new Float32Array(D_MODEL),
  crossAttn: new Float32Array(MAX_SEQ_LEN),
  hCtx: new Float32Array(D_MODEL),
  morphEmb: new Float32Array(D_MORPH_EMB),
  otpRaw: new Float32Array(D_SPAN_RAW),
  linkRaw: new Float32Array(D_LINK_RAW),
  urlEmb: new Float32Array(D_MODEL),
  otpLatents: new Float32Array(16 * D_POINTER),
  otpRefined: new Float32Array(16 * D_POINTER),
  linkLatents: new Float32Array(14 * D_POINTER),
  linkRefined: new Float32Array(14 * D_POINTER),
  otpProbs: new Float32Array(17),
  linkProbs: new Float32Array(15),
  rivalBuf: new Float32Array(D_POINTER),
  zNull: new Float32Array(D_POINTER),
  zOtpWin: new Float32Array(D_POINTER),
  zLinkWin: new Float32Array(D_POINTER),
  actionIn: new Float32Array(D_ACTION_IN),
  actionH1: new Float32Array(D_MODEL),
  actionLogits: new Float32Array(ACTION_CLASSES.length),
  intentLogits: new Float32Array(INTENT_CLASSES.length),
};

function batchLinearInto(
  mat: DecodedMatrix,
  input: Float32Array,
  out: Float32Array,
  seqLen: number,
  applyGelu: boolean
): void {
  const rows = mat.rows;
  const cols = mat.cols;
  const w = mat.weights;
  const b = mat.bias;
  const cols4 = cols & ~3;
  const l4 = seqLen & ~3;

  for (let r = 0; r < rows; r++) {
    const wOff = r * cols;
    const br = b[r] ?? 0;
    let t = 0;
    for (; t < l4; t += 4) {
      let a0 = br;
      let a1 = br;
      let a2 = br;
      let a3 = br;
      const x0 = t * cols;
      const x1 = x0 + cols;
      const x2 = x1 + cols;
      const x3 = x2 + cols;
      let c = 0;
      for (; c < cols4; c += 4) {
        const w0 = w[wOff + c]!;
        const w1 = w[wOff + c + 1]!;
        const w2 = w[wOff + c + 2]!;
        const w3 = w[wOff + c + 3]!;
        a0 +=
          w0 * input[x0 + c]! +
          w1 * input[x0 + c + 1]! +
          w2 * input[x0 + c + 2]! +
          w3 * input[x0 + c + 3]!;
        a1 +=
          w0 * input[x1 + c]! +
          w1 * input[x1 + c + 1]! +
          w2 * input[x1 + c + 2]! +
          w3 * input[x1 + c + 3]!;
        a2 +=
          w0 * input[x2 + c]! +
          w1 * input[x2 + c + 1]! +
          w2 * input[x2 + c + 2]! +
          w3 * input[x2 + c + 3]!;
        a3 +=
          w0 * input[x3 + c]! +
          w1 * input[x3 + c + 1]! +
          w2 * input[x3 + c + 2]! +
          w3 * input[x3 + c + 3]!;
      }
      for (; c < cols; c++) {
        const wc = w[wOff + c]!;
        a0 += wc * input[x0 + c]!;
        a1 += wc * input[x1 + c]!;
        a2 += wc * input[x2 + c]!;
        a3 += wc * input[x3 + c]!;
      }
      if (applyGelu) {
        out[t * rows + r] = gelu(a0);
        out[(t + 1) * rows + r] = gelu(a1);
        out[(t + 2) * rows + r] = gelu(a2);
        out[(t + 3) * rows + r] = gelu(a3);
      } else {
        out[t * rows + r] = a0;
        out[(t + 1) * rows + r] = a1;
        out[(t + 2) * rows + r] = a2;
        out[(t + 3) * rows + r] = a3;
      }
    }
    for (; t < seqLen; t++) {
      let a = br;
      const xOff = t * cols;
      let c = 0;
      for (; c < cols4; c += 4) {
        a +=
          w[wOff + c]! * input[xOff + c]! +
          w[wOff + c + 1]! * input[xOff + c + 1]! +
          w[wOff + c + 2]! * input[xOff + c + 2]! +
          w[wOff + c + 3]! * input[xOff + c + 3]!;
      }
      for (; c < cols; c++) {
        a += w[wOff + c]! * input[xOff + c]!;
      }
      out[t * rows + r] = applyGelu ? gelu(a) : a;
    }
  }
}

function linearVecInto(
  mat: DecodedMatrix,
  input: Float32Array,
  inputOff: number,
  out: Float32Array,
  outOff: number,
  applyGelu: boolean
): void {
  const rows = mat.rows;
  const cols = mat.cols;
  const w = mat.weights;
  const b = mat.bias;
  const cols4 = cols & ~3;
  const rows2 = rows & ~1;
  let r = 0;
  for (; r < rows2; r += 2) {
    let acc0 = b[r] ?? 0;
    let acc1 = b[r + 1] ?? 0;
    const wOff0 = r * cols;
    const wOff1 = (r + 1) * cols;
    let c = 0;
    for (; c < cols4; c += 4) {
      const in0 = input[inputOff + c]!;
      const in1 = input[inputOff + c + 1]!;
      const in2 = input[inputOff + c + 2]!;
      const in3 = input[inputOff + c + 3]!;
      acc0 +=
        w[wOff0 + c]! * in0 +
        w[wOff0 + c + 1]! * in1 +
        w[wOff0 + c + 2]! * in2 +
        w[wOff0 + c + 3]! * in3;
      acc1 +=
        w[wOff1 + c]! * in0 +
        w[wOff1 + c + 1]! * in1 +
        w[wOff1 + c + 2]! * in2 +
        w[wOff1 + c + 3]! * in3;
    }
    for (; c < cols; c++) {
      const inC = input[inputOff + c]!;
      acc0 += w[wOff0 + c]! * inC;
      acc1 += w[wOff1 + c]! * inC;
    }
    out[outOff + r] = applyGelu ? gelu(acc0) : acc0;
    out[outOff + r + 1] = applyGelu ? gelu(acc1) : acc1;
  }
  for (; r < rows; r++) {
    let acc = b[r] ?? 0;
    const wOff = r * cols;
    let c = 0;
    for (; c < cols4; c += 4) {
      acc +=
        w[wOff + c]! * input[inputOff + c]! +
        w[wOff + c + 1]! * input[inputOff + c + 1]! +
        w[wOff + c + 2]! * input[inputOff + c + 2]! +
        w[wOff + c + 3]! * input[inputOff + c + 3]!;
    }
    for (; c < cols; c++) {
      acc += w[wOff + c]! * input[inputOff + c]!;
    }
    out[outOff + r] = applyGelu ? gelu(acc) : acc;
  }
}

function rmsNormResidualInto(
  resA: Float32Array,
  resAOff: number,
  resB: Float32Array,
  resBOff: number,
  gamma: Float32Array,
  out: Float32Array,
  outOff: number,
  dim: number
): void {
  let sq = 0;
  for (let d = 0; d < dim; d++) {
    const v = resA[resAOff + d]! + resB[resBOff + d]!;
    out[outOff + d] = v;
    sq += v * v;
  }
  const invRms = 1 / Math.sqrt(sq / dim + 1e-5);
  for (let d = 0; d < dim; d++) {
    out[outOff + d] = out[outOff + d]! * invRms * (gamma[d] ?? 1);
  }
}

function softmaxInPlace(arr: Float32Array, len: number, temperature: number): void {
  const t = Math.max(0.1, temperature);
  let maxV = -Infinity;
  for (let i = 0; i < len; i++) {
    const s = arr[i]! / t;
    if (s > maxV) {
      maxV = s;
    }
  }
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const e = Math.exp(arr[i]! / t - maxV);
    arr[i] = e;
    sum += e;
  }
  const inv = sum > 0 ? 1 / sum : 1;
  for (let i = 0; i < len; i++) {
    arr[i] = arr[i]! * inv;
  }
}

const DIR_DECAY = new Float32Array([1.0, 0.55, 0.3025, 0.166375, 0.09150625, 0.0503284375]);
const DIR_SUMS = new Float32Array([0, 1.0, 1.55, 1.8525, 2.018875, 2.11038125, 2.1607096875]);

function poolDirectionalWindows(
  H: Float32Array,
  seqLen: number,
  positions: number[],
  hSpanOut: Float32Array,
  hLeftOut: Float32Array,
  hRightOut: Float32Array
): void {
  hSpanOut.fill(0);
  hLeftOut.fill(0);
  hRightOut.fill(0);
  const count = Math.max(1, positions.length);
  const invCount = 1 / count;

  for (let idx = 0; idx < positions.length; idx++) {
    const p = positions[idx]!;
    const pOff = p * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      hSpanOut[d] = hSpanOut[d]! + H[pOff + d]! * invCount;
    }

    const maxLeft = Math.min(6, p);
    if (maxLeft > 0) {
      const invLeftW = invCount / DIR_SUMS[maxLeft]!;
      for (let dist = 1; dist <= maxLeft; dist++) {
        const s = DIR_DECAY[dist - 1]! * invLeftW;
        const off = (p - dist) * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          hLeftOut[d] = hLeftOut[d]! + H[off + d]! * s;
        }
      }
    }

    const maxRight = Math.min(6, seqLen - 1 - p);
    if (maxRight > 0) {
      const invRightW = invCount / DIR_SUMS[maxRight]!;
      for (let dist = 1; dist <= maxRight; dist++) {
        const s = DIR_DECAY[dist - 1]! * invRightW;
        const off = (p + dist) * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          hRightOut[d] = hRightOut[d]! + H[off + d]! * s;
        }
      }
    }
  }
}

function crossAttendContext(
  q: Float32Array,
  H: Float32Array,
  seqLen: number,
  outCtx: Float32Array
): void {
  const scale = 1 / Math.sqrt(D_MODEL);
  const attn = SCRATCH.crossAttn;
  for (let t = 0; t < seqLen; t++) {
    let dot = 0;
    const off = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      dot += q[d]! * H[off + d]!;
    }
    attn[t] = dot * scale;
  }
  softmaxInPlace(attn, seqLen, 1.0);
  outCtx.fill(0);
  for (let t = 0; t < seqLen; t++) {
    const w = attn[t]!;
    const off = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      outCtx[d] = outCtx[d]! + w * H[off + d]!;
    }
  }
}

function checkOriginBound(
  link: DocumentLinkCandidate,
  expectedDomains: string[],
  originUrl?: string
): boolean {
  const hosts: string[] = [...expectedDomains];
  if (originUrl) {
    try {
      const h = new URL(originUrl).hostname;
      if (h) {
        hosts.push(h);
      }
    } catch {
      /* ignore */
    }
  }
  if (hosts.length === 0) {
    return false;
  }
  return hostMatchesExpectation(link.host, hosts);
}

export function runGhostNet(
  doc: CompiledEmailDocument,
  options: GhostNetRunOptions = {},
  predecoded?: DecodedGhostNet
): GhostNetResult {
  const t0 = performance.now();
  const net =
    predecoded ??
    (options.bundleOverride ? decodeGhostNetBundle(options.bundleOverride) : getDefaultNet());

  const otpCandidates = doc.codeCandidates.slice(0, 16);
  const eligibleLinks = doc.linkCandidates.filter((l) => !l.gate.hardReject).slice(0, 14);
  const seq = tokenizeEmailDocument(doc, net.vocabMap, eligibleLinks);
  const L = seq.seqLen;

  // ── 1. Token + Character 3-Gram + Zone Embedding Lookup ───────────────────
  const tokW = net.tokenEmb.weights;
  const E = SCRATCH.E;
  for (let t = 0; t < L; t++) {
    const vOff = seq.vocabIds[t]! * D_MODEL;
    const c0Off = seq.charIds[t * 3]! * D_MODEL;
    const c1Off = seq.charIds[t * 3 + 1]! * D_MODEL;
    const c2Off = seq.charIds[t * 3 + 2]! * D_MODEL;
    const zOff = seq.zoneIds[t]! * D_MODEL;
    const outOff = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      const cAvg = (tokW[c0Off + d]! + tokW[c1Off + d]! + tokW[c2Off + d]!) * (1 / 3);
      E[outOff + d] = tokW[vOff + d]! + cAvg + net.zoneEmb[zOff + d]!;
    }
  }

  // ── 2. Bi-Directional Multi-Scale Depthwise Conv + Pointwise GLU ──────────
  const X1 = SCRATCH.X1;
  const convCatSeq = SCRATCH.convCatSeq;
  const gluRawSeq = SCRATCH.gluRawSeq;
  convCatSeq.fill(0, 0, L * D_MODEL * 2);
  for (let t = 0; t < L; t++) {
    const cOff = t * D_MODEL * 2;
    for (let k = -1; k <= 1; k++) {
      const pos = t + k;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wOff = (k + 1) * D_MODEL;
      const eOff = pos * D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        convCatSeq[cOff + d] = convCatSeq[cOff + d]! + net.dwK3[wOff + d]! * E[eOff + d]!;
      }
    }
    for (let k = 0; k < 5; k++) {
      const pos = t + (k - 2) * 2;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wOff = k * D_MODEL;
      const eOff = pos * D_MODEL;
      const c2Off = cOff + D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        convCatSeq[c2Off + d] = convCatSeq[c2Off + d]! + net.dwK5Dil2[wOff + d]! * E[eOff + d]!;
      }
    }
  }
  batchLinearInto(net.pwGlu, convCatSeq, gluRawSeq, L, false);
  for (let t = 0; t < L; t++) {
    let sq = 0;
    const xOff = t * D_MODEL;
    const gOff = t * D_MODEL * 2;
    for (let d = 0; d < D_MODEL; d++) {
      const v = E[xOff + d]! + gluRawSeq[gOff + d]! * sigmoid(gluRawSeq[gOff + D_MODEL + d]!);
      X1[xOff + d] = v;
      sq += v * v;
    }
    const invRms = 1 / Math.sqrt(sq / D_MODEL + 1e-5);
    for (let d = 0; d < D_MODEL; d++) {
      X1[xOff + d] = X1[xOff + d]! * invRms * (net.norm1Gamma[d] ?? 1);
    }
  }

  // ── 3. 4-Head Self-Attention w/ Relative Position Bias + FFN ──────────────
  const QKV = SCRATCH.QKV;
  batchLinearInto(net.qkvProj, X1, QKV, L, false);

  const headScale = 1 / Math.sqrt(D_HEAD);
  const A = SCRATCH.A;
  const H = SCRATCH.H;
  const attnOutSeq = SCRATCH.attnOutSeq;
  attnOutSeq.fill(0, 0, L * D_MODEL);

  for (let t = 0; t < L; t++) {
    const tQkvOff = t * D_MODEL * 3;
    const tAttnOff = t * D_MODEL;

    for (let h = 0; h < N_HEADS; h++) {
      const hOff = h * D_HEAD;
      const qBase = tQkvOff + hOff;
      const q0 = QKV[qBase]!;
      const q1 = QKV[qBase + 1]!;
      const q2 = QKV[qBase + 2]!;
      const q3 = QKV[qBase + 3]!;
      const q4 = QKV[qBase + 4]!;
      const q5 = QKV[qBase + 5]!;
      const q6 = QKV[qBase + 6]!;
      const q7 = QKV[qBase + 7]!;
      const biasBase = h * 15;

      for (let s = 0; s < L; s++) {
        const kBase = s * D_MODEL * 3 + D_MODEL + hOff;
        const dot =
          q0 * QKV[kBase]! +
          q1 * QKV[kBase + 1]! +
          q2 * QKV[kBase + 2]! +
          q3 * QKV[kBase + 3]! +
          q4 * QKV[kBase + 4]! +
          q5 * QKV[kBase + 5]! +
          q6 * QKV[kBase + 6]! +
          q7 * QKV[kBase + 7]!;
        const rel = Math.max(-7, Math.min(7, s - t)) + 7;
        SCRATCH.attnScores[s] = dot * headScale + net.relPosBias[biasBase + rel]!;
      }
      softmaxInPlace(SCRATCH.attnScores, L, 1.0);

      let o0 = 0;
      let o1 = 0;
      let o2 = 0;
      let o3 = 0;
      let o4 = 0;
      let o5 = 0;
      let o6 = 0;
      let o7 = 0;
      for (let s = 0; s < L; s++) {
        const w = SCRATCH.attnScores[s]!;
        const vBase = s * D_MODEL * 3 + D_MODEL * 2 + hOff;
        o0 += w * QKV[vBase]!;
        o1 += w * QKV[vBase + 1]!;
        o2 += w * QKV[vBase + 2]!;
        o3 += w * QKV[vBase + 3]!;
        o4 += w * QKV[vBase + 4]!;
        o5 += w * QKV[vBase + 5]!;
        o6 += w * QKV[vBase + 6]!;
        o7 += w * QKV[vBase + 7]!;
      }
      const outHeadOff = tAttnOff + hOff;
      attnOutSeq[outHeadOff] = o0;
      attnOutSeq[outHeadOff + 1] = o1;
      attnOutSeq[outHeadOff + 2] = o2;
      attnOutSeq[outHeadOff + 3] = o3;
      attnOutSeq[outHeadOff + 4] = o4;
      attnOutSeq[outHeadOff + 5] = o5;
      attnOutSeq[outHeadOff + 6] = o6;
      attnOutSeq[outHeadOff + 7] = o7;
    }
  }

  batchLinearInto(net.outProj, attnOutSeq, SCRATCH.ffnOutSeq, L, false);
  for (let t = 0; t < L; t++) {
    const tOff = t * D_MODEL;
    rmsNormResidualInto(X1, tOff, SCRATCH.ffnOutSeq, tOff, net.norm2Gamma, A, tOff, D_MODEL);
  }

  batchLinearInto(net.ffnW1, A, SCRATCH.ffnHiddenSeq, L, true);
  batchLinearInto(net.ffnW2, SCRATCH.ffnHiddenSeq, SCRATCH.ffnOutSeq, L, false);
  for (let t = 0; t < L; t++) {
    const tOff = t * D_MODEL;
    rmsNormResidualInto(A, tOff, SCRATCH.ffnOutSeq, tOff, net.norm3Gamma, H, tOff, D_MODEL);
  }

  // Attention Pooling + [CLS] -> Document Latent & Intent Probabilities
  for (let t = 0; t < L; t++) {
    let sc = net.poolProj.bias[0] ?? 0;
    const hOff = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      sc += net.poolProj.weights[d]! * H[hOff + d]!;
    }
    SCRATCH.poolWeights[t] = sc;
  }
  softmaxInPlace(SCRATCH.poolWeights, L, 1.0);
  SCRATCH.zDoc.fill(0);
  for (let t = 0; t < L; t++) {
    const w = SCRATCH.poolWeights[t]!;
    const hOff = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      SCRATCH.zDoc[d] = SCRATCH.zDoc[d]! + 0.5 * w * H[hOff + d]!;
    }
  }
  for (let d = 0; d < D_MODEL; d++) {
    SCRATCH.zDoc[d] = SCRATCH.zDoc[d]! + 0.5 * H[d]!;
  }

  linearVecInto(net.intentHead, SCRATCH.zDoc, 0, SCRATCH.intentLogits, 0, false);
  softmaxInPlace(SCRATCH.intentLogits, INTENT_CLASSES.length, net.temperatures.intent);

  const intentProbs = {} as Record<GhostNetIntentClass, number>;
  let bestIntentIdx = 0;
  let bestIntentProb = -1;
  for (let i = 0; i < INTENT_CLASSES.length; i++) {
    const p = SCRATCH.intentLogits[i]!;
    intentProbs[INTENT_CLASSES[i]!] = p;
    if (p > bestIntentProb) {
      bestIntentProb = p;
      bestIntentIdx = i;
    }
  }
  const intent = INTENT_CLASSES[bestIntentIdx]!;

  // ── 4. Tower 2A: OTP Span Cross-Attention + Set Interaction + <NULL_OTP> ──
  const K = otpCandidates.length;
  let otpRanking: Array<{ candidate: DocumentCodeCandidate; probability: number }> = [];
  let nullOtpProb = 1;
  let bestOtp: { candidate: DocumentCodeCandidate; probability: number } | null = null;
  let otpMargin = 0;
  SCRATCH.zOtpWin.fill(0);

  if (K > 0) {
    const otpProbs = SCRATCH.otpProbs;
    const morphW = net.codeCharEmb.weights;

    for (let i = 0; i < K; i++) {
      const cand = otpCandidates[i]!;
      const posList = seq.codePositions[i] ?? [Math.min(L - 1, 1)];
      poolDirectionalWindows(H, L, posList, SCRATCH.hSpan, SCRATCH.hLeft, SCRATCH.hRight);

      SCRATCH.lrPair.set(SCRATCH.hLeft, 0);
      SCRATCH.lrPair.set(SCRATCH.hRight, D_MODEL);
      linearVecInto(net.otpCrossQuery, SCRATCH.lrPair, 0, SCRATCH.crossQ, 0, false);
      crossAttendContext(SCRATCH.crossQ, H, L, SCRATCH.hCtx);

      const [m0, m1, m2, m3] = extractCodeMorphCharIds(cand.code);
      const o0 = m0 * D_MORPH_EMB;
      const o1 = m1 * D_MORPH_EMB;
      const o2 = m2 * D_MORPH_EMB;
      const o3 = m3 * D_MORPH_EMB;
      for (let d = 0; d < D_MORPH_EMB; d++) {
        SCRATCH.morphEmb[d] =
          (morphW[o0 + d]! + morphW[o1 + d]! + morphW[o2 + d]! + morphW[o3 + d]!) * 0.25;
      }

      const geom = extractCodeStructuralGeometry(
        cand,
        doc,
        options.providerOtpLength,
        options.pageExpectation
      );
      SCRATCH.otpRaw.set(SCRATCH.hLeft, 0);
      SCRATCH.otpRaw.set(SCRATCH.hRight, D_MODEL);
      SCRATCH.otpRaw.set(SCRATCH.hSpan, D_MODEL * 2);
      SCRATCH.otpRaw.set(SCRATCH.hCtx, D_MODEL * 3);
      SCRATCH.otpRaw.set(SCRATCH.morphEmb, D_MODEL * 4);
      SCRATCH.otpRaw.set(geom, D_MODEL * 4 + D_MORPH_EMB);

      linearVecInto(net.otpSpanProj, SCRATCH.otpRaw, 0, SCRATCH.otpLatents, i * D_POINTER, true);
    }

    for (let i = 0; i < K; i++) {
      const zOff = i * D_POINTER;
      if (K > 1) {
        SCRATCH.rivalBuf.fill(-Infinity);
        for (let j = 0; j < K; j++) {
          if (j === i) {
            continue;
          }
          const jOff = j * D_POINTER;
          for (let d = 0; d < D_POINTER; d++) {
            const v = SCRATCH.otpLatents[jOff + d]!;
            if (v > SCRATCH.rivalBuf[d]!) {
              SCRATCH.rivalBuf[d] = v;
            }
          }
        }
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.rivalBuf[d] = SCRATCH.otpLatents[zOff + d]! - SCRATCH.rivalBuf[d]!;
        }
        linearVecInto(net.otpSetInteract, SCRATCH.rivalBuf, 0, SCRATCH.otpRefined, zOff, true);
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.otpRefined[zOff + d] =
            SCRATCH.otpLatents[zOff + d]! + SCRATCH.otpRefined[zOff + d]!;
        }
      } else {
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.otpRefined[zOff + d] = SCRATCH.otpLatents[zOff + d]!;
        }
      }

      let sc = net.otpScoreHead.bias[0] ?? 0;
      for (let d = 0; d < D_POINTER; d++) {
        sc += net.otpScoreHead.weights[d]! * SCRATCH.otpRefined[zOff + d]!;
      }
      otpProbs[i] = sc;
    }

    linearVecInto(net.otpNullProj, SCRATCH.zDoc, 0, SCRATCH.zNull, 0, true);
    let nullLogit = net.otpNullScore.bias[0] ?? 0;
    for (let d = 0; d < D_POINTER; d++) {
      nullLogit += net.otpNullScore.weights[d]! * SCRATCH.zNull[d]!;
    }
    otpProbs[K] = nullLogit;

    softmaxInPlace(otpProbs, K + 1, net.temperatures.otp);
    nullOtpProb = otpProbs[K]!;

    for (let i = 0; i < K; i++) {
      const p = otpProbs[i]!;
      const zOff = i * D_POINTER;
      for (let d = 0; d < D_POINTER; d++) {
        SCRATCH.zOtpWin[d] = SCRATCH.zOtpWin[d]! + p * SCRATCH.otpRefined[zOff + d]!;
      }
    }

    let bestIdx = -1;
    let bestP = -1;
    let runnerUpP = -1;
    for (let i = 0; i < K; i++) {
      const p = otpProbs[i]!;
      if (p > bestP) {
        runnerUpP = bestP;
        bestP = p;
        bestIdx = i;
      } else if (p > runnerUpP) {
        runnerUpP = p;
      }
    }

    if (bestIdx >= 0 && bestP > nullOtpProb) {
      bestOtp = { candidate: otpCandidates[bestIdx]!, probability: bestP };
      otpMargin = Math.max(0, bestP - Math.max(runnerUpP, nullOtpProb));
    }

    if (K === 1) {
      otpRanking = bestOtp
        ? [bestOtp]
        : [{ candidate: otpCandidates[0]!, probability: otpProbs[0]! }];
    } else {
      otpRanking = otpCandidates
        .map((candidate, idx) => ({ candidate, probability: otpProbs[idx]! }))
        .sort((a, b) => b.probability - a.probability);
    }
  }

  // ── 5. Tower 2B: Link Span Cross-Attention + Set Interaction + <NULL_LINK> ─
  const M = eligibleLinks.length;
  let linkRanking: Array<{ candidate: DocumentLinkCandidate; probability: number }> = [];
  let nullLinkProb = 1;
  let bestLink: { candidate: DocumentLinkCandidate; probability: number } | null = null;
  let linkMargin = 0;
  let ambiguousDualLinks = false;
  SCRATCH.zLinkWin.fill(0);

  if (M > 0) {
    const linkProbs = SCRATCH.linkProbs;
    const bestCodeStr = bestOtp?.candidate.code ?? null;

    for (let j = 0; j < M; j++) {
      const link = eligibleLinks[j]!;
      const posList = seq.linkAnchorPositions[j] ?? [Math.min(L - 1, 1)];
      poolDirectionalWindows(H, L, posList, SCRATCH.hSpan, SCRATCH.hLeft, SCRATCH.hRight);

      // Learned URL subword + char3gram pooled vector
      const urlToks = extractUrlSubwordTokens(link.url);
      SCRATCH.urlEmb.fill(0);
      if (urlToks.length > 0) {
        const inv = 1 / urlToks.length;
        for (const ut of urlToks) {
          const ids = resolveTokenVocabAndChars(ut, net.vocabMap);
          const vO = ids.vocabId * D_MODEL;
          const c0O = ids.c0 * D_MODEL;
          const c1O = ids.c1 * D_MODEL;
          const c2O = ids.c2 * D_MODEL;
          for (let d = 0; d < D_MODEL; d++) {
            const emb =
              tokW[vO + d]! + (tokW[c0O + d]! + tokW[c1O + d]! + tokW[c2O + d]!) * (1 / 3);
            SCRATCH.urlEmb[d] = SCRATCH.urlEmb[d]! + emb * inv;
          }
        }
      }

      SCRATCH.lrPair.set(SCRATCH.hSpan, 0);
      SCRATCH.lrPair.set(SCRATCH.urlEmb, D_MODEL);
      linearVecInto(net.linkCrossQuery, SCRATCH.lrPair, 0, SCRATCH.crossQ, 0, false);
      crossAttendContext(SCRATCH.crossQ, H, L, SCRATCH.hCtx);

      const geom = extractLinkStructuralGeometry(link, doc, bestCodeStr);
      SCRATCH.linkRaw.set(SCRATCH.hSpan, 0);
      SCRATCH.linkRaw.set(SCRATCH.urlEmb, D_MODEL);
      SCRATCH.linkRaw.set(SCRATCH.hCtx, D_MODEL * 2);
      SCRATCH.linkRaw.set(geom, D_MODEL * 3);

      linearVecInto(net.linkSpanProj, SCRATCH.linkRaw, 0, SCRATCH.linkLatents, j * D_POINTER, true);
    }

    for (let j = 0; j < M; j++) {
      const zOff = j * D_POINTER;
      if (M > 1) {
        SCRATCH.rivalBuf.fill(-Infinity);
        for (let k = 0; k < M; k++) {
          if (k === j) {
            continue;
          }
          const kOff = k * D_POINTER;
          for (let d = 0; d < D_POINTER; d++) {
            const v = SCRATCH.linkLatents[kOff + d]!;
            if (v > SCRATCH.rivalBuf[d]!) {
              SCRATCH.rivalBuf[d] = v;
            }
          }
        }
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.rivalBuf[d] = SCRATCH.linkLatents[zOff + d]! - SCRATCH.rivalBuf[d]!;
        }
        linearVecInto(net.linkSetInteract, SCRATCH.rivalBuf, 0, SCRATCH.linkRefined, zOff, true);
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.linkRefined[zOff + d] =
            SCRATCH.linkLatents[zOff + d]! + SCRATCH.linkRefined[zOff + d]!;
        }
      } else {
        for (let d = 0; d < D_POINTER; d++) {
          SCRATCH.linkRefined[zOff + d] = SCRATCH.linkLatents[zOff + d]!;
        }
      }

      let sc = net.linkScoreHead.bias[0] ?? 0;
      for (let d = 0; d < D_POINTER; d++) {
        sc += net.linkScoreHead.weights[d]! * SCRATCH.linkRefined[zOff + d]!;
      }
      linkProbs[j] = sc;
    }

    linearVecInto(net.linkNullProj, SCRATCH.zDoc, 0, SCRATCH.zNull, 0, true);
    let nullLogit = net.linkNullScore.bias[0] ?? 0;
    for (let d = 0; d < D_POINTER; d++) {
      nullLogit += net.linkNullScore.weights[d]! * SCRATCH.zNull[d]!;
    }
    linkProbs[M] = nullLogit;

    softmaxInPlace(linkProbs, M + 1, net.temperatures.link);
    nullLinkProb = linkProbs[M]!;

    for (let j = 0; j < M; j++) {
      const p = linkProbs[j]!;
      const zOff = j * D_POINTER;
      for (let d = 0; d < D_POINTER; d++) {
        SCRATCH.zLinkWin[d] = SCRATCH.zLinkWin[d]! + p * SCRATCH.linkRefined[zOff + d]!;
      }
    }

    let bestLIdx = -1;
    let bestLP = -1;
    let runnerUpLP = -1;
    for (let j = 0; j < M; j++) {
      const p = linkProbs[j]!;
      if (p > bestLP) {
        runnerUpLP = bestLP;
        bestLP = p;
        bestLIdx = j;
      } else if (p > runnerUpLP) {
        runnerUpLP = p;
      }
    }

    if (bestLIdx >= 0 && bestLP > nullLinkProb) {
      bestLink = { candidate: eligibleLinks[bestLIdx]!, probability: bestLP };
      linkMargin = Math.max(0, bestLP - Math.max(runnerUpLP, nullLinkProb));
    }

    if (M === 1) {
      linkRanking = bestLink
        ? [bestLink]
        : [{ candidate: eligibleLinks[0]!, probability: linkProbs[0]! }];
    } else {
      linkRanking = eligibleLinks
        .map((candidate, idx) => ({ candidate, probability: linkProbs[idx]! }))
        .sort((a, b) => b.probability - a.probability);
    }

    if (
      bestLink &&
      linkRanking.length > 1 &&
      linkRanking[0]!.probability >= 0.3 &&
      linkRanking[1]!.probability >= 0.25 &&
      linkRanking[0]!.probability - linkRanking[1]!.probability < 0.12 &&
      linkRanking[0]!.candidate.gate.quality >= 80 &&
      linkRanking[1]!.candidate.gate.quality >= 80
    ) {
      ambiguousDualLinks = true;
    }
  }

  // ── 6. Tower 3: Cross-Modal Latent Action Reasoner ────────────────────────
  const expectedDomains = options.expectedDomains ?? [];
  const siteHosts = [...expectedDomains];
  if (options.originUrl) {
    try {
      const h = new URL(options.originUrl).hostname;
      if (h) {
        siteHosts.push(h);
      }
    } catch {
      /* ignore */
    }
  }
  const hasSiteContext = siteHosts.length > 0;
  const senderMatchesSite = Boolean(
    doc.senderDomain &&
    hasSiteContext &&
    siteHosts.some((h) => sameVerificationSite(doc.senderDomain!, h))
  );
  const linkDomainBound = bestLink
    ? checkOriginBound(bestLink.candidate, expectedDomains, options.originUrl)
    : false;
  const otpInBestLinkUrl = Boolean(
    bestOtp &&
    bestLink &&
    bestLink.candidate.url.toLowerCase().includes(bestOtp.candidate.code.toLowerCase())
  );
  const hasIndependentOtp = Boolean(bestOtp && bestOtp.candidate.inVisibleBodyOutsideUrls);
  const exp = options.pageExpectation;
  const hasPageExp = Boolean(
    exp &&
    (exp.hasOtpInputs !== undefined ||
      exp.expectedOtpLength !== undefined ||
      exp.hasMagicLinkPrompt !== undefined)
  );
  const otpLen = bestOtp?.candidate.code.length ?? 0;
  const otpNum = bestOtp ? /^\d+$/.test(bestOtp.candidate.code) : false;

  const aIn = SCRATCH.actionIn;
  aIn.set(SCRATCH.zDoc, 0);
  for (let i = 0; i < INTENT_CLASSES.length; i++) {
    aIn[D_MODEL + i] = SCRATCH.intentLogits[i]!;
  }
  aIn.set(SCRATCH.zOtpWin, D_MODEL + INTENT_CLASSES.length);
  aIn.set(SCRATCH.zLinkWin, D_MODEL + INTENT_CLASSES.length + D_POINTER);

  const mBase = D_MODEL + INTENT_CLASSES.length + D_POINTER * 2;
  aIn[mBase + 0] = bestOtp?.probability ?? 0;
  aIn[mBase + 1] = nullOtpProb;
  aIn[mBase + 2] = otpMargin;
  aIn[mBase + 3] = bestOtp?.candidate.isExplicitBodyCode ? 1 : 0;
  aIn[mBase + 4] = bestOtp?.candidate.inVisibleBodyOutsideUrls ? 1 : 0;
  aIn[mBase + 5] = bestOtp?.candidate.embeddedInEmailHandle ? 1 : 0;
  aIn[mBase + 6] = Math.min(1, otpLen / 10);
  aIn[mBase + 7] = otpNum ? 1 : 0;
  aIn[mBase + 8] = bestLink?.probability ?? 0;
  aIn[mBase + 9] = nullLinkProb;
  aIn[mBase + 10] = linkMargin;
  aIn[mBase + 11] = bestLink ? bestLink.candidate.gate.quality / 100 : 0;
  aIn[mBase + 12] = bestLink?.candidate.gate.structuralAutoOpen ? 1 : 0;
  aIn[mBase + 13] = linkDomainBound ? 1 : 0;
  aIn[mBase + 14] = bestOtp && bestLink ? 1 : 0;
  aIn[mBase + 15] = otpInBestLinkUrl ? 1 : 0;
  aIn[mBase + 16] = hasIndependentOtp ? 1 : 0;
  aIn[mBase + 17] = (options.securityScore ?? 100) / 100;
  aIn[mBase + 18] = options.securityRisk === 'high' ? 1 : 0;
  aIn[mBase + 19] = options.securityRisk === 'medium' ? 1 : 0;
  aIn[mBase + 20] = senderMatchesSite ? 1 : 0;
  aIn[mBase + 21] = hasSiteContext ? 1 : 0;
  aIn[mBase + 22] = ambiguousDualLinks ? 1 : 0;
  aIn[mBase + 23] = hasPageExp ? 1 : 0;
  aIn[mBase + 24] = exp?.hasOtpInputs ? 1 : 0;
  aIn[mBase + 25] = exp?.hasMagicLinkPrompt ? 1 : 0;
  aIn[mBase + 26] =
    exp?.expectedOtpLength && otpLen > 0 ? (exp.expectedOtpLength === otpLen ? 1 : -1) : 0;
  aIn[mBase + 27] =
    exp?.expectedOtpFormat && otpLen > 0
      ? (exp.expectedOtpFormat === 'numeric' ? otpNum : !otpNum)
        ? 1
        : -1
      : 0;

  linearVecInto(net.actionW1, aIn, 0, SCRATCH.actionH1, 0, true);
  linearVecInto(net.actionW2, SCRATCH.actionH1, 0, SCRATCH.actionLogits, 0, false);
  softmaxInPlace(SCRATCH.actionLogits, ACTION_CLASSES.length, net.temperatures.action);

  // Enforce zero-trust WebOTP origin-binding invariant: never auto-open an unbound link
  if (!linkDomainBound) {
    const pOpen = SCRATCH.actionLogits[1]!;
    const pBoth = SCRATCH.actionLogits[2]!;
    SCRATCH.actionLogits[1] = 0;
    SCRATCH.actionLogits[2] = 0;
    if (bestOtp && hasIndependentOtp) {
      SCRATCH.actionLogits[0] = SCRATCH.actionLogits[0]! + pBoth;
      SCRATCH.actionLogits[3] = SCRATCH.actionLogits[3]! + pOpen;
    } else {
      SCRATCH.actionLogits[3] = SCRATCH.actionLogits[3]! + pOpen + pBoth;
    }
  }

  const actionProbs = {} as Record<GhostNetActionClass, number>;
  let bestActionIdx = 0;
  let bestActionProb = -1;
  for (let i = 0; i < ACTION_CLASSES.length; i++) {
    const p = SCRATCH.actionLogits[i]!;
    actionProbs[ACTION_CLASSES[i]!] = p;
    if (p > bestActionProb) {
      bestActionProb = p;
      bestActionIdx = i;
    }
  }

  return {
    intent,
    intentConfidence: bestIntentProb,
    intentProbs,
    bestOtp,
    otpRanking,
    nullOtpProb,
    bestLink,
    linkRanking,
    nullLinkProb,
    ambiguousDualLinks,
    action: ACTION_CLASSES[bestActionIdx]!,
    actionConfidence: bestActionProb,
    actionProbs,
    inferenceMs: performance.now() - t0,
  };
}
