/**
 * @deprecated This file is a compatibility shim. Prefer direct imports from
 * 'src/services/extraction/knowledge' instead.
 *
 * Remaining consumers (migrate these to remove this file):
 *   - extraction/otpExtractor.ts
 *   - extraction/providerDetector.ts
 *   - extraction/linkExtractor.ts
 */
import { KnowledgeBase } from './extraction/knowledge';

export {
  KnowledgeBase,
  PROVIDER_DATABASE,
  OTP_PATTERN_DATABASE,
  ANTI_PATTERN_DATABASE,
  CONTEXT_KEYWORD_DATABASE,
  LINK_PATTERN_DATABASE,
  INTENT_PATTERNS,
} from './extraction/knowledge';
export default KnowledgeBase;
