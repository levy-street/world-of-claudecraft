export declare function isIgnoredByDockerignore(dockerignore: string, path: string): boolean;
export declare function collectLocalImportClosure(
  entry: string,
  readFile: (path: string) => string | null | undefined,
): string[];
