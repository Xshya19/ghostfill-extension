import { Lock, BarChart2, MailCheck } from 'lucide-react';
import React from 'react';

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

interface PrivacyTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
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
    <div role="tabpanel" id="tabpanel-privacy" aria-labelledby="tab-privacy">
      <SettingsSection id="history" title={t('historyDataSection')} icon={<Lock size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="save-history-label">{t('saveHistory')}</label>
            <p>{t('saveHistoryDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.saveHistory}
            onChange={(checked) => onSettingChange('saveHistory', checked)}
            ariaLabel={t('saveHistoryAriaLabel')}
            ariaLabelledBy="save-history-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="history-retention">{t('historyRetention')}</label>
            <p>{t('historyRetentionDescription')}</p>
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
            aria-describedby={
              fieldHasError('historyRetentionDays')
                ? 'history-retention-error'
                : 'history-retention-desc'
            }
          />
          <span id="history-retention-desc" className="sr-only">
            {t('historyRetentionAriaDescription')}
          </span>
          {fieldHasError('historyRetentionDays') && (
            <span id="history-retention-error" className="field-error" role="alert">
              {getFieldError('historyRetentionDays')}
            </span>
          )}
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="clear-on-close-label">{t('clearOnClose')}</label>
            <p>{t('clearOnCloseDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.clearOnClose}
            onChange={(checked) => onSettingChange('clearOnClose', checked)}
            ariaLabel={t('clearOnCloseAriaLabel')}
            ariaLabelledBy="clear-on-close-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="gmail-privacy"
        title={t('gmailPrivacySection')}
        icon={<MailCheck size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label id="gmail-session-fallback-label">{t('gmailSessionDetection')}</label>
            <p>{t('gmailSessionDetectionDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.allowGmailSessionFallback}
            onChange={(checked) => onSettingChange('allowGmailSessionFallback', checked)}
            ariaLabel={t('gmailSessionDetectionAriaLabel')}
            ariaLabelledBy="gmail-session-fallback-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="telemetry" title={t('telemetrySection')} icon={<BarChart2 size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="analytics-label">{t('anonymousAnalytics')}</label>
            <p>{t('anonymousAnalyticsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.analyticsEnabled}
            onChange={(checked) => onSettingChange('analyticsEnabled', checked)}
            ariaLabel={t('anonymousAnalyticsAriaLabel')}
            ariaLabelledBy="analytics-label"
          />
        </div>
      </SettingsSection>
    </div>
  );
};

export default PrivacyTab;
