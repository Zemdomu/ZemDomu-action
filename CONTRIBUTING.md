# Contributing to ZemDomu GitHub Action

Report bugs, suggest improvements, or send a focused pull request. Search existing
issues first. Use [Meta discussions](https://github.com/Zemdomu/ZemDomu/discussions)
for questions or feedback spanning several ZemDomu products.

## Report a bug

Use the bug report form and include the affected version, syntax or framework,
a minimal reproduction, and expected and actual results. Include the smallest
workflow job, Action inputs, source files, and redacted log or annotation needed
to reproduce the problem. Include permissions when relevant.

Reports and attachments are public. Remove tokens, credentials, private source,
customer data, and identifying paths from examples and logs. For a suspected
security vulnerability, follow [SECURITY.md](SECURITY.md).

## Suggest a change

Use the feature request form to explain the problem, who encounters it, the
proposed scope, and any workaround. Discuss broad changes before starting a large
implementation. A feature request is a proposal, not a release commitment.

## Work on a change

Use Node.js 22.17 or newer. From the root of this repository, install dependencies
and run the tests:

```sh
npm ci
npm test
```

Dependency installation runs the `prepare` build. `npm test` rebuilds the Action
bundle before running the tests.

Add a focused regression test under `tests/` for runner, input, file-discovery,
annotation, or SARIF changes. Edit source under `src/`; use `npm run build` to
regenerate the bundle when needed.
Keep changes focused and include the commands and results in your pull request.
Explain any checks you could not run. For a user-facing change, add an entry under
`Unreleased` in `CHANGELOG.md`, grouped by category (for example, `Bugfix`,
`Feature`, or `Docs`).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in issues, discussions, and reviews.
