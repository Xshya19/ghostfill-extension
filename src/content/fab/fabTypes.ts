/**
 * GhostFill 3.0 — FAB Intelligence Layer · shared types
 *
 * This layer is intentionally dependency-free (no `chrome.*`, no repo imports)
 * so it can be unit-tested in isolation and reused by GhostLabel.
 */

export type FabMode = 'magic' | 'email' | 'password' | 'otp' | 'user' | 'form';

/**
 * Tri-state presence.
 * - `hidden`  → not rendered at all
 * - `quiet`   → 14px dot, no label, expands only on hover (low confidence)
 * - `active`  → full 46px FAB (high confidence)
 */
export type FabPresence = 'hidden' | 'quiet' | 'active';

export type FabBlockReason =
  | 'disabled-by-settings'
  | 'host-muted'
  | 'host-app-surface'
  | 'not-a-field'
  | 'inside-fab'
  | 'design-mode'
  | 'field-not-editable'
  | 'field-invisible'
  | 'field-too-small'
  | 'excluded-input-type'
  | 'search-field'
  | 'rich-text-editor'
  | 'content-field'
  | 'payment-field'
  | 'address-field'
  | 'numeric-field'
  | 'promo-field'
  | 'identity-document-field'
  | 'low-score';

/** Structural subset of `PageAnalysis` from `src/intelligence/pageAnalyzer.ts`. */
export interface PageSignals {
  readonly pageType?: string | null;
  readonly hasEmailField?: boolean;
  readonly hasPasswordField?: boolean;
  readonly hasOTPField?: boolean;
  readonly hasNameFields?: boolean;
  readonly isAuthRelated?: boolean;
  readonly inputCount?: number;
  readonly formCount?: number;
  readonly provider?: string | null;
}

export interface HostPolicySnapshot {
  readonly host: string;
  readonly muted: boolean;
  readonly dismissals: number;
  readonly accepts: number;
}

/** Everything the gate learned about the focused field, useful for telemetry. */
export interface FieldEvidence {
  readonly tag: string;
  readonly type: string;
  readonly autocompleteTokens: readonly string[];
  readonly descriptor: string;
  readonly labelText: string;
  readonly inForm: boolean;
  readonly formInputCount: number;
  readonly formHasPassword: boolean;
  readonly maxLength: number;
  readonly inputMode: string;
  readonly isContentEditable: boolean;
  readonly width: number;
  readonly height: number;
}

export interface GateDecision {
  readonly presence: FabPresence;
  readonly mode: FabMode;
  readonly score: number;
  /** 0..1 — `score` normalised, safe for UI copy and telemetry buckets. */
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly blockedBy?: FabBlockReason;
  /**
   * Element the FAB should anchor to. Usually the field itself, but split OTP
   * digit boxes anchor to their shared container so the FAB sits beside the
   * whole group instead of one 32px box.
   */
  readonly anchorElement?: HTMLElement;
  readonly evidence?: FieldEvidence;
}

export interface GateThresholds {
  readonly active?: number;
  readonly quiet?: number;
}

export interface GateOptions {
  /** User setting `showFloatingButton`. */
  readonly enabled?: boolean;
  readonly pageSignals?: PageSignals | null;
  readonly policy?: HostPolicySnapshot | null;
  /** Optional bridge to the existing `classifyField()` / IntelligenceCore. */
  readonly classify?: (el: HTMLElement) => FabMode | 'generic';
  readonly href?: string;
  readonly hostname?: string;
  readonly thresholds?: GateThresholds;
  /** Escape hatch for QA pages: allow app surfaces such as Docs/Slack. */
  readonly allowAppSurfaces?: boolean;
}

export const DEFAULT_THRESHOLDS: Required<GateThresholds> = {
  active: 60,
  quiet: 32,
};
