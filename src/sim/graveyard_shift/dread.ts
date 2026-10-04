// Dread, Morthen's resource on a Graveyard Shift run: 0 to 100, starts empty,
// never regenerates or decays (updateRegen has no 'dread' arm). It is earned by
// dealing damage (the rage-from-damage-dealt hook in combat/damage.ts calls
// dreadFromDamageDealt) and by allies falling nearby, and spent by Shadow
// Pulse through the ordinary cost path. A pure leaf:
// combat/damage.ts and the profile import it without a cycle. Draws no rng.

import type { Entity, ResourceType } from '../types';

export const DREAD_MAX = 100;

// One Dread per 20 damage dealt, any school, swing or spell, rounded to a whole
// point per hit so the pool stays an integer: the frame text (rounded) then
// never shows a cost the cast refuses, and no float drift leaves a pool a hair
// under a cost. Rounding to nearest keeps the average rate. Rate check, with
// the solo damage multiplier (morthen_profile.ts): the swing alone earns about
// 5 Dread a hit, so a Pulse every four or five swings of steady melee, which
// is what keeps Morthen in the party's face rather than kiting.
export const DREAD_PER_DAMAGE = 1 / 20;
export const SHADOW_PULSE_DREAD = 25;
// One of Morthen's allies falling close to him feeds his Dread (concept rule).
export const ALLY_DEATH_DREAD = 15;
export const ALLY_DEATH_DREAD_RADIUS = 20;

// The whole Dread one hit of `amount` damage earns.
export function dreadForHit(amount: number): number {
  return amount > 0 ? Math.round(amount * DREAD_PER_DAMAGE) : 0;
}

// Every hit he lands counts, including the noRage ones (reflects and the like)
// that rage-from-damage skips: Dread measures harm done, not swings taken.
export function dreadFromDamageDealt(source: Entity, amount: number): void {
  if (source.resourceType !== 'dread') return;
  const gain = dreadForHit(amount);
  if (gain === 0) return;
  source.resource = Math.min(source.maxResource, source.resource + gain);
}

// The Dread a recalc hands back: the pool before the recalc when it was
// already Dread, else empty (the identity just landed). The base recalc pass
// rewrites the resource for the real class first, so the profile must not
// read e.resource after it.
export function carriedDread(prevType: ResourceType | null, prevResource: number): number {
  if (prevType !== 'dread') return 0;
  return Math.max(0, Math.min(DREAD_MAX, prevResource));
}
