// Form Detection Types

export type FormType =
    | 'login'
    | 'signup'
    | 'password-reset'
    | 'two-factor'
    | 'newsletter'
    | 'contact'
    | 'checkout'
    | 'profile'
    | 'unknown';

export type FieldType =
    | 'email'
    | 'password'
    | 'confirm-password'
    | 'otp'
    | 'username'
    | 'name'
    | 'first-name'
    | 'last-name'
    | 'middle-name'
    | 'phone'
    | 'address'
    | 'city'
    | 'zip'
    | 'country'
    | 'credit-card'
    | 'cvv'
    | 'expiry'
    | 'unknown';

export interface DetectedField {
    element: HTMLInputElement | HTMLTextAreaElement;
    selector: string;
    fieldType: FieldType;
    confidence: number;
    label?: string;
    placeholder?: string;
    name?: string;
    id?: string;
    autocomplete?: string;
    rect: DOMRect;
}

export interface DetectedForm {
    element: HTMLFormElement;
    selector: string;
    formType: FormType;
    confidence: number;
    fields: DetectedField[];
    submitButton?: HTMLButtonElement | HTMLInputElement;
    actionUrl?: string;
}

export interface FormAnalysis {
    forms: DetectedForm[];
    standaloneFields: DetectedField[];
    timestamp: number;
}

export interface FieldHeuristics {
    patterns: RegExp[];
    keywords: string[];
    types: string[];
    autocomplete: string[];
}

export const FIELD_HEURISTICS: Record<FieldType, FieldHeuristics> = {
    email: {
        // Enhanced: Added more international patterns, common misspellings, and edge cases
        patterns: [
            /email/i, /e-mail/i, /e_mail/i, /mail/i, /@/i,
            /correo/i,   // Spanish
            /courriel/i, // French
            /邮箱/i,      // Chinese
            /メール/i,    // Japanese
            /이메일/i,    // Korean
            /البريد/i,   // Arabic
            /login/i, /signin/i, /user.*id/i, /account/i, /identifier/i
        ],
        keywords: ['email', 'e-mail', 'mail', 'correo', 'address', 'login', 'userid', 'account', 'user', 'id', 'identifier', 'courriel', 'signin'],
        types: ['email', 'text'],
        autocomplete: ['email', 'username', 'section-login email', 'webauthn', 'work email', 'home email'],
    },
    password: {
        // Enhanced: Added more languages and common variations
        patterns: [
            /password/i, /passwd/i, /pwd/i, /pass/i, /passcode/i,
            /contraseña/i, // Spanish
            /clave/i,      // Spanish
            /mot.?de.?passe/i, // French
            /kennwort/i, /passwort/i, // German
            /密码/i,       // Chinese
            /パスワード/i,  // Japanese
            /비밀번호/i,    // Korean
            /secret/i, /credential/i
        ],
        keywords: ['password', 'pass', 'pwd', 'contraseña', 'clave', 'secret', 'credential', 'kennwort', 'passwort'],
        types: ['password'],
        autocomplete: ['current-password', 'new-password', 'password'],
    },
    'confirm-password': {
        patterns: [/confirm/i, /repeat/i, /retype/i, /verificar?/i, /valid/i, /match/i, /again/i, /re.?enter/i, /retry/i],
        keywords: ['confirm', 'repeat', 'retype', 'verify', 'again', 'validation', 'match', 'reenter', 'confirm_password', 'confirmpassword', 'password2'],
        types: ['password'],
        autocomplete: ['new-password'],
    },
    otp: {
        // Enhanced: Added more OTP/verification patterns
        patterns: [
            /otp/i, /code/i, /verify/i, /token/i, /pin/i, /mpin/i,
            /2fa/i, /mfa/i, /totp/i,
            /security/i, /access/i, /passcode/i, /activation/i,
            /verification/i, /authenticate/i, /challenge/i,
            /#/i, /digit/i, /one.?time/i,
            /验证码/i, /認証/i  // Chinese/Japanese
        ],
        keywords: ['otp', 'code', 'verification', 'token', 'pin', '2fa', 'mfa', 'security', 'access', 'passcode', 'digit', 'sms', 'authenticator', 'challenge', 'onetime'],
        types: ['text', 'number', 'tel', 'password'],
        autocomplete: ['one-time-code', 'otp'],
    },
    username: {
        // Enhanced: Better username detection with social handles
        patterns: [
            /username/i, /user.?name/i, /user.?id/i, /login.?id/i, /login.?name/i,
            /usuario/i, /handle/i, /nickname/i, /screen.?name/i, /alias/i,
            /account.?name/i, /account.?id/i, /member.?id/i,
            /用户名/i, /ユーザー名/i, /사용자명/i,
            /^uid$/i, /^uname$/i
        ],
        keywords: [
            'username', 'user', 'login', 'userid', 'uid', 'uname',
            'handle', 'nickname', 'alias', 'screenname', 'accountname',
            'memberid', 'loginname', 'loginid'
        ],
        types: ['text'],
        autocomplete: ['username', 'nickname'],
    },
    name: {
        // Enhanced: Better full name detection with more languages
        patterns: [
            /^name$/i, /full.?name/i, /your.?name/i, /complete.?name/i, /display.?name/i,
            /real.?name/i, /legal.?name/i, /actual.?name/i, /^the.?name$/i,
            /nombre.?completo/i,  // Spanish
            /nom.?complet/i,      // French
            /nome.?completo/i,    // Italian/Portuguese
            /vollständiger.?name/i, // German
            /tên.?đầy.?đủ/i,      // Vietnamese
            /姓名/i,               // Chinese
            /フルネーム/i,          // Japanese
            /성명/i,               // Korean
            /الاسم.?الكامل/i       // Arabic
        ],
        keywords: [
            'fullname', 'full_name', 'completename', 'complete_name',
            'yourname', 'displayname', 'realname', 'real_name',
            'legalname', 'legal_name', 'wholename', 'name'
        ],
        types: ['text'],
        autocomplete: ['name'],
    },
    'first-name': {
        // Enhanced: Comprehensive first name detection
        patterns: [
            /first.?name/i, /given.?name/i, /forename/i,
            /^fname$/i, /^f_name$/i, /^f-name$/i, /^first$/i,
            /christian.?name/i, /personal.?name/i,
            /prénom/i, /prenom/i,     // French
            /vorname/i,               // German
            /primer.?nombre/i,        // Spanish
            /nome.?proprio/i,         // Italian
            /primeiro.?nome/i,        // Portuguese
            /имя/i,                   // Russian
            /名(?!字)/i,              // Chinese (given name, not full)
            /ファーストネーム/i,       // Japanese
            /이름/i,                  // Korean
            /الاسم.?الأول/i           // Arabic
        ],
        keywords: [
            'fname', 'f_name', 'firstname', 'first_name', 'first-name',
            'givenname', 'given_name', 'given-name', 'given',
            'forename', 'prenom', 'vorname', 'christianname',
            'personalname', 'primernombre'
        ],
        types: ['text'],
        autocomplete: ['given-name', 'first-name'],
    },
    'last-name': {
        // Enhanced: Comprehensive last name / surname detection
        patterns: [
            /last.?name/i, /sur.?name/i, /family.?name/i,
            /^lname$/i, /^l_name$/i, /^l-name$/i, /^last$/i,
            /^surname$/i, /^sname$/i,
            /nachname/i, /familienname/i,   // German
            /apellido/i, /segundo.?nombre/i, // Spanish
            /nom.?de.?famille/i,            // French
            /cognome/i,                     // Italian
            /sobrenome/i, /apelido/i,       // Portuguese
            /фамилия/i,                     // Russian
            /姓(?!名)/i,                    // Chinese (surname only)
            /ラストネーム/i, /苗字/i,        // Japanese
            /성/i,                          // Korean
            /اسم.?العائلة/i, /اللقب/i       // Arabic
        ],
        keywords: [
            'lname', 'l_name', 'lastname', 'last_name', 'last-name',
            'surname', 'sname', 's_name', 'familyname', 'family_name', 'family-name',
            'apellido', 'nachname', 'cognome', 'sobrenome'
        ],
        types: ['text'],
        autocomplete: ['family-name', 'last-name'],
    },
    'middle-name': {
        // NEW: Middle name detection
        patterns: [
            /middle.?name/i, /mid.?name/i,
            /^mname$/i, /^m_name$/i, /^m-name$/i, /^middle$/i,
            /second.?name/i, /additional.?name/i,
            /segundo.?nombre/i, /nombre.?medio/i,  // Spanish
            /deuxième.?prénom/i, /second.?prénom/i, // French
            /zweiter.?vorname/i, /mittelname/i,    // German
            /patronym/i, /отчество/i,              // Russian patronymic
            /middle.?initial/i
        ],
        keywords: [
            'mname', 'm_name', 'middlename', 'middle_name', 'middle-name',
            'midname', 'secondname', 'second_name', 'additionalname',
            'middleinitial', 'mi', 'patronymic'
        ],
        types: ['text'],
        autocomplete: ['additional-name', 'middle-name'],
    },
    phone: {
        // Enhanced: Better phone detection
        patterns: [
            /phone/i, /tel/i, /mobile/i, /cell/i, /contact/i, /numero/i,
            /fone/i, /callback/i, /sms/i, /whatsapp/i,
            /电话/i, /電話/i,  // Chinese
            /電話番号/i        // Japanese
        ],
        keywords: ['phone', 'telephone', 'mobile', 'cell', 'sms', 'tel', 'fone', 'numero', 'contact', 'whatsapp', 'landline', 'callback'],
        types: ['tel', 'text', 'number'],
        autocomplete: ['tel', 'tel-national', 'tel-local', 'mobile'],
    },
    address: {
        patterns: [/address/i, /street/i, /direccion/i, /location/i, /adresse/i, /住所/i, /地址/i, /domicile/i, /residence/i],
        keywords: ['address', 'street', 'direccion', 'shipping', 'billing', 'adresse', 'domicile', 'residence', 'addr', 'address1', 'address2'],
        types: ['text'],
        autocomplete: ['street-address', 'address-line1', 'address-line2'],
    },
    city: {
        patterns: [/city/i, /ciudad/i, /town/i, /locality/i, /ville/i, /stadt/i, /市/i, /città/i],
        keywords: ['city', 'ciudad', 'town', 'locality', 'ville', 'stadt', 'municipality'],
        types: ['text'],
        autocomplete: ['address-level2'],
    },
    zip: {
        patterns: [/zip/i, /postal/i, /postcode/i, /pincode/i, /plz/i, /cep/i, /郵便番号/i, /邮编/i, /code.?postal/i],
        keywords: ['zip', 'postal', 'postcode', 'pincode', 'plz', 'zipcode', 'postalcode', 'cep'],
        types: ['text', 'number'],
        autocomplete: ['postal-code'],
    },
    country: {
        patterns: [/country/i, /pais/i, /region/i, /pays/i, /land/i, /国/i, /país/i, /nation/i, /国家/i],
        keywords: ['country', 'pais', 'nation', 'region', 'pays', 'land', 'nationality'],
        types: ['text', 'select-one'],
        autocomplete: ['country', 'country-name'],
    },
    'credit-card': {
        patterns: [/card/i, /cc/i, /credit/i, /pan/i, /card.?number/i, /卡号/i, /クレジット/i, /tarjeta/i, /carte/i],
        keywords: ['card', 'credit', 'cc', 'mastercard', 'visa', 'amex', 'debit', 'ccnumber', 'cardnumber', 'pan'],
        types: ['text', 'tel', 'number'],
        autocomplete: ['cc-number', 'card-number'],
    },
    cvv: {
        patterns: [/cvv/i, /cvc/i, /security.?code/i, /card.?code/i, /ccv/i, /cv2/i],
        keywords: ['cvv', 'cvc', 'security', 'verification', 'cardcode', 'securitycode', 'ccv', 'cv2'],
        types: ['text', 'password', 'tel', 'number'],
        autocomplete: ['cc-csc'],
    },
    expiry: {
        patterns: [/expir/i, /validity/i, /mm/i, /yy/i, /date/i, /valid.?until/i, /valid.?thru/i, /vencimiento/i],
        keywords: ['expiry', 'expiration', 'validity', 'month', 'year', 'validthru', 'vencimiento', 'mmyy', 'expdate'],
        types: ['text', 'tel', 'number', 'month'],
        autocomplete: ['cc-exp', 'cc-exp-month', 'cc-exp-year'],
    },
    unknown: {
        patterns: [],
        keywords: [],
        types: [],
        autocomplete: [],
    },
};

export const FORM_INDICATORS: Record<FormType, { patterns: RegExp[]; requiredFields: FieldType[] }> = {
    login: {
        patterns: [/login/i, /signin/i, /sign-in/i, /log-in/i, /auth/i, /entrar/i],
        requiredFields: ['password'],
    },
    signup: {
        patterns: [/signup/i, /sign-up/i, /register/i, /create/i, /join/i, /enroll/i, /registrar/i],
        requiredFields: ['email', 'password'],
    },
    'password-reset': {
        patterns: [/reset/i, /forgot/i, /recover/i, /lost/i],
        requiredFields: ['email'],
    },
    'two-factor': {
        patterns: [/2fa/i, /otp/i, /verify/i, /two-factor/i, /mfa/i, /security/i, /challenge/i],
        requiredFields: ['otp'],
    },
    newsletter: {
        patterns: [/newsletter/i, /subscribe/i, /updates/i, /mailing/i],
        requiredFields: ['email'],
    },
    contact: {
        patterns: [/contact/i, /message/i, /inquiry/i, /support/i, /help/i],
        requiredFields: ['email'],
    },
    checkout: {
        patterns: [/checkout/i, /payment/i, /order/i, /pay/i, /purchase/i, /cart/i],
        requiredFields: ['credit-card'],
    },
    profile: {
        patterns: [/profile/i, /account/i, /settings/i, /my-account/i, /preferences/i],
        requiredFields: [],
    },
    unknown: {
        patterns: [],
        requiredFields: [],
    },
};
