import {
  ACTION_CLASSES,
  B_CODE_CHAR,
  D_ACTION_IN,
  D_FFN,
  D_HEAD,
  D_LINK_RAW,
  D_MODEL,
  D_MORPH_EMB,
  D_POINTER,
  D_SPAN_RAW,
  INTENT_CLASSES,
  MAX_SEQ_LEN,
  N_EMB_ROWS,
  N_HEADS,
  N_ZONES,
} from '../../src/services/extraction/ghostNetTokenizer';
import type {
  GhostNetWeightsBundle,
  QuantizedMatrixSpec,
} from '../../src/services/extraction/ghostNetWeights';

export interface ParamMatrix {
  rows: number;
  cols: number;
  hasBias: boolean;
  w: Float32Array;
  b: Float32Array;
  gw: Float32Array;
  gb: Float32Array;
}

export interface NeuralModelParams {
  tokenEmb: ParamMatrix; // N_EMB_ROWS x D_MODEL (2304 x 48)
  zoneEmb: ParamMatrix; // N_ZONES x D_MODEL (8 x 48)
  codeCharEmb: ParamMatrix; // B_CODE_CHAR x D_MORPH_EMB (256 x 16)
  dwK3: ParamMatrix; // 3 x D_MODEL
  dwK5Dil2: ParamMatrix; // 5 x D_MODEL
  pwGlu: ParamMatrix; // 96 x 96
  norm1Gamma: Float32Array;
  gNorm1Gamma: Float32Array;
  qkvProj: ParamMatrix; // 144 x 48
  relPosBias: Float32Array; // 4 * 15 = 60
  gRelPosBias: Float32Array;
  outProj: ParamMatrix; // 48 x 48
  norm2Gamma: Float32Array;
  gNorm2Gamma: Float32Array;
  ffnW1: ParamMatrix; // 64 x 48
  ffnW2: ParamMatrix; // 48 x 64
  norm3Gamma: Float32Array;
  gNorm3Gamma: Float32Array;
  poolProj: ParamMatrix; // 1 x 48
  intentHead: ParamMatrix; // 8 x 48
  otpCrossQuery: ParamMatrix; // 48 x 96
  otpSpanProj: ParamMatrix; // 32 x 228
  otpSetInteract: ParamMatrix; // 32 x 32
  otpScoreHead: ParamMatrix; // 1 x 32
  otpNullProj: ParamMatrix; // 32 x 48
  otpNullScore: ParamMatrix; // 1 x 32
  linkCrossQuery: ParamMatrix; // 48 x 96
  linkSpanProj: ParamMatrix; // 32 x 160
  linkSetInteract: ParamMatrix; // 32 x 32
  linkScoreHead: ParamMatrix; // 1 x 32
  linkNullProj: ParamMatrix; // 32 x 48
  linkNullScore: ParamMatrix; // 1 x 32
  actionW1: ParamMatrix; // 48 x 148
  actionW2: ParamMatrix; // 5 x 48
}

export interface SerializedModelBuffers {
  weights: Float32Array;
  normsAndBiases: Float32Array;
}

class SeededRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 0x100000000;
  }
  normal(std: number): number {
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

function makeMat(
  rows: number,
  cols: number,
  hasBias: boolean,
  std: number,
  rng: SeededRng
): ParamMatrix {
  const w = new Float32Array(rows * cols);
  for (let i = 0; i < w.length; i++) {
    w[i] = rng.normal(std);
  }
  return {
    rows,
    cols,
    hasBias,
    w,
    b: new Float32Array(rows),
    gw: new Float32Array(rows * cols),
    gb: new Float32Array(rows),
  };
}

export function createInitialParams(seed = 20261119): NeuralModelParams {
  const rng = new SeededRng(seed);
  const embStd = 0.08;
  const xavier = (r: number, c: number) => Math.sqrt(2 / (r + c));
  return {
    tokenEmb: makeMat(N_EMB_ROWS, D_MODEL, false, embStd, rng),
    zoneEmb: makeMat(N_ZONES, D_MODEL, false, embStd, rng),
    codeCharEmb: makeMat(B_CODE_CHAR, D_MORPH_EMB, false, embStd, rng),
    dwK3: makeMat(3, D_MODEL, false, 0.25, rng),
    dwK5Dil2: makeMat(5, D_MODEL, false, 0.2, rng),
    pwGlu: makeMat(D_MODEL * 2, D_MODEL * 2, true, xavier(D_MODEL * 2, D_MODEL * 2), rng),
    norm1Gamma: new Float32Array(D_MODEL).fill(1),
    gNorm1Gamma: new Float32Array(D_MODEL),
    qkvProj: makeMat(D_MODEL * 3, D_MODEL, true, xavier(D_MODEL * 3, D_MODEL), rng),
    relPosBias: new Float32Array(N_HEADS * 15),
    gRelPosBias: new Float32Array(N_HEADS * 15),
    outProj: makeMat(D_MODEL, D_MODEL, true, xavier(D_MODEL, D_MODEL), rng),
    norm2Gamma: new Float32Array(D_MODEL).fill(1),
    gNorm2Gamma: new Float32Array(D_MODEL),
    ffnW1: makeMat(D_FFN, D_MODEL, true, xavier(D_FFN, D_MODEL), rng),
    ffnW2: makeMat(D_MODEL, D_FFN, true, xavier(D_MODEL, D_FFN), rng),
    norm3Gamma: new Float32Array(D_MODEL).fill(1),
    gNorm3Gamma: new Float32Array(D_MODEL),
    poolProj: makeMat(1, D_MODEL, true, xavier(1, D_MODEL), rng),
    intentHead: makeMat(
      INTENT_CLASSES.length,
      D_MODEL,
      true,
      xavier(INTENT_CLASSES.length, D_MODEL),
      rng
    ),
    otpCrossQuery: makeMat(D_MODEL, D_MODEL * 2, true, xavier(D_MODEL, D_MODEL * 2), rng),
    otpSpanProj: makeMat(D_POINTER, D_SPAN_RAW, true, xavier(D_POINTER, D_SPAN_RAW), rng),
    otpSetInteract: makeMat(D_POINTER, D_POINTER, true, xavier(D_POINTER, D_POINTER) * 0.5, rng),
    otpScoreHead: makeMat(1, D_POINTER, true, xavier(1, D_POINTER), rng),
    otpNullProj: makeMat(D_POINTER, D_MODEL, true, xavier(D_POINTER, D_MODEL), rng),
    otpNullScore: makeMat(1, D_POINTER, true, xavier(1, D_POINTER), rng),
    linkCrossQuery: makeMat(D_MODEL, D_MODEL * 2, true, xavier(D_MODEL, D_MODEL * 2), rng),
    linkSpanProj: makeMat(D_POINTER, D_LINK_RAW, true, xavier(D_POINTER, D_LINK_RAW), rng),
    linkSetInteract: makeMat(D_POINTER, D_POINTER, true, xavier(D_POINTER, D_POINTER) * 0.5, rng),
    linkScoreHead: makeMat(1, D_POINTER, true, xavier(1, D_POINTER), rng),
    linkNullProj: makeMat(D_POINTER, D_MODEL, true, xavier(D_POINTER, D_MODEL), rng),
    linkNullScore: makeMat(1, D_POINTER, true, xavier(1, D_POINTER), rng),
    actionW1: makeMat(D_MODEL, D_ACTION_IN, true, xavier(D_MODEL, D_ACTION_IN), rng),
    actionW2: makeMat(
      ACTION_CLASSES.length,
      D_MODEL,
      true,
      xavier(ACTION_CLASSES.length, D_MODEL),
      rng
    ),
  };
}

export function listParamMatrices(p: NeuralModelParams): ParamMatrix[] {
  return [
    p.tokenEmb,
    p.zoneEmb,
    p.codeCharEmb,
    p.dwK3,
    p.dwK5Dil2,
    p.pwGlu,
    p.qkvProj,
    p.outProj,
    p.ffnW1,
    p.ffnW2,
    p.poolProj,
    p.intentHead,
    p.otpCrossQuery,
    p.otpSpanProj,
    p.otpSetInteract,
    p.otpScoreHead,
    p.otpNullProj,
    p.otpNullScore,
    p.linkCrossQuery,
    p.linkSpanProj,
    p.linkSetInteract,
    p.linkScoreHead,
    p.linkNullProj,
    p.linkNullScore,
    p.actionW1,
    p.actionW2,
  ];
}

export function zeroAllGrads(p: NeuralModelParams): void {
  for (const m of listParamMatrices(p)) {
    m.gw.fill(0);
    if (m.hasBias) {
      m.gb.fill(0);
    }
  }
  p.gNorm1Gamma.fill(0);
  p.gNorm2Gamma.fill(0);
  p.gNorm3Gamma.fill(0);
  p.gRelPosBias.fill(0);
}

export function packParamsFlat(p: NeuralModelParams): Float32Array {
  let len = p.norm1Gamma.length + p.norm2Gamma.length + p.norm3Gamma.length + p.relPosBias.length;
  for (const m of listParamMatrices(p)) {
    len += m.w.length + (m.hasBias ? m.b.length : 0);
  }
  const buf = new Float32Array(len);
  let off = 0;
  for (const m of listParamMatrices(p)) {
    buf.set(m.w, off);
    off += m.w.length;
    if (m.hasBias) {
      buf.set(m.b, off);
      off += m.b.length;
    }
  }
  buf.set(p.norm1Gamma, off);
  off += p.norm1Gamma.length;
  buf.set(p.norm2Gamma, off);
  off += p.norm2Gamma.length;
  buf.set(p.norm3Gamma, off);
  off += p.norm3Gamma.length;
  buf.set(p.relPosBias, off);
  return buf;
}

export function unpackParamsFlat(p: NeuralModelParams, buf: Float32Array): void {
  let off = 0;
  for (const m of listParamMatrices(p)) {
    m.w.set(buf.subarray(off, off + m.w.length));
    off += m.w.length;
    if (m.hasBias) {
      m.b.set(buf.subarray(off, off + m.b.length));
      off += m.b.length;
    }
  }
  p.norm1Gamma.set(buf.subarray(off, off + p.norm1Gamma.length));
  off += p.norm1Gamma.length;
  p.norm2Gamma.set(buf.subarray(off, off + p.norm2Gamma.length));
  off += p.norm2Gamma.length;
  p.norm3Gamma.set(buf.subarray(off, off + p.norm3Gamma.length));
  off += p.norm3Gamma.length;
  p.relPosBias.set(buf.subarray(off, off + p.relPosBias.length));
}

export function packGradsFlat(p: NeuralModelParams, out?: Float32Array): Float32Array {
  let len =
    p.gNorm1Gamma.length + p.gNorm2Gamma.length + p.gNorm3Gamma.length + p.gRelPosBias.length;
  for (const m of listParamMatrices(p)) {
    len += m.gw.length + (m.hasBias ? m.gb.length : 0);
  }
  const buf = out && out.length === len ? out : new Float32Array(len);
  let off = 0;
  for (const m of listParamMatrices(p)) {
    buf.set(m.gw, off);
    off += m.gw.length;
    if (m.hasBias) {
      buf.set(m.gb, off);
      off += m.gb.length;
    }
  }
  buf.set(p.gNorm1Gamma, off);
  off += p.gNorm1Gamma.length;
  buf.set(p.gNorm2Gamma, off);
  off += p.gNorm2Gamma.length;
  buf.set(p.gNorm3Gamma, off);
  off += p.gNorm3Gamma.length;
  buf.set(p.gRelPosBias, off);
  return buf;
}

export interface EncodedOtpCand {
  code: string;
  len: number;
  isNum: boolean;
  isExplicit: boolean;
  isVisibleOutsideUrls: boolean;
  embeddedInHandle: boolean;
  positions: number[];
  morphIds: [number, number, number, number];
  geom: Float32Array; // length G_OTP (20)
}

export interface EncodedLinkCand {
  url: string;
  positions: number[];
  urlToks: Array<{ vocabId: number; c0: number; c1: number; c2: number }>;
  geom: Float32Array; // length G_LINK (16)
  gateQualityNorm: number;
  structuralAutoOpen: boolean;
  domainBound: boolean;
}

export interface EncodedSample {
  id: string;
  split: 'train' | 'val' | 'test';
  seqLen: number;
  vocabIds: Uint16Array;
  charIds: Uint16Array;
  zoneIds: Uint8Array;
  intentIdx: number;
  intentLossWeight: number;
  otpCands: EncodedOtpCand[];
  otpTarget: Float32Array | null;
  otpLossWeight: number;
  linkCands: EncodedLinkCand[];
  linkTarget: Float32Array | null;
  linkLossWeight: number;
  actionIdx: number;
  actionLossWeight: number;
  securityScoreNorm: number;
  riskHigh: number;
  riskMedium: number;
  senderMatchesSite: number;
  hasSiteContext: number;
  hasPageExp: number;
  pageHasOtpInputs: number;
  pageHasMagicLinkPrompt: number;
  expectedOtpLength: number;
  expectedOtpFormat?: 'numeric' | 'alphanumeric' | null | undefined;
}

export interface KernelScratch {
  E: Float32Array;
  dE: Float32Array;
  convCat: Float32Array; // L * 96
  dConvCat: Float32Array; // L * 96
  gluVal: Float32Array; // L * 48
  gluSig: Float32Array; // L * 48
  dGluRaw: Float32Array; // 96
  sum1: Float32Array; // L * 48
  rms1: Float32Array; // L
  xHat1: Float32Array; // L * 48
  X1: Float32Array; // L * 48
  dSum1: Float32Array;
  dX1: Float32Array; // L * 48
  QKV: Float32Array; // L * 144
  dQKV: Float32Array; // L * 144
  attnProbs: Float32Array; // N_HEADS * L * L
  attnOut: Float32Array; // L * 48
  dAttnOut: Float32Array; // L * 48
  projAttn: Float32Array; // D_MODEL
  sum2: Float32Array; // L * 48
  rms2: Float32Array; // L
  xHat2: Float32Array; // L * 48
  A: Float32Array; // L * 48
  dA: Float32Array; // L * 48
  ffnPre: Float32Array; // L * D_FFN
  ffnAct: Float32Array; // L * D_FFN
  ffnGrad: Float32Array; // L * D_FFN
  sum3: Float32Array; // L * 48
  rms3: Float32Array; // L
  xHat3: Float32Array; // L * 48
  H: Float32Array; // L * 48
  dH: Float32Array; // L * 48
  poolAlpha: Float32Array; // L
  dPoolAlpha: Float32Array; // L
  zDoc: Float32Array; // 48
  dZDoc: Float32Array; // 48
  intentProbs: Float32Array; // 8
  dIntentLogits: Float32Array; // 8
  // OTP pointer activations
  otpHSpan: Float32Array; // 24 * 48
  otpHLeft: Float32Array; // 24 * 48
  otpHRight: Float32Array; // 24 * 48
  otpCrossQ: Float32Array; // 24 * 48
  otpCrossBeta: Float32Array; // 24 * L
  otpHCtx: Float32Array; // 24 * 48
  otpRaw: Float32Array; // 24 * 228
  otpZPre: Float32Array; // 24 * 32
  otpZ: Float32Array; // 24 * 32
  otpZGeluGrad: Float32Array; // 24 * 32
  otpRivalIdx: Int32Array; // 24 * 32
  otpRivalDiff: Float32Array; // 24 * 32
  otpSetPre: Float32Array; // 24 * 32
  otpSetGrad: Float32Array; // 24 * 32
  otpZRef: Float32Array; // 24 * 32
  otpZNullPre: Float32Array; // 32
  otpZNull: Float32Array; // 32
  otpZNullGrad: Float32Array; // 32
  otpProbs: Float32Array; // 25
  dOtpZRef: Float32Array; // 24 * 32
  dOtpZ: Float32Array; // 24 * 32
  zOtpWin: Float32Array; // 32
  dZOtpWin: Float32Array; // 32
  // Link pointer activations
  linkHSpan: Float32Array; // 20 * 48
  linkHUrl: Float32Array; // 20 * 48
  linkCrossQ: Float32Array; // 20 * 48
  linkCrossBeta: Float32Array; // 20 * L
  linkHCtx: Float32Array; // 20 * 48
  linkRaw: Float32Array; // 20 * 160
  linkZPre: Float32Array; // 20 * 32
  linkZ: Float32Array; // 20 * 32
  linkZGeluGrad: Float32Array; // 20 * 32
  linkRivalIdx: Int32Array; // 20 * 32
  linkRivalDiff: Float32Array; // 20 * 32
  linkSetPre: Float32Array; // 20 * 32
  linkSetGrad: Float32Array; // 20 * 32
  linkZRef: Float32Array; // 20 * 32
  linkZNullPre: Float32Array; // 32
  linkZNull: Float32Array; // 32
  linkZNullGrad: Float32Array; // 32
  linkProbs: Float32Array; // 21
  dLinkZRef: Float32Array; // 20 * 32
  dLinkZ: Float32Array; // 20 * 32
  zLinkWin: Float32Array; // 32
  dZLinkWin: Float32Array; // 32
  // Action reasoner
  actionIn: Float32Array; // 148
  dActionIn: Float32Array; // 148
  actionH1: Float32Array; // 48
  actionH1Grad: Float32Array; // 48
  dActionH1: Float32Array; // 48
  actionProbs: Float32Array; // 5
  // Tiny temp buffers
  tmpD: Float32Array;
  tmp2D: Float32Array;
  tmpPairIn: Float32Array;
  tmpProbGrads: Float32Array;
  tmpFFN: Float32Array;
  tmpBeta: Float32Array;
  tmpScores: Float32Array;
  tmpRawOtp: Float32Array;
  tmpRawLink: Float32Array;
}

export function createKernelScratch(): KernelScratch {
  return {
    E: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dE: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    convCat: new Float32Array(MAX_SEQ_LEN * D_MODEL * 2),
    dConvCat: new Float32Array(MAX_SEQ_LEN * D_MODEL * 2),
    gluVal: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    gluSig: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dGluRaw: new Float32Array(D_MODEL * 2),
    sum1: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    rms1: new Float32Array(MAX_SEQ_LEN),
    xHat1: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    X1: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dSum1: new Float32Array(D_MODEL),
    dX1: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    QKV: new Float32Array(MAX_SEQ_LEN * D_MODEL * 3),
    dQKV: new Float32Array(MAX_SEQ_LEN * D_MODEL * 3),
    attnProbs: new Float32Array(N_HEADS * MAX_SEQ_LEN * MAX_SEQ_LEN),
    attnOut: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dAttnOut: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    projAttn: new Float32Array(D_MODEL),
    sum2: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    rms2: new Float32Array(MAX_SEQ_LEN),
    xHat2: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    A: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dA: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    ffnPre: new Float32Array(MAX_SEQ_LEN * D_FFN),
    ffnAct: new Float32Array(MAX_SEQ_LEN * D_FFN),
    ffnGrad: new Float32Array(MAX_SEQ_LEN * D_FFN),
    sum3: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    rms3: new Float32Array(MAX_SEQ_LEN),
    xHat3: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    H: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    dH: new Float32Array(MAX_SEQ_LEN * D_MODEL),
    poolAlpha: new Float32Array(MAX_SEQ_LEN),
    dPoolAlpha: new Float32Array(MAX_SEQ_LEN),
    zDoc: new Float32Array(D_MODEL),
    dZDoc: new Float32Array(D_MODEL),
    intentProbs: new Float32Array(INTENT_CLASSES.length),
    dIntentLogits: new Float32Array(INTENT_CLASSES.length),
    otpHSpan: new Float32Array(24 * D_MODEL),
    otpHLeft: new Float32Array(24 * D_MODEL),
    otpHRight: new Float32Array(24 * D_MODEL),
    otpCrossQ: new Float32Array(24 * D_MODEL),
    otpCrossBeta: new Float32Array(24 * MAX_SEQ_LEN),
    otpHCtx: new Float32Array(24 * D_MODEL),
    otpRaw: new Float32Array(24 * D_SPAN_RAW),
    otpZPre: new Float32Array(24 * D_POINTER),
    otpZ: new Float32Array(24 * D_POINTER),
    otpZGeluGrad: new Float32Array(24 * D_POINTER),
    otpRivalIdx: new Int32Array(24 * D_POINTER),
    otpRivalDiff: new Float32Array(24 * D_POINTER),
    otpSetPre: new Float32Array(24 * D_POINTER),
    otpSetGrad: new Float32Array(24 * D_POINTER),
    otpZRef: new Float32Array(24 * D_POINTER),
    otpZNullPre: new Float32Array(D_POINTER),
    otpZNull: new Float32Array(D_POINTER),
    otpZNullGrad: new Float32Array(D_POINTER),
    otpProbs: new Float32Array(25),
    dOtpZRef: new Float32Array(24 * D_POINTER),
    dOtpZ: new Float32Array(24 * D_POINTER),
    zOtpWin: new Float32Array(D_POINTER),
    dZOtpWin: new Float32Array(D_POINTER),
    linkHSpan: new Float32Array(20 * D_MODEL),
    linkHUrl: new Float32Array(20 * D_MODEL),
    linkCrossQ: new Float32Array(20 * D_MODEL),
    linkCrossBeta: new Float32Array(20 * MAX_SEQ_LEN),
    linkHCtx: new Float32Array(20 * D_MODEL),
    linkRaw: new Float32Array(20 * D_LINK_RAW),
    linkZPre: new Float32Array(20 * D_POINTER),
    linkZ: new Float32Array(20 * D_POINTER),
    linkZGeluGrad: new Float32Array(20 * D_POINTER),
    linkRivalIdx: new Int32Array(20 * D_POINTER),
    linkRivalDiff: new Float32Array(20 * D_POINTER),
    linkSetPre: new Float32Array(20 * D_POINTER),
    linkSetGrad: new Float32Array(20 * D_POINTER),
    linkZRef: new Float32Array(20 * D_POINTER),
    linkZNullPre: new Float32Array(D_POINTER),
    linkZNull: new Float32Array(D_POINTER),
    linkZNullGrad: new Float32Array(D_POINTER),
    linkProbs: new Float32Array(21),
    dLinkZRef: new Float32Array(20 * D_POINTER),
    dLinkZ: new Float32Array(20 * D_POINTER),
    zLinkWin: new Float32Array(D_POINTER),
    dZLinkWin: new Float32Array(D_POINTER),
    actionIn: new Float32Array(D_ACTION_IN),
    dActionIn: new Float32Array(D_ACTION_IN),
    actionH1: new Float32Array(D_MODEL),
    actionH1Grad: new Float32Array(D_MODEL),
    dActionH1: new Float32Array(D_MODEL),
    actionProbs: new Float32Array(ACTION_CLASSES.length),
    tmpD: new Float32Array(D_MODEL),
    tmp2D: new Float32Array(D_MODEL * 2),
    tmpPairIn: new Float32Array(D_MODEL * 2),
    tmpProbGrads: new Float32Array(25),
    tmpFFN: new Float32Array(D_FFN),
    tmpBeta: new Float32Array(MAX_SEQ_LEN),
    tmpScores: new Float32Array(MAX_SEQ_LEN),
    tmpRawOtp: new Float32Array(D_SPAN_RAW),
    tmpRawLink: new Float32Array(D_LINK_RAW),
  };
}

function copySlice(
  src: Float32Array,
  srcOff: number,
  dst: Float32Array,
  dstOff: number,
  len: number
): void {
  for (let i = 0; i < len; i++) {
    dst[dstOff + i] = src[srcOff + i]!;
  }
}

function geluWrite(
  x: number,
  actArr: Float32Array,
  actIdx: number,
  gradArr: Float32Array,
  gradIdx: number
): void {
  const c = 0.7978845608028654;
  const a = 0.044715;
  const x2 = x * x;
  const u = c * (x + a * x2 * x);
  const t = Math.tanh(u);
  actArr[actIdx] = 0.5 * x * (1 + t);
  gradArr[gradIdx] = 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * a * x2);
}

function geluValGrad(x: number): [number, number] {
  const c = 0.7978845608028654;
  const a = 0.044715;
  const x2 = x * x;
  const u = c * (x + a * x2 * x);
  const t = Math.tanh(u);
  const y = 0.5 * x * (1 + t);
  const dy = 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * a * x2);
  return [y, dy];
}

function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

function linearFwd(
  m: ParamMatrix,
  x: Float32Array,
  xOff: number,
  out: Float32Array,
  outOff: number
): void {
  const { rows, cols, w, b, hasBias } = m;
  const cols4 = cols & ~3;
  for (let r = 0; r < rows; r++) {
    let acc = hasBias ? b[r]! : 0;
    const wOff = r * cols;
    let c = 0;
    for (; c < cols4; c += 4) {
      acc +=
        w[wOff + c]! * x[xOff + c]! +
        w[wOff + c + 1]! * x[xOff + c + 1]! +
        w[wOff + c + 2]! * x[xOff + c + 2]! +
        w[wOff + c + 3]! * x[xOff + c + 3]!;
    }
    for (; c < cols; c++) {
      acc += w[wOff + c]! * x[xOff + c]!;
    }
    out[outOff + r] = acc;
  }
}

function linearBwd(
  m: ParamMatrix,
  x: Float32Array,
  xOff: number,
  dOut: Float32Array,
  dOutOff: number,
  dX: Float32Array | null,
  dXOff: number
): void {
  const { rows, cols, w, gw, gb, hasBias } = m;
  const cols4 = cols & ~3;
  if (dX) {
    for (let r = 0; r < rows; r++) {
      const g = dOut[dOutOff + r]!;
      if (g === 0) {
        continue;
      }
      if (hasBias) {
        gb[r] = gb[r]! + g;
      }
      const wOff = r * cols;
      let c = 0;
      for (; c < cols4; c += 4) {
        const wc0 = wOff + c;
        const xc0 = xOff + c;
        const dx0 = dXOff + c;
        gw[wc0] = gw[wc0]! + g * x[xc0]!;
        gw[wc0 + 1] = gw[wc0 + 1]! + g * x[xc0 + 1]!;
        gw[wc0 + 2] = gw[wc0 + 2]! + g * x[xc0 + 2]!;
        gw[wc0 + 3] = gw[wc0 + 3]! + g * x[xc0 + 3]!;
        dX[dx0] = dX[dx0]! + g * w[wc0]!;
        dX[dx0 + 1] = dX[dx0 + 1]! + g * w[wc0 + 1]!;
        dX[dx0 + 2] = dX[dx0 + 2]! + g * w[wc0 + 2]!;
        dX[dx0 + 3] = dX[dx0 + 3]! + g * w[wc0 + 3]!;
      }
      for (; c < cols; c++) {
        gw[wOff + c] = gw[wOff + c]! + g * x[xOff + c]!;
        dX[dXOff + c] = dX[dXOff + c]! + g * w[wOff + c]!;
      }
    }
  } else {
    for (let r = 0; r < rows; r++) {
      const g = dOut[dOutOff + r]!;
      if (g === 0) {
        continue;
      }
      if (hasBias) {
        gb[r] = gb[r]! + g;
      }
      const wOff = r * cols;
      let c = 0;
      for (; c < cols4; c += 4) {
        const wc0 = wOff + c;
        const xc0 = xOff + c;
        gw[wc0] = gw[wc0]! + g * x[xc0]!;
        gw[wc0 + 1] = gw[wc0 + 1]! + g * x[xc0 + 1]!;
        gw[wc0 + 2] = gw[wc0 + 2]! + g * x[xc0 + 2]!;
        gw[wc0 + 3] = gw[wc0 + 3]! + g * x[xc0 + 3]!;
      }
      for (; c < cols; c++) {
        gw[wOff + c] = gw[wOff + c]! + g * x[xOff + c]!;
      }
    }
  }
}

function softmaxArray(arr: Float32Array, len: number): void {
  let maxV = -Infinity;
  for (let i = 0; i < len; i++) {
    if (arr[i]! > maxV) {
      maxV = arr[i]!;
    }
  }
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const e = Math.exp(arr[i]! - maxV);
    arr[i] = e;
    sum += e;
  }
  const inv = sum > 0 ? 1 / sum : 1;
  for (let i = 0; i < len; i++) {
    arr[i] = arr[i]! * inv;
  }
}

function rmsNormBwd(
  xHat: Float32Array,
  xHatOff: number,
  invRms: number,
  gamma: Float32Array,
  gGamma: Float32Array,
  dOut: Float32Array,
  dOutOff: number,
  dIn: Float32Array,
  dInOff: number,
  dim: number,
  gHatBuf: Float32Array
): void {
  let dot = 0;
  for (let d = 0; d < dim; d++) {
    const go = dOut[dOutOff + d]!;
    const xh = xHat[xHatOff + d]!;
    gGamma[d] = gGamma[d]! + go * xh;
    const gh = go * gamma[d]!;
    gHatBuf[d] = gh;
    dot += gh * xh;
  }
  const avgDot = dot / dim;
  for (let d = 0; d < dim; d++) {
    dIn[dInOff + d] = dIn[dInOff + d]! + invRms * (gHatBuf[d]! - xHat[xHatOff + d]! * avgDot);
  }
}

function accumulateSpanBwd(
  dH: Float32Array,
  seqLen: number,
  positions: number[],
  dSpan: Float32Array,
  dSpanOff: number,
  dLeft: Float32Array,
  dLeftOff: number,
  dRight: Float32Array,
  dRightOff: number
): void {
  const count = Math.max(1, positions.length);
  const invCount = 1 / count;
  for (let idx = 0; idx < positions.length; idx++) {
    const p = positions[idx]!;
    const pOff = p * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      dH[pOff + d] = dH[pOff + d]! + dSpan[dSpanOff + d]! * invCount;
    }

    let leftW = 0;
    let w = 1;
    for (let dist = 1; dist <= 6 && p - dist >= 0; dist++) {
      leftW += w;
      w *= 0.55;
    }
    if (leftW > 0) {
      w = 1;
      for (let dist = 1; dist <= 6 && p - dist >= 0; dist++) {
        const s = (w / leftW) * invCount;
        const off = (p - dist) * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          dH[off + d] = dH[off + d]! + dLeft[dLeftOff + d]! * s;
        }
        w *= 0.55;
      }
    }

    let rightW = 0;
    w = 1;
    for (let dist = 1; dist <= 6 && p + dist < seqLen; dist++) {
      rightW += w;
      w *= 0.55;
    }
    if (rightW > 0) {
      w = 1;
      for (let dist = 1; dist <= 6 && p + dist < seqLen; dist++) {
        const s = (w / rightW) * invCount;
        const off = (p + dist) * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          dH[off + d] = dH[off + d]! + dRight[dRightOff + d]! * s;
        }
        w *= 0.55;
      }
    }
  }
}

export interface SampleStepStats {
  loss: number;
  intentCorrect: boolean;
  otpChecked: boolean;
  otpCorrect: boolean;
  linkChecked: boolean;
  linkCorrect: boolean;
  actionCorrect: boolean;
  falseAutoAct: boolean;
}

export function forwardBackwardSample(
  sample: EncodedSample,
  params: NeuralModelParams,
  sc: KernelScratch,
  computeGrads: boolean,
  lossWeights: { otp: number; link: number; action: number } = { otp: 1.0, link: 1.0, action: 0.8 }
): SampleStepStats {
  const L = sample.seqLen;
  const tokW = params.tokenEmb.w;
  const E = sc.E;

  // ── 1. Token + Char3gram + Zone Embeddings ──────────────────────────────
  for (let t = 0; t < L; t++) {
    const vO = sample.vocabIds[t]! * D_MODEL;
    const c0O = sample.charIds[t * 3]! * D_MODEL;
    const c1O = sample.charIds[t * 3 + 1]! * D_MODEL;
    const c2O = sample.charIds[t * 3 + 2]! * D_MODEL;
    const zO = sample.zoneIds[t]! * D_MODEL;
    const outO = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      const cAvg = (tokW[c0O + d]! + tokW[c1O + d]! + tokW[c2O + d]!) * (1 / 3);
      E[outO + d] = tokW[vO + d]! + cAvg + params.zoneEmb.w[zO + d]!;
    }
  }

  // ── 2. Bi-Directional Multi-Scale Depthwise + Pointwise GLU Conv ────────
  const X1 = sc.X1;
  for (let t = 0; t < L; t++) {
    const cO = t * D_MODEL * 2;
    sc.convCat.fill(0, cO, cO + D_MODEL * 2);
    for (let k = -1; k <= 1; k++) {
      const pos = t + k;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wO = (k + 1) * D_MODEL;
      const eO = pos * D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        sc.convCat[cO + d] = sc.convCat[cO + d]! + params.dwK3.w[wO + d]! * E[eO + d]!;
      }
    }
    for (let k = 0; k < 5; k++) {
      const pos = t + (k - 2) * 2;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wO = k * D_MODEL;
      const eO = pos * D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        sc.convCat[cO + D_MODEL + d] =
          sc.convCat[cO + D_MODEL + d]! + params.dwK5Dil2.w[wO + d]! * E[eO + d]!;
      }
    }
    linearFwd(params.pwGlu, sc.convCat, cO, sc.dGluRaw, 0);
    let sq = 0;
    const tO = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      const val = sc.dGluRaw[d]!;
      const sig = sigmoid(sc.dGluRaw[D_MODEL + d]!);
      sc.gluVal[tO + d] = val;
      sc.gluSig[tO + d] = sig;
      const s = E[tO + d]! + val * sig;
      sc.sum1[tO + d] = s;
      sq += s * s;
    }
    const invRms = 1 / Math.sqrt(sq / D_MODEL + 1e-5);
    sc.rms1[t] = invRms;
    for (let d = 0; d < D_MODEL; d++) {
      const xh = sc.sum1[tO + d]! * invRms;
      sc.xHat1[tO + d] = xh;
      X1[tO + d] = xh * params.norm1Gamma[d]!;
    }
  }

  // ── 3. 4-Head Self-Attention w/ Relative Position Bias + FFN ────────────
  for (let t = 0; t < L; t++) {
    linearFwd(params.qkvProj, X1, t * D_MODEL, sc.QKV, t * D_MODEL * 3);
  }
  const headScale = 1 / Math.sqrt(D_HEAD);
  for (let t = 0; t < L; t++) {
    const tQkv = t * D_MODEL * 3;
    const tOut = t * D_MODEL;
    sc.attnOut.fill(0, tOut, tOut + D_MODEL);

    for (let h = 0; h < N_HEADS; h++) {
      const hO = h * D_HEAD;
      const bBase = h * 15;
      const probBase = (h * L + t) * L;
      for (let s = 0; s < L; s++) {
        const sK = s * D_MODEL * 3 + D_MODEL + hO;
        let dot = 0;
        for (let d = 0; d < D_HEAD; d++) {
          dot += sc.QKV[tQkv + hO + d]! * sc.QKV[sK + d]!;
        }
        const rel = Math.max(-7, Math.min(7, s - t)) + 7;
        sc.attnProbs[probBase + s] = dot * headScale + params.relPosBias[bBase + rel]!;
      }
      // Softmax slice [probBase .. probBase + L)
      let maxV = -Infinity;
      for (let s = 0; s < L; s++) {
        const v = sc.attnProbs[probBase + s]!;
        if (v > maxV) {
          maxV = v;
        }
      }
      let pSum = 0;
      for (let s = 0; s < L; s++) {
        const e = Math.exp(sc.attnProbs[probBase + s]! - maxV);
        sc.attnProbs[probBase + s] = e;
        pSum += e;
      }
      const inv = pSum > 0 ? 1 / pSum : 1;
      for (let s = 0; s < L; s++) {
        const w = sc.attnProbs[probBase + s]! * inv;
        sc.attnProbs[probBase + s] = w;
        const sV = s * D_MODEL * 3 + D_MODEL * 2 + hO;
        for (let d = 0; d < D_HEAD; d++) {
          sc.attnOut[tOut + hO + d] = sc.attnOut[tOut + hO + d]! + w * sc.QKV[sV + d]!;
        }
      }
    }

    linearFwd(params.outProj, sc.attnOut, tOut, sc.projAttn, 0);
    let sq2 = 0;
    for (let d = 0; d < D_MODEL; d++) {
      const s = X1[tOut + d]! + sc.projAttn[d]!;
      sc.sum2[tOut + d] = s;
      sq2 += s * s;
    }
    const invRms2 = 1 / Math.sqrt(sq2 / D_MODEL + 1e-5);
    sc.rms2[t] = invRms2;
    for (let d = 0; d < D_MODEL; d++) {
      const xh = sc.sum2[tOut + d]! * invRms2;
      sc.xHat2[tOut + d] = xh;
      sc.A[tOut + d] = xh * params.norm2Gamma[d]!;
    }

    // Position-wise FFN
    const fO = t * D_FFN;
    linearFwd(params.ffnW1, sc.A, tOut, sc.ffnPre, fO);
    for (let r = 0; r < D_FFN; r++) {
      geluWrite(sc.ffnPre[fO + r]!, sc.ffnAct, fO + r, sc.ffnGrad, fO + r);
    }
    linearFwd(params.ffnW2, sc.ffnAct, fO, sc.tmpD, 0);
    let sq3 = 0;
    for (let d = 0; d < D_MODEL; d++) {
      const s = sc.A[tOut + d]! + sc.tmpD[d]!;
      sc.sum3[tOut + d] = s;
      sq3 += s * s;
    }
    const invRms3 = 1 / Math.sqrt(sq3 / D_MODEL + 1e-5);
    sc.rms3[t] = invRms3;
    for (let d = 0; d < D_MODEL; d++) {
      const xh = sc.sum3[tOut + d]! * invRms3;
      sc.xHat3[tOut + d] = xh;
      sc.H[tOut + d] = xh * params.norm3Gamma[d]!;
    }
  }

  // ── 4. Attention Pooling + Intent Loss ──────────────────────────────────
  const H = sc.H;
  for (let t = 0; t < L; t++) {
    let scVal = params.poolProj.b[0]!;
    const hO = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      scVal += params.poolProj.w[d]! * H[hO + d]!;
    }
    sc.poolAlpha[t] = scVal;
  }
  softmaxArray(sc.poolAlpha, L);
  sc.zDoc.fill(0);
  for (let t = 0; t < L; t++) {
    const w = 0.5 * sc.poolAlpha[t]!;
    const hO = t * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      sc.zDoc[d] = sc.zDoc[d]! + w * H[hO + d]!;
    }
  }
  for (let d = 0; d < D_MODEL; d++) {
    sc.zDoc[d] = sc.zDoc[d]! + 0.5 * H[d]!;
  }

  linearFwd(params.intentHead, sc.zDoc, 0, sc.intentProbs, 0);
  softmaxArray(sc.intentProbs, INTENT_CLASSES.length);

  const INTENT_SMOOTH = 0.02;
  const smoothFloor = INTENT_SMOOTH / INTENT_CLASSES.length;
  let totalLoss = 0;
  for (let i = 0; i < INTENT_CLASSES.length; i++) {
    const q = (i === sample.intentIdx ? 1 - INTENT_SMOOTH : 0) + smoothFloor;
    totalLoss -= sample.intentLossWeight * q * Math.log(Math.max(1e-12, sc.intentProbs[i]!));
  }
  let predIntent = 0;
  for (let i = 1; i < INTENT_CLASSES.length; i++) {
    if (sc.intentProbs[i]! > sc.intentProbs[predIntent]!) {
      predIntent = i;
    }
  }

  // ── 5. Tower 2A: OTP Span Cross-Attention + Set Interaction + <NULL_OTP> ─
  const K = sample.otpCands.length;
  sc.zOtpWin.fill(0);
  let bestOtpIdx = -1;
  let bestOtpProb = 0;
  let nullOtpProb = 1;
  let otpMargin = 0;
  let otpChecked = false;
  let otpCorrect = true;

  if (K > 0) {
    const morphW = params.codeCharEmb.w;
    for (let i = 0; i < K; i++) {
      const cand = sample.otpCands[i]!;
      const dO = i * D_MODEL;
      sc.otpHSpan.fill(0, dO, dO + D_MODEL);
      sc.otpHLeft.fill(0, dO, dO + D_MODEL);
      sc.otpHRight.fill(0, dO, dO + D_MODEL);

      const posList = cand.positions;
      const invCnt = 1 / Math.max(1, posList.length);
      for (const p of posList) {
        const pO = p * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.otpHSpan[dO + d] = sc.otpHSpan[dO + d]! + H[pO + d]! * invCnt;
        }
        let lW = 0;
        let w = 1;
        for (let dist = 1; dist <= 6 && p - dist >= 0; dist++) {
          lW += w;
          w *= 0.55;
        }
        if (lW > 0) {
          w = 1;
          for (let dist = 1; dist <= 6 && p - dist >= 0; dist++) {
            const scale = (w / lW) * invCnt;
            const o = (p - dist) * D_MODEL;
            for (let d = 0; d < D_MODEL; d++) {
              sc.otpHLeft[dO + d] = sc.otpHLeft[dO + d]! + H[o + d]! * scale;
            }
            w *= 0.55;
          }
        }
        let rW = 0;
        w = 1;
        for (let dist = 1; dist <= 6 && p + dist < L; dist++) {
          rW += w;
          w *= 0.55;
        }
        if (rW > 0) {
          w = 1;
          for (let dist = 1; dist <= 6 && p + dist < L; dist++) {
            const scale = (w / rW) * invCnt;
            const o = (p + dist) * D_MODEL;
            for (let d = 0; d < D_MODEL; d++) {
              sc.otpHRight[dO + d] = sc.otpHRight[dO + d]! + H[o + d]! * scale;
            }
            w *= 0.55;
          }
        }
      }

      copySlice(sc.otpHLeft, dO, sc.tmp2D, 0, D_MODEL);
      copySlice(sc.otpHRight, dO, sc.tmp2D, D_MODEL, D_MODEL);
      linearFwd(params.otpCrossQuery, sc.tmp2D, 0, sc.otpCrossQ, dO);

      const scaleQ = 1 / Math.sqrt(D_MODEL);
      const bO = i * L;
      for (let t = 0; t < L; t++) {
        let dot = 0;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          dot += sc.otpCrossQ[dO + d]! * H[tO + d]!;
        }
        sc.tmpBeta[t] = dot * scaleQ;
      }
      softmaxArray(sc.tmpBeta, L);
      copySlice(sc.tmpBeta, 0, sc.otpCrossBeta, bO, L);
      sc.otpHCtx.fill(0, dO, dO + D_MODEL);
      for (let t = 0; t < L; t++) {
        const bw = sc.tmpBeta[t]!;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.otpHCtx[dO + d] = sc.otpHCtx[dO + d]! + bw * H[tO + d]!;
        }
      }

      const rawO = i * D_SPAN_RAW;
      copySlice(sc.otpHLeft, dO, sc.otpRaw, rawO, D_MODEL);
      copySlice(sc.otpHRight, dO, sc.otpRaw, rawO + D_MODEL, D_MODEL);
      copySlice(sc.otpHSpan, dO, sc.otpRaw, rawO + D_MODEL * 2, D_MODEL);
      copySlice(sc.otpHCtx, dO, sc.otpRaw, rawO + D_MODEL * 3, D_MODEL);

      const mIds = cand.morphIds;
      const mO0 = mIds[0] * D_MORPH_EMB;
      const mO1 = mIds[1] * D_MORPH_EMB;
      const mO2 = mIds[2] * D_MORPH_EMB;
      const mO3 = mIds[3] * D_MORPH_EMB;
      for (let d = 0; d < D_MORPH_EMB; d++) {
        sc.otpRaw[rawO + D_MODEL * 4 + d] =
          (morphW[mO0 + d]! + morphW[mO1 + d]! + morphW[mO2 + d]! + morphW[mO3 + d]!) * 0.25;
      }
      copySlice(cand.geom, 0, sc.otpRaw, rawO + D_MODEL * 4 + D_MORPH_EMB, cand.geom.length);

      const zO = i * D_POINTER;
      linearFwd(params.otpSpanProj, sc.otpRaw, rawO, sc.otpZPre, zO);
      for (let d = 0; d < D_POINTER; d++) {
        geluWrite(sc.otpZPre[zO + d]!, sc.otpZ, zO + d, sc.otpZGeluGrad, zO + d);
      }
    }

    for (let i = 0; i < K; i++) {
      const zO = i * D_POINTER;
      if (K > 1) {
        for (let d = 0; d < D_POINTER; d++) {
          let maxV = -Infinity;
          let maxIdx = 0;
          for (let j = 0; j < K; j++) {
            if (j === i) {
              continue;
            }
            const v = sc.otpZ[j * D_POINTER + d]!;
            if (v > maxV) {
              maxV = v;
              maxIdx = j;
            }
          }
          sc.otpRivalIdx[zO + d] = maxIdx;
          sc.otpRivalDiff[zO + d] = sc.otpZ[zO + d]! - maxV;
        }
        linearFwd(params.otpSetInteract, sc.otpRivalDiff, zO, sc.otpSetPre, zO);
        for (let d = 0; d < D_POINTER; d++) {
          geluWrite(sc.otpSetPre[zO + d]!, sc.otpZRef, zO + d, sc.otpSetGrad, zO + d);
          sc.otpZRef[zO + d] = sc.otpZ[zO + d]! + sc.otpZRef[zO + d]!;
        }
      } else {
        copySlice(sc.otpZ, zO, sc.otpZRef, zO, D_POINTER);
      }
      linearFwd(params.otpScoreHead, sc.otpZRef, zO, sc.otpProbs, i);
    }

    linearFwd(params.otpNullProj, sc.zDoc, 0, sc.otpZNullPre, 0);
    for (let d = 0; d < D_POINTER; d++) {
      geluWrite(sc.otpZNullPre[d]!, sc.otpZNull, d, sc.otpZNullGrad, d);
    }
    linearFwd(params.otpNullScore, sc.otpZNull, 0, sc.otpProbs, K);
    softmaxArray(sc.otpProbs, K + 1);

    nullOtpProb = sc.otpProbs[K]!;
    let topI = 0;
    for (let i = 1; i < K; i++) {
      if (sc.otpProbs[i]! > sc.otpProbs[topI]!) {
        topI = i;
      }
    }
    if (sc.otpProbs[topI]! > nullOtpProb) {
      bestOtpIdx = topI;
      bestOtpProb = sc.otpProbs[topI]!;
      let runner = 0;
      for (let i = 0; i < K; i++) {
        if (i !== topI && sc.otpProbs[i]! > runner) {
          runner = sc.otpProbs[i]!;
        }
      }
      otpMargin = Math.max(0, bestOtpProb - Math.max(runner, nullOtpProb));
    }
    for (let i = 0; i < K; i++) {
      const p = sc.otpProbs[i]!;
      const zO = i * D_POINTER;
      for (let d = 0; d < D_POINTER; d++) {
        sc.zOtpWin[d] = sc.zOtpWin[d]! + p * sc.otpZRef[zO + d]!;
      }
    }

    if (sample.otpTarget) {
      otpChecked = true;
      let winAll = 0;
      for (let i = 1; i <= K; i++) {
        if (sc.otpProbs[i]! > sc.otpProbs[winAll]!) {
          winAll = i;
        }
      }
      otpCorrect = (sample.otpTarget[winAll] ?? 0) > 0;
      for (let i = 0; i <= K; i++) {
        const tgt = sample.otpTarget[i]!;
        if (tgt > 0) {
          totalLoss -=
            lossWeights.otp *
            sample.otpLossWeight *
            tgt *
            Math.log(Math.max(1e-12, sc.otpProbs[i]!));
        }
      }
    }
  }

  // ── 6. Tower 2B: Link Span Cross-Attention + Set Interaction + <NULL_LINK> ─
  const M = sample.linkCands.length;
  sc.zLinkWin.fill(0);
  let bestLinkIdx = -1;
  let bestLinkProb = 0;
  let nullLinkProb = 1;
  let linkMargin = 0;
  let ambiguousDualLinks = false;
  let linkChecked = false;
  let linkCorrect = true;

  if (M > 0) {
    const bestCodeStr = bestOtpIdx >= 0 ? sample.otpCands[bestOtpIdx]!.code.toLowerCase() : null;
    for (let j = 0; j < M; j++) {
      const lc = sample.linkCands[j]!;
      const dO = j * D_MODEL;
      sc.linkHSpan.fill(0, dO, dO + D_MODEL);
      const posList = lc.positions;
      const invCnt = 1 / Math.max(1, posList.length);
      for (const p of posList) {
        const pO = p * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.linkHSpan[dO + d] = sc.linkHSpan[dO + d]! + H[pO + d]! * invCnt;
        }
      }

      sc.linkHUrl.fill(0, dO, dO + D_MODEL);
      if (lc.urlToks.length > 0) {
        const invU = 1 / lc.urlToks.length;
        for (const ut of lc.urlToks) {
          const vO = ut.vocabId * D_MODEL;
          const c0O = ut.c0 * D_MODEL;
          const c1O = ut.c1 * D_MODEL;
          const c2O = ut.c2 * D_MODEL;
          for (let d = 0; d < D_MODEL; d++) {
            const emb =
              tokW[vO + d]! + (tokW[c0O + d]! + tokW[c1O + d]! + tokW[c2O + d]!) * (1 / 3);
            sc.linkHUrl[dO + d] = sc.linkHUrl[dO + d]! + emb * invU;
          }
        }
      }

      copySlice(sc.linkHSpan, dO, sc.tmp2D, 0, D_MODEL);
      copySlice(sc.linkHUrl, dO, sc.tmp2D, D_MODEL, D_MODEL);
      linearFwd(params.linkCrossQuery, sc.tmp2D, 0, sc.linkCrossQ, dO);

      const scaleQ = 1 / Math.sqrt(D_MODEL);
      const bO = j * L;
      for (let t = 0; t < L; t++) {
        let dot = 0;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          dot += sc.linkCrossQ[dO + d]! * H[tO + d]!;
        }
        sc.tmpBeta[t] = dot * scaleQ;
      }
      softmaxArray(sc.tmpBeta, L);
      copySlice(sc.tmpBeta, 0, sc.linkCrossBeta, bO, L);
      sc.linkHCtx.fill(0, dO, dO + D_MODEL);
      for (let t = 0; t < L; t++) {
        const bw = sc.tmpBeta[t]!;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.linkHCtx[dO + d] = sc.linkHCtx[dO + d]! + bw * H[tO + d]!;
        }
      }

      const rawO = j * D_LINK_RAW;
      copySlice(sc.linkHSpan, dO, sc.linkRaw, rawO, D_MODEL);
      copySlice(sc.linkHUrl, dO, sc.linkRaw, rawO + D_MODEL, D_MODEL);
      copySlice(sc.linkHCtx, dO, sc.linkRaw, rawO + D_MODEL * 2, D_MODEL);
      copySlice(lc.geom, 0, sc.linkRaw, rawO + D_MODEL * 3, lc.geom.length);
      // Sync dynamic containsOtpCode feature (index 12)
      sc.linkRaw[rawO + D_MODEL * 3 + 12] =
        bestCodeStr && lc.url.toLowerCase().includes(bestCodeStr) ? 1 : 0;

      const zO = j * D_POINTER;
      linearFwd(params.linkSpanProj, sc.linkRaw, rawO, sc.linkZPre, zO);
      for (let d = 0; d < D_POINTER; d++) {
        geluWrite(sc.linkZPre[zO + d]!, sc.linkZ, zO + d, sc.linkZGeluGrad, zO + d);
      }
    }

    for (let j = 0; j < M; j++) {
      const zO = j * D_POINTER;
      if (M > 1) {
        for (let d = 0; d < D_POINTER; d++) {
          let maxV = -Infinity;
          let maxIdx = 0;
          for (let k = 0; k < M; k++) {
            if (k === j) {
              continue;
            }
            const v = sc.linkZ[k * D_POINTER + d]!;
            if (v > maxV) {
              maxV = v;
              maxIdx = k;
            }
          }
          sc.linkRivalIdx[zO + d] = maxIdx;
          sc.linkRivalDiff[zO + d] = sc.linkZ[zO + d]! - maxV;
        }
        linearFwd(params.linkSetInteract, sc.linkRivalDiff, zO, sc.linkSetPre, zO);
        for (let d = 0; d < D_POINTER; d++) {
          geluWrite(sc.linkSetPre[zO + d]!, sc.linkZRef, zO + d, sc.linkSetGrad, zO + d);
          sc.linkZRef[zO + d] = sc.linkZ[zO + d]! + sc.linkZRef[zO + d]!;
        }
      } else {
        copySlice(sc.linkZ, zO, sc.linkZRef, zO, D_POINTER);
      }
      linearFwd(params.linkScoreHead, sc.linkZRef, zO, sc.linkProbs, j);
    }

    linearFwd(params.linkNullProj, sc.zDoc, 0, sc.linkZNullPre, 0);
    for (let d = 0; d < D_POINTER; d++) {
      geluWrite(sc.linkZNullPre[d]!, sc.linkZNull, d, sc.linkZNullGrad, d);
    }
    linearFwd(params.linkNullScore, sc.linkZNull, 0, sc.linkProbs, M);
    softmaxArray(sc.linkProbs, M + 1);

    nullLinkProb = sc.linkProbs[M]!;
    let topJ = 0;
    for (let j = 1; j < M; j++) {
      if (sc.linkProbs[j]! > sc.linkProbs[topJ]!) {
        topJ = j;
      }
    }
    if (sc.linkProbs[topJ]! > nullLinkProb) {
      bestLinkIdx = topJ;
      bestLinkProb = sc.linkProbs[topJ]!;
      let runnerIdx = -1;
      let runner = 0;
      for (let j = 0; j < M; j++) {
        if (j !== topJ && sc.linkProbs[j]! > runner) {
          runner = sc.linkProbs[j]!;
          runnerIdx = j;
        }
      }
      linkMargin = Math.max(0, bestLinkProb - Math.max(runner, nullLinkProb));
      if (
        runnerIdx >= 0 &&
        bestLinkProb >= 0.3 &&
        runner >= 0.25 &&
        bestLinkProb - runner < 0.12 &&
        sample.linkCands[topJ]!.gateQualityNorm >= 0.8 &&
        sample.linkCands[runnerIdx]!.gateQualityNorm >= 0.8
      ) {
        ambiguousDualLinks = true;
      }
    }

    for (let j = 0; j < M; j++) {
      const p = sc.linkProbs[j]!;
      const zO = j * D_POINTER;
      for (let d = 0; d < D_POINTER; d++) {
        sc.zLinkWin[d] = sc.zLinkWin[d]! + p * sc.linkZRef[zO + d]!;
      }
    }

    if (sample.linkTarget) {
      linkChecked = true;
      let winAll = 0;
      for (let j = 1; j <= M; j++) {
        if (sc.linkProbs[j]! > sc.linkProbs[winAll]!) {
          winAll = j;
        }
      }
      linkCorrect = (sample.linkTarget[winAll] ?? 0) > 0;
      for (let j = 0; j <= M; j++) {
        const tgt = sample.linkTarget[j]!;
        if (tgt > 0) {
          totalLoss -=
            lossWeights.link *
            sample.linkLossWeight *
            tgt *
            Math.log(Math.max(1e-12, sc.linkProbs[j]!));
        }
      }
    }
  }

  // ── 7. Tower 3: Cross-Modal Latent Action Reasoner ──────────────────────
  const bestOtpCand = bestOtpIdx >= 0 ? sample.otpCands[bestOtpIdx]! : null;
  const bestLinkCand = bestLinkIdx >= 0 ? sample.linkCands[bestLinkIdx]! : null;

  const aIn = sc.actionIn;
  aIn.set(sc.zDoc, 0);
  aIn.set(sc.intentProbs, D_MODEL);
  aIn.set(sc.zOtpWin, D_MODEL + INTENT_CLASSES.length);
  aIn.set(sc.zLinkWin, D_MODEL + INTENT_CLASSES.length + D_POINTER);

  const mBase = D_MODEL + INTENT_CLASSES.length + D_POINTER * 2;
  const otpLen = bestOtpCand?.len ?? 0;
  const otpNum = bestOtpCand?.isNum ?? false;
  const otpInBestLinkUrl = Boolean(
    bestOtpCand &&
    bestLinkCand &&
    bestLinkCand.url.toLowerCase().includes(bestOtpCand.code.toLowerCase())
  );

  aIn[mBase + 0] = bestOtpProb;
  aIn[mBase + 1] = nullOtpProb;
  aIn[mBase + 2] = otpMargin;
  aIn[mBase + 3] = bestOtpCand?.isExplicit ? 1 : 0;
  aIn[mBase + 4] = bestOtpCand?.isVisibleOutsideUrls ? 1 : 0;
  aIn[mBase + 5] = bestOtpCand?.embeddedInHandle ? 1 : 0;
  aIn[mBase + 6] = Math.min(1, otpLen / 10);
  aIn[mBase + 7] = otpNum ? 1 : 0;
  aIn[mBase + 8] = bestLinkProb;
  aIn[mBase + 9] = nullLinkProb;
  aIn[mBase + 10] = linkMargin;
  aIn[mBase + 11] = bestLinkCand?.gateQualityNorm ?? 0;
  aIn[mBase + 12] = bestLinkCand?.structuralAutoOpen ? 1 : 0;
  aIn[mBase + 13] = bestLinkCand?.domainBound ? 1 : 0;
  aIn[mBase + 14] = bestOtpCand && bestLinkCand ? 1 : 0;
  aIn[mBase + 15] = otpInBestLinkUrl ? 1 : 0;
  aIn[mBase + 16] = bestOtpCand?.isVisibleOutsideUrls ? 1 : 0;
  aIn[mBase + 17] = sample.securityScoreNorm;
  aIn[mBase + 18] = sample.riskHigh;
  aIn[mBase + 19] = sample.riskMedium;
  aIn[mBase + 20] = sample.senderMatchesSite;
  aIn[mBase + 21] = sample.hasSiteContext;
  aIn[mBase + 22] = ambiguousDualLinks ? 1 : 0;
  aIn[mBase + 23] = sample.hasPageExp;
  aIn[mBase + 24] = sample.pageHasOtpInputs;
  aIn[mBase + 25] = sample.pageHasMagicLinkPrompt;
  aIn[mBase + 26] =
    sample.expectedOtpLength > 0 && otpLen > 0 ? (sample.expectedOtpLength === otpLen ? 1 : -1) : 0;
  aIn[mBase + 27] =
    sample.expectedOtpFormat && otpLen > 0
      ? (sample.expectedOtpFormat === 'numeric' ? otpNum : !otpNum)
        ? 1
        : -1
      : 0;

  linearFwd(params.actionW1, aIn, 0, sc.tmpD, 0);
  for (let r = 0; r < D_MODEL; r++) {
    geluWrite(sc.tmpD[r]!, sc.actionH1, r, sc.actionH1Grad, r);
  }
  linearFwd(params.actionW2, sc.actionH1, 0, sc.actionProbs, 0);
  softmaxArray(sc.actionProbs, ACTION_CLASSES.length);

  totalLoss -=
    lossWeights.action *
    sample.actionLossWeight *
    Math.log(Math.max(1e-12, sc.actionProbs[sample.actionIdx]!));

  let predAction = 0;
  for (let i = 1; i < ACTION_CLASSES.length; i++) {
    if (sc.actionProbs[i]! > sc.actionProbs[predAction]!) {
      predAction = i;
    }
  }
  const falseAutoAct = sample.actionIdx >= 3 && predAction < 3;

  if (!computeGrads) {
    return {
      loss: totalLoss,
      intentCorrect: predIntent === sample.intentIdx,
      otpChecked,
      otpCorrect,
      linkChecked,
      linkCorrect,
      actionCorrect: predAction === sample.actionIdx,
      falseAutoAct,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYTICAL BACKPROPAGATION
  // ══════════════════════════════════════════════════════════════════════════
  sc.dH.fill(0, 0, L * D_MODEL);
  sc.dZDoc.fill(0);

  // ── Bwd 7: Tower 3 Action Reasoner ────────────────────────────────────────
  const dActLogits = sc.actionProbs; // mutate in place cleanly
  for (let i = 0; i < ACTION_CLASSES.length; i++) {
    const tgt = i === sample.actionIdx ? 1 : 0;
    dActLogits[i] = lossWeights.action * sample.actionLossWeight * (dActLogits[i]! - tgt);
  }
  sc.dActionH1.fill(0);
  linearBwd(params.actionW2, sc.actionH1, 0, dActLogits, 0, sc.dActionH1, 0);
  for (let r = 0; r < D_MODEL; r++) {
    sc.dActionH1[r] = sc.dActionH1[r]! * sc.actionH1Grad[r]!;
  }
  sc.dActionIn.fill(0);
  linearBwd(params.actionW1, aIn, 0, sc.dActionH1, 0, sc.dActionIn, 0);

  // Route Action grads to zDoc, zOtpWin, zLinkWin, and intentProbs (exact softmax Jacobian)
  for (let d = 0; d < D_MODEL; d++) {
    sc.dZDoc[d] = sc.dZDoc[d]! + sc.dActionIn[d]!;
  }
  copySlice(sc.dActionIn, D_MODEL + INTENT_CLASSES.length, sc.dZOtpWin, 0, D_POINTER);
  copySlice(sc.dActionIn, D_MODEL + INTENT_CLASSES.length + D_POINTER, sc.dZLinkWin, 0, D_POINTER);

  // Softmax Jacobian from dIntentProbs + Intent CE
  let intentDot = 0;
  for (let i = 0; i < INTENT_CLASSES.length; i++) {
    intentDot += sc.intentProbs[i]! * sc.dActionIn[D_MODEL + i]!;
  }
  for (let i = 0; i < INTENT_CLASSES.length; i++) {
    const p = sc.intentProbs[i]!;
    const tgt = (i === sample.intentIdx ? 1 - INTENT_SMOOTH : 0) + smoothFloor;
    const dFromAct = p * (sc.dActionIn[D_MODEL + i]! - intentDot);
    sc.dIntentLogits[i] = sample.intentLossWeight * (p - tgt) + dFromAct;
  }
  linearBwd(params.intentHead, sc.zDoc, 0, sc.dIntentLogits, 0, sc.dZDoc, 0);

  // ── Bwd 6: Tower 2B Link Pointer ──────────────────────────────────────────
  if (M > 0) {
    sc.dLinkZRef.fill(0, 0, M * D_POINTER);
    const dLinkLogits = sc.tmpScores;
    dLinkLogits.fill(0, 0, M + 1);

    // Gradient through soft pool zLinkWin + scalar policy meta probabilities
    const dLinkProbs = sc.tmpProbGrads;
    dLinkProbs.fill(0, 0, M + 1);
    for (let j = 0; j < M; j++) {
      const p = sc.linkProbs[j]!;
      const zO = j * D_POINTER;
      let acc = 0;
      for (let d = 0; d < D_POINTER; d++) {
        const dz = sc.dZLinkWin[d]!;
        sc.dLinkZRef[zO + d] = sc.dLinkZRef[zO + d]! + p * dz;
        acc += dz * sc.linkZRef[zO + d]!;
      }
      dLinkProbs[j] = acc;
    }
    dLinkProbs[M] = dLinkProbs[M]! + sc.dActionIn[mBase + 9]!;
    if (bestLinkIdx >= 0) {
      dLinkProbs[bestLinkIdx] = dLinkProbs[bestLinkIdx]! + sc.dActionIn[mBase + 8]!;
      if (linkMargin > 0) {
        let maxOtherIdx = M;
        let maxOtherVal = sc.linkProbs[M]!;
        for (let j = 0; j < M; j++) {
          if (j !== bestLinkIdx && sc.linkProbs[j]! > maxOtherVal) {
            maxOtherVal = sc.linkProbs[j]!;
            maxOtherIdx = j;
          }
        }
        dLinkProbs[bestLinkIdx] = dLinkProbs[bestLinkIdx]! + sc.dActionIn[mBase + 10]!;
        dLinkProbs[maxOtherIdx] = dLinkProbs[maxOtherIdx]! - sc.dActionIn[mBase + 10]!;
      }
    }
    let pDot = 0;
    for (let j = 0; j <= M; j++) {
      pDot += sc.linkProbs[j]! * dLinkProbs[j]!;
    }
    for (let j = 0; j <= M; j++) {
      const p = sc.linkProbs[j]!;
      const actTerm = p * (dLinkProbs[j]! - pDot);
      const ceTerm = sample.linkTarget
        ? lossWeights.link * sample.linkLossWeight * (p - sample.linkTarget[j]!)
        : 0;
      dLinkLogits[j] = ceTerm + actTerm;
    }

    // Backprop linkNullHead
    const dNull = sc.tmpRawLink;
    dNull.fill(0, 0, D_POINTER);
    for (let d = 0; d < D_POINTER; d++) {
      params.linkNullScore.gw[d] = params.linkNullScore.gw[d]! + dLinkLogits[M]! * sc.linkZNull[d]!;
      dNull[d] = dLinkLogits[M]! * params.linkNullScore.w[d]! * sc.linkZNullGrad[d]!;
    }
    if (params.linkNullScore.hasBias) {
      params.linkNullScore.gb[0] = params.linkNullScore.gb[0]! + dLinkLogits[M]!;
    }
    linearBwd(params.linkNullProj, sc.zDoc, 0, dNull, 0, sc.dZDoc, 0);

    for (let j = 0; j < M; j++) {
      const g = dLinkLogits[j]!;
      const zO = j * D_POINTER;
      if (params.linkScoreHead.hasBias) {
        params.linkScoreHead.gb[0] = params.linkScoreHead.gb[0]! + g;
      }
      for (let d = 0; d < D_POINTER; d++) {
        params.linkScoreHead.gw[d] = params.linkScoreHead.gw[d]! + g * sc.linkZRef[zO + d]!;
        sc.dLinkZRef[zO + d] = sc.dLinkZRef[zO + d]! + g * params.linkScoreHead.w[d]!;
      }
    }

    sc.dLinkZ.fill(0, 0, M * D_POINTER);
    for (let j = 0; j < M; j++) {
      const zO = j * D_POINTER;
      if (M > 1) {
        for (let d = 0; d < D_POINTER; d++) {
          sc.dLinkZ[zO + d] = sc.dLinkZ[zO + d]! + sc.dLinkZRef[zO + d]!;
          sc.tmpD[d] = sc.dLinkZRef[zO + d]! * sc.linkSetGrad[zO + d]!;
        }
        sc.tmpFFN.fill(0, 0, D_POINTER);
        linearBwd(params.linkSetInteract, sc.linkRivalDiff, zO, sc.tmpD, 0, sc.tmpFFN, 0);
        for (let d = 0; d < D_POINTER; d++) {
          sc.dLinkZ[zO + d] = sc.dLinkZ[zO + d]! + sc.tmpFFN[d]!;
          const maxIdx = sc.linkRivalIdx[zO + d]!;
          sc.dLinkZ[maxIdx * D_POINTER + d] = sc.dLinkZ[maxIdx * D_POINTER + d]! - sc.tmpFFN[d]!;
        }
      } else {
        for (let d = 0; d < D_POINTER; d++) {
          sc.dLinkZ[zO + d] = sc.dLinkZ[zO + d]! + sc.dLinkZRef[zO + d]!;
        }
      }
    }

    for (let j = 0; j < M; j++) {
      const zO = j * D_POINTER;
      const dO = j * D_MODEL;
      const rawO = j * D_LINK_RAW;
      for (let d = 0; d < D_POINTER; d++) {
        sc.dLinkZ[zO + d] = sc.dLinkZ[zO + d]! * sc.linkZGeluGrad[zO + d]!;
      }
      sc.tmpRawLink.fill(0, 0, D_LINK_RAW);
      linearBwd(params.linkSpanProj, sc.linkRaw, rawO, sc.dLinkZ, zO, sc.tmpRawLink, 0);

      // Grads to hAnchor (0..47), hUrl (48..95), hCtx (96..143)
      const posList = sample.linkCands[j]!.positions;
      const invCnt = 1 / Math.max(1, posList.length);
      for (const p of posList) {
        const pO = p * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.dH[pO + d] = sc.dH[pO + d]! + sc.tmpRawLink[d]! * invCnt;
        }
      }

      // Accumulate URL token embedding grads directly
      const lc = sample.linkCands[j]!;
      if (lc.urlToks.length > 0) {
        const invU = 1 / lc.urlToks.length;
        for (const ut of lc.urlToks) {
          const vO = ut.vocabId * D_MODEL;
          const c0O = ut.c0 * D_MODEL;
          const c1O = ut.c1 * D_MODEL;
          const c2O = ut.c2 * D_MODEL;
          for (let d = 0; d < D_MODEL; d++) {
            const gU = sc.tmpRawLink[D_MODEL + d]! * invU;
            params.tokenEmb.gw[vO + d] = params.tokenEmb.gw[vO + d]! + gU;
            const gC = gU * (1 / 3);
            params.tokenEmb.gw[c0O + d] = params.tokenEmb.gw[c0O + d]! + gC;
            params.tokenEmb.gw[c1O + d] = params.tokenEmb.gw[c1O + d]! + gC;
            params.tokenEmb.gw[c2O + d] = params.tokenEmb.gw[c2O + d]! + gC;
          }
        }
      }

      // Backprop crossAttendContext
      const dCtxOff = D_MODEL * 2;
      const bO = j * L;
      let betaDot = 0;
      for (let t = 0; t < L; t++) {
        const bw = sc.linkCrossBeta[bO + t]!;
        const tO = t * D_MODEL;
        let db = 0;
        for (let d = 0; d < D_MODEL; d++) {
          const dc = sc.tmpRawLink[dCtxOff + d]!;
          sc.dH[tO + d] = sc.dH[tO + d]! + bw * dc;
          db += dc * H[tO + d]!;
        }
        sc.tmpBeta[t] = db;
        betaDot += bw * db;
      }
      sc.tmpD.fill(0);
      const scaleQ = 1 / Math.sqrt(D_MODEL);
      for (let t = 0; t < L; t++) {
        const dScore = sc.linkCrossBeta[bO + t]! * (sc.tmpBeta[t]! - betaDot) * scaleQ;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.tmpD[d] = sc.tmpD[d]! + dScore * H[tO + d]!;
          sc.dH[tO + d] = sc.dH[tO + d]! + dScore * sc.linkCrossQ[dO + d]!;
        }
      }
      sc.tmp2D.fill(0);
      sc.tmpPairIn.set(sc.linkHSpan.subarray(dO, dO + D_MODEL), 0);
      sc.tmpPairIn.set(sc.linkHUrl.subarray(dO, dO + D_MODEL), D_MODEL);
      linearBwd(params.linkCrossQuery, sc.tmpPairIn, 0, sc.tmpD, 0, sc.tmp2D, 0);
      for (const p of posList) {
        const pO = p * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.dH[pO + d] = sc.dH[pO + d]! + sc.tmp2D[d]! * invCnt;
        }
      }
      if (lc.urlToks.length > 0) {
        const invU = 1 / lc.urlToks.length;
        for (const ut of lc.urlToks) {
          const vO = ut.vocabId * D_MODEL;
          const c0O = ut.c0 * D_MODEL;
          const c1O = ut.c1 * D_MODEL;
          const c2O = ut.c2 * D_MODEL;
          for (let d = 0; d < D_MODEL; d++) {
            const gU = sc.tmp2D[D_MODEL + d]! * invU;
            params.tokenEmb.gw[vO + d] = params.tokenEmb.gw[vO + d]! + gU;
            const gC = gU * (1 / 3);
            params.tokenEmb.gw[c0O + d] = params.tokenEmb.gw[c0O + d]! + gC;
            params.tokenEmb.gw[c1O + d] = params.tokenEmb.gw[c1O + d]! + gC;
            params.tokenEmb.gw[c2O + d] = params.tokenEmb.gw[c2O + d]! + gC;
          }
        }
      }
    }
  }

  // ── Bwd 5: Tower 2A OTP Pointer ───────────────────────────────────────────
  if (K > 0) {
    sc.dOtpZRef.fill(0, 0, K * D_POINTER);
    const dOtpLogits = sc.tmpScores;
    dOtpLogits.fill(0, 0, K + 1);

    const dOtpProbs = sc.tmpProbGrads;
    dOtpProbs.fill(0, 0, K + 1);
    for (let i = 0; i < K; i++) {
      const p = sc.otpProbs[i]!;
      const zO = i * D_POINTER;
      let acc = 0;
      for (let d = 0; d < D_POINTER; d++) {
        const dz = sc.dZOtpWin[d]!;
        sc.dOtpZRef[zO + d] = sc.dOtpZRef[zO + d]! + p * dz;
        acc += dz * sc.otpZRef[zO + d]!;
      }
      dOtpProbs[i] = acc;
    }
    dOtpProbs[K] = dOtpProbs[K]! + sc.dActionIn[mBase + 1]!;
    if (bestOtpIdx >= 0) {
      dOtpProbs[bestOtpIdx] = dOtpProbs[bestOtpIdx]! + sc.dActionIn[mBase + 0]!;
      if (otpMargin > 0) {
        let maxOtherIdx = K;
        let maxOtherVal = sc.otpProbs[K]!;
        for (let i = 0; i < K; i++) {
          if (i !== bestOtpIdx && sc.otpProbs[i]! > maxOtherVal) {
            maxOtherVal = sc.otpProbs[i]!;
            maxOtherIdx = i;
          }
        }
        dOtpProbs[bestOtpIdx] = dOtpProbs[bestOtpIdx]! + sc.dActionIn[mBase + 2]!;
        dOtpProbs[maxOtherIdx] = dOtpProbs[maxOtherIdx]! - sc.dActionIn[mBase + 2]!;
      }
    }
    let pDot = 0;
    for (let i = 0; i <= K; i++) {
      pDot += sc.otpProbs[i]! * dOtpProbs[i]!;
    }
    for (let i = 0; i <= K; i++) {
      const p = sc.otpProbs[i]!;
      const actTerm = p * (dOtpProbs[i]! - pDot);
      const ceTerm = sample.otpTarget
        ? lossWeights.otp * sample.otpLossWeight * (p - sample.otpTarget[i]!)
        : 0;
      dOtpLogits[i] = ceTerm + actTerm;
    }

    const dNull = sc.tmpRawOtp;
    dNull.fill(0, 0, D_POINTER);
    for (let d = 0; d < D_POINTER; d++) {
      params.otpNullScore.gw[d] = params.otpNullScore.gw[d]! + dOtpLogits[K]! * sc.otpZNull[d]!;
      dNull[d] = dOtpLogits[K]! * params.otpNullScore.w[d]! * sc.otpZNullGrad[d]!;
    }
    if (params.otpNullScore.hasBias) {
      params.otpNullScore.gb[0] = params.otpNullScore.gb[0]! + dOtpLogits[K]!;
    }
    linearBwd(params.otpNullProj, sc.zDoc, 0, dNull, 0, sc.dZDoc, 0);

    for (let i = 0; i < K; i++) {
      const g = dOtpLogits[i]!;
      const zO = i * D_POINTER;
      if (params.otpScoreHead.hasBias) {
        params.otpScoreHead.gb[0] = params.otpScoreHead.gb[0]! + g;
      }
      for (let d = 0; d < D_POINTER; d++) {
        params.otpScoreHead.gw[d] = params.otpScoreHead.gw[d]! + g * sc.otpZRef[zO + d]!;
        sc.dOtpZRef[zO + d] = sc.dOtpZRef[zO + d]! + g * params.otpScoreHead.w[d]!;
      }
    }

    sc.dOtpZ.fill(0, 0, K * D_POINTER);
    for (let i = 0; i < K; i++) {
      const zO = i * D_POINTER;
      if (K > 1) {
        for (let d = 0; d < D_POINTER; d++) {
          sc.dOtpZ[zO + d] = sc.dOtpZ[zO + d]! + sc.dOtpZRef[zO + d]!;
          sc.tmpD[d] = sc.dOtpZRef[zO + d]! * sc.otpSetGrad[zO + d]!;
        }
        sc.tmpFFN.fill(0, 0, D_POINTER);
        linearBwd(params.otpSetInteract, sc.otpRivalDiff, zO, sc.tmpD, 0, sc.tmpFFN, 0);
        for (let d = 0; d < D_POINTER; d++) {
          sc.dOtpZ[zO + d] = sc.dOtpZ[zO + d]! + sc.tmpFFN[d]!;
          const maxIdx = sc.otpRivalIdx[zO + d]!;
          sc.dOtpZ[maxIdx * D_POINTER + d] = sc.dOtpZ[maxIdx * D_POINTER + d]! - sc.tmpFFN[d]!;
        }
      } else {
        for (let d = 0; d < D_POINTER; d++) {
          sc.dOtpZ[zO + d] = sc.dOtpZ[zO + d]! + sc.dOtpZRef[zO + d]!;
        }
      }
    }

    for (let i = 0; i < K; i++) {
      const zO = i * D_POINTER;
      const dO = i * D_MODEL;
      const rawO = i * D_SPAN_RAW;
      for (let d = 0; d < D_POINTER; d++) {
        sc.dOtpZ[zO + d] = sc.dOtpZ[zO + d]! * sc.otpZGeluGrad[zO + d]!;
      }
      sc.tmpRawOtp.fill(0, 0, D_SPAN_RAW);
      linearBwd(params.otpSpanProj, sc.otpRaw, rawO, sc.dOtpZ, zO, sc.tmpRawOtp, 0);

      // Update codeCharEmb
      const mIds = sample.otpCands[i]!.morphIds;
      const morphOff = D_MODEL * 4;
      for (const mId of mIds) {
        const mO = mId * D_MORPH_EMB;
        for (let d = 0; d < D_MORPH_EMB; d++) {
          params.codeCharEmb.gw[mO + d] =
            params.codeCharEmb.gw[mO + d]! + sc.tmpRawOtp[morphOff + d]! * 0.25;
        }
      }

      // Gradients to hCtx -> crossQ -> hLeft/hRight -> H
      const ctxOff = D_MODEL * 3;
      const bO = i * L;
      let betaDot = 0;
      for (let t = 0; t < L; t++) {
        const bw = sc.otpCrossBeta[bO + t]!;
        const tO = t * D_MODEL;
        let db = 0;
        for (let d = 0; d < D_MODEL; d++) {
          const dc = sc.tmpRawOtp[ctxOff + d]!;
          sc.dH[tO + d] = sc.dH[tO + d]! + bw * dc;
          db += dc * H[tO + d]!;
        }
        sc.tmpBeta[t] = db;
        betaDot += bw * db;
      }
      sc.tmpD.fill(0);
      const scaleQ = 1 / Math.sqrt(D_MODEL);
      for (let t = 0; t < L; t++) {
        const dScore = sc.otpCrossBeta[bO + t]! * (sc.tmpBeta[t]! - betaDot) * scaleQ;
        const tO = t * D_MODEL;
        for (let d = 0; d < D_MODEL; d++) {
          sc.tmpD[d] = sc.tmpD[d]! + dScore * H[tO + d]!;
          sc.dH[tO + d] = sc.dH[tO + d]! + dScore * sc.otpCrossQ[dO + d]!;
        }
      }
      sc.tmp2D.fill(0);
      sc.tmpPairIn.set(sc.otpHLeft.subarray(dO, dO + D_MODEL), 0);
      sc.tmpPairIn.set(sc.otpHRight.subarray(dO, dO + D_MODEL), D_MODEL);
      linearBwd(params.otpCrossQuery, sc.tmpPairIn, 0, sc.tmpD, 0, sc.tmp2D, 0);

      for (let d = 0; d < D_MODEL; d++) {
        sc.tmpRawOtp[d] = sc.tmpRawOtp[d]! + sc.tmp2D[d]!;
        sc.tmpRawOtp[D_MODEL + d] = sc.tmpRawOtp[D_MODEL + d]! + sc.tmp2D[D_MODEL + d]!;
      }

      accumulateSpanBwd(
        sc.dH,
        L,
        sample.otpCands[i]!.positions,
        sc.tmpRawOtp,
        D_MODEL * 2,
        sc.tmpRawOtp,
        0,
        sc.tmpRawOtp,
        D_MODEL
      );
    }
  }

  // ── Bwd 4: Attention Pooling + [CLS] ──────────────────────────────────────
  for (let d = 0; d < D_MODEL; d++) {
    sc.dH[d] = sc.dH[d]! + 0.5 * sc.dZDoc[d]!;
  }
  let alphaDot = 0;
  for (let t = 0; t < L; t++) {
    const hO = t * D_MODEL;
    let da = 0;
    for (let d = 0; d < D_MODEL; d++) {
      const dz = 0.5 * sc.dZDoc[d]!;
      sc.dH[hO + d] = sc.dH[hO + d]! + sc.poolAlpha[t]! * dz;
      da += dz * H[hO + d]!;
    }
    sc.dPoolAlpha[t] = da;
    alphaDot += sc.poolAlpha[t]! * da;
  }
  for (let t = 0; t < L; t++) {
    const dScore = sc.poolAlpha[t]! * (sc.dPoolAlpha[t]! - alphaDot);
    const hO = t * D_MODEL;
    if (params.poolProj.hasBias) {
      params.poolProj.gb[0] = params.poolProj.gb[0]! + dScore;
    }
    for (let d = 0; d < D_MODEL; d++) {
      params.poolProj.gw[d] = params.poolProj.gw[d]! + dScore * H[hO + d]!;
      sc.dH[hO + d] = sc.dH[hO + d]! + dScore * params.poolProj.w[d]!;
    }
  }

  // ── Bwd 3: FFN + Self-Attention ───────────────────────────────────────────
  sc.dA.fill(0, 0, L * D_MODEL);
  sc.dAttnOut.fill(0, 0, L * D_MODEL);
  sc.dX1.fill(0, 0, L * D_MODEL);
  sc.dQKV.fill(0, 0, L * D_MODEL * 3);

  for (let t = 0; t < L; t++) {
    const tO = t * D_MODEL;
    const fO = t * D_FFN;
    sc.tmpD.fill(0);
    rmsNormBwd(
      sc.xHat3,
      tO,
      sc.rms3[t]!,
      params.norm3Gamma,
      params.gNorm3Gamma,
      sc.dH,
      tO,
      sc.tmpD,
      0,
      D_MODEL,
      sc.dSum1
    );
    for (let d = 0; d < D_MODEL; d++) {
      sc.dA[tO + d] = sc.dA[tO + d]! + sc.tmpD[d]!;
    }
    sc.tmpFFN.fill(0);
    linearBwd(params.ffnW2, sc.ffnAct, fO, sc.tmpD, 0, sc.tmpFFN, 0);
    for (let r = 0; r < D_FFN; r++) {
      sc.tmpFFN[r] = sc.tmpFFN[r]! * sc.ffnGrad[fO + r]!;
    }
    linearBwd(params.ffnW1, sc.A, tO, sc.tmpFFN, 0, sc.dA, tO);

    sc.tmpD.fill(0);
    rmsNormBwd(
      sc.xHat2,
      tO,
      sc.rms2[t]!,
      params.norm2Gamma,
      params.gNorm2Gamma,
      sc.dA,
      tO,
      sc.tmpD,
      0,
      D_MODEL,
      sc.dSum1
    );
    for (let d = 0; d < D_MODEL; d++) {
      sc.dX1[tO + d] = sc.dX1[tO + d]! + sc.tmpD[d]!;
    }
    linearBwd(params.outProj, sc.attnOut, tO, sc.tmpD, 0, sc.dAttnOut, tO);
  }

  for (let t = 0; t < L; t++) {
    const tQkv = t * D_MODEL * 3;
    const tOut = t * D_MODEL;
    for (let h = 0; h < N_HEADS; h++) {
      const hO = h * D_HEAD;
      const bBase = h * 15;
      const probBase = (h * L + t) * L;
      let aDot = 0;
      for (let s = 0; s < L; s++) {
        const w = sc.attnProbs[probBase + s]!;
        const sV = s * D_MODEL * 3 + D_MODEL * 2 + hO;
        let da = 0;
        for (let d = 0; d < D_HEAD; d++) {
          const dAO = sc.dAttnOut[tOut + hO + d]!;
          sc.dQKV[sV + d] = sc.dQKV[sV + d]! + w * dAO;
          da += dAO * sc.QKV[sV + d]!;
        }
        sc.tmpBeta[s] = da;
        aDot += w * da;
      }
      for (let s = 0; s < L; s++) {
        const dScore = sc.attnProbs[probBase + s]! * (sc.tmpBeta[s]! - aDot);
        const rel = Math.max(-7, Math.min(7, s - t)) + 7;
        params.gRelPosBias[bBase + rel] = params.gRelPosBias[bBase + rel]! + dScore;
        const scaled = dScore * headScale;
        const sK = s * D_MODEL * 3 + D_MODEL + hO;
        for (let d = 0; d < D_HEAD; d++) {
          sc.dQKV[tQkv + hO + d] = sc.dQKV[tQkv + hO + d]! + scaled * sc.QKV[sK + d]!;
          sc.dQKV[sK + d] = sc.dQKV[sK + d]! + scaled * sc.QKV[tQkv + hO + d]!;
        }
      }
    }
  }

  for (let t = 0; t < L; t++) {
    linearBwd(params.qkvProj, X1, t * D_MODEL, sc.dQKV, t * D_MODEL * 3, sc.dX1, t * D_MODEL);
  }

  // ── Bwd 2 & 1: Conv + GLU + Embeddings ──────────────────────────────────
  sc.dE.fill(0, 0, L * D_MODEL);
  sc.dConvCat.fill(0, 0, L * D_MODEL * 2);

  for (let t = 0; t < L; t++) {
    const tO = t * D_MODEL;
    const cO = t * D_MODEL * 2;
    sc.tmpD.fill(0);
    rmsNormBwd(
      sc.xHat1,
      tO,
      sc.rms1[t]!,
      params.norm1Gamma,
      params.gNorm1Gamma,
      sc.dX1,
      tO,
      sc.tmpD,
      0,
      D_MODEL,
      sc.dSum1
    );
    for (let d = 0; d < D_MODEL; d++) {
      const ds = sc.tmpD[d]!;
      sc.dE[tO + d] = sc.dE[tO + d]! + ds;
      const sig = sc.gluSig[tO + d]!;
      const val = sc.gluVal[tO + d]!;
      sc.dGluRaw[d] = ds * sig;
      sc.dGluRaw[D_MODEL + d] = ds * val * sig * (1 - sig);
    }
    linearBwd(params.pwGlu, sc.convCat, cO, sc.dGluRaw, 0, sc.dConvCat, cO);

    for (let k = -1; k <= 1; k++) {
      const pos = t + k;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wO = (k + 1) * D_MODEL;
      const eO = pos * D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        const g = sc.dConvCat[cO + d]!;
        params.dwK3.gw[wO + d] = params.dwK3.gw[wO + d]! + g * E[eO + d]!;
        sc.dE[eO + d] = sc.dE[eO + d]! + g * params.dwK3.w[wO + d]!;
      }
    }
    for (let k = 0; k < 5; k++) {
      const pos = t + (k - 2) * 2;
      if (pos < 0 || pos >= L) {
        continue;
      }
      const wO = k * D_MODEL;
      const eO = pos * D_MODEL;
      for (let d = 0; d < D_MODEL; d++) {
        const g = sc.dConvCat[cO + D_MODEL + d]!;
        params.dwK5Dil2.gw[wO + d] = params.dwK5Dil2.gw[wO + d]! + g * E[eO + d]!;
        sc.dE[eO + d] = sc.dE[eO + d]! + g * params.dwK5Dil2.w[wO + d]!;
      }
    }
  }

  for (let t = 0; t < L; t++) {
    const tO = t * D_MODEL;
    const vO = sample.vocabIds[t]! * D_MODEL;
    const c0O = sample.charIds[t * 3]! * D_MODEL;
    const c1O = sample.charIds[t * 3 + 1]! * D_MODEL;
    const c2O = sample.charIds[t * 3 + 2]! * D_MODEL;
    const zO = sample.zoneIds[t]! * D_MODEL;
    for (let d = 0; d < D_MODEL; d++) {
      const g = sc.dE[tO + d]!;
      params.tokenEmb.gw[vO + d] = params.tokenEmb.gw[vO + d]! + g;
      const gc = g * (1 / 3);
      params.tokenEmb.gw[c0O + d] = params.tokenEmb.gw[c0O + d]! + gc;
      params.tokenEmb.gw[c1O + d] = params.tokenEmb.gw[c1O + d]! + gc;
      params.tokenEmb.gw[c2O + d] = params.tokenEmb.gw[c2O + d]! + gc;
      params.zoneEmb.gw[zO + d] = params.zoneEmb.gw[zO + d]! + g;
    }
  }

  return {
    loss: totalLoss,
    intentCorrect: predIntent === sample.intentIdx,
    otpChecked,
    otpCorrect,
    linkChecked,
    linkCorrect,
    actionCorrect: predAction === sample.actionIdx,
    falseAutoAct,
  };
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function quantizeParamMatrix(m: ParamMatrix): QuantizedMatrixSpec {
  const scales = new Float32Array(m.rows);
  const q = new Int8Array(m.rows * m.cols);
  for (let r = 0; r < m.rows; r++) {
    const off = r * m.cols;
    let maxAbs = 0;
    for (let c = 0; c < m.cols; c++) {
      const a = Math.abs(m.w[off + c]!);
      if (a > maxAbs) {
        maxAbs = a;
      }
    }
    const scale = maxAbs > 1e-8 ? maxAbs / 127 : 0;
    scales[r] = scale;
    if (scale > 0) {
      const inv = 1 / scale;
      for (let c = 0; c < m.cols; c++) {
        q[off + c] = Math.max(-127, Math.min(127, Math.round(m.w[off + c]! * inv)));
      }
    }
  }
  const spec: QuantizedMatrixSpec = {
    rows: m.rows,
    cols: m.cols,
    scalesB64: bytesToB64(new Uint8Array(scales.buffer)),
    weightsB64: bytesToB64(new Uint8Array(q.buffer)),
  };
  if (m.hasBias) {
    const fb = Float32Array.from(m.b);
    spec.biasB64 = bytesToB64(new Uint8Array(fb.buffer));
  }
  return spec;
}

export function exportWeightsBundle(
  p: NeuralModelParams,
  vocab: string[],
  trainedSamples: number,
  temperatures: { intent: number; otp: number; link: number; action: number }
): GhostNetWeightsBundle {
  return {
    version: 2,
    trainedSamples,
    vocab,
    temperatures,
    embeddings: {
      tokenEmb: quantizeParamMatrix(p.tokenEmb),
      zoneEmbB64: bytesToB64(new Uint8Array(Float32Array.from(p.zoneEmb.w).buffer)),
      codeCharEmb: quantizeParamMatrix(p.codeCharEmb),
    },
    seqConv: {
      dwK3B64: bytesToB64(new Uint8Array(Float32Array.from(p.dwK3.w).buffer)),
      dwK5Dil2B64: bytesToB64(new Uint8Array(Float32Array.from(p.dwK5Dil2.w).buffer)),
      pwGlu: quantizeParamMatrix(p.pwGlu),
      norm1GammaB64: bytesToB64(new Uint8Array(Float32Array.from(p.norm1Gamma).buffer)),
    },
    selfAttn: {
      qkvProj: quantizeParamMatrix(p.qkvProj),
      relPosBiasB64: bytesToB64(new Uint8Array(Float32Array.from(p.relPosBias).buffer)),
      outProj: quantizeParamMatrix(p.outProj),
      norm2GammaB64: bytesToB64(new Uint8Array(Float32Array.from(p.norm2Gamma).buffer)),
      ffnW1: quantizeParamMatrix(p.ffnW1),
      ffnW2: quantizeParamMatrix(p.ffnW2),
      norm3GammaB64: bytesToB64(new Uint8Array(Float32Array.from(p.norm3Gamma).buffer)),
      poolProj: quantizeParamMatrix(p.poolProj),
      intentHead: quantizeParamMatrix(p.intentHead),
    },
    otpPointer: {
      crossQuery: quantizeParamMatrix(p.otpCrossQuery),
      spanProj: quantizeParamMatrix(p.otpSpanProj),
      setInteract: quantizeParamMatrix(p.otpSetInteract),
      scoreHead: quantizeParamMatrix(p.otpScoreHead),
      nullProj: quantizeParamMatrix(p.otpNullProj),
      nullScore: quantizeParamMatrix(p.otpNullScore),
    },
    linkPointer: {
      crossQuery: quantizeParamMatrix(p.linkCrossQuery),
      spanProj: quantizeParamMatrix(p.linkSpanProj),
      setInteract: quantizeParamMatrix(p.linkSetInteract),
      scoreHead: quantizeParamMatrix(p.linkScoreHead),
      nullProj: quantizeParamMatrix(p.linkNullProj),
      nullScore: quantizeParamMatrix(p.linkNullScore),
    },
    actionReasoner: {
      w1: quantizeParamMatrix(p.actionW1),
      w2: quantizeParamMatrix(p.actionW2),
    },
  };
}
