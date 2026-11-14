import React from 'react';
import { createRoot } from 'react-dom/client';

import { initTheme } from '../../shared/theme';
import { GlassFilterDefs } from '../ui/GlassFilterDefs';
import OptionsApp from './OptionsApp';
import './options.css';
import '../styles/optical-glass.css';

/**
 * Screen readers announce a page in the document language. Chrome translates
 * the interface, so the document must follow the browser locale instead of
 * the static `lang="en"` of the HTML shell. Local previews and tests run
 * without the extension runtime, hence the fallbacks.
 */
export const resolveDocumentLanguage = (): string => {
  try {
    const uiLanguage = chrome?.i18n?.getUILanguage?.();
    if (uiLanguage) {
      return uiLanguage;
    }
  } catch {
    // No Chrome extension runtime available.
  }
  return navigator.language || 'en';
};

/** Apply the UI locale to the document (must run from bundled code: the
 * manifest CSP forbids inline scripts). */
export const applyDocumentLanguage = (): void => {
  document.documentElement.lang = resolveDocumentLanguage();
};

initTheme();
applyDocumentLanguage();

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <GlassFilterDefs />
      <OptionsApp />
    </React.StrictMode>
  );
}
