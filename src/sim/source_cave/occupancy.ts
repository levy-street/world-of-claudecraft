// Source Cave occupancy and centre-seal geometry. One authoritative spatial
// rule feeds clear credit, instance lifetime, reboot confirmation, encounter
// breach detection, and the render-facing seal population projection.

import { DELVE_SLOT_SPACING, delveModuleStackEndRelZ, delveModuleZOffset } from '../data';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { sourceCaveOrigin } from './runtime';

const SOURCE_CAVE_OCCUPANCY_SOUTH = 70;
const SOURCE_CAVE_OCCUPANCY_X = 120;
const SOURCE_CAVE_OCCUPANCY_NORTH_MAX = DELVE_SLOT_SPACING - SOURCE_CAVE_OCCUPANCY_SOUTH;

/** Gameplay radius of the visibly distinct centre seal. */
export const SOURCE_CAVE_SEAL_RADIUS = 10;

/** Stable world-space centre of one claimed cave arena. */
export function sourceCaveSealCenter(
  ctx: SimContext,
  inst: InstanceSlot,
): { x: number; z: number } | null {
  const cave = ctx.sourceCave;
  if (!cave) return null;
  const origin = sourceCaveOrigin(inst.slot);
  return {
    x: origin.x + cave.spec.chestPos.x,
    z: origin.z + delveModuleZOffset(cave.spec.modules, 0) + cave.spec.chestPos.z,
  };
}

/** Is this world position inside this cave copy's occupancy box? */
export function posInSourceCaveInstance(
  ctx: SimContext,
  inst: InstanceSlot,
  pos: { x: number; z: number },
): boolean {
  const cave = ctx.sourceCave;
  if (!cave) return false;
  const origin = sourceCaveOrigin(inst.slot);
  const north = Math.min(
    delveModuleStackEndRelZ(cave.spec.modules),
    SOURCE_CAVE_OCCUPANCY_NORTH_MAX,
  );
  const dz = pos.z - origin.z;
  return (
    Math.abs(pos.x - origin.x) < SOURCE_CAVE_OCCUPANCY_X &&
    dz > -SOURCE_CAVE_OCCUPANCY_SOUTH &&
    dz < north
  );
}

/** Players physically inside this cave copy, sorted for deterministic targeting. */
export function playersInSourceCaveInstance(ctx: SimContext, inst: InstanceSlot): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const entity = ctx.entities.get(meta.entityId);
    if (entity && posInSourceCaveInstance(ctx, inst, entity.pos)) out.push(meta);
  }
  out.sort((a, b) => a.entityId - b.entityId);
  return out;
}

/** Claimed cave copy containing a player, independent of mutable party membership. */
export function sourceCaveInstanceForPlayer(
  ctx: SimContext,
  playerEntityId: number,
): InstanceSlot | null {
  for (const inst of ctx.instances) {
    if (inst.dungeonId !== 'source_cave' || inst.partyKey === null) continue;
    if (playersInSourceCaveInstance(ctx, inst).some((meta) => meta.entityId === playerEntityId)) {
      return inst;
    }
  }
  return null;
}

/** Living-player population of the seal, used by both encounter logic and wire. */
export function sourceCaveSealPopulation(
  ctx: SimContext,
  inst: InstanceSlot,
): { inside: number; eligible: number } {
  const centre = sourceCaveSealCenter(ctx, inst);
  if (!centre) return { inside: 0, eligible: 0 };
  let inside = 0;
  let eligible = 0;
  const radiusSq = SOURCE_CAVE_SEAL_RADIUS * SOURCE_CAVE_SEAL_RADIUS;
  for (const meta of playersInSourceCaveInstance(ctx, inst)) {
    const entity = ctx.entities.get(meta.entityId);
    if (!entity || entity.dead) continue;
    eligible++;
    const dx = entity.pos.x - centre.x;
    const dz = entity.pos.z - centre.z;
    if (dx * dx + dz * dz <= radiusSq) inside++;
  }
  return { inside, eligible };
}
