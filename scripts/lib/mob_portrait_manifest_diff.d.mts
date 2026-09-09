import type { RecordedRenderEnv, RenderEnvDrift } from './mob_portrait_render_env.mjs';

export interface PortraitFileDigest {
  path?: string;
  entry?: string;
  bytes: number;
  sha256: string;
}

export interface DriftManifestRow {
  id: string;
  sourceFingerprint: string;
  output: { bytes: number; sha256: string };
}

export interface DriftManifest {
  schemaVersion: number;
  rendererFingerprint: string;
  portraitCount: number;
  bootstrapReview?: PortraitFileDigest;
  /** Where the committed bytes were rendered. Optional: manifests minted before
   *  the field existed carry none, and an absent record concludes nothing. */
  renderEnv?: RecordedRenderEnv;
  // Required in every manifest this ships against. describeManifestDrift still reads it
  // defensively so a malformed committed file degrades into a diagnosis instead of a throw.
  renderer: {
    trackedFiles: PortraitFileDigest[];
    browserBundle: PortraitFileDigest;
  };
  portraits: DriftManifestRow[];
}

export interface ChangedPortraitRow {
  id: string;
  sourceChanged: boolean;
  outputChanged: boolean;
}

export interface ManifestDrift {
  schemaChanged: boolean;
  portraitCountChanged: boolean;
  fingerprintChanged: boolean;
  bundleChanged: boolean;
  bootstrapReviewChanged: boolean;
  changedTrackedFiles: string[];
  changedRows: ChangedPortraitRow[];
  bookkeepingOnly: boolean;
  /** How the recorded render environments compare. `known` is false whenever
   *  either manifest carries no record. */
  renderEnv: RenderEnvDrift;
  /** Every changed row is output-only AND the known render environment moved:
   *  the same art re-baked on a different GPU stack. */
  environmentOnly: boolean;
}

export function describeManifestDrift(
  previous: DriftManifest | null,
  next: DriftManifest,
): ManifestDrift;

export function formatManifestDrift(drift: ManifestDrift): string;
