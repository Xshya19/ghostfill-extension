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

const COLORS = {
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

const shell = (body: string, accent: string = COLORS.yellow): string => `
  <svg class="gf-menu-symbol" viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="3" fill="${COLORS.paper}" stroke="${COLORS.ink}" stroke-width="1.8"/>
    <path d="M5 18.5L18.5 5" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"/>
    ${body}
  </svg>`;

const icons: Readonly<Record<MenuIconName, string>> = {
  spark: shell(
    `<path d="M12 6.2l1.15 3.1 3.1 1.15-3.1 1.15L12 14.8l-1.15-3.2-3.1-1.15 3.1-1.15L12 6.2z" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="1.2" stroke-linejoin="round"/>
     <circle cx="7.2" cy="16.4" r="1.15" fill="${COLORS.cyan}" stroke="${COLORS.ink}" stroke-width="0.9"/>
     <path d="M17.4 15.7l.5 1 .95.35-.95.35-.5 1-.48-1-.98-.35.98-.35.48-1z" fill="${COLORS.pink}" stroke="${COLORS.ink}" stroke-width="0.6"/>`,
    COLORS.pink
  ),
  key: shell(
    `<circle cx="9" cy="14.4" r="3.6" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="1.5"/>
     <circle cx="9" cy="14.4" r="1.05" fill="${COLORS.ink}"/>
     <path d="M11.5 11.9l5.5-5.5M15 8.4l2.1 2.1M16.6 6.8l2.1 2.1" stroke="${COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <path d="M6.9 17.5h4.2" stroke="${COLORS.paper}" stroke-width="0.8" stroke-linecap="round" opacity="0.8"/>`,
    COLORS.cyan
  ),
  mail: shell(
    `<rect x="5.7" y="7" width="12.6" height="9.8" rx="1.6" fill="${COLORS.cyan}" stroke="${COLORS.ink}" stroke-width="1.5"/>
     <path d="M6 8.6l6 4.1 6-4.1" stroke="${COLORS.ink}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="8" y="13.2" width="8" height="2" rx="1" fill="${COLORS.paper}" stroke="${COLORS.ink}" stroke-width="0.7"/>
     <circle cx="17.7" cy="6.1" r="1.3" fill="${COLORS.pink}" stroke="${COLORS.ink}" stroke-width="0.8"/>`,
    COLORS.yellow
  ),
  lock: shell(
    `<rect x="6.3" y="10.2" width="11.4" height="7.6" rx="1.6" fill="${COLORS.violet}" stroke="${COLORS.ink}" stroke-width="1.5"/>
     <path d="M8.5 10.1V8.2a3.5 3.5 0 017 0v1.9" stroke="${COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <circle cx="12" cy="14" r="1.35" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="0.8"/>
     <path d="M12 15.2v1.2" stroke="${COLORS.ink}" stroke-width="1.1" stroke-linecap="round"/>`,
    COLORS.teal
  ),
  user: shell(
    `<circle cx="12" cy="8.6" r="3" fill="${COLORS.mint}" stroke="${COLORS.ink}" stroke-width="1.5"/>
     <path d="M6.9 17.8c.7-3 2.7-4.5 5.1-4.5s4.4 1.5 5.1 4.5" fill="${COLORS.cyan}" stroke="${COLORS.ink}" stroke-width="1.5" stroke-linecap="round"/>
     <path d="M9.5 8.2h5" stroke="${COLORS.paper}" stroke-width="0.8" stroke-linecap="round" opacity="0.7"/>`,
    COLORS.pink
  ),
  users: shell(
    `<circle cx="9.2" cy="9.1" r="2.5" fill="${COLORS.cyan}" stroke="${COLORS.ink}" stroke-width="1.3"/>
     <circle cx="15" cy="9.4" r="2.4" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="1.3"/>
     <path d="M5.6 17.6c.55-2.5 2-3.8 3.9-3.8 1.15 0 2.1.45 2.85 1.35.75-.9 1.7-1.35 2.85-1.35 1.9 0 3.35 1.3 3.9 3.8" fill="${COLORS.pink}" stroke="${COLORS.ink}" stroke-width="1.3" stroke-linecap="round"/>`,
    COLORS.mint
  ),
  edit: shell(
    `<path d="M7.1 16.8l.85-3.7 6.9-6.9 2.85 2.85-6.9 6.9-3.7.85z" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M13.7 7.3l2.85 2.85M8.2 13.5l2.25 2.25" stroke="${COLORS.ink}" stroke-width="1" stroke-linecap="round"/>
     <path d="M6.5 18.3h10.8" stroke="${COLORS.ink}" stroke-width="1.4" stroke-linecap="round"/>`,
    COLORS.violet
  ),
  mask: shell(
    `<path d="M6.5 9.2c2.2-1.6 8.8-1.6 11 0l-.75 5.4c-.35 2-2 3.2-4.75 3.2s-4.4-1.2-4.75-3.2L6.5 9.2z" fill="${COLORS.pink}" stroke="${COLORS.ink}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M9 12.1c1.2-.55 2.1-.55 3.2 0M12.8 12.1c1.1-.55 2-.55 3.2 0" stroke="${COLORS.ink}" stroke-width="1.1" stroke-linecap="round"/>
     <path d="M10.4 15.2c1 .55 2.2.55 3.2 0" stroke="${COLORS.paper}" stroke-width="1" stroke-linecap="round"/>`,
    COLORS.cyan
  ),
  clear: shell(
    `<path d="M8 9.3h9.2v7.2A1.5 1.5 0 0115.7 18H9.5A1.5 1.5 0 018 16.5V9.3z" fill="${COLORS.coral}" stroke="${COLORS.ink}" stroke-width="1.4"/>
     <path d="M6.7 9.3h11.8M10 7.1h5.2M10.6 11.5v4.1M14.5 11.5v4.1" stroke="${COLORS.ink}" stroke-width="1.25" stroke-linecap="round"/>
     <path d="M7.5 6.5l2.1-1.1" stroke="${COLORS.yellow}" stroke-width="1.4" stroke-linecap="round"/>`,
    COLORS.mint
  ),
  chart: shell(
    `<rect x="6.5" y="13" width="2.7" height="4.5" rx=".8" fill="${COLORS.cyan}" stroke="${COLORS.ink}" stroke-width="1.1"/>
     <rect x="10.7" y="9" width="2.7" height="8.5" rx=".8" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="1.1"/>
     <rect x="14.9" y="6.8" width="2.7" height="10.7" rx=".8" fill="${COLORS.pink}" stroke="${COLORS.ink}" stroke-width="1.1"/>
     <path d="M6.4 18.2h12" stroke="${COLORS.ink}" stroke-width="1.4" stroke-linecap="round"/>`,
    COLORS.violet
  ),
  settings: shell(
    `<circle cx="12" cy="12" r="3.2" fill="${COLORS.mint}" stroke="${COLORS.ink}" stroke-width="1.4"/>
     <path d="M12 5.8v2M12 16.2v2M5.8 12h2M16.2 12h2M7.6 7.6l1.4 1.4M15 15l1.4 1.4M16.4 7.6L15 9M9 15l-1.4 1.4" stroke="${COLORS.ink}" stroke-width="1.3" stroke-linecap="round"/>
     <circle cx="12" cy="12" r="1.05" fill="${COLORS.yellow}" stroke="${COLORS.ink}" stroke-width="0.7"/>`,
    COLORS.coral
  ),
};

export function menuIcon(name: MenuIconName): string {
  return icons[name];
}
