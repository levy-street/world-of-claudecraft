// Locally imported model files (.glb/.gltf) in the editor: the 'local/<sha256>'
// asset-id scheme and the session registry backing the asset browser's Imported
// tab. Fully offline: the file never leaves the machine; the registry maps the
// content-addressed id to an object URL the GLB loader can fetch. Session-
// scoped: a reload drops the blobs, and re-importing the same file mints the
// SAME id (content hash), so placements in a saved map rebind automatically.
// No DOM APIs here (the app creates the object URL); Vitest-importable.

export const LOCAL_ASSET_PREFIX = 'local/';

export interface LocalAssetEntry {
  /** Full asset id, 'local/<sha256>'. */
  id: string;
  name: string;
  /** Object URL (or any fetchable URL) for the model bytes. */
  url: string;
  byteSize: number;
}

const registry = new Map<string, LocalAssetEntry>();

export function isLocalAssetId(assetId: string): boolean {
  return assetId.startsWith(LOCAL_ASSET_PREFIX);
}

export function localAssetIdFor(sha256: string): string {
  return `${LOCAL_ASSET_PREFIX}${sha256}`;
}

/** Register (or replace) an imported model; returns its asset id. */
export function registerLocalAsset(entry: LocalAssetEntry): string {
  registry.set(entry.id, { ...entry });
  return entry.id;
}

/** Resolve a 'local/...' id to its object URL, or null when unknown/not local. */
export function localAssetUrl(assetId: string): string | null {
  if (!isLocalAssetId(assetId)) return null;
  return registry.get(assetId)?.url ?? null;
}

export function localAssetLabel(assetId: string): string {
  const entry = registry.get(assetId);
  if (entry?.name) return entry.name;
  return assetId.slice(LOCAL_ASSET_PREFIX.length, LOCAL_ASSET_PREFIX.length + 8);
}

export function listLocalAssets(): LocalAssetEntry[] {
  return [...registry.values()];
}

/** Drop an imported model; returns its URL so the caller can revoke it. */
export function removeLocalAsset(assetId: string): string | null {
  const entry = registry.get(assetId);
  registry.delete(assetId);
  return entry?.url ?? null;
}

/** Empty the session registry and return every URL for caller-owned cleanup. */
export function drainLocalAssetUrls(): string[] {
  const urls = [...registry.values()].map((entry) => entry.url);
  registry.clear();
  return urls;
}
