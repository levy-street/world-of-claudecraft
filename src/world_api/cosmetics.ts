export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Marketplace creator-skin ids the account owns; the equip gate's allow-list.
  ownedCreatorSkinIds: string[];
}

// Public cosmetic metadata for one marketplace creator skin (from GET
// /api/skins/registry). The renderer resolves an entity's opaque cosmeticSkinId
// to assetUrl through this; the marketplace UI uses name/price. Deliberately
// carries no ownership or creator wallet — it is world-public.
export interface CreatorSkinRegistryEntry {
  id: string;
  name: string;
  description: string;
  skinCatalog: 'class' | 'mech';
  fallbackSkin: number;
  targetClass: string | null;
  assetUrl: string;
  emissiveUrl: string | null;
  priceUsdc: string; // USDC base units (6 decimals) as a string
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  changeSkin(skin: number, catalog?: 'class' | 'mech', cosmeticSkinId?: string | null): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
}

// Normalize an untrusted/persisted cosmetics blob to the AccountCosmetics shape:
// every field a deduped array of non-empty strings. The single source of truth
// for this shape, shared by the server (server/db.ts) and the client
// (src/net/online.ts) so the two can never drift as fields are added.
export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: uniqueStrings(src.completedQuestIds),
    mechChromaIds: uniqueStrings(src.mechChromaIds),
    ownedCreatorSkinIds: uniqueStrings(src.ownedCreatorSkinIds),
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
