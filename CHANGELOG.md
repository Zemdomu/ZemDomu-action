## Unreleased

### Feature

- Feature: emit canonical Core diagnostics as column-precise GitHub annotations and a SARIF 2.1.0 report path for code-scanning uploads.
- Feature: add Marketplace branding, versioned first-screen onboarding, and tested metadata, input, output, and failure-behavior documentation.

### Docs

- Docs: align Action metadata, workflow examples, and README copy with the
  approved ZemDomu GitHub Action name, pull-request annotation outcome,
  supported cross-component scope, and static-analysis limits.

### Chore

- Chore: publish the exact verified Action bundle with matching changelog notes, public tag, and non-draft GitHub release through fail-closed release automation.
- Chore: run the Action on GitHub's Node.js 24 runtime.
- Chore: remove the unused `@actions/github` runtime dependency from the bundled Action graph.

### Bugfix

- Bugfix: make file discovery deterministic across path separators while excluding hidden files, dependencies, directories, and symlink traversal.

## 0.3.6

### Security

- Security: update the undici override and lockfile to patched GitHub Action runtime dependencies.
- Security: override @isaacs/brace-expansion to 5.0.1 to address the dependabot alert.
- Security: refresh Action dependency overrides to clear npm audit vulnerabilities in the bundled action runtime.

### Bugfix

- Bugfix: bundle updated requireLinkText behavior for accessible link names.
- Bugfix: bundle updated requireHtmlLang validation for invalid language tags.
- Bugfix: bundle updated requireAltText behavior for inline SVG icons.

### Feature

- Feature: surface `requireDocumentTitle` (ZMD019) violations in GitHub Action annotations.
- Feature: surface `requireSingleMain` (ZMD020) violations in GitHub Action annotations.
- Feature: surface `ariaValidAttrValue` (ZMD021) violations in GitHub Action annotations.
- Feature: add npm funding metadata linking to Buy Me a Coffee for `npm fund`.

### Chore

- Chore: bundle ZemDomu Core 1.3.20 and refresh the tracked GitHub Action distribution.

## 0.3.5

### Feature

- Feature: surface unresolved TODO-ZMD placeholders (ZMD018)

### Docs

- Docs: note button accessible-name checks (text, aria-label, aria-labelledby, labeled content)

### Security

- Security: upgrade GitHub Actions SDK dependencies to address undici advisory.

### Chore

- Chore: bump zemdomu core dependency to 1.3.17.
## 0.3.4

- Chore: bump zemdomu core dependency to 1.3.15
