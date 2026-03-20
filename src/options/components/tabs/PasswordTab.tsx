import React from 'react';

import { UserSettings } from '../../../types/storage.types';
import SettingsSection from '../SettingsSection';
import ToggleSwitch from '../ToggleSwitch';

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
      <SettingsSection id="password-defaults" title="Password Defaults" icon="🔐">
        <div className="setting-item">
          <div className="setting-info">
            <label htmlFor="password-length">Default Length</label>
            <p>Default password length for new generations (8–128)</p>
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
            Enter a value between 8 and 128 characters
          </span>
          {fieldHasError('passwordDefaults.length') && (
            <span id="password-length-error" className="field-error" role="alert">
              {getFieldError('passwordDefaults.length')}
            </span>
          )}
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="uppercase-label">Uppercase Letters</label>
            <p>Include A–Z in generated passwords</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.uppercase}
            onChange={(checked) => onPasswordDefaultChange('uppercase', checked)}
            ariaLabel="Include uppercase letters"
            ariaLabelledBy="uppercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="lowercase-label">Lowercase Letters</label>
            <p>Include a–z in generated passwords</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.lowercase}
            onChange={(checked) => onPasswordDefaultChange('lowercase', checked)}
            ariaLabel="Include lowercase letters"
            ariaLabelledBy="lowercase-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="numbers-label">Numbers</label>
            <p>Include 0–9 in generated passwords</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.numbers}
            onChange={(checked) => onPasswordDefaultChange('numbers', checked)}
            ariaLabel="Include numbers"
            ariaLabelledBy="numbers-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="symbols-label">Symbols</label>
            <p>Include special characters (!@#$%^&*…)</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.symbols}
            onChange={(checked) => onPasswordDefaultChange('symbols', checked)}
            ariaLabel="Include symbols"
            ariaLabelledBy="symbols-label"
          />
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <label id="exclude-ambiguous-label">Exclude Ambiguous</label>
            <p>Remove characters like O, 0, l, 1 that look similar</p>
          </div>
          <ToggleSwitch
            checked={settings.passwordDefaults.excludeAmbiguous}
            onChange={(checked) => onPasswordDefaultChange('excludeAmbiguous', checked)}
            ariaLabel="Exclude ambiguous characters"
            ariaLabelledBy="exclude-ambiguous-label"
          />
        </div>
      </SettingsSection>
    </div>
  );
};

export default PasswordTab;
