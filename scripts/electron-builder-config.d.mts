// Hand-written declarations for scripts/electron-builder-config.mjs so the
// Vitest suite type-checks its imports (same convention as the electron/*.d.cts
// files). Keep in sync with the .mjs exports.

import type { UpdateChannel } from '../electron/update_guard.cjs';

export interface AzureSignOptions {
  publisherName: string;
  endpoint: string;
  codeSigningAccountName: string;
  certificateProfileName: string;
}

export function azureSignOptionsFromEnv(
  env?: Record<string, string | undefined>,
): AzureSignOptions | null;

export interface DesktopBuilderConfig {
  extraMetadata: {
    wocDesktop: {
      distribution: 'website' | 'steam';
      apiOrigin?: string;
      loginOrigin?: string;
      crashSubmitUrl?: string;
      steamAppId?: string;
    };
  };
  publish: { channel?: UpdateChannel; [key: string]: unknown } | null;
  directories: { output?: string; [key: string]: unknown };
  mac: { [key: string]: unknown };
  win: { azureSignOptions?: AzureSignOptions; [key: string]: unknown };
  linux: { [key: string]: unknown };
  files?: string[];
  asarUnpack?: string[];
  [key: string]: unknown;
}

export function desktopBuilderConfig(input: {
  base: Record<string, unknown>;
  distribution: string;
  mode?: 'pack' | 'build';
  apiOrigin?: string;
  loginOrigin?: string;
  crashSubmitUrl?: string;
  azureSign?: AzureSignOptions | null;
  updateChannel?: string | null;
  steamAppId?: string;
  steamworksInstalled?: (() => boolean) | null;
}): DesktopBuilderConfig;

export function isChannelFeedFile(fileName: unknown, channel: unknown): boolean;
export function stampFeedFile(text: string, apiOrigin: string): string;
export function stampChannelFeedFiles(input: {
  outDir: string;
  channel: unknown;
  apiOrigin: string;
  fs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => string[];
    readFileSync: (path: string, encoding: 'utf8') => string;
    writeFileSync: (path: string, data: string) => void;
  };
  joinPath: (...parts: string[]) => string;
}): string[];
