import type { RecordedRenderEnv } from './mob_portrait_render_env.mjs';

export interface PortraitManifestRow {
  id: string;
  sourceFingerprint: string;
  output: { bytes: number; sha256: string };
}

export interface ReceiptGuardManifest {
  schemaVersion: number;
  rendererFingerprint: string;
  /** Where the committed bytes were rendered; absent on manifests minted before
   *  the field existed, which the guard treats as "nothing can be concluded". */
  renderEnv?: RecordedRenderEnv;
  portraits: PortraitManifestRow[];
}

export interface PortraitRenderReceipt {
  schemaVersion: number;
  generatedBy: string;
  rendererFingerprint: string;
  renderEnv?: RecordedRenderEnv;
  portraits: PortraitManifestRow[];
}

export function changedPortraitIds(
  previous: ReceiptGuardManifest | null,
  next: ReceiptGuardManifest,
): string[];

export function rowChangedPortraitIds(
  previous: ReceiptGuardManifest,
  next: ReceiptGuardManifest,
): string[];

export function assertManifestWriteAuthorized(args: {
  previous: ReceiptGuardManifest | null;
  next: ReceiptGuardManifest;
  receipt: PortraitRenderReceipt | null;
  allowBootstrap?: boolean;
  /** Accept a re-render made in a DIFFERENT recorded render environment whose
   *  render inputs are all unchanged. Refused without it. */
  allowEnvironmentRemint?: boolean;
}): void;
