export declare const MOB_ACTIONS: Set<string>;

export interface CatalogEntry {
  key: string;
  loop?: boolean;
  [key: string]: unknown;
}

export interface ManifestResult {
  count: number;
  errors: string[];
}

export declare function buildManifest(
  catalog: CatalogEntry[],
  sfxDir: string,
  manifestPath: string,
): ManifestResult;
