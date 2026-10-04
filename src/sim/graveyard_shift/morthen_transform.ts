// Turning the run owner into Morthen and back. The real level and talent
// modifiers are parked on the run; the identity aura carries everything else
// (the stat profile through recalcPlayerStats, the kit through
// knownAbilitiesFor, the frozen action bar, the locks). Draws no rng.

import { abilitiesKnownAt, type KnownAbility } from '../content/classes';
import {
  emptyAllocation,
  emptyModifiers,
  type TalentAllocation,
  type TalentModifiers,
} from '../content/talents';
import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { morthenKitKnown } from './kit';
import {
  hasMorthenIdentity,
  MORTHEN_IDENTITY_AURA_ID,
  morthenIdentityAura,
} from './morthen_identity';
import { morthenLevel } from './morthen_profile';

export interface MorthenParked {
  readonly level: number;
  // Both halves of the build: modifier readers and allocation readers (the
  // hunter Beastguard check reads meta.talents directly) see nothing on shift.
  readonly talents: TalentAllocation;
  readonly talentMods: TalentModifiers;
}

// The one known-list rule (Sim.refreshKnownAbilities): Morthen knows only the
// kit, so the real class kit is uncastable for the whole run.
export function knownAbilitiesFor(meta: PlayerMeta, e: Entity): KnownAbility[] {
  if (hasMorthenIdentity(e)) return morthenKitKnown();
  return abilitiesKnownAt(meta.cls, e.level, meta.talentMods, meta.questsDone);
}

function recalc(ctx: SimContext, meta: PlayerMeta, e: Entity): void {
  recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

export function applyMorthenIdentity(ctx: SimContext, meta: PlayerMeta, e: Entity): MorthenParked {
  const parked: MorthenParked = {
    level: e.level,
    talents: meta.talents,
    talentMods: meta.talentMods,
  };
  e.level = morthenLevel();
  meta.talents = emptyAllocation();
  meta.talentMods = emptyModifiers();
  e.auras.push(morthenIdentityAura(e.id));
  recalc(ctx, meta, e);
  ctx.refreshKnownAbilities(meta, false);
  e.hp = e.maxHp;
  return parked;
}

// The reverse, run BEFORE the clean slate and pool restore of the teardown so
// the hp clamp sees the real maximum.
export function removeMorthenIdentity(
  ctx: SimContext,
  meta: PlayerMeta,
  e: Entity,
  parked: MorthenParked,
): void {
  const at = e.auras.findIndex((a) => a.id === MORTHEN_IDENTITY_AURA_ID);
  if (at >= 0) e.auras.splice(at, 1);
  e.level = parked.level;
  meta.talents = parked.talents;
  meta.talentMods = parked.talentMods;
  recalc(ctx, meta, e);
  ctx.refreshKnownAbilities(meta, false);
  // Deeds skipped the owner on shift; evaluate the real character again.
  ctx.markDeedsDirty(meta.entityId);
}
