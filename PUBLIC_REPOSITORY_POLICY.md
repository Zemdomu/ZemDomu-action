# Public Repository Policy

This repository is public. Assume every tracked file, commit, release asset,
and GitHub Action bundle entry can be read by anyone.

Public Markdown is limited to `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and this
policy. Public issue forms are limited to `.github/ISSUE_TEMPLATE/bug_report.yml`,
`.github/ISSUE_TEMPLATE/feature_request.yml`, and
`.github/ISSUE_TEMPLATE/config.yml`. Put local plans, agent context, investigation
notes, security work, and release coordination in `.internal/`; that directory
is ignored and must never be force-added.

Never store credentials, tokens, private keys, customer data, private URLs, or
real environment values in this repository. From the canonical ZemDomu
monorepo root, run:

```sh
node scripts/check-public-repo-safety.mjs --package actions
```

If sensitive information is committed, stop publication, revoke or rotate the
affected credential, report the exposure privately, and assess Git history.
Removing the current file does not remove earlier commits; do not rewrite
shared history without an explicit coordinated decision.
