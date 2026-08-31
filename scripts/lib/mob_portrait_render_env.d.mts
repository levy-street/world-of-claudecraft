export const RENDER_ENV_SCHEMA_VERSION: 1;

export const RENDER_ENV_FIELDS: readonly [
  'platform',
  'arch',
  'gpuVendor',
  'gpuRenderer',
  'browserMajor',
];

/** What a caller observes. Every field is optional: a partially observed
 *  environment still records and hashes deterministically. */
export interface ObservedRenderEnv {
  platform?: string | null;
  arch?: string | null;
  gpuVendor?: string | null;
  gpuRenderer?: string | null;
  /** Full browser build string; only its major is hashed. */
  browserVersion?: string | null;
  /** Accepted in place of browserVersion when only the major is known. */
  browserMajor?: string | null;
  /** The ANGLE backend the launch asked for. Provenance, never hashed. */
  requestedBackend?: string | null;
}

export interface NormalizedRenderEnv {
  schemaVersion: number;
  platform: string;
  arch: string;
  gpuVendor: string;
  gpuRenderer: string;
  browserMajor: string;
  browserVersion: string;
  requestedBackend: string;
}

export interface RecordedRenderEnv extends NormalizedRenderEnv {
  fingerprint: string;
}

export interface RenderEnvDriftField {
  field: string;
  from: string;
  to: string;
}

export interface RenderEnvDrift {
  known: boolean;
  moved: boolean;
  fields: RenderEnvDriftField[];
}

export function browserMajorOf(version: string | null | undefined): string;

export function normalizeRenderEnv(
  raw: ObservedRenderEnv | NormalizedRenderEnv | null | undefined,
): NormalizedRenderEnv;

export function renderEnvFingerprint(
  env: ObservedRenderEnv | NormalizedRenderEnv | null | undefined,
): string;

export function recordRenderEnv(
  raw: ObservedRenderEnv | NormalizedRenderEnv | null | undefined,
): RecordedRenderEnv;

export function describeRenderEnvDrift(
  previous: NormalizedRenderEnv | RecordedRenderEnv | null | undefined,
  next: NormalizedRenderEnv | RecordedRenderEnv | null | undefined,
): RenderEnvDrift;

export function formatRenderEnvDrift(drift: RenderEnvDrift): string;
