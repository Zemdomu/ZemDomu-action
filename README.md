# ZemDomu GitHub Action

This package provides a GitHub Action that runs the ZemDomu linter on your project.

## Usage

Add the action to a workflow in your repository:

```yaml
- uses: Zelcus/ZemDomu-mono/packages/Zemdomu-Actions@main
  with:
    files: "**/*.{html,jsx,tsx}"
```

For local development inside this monorepo you can reference the action by path:

```yaml
- uses: ./packages/Zemdomu-Actions
```

The action uses the `zemdomu` npm package from [ZemDomu](https://www.npmjs.com/package/zemdomu).

## Configuring rule severity with `.zemdomurc.json`

Rule severities are controlled via a `.zemdomurc.json` file in your repository root. This file should look like:

```json
{
  "rules": {
    "singleH1": "warning",
    "requireHtmlLang": "warning",
    "enforceHeadingOrder": "warning",
    "uniqueIds": "warning",
    "requireIframeTitle": "warning",
    "requireImageInputAlt": "warning",
    "requireLabelForFormControls": "warning",
    "requireAltText": "warning",
    "enforceListNesting": "warning",
    "requireHrefOnAnchors": "warning",
    "requireButtonText": "warning",
    "preventEmptyInlineTags": "warning",
    "requireSectionHeading": "warning",
    "requireTableCaption": "warning",
    "requireLinkText": "warning",
    "requireNavLinks": "warning"
  }
}
```

- Each rule can be set to `off`, `warning`, or `error`.
- Only rules set to `error` will cause the workflow to fail.
- To emit only warnings and never fail the workflow, set all rules to `warning`.
- For a full list of rules, see the ZemDomu documentation or the example above.

Remove the `warningOnly` input from your workflow; use `.zemdomurc.json` for all severity configuration.
