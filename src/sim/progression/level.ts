// Host-driven level jump, shared by development and moderation callers.

import { recalcPlayerStats } from '../entity';
import { perfectMembershipArmour } from '../membership_armour_progression';
import { computeCharacterModifiers } from '../set_bonus_mods';
import type { SimContext } from '../sim_context';
import { MAX_LEVEL, xpToReachLevel } from '../types';

export function setPlayerLevel(ctx: SimContext, level: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  r.e.level = Math.max(1, Math.min(MAX_LEVEL, level));
  // Keep lifetimeXp consistent with the level so post-cap progression starts
  // from a sane baseline (virtualLevel never falls below the real level). Only
  // ever raises it; lifetimeXp is monotonic.
  r.meta.lifetimeXp = Math.max(r.meta.lifetimeXp, xpToReachLevel(r.e.level));
  // Re-bake the flat talent mods at the new level before the stat + ability pass:
  // spec mastery magnitudes scale with level (min(1, level/20)), so a dev/GM level
  // jump must strengthen (or weaken) the mastery, exactly like the live ding path
  // (combat/damage.ts grantXp). Without this a level-jumped character keeps the
  // mastery baked at the OLD level.
  const m = r.meta;
  m.talentMods = computeCharacterModifiers(m.cls, m.talents, r.e.level, m.equipment);
  perfectMembershipArmour(r.meta, r.e.level);
  recalcPlayerStats(
    r.e,
    r.meta.cls,
    r.meta.equipment,
    ctx.playerMods(r.meta),
    r.meta.equipmentInstance,
  );
  r.e.hp = r.e.maxHp;
  if (r.e.resourceType === 'mana') r.e.resource = r.e.maxResource;
  ctx.refreshKnownAbilities(r.meta, false);
  ctx.syncPetLevel(r.e);
  ctx.markDeedsDirty(r.meta.entityId); // level/lifetimeXp predicates re-check
}
