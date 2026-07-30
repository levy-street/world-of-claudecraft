export interface SfxConformCatalogEntry {
  key: string;
  stereo?: boolean;
}

export interface DiscoveredSfxConformEntry {
  key: string;
  tracks: ReadonlyArray<{ filename: string }>;
}

export interface SfxConformPolicy {
  violations: string[];
  recognizes(filename: string): boolean;
  expectedChannels(filename: string): number | undefined;
}

export function buildSfxConformPolicy(
  catalog: ReadonlyArray<SfxConformCatalogEntry>,
  discoveredEntries: Readonly<Record<string, DiscoveredSfxConformEntry>>,
  sourceFilenames?: ReadonlyArray<string>,
): SfxConformPolicy;
