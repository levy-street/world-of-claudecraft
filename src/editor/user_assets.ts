// Player-uploaded GLB assets in the editor: the 'user/<sha256>' asset-id scheme
// and the session registry backing the asset browser's Uploaded tab. Resolution
// is PURE (the render path derives from the id itself, so a map that references
// another player's public upload renders without any registry entry); the
// registry only adds labels for the browsing UI. No DOM: custom_map.ts (a
// Vitest-imported module) consults resolveUserAsset from placementsToRenderAssets.

export const USER_ASSET_PREFIX = 'user/';

const SHA256_RE = /^[a-f0-9]{64}$/;

export interface UserAssetEntry {
  /** Server row id (delete handle); 0 for entries not owned by this account. */
  id: number;
  sha256: string;
  name: string | null;
  byteSize: number;
}

export function isUserAssetId(assetId: string): boolean {
  return assetId.startsWith(USER_ASSET_PREFIX);
}

export function userAssetIdFor(sha256: string): string {
  return `${USER_ASSET_PREFIX}${sha256}`;
}

/**
 * Resolve a 'user/<sha256>' asset id to its content-addressed GLB URL
 * (server route GET /api/assets/<sha256>.glb), or null when the id is not a
 * well-formed user asset id.
 */
export function userAssetPath(assetId: string): string | null {
  if (!isUserAssetId(assetId)) return null;
  const sha = assetId.slice(USER_ASSET_PREFIX.length);
  if (!SHA256_RE.test(sha)) return null;
  return `/api/assets/${sha}.glb`;
}

// ---- session registry (labels for the Uploaded tab) ------------------------

const registry = new Map<string, UserAssetEntry>();

export function registerUserAssets(entries: readonly UserAssetEntry[]): void {
  for (const e of entries) registry.set(e.sha256, { ...e });
}

export function clearUserAssets(): void {
  registry.clear();
}

export function removeUserAsset(sha256: string): void {
  registry.delete(sha256);
}

export function listUserAssets(): UserAssetEntry[] {
  return [...registry.values()];
}

/** Display label for a user asset id: the uploaded name, else a short hash. */
export function userAssetLabel(assetId: string): string {
  const sha = assetId.slice(USER_ASSET_PREFIX.length);
  const entry = registry.get(sha);
  if (entry?.name) return entry.name;
  return sha.slice(0, 8);
}
