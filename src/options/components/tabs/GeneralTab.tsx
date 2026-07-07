import { Palette, Bell, Save } from 'lucide-react';
import React from 'react';

import { Button } from '../../../shared/ui';
import { UserSettings } from '../../../types/storage.types';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

interface GeneralTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
}

const GeneralTab: React.FC<GeneralTabProps> = ({ settings, onSettingChange }) => {
  return (
    <div role="tabpanel" id="tabpanel-general" aria-labelledby="tab-general">
      <SettingsSection id="appearance" title={t('appearanceSection')} icon={<Palette size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="dark-mode">{t('darkMode')}</label>
            <p>{t('darkModeDescription')}</p>
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
            <option value="system">{t('themeSystem')}</option>
            <option value="false">{t('themeLight')}</option>
            <option value="true">{t('themeDark')}</option>
          </select>
          <span id="dark-mode-description" className="sr-only">
            {t('darkModeAriaDescription')}
          </span>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="show-floating-button-label">{t('floatingButton')}</label>
            <p>{t('floatingButtonDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.showFloatingButton}
            onChange={(checked) => onSettingChange('showFloatingButton', checked)}
            ariaLabel={t('floatingButtonAriaLabel')}
            ariaLabelledBy="show-floating-button-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="floating-position">{t('buttonPosition')}</label>
            <p>{t('buttonPositionDescription')}</p>
          </div>
          <select
            id="floating-position"
            value={settings.floatingButtonPosition}
            onChange={(e) =>
              onSettingChange('floatingButtonPosition', e.target.value as 'right' | 'left')
            }
          >
            <option value="right">{t('right')}</option>
            <option value="left">{t('left')}</option>
          </select>
        </div>
      </SettingsSection>

      <SettingsSection
        id="notifications"
        title={t('notificationsSection')}
        icon={<Bell size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label id="notifications-label">{t('desktopNotifications')}</label>
            <p>{t('desktopNotificationsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.notifications}
            onChange={(checked) => onSettingChange('notifications', checked)}
            ariaLabel={t('desktopNotificationsAriaLabel')}
            ariaLabelledBy="notifications-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="sound-enabled-label">
              {t('soundEffects')} <span className="coming-soon-label">({t('comingSoon')})</span>
            </label>
            <p>{t('soundEffectsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.soundEnabled}
            onChange={(checked) => onSettingChange('soundEnabled', checked)}
            ariaLabel={t('soundEffectsAriaLabel')}
            ariaLabelledBy="sound-enabled-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="app-data" title={t('appDataSection')} icon={<Save size={18} />}>
        <div className="setting-item setting-item-col">
          <div className="setting-info setting-info-mb-8">
            <label>{t('applicationTutorial')}</label>
            <p>{t('applicationTutorialDescription')}</p>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              await chrome.storage.local.set({ hasSeenOnboarding: false });
              console.warn(t('onboardingResetWarning'));
            }}
          >
            {t('replayOnboarding')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
};

export default GeneralTab;
