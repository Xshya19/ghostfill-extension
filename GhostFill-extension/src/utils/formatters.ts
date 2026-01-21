// Data Formatters

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format password strength as text
 */
export function formatPasswordStrength(score: number): string {
    if (score < 20) return 'Very Weak';
    if (score < 40) return 'Weak';
    if (score < 60) return 'Fair';
    if (score < 80) return 'Strong';
    return 'Very Strong';
}

/**
 * Format crack time estimate
 */
export function formatCrackTime(seconds: number): string {
    if (seconds < 1) return 'instant';
    if (seconds < 60) return `${Math.floor(seconds)} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months`;
    if (seconds < 3153600000) return `${Math.floor(seconds / 31536000)} years`;
    if (seconds < 3153600000000) return `${Math.floor(seconds / 3153600000)} centuries`;
    return 'forever';
}

/**
 * Format email address for display (truncate if too long)
 */
export function formatEmailDisplay(email: string, maxLength: number = 30): string {
    if (email.length <= maxLength) return email;

    const [local, domain] = email.split('@');
    if (!domain) return email.substring(0, maxLength) + '...';

    const availableForLocal = maxLength - domain.length - 4; // 4 for "...@"
    if (availableForLocal < 3) {
        return email.substring(0, maxLength - 3) + '...';
    }

    return local.substring(0, availableForLocal) + '...@' + domain;
}

/**
 * Format date for display
 */
export function formatDate(timestamp: number | string | Date): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Format time for display
 */
export function formatTime(timestamp: number | string | Date): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Format date and time for display
 */
export function formatDateTime(timestamp: number | string | Date): string {
    return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(timestamp: number): string {
    // Check for invalid, zero, or future formatting issues
    if (!timestamp || timestamp <= 0) return 'just now';

    const now = Date.now();
    const diff = now - timestamp;

    // Handle future dates or clock skew
    if (diff < 0) return 'just now';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) return formatDate(timestamp);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    if (seconds > 10) return `${seconds}s ago`;
    return 'just now';
}

/**
 * Format OTP for display (add spaces for readability)
 */
export function formatOTP(otp: string): string {
    // If it's 6 digits, format as 123 456
    if (/^\d{6}$/.test(otp)) {
        return otp.substring(0, 3) + ' ' + otp.substring(3);
    }
    // If it's 8 digits, format as 1234 5678
    if (/^\d{8}$/.test(otp)) {
        return otp.substring(0, 4) + ' ' + otp.substring(4);
    }
    return otp;
}

/**
 * Format domain for display (remove www)
 */
export function formatDomain(domain: string): string {
    return domain.replace(/^www\./i, '');
}

/**
 * Mask password for display
 */
export function maskPassword(password: string, showFirst: number = 2, showLast: number = 2): string {
    if (password.length <= showFirst + showLast + 2) {
        return '•'.repeat(password.length);
    }

    const first = password.substring(0, showFirst);
    const last = password.substring(password.length - showLast);
    const middle = '•'.repeat(Math.min(password.length - showFirst - showLast, 8));

    return first + middle + last;
}

/**
 * Format entropy in bits
 */
export function formatEntropy(entropy: number): string {
    return `${Math.round(entropy)} bits`;
}

/**
 * Pluralize a word
 */
export function pluralize(count: number, singular: string, plural?: string): string {
    if (count === 1) return singular;
    return plural || singular + 's';
}

/**
 * Extract OTP/verification code from text
 * Finds 4-8 digit codes commonly used for verification
 */
export function extractOTP(text: string): string | null {
    if (!text) return null;
    const match = text.match(/\b(\d{4,8})\b/);
    return match ? match[1] : null;
}

/**
 * Extract activation/verification link from email body
 * Matches common verification URL patterns
 */
export function extractActivationLink(text: string): string | null {
    if (!text) return null;
    const linkMatch = text.match(
        /https?:\/\/[^\s<>"']+(?:verify|confirm|activate|token|auth|click|register|validate|approve|accept|complete|signup)[^\s<>"']*/i
    );
    return linkMatch ? linkMatch[0] : null;
}

