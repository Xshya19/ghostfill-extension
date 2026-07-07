// Compact multilingual keyword sets used by both the structural extractor and
// the heuristic classifier. Single source of truth (fixes audit P3-7/P3-8
// keyword drift). Lowercased, accent-insensitive matching is the caller's job.
//
// These are intentionally small + high-precision. Recall is handled by
// autocomplete/type signals and (optionally) the model. Languages: en, es, fr,
// de, pt, hi (romanized).

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
    'email_id'
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
    'usuario o correo'
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
    'pass-phrase'
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
    'sms-code'
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
    'mobile_number'
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
