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

const STROKE = '1.7';

export const SHARED_SVG_DEFS = '';

const fabIcon = (
  body: string
): string => `<svg class="gf-fab-symbol" viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <path class="gf-fab-symbol__halo" d="M12 2.7a9.3 9.3 0 1 1 0 18.6 9.3 9.3 0 0 1 0-18.6Z" fill="currentColor" opacity=".1"/>
  ${body}
</svg>`;

const ICONS: Readonly<Record<ButtonMode, string>> = {
  magic: fabIcon(`
    <circle cx="12" cy="12" r="5.15" fill="currentColor" opacity=".16"/>
    <path d="M12 5.1v2.05M12 16.85v2.05M5.1 12h2.05M16.85 12h2.05" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" opacity=".72"/>
    <path d="m12 7.25 1.45 3.3 3.3 1.45-3.3 1.45-1.45 3.3-1.45-3.3-3.3-1.45 3.3-1.45L12 7.25Z" fill="currentColor" opacity=".22"/>
    <path d="m12 7.25 1.45 3.3 3.3 1.45-3.3 1.45-1.45 3.3-1.45-3.3-3.3-1.45 3.3-1.45L12 7.25Z" stroke="currentColor" stroke-width="${STROKE}" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="1.25" fill="currentColor"/>
    <path d="m18.3 4.1.45 1.25 1.25.45-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45.45-1.25Z" fill="currentColor"/>
  `),

  email: fabIcon(`
    <rect x="4.7" y="6.6" width="14.6" height="11" rx="2.4" fill="currentColor" opacity=".18"/>
    <rect x="4.7" y="6.6" width="14.6" height="11" rx="2.4" stroke="currentColor" stroke-width="${STROKE}"/>
    <path d="m5.7 8 6.3 4.65L18.3 8" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="18.5" cy="5.5" r="2" fill="currentColor" stroke="var(--fab-core, #fff)" stroke-width="1.15"/>
  `),

  password: fabIcon(`
    <rect x="5.1" y="10.2" width="13.8" height="8.7" rx="2.4" fill="currentColor" opacity=".18"/>
    <rect x="5.1" y="10.2" width="13.8" height="8.7" rx="2.4" stroke="currentColor" stroke-width="${STROKE}"/>
    <path d="M8.2 10.1V8.4a3.8 3.8 0 0 1 7.6 0v1.7" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round"/>
    <circle cx="12" cy="14.3" r="1.25" fill="currentColor"/><path d="M12 15.4v1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  `),

  otp: fabIcon(`
    <path d="m12 4 6.5 2.45v5.3c0 3.65-2.6 6.5-6.5 8.25-3.9-1.75-6.5-4.6-6.5-8.25v-5.3L12 4Z" fill="currentColor" opacity=".18"/>
    <path d="m12 4 6.5 2.45v5.3c0 3.65-2.6 6.5-6.5 8.25-3.9-1.75-6.5-4.6-6.5-8.25v-5.3L12 4Z" stroke="currentColor" stroke-width="${STROKE}" stroke-linejoin="round"/>
    <circle cx="8.8" cy="11.4" r="1" fill="currentColor"/><circle cx="12" cy="11.4" r="1" fill="currentColor"/><circle cx="15.2" cy="11.4" r="1" fill="currentColor"/>
    <path d="m9.7 15 1.45 1.35 3.2-3.05" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  `),

  user: fabIcon(`
    <circle cx="12" cy="8.4" r="3.15" fill="currentColor" opacity=".22"/>
    <circle cx="12" cy="8.4" r="3.15" stroke="currentColor" stroke-width="${STROKE}"/>
    <path d="M5.7 19c.55-3.45 2.65-5.35 6.3-5.35s5.75 1.9 6.3 5.35" fill="currentColor" opacity=".18"/>
    <path d="M5.7 19c.55-3.45 2.65-5.35 6.3-5.35s5.75 1.9 6.3 5.35" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round"/>
    <path d="M18.3 6.4h3M19.8 4.9v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  `),

  form: fabIcon(`
    <rect x="5.7" y="4.2" width="12.6" height="15.6" rx="2.3" fill="currentColor" opacity=".16"/>
    <rect x="5.7" y="4.2" width="12.6" height="15.6" rx="2.3" stroke="currentColor" stroke-width="${STROKE}"/>
    <path d="M9 8h5.8M9 11.5h6M9 15h3.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
    <path d="m13.8 15.3 1.35 1.25 2.55-2.7" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
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
  settings: menuShell(
    `<circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.45"/>
     <path d="M12 5.7v2M12 16.3v2M5.7 12h2M16.3 12h2M7.55 7.55l1.45 1.45M15 15l1.45 1.45M16.45 7.55 15 9M9 15l-1.45 1.45" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    'var(--gf-coral, #ff7d8d)'
  ),
};

export function menuIcon(name: MenuIconName): string {
  return MENU_ICONS[name];
}
