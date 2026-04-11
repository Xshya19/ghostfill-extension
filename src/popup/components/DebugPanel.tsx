/* eslint-disable no-console */
import React, { useState, useEffect, useCallback } from 'react';

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
          'color: #10B981; font-weight: bold'
        );
      })
      .catch(() => {
        console.log(
          '%c❌ Failed to copy. Check console (F12)',
          'color: #EF4444; font-weight: bold'
        );
        console.log(report);
      });
  }, [errors, stats]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 99999,
          background: errors.length > 0 ? '#EF4444' : '#6366F1',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
        title="Debug Panel - Click to view errors"
      >
        🐛 Debug {errors.length > 0 && `(${errors.length})`}
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        zIndex: 99999,
        width: '400px',
        maxHeight: '500px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: '12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
          color: 'white',
          padding: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: '14px' }}>🐛 GhostFill Debug</span>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      {/* Stats */}
      <div style={{ padding: '12px', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <span style={{ color: '#6366F1' }}>
            Total: <b>{stats.total}</b>
          </span>
          <span style={{ color: '#EF4444' }}>
            Errors: <b>{stats.errors}</b>
          </span>
          <span style={{ color: '#F59E0B' }}>
            Warnings: <b>{stats.warnings}</b>
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'flex', gap: '8px' }}>
        <button
          onClick={refreshErrors}
          style={{
            flex: 1,
            padding: '8px',
            background: '#6366F1',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          🔄 Refresh
        </button>
        <button
          onClick={copyReport}
          style={{
            flex: 1,
            padding: '8px',
            background: '#10B981',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          📋 Copy Report
        </button>
      </div>

      {/* Error List */}
      <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '8px' }}>
        {errors.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
            ✅ No errors captured
          </div>
        ) : (
          errors
            .slice(-10)
            .reverse()
            .map((err, i) => (
              <div
                key={i}
                style={{
                  padding: '8px',
                  marginBottom: '8px',
                  background: err.source === 'error' ? '#FEE2E2' : '#FEF3C7',
                  borderRadius: '6px',
                  borderLeft: `4px solid ${err.source === 'error' ? '#EF4444' : '#F59E0B'}`,
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  {err.source === 'error' ? '🔴' : '🟡'} {err.context || 'Error'}
                </div>
                <div style={{ wordBreak: 'break-word' }}>{err.message.slice(0, 100)}</div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                  {err.timestamp.toISOString()}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
};

export default DebugPanel;
