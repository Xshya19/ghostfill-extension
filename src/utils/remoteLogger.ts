/**
 * Intercepts console logs and optionally forwards them to a developer-provided
 * endpoint. The extension should stay silent by default so MV3 CSP rules are
 * never tripped by localhost logging attempts.
 */
type RemoteLoggerConfig = {
    enabled?: boolean;
    url?: string;
};

type RemoteLoggerGlobal = typeof globalThis & {
    __GHOSTFILL_REMOTE_LOGGER__?: RemoteLoggerConfig;
};

let isInitialized = false;

function getRemoteLoggerUrl(): string | null {
    if (process.env.NODE_ENV !== 'development') {
        return null;
    }

    const config = (globalThis as RemoteLoggerGlobal).__GHOSTFILL_REMOTE_LOGGER__;
    if (!config?.enabled || !config.url) {
        return null;
    }

    try {
        const parsed = new URL(config.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

export function initRemoteLogger(sourceName: string) {
    if (isInitialized) {return;}

    const remoteLoggerUrl = getRemoteLoggerUrl();
    if (!remoteLoggerUrl) {return;}

    isInitialized = true;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    const serializeArgs = (args: any[]) => {
        return args.map(arg => {
            if (typeof arg === 'object') {
                if (arg instanceof Error) {
                    return arg.stack || arg.message;
                }
                try {
                    return JSON.stringify(arg, Object.getOwnPropertyNames(arg));
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    };

    const sendLog = (level: string, message: string) => {
        // Prevent infinite loops if the endpoint is unavailable.
        try {
            void fetch(remoteLoggerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: sourceName,
                    level,
                    message
                })
            }).catch(() => {});
        } catch (e) {
            // Silently fail to avoid infinite logging loops
        }
    };

    console.log = (...args: any[]) => {
        originalLog.apply(console, args);
        sendLog('LOG', serializeArgs(args));
    };

    console.info = (...args: any[]) => {
        originalInfo.apply(console, args);
        sendLog('INFO', serializeArgs(args));
    };

    console.warn = (...args: any[]) => {
        originalWarn.apply(console, args);
        sendLog('WARN', serializeArgs(args));
    };

    console.error = (...args: any[]) => {
        originalError.apply(console, args);
        sendLog('ERROR', serializeArgs(args));
    };
}
