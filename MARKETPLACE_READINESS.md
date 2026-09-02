# GitHub Marketplace release readiness

This checklist records the repository-level values and owner steps for the
existing [ZemDomu Lint Marketplace listing](https://github.com/marketplace/actions/zemdomu-lint).
It does not replace the tested customer setup in `README.md`.

## Verified on 2026-09-02

- The public `Zemdomu/ZemDomu-action` repository is public, has issues enabled,
  and contains one root `action.yml` plus the committed `dist/index.js` runtime.
- GitHub Marketplace currently shows `v0.3.6` as Latest in the **Code quality**
  category.
- The `v0.3.6` release still contains the older `ZemDomu Lint` manifest while
  public `main` contains the newer `ZemDomu GitHub Action` metadata.
- GitHub does not currently detect a repository license even though the README
  states MIT. H-09 owns the licensing decision; do not treat the README line as
  a substitute for an approved root license file.

## Publication-ready repository values

- Description: `Semantic HTML and accessibility checks for HTML, JSX, TSX, and Vue pull requests.`
- Homepage: `https://zemdomu.dev/`
- Issues: `https://github.com/Zemdomu/ZemDomu-action/issues`
- Topics: `github-actions`, `accessibility`, `a11y`, `semantic-html`, `static-analysis`, `jsx`, `tsx`, `vue`
- Primary Marketplace category: **Code quality**
- Secondary Marketplace category: **Continuous integration**

## Owner publication gate

H-11 should publish or update the Marketplace release only after ZD-35 has
reconciled the monorepo package version, public mirror, `v0.3.6` release/tag
lineage, and release credentials, and H-09 has resolved the public license.
The README and its tests target `v0.3.7` as the next valid release after that
reconciliation. Confirm Marketplace publication on the release-specific tag,
retain `action.yml` as the metadata filename, and verify the rendered README,
branding, category, version, and issue link from a signed-out session.
