import type { Sim } from '../../src/sim/sim';
import { groundHeight } from '../../src/sim/world';

/** Flat, collider-free simulation test lane beyond authored overworld content. */
export const OPEN_FIELD = Object.freeze({ x: 0, z: -1000 });

export function placePlayerInOpenField(
  sim: Sim,
  pid = sim.playerId,
  offset: { x?: number; z?: number } = {},
): void {
  const player = sim.entities.get(pid);
  if (!player) throw new Error(`missing open-field player ${pid}`);
  const x = OPEN_FIELD.x + (offset.x ?? 0);
  const z = OPEN_FIELD.z + (offset.z ?? 0);
  player.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  player.prevPos = { ...player.pos };
  player.fallStartY = player.pos.y;
  player.onGround = true;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
}
