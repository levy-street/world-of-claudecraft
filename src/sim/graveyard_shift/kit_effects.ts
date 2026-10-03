// The three Graveyard Shift kit effects no shared effect kind expresses, reached
// from combat/effect_dispatch.ts by one-line delegations: Gravecall's stacking
// barrow mark, Shadow Pulse's mark burst, and Raise the Fallen. Draws no rng.

import { summonUndead } from '../combat/necromancy';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity } from '../types';
import { dist2d } from '../types';
import { GRAVEYARD_SHIFT_ALLY_TEMPLATE } from './run_allies';

export const BARROW_MARK_AURA_ID = 'gshift_barrow_mark';
export const BARROW_MARK_NAME = 'Marked for the Barrow';

function markOf(target: Entity, casterId: number): Aura | undefined {
  return target.auras.find((a) => a.id === BARROW_MARK_AURA_ID && a.sourceId === casterId);
}

export function applyBarrowMark(
  ctx: SimContext,
  caster: Entity,
  target: Entity | null,
  maxStacks: number,
  duration: number,
): void {
  if (!target || target.dead || !ctx.isHostileTo(caster, target)) return;
  const mark = markOf(target, caster.id);
  if (mark) {
    mark.stacks = Math.min(maxStacks, (mark.stacks ?? 1) + 1);
    mark.remaining = duration;
    return;
  }
  target.auras.push({
    id: BARROW_MARK_AURA_ID,
    name: BARROW_MARK_NAME,
    kind: 'gshift_mark',
    remaining: duration,
    duration,
    stacks: 1,
    value: 0,
    sourceId: caster.id,
    school: 'shadow',
  });
  ctx.emit({ type: 'aura', targetId: target.id, name: BARROW_MARK_NAME, gained: true });
}

// Every marked enemy within the pulse takes the bonus per stack and loses its
// marks, before the pulse's own blast lands.
export function burstBarrowMarks(
  ctx: SimContext,
  caster: Entity,
  ability: AbilityDef,
  bonusPerStack: number,
  radius: number,
): void {
  for (const target of ctx.hostilesInRadius(caster, caster.pos, radius)) {
    const mark = markOf(target, caster.id);
    if (!mark) continue;
    target.auras.splice(target.auras.indexOf(mark), 1);
    ctx.emit({ type: 'aura', targetId: target.id, name: BARROW_MARK_NAME, gained: false });
    const bonus = Math.round(bonusPerStack * (mark.stacks ?? 1));
    if (bonus > 0 && !target.dead) {
      ctx.dealDamage(
        caster,
        target,
        bonus,
        false,
        ability.school,
        ability.name,
        'hit',
        false,
        undefined,
        true,
        false,
        false,
        ability.id,
        true,
      );
    }
  }
}

// The nearest corpse within reach that this run has not raised yet: a fallen
// adventurer, or an ownerless dead creature.
export function raisableCorpse(ctx: SimContext, caster: Entity, radius: number): Entity | null {
  const run = ctx.graveyardShiftRuns.get(caster.id);
  if (!run) return null;
  let best: Entity | null = null;
  let bestDist = radius;
  for (const e of ctx.entities.values()) {
    if (!e.dead || e.id === caster.id || run.raisedCorpseIds.has(e.id)) continue;
    if (e.kind !== 'player' && e.kind !== 'mob') continue;
    // Never an owned corpse (Morthen's own fallen skeletons would rise again and
    // again, each death feeding his Dread): adventurers and ownerless creatures.
    if (e.ownerId !== null) continue;
    const d = dist2d(e.pos, caster.pos);
    if (d < bestDist || (d === bestDist && best && e.id < best.id)) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

export function raiseTheFallen(
  ctx: SimContext,
  caster: Entity,
  radius: number,
  duration: number,
): void {
  const run = ctx.graveyardShiftRuns.get(caster.id);
  const corpse = raisableCorpse(ctx, caster, radius);
  if (!run || !corpse) return;
  run.raisedCorpseIds.add(corpse.id);
  const raised = summonUndead(
    ctx,
    caster,
    GRAVEYARD_SHIFT_ALLY_TEMPLATE,
    true,
    duration,
    { x: corpse.pos.x, z: corpse.pos.z },
    true,
  );
  if (!raised) return;
  raised.petMode = 'aggressive';
  run.allyIds.push(raised.id);
}

// The refusal castAbility shows before a Raise the Fallen with nothing to raise
// (dev-gated; re-localized by the client's error matcher).
export function graveyardShiftCastError(
  ctx: SimContext,
  caster: Entity,
  ability: AbilityDef,
): string | null {
  const raise = ability.effects.find((effect) => effect.type === 'gshiftRaiseFallen');
  if (!raise || raise.type !== 'gshiftRaiseFallen') return null;
  return raisableCorpse(ctx, caster, raise.radius) ? null : 'There is no corpse to raise.';
}
