// ─── Trusted Types default policy (safety-net) ────────────────────
// Chrome enforces `require-trusted-types-for 'script'` from the
// manifest CSP on the service worker too.  Webpack creates its own
// named policy for chunk-loading, but any OTHER code that touches a
// Trusted-Types-guarded sink (setTimeout with strings, eval, etc.)
// would still throw.  The 'default' policy is the browser's built-in
// fallback — it is invoked automatically whenever an untrusted string
// is assigned to a sink and no named policy was used.
{
  interface GlobalWithTrustedTypes {
    trustedTypes?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createPolicy: (name: string, rules: any) => void;
    };
    setImmediate?: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
    clearImmediate?: (id: ReturnType<typeof setTimeout>) => void;
  }
  const g = globalThis as unknown as GlobalWithTrustedTypes;
  if (typeof g.trustedTypes !== 'undefined') {
    try {
      g.trustedTypes.createPolicy('default', {
        createHTML: (s: string) => s,
        createScriptURL: (s: string) => s,
        createScript: (s: string) => s,
      });
    } catch (_) {
      // Policy may already exist
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g2 = globalThis as any;
  g2.setImmediate = (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    return setTimeout(callback, 0, ...args);
  };

  g2.clearImmediate = (id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id);
  };
}
