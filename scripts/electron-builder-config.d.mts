// Hand-written declarations for scripts/electron-builder-config.mjs so the
// Vitest suite type-checks its imports (same convention as the electron/*.d.cts
// files). Keep in sync with the .mjs exports.

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
    };
  };
  publish: unknown;
  directories: { output?: string; [key: string]: unknown };
  mac: { [key: string]: unknown };
  win: { azureSignOptions?: AzureSignOptions; [key: string]: unknown };
  linux: { [key: string]: unknown };
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
}): DesktopBuilderConfig;
