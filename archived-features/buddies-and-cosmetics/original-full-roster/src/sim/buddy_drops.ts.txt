// Boss pets: the per-player roll at a boss's death, and the reveal sweep that
// turns a pending companion into an owned one once the player walks out.
//
// The roll is INDIVIDUAL: every eligible player draws their own chance for
// every companion the boss carries (content/buddy_sources.ts), so nobody
// loses a roll to a party member and there is no corpse item to need/greed.
// A win attaches as a PENDING buddy with a presence line (buddies.ts
// attachPendingBuddy); the sweep below reveals it on the zone-out (instance
// kills) or once the player is BUDDY_WORLD_REVEAL_DISTANCE from the kill
// (world bosses). Login reveals anything left pending, so a companion can
// never get stuck.
//
// rng: the roll draws ctx.rng.chance() once per (player, companion row) ONLY
// for a boss that has rows, in a fixed order (eligible players in the order
// the death site hands them, rows in table order). Ordinary kills draw
// nothing, so the parity goldens for every non-boss scenario are untouched;
// the scenarios that kill a listed boss shift by design.
//
// `src/sim`-pure.

import {
  attachPendingBuddy,
  buddyWornTint,
  grantBuddy,
  grantBuddyCosmetic,
  revealPendingBuddies,
} from './buddies';
import {
  BUDDY_COSMETIC_DEED_REWARDS,
  BUDDY_DEED_REWARDS,
  BUDDY_WORLD_REVEAL_DISTANCE,
  buddyBossDropsFor,
} from './content/buddy_sources';
import { spawnBuddyEntity } from './pet/buddy_ai';
import type { InstanceSlot, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity } from './types';

/** Roll the boss's companions for every recipient. `inst` is the claim the
 *  boss died inside (null for an open-world boss); it decides the heroic rate
 *  and whether the reveal waits for a zone-out or for distance. */
export function rollBossBuddyDrops(
  ctx: SimContext,
  boss: Entity,
  recipients: readonly PlayerMeta[],
  inst: InstanceSlot | null,
): void {
  const rows = buddyBossDropsFor(boss.templateId);
  if (rows.length === 0 || recipients.length === 0) return;
  const heroic = inst?.difficulty === 'heroic';
  const source = inst ? 'instance' : 'world';
  for (const meta of recipients) {
    for (const row of rows) {
      if (row.heroicOnly && !heroic) continue;
      const chance = heroic ? (row.heroicChance ?? row.chance) : row.chance;
      // Draw even for a companion this player already has: the draw count
      // per (player, row) stays fixed across a party whatever each member
      // owns, so one collector cannot shift another's stream.
      const won = ctx.rng.chance(chance);
      if (!won) continue;
      attachPendingBuddy(ctx, meta.entityId, row.key, source, { x: boss.pos.x, z: boss.pos.z });
    }
  }
}

/** True while the player stands inside any claimed instance's band (the same
 *  120x250 envelope the deed encounter tasks use for instance membership). */
export function playerInsideInstance(ctx: SimContext, e: Entity): boolean {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) continue;
    const origin = ctx.instanceOriginOf(inst);
    if (Math.abs(e.pos.x - origin.x) < 120 && Math.abs(e.pos.z - origin.z) < 250) return true;
  }
  return false;
}

/** The 1 Hz reveal sweep: every player with something pending is checked
 *  against the reveal condition of each entry. Cheap: players with an empty
 *  pending list cost one length read. */
export function updateBuddyReveals(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    if (meta.buddies.pending.length === 0) continue;
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    const inside = playerInsideInstance(ctx, e);
    revealPendingBuddies(ctx, meta.entityId, (p) =>
      p.source === 'instance'
        ? !inside
        : dist2d(e.pos, { x: p.x, y: 0, z: p.z }) >= BUDDY_WORLD_REVEAL_DISTANCE,
    );
  }
}

/** Login, three jobs. (1) A deed earned before its companion or look was
 *  authored pays out now (the deed evaluator's retro pass skips deeds already
 *  earned, so the reward table is reconciled here instead). (2) A companion
 *  left pending by a logout mid-instance reveals at once when the player
 *  stands outside, else the sweep picks it up on the way out. (3) The last
 *  summoned companion walks back out with the player, so a collected buddy
 *  is simply THERE every session rather than re-summoned by hand. */
export function revealBuddiesOnJoin(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return;
  for (const [deedId, key] of Object.entries(BUDDY_DEED_REWARDS)) {
    if (meta.deedsEarned.has(deedId)) grantBuddy(ctx, pid, key);
  }
  for (const [deedId, id] of Object.entries(BUDDY_COSMETIC_DEED_REWARDS)) {
    if (meta.deedsEarned.has(deedId)) grantBuddyCosmetic(ctx, pid, id);
  }
  const inside = playerInsideInstance(ctx, e);
  revealPendingBuddies(ctx, pid, (p) => p.source === 'world' || !inside);
  const last = meta.buddies.last;
  if (!e.buddyKey && !e.dead && last && meta.buddies.owned.has(last)) {
    e.buddyKey = last;
    spawnBuddyEntity(ctx, e, last, buddyWornTint(meta, last));
  }
}
