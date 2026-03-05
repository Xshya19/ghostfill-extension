import React from 'react';

import { UserSettings } from '../../types/storage.types';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

interface AutomationTabProps {
    settings: UserSettings;
    onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

const AutomationTab: React.FC<AutomationTabProps> = ({ settings, onSettingChange }) => {
    return (
        <div
            role="tabpanel"
            id="tabpanel-automation"
            aria-labelledby="tab-automation"
        >
            <SettingsSection id="auto-fill" title="Auto-fill" icon="⚡">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="auto-fill-otp-label">Auto-fill OTP</label>
                        <p>Automatically fill OTP fields when a code is detected in email</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.autoFillOTP}
                        onChange={(checked) => onSettingChange('autoFillOTP', checked)}
                        ariaLabel="Auto-fill OTP"
                        ariaLabelledBy="auto-fill-otp-label"
                    />
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label id="auto-confirm-links-label">Auto-open Verification Links</label>
                        <p>Automatically open activation/verification links from emails in a new tab</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.autoConfirmLinks}
                        onChange={(checked) => onSettingChange('autoConfirmLinks', checked)}
                        ariaLabel="Auto-confirm verification links"
                        ariaLabelledBy="auto-confirm-links-label"
                    />
                </div>
            </SettingsSection>

            <SettingsSection id="shortcuts" title="Keyboard Shortcuts" icon="⌨️">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="keyboard-shortcuts-label">Enable Shortcuts</label>
                        <p>Use keyboard shortcuts for quick actions</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.keyboardShortcuts}
                        onChange={(checked) => onSettingChange('keyboardShortcuts', checked)}
                        ariaLabel="Enable keyboard shortcuts"
                        ariaLabelledBy="keyboard-shortcuts-label"
                    />
                </div>

                <div className="shortcut-reference" role="group" aria-label="Keyboard shortcut reference">
                    <h3 className="shortcut-reference-title">Quick Reference</h3>
                    <div className="shortcut-list">
                        <div className="shortcut-row">
                            <span className="shortcut-action">Open GhostFill</span>
                            <kbd className="shortcut-keys">Ctrl + Shift + E</kbd>
                        </div>
                        <div className="shortcut-row">
                            <span className="shortcut-action">Generate Email</span>
                            <kbd className="shortcut-keys">Ctrl + Shift + M</kbd>
                        </div>
                        <div className="shortcut-row">
                            <span className="shortcut-action">Generate Password</span>
                            <kbd className="shortcut-keys">Ctrl + Shift + G</kbd>
                        </div>
                        <div className="shortcut-row">
                            <span className="shortcut-action">Auto-fill Form</span>
                            <kbd className="shortcut-keys">Ctrl + Shift + F</kbd>
                        </div>
                    </div>
                    <p className="shortcut-note">
                        Customize shortcuts in <code>chrome://extensions/shortcuts</code>
                    </p>
                </div>
            </SettingsSection>
        </div>
    );
};

export default AutomationTab;
