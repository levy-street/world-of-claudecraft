// Weekly quests: a repeatable quest that can be turned in once per weekly reset.
//
// The lock rides the character's `raidLockouts` map under a `weeklyquest:<questId>` id,
// the way a looted world boss rides it under `worldboss:<mobId>` (world_boss.ts). That is
// deliberate reuse, not a shortcut: raidLockouts is already the persisted, per-character,
// epoch-ms "locked until the reset" store, with the load-time expiry filter, the save
// round-trip, the online mirror and the lockout panel (which now shows the weekly's
// countdown beside the raids, raid_lockout_format.ts). The boundary is the realm's WEEKLY
// raid reset (ctx.weeklyRaidResetMs), the one the raid rooms' lockouts expire on.
//
// Pure leaf: no SimContext, no clock (the caller passes the host lockout "now").

/** Prefix of a weekly quest's lockout id in `raidLockouts`. */
export const WEEKLY_QUEST_LOCKOUT_PREFIX = 'weeklyquest:';

export function weeklyQuestLockoutId(questId: string): string {
  return WEEKLY_QUEST_LOCKOUT_PREFIX + questId;
}

/** The quest id inside a weekly-quest lockout id, or null for any other lockout. */
export function weeklyQuestIdFromLockout(lockoutId: string): string | null {
  return lockoutId.startsWith(WEEKLY_QUEST_LOCKOUT_PREFIX)
    ? lockoutId.slice(WEEKLY_QUEST_LOCKOUT_PREFIX.length)
    : null;
}

/** Every weekly quest still locked at `nowMs`, sorted (a stable wire signature). */
export function weeklyLockedQuestIds(
  raidLockouts: ReadonlyMap<string, number>,
  nowMs: number,
): string[] {
  const out: string[] = [];
  for (const [id, until] of raidLockouts) {
    const questId = weeklyQuestIdFromLockout(id);
    if (questId !== null && until > nowMs) out.push(questId);
  }
  return out.sort();
}
