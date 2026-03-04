// ═══════════════════════════════════════════════════════════════════════
//  GHOSTFILL UTILITIES - BARREL EXPORT (DEPRECATED)
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
//   import { validateEmail, createLogger } from '@utils';
//
// Use direct imports:
//   import { validateEmail } from '@utils/validators';
//   import { createLogger } from '@utils/logger';
//   import { safeSendMessage } from '@utils/messaging';
//   import { debounce } from '@utils/debounce';
//
// ═══════════════════════════════════════════════════════════════════════

// Utility exports - Re-export all from each module (DEPRECATED)
// For direct imports without conflicts, import from the specific module

export * from './messaging';
export * from './constants';
export * from './logger';
export * from './debounce';
export * from './errorHandler';

// Helper functions (deprecated - use direct imports)
export { 
    generateId, 
    deepClone, 
    deepMerge, 
    isObject, 
    sleep, 
    retry, 
    truncate, 
    escapeHtml, 
    stripHtml, 
    copyToClipboard, 
    getUniqueSelector, 
    isElementVisible, 
    getElementLabel 
} from './helpers';

// Validators (deprecated - use direct imports)
export { 
    validateEmail, 
    validatePasswordOptions, 
    validateOTP, 
    validateDomain, 
    sanitizeString, 
    sanitizeHtml 
} from './validators';

// Formatters (deprecated - use direct imports)
export { 
    formatFileSize, 
    formatPasswordStrength, 
    formatCrackTime, 
    formatRelativeTime, 
    formatOTP, 
    formatDomain, 
    maskPassword, 
    formatEntropy, 
    pluralize 
} from './formatters';

// Error handling (deprecated - use direct imports)
export { 
    AppError, 
    NetworkError, 
    StorageError, 
    ValidationError, 
    PermissionError, 
    handleError, 
    withErrorHandling, 
    tryCatch, 
    safeJsonParse, 
    assert, 
    getErrorMessage, 
    toErrorResponse, 
    toSuccessResponse 
} from './errorHandler';
