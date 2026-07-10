import React from 'react';
import { createRoot } from 'react-dom/client';

import { initTheme } from '../shared/theme';
import OptionsApp from './OptionsApp';
import './styles/options.css';
import '../shared/styles/spectre-v2.css';
import './styles/options-v2.css';

initTheme();

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <OptionsApp />
    </React.StrictMode>
  );
}
