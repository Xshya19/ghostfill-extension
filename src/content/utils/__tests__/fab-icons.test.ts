import { describe, expect, it } from 'vitest';

import { setHTML } from '../../../utils/setHTML';
import { IconSystem } from '../fab-icons';
import { menuIcon } from '../fab-menu-icons';

describe('FAB icon rendering', () => {
  it('keeps detailed SVG menu icons after sanitization', () => {
    const host = document.createElement('div');

    setHTML(host, `${menuIcon('spark')}<script>alert("x")</script>`);

    const icon = host.querySelector('svg.gf-menu-symbol');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('role')).toBe('presentation');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('script')).toBeNull();
  });

  it('does not duplicate role attributes on primary FAB icons', () => {
    const markup = IconSystem.get('magic');

    expect(markup.match(/\srole=/g) ?? []).toHaveLength(1);
    expect(markup).toContain('role="presentation"');
  });
});
