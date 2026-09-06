// Rift Forge test placement (src/sim/rift/forge_gate.ts): both forge
// operations refuse away from a riftForge NPC, so every suite that forges
// stands the player at the Riftwright first. Mirrors the banker helpers in
// tests/bank.test.ts: resolve the LIVE entity (content coords run through the
// spawn placement), copy its pos, and rebucket so the grid scan sees the move.

import type { Sim } from '../../src/sim/sim';
import type { Entity } from '../../src/sim/types';

export const RIFT_FORGE_NPC_ID = 'riftwright_maelis';

export function riftForgeEntity(sim: Sim, templateId: string = RIFT_FORGE_NPC_ID): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === templateId) return e;
  }
  throw new Error(`rift forge NPC ${templateId} is not spawned in the world`);
}

/** Stand a player on the Riftwright and rebucket. Returns the NPC entity. */
export function moveToRiftForge(sim: Sim, pid: number = sim.playerId): Entity {
  const forge = riftForgeEntity(sim);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...forge.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return forge;
}

/** Place a player hundreds of yards from the Riftwright (2D reach only). */
export function moveFarFromRiftForge(sim: Sim, pid: number = sim.playerId): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { x: 500, y: p.pos.y, z: 500 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}
