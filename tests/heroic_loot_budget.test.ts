import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { itemLevel, itemSourceLevel } from '../src/sim/item_level';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

// Release baseline: every existing acquisition remains and item definitions and
// levels stay byte-equivalent after canonical serialization. This catches an
// accidental stat buff from moving generated variants into HEROIC_BOSS_LOOT.
const BASELINE = {
  sexton_marrow: {
    gearIds: ['oiled_boots', 'quilted_trousers'],
    normalDigest: '030977d6324caf60a1c4e5b122d48af316ff8633d3cb627179c8130ba27f8776',
    gearDigest: '3b0b1f90c47672bc0b07c4bd7eb6733dd8b1c678cae29b686d31f482ceec97be',
  },
  morthen: {
    gearIds: [
      'bonechill_cord',
      'bonechill_striders',
      'cryptbone_greaves',
      'cryptbone_helm',
      'cryptbone_pauldrons',
      'cryptplate_helm',
      'greyjaw_hide_boots',
      'lunarward_cinch',
      'morthens_cryptforged_hauberk',
      'oiled_boots',
      'quilted_trousers',
      'shadowpulse_handwraps',
      'shadowpulse_slippers',
    ],
    normalDigest: '608ad38c9ea77cb6a20f75c9aac2fc5bf6787ccf9ac41a8a50ae9b9cd7ddef13',
    gearDigest: 'f52ae1097cb4f45b0c547cfb2ebce590624f4b95eb7e2884931fd0ebb971109e',
  },
  knight_commander_olen: {
    gearIds: [
      'fenmist_robe',
      'heroic_eelscale_leggings',
      'heroic_tideguard_greaves',
      'heroic_tideguard_sabatons',
      'marshstrider_boots',
      'trollhide_leggings',
    ],
    normalDigest: '9165d82e66547ae3ab98bcab284ee171842737273727a4701d140fd7c2922016',
    gearDigest: '426604ed8f7dfe81c85bb8a947c4e970fda25d8b5b8edb00fccf764bb8830b6e',
  },
  vael_the_mistcaller: {
    gearIds: [
      'dreamroot_boots',
      'eelskin_tunic',
      'fenmist_robe',
      'heroic_drowned_prayer_leggings',
      'heroic_drowned_prayer_sandals',
      'heroic_eelscale_treads',
      'heroic_tidescale_vest',
      'marshstrider_boots',
      'mistcallers_fang',
      'mistforged_pauldrons',
      'mistveil_cord',
      'mistveil_grips',
      'sash_of_the_sunken_court',
      'sunken_court_mantle',
      'tidebound_spaulders',
      'tideguard_faceguard',
      'trollhide_leggings',
    ],
    normalDigest: '213a53c89b1da7a01abf0c4ea3849f9390368a6163a358f3fdad2f2007f0bcb1',
    gearDigest: 'd5991a262b361b97fd07aff9ca1ff9fb4f97239fc023975aaace90dc3107f31d',
  },
  choirmother_selthe: {
    gearIds: ['heroic_selthes_seastriders'],
    normalDigest: 'c613531eda914e6aa4815f28a0fd741002338f401f691f957893e9ed0f38aa71',
    gearDigest: 'd6dadf39d72dd0f7f043343d86aa9ca8da44b71fa823881641a28ce67c2fb20e',
  },
  ysolei: {
    gearIds: [
      'choir_blessed_spaulders',
      'choirmothers_casque',
      'heroic_moonshroud_breastplate',
      'heroic_moonshroud_robe',
      'heroic_moonshroud_tunic',
      'heroic_ysols_pearl_greaves',
      'lunar_choir_leggings',
      'lunar_tide_greatstaff',
      'stormbark_mantle',
      'tideworn_warboots',
      'tidewoven_trousers',
    ],
    normalDigest: 'aa4c9a380d095266e6cd74de3869ac1652f4a896af53c6bdd4cf406fa35ee01c',
    gearDigest: '61aca27f2d85ec007ba42850e9735463c2e847a4131426cbc7c0357f819bca50',
  },
  korgath_the_bound: {
    gearIds: [
      'boneplate_vest',
      'heroic_boundstone_helm',
      'heroic_gravewyrm_mantle',
      'heroic_gravewyrm_sabatons',
      'heroic_korgaths_chainwraps',
      'heroic_shadowmeld_tunic',
      'heroic_staff_of_velkhar',
      'heroic_wyrmcult_grand_robe',
      'heroic_wyrmcult_soulsteps',
      'heroic_wyrmshadow_treads',
      'nightwalk_jerkin',
      'revenant_silk_robe',
      'zealotsbane_blade',
    ],
    normalDigest: '48c75a437f0d7672490273450f6a49fbc974378155beefd3184a71cea13c2521',
    gearDigest: '819c8b898bc2afff45c279b8c9c109a856f03096edda71004a9a7c089d6bc71b',
  },
  grand_necromancer_velkhar: {
    gearIds: [
      'boneplate_vest',
      'emberwood_staff',
      'heroic_boneguard_breastplate',
      'heroic_deathlord_legguards',
      'heroic_gravewyrm_stalkers_treads',
      'heroic_necromancers_soulsteps',
      'heroic_shadowmeld_tunic',
      'heroic_staff_of_velkhar',
      'heroic_wyrmshadow_legguards',
      'nightwalk_jerkin',
      'revenant_silk_robe',
    ],
    normalDigest: 'e9b35e13c5de33a5bf786cdba760f19b6b769a4bf712de6ee2ff0698ed1fcb09',
    gearDigest: '5f0ab11f2b8365a28e0192bdc47aca16eaa22d727ae7c66a18d6eba3d5b3e8a2',
  },
  korzul_the_gravewyrm: {
    gearIds: [
      'boneplate_vest',
      'cultist_flayer',
      'gravescale_girdle',
      'gravewyrm_claws',
      'gravewyrm_cleaver',
      'heroic_boundstone_girdle',
      'heroic_deathlord_warplate',
      'heroic_deathlords_dread_visage',
      'heroic_fang_of_korzul',
      'heroic_gravewyrm_bone_quiver',
      'heroic_gravewyrm_gauntlets',
      'heroic_grovewardens_grips',
      'heroic_necromancers_soulspire_mantle',
      'heroic_necromancers_starshroud',
      'heroic_nightfangs_greatstaff',
      'heroic_staff_of_the_gravewyrm',
      'heroic_verdant_walkers',
      'heroic_wildgrowth_leggings',
      'heroic_wyrmfang_greatblade',
      'heroic_wyrmshadow_harness',
      'heroic_wyrmshadow_talongrips',
      'nightwalk_jerkin',
      'revenant_silk_robe',
      'sanctum_prowlers_grips',
      'shroud_of_the_gravewyrm',
      'wildsoul_maul',
      'wyrmchoir_handwraps',
    ],
    normalDigest: '0ac50f2ff6acdc808e5c24f721c84b337eade18ea81d2463f77bdd437599946a',
    gearDigest: '27d907ece0786d3994aec6330d2373e8a8e4731c1610ef5f2980a763374585b8',
  },
  wildheart_high_priest: {
    gearIds: [
      'basin_stalkers_tunic',
      'bloodmane_war_legguards',
      'bloodmane_warleggings',
      'greatfang_of_the_basin',
      'heroic_wildheart_fangknife',
      'heroic_wildheart_hexwood_staff',
      'heroic_wildheart_tuskblade',
      'sunbone_oracles_crown',
      'sunbone_ritual_hauberk',
      'sunbone_ritual_sarong',
      'verdant_heart_vestment',
      'vineclaw_stalking_breeches',
    ],
    normalDigest: 'dc4c6a27f87b5cd5ab11237b791de5a2707e2b55329f7c1aada4a4fb9cfe34f8',
    gearDigest: '0939a67a0c3e1b70187cee7379c1360b26b4b97720d56a475e0a23c2155aaaf5',
  },
} as const;

function digest(value: unknown): string {
  const stable = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(stable)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, stable(item)]),
          )
        : input;
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

describe('heroic five-player equipment budget', () => {
  it('keeps migrated bags independent at their original per-kill chances', () => {
    for (const [bossId, itemId, chance, sourceLevel] of [
      ['morthen', 'gravewoven_bag', 0.2, 10],
      ['vael_the_mistcaller', 'mistcallers_duffel', 0.1, 13],
      ['grand_necromancer_velkhar', 'necromancers_reagent_satchel', 0.2, 20],
    ] as const) {
      const entry = HEROIC_BOSS_LOOT[bossId].find((row) => row.itemId === itemId);
      expect(entry).toEqual({ itemId, chance, preserveSourceTier: true });
      expect(itemSourceLevel(itemId)).toBe(sourceLevel);
      expect(itemLevel(ITEMS[itemId])).toBeUndefined();
      expect(MOBS[bossId].loot.find((row) => row.itemId === itemId)?.normalOnly).toBe(true);
    }
  });

  let sim: Sim;
  beforeAll(() => {
    sim = new Sim({ seed: 1234, playerClass: 'warrior' });
  });

  for (const [bossId, baseline] of Object.entries(BASELINE)) {
    it(bossId + ' gives exactly one equipment item through the real loot roller', () => {
      const template = MOBS[bossId];
      const meta = sim.ctx.players.get(sim.player.id)!;
      sim.ctx.instances.push({
        id: -1,
        dungeonId: 'hollow_crypt',
        partyKey: 'budget-test',
        difficulty: 'heroic',
        mobIds: [-1],
      } as unknown as (typeof sim.ctx.instances)[number]);
      sim.rng = new Rng(4321);
      try {
        for (let kill = 0; kill < 300; kill++) {
          const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
          rollLoot(sim.ctx, mob, meta);
          const gear = (mob.loot?.items ?? []).filter(
            (entry) => ITEMS[entry.itemId]?.slot && ITEMS[entry.itemId]?.kind !== 'bag',
          );
          expect(gear, 'kill ' + kill).toHaveLength(1);
        }
      } finally {
        sim.ctx.instances.pop();
      }
    });

    it(bossId + ' can award every equipment entry through its partition', () => {
      const template = MOBS[bossId];
      const meta = sim.ctx.players.get(sim.player.id)!;
      const entries = HEROIC_BOSS_LOOT[bossId].filter(
        (entry) => entry.itemId && ITEMS[entry.itemId]?.slot && ITEMS[entry.itemId]?.kind !== 'bag',
      );
      const draw = vi.spyOn(sim.rng, 'next');
      sim.ctx.instances.push({
        id: -1,
        dungeonId: 'hollow_crypt',
        partyKey: 'budget-test',
        difficulty: 'heroic',
        mobIds: [-1],
      } as unknown as (typeof sim.ctx.instances)[number]);
      let cumulative = 0;
      try {
        for (const entry of entries) {
          draw.mockReturnValue(cumulative + entry.chance / 2);
          cumulative += entry.chance;
          const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
          rollLoot(sim.ctx, mob, meta);
          expect(
            mob.loot?.items.some((drop) => drop.itemId === entry.itemId),
            entry.itemId,
          ).toBe(true);
        }
        expect(cumulative).toBe(1);
      } finally {
        draw.mockRestore();
        sim.ctx.instances.pop();
      }
    });

    it(bossId + ' retains every heroic acquisition and its existing item stats', () => {
      const gearEntries = (HEROIC_BOSS_LOOT[bossId] ?? []).filter(
        (entry) => entry.itemId && ITEMS[entry.itemId]?.slot && ITEMS[entry.itemId]?.kind !== 'bag',
      );
      expect([...new Set(gearEntries.map((entry) => entry.itemId!))].sort()).toEqual(
        baseline.gearIds,
      );
      const definitions = Object.fromEntries(
        baseline.gearIds.map((id) => [id, { def: ITEMS[id], level: itemLevel(ITEMS[id]) }]),
      );
      expect(digest(definitions)).toBe(baseline.gearDigest);
    });

    it(bossId + ' preserves the complete Normal loot table and probabilities', () => {
      const normalLoot = MOBS[bossId].loot.map(({ normalOnly: _normalOnly, ...entry }) => entry);
      expect(digest(normalLoot)).toBe(baseline.normalDigest);
    });
  }
});
