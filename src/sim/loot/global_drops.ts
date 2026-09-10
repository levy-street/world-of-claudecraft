// Global buddy-whistle drop: independent of any mob's own `loot` table, every
// regular mob kill additionally rolls one chance per whistle rarity tier for
// a random buddy whistle (src/sim/content/items.ts, kind 'buddy') of that
// quality. Consumed by rollLoot (loot_roll.ts), appended to the SAME corpse
// item list as everything else so it rides ordinary party need/greed rules
// for free; see that file's header for why the draw order here matters.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no
// Math.random/Date.now.

import { ITEMS } from '../data';

export interface GlobalBuddyDropTier {
  quality: string;
  /** Independent per-kill chance (0..1) that THIS tier drops, checked with
   *  its own ctx.rng.chance() draw regardless of whether any other tier hit. */
  chance: number;
}

// 2026-09-03 owner request: 1.5% common and 1% uncommon from every enemy
// killed (normal, elite, dungeon boss and raid boss alike, since rollLoot runs
// this list on every kill), with rare and epic held OUT of the drop table for
// now. Superseded the 2026-08-28 tuning (2% / 1% / 0.5% / 0.25%).
//
// The two withheld tiers stay listed at chance 0 rather than being deleted:
// every tier draws its ctx.rng.chance() unconditionally (loot_roll.ts), so the
// per-kill draw COUNT is what the parity goldens are pinned to, and keeping
// four rows means this retuning changes only which draws can win, never the
// draw order. Re-enabling a tier is then a one-number edit that also cannot
// reshape a golden. chance 0 can never win: Rng.chance is a strict `< p`.
//
// 2026-09-04: rare joins the table at 0.05%, a twentieth of the uncommon rate,
// so a blue companion is a genuine long-odds find rather than vendor-only.
//
// 2026-09-06: the rares that something else OWNS came back out of the pool.
// Proud Grunt, Loot Goblin and Penny Goldspark are their vendors' alone (owner
// request: the counters are the only way to them) and Crystal Tide is
// fishing's alone. The tier keeps its rate and keeps the rares nothing else
// claims -- Cate Coin, Alon, Trollface, Kekius and Solbot -- so a blue
// companion is still a long-odds find off a kill. See
// WITHHELD_FROM_GLOBAL_POOL.
//
// Epic stays withheld at chance 0: the one epic with a live source is the
// Crystal Lich, and Nythraxis owns that chase (content/dungeons.ts).
export const GLOBAL_BUDDY_DROP_TIERS: readonly GlobalBuddyDropTier[] = [
  { quality: 'common', chance: 0.015 },
  { quality: 'uncommon', chance: 0.01 },
  { quality: 'rare', chance: 0.0005 },
  { quality: 'epic', chance: 0 },
];

// The angler's companion (2026-09-06 owner request): Crystal Tide is fished
// up anywhere, at 0.5% of every landed catch. It lives here rather than in
// professions/fishing.ts because this module is where a buddy's sources that
// are NOT a mob's own loot table are declared, and because the whistle it
// names has to stay one edit away from the tier list above: the companion is
// rare, so it ALSO rides the 0.05% rare tier off a kill, and a reader tuning
// one rate should see the other.
//
// Being a share of the catch rather than a bonus beside it is deliberate: a
// cast is one rng draw by contract (professions/fishing.ts), and this rides
// the bottom slice of that same draw. See the draw site for why that keeps
// every pinned catch sequence and every fishing parity golden intact.
//
// FISHING IS ITS ONLY SOURCE. Being a rare would otherwise put it in the rare
// tier's pool below and let any kill in the world hand it over, which is not
// what it is: it is the angler's companion, and a companion earned at the
// water should not also fall off a boar. WITHHELD_FROM_GLOBAL_POOL is what
// enforces that.
export const FISHING_BUDDY_DROP = {
  itemId: 'whistle_crystal_tide',
  chance: 0.005,
} as const;

/** Whistles the global tier pools never carry, because something else in the
 *  game owns their acquisition outright: a named vendor, or the water. Not the
 *  same as a withheld TIER (a tier at chance 0 withholds every whistle in it);
 *  this withholds a NAMED companion from a tier that stays live for whatever
 *  joins it later.
 *
 *  This is content, not a switch. The tier a withheld whistle came out of
 *  stays live for everything else in it, and a new companion with no named
 *  source starts dropping the day it is added. rollLoot also skips an empty
 *  pool without changing its draw count, so even withholding a whole tier's
 *  worth would leave the parity goldens alone. */
const WITHHELD_FROM_GLOBAL_POOL: ReadonlySet<string> = new Set([
  // Fishing's own, at 0.5% a catch (professions/fishing.ts).
  FISHING_BUDDY_DROP.itemId,
  // The three currency counters in Highwatch (content/zone3.ts): honor,
  // Heroic Marks and gold. A companion you are meant to SAVE for should not
  // also fall off a boar, which is the whole reason the counters exist.
  'whistle_proud_grunt',
  'whistle_loot_goblin',
  'whistle_penny_goldspark',
]);

// Built once at module load from the merged ITEMS catalog (not just
// content/items.ts) so a buddy whistle added anywhere else joins its tier's
// pool automatically. Sorted for a stable, reviewable id order that never
// depends on ITEMS's own merge order.
const BUDDY_WHISTLES_BY_QUALITY: Record<string, string[]> = {};
for (const item of Object.values(ITEMS)) {
  if (item.kind !== 'buddy') continue;
  if (WITHHELD_FROM_GLOBAL_POOL.has(item.id)) continue;
  const quality = item.quality ?? 'common';
  if (!BUDDY_WHISTLES_BY_QUALITY[quality]) BUDDY_WHISTLES_BY_QUALITY[quality] = [];
  BUDDY_WHISTLES_BY_QUALITY[quality].push(item.id);
}
for (const pool of Object.values(BUDDY_WHISTLES_BY_QUALITY)) pool.sort();

/** Every buddy-whistle item id of `quality` the global table can actually
 *  hand out, in a fixed sorted order (empty when the catalog has none at that
 *  quality yet). A withheld companion is absent, so this is also the honest
 *  answer to "one of how many" for the UI. */
export function buddyWhistlesOfQuality(quality: string): readonly string[] {
  return BUDDY_WHISTLES_BY_QUALITY[quality] ?? [];
}
