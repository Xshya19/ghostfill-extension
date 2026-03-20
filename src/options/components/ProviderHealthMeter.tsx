import React, { useState, useEffect } from 'react';

// Minimal interface based on backend type
interface ProviderHealthStatus {
  name: string;
  successRate: number;
  consecutiveFailures: number;
  avgResponseTime: number;
  circuitOpen: boolean;
}

export const ProviderHealthMeter: React.FC = () => {
  const [healthData, setHealthData] = useState<ProviderHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'GET_PROVIDER_HEALTH' }, (res) => {
          if (res && res.success && Array.isArray(res.health)) {
            setHealthData(res.health);
          }
          setLoading(false);
        });
      }
    };

    fetchHealth();
    // Refresh every 10 seconds while tab is open
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="provider-health-meter">Loading provider health...</div>;
  }

  if (healthData.length === 0) {
    return null;
  }

  return (
    <div
      className="provider-health-meter"
      style={{
        marginTop: '12px',
        fontSize: '13px',
        borderTop: '1px solid var(--border-color)',
        paddingTop: '12px',
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Provider Health</h4>
      <div
        style={{
          display: 'grid',
          gap: '8px',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        }}
      >
        {healthData.map((h) => {
          const isWarning = h.successRate <= 0.7 && h.successRate > 0 && !h.circuitOpen;
          const isDead = h.circuitOpen || h.successRate === 0;

          let statusColor = 'var(--success-color, #10b981)';
          if (isWarning) {
            statusColor = 'var(--warning-color, #f59e0b)';
          }
          if (isDead) {
            statusColor = 'var(--error-color, #ef4444)';
          }

          return (
            <div
              key={h.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
              }}
            >
              <span style={{ fontWeight: 500 }}>{h.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {Math.round(h.successRate * 100)}%
                </span>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: statusColor,
                    boxShadow: `0 0 4px ${statusColor}80`,
                  }}
                  title={`Response: ${Math.round(h.avgResponseTime)}ms | Failures: ${h.consecutiveFailures}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
