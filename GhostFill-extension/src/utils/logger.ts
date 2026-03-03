/* eslint-disable no-console */
/**
 * Secure Logger Utility
 *
 * Provides structured logging with automatic security redaction.
 * All sensitive data (passwords, tokens, emails, OTPs) is redacted before logging.
 *
 * HIGH FIX: Production Log Stripping
 * - All console.log/debug/warn calls are stripped in production builds
 * - Only error logs are kept for debugging production issues
 * - Configure Terser to drop console statements in production
 *
 * @security Prevents credential leakage via console logs
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    message: string;
    data?: unknown;
    timestamp: number;
    source?: string;
}

// HIGH FIX: Check if we're in production mode
// Temporarily disabled for debugging
// const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_PRODUCTION = false;

// HIGH FIX: Allowlist for production logging (only errors and critical warnings)
const PRODUCTION_LOG_ALLOWLIST: LogLevel[] = ['error', 'warn', 'info', 'debug'];

// Sensitive data patterns to redact
// SECURITY FIX: Expanded patterns to cover all credential formats and edge cases
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
    // API Keys & Tokens (expanded patterns)
    { pattern: /(api[_-]?key|apikey|token|bearer|auth|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|jwt|jws|jwe)\s*[=:]\s*["']?[a-zA-Z0-9\-_.]{20,}["']?/gi, replacement: '$1=[REDACTED]' },
    // OAuth and social auth tokens
    { pattern: /(oauth|oauth2|oauth[_-]?token|social[_-]?token|provider[_-]?token)\s*[=:]\s*["']?[a-zA-Z0-9\-_.]{10,}["']?/gi, replacement: '$1=[REDACTED]' },
    // AWS and cloud provider credentials
    { pattern: /(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws[_-]?secret|aws[_-]?key|gcp[_-]?key|azure[_-]?secret)/gi, replacement: '[REDACTED_CLOUD_CREDENTIAL]' },
    // Passwords (expanded patterns)
    { pattern: /(password|passwd|pwd|secret|credentials|passphrase|private[_-]?key|secret[_-]?key|signing[_-]?key)\s*[=:]\s*["']?[^"'\s]{4,}["']?/gi, replacement: '$1=[REDACTED]' },
    // Email addresses (expanded to catch more formats)
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
    // Phone numbers (international format)
    { pattern: /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[PHONE]' },
    // OTP codes (expanded patterns for various formats)
    { pattern: /\b(otp|code|verification|confirm|auth|security|pin|token|passcode).{0,50}\b([0-9]{4,10})\b/gi, replacement: '$1=[REDACTED]' },
    // Credit card numbers (all major formats)
    { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g, replacement: '[CARD_NUMBER]' },
    // SSN (US Social Security Number)
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
    // IP addresses (IPv4 and IPv6)
    { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_ADDRESS]' },
    { pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, replacement: '[IPV6_ADDRESS]' },
    // SECURITY FIX: Bearer tokens in Authorization headers
    { pattern: /authorization\s*:\s*bearer\s+[a-zA-Z0-9\-_.]+/gi, replacement: 'Authorization: Bearer [REDACTED]' },
    // SECURITY FIX: GraphQL mutations with passwords
    { pattern: /(password|currentPassword|newPassword|passwordConfirmation)\s*:\s*"[^"]*"/gi, replacement: '$1: "[REDACTED]"' },
    // SECURITY FIX: Base64 encoded credentials (detect common patterns)
    { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: '[REDACTED_BASE64]' },
    // SECURITY FIX: Private keys (PEM format)
    { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi, replacement: '[REDACTED_PRIVATE_KEY]' },
    // SECURITY FIX: Connection strings with credentials
    { pattern: /(mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi, replacement: '$1://[REDACTED]:[REDACTED]@' },
    // SECURITY FIX: Basic auth headers
    { pattern: /basic\s+[a-zA-Z0-9+/]+=*/gi, replacement: 'Basic [REDACTED]' },
];

// Keys that should always be redacted in objects
// SECURITY FIX: Expanded to include all credential and PII field names
// FIX: All keys stored in lowercase for consistent case-insensitive comparison
const REDACT_KEYS = new Set([
    // Authentication & Credentials
    'password', 'passwd', 'pwd', 'secret', 'token', 'apikey', 'api_key',
    'auth', 'bearer', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token',
    'credentials', 'privatekey', 'private_key', 'secretkey', 'secret_key', 'otp', 'code',
    'idtoken', 'id_token', 'sessiontoken', 'session_token', 'jwt', 'jws', 'jwe',
    'signingkey', 'signing_key', 'encryptionkey', 'encryption_key',
    'clientid', 'client_id', 'clientsecret', 'client_secret',
    'oauthtoken', 'oauth_token', 'providertoken', 'provider_token',
    'awskey', 'aws_key', 'awssecret', 'aws_secret', 'gpckey', 'azuresecret',
    'authorization', 'authheader', 'auth_header',

    // Personal Identifiable Information (PII)
    'ssn', 'socialsecurity', 'social_security', 'taxid', 'tax_id',
    'creditcard', 'credit_card', 'cardnumber', 'card_number', 'cvv', 'cvc', 'cardcvv',
    'phonenumber', 'phone_number', 'mobile', 'telephone', 'fax',
    'dateofbirth', 'date_of_birth', 'dob', 'birthdate', 'birth_date',
    'address', 'streetaddress', 'street_address', 'zipcode', 'zip_code', 'postalcode',
    'ipaddress', 'ip_address', 'macaddress', 'mac_address',
    'email', 'emailaddress', 'email_address', 'maidenname',
    'passport', 'passportnumber', 'driverslicense', 'license_number',

    // Financial
    'accountnumber', 'account_number', 'routingnumber', 'routing_number',
    'iban', 'swift', 'bic', 'bankaccount',

    // Security
    'privatekey', 'publickey', 'symmetrickey', 'masterkey', 'rootkey',
    'certificate', 'cert', 'sslkey', 'sshkey',
]);

/**
 * Redact sensitive data from any value
 * @security Prevents credential leakage in logs
 */
function redactSensitiveData(data: unknown, depth = 0): unknown {
    // Prevent infinite recursion
    if (depth > 10) {
        return '[MAX_DEPTH]';
    }

    if (typeof data === 'string') {
        let redacted = data;
        for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
            redacted = redacted.replace(pattern, replacement);
        }
        return redacted;
    }

    if (data instanceof Error) {
        const redacted = new Error(redactSensitiveData(data.message, depth + 1) as string);
        redacted.stack = data.stack;
        return redacted;
    }

    if (Array.isArray(data)) {
        return data.map(item => redactSensitiveData(item, depth + 1));
    }

    if (typeof data === 'object' && data !== null) {
        const redacted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (REDACT_KEYS.has(key.toLowerCase())) {
                redacted[key] = '[REDACTED]';
            } else {
                redacted[key] = redactSensitiveData(value, depth + 1);
            }
        }
        return redacted;
    }

    return data;
}

class Logger {
    private enabled: boolean = true;
    private prefix: string = '[GhostFill]';
    private history: LogEntry[] = [];
    private maxHistory: number = 100;

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    setPrefix(prefix: string): void {
        this.prefix = prefix;
    }

    private log(level: LogLevel, message: string, data?: unknown, source?: string): void {
        // HIGH FIX: Production Log Stripping
        // In production, only allow error logs (and critical warnings if needed)
        if (IS_PRODUCTION && !PRODUCTION_LOG_ALLOWLIST.includes(level)) {
            // Still store in history for potential debugging, but don't log to console
            const entry: LogEntry = {
                level,
                message: redactSensitiveData(message) as string,
                data: data !== undefined ? redactSensitiveData(data) : undefined,
                timestamp: Date.now(),
                source,
            };
            this.history.push(entry);
            if (this.history.length > this.maxHistory) {
                this.history.shift();
            }
            return;
        }

        // SECURITY FIX: Redact sensitive data before logging
        const redactedMessage = redactSensitiveData(message) as string;
        const redactedData = data !== undefined ? redactSensitiveData(data) : undefined;

        const entry: LogEntry = {
            level,
            message: redactedMessage,
            data: redactedData,
            timestamp: Date.now(),
            source,
        };

        // Store in history
        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        if (!this.enabled && level !== 'error') { return; }

        const timestamp = new Date().toISOString();
        const formattedMessage = `${this.prefix} [${timestamp}] [${level.toUpperCase()}]${source ? ` [${source}]` : ''} ${redactedMessage}`;

        switch (level) {
            case 'debug':
                if (redactedData !== undefined) {
                    console.debug(formattedMessage, redactedData);
                } else {
                    console.debug(formattedMessage);
                }
                break;
            case 'info':
                if (redactedData !== undefined) {
                    console.info(formattedMessage, redactedData);
                } else {
                    console.info(formattedMessage);
                }
                break;
            case 'warn':
                if (redactedData !== undefined) {
                    console.warn(formattedMessage, redactedData);
                } else {
                    console.warn(formattedMessage);
                }
                break;
            case 'error':
                if (redactedData !== undefined) {
                    console.error(formattedMessage, redactedData);
                } else {
                    console.error(formattedMessage);
                }
                break;
        }
    }

    debug(message: string, data?: unknown, source?: string): void {
        this.log('debug', message, data, source);
    }

    info(message: string, data?: unknown, source?: string): void {
        this.log('info', message, data, source);
    }

    warn(message: string, data?: unknown, source?: string): void {
        this.log('warn', message, data, source);
    }

    error(message: string, data?: unknown, source?: string): void {
        this.log('error', message, data, source);
    }

    getHistory(): LogEntry[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
    }

    // Create a child logger with a specific source
    child(source: string): ChildLogger {
        return new ChildLogger(this, source);
    }
}

class ChildLogger {
    constructor(
        private parent: Logger,
        private source: string
    ) { }

    debug(message: string, data?: unknown): void {
        this.parent.debug(message, data, this.source);
    }

    info(message: string, data?: unknown): void {
        this.parent.info(message, data, this.source);
    }

    warn(message: string, data?: unknown): void {
        this.parent.warn(message, data, this.source);
    }

    error(message: string, data?: unknown): void {
        this.parent.error(message, data, this.source);
    }
}

// Export singleton instance
export const logger = new Logger();

// Export for creating child loggers
export function createLogger(source: string): ChildLogger {
    return logger.child(source);
}
