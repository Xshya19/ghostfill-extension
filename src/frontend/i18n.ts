import englishMessages from '../../public/_locales/en/messages.json';

/**
 * Read an extension locale message with a readable browser-preview fallback.
 * Chrome provides the authoritative translation in production; the fallback
 * keeps localhost visual regression builds useful without extension APIs.
 *
 * `substitutions` feeds Chrome's positional placeholders ($1, $2, …) so
 * interpolated copy can stay localized without string concatenation.
 */
export function t(key: string, substitutions?: string | string[]): string {
  try {
    const translated = chrome?.i18n?.getMessage?.(key, substitutions);
    if (translated) {
      return translated;
    }
  } catch {
    // Local previews intentionally run without the Chrome extension runtime.
  }

  const bundledFallback = (englishMessages as Record<string, { message?: string }>)[key]?.message;
  if (bundledFallback) {
    return applySubstitutions(bundledFallback, substitutions);
  }

  const readable = key
    .replace(/Label$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1).toLowerCase() : key;
}

/** Replace Chrome positional placeholders ($1..$9) in a bundled message. */
function applySubstitutions(message: string, substitutions?: string | string[]): string {
  if (substitutions === undefined) {
    return message;
  }
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
  return message.replace(/\$(\d+)/g, (match, index: string) => {
    const value = subs[Number(index) - 1];
    return value ?? match;
  });
}
