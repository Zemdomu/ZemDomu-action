declare module 'zemdomu' {
  export interface Rule {
    id: string;
    description: string;
    severity: 'error' | 'warning';
  }

  export interface LintIssue {
    rule: string;
    message: string;
    line: number;
    column?: number;
    severity: 'error' | 'warning';
  }

  export class ProjectLinter {
    constructor(options?: any);
    clear(): void;
    lintFile(filePath: string, content?: string): Promise<Map<string, LintIssue[]>>;
    lintFiles(filePaths: string[]): Promise<Map<string, LintIssue[]>>;
  }
}
