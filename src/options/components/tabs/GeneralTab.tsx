import React from 'react';

import { UserSettings } from '../../types/storage.types';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

interface GeneralTabProps {
    settings: UserSettings;
    onSettingChange: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

const GeneralTab: React.FC<GeneralTabProps> = ({ settings, onSettingChange }) => {
    return (
        <div
            role="tabpanel"
            id="tabpanel-general"
            aria-labelledby="tab-general"
        >
            <SettingsSection id="appearance" title="Appearance" icon="🎨">
                <div className="setting-item">
                    <div className="setting-info">
                        <label htmlFor="dark-mode">Dark Mode</label>
                        <p>Choose your preferred color scheme</p>
                    </div>
                    <select
                        id="dark-mode"
                        value={String(settings.darkMode)}
                        onChange={(e) => {
                            const val = e.target.value;
                            onSettingChange('darkMode', val === 'system' ? 'system' : val === 'true');
                        }}
                        aria-describedby="dark-mode-description"
                    >
                        <option value="system">System</option>
                        <option value="false">Light</option>
                        <option value="true">Dark</option>
                    </select>
                    <span id="dark-mode-description" className="sr-only">
                        Choose dark mode, light mode, or follow system preference
                    </span>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label id="show-floating-button-label">Floating Button</label>
                        <p>Display the GhostFill action button near input fields</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.showFloatingButton}
                        onChange={(checked) => onSettingChange('showFloatingButton', checked)}
                        ariaLabel="Show floating button"
                        ariaLabelledBy="show-floating-button-label"
                    />
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label htmlFor="floating-position">Button Position</label>
                        <p>Which side of the input field to display the button</p>
                    </div>
                    <select
                        id="floating-position"
                        value={settings.floatingButtonPosition}
                        onChange={(e) => onSettingChange('floatingButtonPosition', e.target.value as 'right' | 'left')}
                    >
                        <option value="right">Right</option>
                        <option value="left">Left</option>
                    </select>
                </div>
            </SettingsSection>

            <SettingsSection id="notifications" title="Notifications & Sound" icon="🔔">
                <div className="setting-item">
                    <div className="setting-info">
                        <label id="notifications-label">Desktop Notifications</label>
                        <p>Show notifications for new emails and OTP codes</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.notifications}
                        onChange={(checked) => onSettingChange('notifications', checked)}
                        ariaLabel="Enable notifications"
                        ariaLabelledBy="notifications-label"
                    />
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <label id="sound-enabled-label">Sound Effects</label>
                        <p>Play sounds for actions like copy, OTP detection, etc.</p>
                    </div>
                    <ToggleSwitch
                        checked={settings.soundEnabled}
                        onChange={(checked) => onSettingChange('soundEnabled', checked)}
                        ariaLabel="Enable sound effects"
                        ariaLabelledBy="sound-enabled-label"
                    />
                </div>
            </SettingsSection>
        </div>
    );
};

export default GeneralTab;
