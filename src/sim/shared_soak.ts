// The shared-soak split: one damage total, divided by everyone standing inside a circle.
//
// Two encounters use it and they must never disagree on the arithmetic, so it lives here
// rather than in either of them: Varkhul's Shared Pyre (varkhul_shared_pyre.ts prices its
// per-soaker fraction through `sharedSoakFraction`) and Balgath's Barrow Burden
// (mob/boss_ranged_mechanics.ts). Both mark ONE player with an aura, both resolve around
// that player's live position when the wind-up ends, and both hand every player inside
// the circle an equal slice of a total priced as a fraction of that player's max health.
//
// Pure: no SimContext, no rng, no clock. A Vitest imports it directly.

/** Each soaker's slice of a total priced as a fraction of max health. */
export function sharedSoakFraction(totalFraction: number, soakers: number): number {
  return totalFraction / Math.max(1, Math.floor(soakers));
}

/** Every living player inside the soak circle, in the order given. */
export function playersInsideSoak<T extends { dead: boolean; pos: { x: number; z: number } }>(
  players: readonly T[],
  center: { x: number; z: number },
  radius: number,
): T[] {
  return players.filter(
    (player) =>
      !player.dead && Math.hypot(player.pos.x - center.x, player.pos.z - center.z) <= radius,
  );
}
