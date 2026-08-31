// The worn-set wearer probe for bespoke class-module bends: the resolver
// (src/sim/set_bonus_mods.ts) registers setBonusFlag(setId, pieces) in
// mods.selected for every met tier, and call sites gate their bends on that
// flag exactly like a talent option id. This is the shared form of the check
// the earlier class waves inlined per module; the priest wave has three call
// sites, so it earns the module (rule of three).
// Draws no rng; `src/sim`-pure (tests/architecture.test.ts).

import { setBonusFlag } from '../content/ignivar_set_bonuses';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** True when `p` is a player whose worn equipment meets the given set tier. */
export function wearsSetBonus(ctx: SimContext, p: Entity, setId: string, pieces: number): boolean {
  if (p.kind !== 'player') return false;
  const meta = ctx.players.get(p.id);
  if (meta === undefined) return false;
  return ctx.playerMods(meta).selected[setBonusFlag(setId, pieces)] === true;
}
