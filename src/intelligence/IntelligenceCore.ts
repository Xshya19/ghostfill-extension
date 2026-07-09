import { FieldType } from '../types/form.types';
import { storageService } from '../services/storageService';
import { createLogger } from '../utils/logger';

const log = createLogger('IntelligenceCore');

// ─── 1. SHARED TYPES ──────────────────────────────────────────────────

export type FieldClass =
  | 'Email'
  | 'Username'
  | 'Password'
  | 'Target_Password_Confirm'
  | 'First_Name'
  | 'Last_Name'
  | 'Full_Name'
  | 'Phone'
  | 'OTP'
  | 'Unknown';

export const FIELD_CLASSES: FieldClass[] = [
  'Email',
  'Username',
  'Password',
  'Target_Password_Confirm',
  'First_Name',
  'Last_Name',
  'Full_Name',
  'Phone',
  'OTP',
  'Unknown',
];

export type HardNegative =
  | 'CVV'
  | 'CardNumber'
  | 'CardExpiry'
  | 'ZIP'
  | 'Search'
  | 'Coupon'
  | 'Captcha'
  | 'Honeypot'
  | 'Amount'
  | 'DateOfBirth';

export interface RawFieldRecord {
  url?: string | undefined;
  selector?: string | undefined;
  tag: string;
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string;
  surroundingText: string;
  maxLength: number;
  inputMode: string;
  pattern: string;
  required: boolean;
  visible: boolean;
  widthPx: number;
  focused?: boolean;
  opacityZero?: boolean;
  offscreen?: boolean;
  tiny?: boolean;
  className?: string | undefined;
  isSecondPasswordField?: boolean | undefined;
  dataAttributes?: Record<string, string> | undefined;
  title?: string | undefined;
  formFieldCount?: number | undefined;
  formAction?: string | undefined;
  isAnimating?: boolean | undefined;
  tabIndex?: number | undefined;
  closestHeadingText?: string | undefined;
  structural?: number[] | undefined;
}

export interface LabeledFieldRecord extends RawFieldRecord {
  label: FieldClass;
  hardNegative?: HardNegative | undefined;
  teacherConfidence?: number | undefined;
  rationale?: string | undefined;
}

export interface ClassificationResult {
  scores: Record<FieldClass, number>;
  top: FieldClass;
  topProb: number;
  margin: number;
  hardNegative?: HardNegative | undefined;
  signals: string[];
}

export type FillAction = 'FILL' | 'ABSTAIN' | 'BLOCK';

export interface FillDecision {
  action: FillAction;
  class: FieldClass;
  confidence: number;
  reason: string;
  safety?: string | undefined;
  signals: string[];
}

export const NUM_STRUCTURAL_FEATURES = 64;

export const STRUCT = {
  TYPE_TEXT: 0,
  TYPE_EMAIL: 1,
  TYPE_PASSWORD: 2,
  TYPE_TEL: 3,
  TYPE_NUMBER: 4,
  TYPE_SEARCH: 5,
  TYPE_HIDDEN: 6,
  TYPE_OTHER: 7,
  AC_EMAIL: 8,
  AC_USERNAME: 9,
  AC_CURRENT_PASSWORD: 10,
  AC_NEW_PASSWORD: 11,
  AC_ONE_TIME_CODE: 12,
  AC_TEL: 13,
  AC_NAME: 14,
  AC_OFF_OR_NONE: 15,
  MAXLEN_IS_1: 16,
  MAXLEN_LE_8: 17,
  WIDTH_LE_90: 18,
  INPUTMODE_NUMERIC: 19,
  PATTERN_DIGITS: 20,
  REQUIRED: 21,
  VISIBLE: 22,
  HAS_LABEL: 23,
  HAS_PLACEHOLDER: 24,
  HAS_ARIA: 25,
  IN_FORM: 26,
  SIBLING_SAME_SHAPE_COUNT_4_8: 27,
  OFFSCREEN: 28,
  ZERO_OPACITY: 29,
  TINY_SIZE: 30,
  IS_TEXTAREA: 31,
  KW_EMAIL: 32,
  KW_USER: 33,
  KW_PASS: 34,
  KW_CONFIRM: 35,
  KW_NEW: 36,
  KW_CURRENT: 37,
  KW_OTP: 38,
  KW_CODE: 39,
  KW_VERIFY: 40,
  KW_PHONE: 41,
  KW_FIRST: 42,
  KW_LAST: 43,
  KW_FULLNAME: 44,
  KW_CVV: 45,
  KW_CARD: 46,
  KW_EXPIRY: 47,
  KW_ZIP: 48,
  KW_SEARCH: 49,
  KW_COUPON: 50,
  KW_CAPTCHA: 51,
  KW_AMOUNT: 52,
  KW_DOB: 53,
  KW_DIGITS_IN_NAME: 54,
  KW_OTP_LENGTH_HINT: 55,
  HAS_DATA_TESTID: 56,
  HAS_TITLE: 57,
  FORM_HAS_2_PASSWORDS: 58,
  IS_ANIMATING: 59,
  TAB_INDEX_SET: 60,
  URL_LOGIN_SIGNUP: 61,
  HEADING_OTP_KEYWORD: 62,
  FORM_FIELD_COUNT_LE_4: 63,
} as const;

export function emptyStructural(): number[] {
  return new Array(NUM_STRUCTURAL_FEATURES).fill(0);
}

// ─── 2. KEYWORDS & MATCHERS ──────────────────────────────────────────

export const KW = {
  email: [
    'email',
    'e-mail',
    'correo',
    'courriel',
    'mail',
    'emailid',
    'email address',
    'email_address',
    'email-address',
    'correo electronico',
    'correo-electronico',
    'adresse e-mail',
    'adresse-email',
    'adresse de messagerie',
    'e-mail-adresse',
    'email_id',
    'ईमेल',
    '邮箱',
    'メール',
    '이메일',
    'البريد',
    'correio',
    'e-posta'
  ],
  user: [
    'username',
    'user name',
    'userid',
    'user id',
    'login',
    'usuario',
    'utilisateur',
    'benutzer',
    'handle',
    'user_name',
    'user-name',
    'username_or_email',
    'username-or-email',
    'email_or_username',
    'email-or-username',
    'login_field',
    'mobile_or_email',
    'identificador',
    'user_id',
    'nom d\'utilisateur',
    'usuario o correo',
    'उपयोगकर्ता',
    '用户名',
    'ユーザー名',
    '사용자명',
    'اسم المستخدم',
    'nome de usuário',
    'kullanıcı adı'
  ],
  password: [
    'password',
    'passwd',
    'pwd',
    'contrasena',
    'contraseña',
    'mot de passe',
    'passwort',
    'senha',
    'paswaard',
    'passcode',
    'mot_de_passe',
    'pass_wort',
    'passphrase',
    'pass-phrase',
    'पासवर्ड',
    '密码',
    'パスワード',
    '비밀번호',
    'كلمة المرور',
    'senha',
    'şifre'
  ],
  confirm: [
    'confirm',
    'repeat',
    're-enter',
    'reenter',
    'again',
    'verify password',
    'confirmar',
    'repetir',
    'bestatigen',
    'wiederholen',
    'confirm password',
    'confirm-password',
    'confirm_password',
    'password confirmation',
    'password_confirmation',
    'repeat password',
    'repeat_password',
    're-enter password',
    'verify password',
    'repetir contraseña',
    'confirmer le mot de passe'
  ],
  newpw: [
    'new password',
    'create password',
    'choose password',
    'set password',
    'nueva contrasena',
    'nueva contraseña',
    'nouveau mot de passe',
    'new_password',
    'new-password',
    'create_password',
    'create-password',
    'choose_password',
    'set_password',
    'nouveau-mot-de-passe'
  ],
  currentpw: ['current password', 'old password', 'existing password', 'current_password', 'current-password'],
  otp: [
    'otp',
    'one-time',
    'one time',
    'onetime',
    'verification code',
    'security code',
    'auth code',
    'authentication code',
    'login code',
    'sign-in code',
    'passcode',
    'codigo',
    'code de verification',
    'verification_code',
    'verification-code',
    'security_code',
    'security-code',
    'auth_code',
    'auth-code',
    'pass_code',
    'pass-code',
    'one_time_password',
    'one-time-password',
    'code_de_verification',
    'einmalpasswort',
    'sms_code',
    'sms-code',
    'सत्यापन कोड',
    '验证码',
    '認証コード',
    '인증번호',
    'رمز التحقق',
    'código de verificação',
    'doğrulama kodu'
  ],
  code: ['code', 'pin', 'token'],
  verify: ['verify', 'verification', 'confirm your', 'enter the code', 'we sent', 'sent to your'],
  phone: [
    'phone',
    'mobile',
    'cell',
    'telephone',
    'tel',
    'contact number',
    'telefono',
    'numero',
    'handynummer',
    'celular',
    'mobile number',
    'phone_number',
    'phone-number',
    'mobile_number',
    'फ़ोन',
    '手机号',
    '電話番号',
    '전화번호',
    'رقم الهاتف',
    'telefone',
    'telefon'
  ],
  first: [
    'first name',
    'firstname',
    'given name',
    'forename',
    'nombre',
    'prenom',
    'vorname',
    'first',
    'fname',
    'first_name',
    'first-name',
    'given_name',
    'given-name'
  ],
  last: [
    'last name',
    'lastname',
    'surname',
    'family name',
    'apellido',
    'nom de famille',
    'nachname',
    'last',
    'lname',
    'last_name',
    'last-name',
    'family_name',
    'family-name'
  ],
  fullname: [
    'full name',
    'fullname',
    'your name',
    'name',
    'nombre completo',
    'nom complet',
    'cardholder name',
    'full_name',
    'full-name',
    'your_name',
    'your-name',
    'name_and_surname',
    'cardholder_name',
    'cardholder-name',
    'nombre_completo'
  ],
  cvv: ['cvv', 'cvc', 'csc', 'security code', 'card verification', 'cvv2'],
  card: ['card number', 'cardnumber', 'credit card', 'debit card', 'cc number', 'pan'],
  expiry: ['expiry', 'expiration', 'exp date', 'mm/yy', 'mm / yy', 'valid thru', 'valid till'],
  zip: ['zip', 'zipcode', 'postal code', 'postcode', 'pin code', 'codigo postal'],
  search: ['search', 'buscar', 'rechercher', 'suchen', 'find', 'query'],
  coupon: ['coupon', 'promo', 'promotion', 'discount', 'voucher', 'gift code', 'referral'],
  captcha: ['captcha', 'i am not a robot', 'recaptcha', 'hcaptcha', 'human verification'],
  amount: ['amount', 'quantity', 'qty', 'total', 'price', 'cantidad', 'montant'],
  dob: ['date of birth', 'birth date', 'birthday', 'dob', 'fecha de nacimiento'],
};

export type KeywordGroup = keyof typeof KW;

export function normalizeText(input: string): string {
  if (!input) {
    return '';
  }
  let s = input.replace(/[\u200B-\u200D\u200E\u200F\uFEFF]/g, '').toLowerCase();
  s = s.normalize('NFD');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 768 && code <= 879) {
      continue;
    }
    out += ch;
  }
  out = out.replace(/[ \t\r\n]+/g, ' ').trim();
  return out;
}

export function matchesAny(text: string, group: KeywordGroup): boolean {
  const t = normalizeText(text);
  if (!t) {
    return false;
  }
  for (const kw of KW[group]) {
    // Dynamic pre-normalization of keywords to ensure accentless matches work 100% reliably
    if (t.includes(normalizeText(kw))) {
      return true;
    }
  }
  return false;
}

// ─── 3. SAFETY GATE ───────────────────────────────────────────────────

export interface SafetyVerdict {
  allow: boolean;
  reason: string;
}

function otpCapable(r: RawFieldRecord): boolean {
  if (r.type === 'email') {
    return false;
  }
  if (r.maxLength > 0 && r.maxLength < 4 && r.maxLength !== 1) {
    return false;
  }
  return true;
}

const STRONG_IDP_PATH_TOKENS: readonly string[] = [
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
  '/.well-known/saml',
  '/protocol/openid-connect',
  '/connect/authorize',
  '/connect/token',
  '/saml/',
  '/saml2/',
  '/oauth/',
  '/oauth2/',
  '/oidc/',
  '/authorize',
  '/protocol/',
  '/realms/',
  '/application/o/',
  '/self-service/',
  '/api/v1/registration',
  '/v2/identity-providers/',
  '/v1/sessions',
  '/oauth2/v2.0/',
  '/common/oauth2/',
];

const WEAK_IDP_PATH_TOKENS: readonly string[] = [
  '/sso/',
  '/signin/',
  '/sign-in/',
  '/auth/',
  '/identity/',
  '/account/',
  '/login/',
];

const IDP_SUBDOMAIN_PATTERNS: readonly RegExp[] = [
  /(?:^|\.)[a-z0-9-]+\.auth0\.(?:com|eu|au)$/i,
  /(?:^|\.)[a-z0-9-]+\.okta(?:-(?:emea|gov|govt))?\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.oktapreview\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.oktadev\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.onelogin\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.pingidentity\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.jumpcloud\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.ory\.sh$/i,
  /\.auth\.[a-z0-9-]+\.amazoncognito\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.(?:akamai|cloudflareaccess|linode)\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.workos\.com$/i,
];

function looksLikeOAuthFlow(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const query = parsed.search.toLowerCase();

  for (const token of STRONG_IDP_PATH_TOKENS) {
    if (path.includes(token)) {
      return true;
    }
  }

  for (const rx of IDP_SUBDOMAIN_PATTERNS) {
    if (rx.test(host)) {
      return true;
    }
  }

  let weakPathHits = 0;
  for (const token of WEAK_IDP_PATH_TOKENS) {
    if (path.includes(token)) {
      weakPathHits++;
    }
  }

  const OAUTH_PARAMS = [
    'response_type=',
    'client_id=',
    'redirect_uri=',
    'state=',
    'code_challenge=',
    'code_challenge_method=',
    'nonce=',
    'prompt=',
    'acr_values=',
  ];
  let oauthParamHits = 0;
  for (const param of OAUTH_PARAMS) {
    if (query.includes(param)) {
      oauthParamHits++;
    }
  }

  if (weakPathHits >= 2) {
    return true;
  }
  if (weakPathHits >= 1 && oauthParamHits >= 1) {
    return true;
  }
  if (oauthParamHits >= 2) {
    return true;
  }
  if (query.includes('scope=openid') || query.includes('response_type=code')) {
    return true;
  }

  return false;
}

export function checkSafety(
  r: RawFieldRecord,
  result: ClassificationResult,
  chosen: FieldClass
): SafetyVerdict {
  if (r.isAnimating) {
    return { allow: true, reason: 'element is transitioning/animating' };
  }

  if (result.hardNegative === 'Honeypot' && !looksLikeOAuthFlow(r.url ?? '')) {
    return { allow: false, reason: 'honeypot trap field' };
  }
  if (!r.visible && r.type !== 'hidden') {
    const isCustomStyledInput = r.opacityZero && !r.offscreen && !r.tiny;
    if (!r.focused && !isCustomStyledInput) {
      return { allow: false, reason: 'field not visible' };
    }
  }
  const dangerousNegatives = new Set([
    'CVV',
    'CardNumber',
    'CardExpiry',
    'Captcha',
    'Coupon',
    'Search',
    'Amount',
    'ZIP',
    'DateOfBirth',
  ]);
  if (result.hardNegative && dangerousNegatives.has(result.hardNegative) && chosen !== 'Unknown') {
    return {
      allow: false,
      reason: 'target looks like ' + result.hardNegative + ', refusing identity/OTP fill',
    };
  }
  if (chosen === 'OTP' && !otpCapable(r)) {
    return { allow: false, reason: 'element not OTP-capable (type/maxLength)' };
  }
  if ((chosen === 'Password' || chosen === 'Target_Password_Confirm') && r.type === 'email') {
    return { allow: false, reason: 'refusing to type password into an email field' };
  }
  return { allow: true, reason: 'no safety rule triggered' };
}

export function verifyFill(
  expected: string,
  actual: string,
  fieldType: string
): { ok: boolean; reason: string } {
  if (actual === expected) {
    return { ok: true, reason: 'exact match' };
  }
  if (fieldType === 'phone' || fieldType === 'tel') {
    const normalize = (val: string) => val.replace(/[^0-9]/g, '');
    if (normalize(actual) === normalize(expected)) {
      return { ok: true, reason: 'matched telephone digits' };
    }
  }
  if (fieldType === 'number') {
    const strippedExpected = expected.replace(/^0+/, '');
    if (actual === strippedExpected && strippedExpected !== expected) {
      return {
        ok: false,
        reason: 'number field dropped leading zero(s); refill via keystroke path',
      };
    }
  }
  const digitsExpected = expected.replace(/[^0-9]/g, '');
  const digitsActual = actual.replace(/[^0-9]/g, '');
  if (digitsExpected && digitsExpected === digitsActual) {
    return { ok: true, reason: 'matched after stripping formatting' };
  }
  return { ok: false, reason: 'value mismatch after fill' };
}

// ─── 4. HEURISTIC CLASSIFIER ──────────────────────────────────────────

type Scores = Record<FieldClass, number>;

function zeroScores(): Scores {
  const s = {} as Scores;
  for (const c of FIELD_CLASSES) {
    s[c] = 0;
  }
  return s;
}

function combinedText(r: RawFieldRecord): string {
  const dataVals = r.dataAttributes ? Object.values(r.dataAttributes).join(' ') : '';
  return [
    r.labelText,
    r.placeholder,
    r.ariaLabel,
    r.surroundingText,
    r.name,
    r.id,
    r.autocomplete,
    r.className || '',
    dataVals,
    r.title || '',
  ].join(' ');
}

export function looksLikeOtpField(r: RawFieldRecord): boolean {
  const text = combinedText(r);
  const textOtp =
    matchesAny(text, 'otp') || (matchesAny(text, 'code') && matchesAny(text, 'verify'));
  const splitShape =
    r.maxLength === 1 &&
    (r.inputMode === 'numeric' || r.type === 'tel' || r.type === 'number' || r.type === 'text');
  const shortNumeric =
    r.maxLength > 0 &&
    r.maxLength <= 8 &&
    (r.inputMode === 'numeric' || r.autocomplete.includes('one-time-code'));
  
  const hasSiblingSameShapeCount = Boolean(r.structural && r.structural[27] === 1);

  return (
    r.autocomplete.includes('one-time-code') ||
    (textOtp && (splitShape || shortNumeric || r.maxLength === 6)) ||
    (splitShape && hasSiblingSameShapeCount)
  );
}

export function detectHardNegative(r: RawFieldRecord): HardNegative | undefined {
  const text = combinedText(r);
  
  if (r.dataAttributes) {
    const dataText = Object.values(r.dataAttributes).join(' ').toLowerCase();
    if (matchesAny(dataText, 'search')) return 'Search';
    if (matchesAny(dataText, 'captcha')) return 'Captcha';
    if (matchesAny(dataText, 'coupon')) return 'Coupon';
  }

  if (
    r.type !== 'hidden' &&
    !r.visible &&
    r.opacityZero &&
    (r.offscreen || r.tiny) &&
    !r.focused &&
    (matchesAny(text, 'email') || matchesAny(text, 'user') || matchesAny(text, 'fullname'))
  ) {
    return 'Honeypot';
  }
  if (matchesAny(text, 'cvv')) {
    return 'CVV';
  }
  if (matchesAny(text, 'card')) {
    return 'CardNumber';
  }
  if (matchesAny(text, 'expiry')) {
    return 'CardExpiry';
  }
  if (matchesAny(text, 'captcha')) {
    return 'Captcha';
  }
  if (matchesAny(text, 'coupon')) {
    return 'Coupon';
  }
  if (r.type === 'search' || matchesAny(text, 'search')) {
    return 'Search';
  }
  if (matchesAny(text, 'zip')) {
    return 'ZIP';
  }
  if (matchesAny(text, 'dob')) {
    return 'DateOfBirth';
  }
  if (matchesAny(text, 'amount')) {
    return 'Amount';
  }
  return undefined;
}

function softmax(scores: Scores, temperature: number): Scores {
  const t = temperature > 0 ? temperature : 1;
  const vals = FIELD_CLASSES.map((c) => (scores[c] ?? 0) / t);
  const max = Math.max(...vals);
  const exps = vals.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out = zeroScores();
  FIELD_CLASSES.forEach((c, i) => {
    const expVal = exps[i];
    if (expVal !== undefined) {
      out[c] = expVal / sum;
    }
  });
  return out;
}

export interface ClassifyOptions {
  temperature?: number | undefined;
}

export function classifyHeuristic(
  r: RawFieldRecord,
  opts: ClassifyOptions = {}
): ClassificationResult {
  const s = zeroScores();
  const signals: string[] = [];
  const add = (c: FieldClass, w: number, why: string) => {
    s[c] += w;
    signals.push(why + ' -> ' + c + ' (+' + w + ')');
  };
  const text = combinedText(r);
  const ac = r.autocomplete;

  s.Unknown += 0.6;

  if (ac.includes('one-time-code')) {
    add('OTP', 6, 'autocomplete=one-time-code');
  }
  if (ac.includes('email')) {
    add('Email', 5, 'autocomplete=email');
  }
  if (ac.includes('username')) {
    add('Username', 5, 'autocomplete=username');
  }
  if (ac.includes('current-password')) {
    add('Password', 5.5, 'autocomplete=current-password');
  }
  if (ac.includes('new-password')) {
    add('Password', 3, 'autocomplete=new-password');
    add('Target_Password_Confirm', 1.5, 'new-password may be confirm');
  }
  if (ac.includes('tel')) {
    add('Phone', 5, 'autocomplete=tel');
  }
  if (ac.includes('given-name')) {
    add('First_Name', 5, 'autocomplete=given-name');
  }
  if (ac.includes('family-name')) {
    add('Last_Name', 5, 'autocomplete=family-name');
  }
  if (ac === 'name' || ac.includes('cc-name')) {
    add('Full_Name', 4.5, 'autocomplete=name');
  }

  if (r.type === 'email') {
    add('Email', 3.5, 'type=email');
  }
  if (r.type === 'tel') {
    add('Phone', 3, 'type=tel');
  }
  if (r.type === 'password') {
    add('Password', 3.5, 'type=password');
    add('Target_Password_Confirm', 1, 'type=password');
  }

  if (looksLikeOtpField(r)) {
    add('OTP', 4.5, 'otp structural/text signal');
  }

  if (matchesAny(text, 'email')) {
    add('Email', 3, 'kw:email');
  }
  if (matchesAny(text, 'user')) {
    add('Username', 2.5, 'kw:user');
  }
  if (matchesAny(text, 'password')) {
    add('Password', 2.5, 'kw:password');
    if (matchesAny(text, 'confirm')) {
      add('Target_Password_Confirm', 3.5, 'kw:confirm+password');
    }
    if (matchesAny(text, 'newpw')) {
      add('Password', 1.5, 'kw:new-password');
    }
    if (matchesAny(text, 'currentpw')) {
      add('Password', 1.5, 'kw:current-password');
    }
  }
  if (matchesAny(text, 'confirm') && (matchesAny(text, 'password') || r.type === 'password')) {
    add('Target_Password_Confirm', 6, 'confirm+password dominance');
    s.Password *= 0.35;
    signals.push('dampen Password in favor of confirm');
  }
  if (matchesAny(text, 'otp')) {
    add('OTP', 3.5, 'kw:otp');
  }
  if (matchesAny(text, 'phone')) {
    add('Phone', 3, 'kw:phone');
  }
  if (matchesAny(text, 'first')) {
    add('First_Name', 3.5, 'kw:first-name');
  }
  if (matchesAny(text, 'last')) {
    add('Last_Name', 3.5, 'kw:last-name');
  }

  const localTxt = [r.labelText, r.placeholder, r.ariaLabel, r.name, r.id, r.autocomplete].join(
    ' '
  );
  const hasLocalFirst = matchesAny(localTxt, 'first');
  const hasLocalLast = matchesAny(localTxt, 'last');
  const normLocalText = normalizeText(localTxt);
  const hasExplicitFullName =
    matchesAny(text, 'fullname') &&
    !hasLocalFirst &&
    !hasLocalLast &&
    !normLocalText.includes('first name') &&
    !normLocalText.includes('last name') &&
    !normLocalText.includes('given name') &&
    !normLocalText.includes('family name');

  if (hasExplicitFullName) {
    add('Full_Name', 4, 'kw:fullname');
  }

  const hard = detectHardNegative(r);
  const probs = softmax(s, opts.temperature ?? 1.0);
  let top: FieldClass = 'Unknown';
  let topProb = 0;
  for (const c of FIELD_CLASSES) {
    const p = probs[c] ?? 0;
    if (p > topProb) {
      topProb = p;
      top = c;
    }
  }

  const sortedProbs = FIELD_CLASSES.map((c) => probs[c] ?? 0).sort((a, b) => b - a);
  const margin = (sortedProbs[0] ?? 0) - (sortedProbs[1] ?? 0);

  return {
    scores: probs,
    top,
    topProb,
    margin,
    hardNegative: hard,
    signals,
  };
}

export function classifyField(
  record: RawFieldRecord,
  opts: ClassifyOptions = {}
): FillDecision {
  const result = classifyHeuristic(record, opts);
  const chosen = result.top;

  const safety = checkSafety(record, result, chosen);
  const confidence = result.topProb;

  if (!safety.allow) {
    return {
      action: 'BLOCK',
      class: chosen,
      confidence,
      reason: 'safety-gate: ' + safety.reason,
      safety: safety.reason,
      signals: [...result.signals],
    };
  }

  const threshold = chosen === 'OTP' ? 0.35 : 0.45;
  if (confidence < threshold) {
    return {
      action: 'ABSTAIN',
      class: chosen,
      confidence,
      reason: `confidence ${confidence.toFixed(2)} < threshold ${threshold}`,
      signals: [...result.signals],
    };
  }

  return {
    action: 'FILL',
    class: chosen,
    confidence,
    reason: `confidence ${confidence.toFixed(2)} >= threshold ${threshold}`,
    signals: [...result.signals],
  };
}

// ─── 5. CLASSIFIER ENTRYPOINT GATEWAY ─────────────────────────────────

export interface CalibratedResult {
  fieldType: FieldType;
  rawScore: number;
  confidence: number;
  margin: number;
  signals: string[];
  decision: 'FILL' | 'ABSTAIN' | 'BLOCK';
  safetyReason?: string | undefined;
}

export class IntelligenceCore {
  private temperature = 1.0;
  private classificationCache = new Map<string, CalibratedResult>();
  private adaptive = new AdaptiveStrategyEngine();

  constructor(temperature: number = 1.0) {
    this.temperature = temperature;
  }

  classify(record: RawFieldRecord): CalibratedResult {
    const fingerprint = [
      record.tag,
      record.type,
      record.name,
      record.id,
      record.placeholder,
      record.autocomplete,
      record.className || '',
      record.labelText,
    ].join('|');

    const cached = this.classificationCache.get(fingerprint);
    if (cached) {
      return cached;
    }

    const { result, decision } = this.classifyLegacyHelper(record);

    const fieldType = mapFieldClassToFieldType(result.top);
    const confidence = result.topProb;
    const rawScore = Math.log(result.topProb / (1 - result.topProb + 1e-9));

    let finalDecision: 'FILL' | 'ABSTAIN' | 'BLOCK' = 'FILL';
    if (decision.action === 'BLOCK') {
      finalDecision = 'BLOCK';
    } else if (decision.action === 'ABSTAIN') {
      finalDecision = 'ABSTAIN';
    }

    const calibrated: CalibratedResult = {
      fieldType,
      rawScore,
      confidence,
      margin: result.margin,
      signals: [...result.signals],
      decision: finalDecision,
      safetyReason: decision.safety,
    };

    this.classificationCache.set(fingerprint, calibrated);
    return calibrated;
  }

  private classifyLegacyHelper(record: RawFieldRecord) {
    const result = classifyHeuristic(record, { temperature: this.temperature });
    const decision = classifyField(record, { temperature: this.temperature });
    return { result, decision };
  }

  classifyBatch(records: RawFieldRecord[]): CalibratedResult[] {
    const results = records.map(r => this.classify(r));

    for (let i = 0; i < results.length; i++) {
      const current = results[i];
      if (!current) continue;

      if (i > 0) {
        const prev = results[i - 1];
        if (prev && (prev.fieldType === 'email' || prev.fieldType === 'username') && prev.decision === 'ABSTAIN') {
          if (current.fieldType === 'password' && current.decision === 'FILL') {
            prev.decision = 'FILL';
            prev.confidence = Math.max(prev.confidence, 0.65);
            prev.signals.push('batch: promoted email/username due to confident password sibling');
          }
        }
      }

      if (i > 0) {
        const prev = results[i - 1];
        if (prev && prev.fieldType === 'email' && prev.decision === 'FILL') {
          if (current.fieldType === 'password' && current.decision === 'ABSTAIN') {
            current.decision = 'FILL';
            current.confidence = Math.max(current.confidence, 0.65);
            current.signals.push('batch: promoted password due to confident email sibling');
          }
        }
      }

      if (i > 0) {
        const prev = results[i - 1];
        if (prev && prev.fieldType === 'password' && prev.decision === 'FILL') {
          if (current.fieldType === 'confirm-password' && current.decision === 'ABSTAIN') {
            current.decision = 'FILL';
            current.confidence = Math.max(current.confidence, 0.65);
            current.signals.push('batch: promoted confirm-password due to confident password sibling');
          }
        }
      }
    }

    return results;
  }

  clearCache(): void {
    this.classificationCache.clear();
  }

  setTemperature(t: number): void {
    if (t > 0) {
      this.temperature = t;
    }
  }

  getAdaptiveEngine(): AdaptiveStrategyEngine {
    return this.adaptive;
  }
}

export function mapFieldClassToFieldType(cls: FieldClass): FieldType {
  switch (cls) {
    case 'Email':
      return 'email';
    case 'Username':
      return 'username';
    case 'Password':
      return 'password';
    case 'Target_Password_Confirm':
      return 'confirm-password';
    case 'First_Name':
      return 'first-name';
    case 'Last_Name':
      return 'last-name';
    case 'Full_Name':
      return 'full-name';
    case 'Phone':
      return 'phone';
    case 'OTP':
      return 'otp';
    case 'Unknown':
      return 'unknown';
    default: {
      const exhaustiveCheck: never = cls;
      return exhaustiveCheck;
    }
  }
}

// ─── 6. HISTORY & TELEMETRY ──────────────────────────────────────────

export class HistoryManager {
  private static readonly KEY_PREFIX = 'trusted_selector_';

  static async getTrustedSelector(domain: string, type: FieldType): Promise<string | null> {
    try {
      const data = await chrome.storage.local.get(`${this.KEY_PREFIX}${domain}`);
      return data[`${this.KEY_PREFIX}${domain}`]?.[type] || null;
    } catch {
      return null;
    }
  }

  static async saveTrustedSelector(domain: string, type: FieldType, selector: string): Promise<void> {
    try {
      const key = `${this.KEY_PREFIX}${domain}`;
      const existing = (await chrome.storage.local.get(key))[key] || {};
      existing[type] = selector;
      await chrome.storage.local.set({ [key]: existing });
    } catch {
      // ignore
    }
  }
}

export interface TelemetryEvent {
  timestamp: number;
  hostname: string;
  action: 'classify' | 'detect' | 'fill' | 'verify';
  strategy?: string;
  outcome: 'success' | 'failure' | 'abstain' | 'block';
  latencyMs: number;
}

export class TelemetryCollector {
  private readonly STORAGE_KEY = 'ghostfill_telemetry_events';
  private events: TelemetryEvent[] = [];

  async record(event: Omit<TelemetryEvent, 'timestamp' | 'hostname'>): Promise<void> {
    const timestamp = Date.now();
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'background';
    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp,
      hostname,
    };

    this.events.push(fullEvent);

    if (this.events.length > 100) {
      this.events.shift();
    }

    try {
      const stored = (await storageService.get(this.STORAGE_KEY as any)) as TelemetryEvent[] || [];
      stored.push(fullEvent);

      if (stored.length > 1000) {
        stored.shift();
      }

      await storageService.set(this.STORAGE_KEY as any, stored);
    } catch {
      // safe fallback
    }
  }

  async getEvents(): Promise<TelemetryEvent[]> {
    try {
      return (await storageService.get(this.STORAGE_KEY as any)) as TelemetryEvent[] || [];
    } catch {
      return this.events;
    }
  }

  async clearEvents(): Promise<void> {
    this.events = [];
    try {
      await storageService.set(this.STORAGE_KEY as any, []);
    } catch {
      // safe fallback
    }
  }
}

export interface DiagnosticsReport {
  successRate: number;
  totalFills: number;
  avgLatencyMs: number;
  mostSuccessfulStrategy: string;
  status: 'healthy' | 'degraded';
  recommendations: string[];
}

export class SelfDiagnostics {
  private telemetry: TelemetryCollector;

  constructor(telemetry = new TelemetryCollector()) {
    this.telemetry = telemetry;
  }

  async run(): Promise<DiagnosticsReport> {
    const events = await this.telemetry.getEvents();
    const fillEvents = events.filter((e) => e.action === 'fill' || e.action === 'verify');

    if (fillEvents.length === 0) {
      return {
        successRate: 100,
        totalFills: 0,
        avgLatencyMs: 0,
        mostSuccessfulStrategy: 'none',
        status: 'healthy',
        recommendations: ['No fill outcomes recorded yet. Interact with forms to populate statistics.'],
      };
    }

    const successes = fillEvents.filter((e) => e.outcome === 'success').length;
    const successRate = Math.round((successes / fillEvents.length) * 100);
    const avgLatencyMs = Math.round(fillEvents.reduce((sum, e) => sum + e.latencyMs, 0) / fillEvents.length);

    const strategyCounts = new Map<string, number>();
    for (const e of fillEvents) {
      if (e.outcome === 'success' && e.strategy) {
        strategyCounts.set(e.strategy, (strategyCounts.get(e.strategy) || 0) + 1);
      }
    }

    let mostSuccessfulStrategy = 'none';
    let maxCount = 0;
    for (const [strategy, count] of strategyCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostSuccessfulStrategy = strategy;
      }
    }

    const recommendations: string[] = [];
    if (successRate < 90) {
      recommendations.push(
        'Fill success rate is below 90%. Consider checking page custom fields or reporting the site framework.'
      );
    }
    if (avgLatencyMs > 1000) {
      recommendations.push(
        'Average fill latency is high. Consider using less heavy typing simulation delays.'
      );
    }

    return {
      successRate,
      totalFills: fillEvents.length,
      avgLatencyMs,
      mostSuccessfulStrategy,
      status: successRate >= 80 ? 'healthy' : 'degraded',
      recommendations,
    };
  }
}

// ─── 7. ADAPTIVE STRATEGY ENGINE & VERIFICATION LOOP ──────────────────

export interface StrategyStats {
  attempts: number;
  successes: number;
  avgLatency: number;
  lastUsed: number;
}

export class AdaptiveStrategyEngine {
  private successRates: Map<string, Map<string, StrategyStats>> = new Map();
  private explorationRate = 0.1;
  private readonly STORAGE_KEY = 'adaptive_strategy_stats';
  private initialized = false;
  private lastPersistTime = 0;
  private pendingWriteCount = 0;

  constructor(explorationRate = 0.1) {
    this.explorationRate = explorationRate;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await storageService.get(this.STORAGE_KEY as any);
      if (stored && typeof stored === 'object') {
        const rawStats = stored as Record<string, Record<string, StrategyStats>>;
        for (const [siteKey, strategies] of Object.entries(rawStats)) {
          const innerMap = new Map<string, StrategyStats>();
          for (const [strategy, stats] of Object.entries(strategies)) {
            const ageDays = (Date.now() - stats.lastUsed) / (1000 * 60 * 60 * 24);
            if (ageDays >= 1) {
              const decayFactor = Math.pow(0.95, Math.floor(ageDays));
              stats.successes = stats.successes * decayFactor;
              stats.attempts = stats.attempts * decayFactor;
            }
            innerMap.set(strategy, stats);
          }
          this.successRates.set(siteKey, innerMap);
        }
      }
    } catch (e) {
      // safe fallback
    }
    this.initialized = true;
    this.lastPersistTime = Date.now();
  }

  async recordOutcome(
    site: string,
    strategy: string,
    fieldType: FieldType,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    await this.init();

    const siteKey = `${site}:${fieldType}`;
    let siteMap = this.successRates.get(siteKey);
    if (!siteMap) {
      siteMap = new Map();
      this.successRates.set(siteKey, siteMap);
    }

    let stats = siteMap.get(strategy);
    if (!stats) {
      stats = { attempts: 0, successes: 0, avgLatency: 0, lastUsed: 0 };
    }

    stats.attempts++;
    if (success) stats.successes++;
    stats.lastUsed = Date.now();

    stats.avgLatency = stats.avgLatency === 0 ? latencyMs : stats.avgLatency * 0.9 + latencyMs * 0.1;

    siteMap.set(strategy, stats);
    
    this.pendingWriteCount++;
    const timeSinceLastWrite = Date.now() - this.lastPersistTime;
    if (this.pendingWriteCount >= 5 || timeSinceLastWrite >= 30000) {
      await this.persist();
      this.pendingWriteCount = 0;
      this.lastPersistTime = Date.now();
    }
  }

  getOptimalStrategyOrder<T extends { name: string }>(
    site: string,
    strategies: T[],
    fieldType?: FieldType
  ): T[] {
    const siteKey = fieldType ? `${site}:${fieldType}` : site;
    const siteMap = this.successRates.get(siteKey) || this.successRates.get(site);

    const scored = strategies.map((strategy) => {
      const stats = siteMap?.get(strategy.name);
      let score = 0.5;

      if (stats && stats.attempts > 0) {
        const successRate = stats.successes / stats.attempts;
        const adaptiveExploration = 0.1 / (1 + Math.log2(1 + stats.attempts));
        const explorationBonus = stats.attempts < 5 ? adaptiveExploration : 0;
        const latencyPenalty = Math.min(stats.avgLatency / 5000, 0.2);

        score = successRate + explorationBonus - latencyPenalty;
      } else {
        score += this.explorationRate;
      }

      return { strategy, score };
    });

    return scored.sort((a, b) => b.score - a.score).map((x) => x.strategy);
  }

  async flush(): Promise<void> {
    if (this.pendingWriteCount > 0) {
      await this.persist();
      this.pendingWriteCount = 0;
      this.lastPersistTime = Date.now();
    }
  }

  private async persist(): Promise<void> {
    try {
      const plainObj: Record<string, Record<string, StrategyStats>> = {};
      for (const [siteKey, strategies] of this.successRates.entries()) {
        plainObj[siteKey] = {};
        for (const [strategy, stats] of strategies.entries()) {
          plainObj[siteKey][strategy] = stats;
        }
      }
      await storageService.set(this.STORAGE_KEY as any, plainObj);
    } catch (e) {
      // safe fallback
    }
  }
}

export interface VerificationResult {
  success: boolean;
  attempts: number;
  strategy: string;
}

export class VerificationLoop {
  private maxRetries: number;
  private baseDelayMs: number;

  constructor(maxRetries = 3, baseDelayMs = 150) {
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
  }

  async verifyAndCorrect(
    filler: any,
    candidate: any,
    value: string
  ): Promise<VerificationResult> {
    let attempt = 0;
    let strategyUsed = 'none';

    while (attempt < this.maxRetries) {
      attempt++;
      
      if (attempt > 1) {
        candidate.element.dispatchEvent(
          new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '' })
        );
      }

      const result = await filler.fill(candidate, value);

      if (result.success) {
        strategyUsed = result.strategy;

        const baseDelay = this.getFrameworkDelay(candidate.element);
        const currentDelay = baseDelay * (2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, currentDelay));

        const verified = this.deepVerify(candidate, value);
        if (verified) {
          return { success: true, attempts: attempt, strategy: strategyUsed };
        } else {
          log.warn(`Verification failed for field. Expected: ${value}, Got: ${candidate.element.value}. Attempting correction...`);
        }
      }
    }

    return { success: false, attempts: attempt, strategy: strategyUsed };
  }

  private deepVerify(candidate: any, expected: string): boolean {
    const el = candidate.element;
    if (!el.isConnected) return false;

    if (el.isContentEditable) {
      const actualText = el.textContent || '';
      return actualText.trim() === expected.trim();
    }

    if (el.type === 'password') {
      return el.value.length >= expected.length;
    }

    const actual = el.value || '';
    if (actual === expected) {
      return true;
    }

    const normalize = (val: string) => val.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalize(actual) === normalize(expected);
  }

  private getFrameworkDelay(el: HTMLElement): number {
    let current: HTMLElement | null = el;
    while (current) {
      const classStr = (current.className || '').toString().toLowerCase();
      if (classStr.includes('ng-') || current.tagName.includes('ANGULAR')) {
        return 120;
      }
      if (classStr.includes('vue') || (current as any).__vnode) {
        return 80;
      }
      if (classStr.includes('react') || Object.keys(current).some(k => k.startsWith('__react'))) {
        return 100;
      }
      current = current.parentElement;
    }
    return this.baseDelayMs;
  }
}
