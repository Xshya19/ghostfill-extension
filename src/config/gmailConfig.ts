/**
 * GhostFill Gmail Config
 *
 * HOW THIS WORKS (exactly like Claude AI / Manus AI):
 *   - You (the developer) create ONE Google Cloud project → get a client_id
 *   - This client_id is bundled here — users never touch Google Cloud Console
 *   - Users just see "Sign in with Google" → click Allow → done
 *
 * TO SET UP (one-time, takes ~5 minutes):
 *   1. Go to https://console.cloud.google.com
 *   2. Create new project → name it "GhostFill"
 *   3. APIs & Services → Enable → search "Gmail API" → Enable
 *   4. APIs & Services → OAuth consent screen → External → fill app name → Save
 *   5. APIs & Services → Credentials → Create → OAuth 2.0 Client ID
 *   6. Application type: Web application
 *   7. Authorized JavaScript origins: (leave empty)
 *   8. Authorized redirect URIs: paste the value of chrome.identity.getRedirectURL()
 *      (open extension console, run: chrome.identity.getRedirectURL())
 *      It looks like: https://EXTENSION_ID.chromiumapp.org/
 *   9. Click Create → copy the Client ID below
 *
 * Configure the production client_id in manifest.json under oauth2.client_id.
 */
function getBundledGmailClientId(): string {
  try {
    return chrome.runtime.getManifest().oauth2?.client_id?.trim() ?? '';
  } catch {
    return '';
  }
}

export const GMAIL_CLIENT_ID = getBundledGmailClientId();

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
export const OAUTH_TOKEN_INFO = 'https://oauth2.googleapis.com/tokeninfo';
export const OAUTH_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
