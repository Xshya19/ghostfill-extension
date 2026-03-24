// ═══════════════════════════════════════════════════════════════════════
//  GHOSTFILL SERVICES - BARREL EXPORT (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════════
//
// ⚠️  DEPRECATION NOTICE
// This barrel export file is DEPRECATED and will be removed in v2.0.
//
// REASON: Barrel exports can cause circular dependencies and make it
// harder for bundlers to tree-shake unused code.
//
// MIGRATION GUIDE:
// ─────────────────
// Instead of:
//   import { emailService, passwordService } from '@services';
//
// Use direct imports:
//   import { emailService } from '@services/emailServices';
//   import { passwordService } from '@services/passwordService';
//   import { otpService } from '@services/otpService';
//   import { storageService } from '@services/storageService';
//
// For TypeScript users, import types directly:
//   import type { EmailAccount } from '@services/types/email-services.types';
//
// ═══════════════════════════════════════════════════════════════════════

// Service exports (deprecated - use direct imports)
export { emailService } from './emailServices';
export { passwordService } from './passwordService';
export { otpService } from './otpService';
export { storageService } from './storageService';
export { clipboardService } from './clipboardService';
export { linkService } from './linkService';
export { identityService } from './identityService';
export { smartDetectionService } from './smartDetectionService';
export { performanceService } from './performanceService';

// Re-export extraction module for external consumers (deprecated)
export { extractAll, extractOTPStandalone, extractLinkStandalone } from './intelligentExtractor';

// Re-export email service sub-components for advanced usage (deprecated)
export {
  providerHealth,
  tempMailService,
  mailTmService,
  mailGwService,
  dropMailService,
  guerrillaMailService,
  maildropService,
  customDomainService,
} from './emailServices';

// Type exports (these are safe to re-export)
export type { EmailAccount, EmailService } from '../types';
