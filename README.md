# ZemDomu GitHub Action

> Semantic checks in CI before markup regressions ship.

The ZemDomu GitHub Action runs ZemDomu semantic checks in CI and surfaces
findings as GitHub annotations. It helps teams catch structural,
accessibility, and search-related markup issues before they land in the main
branch.

Most linters check syntax. ZemDomu checks meaning.

## What It Is

ZemDomu Actions runs the shared ZemDomu rules engine inside GitHub Actions. It
is designed for teams that want semantic issues to be enforced in pull requests
instead of discovered later through audits or production review.

## Why ZemDomu

Compared with scanner-only CI steps and generic lint jobs, ZemDomu focuses on
semantic structure and actionable remediation.

- It checks semantic HTML, accessible naming, and document structure.
- It can analyze component trees instead of only isolated files.
- It shares the same rules engine as the VS Code extension and CLI.
- It reports findings directly where teams already review code: in pull requests.

## Features

- Lints HTML, JSX, TSX, and Vue templates in CI.
- Surfaces findings as GitHub Actions annotations.
- Fails the job when issues are detected.
- Supports cross-component analysis for component trees.
- Flags semantic issues that affect accessibility and SEO.

## Quick Start

```yaml
name: ZemDomu Semantic Checks
on: [pull_request]

jobs:
  zemdomu:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Zemdomu/ZemDomu-action@main
        with:
          files: |
            **/*.{html,jsx,tsx,vue}
```

## Inputs

- `files`: glob patterns of files to lint
  Default: `**/*.{html,jsx,tsx,vue}`
- `crossComponentAnalysis`: enable cross-component analysis
  Default: `false`
- `crossComponentDepth`: maximum depth for cross-component analysis
  Default: `3`

## Outputs

The action reports findings through GitHub Actions annotations and fails the
job if issues are detected.

## Example

Run only on frontend folders and enable cross-component analysis:

```yaml
- uses: Zemdomu/ZemDomu-action@main
  with:
    files: |
      apps/web/**/*.{html,jsx,tsx,vue}
      packages/ui/**/*.{html,jsx,tsx,vue}
    crossComponentAnalysis: true
    crossComponentDepth: 4
```

## Local Development

Reference the action by path:

```yaml
- uses: ./packages/Zemdomu-Actions
```

Build and test from the action package:

```bash
cd packages/Zemdomu-Actions
npm install
npm run build
npm test
```

## Links

- Issues and suggestions: https://github.com/ZemDomu/ZemDomu-action/issues
- ZemDomu Core: https://www.npmjs.com/package/zemdomu
- Website and docs: https://zemdomu.dev/

## License

MIT (c) 2025 Zacharias Eryd Berlin
