import type { Entity } from '../sim/types';

export type EvilEyeMarkerKind = 'primary' | 'secondary';

export interface FateThreadMarkerState {
  stacks: number;
  remaining: number;
  duration: number;
}

export function fateThreadMarkerState(
  entity: Pick<Entity, 'dead' | 'auras'>,
  ownerId: number,
): FateThreadMarkerState | null {
  if (entity.dead) return null;
  const aura = entity.auras.find(
    (candidate) =>
      candidate.kind === 'affliction_fate_threads' &&
      candidate.sourceId === ownerId &&
      candidate.remaining > 0,
  );
  if (!aura) return null;
  return {
    stacks: Math.max(0, Math.min(3, aura.stacks ?? 0)),
    remaining: Math.max(0, aura.remaining),
    duration: Math.max(0.01, aura.duration),
  };
}

export function hasPossessedEvilEye(owner: Pick<Entity, 'dead' | 'auras'> | undefined): boolean {
  return (
    !!owner &&
    !owner.dead &&
    owner.auras.some((aura) => aura.kind === 'affliction_possession' && aura.remaining > 0)
  );
}

/** Replicated Affliction aura state that owns the overhead Evil Eye presentation. */
export function evilEyeMarkerKind(
  entity: Pick<Entity, 'dead' | 'auras'>,
  ownerId: number,
): EvilEyeMarkerKind | null {
  if (entity.dead) return null;
  if (entity.auras.some((aura) => aura.kind === 'affliction_eye' && aura.sourceId === ownerId)) {
    return 'primary';
  }
  if (
    entity.auras.some(
      (aura) => aura.kind === 'affliction_eye_secondary' && aura.sourceId === ownerId,
    )
  ) {
    return 'secondary';
  }
  return null;
}
