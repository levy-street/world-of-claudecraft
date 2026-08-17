import type { Entity } from '../sim/types';

export interface AfflictionFamiliarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

type FamiliarOwner = Pick<Entity, 'id' | 'kind' | 'templateId' | 'dead' | 'auras'>;

export const AFFLICTION_FAMILIAR_LOCAL_X = -1.05;
export const AFFLICTION_FAMILIAR_LOCAL_Z = 0.15;

const BASE_X = AFFLICTION_FAMILIAR_LOCAL_X;
const BASE_Y = 1.72;
const BASE_Z = AFFLICTION_FAMILIAR_LOCAL_Z;

/** The client only owns a trustworthy specialization value for its local player. */
export function shouldShowAfflictionFamiliar(
  entity: FamiliarOwner,
  localPlayerId: number,
  talentSpec: string | null,
): boolean {
  return (
    entity.id === localPlayerId &&
    entity.kind === 'player' &&
    entity.templateId === 'warlock' &&
    !entity.dead &&
    talentSpec === 'affliction'
  );
}

export function isAfflictionFamiliarPossessed(entity: Pick<Entity, 'auras'>): boolean {
  return entity.auras.some((aura) => aura.kind === 'affliction_possession' && aura.remaining > 0);
}

/** Turns a player-local +Z-facing companion toward a world-space target. */
export function afflictionFamiliarLookYaw(
  ownerX: number,
  ownerZ: number,
  ownerYaw: number,
  targetX: number,
  targetZ: number,
): number {
  let yaw = Math.atan2(targetX - ownerX, targetZ - ownerZ) - ownerYaw;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  return yaw;
}

/**
 * Writes the familiar's restrained hover pose into caller-owned storage.
 * Its phase comes from the stable entity id, so the result is deterministic
 * and no random draw or per-frame object allocation enters the render loop.
 */
export function writeAfflictionFamiliarPose(
  out: AfflictionFamiliarPose,
  timeSeconds: number,
  entityId: number,
  reducedMotion: boolean,
): AfflictionFamiliarPose {
  if (reducedMotion) {
    out.x = BASE_X;
    out.y = BASE_Y;
    out.z = BASE_Z;
    out.yaw = 0;
    out.pitch = 0;
    out.roll = 0;
    return out;
  }

  const phase = (Math.abs(entityId) % 17) * 0.37;
  const hover = timeSeconds * 2.15 + phase;
  const glance = timeSeconds * 0.78 + phase * 0.61;
  out.x = BASE_X + Math.sin(hover * 0.71) * 0.08;
  out.y = BASE_Y + Math.sin(hover) * 0.08;
  out.z = BASE_Z + Math.cos(hover * 0.63) * 0.07;
  out.yaw = Math.sin(glance) * 0.16;
  out.pitch = Math.sin(hover * 0.52) * 0.045;
  out.roll = Math.cos(hover * 0.81) * 0.065;
  return out;
}
