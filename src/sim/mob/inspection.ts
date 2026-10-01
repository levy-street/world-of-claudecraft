// Mob INSPECTION: the cold read behind the mob inspect window's live stat
// block (IWorldInteraction.mobInspectInfo). It reports what the authoritative
// sim actually stamped on this spawn (after any heroic, normal-retune or rift
// scaling rewrote the template), which a client cannot re-derive from static
// content. Everything else the window shows (family, rank, loot table) is
// static content the client already bundles.
//
// Disclosure-bounded like the corpse-harvest status read: only an UNOWNED mob
// (never a player, NPC or anyone's pet) that the viewer could already see,
// meaning the same owned world or instance (sameHarvestScope, the generic
// membership-plus-position scope check) and inside the interest drop edge an
// online client keeps entities through. Draws no rng and mutates nothing.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts).

import type { MobInspectInfo } from '../../world_api';
import { MOBS } from '../data';
import { sameHarvestScope } from '../professions/corpse_harvest_scope';
import type { SimContext } from '../sim_context';
import { dist2d, PLAYER_INTEREST_DROP_RADIUS } from '../types';

/** How far away a mob may be inspected: the interest drop edge, so a mob an
 *  online client still renders always answers and nothing past it ever does. */
export const MOB_INSPECT_RANGE = PLAYER_INTEREST_DROP_RADIUS;

export function mobInspectInfo(
  ctx: SimContext,
  mobId: number,
  pid?: number,
): MobInspectInfo | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const mob = ctx.entities.get(mobId);
  if (mob?.kind !== 'mob' || mob.ownerId !== null) return null;
  if (!sameHarvestScope(ctx, r.e.id, mob)) return null;
  // Positive sense, so a non-finite distance can never read as in range.
  if (!(dist2d(r.e.pos, mob.pos) <= MOB_INSPECT_RANGE)) return null;
  return {
    mobId: mob.id,
    templateId: mob.templateId,
    level: mob.level,
    maxHp: mob.maxHp,
    weaponMin: mob.weapon.min,
    weaponMax: mob.weapon.max,
    attackSpeed: mob.weapon.speed,
    armor: mob.stats.armor,
    // The same template-OR-entity rule Sim.applyAura gates control and slow
    // auras on: a promoted dungeon miniboss gains both flags at spawn
    // (instances/dungeon_spawn_miniboss.ts) while its template has neither.
    ccImmune: MOBS[mob.templateId]?.ccImmune === true || mob.ccImmune === true,
    slowImmune: MOBS[mob.templateId]?.slowImmune === true || mob.slowImmune === true,
  };
}
