import React, { useRef } from 'react';

import { UserSettings, DEFAULT_SETTINGS } from '../../types/storage.types';
import { createLogger } from '../../utils/logger';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

const log = createLogger('AdvancedTab');

interface AdvancedTabProps {
    settings: UserSettings;
    onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
    sessionSecrets: { customDomainKey: string; llmApiKey: string };
    onSessionSecretChange: (key: 'customDomainKey' | 'llmApiKey', value: string) => void;
    onReset: () => void;
    onClearData: () => void;
    onSettingsImport: (imported: UserSettings) => void;
}

const AdvancedTab: React.FC<AdvancedTabProps> = ({
    settings,
    onSettingChange,
    onReset,
    onClearData,
    onSettingsImport,
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
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target?.result as string);

                // Validate basic structure — merge with defaults to fill missing keys
                const merged: UserSettings = {
                    ...DEFAULT_SETTINGS,
                    ...parsed,
                    passwordDefaults: {
                        ...DEFAULT_SETTINGS.passwordDefaults,
                        ...(parsed.passwordDefaults || {}),
                    },
                };

                onSettingsImport(merged);
            } catch (err) {
                log.error('Import failed:', err);
                alert('Invalid settings file. Please select a valid GhostFill settings JSON.');
            }
        };
        reader.readAsText(file);

        // Reset input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div
            role="tabpanel"
            id="tabpanel-advanced"
            aria-labelledby="tab-advanced"
        >
            <SettingsSection id="ai-intelligence" title="AI & Intelligence" icon="🧠">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="enable-ai-parser-label">Enable AI Parser</label>
                        <p>Use on-device AI to detect OTPs and analyze form fields (no API key needed)</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.useLLMParser}
                        onChange={(checked) => onSettingChange('useLLMParser', checked)}
                        ariaLabel="Enable AI parser"
                        ariaLabelledBy="enable-ai-parser-label"
                    />
                </div>

                <div className="setting-item vertical-group">
                    <div className="setting-info" style={{ width: '100%' }}>
                        <label style={{ fontSize: 14, fontWeight: 600 }}>🔒 Powered by Local AI</label>
                        <p style={{ opacity: 0.7, lineHeight: 1.5 }}>
                            GhostFill uses a 3-layer on-device AI engine that runs entirely in your browser.
                            No data is ever sent to external servers. Works offline.
                        </p>
                    </div>
                    <div className="tech-pill-container" role="list" aria-label="AI features">
                        <span className="tech-pill indigo" role="listitem">Chrome AI (Gemini Nano)</span>
                        <span className="tech-pill purple" role="listitem">Smart Detection</span>
                        <span className="tech-pill blue" role="listitem">Pattern Engine</span>
                    </div>
                </div>
            </SettingsSection>

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
                    <button className="btn btn-secondary" type="button" onClick={handleExport}>
                        Export
                    </button>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label htmlFor="import-settings">Import Settings</label>
                        <p>Load settings from a previously exported JSON file</p>
                    </div>
                    <label className="btn btn-secondary import-btn" tabIndex={0} role="button">
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

            <SettingsSection id="danger-zone" title="Danger Zone" icon="⚠️" variant="danger">
                <div className="setting-item">
                    <div className="setting-info">
                        <label>Reset Settings</label>
                        <p>Restore all settings to their defaults</p>
                    </div>
                    <button
                        className="btn btn-secondary"
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
                        className="btn btn-danger"
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
