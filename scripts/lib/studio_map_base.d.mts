export const BASE_CACHE_KEEP: number;
export function gitBlobId(bytes: string | Uint8Array): string;
export function snapshotBase(cacheDir: string, bytes: string | Uint8Array): string;
export function pruneBases(cacheDir: string, keep: number): void;
export function readBase(cacheDir: string, repoRoot: string, id: string): string | null;
