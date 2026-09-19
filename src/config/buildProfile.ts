/**
 * The public distribution intentionally excludes real-mail OAuth integrations.
 * Webpack replaces this value at build time; Vitest falls back to the full
 * profile so existing integration tests retain their historical behavior.
 */
const configuredProfile =
  typeof __GHOSTFILL_BUILD_PROFILE__ === 'undefined' ? 'full' : __GHOSTFILL_BUILD_PROFILE__;

export const BUILD_PROFILE = configuredProfile === 'full' ? 'full' : 'public';
export const IS_GMAIL_ENABLED = BUILD_PROFILE === 'full';
