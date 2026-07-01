export const GATHERING_PROFESSION_IDS = ['mining', 'logging', 'herbalism'] as const;

export type GatheringProfessionId = (typeof GATHERING_PROFESSION_IDS)[number];

export interface GatheringProfessionDef {
  id: GatheringProfessionId;
}

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: { id: 'mining' },
  logging: { id: 'logging' },
  herbalism: { id: 'herbalism' },
};
