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

function scheduledDotDamage(dot: Entity['auras'][number]): number {
  const interval = dot.tickInterval ?? 1;
  const untilNextTick = dot.tickTimer ?? interval;
  const ticksLeft =
    untilNextTick <= dot.remaining
      ? 1 + Math.max(0, Math.floor((dot.remaining - untilNextTick) / interval))
      : 0;
  return Math.round(dot.value * ticksLeft);
}

/** Remove one caster-owned DoT and return its scheduled damage without dealing it. */
export function consumeOwnedDot(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  dotId: string,
): number {
  const dotIndex = target.auras.findIndex(
    (aura) => aura.kind === 'dot' && aura.id === dotId && aura.sourceId === source.id,
  );
  if (dotIndex < 0) return 0;
  const dot = target.auras[dotIndex];
  const remainingDamage = scheduledDotDamage(dot);
  target.auras.splice(dotIndex, 1);
  ctx.emit({ type: 'aura', targetId: target.id, name: dot.name, gained: false });
  return remainingDamage;
}

/** Add damage to one rolling caster-owned DoT and reschedule it over a fresh window. */
export function rollOwnedDot(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  dot: {
    id: string;
    name: string;
    school: Entity['auras'][number]['school'];
    pctDamage: number;
    duration: number;
    interval: number;
  },
  landedDamage: number,
): number {
  if (landedDamage <= 0 || target.dead || target.hp <= 0) return 0;
  const contribution = Math.round(landedDamage * dot.pctDamage);
  if (contribution <= 0) return 0;
  const ticks = Math.max(1, Math.round(dot.duration / dot.interval));
  const existing = target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === dot.id && aura.sourceId === source.id,
  );
  if (existing) {
    const bankedDamage = scheduledDotDamage(existing) + contribution;
    existing.remaining = dot.duration;
    existing.duration = dot.duration;
    existing.value = Math.max(1, Math.round(bankedDamage / ticks));
    existing.tickInterval = dot.interval;
    existing.tickTimer = Math.min(existing.tickTimer ?? dot.interval, dot.interval);
    existing.damageModifiersResolved = true;
    return existing.value * ticks;
  }

  const value = Math.max(1, Math.round(contribution / ticks));
  ctx.applyAura(target, {
    id: dot.id,
    name: dot.name,
    kind: 'dot',
    remaining: dot.duration,
    duration: dot.duration,
    value,
    tickInterval: dot.interval,
    tickTimer: dot.interval,
    damageModifiersResolved: true,
    sourceId: source.id,
    school: dot.school,
  });
  return value * ticks;
}

/** Detonate the scheduled damage of one caster-owned DoT without re-entering proc hooks. */
export function detonateOwnedDot(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  dotId: string,
): number {
  if (target.dead || target.hp <= 0) return 0;
  const dotIndex = target.auras.findIndex(
    (aura) => aura.kind === 'dot' && aura.id === dotId && aura.sourceId === source.id,
  );
  if (dotIndex < 0) return 0;
  const dot = target.auras[dotIndex];
  const remainingDamage = scheduledDotDamage(dot);
  target.auras.splice(dotIndex, 1);
  ctx.emit({ type: 'aura', targetId: target.id, name: dot.name, gained: false });
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: dot.school,
    fx: 'detonate',
  });
  if (remainingDamage > 0) {
    ctx.dealDamage(
      source,
      target,
      remainingDamage,
      false,
      dot.school,
      dot.name,
      'hit',
      false,
      undefined,
      false,
      false,
      true,
      null,
      true,
    );
  }
  return remainingDamage;
}
