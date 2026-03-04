import React from 'react';
import { createRoot } from 'react-dom/client';

import OptionsApp from './OptionsApp';
import './styles/options.css';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <OptionsApp />
        </React.StrictMode>
    );
}
