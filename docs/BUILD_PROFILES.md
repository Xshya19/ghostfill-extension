# Build profiles

The normal commands now create the full profile:

- `npm run build` and `npm run build:zip` include Gmail OAuth, the Gmail/Google alias UI, `identity` and `scripting`, and the provider host access declared in `manifest.full-overrides.json`.
- `npm run build:full` and `npm run build:full:dev` remain compatibility aliases for the normal full commands.

The restricted temporary-mail-only profile remains available explicitly:

- `npm run build:public` and `npm run build:public:zip` omit Gmail OAuth, real-mail permissions, and real-mail controls.

The full profile is the product profile requested by this repository, but it is not automatically ready for unrestricted public distribution. Gmail's `gmail.readonly` scope is restricted, so a public real-mail release requires an owned OAuth client, a verified consent-screen configuration, an appropriate privacy policy, and any Google review or verification that applies at that time. A GitHub Pages URL alone does not establish OAuth domain ownership.

To enable the full profile after installation, open **Options → Gmail (OAuth)**, confirm the OAuth client ID, then choose **Gmail** in the popup and connect the Google account. After connection, the **Aliases** button opens the Gmail alias manager.
