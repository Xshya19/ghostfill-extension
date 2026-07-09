/* eslint-disable no-console */
/**
 * Consolidated Logger Utility - GhostFill
 *
 * Provides:
 * 1. Structured Logging with sensitive data redaction (Logger / ChildLogger / createLogger)
 * 2. Developer Remote Logging (initRemoteLogger)
 * 3. Ring-Buffer Diagnostic Logging (diag)
 *
 * @security Prevents credential leakage via console logs and intercepts console calls securely.
 */

// ─── Logger & Redaction Types ────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: number;
  source?: string;
}

type LoggerGlobal = typeof globalThis & {
  __GHOSTFILL_LOG_HISTORY__?: LogEntry[];
  dumpGhostFillLogs?: () => Promise<LogEntry[]>;
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PRODUCTION_LOG_ALLOWLIST: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const PERSISTED_LOG_KEY = 'ghostfill_debug_logs';

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /(api[_-]?key|apikey|token|bearer|auth|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|jwt|jws|jwe)\s*[=:]\s*["']?[a-zA-Z0-9\-_.]{20,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
  {
    pattern: /(oauth|oauth2|oauth[_-]?token|social[_-]?token|provider[_-]?token)\s*[=:]\s*["']?[a-zA-Z0-9\-_.]{10,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
  {
    pattern: /(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws[_-]?secret|aws[_-]?key|gcp[_-]?key|azure[_-]?secret)/gi,
    replacement: '[REDACTED_CLOUD_CREDENTIAL]',
  },
  {
    pattern: /(password|passwd|pwd|secret|credentials|passphrase|private[_-]?key|secret[_-]?key|signing[_-]?key)\s*[=:]\s*["']?[^"'\s]{4,}["']?/gi,
    replacement: '$1=[REDACTED]',
  },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { pattern: /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[PHONE]' },
  {
    pattern: /\b(otp|code|verification|confirm|auth|security|pin|token|passcode).{0,50}\b([0-9]{4,10})\b/gi,
    replacement: '$2=[REDACTED]',
  },
  {
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    replacement: '[CARD_NUMBER]',
  },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_ADDRESS]' },
  { pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, replacement: '[IPV6_ADDRESS]' },
  {
    pattern: /authorization\s*:\s*bearer\s+[a-zA-Z0-9\-_.]+/gi,
    replacement: 'Authorization: Bearer [REDACTED]',
  },
  {
    pattern: /(password|currentPassword|newPassword|passwordConfirmation)\s*:\s*"[^"]*"/gi,
    replacement: '$1: "[REDACTED]"',
  },
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: '[REDACTED_BASE64]' },
  {
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /(mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi,
    replacement: '$1://[REDACTED]:[REDACTED]@',
  },
  { pattern: /basic\s+[a-zA-Z0-9+/]+=*/gi, replacement: 'Basic [REDACTED]' },
];

const REDACT_KEYS = new Set([
  'password', 'passwd', 'pwd', 'secret', 'token', 'apikey', 'api_key', 'auth',
  'bearer', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token',
  'credentials', 'privatekey', 'private_key', 'secretkey', 'secret_key', 'otp',
  'code', 'idtoken', 'id_token', 'sessiontoken', 'session_token', 'jwt', 'jws',
  'jwe', 'signingkey', 'signing_key', 'encryptionkey', 'encryption_key', 'clientid',
  'client_id', 'clientsecret', 'client_secret', 'oauthtoken', 'oauth_token',
  'providertoken', 'provider_token', 'awskey', 'aws_key', 'awssecret', 'aws_secret',
  'gpckey', 'azuresecret', 'authorization', 'authheader', 'auth_header',
  'ssn', 'socialsecurity', 'social_security', 'taxid', 'tax_id', 'creditcard',
  'credit_card', 'cardnumber', 'card_number', 'cvv', 'cvc', 'cardcvv', 'phonenumber',
  'phone_number', 'mobile', 'telephone', 'fax', 'dateofbirth', 'date_of_birth',
  'dob', 'birthdate', 'birth_date', 'address', 'streetaddress', 'street_address',
  'zipcode', 'zip_code', 'postalcode', 'ipaddress', 'ip_address', 'macaddress',
  'mac_address', 'email', 'emailaddress', 'email_address', 'maidenname', 'passport',
  'passportnumber', 'driverslicense', 'license_number', 'accountnumber', 'account_number',
  'routingnumber', 'routing_number', 'iban', 'swift', 'bic', 'bankaccount',
  'privatekey', 'publickey', 'symmetrickey', 'masterkey', 'rootkey', 'certificate',
  'cert', 'sslkey', 'sshkey',
]);

function redactSensitiveData(data: unknown, depth = 0): unknown {
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
    if (data.stack) {
      redacted.stack = data.stack;
    }
    return redacted;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, depth + 1));
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

// ─── Logger Class ────────────────────────────────────────────────────

class Logger {
  private enabled: boolean = true;
  private prefix: string = '[GhostFill]';
  private history: LogEntry[] = [];
  private maxHistory: number = 100;
  private isPersisting = false;
  private hasPendingPersist = false;

  constructor() {
    this.installGlobalDebugHelpers();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  private log(level: LogLevel, message: string, data?: unknown, source?: string): void {
    if (IS_PRODUCTION && !PRODUCTION_LOG_ALLOWLIST.includes(level)) {
      const entry: LogEntry = {
        level,
        message: redactSensitiveData(message) as string,
        timestamp: Date.now(),
      };
      if (data !== undefined) {
        entry.data = redactSensitiveData(data);
      }
      if (source) {
        entry.source = source;
      }
      this.history.push(entry);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      this.syncGlobalHistory();
      this.persistHistory();
      return;
    }

    const redactedMessage = redactSensitiveData(message) as string;
    const redactedData = data !== undefined ? redactSensitiveData(data) : undefined;

    const entry: LogEntry = {
      level,
      message: redactedMessage,
      timestamp: Date.now(),
    };
    if (redactedData !== undefined) {
      entry.data = redactedData;
    }
    if (source) {
      entry.source = source;
    }

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.syncGlobalHistory();
    this.persistHistory();

    if (!this.enabled && level !== 'error') {
      return;
    }

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

  async getPersistedHistory(): Promise<LogEntry[]> {
    if (typeof chrome === 'undefined') {
      return this.getHistory();
    }

    try {
      if (chrome.storage?.session) {
        const sessionData = await chrome.storage.session.get(PERSISTED_LOG_KEY);
        const sessionLogs = sessionData?.[PERSISTED_LOG_KEY];
        if (Array.isArray(sessionLogs) && sessionLogs.length > 0) {
          return sessionLogs as LogEntry[];
        }
      }
    } catch {
      // ignore
    }

    return this.getHistory();
  }

  clearHistory(): void {
    this.history = [];
    this.syncGlobalHistory();
    if (typeof chrome !== 'undefined') {
      try {
        if (chrome.storage?.session) {
          void chrome.storage.session.remove(PERSISTED_LOG_KEY);
        }
      } catch {
        // ignore
      }
    }
  }

  private syncGlobalHistory(): void {
    const globalScope = globalThis as LoggerGlobal;
    globalScope.__GHOSTFILL_LOG_HISTORY__ = this.getHistory();
  }

  private persistHistory(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      return;
    }

    if (this.isPersisting) {
      this.hasPendingPersist = true;
      return;
    }

    this.isPersisting = true;
    this.hasPendingPersist = false;

    const performPersist = async () => {
      const snapshot = this.getHistory();
      try {
        await chrome.storage.session.set({ [PERSISTED_LOG_KEY]: snapshot });
      } catch {
        // ignore
      } finally {
        this.isPersisting = false;
        if (this.hasPendingPersist) {
          this.persistHistory();
        }
      }
    };

    void performPersist();
  }

  private installGlobalDebugHelpers(): void {
    const globalScope = globalThis as LoggerGlobal;
    this.syncGlobalHistory();

    const isExtensionContext = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
    if (!isExtensionContext) {
      return;
    }

    globalScope.dumpGhostFillLogs = async () => {
      const logs = await this.getPersistedHistory();
      console.table(
        logs.map((entry) => ({
          time: new Date(entry.timestamp).toISOString(),
          level: entry.level,
          source: entry.source || '',
          message: entry.message,
        }))
      );
      return logs;
    };
  }

  child(source: string): ChildLogger {
    return new ChildLogger(this, source);
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private source: string
  ) {}

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

export const logger = new Logger();

export function createLogger(source: string): ChildLogger {
  return logger.child(source);
}

// ─── Remote Logger Consolidation ─────────────────────────────────────

type RemoteLoggerConfig = {
  enabled?: boolean;
  url?: string;
};

type RemoteLoggerGlobal = typeof globalThis & {
  __GHOSTFILL_REMOTE_LOGGER__?: RemoteLoggerConfig;
};

let isRemoteLoggerInitialized = false;

function getRemoteLoggerUrl(): string | null {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  const config = (globalThis as RemoteLoggerGlobal).__GHOSTFILL_REMOTE_LOGGER__;
  if (!config?.enabled || !config.url) {
    return null;
  }
  try {
    const parsed = new URL(config.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function initRemoteLogger(sourceName: string): void {
  if (isRemoteLoggerInitialized) {
    return;
  }

  const remoteLoggerUrl = getRemoteLoggerUrl();
  if (!remoteLoggerUrl) {
    return;
  }

  isRemoteLoggerInitialized = true;

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  const serializeArgs = (args: any[]) => {
    return args
      .map((arg) => {
        if (typeof arg === 'object') {
          if (arg instanceof Error) {
            return arg.stack || arg.message;
          }
          try {
            return JSON.stringify(arg, Object.getOwnPropertyNames(arg));
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  };

  const sendLog = (level: string, message: string) => {
    try {
      void fetch(remoteLoggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourceName,
          level,
          message,
        }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  };

  console.log = (...args: any[]) => {
    originalLog.apply(console, args);
    sendLog('LOG', serializeArgs(args));
  };

  console.info = (...args: any[]) => {
    originalInfo.apply(console, args);
    sendLog('INFO', serializeArgs(args));
  };

  console.warn = (...args: any[]) => {
    originalWarn.apply(console, args);
    sendLog('WARN', serializeArgs(args));
  };

  console.error = (...args: any[]) => {
    originalError.apply(console, args);
    sendLog('ERROR', serializeArgs(args));
  };
}

// ─── Diagnostic Logger Consolidation ─────────────────────────────────

export type DiagLevel = 'step' | 'info' | 'warn' | 'error' | 'state' | 'perf';
export type DiagCategory =
  | 'email' | 'otp' | 'sse' | 'polling' | 'messaging' | 'storage' | 'link'
  | 'notification' | 'system' | 'field-fill' | 'detection';

export interface DiagEntry {
  ts: number;
  time: string;
  level: DiagLevel;
  category: DiagCategory;
  flowId: string | null;
  step: number | null;
  action: string;
  detail: string;
  data?: Record<string, unknown>;
  stack?: string;
}

const MAX_DIAG_ENTRIES = 3000;
const diagBuffer: DiagEntry[] = [];
const SHOULD_PRINT_DIAG_TO_CONSOLE = process.env.NODE_ENV !== 'production';

function pushDiag(entry: DiagEntry): void {
  diagBuffer.push(entry);
  if (diagBuffer.length > MAX_DIAG_ENTRIES) {
    diagBuffer.splice(0, diagBuffer.length - MAX_DIAG_ENTRIES);
  }
}

const diagFlowCounters: Record<string, number> = {};

function nextFlowId(category: string): string {
  diagFlowCounters[category] = (diagFlowCounters[category] || 0) + 1;
  return `${category}-${String(diagFlowCounters[category]).padStart(4, '0')}`;
}

function fmtDiagTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().substring(11, 23);
}

export const diag = {
  log(
    level: DiagLevel,
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>,
    flowId?: string | null,
    step?: number | null
  ): string {
    const flow = flowId || null;
    const s = step ?? null;
    const entry: DiagEntry = {
      ts: Date.now(),
      time: fmtDiagTime(Date.now()),
      level,
      category,
      flowId: flow,
      step: s,
      action,
      detail,
    };

    if (data) {
      entry.data = data;
    }

    if (level === 'error' && data?.error instanceof Error) {
      entry.stack = data.error.stack || '';
    }

    pushDiag(entry);

    const prefix = flow ? `[${flow}${s !== null ? `:${s}` : ''}]` : '[diag]';
    const levelIcon =
      level === 'error' ? '🔴' : level === 'warn' ? '🟡' : level === 'state' ? '🔵' : level === 'perf' ? '⚡' : level === 'step' ? '▸' : 'ℹ️';

    const catTag = `[${category.toUpperCase()}]`;
    const msg = `${levelIcon} ${prefix} ${catTag} ${action} — ${detail}`;

    if (SHOULD_PRINT_DIAG_TO_CONSOLE || level === 'error') {
      switch (level) {
        case 'error':
          console.error(`[GhostFill-DIAG] ${msg}`, data);
          break;
        case 'warn':
          console.warn(`[GhostFill-DIAG] ${msg}`, data);
          break;
        case 'perf':
          console.info(`[GhostFill-DIAG] ${msg}`, data);
          break;
        default:
          console.log(`[GhostFill-DIAG] ${msg}`, data ?? '');
      }
    }

    return flow || '';
  },

  startFlow(category: DiagCategory, action: string, detail?: string): string {
    const id = nextFlowId(category);
    diag.log('step', category, `▶ START ${action}`, detail || '', undefined, id, 0);
    return id;
  },

  endFlow(
    flowId: string,
    category: DiagCategory,
    action: string,
    success: boolean,
    detail?: string,
    data?: Record<string, unknown>
  ): void {
    let firstEntry: DiagEntry | undefined;
    let lastEntry: DiagEntry | undefined;
    for (let i = diagBuffer.length - 1; i >= 0; i--) {
      if (diagBuffer[i]!.flowId === flowId) {
        lastEntry = diagBuffer[i];
        break;
      }
    }
    for (const entry of diagBuffer) {
      if (entry.flowId === flowId) {
        firstEntry = entry;
        break;
      }
    }
    const stepNum = lastEntry ? (lastEntry.step ?? 0) + 1 : 1;
    const duration = firstEntry ? Date.now() - firstEntry.ts : 0;
    diag.log(
      success ? 'info' : 'error',
      category,
      `◀ END ${action}`,
      `${success ? '✅ Success' : '❌ Failed'} — ${detail || ''} (${duration}ms)`,
      { ...data, durationMs: duration },
      flowId,
      stepNum
    );
  },

  step(
    flowId: string,
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    let lastEntry: DiagEntry | undefined;
    for (let i = diagBuffer.length - 1; i >= 0; i--) {
      if (diagBuffer[i]!.flowId === flowId) {
        lastEntry = diagBuffer[i];
        break;
      }
    }
    const stepNum = lastEntry ? (lastEntry.step ?? 0) + 1 : 1;
    diag.log('step', category, action, detail, data, flowId, stepNum);
  },

  state(
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    diag.log('state', category, `STATE: ${action}`, detail, data);
  },

  perf(
    category: DiagCategory,
    action: string,
    detail: string,
    data?: Record<string, unknown>
  ): void {
    diag.log('perf', category, `PERF: ${action}`, detail, data);
  },

  getEntries(filter?: {
    category?: DiagCategory;
    level?: DiagLevel;
    flowId?: string;
    lastN?: number;
  }): DiagEntry[] {
    let entries = diagBuffer;
    if (filter?.category) {
      entries = entries.filter((e) => e.category === filter.category);
    }
    if (filter?.level) {
      entries = entries.filter((e) => e.level === filter.level);
    }
    if (filter?.flowId) {
      entries = entries.filter((e) => e.flowId === filter.flowId);
    }
    if (filter?.lastN) {
      entries = entries.slice(-filter.lastN);
    }
    return entries;
  },

  exportReport(): string {
    const lines: string[] = [];
    const now = new Date().toISOString();

    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  GHOSTFILL DIAGNOSTIC REPORT');
    lines.push(`  Generated: ${now}`);
    lines.push(`  Entries: ${diagBuffer.length}`);
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('');

    const errorCount = diagBuffer.filter((e) => e.level === 'error').length;
    const warnCount = diagBuffer.filter((e) => e.level === 'warn').length;
    const flowIds = [...new Set(diagBuffer.filter((e) => e.flowId).map((e) => e.flowId))];

    lines.push(`📊 SUMMARY`);
    lines.push(`   Errors: ${errorCount}`);
    lines.push(`   Warnings: ${warnCount}`);
    lines.push(`   Active flows traced: ${flowIds.length}`);
    lines.push('');

    const errors = diagBuffer.filter((e) => e.level === 'error').slice(-20);
    if (errors.length > 0) {
      lines.push('🔴 RECENT ERRORS (last 20)');
      lines.push('─────────────────────────────────────────────────────');
      for (const e of errors) {
        const flowTag = e.flowId ? `[${e.flowId}${e.step !== null ? `:${e.step}` : ''}]` : '';
        lines.push(`  ${e.time} ${flowTag} [${e.category}] ${e.action}`);
        lines.push(`    ${e.detail}`);
        if (e.stack) {
          lines.push(`    Stack: ${e.stack.split('\n').slice(0, 3).join('\n    ')}`);
        }
        lines.push('');
      }
    }

    const recent = diagBuffer.slice(-200);
    lines.push('📋 RECENT LOG (last 200 entries)');
    lines.push('─────────────────────────────────────────────────────');
    for (const e of recent) {
      const flowTag = e.flowId ? `[${e.flowId}${e.step !== null ? `:${e.step}` : ''}]` : '[--]';
      const icon =
        e.level === 'error' ? '🔴' : e.level === 'warn' ? '🟡' : e.level === 'state' ? '🔵' : e.level === 'perf' ? '⚡' : '  ';
      lines.push(
        `  ${icon} ${e.time} ${flowTag.padEnd(20)} [${e.category.padEnd(14)}] ${e.action} — ${e.detail}`
      );
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  END OF REPORT');
    lines.push('═══════════════════════════════════════════════════════');

    return lines.join('\n');
  },

  printReport(): void {
    const report = diag.exportReport();
    console.log('\n' + report);
  },

  async copyReport(): Promise<void> {
    const report = diag.exportReport();
    try {
      await navigator.clipboard.writeText(report);
      console.log('[GhostFill-DIAG] ✅ Diagnostic report copied to clipboard');
    } catch {
      console.log('[GhostFill-DIAG] ⚠️ Could not copy to clipboard. Report printed below:\n');
      diag.printReport();
    }
  },

  clear(): void {
    diagBuffer.length = 0;
    Object.keys(diagFlowCounters).forEach((k) => {
      diagFlowCounters[k] = 0;
    });
    console.log('[GhostFill-DIAG] 🗑️ Diagnostic buffer cleared');
  },

  get bufferSize(): number {
    return diagBuffer.length;
  },
};

// Register on window for console access
declare global {
  // eslint-disable-next-line no-var
  var __GHOSTFILL_DIAG__: typeof diag | undefined;
}

globalThis.__GHOSTFILL_DIAG__ = diag;

if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).ghostfill = {
    exportLogs: () => diag.printReport(),
    copyLogs: () => void diag.copyReport(),
    clearLogs: () => diag.clear(),
    getLogs: (filter?: Record<string, unknown>) =>
      diag.getEntries(filter as Parameters<typeof diag.getEntries>[0]),
    diag,
  };
}

export default diag;
