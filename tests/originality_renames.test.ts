// Literal pins for the display renames of the profession name-originality
// sweep. Each renamed string here has no other owning suite pinning its
// literal (titles and deed text are pinned in char_window / deeds_content;
// gathered materials and the koi in node_material_table / gather_event_i18n /
// guide.test), so this file is the decisive guard that a content edit or a
// bad merge cannot quietly reintroduce a colliding coin. Ids are frozen API
// and deliberately keep their historical spellings.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { ENCHANTS } from '../src/sim/content/enchants';
import { OVERWORLD_GRAVEYARDS } from '../src/sim/content/graveyards';
import { MOUNTS } from '../src/sim/content/mounts';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { INFERNAL_NOUNS, infernalCitadelName } from '../src/sim/content/rift/infernal_citadel';
import { TALENTS } from '../src/sim/content/talents';
import { ZONE3_NPCS, ZONE3_QUESTS } from '../src/sim/content/zone3';
import { ABILITIES, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { armorySkinStrings } from '../src/ui/i18n.catalog/armory';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { DICT } from '../src/ui/sim_i18n';

describe('originality-sweep display literals stay renamed', () => {
  it('pins the renamed enchant display names', () => {
    expect(ENCHANTS.enchant_weapon_runed_focus.name).toBe('Enchant Weapon - Runed Sigil');
    expect(ENCHANTS.enchant_chest_runeweave.name).toBe('Enchant Chest - Runed Weave');
  });

  it('pins the renamed quest, deed, and tool-effect names', () => {
    expect(ZONE3_QUESTS.q_stalker_pelts.name).toBe('First Frost at Highwatch');
    expect(DEEDS.exp_first_ore.name).toBe('Pick Meets Stone');
    expect(TOOL_EFFECTS.quickening_charm.name).toBe('Springback Charm');
  });

  it('pins the renamed item names with no other literal pin', () => {
    expect(ITEMS.stalkerhide_jerkin.name).toBe('Prowlhide Jerkin');
    expect(ITEMS.arcanite_bar.name).toBe('Glyphsteel Bar');
    expect(ITEMS.mithril_mining_pick.name).toBe('Skysilver Mining Pick');
    expect(ITEMS.sootscale_mantle.name).toBe('Kilnscale Mantle');
    expect(ITEMS.silverthread_slippers.name).toBe('Palethread Slippers');
    expect(ITEMS.goldweave_robe.name).toBe('Gildenweave Robe');
    expect(ITEMS.elderwood_log.name).toBe('Highpine Log');
    expect(ITEMS.elderwood_axe.name).toBe('Highpine Axe');
    expect(ITEMS.elderwood_battle_staff.name).toBe('Highpine Battle Staff');
    // The one deliberate id/name divergence that predates the sweep: the id
    // shipped, the display name already carried the original coin.
    expect(ITEMS.raw_stonescale_carp.name).toBe('Raw Slatefin Carp');
  });

  it('zone3 NPC display names were ruled keeps, not renames', () => {
    expect(ZONE3_NPCS.quartermaster_bree.name).toBe('Quartermaster Bree');
  });
});

// Masterwrought Phase 03 naming audit (R15, 2026-08-07): every confirmed
// collision renamed display-only. Old names additionally arm the ip_scrub
// denylist; verdicts + evidence live in docs/prd/masterwrought/naming-audit.md.
describe('phase 03 naming-audit display literals stay renamed', () => {
  it('pins the renamed ability display names', () => {
    expect(ABILITIES.crusader_strike.name).toBe('Oathstrike');
    expect(ABILITIES.heroic_leap.name).toBe('Vaulting Charge');
    expect(ABILITIES.holy_nova.name).toBe('Hallowburst');
    expect(ABILITIES.icy_veins.name).toBe('Coldsurge');
    expect(ABILITIES.victory_rush.name).toBe("Victor's Surge");
    expect(ABILITIES.wyvern_sting.name).toBe('Drakesting');
    expect(ABILITIES.glacial_spike.name).toBe('Rimeneedle');
    expect(ABILITIES.frozen_orb.name).toBe('Frostglobe');
    expect(ABILITIES.holy_shock.name).toBe('Lightjolt');
    expect(ABILITIES.storm_bolt.name).toBe('Thunderhurl');
    expect(ABILITIES.vanish.name).toBe('Smokefade');
    expect(ABILITIES.counterspell.name).toBe('Spellsever');
    expect(ABILITIES.spellsteal.name).toBe('Spellplunder');
    expect(ABILITIES.swiftmend.name).toBe('Fleetmend');
    expect(ABILITIES.summon_voidwalker.name).toBe('Summon Duskmurk');
    expect(ABILITIES.avenging_wrath.name).toBe('Zealwing');
    expect(ABILITIES.blink.name).toBe('Flitstep');
  });

  it('pins the renamed item display names', () => {
    expect(ITEMS.wyrmcult_grand_robe.name).toBe('Broodsworn Grand Robe');
    expect(ITEMS.wyrmcult_orders.name).toBe('Broodsworn Orders');
    expect(ITEMS.wyrmcult_soulsteps.name).toBe('Broodsworn Soulsteps');
    expect(ITEMS.wyrmcult_spellgrips.name).toBe('Broodsworn Spellgrips');
    expect(ITEMS.cryptbloom_shoulderguards.name).toBe('Tombpetal Shoulderguards');
    expect(ITEMS.frostmane_mantle.name).toBe('Mantle of the Rimemane');
    expect(ITEMS.varric_shadow_cowl.name).toBe("Vandric's Shadow Cowl");
    expect(ITEMS.mistforged_pauldrons.name).toBe('Fogforged Pauldrons');
    expect(ITEMS.reins_terrorspark_groundshaker.name).toBe('Ignition Key: Dreadspark Groundshaker');
  });

  it('pins the renamed mob, pet, and mechanic display names', () => {
    expect(MOBS.wyrmcult_zealot.name).toBe('Broodsworn Zealot');
    expect(MOBS.wyrmcult_necromancer.name).toBe('Broodsworn Necromancer');
    expect(MOBS.frostmane_yeti.name).toBe('Rimemane Yeti');
    expect(MOBS.nightkin_stargazer.name).toBe('Gloamkin Stargazer');
    expect(MOBS.deacon_varric.name).toBe('Deacon Vandric');
    expect(MOBS.harvest_sprite.name).toBe('Gleaning Sprite');
    expect(MOBS.gloomshade.name).toBe('Duskmurk');
    expect((MOBS.rift_hellguard as { cleave?: { name?: string } }).cleave?.name).toBe(
      'Pitsteel Sweep',
    );
    expect((MOBS.rift_boss_pitlord as { aoePulse?: { name?: string } }).aoePulse?.name).toBe(
      'Pitfire Ring',
    );
    expect((MOBS.shardlord_kazzix as { frostbite?: { name?: string } }).frostbite?.name).toBe(
      'Wintergnaw',
    );
  });

  it('pins the rift set-piece noun pool past the Hellfire Citadel collision (QA round)', () => {
    // The composed rift name is built from INFERNAL_NOUNS, a code constant no
    // content-row scan can see: with 'Hellfire' in the pool, 1 in 4 set-piece
    // seeds rendered 'The Hellfire Citadel', another game's instanced-dungeon
    // name verbatim. Pin the pool AND the composed surface, because a future
    // pool edit could reintroduce the collision without touching any name row.
    expect(INFERNAL_NOUNS).toContain('Pitfire');
    expect(INFERNAL_NOUNS).not.toContain('Hellfire');
    for (let seed = 0; seed < 256; seed++) {
      expect(infernalCitadelName(seed)).not.toContain('Hellfire');
    }
  });

  it('pins the renamed NPC, town, and POI display names', () => {
    expect(NPCS.hermit_okku.name).toBe('Okrim');
    expect(NPCS.provisioner_fenna.title).toBe('Eldershine Provisioner');
    expect(NPCS.sexton_marrow.title).toBe('Sexton of Gibbetmere');
    expect(NPCS.widow_tansy.title).toBe('Candlewright of Gibbetmere');
    const wraithwood = ZONES.find((z) => z.id === 'wraithwood');
    const veiled = ZONES.find((z) => z.id === 'veiled_hollow');
    const nightbloom = ZONES.find((z) => z.id === 'nightbloom');
    const thornpeak = ZONES.find((z) => z.id === 'thornpeak_heights');
    expect(wraithwood?.hub.name).toBe('Gibbetmere');
    // POIs resolve by frozen poi id, not index, so a reordered list cannot
    // misattribute a rename regression to the wrong point.
    expect(wraithwood?.pois?.find((p) => p.id === 'gallowmere')?.label).toBe('Gibbetmere');
    expect(veiled?.hub.name).toBe('Eldershine');
    expect(veiled?.pois?.find((p) => p.id === 'eldergleam')?.label).toBe('Eldershine');
    expect(nightbloom?.pois?.find((p) => p.id === 'the_moonwell')?.label).toBe('The Moonspring');
    expect(thornpeak?.pois?.find((p) => p.id === 'wyrmcult_tents')?.label).toBe('Broodsworn Tents');
    expect(OVERWORLD_GRAVEYARDS.find((g) => g.id === 'gy_veiled_hollow')?.name).toBe(
      'Eldershine Rest',
    );
  });

  it('pins the renamed quest, deed, spec, mount, and skin display names', () => {
    expect(QUESTS.q_ww_bells_of_gallowmere.name).toBe('The Bells of Gibbetmere');
    expect(QUESTS.q_fv_frostmane_tyrant.name).toBe('The Rimemane Tyrant');
    expect(DEEDS.dgn_sanctum_speed.name).toBe('Sanctum Footrace');
    expect(DEEDS.chr_nightbloom_first_cast.name).toBe('A Ripple on the Moonspring');
    // Phase 03 renamed this title Banneret; release/v0.36.0's own IP-safe
    // honor-title re-cut (PR #3133) landed Fieldreaver for the same deed and
    // supersedes the phase name, so the pin follows the release.
    expect(DEEDS.pvp_honor_knight_lieutenant.name).toBe('Fieldreaver');
    expect(DEEDS.pvp_honor_knight_lieutenant.reward).toEqual({
      kind: 'title',
      text: 'Fieldreaver',
    });
    const resto = TALENTS.shaman.specs.find((s) => s.id === 'restoration');
    expect(resto?.name).toBe('Spiritcall');
    expect(MOUNTS.terrorspark_groundshaker.name).toBe('Dreadspark Groundshaker');
    // Both layers for the skin: the catalog source of truth AND the resolved
    // artifact (the latter is only decisive after an i18n regen).
    expect(armorySkinStrings.winterbite.name).toBe('Wintergnaw');
    expect(en.hudChrome.wocStore.skins.winterbite.name).toBe('Wintergnaw');
    expect(en.hudChrome.mounts.name_terrorspark_groundshaker).toBe('Dreadspark Groundshaker');
    // The sim matcher's English aura label is its own surface (sim_i18n is not
    // part of the resolved catalog): pin it beside the mechanic def pin above.
    expect(DICT.en['aura.frostbite']).toBe('Wintergnaw');
  });
});
