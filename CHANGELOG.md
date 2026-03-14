## Unreleased

## 0.3.6

### Bugfix

- Bugfix: bundle updated requireLinkText behavior for accessible link names.
- Bugfix: bundle updated requireHtmlLang validation for invalid language tags.
- Bugfix: bundle updated requireAltText behavior for inline SVG icons.

### Feature

- Feature: surface `requireDocumentTitle` (ZMD019) violations in GitHub Action annotations.
- Feature: surface `requireSingleMain` (ZMD020) violations in GitHub Action annotations.
- Feature: surface `ariaValidAttrValue` (ZMD021) violations in GitHub Action annotations.
- Feature: add npm funding metadata linking to Buy Me a Coffee for `npm fund`.

### Security

- Security: override @isaacs/brace-expansion to 5.0.1 to address the dependabot alert.

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
