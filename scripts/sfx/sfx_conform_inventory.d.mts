export interface SfxConformCatalogEntry {
  key: string;
  stereo?: boolean;
  /** Hand-recorded, already-mastered content: conform guards its true peak but
   *  never re-targets its loudness. */
  custom?: boolean;
}

export interface DiscoveredSfxConformEntry {
  key: string;
  tracks: ReadonlyArray<{ filename: string }>;
}

export interface SfxConformPolicy {
  violations: string[];
  recognizes(filename: string): boolean;
  expectedChannels(filename: string): number | undefined;
  isCustomMaster(filename: string): boolean;
}

export function buildSfxConformPolicy(
  catalog: ReadonlyArray<SfxConformCatalogEntry>,
  discoveredEntries: Readonly<Record<string, DiscoveredSfxConformEntry>>,
  sourceFilenames?: ReadonlyArray<string>,
): SfxConformPolicy;
