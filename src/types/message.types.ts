// Message Passing Types

import { EmailAccount, Email, EmailService } from './email.types';
import { DetectedForm, DetectedField } from './form.types';
import { PasswordOptions, GeneratedPassword, PasswordHistoryItem } from './password.types';
import { UserSettings } from './storage.types';

// Message action types
export type MessageAction =
  // Email actions
  | 'GENERATE_EMAIL'
  | 'GENERATE_GMAIL_ALIAS'
  | 'GET_CURRENT_EMAIL'
  | 'CHECK_INBOX'
  | 'READ_EMAIL'
  | 'GET_EMAIL_HISTORY'
  | 'GET_PROVIDER_HEALTH'
  // Password actions
  | 'GENERATE_PASSWORD'
  | 'GET_PASSWORD_HISTORY'
  | 'SAVE_PASSWORD'
  | 'DELETE_PASSWORD'
  // Identity actions
  | 'GET_IDENTITY'
  | 'GENERATE_IDENTITY'
  | 'REFRESH_IDENTITY'
  // OTP actions
  | 'EXTRACT_OTP'
  | 'GET_LAST_OTP'
  | 'FILL_OTP'
  | 'OTP_PAGE_DETECTED'
  | 'OTP_PAGE_LEFT'
  | 'AUTO_FILL_OTP'
  // Form actions
  | 'DETECT_FORMS'
  | 'FILL_FIELD'
  | 'FILL_FORM'
  | 'HIGHLIGHT_FIELDS'
  | 'SMART_AUTOFILL'
  | 'SHOW_FLOATING_BUTTON'
  | 'HIDE_FLOATING_BUTTON'
  // Storage actions
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'CLEAR_DATA'
  // Notification actions
  | 'SHOW_NOTIFICATION'
  | 'NEW_EMAIL_RECEIVED'
  | 'OTP_DETECTED'
  // Context menu actions
  | 'CONTEXT_MENU_CLICK'
  | 'UPDATE_CONTEXT_MENU'
  | 'OPEN_OPTIONS'
  // Clipboard actions
  | 'CLIPBOARD_OPERATION_FAILED'
  // LLM/Agent actions
  | 'ANALYZE_DOM'
  // Site context actions (context-aware verification)
  | 'CAPTURE_SITE_CONTEXT'
  // Instant OTP check action
  | 'CHECK_OTP_NOW'
  | 'MARK_OTP_USED'
  | 'PING'
  // ML Inference actions
  | 'CLASSIFY_FIELD'
  | 'CHECK_ML'
  | 'PREWARM_ML'
  | 'REPORT_MISCLASSIFICATION'
  | 'LINK_ACTIVATED'
  | 'CHECK_OTP_FRESHNESS'
  | 'WAIT_FOR_FRESH_OTP'
  | 'FALLBACK_DOMAINS_USED'
  | 'RESET_STATE'
  // Event-driven polling triggers
  | 'REGISTRATION_FORM_SUBMITTED'
  // Diagnostic export
  | 'GET_DIAGNOSTIC_REPORT'
  // Gmail API actions
  | 'GMAIL_SIGN_IN'
  | 'GMAIL_SIGN_OUT'
  | 'GMAIL_FETCH_INBOX'
  | 'GMAIL_GET_MESSAGE'
  | 'GMAIL_GET_STATUS'
  | 'GMAIL_SEARCH'
  | 'GMAIL_LIST_LABELS'
  | 'DOWNLOAD_TRAINING_DATA';

// Base message interface
export interface BaseMessage {
  action: MessageAction;
  tabId?: number;
  timestamp?: number;
}

// ... existing interfaces ...

export interface AnalyzeDOMMessage extends BaseMessage {
  action: 'ANALYZE_DOM';
  payload: {
    simplifiedDOM: string;
  };
}

// Site context message for context-aware verification
export interface CaptureSiteContextMessage extends BaseMessage {
  action: 'CAPTURE_SITE_CONTEXT';
  payload: {
    url: string;
    pageText: string;
    hasOTPField: boolean;
    hasPasswordField: boolean;
    hasEmailField: boolean;
    otpFieldSelector?: string;
    otpFieldLength?: number;
  };
}

// ... existing interfaces ...

// ... existing interfaces ...
export interface GenerateEmailMessage extends BaseMessage {
  action: 'GENERATE_EMAIL';
  payload?: {
    prefix?: string;
    domain?: string;
    service?: EmailService;
  };
}

export interface GenerateGmailAliasMessage extends BaseMessage {
  action: 'GENERATE_GMAIL_ALIAS';
  payload?: {
    domain?: string;
  };
}

export interface GenerateEmailResponse {
  success: boolean;
  email?: EmailAccount;
  error?: string;
}

export interface GetCurrentEmailResponse {
  success: boolean;
  email?: EmailAccount;
  error?: string;
}

export interface CheckInboxMessage extends BaseMessage {
  action: 'CHECK_INBOX';
  payload?: {
    email: string;
    service: EmailService;
  };
}

export interface CheckInboxResponse {
  success: boolean;
  emails?: Email[];
  error?: string;
}

export interface ReadEmailMessage extends BaseMessage {
  action: 'READ_EMAIL';
  payload: {
    emailId: string | number;
    login: string;
    domain: string;
    service: EmailService;
  };
}

export interface ReadEmailResponse {
  success: boolean;
  email?: Email;
  otp?: string;
  error?: string;
}

// Password-related messages
export interface GeneratePasswordMessage extends BaseMessage {
  action: 'GENERATE_PASSWORD';
  payload?: Partial<PasswordOptions>;
}

export interface GeneratePasswordResponse {
  success: boolean;
  result?: GeneratedPassword;
  error?: string;
}

export interface SavePasswordMessage extends BaseMessage {
  action: 'SAVE_PASSWORD';
  payload: {
    password: string;
    website: string;
    notes?: string;
  };
}

export interface GetPasswordHistoryMessage extends BaseMessage {
  action: 'GET_PASSWORD_HISTORY';
}

export interface GetPasswordHistoryResponse {
  success: boolean;
  history?: PasswordHistoryItem[];
  error?: string;
}

// Identity-related messages
export interface GetIdentityMessage extends BaseMessage {
  action: 'GET_IDENTITY';
}

export interface GetIdentityResponse {
  success: boolean;
  identity?: import('./identity.types').IdentityProfile & { email: string; password: string };
  error?: string;
}

export interface GenerateIdentityMessage extends BaseMessage {
  action: 'GENERATE_IDENTITY';
}

export interface GenerateIdentityResponse {
  success: boolean;
  identity?: import('./identity.types').IdentityProfile;
  error?: string;
}

export interface RefreshIdentityMessage extends BaseMessage {
  action: 'REFRESH_IDENTITY';
}

// OTP-related messages
export interface ExtractOTPMessage extends BaseMessage {
  action: 'EXTRACT_OTP';
  payload: {
    text?: string;
    textBody?: string;
    htmlBody?: string;
    subject?: string;
    source?: string;
    emailId?: string | number;
    emailFrom?: string;
    emailDate?: number;
    saveToLastOTP?: boolean;
  };
}

export interface ExtractOTPResponse {
  success: boolean;
  otp?: string;
  link?: string;
  confidence?: number;
  error?: string;
}

export interface GetLastOTPResponse {
  success: boolean;
  lastOTP?: import('./storage.types').LastOTP;
  error?: string;
}

export interface FillOTPMessage extends BaseMessage {
  action: 'FILL_OTP';
  payload: {
    otp: string;
    fieldSelectors?: string[];
  };
}

// OTP Page Detection messages
export interface OTPPageDetectedMessage extends BaseMessage {
  action: 'OTP_PAGE_DETECTED';
  payload: {
    url: string;
    fieldCount: number;
    fieldSelectors: string[];
    confidence?: number;
    verdict?: 'otp-page' | 'possible-otp' | 'not-otp' | 'maybe-otp';
  };
}

export interface OTPPageLeftMessage extends BaseMessage {
  action: 'OTP_PAGE_LEFT';
}

export interface AutoFillOTPMessage extends BaseMessage {
  action: 'AUTO_FILL_OTP';
  payload: {
    otp: string;
    source: 'email' | 'sms' | 'manual' | 'url-extracted';
    confidence: number;
    fieldSelectors?: string[];
    isBackgroundTab?: boolean;
  };
}

export interface MarkOTPUsedMessage extends BaseMessage {
  action: 'MARK_OTP_USED';
}

export interface CheckOTPNowMessage extends BaseMessage {
  action: 'CHECK_OTP_NOW';
}

export interface GetProviderHealthMessage extends BaseMessage {
  action: 'GET_PROVIDER_HEALTH';
}

export interface DeletePasswordMessage extends BaseMessage {
  action: 'DELETE_PASSWORD';
  payload?: {
    id: string;
  };
}

export interface ShowFloatingButtonMessage extends BaseMessage {
  action: 'SHOW_FLOATING_BUTTON';
}

export interface HideFloatingButtonMessage extends BaseMessage {
  action: 'HIDE_FLOATING_BUTTON';
}

export interface ClearDataMessage extends BaseMessage {
  action: 'CLEAR_DATA';
}

export interface UpdateContextMenuMessage extends BaseMessage {
  action: 'UPDATE_CONTEXT_MENU';
}

export interface OpenOptionsMessage extends BaseMessage {
  action: 'OPEN_OPTIONS';
}

export interface ClipboardOperationFailedMessage extends BaseMessage {
  action: 'CLIPBOARD_OPERATION_FAILED';
  payload?: {
    error: string;
  };
}

export interface PingMessage extends BaseMessage {
  action: 'PING';
}

export interface CheckOTPNowResponse {
  success: boolean;
  otp?: string;
  error?: string;
}

// Form-related messages
export interface DetectFormsMessage extends BaseMessage {
  action: 'DETECT_FORMS';
}

export interface DetectFormsResponse {
  success: boolean;
  forms?: DetectedForm[];
  standaloneFields?: DetectedField[];
  error?: string;
}

export interface GetSettingsResponse {
  success: boolean;
  settings?: UserSettings;
  error?: string;
}

export interface GetEmailHistoryResponse {
  success: boolean;
  history?: import('./email.types').EmailHistoryItem[];
  error?: string;
}

export interface FillFieldMessage extends BaseMessage {
  action: 'FILL_FIELD';
  payload: {
    value: string;
    selector?: string;
    fieldType?: string;
  };
}

export interface FillFormMessage extends BaseMessage {
  action: 'FILL_FORM';
  payload: {
    formSelector: string;
    data: Record<string, string>;
  };
}

// Notification messages
export interface ShowNotificationMessage extends BaseMessage {
  action: 'SHOW_NOTIFICATION';
  payload: {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
  };
}

export interface NewEmailReceivedMessage extends BaseMessage {
  action: 'NEW_EMAIL_RECEIVED';
  payload: {
    email: Email;
    account: EmailAccount;
  };
}

export interface OTPDetectedMessage extends BaseMessage {
  action: 'OTP_DETECTED';
  payload: {
    otp: string;
    source: string;
    email?: Email;
  };
}

// Context menu messages
export interface ContextMenuClickMessage extends BaseMessage {
  action: 'CONTEXT_MENU_CLICK';
  payload: {
    menuItemId: string;
    selectionText?: string;
    pageUrl?: string;
    frameUrl?: string;
  };
}

// Generic message for simple actions
export interface GetCurrentEmailMessage extends BaseMessage {
  action: 'GET_CURRENT_EMAIL';
}

export interface GetLastOTPMessage extends BaseMessage {
  action: 'GET_LAST_OTP';
}

export interface GetSettingsMessage extends BaseMessage {
  action: 'GET_SETTINGS';
}

export interface UpdateSettingsMessage extends BaseMessage {
  action: 'UPDATE_SETTINGS';
  payload: Partial<UserSettings>;
}

export interface GetEmailHistoryMessage extends BaseMessage {
  action: 'GET_EMAIL_HISTORY';
}

export interface SmartAutoFillMessage extends BaseMessage {
  action: 'SMART_AUTOFILL';
}

export interface HighlightFieldsMessage extends BaseMessage {
  action: 'HIGHLIGHT_FIELDS';
  payload: {
    fieldType: string;
  };
}

export interface ClassifyFieldMessage extends BaseMessage {
  action: 'CLASSIFY_FIELD';
  payload: {
    features: import('../content/extractor').RawFieldFeatures;
    context?: import('./form.types').PageContext;
  };
}

export interface CheckMLMessage extends BaseMessage {
  action: 'CHECK_ML';
  payload?: any;
}

export interface PrewarmMLMessage extends BaseMessage {
  action: 'PREWARM_ML';
}

export interface ClassifyFieldResponse {
  success: boolean;
  prediction?: import('../offscreen/inferenceEngine').MLPrediction | null;
  error?: string;
}

export interface AnalyzeDOMResponse {
  success: boolean;
  result?: {
    confidence?: number;
  };
  error?: string;
}

export interface ReportMisclassificationMessage extends BaseMessage {
  action: 'REPORT_MISCLASSIFICATION';
  payload: {
    correctType: string;
  };
}

export interface LinkActivatedMessage extends BaseMessage {
  action: 'LINK_ACTIVATED';
}

export interface CheckOTPFreshnessMessage extends BaseMessage {
  action: 'CHECK_OTP_FRESHNESS';
}

export interface WaitForFreshOTPMessage extends BaseMessage {
  action: 'WAIT_FOR_FRESH_OTP';
  payload: {
    maxWaitMs: number;
  };
}

export interface FallbackDomainsUsedMessage extends BaseMessage {
  action: 'FALLBACK_DOMAINS_USED';
  payload?: {
    service?: string;
    reason?: string;
    timestamp?: number;
    error?: string;
  };
}

/**
 * Broadcast from background to all content scripts on GENERATE_EMAIL.
 * Signals content scripts to reset their local OTP badge, menus, and
 * polling registrations for a clean new-session state.
 */
export interface ResetStateMessage extends BaseMessage {
  action: 'RESET_STATE';
}

export interface RegistrationFormSubmittedMessage extends BaseMessage {
  action: 'REGISTRATION_FORM_SUBMITTED';
  payload?: {
    url: string;
    formAction?: string;
    timestamp?: number;
  };
}

export interface GetDiagnosticReportMessage extends BaseMessage {
  action: 'GET_DIAGNOSTIC_REPORT';
}

export interface DownloadTrainingDataMessage extends BaseMessage {
  action: 'DOWNLOAD_TRAINING_DATA';
  payload: {
    data: string;
  };
}

export interface DiagnosticReportResponse {
  success: boolean;
  report?: unknown;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail API types
// ─────────────────────────────────────────────────────────────────────────────

export interface GmailProfile {
  email: string;
  name?: string;
  picture?: string;
  messagesTotal?: number;
  historyId?: string;
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePayload {
  headers: GmailMessageHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePayload[];
  mimeType?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  fromEmail: string;
  fromName: string;
  to?: string;
  cc?: string;
  bcc?: string;
  deliveredTo?: string;
  xOriginalTo?: string;
  headers?: Array<{ name: string; value: string }>;
  date: number;
  dateFormatted: string;
  body?: string;
  /** Separate HTML body for link detection — may differ from plain-text `body` */
  htmlBody?: string;
  isUnread: boolean;
  labelIds: string[];
}

// Gmail sign-in message
export interface GmailSignInMessage extends BaseMessage {
  action: 'GMAIL_SIGN_IN';
}

export interface GmailAuthIssueResponse {
  silentAuthBlocked: boolean;
  reason: string | null;
  retryAt: number | null;
  permanent: boolean;
}

export interface GmailClientIdStatusResponse {
  configured: boolean;
  usingBundledClientId: boolean;
  blocked: boolean;
  reason: string | null;
}

export interface GmailSignInResponse {
  success: boolean;
  profile?: GmailProfile;
  error?: string;
  setupRequired?: boolean;
  authIssue?: GmailAuthIssueResponse;
  clientIdStatus?: GmailClientIdStatusResponse;
}

// Gmail sign-out message
export interface GmailSignOutMessage extends BaseMessage {
  action: 'GMAIL_SIGN_OUT';
}

// Gmail fetch inbox message
export interface GmailFetchInboxMessage extends BaseMessage {
  action: 'GMAIL_FETCH_INBOX';
  payload?: {
    query?: string;
    maxResults?: number;
    alias?: string;
    forceFull?: boolean;
  };
}

export interface GmailFetchInboxResponse {
  success: boolean;
  messages?: GmailMessage[];
  source?: 'cache' | 'full' | 'history';
  cached?: boolean;
  error?: string;
}

// Gmail get single message
export interface GmailGetMessageMessage extends BaseMessage {
  action: 'GMAIL_GET_MESSAGE';
  payload: { messageId: string; alias?: string };
}

export interface GmailGetMessageResponse {
  success: boolean;
  message?: GmailMessage;
  error?: string;
}

// Gmail get auth status
export interface GmailGetStatusMessage extends BaseMessage {
  action: 'GMAIL_GET_STATUS';
}

export interface GmailGetStatusResponse {
  success: boolean;
  connected: boolean;
  profile?: GmailProfile;
  error?: string;
  authIssue?: GmailAuthIssueResponse;
  clientIdStatus?: GmailClientIdStatusResponse;
}

export interface GmailSearchMessage extends BaseMessage {
  action: 'GMAIL_SEARCH';
  payload?: {
    query?: string;
    maxResults?: number;
    alias?: string;
  };
}

export interface GmailListLabelsMessage extends BaseMessage {
  action: 'GMAIL_LIST_LABELS';
}

export interface GmailListLabelsResponse {
  success: boolean;
  labels?: Array<{ id: string; name: string; type: string }>;
  error?: string;
}

// Union type for all messages
export type ExtensionMessage =
  | GenerateEmailMessage
  | GenerateGmailAliasMessage
  | GetCurrentEmailMessage
  | CheckInboxMessage
  | ReadEmailMessage
  | GetEmailHistoryMessage
  | GetProviderHealthMessage
  | GeneratePasswordMessage
  | SavePasswordMessage
  | DeletePasswordMessage
  | GetPasswordHistoryMessage
  | GetIdentityMessage
  | GenerateIdentityMessage
  | RefreshIdentityMessage
  | ExtractOTPMessage
  | GetLastOTPMessage
  | FillOTPMessage
  | OTPPageDetectedMessage
  | OTPPageLeftMessage
  | AutoFillOTPMessage
  | DetectFormsMessage
  | FillFieldMessage
  | FillFormMessage
  | HighlightFieldsMessage
  | SmartAutoFillMessage
  | ShowFloatingButtonMessage
  | HideFloatingButtonMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | ClearDataMessage
  | ShowNotificationMessage
  | NewEmailReceivedMessage
  | OTPDetectedMessage
  | ContextMenuClickMessage
  | UpdateContextMenuMessage
  | OpenOptionsMessage
  | ClipboardOperationFailedMessage
  | AnalyzeDOMMessage
  | CaptureSiteContextMessage
  | CheckOTPNowMessage
  | MarkOTPUsedMessage
  | ClassifyFieldMessage
  | CheckMLMessage
  | PingMessage
  | PrewarmMLMessage
  | ReportMisclassificationMessage
  | LinkActivatedMessage
  | CheckOTPFreshnessMessage
  | WaitForFreshOTPMessage
  | FallbackDomainsUsedMessage
  | ResetStateMessage
  | RegistrationFormSubmittedMessage
  | GetDiagnosticReportMessage
  | GmailSignInMessage
  | GmailSignOutMessage
  | GmailFetchInboxMessage
  | GmailGetMessageMessage
  | GmailGetStatusMessage
  | GmailSearchMessage
  | GmailListLabelsMessage
  | DownloadTrainingDataMessage;

// Response union type
export type ExtensionResponse =
  | GenerateEmailResponse
  | GetCurrentEmailResponse
  | CheckInboxResponse
  | ReadEmailResponse
  | GetEmailHistoryResponse
  | GeneratePasswordResponse
  | GetPasswordHistoryResponse
  | GetIdentityResponse
  | GenerateIdentityResponse
  | ExtractOTPResponse
  | GetLastOTPResponse
  | DetectFormsResponse
  | GetSettingsResponse
  | ClassifyFieldResponse
  | AnalyzeDOMResponse
  | DiagnosticReportResponse
  | GmailSignInResponse
  | GmailFetchInboxResponse
  | GmailGetMessageResponse
  | GmailGetStatusResponse
  | GmailListLabelsResponse
  | { success: boolean; health?: unknown[]; error?: string }
  | { success: boolean; isFresh?: boolean; error?: string }
  | { success: boolean; error?: string };

// Message sender info
export interface MessageSender {
  tabId?: number;
  frameId?: number;
  url?: string;
  origin?: string;
}

// Message handler type
export type MessageHandler<T extends BaseMessage, R> = (
  message: T,
  sender: MessageSender
) => Promise<R>;
