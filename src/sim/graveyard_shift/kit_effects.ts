// Raise the Fallen, the one Graveyard Shift kit effect no shared effect kind
// expresses, reached from combat/effect_dispatch.ts by a one-line delegation,
// and the cast refusal it needs. Draws no rng.

import { summonUndead } from '../combat/necromancy';
import type { SimContext } from '../sim_context';
import type { AbilityDef, Entity } from '../types';
import { dist2d } from '../types';
import { GRAVEYARD_SHIFT_ALLY_TEMPLATE } from './run_allies';

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
