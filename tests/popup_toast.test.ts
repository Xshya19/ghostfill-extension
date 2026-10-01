import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toast } from '../src/frontend/ui';

describe('popup toast', () => {
  it('does not render an empty pill after its message clears', () => {
    expect(renderToStaticMarkup(React.createElement(Toast, { message: null }))).not.toContain(
      'class="gf-toast"'
    );
    expect(renderToStaticMarkup(React.createElement(Toast, { message: 'Copied' }))).toContain(
      'Copied'
    );
  });
});
