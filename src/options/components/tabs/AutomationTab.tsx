import { Zap, Keyboard } from 'lucide-react';
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

interface AutomationTabProps {
  settings: UserSettings;
  onSettingChange: (key: keyof UserSettings, value: UserSettings[keyof UserSettings]) => void;
}

const AutomationTab: React.FC<AutomationTabProps> = ({ settings, onSettingChange }) => {
  return (
    <div role="tabpanel" id="tabpanel-automation" aria-labelledby="tab-automation">
      <SettingsSection id="auto-fill" title={t('autofillSection')} icon={<Zap size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="auto-fill-otp-label">{t('autofillOTP')}</label>
            <p>{t('autofillOTPDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.autoFillOTP}
            onChange={(checked) => onSettingChange('autoFillOTP', checked)}
            ariaLabel={t('autofillOTPAriaLabel')}
            ariaLabelledBy="auto-fill-otp-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="auto-confirm-links-label">{t('autoOpenVerificationLinks')}</label>
            <p>{t('autoOpenVerificationLinksDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.autoConfirmLinks}
            onChange={(checked) => onSettingChange('autoConfirmLinks', checked)}
            ariaLabel={t('autoOpenVerificationLinksAriaLabel')}
            ariaLabelledBy="auto-confirm-links-label"
          />
        </div>
      </SettingsSection>

      <SettingsSection id="shortcuts" title={t('shortcutsSection')} icon={<Keyboard size={18} />}>
        <div className="setting-item">
          <div className="setting-info">
            <label id="keyboard-shortcuts-label">{t('enableShortcuts')}</label>
            <p>{t('enableShortcutsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.keyboardShortcuts}
            onChange={(checked) => onSettingChange('keyboardShortcuts', checked)}
            ariaLabel={t('enableShortcutsAriaLabel')}
            ariaLabelledBy="keyboard-shortcuts-label"
          />
        </div>

        <div
          className="shortcut-reference"
          role="group"
          aria-label={t('shortcutReferenceAriaLabel')}
        >
          <h3 className="shortcut-reference-title">{t('quickReference')}</h3>
          <div className="shortcut-list">
            <div className="shortcut-row">
              <span className="shortcut-action">{t('shortcutOpenGhostFill')}</span>
              <kbd className="shortcut-keys">Ctrl + Shift + E</kbd>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-action">{t('shortcutGenerateEmail')}</span>
              <kbd className="shortcut-keys">Ctrl + Shift + M</kbd>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-action">{t('shortcutGeneratePassword')}</span>
              <kbd className="shortcut-keys">Ctrl + Shift + G</kbd>
            </div>
            <div className="shortcut-row">
              <span className="shortcut-action">{t('shortcutAutofillForm')}</span>
              <kbd className="shortcut-keys">Ctrl + Shift + F</kbd>
            </div>
          </div>
          <p className="shortcut-note">{t('customizeShortcutsNote')}</p>
        </div>
      </SettingsSection>
    </div>
  );
};

export default AutomationTab;
