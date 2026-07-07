import { createLogger } from '../../utils/logger';

const log = createLogger('SafeStyles');

const createFallbackStyle = (): CSSStyleDeclaration => {
  return new Proxy(
    {
      getPropertyValue: (prop: string) => {
        const propStr = String(prop);
        if (propStr === 'display') {
          return 'none';
        }
        if (propStr === 'visibility') {
          return 'hidden';
        }
        if (propStr === 'opacity') {
          return '0';
        }
        if (propStr === 'z-index' || propStr === 'zIndex') {
          return '0';
        }
        return '';
      },
    },
    {
      get: (target, prop) => {
        if (prop === 'getPropertyValue') {
          return target.getPropertyValue;
        }
        const propStr = String(prop);
        if (propStr === 'display') {
          return 'none';
        }
        if (propStr === 'visibility') {
          return 'hidden';
        }
        if (propStr === 'opacity') {
          return '0';
        }
        if (propStr === 'zIndex' || propStr === 'z-index') {
          return '0';
        }
        return '';
      },
    }
  ) as unknown as CSSStyleDeclaration;
};

/**
 * Safely fetches computed style of an element.
 * Protects against Chromium pattern-attribute crash and prevents host page pollution
 * by avoiding overriding `window.getComputedStyle` globally.
 */
export function safeGetComputedStyle(el: Element, pseudoElt?: string | null): CSSStyleDeclaration {
  if (!el || typeof window === 'undefined') {
    return createFallbackStyle();
  }

  const originalGetComputedStyle = window.getComputedStyle;
  if (!originalGetComputedStyle) {
    return createFallbackStyle();
  }

  let style: CSSStyleDeclaration;
  try {
    style = originalGetComputedStyle(el, pseudoElt);
  } catch (e) {
    log.warn('window.getComputedStyle failed, using fallback:', e);
    return createFallbackStyle();
  }

  return new Proxy(style, {
    get(target, prop) {
      try {
        const val = Reflect.get(target, prop, target);
        if (typeof val === 'function') {
          return function (this: any, ...args: any[]) {
            try {
              return val.apply(target, args);
            } catch (err) {
              log.warn(`CSSStyleDeclaration method call for "${String(prop)}" failed:`, err);
              if (prop === 'getPropertyValue') {
                const propName = args[0];
                if (propName === 'display') {
                  return 'none';
                }
                if (propName === 'visibility') {
                  return 'hidden';
                }
                if (propName === 'opacity') {
                  return '0';
                }
                if (propName === 'z-index' || propName === 'zIndex') {
                  return '0';
                }
                return '';
              }
              return '';
            }
          };
        }
        return val;
      } catch (e) {
        log.warn(`CSSStyleDeclaration property access for "${String(prop)}" failed:`, e);
        const propStr = String(prop);
        if (propStr === 'display') {
          return 'none';
        }
        if (propStr === 'visibility') {
          return 'hidden';
        }
        if (propStr === 'opacity') {
          return '0';
        }
        if (propStr === 'zIndex' || propStr === 'z-index') {
          return '0';
        }
        return '';
      }
    },
  });
}
