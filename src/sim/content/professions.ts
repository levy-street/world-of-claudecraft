export type GatheringProfessionId = 'mining' | 'logging' | 'herbalism';

export type ProductionCraftId =
  | 'weaponcrafting'
  | 'armorcrafting'
  | 'engineering'
  | 'alchemy'
  | 'cooking'
  | 'leatherworking'
  | 'tailoring'
  | 'inscription'
  | 'enchanting'
  | 'jewelcrafting';

export type ProductionCraftPole = 'material' | 'experimental' | 'formal' | 'cross_cutting';

export interface GatheringProfessionDef {
  readonly id: GatheringProfessionId;
  readonly name: string;
}

export interface ProductionCraftDef {
  readonly id: ProductionCraftId;
  readonly name: string;
  readonly pole: ProductionCraftPole;
}

export const GATHERING_PROFESSION_ORDER = ['mining', 'logging', 'herbalism'] as const;

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: { id: 'mining', name: 'Mining' },
  logging: { id: 'logging', name: 'Logging' },
  herbalism: { id: 'herbalism', name: 'Herbalism' },
};

export const PRODUCTION_CRAFT_RING = [
  'weaponcrafting',
  'armorcrafting',
  'engineering',
  'alchemy',
  'cooking',
  'leatherworking',
  'tailoring',
  'inscription',
  'enchanting',
  'jewelcrafting',
] as const;

export const PRODUCTION_CRAFTS: Record<ProductionCraftId, ProductionCraftDef> = {
  weaponcrafting: { id: 'weaponcrafting', name: 'Weaponcrafting', pole: 'material' },
  armorcrafting: { id: 'armorcrafting', name: 'Armorcrafting', pole: 'material' },
  engineering: { id: 'engineering', name: 'Engineering', pole: 'experimental' },
  alchemy: { id: 'alchemy', name: 'Alchemy', pole: 'experimental' },
  cooking: { id: 'cooking', name: 'Cooking', pole: 'cross_cutting' },
  leatherworking: { id: 'leatherworking', name: 'Leatherworking', pole: 'material' },
  tailoring: { id: 'tailoring', name: 'Tailoring', pole: 'material' },
  inscription: { id: 'inscription', name: 'Inscription', pole: 'formal' },
  enchanting: { id: 'enchanting', name: 'Enchanting', pole: 'formal' },
  jewelcrafting: { id: 'jewelcrafting', name: 'Jewelcrafting', pole: 'formal' },
};

function craftRingIndex(craft: ProductionCraftId): number {
  const index = PRODUCTION_CRAFT_RING.indexOf(craft);
  if (index < 0) throw new Error(`Unknown production craft: ${craft}`);
  return index;
}

function craftAtRingOffset(craft: ProductionCraftId, offset: number): ProductionCraftId {
  const index = craftRingIndex(craft);
  const next =
    PRODUCTION_CRAFT_RING[
      (index + offset + PRODUCTION_CRAFT_RING.length) % PRODUCTION_CRAFT_RING.length
    ];
  if (!next) throw new Error(`Invalid production craft ring offset: ${craft}, ${offset}`);
  return next;
}

export function adjacentProductionCrafts(
  craft: ProductionCraftId,
): readonly [ProductionCraftId, ProductionCraftId] {
  return [craftAtRingOffset(craft, -1), craftAtRingOffset(craft, 1)];
}

export function oppositeProductionCraft(craft: ProductionCraftId): ProductionCraftId {
  return craftAtRingOffset(craft, PRODUCTION_CRAFT_RING.length / 2);
}

export function areAdjacentProductionCrafts(a: ProductionCraftId, b: ProductionCraftId): boolean {
  return adjacentProductionCrafts(a).includes(b);
}
