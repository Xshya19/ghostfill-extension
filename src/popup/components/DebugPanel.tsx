/* eslint-disable no-console */
import React, { useState, useEffect, useCallback } from 'react';

// Allow CSS custom properties (e.g. "--debug-bg") in inline style objects without `any`.
type StyleWithVars = React.CSSProperties & Record<`--${string}`, string>;

interface CapturedError {
  timestamp: Date;
  message: string;
  stack: string;
  source: 'error' | 'warn' | 'info' | 'log';
  context: string;
}

interface GhostFillDebugGlobal {
  __GHOSTFILL_ERRORS__?: CapturedError[];
  ghostfillDebug?: {
    getErrors: () => CapturedError[];
    getStats: () => { total: number; errors: number; warnings: number };
  };
}

const DebugPanelStyles: React.FC = () => (
  <style>{`
  .gf-debug-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99999;
    color: var(--gf-ink);
    background: var(--debug-bg, var(--gf-yellow));
    border: 2px solid var(--gf-ink);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 800;
    font-family: 'IBM Plex Mono', monospace;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--gf-ink);
    display: flex;
    align-items: center;
    gap: 8px;
    transition: transform 0.1s, box-shadow 0.1s;
  }
  .gf-debug-trigger:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--gf-ink); }
  .gf-debug-trigger:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--gf-ink); }
  
  .gf-debug-panel {
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 99999;
    width: 400px;
    max-height: 500px;
    background: var(--gf-bg);
    border: 2px solid var(--gf-ink);
    border-radius: 12px;
    box-shadow: 6px 6px 0 var(--gf-ink);
    overflow: hidden;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--gf-cream);
  }
  .gf-debug-header {
    background: var(--gf-magenta);
    color: var(--gf-ink);
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--gf-ink);
  }
  .gf-debug-title { font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
  .gf-debug-close {
    background: var(--gf-ink);
    border: 2px solid var(--gf-ink);
    color: var(--gf-magenta);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-weight: 800;
  }
  .gf-debug-stats { padding: 12px; border-bottom: 2px solid var(--gf-ink); background: var(--gf-surface); }
  .gf-debug-stats-row { display: flex; gap: 12px; justify-content: center; font-weight: 700; }
  .gf-debug-actions { padding: 8px; border-bottom: 2px solid var(--gf-ink); display: flex; gap: 8px; }
  .gf-debug-btn {
    flex: 1; padding: 8px; border: 2px solid var(--gf-ink); border-radius: 6px;
    cursor: pointer; font-weight: 800; text-transform: uppercase; font-size: 10px;
    box-shadow: 2px 2px 0 var(--gf-ink); transition: transform 0.1s, box-shadow 0.1s;
  }
  .gf-debug-btn:active { transform: translate(2px, 2px); box-shadow: none; }
  .gf-debug-btn-refresh { background: var(--gf-cyan); color: var(--gf-ink); }
  .gf-debug-btn-copy { background: var(--gf-mint); color: var(--gf-ink); }
  .gf-debug-list { max-height: 300px; overflow-y: auto; padding: 8px; }
  .gf-debug-empty { text-align: center; color: var(--gf-text-dim); padding: 20px; }
  .gf-debug-error {
    padding: 8px; margin-bottom: 8px; border-radius: 6px;
    border: 2px solid var(--gf-ink); box-shadow: 2px 2px 0 var(--gf-ink);
    background: var(--err-bg);
    border-left: 4px solid var(--err-border-color);
  }
  .gf-debug-error-title { font-weight: 800; margin-bottom: 4px; text-transform: uppercase; }
  .gf-debug-error-message { word-break: break-word; color: var(--gf-cream); }
  .gf-debug-error-timestamp { font-size: 10px; color: var(--gf-text-dim); margin-top: 4px; }
`}</style>
);

export const DebugPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [stats, setStats] = useState({ total: 0, errors: 0, warnings: 0 });

  const refreshErrors = useCallback(() => {
    const global = window as unknown as GhostFillDebugGlobal;
    if (global.ghostfillDebug) {
      setErrors(global.ghostfillDebug.getErrors());
      setStats(global.ghostfillDebug.getStats());
    }
  }, []);

  useEffect(() => {
    refreshErrors();
    const interval = setInterval(refreshErrors, 2000);
    return () => clearInterval(interval);
  }, [refreshErrors]);

  const copyReport = useCallback(() => {
    const report = `GHOSTFILL ERROR REPORT
${'='.repeat(50)}
Date: ${new Date().toISOString()}
Total Errors: ${errors.length}
Errors: ${stats.errors}
Warnings: ${stats.warnings}

${errors
  .map(
    (err, i) => `
[${i + 1}] ${err.timestamp.toISOString()}
Type: ${err.source.toUpperCase()}
Context: ${err.context || 'N/A'}
Message: ${err.message}
${err.stack ? 'Stack: ' + err.stack.split('\n').slice(0, 3).join('\n') : ''}
${'-'.repeat(30)}
`
  )
  .join('')}`;

    navigator.clipboard
      .writeText(report)
      .then(() => {
        console.log(
          '%c✅ Error report copied! Paste it here to share.',
          'color: var(--gf-mint); font-weight: bold'
        );
      })
      .catch(() => {
        console.log(
          '%c❌ Failed to copy. Check console (F12)',
          'color: var(--gf-coral); font-weight: bold'
        );
        console.log(report);
      });
  }, [errors, stats]);

  if (!isOpen) {
    return (
      <>
        <button
          className="gf-debug-trigger"
          onClick={() => setIsOpen(true)}
          style={
            {
              '--debug-bg': errors.length > 0 ? 'var(--gf-coral)' : 'var(--gf-magenta)',
            } as StyleWithVars
          }
          title="Debug Panel - Click to view errors"
        >
          🐛 Debug {errors.length > 0 && `(${errors.length})`}
        </button>
        <DebugPanelStyles />
      </>
    );
  }

  return (
    <>
      <div className="gf-debug-panel">
        {/* Header */}
        <div className="gf-debug-header">
          <span className="gf-debug-title">🐛 GhostFill Debug</span>
          <button
            className="gf-debug-close"
            onClick={() => setIsOpen(false)}
            aria-label="Close debug panel"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="gf-debug-stats">
          <div className="gf-debug-stats-row">
            <span className="neon-text-magenta">
              Total: <b>{stats.total}</b>
            </span>
            <span className="neon-text-coral">
              Errors: <b>{stats.errors}</b>
            </span>
            <span className="neon-text-yellow">
              Warnings: <b>{stats.warnings}</b>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="gf-debug-actions">
          <button
            className="gf-debug-btn gf-debug-btn-refresh"
            onClick={refreshErrors}
            aria-label="Refresh error list"
          >
            🔄 Refresh
          </button>
          <button
            className="gf-debug-btn gf-debug-btn-copy"
            onClick={copyReport}
            aria-label="Copy debug report"
          >
            📋 Copy Report
          </button>
        </div>

        {/* Error List */}
        <div className="gf-debug-list">
          {errors.length === 0 ? (
            <div className="gf-debug-empty">✅ No errors captured</div>
          ) : (
            errors
              .slice(-10)
              .reverse()
              .map((err, i) => (
                <div
                  key={`${err.timestamp.getTime()}-${i}`}
                  className="gf-debug-error"
                  style={
                    {
                      '--err-bg':
                        err.source === 'error'
                          ? 'rgba(var(--gf-coral-rgb, 255,122,92), 0.08)'
                          : 'rgba(var(--gf-yellow-rgb, 255,229,92), 0.08)',
                      '--err-border-color':
                        err.source === 'error' ? 'var(--gf-coral)' : 'var(--gf-yellow)',
                    } as StyleWithVars
                  }
                >
                  <div className="gf-debug-error-title">
                    {err.source === 'error' ? '🔴' : '🟡'} {err.context || 'Error'}
                  </div>
                  <div className="gf-debug-error-message">{err.message.slice(0, 100)}</div>
                  <div className="gf-debug-error-timestamp">{err.timestamp.toISOString()}</div>
                </div>
              ))
          )}
        </div>
      </div>
      <DebugPanelStyles />
    </>
  );
};

export default DebugPanel;
