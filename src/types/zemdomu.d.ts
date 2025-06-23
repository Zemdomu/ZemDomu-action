declare module 'zemdomu' {
  export class ProjectLinter {
    constructor(options?: any);
    clear(): void;
    lintFile(filePath: string, content?: string): Promise<Map<string, any[]>>;
    lintFiles(filePaths: string[]): Promise<Map<string, any[]>>;
  }
}
