# GitHub operations and recovery

This repository has controls in source for CI, release packaging, dependency review, CodeQL, and Dependabot. The following account-level controls must still be configured in GitHub itself; a repository commit cannot enable them.

## Recover from the current Actions failure

The September 2026 CI and release runs did not execute any project commands. GitHub marked their jobs as failed before startup because the account was locked for a billing issue. Resolve that account condition in GitHub's billing settings first. Do not change application code or delete the `v1.1.0` tag to address that failure.

After GitHub Actions is available again:

1. Open **Actions → CI** and rerun the failed checks, or open a new pull request to trigger CI.
2. For the existing release tag, open **Actions → Release → Run workflow**, enter `v1.1.0`, and run it from the default branch. The workflow packages the immutable tag, verifies its checksum, and creates or updates the matching release without retagging.

## Protect `main`

After the checks above are running successfully, create a ruleset for the `main` branch under **Settings → Rules → Rulesets** with these controls:

- Require a pull request before merging and require the branch to be up to date.
- Require the successful CI matrix checks, **Dependency review**, and **CodeQL**. Do not make checks required until Actions is unblocked, or the branch will be unable to merge.
- Block force pushes and branch deletion.
- Require conversation resolution before merging.
- Prefer squash merges and enable automatic deletion of merged branches.

This project is currently maintained by one account, so do not require a separate code-owner approval unless a second trusted maintainer is added. A requirement that no available maintainer can satisfy is not protection; it is a release outage.

## Harden GitHub settings

Under **Settings → Actions → General**, use the restrictive default token permission and require workflows to use full-length commit SHA pins once all workflow references are pinned. This repository's workflows already meet that source-level rule. Limit allowed actions to GitHub-owned actions unless a reviewed exception is added.

Under **Security → Advanced Security**, enable the dependency graph, Dependabot alerts, secret scanning, push protection, and private vulnerability reporting where the account plan makes them available. These are complementary controls: they do not replace the local redaction and validation defenses in the extension.

## Dependabot backlog

The current nine Dependabot pull requests were created while Actions was locked, so none received a real CI result. The workflow action upgrades are now incorporated in this branch with immutable pins; after this branch merges, close the now-stale action-only pull requests (#1, #2, and #3) rather than merging duplicate changes.

Review the remaining npm updates after CI is restored:

- Patch/minor candidates: #4, #6, #7, and #9.
- Major-version candidates that need an explicit compatibility pass: #5 and #8.

Dependabot is now weekly and groups low-risk updates, preventing another large unreviewed queue. Never merge dependency pull requests solely because a bot opened them; require the normal CI and dependency-review results.
