// A Buried Hoard is scaled to its head count when it opens (vaultForPortal,
// treasure_vault.ts): the owner's party size at that moment. A player who joins
// the party AFTER the door opened may still walk in (mayEnterVaultPortal reads
// the party live), so without this module a lone reader could open the hoard at
// solo strength and then invite a full party into it.
//
// The rule: every time a player enters who had not entered before, the hoard is
// scaled UP to the number of distinct players who have entered (capped at five,
// never below the head count it opened with). Never down: a player who leaves or
// dies does not make the room easier. Every living rift mob in the room is
// scaled by the ratio of the new vault factors to the old ones, keeping its
// share of health, so what the room has already dealt is neither lost nor
// bought. The dead stay dead. Mobs born later (adds, a ritual's warriors) read
// the vault's live head count at birth, so they need nothing from here.
//
// Pure arithmetic, no rng: every host reaches the same numbers.

import { vaultDamageFactor, vaultHealthFactor } from '../content/treasure_maps';
import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { RiftInstance } from './types';

/** The most players a hoard is ever scaled for. */
export const VAULT_MAX_HEAD_COUNT = 5;

/** The head count a hoard should be scaled for now: the distinct players who have
 *  entered it, never below what it opened with, never above five. */
export function vaultHeadCountFor(opened: number, entered: number): number {
  return Math.max(1, Math.min(VAULT_MAX_HEAD_COUNT, Math.max(opened, entered)));
}

/** Scale one living mob from `from` heads to `to` heads, keeping its health share. */
export function rescaleVaultMob(mob: Entity, from: number, to: number): void {
  const hpRatio = vaultHealthFactor(to) / vaultHealthFactor(from);
  const dmgRatio = vaultDamageFactor(to) / vaultDamageFactor(from);
  const share = mob.maxHp > 0 ? mob.hp / mob.maxHp : 1;
  mob.maxHp = Math.max(1, Math.round(mob.maxHp * hpRatio));
  mob.hp = Math.max(1, Math.min(mob.maxHp, Math.round(mob.maxHp * share)));
  if (mob.damageFloorHp !== undefined) {
    mob.damageFloorHp = Math.ceil(mob.damageFloorHp * hpRatio);
  }
  mob.weapon = {
    ...mob.weapon,
    min: Math.round(mob.weapon.min * dmgRatio),
    max: Math.round(mob.weapon.max * dmgRatio),
  };
  if (mob.mechanicDamageMult !== undefined) mob.mechanicDamageMult *= dmgRatio;
  if (mob.mechanicHealMult !== undefined) mob.mechanicHealMult *= hpRatio;
}

/** Every living rift mob of the room: its roster and whatever those summoned.
 *  The hoard's own mechanic bodies (eggs, totems, tentacles, orbs, cocoons) are
 *  not rift mobs and keep their authored pools. */
function livingRoomMobs(ctx: SimContext, inst: RiftInstance): Entity[] {
  const seen = new Set<number>();
  const out: Entity[] = [];
  const visit = (id: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const mob = ctx.entities.get(id);
    if (!mob || mob.kind !== 'mob') return;
    for (const child of mob.summonedIds ?? []) visit(child);
    if (mob.dead || mob.hp <= 0) return;
    const template = MOBS[mob.templateId];
    if (!template || mob.templateId.startsWith('hoard_')) return;
    out.push(mob);
  };
  for (const id of inst.mobIds) visit(id);
  if (inst.bossId !== null) visit(inst.bossId);
  return out;
}

/** Scale the hoard up to the players who have entered it. Returns the new head
 *  count when it changed, else null. */
export function rescaleVaultForEntrants(ctx: SimContext, inst: RiftInstance): number | null {
  const vault = inst.vault;
  if (!vault) return null;
  const from = vault.headCount;
  const to = vaultHeadCountFor(from, inst.memberIds.size);
  if (to <= from) return null;
  for (const mob of livingRoomMobs(ctx, inst)) rescaleVaultMob(mob, from, to);
  vault.headCount = to;
  return to;
}
