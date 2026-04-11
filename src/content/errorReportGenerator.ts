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

function generateReport(errors: CapturedError[]): string {
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

// Add to window for browser console access
if (typeof window !== 'undefined') {
  const ghostWindow = window as Window & {
    generateGhostFillReport: typeof generateReport;
    copyGhostFillReport: () => void;
    __GHOSTFILL_ERRORS__?: CapturedError[];
  };

  ghostWindow.generateGhostFillReport = generateReport;

  ghostWindow.copyGhostFillReport = function (): void {
    const errors = ghostWindow.__GHOSTFILL_ERRORS__ || [];
    const report = generateReport(errors);

    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(report)
        .then(() => {
          console.log(
            '%c✅ GhostFill Error Report copied to clipboard!',
            'color: #10B981; font-weight: bold; font-size: 14px'
          );
          console.log('%c📋 Paste it anywhere to share with developers.', 'color: #6366F1');
        })
        .catch(() => {
          console.log(
            '%c❌ Failed to copy. Please copy manually from above.',
            'color: #EF4444; font-weight: bold'
          );
          console.log(report);
        });
    } else {
      console.log(report);
    }
  };

  console.log('%c╔════════════════════════════════════════════════════════════╗', 'color: #6366F1');
  console.log(
    '%c║  📋 GHOSTFILL REPORT GENERATOR                          ║',
    'color: #6366F1; font-weight: bold'
  );
  console.log('%c╠════════════════════════════════════════════════════════════╣', 'color: #6366F1');
  console.log('%c║                                                            ║', 'color: #6366F1');
  console.log('%c║  To generate a shareable report, type:                  ║', 'color: #6366F1');
  console.log('%c║                                                            ║', 'color: #6366F1');
  console.log(
    '%c║  📋 copyGhostFillReport()  - Copy report to clipboard   ║',
    'color: #10B981; font-weight: bold'
  );
  console.log('%c║                                                            ║', 'color: #6366F1');
  console.log('%c║  Then paste it in chat to share with developer!          ║', 'color: #10B981');
  console.log('%c║                                                            ║', 'color: #6366F1');
  console.log('%c╚════════════════════════════════════════════════════════════╝', 'color: #6366F1');
}
