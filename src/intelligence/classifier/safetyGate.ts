// Deterministic safety gate. This is NOT a classifier and NOT a fallback brain.
// It is a seatbelt: a small set of inviolable rules that prevent the worst
// outcomes when typing into password/OTP fields. It runs AFTER classification
// and can only BLOCK or annotate -- it never changes the predicted class.

import type { ClassificationResult, FieldClass, RawFieldRecord } from '../types';

export interface SafetyVerdict {
  allow: boolean;
  reason: string;
}

// OTP/password capability check: would it be safe to type this kind of secret
// into this element at all?
function otpCapable(r: RawFieldRecord): boolean {
  if (r.type === 'email') {
    return false;
  } // never type an OTP into an email field
  if (r.maxLength > 0 && r.maxLength < 4 && r.maxLength !== 1) {
    return false;
  } // too short for a code, not a split box
  return true;
}

/**
 * Strong IdP path tokens — these appear ONLY on real OAuth/OIDC/SAML
 * endpoints (not on arbitrary login pages). If a URL contains ANY of these,
 * it's a genuine IdP flow.
 */
const STRONG_IDP_PATH_TOKENS: readonly string[] = [
  '/.well-known/openid-configuration', // OIDC discovery
  '/.well-known/oauth-authorization-server', // RFC 8414
  '/.well-known/saml', // SAML metadata
  '/protocol/openid-connect', // Keycloak
  '/connect/authorize', // Generic OIDC
  '/connect/token', // Generic OIDC
  '/saml/', // SAML endpoints
  '/saml2/', // SAML2 endpoints
  '/oauth/', // Generic OAuth
  '/oauth2/', // Generic OAuth2
  '/oidc/', // OpenID Connect
  '/authorize', // OAuth2 authorize endpoint
  '/protocol/', // Keycloak realm protocols
  '/realms/', // Keycloak realm paths
  '/application/o/', // Hydra / Ory Fosite
  '/self-service/', // Ory Kratos
  '/api/v1/registration', // Ory Kratos
  '/v2/identity-providers/', // Authgear
  '/v1/sessions', // Ory sessions
  '/oauth2/v2.0/', // Microsoft Entra (Azure AD)
  '/common/oauth2/', // Microsoft Entra tenantless
];

/**
 * Weak IdP path tokens — these COULD appear on real IdPs OR on ordinary
 * SaaS login pages. They count toward a tally; multiple weak hits OR one
 * weak hit combined with OAuth query params is required.
 */
const WEAK_IDP_PATH_TOKENS: readonly string[] = [
  '/sso/',
  '/signin/',
  '/sign-in/',
  '/auth/',
  '/identity/',
  '/account/',
  '/login/',
];

/**
 * Regexes for IdP-product SUBDOMAIN patterns — anchored to a known
 * identity-stack product name (Auth0, Okta, Ory, etc.). These alone are
 * decisive because tenant-subdomain conventions are owned by the IdP
 * product, not by the customer.
 */
const IDP_SUBDOMAIN_PATTERNS: readonly RegExp[] = [
  // Auth0 — tenant.auth0.com / tenant.region.auth0.com / tenant.eu.auth0.com
  /(?:^|\.)[a-z0-9-]+\.auth0\.(?:com|eu|au)$/i,
  // Okta — org.okta.com / org.okta-emea.com / org.okta-gov.com
  /(?:^|\.)[a-z0-9-]+\.okta(?:-(?:emea|gov|govt))?\.com$/i,
  // Okta preview / dev tenants
  /(?:^|\.)[a-z0-9-]+\.oktapreview\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.oktadev\.com$/i,
  // OneLogin, PingIdentity, JumpCloud, Duo
  /(?:^|\.)[a-z0-9-]+\.onelogin\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.pingidentity\.com$/i,
  /(?:^|\.)[a-z0-9-]+\.jumpcloud\.com$/i,
  // Ory — tenant.ory.sh (Kratos/Hydra/Keto/Fosite)
  /(?:^|\.)[a-z0-9-]+\.ory\.sh$/i,
  // Keycloak hosted by org — {app}.keycloak.org or a subdomain pointing
  // at a self-hosted Keycloak realm (Keycloak doesn't use a fixed
  // subdomain convention, so we don't try to match it from the hostname).
  // Cognito hosted UI — {tenant}.auth.{region}.amazoncognito.com
  /\.auth\.[a-z0-9-]+\.amazoncognito\.com$/i,
  // Akamai / Cloudflare Access / Linode SSO subdomains
  /(?:^|\.)[a-z0-9-]+\.(?:akamai|cloudflareaccess|linode)\.com$/i,
  // WorkOS hosted — {app}.workos.com
  /(?:^|\.)[a-z0-9-]+\.workos\.com$/i,
];

/**
 * Detect whether a URL looks like an OAuth / SSO / IdP flow rather than
 * an arbitrary login page. Pure signal analysis — NO per-vendor
 * allow-list of hostnames. The classifier reasons about the URL the
 * same way a security researcher would: "this URL has an OIDC discovery
 * path / a SAML endpoint / OAuth query params / a tenant subdomain of a
 * known IdP product → it's an IdP."
 *
 * PERMANENT FIX 2026-06-21: prior to this fix, the safety gate either
 * (a) blocked every `!visible` field as a honeypot, or (b) used a
 * hand-maintained hostname allow-list that missed every OAuth provider
 * the user hadn't pre-registered. Both broke real signin flows.
 *
 * Decision logic (in priority order):
 *   1. Strong IdP path token anywhere in the URL → OAuth (decisive).
 *   2. Recognized IdP-product subdomain regex → OAuth (decisive).
 *   3. ≥2 weak IdP path tokens in the URL → OAuth.
 *   4. Any single weak IdP path token PLUS ≥1 OAuth query param → OAuth.
 *   5. ≥2 OAuth query params in isolation → OAuth.
 *   6. Single decisive OAuth query param (`scope=openid` or
 *      `response_type=code`) → OAuth.
 *
 * False-positive guards: a single `/login/` path token on an arbitrary
 * hostname is NOT OAuth — phishing pages use those too. We require
 * either a strong IdP signal or a combination of weak signals.
 */
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

  // ── Signal 1: Strong IdP path tokens — these only appear on real
  //    OAuth/OIDC/SAML endpoints. Any single hit is decisive.
  for (const token of STRONG_IDP_PATH_TOKENS) {
    if (path.includes(token)) {
      return true;
    }
  }

  // ── Signal 2: Recognized IdP-product subdomain patterns.
  for (const rx of IDP_SUBDOMAIN_PATTERNS) {
    if (rx.test(host)) {
      return true;
    }
  }

  // ── Signal 3: Tally weak IdP path tokens (require ≥2).
  let weakPathHits = 0;
  for (const token of WEAK_IDP_PATH_TOKENS) {
    if (path.includes(token)) {
      weakPathHits++;
    }
  }

  // ── Signal 4: OAuth query parameters.
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

  // ── Combine signals (conservative on false positives).
  if (weakPathHits >= 2) {
    return true;
  }
  if (weakPathHits >= 1 && oauthParamHits >= 1) {
    return true;
  }
  if (oauthParamHits >= 2) {
    return true;
  }
  // Decisive single OAuth params — `scope=openid` only appears in real
  // OIDC handshakes, and `response_type=code` is the OAuth2 PKCE/AuthCode
  // signature. These by themselves are highly specific.
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
  // 1) never fill anything into a detected honeypot / invisible trap.
  //    EXCEPTION: if the page is clearly an OAuth / SSO / IdP flow
  //    (detected via URL pattern, NOT a hardcoded hostname list), hidden
  //    identity fields at multi-step signin are legitimate, not honeypots.
  //    The visibility check below + the confidence threshold still gate
  //    what we actually fill.
  if (result.hardNegative === 'Honeypot' && !looksLikeOAuthFlow(r.url ?? '')) {
    return { allow: false, reason: 'honeypot trap field' };
  }
  if (!r.visible && r.type !== 'hidden') {
    const isCustomStyledInput = r.opacityZero && !r.offscreen && !r.tiny;
    if (!r.focused && !isCustomStyledInput) {
      return { allow: false, reason: 'field not visible' };
    }
  }
  // 2) never fill identity/OTP into a payment/search/captcha/coupon field
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
  // 3) OTP must only go into an OTP-capable element
  if (chosen === 'OTP' && !otpCapable(r)) {
    return { allow: false, reason: 'element not OTP-capable (type/maxLength)' };
  }
  // 4) secrets only into appropriate input types
  if ((chosen === 'Password' || chosen === 'Target_Password_Confirm') && r.type === 'email') {
    return { allow: false, reason: 'refusing to type password into an email field' };
  }
  return { allow: true, reason: 'no safety rule triggered' };
}

// Post-fill verification helper. After writing a value, confirm it landed.
// (Note for OTP on type=number with leading zero -- see audit P0-3.)
export function verifyFill(
  expected: string,
  actual: string,
  fieldType: string
): { ok: boolean; reason: string } {
  if (actual === expected) {
    return { ok: true, reason: 'exact match' };
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
