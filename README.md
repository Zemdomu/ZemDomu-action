# ZemDomu GitHub Action

This package provides a GitHub Action that runs the ZemDomu linter on your project.

## Usage

Add the action to a workflow in your repository:

```yaml
- uses: Zelcus/ZemDomu-mono/packages/Zemdomu-Actions@main
  with:
    files: "**/*.{html,jsx,tsx}"
    # Optional: emit warnings instead of failing on issues
    warningOnly: "false"
```

For local development inside this monorepo you can reference the action by path:

```yaml
- uses: ./packages/Zemdomu-Actions
```

The action uses the `zemdomu` npm package from [ZemDomu](https://www.npmjs.com/package/zemdomu).

### Configuring rule severity

Each lint rule can be individually configured when running the action.  Pass the
rule name as an input with one of the values `off`, `warning`, or `error`:

```yaml
jobs:
  lint:
    steps:
      - uses: Zelcus/ZemDomu-mono/packages/Zemdomu-Actions@main
        with:
          requireHtmlLang: warning
          singleH1: error
```

See `action.yml` for the full list of supported rule names.
