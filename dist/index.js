        const patternsInput = core.getInput("files") || "**/*.{html,jsx,tsx}";
        const patterns = patternsInput
            .split(/\r?\n/)
            .flatMap((p) => p.split(/[, ]+/))
            .filter(Boolean);
        const linter = new zemdomu_1.ProjectLinter();
        let hasIssues = false;
                core.error(`${issue.message} (${issue.rule})`, {
                    file,
                    startLine: issue.line + 1,
                });
                hasIssues = true;
        if (hasIssues) {
            core.setFailed("Semantic-HTML linting failed; see errors above.");
        }
