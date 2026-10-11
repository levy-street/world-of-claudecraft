// Boss-pet cosmetic challenges: the per-attempt timing and damage tracker,
// resolved at the boss's death for every credited player.
//
// Two task kinds (content/buddy_sources.ts BUDDY_COSMETIC_CHALLENGES):
//   speed  - the kill lands within N seconds of the attempt's first damage;
//   dps    - the player's OWN damage on the boss over the attempt, divided by
//            its length, meets a rate.
// Both re-arm when the boss evades home or respawns (resetBuddyChallenge,
// called beside resetDeedEncounter), exactly like the deed encounter tasks,
// so a wipe never carries a stale clock into the next pull.
//
// Bookkeeping is a WeakMap keyed on the boss entity: no seam member, no
// per-Sim runtime bag, and a dropped entity takes its record with it. Only
// bosses in BUDDY_CHALLENGE_BOSSES are tracked, so the damage hot path pays
// one Set lookup for every other mob. Draws no rng.
//
// `src/sim`-pure.

import { grantBuddyCosmetic } from './buddies';
import { BUDDY_CHALLENGE_BOSSES, buddyCosmeticChallengesFor } from './content/buddy_sources';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, TICK_RATE } from './types';

interface Attempt {
  /** Tick of the attempt's first damage. */
  startTick: number;
  /** Damage on the boss per contributing player entity id (pet damage
   *  credits the owner). */
  damage: Map<number, number>;
}

const attempts = new WeakMap<Entity, Attempt>();

/** Damage-site hook: fold `amount` from `source` into the boss's attempt,
 *  opening one on the first hit. */
export function recordBossDamageForBuddies(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
): void {
  if (!source || amount <= 0 || !BUDDY_CHALLENGE_BOSSES.has(target.templateId)) return;
  const contributorId = source.kind === 'player' ? source.id : source.ownerId;
  if (contributorId === null) return;
  let attempt = attempts.get(target);
  if (!attempt) {
    attempt = { startTick: ctx.tickCount, damage: new Map() };
    attempts.set(target, attempt);
  }
  attempt.damage.set(contributorId, (attempt.damage.get(contributorId) ?? 0) + amount);
}

/** Evade/respawn: forget the attempt so the next pull starts a fresh clock. */
export function resetBuddyChallenge(boss: Entity): void {
  attempts.delete(boss);
}

/** The attempt's length so far in seconds (0 with no attempt open). */
export function buddyAttemptSeconds(ctx: SimContext, boss: Entity): number {
  const attempt = attempts.get(boss);
  return attempt ? Math.max(0, ctx.tickCount - attempt.startTick) / TICK_RATE : 0;
}

/** Death-site hook: resolve every challenge the boss carries for every
 *  recipient, then consume the attempt. A speed task pays everyone credited;
 *  a dps task pays each player on their own damage. */
export function resolveBuddyChallenges(
  ctx: SimContext,
  boss: Entity,
  recipients: readonly PlayerMeta[],
): void {
  const rows = buddyCosmeticChallengesFor(boss.templateId);
  if (rows.length === 0) return;
  const attempt = attempts.get(boss);
  attempts.delete(boss);
  if (!attempt) return;
  // A kill on the same tick as the first hit is a one-tick fight, never a
  // division by zero.
  const seconds = Math.max(1 / TICK_RATE, (ctx.tickCount - attempt.startTick) / TICK_RATE);
  for (const row of rows) {
    for (const meta of recipients) {
      const ok =
        row.kind === 'speed'
          ? seconds <= row.seconds
          : (attempt.damage.get(meta.entityId) ?? 0) / seconds >= row.dps;
      if (ok) grantBuddyCosmetic(ctx, meta.entityId, row.cosmeticId);
    }
  }
}
