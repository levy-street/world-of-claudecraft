// Type declarations for the pure planning/validation exports in
// publish_bundle.mjs, imported by tests/ota_publish.test.ts (the .mjs has no
// inline types, mirrors version_sync.d.mts).

export interface OtaPublishArgs {
  version: string | null;
  minNative: string | null;
  rollback: string | null;
  skipBuild: boolean;
  dryRun: boolean;
  force: boolean;
}

export interface OtaPublishManifest {
  version: string;
  url: string;
  checksum?: string;
  minNativeVersion?: string;
  builtAt?: string;
}

export interface OtaPublishPlan {
  bucket: string;
  bundleKey: string;
  manifestKey: string;
  bundleUrl: string;
  manifestUrl: string;
  manifest: OtaPublishManifest;
}

export function bundleFileName(version: string): string;
export function awsEndpointArgs(endpointUrl: string | undefined | null): string[];
export function parseOtaArgs(argv: string[]): OtaPublishArgs;
export function planOtaPublish(input: {
  version: string;
  bucket: string;
  prefix?: string;
  publicBaseUrl: string;
  checksum?: string;
  minNative?: string | null;
  builtAt?: string;
}): OtaPublishPlan;
