import React from 'react';
import { createRoot } from 'react-dom/client';

import { initTheme } from '../../shared/theme';
import { GlassFilterDefs } from '../ui/GlassFilterDefs';
import OptionsApp from './OptionsApp';
import './options.css';
import '../styles/optical-glass.css';

initTheme();

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
