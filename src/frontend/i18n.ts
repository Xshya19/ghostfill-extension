import englishMessages from '../../public/_locales/en/messages.json';

/**
 * Read an extension locale message with a readable browser-preview fallback.
 * Chrome provides the authoritative translation in production; the fallback
 * keeps localhost visual regression builds useful without extension APIs.
 */
export function t(key: string): string {
  try {
    const translated = chrome?.i18n?.getMessage?.(key);
    if (translated) {
      return translated;
    }
  } catch {
    // Local previews intentionally run without the Chrome extension runtime.
  }

  const bundledFallback = (englishMessages as Record<string, { message?: string }>)[key]?.message;
  if (bundledFallback) {
    return bundledFallback;
  }

  const readable = key
    .replace(/Label$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1).toLowerCase() : key;
}
