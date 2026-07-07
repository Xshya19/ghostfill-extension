import { Terminal, Save, AlertTriangle } from 'lucide-react';
import React, { useRef } from 'react';

import { Button } from '../../../shared/ui';
import { UserSettings, DEFAULT_SETTINGS } from '../../../types/storage.types';
import { createLogger } from '../../../utils/logger';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

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
            const actualType =
              parsed[k] === null ? 'null' : Array.isArray(parsed[k]) ? 'array' : typeof parsed[k];
            // Allow array-to-array and object-to-object matches
            const typeMatches =
              actualType === expectedType ||
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
          console.warn('Invalid settings file. Please select a valid GhostFill settings JSON.');
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
      <SettingsSection id="developer" title={t('developerSection')} icon={<Terminal size={18} />}>
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

      <SettingsSection id="backup" title={t('backupRestoreSection')} icon={<Save size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label>Export Settings</label>
            <p>Download your current settings as a JSON file</p>
          </div>
          <Button size="sm" type="button" onClick={handleExport}>
            Export
          </Button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="import-settings">Import Settings</label>
            <p>Load settings from a previously exported JSON file</p>
          </div>
          <button
            type="button"
            className="gf-btn gf-btn--sm import-btn"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Import settings from JSON file"
          >
            Import
            <input
              ref={fileInputRef}
              id="import-settings"
              type="file"
              accept=".json"
              onChange={handleImport}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        id="danger-zone"
        title="Danger Zone"
        icon={<AlertTriangle size={18} />}
        variant="danger"
      >
        <div className="setting-item">
          <div className="setting-info">
            <label>Reset Settings</label>
            <p>Restore all settings to their defaults</p>
          </div>
          <Button
            size="sm"
            onClick={onReset}
            type="button"
            aria-label="Reset all settings to defaults"
          >
            Reset
          </Button>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label>Clear All Data</label>
            <p>Delete all emails, passwords, and history</p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={onClearData}
            type="button"
            aria-label="Clear all stored data"
          >
            Clear Data
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
};

export default AdvancedTab;
