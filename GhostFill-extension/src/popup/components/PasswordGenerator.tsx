import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, Copy, Zap, Shield, Check } from 'lucide-react';
import { PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';

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
            if (!chrome?.runtime?.id) return;
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
        if (!password) return;
        try {
            await navigator.clipboard.writeText(password.password);
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
            <div className="glass-card" style={{ padding: 20, cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div className="widget-label">
                        <Lock size={14} className="sf-icon" />
                        {currentPassword ? 'Current Secret' : 'Secured Generator'}
                    </div>
                    <button className="back-button" style={{ width: 32, height: 32 }} onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                </div>
                {/* Terminal-style Password Display */}
                <motion.div
                    className="password-terminal"
                    style={{
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
                        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.15)',
                        padding: '20px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 70,
                        borderRadius: 16,
                        cursor: 'pointer',
                        position: 'relative',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                    whileHover={{ scale: 1.01, boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.2)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={copyPassword}
                >
                    <div style={{
                        fontSize: 18,
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: showPassword ? '2px' : '0.4em',
                        textAlign: 'center',
                        wordBreak: 'break-all',
                        filter: showPassword ? 'none' : 'blur(4px)',
                        transition: 'all 0.3s var(--ease-out-expo)',
                        color: '#00ff88',
                        textShadow: '0 0 20px rgba(0, 255, 136, 0.3)'
                    }}>
                        {password ? (showPassword ? password.password : '••••••••••••••••') : '••••••••••••••••'}
                    </div>
                </motion.div>

                {password && (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: getStrengthColor(password.strength.level), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {password.strength.level}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: getStrengthColor(password.strength.level) }}>
                                {getStrengthPercent(password.strength.level)}%
                            </span>
                        </div>
                        {/* Gradient Strength Bar */}
                        <div style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--bg-tertiary)',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${getStrengthPercent(password.strength.level)}%`,
                                height: '100%',
                                borderRadius: 4,
                                background: `linear-gradient(90deg, ${getStrengthColor(password.strength.level)} 0%, ${password.strength.level === 'strong' || password.strength.level === 'very-strong' ? 'var(--success-light)' : getStrengthColor(password.strength.level)} 100%)`,
                                boxShadow: password.strength.level === 'strong' || password.strength.level === 'very-strong' ? '0 0 12px rgba(16, 185, 129, 0.4)' : 'none',
                                transition: 'width 0.5s var(--ease-out-expo), box-shadow 0.3s ease'
                            }} />
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button className="ios-button button-primary" style={{ flex: 1 }} onClick={generatePassword} disabled={loading}>
                        {loading ? <span className="spinner-small" /> : <Zap size={16} fill="white" />}
                        {loading ? 'Generating...' : 'Regen'}
                    </button>
                    <button className="ios-button button-secondary" style={{ flex: 1 }} onClick={copyPassword}>
                        {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </div>

            {/* Configuration Card */}
            <div className="glass-card" style={{ marginTop: 16, padding: 20, cursor: 'default' }}>
                <div className="widget-label" style={{ marginBottom: 14 }}>
                    <Shield size={14} className="sf-icon" />
                    Complexity Settings
                </div>

                {/* Length Slider */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                        <span>Length</span>
                        <span style={{ color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>{options.length}</span>
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
