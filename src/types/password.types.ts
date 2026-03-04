// Password Types

export interface PasswordOptions {
    length: number;
    uppercase: boolean;
    lowercase: boolean;
    numbers: boolean;
    symbols: boolean;
    excludeAmbiguous: boolean;
    excludeSimilar: boolean;
    customCharset?: string;
    minUppercase?: number;
    minLowercase?: number;
    minNumbers?: number;
    minSymbols?: number;
}

export interface PasswordStrength {
    score: number; // 0-100
    level: 'weak' | 'fair' | 'good' | 'strong' | 'very-strong';
    entropy: number;
    crackTime: string;
    suggestions: string[];
}

export interface GeneratedPassword {
    password: string;
    strength: PasswordStrength;
    options: PasswordOptions;
    generatedAt: number;
}

export interface PasswordHistoryItem {
    id: string;
    password: string; // Encrypted or base64 encoded
    website: string;
    favicon?: string;
    createdAt: number;
    strength: number;
    notes?: string;
    encrypted?: boolean; // Flag to indicate if password is encrypted
}

export interface PasswordPreset {
    id: string;
    name: string;
    icon: string;
    options: PasswordOptions;
}

export const PASSWORD_PRESETS: PasswordPreset[] = [
    {
        id: 'standard',
        name: 'Standard',
        icon: '🔐',
        options: {
            length: 16,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            excludeAmbiguous: false,
            excludeSimilar: false,
            minNumbers: 2,
            minSymbols: 2,
            minUppercase: 1,
            minLowercase: 1,
        },
    },
    {
        id: 'strong',
        name: 'Strong',
        icon: '🛡️',
        options: {
            length: 24,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            excludeAmbiguous: true,
            excludeSimilar: false,
            minNumbers: 2,
            minSymbols: 2,
            minUppercase: 1,
            minLowercase: 1,
        },
    },
    {
        id: 'pin',
        name: 'PIN',
        icon: '🔢',
        options: {
            length: 6,
            uppercase: false,
            lowercase: false,
            numbers: true,
            symbols: false,
            excludeAmbiguous: false,
            excludeSimilar: false,
        },
    },
    {
        id: 'passphrase',
        name: 'Passphrase',
        icon: '📝',
        options: {
            length: 32,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: false,
            excludeAmbiguous: true,
            excludeSimilar: true,
        },
    },
    {
        id: 'maximum',
        name: 'Maximum',
        icon: '⚡',
        options: {
            length: 64,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
            excludeAmbiguous: true,
            excludeSimilar: true,
            minNumbers: 2,
            minSymbols: 2,
            minUppercase: 1,
            minLowercase: 1,
        },
    },
];

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
    excludeSimilar: false,
    minNumbers: 2,
    minSymbols: 2,
    minUppercase: 1, // Ensures at least 2 letters total (1 upper + 1 lower)
    minLowercase: 1,
};

export const CHARACTER_SETS = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#?$%^&*()-_=+{};:,<.>', // Updated to user's specific list
    ambiguous: '0O1lI',
    similar: '{}[]()',
};
