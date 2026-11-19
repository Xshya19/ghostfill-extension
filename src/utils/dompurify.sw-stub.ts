// Lightweight service-worker stub for DOMPurify (Service Workers have no DOM;
// sanitizeHtml in sanitization.core.ts falls back to its worker-safe regex scrubber).
const dompurifySwStub = {
  isSupported: false,
  sanitize(dirty: string): string {
    return typeof dirty === 'string' ? dirty : '';
  },
  addHook(): void {
    // no-op
  },
  removeAllHooks(): void {
    // no-op
  },
};

export default dompurifySwStub;
