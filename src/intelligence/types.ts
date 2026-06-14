// Canonical shared types for the GhostFill intelligence layer.
// Everything (harvest -> label -> classify -> eval -> train) shares THIS contract.

export type FieldClass =
  | 'Email'
  | 'Username'
  | 'Password'
  | 'Target_Password_Confirm'
  | 'First_Name'
  | 'Last_Name'
  | 'Full_Name'
  | 'Phone'
  | 'OTP'
  | 'Unknown';

// Hard negatives: things that LOOK fillable but must NEVER be treated as an
// identity/OTP field. Tracked explicitly so the eval can measure the dangerous
// cases where heuristics (and models) most often fail.
export type HardNegative =
  | 'CVV'
  | 'CardNumber'
  | 'CardExpiry'
  | 'ZIP'
  | 'Search'
  | 'Coupon'
  | 'Captcha'
  | 'Honeypot'
  | 'Amount'
  | 'DateOfBirth';

// Raw, already-extracted signals for a single field. Contains NO user values
// (privacy): only structural/labeling signals. Produced by featureExtractor in
// the browser; consumed by the classifier and the eval harness in Node.
export interface RawFieldRecord {
  url?: string | undefined;
  selector?: string | undefined;
  tag: string; // 'input' | 'textarea' | 'select' | ...
  type: string; // input "type" attribute, lowercased
  autocomplete: string; // autocomplete attribute, lowercased
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string; // resolved (shadow-DOM-aware, multi-id aria) label text
  surroundingText: string; // nearby visible text snippet
  maxLength: number; // -1 when unset
  inputMode: string;
  pattern: string; // pattern attribute (raw)
  required: boolean;
  visible: boolean;
  widthPx: number;
  focused?: boolean;
  opacityZero?: boolean;
  offscreen?: boolean;
  tiny?: boolean;
  // Canonical structural feature vector (see contract.ts). Optional for eval
  // rows; required when collecting diagnostics for labeling.
  structural?: number[] | undefined;
}

export interface LabeledFieldRecord extends RawFieldRecord {
  label: FieldClass;
  hardNegative?: HardNegative | undefined;
  teacherConfidence?: number | undefined; // 0..1 from the LLM teacher
  rationale?: string | undefined;
}

export interface ClassificationResult {
  // Normalized probabilities over FieldClass (sum ~= 1).
  scores: Record<FieldClass, number>;
  top: FieldClass;
  topProb: number;
  margin: number; // topProb - secondProb
  hardNegative?: HardNegative | undefined; // detected hard-negative subtype, if any
  signals: string[]; // human-readable signals that fired (explainability)
}

export type FillAction = 'FILL' | 'ABSTAIN' | 'BLOCK';

export interface FillDecision {
  action: FillAction;
  class: FieldClass;
  confidence: number;
  reason: string;
  safety?: string | undefined; // populated when the safety gate blocked the fill
  signals: string[];
}
