import {
  VANGUARD_SHADOW_2PC_SLOW_DURATION_SEC,
  VANGUARD_SHADOW_2PC_SLOW_MULT,
  VANGUARD_SHADOW_4PC_FREE_CHANCE,
} from '../../content/vanguard_set_bonuses_a';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { wearsSetBonus } from '../set_bonus_wearer';

/** Duskhymn Regalia (Warfare Season 2, Vespers PvP set) bespoke bends. The
 *  4pc Duskhymn Ward shield is a plain castNth proc in
 *  content/vanguard_set_bonuses_a.ts; the two pieces below need call sites. */
export const DUSKHYMN_SLOW_AURA_ID = 'vanguard_duskhymn_slow';
const LITANY_OF_WOE_ID = 'mind_flay';
const VOID_RUPTURE_ID = 'void_rupture';

/** 2pc: each landed Litany of Woe tick slows its target for a fixed window.
 *  One aura id, so every tick refreshes the same 30 percent slow and never
 *  stacks; movement already takes only the strongest slow. Draws no rng. */
export function duskhymnLitanyTick(
  ctx: SimContext,
  priest: Entity,
  abilityId: string,
  target: Entity,
): void {
  if (abilityId !== LITANY_OF_WOE_ID || target.dead) return;
  if (!wearsSetBonus(ctx, priest, 'vanguard_priest_shadow', 2)) return;
  ctx.applyAura(target, {
    id: DUSKHYMN_SLOW_AURA_ID,
    name: 'Litany of Woe',
    kind: 'slow',
    remaining: VANGUARD_SHADOW_2PC_SLOW_DURATION_SEC,
    duration: VANGUARD_SHADOW_2PC_SLOW_DURATION_SEC,
    value: VANGUARD_SHADOW_2PC_SLOW_MULT,
    sourceId: priest.id,
    school: 'shadow',
  });
}

/** 4pc: Void Rupture's chance to cost no Gloomtithe, rolled at cast commit.
 *  Wearer-gated before the draw, so no one else's rng stream moves. */
export function duskhymnRuptureCostsNothing(
  ctx: SimContext,
  priest: Entity,
  abilityId: string,
): boolean {
  if (abilityId !== VOID_RUPTURE_ID) return false;
  if (!wearsSetBonus(ctx, priest, 'vanguard_priest_shadow', 4)) return false;
  return ctx.rng.chance(VANGUARD_SHADOW_4PC_FREE_CHANCE);
}
