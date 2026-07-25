import { PROCEDURAL_BASE_IDS } from './bases';
import type { ProceduralBasePool } from './types';

function fullPool(id: string): ProceduralBasePool {
  return { id, baseIds: [...PROCEDURAL_BASE_IDS] };
}

export const PROCEDURAL_BASE_POOLS: Record<string, ProceduralBasePool> = {
  initial_all: fullPool('initial_all'),
  initial_world: fullPool('initial_world'),
  initial_rare: fullPool('initial_rare'),
  initial_dungeon_boss: fullPool('initial_dungeon_boss'),
};
