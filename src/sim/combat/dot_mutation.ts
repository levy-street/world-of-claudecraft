import type { Entity } from '../types';

/** Extend one caster-owned DoT application, honoring its per-application cap. */
export function extendOwnedDot(
  target: Entity,
  sourceId: number,
  dotId: string,
  seconds: number,
  maxBonus: number,
): number {
  const dot = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === dotId && aura.sourceId === sourceId,
  );
  if (!dot) return 0;
  const alreadyExtended = dot.extendedBy ?? 0;
  const extension = Math.min(seconds, maxBonus - alreadyExtended);
  if (extension <= 0) return 0;
  dot.extendedBy = alreadyExtended + extension;
  dot.remaining += extension;
  dot.duration += extension;
  return extension;
}
