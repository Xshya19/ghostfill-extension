# Releasing GhostFill

This project uses a zero-cost GitHub Actions release path. It does not create a release until a maintainer deliberately pushes a version tag.

1. Update `package.json`, `manifest.json`, and `CHANGELOG.md` for the intended version.
2. Run `npm ci`, `npm run type-check`, `npm run lint`, `npm test`, `npm run build`, `npm run bundle:check`, and `npm run build:zip` locally.
3. Inspect `dist/manifest.json` and list the ZIP contents. Confirm it is the public temporary-email-only profile.
4. In a clean Chrome profile, load the extracted ZIP and manually test the disposable-email flow as far as the available provider permits.
5. Confirm `Get-FileHash` matches the generated `.sha256` file.
6. Commit the verified changes and create a signed or reviewed `v<package-version>` tag. Do not reuse a tag for a different commit.
7. Push the tag. The release workflow reruns required checks, creates the ZIP and checksum, uploads them, and creates GitHub-generated release notes.
8. If a release run was blocked before it started, first resolve the account-level GitHub Actions block. Then open **Actions → Release → Run workflow**, enter the already-created tag (for example, `v1.1.0`), and run it. The workflow checks out that immutable tag, so never delete and recreate a tag just to retry a release.
9. Inspect the completed GitHub Release before announcing it.

The workflow requires only the repository `GITHUB_TOKEN`; it does not require a paid service. It does not publish to the Chrome Web Store.
