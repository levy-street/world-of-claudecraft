// Hand-written declarations for scripts/electron-win-sign.mjs so the Vitest
// suite type-checks its imports (same convention as
// scripts/electron-builder-config.d.mts). Keep in sync with the .mjs exports.

export const KEY_VAULT_SIGN_ENV_VARS: string[];

export function resolveTimestampUrl(value: string | undefined): string;

export function azureSignToolArgs(
  env: Record<string, string | undefined>,
  filePath: string,
): string[];

export default function sign(configuration: { path: string; hash?: string }): Promise<void>;
