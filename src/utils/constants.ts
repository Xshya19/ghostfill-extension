// Application Constants

export const APP_NAME = 'GhostFill';
export const APP_VERSION = '1.0.15';

// API Endpoints
export const API = {
    TEMP_MAIL: {
        BASE_URL: 'https://www.1secmail.com/api/v1/',
        ENDPOINTS: {
            GEN_RANDOM: 'genRandomMailbox',
            GET_MESSAGES: 'getMessages',
            READ_MESSAGE: 'readMessage',
            GET_DOMAINS: 'getDomainList',
        },
    },
    MAIL_TM: {
        BASE_URL: 'https://api.mail.tm',
        ENDPOINTS: {
            DOMAINS: '/domains',
            ACCOUNTS: '/accounts',
            TOKEN: '/token',
            MESSAGES: '/messages',
        },
    },
    GUERRILLA: {
        BASE_URL: 'https://api.guerrillamail.com/ajax.php',
    },
    MAIL_GW: {
        BASE_URL: 'https://api.mail.gw',
        ENDPOINTS: {
            DOMAINS: '/domains',
            ACCOUNTS: '/accounts',
            TOKEN: '/token',
            MESSAGES: '/messages',
        },
    },
    DROPMAIL: {
        BASE_URL: 'https://dropmail.me',
        GRAPHQL_ENDPOINT: '/graphql',
    },
} as const;

// Available email domains
export const TEMP_MAIL_DOMAINS = [
    '1secmail.com',
    '1secmail.net',
    '1secmail.org',
    'kzccv.com',
    'qiott.com',
    'wuuvo.com',
    'icznn.com',
    'yeggq.com',
];

// Timing constants
export const TIMING = {
    EMAIL_CHECK_INTERVAL_MS: 5000,
    EMAIL_EXPIRY_HOURS: 1,
    OTP_EXPIRY_MINUTES: 5,
    CLIPBOARD_CLEAR_SECONDS: 30,
    NOTIFICATION_DURATION_MS: 5000,
    FLOATING_BUTTON_HIDE_MS: 8000,
    DEBOUNCE_DELAY_MS: 300,
    ANIMATION_DURATION_MS: 200,
    // New constants to eliminate magic numbers
    OTP_NEW_THRESHOLD_MS: 120000, // 2 minutes - OTP considered "new"
    COPY_CONFIRMATION_MS: 2500,   // How long to show copy success
    HUB_POLL_INTERVAL_MS: 5000,   // Hub polling for OTP/inbox
    INBOX_POLL_INTERVAL_MS: 30000, // EmailGenerator inbox polling
} as const;

// UI Constants
export const UI = {
    POPUP_WIDTH: 400,
    POPUP_HEIGHT: 520,
    FLOATING_BUTTON_SIZE: 32, // Match CSS
    FLOATING_BUTTON_OFFSET: 12,
    MAX_HISTORY_ITEMS: 50,
    MAX_INBOX_EMAILS: 20,
    PASSWORD_MIN_LENGTH: 4,
    PASSWORD_MAX_LENGTH: 128,
    DEFAULT_PASSWORD_LENGTH: 16,
} as const;

// Color Palette (Premium Design)
export const COLORS = {
    primary: {
        50: '#EEF2FF',
        100: '#E0E7FF',
        200: '#C7D2FE',
        300: '#A5B4FC',
        400: '#818CF8',
        500: '#6366F1',
        600: '#4F46E5',
        700: '#4338CA',
        800: '#3730A3',
        900: '#312E81',
    },
    secondary: {
        50: '#F5F3FF',
        100: '#EDE9FE',
        200: '#DDD6FE',
        300: '#C4B5FD',
        400: '#A78BFA',
        500: '#8B5CF6',
        600: '#7C3AED',
        700: '#6D28D9',
        800: '#5B21B6',
        900: '#4C1D95',
    },
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
} as const;

// Storage keys
export const STORAGE_KEYS = {
    CURRENT_EMAIL: 'currentEmail',
    LAST_OTP: 'lastOTP',
    EMAIL_HISTORY: 'emailHistory',
    PASSWORD_HISTORY: 'passwordHistory',
    INBOX: 'inbox',
    SETTINGS: 'settings',
    BEHAVIOR_DATA: 'behaviorData',
} as const;

// Context menu IDs
export const CONTEXT_MENU_IDS = {
    PARENT: 'ghostfill',
    GENERATE_EMAIL: 'generate-email',
    GENERATE_EMAIL_QUICK: 'generate-email-quick',
    GENERATE_EMAIL_1SECMAIL: 'generate-email-1secmail',
    GENERATE_EMAIL_MAILTM: 'generate-email-mailtm',
    GENERATE_EMAIL_CUSTOM: 'generate-email-custom',
    GENERATE_PASSWORD: 'generate-password',
    GENERATE_PASSWORD_STANDARD: 'generate-password-standard',
    GENERATE_PASSWORD_STRONG: 'generate-password-strong',
    GENERATE_PASSWORD_PIN: 'generate-password-pin',
    GENERATE_PASSWORD_PASSPHRASE: 'generate-password-passphrase',
    CHECK_INBOX: 'check-inbox',
    LAST_OTP: 'last-otp',
    SEPARATOR_1: 'sep-1',
    SMART_AUTOFILL: 'smart-autofill',
    FILL_EMAIL: 'fill-email',
    FILL_PASSWORD: 'fill-password',
    SEPARATOR_2: 'sep-2',
    HISTORY: 'history',
    SETTINGS: 'settings',
} as const;

// Keyboard shortcuts
export const SHORTCUTS = {
    OPEN_POPUP: 'Ctrl+Shift+E',
    GENERATE_EMAIL: 'Ctrl+Shift+M',
    GENERATE_PASSWORD: 'Ctrl+Shift+P',
    AUTO_FILL: 'Ctrl+Shift+F',
} as const;

// Regular expressions for OTP detection
export const OTP_REGEX = {
    STANDARD: /(?:code|otp|pin|verification|confirm)[:\s]*(\d{4,8})/gi,
    NATURAL: /(?:your\s+(?:verification\s+)?code\s+is\s*)(\d{4,8})/gi,
    SUFFIX: /(\d{4,8})\s*(?:is\s+your|code)/gi,
    SPACED: /\b(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)\b/g,
    ALPHANUMERIC: /\b([A-Z0-9]{6,10})\b/g,
    STANDALONE: /\b(\d{4,8})\b/g,
} as const;

// Error messages
export const ERRORS = {
    NETWORK_ERROR: 'Network error. Please check your connection.',
    EMAIL_GENERATION_FAILED: 'Failed to generate email. Please try again.',
    INBOX_CHECK_FAILED: 'Failed to check inbox. Please try again.',
    PASSWORD_GENERATION_FAILED: 'Failed to generate password.',
    OTP_NOT_FOUND: 'No OTP found in the email.',
    STORAGE_ERROR: 'Failed to save data. Storage may be full.',
    PERMISSION_DENIED: 'Permission denied for this operation.',
    INVALID_INPUT: 'Invalid input provided.',
} as const;

// Success messages
export const SUCCESS = {
    EMAIL_GENERATED: 'New email generated!',
    PASSWORD_GENERATED: 'Password generated!',
    OTP_COPIED: 'OTP copied to clipboard!',
    EMAIL_COPIED: 'Email copied to clipboard!',
    PASSWORD_COPIED: 'Password copied to clipboard!',
    AUTOFILL_COMPLETE: 'Form auto-filled successfully!',
    SETTINGS_SAVED: 'Settings saved!',
} as const;
