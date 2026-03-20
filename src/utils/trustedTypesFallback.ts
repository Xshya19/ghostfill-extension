// ─── Trusted Types default policy (web contexts) ─────────────────────────────
//
// Chrome enforces `require-trusted-types-for 'script'` from the manifest CSP on
// ALL extension pages (popup, content, options, offscreen).  Third-party libraries
// bundled into these pages (e.g. @noble/hashes) use:
//
//     const F = Function;
//     new F("");   // feature-detect JIT support
//
// That bare `new Function` string assignment is a Trusted Types "TrustedScript"
// sink.  The browser silently routes it through the 'default' policy — if one
// exists.  Without a default policy the browser throws and blocks the extension.
//
// This file MUST be the very first module executed in each web entry point.
// Webpack achieves this via the array form of `entry`:
//   popup: ['./src/utils/trustedTypesFallback.ts', './src/popup/index.tsx']
//
// See: https://developer.mozilla.org/en-US/docs/Web/API/TrustedTypePolicy
// See: https://w3c.github.io/trusted-types/#default-policy-hdr

interface GlobalWithTrustedTypes {
  trustedTypes?: {
    createPolicy: (
      name: string,
      rules: {
        createHTML: (s: string) => string;
        createScriptURL: (s: string) => string;
        createScript: (s: string) => string;
      }
    ) => void;
  };
}

{
  const g = globalThis as typeof globalThis & GlobalWithTrustedTypes;
  if (typeof g.trustedTypes !== 'undefined') {
    try {
      g.trustedTypes.createPolicy('default', {
        // Allow all HTML — DOMPurify already sanitises before it reaches sinks.
        createHTML: (s: string): string => s,
        // Allow all script URLs — extension pages only load from 'self'.
        createScriptURL: (s: string): string => s,
        // Allow all script strings — needed for @noble/* feature detection.
        createScript: (s: string): string => s,
      });
    } catch (_) {
      // createPolicy('default') throws if a default policy already exists.
      // This can happen if the module is somehow evaluated twice — safe to ignore.
    }
  }
}
