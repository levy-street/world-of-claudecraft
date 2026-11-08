import { BUILTIN_WORLD } from '../../src/sim/data';
import type { RoutePoint } from './quest_map';

export type SystemStep = 'Start' | number | 'Reward';

export interface SystemRoute {
  points: RoutePoint[];
  notes?: string[];
  flow?: string[];
}

export function worldPin(
  step: SystemStep,
  x: number,
  z: number,
  label: string,
  radius?: number,
): RoutePoint {
  return { step, frame: 'Overworld', x, z, label, radius };
}

export function npcPin(step: SystemStep, id: string, label?: string): RoutePoint {
  const npc = BUILTIN_WORLD.npcs[id];
  if (!npc) throw new Error('Unknown system route NPC: ' + id);
  return worldPin(step, npc.pos.x, npc.pos.z, label ? npc.name + ' · ' + label : npc.name);
}
