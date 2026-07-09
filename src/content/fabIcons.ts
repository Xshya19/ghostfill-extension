import { type ButtonMode } from './floatingButton';

const TOKENS = {
  iris: 'var(--gf-primary, #7c83ff)',
  irisDeep: 'var(--gf-primary-deep, #4f55d6)',
  mint: 'var(--gf-mint, #36d6a8)',
  coral: 'var(--gf-coral, #ff6b6b)',
} as const;

const STROKE = '1.7';

export const SHARED_SVG_DEFS = '';

const ICONS: Readonly<Record<ButtonMode, string>> = {
  magic: `<img src="${chrome.runtime.getURL('assets/logo.png')}" role="presentation" aria-hidden="true" alt="GhostFill Logo" />`,

  email: `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="5" width="18" height="14" rx="2.5"/>
    <path d="M3.5 6.5 L12 12.5 L20.5 6.5"/>
    <path d="M3.5 17.5 L9 13" opacity="0.55"/>
    <path d="M20.5 17.5 L15 13" opacity="0.55"/>
  </svg>`,

  password: `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8.5" cy="15.5" r="4"/>
    <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/>
    <path d="M11.5 12.5 L20 4"/>
    <path d="M16.5 8 L18.5 10"/>
    <path d="M19 5.5 L20.5 7"/>
  </svg>`,

  otp: `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3 L20 6 V 12.5 C 20 17 16.5 20 12 21 C 7.5 20 4 17 4 12.5 V 6 Z"/>
    <path d="M8.5 12 L11 14.5 L15.8 9.7" stroke-width="2"/>
  </svg>`,

  user: `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="8.5" r="3.5"/>
    <path d="M5.5 20 C 5.5 16.4 8.4 13.5 12 13.5 C 15.6 13.5 18.5 16.4 18.5 20"/>
  </svg>`,

  form: `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="3.5" width="14" height="17" rx="2"/>
    <path d="M8 8 H 14" opacity="0.85"/>
    <path d="M8 12 H 16" opacity="0.85"/>
    <path d="M8 16 H 13" opacity="0.85"/>
    <path d="M14.5 16.5 L 16 18 L 18.5 15.2" stroke-width="2"/>
  </svg>`,
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
    return `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="${TOKENS.iris}" stroke-width="2" opacity="0.18"/>
      <path d="M12 3 a 9 9 0 0 1 9 9" stroke="${TOKENS.iris}" stroke-width="2.2" stroke-linecap="round" fill="none">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
      </path>
    </svg>`;
  }

  static getSuccess(): string {
    return `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9.5" stroke="${TOKENS.mint}" stroke-width="1.8" opacity="0.8"/>
      <path d="M7.5 12.5 l 3 3 6 -6.5" stroke="${TOKENS.mint}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  }

  static getError(): string {
    return `<svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9.5" stroke="${TOKENS.coral}" stroke-width="1.8" opacity="0.8"/>
      <path d="M8.5 8.5 l 7 7 M 15.5 8.5 l -7 7" stroke="${TOKENS.coral}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
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
  | 'settings';

const MENU_COLORS = {
  ink: '#181818',
  yellow: '#FFE500',
  cyan: '#79F7FF',
  teal: '#53F2FC',
  pink: '#FA8CEF',
  violet: '#918EFA',
  mint: '#9DFC7C',
  coral: '#FA7A7A',
  paper: '#FFFDF6',
} as const;

const shell = (body: string, accent: string = MENU_COLORS.yellow): string => `
  <svg class="gf-menu-symbol" viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="3" fill="${MENU_COLORS.paper}" stroke="${MENU_COLORS.ink}" stroke-width="1.8"/>
    <path d="M5 18.5L18.5 5" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"/>
    ${body}
  </svg>`;

const MENU_ICONS: Readonly<Record<MenuIconName, string>> = {
  spark: shell(
    `<path d="M12 6.2l1.15 3.1 3.1 1.15-3.1 1.15L12 14.8l-1.15-3.2-3.1-1.15 3.1-1.15L12 6.2z" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="1.2" stroke-linejoin="round"/>
     <circle cx="7.2" cy="16.4" r="1.15" fill="${MENU_COLORS.cyan}" stroke="${MENU_COLORS.ink}" stroke-width="0.9"/>
     <path d="M17.4 15.7l.5 1 .95.35-.95.35-.5 1-.48-1-.98-.35.98-.35.48-1z" fill="${MENU_COLORS.pink}" stroke="${MENU_COLORS.ink}" stroke-width="0.6"/>`,
    MENU_COLORS.pink
  ),
  key: shell(
    `<circle cx="9" cy="14.4" r="3.6" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="1.5"/>
     <circle cx="9" cy="14.4" r="1.05" fill="${MENU_COLORS.ink}"/>
     <path d="M11.5 11.9l5.5-5.5M15 8.4l2.1 2.1M16.6 6.8l2.1 2.1" stroke="${MENU_COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <path d="M6.9 17.5h4.2" stroke="${MENU_COLORS.paper}" stroke-width="0.8" stroke-linecap="round" opacity="0.8"/>`,
    MENU_COLORS.cyan
  ),
  mail: shell(
    `<rect x="5.7" y="7" width="12.6" height="9.8" rx="1.6" fill="${MENU_COLORS.cyan}" stroke="${MENU_COLORS.ink}" stroke-width="1.5"/>
     <path d="M6 8.6l6 4.1 6-4.1" stroke="${MENU_COLORS.ink}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="8" y="13.2" width="8" height="2" rx="1" fill="${MENU_COLORS.paper}" stroke="${MENU_COLORS.ink}" stroke-width="0.7"/>
     <circle cx="17.7" cy="6.1" r="1.3" fill="${MENU_COLORS.pink}" stroke="${MENU_COLORS.ink}" stroke-width="0.8"/>`,
    MENU_COLORS.yellow
  ),
  lock: shell(
    `<rect x="6.3" y="10.2" width="11.4" height="7.6" rx="1.6" fill="${MENU_COLORS.violet}" stroke="${MENU_COLORS.ink}" stroke-width="1.5"/>
     <path d="M8.5 10.1V8.2a3.5 3.5 0 017 0v1.9" stroke="${MENU_COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <circle cx="12" cy="14" r="1.35" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="0.8"/>
     <path d="M12 15.2v1.2" stroke="${MENU_COLORS.ink}" stroke-width="1.1" stroke-linecap="round"/>`,
    MENU_COLORS.teal
  ),
  user: shell(
    `<circle cx="12" cy="8.6" r="3" fill="${MENU_COLORS.mint}" stroke="${MENU_COLORS.ink}" stroke-width="1.5"/>
     <path d="M6.9 17.8c.7-3 2.7-4.5 5.1-4.5s4.4 1.5 5.1 4.5" fill="${MENU_COLORS.cyan}" stroke="${MENU_COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <path d="M9.5 8.2h5" stroke="${MENU_COLORS.paper}" stroke-width="0.8" stroke-linecap="round" opacity="0.7"/>`,
    MENU_COLORS.pink
  ),
  users: shell(
    `<circle cx="9.2" cy="9.1" r="2.5" fill="${MENU_COLORS.cyan}" stroke="${MENU_COLORS.ink}" stroke-width="1.3"/>
     <circle cx="15" cy="9.4" r="2.4" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="1.3"/>
     <path d="M5.6 17.6c.55-2.5 2-3.8 3.9-3.8 1.15 0 2.1.45 2.85 1.35.75-.9 1.7-1.35 2.85-1.35 1.9 0 3.35 1.3 3.9 3.8" fill="${MENU_COLORS.pink}" stroke="${MENU_COLORS.ink}" stroke-width="1.3" stroke-linecap="round"/>`,
    MENU_COLORS.mint
  ),
  edit: shell(
    `<path d="M7.1 16.8l.85-3.7 6.9-6.9 2.85 2.85-6.9 6.9-3.7.85z" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M13.7 7.3l2.85 2.85M8.2 13.5l2.25 2.25" stroke="${MENU_COLORS.ink}" stroke-width="1" stroke-linecap="round"/>
     <path d="M6.5 18.3h10.8" stroke="${MENU_COLORS.ink}" stroke-width="1.4" stroke-linecap="round"/>`,
    MENU_COLORS.violet
  ),
  mask: shell(
    `<path d="M6.5 9.2c2.2-1.6 8.8-1.6 11 0l-.75 5.4c-.35 2-2 3.2-4.75 3.2s-4.4-1.2-4.75-3.2L6.5 9.2z" fill="${MENU_COLORS.pink}" stroke="${MENU_COLORS.ink}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M9 12.1c1.2-.55 2.1-.55 3.2 0M12.8 12.1c1.1-.55 2-.55 3.2 0" stroke="${MENU_COLORS.ink}" stroke-width="1.1" stroke-linecap="round"/>
     <path d="M10.4 15.2c1 .55 2.2.55 3.2 0" stroke="${MENU_COLORS.paper}" stroke-width="1" stroke-linecap="round"/>`,
    MENU_COLORS.cyan
  ),
  clear: shell(
    `<path d="M8 9.3h9.2v7.2A1.5 1.5 0 0115.7 18H9.5A1.5 1.5 0 018 16.5V9.3z" fill="${MENU_COLORS.coral}" stroke="${MENU_COLORS.ink}" stroke-width="1.4"/>
     <path d="M6.7 9.3h11.8M10 7.1h5.2M10.6 11.5v4.1M14.5 11.5v4.1" stroke="${MENU_COLORS.ink}" stroke-width="1.25" stroke-linecap="round"/>
     <path d="M7.5 6.5l2.1-1.1" stroke="${MENU_COLORS.yellow}" stroke-width="1.4" stroke-linecap="round"/>`,
    MENU_COLORS.mint
  ),
  chart: shell(
    `<rect x="6.5" y="13" width="2.7" height="4.5" rx=".8" fill="${MENU_COLORS.cyan}" stroke="${MENU_COLORS.ink}" stroke-width="1.1"/>
     <rect x="10.7" y="9" width="2.7" height="8.5" rx=".8" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="1.1"/>
     <rect x="14.9" y="6.8" width="2.7" height="10.7" rx=".8" fill="${MENU_COLORS.pink}" stroke="${MENU_COLORS.ink}" stroke-width="1.1"/>
     <path d="M6.4 18.2h12" stroke="${MENU_COLORS.ink}" stroke-width="1.4" stroke-linecap="round"/>`,
    MENU_COLORS.violet
  ),
  settings: shell(
    `<circle cx="12" cy="12" r="3.2" fill="${MENU_COLORS.mint}" stroke="${MENU_COLORS.ink}" stroke-width="1.4"/>
     <path d="M12 5.8v2M12 16.2v2M5.8 12h2M16.2 12h2M7.6 7.6l1.4 1.4M15 15l1.4 1.4M16.4 7.6L15 9M9 15l-1.4 1.4" stroke="${MENU_COLORS.ink}" stroke-width="1.3" stroke-linecap="round"/>
     <circle cx="12" cy="12" r="1.05" fill="${MENU_COLORS.yellow}" stroke="${MENU_COLORS.ink}" stroke-width="0.7"/>`,
    MENU_COLORS.coral
  ),
};

export function menuIcon(name: MenuIconName): string {
  return MENU_ICONS[name];
}
