/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  SENTINEL PHASE 3 — TYPE SYSTEM EXTENSIONS                  ║
 * ║  The nervous system's type vocabulary.                       ║
 * ║  Never redefines DetectedField or FormInputElement.          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

// ─── Detection Layers ───────────────────────────────────────────
export type DetectionLayer = 'heuristic' | 'ml' | 'spatial' | 'history';

export const ALL_LAYERS: readonly DetectionLayer[] = [
  'heuristic',
  'ml',
  'spatial',
  'history',
] as const;

// ─── Meta-Learner ───────────────────────────────────────────────

export interface LayerPerformance {
  readonly layer: DetectionLayer;
  correctPredictions: number;
  totalPredictions: number;
  ema: number; // Exponential moving average accuracy
  calibrationError: number; // |predicted_conf - actual_accuracy|
  hallucinationCount: number; // High conf (>0.8) + wrong
  lastUpdated: number;
}

export interface DomainProfile {
  readonly domain: string;
  layers: Record<DetectionLayer, LayerPerformance>;
  weights: Record<DetectionLayer, number>;
  totalInteractions: number;
  lastVisit: number;
  trustScore: number;
  flowPattern: AuthFlowPattern | null;
}

export interface MetaLearnerState {
  version: number;
  globalWeights: Record<DetectionLayer, number>;
  domains: Record<string, DomainProfile>;
  globalHallucinationRate: number;
  lastCalibration: number;
}

export interface WeightUpdate {
  layer: DetectionLayer;
  before: number;
  after: number;
  reason: string;
  ts: number;
}

// ─── Autonomous Navigation ─────────────────────────────────────

export type AuthFlowStep =
  | 'identifier' // email or username
  | 'password'
  | 'otp'
  | 'totp'
  | 'phone'
  | 'mfa_select'
  | 'recovery'
  | 'complete';

export interface AuthFlowPattern {
  domain: string;
  steps: AuthFlowStep[];
  currentIndex: number;
  transitions: FlowTransition[];
  startedAt: number;
  completedAt: number | null;
}

export interface FlowTransition {
  from: AuthFlowStep;
  to: AuthFlowStep;
  buttonSelector: string;
  buttonText: string;
  delayMs: number;
  success: boolean;
}

export type NavButtonType =
  | 'submit'
  | 'next'
  | 'continue'
  | 'verify'
  | 'confirm'
  | 'login'
  | 'signin'
  | 'send_code';

export interface NavigationTarget {
  element: HTMLElement;
  type: NavButtonType;
  text: string;
  confidence: number;
  rect: DOMRect;
  visible: boolean;
  zIndex: number;
  formAncestor: HTMLElement | null;
}

export interface NavigationDecision {
  shouldAct: boolean;
  target: NavigationTarget | null;
  currentStep: AuthFlowStep;
  nextStep: AuthFlowStep | null;
  confidence: number;
  reason: string;
}

// ─── Form Simulator ────────────────────────────────────────────

export type ObfuscationLevel = 0 | 1 | 2 | 3;
export type CSSFramework = 'none' | 'tailwind' | 'bootstrap' | 'material' | 'shadcn' | 'custom';
export type InputVariant = 'standard' | 'contenteditable' | 'div_input' | 'web_component';
export type FormLayout = 'vertical' | 'horizontal' | 'grid' | 'modal' | 'inline';
export type SimFormType =
  | 'login'
  | 'otp'
  | 'signup'
  | 'mfa'
  | 'payment'
  | 'recovery'
  | 'multi_step';

export interface SyntheticFormConfig {
  formType: SimFormType;
  obfuscation: ObfuscationLevel;
  nestingDepth: number;
  shadowDOM: boolean;
  hasHoneypot: boolean;
  hasDecoy: boolean;
  framework: CSSFramework;
  inputVariant: InputVariant;
  layout: FormLayout;
  splitOTP: boolean; // 4-6 individual digit inputs
  numDecoyFields: number;
  seed: number;
}

export interface SyntheticField {
  html: string;
  label: string; // Ground-truth FieldType
  confidence: number; // Expected detection confidence
  isHoneypot: boolean;
  isTrap: boolean;
  features: number[] | null;
}

export interface SyntheticForm {
  config: SyntheticFormConfig;
  outerHTML: string;
  fields: SyntheticField[];
  generatedAt: number;
  templateId: string;
}

export interface DetectedField {
  element: HTMLElement;
  type: string;
  confidence: number;
  layer?: string;
  disagreement?: number;
}

export interface TrainingExample {
  features: number[]; // 128-dim
  textTensor: number[][]; // 8×80
  label: string;
  confidence: number;
  meta: {
    source: 'synthetic' | 'real' | 'misclassification' | 'low_confidence';
    domain?: string;
    obfuscation?: ObfuscationLevel;
    formType?: SimFormType;
    seed?: number;
  };
}

// ─── Cross-Origin Proxy ────────────────────────────────────────

export const SENTINEL_MSG_PREFIX = '__SENTINEL_PROXY__' as const;

export type ProxyMessageType =
  | 'PROBE'
  | 'PROBE_RESPONSE'
  | 'FILL_REQUEST'
  | 'FILL_ACK'
  | 'HEARTBEAT';

export interface ProxyMessage {
  sentinel: typeof SENTINEL_MSG_PREFIX;
  type: ProxyMessageType;
  id: string;
  payload: unknown;
  origin: string;
  ts: number;
  depth: number;
}

export interface IFrameFieldReport {
  frameId: string;
  frameSrc: string;
  depth: number;
  fields: Array<{
    path: string; // CSS path within iframe
    features: number[];
    textTensor: number[][];
    rect: { x: number; y: number; w: number; h: number };
    visible: boolean;
  }>;
}

// ─── Confidence & Snapshots ────────────────────────────────────

export interface ConfidenceEvent {
  ts: number;
  domain: string;
  fieldPath: string;
  perLayer: Record<DetectionLayer, number>;
  ensemble: number;
  predicted: string;
  actual?: string;
  contextHash: string;
}

export interface DOMFormSnapshot {
  ts: number;
  domain: string;
  url: string;
  sanitizedHTML: string;
  fields: Array<{
    path: string;
    features: number[]; // 128-dim
    textTensor: number[][];
    predicted: string;
    actual?: string;
    confidence: number;
  }>;
  topology: {
    bounds: { x: number; y: number; w: number; h: number };
    positions: Array<{ path: string; rect: { x: number; y: number; w: number; h: number } }>;
    submitBtn?: {
      path: string;
      text: string;
      rect: { x: number; y: number; w: number; h: number };
    };
    headings: string[];
  };
}
