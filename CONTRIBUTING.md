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

The normal test run includes seeded fast-check properties against the real runner
and file-discovery APIs. They check annotation escaping, output record boundaries,
Unicode preservation, overlapping globs, and exclusion of vendor or linked
directories. Run just these properties with `npm run test:fuzz`. Each property
runs 250 cases by default; use a longer run and a chosen seed when investigating:

```sh
ZEMDOMU_FUZZ_RUNS=2000 ZEMDOMU_FUZZ_SEED=12345 npm run test:fuzz
```

`ZEMDOMU_FUZZ_RUNS` accepts 1–10000; `ZEMDOMU_FUZZ_SEED` accepts a signed 32-bit
integer. A failure reports its seed, shrunk counterexample, and replay path.
Replay that path against the named property, for example:

```sh
ZEMDOMU_FUZZ_SEED=12345 ZEMDOMU_FUZZ_PATH='0:1:2' node --experimental-strip-types --test --test-name-pattern='annotations preserve Unicode' tests/fuzz-properties.test.js
```

Use the actual seed and path from the failure. Omit `ZEMDOMU_FUZZ_PATH` for a fresh
run, and add a focused regression test for any confirmed counterexample.

Add a focused regression test under `tests/` for runner, input, file-discovery,
annotation, or SARIF changes. Edit source under `src/`; use `npm run build` to
regenerate the bundle when needed.
New functionality must include automated tests for its expected behavior and
important failure cases.

Follow the surrounding TypeScript naming, formatting, and module conventions.
Keep type checking enabled with the repository's checked-in `tsconfig.json`.
Fix compiler errors and confirmed security-analysis findings before merging;
document the evidence for any finding dismissed as a false positive. Do not
disable checks or weaken configuration to make a pull request pass.

Keep changes focused and include the commands and results in your pull request.
Explain any checks you could not run. For a user-facing change, add an entry under
`Unreleased` in `CHANGELOG.md`, grouped by category (for example, `Bugfix`,
`Feature`, or `Docs`).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in issues, discussions, and reviews.

## Measure source coverage

After `npm ci`, run `npm run test:coverage`. It executes the same runner, property,
Action-process, parity, discovery, and metadata checks as `npm test`, using direct
TypeScript compilation with source maps in `.coverage-build/`. Normal `npm test`
continues to rebuild and exercise the shipped ncc bundle. Coverage leaves `dist/`
unchanged and retains ignored `coverage/tmp/` raw V8 data, detailed
`coverage/coverage-final.json`, and `coverage/coverage-summary.json` for inspection.
Open `coverage/index.html` for the browsable source report. The lockfile keeps
coverage's `supports-color` and `has-flag` dependencies nested under
`istanbul-lib-report`; hoisting them would activate an existing optional runtime
require during ncc bundling. Preserve that tool-only placement. The committed
bundle check catches dependency-layout changes that alter the shipped bytes.

Reports cover executable first-party `src/**/*.ts`, excluding dependencies and
test/tooling code. The guard requires every source file and real executed
function/branch counters for the Action entry point; missing source files,
generated-file leakage, missing or incorrect direct maps, and the former
zero-counter bundle remap fail the command.
Percentages describe observed statement, branch, function, and line execution;
they do not prove complete input coverage, accessibility conformance, or security.

## Release security checks

Before publishing a production release, run `npm ci`, `npm test`,
`npm run audit:production`, and `npm run audit:all` on the release candidate.
The full test suite includes the generated-input property tests. Require a
successful CodeQL push run on public `main` for the exact source commit being
released, and review its findings. Fix confirmed exploitable vulnerabilities of
medium or higher severity before publishing; record evidence for false-positive
dismissals. Include the source commit and test, fuzz, audit, and CodeQL results
in the release pull request. Repeat these checks if the source changes.
