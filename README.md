# ZemDomu GitHub Action

Run the ZemDomu semantic linter in GitHub Actions to prevent SEO and
accessibility regressions before code lands.

## What it is

ZemDomu Actions runs the core ZemDomu linter in CI and surfaces findings as
GitHub Actions annotations.

## Features

- Lints HTML, JSX, TSX, and Vue templates in CI.
- Surfaces findings as GitHub Actions annotations.
- Fails the job when issues are detected.
- Supports cross-component analysis for component trees.

## Quick start

```yaml
name: ZemDomu SEO Guard
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

- `files`: Glob patterns (newline, comma, or space separated).
  Default: `**/*.{html,jsx,tsx,vue}`
- `crossComponentAnalysis`: Enable cross-component analysis.
  Default: `false`
- `crossComponentDepth`: Maximum depth for cross-component analysis.
  Default: `3`

## Outputs

None. The action reports findings via GitHub Actions annotations and fails the
job if issues are detected.

## Examples

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

## Local development (monorepo)

Reference the action by path:

```yaml
- uses: ./packages/Zemdomu-Actions
```

Build and test from the action package:

```bash
npm run build
npm test
```

## Links

Development happens in a private monorepo; this repository is the public mirror
for issues and updates.

- Public mirror: https://github.com/Zemdomu/ZemDomu-action
- Issues and suggestions: https://github.com/Zemdomu/ZemDomu-action/issues
- ZemDomu core: https://www.npmjs.com/package/zemdomu

## License

MIT (c) 2025 Zacharias Eryd Berlin
