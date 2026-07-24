import { PROCEDURAL_BASE_IDS } from './bases';
import type { ProceduralBasePool } from './types';

export const PROCEDURAL_BASE_POOLS: Record<string, ProceduralBasePool> = {
  initial_all: {
    id: 'initial_all',
    baseIds: [...PROCEDURAL_BASE_IDS],
  },
  initial_world: {
    id: 'initial_world',
    baseIds: ['iron_broadsword', 'ashwood_staff', 'mirefen_leather_gloves', 'thornpeak_mail_chest'],
  },
  initial_rare: {
    id: 'initial_rare',
    baseIds: ['iron_broadsword', 'ashwood_staff', 'gravecaller_cloth_hood', 'gravecaller_ring'],
  },
  initial_dungeon_boss: {
    id: 'initial_dungeon_boss',
    baseIds: [...PROCEDURAL_BASE_IDS],
  },
};
