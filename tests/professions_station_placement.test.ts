// Professions 2.0 Phase 8: station and master PLACEMENT safety, the
// master-to-zone assignment, the hands-vs-stations recipe split, and the
// fixed-seed determinism of a world that now spawns the six master NPCs.
//
// The placement-safety arm is derived from content, not hardcoded distances:
// a station (or its resident master) must keep at least the camp-safety
// margin every PRE-EXISTING town NPC already satisfies. The buffer is
// computed in this test from the same zone content the sim spawns from
// (strictest existing margin across all three town hubs; at authoring time
// that is about 11.19 units, bursar_fernando against the wild_boar camp), so
// a future camp or NPC edit moves the bar instead of rotting a literal.
import { describe, expect, it } from 'vitest';
import { STATION_RADIUS, STATIONS } from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  CASTER_HUB_RECIPES,
  FIELD_RECIPES,
  TOOL_RECIPES,
} from '../src/sim/content/recipes';
import { ZONE1_CAMPS, ZONE1_CHAPEL_CAMPS, ZONE1_NPCS, ZONE1_ZONE } from '../src/sim/content/zone1';
import { ZONE2_CAMPS, ZONE2_NPCS, ZONE2_ZONE } from '../src/sim/content/zone2';
import { ZONE3_CAMPS, ZONE3_NPCS, ZONE3_ZONE } from '../src/sim/content/zone3';
import { MOBS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { CampDef, NpcDef } from '../src/sim/types';

interface ZoneContent {
  zone: typeof ZONE1_ZONE;
  npcs: Record<string, NpcDef>;
  camps: CampDef[];
}

// Per-zone camp selection: a Fenbridge master is checked against zone 2
// camps only. Zone 1 includes the appended chapel camps (spawned last but
// just as hostile).
const ZONE_CONTENT: ZoneContent[] = [
  { zone: ZONE1_ZONE, npcs: ZONE1_NPCS, camps: [...ZONE1_CAMPS, ...ZONE1_CHAPEL_CAMPS] },
  { zone: ZONE2_ZONE, npcs: ZONE2_NPCS, camps: ZONE2_CAMPS },
  { zone: ZONE3_ZONE, npcs: ZONE3_NPCS, camps: ZONE3_CAMPS },
];

function zoneContentById(zoneId: string): ZoneContent {
  const entry = ZONE_CONTENT.find((z) => z.zone.id === zoneId);
  if (!entry) throw new Error(`no zone content for ${zoneId}`);
  return entry;
}

// Hostile = the camp's mob template aggro-pulls on proximity. A missing
// template is a content error, never silently non-hostile.
function hostileCamps(camps: CampDef[]): CampDef[] {
  return camps.filter((camp) => {
    const mob = MOBS[camp.mobId];
    if (!mob) throw new Error(`camp mob ${camp.mobId} missing from MOBS`);
    return mob.aggroRadius > 0;
  });
}

// How far past a camp's worst-case pull edge (spawn radius plus aggro
// radius) a position sits. Negative means inside pull range.
function marginToCamp(pos: { x: number; z: number }, camp: CampDef): number {
  const dist = Math.hypot(pos.x - camp.center.x, pos.z - camp.center.z);
  return dist - camp.radius - MOBS[camp.mobId].aggroRadius;
}

function worstMargin(pos: { x: number; z: number }, camps: CampDef[]): number {
  return Math.min(...camps.map((camp) => marginToCamp(pos, camp)));
}

function distTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const MASTER_IDS = new Set(STATIONS.map((s) => s.masterNpcId));

// The pre-existing town NPCs the safety bar is derived from: statically
// placed (non-dynamic) NPCs standing inside their zone's hub circle,
// excluding the six Phase 8 masters themselves (the bar must be what the
// town already satisfied BEFORE the masters arrived).
function townNpcs(entry: ZoneContent): NpcDef[] {
  return Object.values(entry.npcs).filter(
    (npc) =>
      !npc.dynamic &&
      !MASTER_IDS.has(npc.id) &&
      distTo(npc.pos, entry.zone.hub) <= entry.zone.hub.radius,
  );
}

function safetyBuffer(): number {
  let buffer = Infinity;
  for (const entry of ZONE_CONTENT) {
    const camps = hostileCamps(entry.camps);
    expect(camps.length, `${entry.zone.id} needs hostile camps`).toBeGreaterThan(0);
    const npcs = townNpcs(entry);
    expect(npcs.length, `${entry.zone.id} needs pre-existing town NPCs`).toBeGreaterThan(0);
    for (const npc of npcs) buffer = Math.min(buffer, worstMargin(npc.pos, camps));
  }
  return buffer;
}

describe('station and master placement safety (derived from content)', () => {
  it('every station and master clears the strictest existing town-NPC camp margin', () => {
    const buffer = safetyBuffer();
    // The bar itself must be meaningful: finite (camps exist) and positive
    // (no existing town NPC stands inside a camp's pull range), otherwise
    // the comparisons below would pass vacuously.
    expect(Number.isFinite(buffer)).toBe(true);
    expect(buffer).toBeGreaterThan(0);

    for (const station of STATIONS) {
      const entry = zoneContentById(station.zoneId);
      const camps = hostileCamps(entry.camps);
      expect(
        worstMargin(station.pos, camps),
        `${station.id} sits closer to a hostile camp than any existing town NPC`,
      ).toBeGreaterThan(buffer);

      const master = NPCS[station.masterNpcId];
      expect(master, `${station.masterNpcId} missing from merged NPCS`).toBeDefined();
      expect(
        worstMargin(master.pos, camps),
        `${station.masterNpcId} sits closer to a hostile camp than any existing town NPC`,
      ).toBeGreaterThan(buffer);
    }
  });

  it('each master stands beside their station, both inside the hosting hub circle', () => {
    for (const station of STATIONS) {
      const entry = zoneContentById(station.zoneId);
      const master = NPCS[station.masterNpcId];
      expect(master, station.masterNpcId).toBeDefined();
      // Beside, not merely near: the master is the station's one visible
      // anchor today, so they must read as attached to it (and trivially
      // stand inside its STATION_RADIUS gate circle).
      expect(distTo(master.pos, station.pos), `${station.masterNpcId} strayed`).toBeLessThanOrEqual(
        3,
      );
      expect(distTo(station.pos, entry.zone.hub), `${station.id} outside hub`).toBeLessThanOrEqual(
        entry.zone.hub.radius,
      );
      expect(
        distTo(master.pos, entry.zone.hub),
        `${station.masterNpcId} outside hub`,
      ).toBeLessThanOrEqual(entry.zone.hub.radius);
      expect(STATION_RADIUS).toBeGreaterThan(3);
    }
  });

  it('pins the master-to-zone assignment: four Eastbrook anchors, tannery in Fenbridge, apothecary in Highwatch', () => {
    expect(STATIONS.map((s) => [s.masterNpcId, s.zoneId, s.id, s.type])).toEqual([
      ['forgemistress_darva', 'eastbrook_vale', 'station_eastbrook_forge', 'forge'],
      ['cook_marlow', 'eastbrook_vale', 'station_eastbrook_kitchens', 'kitchens'],
      ['weaver_ottilie', 'eastbrook_vale', 'station_eastbrook_loom', 'loom'],
      ['tinker_gizzel', 'eastbrook_vale', 'station_eastbrook_toolworks', 'toolworks'],
      ['tanner_hesk', 'mirefen_marsh', 'station_fenbridge_tannery', 'tannery'],
      ['alchemist_verane', 'thornpeak_heights', 'station_highwatch_apothecary', 'apothecary'],
    ]);
  });
});

describe('hands-vs-stations recipe split (FIELD_RECIPES)', () => {
  it('FIELD_RECIPES is exactly the nine common recipe ids, none station-stamped', () => {
    expect([...FIELD_RECIPES].sort()).toEqual([
      'recipe_eastbrook_arming_sword',
      'recipe_eastbrook_chain_vest',
      'recipe_eastbrook_druids_hide',
      'recipe_eastbrook_ritual_vestments',
      'recipe_eastbrook_warded_leggings',
      'recipe_eastbrook_wool_trousers',
      'recipe_minor_healing_potion',
      'recipe_tanned_leather_jerkin',
      'recipe_tough_jerky',
    ]);
    for (const recipeId of FIELD_RECIPES) {
      const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
      expect(recipe, `${recipeId} missing from ALL_RECIPES`).toBeDefined();
      expect(recipe?.stationType, `${recipeId} must stay field-craftable`).toBeUndefined();
    }
  });

  it('every tool and caster hub recipe carries its literal station stamp', () => {
    expect(
      Object.fromEntries(
        [...TOOL_RECIPES, ...CASTER_HUB_RECIPES].map((r) => [r.id, r.stationType]),
      ),
    ).toEqual({
      recipe_thorium_mining_pick: 'toolworks',
      recipe_arcanite_mining_pick: 'toolworks',
      recipe_ashwood_axe: 'toolworks',
      recipe_elderwood_axe: 'toolworks',
      recipe_goldleaf_sickle: 'toolworks',
      recipe_sunpetal_sickle: 'toolworks',
      recipe_wardweave_cowl: 'loom',
      recipe_duskhide_wraps: 'tannery',
      recipe_sootscale_mantle: 'forge',
    });
  });

  it('every station-stamped recipe resolves to a station that exists in the world', () => {
    // The stranding guard: a future recipe stamped with a stationType that has
    // no STATIONS record would be silently uncraftable everywhere (the gate
    // denies and no physical station can ever satisfy it). Derived from
    // content so it moves with both tables.
    const placedTypes = new Set(STATIONS.map((s) => s.type));
    for (const recipe of ALL_RECIPES) {
      if (!recipe.stationType) continue;
      expect(
        placedTypes.has(recipe.stationType),
        `${recipe.id} requires a '${recipe.stationType}' station but STATIONS places none`,
      ).toBe(true);
    }
  });
});

describe('determinism with the six masters spawned', () => {
  function projection(sim: Sim) {
    return [...(sim as unknown as { entities: Map<number, any> }).entities.values()].map((e) => ({
      id: e.id,
      templateId: e.templateId ?? null,
      x: e.pos.x,
      z: e.pos.z,
      hp: e.hp,
      level: e.level,
    }));
  }

  it('two same-seed worlds tick to identical states, master NPCs included', () => {
    const a = new Sim({ seed: 20061, playerClass: 'warrior', autoEquip: false });
    const b = new Sim({ seed: 20061, playerClass: 'warrior', autoEquip: false });
    for (let i = 0; i < 100; i++) {
      a.tick();
      b.tick();
    }
    const pa = projection(a);
    expect(pa).toEqual(projection(b));
    // The projection genuinely includes the Phase 8 content: all six masters
    // spawned as world entities in both runs.
    const templates = new Set(pa.map((e) => e.templateId));
    for (const station of STATIONS) {
      expect(templates.has(station.masterNpcId), station.masterNpcId).toBe(true);
    }
  });
});
