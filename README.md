# ZemDomu GitHub Action

> Pull-request annotations for supported semantic accessibility defects.

The ZemDomu GitHub Action runs the shared ZemDomu Core rules in CI and surfaces
findings as pull-request annotations. It analyzes supported HTML, JSX, TSX, and
Vue source so teams can catch semantic HTML and accessibility defects before
merge.

Use these static source checks before runtime and manual accessibility testing,
not instead of them. A clean Action run does not establish accessibility or
WCAG conformance.

## Quick Start

Add one versioned step to a pull-request workflow:

```yaml
name: ZemDomu Semantic Accessibility Checks
on: [pull_request]

jobs:
  zemdomu:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Zemdomu/ZemDomu-action@v0.3.7
```

The default scan includes `**/*.{html,jsx,tsx,vue}`.

## What It Is

The ZemDomu GitHub Action runs the shared ZemDomu Core engine inside GitHub
Actions. It
is designed for teams that want semantic issues to be enforced in pull requests
instead of discovered later through audits or production review.

## Why ZemDomu

ZemDomu adds focused source-level semantic structure analysis to pull-request
workflows and complements rendered-DOM scanners.

- It checks semantic HTML, accessible naming, and document structure.
- It can analyze named structural rules across statically resolvable React and
  Vue component imports when cross-component analysis is enabled.
- It shares the same rules engine as the VS Code extension and CLI.
- It reports findings directly where teams already review code: in pull requests.

## Features

- Lints HTML, JSX, TSX, and Vue templates in CI.
- Surfaces findings as GitHub Actions annotations.
- Generates a SARIF 2.1.0 report for GitHub code-scanning uploads.
- Fails the job when issues are detected.
- Supports bounded cross-component analysis for local React and Vue imports.
- Flags supported semantic HTML and accessibility source patterns.

## Configuration

| Input | Default | Purpose |
| --- | --- | --- |
| `files` | `**/*.{html,jsx,tsx,vue}` | One or more newline-, comma-, or space-separated glob patterns to analyze. |
| `crossComponentAnalysis` | `false` | Set to `true` to follow statically resolvable local React and Vue imports. |
| `crossComponentDepth` | `3` | Maximum local import depth when cross-component analysis is enabled. |

## Outputs

- `sarif`: absolute path to the generated SARIF 2.1.0 report.

## Annotations and Failure Behavior

ZemDomu maps canonical `error`, `warning`, and `info` severities to GitHub error,
warning, and notice annotations. The step fails when any supported finding is
reported; there is currently no separate Action-level severity threshold.
Invalid input or an analysis error also fails the step.

The `sarif` output is written even when analysis reports findings. To upload the
same canonical results to GitHub code scanning, let the ZemDomu step continue
long enough for the upload step to run:

```yaml
- id: zemdomu
  continue-on-error: true
  uses: Zemdomu/ZemDomu-action@v0.3.7
- if: always() && steps.zemdomu.outputs.sarif != ''
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: ${{ steps.zemdomu.outputs.sarif }}
- name: Preserve the ZemDomu result
  if: steps.zemdomu.outcome == 'failure'
  run: exit 1
```

## Example

Run only on frontend folders and enable cross-component analysis:

```yaml
- uses: Zemdomu/ZemDomu-action@v0.3.7
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
