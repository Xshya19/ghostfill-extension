/**
 * fab-contextual-menu.ts — Contextual Menu Builder
 *
 * Extracted from floatingButton.ts §5. Builds the context-aware action
 * menu entries based on the current page analysis and button mode.
 */
import type { ButtonMode, MenuAction } from './fab-types';
import type { PageAnalysis } from './pageAnalyzer';
import { escapeHTML } from './fab-utils';

export class ContextualMenu {
  static buildActions(
    analysis: PageAnalysis,
    currentMode: ButtonMode,
    hasOTPReady: boolean
  ): MenuAction[] {
    const noop = async (): Promise<void> => {};

    const isIdentityCtx =
      currentMode === 'user' || analysis.hasNameFields || analysis.pageType === 'signup';

    const showOTP =
      analysis.pageType === 'verification' ||
      analysis.pageType === '2fa' ||
      analysis.hasOTPField ||
      hasOTPReady;

    const showEmail =
      analysis.hasEmailField || analysis.pageType === 'signup' || analysis.pageType === 'login';

    const showPassword =
      analysis.hasPasswordField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'password-reset';

    const siteTitleMatch = document.title.match(/^([^-|]+)/);
    const rawName = siteTitleMatch ? siteTitleMatch[1].trim() : 'Account';
    const contextName = escapeHTML(rawName);

    const actions: MenuAction[] = [
      { id: 'smart-fill',       icon: '✨', label: `✨ Auto-fill ${contextName}`, shortcut: '⌘⇧G', visible: true,            handler: noop },
      { id: 'paste-otp',        icon: '🔑', label: hasOTPReady ? 'Paste Found Code' : 'Paste Code',       visible: showOTP,         handler: noop },
      { id: 'generate-email',   icon: '📧', label: 'Use Hidden Email',                                    visible: showEmail,       handler: noop },
      { id: 'generate-password',icon: '🔐', label: 'Generate Secure Password',                            visible: showPassword,    handler: noop },
      { id: 'fill-firstname',   icon: '👤', label: 'Inject First Name',                                   visible: isIdentityCtx,  handler: noop },
      { id: 'fill-lastname',    icon: '👥', label: 'Inject Last Name',                                    visible: isIdentityCtx,  handler: noop },
      { id: 'fill-fullname',    icon: '📝', label: 'Inject Full Name',                                    visible: isIdentityCtx,  handler: noop },
      { id: 'fill-username',    icon: '🎭', label: 'Inject Username',                                     visible: isIdentityCtx,  handler: noop },
      { id: 'clear-fields',     icon: '🧹', label: 'Clear All Fields',                                    visible: true,           handler: noop },
      { id: 'divider',          icon: '',   label: '',                                                     visible: true,           handler: noop },
      { id: 'settings',         icon: '⚙️', label: 'GhostFill Settings',                                  visible: true,           handler: noop },
    ];

    return actions.filter((a) => a.visible);
  }
}
