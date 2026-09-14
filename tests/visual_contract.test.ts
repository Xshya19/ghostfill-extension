import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IconSystem, menuIcon, type ButtonMode, type MenuIconName } from '../src/shared/icons';
import { generateHostTokens } from '../src/shared/theme';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('GhostFill visual contract', () => {
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

    expect(css).toContain('--popup-gutter: 14px;');
    expect(css).toContain('--popup-gap: var(--gf-panel-gap);');
    expect(css).not.toContain('var(--shadow-sm)');
    expect(css).not.toContain('var(--shadow-md)');
    expect(css).not.toContain('var(--gf-accent-rgb)');
    expect(css).toMatch(
      /\.ghost-dashboard,[\s\S]*?padding:\s*var\(--popup-gap\) var\(--popup-gutter\)/
    );
    expect(css).toMatch(/\.inbox-list > \.hub-empty-state\s*{[\s\S]*?flex:\s*1/);
    expect(css).toMatch(
      /\.ghost-dashboard,[\s\S]*?scrollbar-gutter:\s*auto;[\s\S]*?transform:\s*translateZ\(0\)/
    );
  });

  it('renders identity controls as a single aligned action dock', () => {
    const css = readSource('src/frontend/popup/popup.css');

    expect(css).toMatch(/\.identity-actions\s*{[\s\S]*?padding:\s*2px/);
    expect(css).toMatch(/\.identity-actions \.action-icon\s*{[\s\S]*?border:\s*0/);
  });

  it('keeps the FAB compact and removes decorative status noise', () => {
    const css = readSource('src/content/floatingButton.shadow.css');

    expect(css).toMatch(/\.gf-fab\s*{[\s\S]*?width:\s*44px;\s*height:\s*44px/);
    expect(css).toMatch(/\.gf-fab::after\s*{[\s\S]*?display:\s*none/);
    expect(css).toMatch(/\.gf-menu\s*{[\s\S]*?width:\s*236px/);
    expect(css).not.toContain('gf-emoji-icon');
  });

  it('shares the Spectre geometry across popup, options, and primitives', () => {
    const globals = readSource('src/frontend/styles/globals.css');
    const options = readSource('src/frontend/options/options.css');
    const popup = readSource('src/frontend/popup/popup.css');

    expect(globals).toContain('--gf-panel-radius: 14px;');
    expect(globals).toContain('--gf-control-radius: 10px;');
    expect(options).toContain('background: var(--gf-surface);');
    expect(options).toContain('border-radius: var(--gf-panel-radius);');
    expect(options).toContain('min-height: var(--gf-control-h);');
    expect(options).toMatch(/@media \(max-width: 560px\)[\s\S]*?--gutter:\s*16px;/);
    expect(popup).toContain('border-radius: var(--gf-panel-radius);');
    expect(popup).toContain('border-radius: var(--gf-control-radius);');
  });

  it('keeps the shadow-dom FAB self-contained on arbitrary host pages', () => {
    const css = readSource('src/content/floatingButton.shadow.css');

    expect(css).toContain('--gf-surface: #141820;');
    expect(css).toContain('--gf-primary-rgb: 129, 140, 248;');
    expect(css).toContain('--gf-font-mono:');
    expect(css).toContain('--fab-accent: var(--gf-primary);');
    expect(css).toContain('--fab-accent: var(--gf-mint);');
    expect(css).toContain('--fab-accent: var(--gf-amber);');
    expect(css).toContain('--gf-grad-cobalt: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);');
    expect(css).toContain('--gf-grad-mint: linear-gradient(180deg, #34d399 0%, #10b981 100%);');
    expect(css).toContain('--gf-grad-coral: linear-gradient(180deg, #f87171 0%, #ef4444 100%);');
    expect(css).toContain('local Spectre palette');
  });

  it('uses the same semantic accents for in-page field feedback', () => {
    const css = readSource('src/content/styles/content.css');

    expect(css).toContain('--gf-cc-iris: #818cf8;');
    expect(css).toContain('--gf-cc-mint: #34d399;');
    expect(css).toContain('--gf-cc-amber: #fbbf24;');
    expect(css).toContain('--gf-cc-coral: #f87171;');
    expect(css).not.toContain('#5b54e8');
    expect(css).not.toContain('#0a9d72');
  });

  it('exports the same geometry tokens into shadow-dom content UI', () => {
    const hostTokens = generateHostTokens();

    expect(hostTokens).toContain('--gf-panel-radius: 14px;');
    expect(hostTokens).toContain('--gf-control-radius: 10px;');
    expect(hostTokens).toContain('--gf-control-h: 36px;');
  });
});
