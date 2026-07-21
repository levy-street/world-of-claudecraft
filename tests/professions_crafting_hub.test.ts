// Professions 2.0 Phase 8: crafting stations and the hands-vs-stations split
// (this file previously pinned the retired #1297 level-20 crafting hub; the
// name is kept so the deed-sourcing anchors in src/sim/content/deeds.ts stay
// valid). Pins the station CONTENT (STATIONS / STATION_TYPE_BY_CRAFT /
// STATION_RADIUS / FIELD_RECIPES), the pure geometry helpers, and the
// resolveCraft station gate: position-only (the old level arm is RETIRED,
// 2026-07-17 maintainer ruling), per-type, mobile-station aware, no side
// effect on denial. The reagent-sourcing arms (Quartermaster Bree's price
// literals) are carried over intact from the hub era.
import { describe, expect, it } from 'vitest';
import {
  CRAFT_RING,
  MOBILE_CRAFTING_STATION_DURATION_TICKS,
  STATION_RADIUS,
  STATION_TYPE_BY_CRAFT,
  STATIONS,
} from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  COMBO_RECIPES,
  COMMON_RECIPES,
  FIELD_RECIPES,
  TOOL_RECIPES,
} from '../src/sim/content/recipes';
import { ZONE1_ZONE } from '../src/sim/content/zone1';
import { ZONE2_ZONE } from '../src/sim/content/zone2';
import { ZONE3_ZONE } from '../src/sim/content/zone3';
import { ITEMS, NPCS } from '../src/sim/data';
import { craftItem, resolveCraft } from '../src/sim/professions/crafting';
import {
  isStationActive,
  placeMobileStationForPlayer,
} from '../src/sim/professions/mobile_station';
import { isAtStation, stationsOfType, stationTypeForCraft } from '../src/sim/professions/stations';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

function placeAt(sim: Sim, pid: number, pos: { x: number; z: number }) {
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

const toolworks = stationsOfType('toolworks')[0];
const tannery = stationsOfType('tannery')[0];

// A spot guaranteed outside EVERY station circle (far off the playfield).
const NOWHERE = { x: 5000, z: 5000 };

describe('station content (Phase 8)', () => {
  it('pins the six stations: id, type, zone, and resident master', () => {
    expect(
      STATIONS.map((s) => ({ id: s.id, type: s.type, zoneId: s.zoneId, master: s.masterNpcId })),
    ).toEqual([
      {
        id: 'station_eastbrook_forge',
        type: 'forge',
        zoneId: ZONE1_ZONE.id,
        master: 'forgemistress_darva',
      },
      {
        id: 'station_eastbrook_kitchens',
        type: 'kitchens',
        zoneId: ZONE1_ZONE.id,
        master: 'cook_marlow',
      },
      {
        id: 'station_eastbrook_loom',
        type: 'loom',
        zoneId: ZONE1_ZONE.id,
        master: 'weaver_ottilie',
      },
      {
        id: 'station_eastbrook_toolworks',
        type: 'toolworks',
        zoneId: ZONE1_ZONE.id,
        master: 'tinker_gizzel',
      },
      {
        id: 'station_fenbridge_tannery',
        type: 'tannery',
        zoneId: ZONE2_ZONE.id,
        master: 'tanner_hesk',
      },
      {
        id: 'station_highwatch_apothecary',
        type: 'apothecary',
        zoneId: ZONE3_ZONE.id,
        master: 'alchemist_verane',
      },
    ]);
    expect(STATION_RADIUS).toBe(20);
  });

  it('maps exactly the seven stationed crafts, each to a type with a real station', () => {
    expect(Object.entries(STATION_TYPE_BY_CRAFT).sort()).toEqual([
      ['alchemy', 'apothecary'],
      ['armorcrafting', 'forge'],
      ['cooking', 'kitchens'],
      ['engineering', 'toolworks'],
      ['leatherworking', 'tannery'],
      ['tailoring', 'loom'],
      ['weaponcrafting', 'forge'],
    ]);
    const ringIds = new Set(CRAFT_RING.map((c) => c.id));
    for (const [craftId, type] of Object.entries(STATION_TYPE_BY_CRAFT)) {
      expect(ringIds.has(craftId), `${craftId} must be a ring craft`).toBe(true);
      expect(stationsOfType(type).length, `${type} needs a physical station`).toBeGreaterThan(0);
    }
    // The three station-less crafts stay station-less (no station-bound
    // content exists for them today).
    for (const craftId of ['jewelcrafting', 'inscription', 'enchanting']) {
      expect(stationTypeForCraft(craftId)).toBeUndefined();
    }
  });

  it('FIELD_RECIPES is exactly the nine common recipes, and stamps split hands-vs-stations', () => {
    expect(COMMON_RECIPES.length).toBe(9);
    // Pinned to the nine LITERAL ids, not COMMON_RECIPES-derived: FIELD_RECIPES
    // is defined AS Set(COMMON_RECIPES ids) (recipes.ts), so a derived compare
    // is a tautology; only the literal list trips when a content edit adds,
    // drops, or swaps a common recipe.
    expect([...FIELD_RECIPES].sort()).toEqual(
      [
        'recipe_eastbrook_arming_sword',
        'recipe_eastbrook_chain_vest',
        'recipe_eastbrook_wool_trousers',
        'recipe_tanned_leather_jerkin',
        'recipe_tough_jerky',
        'recipe_minor_healing_potion',
        'recipe_eastbrook_ritual_vestments',
        'recipe_eastbrook_druids_hide',
        'recipe_eastbrook_warded_leggings',
      ].sort(),
    );
    // Hands: no common or combo recipe carries a stationType.
    for (const recipe of [...COMMON_RECIPES, ...COMBO_RECIPES]) {
      expect(recipe.stationType, `${recipe.id} must stay field-craftable`).toBeUndefined();
    }
    // Stations: every tool recipe is toolworks-bound; and every stamped type
    // is the one serving that recipe's own craft (no recipe demands a
    // foreign craft's station).
    for (const recipe of TOOL_RECIPES) {
      expect(recipe.stationType, recipe.id).toBe('toolworks');
    }
    for (const recipe of ALL_RECIPES) {
      if (recipe.stationType) {
        expect(recipe.stationType, `${recipe.id} station/craft mismatch`).toBe(
          stationTypeForCraft(recipe.professionId),
        );
      }
    }
  });
});

describe('isAtStation geometry (squared-distance, per type)', () => {
  it('is true at the station center and on the radius boundary, false one step past', () => {
    expect(isAtStation(toolworks.pos, 'toolworks')).toBe(true);
    expect(
      isAtStation({ x: toolworks.pos.x + STATION_RADIUS, z: toolworks.pos.z }, 'toolworks'),
    ).toBe(true);
    expect(
      isAtStation({ x: toolworks.pos.x + STATION_RADIUS + 1, z: toolworks.pos.z }, 'toolworks'),
    ).toBe(false);
  });

  it('discriminates per type: standing at the tannery is not being at the toolworks', () => {
    expect(isAtStation(tannery.pos, 'tannery')).toBe(true);
    expect(isAtStation(tannery.pos, 'toolworks')).toBe(false);
    expect(isAtStation(NOWHERE, 'tannery')).toBe(false);
  });
});

describe('resolveCraft station gate (Phase 8: position-only, per type)', () => {
  const recipeId = 'recipe_thorium_mining_pick'; // engineering -> toolworks

  function grantPickReagents(sim: Sim, pid: number) {
    grantItem(sim, 'thorium_ore', 4, pid);
    grantItem(sim, 'mithril_mining_pick', 1, pid);
  }

  it('denies with station_required away from every station, consuming nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeAt(sim, pid, NOWHERE);
    grantPickReagents(sim, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
    // no side effect: reagents untouched on denial
    expect(sim.countItem('thorium_ore', pid)).toBe(4);
    expect(sim.countItem('mithril_mining_pick', pid)).toBe(1);
  });

  it('a station of the WRONG type never satisfies the gate', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeAt(sim, pid, tannery.pos);
    grantPickReagents(sim, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('station_required');
  });

  it('succeeds at the matching station with NO level requirement (the level arm retired)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Deliberately level 1: the old hub gate denied under level 20; Phase 8
    // has no level arm at all.
    placeAt(sim, pid, toolworks.pos);
    grantPickReagents(sim, pid);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_ore', pid)).toBe(0);
    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
  });

  it('an own ACTIVE mobile station for the matching craft satisfies the gate in the field', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeAt(sim, pid, NOWHERE);
    grantPickReagents(sim, pid);
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.engineering = 75; // specialized: placement is gated on it
    const station = placeMobileStationForPlayer((sim as any).ctx, 'engineering', pid);
    expect(station).toBeDefined();
    expect(meta.mobileStation).toBe(station);

    const result = resolveCraft((sim as any).ctx, pid, recipeId);

    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
  });

  it('a mobile station for a DIFFERENT craft, or an expired one, does not satisfy', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeAt(sim, pid, NOWHERE);
    grantPickReagents(sim, pid);
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.cooking = 75;
    expect(placeMobileStationForPlayer((sim as any).ctx, 'cooking', pid)).toBeDefined();
    // kitchens is not toolworks: the wrong-craft mobile station denies.
    expect(resolveCraft((sim as any).ctx, pid, recipeId).reason).toBe('station_required');

    // The right craft, but expired: force the tick-domain expiry into the past.
    meta.craftSkills.engineering = 75;
    const station = placeMobileStationForPlayer((sim as any).ctx, 'engineering', pid)!;
    station.expiresAtTick = 0;
    expect(resolveCraft((sim as any).ctx, pid, recipeId).reason).toBe('station_required');
  });

  it('an unspecialized placement fails and leaves no station behind', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    expect(placeMobileStationForPlayer((sim as any).ctx, 'engineering', pid)).toBeUndefined();
    expect(meta.mobileStation).toBeNull();
  });

  it('never gates a field recipe: all nine common recipes craft far from any station', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    placeAt(sim, pid, NOWHERE);
    // Nine crafts stay under the #1301 throttle cap (10 per window), so every
    // success below is attributable to the missing station gate alone.
    expect(FIELD_RECIPES.size).toBe(9);
    for (const recipeId of FIELD_RECIPES) {
      const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
      expect(recipe, `${recipeId} missing from ALL_RECIPES`).toBeDefined();
      for (const reagent of recipe?.reagents ?? []) {
        grantItem(sim, reagent.itemId, reagent.count, pid);
      }
      const result = resolveCraft((sim as any).ctx, pid, recipeId);
      expect(result.ok, `${recipeId} must craft in the field`).toBe(true);
    }
  });

  it('mobileStation is transient: absent from the character save, null after a reload', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.engineering = 75;
    expect(placeMobileStationForPlayer((sim as any).ctx, 'engineering', pid)).toBeDefined();
    expect(meta.mobileStation).not.toBeNull();

    // The save path the online server persists through (serializeCharacter ->
    // addPlayer state): the station must never ride it, because its expiry is
    // tick-domain and tick counts are not restart-safe.
    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    expect(JSON.stringify(state)).not.toContain('mobileStation');

    const reloaded = makeSim(7);
    const reloadedPid = reloaded.addPlayer('warrior', 'Reloaded', { state: state ?? undefined });
    expect((reloaded as any).players.get(reloadedPid).mobileStation).toBeNull();
  });

  it('mobile-station activity is strict at the boundary: active at expiry-1, expired AT expiry', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.craftSkills.engineering = 75;
    const station = placeMobileStationForPlayer((sim as any).ctx, 'engineering', pid);
    expect(station).toBeDefined();
    if (!station) return;
    // isStationActive is a strict < on expiresAtTick: the expiry tick itself
    // is already inactive (the offline expired-arm test above overwrites the
    // tick wholesale, so only this pin holds the exact boundary).
    expect(isStationActive(station, station.expiresAtTick - 1)).toBe(true);
    expect(isStationActive(station, station.expiresAtTick)).toBe(false);
    // The window is the content constant, anchored at the placement tick.
    expect(station.expiresAtTick - station.placedAtTick).toBe(
      MOBILE_CRAFTING_STATION_DURATION_TICKS,
    );
  });
});

describe('station reagent sourcing (prog_tools_of_the_trade completability)', () => {
  const HUB_REAGENTS = [
    'thorium_ore',
    'arcanite_bar',
    'ashwood_log',
    'elderwood_log',
    'goldleaf_herb',
    'sunpetal_herb',
  ] as const;

  // Every id a player can actually buy: on some NPC's vendor list AND carrying
  // the buyValue the live buy path requires (items.ts buyItem checks both).
  const vendorSold = new Set<string>();
  for (const npc of Object.values(NPCS)) {
    for (const id of npc.vendorItems ?? []) if (ITEMS[id]?.buyValue) vendorSold.add(id);
  }

  function acquirable(itemId: string, seen: Set<string> = new Set()): boolean {
    if (vendorSold.has(itemId)) return true;
    if (seen.has(itemId)) return false;
    seen.add(itemId);
    // Each sibling reagent branch gets its own copy of the path: `seen` is a
    // cycle guard, not a global visited set, so a craftable intermediate
    // shared by two siblings is not wrongly reported unreachable.
    return ALL_RECIPES.some(
      (r) =>
        r.resultItemId === itemId && r.reagents.every((g) => acquirable(g.itemId, new Set(seen))),
    );
  }

  it('every toolworks tool-recipe reagent chain bottoms out at a live vendor', () => {
    // The deed needs one station craft, so at least one recipe must be
    // completable; this pins ALL six tool recipes, reagents and base tools
    // alike, so no future recipe or stock edit can silently strand the deed
    // again. (CASTER_HUB_RECIPES stay out of scope on purpose: their
    // linen/spider/bone reagents are mob drops, not vendor goods.)
    for (const recipe of TOOL_RECIPES) {
      for (const reagent of recipe.reagents) {
        expect(
          acquirable(reagent.itemId),
          `${recipe.id} reagent ${reagent.itemId} has no live source`,
        ).toBe(true);
      }
    }
  });

  it('Quartermaster Bree sells all six reagents from the Highwatch hub', () => {
    const bree = NPCS.quartermaster_bree;
    for (const id of HUB_REAGENTS) {
      expect(bree.vendorItems, `${id} missing from Bree's stock`).toContain(id);
    }
    // Bree's counter stays inside the Highwatch hub circle, so the shopping
    // trip is one stop (crafting then happens at the recipe's own station).
    const distToHub = Math.hypot(bree.pos.x - ZONE3_ZONE.hub.x, bree.pos.z - ZONE3_ZONE.hub.z);
    expect(distToHub).toBeLessThanOrEqual(ZONE3_ZONE.hub.radius);
    // Per-item price pins (literals, not derived): the trade-goods 4x staple
    // markup, and buy stays above sell so there is no vendor arbitrage loop. A
    // price-tier change on any single reagent must fail here, not slip past a
    // shared range check.
    const REAGENT_PRICES: Record<(typeof HUB_REAGENTS)[number], [number, number]> = {
      thorium_ore: [60, 15],
      arcanite_bar: [160, 40],
      ashwood_log: [60, 15],
      elderwood_log: [160, 40],
      goldleaf_herb: [60, 15],
      sunpetal_herb: [160, 40],
    };
    for (const id of HUB_REAGENTS) {
      const def = ITEMS[id];
      // Reagents are common (white), NOT a rarity color: a material must never fall
      // into the junk sweep (sellAllJunk vendors quality 'poor'). The tier lives in
      // the price, not the color.
      expect(def.quality, `${id} quality`).toBe('common');
      const [buyValue, sellValue] = REAGENT_PRICES[id];
      expect(def.buyValue, `${id} buyValue`).toBe(buyValue);
      expect(def.sellValue, `${id} sellValue`).toBe(sellValue);
    }
  });

  it('vendor purchases alone complete the deed: shop at Wilkes and Bree, craft at the toolworks', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const anySim = sim as any;
    const meta = anySim.players.get(pid);
    meta.copper = 390; // mithril_mining_pick 150 + four thorium_ore at 60, exact

    const npcEntity = (templateId: string) =>
      [...anySim.entities.values()].find((e: any) => e.templateId === templateId);

    // Every recipe input comes from a real vendor purchase, nothing granted:
    // the base tool from Trader Wilkes in Eastbrook, the ore from Bree.
    const wilkes = npcEntity('trader_wilkes');
    placeAt(sim, pid, wilkes.pos);
    sim.buyItem(wilkes.id, 'mithril_mining_pick');
    expect(sim.countItem('mithril_mining_pick', pid)).toBe(1);

    const bree = npcEntity('quartermaster_bree');
    placeAt(sim, pid, bree.pos);
    for (let i = 0; i < 4; i++) sim.buyItem(bree.id, 'thorium_ore');
    expect(sim.countItem('thorium_ore', pid)).toBe(4);
    expect(meta.copper).toBe(0); // both price literals held

    // Phase 8: the craft happens at the recipe's own station (the Eastbrook
    // toolworks), not at Bree's counter; a walk, never another purchase.
    placeAt(sim, pid, toolworks.pos);
    const result = craftItem(anySim.ctx, 'recipe_thorium_mining_pick', pid);
    expect(result.ok).toBe(true);
    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
    expect(sim.countItem('thorium_ore', pid)).toBe(0);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(true);
  });
});
