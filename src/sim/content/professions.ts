import type { GatheringProfessionId } from '../types';

export const GATHERING_PROFESSION_IDS = ['mining', 'logging', 'herbalism'] as const;

export interface GatheringProfessionDef {
  id: GatheringProfessionId;
}

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: { id: 'mining' },
  logging: { id: 'logging' },
  herbalism: { id: 'herbalism' },
};
