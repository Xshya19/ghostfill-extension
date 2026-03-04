/**
 * PERFORMANCE OPTIMIZED: Debounce and Throttle Utilities
 * 
 * Optimizations:
 * ✓ Cancelable timers
 * ✓ Immediate execution option (leading edge)
 * ✓ Function context and arguments preservation
 * ✓ Memory-efficient timer storage
 */

interface DebounceOptions {
    leading?: boolean;  // Execute on leading edge
    trailing?: boolean; // Execute on trailing edge
    maxWait?: number;   // Maximum wait time before forced execution
}

interface DebouncedFunction<F extends (...args: unknown[]) => unknown> {
    (...args: Parameters<F>): ReturnType<F> | undefined;
    cancel: () => void;
    flush: (...args: Parameters<F>) => ReturnType<F> | undefined;
    isPending: () => boolean;
}

/**
 * PERFORMANCE: Creates a debounced function that delays execution
 */
export function debounce<F extends (...args: unknown[]) => unknown>(
    func: F,
    wait: number,
    options: DebounceOptions = {}
): DebouncedFunction<F> {
    const { leading = false, trailing = true, maxWait } = options;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<F> | null = null;
    let lastCallTime: number = 0;
    let lastInvokeTime = 0;
    let leadingCalled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastThis: any = null;

    function shouldInvoke(time: number): boolean {
        if (lastCallTime === 0) {return true;}

        const timeSinceLastCall = time - lastCallTime;
        const timeSinceLastInvoke = time - lastInvokeTime;

        return (
            lastCallTime === 0 ||
            timeSinceLastCall >= wait ||
            timeSinceLastCall < 0 ||
            (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
        );
    }

    function invokeFunc(time: number): ReturnType<F> | undefined {
        const args = lastArgs;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const thisArg: any = lastThis;

        lastArgs = lastThis = null;
        lastInvokeTime = time;
        leadingCalled = false;

        if (args === null) {return undefined;}

        return func.apply(thisArg, args) as ReturnType<F>;
    }

    function timerExpired(): ReturnType<F> | undefined {
        const time = Date.now();

        if (shouldInvoke(time)) {
            return trailingInvoke(time);
        }

        const timeSinceLastCall = time - lastCallTime;
        const timeSinceLastInvoke = time - lastInvokeTime;
        const remaining = wait - timeSinceLastCall;

        const adjustedWait = maxWait !== undefined
            ? Math.min(remaining, maxWait - timeSinceLastInvoke)
            : remaining;

        timeoutId = setTimeout(timerExpired, adjustedWait);
        return undefined;
    }

    function trailingInvoke(time: number): ReturnType<F> | undefined {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        return invokeFunc(time);
    }

    function leadingInvoke(time: number): ReturnType<F> | undefined {
        leadingCalled = true;
        lastInvokeTime = time;

        if (timeoutId === null && trailing) {
            timeoutId = setTimeout(timerExpired, wait);
        }

        return invokeFunc(time);
    }

    function debounced(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): ReturnType<F> | undefined {
        const time = Date.now();
        const isInvoking = shouldInvoke(time);

        lastArgs = args;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastThis = this;
        lastCallTime = time;

        if (isInvoking) {
            if (timeoutId === null && leadingCalled) {
                if (trailing) {
                    timeoutId = setTimeout(timerExpired, wait);
                }
                return invokeFunc(lastCallTime);
            }

            if (leading) {
                return leadingInvoke(lastCallTime);
            } else if (trailing) {
                if (timeoutId === null) {
                    timeoutId = setTimeout(timerExpired, wait);
                }
                return invokeFunc(lastCallTime);
            }
        }

        if (timeoutId === null && trailing) {
            timeoutId = setTimeout(timerExpired, wait);
        }

        return undefined;
    }

    debounced.cancel = function(): void {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        lastArgs = lastThis = null;
        lastCallTime = lastInvokeTime = 0;
        leadingCalled = false;
    };

    debounced.flush = function(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): ReturnType<F> | undefined {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        lastArgs = args;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastThis = this;
        lastCallTime = lastInvokeTime = Date.now();
        return func.apply(this, args) as ReturnType<F>;
    };

    debounced.isPending = function(): boolean {
        return timeoutId !== null;
    };

    return debounced as DebouncedFunction<F>;
}

/**
 * PERFORMANCE: Creates a throttled function that limits execution rate
 */
export function throttle<F extends (...args: unknown[]) => unknown>(
    func: F,
    limit: number,
    options: { leading?: boolean; trailing?: boolean } = {}
): DebouncedFunction<F> {
    const { leading = true, trailing = true } = options;

    let inThrottle = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<F> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastThis: any = null;
    let result: ReturnType<F> | undefined;

    function throttled(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): ReturnType<F> | undefined {
        lastArgs = args;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastThis = this;

        if (!inThrottle) {
            if (leading) {
                result = func.apply(this, args) as ReturnType<F>;
                inThrottle = true;

                if (trailing) {
                    timeoutId = setTimeout(() => {
                        inThrottle = false;
                        if (lastArgs && trailing) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            result = func.apply(lastThis as any, lastArgs) as ReturnType<F>;
                        }
                        lastArgs = lastThis = null;
                    }, limit);
                } else {
                    timeoutId = setTimeout(() => {
                        inThrottle = false;
                    }, limit);
                }
            } else if (trailing) {
                timeoutId = setTimeout(() => {
                    inThrottle = false;
                    result = func.apply(this, args) as ReturnType<F>;
                }, limit);
            }
        }

        return result;
    }

    throttled.cancel = function(): void {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        inThrottle = false;
        lastArgs = lastThis = null;
    };

    throttled.flush = function(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): ReturnType<F> | undefined {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        inThrottle = false;
        return func.apply(this, args) as ReturnType<F>;
    };

    throttled.isPending = function(): boolean {
        return timeoutId !== null || inThrottle;
    };

    return throttled as DebouncedFunction<F>;
}

/**
 * PERFORMANCE: Request Animation Frame based debounce for UI updates
 */
export function rafDebounce<F extends (...args: unknown[]) => unknown>(
    func: F
): DebouncedFunction<F> {
    let rafId: number | null = null;
    let lastArgs: Parameters<F> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastThis: any = null;

    function debounced(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): void {
        lastArgs = args;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastThis = this;

        if (rafId !== null) {
            cancelAnimationFrame(rafId);
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (lastArgs) {
                func.apply(lastThis as ThisParameterType<F>, lastArgs);
            }
        });
    }

    debounced.cancel = function(): void {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastArgs = lastThis = null;
    };

    debounced.flush = function(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias
        this: any,
        ...args: Parameters<F>
    ): ReturnType<F> | undefined {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        return func.apply(this, args) as ReturnType<F>;
    };

    debounced.isPending = function(): boolean {
        return rafId !== null;
    };

    return debounced as DebouncedFunction<F>;
}
