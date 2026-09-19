# Build profiles

`npm run build` and `npm run build:zip` create the public profile. Its generated manifest excludes Gmail OAuth, the `identity` and `scripting` permissions, and Google, Microsoft, and Zoho host access. The popup and options page also hide real-mail controls, and the message router rejects real-mail actions.

`npm run build:full` is a maintainer-only profile. It applies `manifest.full-overrides.json` during the Webpack build to restore the legacy real-mail integrations. The source implementation remains available for development and review.

The full profile is not ready for unrestricted distribution. Gmail's `gmail.readonly` is a restricted scope, so a public real-mail release requires an owned OAuth client, a verified consent-screen configuration, an appropriate privacy policy, and any Google review or verification that applies at that time. A GitHub Pages URL alone does not establish OAuth domain ownership.
