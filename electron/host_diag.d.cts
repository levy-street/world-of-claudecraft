// Types for electron/host_diag.cjs (the CJS module is the implementation; this
// file is what tsc and tests/electron_host_diag.test.ts read).

export type HostDiagScriptVerdict = 'ok' | 'missing' | 'hash-mismatch';

export type NativeHostDiagStatus =
  | 'ok'
  | 'partial'
  | 'unsupported-platform'
  | 'unavailable'
  | 'error';

/** Short STABLE codes only: this value crosses to the renderer, so a raw error
 *  message or a path must never appear here. */
export type NativeHostDiagReason =
  | 'missing'
  | 'hash-mismatch'
  | 'timeout'
  | 'too-large'
  | 'bad-json'
  | 'spawn-failed'
  | 'exit-code';

export interface NativeHostDiagResult {
  status: NativeHostDiagStatus;
  reason?: NativeHostDiagReason;
  exitCode?: number | null;
  durationMs: number;
  report?: Record<string, unknown> | null;
}

export interface HostDiagManifest {
  file: string;
  sha256: string;
  toolVersion: string;
  schemaVersion: number;
}

export interface HostDiagScriptPaths {
  isPackaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
}

export interface HostDiagSpawnOptions {
  windowsHide: true;
  stdio: readonly ['ignore', 'pipe', 'ignore'];
}

/** The renderer's contribution, after sanitizeGameInfo: the whitelisted keys
 *  only, each a clamped string or a finite number. */
export type HostDiagGameInfo = Record<string, string | number>;

export interface HostDiagRunResult {
  status: 'saved' | 'cancelled' | 'busy' | 'error';
  nativeStatus: NativeHostDiagStatus | null;
  fileName?: string;
  durationMs: number;
  bytes: number;
}

export declare const APP_EXE_NAME_RE: RegExp;
export declare const BROWSER_EXE_NAMES: readonly string[];
export declare const GAME_INFO_KEYS: readonly string[];
export declare const GPU_INFO_TIMEOUT_MS: number;
export declare const HOST_DIAG_KIND: string;
export declare const HOST_DIAG_MANIFEST: HostDiagManifest;
export declare const HOST_DIAG_MAX_STDOUT_BYTES: number;
export declare const HOST_DIAG_SCHEMA_VERSION: number;
export declare const HOST_DIAG_SPAWN_OPTIONS: HostDiagSpawnOptions;
export declare const HOST_DIAG_TIMEOUT_MS: number;

export declare function appExeNameFor(execPath: string): string | null;
export declare function assembleHostDiagReport(input?: {
  game?: unknown;
  electron?: unknown;
  native?: Partial<NativeHostDiagResult> & { platform?: string | null };
  now?: Date | number;
}): Record<string, unknown>;
export declare function buildHostDiagArgs(input?: {
  scriptPath?: string;
  appExeName?: string | null;
}): string[];
export declare function collectElectronHostInfo(
  deps?: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export declare function flattenSwitchPairs(
  pairs: ReadonlyArray<string | readonly [string, string?]> | unknown,
): string;
export declare function hostDiagFileName(now?: Date | number): string;
export declare function hostDiagScriptPath(paths?: HostDiagScriptPaths): string;
export declare function powershellExe(env?: Record<string, string | undefined>): string;
export declare function runHostDiag(deps?: Record<string, unknown>): Promise<HostDiagRunResult>;
export declare function runNativeHostDiag(
  deps?: Record<string, unknown>,
): Promise<NativeHostDiagResult>;
export declare function sanitizeGameInfo(raw: unknown): HostDiagGameInfo;
export declare function sanitizeShellState(
  raw: unknown,
  maxKeys?: number,
): Record<string, string | number | boolean | null> | null;
export declare function saveHostDiagFile(
  text: string,
  deps?: Record<string, unknown>,
): Promise<{ status: 'saved' | 'cancelled' | 'error'; fileName?: string }>;
export declare function verifyHostDiagScript(
  scriptPath: string,
  manifest?: HostDiagManifest,
  deps?: Record<string, unknown>,
): HostDiagScriptVerdict;
