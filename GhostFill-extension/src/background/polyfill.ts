if (typeof globalThis.setImmediate === 'undefined') {
    // @ts-expect-error - setImmediate is not in the standard DOM types
    globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
        return setTimeout(callback, 0, ...args);
    });

    // @ts-expect-error - clearImmediate is not in the standard DOM types
    globalThis.clearImmediate = ((id: ReturnType<typeof setTimeout>) => {
        clearTimeout(id);
    });
}
