import { deepQuerySelectorAll } from '../utils/core';
import { FieldType } from '../types/form.types';
import { createLogger } from '../utils/logger';
import { storageService } from '../services/storageService';
import {
  NUM_STRUCTURAL_FEATURES,
  STRUCT,
  emptyStructural,
  RawFieldRecord,
  emptyStructural as legacyEmptyStructural,
} from './IntelligenceCore';

const log = createLogger('PageAnalyzer');

type Fillable = HTMLInputElement | HTMLTextAreaElement;

// ─── 1. PAGE TYPES & ANALYSIS ────────────────────────────────────────

export type PageType =
  | 'login'
  | 'signup'
  | 'verification'
  | '2fa'
  | 'password-reset'
  | 'checkout'
  | 'profile'
  | 'generic-form'
  | 'non-auth';

export interface PageAnalysis {
  readonly pageType: PageType;
  readonly hasEmailField: boolean;
  readonly hasPasswordField: boolean;
  readonly hasOTPField: boolean;
  readonly hasNameFields: boolean;
  readonly formCount: number;
  readonly inputCount: number;
  readonly isAuthRelated: boolean;
  readonly provider: string | null;
  readonly framework: string;
  readonly signals: readonly string[];
}

export function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

const PAGE_TEXT_SCAN_LIMIT = 3000;

// ─── 2. OTP PATTERNS & HEURISTICS (formerly otpPatterns.ts) ───────────

export const OTP_CONSTANTS = {
  MAX_OTP_LENGTH: 8,
  MIN_OTP_LENGTH: 4,
  MIN_SPLIT_FIELDS: 4,
  MAX_SPLIT_FIELDS: 8,
};

export const OTP_PATTERNS = {
  FIELD_SIGNALS: [
    /otp/i,
    /one[-_\s]?time/i,
    /verification[-_\s]?code/i,
    /security[-_\s]?code/i,
    /passcode/i,
    /2fa/i,
    /mfa/i,
    /auth[-_\s]?code/i,
    /pin/i,
  ],
  VERIFICATION_PAGE: [
    /verify|verification|confirm[\s._-]*email|activate[\s._-]*account/i,
    /enter[\s._-]*(your\s+)?code|enter[\s._-]*otp|one[-_\s]?time/i,
    /self[-_\s]?service[\s._-]*verification/i,
    /check[\s._-]*inbox|code[\s._-]*sent|we[\s._-]*sent[\s._-]*code/i,
  ],
  NEGATIVE: [/password/i, /passwd/i, /username/i, /login/i, /signin/i, /search/i, /captcha/i],
  PAGE_TYPES: [
    {
      key: 'isVerificationPage',
      patterns: [
        /verify|verification|confirm[\s._-]*email|activate[\s._-]*account/i,
        /enter[\s._-]*(your\s+)?code|enter[\s._-]*otp|one[-_\s]?time/i,
        /self[-_\s]?service[\s._-]*verification/i,
        /check[\s._-]*inbox|code[\s._-]*sent|we[\s._-]*sent[\s._-]*code/i,
      ],
      signal: 'page:verification',
    },
    {
      key: 'isLoginPage',
      patterns: [/sign\s*in|log\s*in|login|authenticate/i],
      signal: 'page:login',
    },
    {
      key: 'isSignupPage',
      patterns: [/sign\s*up|register|create\s*account|get\s*started|join/i],
      signal: 'page:signup',
    },
    {
      key: 'isPasswordResetPage',
      patterns: [
        /reset[\s._-]*password|forgot[\s._-]*password|recover[\s._-]*account|new[\s._-]*password/i,
      ],
      signal: 'page:password-reset',
    },
    {
      key: 'is2FAPage',
      patterns: [
        /two[- ]?factor|2fa|multi[- ]?factor|mfa|authenticat[\w]*[\s._-]*code/i,
        /security[\s._-]*code|backup[\s._-]*code/i,
      ],
      signal: 'page:2fa',
    },
  ],
  PROVIDERS: [
    [/clerk\.(dev|com)/i, 'Clerk'],
    [/auth0\.com/i, 'Auth0'],
    [/supabase/i, 'Supabase'],
    [/firebase/i, 'Firebase'],
    [/cognito|amazonaws/i, 'AWS Cognito'],
    [/okta\.com/i, 'Okta'],
    [/ory\.|kratos/i, 'Ory Kratos'],
    [/stytch\.com/i, 'Stytch'],
    [/workos\.com/i, 'WorkOS'],
    [/keycloak/i, 'Keycloak'],
    [/linear\.app/i, 'Linear'],
    [/notion\.so/i, 'Notion'],
    [/github\.com/i, 'GitHub'],
    [/gitlab\.com/i, 'GitLab'],
    [/slack\.com/i, 'Slack'],
    [/discord\.com/i, 'Discord'],
    [/vercel\.com/i, 'Vercel'],
    [/stripe\.com/i, 'Stripe'],
    [/mistral\.ai/i, 'Mistral'],
    [/aliyun\.com|alibaba/i, 'Alibaba'],
    [/microsoft\.com|login\.live/i, 'Microsoft'],
    [/google\.com[\w./]*accounts/i, 'Google'],
    [/apple\.com[\w./]*appleid/i, 'Apple'],
    [/twilio\.com\/verify/i, 'Twilio Verify'],
    [/magic\.link/i, 'Magic.link'],
    [/descope\.com/i, 'Descope'],
    [/passage\.id/i, 'Passage'],
    [/hanko\.io/i, 'Hanko'],
    [/frontegg\.com/i, 'Frontegg'],
    [/nhost\.io/i, 'Nhost'],
    [/appwrite\.io/i, 'Appwrite'],
    [/pocketbase\.io/i, 'PocketBase'],
    [/zitadel\.ch|zitadel\.com/i, 'Zitadel'],
    [/authentik/i, 'Authentik'],
    [/casdoor\.org/i, 'Casdoor'],
    [/fusionauth\.io/i, 'FusionAuth'],
    [/userfront\.com/i, 'Userfront'],
    [/supertokens\.com/i, 'SuperTokens'],
    [/bitwarden\.com/i, 'Bitwarden'],
    [/lastpass\.com/i, 'LastPass'],
    [/dashlane\.com/i, 'Dashlane'],
    [/1password\.com/i, '1Password'],
    [/proton\.me|protonmail\.com/i, 'Proton'],
    [/tutanota\.com/i, 'Tutanota'],
    [/binance\.com/i, 'Binance'],
    [/coinbase\.com/i, 'Coinbase'],
    [/kraken\.com/i, 'Kraken'],
    [/kucoin\.com/i, 'KuCoin'],
    [/bybit\.com/i, 'Bybit'],
    [/metamask\.io/i, 'MetaMask'],
    [/phantom\.app/i, 'Phantom'],
    [/amazon\.(com|in|co\.uk)/i, 'Amazon'],
    [/ebay\.com/i, 'eBay'],
    [/paypal\.com/i, 'PayPal'],
    [/venmo\.com/i, 'Venmo'],
    [/cash\.app/i, 'Cash App'],
    [/revolut\.com/i, 'Revolut'],
    [/wise\.com/i, 'Wise'],
    [/adobe\.com/i, 'Adobe'],
    [/dropbox\.com/i, 'Dropbox'],
    [/zoom\.us/i, 'Zoom'],
    [/slack-edge\.com/i, 'Slack Edge'],
    [/microsoftonline\.com/i, 'Microsoft Online'],
  ],
};

export class OTPDetectionCore {
  static scoreElement(el: HTMLElement): number {
    let score = 0;
    const text = (
      el.id +
      ' ' +
      (el.getAttribute('name') ?? '') +
      ' ' +
      (el.getAttribute('placeholder') ?? '') +
      ' ' +
      (el.getAttribute('autocomplete') ?? '')
    ).toLowerCase();
    const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();

    for (const pattern of OTP_PATTERNS.FIELD_SIGNALS) {
      if (pattern.test(text) || pattern.test(aria)) {
        score += 30;
      }
    }

    if (el.getAttribute('autocomplete') === 'one-time-code') {
      score += 100;
    }

    for (const pattern of OTP_PATTERNS.NEGATIVE) {
      if (pattern.test(text)) {
        score -= 50;
      }
    }

    return score;
  }
}

// ─── 3. MULTILINGUAL KEYWORD SNIFFER & VISUAL STATES (formerly detection.ts) ──

export interface KeywordProfile {
  language: string;
  field_class: string;
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
      {
        language: 'ja',
        field_class: 'Email',
        exact_matches: ['メールアドレス', 'メール', 'アドレス'],
        partial_patterns: ['メール', 'アドレス'],
        negative_signals: ['パスワード'],
      },
      {
        language: 'ja',
        field_class: 'Phone',
        exact_matches: ['電話番号', '携帯番号', '電話'],
        partial_patterns: ['電話', '携帯', 'tel'],
        negative_signals: ['メール', 'パスワード'],
      },
      {
        language: 'ja',
        field_class: 'OTP',
        exact_matches: ['認証コード', '確認コード', '認証キー'],
        partial_patterns: ['認証', '確認', 'コード', 'ワンタイム'],
        negative_signals: ['パスワード'],
      },
      {
        language: 'ja',
        field_class: 'First_Name',
        exact_matches: ['名', '名前', '名（メイ）'],
        partial_patterns: ['名'],
        negative_signals: ['姓', '氏名'],
      },
      {
        language: 'ja',
        field_class: 'Last_Name',
        exact_matches: ['姓', '名字', '姓（セイ）'],
        partial_patterns: ['姓', '名字'],
        negative_signals: ['名', '氏名'],
      },
    ]);

    this.addProfile('hi', [
      {
        language: 'hi',
        field_class: 'Email',
        exact_matches: ['ईमेल', 'ई-मेल'],
        partial_patterns: ['ईमेल', 'ई-मेल'],
        negative_signals: ['पासवर्ड'],
      },
      {
        language: 'hi',
        field_class: 'Username',
        exact_matches: ['उपयोगकर्ता', 'उपयोगकर्ता नाम'],
        partial_patterns: ['उपयोगकर्ता'],
        negative_signals: ['पासवर्ड'],
      },
      {
        language: 'hi',
        field_class: 'Password',
        exact_matches: ['पासवर्ड', 'गुप्त कोड'],
        partial_patterns: ['पासवर्ड'],
        negative_signals: ['उपयोगकर्ता'],
      },
      {
        language: 'hi',
        field_class: 'OTP',
        exact_matches: ['सत्यापन कोड', 'ओटीपी'],
        partial_patterns: ['सत्यापन', 'कोड', 'ओटीपी'],
        negative_signals: ['पासवर्ड'],
      },
      {
        language: 'hi',
        field_class: 'Phone',
        exact_matches: ['फ़ोन', 'फ़ोन नंबर', 'मोबाइल'],
        partial_patterns: ['फ़ोन', 'नंबर', 'मोबाइल'],
        negative_signals: ['ईमेल'],
      },
    ]);

    this.addProfile('zh', [
      {
        language: 'zh',
        field_class: 'Email',
        exact_matches: ['邮箱', '电子邮箱', '邮件'],
        partial_patterns: ['邮箱', '邮件'],
        negative_signals: ['密码'],
      },
      {
        language: 'zh',
        field_class: 'Username',
        exact_matches: ['用户名', '账户', '账号'],
        partial_patterns: ['用户', '账号'],
        negative_signals: ['密码'],
      },
      {
        language: 'zh',
        field_class: 'Password',
        exact_matches: ['密码', '口令'],
        partial_patterns: ['密码'],
        negative_signals: ['用户名'],
      },
      {
        language: 'zh',
        field_class: 'OTP',
        exact_matches: ['验证码', '动态码', '短信验证码'],
        partial_patterns: ['验证', '码'],
        negative_signals: ['密码'],
      },
      {
        language: 'zh',
        field_class: 'Phone',
        exact_matches: ['手机', '手机号', '电话', '号码'],
        partial_patterns: ['手机', '电话'],
        negative_signals: ['邮箱'],
      },
    ]);

    this.addProfile('ko', [
      {
        language: 'ko',
        field_class: 'Email',
        exact_matches: ['이메일', '이메일 주소'],
        partial_patterns: ['이메일', '메일'],
        negative_signals: ['비밀번호'],
      },
      {
        language: 'ko',
        field_class: 'Username',
        exact_matches: ['사용자명', '아이디', '계정'],
        partial_patterns: ['사용자', '아이디'],
        negative_signals: ['비밀번호'],
      },
      {
        language: 'ko',
        field_class: 'Password',
        exact_matches: ['비밀번호', '패스워드'],
        partial_patterns: ['비밀', '패스'],
        negative_signals: ['아이디'],
      },
      {
        language: 'ko',
        field_class: 'OTP',
        exact_matches: ['인증번호', '인증코드', '보안코드'],
        partial_patterns: ['인증', '코드'],
        negative_signals: ['비밀번호'],
      },
      {
        language: 'ko',
        field_class: 'Phone',
        exact_matches: ['전화번호', '휴대폰', '핸드폰'],
        partial_patterns: ['전화', '번호', '휴대'],
        negative_signals: ['이메일'],
      },
    ]);

    this.addProfile('pt', [
      {
        language: 'pt',
        field_class: 'Email',
        exact_matches: ['email', 'e-mail', 'correio eletrônico'],
        partial_patterns: ['email', 'correio'],
        negative_signals: ['senha'],
      },
      {
        language: 'pt',
        field_class: 'Username',
        exact_matches: ['nome de usuário', 'usuário', 'login', 'utilizador'],
        partial_patterns: ['usuário', 'login'],
        negative_signals: ['senha'],
      },
      {
        language: 'pt',
        field_class: 'Password',
        exact_matches: ['senha', 'palavra-passe', 'codigo de acesso'],
        partial_patterns: ['senha', 'passe'],
        negative_signals: ['usuário'],
      },
      {
        language: 'pt',
        field_class: 'OTP',
        exact_matches: ['código de verificação', 'código', 'token'],
        partial_patterns: ['código', 'verificação', 'token'],
        negative_signals: ['senha'],
      },
      {
        language: 'pt',
        field_class: 'Phone',
        exact_matches: ['telefone', 'celular', 'móvel'],
        partial_patterns: ['tel', 'cel', 'fone'],
        negative_signals: ['email'],
      },
    ]);

    this.addProfile('tr', [
      {
        language: 'tr',
        field_class: 'Email',
        exact_matches: ['e-posta', 'e-mail', 'eposta'],
        partial_patterns: ['e-posta', 'eposta', 'mail'],
        negative_signals: ['şifre'],
      },
      {
        language: 'tr',
        field_class: 'Username',
        exact_matches: ['kullanıcı adı', 'kullanıcı'],
        partial_patterns: ['kullanıcı'],
        negative_signals: ['şifre'],
      },
      {
        language: 'tr',
        field_class: 'Password',
        exact_matches: ['şifre', 'parola'],
        partial_patterns: ['şifre', 'parola'],
        negative_signals: ['kullanıcı'],
      },
      {
        language: 'tr',
        field_class: 'OTP',
        exact_matches: ['doğrulama kodu', 'onay kodu', 'tek kullanımlık şifre'],
        partial_patterns: ['doğrulama', 'kod', 'onay'],
        negative_signals: ['şifre'],
      },
      {
        language: 'tr',
        field_class: 'Phone',
        exact_matches: ['telefon', 'cep telefonu', 'mobil'],
        partial_patterns: ['tel', 'cep'],
        negative_signals: ['posta'],
      },
    ]);

    this.addProfile('ar', [
      {
        language: 'ar',
        field_class: 'Email',
        exact_matches: ['البريد الإلكتروني', 'البريد', 'إيميل'],
        partial_patterns: ['البريد', 'إيميل'],
        negative_signals: ['كلمة المرور'],
      },
      {
        language: 'ar',
        field_class: 'Username',
        exact_matches: ['اسم المستخدم', 'المستخدم', 'حساب'],
        partial_patterns: ['المستخدم', 'اسم'],
        negative_signals: ['كلمة المرور'],
      },
      {
        language: 'ar',
        field_class: 'Password',
        exact_matches: ['كلمة المرور', 'كلمة السر', 'السر'],
        partial_patterns: ['المرور', 'السر'],
        negative_signals: ['اسم المستخدم'],
      },
      {
        language: 'ar',
        field_class: 'OTP',
        exact_matches: ['رمز التحقق', 'رمز التفعيل', 'كود'],
        partial_patterns: ['رمز', 'التحقق', 'التفعيل', 'كود'],
        negative_signals: ['كلمة المرور'],
      },
      {
        language: 'ar',
        field_class: 'Phone',
        exact_matches: ['رقم الهاتف', 'الهاتف', 'الجوال'],
        partial_patterns: ['الهاتف', 'رقم', 'جوال'],
        negative_signals: ['البريد'],
      },
    ]);
  }

  private static addProfile(lang: string, profs: KeywordProfile[]): void {
    this.profiles.set(lang, profs);
  }

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
      (document.body?.innerText?.slice(0, 300) || '')
    ).toLowerCase();

    if (/[\u0900-\u097f]/.test(text)) {
      return 'hi';
    }
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh';
    }
    if (/[\uac00-\ud7a3]/.test(text)) {
      return 'ko';
    }
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) {
      return 'ja';
    }
    if (/[\u0600-\u06ff]/.test(text)) {
      return 'ar';
    }
    if (/usuario|contraseña|correo/i.test(text)) {
      return 'es';
    }
    if (/mot de passe|identifiant|courriel/i.test(text)) {
      return 'fr';
    }
    if (/passwort|benutzername/i.test(text)) {
      return 'de';
    }
    if (/utilizador|usuário|palavra-passe/i.test(text)) {
      return 'pt';
    }
    if (/şifre|kullanıcı/i.test(text)) {
      return 'tr';
    }
    return 'en';
  }

  public static detect(el: HTMLElement, lang: string): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const cls of ['Email', 'Username', 'Password', 'Target_Password_Confirm', 'Phone', 'OTP', 'First_Name', 'Last_Name', 'Full_Name', 'Unknown']) {
      scores[cls] = 0;
    }

    const textSignals = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.title,
      el.getAttribute('data-testid'),
      el.getAttribute('data-cy'),
      el.getAttribute('data-field'),
      el.getAttribute('data-type'),
      el.getAttribute('data-automation-id'),
      el.getAttribute('data-component'),
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

    const type = (el as HTMLInputElement).type || '';
    const combinedTextVal = textSignals.join(' ');
    const hasConfirmKeyword = /confirm|repeat|retype|verify/i.test(combinedTextVal);
    const hasPasswordContext = type.toLowerCase() === 'password' || /pass|pwd/i.test(combinedTextVal);
    if (hasConfirmKeyword && hasPasswordContext) {
      scores.Target_Password_Confirm = (scores.Target_Password_Confirm ?? 0) + 2.0;
      scores.Password = 0;
    }

    for (const cls of ['Email', 'Username', 'Password', 'Target_Password_Confirm', 'Phone', 'OTP', 'First_Name', 'Last_Name', 'Full_Name', 'Unknown']) {
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
      if (label?.textContent) {
        return label.textContent.trim();
      }
      let root: Node | null = el.getRootNode();
      while (root) {
        if (root instanceof ShadowRoot) {
          const labelInShadow = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (labelInShadow?.textContent) {
            return labelInShadow.textContent.trim();
          }
        }
        root = root instanceof ShadowRoot ? (root as any).host?.getRootNode() : null;
      }
      return '';
    } catch {
      return '';
    }
  }
}

export interface VisualState {
  isVisible: boolean;
  opacity: number;
  dimensions: { w: number; h: number };
  isInViewport: boolean;
  isObscured: boolean;
  isAnimating: boolean;
  willBecomeVisible: boolean;
  zIndex: number;
}

export class VisualStateTracker {
  private styleCache = new Map<HTMLElement, CSSStyleDeclaration>();

  private getCachedStyle(el: HTMLElement): CSSStyleDeclaration {
    let cached = this.styleCache.get(el);
    if (!cached) {
      cached = window.getComputedStyle(el);
      this.styleCache.set(el, cached);
    }
    return cached;
  }

  public getVisualState(el: HTMLElement): VisualState {
    this.styleCache.clear();
    const style = this.getCachedStyle(el);
    const rect = el.getBoundingClientRect();

    const isVisibleVal = this.checkVisibility(el, style);
    const isObscuredVal = this.checkIfObscured(el, rect, style);

    return {
      isVisible: isVisibleVal,
      opacity: parseFloat(style.opacity || '1'),
      dimensions: { w: el.offsetWidth, h: el.offsetHeight },
      isInViewport: this.isInViewport(rect),
      isObscured: isObscuredVal,
      isAnimating: this.isCurrentlyAnimating(style),
      willBecomeVisible: this.predictFutureVisibility(el, style),
      zIndex: parseInt(style.zIndex, 10) || 0,
    };
  }

  private checkVisibility(el: HTMLElement, style: CSSStyleDeclaration): boolean {
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) < 0.01) return false;
    if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;

    let curr: HTMLElement | null = el.parentElement;
    while (curr) {
      const pStyle = this.getCachedStyle(curr);
      if (pStyle.display === 'none') return false;
      if (pStyle.overflow === 'hidden' && (curr.offsetWidth === 0 || curr.offsetHeight === 0)) {
        return false;
      }
      curr = curr.parentElement;
    }
    return true;
  }

  private checkIfObscured(el: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
    if (rect.width === 0 || rect.height === 0) return false;

    const points = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + 2, y: rect.top + 2 },
      { x: rect.right - 2, y: rect.top + 2 },
      { x: rect.left + 2, y: rect.bottom - 2 },
      { x: rect.right - 2, y: rect.bottom - 2 }
    ];

    let obscuredPoints = 0;
    const myZ = parseInt(style.zIndex, 10) || 0;

    for (const pt of points) {
      if (pt.x < 0 || pt.y < 0 || pt.x > window.innerWidth || pt.y > window.innerHeight) {
        continue;
      }
      const elementAtPoint = document.elementFromPoint(pt.x, pt.y);
      if (!elementAtPoint) continue;
      if (elementAtPoint !== el && !el.contains(elementAtPoint) && !elementAtPoint.contains(el)) {
        const obsStyle = this.getCachedStyle(elementAtPoint as HTMLElement);
        const obsZ = parseInt(obsStyle.zIndex, 10) || 0;
        if (obsZ > myZ) {
          obscuredPoints++;
        }
      }
    }
    return obscuredPoints >= 3;
  }

  private isInViewport(rect: DOMRect): boolean {
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  private isCurrentlyAnimating(style: CSSStyleDeclaration): boolean {
    return (
      (!!style.animationName && style.animationName !== 'none') ||
      (!!style.transitionProperty && style.transitionProperty !== 'none')
    );
  }

  private predictFutureVisibility(el: HTMLElement, style: CSSStyleDeclaration): boolean {
    if (this.checkVisibility(el, style)) return true;
    const transition = style.transitionProperty || '';
    if (parseFloat(style.opacity) === 0 && (transition.includes('opacity') || transition.includes('all'))) {
      return true;
    }

    let curr: HTMLElement | null = el.parentElement;
    while (curr) {
      const pStyle = this.getCachedStyle(curr);
      const pTransition = pStyle.transitionProperty || '';
      const pAnimation = pStyle.animationName || '';
      if (
        (pTransition !== 'none' && (pTransition.includes('opacity') || pTransition.includes('visibility') || pTransition.includes('display') || pTransition.includes('all'))) ||
        (pAnimation !== 'none')
      ) {
        return true;
      }
      if (curr.tagName === 'DIALOG') return true;
      curr = curr.parentElement;
    }

    if (el.hasAttribute('hidden') || el.classList.contains('hidden')) {
      return false;
    }
    return false;
  }
}

export interface FormFingerprint {
  l1: string;
  l2: string;
  l3: string;
}

export class FuzzyFormFingerprint {
  public static generate(elements: HTMLElement[]): FormFingerprint {
    const inputs = elements.filter((el) => el.tagName === 'INPUT' || el.tagName === 'SELECT');

    const l1 = inputs
      .map((el) => {
        let depth = 0;
        let curr: HTMLElement | null = el;
        while (curr && curr.tagName !== 'FORM') {
          curr = curr.parentElement;
          depth++;
        }
        return `${el.tagName}:${depth}`;
      })
      .join(',');

    const l2 = inputs
      .map((el) => {
        if (el.tagName === 'SELECT') return 'select';
        return (el as HTMLInputElement).type || 'text';
      })
      .join(',');

    const l3 = inputs
      .map((el) => {
        const raw = el.id || el.getAttribute('name') || '';
        return raw.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10);
      })
      .filter(Boolean)
      .join(',');

    return { l1, l2, l3 };
  }

  public static match(current: FormFingerprint, history: FormFingerprint[]): { matched: boolean; score: number } {
    let bestScore = 0;

    for (const hist of history) {
      let score = 0;
      if (current.l1 === hist.l1) score += 0.5;
      if (current.l2 === hist.l2) score += 0.3;

      if (current.l3 && hist.l3) {
        const currTokens = current.l3.split(',');
        const histTokens = hist.l3.split(',');
        let tokenMatches = 0;
        for (const token of currTokens) {
          if (histTokens.includes(token)) {
            tokenMatches++;
          }
        }
        score += (tokenMatches / Math.max(currTokens.length, histTokens.length)) * 0.2;
      }

      if (score > bestScore) {
        bestScore = score;
      }
    }

    return { matched: bestScore >= 0.7, score: bestScore };
  }
}

// ─── 4. FIELD RECORD EXTRACTION (formerly featureExtractor.ts) ────────

function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : document;
}

function textById(root: Document | ShadowRoot, id: string): string {
  const byId = (root as Document).getElementById
    ? (root as Document).getElementById(id)
    : root.querySelector('#' + (window.CSS ? CSS.escape(id) : id));
  return byId?.textContent?.trim() || '';
}

export function resolveLabelText(el: Fillable): string {
  const root = rootOf(el);

  if (el.id) {
    const sel = 'label[for="' + (window.CSS ? CSS.escape(el.id) : el.id) + '"]';
    const label = root.querySelector(sel);
    if (label?.textContent) {
      return label.textContent.trim();
    }
  }
  const wrapping = el.closest ? el.closest('label') : null;
  if (wrapping?.textContent) {
    return wrapping.textContent.trim();
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/[ \t\r\n]+/)
      .map((id) => textById(root, id))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(' ');
    }
  }
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const parts = describedBy
      .split(/[ \t\r\n]+/)
      .map((id) => textById(root, id))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(' ');
    }
  }

  const titleAttr = el.getAttribute('title');
  if (titleAttr?.trim()) {
    return titleAttr.trim();
  }

  if (el.previousElementSibling) {
    let prev: Element | null = el.previousElementSibling;
    while (prev) {
      const tag = prev.tagName.toLowerCase();
      if (
        tag === 'label' ||
        prev.classList.contains('label') ||
        prev.classList.contains('title') ||
        prev.classList.contains('placeholder') ||
        prev.classList.contains('caption') ||
        prev.classList.contains('text') ||
        prev.classList.contains('input-label')
      ) {
        const text = prev.textContent?.trim();
        if (text && text.length < 100) {
          return text;
        }
      }
      prev = prev.previousElementSibling;
    }
  }

  const parent = el.parentElement;
  if (parent) {
    const prevSibling = parent.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim();
      if (text && text.length < 100) {
        return text;
      }
    }
  }

  return '';
}

function findClosestHeadingText(el: Element): string {
  try {
    let parent: Element | null = el;
    while (parent && parent !== document.body) {
      const headings = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      if (headings.length > 0) {
        for (let i = headings.length - 1; i >= 0; i--) {
          const h = headings[i];
          if (h && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            return h.textContent?.trim() || '';
          }
        }
      }
      parent = parent.parentElement;
    }
  } catch {
    // safe fallback
  }
  return '';
}

function surroundingText(el: Fillable): string {
  const container =
    (el.closest && (el.closest('label,div,fieldset,section,form') as HTMLElement)) ||
    el.parentElement;
  if (!container) {
    return '';
  }
  const raw = (container.textContent || '').replace(/[ \t\r\n]+/g, ' ').trim();
  return raw.slice(0, 300);
}

function isVisible(el: Fillable): {
  visible: boolean;
  opacityZero: boolean;
  offscreen: boolean;
  tiny: boolean;
  width: number;
} {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const opacityZero = parseFloat(style.opacity || '1') === 0;
  const hiddenByCss = style.display === 'none' || style.visibility === 'hidden';
  const offscreen =
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.left > window.innerWidth + 2000 ||
    rect.top > window.innerHeight + 5000;
  const tiny = rect.width <= 2 || rect.height <= 2;
  const visible =
    !hiddenByCss && !opacityZero && !tiny && (el as HTMLInputElement).type !== 'hidden';
  return { visible, opacityZero, offscreen, tiny, width: rect.width };
}

function countSameShapeSiblings(el: Fillable): number {
  const form = (el.closest && el.closest('form,div,fieldset')) as HTMLElement | null;
  if (!form) {
    return 0;
  }
  const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
  const ml = (el as HTMLInputElement).maxLength;
  const rectEl = el.getBoundingClientRect();
  const widthEl = rectEl.width;
  let n = 0;
  for (const i of inputs) {
    const rectI = i.getBoundingClientRect();
    const widthI = rectI.width;
    const inputModeMatches = i.getAttribute('inputmode') === el.getAttribute('inputmode');
    const widthMatches = Math.abs(widthI - widthEl) <= 5;
    if (i.maxLength === ml && (ml === 1 || (ml > 0 && ml <= 2)) && inputModeMatches && widthMatches) {
      n++;
    }
  }
  return n;
}

export function extractFieldRecord(el: Fillable): RawFieldRecord {
  const tag = el.tagName.toLowerCase();
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const name = el.getAttribute('name') || '';
  const id = el.id || '';
  const placeholder = (el as HTMLInputElement).placeholder || '';
  const ariaLabel = el.getAttribute('aria-label') || '';
  const labelText = resolveLabelText(el);
  const surrounding = surroundingText(el);
  const maxLength = (el as HTMLInputElement).maxLength ?? -1;
  const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
  const pattern = el.getAttribute('pattern') || '';
  const required = (el as HTMLInputElement).required === true;
  const vis = isVisible(el);

  let isSecondPasswordField = false;
  if (type === 'password') {
    try {
      const form = el.closest('form, div.form, fieldset') || document;
      const pwdFields = Array.from(form.querySelectorAll('input[type="password"]'));
      const idx = pwdFields.indexOf(el);
      if (idx > 0) {
        isSecondPasswordField = true;
      }
    } catch {
      // safe fallback
    }
  }

  const dataAttributes: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr && attr.name.startsWith('data-')) {
      dataAttributes[attr.name] = attr.value;
    }
  }

  const style = window.getComputedStyle(el);
  const isAnimating = style.animationName !== 'none' || style.transitionProperty !== 'none';
  const form = el.closest('form') as HTMLFormElement | null;
  const formFieldCount = form ? form.querySelectorAll('input:not([type="hidden"]), textarea').length : 0;
  const formAction = form?.action || '';
  const closestHeadingText = findClosestHeadingText(el);

  const rec: RawFieldRecord = {
    url: location.href,
    selector: id ? '#' + id : name ? tag + '[name="' + name + '"]' : tag,
    tag,
    type,
    autocomplete,
    name,
    id,
    placeholder,
    ariaLabel,
    labelText,
    surroundingText: surrounding,
    maxLength: typeof maxLength === 'number' ? maxLength : -1,
    inputMode,
    pattern,
    required,
    visible: vis.visible,
    widthPx: Math.round(vis.width),
    focused: document.activeElement === el,
    opacityZero: vis.opacityZero,
    offscreen: vis.offscreen,
    tiny: vis.tiny,
    className: el.className || '',
    isSecondPasswordField,
    dataAttributes,
    title: el.getAttribute('title') || '',
    formFieldCount,
    formAction,
    isAnimating,
    tabIndex: el.tabIndex,
    closestHeadingText,
  };
  rec.structural = buildStructural(rec, {
    ...vis,
    sameShape: countSameShapeSiblings(el),
    inForm: !!el.closest?.('form'),
  });
  return rec;
}

export function buildStructural(rec: RawFieldRecord, vis: {
  opacityZero: boolean;
  offscreen: boolean;
  tiny: boolean;
  sameShape: number;
  inForm: boolean;
}): number[] {
  const v = emptyStructural();
  const set = (i: number, val = 1) => {
    if (i >= 0 && i < NUM_STRUCTURAL_FEATURES) {
      v[i] = val;
    }
  };
  const combined = [
    rec.labelText,
    rec.placeholder,
    rec.ariaLabel,
    rec.name,
    rec.id,
    rec.surroundingText,
    rec.autocomplete,
    rec.className || '',
  ].join(' ');

  const t = rec.type;
  if (t === 'text') {
    set(STRUCT.TYPE_TEXT);
  } else if (t === 'email') {
    set(STRUCT.TYPE_EMAIL);
  } else if (t === 'password') {
    set(STRUCT.TYPE_PASSWORD);
  } else if (t === 'tel') {
    set(STRUCT.TYPE_TEL);
  } else if (t === 'number') {
    set(STRUCT.TYPE_NUMBER);
  } else if (t === 'search') {
    set(STRUCT.TYPE_SEARCH);
  } else if (t === 'hidden') {
    set(STRUCT.TYPE_HIDDEN);
  } else {
    set(STRUCT.TYPE_OTHER);
  }

  const ac = rec.autocomplete;
  if (ac.includes('email')) {
    set(STRUCT.AC_EMAIL);
  }
  if (ac.includes('username')) {
    set(STRUCT.AC_USERNAME);
  }
  if (ac.includes('current-password')) {
    set(STRUCT.AC_CURRENT_PASSWORD);
  }
  if (ac.includes('new-password')) {
    set(STRUCT.AC_NEW_PASSWORD);
  }
  if (ac.includes('one-time-code')) {
    set(STRUCT.AC_ONE_TIME_CODE);
  }
  if (ac.includes('tel')) {
    set(STRUCT.AC_TEL);
  }
  if (ac.includes('name') || ac.includes('given') || ac.includes('family')) {
    set(STRUCT.AC_NAME);
  }
  if (ac === '' || ac === 'off' || ac === 'nope') {
    set(STRUCT.AC_OFF_OR_NONE);
  }

  if (rec.maxLength === 1) {
    set(STRUCT.MAXLEN_IS_1);
  }
  if (rec.maxLength > 0 && rec.maxLength <= 8) {
    set(STRUCT.MAXLEN_LE_8);
  }
  if (rec.widthPx > 0 && rec.widthPx <= 90) {
    set(STRUCT.WIDTH_LE_90);
  }
  if (rec.inputMode === 'numeric' || rec.inputMode === 'tel') {
    set(STRUCT.INPUTMODE_NUMERIC);
  }
  if (rec.pattern.includes('0-9') || rec.pattern.includes('d{') || rec.pattern.includes('[0-9]')) {
    set(STRUCT.PATTERN_DIGITS);
  }
  if (rec.required) {
    set(STRUCT.REQUIRED);
  }
  if (rec.visible) {
    set(STRUCT.VISIBLE);
  }
  if (rec.labelText) {
    set(STRUCT.HAS_LABEL);
  }
  if (rec.placeholder) {
    set(STRUCT.HAS_PLACEHOLDER);
  }
  if (rec.ariaLabel) {
    set(STRUCT.HAS_ARIA);
  }
  if (vis.inForm) {
    set(STRUCT.IN_FORM);
  }
  if (vis.sameShape >= 4 && vis.sameShape <= 8) {
    set(STRUCT.SIBLING_SAME_SHAPE_COUNT_4_8);
  }
  if (vis.offscreen) {
    set(STRUCT.OFFSCREEN);
  }
  if (vis.opacityZero) {
    set(STRUCT.ZERO_OPACITY);
  }
  if (vis.tiny) {
    set(STRUCT.TINY_SIZE);
  }
  if (rec.tag === 'textarea') {
    set(STRUCT.IS_TEXTAREA);
  }

  const kwHit = (group: any, idx: number) => {
    // Dynamic import mapping for MatchesAny inside DOM buildStructural
    if (combined.toLowerCase().includes(group)) {
      set(idx);
    }
  };
  kwHit('email', STRUCT.KW_EMAIL);
  kwHit('user', STRUCT.KW_USER);
  kwHit('password', STRUCT.KW_PASS);
  kwHit('confirm', STRUCT.KW_CONFIRM);
  kwHit('new', STRUCT.KW_NEW);
  kwHit('current', STRUCT.KW_CURRENT);
  kwHit('otp', STRUCT.KW_OTP);
  kwHit('code', STRUCT.KW_CODE);
  kwHit('verify', STRUCT.KW_VERIFY);
  kwHit('phone', STRUCT.KW_PHONE);
  kwHit('first', STRUCT.KW_FIRST);
  kwHit('last', STRUCT.KW_LAST);
  kwHit('fullname', STRUCT.KW_FULLNAME);
  kwHit('cvv', STRUCT.KW_CVV);
  kwHit('card', STRUCT.KW_CARD);
  kwHit('expiry', STRUCT.KW_EXPIRY);
  kwHit('zip', STRUCT.KW_ZIP);
  kwHit('search', STRUCT.KW_SEARCH);
  kwHit('coupon', STRUCT.KW_COUPON);
  kwHit('captcha', STRUCT.KW_CAPTCHA);
  kwHit('amount', STRUCT.KW_AMOUNT);
  kwHit('dob', STRUCT.KW_DOB);

  if (/[0-9]/.test(rec.name + ' ' + rec.id)) {
    set(STRUCT.KW_DIGITS_IN_NAME);
  }
  const otpLenHint = combined.toLowerCase().match(/([0-9])\s*(digit|digits|caracteres|stellig)/);
  if (otpLenHint) {
    set(STRUCT.KW_OTP_LENGTH_HINT);
  }

  if (rec.dataAttributes && (rec.dataAttributes['data-testid'] || rec.dataAttributes['data-cy'] || rec.dataAttributes['data-automation-id'])) {
    set(STRUCT.HAS_DATA_TESTID);
  }
  if (rec.title) {
    set(STRUCT.HAS_TITLE);
  }
  if (rec.isSecondPasswordField) {
    set(STRUCT.FORM_HAS_2_PASSWORDS);
  }
  if (rec.isAnimating) {
    set(STRUCT.IS_ANIMATING);
  }
  if (typeof rec.tabIndex === 'number' && rec.tabIndex >= 0) {
    set(STRUCT.TAB_INDEX_SET);
  }
  if (/login|signup|register|sign-in|sign-up|join|enter/i.test(rec.url || '') || /login|signup|register|sign-in|sign-up|join|enter/i.test(rec.formAction || '')) {
    set(STRUCT.URL_LOGIN_SIGNUP);
  }
  if (rec.closestHeadingText && /otp|code|verify|verification|pin/i.test(rec.closestHeadingText)) {
    set(STRUCT.HEADING_OTP_KEYWORD);
  }
  if (rec.formFieldCount && rec.formFieldCount <= 4) {
    set(STRUCT.FORM_FIELD_COUNT_LE_4);
  }

  return v;
}

// ─── 5. SESSION TRACKING & AUTH STEPS (formerly sessionTracking.ts) ──

export type AuthFlowType =
  | 'single_page_login'
  | 'split_login'
  | 'login_with_mfa'
  | 'password_reset'
  | 'signup'
  | 'unknown';

export interface AuthSession {
  domain: string;
  steps: AuthStep[];
  detectedFlow: AuthFlowType;
  startTime: number;
}

export interface AuthStep {
  url: string;
  timestamp: number;
  formFingerprint: FormFingerprint;
  detectedFields: Array<{ selector: string; type: FieldType }>;
}

export class AuthSessionTracker {
  private static activeSessions: Map<string, AuthSession> = new Map();
  private static STORAGE_KEY = 'ghostfill_auth_sessions';

  public static async resume(): Promise<void> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const saved = data[this.STORAGE_KEY];
      if (saved && typeof saved === 'object') {
        for (const [domain, session] of Object.entries(saved)) {
          if (!this.isSessionStale(session as AuthSession)) {
            this.activeSessions.set(domain, session as AuthSession);
          }
        }
      }
    } catch {
      // Storage might be unavailable
    }
  }

  private static async persist(): Promise<void> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      const sessionsObj = Object.fromEntries(this.activeSessions);
      await chrome.storage.local.set({ [this.STORAGE_KEY]: sessionsObj });
    } catch {
      // Non-critical
    }
  }

  public static async recordStep(
    domain: string,
    fingerprint: any,
    fields: Array<{ selector: string; type: string }>
  ): Promise<AuthSession> {
    let session = AuthSessionTracker.activeSessions.get(domain);

    if (!session || AuthSessionTracker.isSessionStale(session)) {
      session = { domain, steps: [], detectedFlow: 'unknown', startTime: Date.now() };
      AuthSessionTracker.activeSessions.set(domain, session);
    }

    session.steps.push({
      url: window.location.href,
      timestamp: Date.now(),
      formFingerprint: fingerprint,
      detectedFields: fields as any,
    });

    session.detectedFlow = AuthSessionTracker.classifyFlow(session);
    void AuthSessionTracker.persist();
    return session;
  }

  private static isSessionStale(session: AuthSession): boolean {
    const MAX_AGE = 10 * 60 * 1000;
    return Date.now() - session.startTime > MAX_AGE;
  }

  private static classifyFlow(session: AuthSession): AuthFlowType {
    const allFields = session.steps.flatMap((s) => s.detectedFields.map((f) => f.type));
    const step1 = session.steps[0]?.detectedFields.map((f) => f.type) || [];
    const step2 = session.steps[1]?.detectedFields.map((f) => f.type) || [];

    if (step1.includes('email' as any) && step2.includes('password' as any)) {
      return 'split_login';
    }
    if (
      allFields.includes('email' as any) &&
      allFields.includes('password' as any) &&
      allFields.includes('otp_digit' as any)
    ) {
      return 'login_with_mfa';
    }
    if (allFields.includes('email' as any) && allFields.includes('password' as any)) {
      return 'single_page_login';
    }
    return 'unknown';
  }
}

interface IFrameMessage {
  type: 'SENTINEL_PROBE' | 'SENTINEL_RESULT' | 'SENTINEL_FILL';
  payload: any;
  sourceOrigin: string;
}

export class IFrameProxyV2 {
  private static instance: IFrameProxyV2;

  public static init(): void {
    if (!this.instance) {
      this.instance = new IFrameProxyV2();
      this.instance.listenForResults(() => {});
    }
  }

  public probeIframes(): void {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      if (this.isLikelyAuthIFrame(iframe)) {
        this.sendProbe(iframe);
      }
    }
  }

  private isLikelyAuthIFrame(iframe: HTMLIFrameElement): boolean {
    const src = iframe.src?.toLowerCase() || '';
    const keywords = ['auth', 'login', 'stripe', 'checkout', 'verify', 'pay'];
    return keywords.some((k) => src.includes(k));
  }

  private sendProbe(iframe: HTMLIFrameElement): void {
    const target = iframe.contentWindow;
    if (!target) return;

    let targetOrigin: string;
    try {
      if (iframe.src) {
        targetOrigin = new URL(iframe.src).origin;
        if (targetOrigin === 'null') return;
      } else {
        targetOrigin = window.location.origin;
      }
    } catch {
      return;
    }

    const message: IFrameMessage = {
      type: 'SENTINEL_PROBE',
      payload: {},
      sourceOrigin: window.location.origin,
    };
    target.postMessage(message, targetOrigin);
  }

  public listenForResults(callback: (results: any) => void): void {
    const TRUSTED_ORIGINS = [
      { hostname: 'stripe.com', allowSubdomains: true },
      { hostname: 'js.stripe.com', allowSubdomains: false },
      { hostname: 'paypal.com', allowSubdomains: true },
      { hostname: 'paypalobjects.com', allowSubdomains: false },
      { hostname: 'auth0.com', allowSubdomains: true },
      { hostname: 'google.com', allowSubdomains: true },
      { hostname: 'apple.com', allowSubdomains: true },
    ];

    window.addEventListener('message', (event: MessageEvent) => {
      const origin = event.origin;
      if (origin === window.location.origin) {
        const message = event.data as IFrameMessage;
        if (message && message.type === 'SENTINEL_RESULT') {
          callback(message.payload);
        }
        return;
      }

      let isTrusted = false;
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:') return;
        const hostname = url.hostname;

        isTrusted = TRUSTED_ORIGINS.some((trusted) => {
          if (trusted.allowSubdomains) {
            return hostname === trusted.hostname || hostname.endsWith('.' + trusted.hostname);
          }
          return hostname === trusted.hostname;
        });
      } catch {
        return;
      }

      if (!isTrusted) return;

      const message = event.data as IFrameMessage;
      if (message && message.type === 'SENTINEL_RESULT') {
        callback(message.payload);
      }
    });
  }
}

// ─── 6. FRAMEWORK & PAGE ANALYZER (formerly pageAnalyzer.ts) ──────────

export class PageAnalyzer {
  private static readonly PROVIDER_MAP: ReadonlyArray<readonly [RegExp, string]> = [
    [/clerk\.(dev|com)/i, 'Clerk'],
    [/auth0\.com/i, 'Auth0'],
    [/supabase/i, 'Supabase'],
    [/firebase/i, 'Firebase'],
    [/cognito|amazonaws/i, 'AWS Cognito'],
    [/okta/i, 'Okta'],
    [/ory\.|kratos/i, 'Ory Kratos'],
    [/stytch/i, 'Stytch'],
    [/keycloak/i, 'Keycloak'],
    [/supertokens/i, 'SuperTokens'],
    [/magic\.link/i, 'Magic Link'],
    [/workos/i, 'WorkOS'],
    [/kinde/i, 'Kinde Auth'],
    [/logto/i, 'Logto'],
    [/b2c\.login\.microsoft/i, 'Azure B2C'],
    [/auth\.pingidentity/i, 'Ping Identity'],
    [/github\.com/i, 'GitHub'],
    [/gitlab/i, 'GitLab'],
    [/bitbucket/i, 'Bitbucket'],
    [/slack\.com/i, 'Slack'],
    [/discord\.com|discordapp\.com/i, 'Discord'],
    [/linear\.app/i, 'Linear'],
    [/notion\.so/i, 'Notion'],
    [/vercel\.com/i, 'Vercel'],
    [/netlify\.com/i, 'Netlify'],
    [/stripe/i, 'Stripe'],
    [/paypal/i, 'PayPal'],
    [/shopify/i, 'Shopify'],
    [/amazon/i, 'Amazon'],
    [/paddle/i, 'Paddle'],
    [/mistral/i, 'Mistral'],
    [/microsoft|login\.live/i, 'Microsoft'],
    [/google[\w./]*accounts/i, 'Google'],
    [/apple\.com[\w./]*appleid/i, 'Apple ID'],
    [/linkedin\.com/i, 'LinkedIn'],
    [/x\.com|twitter\.com/i, 'X (Twitter)'],
  ] as const;

  private static readonly PAGE_PATTERNS: ReadonlyArray<{
    readonly type: PageType;
    readonly pattern: RegExp;
    readonly signal: string;
  }> = [
    {
      type: 'verification',
      pattern:
        /verify|verification|confirm[\s._-]*email|activate[\s._-]*account|enter[\s._-]*(your\s+)?code|one[-_\s]?time|otp|self[-_\s]?service[\s._-]*verification/i,
      signal: 'page:verification',
    },
    {
      type: '2fa',
      pattern: /two[-_\s]?factor|2fa|mfa|authenticat[\w]*[\s._-]*code|security[\s._-]*code/i,
      signal: 'page:2fa',
    },
    {
      type: 'password-reset',
      pattern:
        /reset[\s._-]*password|forgot[\s._-]*password|recover|new[\s._-]*password|change[\s._-]*password/i,
      signal: 'page:password-reset',
    },
    {
      type: 'signup',
      pattern: /sign\s*up|register|create\s*account|get\s*started|join\s*(us|now|free)|enroll/i,
      signal: 'page:signup',
    },
    {
      type: 'login',
      pattern: /sign\s*in|log\s*in|login|authenticate/i,
      signal: 'page:login',
    },
    {
      type: 'checkout',
      pattern: /checkout|billing|payment|subscribe|purchase/i,
      signal: 'page:checkout',
    },
    {
      type: 'profile',
      pattern: /profile|settings|account\s*settings|edit\s*profile|preferences/i,
      signal: 'page:profile',
    },
  ] as const;

  private static readonly FIELD_SELECTORS = {
    email:
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete*="email"], input[placeholder*="email" i], input[aria-label*="email" i]',
    password: 'input[type="password"]',
    otp: [
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[name="code"]',
      'input[id*="otp" i]',
      'input[maxlength="1"][type="text"]',
      'input[maxlength="1"][type="tel"]',
      'input[maxlength="4"]',
      'input[maxlength="6"]',
      'input[maxlength="8"]',
    ].join(', '),
    name: 'input[name*="name" i]:not([name*="user" i]), input[autocomplete="given-name"], input[autocomplete="family-name"]',
  } as const;

  private static readonly FRAMEWORK_DETECTORS: ReadonlyArray<{
    readonly name: string;
    readonly detect: () => boolean;
  }> = [
    {
      name: 'nextjs',
      detect: () => !!safeQuerySelector(document, 'script[id="__NEXT_DATA__"]'),
    },
    {
      name: 'react',
      detect: () => {
        const el =
          safeQuerySelector<HTMLElement>(document, 'input') ??
          safeQuerySelector<HTMLElement>(document, 'div');
        if (!el) {
          return false;
        }
        return Object.keys(el).some(
          (k) =>
            k.startsWith('__reactFiber$') ||
            k.startsWith('__reactProps$') ||
            k.startsWith('__reactInternalInstance$')
        );
      },
    },
    {
      name: 'vue',
      detect: () => {
        if ((document as Document & { __vue_app__?: unknown }).__vue_app__) {
          return true;
        }
        const allEls = document.body?.querySelectorAll('*');
        if (!allEls) {
          return false;
        }
        for (let i = 0, len = Math.min(allEls.length, 100); i < len; i++) {
          if (allEls[i]!.getAttributeNames().some((a) => /^data-v-[a-f0-9]+$/.test(a))) {
            return true;
          }
        }
        return false;
      },
    },
    {
      name: 'angular',
      detect: () =>
        !!(
          (window as Window & { ng?: unknown }).ng ??
          safeQuerySelector(document, '[ng-version]') ??
          safeQuerySelector(document, '[_nghost]') ??
          safeQuerySelector(document, '[ng-app]')
        ),
    },
    {
      name: 'svelte',
      detect: () =>
        !!(
          safeQuerySelector(document, '[class*="svelte-"]') ??
          safeQuerySelector(document, 'script[type="svelte-data"]')
        ),
    },
    {
      name: 'solid',
      detect: () =>
        !!(
          (window as Window & { _$HY?: unknown })._$HY ?? safeQuerySelector(document, '[data-hk]')
        ),
    },
    {
      name: 'htmx',
      detect: () => !!safeQuerySelector(document, '[hx-get], [hx-post], [hx-trigger]'),
    },
    {
      name: 'qwik',
      detect: () => !!safeQuerySelector(document, '[q\\:container], [q\\:id]'),
    },
  ];

  static analyze(): PageAnalysis {
    const url = window.location.href.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.textContent ?? '')
      .slice(0, PAGE_TEXT_SCAN_LIMIT)
      .toLowerCase();
    const metaContent = Array.from(document.querySelectorAll('meta'))
      .map((m) => (m.getAttribute('content') ?? '').toLowerCase())
      .join(' ');
    const combined = `${url} ${path} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];

    const hasEmailField = deepQuerySelectorAll(this.FIELD_SELECTORS.email).length > 0;
    const hasPasswordField = deepQuerySelectorAll(this.FIELD_SELECTORS.password).length > 0;
    const hasOTPField = deepQuerySelectorAll(this.FIELD_SELECTORS.otp).length > 0;
    const hasNameFields = deepQuerySelectorAll(this.FIELD_SELECTORS.name).length > 0;
    const formCount = deepQuerySelectorAll('form').length;
    const inputCount = deepQuerySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="reset"]):not([type="checkbox"]):not([type="radio"])' +
      ':not([type="file"]):not([type="image"]):not([type="range"])' +
      ':not([type="color"]):not([type="search"])'
    ).length;

    const pageType = this.classifyPage(
      combined,
      hasOTPField,
      hasPasswordField,
      hasEmailField,
      signals
    );

    const provider = this.detectProvider(url, signals);

    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);

    return Object.freeze({
      pageType,
      hasEmailField,
      hasPasswordField,
      hasOTPField,
      hasNameFields,
      formCount,
      inputCount,
      isAuthRelated: pageType !== 'non-auth',
      provider,
      framework,
      signals: Object.freeze(signals),
    });
  }

  private static classifyPage(
    combined: string,
    hasOTPField: boolean,
    hasPasswordField: boolean,
    hasEmailField: boolean,
    signals: string[]
  ): PageType {
    if (hasOTPField || this.PAGE_PATTERNS[0]!.pattern.test(combined)) {
      const is2FA = this.PAGE_PATTERNS[1]!.pattern.test(combined);
      const type = is2FA ? '2fa' : 'verification';
      signals.push(`page:${type}`);
      return type;
    }

    for (const { type, pattern, signal } of this.PAGE_PATTERNS) {
      if (type === 'verification' || type === '2fa') {
        continue;
      }
      if (pattern.test(combined)) {
        signals.push(signal);
        return type;
      }
    }

    if (hasPasswordField || hasEmailField) {
      signals.push('page:generic-form');
      return 'generic-form';
    }

    return 'non-auth';
  }

  private static detectProvider(url: string, signals: string[]): string | null {
    for (const [pattern, name] of this.PROVIDER_MAP) {
      if (pattern.test(url)) {
        signals.push(`provider:${name}`);
        return name;
      }
    }
    return null;
  }

  private static detectFramework(): string {
    for (const detector of this.FRAMEWORK_DETECTORS) {
      try {
        if (detector.detect()) {
          return detector.name;
        }
      } catch {
        // ignore
      }
    }
    return 'unknown';
  }
}

// ─── 7. LAYOUT PATTERN DETECTOR (formerly layout.ts) ──────────────────

export type LayoutPattern =
  | 'vertical_login'
  | 'vertical_signup'
  | 'horizontal_otp'
  | 'split_screen'
  | 'modal_overlay'
  | 'inline_form'
  | 'unknown';

export interface FormCluster {
  elements: HTMLElement[];
  boundingBox: DOMRect;
  layoutPattern: LayoutPattern;
  confidence: number;
}

export class LayoutPatternDetector {
  public static detectClusters(): FormCluster[] {
    const instance = new LayoutPatternDetector();
    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), select, textarea, button')
    );
    const clusters: FormCluster[] = [];
    const processed = new Set<Element>();

    for (const input of inputs) {
      if (processed.has(input)) {
        continue;
      }

      const clusterElements = instance.findNearbyElements(
        input as HTMLElement,
        inputs as HTMLElement[]
      );
      clusterElements.forEach((el) => processed.add(el));

      if (clusterElements.length > 0) {
        const boundingBox = instance.computeBoundingBox(clusterElements);
        const { pattern, confidence } = instance.classifyPattern(clusterElements, boundingBox);
        clusters.push({
          elements: clusterElements,
          boundingBox,
          layoutPattern: pattern,
          confidence,
        });
      }
    }

    return clusters;
  }

  private findNearbyElements(start: HTMLElement, all: HTMLElement[]): HTMLElement[] {
    const cluster = [start];
    const threshold = 150;
    const startRect = start.getBoundingClientRect();

    for (const el of all) {
      if (el === start) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      const dist = Math.sqrt(
        Math.pow(startRect.left - rect.left, 2) + Math.pow(startRect.top - rect.top, 2)
      );
      if (dist < threshold) {
        cluster.push(el);
      }
    }
    return cluster;
  }

  private computeBoundingBox(elements: HTMLElement[]): DOMRect {
    let top = Infinity,
      left = Infinity,
      bottom = -Infinity,
      right = -Infinity;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      bottom = Math.max(bottom, rect.bottom);
      right = Math.max(right, rect.right);
    }
    return new DOMRect(left, top, right - left, bottom - top);
  }

  private classifyPattern(
    elements: HTMLElement[],
    box: DOMRect
  ): { pattern: LayoutPattern; confidence: number } {
    const inputs = elements.filter((el) => el.tagName === 'INPUT');
    const buttons = elements.filter((el) => el.tagName === 'BUTTON');

    if (inputs.length >= 4 && inputs.length <= 8) {
      const isHorizontal = inputs.every(
        (el) =>
          Math.abs(el.getBoundingClientRect().top - inputs[0]!.getBoundingClientRect().top) < 10
      );
      if (isHorizontal) {
        return { pattern: 'horizontal_otp', confidence: 0.9 };
      }
    }

    if (inputs.length >= 2 && inputs.length <= 3 && buttons.length >= 1) {
      const isVertical = inputs.every(
        (el, i) =>
          i === 0 || el.getBoundingClientRect().top > inputs[i - 1]!.getBoundingClientRect().top
      );
      if (isVertical && box.width < 500) {
        return { pattern: 'vertical_login', confidence: 0.85 };
      }
    }

    const modal = elements[0]!.closest('[role="dialog"], .modal, .overlay');
    if (modal) {
      return { pattern: 'modal_overlay', confidence: 0.95 };
    }

    return { pattern: 'unknown', confidence: 0.5 };
  }
}
