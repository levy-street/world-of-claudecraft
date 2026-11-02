import type { EditorEntity } from './model';
import type { Vec2 } from './view';

interface RuntimeMapEntity {
  kind: string;
  templateId: string;
  pos: { x: number; y: number; z: number };
  prevPos: { x: number; y: number; z: number };
  spawnPos: { x: number; y: number; z: number };
  leashAnchor: { x: number; y: number; z: number } | null;
  wanderTarget: { x: number; y: number; z: number } | null;
}

interface RuntimeCamp {
  mobId: string;
  radius: number;
}

interface RuntimeCampMatch extends RuntimeCamp {
  center: Vec2;
  count: number;
  // A camp's authored spots (CampDef.spots): a pinned mob spawns on its spot,
  // which may sit outside the camp's radius.
  spots?: readonly Vec2[];
}

interface RuntimeMobMatch {
  templateId: string;
  pos: Vec2;
  spawnPos: Vec2;
}

/**
 * Match a rendered mob back to authored data. Group camps own spawn points;
 * exported one-mob camps own the mob's visible, individually edited position.
 */
export function findRuntimeCampIndex(
  camps: readonly RuntimeCampMatch[],
  mob: RuntimeMobMatch,
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < camps.length; i++) {
    const camp = camps[i];
    if (camp.mobId !== mob.templateId) continue;
    const spawnDistance = Math.hypot(
      mob.spawnPos.x - camp.center.x,
      mob.spawnPos.z - camp.center.z,
    );
    const visibleDistance = Math.hypot(mob.pos.x - camp.center.x, mob.pos.z - camp.center.z);
    const distance = camp.count === 1 ? Math.min(spawnDistance, visibleDistance) : spawnDistance;
    const owns = distance <= camp.radius + 1 || campHoldsSpawn(camp, mob.spawnPos);
    if (owns && distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

interface RuntimeMobEntity extends RuntimeMapEntity {
  id: number;
  ownerId: number | null;
}

interface RuntimeFacingEntity {
  kind: string;
  templateId: string;
  facing: number;
  prevFacing: number;
}

/** Rotate one authored NPC in the running editor Sim without reloading it. */
export function setRuntimeNpcFacing(
  entities: Iterable<RuntimeFacingEntity>,
  key: string,
  facing: number,
): number {
  if (!key.startsWith('npc:')) return 0;
  const npcId = key.slice('npc:'.length);
  let rotated = 0;
  for (const entity of entities) {
    if (entity.kind !== 'npc' || entity.templateId !== npcId) continue;
    entity.facing = facing;
    entity.prevFacing = facing;
    rotated++;
  }
  return rotated;
}

export function splitCampIntoIndividuals<T extends RuntimeCamp & { center: Vec2; count: number }>(
  camp: T,
  positions: readonly Vec2[],
): T[] {
  // The positions are the mobs that actually spawned, so a retired slot has
  // none; each one-mob camp stands at its own position, never inheriting the
  // group's pinned spots or retired slots (spots[0] would pin every one to
  // the same point, and a retired slot would erase it).
  const {
    spots: _spots,
    retiredSlots: _retired,
    ...rest
  } = camp as T & {
    spots?: unknown;
    retiredSlots?: unknown;
  };
  return positions.slice(0, camp.count).map(
    (position) =>
      ({
        ...rest,
        center: { x: position.x, z: position.z },
        radius: 0.5,
        count: 1,
      }) as unknown as T,
  );
}

/** True when a spawn point belongs to the camp: inside its scatter disc, or on
 *  one of its pinned spots (CampDef.spots), which can sit outside the disc. */
export function campHoldsSpawn(
  camp: { center: Vec2; radius: number; spots?: readonly Vec2[] },
  spawn: Vec2,
): boolean {
  if (Math.hypot(spawn.x - camp.center.x, spawn.z - camp.center.z) <= camp.radius + 1) return true;
  return (camp.spots ?? []).some((s) => Math.hypot(spawn.x - s.x, spawn.z - s.z) <= 0.75);
}

/** Move a camp's center, carrying its pinned spots by the same offset so the
 *  camp moves as one group. */
export function setCampCenter(
  camp: { center: Vec2; spots?: readonly Vec2[] },
  x: number,
  z: number,
): void {
  const dx = x - camp.center.x;
  const dz = z - camp.center.z;
  if (camp.spots && (dx !== 0 || dz !== 0)) {
    camp.spots = camp.spots.map((s) => ({ x: s.x + dx, z: s.z + dz }));
  }
  camp.center.x = x;
  camp.center.z = z;
}

export function toggledMobSelection(
  current: ReadonlySet<number>,
  id: number,
  additive: boolean,
): Set<number> {
  // Pressing an already-selected member preserves the group so dragging that
  // member moves the whole selection. Pressing an unselected mob starts over.
  if (!additive) return current.has(id) ? new Set(current) : new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function isMovableEntity(entity: EditorEntity): boolean {
  return entity.kind === 'npc' || entity.kind === 'camp';
}

/** Pick the closest NPC or mob-camp authoring handle around a world point. */
export function pickMovableEntity(
  entities: readonly EditorEntity[],
  point: Vec2,
): EditorEntity | null {
  let best: EditorEntity | null = null;
  let bestDistance = Infinity;
  for (const entity of entities) {
    if (!isMovableEntity(entity)) continue;
    const distance = Math.hypot(entity.point.x - point.x, entity.point.z - point.z);
    const pickRadius = entity.kind === 'camp' ? Math.max(4, entity.radius) : 4;
    if (distance <= pickRadius && distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

function translated(
  point: { x: number; y: number; z: number },
  dx: number,
  dz: number,
  groundY: (x: number, z: number) => number,
): { x: number; y: number; z: number } {
  const x = point.x + dx;
  const z = point.z + dz;
  return { x, y: groundY(x, z), z };
}

/** Translate every explicitly selected wild mob by the same world delta. */
export function moveRuntimeMobsById(
  entities: Iterable<RuntimeMobEntity>,
  ids: ReadonlySet<number>,
  dx: number,
  dz: number,
  groundY: (x: number, z: number) => number,
): number {
  let moved = 0;
  for (const entity of entities) {
    if (!ids.has(entity.id) || entity.kind !== 'mob' || entity.ownerId !== null) continue;
    Object.assign(entity.pos, translated(entity.pos, dx, dz, groundY));
    Object.assign(entity.prevPos, entity.pos);
    Object.assign(entity.spawnPos, translated(entity.spawnPos, dx, dz, groundY));
    if (entity.leashAnchor) {
      Object.assign(entity.leashAnchor, translated(entity.leashAnchor, dx, dz, groundY));
    }
    if (entity.wanderTarget) {
      Object.assign(entity.wanderTarget, translated(entity.wanderTarget, dx, dz, groundY));
    }
    moved++;
  }
  return moved;
}

/**
 * Move the already-running editor Sim entities that correspond to an authored
 * NPC or camp. This keeps a drag live without tearing down the renderer.
 */
export function moveRuntimeMapEntity(
  entities: Iterable<RuntimeMapEntity>,
  key: string,
  camps: readonly RuntimeCamp[],
  from: Vec2,
  to: Vec2,
  groundY: (x: number, z: number) => number,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let moved = 0;
  if (key.startsWith('npc:')) {
    const npcId = key.slice('npc:'.length);
    for (const entity of entities) {
      if (entity.kind !== 'npc' || entity.templateId !== npcId) continue;
      const next = { x: to.x, y: groundY(to.x, to.z), z: to.z };
      Object.assign(entity.pos, next);
      Object.assign(entity.prevPos, next);
      Object.assign(entity.spawnPos, next);
      moved++;
    }
    return moved;
  }
  if (!key.startsWith('camp:')) return 0;
  const index = Number.parseInt(key.slice('camp:'.length), 10);
  const camp = Number.isInteger(index) ? camps[index] : undefined;
  if (!camp) return 0;
  const membershipRadius = camp.radius + 12;
  for (const entity of entities) {
    if (entity.kind !== 'mob' || entity.templateId !== camp.mobId) continue;
    if (Math.hypot(entity.spawnPos.x - from.x, entity.spawnPos.z - from.z) > membershipRadius) {
      continue;
    }
    const next = translated(entity.pos, dx, dz, groundY);
    const spawn = translated(entity.spawnPos, dx, dz, groundY);
    Object.assign(entity.pos, next);
    Object.assign(entity.prevPos, next);
    Object.assign(entity.spawnPos, spawn);
    if (entity.leashAnchor) {
      Object.assign(entity.leashAnchor, translated(entity.leashAnchor, dx, dz, groundY));
    }
    if (entity.wanderTarget) {
      Object.assign(entity.wanderTarget, translated(entity.wanderTarget, dx, dz, groundY));
    }
    moved++;
  }
  return moved;
}
