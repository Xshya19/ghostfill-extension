/**
 * Core Utilities & Helpers (GhostFill)
 * Single consolidated source of truth for environment-agnostic and DOM helper utilities.
 */

import { createLogger } from './logger';

const log = createLogger('Core');

// ─── Cryptographic & Randomness Utilities ────────────────────────────

/**
 * Generate a cryptographically secure random number between 0 (inclusive) and 1 (exclusive)
 */
export function secureMathRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${secureMathRandom().toString(36).substring(2, 11)}`;
}

/**
 * Generate a cryptographically secure random string of specified length
 */
export function generateRandomString(length: number, charset: string): string {
  if (charset.length <= 1) {
    return charset.repeat(length);
  }
  const limit = Math.floor(0x100000000 / charset.length) * charset.length;
  const array = new Uint32Array(length);
  let result = '';
  let offset = 0;

  while (offset < length) {
    crypto.getRandomValues(array);
    for (let i = 0; i < array.length && offset < length; i++) {
      if (array[i]! < limit) {
        result += charset[array[i]! % charset.length];
        offset++;
      }
    }
  }
  return result;
}

// ─── Object & Data Utilities ─────────────────────────────────────────

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge objects deeply with prototype pollution protection
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (dangerousKeys.includes(key)) {
        log.warn('Blocked prototype pollution attempt', key);
        continue;
      }
      const targetValue = result[key as keyof T];
      const sourceValue = source[key as keyof T];

      if (isObject(targetValue) && isObject(sourceValue)) {
        result[key as keyof T] = deepMerge(
          targetValue as object,
          sourceValue as object
        ) as T[keyof T];
      } else if (sourceValue !== undefined) {
        result[key as keyof T] = sourceValue as T[keyof T];
      }
    }
  }
  return result;
}

// ─── Promise & Timing Utilities ──────────────────────────────────────

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelay * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Wraps a promise with a timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Retries a function with exponential backoff (alias/alternative pattern).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fn();
      if (res === null) {
        throw new Error('Operation returned null');
      }
      if (res && typeof res === 'object' && 'error' in res) {
        throw new Error(String((res as any).error));
      }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const delay = baseDelay * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Max retries reached');
}

// ─── Formatters & Strings ────────────────────────────────────────────

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0) {
    return 'just now';
  }
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) {
    return 'just now';
  }
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return formatDate(timestamp);
  }
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  if (seconds > 10) {
    return `${seconds}s ago`;
  }
  return 'just now';
}

export function formatDate(timestamp: number | string | Date): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(timestamp: number | string | Date): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(timestamp: number | string | Date): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) {
    return singular;
  }
  return plural || singular + 's';
}

export function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str || '';
  }
  return str.substring(0, maxLength - 3) + '...';
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, '');
}

export function formatPasswordStrength(score: number): string {
  if (score < 20) return 'Very Weak';
  if (score < 40) return 'Weak';
  if (score < 60) return 'Fair';
  if (score < 80) return 'Strong';
  return 'Very Strong';
}

export function formatCrackTime(seconds: number): string {
  if (seconds < 1) return 'instant';
  if (seconds < 60) return `${Math.floor(seconds)} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months`;
  if (seconds < 3153600000) return `${Math.floor(seconds / 31536000)} years`;
  if (seconds < 3153600000000) return `${Math.floor(seconds / 3153600000)} centuries`;
  return 'forever';
}

export function formatEmailDisplay(email: string, maxLength: number = 30): string {
  if (email.length <= maxLength) {
    return email;
  }
  const [local, domain] = email.split('@');
  if (!domain) {
    return email.substring(0, maxLength) + '...';
  }
  const availableForLocal = maxLength - domain.length - 4;
  if (availableForLocal < 3) {
    return email.substring(0, maxLength - 3) + '...';
  }
  return local!.substring(0, availableForLocal) + '...@' + domain;
}

export function formatOTP(otp: string): string {
  if (/^\d{6}$/.test(otp)) {
    return otp.substring(0, 3) + ' ' + otp.substring(3);
  }
  if (/^\d{8}$/.test(otp)) {
    return otp.substring(0, 4) + ' ' + otp.substring(4);
  }
  return otp;
}

export function formatDomain(domain: string): string {
  return domain.replace(/^www\./i, '');
}

export function maskPassword(password: string, showFirst: number = 2, showLast: number = 2): string {
  if (password.length <= showFirst + showLast + 2) {
    return '•'.repeat(password.length);
  }
  const first = password.substring(0, showFirst);
  const last = password.substring(password.length - showLast);
  const middle = '•'.repeat(Math.min(password.length - showFirst - showLast, 8));
  return first + middle + last;
}

export function formatEntropy(entropy: number): string {
  return `${Math.round(entropy)} bits`;
}

// ─── Domain & URL Utilities ──────────────────────────────────────────

const COMMON_SECOND_LEVEL_TLDS = new Set<string>([
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tr', 'com.tw', 'com.sg',
  'org.uk', 'ac.uk', 'gov.uk', 'ne.jp', 'or.jp',
]);

export function isIpLiteral(s: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s) || /^\[.*\]$/.test(s);
}

export function rootDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIpLiteral(host)) {
    return host;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }
  const lastTwo = parts.slice(-2).join('.');
  const tld = parts.slice(-2).join('.');
  if (COMMON_SECOND_LEVEL_TLDS.has(tld) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function isSubdomainOf(hostname: string, root: string): boolean {
  if (!hostname || !root) {
    return false;
  }
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const r = root.toLowerCase().replace(/\.$/, '');
  if (h === r) {
    return true;
  }
  return h.endsWith('.' + r);
}

export function sameRootDomain(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return rootDomain(a) === rootDomain(b);
}

export function extractEmailAddress(from: string): string {
  if (!from || typeof from !== 'string') {
    return '';
  }
  const angle = from.match(/<([^>]+@[^>]+)>/);
  if (angle && angle[1]) {
    return angle[1].trim().toLowerCase();
  }
  const bare = from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return bare && bare[0] ? bare[0].toLowerCase() : '';
}

export function emailHost(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) {
    return '';
  }
  return email.slice(at + 1).toLowerCase();
}

export function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

// ─── Network & Email Utilities ───────────────────────────────────────

export function parseEmail(email: string): { login: string; domain: string } | null {
  const match = email.match(/^([^@]+)@(.+)$/);
  if (!match) {
    return null;
  }
  return { login: match[1]!, domain: match[2]! };
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function fetchWithTimeout(
  resource: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 15000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(id);
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    options.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(id);
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ─── DOM Helper Utilities ────────────────────────────────────────────

export function getUniqueSelector(element: Element): string {
  if (!element) {
    return '';
  }
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-cy');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }
  if (element.hasAttribute('name')) {
    const name = element.getAttribute('name');
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    }
  }
  if (element.hasAttribute('role')) {
    const role = element.getAttribute('role');
    if (role) {
      return `${element.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`;
    }
  }

  const parts: string[] = [];
  let current: Element | null = element;

  const dynamicClassPatterns = [
    /^_?[a-z]{1,3}[0-9a-f]{4,}$/i,
    /^[a-z]{1,2}-[0-9a-f]{4,}$/i,
    /^css-[0-9a-f]+$/i,
    /^_?jsx?-?/i,
    /^_?emotion-/i,
    /^sc-/i,
    /^v-/i,
    /^ng-/i,
    /^svelte-[a-z0-9]+$/i,
    /^chakra-/i,
    /^Mui/i,
    /^ant-/i,
    /^el-/i,
    /^_?radix-/i,
  ];

  const isDynamicClass = (className: string): boolean => {
    return dynamicClassPatterns.some((pattern) => pattern.test(className));
  };

  while (current && current !== document.body && current.parentElement) {
    let part = current.tagName.toLowerCase();
    if (current.className && typeof current.className === 'string') {
      const classes = current.className
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => !isDynamicClass(c))
        .slice(0, 2);

      if (classes.length > 0) {
        part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      }
    }

    const siblings = current.parentElement?.children;
    if (siblings && siblings.length > 1) {
      const sameTagSiblings = Array.from(siblings).filter(
        (sib) => sib.tagName === current!.tagName
      );
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        part += `:nth-of-type(${index})`;
      } else {
        const index = Array.from(siblings).indexOf(current) + 1;
        part += `:nth-child(${index})`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }

  if (parts.length === 0 || (parts.length === 1 && parts[0] === element.tagName.toLowerCase())) {
    return buildAbsolutePathSelector(element);
  }
  return parts.join(' > ');
}

function buildAbsolutePathSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && current.parentElement) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement?.children;
    if (siblings && siblings.length > 1) {
      const index = Array.from(siblings).indexOf(current) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
    } else {
      parts.unshift(tag);
    }
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

export function getElementLabel(input: HTMLInputElement | HTMLTextAreaElement): string {
  if (input.id) {
    try {
      const label = document.querySelector(
        `label[for="${CSS.escape(input.id).replace(/"/g, '\\"')}"]`
      );
      if (label) {
        return label.textContent?.trim() || '';
      }
    } catch {
      // ignore
    }
  }
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent?.replace(input.value, '').trim() || '';
  }
  if (input.ariaLabel) {
    return input.ariaLabel;
  }
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return labelElement.textContent?.trim() || '';
    }
  }
  if (input.placeholder) {
    return input.placeholder;
  }
  const prevSibling = input.previousElementSibling;
  if (prevSibling && prevSibling.textContent) {
    return prevSibling.textContent.trim();
  }
  return '';
}

const MAX_SHADOW_DEPTH = 10;
const MAX_SHADOW_SCAN_ELEMENTS = 5000;
const shadowRootCache = new WeakMap<Element, ShadowRoot>();
let shadowObserver: MutationObserver | null = null;

function initShadowObserver(): void {
  if (shadowObserver || typeof MutationObserver === 'undefined' || !document.body) {
    return;
  }
  shadowObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (node instanceof HTMLElement && node.shadowRoot) {
          shadowRootCache.set(node, node.shadowRoot);
        }
      }
    }
  });
  shadowObserver.observe(document.body, { childList: true, subtree: true });
}

export function deepQuerySelectorAll<T extends Element>(
  selector: string,
  root: Document | Element | ShadowRoot = document,
  depth: number = 0
): T[] {
  if (depth > MAX_SHADOW_DEPTH) {
    return [];
  }
  initShadowObserver();
  const results: T[] = [];
  try {
    results.push(...Array.from(root.querySelectorAll<T>(selector)));
  } catch {
    // ignore
  }

  try {
    const treeRoot =
      root instanceof Document ? root.documentElement : (root as Element | ShadowRoot);
    if (!treeRoot) {
      return results;
    }
    const walker = document.createTreeWalker(treeRoot, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node: Node): number {
        return (node as Element).shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let node: Node | null;
    let count = 0;
    while ((node = walker.nextNode()) && count < MAX_SHADOW_SCAN_ELEMENTS) {
      count++;
      const el = node as Element;
      let shadow = shadowRootCache.get(el);
      if (!shadow && el.shadowRoot) {
        shadow = el.shadowRoot;
        shadowRootCache.set(el, shadow);
      }
      if (shadow) {
        try {
          results.push(...deepQuerySelectorAll<T>(selector, shadow, depth + 1));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return results;
}

export function openSafeUrl(url: string): void {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      log.warn(`Blocked unsafe URL protocol attempt: ${parsed.protocol}`);
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: parsed.toString(), active: true });
    } else {
      window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    }
  } catch (e) {
    log.error('Invalid URL passed to openSafeUrl', e);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }
  if (document.visibilityState === 'visible' && typeof document.execCommand === 'function') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        return true;
      }
    } catch (e) {
      log.warn('Fallback copy failed, trying async API', e);
    }
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch (err) {
    log.error('Failed to copy to clipboard', err);
    return false;
  }
}

// ─── Type Guards Consolidation ───────────────────────────────────────

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= min && value <= max;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isEmailAccount(value: unknown): value is {
  fullEmail: string;
  domain: string;
  createdAt: number;
  expiresAt: number;
  service: string;
} {
  return (
    isObject(value) &&
    isNonEmptyString(value.fullEmail) &&
    value.fullEmail.includes('@') &&
    typeof value.domain === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.expiresAt === 'number' &&
    typeof value.service === 'string'
  );
}

export function isSuccessResponse(value: unknown): value is { success: true; [key: string]: unknown } {
  return isObject(value) && value.success === true;
}

export function isErrorResponse(value: unknown): value is { success: false; error?: string } {
  return isObject(value) && value.success === false;
}

export function isStorageChange(value: unknown): value is { newValue?: unknown; oldValue?: unknown } {
  return isObject(value) && ('newValue' in value || 'oldValue' in value);
}

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NetworkError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class StorageError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'STORAGE_ERROR', details);
    this.name = 'StorageError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class PermissionError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'PERMISSION_ERROR', details);
    this.name = 'PermissionError';
  }
}

export function handleError(error: unknown, context?: string): AppError {
  const contextStr = context ? ` [${context}]` : '';

  if (error instanceof AppError) {
    log.error(`${error.name}${contextStr}: ${error.message}`, error.details);
    return error;
  }

  if (error instanceof Error) {
    log.error(`Error${contextStr}: ${error.message}`, { stack: error.stack });
    return new AppError(error.message, 'UNKNOWN_ERROR', { originalError: error });
  }

  log.error(`Unknown error${contextStr}`, error);
  return new AppError('An unknown error occurred', 'UNKNOWN_ERROR', error);
}

export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: string
): (...args: Parameters<T>) => Promise<ReturnType<T> | undefined> {
  return async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
    try {
      return (await fn(...args)) as ReturnType<T>;
    } catch (error) {
      handleError(error, context);
      return undefined;
    }
  };
}

export function tryCatch<T>(fn: () => T, fallback: T, context?: string): T {
  try {
    return fn();
  } catch (error) {
    handleError(error, context);
    return fallback;
  }
}

export function safeJsonParse<T>(json: string, fallback?: T): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback !== undefined ? fallback : null;
  }
}

export function assert(
  condition: boolean,
  message: string,
  code: string = 'ASSERTION_ERROR'
): asserts condition {
  if (!condition) {
    throw new AppError(message, code);
  }
}

export function assertDefined<T>(value: T | null | undefined, message = 'Value is null or undefined'): asserts value is T {
  if (value === null || value === undefined) {
    throw new AppError(message, 'ASSERTION_ERROR');
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

export function toErrorResponse(
  error: unknown,
  context?: string
): { success: false; error: string } {
  const message = getErrorMessage(error);
  if (context) {
    log.error(`[${context}] ${message}`);
  }
  return { success: false, error: message };
}

export function toSuccessResponse<T>(
  data?: T
): { success: true } & (T extends undefined ? Record<string, never> : T) {
  if (data === undefined) {
    return { success: true } as { success: true } & (T extends undefined
      ? Record<string, never>
      : T);
  }
  return { success: true, ...data } as { success: true } & (T extends undefined
    ? Record<string, never>
    : T);
}

export function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

// ─── O(1) LRU Cache Consolidation ────────────────────────────────────

export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  utilization: number;
}

export class LRUCache<K extends string, V> {
  private readonly cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  getStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: this.cache.size / this.maxSize,
    };
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

// ─── Extractors Consolidation ────────────────────────────────────────

export function extractOTP(text: string): string | null {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  const otpKeywords = [
    'verification code', 'verify code', 'security code', 'confirmation code',
    'authentication code', 'one time', 'one-time', 'otp', 'passcode',
    'code is', 'code:', 'pin is', 'pin:', 'your code', 'the code',
    'enter code', 'use code', 'type code', 'input code', 'login code',
    'sign in code', 'access code', '2fa code', 'password reset',
    'recovery code', 'code to verify', 'code for',
  ];
  const antiPatterns = [
    { name: 'year', regex: /^(?:19|20)\d{2}$/ },
    { name: 'price-currency', regex: /^[$€£¥₹]/ },
    { name: 'ip-address', regex: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/ },
    { name: 'css-hex', regex: /^#[0-9a-f]{3,8}$/i },
    { name: 'css-value', regex: /^\d+(?:px|em|rem|pt|%)$/ },
    { name: 'date', regex: /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/ },
    { name: 'time', regex: /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i },
    { name: 'phone', regex: /^[+]?\d[\d\s()-]{9,14}$/ },
    { name: 'repeated', regex: /^(\d)\1{3,}$/ },
    { name: 'all-zeros', regex: /^0+$/ },
  ];

  if (!otpKeywords.some((k) => lowerText.includes(k))) {
    return null;
  }

  const numberRegex = /\b(\d{4,8})\b/g;
  const candidates: Array<{ value: string; index: number; context: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = numberRegex.exec(text)) !== null) {
    const value = match[1];
    const index = match.index;
    const contextStart = Math.max(0, index - 80);
    const contextEnd = Math.min(text.length, index! + value!.length + 80);
    const context = text.substring(contextStart, contextEnd).toLowerCase();
    candidates.push({ value: value!, index: index!, context });
  }

  if (candidates.length === 0) return null;

  const scoredCandidates = candidates
    .filter(({ value, context }) => {
      for (const anti of antiPatterns) {
        if (anti.regex.test(value)) return false;
      }
      if (/[$€£¥₹]|price|cost|total|amount|fee|usd|eur/i.test(context)) return false;
      if (/(?:order|tracking|shipment|package|delivery|fedex|ups|usps|dhl)\s*(?:#|number|no)/i.test(context)) return false;
      if (/(?:reference|ref|ticket|case|invoice|receipt|transaction)\s*(?:#|number|no|id)/i.test(context)) return false;
      if (/(?:account|acct|member|customer|user|client)\s*(?:#|number|no|id)/i.test(context)) return false;
      if (/(?:zip|postal|area)\s*(?:code)?/i.test(context)) return false;
      return true;
    })
    .map(({ value, index, context }) => {
      let score = 50;
      for (const keyword of otpKeywords) {
        if (context.includes(keyword)) {
          score += 15;
          break;
        }
      }
      if (/(?:enter|use|type|input|provide|submit|copy|paste)/i.test(context)) score += 10;
      if (/(?:valid for|expires? in|good for|active for|\d+\s*(?:min|hour))/i.test(context)) score += 8;
      if (/(?:do not share|don't share|never share|confidential)/i.test(context)) score += 8;
      if (value.length === 6) score += 5;
      if (/(?:unsubscribe|privacy policy|terms|copyright|footer)/i.test(context)) score -= 20;
      return { value, score, index };
    })
    .filter((c) => c.score >= 60)
    .sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) return null;
  return scoredCandidates[0]!.value;
}

export function extractActivationLink(text: string): string | null {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  const knownProviderDomains = [
    'google.com', 'gmail.com', 'accounts.google.com', 'microsoft.com',
    'live.com', 'outlook.com', 'account.microsoft.com', 'apple.com',
    'icloud.com', 'appleid.apple.com', 'amazon.com', 'amazonaws.com',
    'github.com', 'gitlab.com', 'facebook.com', 'facebookmail.com',
    'meta.com', 'twitter.com', 'x.com', 'linkedin.com', 'slack.com',
    'discord.com', 'notion.so', 'vercel.com', 'netlify.com',
    'stripe.com', 'shopify.com', 'auth0.com', 'okta.com', 'onelogin.com',
  ];
  const tokenParamPatterns = [
    '[?&]t=', '[?&]token=', '[?&]key=', '[?&]code=', '[?&]auth=',
    '[?&]access_token=', '[?&]id_token=', '[?&]verification=',
    '[?&]verify=', '[?&]confirm=', '[?&]activation=', '[?&]activate=',
    '[?&]v=', '[?&]hash=', '[?&]sig=', '[?&]signature=', '[?&]uuid=',
    '[?&]uid=', '[?&]user=', '[?&]flow=', '[?&]oobcode=', '[?&]continue=',
  ];
  const verificationKeywords = [
    'verify', 'confirm', 'activate', 'token', 'auth', 'click',
    'register', 'validate', 'approve', 'accept', 'complete',
    'signup', 'signup', 'sign-in', 'login', 'log-in',
    'password-reset', 'email-verify', 'account-verify', 'two-factor', '2fa',
  ];

  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const allUrls: Array<{ url: string; score: number }> = [];
  let urlMatch: RegExpExecArray | null;

  while ((urlMatch = urlRegex.exec(text)) !== null) {
    const url = urlMatch[0];
    const lowerUrl = url.toLowerCase();
    let score = 50;

    for (const keyword of verificationKeywords) {
      if (lowerUrl.includes(keyword)) {
        score += 25;
        break;
      }
    }
    for (const pattern of tokenParamPatterns) {
      if (lowerUrl.includes(pattern)) {
        score += 20;
        for (const domain of knownProviderDomains) {
          if (lowerUrl.includes(domain)) {
            score += 15;
            break;
          }
        }
        break;
      }
    }
    for (const domain of knownProviderDomains) {
      if (lowerUrl.includes(domain)) {
        score += 10;
        break;
      }
    }
    if (
      lowerText.includes('verify') || lowerText.includes('confirm') ||
      lowerText.includes('activate') || lowerText.includes('welcome')
    ) {
      score += 10;
    }
    if (/(?:unsubscribe|preferences|settings|profile|dashboard|home|index)/i.test(lowerUrl)) {
      score -= 30;
    }
    if (/(?:\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|\/images?\/|\/assets?\/)/i.test(lowerUrl)) {
      score -= 25;
    }
    if (/(?:tracking|analytics|pixel|beacon|click-tracker)/i.test(lowerUrl)) {
      score -= 30;
    }
    allUrls.push({ url, score });
  }

  if (allUrls.length === 0) return null;

  const candidates = allUrls.filter((u) => u.score >= 60);
  if (candidates.length === 0) {
    if (
      lowerText.includes('verify') || lowerText.includes('confirm') ||
      lowerText.includes('click') || lowerText.includes('activate')
    ) {
      for (const { url } of allUrls) {
        const hasTokenParam = tokenParamPatterns.some((p) => url.toLowerCase().includes(p));
        const hasQueryParam = /[?&][a-z]+=[a-z0-9_-]+/i.test(url);
        if (hasTokenParam || (hasQueryParam && url.length > 30)) {
          return url;
        }
      }
    }
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.url;
}

// ─── Application Constants ───────────────────────────────────────────

export const APP_NAME = 'GhostFill';
export const APP_VERSION = '1.1.0';

export const API = {
  TEMP_MAIL: {
    BASE_URL: 'https://api.1secmail.com/api/v1/',
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
} as const;

export const TEMP_MAIL_DOMAINS = [
  '1secmail.com',
  '1secmail.net',
  '1secmail.org',
  'kzccv.com',
  'qiott.com',
  'wuuvo.com',
  'icznn.com',
  'yeggq.com',
  'wqmvq.com', // fallback
];

export const TIMING = {
  EMAIL_CHECK_INTERVAL_MS: 5000,
  EMAIL_EXPIRY_HOURS: 1,
  OTP_EXPIRY_MINUTES: 5,
  CLIPBOARD_CLEAR_SECONDS: 30,
  NOTIFICATION_DURATION_MS: 5000,
  FLOATING_BUTTON_HIDE_MS: 8000,
  DEBOUNCE_DELAY_MS: 300,
  ANIMATION_DURATION_MS: 200,
  OTP_NEW_THRESHOLD_MS: 120000,
  COPY_CONFIRMATION_MS: 2500,
  HUB_POLL_INTERVAL_MS: 5000,
  INBOX_POLL_INTERVAL_MS: 30000,
} as const;

export const UI = {
  POPUP_WIDTH: 400,
  POPUP_HEIGHT: 520,
  FLOATING_BUTTON_SIZE: 32,
  FLOATING_BUTTON_OFFSET: 12,
  MAX_HISTORY_ITEMS: 50,
  MAX_INBOX_EMAILS: 20,
  PASSWORD_MIN_LENGTH: 4,
  PASSWORD_MAX_LENGTH: 128,
  DEFAULT_PASSWORD_LENGTH: 16,
} as const;

export const STORAGE_KEYS = {
  CURRENT_EMAIL: 'currentEmail',
  LAST_OTP: 'lastOTP',
  EMAIL_HISTORY: 'emailHistory',
  PASSWORD_HISTORY: 'passwordHistory',
  INBOX: 'inbox',
  SETTINGS: 'settings',
  BEHAVIOR_DATA: 'behaviorData',
} as const;

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

export const SHORTCUTS = {
  OPEN_POPUP: 'Ctrl+Shift+E',
  GENERATE_EMAIL: 'Ctrl+Shift+M',
  GENERATE_PASSWORD: 'Ctrl+Shift+G',
  AUTO_FILL: 'Ctrl+Shift+F',
} as const;

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

export const SUCCESS = {
  EMAIL_GENERATED: 'New email generated!',
  PASSWORD_GENERATED: 'Password generated!',
  OTP_COPIED: 'OTP copied to clipboard!',
  EMAIL_COPIED: 'Email copied to clipboard!',
  PASSWORD_COPIED: 'Password copied to clipboard!',
  AUTOFILL_COMPLETE: 'Form auto-filled successfully!',
  SETTINGS_SAVED: 'Settings saved!',
} as const;

// ─── Gmail OAuth Configurations ──────────────────────────────────────

function getBundledGmailClientId(): string {
  try {
    return chrome.runtime.getManifest().oauth2?.client_id?.trim() ?? '';
  } catch {
    return '';
  }
}

export const GMAIL_CLIENT_ID = getBundledGmailClientId();

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
export const OAUTH_TOKEN_INFO = 'https://oauth2.googleapis.com/tokeninfo';
export const OAUTH_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';

