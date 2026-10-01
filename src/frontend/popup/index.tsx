import React from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../../shared/theme';
import { initRemoteLogger } from '../../utils/logger';
import { GlassFilterDefs } from '../ui/GlassFilterDefs';
import App from './App';
import './popup.css';
import '../styles/optical-glass.css';
import './popup-buttons.css';

initRemoteLogger('Popup');
initTheme();

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <GlassFilterDefs />
      <App />
    </React.StrictMode>
  );
}
