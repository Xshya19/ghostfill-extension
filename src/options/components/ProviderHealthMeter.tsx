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
    let isMounted = true;
    
    const fetchHealth = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'GET_PROVIDER_HEALTH' }, (res) => {
          if (!isMounted) {return;}
          if (res && res.success && Array.isArray(res.health)) {
            setHealthData(res.health);
          }
          setLoading(false);
        });
      }
    };

    fetchHealth();
    // Refresh every 10 seconds while tab is open
    const interval = setInterval(() => {
      if (document.hidden) { return; }
      fetchHealth();
    }, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return <div className="provider-health-meter">Loading provider health...</div>;
  }

  if (healthData.length === 0) {
    return null;
  }

  return (
    <div className="provider-health-meter">
      <h4 className="health-title">Provider Health</h4>
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
                <span className="health-percent">
                  {Math.round(h.successRate * 100)}%
                </span>
                <div
                  className={`health-dot ${statusClass}`}
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
