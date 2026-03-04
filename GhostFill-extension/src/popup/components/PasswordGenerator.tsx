import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, Copy, Zap, Shield, Check } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';
import { copyToClipboard } from '../../utils/helpers';

interface Props {
    onToast: (message: string) => void;
    currentPassword?: string;
}

const PasswordGenerator: React.FC<Props> = ({ onToast, currentPassword }) => {
    const [password, setPassword] = useState<GeneratedPassword | null>(null);
    const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(true);
    const [copied, setCopied] = useState(false);

    const generatePassword = useCallback(async () => {
        setLoading(true);
        try {
            if (!chrome?.runtime?.id) {return;}
            const response = await chrome.runtime.sendMessage({
                action: 'GENERATE_PASSWORD',
                payload: options,
            });
            if (response?.result) {
                setPassword(response.result);
            }
        } catch (error) {
            console.error('Failed to generate password:', error);
            onToast('Failed to generate password');
        } finally {
            setLoading(false);
        }
    }, [options, onToast]);

    useEffect(() => {
        if (currentPassword) {
            setPassword({
                password: currentPassword,
                strength: { score: 4, level: 'strong', crackTime: 'Secure', entropy: 0, suggestions: [] },
                options: DEFAULT_PASSWORD_OPTIONS,
                generatedAt: Date.now()
            });
        } else {
            generatePassword();
        }
    }, [generatePassword, currentPassword]);

    const copyPassword = async () => {
        if (!password) {return;}
        try {
            await copyToClipboard(password.password);
            setCopied(true);
            onToast('Password copied');
            setTimeout(() => setCopied(false), 2500); // Longer confirmation
        } catch (error) {
            onToast('Copy failed');
        }
    };

    const handleOptionChange = (key: keyof PasswordOptions, value: boolean | number) => {
        setOptions(prev => ({ ...prev, [key]: value }));
    };

    const getStrengthColor = (level: string) => {
        switch (level) {
            case 'weak': return 'var(--error)';
            case 'fair': return 'var(--warning)';
            case 'good': return 'var(--warning-light)';
            case 'strong':
            case 'very-strong': return 'var(--success)';
            default: return 'var(--text-tertiary)';
        }
    };

    const getStrengthPercent = (level: string) => {
        switch (level) {
            case 'weak': return 25;
            case 'fair': return 50;
            case 'good': return 75;
            case 'strong':
            case 'very-strong': return 100;
            default: return 0;
        }
    };

    return (
        <div className="generator-flow">
            {/* Main Display Card */}
            <div className="glass-card glass-card-default">
                <div className="generator-card-header">
                    <div className="widget-label">
                        <Lock size={14} className="sf-icon" />
                        {currentPassword ? 'Current Secret' : 'Secured Generator'}
                    </div>
                    <button className="back-button eye-button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                </div>
                {/* Terminal-style Password Display */}
                <motion.div
                    className={`password-terminal ${loading ? 'shimmer' : ''}`}
                    whileTap={{ scale: 0.98 }}
                    onClick={copyPassword}
                >
                    <div className={`password-display-text ${showPassword ? 'password-display-visible' : 'password-display-hidden'}`}>
                        {password ? (showPassword ? password.password : '•'.repeat(options.length)) : '•'.repeat(options.length)}
                    </div>
                </motion.div>

                {password && (
                    <div className="strength-meter-container">
                        <div className="strength-meter-header">
                            <span className="strength-level-label" style={{ color: getStrengthColor(password.strength.level) }}>
                                {password.strength.level}
                            </span>
                            <span className="strength-level-percent" style={{ color: getStrengthColor(password.strength.level) }}>
                                {getStrengthPercent(password.strength.level)}%
                            </span>
                        </div>
                        {/* Gradient Strength Bar */}
                        <div className="strength-bar-bg">
                            <div className="strength-bar-fill" style={{
                                width: `${getStrengthPercent(password.strength.level)}%`,
                                background: `linear-gradient(90deg, ${getStrengthColor(password.strength.level)} 0%, ${password.strength.level === 'strong' || password.strength.level === 'very-strong' ? 'var(--success-light)' : getStrengthColor(password.strength.level)} 100%)`,
                                boxShadow: password.strength.level === 'strong' || password.strength.level === 'very-strong' ? '0 0 12px rgba(16, 185, 129, 0.5)' : 'none',
                            }} />
                        </div>
                    </div>
                )}

                <div className="generator-actions">
                    <button className={`ios-button button-primary ${loading ? 'shimmer' : ''}`} onClick={generatePassword} disabled={loading}>
                        {loading ? <span className="spinner-small" /> : <Zap size={16} fill="white" />}
                        {loading ? 'Securing...' : 'Regen'}
                    </button>
                    <button className="ios-button button-secondary" onClick={copyPassword}>
                        {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </div>

            {/* Configuration Card */}
            <div className="glass-card glass-card-default glass-card-mt16">
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
                        min="12" max="64"
                        value={options.length}
                        onChange={(e) => handleOptionChange('length', Number(e.target.value))}
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
