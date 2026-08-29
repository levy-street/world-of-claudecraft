// Guild colour tiers: the guild line under a character's nameplate tiers by
// the guild's COLLECTIVE lifetime XP (the same sum the guild high-score board
// ranks by, server/db.ts), so the best guilds read as such at a glance.
//
// Absolute thresholds in a pure leaf: every host derives the same tier from
// the same total, and the presentation (nameplate colour classes) keys off
// the tier index alone. Cosmetic only, never power (the graphics-neutral
// rule); tier 0 is the base look every fresh guild starts with.

/** Lifetime-XP floors per tier, ascending; index IS the tier. Tuned so a few
 *  active members clear tier 1 in their first weeks, and the top tier stays
 *  rare enough to mean something. */
export const GUILD_TIER_THRESHOLDS: readonly number[] = [
  0, // 0: a fresh guild
  100_000, // 1: a few actives finding their feet
  1_000_000, // 2: an established roster
  10_000_000, // 3: a serious guild
  100_000_000, // 4: the realm's elite
];

export const GUILD_TIER_COUNT = GUILD_TIER_THRESHOLDS.length;

/** The tier for a guild's summed lifetime XP (clamped, never negative). */
export function guildTierForLifetimeXp(totalLifetimeXp: number): number {
  let tier = 0;
  for (let i = 1; i < GUILD_TIER_THRESHOLDS.length; i++) {
    if (totalLifetimeXp >= GUILD_TIER_THRESHOLDS[i]) tier = i;
  }
  return tier;
}
