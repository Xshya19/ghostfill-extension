import React from 'react';

import { UserSettings } from '../../types/storage.types';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

interface PrivacyTabProps {
    settings: UserSettings;
    onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
    fieldHasError: (field: string) => boolean;
    getFieldError: (field: string) => string | undefined;
    onFieldBlur: (field: string) => void;
}

const PrivacyTab: React.FC<PrivacyTabProps> = ({
    settings,
    onSettingChange,
    fieldHasError,
    getFieldError,
    onFieldBlur,
}) => {
    return (
        <div
            role="tabpanel"
            id="tabpanel-privacy"
            aria-labelledby="tab-privacy"
        >
            <SettingsSection id="history" title="History & Data" icon="🔒">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="save-history-label">Save History</label>
                        <p>Save generated emails and passwords to history for later retrieval</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.saveHistory}
                        onChange={(checked) => onSettingChange('saveHistory', checked)}
                        ariaLabel="Save history"
                        ariaLabelledBy="save-history-label"
                    />
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label htmlFor="history-retention">History Retention</label>
                        <p>Days to keep history before auto-deletion (1–365)</p>
                    </div>
                    <input
                        id="history-retention"
                        type="number"
                        min="1"
                        max="365"
                        value={settings.historyRetentionDays}
                        onChange={(e) => onSettingChange('historyRetentionDays', Number(e.target.value))}
                        onBlur={() => onFieldBlur('historyRetentionDays')}
                        aria-invalid={fieldHasError('historyRetentionDays')}
                        aria-describedby={fieldHasError('historyRetentionDays') ? 'history-retention-error' : 'history-retention-desc'}
                    />
                    <span id="history-retention-desc" className="sr-only">
                        Enter a value between 1 and 365 days
                    </span>
                    {fieldHasError('historyRetentionDays') && (
                        <span id="history-retention-error" className="field-error" role="alert">
                            {getFieldError('historyRetentionDays')}
                        </span>
                    )}
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label id="clear-on-close-label">Clear on Close</label>
                        <p>Automatically clear all data when the browser closes</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.clearOnClose}
                        onChange={(checked) => onSettingChange('clearOnClose', checked)}
                        ariaLabel="Clear data on browser close"
                        ariaLabelledBy="clear-on-close-label"
                    />
                </div>
            </SettingsSection>

            <SettingsSection id="telemetry" title="Telemetry" icon="📊">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="analytics-label">Anonymous Analytics</label>
                        <p>Help improve GhostFill by sharing anonymous usage statistics (no personal data ever)</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.analyticsEnabled}
                        onChange={(checked) => onSettingChange('analyticsEnabled', checked)}
                        ariaLabel="Enable anonymous analytics"
                        ariaLabelledBy="analytics-label"
                    />
                </div>
            </SettingsSection>
        </div>
    );
};

export default PrivacyTab;
