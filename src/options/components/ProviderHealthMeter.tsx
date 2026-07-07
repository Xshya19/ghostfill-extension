import React, { useState, useEffect } from 'react';

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchHealth = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: 'GET_PROVIDER_HEALTH' }, (res) => {
            if (!isMounted) {
              return;
            }
            if (chrome.runtime.lastError) {
              setError(chrome.runtime.lastError.message ?? 'Unable to reach service worker');
              setHealthData([]);
            } else if (res && res.success && Array.isArray(res.health)) {
              setHealthData(res.health);
              setError(null);
            } else {
              setError('No provider data returned');
            }
            setLoading(false);
          });
        } catch (e) {
          if (!isMounted) {
            return;
          }
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      } else {
        setError('Service worker unavailable');
        setLoading(false);
      }
    };

    fetchHealth();
    // Refresh every 10 seconds while tab is open
    const interval = setInterval(() => {
      if (document.hidden) {
        return;
      }
      fetchHealth();
    }, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="provider-health-meter" aria-busy="true">
        <h4 className="health-title">{t('providerHealthTitle')}</h4>
        <div className="health-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="health-pill-card">
              <span className="about-skeleton-row" style={{ width: '60%' }} />
              <span className="about-skeleton-row" style={{ width: '30%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && healthData.length === 0) {
    return (
      <div className="provider-health-meter">
        <h4 className="health-title">{t('providerHealthTitle')}</h4>
        <div
          className="field-error"
          style={{
            padding: '10px 12px',
            background: 'rgba(var(--gf-coral-rgb), 0.08)',
            border: '1px solid rgba(var(--gf-coral-rgb), 0.25)',
            borderRadius: '8px',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (healthData.length === 0) {
    return null;
  }

  return (
    <div className="provider-health-meter">
      <h4 className="health-title">{t('providerHealthTitle')}</h4>
      <div className="health-grid">
        {healthData.map((h) => {
          const isWarning = h.successRate <= 0.7 && h.successRate > 0 && !h.circuitOpen;
          const isDead = h.circuitOpen || h.successRate === 0;

          let statusClass = 'health-status-good';
          if (isWarning) {
            statusClass = 'health-status-warning';
          }
          if (isDead) {
            statusClass = 'health-status-dead';
          }

          return (
            <div key={h.name} className="health-pill-card">
              <span className="health-provider-name">{h.name}</span>
              <div className="health-status-group">
                <span className="health-percent">{Math.round(h.successRate * 100)}%</span>
                <div
                  className={`health-dot ${statusClass}`}
                  title={`Response: ${Math.round(h.avgResponseTime)}ms | Failures: ${h.consecutiveFailures}`}
                  aria-label={
                    isDead
                      ? 'Provider is offline'
                      : isWarning
                        ? 'Provider is degraded'
                        : 'Provider is healthy'
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
