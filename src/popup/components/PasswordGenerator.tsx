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
      let pool = 0;
      if (/[a-z]/.test(currentPassword)) {
        pool += 26;
      }
      if (/[A-Z]/.test(currentPassword)) {
        pool += 26;
      }
      if (/\d/.test(currentPassword)) {
        pool += 10;
      }
      if (/[^a-zA-Z0-9]/.test(currentPassword)) {
        pool += 32;
      }

      const entropy = pool === 0 ? 0 : Math.floor(currentPassword.length * Math.log2(pool));
      let score = 0;
      if (entropy >= 28) {
        score = 1;
      }
      if (entropy >= 36) {
        score = 2;
      }
      if (entropy >= 60) {
        score = 3;
      }
      if (entropy >= 100) {
        score = 4;
      }

      setPassword({
        password: currentPassword,
        strength: {
          score,
          level: score >= 3 ? 'good' : 'weak',
          crackTime: score >= 3 ? 'Secure' : 'Vulnerable',
          entropy,
          suggestions: [],
        },
        options: DEFAULT_PASSWORD_OPTIONS,
        generatedAt: Date.now(),
      });
    } else {
      void generatePassword();
    }
  }, [generatePassword, currentPassword]);

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
      <div className="ghost-card glass-card-default">
        <div className="generator-card-header">
          <div className="widget-label">
            <Lock size={14} className="sf-icon" />
            {currentPassword ? 'Current Secret' : 'Secured Generator'}
          </div>
          <button
            className="back-button eye-button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
        {/* Terminal-style Password Display */}
        <motion.div
          className={`password-terminal ${loading ? 'shimmer' : ''}`}
          whileTap={{ scale: 0.98 }}
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
                style={{ color: getStrengthColor(password.strength.score) }}
              >
                {password.strength.level}
              </span>
              <span
                className="strength-level-percent"
                style={{ color: getStrengthColor(password.strength.score) }}
              >
                {[8, 20, 45, 75, 100][password.strength.score] || 8}%
              </span>
            </div>
            {/* Gradient Strength Bar */}
            <div className="strength-bar-bg">
              <div
                className="strength-bar-fill"
                style={{
                  width: `${[8, 20, 45, 75, 100][password.strength.score] || 8}%`,
                  background: `linear-gradient(90deg, ${getStrengthColor(password.strength.score)} 0%, ${password.strength.score >= 4 ? 'var(--success-light)' : getStrengthColor(password.strength.score)} 100%)`,
                  boxShadow:
                    password.strength.score >= 4 ? '0 0 12px rgba(16, 185, 129, 0.5)' : 'none',
                }}
              />
            </div>
          </div>
        )}

        <div className="generator-actions">
          <button
            className={`premium-btn ${loading ? 'shimmer' : ''}`}
            onClick={handleGeneratePassword}
            disabled={loading}
          >
            {loading ? <span className="spinner-small" /> : <Zap size={16} fill="white" />}
            {loading ? 'Securing...' : 'Regenerate'}
          </button>
          <button className="premium-btn premium-btn-secondary" onClick={handleCopyPassword}>
            {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="ghost-card glass-card-default glass-card-mt16">
        <div className="widget-label config-label">
          <Shield size={14} className="sf-icon" />
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
            style={{ width: '100%' }}
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
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PasswordGenerator;
