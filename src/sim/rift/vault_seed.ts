// Treasure vault seeds (src/sim/treasure_vault.ts). Legacy vaults use the top
// bits `11` and keep all 28 original random bits. Metadata vaults use the
// disjoint `01` namespace: natural and dev portal seeds stay below 2^30, while
// old saved vaults can never be mistaken for an outdoor valley. The descriptor
// alone tells every host the size, biome and whether the hoard is open-air.
// Pure, no imports.

const SEED_NAMESPACE_MASK = 0xc0000000;
const LEGACY_VAULT_FLAG = 0xc0000000;
const METADATA_VAULT_FLAG = 0x40000000;
const LEGACY_RANDOM_MASK = 0x0fffffff;
const METADATA_RANDOM_MASK = 0x007fffff;
const OPEN_FLAG = 0x08000000;
const ZONE_SHIFT = 23;

export type VaultSizeTier = 0 | 1 | 2 | 3;

/** Frozen and append-only. Its indices are persisted in metadata vault seeds. */
export const VAULT_ZONE_IDS = Object.freeze([
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'galecrest',
] as const);

export type VaultZoneId = (typeof VAULT_ZONE_IDS)[number];

/** The single tuning point for which treasure-map rarities open as valleys. */
export const OPEN_HOARD_RARITIES = Object.freeze(['epic', 'legendary'] as const);

export interface VaultSeedMetadata {
  open: boolean;
  zoneId: VaultZoneId;
}

function isMetadataSeed(seed: number): boolean {
  return ((seed >>> 0) & SEED_NAMESPACE_MASK) >>> 0 === METADATA_VAULT_FLAG;
}

/** Whether a vault seed draws its boss from the cave bosses (content/rift/
 *  cave_themes.ts): a common or rare map minted in the current format. A saved
 *  legacy seed keeps the boss it was dug up with. */
export function vaultSeedCaveBoss(seed: number): boolean {
  return isMetadataSeed(seed) && ((seed >>> 28) & 3) <= 1;
}

/** The vault size tier a seed encodes, or null for an ordinary rift seed. */
export function vaultSeedTier(seed: number): VaultSizeTier | null {
  const s = seed >>> 0;
  const namespace = ((s & SEED_NAMESPACE_MASK) >>> 0) as number;
  if (namespace !== LEGACY_VAULT_FLAG && namespace !== METADATA_VAULT_FLAG) return null;
  return ((s >>> 28) & 3) as VaultSizeTier;
}

/** Whether the seed describes an outdoor hoard. Legacy saved seeds are caves. */
export function vaultSeedOpen(seed: number): boolean {
  return isMetadataSeed(seed) && ((seed >>> 0) & OPEN_FLAG) !== 0;
}

/** The dig-site zone encoded in a metadata seed, or null for old/non-vault seeds. */
export function vaultSeedZone(seed: number): VaultZoneId | null {
  if (!isMetadataSeed(seed)) return null;
  return VAULT_ZONE_IDS[((seed >>> 0) >>> ZONE_SHIFT) & 0xf] ?? null;
}

/** True when `zoneId` is one of the frozen seed zone ids. */
export function isVaultZoneId(zoneId: string): zoneId is VaultZoneId {
  return (VAULT_ZONE_IDS as readonly string[]).includes(zoneId);
}

/** A vault seed of `tier`. Without metadata this preserves the legacy 28-bit format. */
export function makeVaultSeed(
  tier: VaultSizeTier,
  random: number,
  metadata?: VaultSeedMetadata,
): number {
  if (!metadata) return (LEGACY_VAULT_FLAG | (tier << 28) | (random & LEGACY_RANDOM_MASK)) >>> 0;
  const zoneIndex = VAULT_ZONE_IDS.indexOf(metadata.zoneId);
  if (zoneIndex < 0) throw new Error(`Unknown vault zone: ${metadata.zoneId}`);
  return (
    (METADATA_VAULT_FLAG |
      (tier << 28) |
      (metadata.open ? OPEN_FLAG : 0) |
      (zoneIndex << ZONE_SHIFT) |
      (random & METADATA_RANDOM_MASK)) >>>
    0
  );
}

/** The Buried Hoard's entrance object: a Rift entrance under its own template,
 *  so it renders and reads as a dug-open way down, never as a rift tear. */
export const HOARD_ENTRANCE_TEMPLATE_ID = 'hoard_entrance';

/** Whether an object template is a walk-in Rift entrance (a rift portal or a
 *  Buried Hoard entrance). The portal registry, the interact paths and the
 *  walk-in trigger all ask this one question. */
export function isRiftEntranceTemplate(templateId: string | undefined): boolean {
  return templateId === 'rift_portal' || templateId === HOARD_ENTRANCE_TEMPLATE_ID;
}
