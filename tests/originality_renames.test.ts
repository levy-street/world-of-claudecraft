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
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { ZONE3_NPCS, ZONE3_QUESTS } from '../src/sim/content/zone3';
import { ITEMS } from '../src/sim/data';

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
