/* eslint-disable no-console */
/**
 * GhostFill Debug Console Utility
 *
 * This module captures all console errors and allows you to dump them
 * for sharing with developers.
 *
 * HOW TO USE:
 * 1. Open Chrome DevTools (F12) on any page
 * 2. Look at the Console tab
 * 3. All errors will be captured
 * 4. Type: dumpGhostFillErrors() to get all captured errors
 * 5. Type: clearGhostFillErrors() to clear the error history
 */

interface CapturedError {
  timestamp: Date;
  message: string;
  stack: string;
  source: 'error' | 'warn' | 'info' | 'log';
  context: string;
}

interface GhostFillDebugGlobal {
  __GHOSTFILL_ERRORS__?: CapturedError[];
  __GHOSTFILL_IS_DEBUG_MODE__?: boolean;
  dumpGhostFillErrors?: () => CapturedError[];
  clearGhostFillErrors?: () => void;
  ghostfillDebug?: {
    enable: () => void;
    disable: () => void;
    isEnabled: () => boolean;
    getErrors: () => CapturedError[];
    getStats: () => { total: number; errors: number; warnings: number };
    printFormatted: () => void;
  };
}

(function initializeDebugConsole(): void {
  const global = window as unknown as GhostFillDebugGlobal;

  // Initialize error storage
  if (!global.__GHOSTFILL_ERRORS__) {
    global.__GHOSTFILL_ERRORS__ = [];
  }

  // Keep original console methods
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalLog = console.log.bind(console);

  // Maximum errors to store
  const MAX_ERRORS = 500;

  // Capture function
  function captureError(args: unknown[], source: CapturedError['source'], context?: string): void {
    const errorData: unknown[] = Array.from(args).map((arg: unknown) => {
      if (arg instanceof Error) {
        return {
          message: arg.message,
          stack: arg.stack,
        };
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    });

    const stackData = errorData.find((d) => typeof d === 'object' && d !== null && 'stack' in d) as
      | { stack?: string }
      | undefined;

    const error: CapturedError = {
      timestamp: new Date(),
      message: errorData.join(' '),
      stack: stackData?.stack || '',
      source,
      context: context || '',
    };

    // Add to storage
    global.__GHOSTFILL_ERRORS__!.push(error);

    // Keep only last MAX_ERRORS
    if (global.__GHOSTFILL_ERRORS__!.length > MAX_ERRORS) {
      global.__GHOSTFILL_ERRORS__!.splice(0, global.__GHOSTFILL_ERRORS__!.length - MAX_ERRORS);
    }

    // Also log to console with formatting
    const isoTime = error.timestamp.toISOString();
    const timestamp = isoTime.split('T')[1]?.slice(0, 12) || '';
    const prefix = context ? `[${context}]` : '[GhostFill]';

    if (source === 'error') {
      originalError(`🔴 ${timestamp} ${prefix} ${error.message}`);
    } else if (source === 'warn') {
      originalWarn(`🟡 ${timestamp} ${prefix} ${error.message}`);
    } else {
      originalLog(`🔵 ${timestamp} ${prefix} ${error.message}`);
    }
  }

  // Override console methods to capture errors and warnings ONLY
  const originalCaptureError = captureError;
  console.error = function (...args: unknown[]): void {
    originalCaptureError(args, 'error');
    originalError.apply(console, args);
  };

  console.warn = function (...args: unknown[]): void {
    originalCaptureError(args, 'warn');
    originalWarn.apply(console, args);
  };

  // Don't capture log/info - only errors and warnings

  // Catch unhandled errors
  window.addEventListener('error', (event: ErrorEvent) => {
    originalCaptureError(
      [event.message, event.filename + ':' + event.lineno + ':' + event.colno],
      'error',
      'UNHANDLED'
    );
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    originalCaptureError(
      ['Unhandled Promise Rejection:', event.reason],
      'error',
      'UNHANDLED_PROMISE'
    );
  });

  // Global functions to dump/clear errors
  global.dumpGhostFillErrors = function (): CapturedError[] {
    const errors = global.__GHOSTFILL_ERRORS__ || [];

    console.log(
      '%c═══════════════════════════════════════════════════════════════',
      'color: #6366F1; font-weight: bold'
    );
    console.log('%c📋 GHOSTFILL ERROR DUMP', 'color: #6366F1; font-weight: bold; font-size: 14px');
    console.log(`%cTotal Errors Captured: ${errors.length}`, 'color: #6366F1');
    console.log(
      '%c═══════════════════════════════════════════════════════════════',
      'color: #6366F1; font-weight: bold'
    );

    errors.forEach((err: CapturedError, index: number) => {
      const icon = err.source === 'error' ? '🔴' : err.source === 'warn' ? '🟡' : '🔵';
      const time = err.timestamp.toISOString();

      console.log(`%c\n${icon} [${index + 1}] ${time}`, 'color: #10B981; font-weight: bold');
      console.log(`   Message: ${err.message}`);
      if (err.context) {
        console.log(`   Context: ${err.context}`);
      }
      if (err.stack) {
        console.log(`   Stack: ${err.stack.split('\n').slice(0, 3).join('\n   ')}`);
      }
    });

    console.log(
      '%c═══════════════════════════════════════════════════════════════\n',
      'color: #6366F1; font-weight: bold'
    );

    return errors;
  };

  global.clearGhostFillErrors = function (): void {
    global.__GHOSTFILL_ERRORS__ = [];
    console.log('%c✅ GhostFill error history cleared', 'color: #10B981; font-weight: bold');
  };

  // Enhanced debug object
  global.ghostfillDebug = {
    enable: (): void => {
      global.__GHOSTFILL_IS_DEBUG_MODE__ = true;
      console.log(
        '%c✅ GhostFill Debug Mode ENABLED',
        'color: #10B981; font-weight: bold; background: #ECFDF5; padding: 4px 8px; border-radius: 4px'
      );
    },
    disable: (): void => {
      global.__GHOSTFILL_IS_DEBUG_MODE__ = false;
      console.log(
        '%c🔴 GhostFill Debug Mode DISABLED',
        'color: #EF4444; font-weight: bold; background: #FEF2F2; padding: 4px 8px; border-radius: 4px'
      );
    },
    isEnabled: (): boolean => global.__GHOSTFILL_IS_DEBUG_MODE__ || false,
    getErrors: (): CapturedError[] => global.__GHOSTFILL_ERRORS__ || [],
    getStats: (): { total: number; errors: number; warnings: number } => {
      const errors = global.__GHOSTFILL_ERRORS__ || [];
      return {
        total: errors.length,
        errors: errors.filter((e: CapturedError) => e.source === 'error').length,
        warnings: errors.filter((e: CapturedError) => e.source === 'warn').length,
      };
    },
    printFormatted: (): void => {
      const stats = global.ghostfillDebug!.getStats();

      console.log('%c', 'line-height: 1.5');
      console.log(
        '%c╔════════════════════════════════════════════════════════════╗',
        'color: #6366F1'
      );
      console.log(
        '%c║  🧟 GHOSTFILL DEBUG CONSOLE                           ║',
        'color: #6366F1; font-weight: bold'
      );
      console.log(
        '%c╠════════════════════════════════════════════════════════════╣',
        'color: #6366F1'
      );
      console.log(
        `%c║  Total Errors: ${String(stats.total).padEnd(10)} Total Warnings: ${String(stats.warnings).padEnd(10)}   ║`,
        'color: #6366F1'
      );
      console.log(
        '%c╠════════════════════════════════════════════════════════════╣',
        'color: #6366F1'
      );
      console.log(
        '%c║  COMMANDS:                                              ║',
        'color: #6366F1'
      );
      console.log(
        '%c║  • dumpGhostFillErrors()    - Show all captured errors  ║',
        'color: #10B981'
      );
      console.log('%c║  • clearGhostFillErrors()  - Clear error history      ║', 'color: #10B981');
      console.log('%c║  • ghostfillDebug.enable()  - Enable debug mode        ║', 'color: #10B981');
      console.log('%c║  • ghostfillDebug.disable() - Disable debug mode       ║', 'color: #10B981');
      console.log(
        '%c╚════════════════════════════════════════════════════════════╝',
        'color: #6366F1'
      );
      console.log('');
    },
  };

  // Print welcome message
  console.log('%c╔════════════════════════════════════════════════════════════╗', 'color: #6366F1');
  console.log(
    '%c║  🧟 GhostFill Debug Console Ready                        ║',
    'color: #6366F1; font-weight: bold; font-size: 12px'
  );
  console.log('%c╠════════════════════════════════════════════════════════════╣', 'color: #6366F1');
  console.log('%c║  Type these commands in the console:                     ║', 'color: #6366F1');
  console.log('%c║                                                          ║', 'color: #6366F1');
  console.log(
    '%c║  📋 dumpGhostFillErrors()   - View all captured errors  ║',
    'color: #10B981; font-weight: bold'
  );
  console.log('%c║  🗑️  clearGhostFillErrors()  - Clear error history        ║', 'color: #10B981');
  console.log('%c║  📊 ghostfillDebug.printFormatted() - Show stats         ║', 'color: #10B981');
  console.log('%c╚════════════════════════════════════════════════════════════╝', 'color: #6366F1');

  // Auto-print stats on load
  setTimeout(() => {
    global.ghostfillDebug?.printFormatted();
  }, 1000);
})();
