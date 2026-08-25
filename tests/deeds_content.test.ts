// Book of Deeds catalog integrity: every id, reference, mark, and total in
// src/sim/content/deeds.ts resolves against the real content tables, and the
// audited launch totals are pinned as LITERALS (update deliberately when the
// catalog changes, never by copying the computed value back).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { POWERUPS } from '../src/sim/content/augments';
import { DEED_ORDER, DEEDS, DEEDS_ERA } from '../src/sim/content/deeds';
import { drownedLitanyChestItemsForTier } from '../src/sim/content/delves/drowned_litany_loot';
import { delveChestItemsForTier } from '../src/sim/content/delves/lockpick_tiers';
import { DELVE_MOBS } from '../src/sim/content/delves/mobs';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { FARM_CROP_IDS, FARM_CROPS } from '../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import {
  FISHING_RARE_ID,
  FISHING_TABLES_BY_BAND,
  RAW_COOKING_CATCH_IDS,
} from '../src/sim/content/items';
import { MAGE_PET_MOBS } from '../src/sim/content/mage_pets';
import { NECROMANCY_MOBS } from '../src/sim/content/necromancy';
import {
  CRAFT_RING,
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
} from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import {
  RIFT_EPIC_ITEM_IDS,
  RIFT_GEAR_ITEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  RIFT_RARE_ITEM_IDS,
} from '../src/sim/content/rift/items';
import { RIFT_MOBS } from '../src/sim/content/rift/mobs';
import { WARLOCK_PET_MOBS } from '../src/sim/content/warlock_pets';
import { YUMI_TEMPLATE_ID } from '../src/sim/content/yumi';
import {
  CAMPS,
  DELVES,
  DUNGEONS,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
} from '../src/sim/data';
import {
  FARM_CHRONICLE_ZONES,
  GROUND_PICKUP_PROVING_QUESTS,
  MAX_CREDITABLE_MOB_LEVEL,
  MILESTONE_DEED_TO_LEGACY,
  onFishCaughtForDeeds,
  RARE_SLAIN_TEMPLATES,
  restoreDeedStats,
  serializeDeedStats,
  VISITED_MARK_NAMESPACES,
  ZONE_FISH,
} from '../src/sim/deeds';
import type { LootTier } from '../src/sim/lockpick';
import { MARKET_HOUSE_STOCK } from '../src/sim/market';
import {
  craftSkillGainMultiplier,
  enchantingGainMultiplier,
} from '../src/sim/professions/archetype';
import { farmingTeachingCeilingFor } from '../src/sim/professions/farming';
import { APEX_FEAST_CRAFT_MARK, isApexFeastRecipe } from '../src/sim/professions/feast';
import { RIFT_LEVEL_CAP, RIFT_MAX_MOB_LEVEL } from '../src/sim/rift/rift_gen';
import type { Rng } from '../src/sim/rng';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { ALL_CLASSES, DEED_STAT_KEYS, type DeedCategory, MILESTONES } from '../src/sim/types';

const ALL = DEED_ORDER.map((id) => DEEDS[id]);

const PREFIX_CATEGORY: Record<string, DeedCategory> = {
  prog_: 'progression',
  cmb_: 'combat',
  dgn_: 'dungeon',
  dlv_: 'delve',
  chr_: 'chronicle',
  col_: 'collection',
  pvp_: 'pvp',
  soc_: 'social',
  exp_: 'exploration',
  feat_: 'feat',
  hid_: 'hidden',
};

describe('audited launch totals (literals: update deliberately with the catalog)', () => {
  it('ships exactly 290 deeds worth 3295 total Renown', () => {
    // Release base (262 / 3145 after the WARFARE lifetime-honor ladder) plus
    // four Reliquary Curator rank bridges and the five Phase 18 completion
    // ladder deeds (all nine renown 0: catalog prestige never scores the
    // board), plus the release's walk-in castle visit pair (exp_the_last_keep,
    // exp_dawnhold_castle, renown 5 each), plus prog_jewelcrafting_rare
    // (renown 10, the Masterwrought phase 05 jewelcrafting base catalog), plus
    // the phase 05 QA ruling pair prog_jewelcrafting_50 (renown 5) and
    // prog_grandmaster_jewelcrafting (renown 25) joining their cross-craft
    // families, plus the phase 06 inscription base catalog's three
    // (prog_inscription_rare 10, prog_inscription_50 5,
    // prog_grandmaster_inscription 25), plus the seven farming celebration
    // deeds of the absorbed packet (D13: prog_first_planting and the four
    // first-harvest chronicles at renown 5, col_golden_harvest at 0 per the
    // luck rule, prog_farming_100 at the profession-100 family value of 10,
    // so +35 Renown in all), plus Phase 11e's roster deed col_farm_roster
    // (renown 5, the gathering ladder's first-rung point), which took this to
    // 288 / 3285, plus Phase 11k's cross-packet deed prog_field_to_feast
    // (renown 5, no title), which takes it to 289 / 3290.
    //
    // PREDICTED THEN OBSERVED, which is the method that tells an append from a
    // lost row: the preceding phase's ledger recorded 288 / 3285, this phase
    // adds exactly one deed at exactly renown 5, so 289 / 3290 was written
    // BEFORE the run and matched it.
    //
    // Then the release/v0.41.0 merge. The release's own chain reads 274 / 3160
    // (its 262 / 3145 base plus the nine zero-Renown Reliquary rows, the
    // walk-in castle visit pair, and the Proving Shore graduation deed
    // prog_ready_for_an_adventure at renown 5). The merge adds exactly that
    // one deed at exactly renown 5 to this branch's 289 / 3290, so
    // 290 / 3295 was written BEFORE the merged tree was measured and matched
    // it; both parents' frozen catalog hashes reproduce from the merged
    // table (see FROZEN_CATALOG_SHA256 below), which is the proof of a pure
    // append on both sides.
    expect(DEED_ORDER.length).toBe(290);
    expect(ALL.reduce((sum, d) => sum + d.renown, 0)).toBe(3295);
  });

  it('ships the audited per-category counts', () => {
    const byCategory: Record<string, number> = {};
    for (const d of ALL) byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    expect(byCategory).toEqual({
      // +1 jewelcrafting rare-tier milestone (Masterwrought phase 05), then
      // +2 for the phase 05 QA ruling pair (the 50-skill and Grandmaster
      // jewelcrafting milestones joining their cross-craft families), then
      // +3 for the phase 06 inscription trio (rare-tier, 50-skill, and
      // Grandmaster) landing the same three families at the table tail, then
      // +2 farming celebrations (prog_first_planting, prog_farming_100), then
      // +1 Phase 11k's cross-packet prog_field_to_feast, then
      // +1 the Proving Shore graduation (prog_ready_for_an_adventure) at the
      // release/v0.41.0 merge (the release's own chain read 58).
      progression: 67,
      combat: 10,
      // +2 Rift coverage deeds (dgn_rift, dgn_rift_s_rank).
      dungeon: 31,
      delve: 13,
      // +4 farming first-harvest chronicles (chr_*_first_harvest).
      chronicle: 53,
      // +4 Reliquary Curator rank bridges and +5 Phase 18 completion ladder
      // deeds on top of the release collection set, +1 col_golden_harvest.
      collection: 40,
      // Release's Thornhollow battlegrounds plus the WARFARE honor ladder.
      pvp: 35,
      social: 18,
      exploration: 11,
      feat: 3,
      hidden: 9,
    });
  });

  it('pins the catalog-refresh additions: ids, order, and renown literals', () => {
    // The refresh tail appends AFTER the 186-deed launch set; both the launch
    // block and the tail are order-pinned so any insertion or reorder reds.
    expect(DEED_ORDER[185]).toBe('hid_codfather');
    expect(DEED_ORDER.slice(186)).toEqual([
      'prog_crown_below',
      'prog_mere_at_rest',
      'prog_callused_hands',
      'prog_tools_of_the_trade',
      'dgn_nythraxis_crypt',
      'chr_marsh_first_cast',
      'pvp_card_duel_first_win',
      // Professions 2.0 tail (order-pinned like the block above).
      'prog_guildsworn',
      'prog_masterwright',
      'prog_fishing_100',
      'prog_master_angler',
      'prog_engineering_50',
      'prog_alchemy_50',
      'prog_cooking_50',
      'prog_leatherworking_50',
      'prog_tailoring_50',
      'prog_enchanting_50',
      'prog_weaponcrafting_50',
      'prog_armorcrafting_50',
      'prog_grandmaster_engineering',
      'prog_grandmaster_alchemy',
      'prog_grandmaster_cooking',
      'prog_grandmaster_leatherworking',
      'prog_grandmaster_tailoring',
      'prog_grandmaster_enchanting',
      'prog_grandmaster_weaponcrafting',
      'prog_grandmaster_armorcrafting',
      'col_pristine_vein',
      'col_ancient_heartwood',
      'col_moonlit_bloom',
      'col_perfect_specimen',
      'soc_first_salvage',
      'soc_salvage_50',
      // The Wildheart Basin dungeon deeds append after the
      // Professions 2.0 tail (the release base merge put that tail first).
      'dgn_wildheart_basin',
      'dgn_wildheart_basin_heroic',
      // The zone-3 gatherer chronicle (R21) closes the per-zone gatherer
      // line; its marks had been written unconsumed since the t3 veins.
      'chr_peaks_gatherer',
      // Camp rares missed by the first reckoning (bug fix; see the
      // RARE_SLAIN_TEMPLATES coverage test below).
      'chr_marsh_rares_ii',
      'chr_peaks_rares_ii',
      'chr_gleamstag',
      'chr_hollow_rares',
      // Thornhollow Fields battleground block (order-pinned like the blocks above;
      // the catalog carries it ahead of the chronicle pairs the release appended).
      'pvp_bg_first_capture',
      'pvp_bg_first_win',
      'pvp_bg_wins_25',
      'pvp_bg_captures_100',
      // The phase 20 bottom-map chronicle pairs (Q26): the gatherer and
      // first-cast deeds the strip zones carry, for the three zones the
      // density pass brought to strip density.
      'chr_willowfen_gatherer',
      'chr_willowfen_first_cast',
      'chr_galecrest_gatherer',
      'chr_galecrest_first_cast',
      'chr_farshore_gatherer',
      'chr_farshore_first_cast',
      // The Drakelands dragonkin brood rework (v0.35): the new standing
      // broodlord rares, plus quest-trigger credit for Cindraleth, the
      // shipped capstone the first reckoning never credited.
      'chr_drakemaw_broodlord',
      'chr_maw_matriarch',
      // Rift coverage (procedural infinite-dungeon system, no fixed
      // dungeonId to key a dungeonClears trigger against).
      'dgn_rift',
      'dgn_rift_s_rank',
      // Basic universal profession deeds (issue #2055): per-craft rare-tier
      // milestones, appended after the Rift coverage block above (the
      // rebase onto the release base put the Rift pair first).
      'prog_engineering_rare',
      'prog_alchemy_rare',
      'prog_cooking_rare',
      'prog_leatherworking_rare',
      'prog_tailoring_rare',
      'prog_weaponcrafting_rare',
      'prog_armorcrafting_rare',
      // The remaining starter-tier zones pick up the same chronicle pair
      // (drakelands already covered above by the brood rework), appended
      // after the profession-rare block above (the release base merge put
      // that block first).
      'chr_frostveil_gatherer',
      'chr_frostveil_first_cast',
      'chr_amberfall_gatherer',
      'chr_amberfall_first_cast',
      'chr_nightbloom_gatherer',
      'chr_nightbloom_first_cast',
      'chr_wraithwood_gatherer',
      'chr_wraithwood_first_cast',
      'chr_palmreach_gatherer',
      'chr_palmreach_first_cast',
      'chr_evergarden_gatherer',
      'chr_evergarden_first_cast',
      // Reliquary Curator rank bridges (zero Renown; catalog prestige never
      // scores the board). Manual grant via syncCuratorRankDeeds. Appended
      // after the starter-zone chronicle block across the release merge.
      'col_reliquary_rank_2',
      'col_reliquary_rank_3',
      'col_reliquary_rank_4',
      'col_reliquary_rank_5',
      // WARFARE lifetime-honor ladder, the release side of the same merge.
      'pvp_honor_sergeant',
      'pvp_honor_knight_lieutenant',
      'pvp_honor_field_marshal',
      // The Reliquary completion ladder (Phase 18; zero Renown, manual grant
      // via syncReliquaryCompletionDeeds, sticky against catalog growth).
      'col_reliquary_complete',
      'col_reliquary_conquerors',
      'col_reliquary_illum_nythraxis_heroic',
      'col_reliquary_illum_thunzharr',
      'col_reliquary_illum_gravewyrm_heroic',
      // The release's walk-in castle visit pair sits ahead of the branch's
      // craft milestones so the eventual release merge stays a pure tail
      // append: the Last Keep's deed retro-fixes its shipped-without-deeds
      // gap, Dawnhold's lands with its castle (both keyed on the enterDungeon
      // markVisited emit). The release's own list reads the same pair here.
      'exp_the_last_keep',
      'exp_dawnhold_castle',
      // Jewelcrafting joins the per-craft rare-tier family with the
      // Masterwrought phase 05 base catalog (appended at the tail:
      // DEED_ORDER is append-only, so it cannot sit beside its siblings),
      // then the phase 05 QA ruling appends its 50-skill and Grandmaster
      // milestones behind it.
      'prog_jewelcrafting_rare',
      'prog_jewelcrafting_50',
      'prog_grandmaster_jewelcrafting',
      // Inscription joins all three families with the Masterwrought phase 06
      // base catalog, the jewelcrafting shape exactly.
      'prog_inscription_rare',
      'prog_inscription_50',
      'prog_grandmaster_inscription',
      // The farming celebration deeds (D13): the first-planting proof, the
      // masterwrought Phase 11i's one deed, ahead of the farming block because
      // that block stays last and contiguous under the packet's three-tier
      // ordering. The angler's endgame ships exactly ONE row, deliberately: the
      // per-profession gathering ladder is complete at 5 / 10 / 25 and no
      // profession has a rung at 50 or 150.
      'col_deepest_cast',
      // four per-hub first-harvest chronicles, the golden-harvest rare find,
      // and the Farming 100 milestone with the Harvestmaster title.
      'prog_first_planting',
      'chr_vale_first_harvest',
      'chr_marsh_first_harvest',
      'chr_peaks_first_harvest',
      'chr_evergarden_first_harvest',
      'col_golden_harvest',
      'prog_farming_100',
      'col_farm_roster',
      // Phase 11k's cross-packet deed, the branch's tail. Appended at the
      // literal end under the 11b three-tier ordering rule, which keeps the
      // farming block contiguous ahead of it.
      'prog_field_to_feast',
      // The Proving Shore graduation closes the merged tail (appended at the
      // release/v0.41.0 merge behind the branch's rows, keeping both sides'
      // tails in their own authored order).
      'prog_ready_for_an_adventure',
    ]);
    expect(DEEDS.dgn_wildheart_basin.renown).toBe(10);
    expect(DEEDS.dgn_wildheart_basin_heroic.renown).toBe(10);
    expect(DEEDS.dgn_wildheart_basin.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'wildheart_basin',
      count: 1,
    });
    expect(DEEDS.prog_crown_below.renown).toBe(25);
    expect(DEEDS.prog_mere_at_rest.renown).toBe(25);
    expect(DEEDS.prog_callused_hands.renown).toBe(5);
    expect(DEEDS.prog_tools_of_the_trade.renown).toBe(10);
    expect(DEEDS.dgn_nythraxis_crypt.renown).toBe(10);
    expect(DEEDS.chr_marsh_first_cast.renown).toBe(5);
    expect(DEEDS.pvp_card_duel_first_win.renown).toBe(5);
    expect(DEEDS.pvp_card_duel_first_win.trigger).toEqual({
      kind: 'stat',
      stat: 'cardDuelsWon',
      count: 1,
    });
    // Full trigger literals: the evaluator's .every() is proven elsewhere, but
    // only a literal pin catches a quest id quietly dropped from a chain list.
    expect(DEEDS.prog_crown_below.trigger).toEqual({
      kind: 'quests',
      questIds: [
        'q_nythraxis_restless_dead',
        'q_nythraxis_graves',
        'q_nythraxis_sealed_crypt',
        'q_nythraxis_bound_guardian',
        'q_nythraxis_scourges_end',
      ],
    });
    expect(DEEDS.prog_mere_at_rest.trigger).toEqual({
      kind: 'quests',
      questIds: ['q_drowned_choir', 'q_palecoil', 'q_silence_the_choir', 'q_drowned_moon'],
    });
    expect(DEEDS.prog_callused_hands.trigger).toEqual({
      kind: 'quest',
      questId: 'q_prof_intro',
    });
    expect(DEEDS.prog_tools_of_the_trade.trigger).toEqual({
      kind: 'stat',
      stat: 'hubCraftsPerformed',
      count: 1,
    });
    expect(DEEDS.dgn_nythraxis_crypt.trigger).toEqual({
      kind: 'quest',
      questId: 'q_nythraxis_sealed_crypt',
    });
    expect(DEEDS.chr_marsh_first_cast.trigger).toEqual({
      kind: 'visit',
      markId: 'fish:mirefen_marsh',
    });
    expect(DEEDS.chr_marsh_rares_ii.renown).toBe(5);
    expect(DEEDS.chr_marsh_rares_ii.trigger).toEqual({ kind: 'visit', markId: 'slain:grubjaw' });
    expect(DEEDS.chr_peaks_rares_ii.renown).toBe(10);
    expect(DEEDS.chr_peaks_rares_ii.trigger).toEqual({
      kind: 'visits',
      markIds: ['slain:old_cragmaw', 'slain:shardlord_kazzix'],
    });
    expect(DEEDS.chr_gleamstag.renown).toBe(5);
    expect(DEEDS.chr_gleamstag.trigger).toEqual({ kind: 'visit', markId: 'slain:gleamstag' });
    expect(DEEDS.chr_hollow_rares.renown).toBe(10);
    expect(DEEDS.chr_hollow_rares.trigger).toEqual({
      kind: 'visits',
      markIds: ['slain:old_marrowshell', 'slain:aurelhorn'],
    });
    expect(DEEDS.chr_drakemaw_broodlord.renown).toBe(10);
    expect(DEEDS.chr_drakemaw_broodlord.trigger).toEqual({
      kind: 'visit',
      markId: 'slain:drakemaw_broodlord',
    });
    expect(DEEDS.chr_maw_matriarch.renown).toBe(10);
    expect(DEEDS.chr_maw_matriarch.trigger).toEqual({
      kind: 'quest',
      questId: 'q_dk_matriarch_of_the_maw',
    });
  });

  it('pins the Rift coverage: renown and trigger literals', () => {
    expect(DEEDS.dgn_rift.category).toBe('dungeon');
    expect(DEEDS.dgn_rift.renown).toBe(5);
    expect(DEEDS.dgn_rift.trigger).toEqual({ kind: 'stat', stat: 'riftClears', count: 1 });
    expect(DEEDS.dgn_rift.hidden ?? false).toBe(false);
    expect(DEEDS.dgn_rift.feat ?? false).toBe(false);
    expect(DEEDS.dgn_rift_s_rank.category).toBe('dungeon');
    expect(DEEDS.dgn_rift_s_rank.renown).toBe(25);
    expect(DEEDS.dgn_rift_s_rank.trigger).toEqual({
      kind: 'stat',
      stat: 'riftSRankClears',
      count: 1,
    });
    expect(DEEDS.dgn_rift_s_rank.hidden ?? false).toBe(false);
    expect(DEEDS.dgn_rift_s_rank.feat ?? false).toBe(false);
  });

  it('pins the walk-in castle visits: renown and trigger literals', () => {
    // The castle visit pair: routine renown-5 walk-ins, no reward beyond it.
    expect(DEEDS.exp_the_last_keep.renown).toBe(5);
    expect(DEEDS.exp_the_last_keep.trigger).toEqual({
      kind: 'visit',
      markId: 'dungeon:the_last_keep',
    });
    expect(DEEDS.exp_the_last_keep.reward).toBeUndefined();
    expect(DEEDS.exp_dawnhold_castle.renown).toBe(5);
    expect(DEEDS.exp_dawnhold_castle.trigger).toEqual({
      kind: 'visit',
      markId: 'dungeon:dawnhold_castle',
    });
    expect(DEEDS.exp_dawnhold_castle.reward).toBeUndefined();
  });

  it('pins the professions additions: renown and trigger literals', () => {
    // The Craftsworn/Masterwright pair (marquee: renown 25 plus a title each).
    expect(DEEDS.prog_guildsworn.renown).toBe(25);
    expect(DEEDS.prog_guildsworn.trigger).toEqual({
      kind: 'stat',
      stat: 'attunementsCompleted',
      count: 1,
    });
    expect(DEEDS.prog_guildsworn.reward).toEqual({ kind: 'title', text: 'Craftsworn' });
    expect(DEEDS.prog_masterwright.renown).toBe(25);
    expect(DEEDS.prog_masterwright.trigger).toEqual({
      kind: 'stat',
      stat: 'masterworksCrafted',
      count: 1,
    });
    expect(DEEDS.prog_masterwright.reward).toEqual({ kind: 'title', text: 'Masterwright' });
    // Fishing milestones: 100 parallels the other gathering 100s (renown 10),
    // 200 is fishing's resolved cap (content/professions.ts maxSkill).
    expect(DEEDS.prog_fishing_100.renown).toBe(10);
    expect(DEEDS.prog_fishing_100.trigger).toEqual({
      kind: 'gathering',
      professionId: 'fishing',
      amount: 100,
    });
    expect(DEEDS.prog_master_angler.renown).toBe(25);
    expect(DEEDS.prog_master_angler.trigger).toEqual({
      kind: 'gathering',
      professionId: 'fishing',
      amount: 200,
    });
    expect(DEEDS.prog_master_angler.reward).toEqual({ kind: 'title', text: 'Master Angler' });
    // Per-craft milestones for the crafts whose milestone pair has shipped:
    // the seven Professions 2.0 recipe-homed crafts plus enchanting,
    // jewelcrafting since the phase 05 QA ruling authored its pair, and
    // inscription since the phase 06 base catalog shipped its trio in the
    // same change (each base catalog gave its craft a live skill-gain path
    // to the 125 cap, so the hold was authoring, not mechanics). The shipped
    // pair is rare-teach tier 50 at renown 5, the resolved cap 125 at renown
    // 25 with a Grandmaster title. EVERY craft threshold in the catalog
    // equals a resolved cap or sits below it, and no deed references the
    // classic 300 scale anywhere.
    const earnableCrafts = [
      'engineering',
      'alchemy',
      'cooking',
      'leatherworking',
      'tailoring',
      'enchanting',
      'weaponcrafting',
      'armorcrafting',
      'jewelcrafting',
      'inscription',
    ];
    for (const craftId of earnableCrafts) {
      const cap = CRAFT_RING.find((c) => c.id === craftId)?.maxSkill;
      expect(cap, craftId).toBe(125);
      const mid = DEEDS[`prog_${craftId}_50`];
      expect(mid.renown, mid.id).toBe(5);
      expect(mid.trigger).toEqual({ kind: 'craftSkill', craftId, level: 50 });
      const grand = DEEDS[`prog_grandmaster_${craftId}`];
      expect(grand.renown, grand.id).toBe(25);
      expect(grand.trigger).toEqual({ kind: 'craftSkill', craftId, level: 125 });
      const name = CRAFT_RING.find((c) => c.id === craftId)?.name as string;
      expect(grand.reward).toEqual({ kind: 'title', text: `Grandmaster ${name}` });
    }
    for (const def of ALL) {
      const t = def.trigger;
      if (t.kind === 'craftSkill') {
        const cap =
          t.craftId !== undefined
            ? (CRAFT_RING.find((c) => c.id === t.craftId)?.maxSkill ?? 0)
            : Math.max(...CRAFT_RING.map((c) => c.maxSkill));
        expect(t.level, def.id).toBeLessThanOrEqual(cap);
        // EARNABILITY, derived from the live gain machinery rather than
        // asserted in prose: a character ONE skill point short of the
        // threshold must still gain from SOME shipped recipe rung under the
        // craft's best-available ceiling, attuned with the craft as a MAJOR
        // (archetypeCeilingFor returns Infinity for a major; the
        // hobby/unattuned rare ceiling already suffices for every craft
        // except engineering, whose ladder waits for its oath, exactly as
        // the guide's whatBody says). The cap-only check above would
        // greenlight a deed for a craft with no gain path at all (a
        // hypothetical prog_inscription_50, which the no-recipes arm reds);
        // this arm also reds a TIER_SKILL_STEP or four-state-curve re-tune
        // that silently strands a shipped titled deed as
        // visible-but-unearnable (design rule 3). Enchanting is the one
        // recipe-less craft: it gains through the disenchant arm's SOFT
        // ceiling, which degrades input instead of zeroing, checked with
        // top-tier input for the same one-point-short character.
        if (t.craftId !== undefined) {
          const craftId = t.craftId;
          const oneShort = { [craftId]: t.level - 1 };
          if (craftId === 'enchanting') {
            expect(
              enchantingGainMultiplier(oneShort, null, null, null, 4),
              `${def.id}: enchanting gain at ${t.level - 1}`,
            ).toBeGreaterThan(0);
          } else {
            const rungs = ALL_RECIPES.filter((r) => r.professionId === craftId).map(
              (r) => r.skillReq ?? 0,
            );
            expect(rungs.length, `${def.id}: ${craftId} ships no recipes`).toBeGreaterThan(0);
            const gain = Math.max(
              ...rungs.map((rung) =>
                craftSkillGainMultiplier(oneShort, craftId, craftId, craftId, null, rung),
              ),
            );
            expect(
              gain,
              `${def.id}: no shipped ${craftId} rung grants at skill ${t.level - 1} as a major`,
            ).toBeGreaterThan(0);
          }
        }
      }
      if (t.kind === 'gathering') {
        const cap =
          t.professionId !== undefined
            ? GATHERING_PROFESSIONS[t.professionId].maxSkill
            : Math.max(...GATHERING_PROFESSION_IDS.map((p) => GATHERING_PROFESSIONS[p].maxSkill));
        expect(t.amount, def.id).toBeLessThanOrEqual(cap);
      }
    }
    // The rare-find quartet: luck-based, so renown 0 and NO title (rule 2),
    // visible like col_glimmerfin (not a hid_ spoiler delight).
    for (const id of [
      'col_pristine_vein',
      'col_ancient_heartwood',
      'col_moonlit_bloom',
      'col_perfect_specimen',
    ]) {
      expect(DEEDS[id].renown, id).toBe(0);
      expect(DEEDS[id].reward, id).toBeUndefined();
      expect(DEEDS[id].hidden ?? false, id).toBe(false);
      expect(DEEDS[id].trigger.kind, id).toBe('visit');
    }
    // The formerly deferred salvage pair, now that salvage is wired on
    // every host; prog_ringwright stays deferred (see docs/design/deeds.md).
    expect(DEEDS.soc_first_salvage.renown).toBe(5);
    expect(DEEDS.soc_first_salvage.trigger).toEqual({
      kind: 'stat',
      stat: 'salvagesPerformed',
      count: 1,
    });
    expect(DEEDS.soc_salvage_50.renown).toBe(10);
    expect(DEEDS.soc_salvage_50.trigger).toEqual({
      kind: 'stat',
      stat: 'salvagesPerformed',
      count: 50,
    });
    expect(DEEDS.prog_ringwright).toBeUndefined();
  });

  it('pins the basic universal profession deeds (issue #2055): renown and trigger literals', () => {
    // Per-craft rare-tier milestones: exactly the crafts that ship a
    // rare-or-better GEAR/CONSUMABLE recipe today (re-derived from the real
    // content tables, never hand-copied), each at standard renown with no
    // reward. Enchanting's only rare-quality outputs are the tool-effect
    // charms (gatherers_cache/artisans_eye, TOOL_EFFECT_RECIPES): consumable
    // recharge implements, not the graded gear/food/potion class this deed
    // rewards, so they are excluded from the derivation the same way the
    // deed's own comment excludes enchanting; jewelcrafting joined the set
    // with the Masterwrought phase 05 base catalog (its rung-50 rare
    // jewelry), and inscription with the phase 06 catalog (its rung-50 rare
    // tome and scroll).
    const rareTierCrafts = [...new Set(ALL_RECIPES.map((r) => r.professionId))]
      .filter((craftId) =>
        ALL_RECIPES.some((r) => {
          if (r.professionId !== craftId) return false;
          const item = ITEMS[r.resultItemId];
          if (item?.use?.type === 'toolEffect') return false;
          const quality = item?.quality;
          return quality === 'rare' || quality === 'epic' || quality === 'legendary';
        }),
      )
      .sort();
    expect(rareTierCrafts).toEqual([
      'alchemy',
      'armorcrafting',
      'cooking',
      'engineering',
      'inscription',
      'jewelcrafting',
      'leatherworking',
      'tailoring',
      'weaponcrafting',
    ]);
    for (const craftId of rareTierCrafts) {
      const deed = DEEDS[`prog_${craftId}_rare`];
      expect(deed, craftId).toBeDefined();
      expect(deed.renown, deed.id).toBe(10);
      expect(deed.reward, deed.id).toBeUndefined();
      expect(deed.hidden ?? false, deed.id).toBe(false);
      expect(deed.trigger).toEqual({ kind: 'visit', markId: `craft_rare:${craftId}` });
    }
    // No deed keys off enchanting: that craft stays out of the per-craft
    // rare-tier set (no item-def output to grade).
    for (const craftId of ['enchanting']) {
      expect(DEEDS[`prog_${craftId}_rare`], craftId).toBeUndefined();
    }
    // The jewelcrafting counter-pin flipped positive with the phase 05 base
    // catalog: the deed exists with the exact family shape and the verified
    // name (appended at the table tail, DEED_ORDER is append-only).
    expect(DEEDS.prog_jewelcrafting_rare).toEqual({
      id: 'prog_jewelcrafting_rare',
      name: 'Polished to Brilliance',
      desc: 'Craft your first rare-tier item in Jewelcrafting.',
      category: 'progression',
      renown: 10,
      trigger: { kind: 'visit', markId: 'craft_rare:jewelcrafting' },
    });
    // And the inscription counter-pin flipped with the phase 06 catalog, the
    // same family shape and its own verified name.
    expect(DEEDS.prog_inscription_rare).toEqual({
      id: 'prog_inscription_rare',
      name: 'Written in Fine Ink',
      desc: 'Craft your first rare-tier item in Inscription.',
      category: 'progression',
      renown: 10,
      trigger: { kind: 'visit', markId: 'craft_rare:inscription' },
    });
  });

  it('ships exactly 45 titles and 4 borders', () => {
    const titles = ALL.filter((d) => d.reward?.kind === 'title');
    const borders = ALL.filter((d) => d.reward?.kind === 'border');
    // Reliquary Curator ranks append 3 titles + 1 border, the WARFARE honor
    // ladder 3 more titles, the Phase 18 Reliquary completion ladder 5 more
    // on top of the release base (31 + 3), Grandmaster Jewelcrafting (phase
    // 05 QA) the ninth per-craft grandmaster, Grandmaster Inscription
    // (phase 06) the tenth, closing the family across the whole ring, and
    // prog_farming_100's Harvestmaster (the absorbed packet's D13 title
    // mandate).
    expect(titles.length).toBe(45);
    expect(borders.length).toBe(4);
    // Titles and border slugs are unique (one deed per cosmetic).
    const titleTexts = titles.map((d) => (d.reward as { text: string }).text);
    expect(new Set(titleTexts).size).toBe(45);
    const borderSlugs = borders.map((d) => (d.reward as { slug: string }).slug);
    expect([...borderSlugs].sort()).toEqual([
      'curators_gilt',
      'deepward',
      'prestige_laurels',
      'reliquary_gilt',
    ]);
  });

  it('pins the launch era constant', () => {
    expect(DEEDS_ERA).toBe('first_era');
  });
});

/** The one recipe with this id, or a loud failure: a silent undefined would
 *  make a predicate arm below pass by measuring nothing. */
function recipeById(id: string) {
  const found = ALL_RECIPES.find((r) => r.id === id);
  if (!found) throw new Error(`no such recipe: ${id}`);
  return found;
}

describe('frozen trigger + renown catalog (design rule 9: never retro-edit a trigger)', () => {
  // A single digest over (id, trigger, renown) for every deed in authored order.
  // The literal pins above cover only a handful of deeds; the other ~180 have no
  // frozen trigger, so silently widening an existing deed's questIds/count,
  // swapping its trigger kind, or nudging its renown keeps every targeted check
  // green. This hash is the one guard that reds on ANY such edit to a SHIPPED
  // deed, enforcing docs/design/deeds.md rule 9 (never retro-edit an existing
  // trigger).
  //
  // Adding a NEW deed also shifts the hash (it appends a row): that is expected
  // and acceptable, re-baseline in the SAME deliberate change. The point is that
  // no edit to a shipped trigger or renown value slips through unnoticed.
  //
  // Regenerate after a DELIBERATE catalog change, then paste the printed hex
  // into FROZEN_CATALOG_SHA256 below (run from the repo root):
  //   npx tsx -e "import {DEED_ORDER,DEEDS} from './src/sim/content/deeds'; import {createHash} from 'node:crypto'; console.log(createHash('sha256').update(JSON.stringify(DEED_ORDER.map((id)=>[id,DEEDS[id].trigger,DEEDS[id].renown])),'utf8').digest('hex'))"
  // v0.26 replaces the point tree before release, so prog_full_build's unreachable
  // eleven-point threshold is deliberately migrated once to the canonical six rows.
  // This new digest freezes that release contract; it is not permission for later edits.
  // Re-baselined once more at the release/v0.27.0 base merge: the catalog now also
  // carries the appended pvp_card_duel_first_win deed (Card Duel).
  // Re-baselined for Professions 2.0: 26 appended professions deeds
  // (Craftsworn, Masterwright, the fishing pair, the per-craft 50/125
  // milestones, the rare-find quartet, and the salvage pair). No shipped
  // trigger or renown changed; prog_master_gatherer had only its English desc
  // reworded, which this digest deliberately does not cover.
  // Re-baselined at the release/v0.30.0 base merge: the catalog appends the
  // Wildheart Basin dungeon deed pair (2 new deeds); no shipped
  // trigger or renown changed.
  // Re-baselined for the zone-3 gatherer chronicle (chr_peaks_gatherer, R21):
  // one appended deed; no shipped trigger or renown changed.
  // Re-baselined again at the release/v0.33.0 sync merge, which brings the
  // RARE_SLAIN_TEMPLATES coverage fix: four more appended deeds,
  // chr_marsh_rares_ii (Grubjaw), chr_peaks_rares_ii (Old Cragmaw, Shardlord
  // Kazzix), chr_gleamstag, and chr_hollow_rares (Old Marrowshell, Aurelhorn),
  // all uncredited camp rares found by the same coverage test. No shipped
  // trigger or renown changed.
  // Re-baselined for the phase 20 bottom-map chronicle pairs (Q26): six
  // appended deeds, the gatherer and first-cast pair for willowfen,
  // galecrest, and farshore_isle. No shipped trigger or renown changed.
  // Re-baselined at this v0.34.0 sync merge for the Drakelands dragonkin brood
  // rework (v0.35): two more appended deeds, chr_drakemaw_broodlord (the new
  // standing broodlord rares) and chr_maw_matriarch (quest-trigger credit for
  // the shipped Cindraleth capstone). Both parents appended only, so no
  // shipped trigger or renown changed on either side.
  // Re-baselined at the v0.35.0 base merge, which unions the brood pair with
  // the four Thornhollow Fields battleground deeds. No shipped trigger or
  // renown changed on either side.
  // Re-baselined for Rift coverage (dgn_rift, dgn_rift_s_rank) plus issue #2055
  // (basic universal profession deeds: prog_engineering_rare through
  // prog_armorcrafting_rare), which both append after the Drakelands brood
  // rework block above. Re-baselined again immediately after for the
  // remaining bottom-map chronicle pairs: twelve more appended deeds after the
  // profession-rare block, the gatherer and first-cast pair for frostveil,
  // amberfall, nightbloom, wraithwood, palmreach, and evergarden (drakelands
  // already covered by the brood rework above). Re-baselined at the v0.35.0
  // sync merges: first for the union with the Reliquary Curator rank bridges,
  // then again when the WARFARE honor ladder joined from the release side.
  // No shipped trigger or renown changed on any side of either merge.
  // Re-baselined 2026-08-08 for Reliquary Phase 18 (the completion ladder):
  // five appended zero-Renown manual deeds (col_reliquary_complete,
  // col_reliquary_conquerors, and the three flagship Illumination deeds),
  // and ONE deliberate shipped-trigger change the hash correctly caught:
  // feat_book_complete's meta list gained the FOUR earnable ladder deeds and
  // deliberately did NOT gain the capstone, which took feat: true (unearnable
  // while three catalog slots stay owner-pended; a non-feat capstone would
  // dead-end The Whole Book; see the reachability pin below). No other
  // trigger or renown changed (verified by reconstructing the pre-phase
  // catalog, which reproduces the previous literal exactly).
  // Re-baselined for the Masterwrought phase 05 jewelcrafting base catalog:
  // one appended deed, prog_jewelcrafting_rare (the per-craft rare-tier
  // family shape, renown 10). No shipped trigger or renown changed.
  // Re-baselined again at the phase 05 QA: two appended deeds,
  // prog_jewelcrafting_50 (renown 5) and prog_grandmaster_jewelcrafting
  // (renown 25, Grandmaster title), completing the craft's milestone family
  // per the 2026-08-10 ruling. No shipped trigger or renown changed.
  // Re-baselined for the Masterwrought phase 06 inscription base catalog:
  // three appended deeds (prog_inscription_rare 10, prog_inscription_50 5,
  // prog_grandmaster_inscription 25, Grandmaster title), the jewelcrafting
  // family shapes exactly. No shipped trigger or renown changed.
  // Re-baselined for the merge of release/v0.40.0: the release's walk-in
  // castle visit pair (exp_the_last_keep, exp_dawnhold_castle, renown 5
  // each) lands AHEAD of the six craft milestones in the merged order, so
  // the merged canonical string matches neither parent literal. No shipped
  // trigger or renown changed (both parents reproduce their own priors
  // exactly; the merged hash is re-minted from the suite output).
  // Re-baselined for the farming celebration deeds (D13): seven appended
  // deeds, prog_first_planting, the four chr_*_first_harvest chronicles,
  // col_golden_harvest, and prog_farming_100 with the Harvestmaster title.
  // No shipped trigger or renown changed.
  // Re-baselined for the farming absorb merge (masterwrought Phase 11d):
  // both parents' appends land in one order (the six craft milestones, then
  // the seven farming rows) so the merged canonical string matches neither
  // parent literal; no shipped trigger or renown changed (both parents
  // reproduce their own priors exactly; the merged hash is re-minted from
  // the suite output).
  // Re-baselined at Phase 11e for the appended roster deed col_farm_roster.
  // An APPEND is the sanctioned reason to move this hash.
  //
  // ONE SHIPPED TRIGGER DID GROW, and saying otherwise would mislead the next
  // person to re-mint this: feat_book_complete's deedIds is a LIVE reference to
  // BOOK_COMPLETE_REQUIREMENTS, which is populated after the table literal from
  // every non-feat non-hidden deed, so appending a deed necessarily widens that
  // capstone's trigger. That is the documented dynamic-meta design rather than
  // a rule-9 retro-edit; no AUTHORED trigger or renown value was touched.
  // Re-baselined at masterwrought Phase 11i for the appended col_deepest_cast.
  // An APPEND is the sanctioned reason to move this hash; no shipped trigger or
  // renown value was touched, and the row was inserted ahead of the farming
  // block rather than at the literal tail so that block stays contiguous, which
  // moves DEED_ORDER's tail positions but no authored trigger.
  // Re-baselined at masterwrought Phase 11k for the appended prog_field_to_feast,
  // and re-minted THE AUDITABLE WAY rather than by pasting the new suite output:
  // the PRE-append row list was reconstructed first (every row minus the new id,
  // with feat_book_complete's live deedIds filtered back to its prior value) and
  // it reproduced 2b6e36a4... EXACTLY, which is what distinguishes an append
  // from an edit. Only then was the digest re-minted with the one appended
  // tuple. No shipped trigger or renown value was touched.
  // Re-baselined at the release/v0.41.0 sync merge for the appended Proving
  // Shore graduation deed (prog_ready_for_an_adventure, on the new
  // tutorialGraduations stat), which the release had itself re-baselined
  // (its own literal was 7041f4ae...) behind the walk-in castle visit pair.
  // Re-minted THE AUDITABLE WAY again: reconstructing the merged canonical
  // rows minus the tutorial deed (feat_book_complete's live deedIds filtered
  // back) reproduced this branch's 52569f4b... EXACTLY, and minus this
  // branch's sixteen appended rows reproduced the release's 7041f4ae...
  // EXACTLY, so the merged catalog is a pure append on BOTH sides. No
  // shipped trigger or renown changed on either side.
  const FROZEN_CATALOG_SHA256 = '4533079d9911b8dc0e20526ca330ff41196126ee9798f216fe5900ba781b9eae';

  it('every shipped deed keeps its trigger and renown unchanged', () => {
    const canonical = JSON.stringify(
      DEED_ORDER.map((id) => [id, DEEDS[id].trigger, DEEDS[id].renown]),
    );
    const actual = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(
      actual,
      'A shipped deed trigger or renown value changed (or a deed was added/removed). ' +
        'Design rule 9 forbids retro-editing an existing trigger; adding a NEW deed is ' +
        'allowed but re-baselines this hash. If the change is deliberate, regenerate ' +
        'FROZEN_CATALOG_SHA256 with the one-liner in the comment above and commit it here.',
    ).toBe(FROZEN_CATALOG_SHA256);
  });
});

describe('retro fallback proof sets stay anchored to the real tables', () => {
  it('the ground-pickup proving quests are exactly the single-source collect quests', () => {
    // A quest proves a sparkle pickup only when its collect objective's item
    // can come from nowhere but the ground pickup path: any mob-loot or
    // vendor source would break the inference, and interact objectives never
    // bump the counter at all. Re-derive that set from the live tables and
    // hold the pin to it, so a new ground object, loot entry, or vendor row
    // forces a conscious re-decision here.
    const groundItemIds = new Set(GROUND_OBJECTS.map((g) => g.itemId));
    const lootItemIds = new Set(
      Object.values(MOBS).flatMap((m) => (m.loot ?? []).map((l) => l.itemId)),
    );
    const vendorItemIds = new Set(Object.values(NPCS).flatMap((n) => n.vendorItems ?? []));
    const derived: string[] = [];
    for (const [questId, quest] of Object.entries(QUESTS)) {
      const proves = quest.objectives.some(
        (obj) =>
          obj.type === 'collect' &&
          groundItemIds.has(obj.itemId) &&
          !lootItemIds.has(obj.itemId) &&
          !vendorItemIds.has(obj.itemId),
      );
      if (proves) derived.push(questId);
    }
    expect([...GROUND_PICKUP_PROVING_QUESTS].sort()).toEqual(derived.sort());
    // The pickup gate itself requires the item def to carry the quest id, so
    // every proving quest's evidence chain resolves end to end.
    for (const questId of GROUND_PICKUP_PROVING_QUESTS) {
      const quest = QUESTS[questId];
      expect(quest, questId).toBeDefined();
      const collect = quest.objectives.find(
        (o) => o.type === 'collect' && groundItemIds.has(o.itemId),
      );
      expect(collect, questId).toBeDefined();
      const item = ITEMS[(collect as { itemId: string }).itemId];
      // kind 'quest' is also the non-transferability guarantee: trade
      // (social/trade.ts), mail (mail/post_office.ts), and the market
      // (market.ts) all hard-block that kind, so questsDone proves THIS
      // character performed the pickup, not a trading partner.
      expect(item?.kind, questId).toBe('quest');
      expect(item?.questId, questId).toBe(questId);
      // A repeatable proving quest would weaken nothing, but none exists; a
      // future one should be reconsidered here rather than slip in.
      expect(quest.repeatable ?? false, questId).toBe(false);
    }
  });

  it('the Craftsworn proof (attunedPairs) is written only by the archetype module', () => {
    // The prog_guildsworn retro arm infers a pre-counter attunement from a
    // non-empty ArchetypeState.attunedPairs. That inference holds only while
    // every attunedPairs WRITE lives in professions/archetype.ts (the
    // quest-validated attunement path and the save-restore of that same
    // history); a writer anywhere else in the sim would let the history grow
    // without an attunement and must re-decide this proof. Same fs-scan
    // idiom as the producer-site test below.
    const simRoot = path.join(__dirname, '..', 'src', 'sim');
    const writers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          if (/attunedPairs(\.push\(|\s*=[^=])/.test(src)) writers.push(path.basename(p));
        }
      }
    };
    walk(simRoot);
    expect(writers.sort()).toEqual(['archetype.ts']);
    // And the retro arm itself exists: deeds.ts grants prog_guildsworn off
    // that history at world join.
    const deedsSrc = fs.readFileSync(path.join(simRoot, 'deeds.ts'), 'utf8');
    const retroArm = deedsSrc.slice(deedsSrc.indexOf('export function retroFallbackGrants'));
    expect(retroArm).toContain('attunedPairs');
    expect(retroArm).toContain("'prog_guildsworn'");
  });

  it('the creditable mob-level ceiling is the S-rank rift pin', () => {
    // Giantslayer's stranded heal keys on the highest level a creditable mob
    // can ever spawn at. S-rank rift floors run mobs up to RIFT_MAX_MOB_LEVEL
    // (the game-wide ceiling; at 23 the +5-level kill is out of reach at the
    // level-20 cap, so capped players take the stranded retro-grant instead);
    // heroic instances pin every mob to one shared level below it; outside
    // those no spawnable template exceeds the player cap. The only templates
    // authored above the ceiling can never be credited: warlock and mage pets
    // sync to their owner's level and die outside kill credit (combat/damage.ts
    // owned-pet early return), and the Yumi cat's damage is intercepted before
    // the death path (social/yumi.ts).
    const heroicLevels = Object.values(HEROIC_DUNGEON_TUNING).map((t) => t.level);
    expect(RIFT_MAX_MOB_LEVEL).toBe(MAX_CREDITABLE_MOB_LEVEL);
    expect(Math.max(...heroicLevels)).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    expect(RIFT_LEVEL_CAP).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    const neverCreditable = new Set([
      ...Object.keys(WARLOCK_PET_MOBS),
      ...Object.keys(MAGE_PET_MOBS),
      // Necromancer pets sync to owner level like the warlock/mage tables
      // (createUndead, combat/necromancy.ts) and die inside the same owned-pet
      // no-credit early return.
      ...Object.keys(NECROMANCY_MOBS),
      YUMI_TEMPLATE_ID,
    ]);
    const dynamicallyLevelCapped = new Set(Object.keys(RIFT_MOBS));
    for (const [id, m] of Object.entries(MOBS)) {
      if (m.dummy || m.worldBoss || neverCreditable.has(id) || dynamicallyLevelCapped.has(id))
        continue;
      expect(m.maxLevel, id).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    }
    // Delve spawns bypass maxLevel: the live level is minLevel plus the
    // tier's enemyLevelBonus (delves/runs.ts). Guard the whole delve mob
    // table against the highest bonus any delve ships, so a future tier or
    // higher-level delve mob cannot silently pass the ceiling.
    const maxDelveBonus = Math.max(
      ...Object.values(DELVES).flatMap((d) => d.tiers.map((t) => t.enemyLevelBonus)),
    );
    for (const [id, m] of Object.entries(DELVE_MOBS)) {
      expect(m.minLevel + maxDelveBonus, id).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    }
  });
});

describe('RARE_SLAIN_TEMPLATES covers every rare camp mob (bug fix regression)', () => {
  // Grubjaw, Old Cragmaw, and Shardlord Kazzix shipped as ordinary CAMPS
  // rares (rare: true, a persistent spawn point, a unique name) but were
  // left off RARE_SLAIN_TEMPLATES, so killing them wrote no 'slain:<id>'
  // mark and could never progress a chr_*_rares deed. Re-derive the live set
  // of rare CAMPS mobs from the real content tables and hold
  // RARE_SLAIN_TEMPLATES to full coverage of it, so a future rare camp mob
  // shipped without deed coverage fails here instead of shipping silently.
  const QUEST_CREDITED_RARE_EXCEPTIONS = new Set([
    // Sethrael the Palecoil (the Drowned Temple side-wing) is not exempt by
    // oversight: its kill is the guaranteed-drop objective of q_palecoil,
    // which already feeds prog_mere_at_rest, so it is credited through the
    // quest-chain system instead of the visited-mark rares system.
    'sethrael_palecoil',
  ]);

  it('every live rare CAMPS mob is in RARE_SLAIN_TEMPLATES or a documented quest-credit exception', () => {
    const campRareIds = new Set(
      CAMPS.filter((c) => MOBS[c.mobId]?.rare === true).map((c) => c.mobId),
    );
    expect(campRareIds.size).toBeGreaterThan(0);
    for (const id of campRareIds) {
      const credited = RARE_SLAIN_TEMPLATES.has(id) || QUEST_CREDITED_RARE_EXCEPTIONS.has(id);
      expect(credited, `${id} is a rare camp mob with no deed credit path`).toBe(true);
    }
  });

  it('RARE_SLAIN_TEMPLATES holds no stale id (every entry is a live rare CAMPS mob)', () => {
    const campRareIds = new Set(
      CAMPS.filter((c) => MOBS[c.mobId]?.rare === true).map((c) => c.mobId),
    );
    for (const id of RARE_SLAIN_TEMPLATES) {
      expect(
        campRareIds.has(id),
        `${id} in RARE_SLAIN_TEMPLATES is not a live rare CAMPS mob`,
      ).toBe(true);
    }
  });

  it('the quest-credit exception really is proven by a required-kill quest that feeds a deed', () => {
    // Cross-check the documented rationale, not just the exclusion: Sethrael's
    // heartscale drop is guaranteed (chance: 1) and gated to q_palecoil, and
    // that quest is required by a live, non-hidden deed.
    const palecoilLoot = MOBS.sethrael_palecoil.loot?.find((l) => l.questId === 'q_palecoil');
    expect(palecoilLoot?.chance).toBe(1);
    const feedsADeed = ALL.some(
      (d) => d.trigger.kind === 'quests' && d.trigger.questIds.includes('q_palecoil'),
    );
    expect(feedsADeed).toBe(true);
  });
});

describe('table shape', () => {
  it('DEED_ORDER holds the append-only authored order (first and last pinned)', () => {
    // DEED_ORDER derives from the table keys, so covering DEEDS is inherent;
    // what CAN drift is the authored order itself. Pin the endpoints as
    // literals: prog_first_steps opens the catalog and the release's
    // prog_ready_for_an_adventure closes the tail (behind this branch's
    // prog_field_to_feast since the v0.41.0 merge), and either moving would
    // signal a reorder
    // (forbidden: the order is an append-only determinism contract; new
    // deeds append). hid_codfather's index is pinned in the refresh test.
    expect(DEED_ORDER[0]).toBe('prog_first_steps');
    // The release's walk-in castle visit pair sits after the Phase 18
    // Reliquary completion ladder, then the Masterwrought phase 05
    // jewelcrafting milestones and the phase 06 inscription milestones
    // append behind it, and the absorbed farming celebration block closes
    // the catalog per the 11b three-tier ordering rule, and the 11-block's own
    // appends follow it in phase order; Phase 11k's prog_field_to_feast was
    // the branch's tail until the release/v0.41.0 merge, where the Proving
    // Shore graduation deed closes the merged tail (appended at the release
    // merge behind the walk-in castle visit pair and the branch's rows).
    expect(DEED_ORDER[DEED_ORDER.length - 1]).toBe('prog_ready_for_an_adventure');
  });

  it('every entry key matches its id and its prefix matches its category', () => {
    for (const [key, def] of Object.entries(DEEDS)) {
      expect(def.id).toBe(key);
      const prefix = Object.keys(PREFIX_CATEGORY).find((p) => key.startsWith(p));
      expect(prefix, `${key} has no known prefix`).toBeDefined();
      expect(def.category, key).toBe(PREFIX_CATEGORY[prefix as string]);
    }
  });

  it('renown values come from the allowed scale', () => {
    for (const def of ALL) expect([0, 5, 10, 25, 50], def.id).toContain(def.renown);
  });

  it('every feat has renown 0 and the feat/hidden flags stay on their prefixes, disjoint', () => {
    // The ONE sanctioned off-prefix feat: the Reliquary completion capstone
    // keeps its col_ id and Collection shelf beside its ladder, but carries
    // feat: true because it is a dynamic meta over a growing catalog (the
    // feat_book_complete class) and the flag is what keeps it out of
    // BOOK_COMPLETE_REQUIREMENTS: three catalog slots are owner-pended today
    // (masterwork:engineering, both pending reins), so a non-feat capstone
    // would dead-end The Whole Book for every player. Growing this set is a
    // deliberate design act; prefer the feat_ prefix for anything new.
    const OFF_PREFIX_FEATS = new Set(['col_reliquary_complete']);
    for (const def of ALL) {
      const expectFeat = def.id.startsWith('feat_') || OFF_PREFIX_FEATS.has(def.id);
      expect(def.feat === true, def.id).toBe(expectFeat);
      expect(def.hidden === true, def.id).toBe(def.id.startsWith('hid_'));
      if (def.feat) expect(def.renown, def.id).toBe(0);
      expect(def.feat === true && def.hidden === true, `${def.id} both feat and hidden`).toBe(
        false,
      );
    }
  });

  it('names and descs are non-empty English with no em/en dashes or emoji', () => {
    const banned = /[\u2013\u2014\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
    for (const def of ALL) {
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.desc.length, def.id).toBeGreaterThan(0);
      expect(banned.test(def.name), `${def.id} name`).toBe(false);
      expect(banned.test(def.desc), `${def.id} desc`).toBe(false);
    }
  });

  it('the Brightwood relic feat desc states the relics can no longer be found', () => {
    // feat_brightwood_relic is permanently unobtainable by design (both source
    // items only ever dropped from retired Brightwood content); players who
    // read a stuck 0/1 without this caveat report it as a broken achievement.
    expect(DEEDS.feat_brightwood_relic.desc).toContain('no longer drop');
  });

  it('the Peaks chapter descs carry the renamed Thornpeak chronicler', () => {
    // The display name was renamed to Zenzie (template id retained for save
    // compatibility); the catalog must never regress to the old name.
    expect(DEEDS.chr_peaks_chapter_i.desc).toContain("Zenzie's chronicle");
    expect(DEEDS.chr_peaks_chapter_ii.desc).toContain("Zenzie's chronicle");
    for (const def of ALL) {
      expect(def.name.includes('Edda Hartwell'), `${def.id} name`).toBe(false);
      expect(def.desc.includes('Edda Hartwell'), `${def.id} desc`).toBe(false);
    }
  });
});

describe('count-form gathering deeds stay earnable', () => {
  // An any-N gathering trigger demanding more professions than are actually
  // gainable would ship an unearnable deed, so this guard caps every one of
  // them at the gainable count. Farming was the exception for two phases: it
  // joined GATHERING_PROFESSION_IDS with no gain path at all. The growth phase
  // gave it one (a harvest queues through queueGatheringGrant like any other
  // gathering harvest), so all five are gainable and the count is simply the
  // roster length again. This guard compares COUNT only, never amount; the
  // amount side of the model is held by the amount-aware farming arm in the
  // next test, added with prog_farming_100 (the first farming trigger to
  // carry an amount above the old tier-1 teaching ceiling).
  const GAINABLE_GATHERING_PROFESSIONS = GATHERING_PROFESSION_IDS.length;
  it('caps every any-N gathering trigger at the gainable profession count', () => {
    expect(GATHERING_PROFESSION_IDS.length).toBe(5);
    let countForm = 0;
    for (const def of ALL) {
      const t = def.trigger;
      if (t.kind !== 'gathering' || t.professionId !== undefined) continue;
      countForm += 1;
      expect(
        t.count ?? 1,
        `${def.id}: any-N gathering deed demands more professions than are gainable`,
      ).toBeLessThanOrEqual(GAINABLE_GATHERING_PROFESSIONS);
    }
    // The loop must have seen the real count-form deeds (prog_first_gather
    // and prog_master_gatherer) or this guard is vacuous.
    expect(countForm).toBeGreaterThanOrEqual(2);
  });

  it('caps every farming gathering trigger at the ceiling the gain schedule can teach', () => {
    // The amount-aware arm the count-form caveat above demanded: farming
    // gains gray at the crop's teaching ceiling (farmingTeachingCeilingFor,
    // professions/farming.ts), so a farming trigger demanding more than the
    // best crop tier can teach would ship unearnable forever, invisible to
    // the count-only guard. The max over live crop tiers 1 to 4 is the
    // profession cap of 100, exactly what prog_farming_100 demands.
    const teachable = Math.max(...[1, 2, 3, 4].map((tier) => farmingTeachingCeilingFor(tier)));
    expect(teachable).toBe(100);
    let farmingTriggers = 0;
    for (const def of ALL) {
      const t = def.trigger;
      if (t.kind !== 'gathering' || t.professionId !== 'farming') continue;
      farmingTriggers += 1;
      expect(
        t.amount,
        `${def.id}: farming deed demands more proficiency than any crop can teach`,
      ).toBeLessThanOrEqual(teachable);
    }
    // Non-vacuity: the loop must have seen prog_farming_100.
    expect(farmingTriggers).toBeGreaterThanOrEqual(1);
  });

  it('GATE 1 discharged: every tier 3/4 seed is vendor-stocked, so prog_farming_100 is earnable', () => {
    // THE (bo) HONESTY ARM, SELF-CLEARED at Phase 11e rather than deleted.
    //
    // It used to assert the opposite: that NO purchase surface stocked these
    // seeds, which made tier 3/4 crops unplantable, capped farming gains at the
    // tier-2 ceiling of 75, and left prog_farming_100 and its Harvestmaster
    // title unreachable. The deed shipped anyway under the D13 mandate, with
    // the dormancy waived in docs/design/deeds.md. GATE 1 stocked the faucet,
    // so the arm reddened exactly as it was built to, and it is INVERTED here
    // rather than removed: the surfaces it walks are unchanged, the direction
    // of the claim is not.
    //
    // Green now means EARNABLE. That distinction is the point: an arm that had
    // simply been deleted would leave nothing saying the faucet exists, and an
    // arm left asserting absence would have to be weakened to pass. Every
    // assertion below fails if the faucet is removed again.
    //
    // DERIVED from the crop catalog, so Phase 11e's four new upper-tier crops
    // are covered without being listed; a hand literal would let a future
    // tier-3 crop ship with no faucet and this arm still green.
    const tier34Seeds = Object.values(FARM_CROPS)
      .filter((crop) => crop.tier >= 3)
      .map((crop) => crop.seedItemId);
    expect(tier34Seeds.length).toBe(8);
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) stocked.add(itemId);
    }
    for (const offer of HEROIC_VENDOR_STOCK) stocked.add(offer.itemId);
    for (const entries of Object.values(DELVE_SHOPS)) {
      for (const entry of entries) stocked.add(entry.itemId);
    }
    // Non-vacuity: the walk really saw the world's counters.
    expect(stocked.size).toBeGreaterThan(0);
    for (const seedId of tier34Seeds) {
      expect(ITEMS[seedId], seedId).toBeDefined();
      expect(stocked.has(seedId), `${seedId} has no faucet: GATE 1 has regressed`).toBe(true);
      // A stocked row without a positive buyValue renders and then refuses
      // (D11's dead-row trap), which would leave the deed just as unreachable
      // while this arm read green on presence alone.
      expect(ITEMS[seedId]?.buyValue ?? 0, `${seedId} is a dead vendor row`).toBeGreaterThan(0);
    }
    // The consequence the arm exists for, stated rather than implied: the
    // teaching ceiling a farmer can now actually reach is the profession cap,
    // because tier 3 and 4 crops are plantable, and that is exactly what
    // prog_farming_100 demands.
    const reachableCeiling = Math.max(
      ...Object.values(FARM_CROPS).map((crop) => farmingTeachingCeilingFor(crop.tier)),
    );
    // The ceiling reaches the deed's own demand. Stated ONCE (the redundant
    // toBeGreaterThanOrEqual(100) that sat below the trigger check was removed
    // at the 11e QA: toBe(100) already implies it), and read against the
    // trigger's own amount rather than a second literal, so a re-tuned deed
    // moves both halves together.
    expect(reachableCeiling).toBe(100);
    const farming100 = DEEDS.prog_farming_100;
    expect(farming100.trigger).toEqual({
      kind: 'gathering',
      professionId: 'farming',
      amount: 100,
    });
    // NOTE ON WHAT THIS ARM DOES AND DOES NOT PROVE, corrected at the 11e QA:
    // farmingTeachingCeilingFor reads the schedule's boundary column and knows
    // nothing about whether anything is STOCKED, so the ceiling alone cannot
    // show the deed is earnable. The GATE 1 teeth in this test are the stocked
    // and positive-buyValue arms above; this pair states the other half, that
    // the ceiling the crops can teach to actually meets the deed's amount.
    if (farming100.trigger.kind === 'gathering') {
      expect(reachableCeiling).toBeGreaterThanOrEqual(farming100.trigger.amount);
    }
    // ...and the transitively parked capstone unparks with it. Read off the
    // capstone's LIVE trigger rather than the private list it is built from, so
    // this cannot drift from what the evaluator actually requires.
    const capstone = DEEDS.feat_book_complete.trigger;
    expect(capstone.kind).toBe('meta');
    if (capstone.kind === 'meta') {
      expect(capstone.deedIds).toContain('prog_farming_100');
      expect(capstone.deedIds).toContain('col_farm_roster');
    }
  });
});

describe('trigger references resolve against the real content tables', () => {
  it('quest, dungeon, delve, item, craft, and profession references all exist', () => {
    for (const def of ALL) {
      const t = def.trigger;
      switch (t.kind) {
        case 'quest':
          expect(QUESTS[t.questId], `${def.id}: ${t.questId}`).toBeDefined();
          break;
        case 'quests':
          for (const q of t.questIds) expect(QUESTS[q], `${def.id}: ${q}`).toBeDefined();
          break;
        case 'dungeonClears':
          expect(DUNGEONS[t.dungeonId], `${def.id}: ${t.dungeonId}`).toBeDefined();
          break;
        case 'delveClears':
          if (t.delveId !== undefined) {
            expect(DELVES[t.delveId], `${def.id}: ${t.delveId}`).toBeDefined();
          }
          break;
        case 'collectItems':
          for (const itemId of t.itemIds) {
            expect(ITEMS[itemId], `${def.id}: ${itemId}`).toBeDefined();
          }
          break;
        case 'craftSkill':
          if (t.craftId !== undefined) {
            expect(
              CRAFT_RING.some((c) => c.id === t.craftId),
              `${def.id}: ${t.craftId}`,
            ).toBe(true);
          }
          break;
        case 'gathering':
          if (t.professionId !== undefined) {
            expect(GATHERING_PROFESSION_IDS, `${def.id}`).toContain(t.professionId);
          }
          break;
        case 'meta':
          for (const dep of t.deedIds) expect(DEEDS[dep], `${def.id}: ${dep}`).toBeDefined();
          for (const q of t.questIds ?? []) expect(QUESTS[q], `${def.id}: ${q}`).toBeDefined();
          break;
        default:
          break;
      }
    }
  });

  it('meta dependencies are acyclic (the fixpoint pass terminates by granting)', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      expect(visiting.has(id), `meta cycle through ${id}`).toBe(false);
      visiting.add(id);
      const t = DEEDS[id].trigger;
      if (t.kind === 'meta') for (const dep of t.deedIds) visit(dep);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of DEED_ORDER) visit(id);
  });

  it('the farm_crop namespace SURVIVES a save/load round trip, so the roster deed can refill', () => {
    // THE MANDATORY TRAP for masterwrought DECISION E, and it is not a
    // formality: an UNREGISTERED namespace serializes fine and is silently
    // dropped by restoreDeedStats on load, so a player who logs out mid-roster
    // would come back with an empty collection and the deed could never
    // complete. That exact bug has shipped twice here (gather_event, then
    // masterwork), which is why this is a round trip and not a list check.
    const marks = [...FARM_CROP_IDS].sort().map((cropId) => `farm_crop:${cropId}`);
    expect(marks).toHaveLength(12);
    const stats = restoreDeedStats(undefined);
    for (const mark of marks) stats.visited.add(mark);
    const saved = serializeDeedStats(stats);
    expect(saved, 'the marks must serialize at all').toBeDefined();
    const restored = restoreDeedStats(saved);
    for (const mark of marks) {
      expect(restored.visited.has(mark), `${mark} was dropped on load`).toBe(true);
    }
    // The control that makes the arm mean something: a mark in an UNREGISTERED
    // namespace really is dropped by the same round trip, so the pass above is
    // the registration working rather than restoreDeedStats keeping everything.
    const bogus = restoreDeedStats(undefined);
    bogus.visited.add('farm_crop_typo:vale_wheat');
    expect(
      restoreDeedStats(serializeDeedStats(bogus)).visited.has('farm_crop_typo:vale_wheat'),
    ).toBe(false);
    // ...and the deed's own trigger really names these marks, so the round trip
    // above is over the set the evaluator reads.
    const trigger = DEEDS.col_farm_roster.trigger;
    expect(trigger.kind).toBe('visits');
    if (trigger.kind === 'visits') expect([...trigger.markIds].sort()).toEqual(marks);
  });

  it('every deed desc that names a shipped item names the RIGHT one', () => {
    // THE GUARD THE BLOCKING BUG ASKED FOR (masterwrought Phase 11k). That
    // phase's deed shipped reading "Cook an apex Harvest Feast", and no such
    // item exists: its outputs are the Stonepot, Warspice and Sageleaf Feasts,
    // while Harvest Feast is a DIFFERENT shipped item, the rare party rung one
    // below. A reviewer caught it. Nothing in this suite could, because nothing
    // read a deed desc, and the Book is player-visible English.
    //
    // THE RULE IS DELIBERATELY NARROW. A desc is prose and most Title Case in
    // it is ordinary English, so a loose check would fire on every deed. This
    // asks only: does the desc contain a phrase that EXACTLY matches a shipped
    // item NAME? That is precisely the shape the bug had, a real item name
    // naming the wrong real item, and it is rare enough to enumerate.
    //
    // AN ALLOWLIST RATHER THAN A BAN, because naming an item is often right
    // (col_deepest_cast really is about the Clockreel Fishing Rod). Its value
    // is that a NEW mention has to be read by a human once: a deed naming an
    // item is making a promise about content, and this is where it is checked.
    const itemNames = [...new Set(Object.values(ITEMS).map((def) => def.name))];
    const mentions: string[] = [];
    for (const id of DEED_ORDER) {
      const desc = DEEDS[id].desc;
      for (const name of itemNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`).test(desc)) mentions.push(`${id}:${name}`);
      }
    }
    expect(
      mentions.sort(),
      'every deed desc naming a shipped item, each reviewed as naming the right one',
    ).toEqual([
      'col_deepest_cast:Clockreel Fishing Rod',
      'col_glimmerfin:Sunglint Koi',
      'feat_brightwood_relic:Bramblehide Jerkin',
      "feat_brightwood_relic:Monarch's Crown",
      'hid_codfather:The Codfather',
    ]);
    // NON-VACUITY: the sweep must actually be able to see a name, or the
    // expectation above is a list of five things it never looked for.
    expect(itemNames.length, 'the item name corpus is real').toBeGreaterThan(500);
    expect(
      DEED_ORDER.some((id) => /Clockreel Fishing Rod/.test(DEEDS[id].desc)),
      'and the matcher really does find one by hand',
    ).toBe(true);
  });

  it('the apex_feast namespace SURVIVES a save/load round trip, so the deed can refill', () => {
    // THE SAME MANDATORY TRAP one deed over (masterwrought Phase 11k), and the
    // reason it is a ROUND TRIP rather than a membership check: an unregistered
    // namespace serializes fine and is silently dropped by restoreDeedStats, so
    // a cook who logs out after crafting their first apex feast would come back
    // with the mark gone and the deed permanently unearnable. This packet has
    // paid for that three times (gather_event, masterwork, farm_crop).
    const stats = restoreDeedStats(undefined);
    stats.visited.add(APEX_FEAST_CRAFT_MARK);
    const restored = restoreDeedStats(serializeDeedStats(stats));
    expect(
      restored.visited.has(APEX_FEAST_CRAFT_MARK),
      `${APEX_FEAST_CRAFT_MARK} was dropped on load`,
    ).toBe(true);
    // The control that makes the arm mean something: a mark in an UNREGISTERED
    // namespace really is dropped by the same round trip.
    const bogus = restoreDeedStats(undefined);
    bogus.visited.add('apex_feast_typo:crafted');
    expect(restoreDeedStats(serializeDeedStats(bogus)).visited.has('apex_feast_typo:crafted')).toBe(
      false,
    );
    // ...and the deed's own trigger really names THIS mark, so the round trip
    // above is over the key the evaluator reads.
    const trigger = DEEDS.prog_field_to_feast.trigger;
    expect(trigger.kind).toBe('visit');
    if (trigger.kind === 'visit') expect(trigger.markId).toBe(APEX_FEAST_CRAFT_MARK);
    // The mark key is a FIXED literal, which is what makes it bounded: an
    // interpolated key source would write permanent ledger noise nothing reads
    // back, the hazard craft_rare's own bounding exists for.
    expect(APEX_FEAST_CRAFT_MARK).toBe('apex_feast:crafted');
  });

  it('isApexFeastRecipe admits exactly the capstone feast bills, and no others', () => {
    // The predicate the craft-credit arm gates on, CALLED rather than described,
    // and pinned by its OUTCOME over every shipped recipe rather than over the
    // three rows this phase happened to add. A predicate that returned true
    // unconditionally would still leave a membership spot-check green.
    const admitted = ALL_RECIPES.filter((r) => isApexFeastRecipe(r))
      .map((r) => r.id)
      .sort();
    expect(admitted).toEqual([
      'recipe_sageleaf_feast',
      'recipe_stonepot_feast',
      'recipe_warspice_feast',
    ]);
    // THE TWO DISCRIMINATING CASES, spelled out because the pin above is
    // satisfied by either half of the rule alone:
    //  - the PARTY feast carries a feast payload and is refused on the RUNG
    //    (cooking 100 against cooking's cap of 125), so a rung-blind predicate
    //    would admit it and the deed would fire on the wrong feast;
    const partyFeast = recipeById('recipe_harvest_feast');
    expect(ITEMS[partyFeast.resultItemId], 'the party feast is a real feast def').toBeTruthy();
    expect(isApexFeastRecipe(partyFeast), 'the PARTY rung is not the apex one').toBe(false);
    //  - the two mobile STATIONS sit at the same 125 rung and are refused on the
    //    PAYLOAD, so a payload-blind predicate would admit them.
    for (const id of ['recipe_laden_hearth', 'recipe_grand_cauldron']) {
      const station = recipeById(id);
      expect(station.skillReq, `${id} really is at the capstone rung`).toBe(125);
      expect(isApexFeastRecipe(station), `${id} is a station, not a feast`).toBe(false);
    }
  });

  it('every visited mark belongs to an authored namespace and resolves to real content', () => {
    const powerupIds = new Set(POWERUPS.map((p) => p.id));
    // A poi mark keys on the poi's STABLE id, never its display label (a label
    // copy edit must not strand exploration progress). The mark resolves to a real
    // poi id in a real zone.
    const zonePoiIds = new Map(ZONES.map((z) => [z.id, new Set(z.pois?.map((p) => p.id))]));
    const checkMark = (deedId: string, mark: string): void => {
      const ns = mark.split(':')[0];
      expect(VISITED_MARK_NAMESPACES, `${deedId}: ${mark}`).toContain(ns);
      if (ns === 'poi') {
        const rest = mark.slice(4);
        const cut = rest.indexOf(':');
        const zoneId = rest.slice(0, cut);
        const poiId = rest.slice(cut + 1);
        const ids = zonePoiIds.get(zoneId);
        expect(ids, `${deedId}: unknown zone in ${mark}`).toBeDefined();
        expect(ids?.has(poiId), `${deedId}: unknown poi id in ${mark}`).toBe(true);
      } else if (ns === 'slain' || ns === 'witness') {
        expect(MOBS[mark.slice(ns.length + 1)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'npc') {
        expect(NPCS[mark.slice(4)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'fish') {
        // Earnability against the tables the zone ACTUALLY draws: the mark
        // writer (onFishCaughtForDeeds) fires only for a caught item listed
        // in ZONE_FISH[zone], and the resolver reads the zone's own catch
        // table when one exists, else the Vale fallback
        // (professions/fishing.ts). Before the phase 20 pass this branch
        // demanded an own-table row, which was true of the three strip zones
        // and nothing else; the starter-zone first-cast deeds fish Vale rows
        // under their own zone id, so the guard now mirrors the resolver's
        // read. The rollout checklist still demands own-table rows with NO
        // fallback for every 'complete' zone, so this loosening cannot leak
        // into a rollout flip.
        const zoneId = mark.slice(5);
        expect(
          ZONES.some((z) => z.id === zoneId),
          `${deedId}: ${mark} names no real zone`,
        ).toBe(true);
        const rows = ZONE_FISH[zoneId] ?? [];
        expect(rows.length, `${deedId}: ${mark} needs ZONE_FISH rows to ever fire`).toBeGreaterThan(
          0,
        );
        const drawn = new Set<string>();
        for (const band of FISHING_TABLES_BY_BAND) {
          for (const entry of band[zoneId] ?? band.eastbrook_vale) {
            if (entry.itemId !== null) drawn.add(entry.itemId);
          }
        }
        for (const itemId of rows) {
          expect(
            drawn.has(itemId),
            `${deedId}: ${mark} lists ${itemId}, never drawn in that zone's waters`,
          ).toBe(true);
        }
      } else if (ns === 'gather') {
        const [, zoneId, type] = mark.split(':');
        expect(zonePoiIds.has(zoneId), `${deedId}: ${mark}`).toBe(true);
        expect(['ore', 'wood', 'herb'], `${deedId}: ${mark}`).toContain(type);
      } else if (ns === 'quality') {
        expect(['rare', 'epic', 'legendary'], `${deedId}: ${mark}`).toContain(mark.slice(8));
      } else if (ns === 'fiesta') {
        expect(powerupIds.has(mark.slice(7)), `${deedId}: ${mark}`).toBe(true);
      } else if (ns === 'dungeon') {
        expect(DUNGEONS[mark.slice(8)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'gather_event') {
        // The four rare-event flavor marks written by announceGatherRareEvent
        // (professions/gather_events.ts gatherRareEventFlavor; golden_harvest
        // is the crop-source flavor) plus the corpse-harvest perfect_specimen
        // jackpot (interaction.ts).
        expect(
          [
            'pristine_vein',
            'ancient_heartwood',
            'moonlit_bloom',
            'golden_harvest',
            'perfect_specimen',
          ],
          `${deedId}: ${mark}`,
        ).toContain(mark.slice('gather_event:'.length));
      } else if (ns === 'farm') {
        // Farming celebration marks: farm:planted (the first-planting proof
        // written at plant success) or a farm:<zone> first-harvest chronicle
        // mark for a listed farming hub (src/sim/deeds.ts
        // onCropHarvestedForDeeds); nothing else may ride the namespace.
        const rest = mark.slice('farm:'.length);
        expect(
          rest === 'planted' || FARM_CHRONICLE_ZONES.includes(rest),
          `${deedId}: ${mark}`,
        ).toBe(true);
      } else if (ns === 'farm_crop') {
        // Per-crop first-harvest collection marks (masterwrought DECISION E),
        // written by the same onCropHarvestedForDeeds hook. Resolved against
        // the live catalog like its siblings: the ids are generated today, so
        // a stray mark is impossible by construction, but this is what catches
        // a HAND-AUTHORED one later, which is the only way the namespace could
        // grow past the catalog it is supposed to mirror.
        expect(FARM_CROP_IDS.has(mark.slice('farm_crop:'.length)), `${deedId}: ${mark}`).toBe(true);
      } else if (ns === 'craft_rare') {
        // Written by professions/crafting.ts craftItem the first time a
        // player crafts a rare-or-better output in that craft (#2055).
        expect(
          CRAFT_RING.some((c) => c.id === mark.slice('craft_rare:'.length)),
          `${deedId}: ${mark}`,
        ).toBe(true);
      }
    };
    for (const def of ALL) {
      if (def.trigger.kind === 'visit') checkMark(def.id, def.trigger.markId);
      if (def.trigger.kind === 'visits') {
        for (const mark of def.trigger.markIds) checkMark(def.id, mark);
      }
    }
  });

  it('a Vale-fallback catch in each bottom-map zone earns its first-cast deed (live)', () => {
    // The witness for the fallback-aware guard above: the mark writer fires
    // for a Vale fish caught under a starter zone's own id (which is what
    // the resolver actually draws there), and the deed grants through the
    // real visit path, for every bottom-map zone (the six added when the
    // pair extended past the original three prove the mechanism generalizes,
    // not just that it works once). A fish the zone never draws must NOT
    // fire it.
    const CASES = [
      ['willowfen', 'chr_willowfen_first_cast'],
      ['galecrest', 'chr_galecrest_first_cast'],
      ['farshore_isle', 'chr_farshore_first_cast'],
      ['frostveil', 'chr_frostveil_first_cast'],
      ['amberfall', 'chr_amberfall_first_cast'],
      ['nightbloom', 'chr_nightbloom_first_cast'],
      ['wraithwood', 'chr_wraithwood_first_cast'],
      ['palmreach', 'chr_palmreach_first_cast'],
      ['evergarden', 'chr_evergarden_first_cast'],
    ] as const;
    for (const [zoneId, deedId] of CASES) {
      const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false });
      const meta = sim.meta(sim.playerId) as PlayerMeta;
      // markVisited only dirties the evaluation key; the deed evaluator runs
      // in the tick phase, so each probe ticks before reading the grant.
      onFishCaughtForDeeds(sim.ctx, meta, zoneId, 'raw_marsh_pike'); // a Mirefen fish
      sim.tick();
      expect(meta.deedsEarned.has(deedId), `${deedId} on a wrong-zone fish`).toBe(false);
      onFishCaughtForDeeds(sim.ctx, meta, zoneId, 'raw_mirror_trout');
      sim.tick();
      expect(meta.deedsEarned.has(deedId), deedId).toBe(true);
      // Zone-keyed: this zone's catch earned nothing for the sibling zones.
      for (const [, otherDeed] of CASES) {
        if (otherDeed === deedId) continue;
        expect(meta.deedsEarned.has(otherDeed), `${otherDeed} cross-zone leak`).toBe(false);
      }
    }
  });

  it('the three gather marks earn each bottom-map gatherer chronicle (live)', () => {
    // The gatherer twin of the fish witness: the chronicle waits on the
    // three gather:<zone>:<type> marks (the exact ids completeGatherCast
    // writes; the rollout suite's live arm pins that producer-template
    // equality for the complete zones), and two marks must NOT grant.
    const CASES = [
      ['willowfen', 'chr_willowfen_gatherer'],
      ['galecrest', 'chr_galecrest_gatherer'],
      ['farshore_isle', 'chr_farshore_gatherer'],
      ['frostveil', 'chr_frostveil_gatherer'],
      ['amberfall', 'chr_amberfall_gatherer'],
      ['nightbloom', 'chr_nightbloom_gatherer'],
      ['wraithwood', 'chr_wraithwood_gatherer'],
      ['palmreach', 'chr_palmreach_gatherer'],
      ['evergarden', 'chr_evergarden_gatherer'],
    ] as const;
    for (const [zoneId, deedId] of CASES) {
      const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false });
      const meta = sim.meta(sim.playerId) as PlayerMeta;
      sim.ctx.markVisited(meta, `gather:${zoneId}:ore`);
      sim.ctx.markVisited(meta, `gather:${zoneId}:wood`);
      sim.tick();
      expect(meta.deedsEarned.has(deedId), `${deedId} granted at two of three marks`).toBe(false);
      sim.ctx.markVisited(meta, `gather:${zoneId}:herb`);
      sim.tick();
      expect(meta.deedsEarned.has(deedId), deedId).toBe(true);
      for (const [, otherDeed] of CASES) {
        if (otherDeed === deedId) continue;
        expect(meta.deedsEarned.has(otherDeed), `${otherDeed} cross-zone leak`).toBe(false);
      }
    }
  });

  it('every ZONE_FISH row belongs to a shipped first-cast deed (the reverse sweep)', () => {
    // The other direction of the fish-guard intersection above: a ZONE_FISH
    // key with no deed consuming its fish:<zone> mark is inert authoring
    // debt, so the table and the deed catalog must cover each other exactly.
    const deedFishZones = new Set<string>();
    for (const def of ALL) {
      if (def.trigger.kind === 'visit' && def.trigger.markId.startsWith('fish:')) {
        deedFishZones.add(def.trigger.markId.slice(5));
      }
      if (def.trigger.kind === 'visits') {
        for (const mark of def.trigger.markIds) {
          if (mark.startsWith('fish:')) deedFishZones.add(mark.slice(5));
        }
      }
    }
    expect([...Object.keys(ZONE_FISH)].sort()).toEqual([...deedFishZones].sort());
  });

  it('every zone row lists EXACTLY the catches that zone draws (the item dimension)', () => {
    // THE THIRD DIRECTION, and the one that was missing. The fish-mark guard
    // above checks rows-are-drawn (a subset claim), and the reverse sweep
    // checks zone KEYS. Neither reads the item lists in the drawn-to-listed
    // direction, so a new catch added to the cell tables and forgotten here
    // reddened nothing: rv-tests deleted all three of masterwrought Phase 11i's
    // catches from every row and the whole deeds suite stayed green.
    //
    // What that costs is not cosmetic. ZONE_FISH is what the first-cast deed
    // reads to decide a zone is fished out, so a missing row makes the mark
    // silently unearnable-by-that-catch: a player reeling in the new fish gets
    // no credit and no error, which is the failure the phase's own SETTLED
    // ruling ("ZONE_FISH: YES, all three join") was written to avoid.
    //
    // EXACT equality, not a subset either way. The set is derived the way the
    // resolver reads the tables (own cell, else the Vale fallback) and filtered
    // to the CATCHES: every raw cooking catch plus the rare koi. Grey junk and
    // the empty-hook null row are deliberately out, which is why this is an
    // authored contract worth pinning rather than a restatement of the table.
    const catchIds = new Set<string>([...RAW_COOKING_CATCH_IDS, FISHING_RARE_ID]);
    // Non-vacuity: the filter must actually keep the junk out, or "exactly the
    // catches" would quietly mean "everything drawn".
    expect(catchIds.has('tangled_weed')).toBe(false);
    expect(catchIds.has('soggy_boot')).toBe(false);
    expect(catchIds.has(FISHING_RARE_ID)).toBe(true);
    let zonesChecked = 0;
    for (const [zoneId, rows] of Object.entries(ZONE_FISH)) {
      const drawn = new Set<string>();
      for (const band of FISHING_TABLES_BY_BAND) {
        for (const entry of band[zoneId] ?? band.eastbrook_vale) {
          if (entry.itemId && catchIds.has(entry.itemId)) drawn.add(entry.itemId);
        }
      }
      expect([...rows].sort(), `ZONE_FISH.${zoneId} vs the cells that zone draws`).toEqual(
        [...drawn].sort(),
      );
      zonesChecked++;
    }
    // The loop ran over a real table, not an empty one.
    expect(zonesChecked).toBe(Object.keys(ZONE_FISH).length);
    expect(zonesChecked).toBeGreaterThanOrEqual(12);
  });

  it('FARM_CHRONICLE_ZONES is real zones and exactly the authored farm-patch zone set', () => {
    // The ZONE_FISH template, forward direction: every listed chronicle zone
    // is a shipped zone, and the list matches the zones that actually carry
    // authored farm patches (FARM_PATCHES) from both directions, so a new
    // patch zone cannot land without its chronicle row and a chronicle row
    // cannot name a bedless zone.
    for (const zoneId of FARM_CHRONICLE_ZONES) {
      expect(
        ZONES.some((z) => z.id === zoneId),
        `${zoneId} names no real zone`,
      ).toBe(true);
    }
    const patchZones = [...new Set(FARM_PATCHES.map((p) => p.zoneId))].sort();
    expect([...FARM_CHRONICLE_ZONES].sort()).toEqual(patchZones);
  });

  it('every farm:<zone> deed mark covers FARM_CHRONICLE_ZONES exactly (the reverse sweep)', () => {
    // The other direction of the farm-guard intersection: a chronicle zone
    // with no deed consuming its farm:<zone> mark is inert authoring debt,
    // so the list and the deed catalog must cover each other exactly (the
    // ZONE_FISH reverse sweep above).
    const deedFarmZones = new Set<string>();
    for (const def of ALL) {
      if (def.trigger.kind === 'visit' && def.trigger.markId.startsWith('farm:')) {
        const rest = def.trigger.markId.slice(5);
        if (rest !== 'planted') deedFarmZones.add(rest);
      }
      if (def.trigger.kind === 'visits') {
        for (const mark of def.trigger.markIds) {
          if (mark.startsWith('farm:') && mark !== 'farm:planted') {
            deedFarmZones.add(mark.slice(5));
          }
        }
      }
    }
    expect([...deedFarmZones].sort()).toEqual([...FARM_CHRONICLE_ZONES].sort());
  });

  it('every static-zone poi carries a stable id, unique within its zone', () => {
    // id is the PERSISTED identity behind every poi visit mark; the deed sweep
    // keys on it, so each static poi MUST declare one and no two pois in a zone
    // may collide (a collision would let one poi satisfy another's mark).
    for (const zone of ZONES) {
      const ids = (zone.pois ?? []).map((p) => p.id);
      for (const id of ids) {
        expect(id, `zone ${zone.id}: a poi is missing its stable id`).toBeDefined();
        expect(typeof id, `zone ${zone.id}: poi id must be a string`).toBe('string');
      }
      expect(new Set(ids).size, `zone ${zone.id}: poi ids must be unique`).toBe(ids.length);
    }
  });

  it('every lifetime counter key is read by at least one deed (no dead counters)', () => {
    const read = new Set<string>();
    for (const def of ALL) if (def.trigger.kind === 'stat') read.add(def.trigger.stat);
    for (const key of DEED_STAT_KEYS) expect(read.has(key), `unread counter ${key}`).toBe(true);
  });

  it('every lifetime counter has a producer site (no permanently unearnable stat deed)', () => {
    // Scan the sim sources for bumpDeedStat call literals; a counter no site
    // ever bumps makes its deed permanently unearnable. guildsFounded is the
    // documented exception: guild creation resolves entirely in the server
    // social layer, so its producer is a server observer, not a sim site.
    const SERVER_PRODUCED: readonly string[] = ['guildsFounded'];
    const produced = new Set<string>();
    const simRoot = path.join(__dirname, '..', 'src', 'sim');
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/bumpDeedStat\([^)]*?'([a-zA-Z]+)'/g)) {
            produced.add(m[1]);
          }
        }
      }
    };
    walk(simRoot);
    for (const key of DEED_STAT_KEYS) {
      if (SERVER_PRODUCED.includes(key)) {
        expect(produced.has(key), `${key} is server-produced; drop the exemption`).toBe(false);
        continue;
      }
      expect(produced.has(key), `no sim producer bumps ${key}`).toBe(true);
    }
  });
});

describe('milestone unification', () => {
  it('the five prog_ milestone deeds mirror the legacy MILESTONES table literally', () => {
    // Pinned literals first (the legacy table must not drift under the deeds).
    expect(MILESTONES.map((m) => [m.id, m.lifetimeXp])).toEqual([
      ['veteran', 250000],
      ['champion', 500000],
      ['paragon', 1000000],
      ['mythic', 2500000],
      ['eternal', 5000000],
    ]);
    for (const m of MILESTONES) {
      const deed = DEEDS[`prog_${m.id}`];
      expect(deed, m.id).toBeDefined();
      expect(deed.trigger).toEqual({ kind: 'lifetimeXp', amount: m.lifetimeXp });
      expect(MILESTONE_DEED_TO_LEGACY[deed.id]).toBe(m.id);
    }
    expect(Object.keys(MILESTONE_DEED_TO_LEGACY).length).toBe(5);
  });

  it('the five reserved milestone titles ride exactly these deeds', () => {
    expect(DEEDS.prog_veteran.reward).toEqual({ kind: 'title', text: 'Veteran' });
    expect(DEEDS.prog_champion.reward).toEqual({ kind: 'title', text: 'Champion' });
    expect(DEEDS.prog_paragon.reward).toEqual({ kind: 'title', text: 'Paragon' });
    expect(DEEDS.prog_mythic.reward).toEqual({ kind: 'title', text: 'Mythic' });
    expect(DEEDS.prog_eternal.reward).toEqual({ kind: 'title', text: 'Eternal' });
  });
});

describe('the completionist feat', () => {
  it('feat_book_complete requires exactly every non-feat, non-hidden deed', () => {
    const t = DEEDS.feat_book_complete.trigger;
    expect(t.kind).toBe('meta');
    if (t.kind !== 'meta') return;
    const expected = DEED_ORDER.filter((id) => !DEEDS[id].feat && !DEEDS[id].hidden);
    expect(t.deedIds).toEqual(expected);
    expect(DEEDS.feat_book_complete.feat).toBe(true);
    expect(DEEDS.feat_book_complete.renown).toBe(0);
  });

  it('stays reachable: the unearnable Reliquary capstone is OUT, its earnable ladder is IN', () => {
    // col_reliquary_complete is unearnable while three catalog slots stay
    // owner-pended (masterwork:engineering, reins_drakemaw_raptor,
    // reins_terrorspark_groundshaker); as a Book requirement it would
    // dead-end The Whole Book for every player, the exact failure the
    // retroFallbackGrants stranded-heal doctrine names. The feat flag is the
    // exclusion mechanism; this arm reds the moment anyone drops it. The
    // derivation pin above cannot catch that regression on its own, because
    // both its sides read the same flag.
    const t = DEEDS.feat_book_complete.trigger;
    if (t.kind !== 'meta') throw new Error('feat_book_complete lost its meta trigger');
    expect(t.deedIds).not.toContain('col_reliquary_complete');
    for (const id of [
      'col_reliquary_conquerors',
      'col_reliquary_illum_nythraxis_heroic',
      'col_reliquary_illum_thunzharr',
      'col_reliquary_illum_gravewyrm_heroic',
    ]) {
      expect(t.deedIds, `${id} is earnable and belongs in the Book`).toContain(id);
    }
  });
});

describe('the border-reward set (a public Discord feed surface since Phase 18)', () => {
  it('pins every border deed by id, all non-hidden', () => {
    // discordFeedDeed cards EVERY border-reward deed name-only, so border
    // rewards are a public third-party surface: adding one must be a
    // deliberate, reviewed act, never a side effect of authoring a reward.
    // A hidden border deed would be dropped by the fail-closed
    // isPubliclyListableDeedId gate (the hid_saul_footnote title precedent
    // pins that ordering), but it should not exist in the first place.
    const borderIds = DEED_ORDER.filter((id) => DEEDS[id].reward?.kind === 'border').sort();
    expect(borderIds).toEqual([
      'col_discovery_250',
      'col_reliquary_rank_5',
      'dgn_deepward',
      'prog_prestige_10',
    ]);
    for (const id of borderIds) expect(DEEDS[id].hidden, id).not.toBe(true);
  });
});

describe('col_junk_drawer stays completable after the phase 11l trophy promotion', () => {
  // The meter behind the deed (poorItemsDiscoveredCount, src/sim/deeds.ts)
  // recounts itemsDiscovered against the LIVE quality === 'poor', so what the
  // deed can ever reach is the set of poor ids a character can actually
  // acquire. Walked here over every acquisition source this file already
  // knows: mob loot (the delve and rift tables are merged into MOBS, and are
  // walked again by name so a future un-merge cannot hide them), the heroic
  // boss tables (HEROIC_BOSS_LOOT), the four rift clear and world-drop id
  // lists (RIFT_*_ITEM_IDS), the two delve chest tables, the Drowned Litany
  // and the Collapsed Reliquary (every LootTier, every class, both bountiful
  // arms), vendor stock (NPC rows, the heroic
  // quartermaster, the delve shops), the World Market's house stock
  // (MARKET_HOUSE_STOCK), ground pickups, every fishing cell in every band,
  // quest rewards, and recipe outputs.
  //
  // The heroic, rift, delve and MARKET_HOUSE_STOCK arms contribute no poor
  // id today (78 heroic and rift entries, 355 chest entries (189 Litany and
  // 166 lockpick, pinned below so the count cannot rot silently) and the 23
  // house stock rows visited, zero poor), so they are scope insurance rather
  // than
  // a pin: a poor id authored onto one of those tables later enters the walk
  // here instead of stranding the deed unseen.
  //
  // CLOSURE: the faucets deliberately NOT walked cannot emit a poor id, so
  // the scope is complete rather than merely wide. Gathering yields carry no
  // poor entry: the node, corpse, and farm supplies in
  // src/sim/professions/gathering_supply.ts are common materials, and its
  // fishingSupply skips poor by def (the `quality === 'poor'` continue near
  // line 76) over the same fishing tables walked above. Salvage returns only
  // the three common materials of SALVAGE_MATERIAL_BY_QUALITY
  // (src/sim/professions/salvage.ts, near line 53) and refuses a poor INPUT
  // outright (isSalvageable, near line 73). Mail letters attach only
  // q_greyjaw's roasted_boar (the one authored `items:` in
  // src/sim/content/letters.ts) plus the per-kill Heroic Mark and Wyrmfall
  // Core stacks the PostOffice fills; the Exchange custody letters carry the
  // player's own parcel back. The heroic variants are merged into ITEMS
  // before this scan runs (src/sim/data.ts, buildHeroicVariants), so livePoor
  // below already sees them. The World Market IS a faucet on its house side:
  // MARKET_HOUSE_STOCK (src/sim/market.ts) is a reseeded house-listing table
  // that never depletes, so it is walked below; player listings only move
  // ids a character acquired through one of the routes above. The /dev
  // vendor (src/sim/content/ptr_dev_vendor.ts) is spawned on demand under
  // ALLOW_DEV_COMMANDS, never placed in NPCS, and stocks epic gear only
  // (allEpicGearIds), so it is invisible to the NPCS walk and can emit no
  // poor id. The rift clear pools (src/sim/rift/loot_pools.ts) derive from
  // tables the walk already covers: the five-man dungeon mob loot merged
  // into MOBS, HEROIC_BOSS_LOOT, and RIFT_EPIC_ITEM_IDS. The lockpick chest
  // table delveChestItemsForTier (granted by src/sim/rift/runs.ts and
  // src/sim/delves/lockpick_controller.ts; today only the Collapsed
  // Reliquary presets it) is walked below beside the Litany table: the 11l
  // QA found it neither walked nor named, gear-only today, so scope
  // insurance rather than a live defect.
  const reachable = new Set<string>();
  const note = (itemId: string | null | undefined): void => {
    if (itemId && ITEMS[itemId]?.quality === 'poor') reachable.add(itemId);
  };
  for (const m of Object.values(MOBS)) for (const l of m.loot ?? []) note(l.itemId);
  for (const m of Object.values(DELVE_MOBS)) for (const l of m.loot ?? []) note(l.itemId);
  for (const m of Object.values(RIFT_MOBS)) for (const l of m.loot ?? []) note(l.itemId);
  for (const entries of Object.values(HEROIC_BOSS_LOOT)) for (const l of entries) note(l.itemId);
  for (const id of RIFT_GEAR_ITEM_IDS) note(id);
  for (const id of RIFT_EPIC_ITEM_IDS) note(id);
  for (const id of RIFT_LEGENDARY_ITEM_IDS) note(id);
  for (const id of RIFT_RARE_ITEM_IDS) note(id);
  // The two delve chest tables are functions, not lists: every tier LootTier
  // admits (the satisfies clause reds the moment the union grows, under tsc,
  // which the gate runs; a bare vitest run strips types), every class, both
  // bountiful arms, under a stub rng pinned all-true and then all-false. The
  // Litany header says exactly two chance draws per call, so the two stubs
  // between them reach every id it can ever return (not every branch: the
  // low tier pushes its second uncommon only on a mixed draw, and the medium,
  // premium and bountiful arms push that id unconditionally, so the id set is
  // complete while one branch is not visited; the lockpick table draws at
  // most once per call, so the same two stubs cover it a fortiori).
  let litanyEntries = 0;
  let lockpickEntries = 0;
  const LOOT_TIERS = Object.keys({
    premium: true,
    medium: true,
    low: true,
  } satisfies Record<LootTier, true>) as LootTier[];
  for (const tier of LOOT_TIERS) {
    for (const cls of ALL_CLASSES) {
      for (const bountiful of [false, true]) {
        for (const always of [true, false]) {
          const rng = { chance: () => always } as unknown as Rng;
          for (const entry of drownedLitanyChestItemsForTier(tier, cls, rng, bountiful)) {
            litanyEntries += 1;
            note(entry.itemId);
          }
          for (const entry of delveChestItemsForTier(tier, cls, rng, bountiful)) {
            lockpickEntries += 1;
            note(entry.itemId);
          }
        }
      }
    }
  }
  for (const npc of Object.values(NPCS)) for (const itemId of npc.vendorItems ?? []) note(itemId);
  for (const offer of HEROIC_VENDOR_STOCK) note(offer.itemId);
  for (const entries of Object.values(DELVE_SHOPS)) for (const entry of entries) note(entry.itemId);
  for (const stock of MARKET_HOUSE_STOCK) note(stock.itemId);
  for (const g of GROUND_OBJECTS) note(g.itemId);
  for (const band of FISHING_TABLES_BY_BAND) {
    for (const rows of Object.values(band)) for (const entry of rows) note(entry.itemId);
  }
  for (const quest of Object.values(QUESTS)) {
    for (const itemId of Object.values(quest.itemRewards ?? {})) note(itemId);
  }
  for (const recipe of ALL_RECIPES) note(recipe.resultItemId);
  const livePoor = new Set(
    Object.values(ITEMS)
      .filter((d) => d.quality === 'poor')
      .map((d) => d.id),
  );
  const unreachable = [...livePoor].filter((id) => !reachable.has(id)).sort();

  it('the chest walk visits every entry of both tables (a count that cannot rot silently)', () => {
    // 3 tiers x 9 classes x 2 bountiful arms x 2 stubs = 108 calls per table:
    // 189 Litany entries and 166 lockpick entries at the 11l QA, pinned PER
    // TABLE so a drift in one cannot hide behind a compensating drift in the
    // other. A table that stopped contributing (a renamed export, a tier the
    // satisfies clause missed) shrinks its own count before it could hide a
    // poor id.
    expect(litanyEntries).toBe(189);
    expect(lockpickEntries).toBe(166);
  });

  it('the reachable poor set is exactly the thirteen survivors with an acquisition route', () => {
    // The chipped tusk is back since the phase's sixth fix round
    // output-excluded it, and the bogiron nugget and the cracked fetish since
    // the 11l QA excluded them the same way (poor again; the fen-troll and
    // drowned-dead loot rows never moved).
    expect([...reachable].sort()).toEqual([
      'bogiron_nugget',
      'briny_idol',
      'chipped_tusk',
      'cracked_fetish',
      'deepfen_pearl',
      'frayed_prayer_beads',
      'inert_storm_shard',
      'moonpale_scale',
      'ogre_toe_ring',
      'pale_pearl',
      'soggy_boot',
      'soggy_moccasin',
      'tangled_weed',
    ]);
  });

  it('the unreachable poor remainder is exactly the Brightwood Glade wildlife pack', () => {
    // Authored in src/sim/content/items.ts under the wildlife-pack banner with
    // no loot, vendor, pickup, fishing, quest, or recipe route anywhere: they
    // exist in the catalog and count for nothing here.
    expect(unreachable).toEqual(['amber_hide', 'soft_down', 'stag_antler']);
  });

  it('the trigger amount fits inside the reachable pool', () => {
    // Phase 11l promoted five junk drops out of poor (eight until its sixth
    // fix round output-excluded the chipped tusk, seven until the 11l QA
    // excluded the bogiron nugget and the cracked fetish), cutting the
    // reachable pool from 18 to 13 against an amount of 10: a margin of
    // THREE. The meter recounts live quality, so a character holding promoted
    // trophies still sees an in-progress counter regress, and four more
    // promotions would strand the deed outright. Re-tuning the trigger is a maintainer decision
    // (docs/design/deeds.md, rule 9: no retro-editing a shipped trigger),
    // left OPEN in the phase ledger rather than edited here. The same doc's
    // rule 5 (no permanently missable deeds) names retroFallbackGrants
    // (src/sim/deeds.ts) as the sanctioned heal for exactly this failure
    // mode: a deed that can silently become permanently impossible for one
    // character is granted at world join from proof, or outright once no earn
    // path can ever exist again for that character.
    // trigger.amount itself is pinned by FROZEN_CATALOG_SHA256 earlier in
    // this file (the whole-catalog hash), so a silent retune reds there
    // before this arm ever sees it.
    const trigger = DEEDS.col_junk_drawer.trigger;
    if (trigger.kind !== 'meter') throw new Error('col_junk_drawer lost its meter trigger');
    expect(trigger.meter).toBe('poorItemsDiscoveredCount');
    expect(trigger.amount).toBeLessThanOrEqual(reachable.size);
  });
});
