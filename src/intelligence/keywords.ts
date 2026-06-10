// Compact multilingual keyword sets used by both the structural extractor and
// the heuristic classifier. Single source of truth (fixes audit P3-7/P3-8
// keyword drift). Lowercased, accent-insensitive matching is the caller's job.
//
// These are intentionally small + high-precision. Recall is handled by
// autocomplete/type signals and (optionally) the model. Languages: en, es, fr,
// de, pt, hi (romanized).

export const KW = {
  email: ['email', 'e-mail', 'correo', 'courriel', 'mail', 'emailid'],
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
  ],
  password: [
    'password',
    'passwd',
    'pwd',
    'contrasena',
    'contrasena',
    'mot de passe',
    'passwort',
    'senha',
    'paswaard',
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
  ],
  newpw: [
    'new password',
    'create password',
    'choose password',
    'set password',
    'nueva contrasena',
    'nouveau mot de passe',
  ],
  currentpw: ['current password', 'old password', 'existing password'],
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
  ],
  fullname: [
    'full name',
    'fullname',
    'your name',
    'name',
    'nombre completo',
    'nom complet',
    'cardholder name',
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

// Normalize text for matching: lowercase, strip accents, collapse whitespace.
export function normalizeText(input: string): string {
  if (!input) {
    return '';
  }
  let s = input.toLowerCase();
  // strip common diacritics without relying on \u regex escapes
  s = s.normalize('NFD');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0;
    // skip combining diacritical marks (U+0300..U+036F)
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
    if (t.includes(kw)) {
      return true;
    }
  }
  return false;
}
