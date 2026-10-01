/**
 * GhostFill shared SVG Icon System and menu symbols.
 */
export type ButtonMode = 'magic' | 'email' | 'password' | 'otp' | 'user' | 'form';

const TOKENS = {
  iris: 'var(--gf-primary, #7c83ff)',
  irisDeep: 'var(--gf-primary-deep, #4f55d6)',
  mint: 'var(--gf-mint, #36d6a8)',
  coral: 'var(--gf-coral, #ff6b6b)',
} as const;

const STROKE = '1.8';

export const SHARED_SVG_DEFS = '';

const fabIcon = (body: string): string =>
  `<svg class="gf-fab-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const ICONS: Readonly<Record<ButtonMode, string>> = {
  magic: fabIcon(`
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/>
    <path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M18 17h4"/>
  `),

  email: fabIcon(`
    <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/>
    <rect x="2" y="4" width="20" height="16" rx="2"/>
  `),

  password: fabIcon(`
    <circle cx="12" cy="16" r="1"/>
    <rect x="3" y="10" width="18" height="12" rx="2"/>
    <path d="M7 10V7a5 5 0 0 1 10 0v3"/>
  `),

  otp: fabIcon(`
    <line x1="4" x2="20" y1="9" y2="9"/>
    <line x1="4" x2="20" y1="15" y2="15"/>
    <line x1="10" x2="8" y1="3" y2="21"/>
    <line x1="16" x2="14" y1="3" y2="21"/>
  `),

  user: fabIcon(`
    <circle cx="12" cy="8" r="5"/>
    <path d="M20 21a8 8 0 0 0-16 0"/>
  `),

  form: fabIcon(`
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="M12 11h4M12 16h4"/>
    <path d="M8 11h.01M8 16h.01"/>
  `),
};

export class IconSystem {
  static get(mode: ButtonMode): string {
    const icon: string = ICONS[mode] || ICONS.magic;
    if (/\srole=/.test(icon)) {
      return icon;
    }
    return icon.replace('<svg ', '<svg role="presentation" ');
  }

  static getSpinner(): string {
    return `<svg class="gf-loading-spinner" viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="${TOKENS.iris}" stroke-width="2" opacity="0.18"/>
      <path d="M12 3 a 9 9 0 0 1 9 9" stroke="${TOKENS.iris}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>`;
  }

  static getSuccess(): string {
    return `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="${TOKENS.mint}" stroke-width="1.8"/>
      <path d="m9 12 2 2 4-4" stroke="${TOKENS.mint}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  static getError(): string {
    return `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="${TOKENS.coral}" stroke-width="1.8"/>
      <path d="m15 9-6 6M9 9l6 6" stroke="${TOKENS.coral}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }
}

export type MenuIconName =
  | 'spark'
  | 'key'
  | 'mail'
  | 'lock'
  | 'user'
  | 'users'
  | 'edit'
  | 'mask'
  | 'clear'
  | 'chart'
  | 'eye-off'
  | 'settings';

const menuShell = (body: string, accent = 'var(--gf-primary, #8b8fff)'): string => `
  <svg class="gf-menu-symbol" viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <circle class="gf-menu-symbol__plate" cx="12" cy="12" r="9.2" fill="currentColor" opacity=".08"/>
    <path d="M5.2 17.9 17.9 5.2" stroke="${accent}" stroke-width="1.35" stroke-linecap="round" opacity=".5"/>
    ${body}
  </svg>`;

const MENU_ICONS: Readonly<Record<MenuIconName, string>> = {
  spark: menuShell(
    `<path d="M12 6.7 13.25 10l3.3 1.25-3.3 1.25L12 15.8l-1.25-3.3-3.3-1.25L10.75 10 12 6.7Z" fill="currentColor" opacity=".84" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
     <circle cx="7.1" cy="16.8" r="1" fill="currentColor"/><path d="m17.5 15.4.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55.55-1.25Z" fill="currentColor" opacity=".75"/>`,
    'var(--gf-violet, #d19cff)'
  ),
  key: menuShell(
    `<circle cx="8.2" cy="15.3" r="3.15" stroke="currentColor" stroke-width="${STROKE}"/>
     <circle cx="8.2" cy="15.3" r=".8" fill="currentColor"/>
     <path d="m10.55 12.95 5.9-5.9m-2.55 2.55 2.05 2.05m-.45-4.15 2.05 2.05" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round"/>`,
    'var(--gf-amber, #ffd166)'
  ),
  mail: menuShell(
    `<rect x="5.2" y="7.1" width="13.6" height="10" rx="2" stroke="currentColor" stroke-width="${STROKE}"/>
     <path d="m5.8 8.2 6.2 4.5 6.2-4.5" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="17.8" cy="6.4" r="1.25" fill="currentColor"/>`,
    'var(--gf-primary, #82a8ff)'
  ),
  lock: menuShell(
    `<rect x="6.1" y="10.1" width="11.8" height="8.4" rx="2" stroke="currentColor" stroke-width="${STROKE}"/>
     <path d="M8.6 10V8.2a3.4 3.4 0 0 1 6.8 0V10" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round"/>
     <circle cx="12" cy="13.7" r="1.15" fill="currentColor"/><path d="M12 14.8v1.25" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>`,
    'var(--gf-mint, #4de4b4)'
  ),
  user: menuShell(
    `<circle cx="12" cy="8.5" r="3.1" stroke="currentColor" stroke-width="${STROKE}"/>
     <path d="M5.9 19c.55-3.35 2.6-5.2 6.1-5.2s5.55 1.85 6.1 5.2" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round"/>
     <path d="M18.2 6.3h3M19.7 4.8v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    'var(--gf-violet, #d19cff)'
  ),
  users: menuShell(
    `<circle cx="9.2" cy="9" r="2.55" stroke="currentColor" stroke-width="1.4"/>
     <circle cx="15.2" cy="9.6" r="2.45" stroke="currentColor" stroke-width="1.4"/>
     <path d="M5.6 18c.45-2.75 1.8-4.2 3.6-4.2 1.15 0 2.1.45 2.8 1.35.7-.9 1.65-1.35 2.8-1.35 1.8 0 3.15 1.45 3.6 4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    'var(--gf-mint, #4de4b4)'
  ),
  edit: menuShell(
    `<path d="m7.1 16.85.85-3.7 7-7 2.8 2.8-7 7-3.65.9Z" stroke="currentColor" stroke-width="${STROKE}" stroke-linejoin="round"/>
     <path d="m13.8 7.35 2.8 2.8M6.5 18.4h10.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    'var(--gf-primary, #82a8ff)'
  ),
  mask: menuShell(
    `<path d="M6.5 9.3c2.2-1.45 8.8-1.45 11 0l-.75 5.2c-.35 2.05-2 3.3-4.75 3.3s-4.4-1.25-4.75-3.3L6.5 9.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M8.9 12.1c1.15-.5 2.15-.5 3.1 0m0 0c.95-.5 1.95-.5 3.1 0M10.4 15.15c1 .55 2.2.55 3.2 0" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>`,
    'var(--gf-violet, #d19cff)'
  ),
  clear: menuShell(
    `<path d="M8 9.2h8v7.4A1.5 1.5 0 0 1 14.5 18h-5A1.5 1.5 0 0 1 8 16.6V9.2Z" stroke="currentColor" stroke-width="1.4"/>
     <path d="M6.6 9.2h10.8M10 7h4M10.4 11.5v4M13.6 11.5v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    'var(--gf-coral, #ff7d8d)'
  ),
  chart: menuShell(
    `<path d="M6.5 17.8V14M10.4 17.8V10.7M14.3 17.8V7.4M18.1 17.8V12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
     <path d="M5.9 18.3h12.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
    'var(--gf-primary, #82a8ff)'
  ),
  'eye-off': menuShell(
    `<path d="M3.8 12s2.9-5 8.2-5c1.25 0 2.38.29 3.38.73M20.2 12s-2.9 5-8.2 5c-1.25 0-2.38-.29-3.38-.73M9.9 9.9a3 3 0 0 0 4.2 4.2M4.5 4.5l15 15" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`,
    'var(--gf-ink-soft, #6d7488)'
  ),
  settings: menuShell(
    `<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.45"/>
     <path d="M12 5.7v2M12 16.3v2M5.7 12h2M16.3 12h2M7.55 7.55l1.45 1.45M15 15l1.45 1.45M16.45 7.55 15 9M9 15l-1.45 1.45" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    'var(--gf-coral, #ff7d8d)'
  ),
};

export function menuIcon(name: MenuIconName): string {
  return MENU_ICONS[name];
}
