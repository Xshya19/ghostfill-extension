# Releasing GhostFill

GitHub Actions is disabled in this repository. Releases are built and checked locally, then uploaded through GitHub Releases. A code push or version tag alone does not publish a built package.

## 1. Validate the release locally

1. Update the version metadata in `package.json` and `manifest.json`, plus `CHANGELOG.md`.
2. Use Node 24 LTS and run the commands below in the source folder, waiting for each to succeed:

   ```bash
   npm ci
   npm audit --audit-level=high
   npm run workflow:check
   npm run type-check
   npm run lint
   npm test
   npm run build:zip
   npm run bundle:check
   ```

   In PowerShell, use `npm.cmd` in place of `npm` if script execution is blocked.

3. Inspect `dist/manifest.json` and the ZIP contents. The normal build is the full profile with optional Gmail integration. Confirm its version, extension identity, permissions, and updater files.
4. On Windows, run `node scripts/check-extension-update.cjs`. Confirm the package includes `Update GhostFill.cmd` and `scripts/update-extension.ps1`.
5. Load the extracted ZIP in a clean Chrome profile. Test address generation, form filling, inbox access, OTP filling, and verification-link opening. Test Gmail setup, sign-in, aliases, and inbox access as far as the configured OAuth client permits.
6. Verify that the ZIP hash matches the generated `.zip.sha256` file. The [README checksum instructions](../README.md#1-get-the-extension-folder) cover Windows, macOS, and Linux.

Keep the ZIP and checksum produced by that same build together. The release package is `ghostfill-extension-v<version>.zip`; GitHub's source archive is not a built extension package.

## 2. Push the tested source and tag

1. Commit the validated changes and push them through the normal pull-request or source-review process.
2. Create a reviewed annotated tag named `v<package-version>` at the tested source commit and push it.
3. Verify that the tag points to that commit. Never move or reuse a published tag for a different commit.

The extension's updater checks published stable release assets. It does not install source commits or tags by themselves.

## 3. Upload the release on GitHub

1. Open the repository's [Releases page](https://github.com/Xshya19/ghostfill-extension/releases) and choose **Draft a new release**.
2. Select the tested version tag.
3. Give the release a title such as **GhostFill v<version>** and describe the changes, local validation, and any known limitations.
4. Upload both generated files under the release assets:

   - `ghostfill-extension-v<version>.zip`
   - `ghostfill-extension-v<version>.zip.sha256`

5. Publish it as a normal stable release if it is intended for ordinary users. A draft or prerelease is not offered by the stable-release updater.
6. Open the published release without signing in. Download both assets and verify their checksum again.
7. Confirm the latest stable release API lists both assets with the exact filenames. The updater needs both; uploading only the source or ZIP is insufficient.

Manual publishing does not need a paid CI runner and does not publish to the Chrome Web Store. Gmail OAuth distribution requirements still apply; see [Build profiles](BUILD_PROFILES.md).

## Optional: restore automated releases

If the maintainer later chooses CI/CD, follow [GitHub operations](GITHUB_OPERATIONS.md) to re-enable Actions and resolve any account billing block first. The stored Release workflow validates an immutable version tag, builds the full-profile ZIP, and uploads the checksum and package.

To retry an existing tag after Actions is available, use **Actions → Release → Run workflow** and enter that tag. Do not delete and recreate a tag to retry packaging.
