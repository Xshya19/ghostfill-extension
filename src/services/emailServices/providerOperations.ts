/** Bound a complete operation, including streamed JSON/text after headers arrive. */
export function runBoundedProviderOperation<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 7000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const controller = new AbortController();
    let settled = false;
    const finish = (error: unknown, result?: T) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error !== undefined) {
        reject(error);
      } else {
        resolve(result as T);
      }
    };
    const onAbort = () => {
      finish(new DOMException('Aborted', 'AbortError'));
      controller.abort();
    };
    const timer = setTimeout(() => {
      const error = new Error(`Provider operation timed out after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      finish(error);
      controller.abort();
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Defer start so synchronous work errors are also observed and cleaned up.
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return work(controller.signal);
      })
      .then(
        (result) => finish(undefined, result),
        (error) => finish(error)
      );
  });
}
