import { isRaidInstancePos } from '../sim/instances/dungeons';
import { dist2d, INTERACT_RANGE } from '../sim/types';
import type { IWorld } from '../world_api';

// The client-side walk-by pass: each frame, scan visible lootable corpses and
// fire IWorld.autoLoot(id) for ones the local player looks eligible for and in
// range of. This is best-effort only; the sim's silent gate (autoLootForParty)
// is the single source of truth for who actually receives loot. Keeping the
// eligibility check here cheap and permissive just avoids spamming commands for
// corpses that plainly aren't ours yet.
export interface AutoLootWorld {
  player: IWorld['player'];
  playerId: IWorld['playerId'];
  partyInfo: IWorld['partyInfo'];
  entities: IWorld['entities'];
  autoLoot(id: number): void;
}

const RETRY_MS = 2000;

export class AutoLoot {
  private lastAttempt = new Map<number, number>();

  // now: the caller's clock (wall or sim time), never read internally, so this
  // stays deterministically unit-testable.
  run(world: AutoLootWorld, now: number): void {
    if (world.player.dead) return;
    // Best-effort mirror of the sim's silent raid-instance gate (avoids spamming
    // the autoloot command); the sim's isInRaidInstance stays authoritative.
    if (isRaidInstancePos(world.player.pos)) return;
    const mine = new Set<number>([world.playerId]);
    for (const m of world.partyInfo?.members ?? []) mine.add(m.pid);
    const px = world.player.pos;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || !e.dead || !e.lootable || !e.loot) continue;
      const tappedMine = e.tappedById == null || mine.has(e.tappedById);
      const personalMine = e.loot.items.some((slot) => slot.personalFor?.includes(world.playerId));
      const openToAll = e.loot.items.some((slot) => slot.openToAll && slot.count > 0);
      if (!tappedMine && !personalMine && !openToAll) continue;
      if (dist2d(px, e.pos) > INTERACT_RANGE) continue;
      const last = this.lastAttempt.get(e.id);
      if (last !== undefined && now - last < RETRY_MS) continue;
      this.lastAttempt.set(e.id, now);
      world.autoLoot(e.id);
    }
    for (const id of this.lastAttempt.keys()) {
      if (!world.entities.has(id)) this.lastAttempt.delete(id);
    }
  }
}
