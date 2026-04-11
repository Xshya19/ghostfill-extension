import React, { useRef } from 'react';

import { UserSettings, DEFAULT_SETTINGS } from '../../../types/storage.types';
import { createLogger } from '../../../utils/logger';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

const log = createLogger('AdvancedTab');

interface AdvancedTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
  sessionSecrets: { customDomainKey: string; llmApiKey: string };
  onSessionSecretChange: (key: 'customDomainKey' | 'llmApiKey', value: string) => void;
  onReset: () => void;
  onClearData: () => void;
  onSettingsImport: (imported: UserSettings) => void;
  onError?: (msg: string) => void;
}

const AdvancedTab: React.FC<AdvancedTabProps> = ({
  settings,
  onSettingChange,
  onReset,
  onClearData,
  onSettingsImport,
  onError,
  sessionSecrets,
  onSessionSecretChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghostfill-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      log.error('Export failed:', err);
    }
  };

  const handleExportMLData = () => {
    chrome.storage.local.get(['ghostfill_training_data'], (res) => {
      const data = res.ghostfill_training_data || [];
      if (data.length === 0) {
        // eslint-disable-next-line no-alert
        alert('No training data collected yet. Right-click editable fields on any website and report misclassifications to collect data.');
        return;
      }
      try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ghostfill_user_data.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        log.error('Export ML Data failed:', err);
      }
    });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);

        // Validate incoming JSON strictly against DEFAULT_SETTINGS keys and types
        const merged: UserSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const k = key as keyof UserSettings;
          if (k in parsed) {
            const expectedType = typeof DEFAULT_SETTINGS[k];
            const actualType = parsed[k] === null ? 'null' : Array.isArray(parsed[k]) ? 'array' : typeof parsed[k];
            // Allow array-to-array and object-to-object matches
            const typeMatches = actualType === expectedType ||
              (expectedType === 'object' && (actualType === 'object' || actualType === 'array'));
            if (typeMatches) {
              if (k === 'passwordDefaults' && typeof parsed[k] === 'object') {
                merged[k] = { ...DEFAULT_SETTINGS.passwordDefaults, ...parsed[k] };
              } else {
                (merged as any)[k] = parsed[k];
              }
            }
          }
        }

        onSettingsImport(merged);
      } catch (err) {
        log.error('Import failed:', err);
        if (onError) {
          onError('Invalid settings file. Please select a valid GhostFill settings JSON.');
        } else {
          // eslint-disable-next-line no-alert
          alert('Invalid settings file. Please select a valid GhostFill settings JSON.');
        }
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div role="tabpanel" id="tabpanel-advanced" aria-labelledby="tab-advanced">
      <SettingsSection id="developer" title="Developer" icon="🛠️">
        <div className="setting-item">
          <div className="setting-info">
            <label id="debug-mode-label">Debug Mode</label>
            <p>Enable verbose console logging for troubleshooting</p>
          </div>
          <ToggleSwitch
            checked={settings.debugMode}
            onChange={(checked) => onSettingChange('debugMode', checked)}
            ariaLabel="Debug mode"
            ariaLabelledBy="debug-mode-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="backup" title="Backup & Restore" icon="💾">
        <div className="setting-item">
          <div className="setting-info">
            <label>Export Settings</label>
            <p>Download your current settings as a JSON file</p>
          </div>
          <button className="premium-btn premium-btn-secondary" type="button" onClick={handleExport}>
            Export
          </button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="import-settings">Import Settings</label>
            <p>Load settings from a previously exported JSON file</p>
          </div>
          <label className="premium-btn premium-btn-secondary import-btn" tabIndex={0} role="button">
            Import
            <input
              ref={fileInputRef}
              id="import-settings"
              type="file"
              accept=".json"
              onChange={handleImport}
              className="sr-only"
            />
          </label>
        </div>
      </SettingsSection>
      
      <SettingsSection id="ai-machine-learning" title="AI & Machine Learning" icon="🤖">
        <div className="setting-item vertical-group">
          <div className="setting-info" style={{ width: '100%' }}>
            <label htmlFor="llm-api-key">OpenAI / Anthropic API Key (Optional)</label>
            <p>Used for enhanced field detection and smart form filling.</p>
          </div>
          <input
            id="llm-api-key"
            type="password"
            placeholder="sk-..."
            value={sessionSecrets.llmApiKey}
            onChange={(e) => onSessionSecretChange('llmApiKey', e.target.value)}
            autoComplete="off"
          />
          <p className="security-note" style={{ color: 'var(--warning)', marginTop: '4px' }}>
            🔒 Stored in memory only (cleared on extension reload)
          </p>
        </div>
      </SettingsSection>

      <SettingsSection id="ml-data" title="Continuous Learning" icon="🧠">
        <div className="setting-item">
          <div className="setting-info">
            <label>Export Training Data</label>
            <p>Download your reported misclassifications to train the ML model</p>
          </div>
          <button className="premium-btn" type="button" onClick={handleExportMLData}>
            Download Data
          </button>
        </div>
      </SettingsSection>

      <SettingsSection id="danger-zone" title="Danger Zone" icon="⚠️" variant="danger">
        <div className="setting-item">
          <div className="setting-info">
            <label>Reset Settings</label>
            <p>Restore all settings to their defaults</p>
          </div>
          <button
            className="premium-btn premium-btn-secondary"
            onClick={onReset}
            type="button"
            aria-label="Reset all settings to defaults"
          >
            Reset
          </button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label>Clear All Data</label>
            <p>Delete all emails, passwords, and history</p>
          </div>
          <button
            className="premium-btn"
            style={{ background: 'var(--error)' }}
            onClick={onClearData}
            type="button"
            aria-label="Clear all stored data"
          >
            Clear Data
          </button>
        </div>
      </SettingsSection>
    </div>
  );
};

export default AdvancedTab;
