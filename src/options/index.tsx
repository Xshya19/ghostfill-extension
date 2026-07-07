import React from 'react';
import { createRoot } from 'react-dom/client';

import { initTheme } from '../shared/theme';
import OptionsApp from './OptionsApp';
import './styles/options.css';

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
