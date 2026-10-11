// The still-running raid lockouts of a durable character save, read the way the
// sim's own load path reads them (addPlayer keeps only finite expiries still in
// the future). Pure and host-agnostic so the server's character list can label
// each roster row with the lockouts the character will carry into the world,
// without booting a Sim: the roster reads the persisted `raidLockouts` blob
// (lockout id -> absolute unlock epoch ms, see CharacterState) against the
// host wall clock, exactly the clock the live lockout gate compares against.
//
// Lockout ids are the sim's own: a bare dungeon id for a normal-difficulty
// final-boss lock, `<dungeon>:heroic` for the heroic daily, and
// `worldboss:<mobId>` for a looted world boss (src/sim/world_boss.ts). The
// roster ships them verbatim; the client resolves display names
// (src/ui/raid_lockout_format.ts raidLockoutDisplayName) and groups them by
// lockoutKind below.

import { isRaidRoom } from './raid_rooms';
import { worldBossIdFromLockout } from './world_boss';

/** What a lockout id locks: a raid boss room (either reset boundary), an
 *  ordinary dungeon (a heroic daily under `<dungeon>:heroic`), or a looted
 *  world boss (`worldboss:<mobId>`). */
export type RaidLockoutKind = 'raid' | 'dungeon' | 'worldBoss';

export const LOCKOUT_KIND_ORDER: readonly RaidLockoutKind[] = ['raid', 'dungeon', 'worldBoss'];

export function lockoutKind(lockoutId: string): RaidLockoutKind {
  if (worldBossIdFromLockout(lockoutId) !== null) return 'worldBoss';
  const dungeonId = lockoutId.endsWith(':heroic')
    ? lockoutId.slice(0, -':heroic'.length)
    : lockoutId;
  return isRaidRoom(dungeonId) ? 'raid' : 'dungeon';
}

/** The subset of a saved `raidLockouts` map that is still locked at `nowMs`:
 *  finite expiries strictly in the future, keys sorted so the wire shape is
 *  deterministic. Tolerates any untrusted JSONB shape (absent, null, non-object,
 *  non-numeric values) by returning an empty map. */
export function activeRaidLockouts(
  saved: Readonly<Record<string, unknown>> | null | undefined,
  nowMs: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!saved || typeof saved !== 'object') return out;
  for (const id of Object.keys(saved).sort()) {
    const until = saved[id];
    if (typeof until === 'number' && Number.isFinite(until) && until > nowMs) out[id] = until;
  }
  return out;
}
