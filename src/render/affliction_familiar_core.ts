import type { Entity } from '../sim/types';

export interface AfflictionFamiliarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

type FamiliarOwner = Pick<Entity, 'id' | 'kind' | 'templateId' | 'dead' | 'auras' | 'specId'>;

export const AFFLICTION_FAMILIAR_LOCAL_X = -1.05;
export const AFFLICTION_FAMILIAR_LOCAL_Z = 0.15;
/** Where the eye hovers, as a fraction of its owner's model height: head
 *  height. Maledict Gaze's ray starts from the same point (drain_life_vfx.ts). */
export const AFFLICTION_FAMILIAR_HEIGHT_FRAC = 0.9;
/** How far above its owner's head bone the eye hovers (rig units), measured so
 *  a standing WOC body keeps the head-height spot it had (head bone 2.46). */
export const AFFLICTION_FAMILIAR_HEAD_LIFT = 0.11;

const HEAD_BONE_NAME = /^(mixamorig:?)?head$/i;

/** Whether a rig node is the head bone the eye follows. */
export function isAfflictionFamiliarHeadBone(node: { name: string; type?: string }): boolean {
  return HEAD_BONE_NAME.test(node.name);
}

const BASE_X = AFFLICTION_FAMILIAR_LOCAL_X;
const BASE_Y = 1.72;
const BASE_Z = AFFLICTION_FAMILIAR_LOCAL_Z;

/** Whether a local player of this class can ever show the familiar: a warlock of
 *  any spec, since a talent switch into Affliction can come mid-session. */
export function afflictionFamiliarClass(localClass: string): boolean {
  return localClass === 'warlock';
}

/** Every living Affliction warlock shows the eye, so other players see it too.
 *  The local player reads its own live talent spec; anyone else reads the spec
 *  their identity wire replicates (Entity.specId, the mouseover tooltip's). */
export function shouldShowAfflictionFamiliar(
  entity: FamiliarOwner,
  localPlayerId: number,
  localTalentSpec: string | null,
): boolean {
  const spec = entity.id === localPlayerId ? localTalentSpec : (entity.specId ?? null);
  return (
    entity.kind === 'player' &&
    afflictionFamiliarClass(entity.templateId) &&
    !entity.dead &&
    spec === 'affliction'
  );
}

/** The eye's hover height in its owner's local (unscaled) space: head height
 *  when the view knows its model height, the authored fallback otherwise. */
export function afflictionFamiliarHoverY(viewHeight: number | undefined): number {
  return viewHeight !== undefined && viewHeight > 0
    ? viewHeight * AFFLICTION_FAMILIAR_HEIGHT_FRAC
    : BASE_Y;
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
  baseY = BASE_Y,
): AfflictionFamiliarPose {
  if (reducedMotion) {
    out.x = BASE_X;
    out.y = baseY;
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
  out.y = baseY + Math.sin(hover) * 0.08;
  out.z = BASE_Z + Math.cos(hover * 0.63) * 0.07;
  out.yaw = Math.sin(glance) * 0.16;
  out.pitch = Math.sin(hover * 0.52) * 0.045;
  out.roll = Math.cos(hover * 0.81) * 0.065;
  return out;
}
