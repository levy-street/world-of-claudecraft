// The per-boss raid lockout (the owner's ruling of 2026-11-28, the Smith's
// Heart): each encounter of a raid listed in PER_BOSS_LOCKOUT_RAIDS
// (raid_boss_lockout_id.ts) saves the character to that boss on that
// difficulty until the realm's weekly raid reset (ctx.weeklyRaidResetMs, the
// Crucible's own Tuesday boundary). Normal and Heroic lock apart. A saved
// character may still enter and fight beside others (the door never reads
// these locks, unlike the per-room raids' at-the-door check in dungeons.ts),
// but the boss pays them nothing that week:
//
// - Loot: the death hub rolls the corpse only for the participants not saved
//   to it (withoutBossSaved before rollLoot, so no personal or quest-item drop
//   is made for a saved raider, the essence quest's remnant included, and a
//   corpse whose every participant is saved rolls nothing at all), and boss
//   companion rolls skip them the same way. The corpse then keeps them off
//   whatever it holds (Entity.bossLootLock, loot/boss_loot_lock.ts).
// - The Weekly Vault's raid row (one raid clear of the kill's difficulty,
//   weekly_rewards.ts recordWeeklyRaidClear, never the dungeon row) and the
//   weekly raid quest (wk_raid) count the kill only for a raider it found
//   unlocked, exactly as a Crucible room's lock keeps a saved raider from a
//   second kill there: one boss, one credit a week, per difficulty.
//
// WHO IS SAVED mirrors the Crucible's Normal lock (dungeons.ts awardHeroicMarks
// arm): every current member of the group that owns the claim, wherever they
// stand, plus anyone inside the claim's footprint, plus the death-time
// participation snapshot. It strikes even an uncredited death, so the owning
// group cannot dodge it. WHO IS CREDITED is the boss kill tally's roster
// (boss_kill_tally.ts bossKillCreditRoster), the same list the Weekly Vault
// pays.
//
// WHEN: once per boss death from the death hub (combat/damage.ts), AFTER every
// reward read of that death (the loot roll, the companions), so all of them
// judge the pre-kill locks, and it pays its own vault and quest credit before
// it stamps; a council's lock lands with its LAST body
// (boss_kill_tally.ts completedBossEncounter), while every body's corpse is
// gated. Draws NO rng; reads only the host lockout clock.

import {
  BOSS_KILL_ENCOUNTERS,
  type BossKillEncounter,
  bossKillCreditRoster,
  completedBossEncounter,
} from '../boss_kill_tally';
import { bossLockoutId, PER_BOSS_LOCKOUT_RAIDS } from '../raid_boss_lockout_id';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { onRaidBossKilledForWeeklyQuests } from '../weekly_quests';
import { recordWeeklyRaidClear } from '../weekly_rewards';
import { instanceLockoutMetas } from './dungeons';

/** The lock a dying body of a per-boss raid is judged on. */
export interface BossLockout {
  lockId: string;
  encounter: BossKillEncounter;
}

/** The per-boss lock of a body in this claim, or null: no claim, a raid that
 *  locks per room (or not at all), or a body of no tracked encounter (trash). */
export function bossLockoutOf(inst: InstanceSlot | null, templateId: string): BossLockout | null {
  if (!inst || inst.partyKey === null || !PER_BOSS_LOCKOUT_RAIDS.has(inst.dungeonId)) return null;
  const encounter = BOSS_KILL_ENCOUNTERS.get(templateId);
  if (!encounter) return null;
  return { lockId: bossLockoutId(inst.dungeonId, encounter.mobId, inst.difficulty), encounter };
}

/** Is this character saved to the boss behind `lockId` right now? */
export function isBossLocked(ctx: SimContext, meta: PlayerMeta, lockId: string): boolean {
  return (meta.raidLockouts.get(lockId) ?? 0) > ctx.lockoutNowMs();
}

/** A reward roster with the raiders saved to this boss left out. The SAME
 *  array when the dying mob is no per-boss raid boss or nobody is saved, so
 *  every other death's reward path (and its rng draw order) is untouched. */
export function withoutBossSaved(
  ctx: SimContext,
  boss: Entity,
  inst: InstanceSlot | null,
  metas: PlayerMeta[],
): PlayerMeta[] {
  const lock = bossLockoutOf(inst, boss.templateId);
  if (!lock) return metas;
  const out = metas.filter((meta) => !isBossLocked(ctx, meta, lock.lockId));
  return out.length === metas.length ? metas : out;
}

/**
 * Settle one per-boss raid body's death (see the header): gate its corpse,
 * and when the death completes the encounter, credit the vault's raid row and
 * the weekly raid quest to the unlocked raiders, tell the saved ones why the boss paid them nothing,
 * and save everyone the lock strikes. A no-op for every other death.
 */
export function settleBossLockoutDeath(
  ctx: SimContext,
  boss: Entity,
  recipients: readonly PlayerMeta[],
  inst: InstanceSlot | null,
): void {
  const lock = bossLockoutOf(inst, boss.templateId);
  if (!lock || !inst) return;
  const struck = new Map<number, PlayerMeta>();
  for (const meta of instanceLockoutMetas(ctx, inst)) struck.set(meta.entityId, meta);
  for (const meta of recipients) struck.set(meta.entityId, meta);
  const freshIds: number[] = [];
  for (const meta of struck.values()) {
    if (!isBossLocked(ctx, meta, lock.lockId)) freshIds.push(meta.entityId);
  }
  boss.bossLootLock = { lockId: lock.lockId, freshIds };
  const encounter = completedBossEncounter(ctx, inst, boss.templateId);
  if (!encounter) return;
  const fresh = new Set(freshIds);
  const credited = bossKillCreditRoster(ctx, boss, encounter, recipients, inst) ?? [];
  const paid = credited.filter((meta) => fresh.has(meta.entityId));
  const tier = inst.difficulty === 'heroic' ? 2 : 1;
  for (const meta of paid) recordWeeklyRaidClear(ctx, meta, tier);
  onRaidBossKilledForWeeklyQuests(ctx, paid);
  for (const meta of credited) {
    if (fresh.has(meta.entityId)) continue;
    ctx.notice(
      meta.entityId,
      'You have already defeated this boss this week, so it holds no loot for you.',
    );
  }
  // Only a fresh lock is stamped: a saved helper keeps the boundary they were
  // saved to (the offline host's flat week would otherwise slide forward on
  // every kill they help with).
  const until = ctx.weeklyRaidResetMs(ctx.lockoutNowMs());
  for (const meta of struck.values()) {
    if (fresh.has(meta.entityId)) meta.raidLockouts.set(lock.lockId, until);
  }
}
