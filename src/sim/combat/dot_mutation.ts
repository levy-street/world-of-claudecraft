import type { SimContext } from '../sim_context';
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

/** Refresh one caster-owned DoT without changing its snapshot or tick cadence. */
export function refreshOwnedDot(target: Entity, sourceId: number, dotId: string): number {
  const dot = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === dotId && aura.sourceId === sourceId,
  );
  if (!dot) return 0;
  dot.remaining = dot.duration;
  return dot.remaining;
}

/** Copy the current caster-owned DoT snapshot to nearby hostiles without RNG. */
export function spreadOwnedDot(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  dotId: string,
  radius: number,
): number {
  const dot = primary.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === dotId && aura.sourceId === source.id,
  );
  if (!dot) return 0;
  const targets = ctx
    .hostilesInRadius(source, primary.pos, radius)
    .filter((candidate) => candidate.id !== primary.id && ctx.hasLineOfSight(primary, candidate))
    .sort((a, b) => a.id - b.id);
  if (targets.length > 0) {
    ctx.emit({
      type: 'spellfxAt',
      x: primary.pos.x,
      z: primary.pos.z,
      school: dot.school,
      fx: 'burst',
      radius,
    });
  }
  for (const target of targets) {
    ctx.applyAura(target, { ...dot });
    ctx.enterCombat(source, target);
  }
  return targets.length;
}
