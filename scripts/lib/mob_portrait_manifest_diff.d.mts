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
}

export function describeManifestDrift(
  previous: DriftManifest | null,
  next: DriftManifest,
): ManifestDrift;

export function formatManifestDrift(drift: ManifestDrift): string;
