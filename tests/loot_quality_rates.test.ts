// Classic-era loot quality rates for normal open-world mobs.
//
// The regression this pins: leveling-zone trash used to hand out uncommon
// (green) gear at 10-30% per kill and rare (blue) gear at 4-8%, so a green
// dropped every few mobs. Classic-era MMO rates for a NORMAL mob are roughly
// 2% for a green and 0.1-0.2% for a blue; rares, elites, and bosses are the
// tier that guarantees quality drops. The retune scales each normal camp
// mob's green entries to a 2% per-kill total (authored relative weights
// preserved) and its blue entries to a 0.2% total. Quest-gated entries are
// exempt (they only drop for players on the quest and gate collection pace,
// not gearing), as are poor/common junk, harvest components, and coin.
import { describe, expect, it } from 'vitest';
import { CAMPS, ITEMS, MOBS } from '../src/sim/data';
import type { LootEntry, MobTemplate } from '../src/sim/types';

// Ceilings for a NORMAL (non-rare, non-elite, non-boss) open-world mob's
// per-kill drop probability, summed across its non-quest loot entries per
// quality tier. Small headroom over the 2% / 0.2% targets so a deliberate
// one-entry tweak does not trip the guard, while the old 10-30% world is
// impossible to reintroduce silently.
const NORMAL_MOB_UNCOMMON_CEILING = 0.03;
const NORMAL_MOB_RARE_CEILING = 0.005;
// Epic long-shot chase entries (deathlord_sabatons, necromancers_legwraps)
// are authored at 0.1% per kill; anything past this band belongs on a rare
// or a boss, not farmable trash.
const NORMAL_MOB_EPIC_CEILING = 0.002;

function isNormalMob(template: MobTemplate): boolean {
  return !template.rare && !template.elite && !template.boss;
}

function qualityChanceSum(
  loot: LootEntry[],
  quality: 'uncommon' | 'rare' | 'epic' | 'legendary',
): number {
  return loot
    .filter((entry) => entry.itemId && !entry.questId)
    .filter((entry) => ITEMS[entry.itemId ?? '']?.quality === quality)
    .reduce((sum, entry) => sum + entry.chance, 0);
}

describe('normal mobs drop quality loot at classic-era rates', () => {
  // Every normal template in the merged table, not just today's camp-spawned
  // set, so a future spawner (escort waves, a new zone's population) lands
  // under the same classic bands automatically.
  const normals = Object.values(MOBS).filter(isNormalMob);

  it('covers the leveling population (sanity: the filter finds the camp mobs)', () => {
    const campIds = new Set(CAMPS.map((c) => c.mobId));
    expect(normals.filter((t) => campIds.has(t.id)).length).toBeGreaterThan(10);
    expect(normals.some((t) => t.id === 'forest_wolf')).toBe(true);
  });

  it.each(normals.map((t) => [t.id, t] as const))(
    '%s: total green chance stays in the classic band',
    (_id, template) => {
      expect(qualityChanceSum(template.loot, 'uncommon')).toBeLessThanOrEqual(
        NORMAL_MOB_UNCOMMON_CEILING,
      );
    },
  );

  it.each(normals.map((t) => [t.id, t] as const))(
    '%s: total blue chance stays in the classic band',
    (_id, template) => {
      expect(qualityChanceSum(template.loot, 'rare')).toBeLessThanOrEqual(NORMAL_MOB_RARE_CEILING);
    },
  );

  it.each(normals.map((t) => [t.id, t] as const))(
    '%s: epic and legendary entries stay long-shot chase drops',
    (_id, template) => {
      expect(qualityChanceSum(template.loot, 'epic')).toBeLessThanOrEqual(NORMAL_MOB_EPIC_CEILING);
      expect(qualityChanceSum(template.loot, 'legendary')).toBe(0);
    },
  );

  it('keeps every retuned drop obtainable (chance stays above zero)', () => {
    const retuned: ReadonlyArray<readonly [string, string]> = [
      ['forest_wolf', 'milepost_boots'],
      ['forest_wolf', 'wolfhide_satchel'],
      ['wild_boar', 'trail_leggings'],
      ['webwood_spider', 'mosshide_vest'],
      ['tunnel_rat', 'mossy_handwraps'],
      ['tunnel_rat', 'thornling_grips'],
      ['mire_widow', 'fenbark_leggings'],
      ['fen_troll', 'elixir_of_the_bear'],
      ['fen_troll', 'marshlight_hauberk'],
      ['gravecaller_mender', 'duskthorn_mantle'],
      ['ridge_stalker', 'wildgrove_cinch'],
      ['deeprock_kobold', 'peaksong_helm'],
      ['deeprock_kobold', 'moonbark_vestments'],
      ['thornpeak_ogre', 'cragprowl_belt'],
      ['drowned_votary', 'tidehymn_slippers'],
      ['wyrmcult_zealot', 'shardsong_mantle'],
      ['wyrmcult_necromancer', 'wyrmcult_spellgrips'],
      ['boneclad_revenant', 'thornpeak_wildwraps'],
    ];
    for (const [mobId, itemId] of retuned) {
      const entry = MOBS[mobId]?.loot.find((l) => l.itemId === itemId);
      expect(entry, `${itemId} on ${mobId}`).toBeTruthy();
      expect(entry?.chance ?? 0, `${itemId} on ${mobId}`).toBeGreaterThan(0);
    }
  });

  it('leaves rares, elites, and bosses on the guaranteed-quality tier', () => {
    // Classic rares guarantee quality loot; the retune must never flatten
    // them into the trash band. Spot-pin the zone-1 rare wolf keeps its
    // generous table.
    const greyjaw = MOBS.old_greyjaw;
    expect(greyjaw.rare).toBe(true);
    expect(qualityChanceSum(greyjaw.loot, 'uncommon')).toBeGreaterThan(0.3);
  });
});
