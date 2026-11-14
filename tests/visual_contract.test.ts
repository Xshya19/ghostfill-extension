import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IconSystem, menuIcon, type ButtonMode, type MenuIconName } from '../src/shared/icons';
import { generateHostTokens } from '../src/shared/theme';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('GhostFill visual contract', () => {
  it('lets inbox rows retain their content height inside a scrolling flex list', () => {
    const css = readSource('src/frontend/popup/popup.css');
    expect(css).toMatch(/\.inbox-item,\s*\.inbox-item-default\s*{[^}]*flex-shrink:\s*0;/);
  });
  it('uses one custom SVG language for every floating-button mode', () => {
    const modes: ButtonMode[] = ['magic', 'email', 'password', 'otp', 'user', 'form'];

    for (const mode of modes) {
      const icon = IconSystem.get(mode);
      expect(icon).toContain('class="gf-fab-symbol"');
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(icon).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('keeps the contextual FAB menu icons in the same restrained visual language', () => {
    const names: MenuIconName[] = [
      'spark',
      'key',
      'mail',
      'lock',
      'user',
      'users',
      'edit',
      'mask',
      'clear',
      'chart',
      'settings',
    ];

    for (const name of names) {
      const icon = menuIcon(name);
      expect(icon).toContain('class="gf-menu-symbol"');
      expect(icon).toContain('class="gf-menu-symbol__plate"');
      expect(icon).not.toContain('#FFFDF6');
      expect(icon).not.toContain('#181818');
    }
  });

  it('keeps popup alignment on a shared gutter and compact vertical rhythm', () => {
    const css = readSource('src/frontend/popup/popup.css');

    expect(css).toContain('--popup-gutter: 16px;');
    expect(css).toContain('--popup-gap: var(--gf-panel-gap);');
    expect(css).not.toContain('var(--shadow-sm)');
    expect(css).not.toContain('var(--shadow-md)');
    expect(css).not.toContain('var(--gf-accent-rgb)');
    expect(css).toMatch(
      /\.ghost-dashboard,[\s\S]*?padding:\s*var\(--popup-gap\) var\(--popup-gutter\)/
    );
    expect(css).toMatch(/\.inbox-list > \.hub-empty-state\s*{[\s\S]*?flex:\s*1/);
    expect(css).toMatch(
      /\.ghost-dashboard,[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?scrollbar-gutter:\s*auto;/
    );
  });

  it('reserves enough popup height for a complete populated inbox row', () => {
    const css = readSource('src/frontend/popup/popup.css');
    const composition = css.slice(css.indexOf('POPUP COMPOSITION'));

    expect(composition).toMatch(
      /\.ghost-dashboard\s*{[\s\S]*?padding:\s*8px var\(--popup-gutter\) 10px;/
    );
    expect(composition).toMatch(
      /\.identity-row\s*{[^}]*min-height:\s*56px;[^}]*padding:\s*6px 8px 6px 12px;/
    );
    expect(composition).toMatch(
      /\.inbox-section\s*{[\s\S]*?gap:\s*var\(--space-1\);[\s\S]*?padding:\s*8px 10px;/
    );
    expect(composition).toMatch(
      /ACCESSIBLE HIT AREAS[\s\S]*?\.identity-actions\s*{\s*min-height:\s*44px;/
    );
    expect(composition).toMatch(
      /\.identity-actions \.action-icon,[\s\S]*?\.view-all-btn,[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
    );
    expect(css).toMatch(/\.otp-badge,\s*\.link-badge\s*{\s*min-height:\s*28px;/);
  });

  it('renders identity controls as a single aligned action dock', () => {
    const css = readSource('src/frontend/popup/popup.css');

    expect(css).toMatch(/\.identity-actions\s*{[\s\S]*?padding:\s*2px/);
    expect(css).toMatch(/\.identity-actions \.action-icon\s*{[\s\S]*?border:\s*0/);
  });

  it('keeps the FAB compact with passive decorative layers', () => {
    const css = readSource('src/content/floatingButton.shadow.css');

    expect(css).toMatch(/\.gf-fab\s*{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
    expect(css).toMatch(/\.gf-fab::after\s*{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.gf-fab\.gf-quiet::after\s*{\s*content:\s*none/);
    expect(css).toMatch(/\.gf-menu\s*{[\s\S]*?width:\s*236px/);
    expect(css).not.toContain('gf-emoji-icon');
  });

  it('shares the Private Workspace geometry across popup, options, and primitives', () => {
    const globals = readSource('src/frontend/styles/globals.css');
    const options = readSource('src/frontend/options/options.css');
    const popup = readSource('src/frontend/popup/popup.css');

    expect(globals).toContain('--gf-panel-radius: 16px;');
    expect(globals).toContain('--gf-control-radius: 10px;');
    expect(options).toContain('background: var(--gf-surface);');
    expect(options).toContain("@import '../styles/globals.css';");
    expect(options).toContain('min-height: var(--gf-control-h);');
    expect(options).toMatch(/@media \(max-width: 560px\)[\s\S]*?--gutter:\s*16px;/);
    expect(popup).toContain('border-radius: var(--gf-panel-radius);');
    expect(popup).toContain('border-radius: var(--gf-control-radius);');
  });

  it('keeps the shadow-dom FAB self-contained on arbitrary host pages', () => {
    const css = readSource('src/content/floatingButton.shadow.css');
    const tokens = generateHostTokens().toLowerCase();
    const fab = readSource('src/content/floatingButton.ts');

    expect(fab).toContain('generateHostThemeStyles()');
    expect(tokens).toContain('--gf-surface: #2c2c2e;');
    expect(tokens).toContain('--gf-primary-rgb: 10, 132, 255;');
    expect(tokens).toContain('--gf-font-mono:');
    expect(css).toContain('--fab-accent: var(--gf-primary);');
    expect(tokens).toContain('--gf-mint: #30d158;');
    expect(tokens).toContain('--gf-amber: #ff9f0a;');
    expect(tokens).toContain('--gf-grad-cobalt: #0066cc;');
    expect(tokens).toContain('--gf-grad-mint: #30d158;');
    expect(tokens).toContain('--gf-grad-coral: #d70015;');
  });

  it('uses the same semantic accents for in-page field feedback', () => {
    const css = readSource('src/content/styles/content.css');
    const status = readSource('src/content/ui/pageStatus.ts');

    expect(status).toContain('generateHostThemeStyles()');
    expect(status).toContain('color: var(--gf-primary);');
    expect(status).toContain('color: var(--gf-mint-text);');
    expect(status).toContain('color: var(--gf-coral-text);');
    expect(css).not.toMatch(/--gf-cc-/);
    expect(css).not.toContain('#5b54e8');
    expect(css).not.toContain('#0a9d72');
  });

  it('exports the same geometry tokens into shadow-dom content UI', () => {
    const hostTokens = generateHostTokens();

    expect(hostTokens).toContain('--gf-panel-radius: 16px;');
    expect(hostTokens).toContain('--gf-control-radius: 10px;');
    expect(hostTokens).toContain('--gf-control-h: 44px;');
  });

  it('keeps interactive semantics unique across options and inbox surfaces', () => {
    const optionsApp = readSource('src/frontend/options/OptionsApp.tsx');
    const optionsTabs = readSource('src/frontend/options/components/OptionsTabs.tsx');
    const inbox = readSource('src/frontend/popup/components/EmailGenerator.tsx');

    expect(optionsApp).toContain('role="tabpanel"');
    expect(optionsTabs).not.toContain('role="tabpanel"');
    expect(inbox).toContain('className="inbox-item-open-button"');
    expect(inbox).not.toContain('className="inbox-item"\n                          role="button"');
  });

  it('keeps Gmail-only inbox errors out of the Temp mail empty state', () => {
    const sharedComponents = readSource('src/frontend/popup/components/SharedComponents.tsx');
    const hub = readSource('src/frontend/popup/components/Hub.tsx');

    expect(sharedComponents).toMatch(/preferredEmailType === 'gmail'\s*&&\s*gmailInboxError\s*&&/);
    expect(hub).toContain('gmailInboxRequestSeqRef.current += 1;');
    expect(hub).toContain('setGmailInboxError(null);');
  });

  it('persists OTPs extracted from the popup inbox for the floating fill action', () => {
    const popupHooks = readSource('src/frontend/popup/hooks.ts');

    expect(popupHooks).toContain('saveToLastOTP: true');
    expect(popupHooks).not.toContain('saveToLastOTP: false');
  });

  it('keeps the command palette and quiet FAB keyboard-safe', () => {
    const optionsApp = readSource('src/frontend/options/OptionsApp.tsx');
    const fabCss = readSource('src/content/floatingButton.shadow.css');
    const eslint = readSource('.eslintrc.cjs');

    expect(optionsApp).toContain('role="combobox"');
    expect(optionsApp).toContain('aria-activedescendant');
    expect(optionsApp).toContain('useSiblingIsolation(isOpen, overlayRef)');
    // Quiet mode inherits the base target instead of repeating or shrinking it.
    expect(fabCss).toMatch(/\.gf-fab\s*{[^}]*width:\s*44px;\s*height:\s*44px/);
    expect(fabCss.match(/\.gf-fab\.gf-quiet\s*{([^}]*)}/)?.[1]).not.toMatch(/(?:width|height):/);
    expect(fabCss).toContain('.gf-fab.gf-quiet:focus-visible');
    expect(eslint).toContain("'plugin:jsx-a11y/recommended'");
  });
});
