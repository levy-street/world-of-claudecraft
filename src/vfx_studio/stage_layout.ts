import { BG_BAND_X_MAX } from '../sim/data';
import type { Sim } from '../sim/sim';

// Beyond the authored instance bands: canonical groundHeight/colliders provide
// a flat empty floor here. The studio never substitutes its own combat physics.
export const STUDIO_ORIGIN = { x: BG_BAND_X_MAX + 2048, z: 0 } as const;

export function arrangeStudioActors(sim: Sim, ids: readonly number[]): void {
  const player = sim.player;
  let ally = 0;
  for (const id of ids) {
    const e = sim.entities.get(id);
    if (!e) continue;
    const self = id === player.id;
    const enemy = e.kind !== 'player' || (ids.length === 2 && !self);
    const x = self || enemy ? 0 : (ally - 2) * 2.7;
    const z = self ? 0 : enemy ? 6 : 9 + Math.abs(ally - 2) * 0.45;
    if (!self && !enemy) ally++;
    e.pos = sim.groundPos(STUDIO_ORIGIN.x + x, STUDIO_ORIGIN.z + z);
    e.prevPos = { ...e.pos };
    e.spawnPos = { ...e.pos };
    sim.rebucket(e);
  }
}
