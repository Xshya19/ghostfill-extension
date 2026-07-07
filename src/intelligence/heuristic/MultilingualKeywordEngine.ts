/**
 * MULTILINGUAL KEYWORD ENGINE — FIXED
 *
 * Corrections vs. original:
 *  - Emits scores keyed by the CANONICAL FIELD_CLASSES (e.g. 'Email','Password',
 *    'OTP') — NOT the lowercase FieldType union. This prevents keyword scores
 *    from being dropped when merged with the rest of the heuristic classifier.
 *  - Adds an `email` profile (was entirely missing) plus more languages.
 *  - Label selector uses CSS.escape and guards empty id.
 *  - Honest docstring (substring matching, 5 languages).
 */

import { FIELD_CLASSES } from '../types';

/** Canonical class names produced by the local field classifier. */
type CanonicalClass = (typeof FIELD_CLASSES)[number];

export interface KeywordProfile {
  language: string; // ISO 639-1
  field_class: CanonicalClass;
  exact_matches: string[];
  partial_patterns: string[];
  negative_signals: string[];
}

export class MultilingualKeywordEngine {
  private static profiles: Map<string, KeywordProfile[]> = new Map();

  static {
    this.addProfile('en', [
      {
        language: 'en',
        field_class: 'Email',
        exact_matches: ['email', 'e-mail', 'mail'],
        partial_patterns: ['email', 'e-mail'],
        negative_signals: ['password', 'phone'],
      },
      {
        language: 'en',
        field_class: 'Username',
        exact_matches: ['username', 'user', 'login', 'userid', 'account'],
        partial_patterns: ['user', 'login'],
        negative_signals: ['password', 'otp', 'email'],
      },
      {
        language: 'en',
        field_class: 'Password',
        exact_matches: ['password', 'passwd', 'pwd', 'secret'],
        partial_patterns: ['pass', 'pwd'],
        negative_signals: ['username', 'email', 'confirm'],
      },
      {
        language: 'en',
        field_class: 'Target_Password_Confirm',
        exact_matches: ['confirm password', 'repeat password', 'retype password'],
        partial_patterns: ['confirm', 'repeat', 'retype', 'again'],
        negative_signals: ['username', 'email'],
      },
      {
        language: 'en',
        field_class: 'OTP',
        exact_matches: ['otp', 'code', 'pin', 'token', 'passcode'],
        partial_patterns: ['otp', 'code', 'verify', 'passcode', '2fa', 'mfa'],
        negative_signals: ['password', 'email'],
      },
      {
        language: 'en',
        field_class: 'Phone',
        exact_matches: ['phone', 'mobile', 'tel', 'telephone', 'cell'],
        partial_patterns: ['phone', 'mobile', 'tel'],
        negative_signals: ['email', 'password'],
      },
    ]);

    this.addProfile('es', [
      {
        language: 'es',
        field_class: 'Username',
        exact_matches: ['usuario', 'nombre_usuario', 'cuenta', 'identificador'],
        partial_patterns: ['usu', 'cuenta'],
        negative_signals: ['contraseña'],
      },
      {
        language: 'es',
        field_class: 'Email',
        exact_matches: ['correo', 'correo electrónico', 'email'],
        partial_patterns: ['correo', 'email'],
        negative_signals: ['contraseña'],
      },
      {
        language: 'es',
        field_class: 'Password',
        exact_matches: ['contraseña', 'clave', 'secreta'],
        partial_patterns: ['contra', 'clave', 'contraseñ'],
        negative_signals: ['usuario'],
      },
    ]);

    this.addProfile('fr', [
      {
        language: 'fr',
        field_class: 'Email',
        exact_matches: ['courriel', 'adresse e-mail', 'email'],
        partial_patterns: ['courriel', 'mail'],
        negative_signals: ['mot de passe'],
      },
      {
        language: 'fr',
        field_class: 'Password',
        exact_matches: ['mot_de_passe', 'mdp', 'passe', 'secret'],
        partial_patterns: ['passe', 'mdp'],
        negative_signals: ['identifiant'],
      },
      {
        language: 'fr',
        field_class: 'Username',
        exact_matches: ['identifiant', 'utilisateur'],
        partial_patterns: ['identifiant', 'utilisateur'],
        negative_signals: ['mot de passe'],
      },
    ]);

    this.addProfile('de', [
      {
        language: 'de',
        field_class: 'Password',
        exact_matches: ['passwort', 'kennwort'],
        partial_patterns: ['passwort', 'kennwort'],
        negative_signals: ['benutzername'],
      },
      {
        language: 'de',
        field_class: 'Username',
        exact_matches: ['benutzername', 'benutzer'],
        partial_patterns: ['benutzer'],
        negative_signals: ['passwort'],
      },
    ]);

    this.addProfile('ja', [
      {
        language: 'ja',
        field_class: 'Password',
        exact_matches: ['パスワード', '暗証番号', '秘密'],
        partial_patterns: ['パスワ', 'パス', '暗証'],
        negative_signals: ['ユーザー'],
      },
      {
        language: 'ja',
        field_class: 'Username',
        exact_matches: ['ユーザー', 'ユーザー名', 'アカウント'],
        partial_patterns: ['ユーザ'],
        negative_signals: ['パスワード'],
      },
    ]);
  }

  private static addProfile(lang: string, profs: KeywordProfile[]): void {
    this.profiles.set(lang, profs);
  }

  /** Detect the page language (html lang → meta → keyword sniff → 'en'). */
  public static detectPageLanguage(): string {
    const htmlLang = document.documentElement.lang?.substring(0, 2).toLowerCase();
    if (htmlLang && this.profiles.has(htmlLang)) {
      return htmlLang;
    }
    const metaLang = document
      .querySelector('meta[http-equiv="Content-Language"]')
      ?.getAttribute('content')
      ?.substring(0, 2)
      .toLowerCase();
    if (metaLang && this.profiles.has(metaLang)) {
      return metaLang;
    }
    const text = (
      document.title +
      ' ' +
      (document.body?.innerText?.slice(0, 200) || '')
    ).toLowerCase();
    if (/usuario|contraseña|correo/i.test(text)) {
      return 'es';
    }
    if (/mot de passe|identifiant|courriel/i.test(text)) {
      return 'fr';
    }
    if (/passwort|benutzername/i.test(text)) {
      return 'de';
    }
    if (/パスワード|ユーザー/i.test(text)) {
      return 'ja';
    }
    return 'en';
  }

  /**
   * Score an element against language-specific profiles.
   * Returns a record keyed by the canonical FIELD_CLASSES (all initialized to 0),
   * so it can be fused directly with the ML and spatial layers.
   */
  public static detect(el: HTMLElement, lang: string): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const cls of FIELD_CLASSES) {
      scores[cls] = 0;
    }

    const textSignals = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.title,
      this.getLabelText(el),
    ]
      .filter(Boolean)
      .map((h) => h!.toLowerCase());

    const activeProfs = this.profiles.get(lang) || this.profiles.get('en')!;

    for (const signal of textSignals) {
      for (const prof of activeProfs) {
        if (prof.exact_matches.some((m) => signal === m)) {
          scores[prof.field_class]! += 1.0;
        }
        if (prof.partial_patterns.some((p) => signal.includes(p))) {
          scores[prof.field_class]! += 0.5;
        }
        if (prof.negative_signals.some((n) => signal.includes(n))) {
          scores[prof.field_class]! -= 0.8;
        }
      }
    }

    // confirm-password disambiguation: when label/placeholder/name contains confirm/repeat/retype/verify and has password context
    const type = (el as HTMLInputElement).type || '';
    const combinedText = textSignals.join(' ');
    const hasConfirmKeyword = /confirm|repeat|retype|verify/i.test(combinedText);
    const hasPasswordContext = type.toLowerCase() === 'password' || /pass|pwd/i.test(combinedText);
    if (hasConfirmKeyword && hasPasswordContext) {
      scores.Target_Password_Confirm = (scores.Target_Password_Confirm ?? 0) + 2.0;
      scores.Password = 0;
    }

    // Never emit negative scores into the fusion stage.
    for (const cls of FIELD_CLASSES) {
      if (scores[cls]! < 0) {
        scores[cls] = 0;
      }
    }
    return scores;
  }

  private static getLabelText(el: HTMLElement): string {
    if (!el.id) {
      return '';
    }
    try {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return label?.textContent?.trim() || '';
    } catch {
      return '';
    }
  }
}

export default MultilingualKeywordEngine;
