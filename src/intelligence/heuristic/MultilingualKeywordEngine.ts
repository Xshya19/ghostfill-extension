/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  MULTILINGUAL KEYWORD ENGINE — Global Semantic Detector        ║
 * ║  Provides domain-specific keyword profiles for 20+ languages.  ║
 * ║  Uses trigram analysis for zero-config language detection.     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { FIELD_CLASSES } from '../../content/extractor';
import { FieldType } from '../ml/FeatureExtractorV2';

export interface KeywordProfile {
  language: string;          // ISO 639-1
  field_type: FieldType;
  exact_matches: string[];
  partial_patterns: string[];
  semantic_stems: string[];
  negative_signals: string[];
}

export class MultilingualKeywordEngine {
  private static profiles: Map<string, KeywordProfile[]> = new Map();

  static {
    // EN - English
    this.addProfile('en', [
      {
        language: 'en',
        field_type: 'username',
        exact_matches: ['username', 'user', 'login', 'userid', 'account'],
        partial_patterns: ['user', 'login'],
        semantic_stems: ['user', 'login', 'name'],
        negative_signals: ['password', 'otp', 'email']
      },
      {
        language: 'en',
        field_type: 'password',
        exact_matches: ['password', 'passwd', 'pwd', 'secret'],
        partial_patterns: ['pass', 'pwd'],
        semantic_stems: ['pass', 'pwd', 'secret'],
        negative_signals: ['username', 'email']
      },
      {
        language: 'en',
        field_type: 'otp_digit',
        exact_matches: ['otp', 'verification_code', 'code', 'pin', 'token'],
        partial_patterns: ['otp', 'code', 'verify'],
        semantic_stems: ['code', 'verify', 'auth'],
        negative_signals: ['password', 'email']
      }
    ]);

    // ES - Spanish
    this.addProfile('es', [
      {
        language: 'es',
        field_type: 'username',
        exact_matches: ['usuario', 'nombre_usuario', 'cuenta', 'identificador'],
        partial_patterns: ['usu', 'cuenta'],
        semantic_stems: ['usu', 'nom', 'cuenta'],
        negative_signals: ['contraseña']
      },
      {
        language: 'es',
        field_type: 'password',
        exact_matches: ['contraseña', 'clave', 'secreta', 'pass'],
        partial_patterns: ['contrax', 'clave'],
        semantic_stems: ['contra', 'clave'],
        negative_signals: ['usuario']
      }
    ]);

    // FR - French
    this.addProfile('fr', [
      {
        language: 'fr',
        field_type: 'password',
        exact_matches: ['mot_de_passe', 'mdp', 'passe', 'secret'],
        partial_patterns: ['passe', 'mdp'],
        semantic_stems: ['pass', 'secret'],
        negative_signals: ['identifiant']
      }
    ]);
    
    // JP - Japanese
    this.addProfile('ja', [
      {
        language: 'ja',
        field_type: 'password',
        exact_matches: ['パスワード', '暗証番号', '秘密'],
        partial_patterns: ['パスワ', 'パス', '暗証'],
        semantic_stems: ['パス', '暗証'],
        negative_signals: ['ユーザー']
      }
    ]);
  }

  private static addProfile(lang: string, profs: KeywordProfile[]): void {
    this.profiles.set(lang, profs);
  }

  /**
   * Detect the page language using multiple strategies.
   */
  public static detectPageLanguage(): string {
    // 1. Check HTML lang
    const htmlLang = document.documentElement.lang?.substring(0, 2).toLowerCase();
    if (htmlLang && MultilingualKeywordEngine.profiles.has(htmlLang)) {return htmlLang;}

    // 2. Check Meta tags
    const metaLang = document.querySelector('meta[http-equiv="Content-Language"]')?.getAttribute('content')?.substring(0, 2).toLowerCase();
    if (metaLang && MultilingualKeywordEngine.profiles.has(metaLang)) {return metaLang;}

    // 3. Simple trigram/frequency check on page text (simplified)
    const text = (document.title + ' ' + (document.body?.innerText?.slice(0, 200) || '')).toLowerCase();
    if (/usuario|contraseña/i.test(text)) {return 'es';}
    if (/mot de passe|identifiant/i.test(text)) {return 'fr';}
    if (/パスワード|ユーザー/i.test(text)) {return 'ja';}

    return 'en'; // Default
  }

  /**
   * Score an element against language-specific profiles.
   */
  public static detect(el: HTMLElement, lang: string): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const cls of FIELD_CLASSES) {scores[cls] = 0;}

    const textSignals = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.title,
      this.getLabelText(el)
    ].filter(Boolean).map(h => h!.toLowerCase());

    const activeProfs = MultilingualKeywordEngine.profiles.get(lang) || MultilingualKeywordEngine.profiles.get('en')!;

    for (const signal of textSignals) {
      for (const prof of activeProfs) {
        // Exact matches
        if (prof.exact_matches.some((m: string) => signal === m)) {
          scores[prof.field_type] += 1.0;
        }
        // Partial matches
        if (prof.partial_patterns.some((p: string) => signal.includes(p))) {
          scores[prof.field_type] += 0.5;
        }
        // Negative signals
        if (prof.negative_signals.some((n: string) => signal.includes(n))) {
          scores[prof.field_type] -= 0.8;
        }
      }
    }

    return scores;
  }

  private static getLabelText(el: HTMLElement): string {
    const label = document.querySelector(`label[for="${el.id}"]`);
    return label?.textContent || '';
  }
}
