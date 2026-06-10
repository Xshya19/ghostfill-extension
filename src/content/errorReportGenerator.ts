/* eslint-disable no-console */
/**
 * GhostFill - Shareable Error Report Generator
 *
 * This module adds commands to easily generate and copy error reports.
 *
 * HOW TO USE IN CONSOLE:
 * 1. Open Chrome DevTools (F12)
 * 2. Go to Console tab
 * 3. Type: copyGhostFillReport() to copy all errors
 * 4. Paste it in chat to share with developers!
 */

interface CapturedError {
  timestamp: Date;
  message: string;
  stack: string;
  source: 'error' | 'warn' | 'info' | 'log';
  context: string;
}

export function generateErrorReport(errors: CapturedError[]): string {
  let report = `GHOSTFILL ERROR REPORT
${'='.repeat(50)}
Generated: ${new Date().toISOString()}
Total Errors: ${errors.length}

ERRORS:
${'='.repeat(50)}
`;

  errors.forEach((err: CapturedError, i: number) => {
    const stackLines = err.stack
      ? '\nStack:\n' +
        err.stack
          .split('\n')
          .slice(0, 5)
          .map((l: string) => '  ' + l)
          .join('\n')
      : '';

    report += `
[${i + 1}] ${err.timestamp.toISOString()}
Type: ${err.source.toUpperCase()}
Context: ${err.context || 'N/A'}
Message: ${err.message}${stackLines}
${'-'.repeat(50)}
`;
  });

  return report;
}

// Error report generation only — do NOT expose functions on window to prevent information disclosure
// Use debugConsole.ts's __GHOSTFILL_ERRORS__ and ghostfillDebug API instead.
