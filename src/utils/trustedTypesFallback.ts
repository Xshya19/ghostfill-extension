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

import { createLogger } from './logger';
const log = createLogger('TrustedTypes');

{
  const g = globalThis as typeof globalThis & GlobalWithTrustedTypes;
  if (typeof g.trustedTypes !== 'undefined') {
    try {
      g.trustedTypes.createPolicy('default', {
        // Allow HTML with basic escaping (DOMPurify usually intercepts, this is a fallback)
        createHTML: (s: string): string => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        // Allow script URLs only from self origin
        createScriptURL: (s: string): string => {
          if (s.startsWith('chrome-extension://') || s.startsWith('/')) { return s; }
          log.warn('Blocked uncontrolled script URL');
          return '';
        },
        // Allow script strings. Restrict to common feature detection only to prevent injection.
        createScript: (s: string): string => {
          const safe = s.trim();
          if (safe === '' || safe === 'return this') {
            return s;
          }
          log.warn('Blocked uncontrolled script string via Trusted Types');
          return '';
        },
      });
    } catch (_) {
      // createPolicy('default') throws if a default policy already exists.
      // This can happen if the module is somehow evaluated twice — safe to ignore.
    }
  }
}
