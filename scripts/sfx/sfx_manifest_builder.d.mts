export declare const MOB_ACTIONS: Set<string>;
export declare const PROBE_EXTENSIONS: readonly string[];
export declare const SFX_MOB_EXTENSION_KEY_PATTERN: RegExp;

export interface CatalogSfxVariant {
  key: string;
  variantId: string;
  variantNumber: number;
}

export type MobSfxVariantParse =
  | { kind: 'ignore' }
  | {
      kind: 'invalid';
      reason: 'variant' | 'action-missing' | 'action-position' | 'key' | 'family';
    }
  | {
      kind: 'valid';
      key: string;
      family: string;
      subfamily: string;
      action: string;
      variantId: string;
      variantNumber: number;
    };

export declare function sfxVariantNumber(value: string): number | null;
export declare function isSfxMobExtensionKey(key: unknown): boolean;
export declare function parseCatalogSfxVariantStem(
  value: string,
  catalogKeys: ReadonlySet<string>,
): CatalogSfxVariant | null;
export declare function parseMobSfxVariantStem(value: string): MobSfxVariantParse;

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
