export declare const MOB_ACTIONS: Set<string>;
export declare const PROBE_EXTENSIONS: readonly string[];

export interface CatalogEntry {
  key: string;
  loop?: boolean;
  [key: string]: unknown;
}

export interface ManifestResult {
  count: number;
  errors: string[];
  entries: Record<string, DiscoveredEntry>;
}

export interface DiscoveredTrack {
  id: string;
  filename: string;
  url: string;
}

export interface DiscoveredEntry {
  key: string;
  loop: boolean;
  catalog: boolean;
  tracks: DiscoveredTrack[];
}

export interface DiscoveryResult {
  entries: Record<string, DiscoveredEntry>;
  errors: string[];
}

export declare function discoverSfxTracks(catalog: CatalogEntry[], sfxDir: string): DiscoveryResult;

export declare function buildManifest(
  catalog: CatalogEntry[],
  sfxDir: string,
  manifestPath: string,
): ManifestResult;
