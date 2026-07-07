import { Lock } from 'lucide-react';
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

interface PasswordTabProps {
  settings: UserSettings;
  onPasswordDefaultChange: (
    key: keyof UserSettings['passwordDefaults'],
    value: UserSettings['passwordDefaults'][keyof UserSettings['passwordDefaults']]
  ) => void;
  fieldHasError: (field: string) => boolean;
  getFieldError: (field: string) => string | undefined;
  onFieldBlur: (field: string) => void;
}

const PasswordTab: React.FC<PasswordTabProps> = ({
  settings,
  onPasswordDefaultChange,
  fieldHasError,
  getFieldError,
  onFieldBlur,
}) => {
  return (
    <div role="tabpanel" id="tabpanel-password" aria-labelledby="tab-password">
      <SettingsSection
        id="password-defaults"
        title={t('passwordDefaultsSection')}
        icon={<Lock size={18} />}
      >
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="password-length">{t('defaultLength')}</label>
            <p>{t('defaultLengthDescription')}</p>
          </div>
          <input
            id="password-length"
            type="number"
            min="8"
            max="128"
            value={settings.passwordDefaults.length}
            onChange={(e) => onPasswordDefaultChange('length', Number(e.target.value))}
            onBlur={() => onFieldBlur('passwordDefaults.length')}
            aria-invalid={fieldHasError('passwordDefaults.length')}
            aria-describedby={
              fieldHasError('passwordDefaults.length')
                ? 'password-length-error'
                : 'password-length-desc'
            }
          />
          <span id="password-length-desc" className="sr-only">
            {t('defaultLengthAriaDescription')}
          </span>
          {fieldHasError('passwordDefaults.length') && (
            <span id="password-length-error" className="field-error" role="alert">
              {getFieldError('passwordDefaults.length')}
            </span>
          )}
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="uppercase-label">{t('uppercaseLetters')}</label>
            <p>{t('uppercaseLettersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.uppercase}
            onChange={(checked) => onPasswordDefaultChange('uppercase', checked)}
            ariaLabel={t('uppercaseLettersAriaLabel')}
            ariaLabelledBy="uppercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="lowercase-label">{t('lowercaseLetters')}</label>
            <p>{t('lowercaseLettersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.lowercase}
            onChange={(checked) => onPasswordDefaultChange('lowercase', checked)}
            ariaLabel={t('lowercaseLettersAriaLabel')}
            ariaLabelledBy="lowercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="numbers-label">{t('numbers')}</label>
            <p>{t('numbersDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.numbers}
            onChange={(checked) => onPasswordDefaultChange('numbers', checked)}
            ariaLabel={t('numbersAriaLabel')}
            ariaLabelledBy="numbers-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="symbols-label">{t('symbols')}</label>
            <p>{t('symbolsDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.symbols}
            onChange={(checked) => onPasswordDefaultChange('symbols', checked)}
            ariaLabel={t('symbolsAriaLabel')}
            ariaLabelledBy="symbols-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="exclude-ambiguous-label">{t('excludeAmbiguous')}</label>
            <p>{t('excludeAmbiguousDescription')}</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.excludeAmbiguous}
            onChange={(checked) => onPasswordDefaultChange('excludeAmbiguous', checked)}
            ariaLabel={t('excludeAmbiguousAriaLabel')}
            ariaLabelledBy="exclude-ambiguous-label"
          />
        </div>
      </SettingsSection>
    </div>
  );
};

export default PasswordTab;
