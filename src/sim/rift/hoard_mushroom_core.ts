// The Mother of Mushrooms (a common/rare Buried Hoard cave boss), the pure half:
// every tunable, how many spore clouds she lays and where, how many sporelings
// she calls, and how tough and how deadly her Bloated Cap is. No rng, no DOM:
// the renderer imports this file.
//
// The rule: she slowly fouls the room. Spore clouds sit on the floor and burn
// whoever stands in them, always with walkways between; two sporelings come for
// the party; and on a rare map she grows a Bloated Cap that bursts across the
// room unless it is cut down first.
//
// What the client needs rides ordinary hoard cues:
//   mushroom-spore  a spore cloud: a short warning, then a lingering hazard
//   mushroom-bloat  one per Bloated Cap, for its whole fuse: a warning whose
//                   clock IS the fuse, centred on the cap, radius its burst
//   mushroom-burst  the same id once the fuse has run (it bursts) or the cap
//                   was cut down (innerRadius 1: cut down in time)

export const MUSHROOM_CUE_VARIANTS = ['mushroom-bloat', 'mushroom-burst'] as const;
export function isMushroomLifeVariant(variant: string | undefined): boolean {
  return (MUSHROOM_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

/** The boss and her brood (src/sim/content/rift/mobs.ts, HOARD_MOBS). */
export const HOARD_MUSHROOM_BOSS_TEMPLATE = 'hoard_boss_mushroom';
export const HOARD_SPORELING_TEMPLATE = 'hoard_sporeling';
export const HOARD_BLOAT_CAP_TEMPLATE = 'hoard_bloat_cap';

export const MUSHROOM = Object.freeze({
  // ---- spore clouds
  sporeRadius: 3.4,
  sporeWarningSec: 1.8,
  sporeImpactFraction: 0.05,
  sporeHazardSec: 7,
  sporePulseFraction: 0.035,
  sporePulseEverySec: 0.8,
  sporeFirstSec: 5,
  sporeEverySec: 13,
  /** Clouds per cast: common, rare, and one more per two extra players, capped. */
  sporeCommon: 3,
  sporeRare: 4,
  sporeMax: 6,
  /** The rings the clouds not laid under a player fall on, round her: the near
   *  one first, the far one when a big cast needs the room. */
  sporeRingRadius: 9,
  sporeOuterRingRadius: 15,
  /** No two clouds of one cast closer than this, centre to centre: at twice the
   *  radius minus this gap there is always a walkway between two clouds. */
  sporeSpacing: 7.5,
  /** Only this many clouds go under players; the rest go on the ring. */
  sporeUnderPlayers: 2,
  // ---- sporelings
  sporelingFirstSec: 10,
  sporelingEverySec: 24,
  sporelingEnragedEverySec: 17,
  sporelingCount: 2,
  sporelingDoubleCount: 3,
  /** No new sporelings while this many of hers still stand. */
  sporelingCap: 4,
  // ---- the Bloated Cap (rare maps only)
  bloatFirstSec: 18,
  bloatEverySec: 34,
  /** The fuse: how long the party has to cut it down. */
  bloatFuseSec: 12,
  bloatDoubleFuseSec: 10,
  bloatRadius: 8,
  bloatDamageFraction: 0.45,
  /** Its health, as a share of HER health (already scaled by party size and
   *  rarity), per player who can work on it, within bounds. */
  bloatHealthFraction: 0.04,
  bloatMaxHealthPlayers: 4,
  /** It grows this far to her side. */
  bloatDistance: 7,
  /** The burst leaves a cloud of this size where the cap stood. */
  bloatCloudRadius: 4.5,
  /** How much bigger it grows by the end of its fuse (its entity scale). */
  bloatSwellGrowth: 0.4,
  /** After a cap is dealt with, her next cloud waits at least this long. */
  bloatRespiteSec: 3,
  burstEndSec: 0.9,
  // ---- the fight
  enrageHp: 0.3,
});

/** How many spore clouds one cast lays. */
export function sporeCloudCount(rare: boolean, players: number): number {
  const base = rare ? MUSHROOM.sporeRare : MUSHROOM.sporeCommon;
  const extra = Math.floor(Math.max(0, players - 1) / 2);
  return Math.min(MUSHROOM.sporeMax, base + extra);
}

/** Where one cast's clouds fall. Up to `sporeUnderPlayers` go under the given
 *  players (already rotated by the caller so everyone takes a turn); the rest
 *  go on the rings round her, turned by `cast` so no two casts look alike. A
 *  point closer than `sporeSpacing` to one already laid is skipped and the ring
 *  tries further round, so the room always keeps walkways. */
export function sporeCloudPoints(
  count: number,
  center: { x: number; z: number },
  players: ReadonlyArray<{ x: number; z: number }>,
  cast: number,
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const clear = (x: number, z: number): boolean =>
    out.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= MUSHROOM.sporeSpacing ** 2);
  for (const player of players.slice(0, MUSHROOM.sporeUnderPlayers)) {
    if (out.length >= count) break;
    if (clear(player.x, player.z)) out.push({ x: player.x, z: player.z });
  }
  const rings = [
    { radius: MUSHROOM.sporeRingRadius, slots: 12 },
    { radius: MUSHROOM.sporeOuterRingRadius, slots: 18 },
  ];
  for (const ring of rings) {
    const turn = (cast * 5) % ring.slots;
    const half = ring.slots / 2;
    for (let step = 0; step < ring.slots && out.length < count; step++) {
      // Every other slot first, then the ones between: spread before it fills.
      const slot = (turn + (step < half ? step * 2 : (step - half) * 2 + 1)) % ring.slots;
      const angle = (slot / ring.slots) * Math.PI * 2;
      const x = center.x + Math.sin(angle) * ring.radius;
      const z = center.z + Math.cos(angle) * ring.radius;
      if (clear(x, z)) out.push({ x, z });
    }
  }
  return out;
}

/** How tough a Bloated Cap is. */
export function bloatHealth(bossMaxHp: number, players: number): number {
  const workers = Math.min(MUSHROOM.bloatMaxHealthPlayers, Math.max(1, players));
  return Math.max(1, Math.round(bossMaxHp * MUSHROOM.bloatHealthFraction * workers));
}

/** How swollen the cap looks (0 new, 1 about to burst) from its fuse clock. */
export function bloatSwell(remaining: number, total: number): number {
  if (!(total > 0)) return 1;
  const t = 1 - Math.max(0, Math.min(1, remaining / total));
  return t * t;
}
