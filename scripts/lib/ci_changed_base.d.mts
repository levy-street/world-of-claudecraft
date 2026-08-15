export declare function resolveChangedBaseRef(deps: {
  env?: Record<string, string | undefined>;
  run: (cmd: string, args: string[]) => { status: number | null; stdout?: string };
}): string;
