// src/services/extraction/index.ts
// ═══════════════════════════════════════════════════════════════════════
//  EXTRACTION MODULE - MAIN EXPORTS
//  Central export point for all extraction functionality
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
//  TYPE EXPORTS
// ───────────────────────────────────────────────────────────────────────

export type {
  // Core extraction types
  EmailIntent,
  EmailSection,
  ProviderKnowledge,
  ExtractedOTP,
  ExtractedLink,
  ExtractionResult,
  IntentSignal,
  AntiPatternSeverity,
  // Module-specific types
  ZoneType,
  EmailZone,
  ZoneWeights,
  URLParamAnalysis,
  AntiPatternResult,
  OTPCandidate,
  RelationshipGraph,
  ContextValidation,
  LinkCandidate,
  ProviderDetectionResult,
  IntentResult,
  CrossValidationResult,
  ExtractionTimings,
  // Configuration types
  ExtractionConfig,
  ScoringConfig,
  ThresholdConfig,
  LimitConfig,
  ContextConfig,
  PerformanceConfig,
} from './types';

// Re-export from shared types for convenience
export type {
  CodeType,
  CodeFormat,
  ExtractionStrategy,
  LinkType,
  PatternStrength,
  OTPFormat,
  EmailCategory,
  ProviderOTPMatch,
  ProviderMatch,
  ProviderCategory,
  OTPSignal,
  ScoringSignal,
  OTPReasoningChain,
  OTPReasoningStep,
  ReasoningChain,
  ReasoningStep,
  OTPEmailAnalysis,
  EmailAnalysis,
  EmailAnatomy,
  OTPExtractionResult,
  LinkExtractionResult,
  ActivationLink,
  ExtractionMeta,
  OTPExtractionMeta,
  ClassificationResult,
  DetectionResult,
  FormAnalysisResult,
  KnowledgeBaseStructure,
  OtpPattern,
  LinkPattern,
  AntiPattern,
  ContextKeyword,
} from '../types';

// ───────────────────────────────────────────────────────────────────────
//  URL EXTRACTOR EXPORTS
// ───────────────────────────────────────────────────────────────────────

export {
  extractUrls,
  isValidUrl,
  normalizeUrl,
  unwrapTrackingUrl,
  decodeHtmlEntities,
  analyzeUrlParams,
  calculateUrlComplexity,
} from './urlExtractor';

// ───────────────────────────────────────────────────────────────────────
//  ZONE ANALYZER EXPORTS
// ───────────────────────────────────────────────────────────────────────

export {
  analyzeEmailZones,
  getZoneForPosition,
  getContextAround,
  stripHtml,
  stripHtmlPreserveStructure,
  ZONE_WEIGHTS,
} from './zoneAnalyzer';

// ───────────────────────────────────────────────────────────────────────
//  PROVIDER DETECTOR EXPORTS
// ───────────────────────────────────────────────────────────────────────

export { detectProvider, providerMatches, getProviderOtpConfig } from './providerDetector';

// ───────────────────────────────────────────────────────────────────────
//  OTP EXTRACTOR EXPORTS
// ───────────────────────────────────────────────────────────────────────

export {
  extractOTP,
  checkAntiPatterns,
  validateContext,
  calculateIsolationScore,
} from './otpExtractor';

// ───────────────────────────────────────────────────────────────────────
//  LINK EXTRACTOR EXPORTS
// ───────────────────────────────────────────────────────────────────────

export { extractLink, isCTAButton, getAnchorInfo, calculateDomainTrust } from './linkExtractor';

// ───────────────────────────────────────────────────────────────────────
//  LINK SCORER EXPORTS
// ───────────────────────────────────────────────────────────────────────

export {
  detectIntentFromUrl,
  scoreAnchorText,
  scoreUrlParams,
  scoreIntentAlignment,
  applyZoneScoring,
  matchesProviderPattern,
  calculateLinkScoreBreakdown,
} from './linkScorer';

// ───────────────────────────────────────────────────────────────────────
//  ORCHESTRATOR EXPORT (Main Entry Point)
// ───────────────────────────────────────────────────────────────────────

export { extractAll, extractOTPStandalone, extractLinkStandalone } from '../intelligentExtractor';
