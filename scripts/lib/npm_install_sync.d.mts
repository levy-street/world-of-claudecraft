export declare function parseInstallProblems(rawStdout: string): string[];
export declare function shouldCheckInstallSync(result: {
  error: Error | undefined;
  stdout: string | undefined;
}): boolean;
export declare function formatInstallSyncFailure(problems: ReadonlyArray<string>): string;
