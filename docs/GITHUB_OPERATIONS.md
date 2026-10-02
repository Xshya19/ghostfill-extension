# GitHub operations and recovery

This repository has controls in source for CI, release packaging, dependency review, CodeQL, and Dependabot. Dependabot alerts, automatic security fixes, private vulnerability reporting, and automatic deletion of merged branches were enabled in GitHub on October 2, 2026. Secret scanning and push protection are also enabled. The remaining account and branch controls below must be configured in GitHub itself.

## Recover from the current Actions failure

The September and October 2026 CI and release runs did not execute any project commands. GitHub marked their jobs as failed before startup because the account was locked for a billing issue. Resolve that account condition in GitHub's billing settings first. Do not change application code or replace version tags to address that failure.

After GitHub Actions is available again:

1. Open **Actions → CI** and rerun the failed checks, or open a new pull request to trigger CI.
2. For the current release tag, open **Actions → Release → Run workflow**, enter `v1.1.3`, and run it from the default branch. The workflow packages the immutable tag, verifies its checksum, and creates or updates the matching release without retagging.

While the account is locked, release validation is performed locally on Windows with Node 24. The CI configuration additionally covers Node 22 and 26 on Linux, a Windows installer/updater job, dependency review, and CodeQL; these remote checks cannot execute until GitHub unlocks the account. Local validation does not constitute a successful GitHub Actions run.

## Protect `main`

After the checks above are running successfully, create a ruleset for the `main` branch under **Settings → Rules → Rulesets** with these controls:

- Require a pull request before merging and require the branch to be up to date.
- Require the successful CI matrix checks, **Dependency review**, and **CodeQL**. Do not make checks required until Actions is unblocked, or the branch will be unable to merge.
- Block force pushes and branch deletion.
- Require conversation resolution before merging.
- Prefer squash merges; automatic deletion of merged branches is already enabled.

This project is currently maintained by one account, so do not require a separate code-owner approval unless a second trusted maintainer is added. A requirement that no available maintainer can satisfy is not protection; it is a release outage.

## Harden GitHub settings

Under **Settings → Actions → General**, use the restrictive default token permission and require workflows to use full-length commit SHA pins once all workflow references are pinned. This repository's workflows already meet that source-level rule. Limit allowed actions to GitHub-owned actions unless a reviewed exception is added.

Under **Security → Advanced Security**, keep the dependency graph, Dependabot alerts, secret scanning, push protection, and private vulnerability reporting enabled. These are complementary controls: they do not replace the local redaction and validation defenses in the extension.

## Dependabot backlog

The dependency updates proposed in [#12](https://github.com/Xshya19/ghostfill-extension/pull/12), [#13](https://github.com/Xshya19/ghostfill-extension/pull/13), [#14](https://github.com/Xshya19/ghostfill-extension/pull/14), and [#15](https://github.com/Xshya19/ghostfill-extension/pull/15) are superseded by the verified action pins and dependency migration in v1.1.3. Their older branches should not be merged over the maintained source.

The media files and build script from [#11](https://github.com/Xshya19/ghostfill-extension/pull/11) already match `main`, and its showcase links are retained in the newer installation documentation. That pull request is also superseded.

Dependabot is now weekly and groups low-risk updates, preventing another large unreviewed queue. Never merge dependency pull requests solely because a bot opened them; require the normal CI and dependency-review results.

## Dependency compatibility limits

Application dependencies and GitHub Actions pins were checked against their latest stable releases on October 2, 2026. Two development tools use the newest compatible versions: ESLint 9.39.5 and TypeScript 6.0.3. The current React, accessibility, and import lint plugins do not declare support for ESLint 10, and `@typescript-eslint/parser` declares TypeScript support below 6.1. Do not force incompatible peer dependencies or disable the security and accessibility rules to install these majors.

ESLint 9 is marked deprecated upstream, so moving to ESLint 10 remains a tooling maintenance task once the plugins support it or a tested replacement is selected. Dependabot continues to surface newer releases; the current lockfile audit reports no known vulnerabilities. Use Node 24 LTS for local development (`.nvmrc`), and use `npm ci` to reproduce the validated dependency tree.
