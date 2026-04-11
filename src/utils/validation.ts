/**
 * Runtime Validation Schemas using Zod
 *
 * HIGH FIX: Runtime Validation for Message Handlers
 * FIX: Un-minified this file — it was collapsed to a single line, breaking
 * TypeScript's ability to resolve named exports.
 */
import { z } from 'zod';
import { createLogger } from './logger';

const log = createLogger('Validation');

// Configuration
const MAX_MESSAGE_SIZE = 2 * 1024 * 1024; // 2MB for large DOM snapshots
const MAX_STRING_LENGTH = 10000;
const MAX_ARRAY_LENGTH = 100;

// ─── Base validators ──────────────────────────────────────────────────────────
const safeString = z.string().max(MAX_STRING_LENGTH, 'String exceeds maximum length');
const safeNumber = z.number().finite();
const safeBoolean = z.boolean();

// ─── Email Service enum ───────────────────────────────────────────────────────
const emailServiceSchema = z.enum([
  'mailgw',
  'mailtm',
  '1secmail',
  'guerrilla',
  'maildrop',
  'tempmail',
  'custom',
]);

// ─── Email Account schema ─────────────────────────────────────────────────────
export const emailAccountSchema = z.object({
  id: safeString,
  fullEmail: safeString.email('Invalid email format'),
  login: safeString,
  domain: safeString,
  service: emailServiceSchema,
  createdAt: safeNumber,
  expiresAt: safeNumber,
});

// ─── Email schema ─────────────────────────────────────────────────────────────
export const emailSchema = z.object({
  id: safeString,
  from: safeString,
  to: safeString,
  subject: safeString,
  body: safeString,
  date: safeString,
  timestamp: safeNumber,
  seen: safeBoolean.optional().nullable(),
});

// ─── Password Options schema ──────────────────────────────────────────────────
export const passwordOptionsSchema = z.object({
  length: safeNumber.min(8).max(128).default(16),
  uppercase: safeBoolean.default(true),
  lowercase: safeBoolean.default(true),
  numbers: safeBoolean.default(true),
  symbols: safeBoolean.default(true),
});

// ─── Generated Password schema ────────────────────────────────────────────────
export const generatedPasswordSchema = z.object({
  password: safeString,
  strength: z.number().min(0).max(100),
  entropy: safeNumber,
});

// ─── User Settings schema ─────────────────────────────────────────────────────
export const userSettingsSchema = z.object({
  preferredEmailService: emailServiceSchema.default('tempmail'),
  autoCheckInbox: safeBoolean.default(true),
  checkIntervalSeconds: safeNumber.min(3).max(60).default(10),
  autoFillOTP: safeBoolean.default(true),
  notifyOnNewEmail: safeBoolean.default(true),
  notifyOnOTP: safeBoolean.default(true),
  darkMode: z.union([safeBoolean, z.literal('system')]).default(false),
  enableAnimations: safeBoolean.default(true),
  autoConfirmLinks: safeBoolean.default(true),
});

// ─── Message Payload Schemas ──────────────────────────────────────────────────
export const generateEmailPayloadSchema = z
  .object({
    prefix: safeString.optional(),
    domain: safeString.optional(),
    service: emailServiceSchema.optional(),
  })
  .optional();

export const checkInboxPayloadSchema = z
  .object({
    email: safeString.email(),
    service: emailServiceSchema,
  })
  .optional();

export const readEmailPayloadSchema = z.object({
  emailId: safeString.or(safeNumber),
  login: safeString,
  domain: safeString,
  service: emailServiceSchema,
});

export const generatePasswordPayloadSchema = passwordOptionsSchema.partial().optional();

export const savePasswordPayloadSchema = z.object({
  password: safeString.min(1).max(512),
  website: safeString.max(500),
  notes: safeString.max(1000).optional().nullable(),
});

export const extractOTPPayloadSchema = z.object({
  text: z.string().max(100000),
  source: safeString.optional().nullable(),
});

export const fillOTPPayloadSchema = z.object({
  otp: safeString.min(4).max(12),
  fieldSelectors: z.array(safeString).max(MAX_ARRAY_LENGTH).optional(),
});

export const otpPageDetectedPayloadSchema = z.object({
  url: safeString.url(),
  fieldCount: safeNumber.min(0).max(100),
  fieldSelectors: z.array(safeString).max(MAX_ARRAY_LENGTH).optional(),
  confidence: safeNumber.min(0).max(1).optional(),
  verdict: z.enum(['otp-page', 'possible-otp', 'not-otp', 'maybe-otp']).optional(),
});

export const autoFillOTPPayloadSchema = z.object({
  otp: safeString.regex(/^[A-Za-z0-9]{4,10}$/, 'OTP must be 4-10 alphanumeric characters'),
  source: z.enum(['email', 'sms', 'manual', 'url-extracted']),
  confidence: safeNumber.min(0).max(1),
  fieldSelectors: z.array(safeString).max(MAX_ARRAY_LENGTH).optional(),
  isBackgroundTab: z.boolean().optional(),
});

export const fillFieldPayloadSchema = z.object({
  value: safeString,
  selector: safeString.optional().nullable(),
  fieldType: safeString.optional().nullable(),
});

export const fillFormPayloadSchema = z.object({
  formSelector: safeString,
  data: z.object({}).catchall(z.string()),
});

export const highlightFieldsPayloadSchema = z.object({
  fieldType: safeString,
});

export const updateSettingsPayloadSchema = userSettingsSchema.partial();

export const showNotificationPayloadSchema = z.object({
  title: safeString.max(200),
  message: safeString.max(500),
  type: z.enum(['info', 'success', 'warning', 'error']).optional(),
  duration: safeNumber.min(1000).max(30000).optional().nullable(),
});

export const newEmailReceivedPayloadSchema = z.object({
  email: emailSchema,
  account: emailAccountSchema,
});

export const otpDetectedPayloadSchema = z.object({
  otp: safeString,
  source: safeString,
  email: emailSchema.optional(),
});

export const contextMenuClickPayloadSchema = z.object({
  menuItemId: safeString,
  selectionText: safeString.optional().nullable(),
  pageUrl: safeString.url().optional().nullable(),
  frameUrl: safeString.url().optional().nullable(),
});

export const analyzeDOMPayloadSchema = z.object({
  simplifiedDOM: z.string().max(MAX_MESSAGE_SIZE),
});

export const classifyFieldPayloadSchema = z.object({
  textChannels: z.array(z.array(z.number().int())),
  structural: z.array(z.number()),
  isVisible: safeBoolean,
});

export const reportMisclassificationPayloadSchema = z.object({
  correctType: safeString,
});

export const captureSiteContextPayloadSchema = z.object({
  url: safeString.url(),
  pageText: z.string().max(100000),
  hasOTPField: safeBoolean,
  hasPasswordField: safeBoolean,
  hasEmailField: safeBoolean,
  otpFieldSelector: safeString.optional().nullable(),
  otpFieldLength: safeNumber.min(1).max(20).optional().nullable(),
});

export const registrationFormSubmittedPayloadSchema = z.object({
  url: safeString,
  formAction: safeString.optional(),
  timestamp: safeNumber.optional(),
});

// ─── Base Message Schema ──────────────────────────────────────────────────────
export const baseMessageSchema = z.object({
  action: z.string(),
  tabId: safeNumber.optional().nullable(),
  timestamp: safeNumber.optional().nullable(),
});

// ─── Message Action to Payload Schema mapping ─────────────────────────────────
export const messagePayloadSchemas: Record<string, z.ZodSchema> = {
  GENERATE_EMAIL: generateEmailPayloadSchema,
  GET_CURRENT_EMAIL: z.undefined().optional(),
  CHECK_INBOX: checkInboxPayloadSchema,
  READ_EMAIL: readEmailPayloadSchema,
  GET_EMAIL_HISTORY: z.undefined().optional(),
  GET_PROVIDER_HEALTH: z.undefined().optional(),
  GENERATE_PASSWORD: generatePasswordPayloadSchema,
  GET_PASSWORD_HISTORY: z.undefined().optional(),
  SAVE_PASSWORD: savePasswordPayloadSchema,
  DELETE_PASSWORD: z.object({ id: safeString }).optional(),
  GET_IDENTITY: z.undefined().optional(),
  GENERATE_IDENTITY: z.undefined().optional(),
  REFRESH_IDENTITY: z.undefined().optional(),
  EXTRACT_OTP: extractOTPPayloadSchema,
  GET_LAST_OTP: z.undefined().optional(),
  FILL_OTP: fillOTPPayloadSchema,
  OTP_PAGE_DETECTED: otpPageDetectedPayloadSchema,
  OTP_PAGE_LEFT: z.undefined().optional(),
  MARK_OTP_USED: z.undefined().optional(),
  AUTO_FILL_OTP: autoFillOTPPayloadSchema,
  DETECT_FORMS: z.undefined().optional(),
  FILL_FIELD: fillFieldPayloadSchema,
  FILL_FORM: fillFormPayloadSchema,
  HIGHLIGHT_FIELDS: highlightFieldsPayloadSchema,
  SMART_AUTOFILL: z.undefined().optional(),
  SHOW_FLOATING_BUTTON: z.undefined().optional(),
  HIDE_FLOATING_BUTTON: z.undefined().optional(),
  GET_SETTINGS: z.undefined().optional(),
  UPDATE_SETTINGS: updateSettingsPayloadSchema,
  CLEAR_DATA: z.undefined().optional(),
  SHOW_NOTIFICATION: showNotificationPayloadSchema,
  NEW_EMAIL_RECEIVED: newEmailReceivedPayloadSchema,
  OTP_DETECTED: otpDetectedPayloadSchema,
  CONTEXT_MENU_CLICK: contextMenuClickPayloadSchema,
  UPDATE_CONTEXT_MENU: z.undefined().optional(),
  OPEN_OPTIONS: z.undefined().optional(),
  CLIPBOARD_OPERATION_FAILED: z.object({ error: safeString }).optional(),
  ANALYZE_DOM: analyzeDOMPayloadSchema,
  CAPTURE_SITE_CONTEXT: captureSiteContextPayloadSchema,
  CHECK_OTP_NOW: z.undefined().optional(),
  PING: z.undefined().optional(),
  PREWARM_ML: z.undefined().optional(),
  CLASSIFY_FIELD: classifyFieldPayloadSchema,
  REPORT_MISCLASSIFICATION: reportMisclassificationPayloadSchema,
  LINK_ACTIVATED: z.undefined().optional(),
  CHECK_OTP_FRESHNESS: z.undefined().optional(),
  WAIT_FOR_FRESH_OTP: z
    .object({
      maxWaitMs: safeNumber.min(1000).max(120000),
    })
    .optional(),
  FALLBACK_DOMAINS_USED: z
    .object({
      service: safeString.optional(),
      reason: safeString.optional(),
      timestamp: safeNumber.optional(),
      error: safeString.optional(),
    })
    .optional(),
  RESET_STATE: z.undefined().optional(),
  REGISTRATION_FORM_SUBMITTED: registrationFormSubmittedPayloadSchema,
  GET_DIAGNOSTIC_REPORT: z.undefined().optional(),
};

// ─── Validation function ──────────────────────────────────────────────────────
export function validateMessage<T extends { action: string; payload?: unknown }>(
  message: T
): { valid: true; data: T } | { valid: false; error: string } {
  try {
    const messageSize = JSON.stringify(message).length;
    if (messageSize > MAX_MESSAGE_SIZE) {
      return {
        valid: false,
        error: `Message exceeds maximum size (${messageSize} > ${MAX_MESSAGE_SIZE} bytes)`,
      };
    }

    const action = message.action.trim();
    const payloadSchema = messagePayloadSchemas[action];

    if (!payloadSchema) {
      log.warn('Unknown message action rejected', { action });
      return {
        valid: false,
        error: `Unknown message action: ${action}`,
      };
    }

    payloadSchema.parse(message.payload);
    return { valid: true, data: message };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return {
        valid: false,
        error: `Validation failed for ${message.action}: ${errors}`,
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type EmailAccount = z.infer<typeof emailAccountSchema>;
export type Email = z.infer<typeof emailSchema>;
export type PasswordOptions = z.infer<typeof passwordOptionsSchema>;
export type GeneratedPassword = z.infer<typeof generatedPasswordSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;