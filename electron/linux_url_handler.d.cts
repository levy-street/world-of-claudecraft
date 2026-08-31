// Type declarations for the CommonJS Linux URL-scheme-handler helper
// (electron/linux_url_handler.cjs), which electron/main.cjs invokes at runtime and
// tests/electron_linux_url_handler.test.ts exercises directly. main.cjs itself runs outside
// tsc; these types serve the test.

export const APPIMAGE_ENTRY_NAME: string;
export const DEB_ENTRY_NAME: string;
export const DESKTOP_ENTRY_BASENAME: string;
export const PRODUCT_NAME: string;
export const SYSTEM_APPLICATIONS_DIR: string;

export function desktopEntryDir(env?: Record<string, string | undefined>, homeDir?: string): string;
export function execArgumentFor(appImagePath: unknown): string | null;
export function defaultRunCommand(
  command: string,
  args: string[],
  log?: LinuxUrlHandlerLog,
  execFile?: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
    callback: (err: unknown) => void,
  ) => { unref?(): void } | undefined,
): void;
export function appImagePathFrom(env?: Record<string, string | undefined>): string | null;
export function buildDesktopEntry(entry: {
  execArgument: unknown;
  scheme: unknown;
  productName: unknown;
  tryExecPath?: string | null;
}): string | null;

export interface LinuxUrlHandlerLog {
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
}

export interface ConfigureLinuxDesktopNameDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  dir?: string;
  homeDir?: string;
  fileExists?: (path: string) => boolean;
}
export interface LinuxDesktopName {
  desktopName: string | null;
  restore: () => void;
}
export function configureLinuxDesktopName(deps?: ConfigureLinuxDesktopNameDeps): LinuxDesktopName;

export type InstallDesktopEntryStatus =
  | 'not-appimage'
  | 'invalid-scheme'
  | 'unsafe-dir'
  | 'unsafe-path'
  | 'unchanged'
  | 'installed'
  | 'failed';

export interface InstallDesktopEntryDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  scheme?: string;
  productName?: string;
  appImagePath?: string | null;
  dir?: string;
  homeDir?: string;
  readFile?: (file: string, encoding: string) => string;
  writeFile?: (file: string, data: string, options: unknown) => void;
  removeFile?: (file: string) => void;
  mkdir?: (dir: string, options: { recursive: boolean }) => unknown;
  rename?: (from: string, to: string) => void;
  fileExists?: (path: string) => boolean;
  runCommand?: (command: string, args: string[], log?: LinuxUrlHandlerLog) => void;
  log?: LinuxUrlHandlerLog;
}

export interface InstallDesktopEntryResult {
  status: InstallDesktopEntryStatus;
  file?: string;
  entry?: string;
  /** Runs update-desktop-database and xdg-mime. MUST be called after
   * app.setAsDefaultProtocolClient, never concurrently with it. */
  associate: () => void;
}

export function installDesktopEntry(deps?: InstallDesktopEntryDeps): InstallDesktopEntryResult;

export function registerLinuxUrlHandler(
  deps?: InstallDesktopEntryDeps & ConfigureLinuxDesktopNameDeps,
): InstallDesktopEntryResult & LinuxDesktopName;
