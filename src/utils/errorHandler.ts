// Error Handler

import { createLogger } from './logger';

const log = createLogger('ErrorHandler');

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

/**
 * Handle errors gracefully
 */
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

/**
 * Wrap async function with error handling
 */
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

/**
 * Try-catch wrapper for sync functions
 */
export function tryCatch<T>(fn: () => T, fallback: T, context?: string): T {
  try {
    return fn();
  } catch (error) {
    handleError(error, context);
    return fallback;
  }
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Assert condition or throw
 */
export function assert(
  condition: boolean,
  message: string,
  code: string = 'ASSERTION_ERROR'
): asserts condition {
  if (!condition) {
    throw new AppError(message, code);
  }
}

/**
 * Extract error message from unknown error type
 */
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

/**
 * Create a standardized error response for message handlers
 */
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

/**
 * Create a standardized success response for message handlers
 */
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
