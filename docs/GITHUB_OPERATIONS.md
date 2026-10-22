# GitHub operations

## Current mode: local checks and manual releases

GitHub Actions was disabled for this repository on October 3, 2026 at the maintainer's request. Pushes, pull requests, and version tags do not run remote CI/CD while this setting is disabled.

The workflow files remain in `.github/workflows` for optional future use. Local type checks, lint, tests, dependency audits, build checks, and the Windows updater checks remain available. Record the relevant local validation in each pull request before merging.

The previous CI, security, and release failures were blocked before any project command ran because of an account billing issue. Removing those failed run records cleans up GitHub's check history; it does not constitute passing CI or resolve account billing.

## Publish without CI/CD

1. Review the changes and run the relevant local validation with Node 24 LTS.
2. Commit and push the verified source. A pull request can be merged without disabled Actions checks.
3. For an extension release, follow [Releasing GhostFill](RELEASING.md): build locally, verify the ZIP, tag the tested commit, and upload the built ZIP plus its matching checksum through GitHub Releases.
4. Verify the published downloads. The Windows updater needs a stable release with both correctly named assets.

Do not replace an existing release tag with a different commit or publish an unverified package just because remote checks are unavailable.

## Repository controls

Dependabot alerts, automatic security fixes, private vulnerability reporting, and automatic deletion of merged branches were enabled on October 2, 2026. Keep those services, secret scanning, and push protection enabled. They are separate from this repository's CI/CD workflow setting.

While Actions is disabled, do not require CI, dependency-review, or CodeQL status checks in a branch ruleset: those jobs cannot run. Useful independent protections include requiring pull requests, resolving review conversations, and blocking force pushes and branch deletion.

The project is maintained by one account. Require another person's approval only when a second trusted maintainer is available.

## Re-enable GitHub Actions later

1. Resolve any remaining account billing block in GitHub's account settings.
2. Open **Settings → Actions → General** and allow GitHub Actions for this repository.
3. Keep workflow tokens read-only by default and keep the reviewed actions pinned to full commit SHAs.
4. Trigger CI with a reviewed pull request or push, and confirm CI and CodeQL execute successfully.
5. If switching back to automatic releases, push a new verified version tag or run **Actions → Release → Run workflow** for an existing immutable tag.
6. Require the appropriate successful status checks in branch protection only after those workflows run reliably.

The stored CI configuration covers Node 22, 24, and 26 on Linux plus a Windows installer/updater job. Running the local checks on Windows does not establish that those remote matrix checks passed.

## Dependency maintenance

The dependency changes from [#12](https://github.com/Xshya19/ghostfill-extension/pull/12), [#13](https://github.com/Xshya19/ghostfill-extension/pull/13), [#14](https://github.com/Xshya19/ghostfill-extension/pull/14), and [#15](https://github.com/Xshya19/ghostfill-extension/pull/15) were superseded by the action pins and dependency migration in v1.1.3. The media and render script from [#11](https://github.com/Xshya19/ghostfill-extension/pull/11) already match the maintained source.

Dependabot is configured weekly and groups low-risk updates. Review each proposed update and run the relevant local checks before merging. If remote CI is re-enabled, require its results too.

Application dependencies and GitHub Actions pins were checked against stable releases on October 2, 2026. Two development tools use compatible versions: ESLint 9.39.5 and TypeScript 6.0.3. The React, accessibility, and import lint plugins do not declare support for ESLint 10, and `@typescript-eslint/parser` declares TypeScript support below 6.1. Do not force incompatible peer dependencies or disable security and accessibility rules to install these majors.

ESLint 9 is deprecated upstream, so migrating to ESLint 10 remains a maintenance task once the plugins support it or a tested replacement is selected. Use `npm ci` to reproduce the dependency tree and `npm audit --audit-level=high` to check for current advisories.
