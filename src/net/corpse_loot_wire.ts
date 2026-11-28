// The decode side of server/corpse_loot_wire.ts: the corpse-loot bits of an
// entity's dynamic record. The dynamic record is re-sent whole in every full or
// lite record, so every key decodes unconditionally and an absent key resets
// the mirror (a respawn that cleared a claim, a lock, a lapse never leaves a
// stale value behind). Keep the keys byte-identical on both sides.
import { type BossLootLock, bossLootLockDenies } from '../sim/loot/boss_loot_lock';
import type { Entity } from '../sim/types';

/** The per-boss raid corpse lock off `bll` ({ id, f }), or undefined for an
 *  absent or malformed key. Reuses `prev` when the lock is unchanged, so a
 *  re-sent record allocates nothing. */
export function decodeBossLootLockWire(
  raw: unknown,
  prev: BossLootLock | undefined,
): BossLootLock | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { id, f } = raw as { id?: unknown; f?: unknown };
  if (typeof id !== 'string' || !Array.isArray(f)) return undefined;
  const freshIds = f.filter((pid): pid is number => typeof pid === 'number');
  if (
    prev &&
    prev.lockId === id &&
    prev.freshIds.length === freshIds.length &&
    prev.freshIds.every((pid, i) => pid === freshIds[i])
  ) {
    return prev;
  }
  return { lockId: id, freshIds };
}

/** The online IWorld.corpseBossLootDenied read: the sim's own gate
 *  (bossLootLockDenies) over the corpse's mirrored lock and THIS viewer's
 *  mirrored lockouts (the self snapshot's `lockouts`, absolute unlock epochs),
 *  against the wall clock the server's lockout clock also reads. */
export function clientBossLootDenied(
  corpse: Pick<Entity, 'bossLootLock'>,
  viewerId: number,
  lockouts: Readonly<Record<string, number>>,
  nowMs: number,
): boolean {
  const lock = corpse.bossLootLock;
  if (!lock) return false;
  const until = Object.hasOwn(lockouts, lock.lockId) ? lockouts[lock.lockId] : undefined;
  return bossLootLockDenies(lock, viewerId, until, nowMs);
}

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applyCorpseLootWire(e: Entity, w: any): void {
  e.tappedById = w.tap ?? null;
  // corpse harvest claim: unconditional so a record without hcb (unclaimed,
  // or a respawn that cleared the claim) resets any stale mirrored pid
  e.harvestClaimedBy = typeof w.hcb === 'number' ? w.hcb : null;
  // loot owner-lock lapse: flag present means lapsed (mirror as already counted down),
  // absent means the lock still holds or never started. The server owns the
  // countdown; the client only ever needs the boolean.
  e.lootFfaTimer = w.ffa ? 0 : Infinity;
  // the per-boss raid lock the corpse was judged on (sim/loot/boss_loot_lock.ts);
  // ClientWorld.corpseBossLootDenied answers this viewer's denial from it
  e.bossLootLock = decodeBossLootLockWire(w.bll, e.bossLootLock);
}
