/**
 * fab-types.ts — Shared type definitions for the Floating Action Button system
 *
 * Extracted from floatingButton.ts §1 to enable clean cross-module imports.
 */

export type ButtonState =
  | 'hidden' | 'idle' | 'hovering' | 'loading'
  | 'success' | 'error' | 'dragging' | 'menu-open';

export type ButtonMode = 'magic' | 'email' | 'password' | 'otp' | 'user' | 'form';

export type ButtonSize = 'mini' | 'normal' | 'expanded';

export type PageType =
  | 'login' | 'signup' | 'verification' | '2fa'
  | 'password-reset' | 'checkout' | 'profile' | 'generic';

export interface MenuAction {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly visible: boolean;
  readonly handler: () => Promise<void>;
}

export interface PositionConfig {
  readonly left: number;
  readonly top: number;
  readonly placement: 'inside-right' | 'outside-right' | 'outside-left' | 'below';
}

export interface MenuPositionConfig {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
  readonly transformOrigin: string;
}
