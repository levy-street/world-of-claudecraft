import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { itemLevel, itemSourceLevel } from '../src/sim/item_level';
import { heroicLootItemId } from '../src/sim/loot/heroic_item';
import { lootEntryRollsOnClaim } from '../src/sim/loot/loot_difficulty_gate';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

// Release baseline: every existing acquisition remains and item definitions and
// levels stay byte-equivalent after canonical serialization. This catches an
// accidental stat buff from moving generated variants into HEROIC_BOSS_LOOT.
// The nine gearDigest values below were re-minted for the stamina baseline
// model (item_budget.ts, "The stamina baseline model"): every changed def
// either gained its free stamina baseline (a caster identity) or had its
// Strength/Agility trimmed onto its line with stamina added, and every heroic
// variant recomputes through the same model at merge time
// (heroic_variants.ts, makeHeroicVariant), so its digest moves even where the
// base item's literal did not. normalDigest is untouched because the loot
// table shape and chances did not change. Receipt for every def behind the
// re-minted digests: the codemod's before/after list
// (scripts/stamina_baseline_codemod.ts, run with --dry) and the generated
// variants that follow their bases; the one boss whose digest did not move
// (choirmother_selthe) is the one whose gear def did not change.
// The trinket slot then added one trinket (content/trinkets.ts) to four
// final bosses' equipment partitions: morthen (bastion_sigil), vael
// (stormjar), ysolei (menders_hourglass) and wildheart_high_priest
// (paired_talons). Those four gearIds gained the trinket and their digests were
// re-minted; the digest over their PRE-trinket ids was verified unchanged, so no
// existing def moved.
// Re-minted 2026-10-08 for the loot redistribution (docs/design/dungeon-rework/
// README.md 7.1): the relocated Nythraxis pieces and raid trinkets joined the
// five-man heroic rolls, final bosses' epics spread over their dungeons, every
// lower dungeon boss gained a blue roll (normal digests) and its rare copies
// (gear lists), and the Gaol Turnkey and the Mere Hydra gained rows. Receipt:
// every boss's PREVIOUS gearIds still hashed to its previous gearDigest
// against the re-minted defs, so no item definition or level moved; only
// which items each boss pays changed.
// Re-minted 2026-10-09 when the dungeons' uncommon pieces left the Heroic
// tables (they drop on Normal only): eight bosses lost their greens from
// gearIds. Receipt: each boss's previous gearIds still hashed to its previous
// gearDigest against the current defs, so no item definition or level moved.
const BASELINE = {
  // Re-minted for the Hollow Crypt rework (docs/design/dungeon-rework/hollow_crypt.md
  // 8.1 and 8.2): every boss now carries its own table. Four shipped heroic epics
  // moved off Morthen (Cryptplate Helm to Sexton Marrow, the Bonechill Striders and
  // Cord to Rimeweb, the Shadowpulse Handwraps to Cantor Ilvane), none left the
  // game; their item defs are unchanged, only the boss that pays them moved.
  sexton_marrow: {
    gearIds: [
      'cryptplate_helm',
      'heroic_bellrope_mitts',
      'heroic_bonewrought_greatsword',
      'heroic_gravedirt_grips',
      'heroic_sextons_spadehaft',
      'heroic_spadeworn_gauntlets',
      'sextons_burial_spade',
    ],
    normalDigest: 'f07e48d99b1c384c50ed260a5d8b5951c5fd44b7eb81135bf2a3bb2330f7e6ab',
    gearDigest: '3f9c75d6579d1c9e0a4b9fad3ca29fc5daebd6d839ef73fdee2fe5d25a18507a',
  },
  rimeweb: {
    gearIds: [
      'bonechill_cord',
      'bonechill_striders',
      'heroic_courtiers_bonefang',
      'heroic_lamenting_veil',
      'heroic_rime_laced_hood',
      'heroic_rimeweb_fang',
      'heroic_rimewreath_coif',
      'rimesilk_hood',
    ],
    normalDigest: '28d6bb3705f5155881e944d858071457bc2fff6e65ddbe3b528425f42bd2403e',
    // Re-minted when the Rimesilk Hood moved onto the stamina model (int 11,
    // spi 7, sta 6: its 18-point caster line plus the 6-stamina baseline), and
    // again when the Lady's rework renamed the fang (display only: the heroic
    // twin reads its base's new name, Bride's Icicle; the old name reproduces
    // the previous digest, verified at the rename, so no stat moved).
    gearDigest: '87f555c7e2465b9bcb9ce3b31f79889e268ef0ac0b68e7ee91e01190ca642f8f',
  },
  cantor_ilvane: {
    gearIds: [
      'heroic_cantors_hymnal',
      'heroic_cantors_stole',
      'heroic_choirward_pauldrons',
      'heroic_choristers_spaulders',
      'heroic_votive_ward_of_the_deathless_court',
      'shadowpulse_handwraps',
      'shadowpulse_slippers',
    ],
    normalDigest: 'bd8086f86a2eb33fcd96aa481a389a19286ed2536a8082279565594bf0162460',
    gearDigest: '1842301c7e8371500253d2e9d055d622549e9b4785649c972d91be5a66c86584',
  },
  morthen: {
    gearIds: [
      'bastion_sigil',
      'heroic_candlewatch_jerkin',
      'heroic_gravecallers_rod',
      'heroic_knellbound_hauberk',
      'heroic_robe_of_the_unquiet_rite',
      'heroic_thornpeak_wardblade',
      'lunarward_cinch',
      'morthens_cryptforged_hauberk',
    ],
    normalDigest: '5d6ae5399615ed65d1a72890bdec2dec6be1d1c0e4afa111a5418e21fb217bd7',
    gearDigest: '2ecc80d8fbc40be313d72e79a03910874ea56e316e678a4ca1b890552ff060c7',
  },
  // Re-minted for the Sunken Bastion rework (docs/design/dungeon-rework/
  // sunken_bastion.md 8.1 and 8.2): Olen's normal table gains the Longsword row
  // and folds the Fenmist Robe into its guaranteed group; the new Gaoler Ossick
  // carries his own table. Three shipped heroic epics moved off Vael (the
  // Tideguard Faceguard and Fogforged Pauldrons to Olen, the Sash of the Sunken
  // Court to Ossick) and Olen's heroic uncommons stay on Vael's partition, so
  // none left the game; their item defs are unchanged, only the payer moved.
  knight_commander_olen: {
    gearIds: [
      'drowned_commanders_breastplate',
      'heroic_drowned_prayer_leggings',
      'heroic_eelscale_leggings',
      'heroic_knight_commanders_longsword',
      'heroic_stormhymn_chain_grips',
      'heroic_tideguard_greaves',
      'mistforged_pauldrons',
      'tideguard_faceguard',
    ],
    // Re-minted when the Longsword chase row joined Olen's shipped olen_bonus
    // group (same 0.1 chance), so a kill pays at most one rare.
    normalDigest: '4debee8849928cb91609f6a0c5d986ddeff42fb58b6f725c91a4288ed3670cea',
    gearDigest: 'bb215f084605abb3a4f7c325e615602878279f43c79690fb866d26480faf079a',
  },
  gaoler_ossick: {
    gearIds: [
      'gaolers_iron_key',
      'gaolyard_striders',
      'heroic_bramblehide_grips',
      'heroic_brinewarden_robe',
      'heroic_gaolyard_cudgel',
      'heroic_gaolyard_jerkin',
      'heroic_tidescale_vest',
      'mooring_stone',
      'sash_of_the_sunken_court',
    ],
    normalDigest: '9176140d149844688d4907a14694610d3ad6f475b52e0a130132325eae9de291',
    gearDigest: 'c9d8b2f1852d0e51b6b9f9ba70b2bb3e58044a0231bafd3ef5efe95169f725d2',
  },
  vael_the_mistcaller: {
    gearIds: [
      'heroic_bramblehide_treads',
      'heroic_direfang_quiver',
      'heroic_drowned_prayer_sandals',
      'heroic_eelscale_treads',
      'heroic_fogbinders_rod',
      'heroic_tideguard_sabatons',
      'mistcallers_fang',
      'stormjar',
      'tidebound_spaulders',
    ],
    normalDigest: '8917391dfc5e9fcd2da06099477d6b7b9a1444246f616b0aaf694276619c25fa',
    gearDigest: 'b885ac64a58cca05122e3ce0d20082f5e57c4943f0ce893365b3b600bed5faab',
  },
  // Re-minted for the Drowned Temple rework (docs/design/dungeon-rework/
  // drowned_temple.md section 8): Selthe's normal table gains a guaranteed
  // archetype group and the Chorus Conch row, the new Tideglass Colossus carries
  // his own table, and each gains one new heroic epic. Four shipped heroic
  // pieces moved off Ysolei (the Choirmother's Casque to Selthe; the Lunar
  // Choir Leggings, Tidewoven Trousers and Tideworn Warboots to the Colossus),
  // none left the game; their item defs are unchanged, only the payer moved.
  choirmother_selthe: {
    gearIds: [
      'choirmothers_casque',
      'heroic_chorus_conch',
      'heroic_conchplate_sabatons',
      'heroic_pale_chorus_slippers',
      'heroic_selthes_seastriders',
      'heroic_stormhymn_chain_treads',
      'pale_chorus_vestment',
    ],
    normalDigest: '65d1d9fbfcd9815214f89cd2d96ea846dddd2914db490c0e2e9436989ff65f7e',
    gearDigest: 'f8eed90e5f67e9cfd3c70722d38a23849aa8ea49e7a59c613167d3ef5cba3557',
  },
  tideglass_colossus: {
    gearIds: [
      'echoing_lens',
      'heroic_bramblehide_legguards',
      'heroic_moonburn_grips',
      'heroic_prism_etched_handwraps',
      'heroic_tideglass_gauntlets',
      'heroic_tideglass_shiv',
      'lunar_choir_leggings',
      'tideglass_warmaul',
      'tideworn_warboots',
      'tidewoven_trousers',
    ],
    normalDigest: '9d27de1f80a3039fdf7f9c830801bef379c3ea7378568dad38dee6acd51c723c',
    gearDigest: '9b74b7040c66ec2fc57abd52f95d67c37ec507e6a4f2a4ec87a52c1ae36c3978',
  },
  ysolei: {
    gearIds: [
      'heroic_moonshroud_breastplate',
      'heroic_moonshroud_robe',
      'heroic_moonshroud_tunic',
      'heroic_moonwrack_stave',
      'heroic_thornpeak_moonhide_cowl',
      'heroic_ysols_pearl_greaves',
      'lunar_tide_greatstaff',
      'menders_hourglass',
    ],
    normalDigest: 'a9976a6c091381043ffca9d95c2e6e735c5188fddcb11577d0a333ba7084c7d5',
    gearDigest: '409eeb52fc34643e0c104ee73a25a2518713da20aabeca96badcce4b26931aad',
  },
  // Re-minted for the Gravewyrm Sanctum rework (gravewyrm_sanctum.md 9.1 and
  // 9.2): Korgath and Velkhar drop their own normal trios (the shared
  // Korzul trio left their normal tables, so their normalDigest moved) and
  // each heroic partition gains its new epic and trinket (Korzul a trinket),
  // the shipped rows keeping their ratios. No existing item def changed.
  korgath_the_bound: {
    gearIds: [
      'foremans_last_link',
      'gravescale_girdle',
      'gravewyrm_claws',
      'hammer_of_the_open_lock',
      'heroic_bonewrought_bulwark',
      'heroic_bonewrought_greatsword',
      'heroic_boundstone_girdle',
      'heroic_boundstone_helm',
      'heroic_deathlord_warplate',
      'heroic_deathlords_dread_visage',
      'heroic_gravewyrm_gauntlets',
      'heroic_gravewyrm_mantle',
      'heroic_gravewyrm_sabatons',
      'heroic_korgaths_chainwraps',
      'heroic_shadowmeld_tunic',
      'heroic_staff_of_velkhar',
      'heroic_thornpeak_wardblade',
      'heroic_wyrmcult_grand_robe',
      'heroic_wyrmcult_soulsteps',
      'heroic_wyrmfang_greatblade',
      'heroic_wyrmshadow_treads',
    ],
    normalDigest: 'a0d9dfeea48e421978c3c1a27aa11c1aad7dc6d568cbf5d517c79bc85e663dbc',
    gearDigest: '14ad38be49a5f4495f3c4f0670ee5007b5d5cf71b73e223d943929c394a57ff6',
  },
  grand_necromancer_velkhar: {
    gearIds: [
      'heroic_boneguard_breastplate',
      'heroic_courtiers_bonefang',
      'heroic_deathlord_legguards',
      'heroic_gravewyrm_stalkers_treads',
      'heroic_grovewardens_grips',
      'heroic_necromancers_soulspire_mantle',
      'heroic_necromancers_soulsteps',
      'heroic_necromancers_starshroud',
      'heroic_shadowmeld_tunic',
      'heroic_staff_of_the_gravewyrm',
      'heroic_staff_of_velkhar',
      'heroic_votive_ward_of_the_deathless_court',
      'heroic_wildgrowth_leggings',
      'heroic_wraithfire_orb',
      'heroic_wyrmshadow_legguards',
      'phial_of_the_tithe',
      'sanctum_prowlers_grips',
      'vestments_of_the_waking_rite',
      'wyrmchoir_handwraps',
    ],
    normalDigest: '859a210340367eb11461edcb9857aa0b9937bbf25c81f99d2b4ec947eed83302',
    gearDigest: '5742740a4b9d149b8a5af5f0b4745dde1efb2cad38c19d1553f0f3ffaf7958bc',
  },
  korzul_the_gravewyrm: {
    gearIds: [
      'gravewyrm_cleaver',
      'heroic_fang_of_korzul',
      'heroic_gravecourt_hewer',
      'heroic_gravewyrm_bone_quiver',
      'heroic_nightfangs_greatstaff',
      'heroic_stormhymn_chain_grips',
      'heroic_stormhymn_chain_treads',
      'heroic_verdant_walkers',
      'heroic_wyrmshadow_harness',
      'heroic_wyrmshadow_talongrips',
      'quenchwater_flask',
      'shroud_of_the_gravewyrm',
      'wildsoul_maul',
    ],
    normalDigest: '4aed8727dccd1d8ad7f7e1027b40145472b282246b10dc3963772e95056a6b8d',
    gearDigest: '5ada5de88b43c548d305ed10bce03b31b02c8fb63f3ec740c9df2990404944dc',
  },
  // The Wildheart Basin rework (docs/design/dungeon-rework/wildheart_basin.md
  // 8.1 and 8.2): the promoted Fanglord Beastmaster and the Gorgebloom carry
  // their own normal tables and heroic partitions. Two of Zulgar's shipped epics
  // moved: the Bloodmane War-Legguards to the Beastmaster, the Sunbone Oracle's
  // Crown to the Gorgebloom. Zulgar's gearDigest was re-minted over his eleven
  // remaining ids; the digest over his former thirteen (62b6f9de...) was
  // verified unchanged against the live defs, so no shipped def moved, and his
  // normalDigest is untouched (his normal table did not change).
  wildheart_beastmaster: {
    gearIds: [
      'bloodmane_war_legguards',
      'fanglords_hide_mantle',
      'fanglords_whistle',
      'heroic_bramblehide_grips',
      'heroic_bramblehide_treads',
      'heroic_direfang_greatblade',
      'heroic_direfang_quiver',
      'heroic_duskwhisper',
      'heroic_fanglords_beastspear',
      'hunters_tally',
    ],
    normalDigest: '501676841dcaafeaa5c2b1b7d4538269c33e47e31d4eb309914536d903698c73',
    gearDigest: '71f270d3831e04445d9223a92781888bd82055c90e038d9438f8ff0b448a3fc6',
  },
  the_gorgebloom: {
    gearIds: [
      'gorgebloom_seedpod',
      'heroic_bramblehide_cinch',
      'heroic_bramblehide_crown',
      'heroic_bramblehide_mantle',
      'heroic_falls_blessed_staff',
      'sunbone_oracles_crown',
      'thornroot_greathelm',
      'wellspring_seed',
    ],
    normalDigest: '7d4066ff289d73e4f10632dfb44d88d6ed206f5355a859d83d3bf99df2415bcb',
    // Re-pinned when the Falls-Blessed Staff (and its heroic copy) joined the
    // shared caster-weapon set: paladins may wield it. requiredClass only; the
    // stats, level and acquisition are unchanged.
    gearDigest: '4991bcb5ebcd160590900e16db94e5d4b29dea359714ea56cf712c5cacaa5bc5',
  },
  wildheart_high_priest: {
    gearIds: [
      'basin_stalkers_tunic',
      'greatfang_of_the_basin',
      'heroic_bramblehide_harness',
      'heroic_bramblehide_legguards',
      'heroic_thornpeak_moonhide_cowl',
      'heroic_wildheart_fangknife',
      'heroic_wildheart_hexwood_staff',
      'heroic_wildheart_tuskblade',
      'paired_talons',
      'sunbone_ritual_hauberk',
      'verdant_heart_vestment',
    ],
    normalDigest: 'a75b69d4c5bebc4bfd9990229e494df00a53aaa8b3372aa56e803f7b5d5fd224',
    gearDigest: 'f1272ee3496342b19cb27e7e2b5695c462762ace475de0691237ba0b41c0d986',
  },
  // The Gaol Turnkey gained a heroic roll on 2026-10-08 (two of Vael's epics,
  // its relocated Nythraxis piece, its blue roll's rare copies).
  gaol_turnkey: {
    gearIds: [
      'dreamroot_boots',
      'heroic_bramblehide_cinch',
      'heroic_cellwatch_belt',
      'heroic_lanternwick_sash',
      'heroic_portcullis_girdle',
      'heroic_turnkeys_shank',
      'sunken_court_mantle',
    ],
    normalDigest: 'fdfbaae76353fbd71016cb1539f015d24002b6de39579a47c915ad65ceff8d1f',
    gearDigest: 'fd58c6160af539a2c8877be971f96f8ea241ffadc7c8a5de7707722abd07b628',
  },
  // The Mere Hydra's centre head carries the fight's one roll since
  // 2026-10-08 (two of Ysolei's epics, its relocated Nythraxis piece, its blue
  // roll's rare copies).
  mere_hydra_head_center: {
    gearIds: [
      'choir_blessed_spaulders',
      'heroic_bramblehide_mantle',
      'heroic_mere_crested_helm',
      'heroic_merecleaver',
      'heroic_mereskin_hood',
      'heroic_merewater_cowl',
      'stormbark_mantle',
    ],
    normalDigest: '1db78a1fac3eb0794de3f0990231c2cdddda1863dd89fdbbe49844bc44e6436d',
    gearDigest: 'b889ae233a25826154a0a38070075f5f3927195045c780e76d066294da3107b1',
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

  // Every equipment id any mob's own (Normal) table pays.
  const normalGearIds = new Set(
    Object.values(MOBS).flatMap((mob) =>
      (mob.loot ?? []).flatMap((entry) =>
        entry.itemId && ITEMS[entry.itemId]?.slot && ITEMS[entry.itemId]?.kind !== 'bag'
          ? [entry.itemId]
          : [],
      ),
    ),
  );

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

    it(bossId + ' pays no Normal gear on a Heroic kill', () => {
      // Every row a Heroic claim can roll: the base rows that are not
      // normalOnly, as the roller upgrades them, plus the Heroic table. None
      // may be uncommon, nor the same item a Normal table pays anywhere.
      const claimIds = [
        ...MOBS[bossId].loot
          .filter((entry) => entry.itemId && lootEntryRollsOnClaim(entry, true))
          .map((entry) => heroicLootItemId(entry.itemId!, true)),
        ...(HEROIC_BOSS_LOOT[bossId] ?? []).flatMap((entry) =>
          entry.itemId ? [entry.itemId] : [],
        ),
      ];
      const gear = claimIds.filter((id) => ITEMS[id]?.slot && ITEMS[id]?.kind !== 'bag');
      expect(gear.length).toBeGreaterThan(0);
      for (const id of gear) {
        expect(ITEMS[id].quality, id).toMatch(/^(rare|epic|legendary)$/);
        expect(normalGearIds.has(id), id + ' also drops on Normal').toBe(false);
      }
    });

    it(bossId + ' preserves the complete Normal loot table and probabilities', () => {
      const normalLoot = MOBS[bossId].loot.map(({ normalOnly: _normalOnly, ...entry }) => entry);
      expect(digest(normalLoot)).toBe(baseline.normalDigest);
    });
  }
});
