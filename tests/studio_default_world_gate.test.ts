// The Studio merge gate: every Studio change to the BUILT-IN world takes effect
// only while an authored map is the active content. The default world must
// read exactly like the release it was merged into (the parity goldens pin the
// tick-level behaviour; this pins the tables and constants behind it), and an
// authored map must still get the Studio's content and traversal band.

import { afterEach, describe, expect, it } from 'vitest';
import { MANTLE_REACH } from '../src/sim/colliders';
import { OVERWORLD_GRAVEYARDS } from '../src/sim/content/graveyards';
import {
  ARENA_X_MAX,
  authoredMapActive,
  BUILTIN_WORLD,
  DELVE_BAND_X_MIN,
  DUNGEON_LIST,
  DUNGEONS,
  dungeonByIndex,
  ITEMS,
  isArenaPos,
  isBuiltinWorldActive,
  MOBS,
  NPCS,
  QUEST_ORDER,
  QUESTS,
  setActiveWorldContent,
  studioContentActive,
  ZONES,
} from '../src/sim/data';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { LEDGE_GRAB_MIN } from '../src/sim/physics/ledge';
import { traversalBand } from '../src/sim/traversal_band';
import { WORLD_BOSSES } from '../src/sim/world_boss';

// The release/v0.45.0 dungeon roster, by id and index (index 6 is unused). An
// authored map registers no dungeon of its own, so the roster never changes.
const RELEASE_DUNGEONS = [
  'hollow_crypt#0',
  'sunken_bastion#1',
  'gravewyrm_sanctum#2',
  'drowned_temple#3',
  'nythraxis_crypt#4',
  'nythraxis_boss_arena#5',
  'wildheart_basin#7',
  'the_last_keep#8',
  'dawnhold_castle#9',
  'ignivar_forge_approach#10',
  'ignivar_raid_arena#11',
  'ignivar_inner_crucible#12',
  'ignivar_molten_assembly#13',
  'ignivar_forge_lift#14',
];

const STUDIO_ITEM_IDS = ['brimming_waterskin', 'duneblade_token'];
const STUDIO_QUEST_IDS = ['q_sw_arrival'];
const STUDIO_MOB_IDS = ['duneblade_marauder', 'objective_practice_champion'];
const STUDIO_NPC_IDS = ['caravan_master_saffa'];

afterEach(() => setActiveWorldContent(null));

describe('the default world reads exactly like the release', () => {
  it('keeps the release dungeon roster, zones and graveyards', () => {
    expect(isBuiltinWorldActive()).toBe(true);
    expect(studioContentActive()).toBe(false);
    expect(DUNGEON_LIST.map((d) => `${d.id}#${d.index}`)).toEqual(RELEASE_DUNGEONS);
    expect(Object.keys(DUNGEONS)).toHaveLength(RELEASE_DUNGEONS.length);
    expect(dungeonByIndex(6)).toBeNull();
    expect(ZONES.map((z) => z.id)).not.toContain('goldcrest_harbor');
    expect(OVERWORLD_GRAVEYARDS.map((g) => g.id)).not.toContain('gy_goldcrest');
  });

  it('registers no Studio items, quests, mobs or NPC rows', () => {
    for (const id of STUDIO_ITEM_IDS) expect(ITEMS[id], id).toBeUndefined();
    for (const id of STUDIO_QUEST_IDS) {
      expect(QUESTS[id], id).toBeUndefined();
      expect(QUEST_ORDER).not.toContain(id);
    }
    for (const id of STUDIO_MOB_IDS) expect(MOBS[id], id).toBeUndefined();
    for (const id of STUDIO_NPC_IDS) expect(NPCS[id], id).toBeUndefined();
  });

  it('schedules only the release world bosses', () => {
    // The v0.45.0 integration's roster: Thunzharr plus Balgath of the Mirefen.
    // Studio's own bosses (STUDIO_WORLD_BOSSES) are never scheduled.
    expect(WORLD_BOSSES.map((b) => b.templateId)).toEqual([
      'thunzharr_waking_peak',
      'balgath_cyclops',
    ]);
  });

  it('keeps the release traversal band (stride, mantle, ledge grab all 0.9)', () => {
    expect(MAX_STEP_HEIGHT).toBe(0.9);
    expect(MANTLE_REACH).toBe(0.9);
    expect(LEDGE_GRAB_MIN).toBe(0.9);
    expect(traversalBand()).toBe(0.9);
  });

  it('keeps the release arena band, running on to the delve band', () => {
    expect(isArenaPos(ARENA_X_MAX + 1)).toBe(true);
    expect(isArenaPos(DELVE_BAND_X_MIN - 1)).toBe(true);
    expect(isArenaPos(DELVE_BAND_X_MIN)).toBe(false);
  });
});

describe('an authored map gets the Studio content and band', () => {
  it('treats a plain variant of the shipped world as the release world', () => {
    // A `{ ...BUILTIN_WORLD }` fixture (tests, playtest copies) is not an
    // authored map: no overlay, release band, release arena band.
    setActiveWorldContent({ ...BUILTIN_WORLD });
    expect(authoredMapActive()).toBe(false);
    expect(studioContentActive()).toBe(false);
    expect(traversalBand()).toBe(0.9);
    // A map document carries a placements list; an authored slate carries a
    // presentation mode. Either one is an authored map.
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    expect(authoredMapActive()).toBe(true);
    setActiveWorldContent({ ...BUILTIN_WORLD, presentationMode: 'blank' });
    expect(authoredMapActive()).toBe(true);
  });

  it('merges the Studio records in, and strips them again on the way back', () => {
    const caddisQuests = [...NPCS.loremaster_caddis.questIds];
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    expect(studioContentActive()).toBe(true);
    // No Studio dungeon: the roster, index 6 and the built-in quest givers'
    // offers are the release's on an authored map too.
    expect(DUNGEON_LIST.map((d) => `${d.id}#${d.index}`)).toEqual(RELEASE_DUNGEONS);
    expect(dungeonByIndex(6)).toBeNull();
    expect(NPCS.loremaster_caddis.questIds).toEqual(caddisQuests);
    for (const id of STUDIO_ITEM_IDS) expect(ITEMS[id], id).toBeDefined();
    for (const id of STUDIO_QUEST_IDS) {
      expect(QUESTS[id], id).toBeDefined();
      expect(QUEST_ORDER).toContain(id);
    }
    for (const id of STUDIO_MOB_IDS) expect(MOBS[id], id).toBeDefined();
    for (const id of STUDIO_NPC_IDS) expect(NPCS[id], id).toBeDefined();
    // the release arena band, running on to the delve band
    expect(isArenaPos(ARENA_X_MAX + 1)).toBe(true);

    setActiveWorldContent(null);
    expect(studioContentActive()).toBe(false);
    expect(DUNGEON_LIST.map((d) => `${d.id}#${d.index}`)).toEqual(RELEASE_DUNGEONS);
    expect(dungeonByIndex(6)).toBeNull();
    for (const id of STUDIO_ITEM_IDS) expect(ITEMS[id], id).toBeUndefined();
    for (const id of STUDIO_QUEST_IDS) expect(QUEST_ORDER).not.toContain(id);
    for (const id of STUDIO_NPC_IDS) expect(NPCS[id], id).toBeUndefined();
    expect(NPCS.loremaster_caddis.questIds).toEqual(caddisQuests);
  });

  it('strides, mantles and grabs on the Studio band', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    expect(traversalBand()).toBe(1.0);
    setActiveWorldContent(null);
    expect(traversalBand()).toBe(0.9);
  });

  it('keeps the overlay idempotent across authored-to-authored swaps', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    const order = QUEST_ORDER.filter((id) => id === 'q_sw_arrival');
    expect(order).toHaveLength(1);
    expect(MOBS.duneblade_marauder).toBeDefined();
  });
});
