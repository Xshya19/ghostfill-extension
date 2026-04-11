import React from 'react';
import { createRoot } from 'react-dom/client';
import { initRemoteLogger } from '../utils/remoteLogger';
import App from './App';
import './styles/popup.css';

initRemoteLogger('Popup');

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
