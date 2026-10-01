import type { ProviderKnowledge } from '../../types/extraction.types';
import { ANTI_PATTERN_DATABASE } from './anti';
import { CONTEXT_KEYWORD_DATABASE, INTENT_PATTERNS } from './intents';
import { LINK_PATTERN_DATABASE } from './links';
import { OTP_PATTERN_DATABASE } from './otp';

export const PROVIDER_DATABASE: ProviderKnowledge[] = [];

export * from './otp';
export * from './anti';
export * from './intents';
export * from './links';

export const KnowledgeBase = {
  providers: PROVIDER_DATABASE,
  otpPatterns: OTP_PATTERN_DATABASE,
  antiPatterns: ANTI_PATTERN_DATABASE,
  contextKeywords: CONTEXT_KEYWORD_DATABASE,
  linkPatterns: LINK_PATTERN_DATABASE,
  intentPatterns: INTENT_PATTERNS,
};

export default KnowledgeBase;
