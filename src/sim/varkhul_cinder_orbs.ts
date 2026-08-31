// Deterministic, reconnect-safe projection for Varkhul's Cinder Orbs.
// Marked players leave permanent ground fire and emit radial projectiles. The
// encounter owns movement, collision, and damage; this leaf owns the shared
// state and world projection used by offline, server, and online hosts.

import type { DungeonDifficulty } from './types';

export const VARKHUL_CINDER_ORBS_TARGETS = 3;
export const VARKHUL_CINDER_ORBS_MARK_SECONDS = 4;
export const VARKHUL_CINDER_FIRE_RADIUS = 3.5;
export const VARKHUL_CINDER_FIRE_TICK_SECONDS = 1;
export const VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP = 0.12;
export const VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP_HEROIC = 0.25;
// Twenty full three-player releases is beyond the intended encounter envelope.
// The cap keeps permanent snapshot work bounded if a raid deliberately stalls.
export const VARKHUL_CINDER_FIRE_MAX_FIELDS = 60;
export const VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET = 6;
export const VARKHUL_CINDER_ORB_SPEED = 9;
export const VARKHUL_CINDER_ORB_DURATION = 5.5;
export const VARKHUL_CINDER_ORB_HIT_RADIUS = 1.1;
export const VARKHUL_CINDER_ORB_DAMAGE_MAX_HP = 0.35;
export const VARKHUL_CINDER_ORB_DAMAGE_MAX_HP_HEROIC = 0.55;
export const VARKHUL_RED_HOT_METAL_DURATION = 10;
export const VARKHUL_RED_HOT_METAL_TICK_SECONDS = 2;
export const VARKHUL_RED_HOT_METAL_DAMAGE_MAX_HP = 0.04;
export const VARKHUL_RED_HOT_METAL_HEAL_ABSORB_MAX_HP = 0.3;

export function varkhulCinderFireDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP_HEROIC
    : VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP;
}

export function varkhulCinderOrbDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_CINDER_ORB_DAMAGE_MAX_HP_HEROIC
    : VARKHUL_CINDER_ORB_DAMAGE_MAX_HP;
}

export function varkhulCinderFireCanSpawn(existingFields: number): boolean {
  return Number.isFinite(existingFields) && existingFields < VARKHUL_CINDER_FIRE_MAX_FIELDS;
}

export interface VarkhulCinderFireState {
  id: string;
  pos: { x: number; y: number; z: number };
  tickTimer: number;
}

export interface VarkhulCinderOrbProjectileState {
  id: string;
  ownerId: number;
  pos: { x: number; y: number; z: number };
  dir: { x: number; z: number };
  remaining: number;
  hitPlayerIds: number[];
  radius?: number;
  duration?: number;
  speed?: number;
  damageMaxHp?: number;
  ability?: string;
}

export interface VarkhulCinderProjectionState {
  cinderFires: readonly VarkhulCinderFireState[];
  cinderOrbProjectiles: readonly VarkhulCinderOrbProjectileState[];
}

export interface ActiveVarkhulCinderFire {
  id: string;
  sourceId: number;
  x: number;
  z: number;
  radius: number;
}

export interface ActiveVarkhulCinderOrbProjectile {
  id: string;
  sourceId: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  duration: number;
  remaining: number;
}

export function varkhulCinderFireId(bossId: number, castKey: number, targetIndex: number): string {
  return `${bossId}:cinder-fire:${castKey}:${targetIndex}`;
}

export function varkhulCinderOrbProjectileId(
  bossId: number,
  castKey: number,
  targetIndex: number,
  projectileIndex: number,
): string {
  return `${bossId}:cinder-orbs:${castKey}:${targetIndex}:${projectileIndex}`;
}

export function activeVarkhulCinderFires(
  bossId: number,
  state: Pick<VarkhulCinderProjectionState, 'cinderFires'>,
): ActiveVarkhulCinderFire[] {
  return state.cinderFires.map((fire) => ({
    id: fire.id,
    sourceId: bossId,
    x: fire.pos.x,
    z: fire.pos.z,
    radius: VARKHUL_CINDER_FIRE_RADIUS,
  }));
}

export function activeVarkhulCinderOrbProjectiles(
  bossId: number,
  state: Pick<VarkhulCinderProjectionState, 'cinderOrbProjectiles'>,
): ActiveVarkhulCinderOrbProjectile[] {
  return state.cinderOrbProjectiles.flatMap((projectile): ActiveVarkhulCinderOrbProjectile[] => {
    if (projectile.remaining <= 0) return [];
    return [
      {
        id: projectile.id,
        sourceId: bossId,
        x: projectile.pos.x,
        z: projectile.pos.z,
        dirX: projectile.dir.x,
        dirZ: projectile.dir.z,
        radius: projectile.radius ?? VARKHUL_CINDER_ORB_HIT_RADIUS,
        duration: projectile.duration ?? VARKHUL_CINDER_ORB_DURATION,
        remaining: Math.min(
          projectile.remaining,
          projectile.duration ?? VARKHUL_CINDER_ORB_DURATION,
        ),
      },
    ];
  });
}
