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
    # Each rule can be configured with off, warning or error
    singleH1: error
    requireHtmlLang: warning
    enforceHeadingOrder: error
```

For local development inside this monorepo you can reference the action by path:

```yaml
- uses: ./packages/Zemdomu-Actions
```

The action uses the `zemdomu` npm package from [ZemDomu](https://www.npmjs.com/package/zemdomu).
