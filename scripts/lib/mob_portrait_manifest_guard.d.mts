export interface PortraitManifestRow {
  id: string;
  sourceFingerprint: string;
  output: { bytes: number; sha256: string };
}

export interface ReceiptGuardManifest {
  schemaVersion: number;
  rendererFingerprint: string;
  portraits: PortraitManifestRow[];
}

export interface PortraitRenderReceipt {
  schemaVersion: number;
  generatedBy: string;
  rendererFingerprint: string;
  portraits: PortraitManifestRow[];
}

export function changedPortraitIds(
  previous: ReceiptGuardManifest | null,
  next: ReceiptGuardManifest,
): string[];

export function assertManifestWriteAuthorized(args: {
  previous: ReceiptGuardManifest | null;
  next: ReceiptGuardManifest;
  receipt: PortraitRenderReceipt | null;
  allowBootstrap?: boolean;
}): void;
