import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, Copy, Zap, Shield, Check } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';
import type { GeneratePasswordResponse } from '../../types/message.types';
import { TIMING } from '../../utils/constants';
import { copyToClipboard } from '../../utils/helpers';
import { createLogger } from '../../utils/logger';
import { safeSendMessage } from '../../utils/messaging';

const log = createLogger('PasswordGenerator');

// Strength score (0-4) -> fill percentage shown in the meter.
const STRENGTH_PERCENTS = [8, 20, 45, 75, 100] as const;
const strengthPercent = (score: number): number => STRENGTH_PERCENTS[score] ?? 8;

// Map raw Shannon entropy (bits) to a 0-4 strength score.
const entropyToScore = (entropy: number): number => {
  if (entropy >= 100) {
    return 4;
  }
  if (entropy >= 60) {
    return 3;
  }
  if (entropy >= 36) {
    return 2;
  }
  if (entropy >= 28) {
    return 1;
  }
  return 0;
};

// Estimate the strength of a pre-existing password from its character set.
const describeExistingPassword = (pw: string): GeneratedPassword => {
  let pool = 0;
  if (/[a-z]/.test(pw)) {
    pool += 26;
  }
  if (/[A-Z]/.test(pw)) {
    pool += 26;
  }
  if (/\d/.test(pw)) {
    pool += 10;
  }
  if (/[^a-zA-Z0-9]/.test(pw)) {
    pool += 32;
  }

  const entropy = pool === 0 ? 0 : Math.floor(pw.length * Math.log2(pool));
  const score = entropyToScore(entropy);

  return {
    password: pw,
    strength: {
      score,
      level: score >= 3 ? 'good' : 'weak',
      crackTime: score >= 3 ? 'Secure' : 'Vulnerable',
      entropy,
      suggestions: [],
    },
    options: DEFAULT_PASSWORD_OPTIONS,
    generatedAt: Date.now(),
  };
};

interface Props {
  onToast: (message: string) => void;
  currentPassword?: string;
}

const PasswordGenerator: React.FC<Props> = ({ onToast, currentPassword }) => {
  const [password, setPassword] = useState<GeneratedPassword | null>(null);
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localLength, setLocalLength] = useState(options.length);

  const generatePassword = useCallback(async () => {
    setLoading(true);
    try {
      if (!chrome?.runtime?.id) {
        return;
      }
      const response = await safeSendMessage({
        action: 'GENERATE_PASSWORD',
        payload: options,
      });
      const typedResponse = response as GeneratePasswordResponse;
      if (typedResponse.result) {
        setPassword(typedResponse.result);
      }
    } catch (error) {
      log.error('Failed to generate password', error);
      onToast('Failed to generate password');
    } finally {
      setLoading(false);
    }
  }, [options, onToast]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setOptions((prev) => ({ ...prev, length: localLength }));
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [localLength]);

  useEffect(() => {
    if (currentPassword) {
      setPassword(describeExistingPassword(currentPassword));
    } else if (!password) {
      void generatePassword();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPassword]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyPassword = async () => {
    if (!password) {
      return;
    }
    try {
      await copyToClipboard(password.password);
      setCopied(true);
      onToast('Password copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), TIMING.COPY_CONFIRMATION_MS); // Longer confirmation
    } catch {
      onToast('Copy failed');
    }
  };

  const handleGeneratePassword = () => {
    void generatePassword();
  };

  const handleCopyPassword = () => {
    void copyPassword();
  };

  const handleOptionChange = (key: keyof PasswordOptions, value: boolean | number) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const getStrengthColor = (score: number) => {
    switch (score) {
      case 0:
      case 1:
        return 'var(--error)';
      case 2:
        return 'var(--warning)';
      case 3:
        return 'var(--warning-light)';
      case 4:
        return 'var(--success)';
      default:
        return 'var(--text-tertiary)';
    }
  };

  return (
    <div className="generator-flow">
      {/* Main Display Card */}
      <div className="memphis-card memphis-card-default">
        <div className="generator-card-header generator-card-header-center">
          <div className="widget-label widget-label-no-margin">
            <Lock size={16} className="sf-icon" />
            {currentPassword ? 'Current Secret' : 'Secured Generator'}
          </div>
          <button
            className="back-button eye-button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
        {/* Terminal-style Password Display */}
        <motion.div
          className={`password-terminal ${loading ? 'shimmer' : ''}`}
          whileTap={{ x: 2, y: 2 }}
          onClick={handleCopyPassword}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCopyPassword();
            }
          }}
        >
          <div
            className={`password-display-text ${showPassword ? 'password-display-visible' : 'password-display-hidden'}`}
          >
            {password
              ? showPassword
                ? password.password
                : '•'.repeat(Math.min(password.password.length, 16))
              : '•'.repeat(Math.min(options.length, 16))}
          </div>
        </motion.div>

        {password && (
          <div className="strength-meter-container" aria-live="polite">
            <div className="strength-meter-header">
              <span
                className="strength-level-label"
                style={{ '--strength-color': getStrengthColor(password.strength.score) }}
              >
                {password.strength.level}
              </span>
              <span
                className="strength-level-percent"
                style={{ '--strength-color': getStrengthColor(password.strength.score) }}
              >
                {strengthPercent(password.strength.score)}%
              </span>
            </div>
            {/* Gradient Strength Bar */}
            <div className="strength-bar-bg">
              <div
                className="strength-bar-fill"
                style={{
                  '--strength-width': `${strengthPercent(password.strength.score)}%`,
                  '--strength-color': getStrengthColor(password.strength.score),
                  '--strength-color-end':
                    password.strength.score >= 4
                      ? 'var(--gf-mint)'
                      : getStrengthColor(password.strength.score),
                }}
              />
            </div>
          </div>
        )}

        <div className="generator-actions">
          <button
            className={`ios-button button-primary ${loading ? 'shimmer' : ''}`}
            onClick={handleGeneratePassword}
            disabled={loading}
          >
            {loading ? <span className="spinner-small" /> : <Zap size={18} fill="white" />}
            {loading ? 'Securing...' : 'Regenerate'}
          </button>
          <button className="ios-button button-secondary" onClick={handleCopyPassword}>
            {copied ? <Check size={18} color="var(--success)" /> : <Copy size={18} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="memphis-card memphis-card-default memphis-card-mt16">
        <div className="widget-label config-label config-label-spaced">
          <Shield size={16} className="sf-icon" />
          Complexity Settings
        </div>

        {/* Length Slider */}
        <div className="slider-container">
          <div className="slider-header">
            <span>Length</span>
            <span className="slider-value">{options.length}</span>
          </div>
          <input
            type="range"
            className="strength-range-input"
            min="8"
            max="64"
            value={localLength}
            onChange={(e) => setLocalLength(Number(e.target.value))}
            aria-label="Password length"
          />
        </div>

        {/* Toggle Pills Grid */}
        <div className="toggle-pills-grid">
          {[
            { id: 'uppercase', label: 'Upper', icon: 'ABC' },
            { id: 'lowercase', label: 'Lower', icon: 'abc' },
            { id: 'numbers', label: 'Numbers', icon: '123' },
            { id: 'symbols', label: 'Symbols', icon: '#@!' },
          ].map((opt) => {
            const isActive = Boolean(options[opt.id as keyof PasswordOptions]);
            return (
              <button
                key={opt.id}
                type="button"
                className={`toggle-pill ${isActive ? 'active' : ''}`}
                onClick={() => handleOptionChange(opt.id as keyof PasswordOptions, !isActive)}
                aria-pressed={isActive}
                aria-label={`${opt.label}: ${isActive ? 'enabled' : 'disabled'}`}
              >
                <span className="pill-icon">{opt.icon}</span>
                <span className="pill-label">{opt.label}</span>
                <span className="pill-check">
                  <Check size={10} strokeWidth={3} color="var(--gf-ink)" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PasswordGenerator;
