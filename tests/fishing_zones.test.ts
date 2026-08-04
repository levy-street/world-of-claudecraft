// The skill-versus-zone axis (D9): which rod a zone's water takes, what a
// cast does when you do not carry it, and the schedule the nine catch-table
// cells are authored against.
//
// The zone column is DERIVED from GATHER_NODES here, the way
// tests/material_grades.test.ts derives its own gather-tier column, so
// re-tiering a zone's ground and leaving its water behind fails loudly
// instead of quietly moving who can fish where.
import { afterEach, describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { DEEDS } from '../src/sim/content/deeds';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import {
  BUILTIN_WORLD,
  DEEPFEN_SHALLOWS_LAKE,
  ITEMS,
  LAKE,
  setActiveWorldContent,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import {
  completeFishing,
  FISH_BITE_DELAY_MAX_SEC,
  FISH_BITE_DELAY_MIN_SEC,
  FISH_BITE_DELAY_ROD_REDUCTION_SEC,
  FISH_REEL_WINDOW_RARITY_BONUS_SEC,
  FISH_REEL_WINDOW_ROD_BONUS_SEC,
  FISH_REEL_WINDOW_SEC,
  FISHING_GAIN_SCHEDULE,
  fishingTeachingCeilingFor,
  fishReelWindowSecFor,
  startFishing,
} from '../src/sim/professions/fishing';
import {
  DEFAULT_FISHING_ROD_TIER,
  FISHING_ZONE_ROD_TIERS,
  rodTierRequiredForZone,
} from '../src/sim/professions/fishing_zones';
import { isGatherToolUse } from '../src/sim/professions/tools';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { zonesReadout } from '../src/sim/social/chat_readouts';
import {
  DT,
  FISHING_CAST_ID,
  FISHING_SESSION_CAP_SEC,
  type ItemDef,
  type SimEvent,
} from '../src/sim/types';
import { terrainHeight, waterLevel, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// DERIVED from the authored tables' own keys, never a hand list: the
// shortfall-schedule sweep below must conscript a NEW zone's catch table the
// moment one is authored (the new-zone checklist in
// tests/professions_zone_rollout.test.ts pins only sum-100 and the
// empty-hook row; THIS file is where the cells' authoring rule lives, and a
// hand-kept list was exactly how a fourth zone's table would have dodged
// it). The starter zones fall back to the Vale rows and so have no keys
// here until their zone-4 re-tier authors real tables.
const ZONE_IDS = Object.keys(FISHING_TABLES_BY_BAND[0]).sort();
const EXPANSION_ZONE_IDS = [
  'veiled_hollow',
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'evergarden',
  'galecrest',
  'farshore_isle',
];
const KOI = 'glimmerfin_koi';
const JUNK_ROWS: Record<string, string[]> = {
  eastbrook_vale: ['tangled_weed'],
  mirefen_marsh: ['soggy_boot', 'tangled_weed'],
  thornpeak_heights: ['tangled_weed'],
};

// The band side of the ladder, which lives here rather than in the module: it
// is the rule the nine catch-table cells were AUTHORED against, and nothing at
// runtime asks it anything (the engine reads the table it is handed). A zone's
// required band is the band its required rod unlocks, which is rodTier - 1
// under the shipped band gate.
const requiredBandFor = (zoneId: string): number =>
  Math.min(2, Math.max(0, rodTierRequiredForZone(zoneId) - 1));
/** How many bands short of the zone's requirement a band is, 0 at or above. */
const shortfallFor = (zoneId: string, band: number): number =>
  Math.min(2, Math.max(0, requiredBandFor(zoneId) - band));
/** How many bands ABOVE the requirement a band sits, 0 when short or at it. */
const surplusFor = (zoneId: string, band: number): number =>
  Math.min(2, Math.max(0, band - requiredBandFor(zoneId)));

function makeSim(seed = 4242): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** South shore of a lake, facing its centre: fishable water ahead. */
function faceLake(sim: Sim, lake: { x: number; z: number; radius: number }): void {
  const pz = lake.z - lake.radius - 2;
  teleportTo(sim, lake.x, pz);
  sim.player.facing = Math.atan2(0, lake.z - pz);
}

/**
 * A dry, water-facing spot on a lake's shore, found by probing the REAL
 * startFishing with tackle good enough for the zone (its deny arms are all
 * draw-free, so failed probes never touch the stream). Returned as plain
 * coordinates so a caller can place a DIFFERENT angler there and be sure the
 * only thing that can refuse them is the rod.
 */
function fishableSpotOn(lake: { x: number; z: number; radius: number }): {
  x: number;
  z: number;
  facing: number;
} {
  const sim = makeSim();
  const meta = sim.meta(sim.playerId) as PlayerMeta;
  sim.addItem('silverstream_fishing_rod', 1);
  for (let r = lake.radius * 0.7; r <= lake.radius + 10; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = lake.x + Math.cos(a) * r;
      const z = lake.z + Math.sin(a) * r;
      teleportTo(sim, x, z);
      const facing = Math.atan2(lake.x - x, lake.z - z);
      sim.player.facing = facing;
      startFishing(sim.ctx, sim.player, meta);
      if (sim.player.castingAbility === FISHING_CAST_ID) {
        sim.player.castingAbility = null;
        sim.player.castRemaining = 0;
        sim.player.fishBiteAtTick = 0;
        sim.player.fishReelDeadlineTick = 0;
        return { x, z, facing };
      }
    }
  }
  throw new Error('no dry fishable shore spot found');
}

function placeAt(sim: Sim, spot: { x: number; z: number; facing: number }): void {
  teleportTo(sim, spot.x, spot.z);
  sim.player.facing = spot.facing;
}

function deniedEvents(events: readonly SimEvent[]) {
  return events.filter((e) => (e as { type: string }).type === 'gatherDenied');
}

const weightOf = (band: number, zoneId: string, itemId: string | null): number => {
  const row = FISHING_TABLES_BY_BAND[band][zoneId].find((r) => r.itemId === itemId);
  expect(row, `missing ${zoneId} band ${band} row for ${itemId ?? 'null'}`).toBeDefined();
  return row?.weight ?? Number.NaN;
};

const junkTotal = (band: number, zoneId: string): number =>
  JUNK_ROWS[zoneId].reduce((sum, id) => sum + weightOf(band, zoneId, id), 0);

describe('the rod a zone takes', () => {
  it('IS the zone tier its own ground carries (content and gate cannot drift apart)', () => {
    // Derived from GATHER_NODES, exactly like the fine-material gather-tier
    // column: a zone's water asks for the same rung its veins do.
    const highestNodeTierIn = (zoneId: string) =>
      Math.max(...GATHER_NODES.filter((n) => n.zoneId === zoneId).map((n) => n.tier));
    let checked = 0;
    for (const zoneId of [...ZONE_IDS, ...EXPANSION_ZONE_IDS]) {
      expect(rodTierRequiredForZone(zoneId), zoneId).toBe(highestNodeTierIn(zoneId));
      checked += 1;
    }
    expect(checked).toBe(14);
    // And the ladder really is a ladder, so the loop above is not three copies
    // of one number.
    expect(rodTierRequiredForZone('eastbrook_vale')).toBe(1);
    expect(rodTierRequiredForZone('mirefen_marsh')).toBe(2);
    expect(rodTierRequiredForZone('thornpeak_heights')).toBe(3);
  });

  it('covers every zone the world ships, and floors an unknown one at tier 1', () => {
    for (const zone of ZONES) {
      expect(FISHING_ZONE_ROD_TIERS[zone.id], zone.id).toBeDefined();
    }
    expect(Object.keys(FISHING_ZONE_ROD_TIERS).sort()).toEqual(
      [...ZONE_IDS, ...EXPANSION_ZONE_IDS].sort(),
    );
    // The floor is what keeps a zone that ever ships without a row castable,
    // matching the catch table's own fall back to the Vale rows.
    expect(rodTierRequiredForZone('no_such_zone')).toBe(DEFAULT_FISHING_ROD_TIER);
    expect(DEFAULT_FISHING_ROD_TIER).toBe(1);
  });

  it('never resolves a prototype key as a zone row', () => {
    // The tier map is an object literal, so a bare index would answer
    // `constructor` and friends with a function, not a tier. The resolver
    // guards with Object.hasOwn; this loop is what keeps that guard from
    // rotting (its sibling resolveVendorRowGate carries the same pin).
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(rodTierRequiredForZone(key), key).toBe(DEFAULT_FISHING_ROD_TIER);
    }
  });

  it('is reachable: every requirement names a rod the world actually contains', () => {
    const rodTiers = Object.values(ITEMS)
      .filter((def) => isGatherToolUse(def.use) && def.use.professionId === 'fishing')
      .map((def) => (isGatherToolUse(def.use) ? def.use.tier : 0));
    for (const zoneId of [...ZONE_IDS, ...EXPANSION_ZONE_IDS]) {
      const need = rodTierRequiredForZone(zoneId);
      // Tier 1 is the bare-hands floor and needs no rod at all; anything above
      // it must be satisfiable by a shipped rod.
      expect(need === 1 || rodTiers.some((tier) => tier >= need), zoneId).toBe(true);
    }
  });

  it('the required BAND is the rod tier minus one, the shipped band gate', () => {
    for (const zoneId of [...ZONE_IDS, ...EXPANSION_ZONE_IDS]) {
      expect(requiredBandFor(zoneId), zoneId).toBe(rodTierRequiredForZone(zoneId) - 1);
    }
    expect(requiredBandFor('eastbrook_vale')).toBe(0);
    expect(requiredBandFor('mirefen_marsh')).toBe(1);
    expect(requiredBandFor('thornpeak_heights')).toBe(2);
  });

  it('shortfall and surplus are mirrors, clamped, and never both positive', () => {
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 3; band++) {
        const short = shortfallFor(zoneId, band);
        const over = surplusFor(zoneId, band);
        expect(Math.min(short, over), `${zoneId} band ${band}`).toBe(0);
        expect(short - over).toBe(requiredBandFor(zoneId) - band);
      }
    }
    // Both ends clamp, so a fourth band or a fourth zone cannot index off the
    // schedule.
    expect(shortfallFor('thornpeak_heights', -5)).toBe(2);
    expect(surplusFor('eastbrook_vale', 99)).toBe(2);
  });
});

describe('the catch tables follow the shortfall schedule', () => {
  // The one place the nine cells are checked against the rule that authored
  // them. Editing a weight past the schedule reds here rather than quietly
  // changing what a zone pays.
  const EMPTY_HOOK_AT_OR_ABOVE = [10, 8, 6]; // by bands ABOVE the requirement
  const EMPTY_HOOK_SHORT = [0, 35, 55]; // by bands SHORT of it
  const KOI_BY_BAND = [1, 3, 6];

  it('every empty-hook weight is exactly what the zone distance says it is', () => {
    let checked = 0;
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 3; band++) {
        const short = shortfallFor(zoneId, band);
        const expected =
          short > 0 ? EMPTY_HOOK_SHORT[short] : EMPTY_HOOK_AT_OR_ABOVE[surplusFor(zoneId, band)];
        expect(weightOf(band, zoneId, null), `${zoneId} band ${band} empty hook`).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
    // Every arm of the schedule is exercised by real content, so none of the
    // three cases above is dead: Eastbrook supplies all three surplus steps,
    // Mirefen and Thornpeak supply both shortfalls.
    const shortfalls = new Set<number>();
    const surpluses = new Set<number>();
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 3; band++) {
        const short = shortfallFor(zoneId, band);
        if (short > 0) shortfalls.add(short);
        else surpluses.add(surplusFor(zoneId, band));
      }
    }
    expect([...shortfalls].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...surpluses].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('the rare catch reads SKILL alone: same weight in every zone, rising with the band', () => {
    for (let band = 0; band < 3; band++) {
      for (const zoneId of ZONE_IDS) {
        expect(weightOf(band, zoneId, KOI), `${zoneId} band ${band}`).toBe(KOI_BY_BAND[band]);
      }
    }
    // It is the one row a shortfall never touches: Thornpeak at band 0 is two
    // bands short and still pays the same koi weight as the Vale at band 0.
    expect(weightOf(0, 'thornpeak_heights', KOI)).toBe(weightOf(0, 'eastbrook_vale', KOI));
    expect(KOI_BY_BAND[0]).toBeLessThan(KOI_BY_BAND[2]);
  });

  it('junk is pinned per cell, and swells with the shortfall', () => {
    // Pinned as LITERALS, like the empty hook, not as a ratio floor. A floor
    // is what this used to be, and the floors were loose enough that Thornpeak
    // band 1 could have dropped 15 to 9 and Mirefen band 0 25 to 19 with every
    // other assertion in this file still green: the junk dimension of the
    // schedule was the one authored rule not actually enforced.
    const JUNK_TOTALS: Record<string, number[]> = {
      eastbrook_vale: [12, 8, 4],
      mirefen_marsh: [25, 13, 9],
      thornpeak_heights: [28, 15, 6],
    };
    let checked = 0;
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 3; band++) {
        expect(junkTotal(band, zoneId), `${zoneId} band ${band} junk`).toBe(
          JUNK_TOTALS[zoneId][band],
        );
        checked += 1;
      }
    }
    expect(checked).toBe(9);
    // And the shape those literals encode: a short cell really does pay more
    // junk than the same zone at its own requirement, roughly double or worse.
    let shortCells = 0;
    for (const zoneId of ZONE_IDS) {
      const atRequirement = junkTotal(requiredBandFor(zoneId), zoneId);
      for (let band = 0; band < 3; band++) {
        const short = shortfallFor(zoneId, band);
        if (short === 0) continue;
        const ratio = junkTotal(band, zoneId) / atRequirement;
        expect(ratio, `${zoneId} band ${band} junk ratio`).toBeGreaterThanOrEqual(
          short === 2 ? 2 : 1.4,
        );
        shortCells += 1;
      }
    }
    // Non-vacuity: Eastbrook has no shortfall cell at all, so without this the
    // ratio loop could skip everything and still pass.
    expect(shortCells).toBe(3);
  });

  it('the food fish take the remainder, pinned per cell', () => {
    // The last clause of the authored schedule, and the only one an edit could
    // otherwise drift past: with the empty hook, the koi and the junk all
    // pinned exactly and the row summing to 100, exactly one degree of freedom
    // is left, which is how the remainder is split between a zone's two food
    // fish. Pinned as literals so a 50/34 to 49/35 nudge in the Vale reds here
    // rather than passing every other assertion in this file.
    const FOOD_ROWS: Record<string, number[][]> = {
      eastbrook_vale: [
        [46, 31],
        [49, 32],
        [50, 34],
      ],
      mirefen_marsh: [
        [22, 17],
        [42, 32],
        [43, 34],
      ],
      thornpeak_heights: [
        [9, 7],
        [27, 20],
        [44, 34],
      ],
    };
    let checked = 0;
    for (const zoneId of ZONE_IDS) {
      for (let band = 0; band < 3; band++) {
        const food = FISHING_TABLES_BY_BAND[band][zoneId]
          .filter(
            (r) => r.itemId !== null && r.itemId !== KOI && !JUNK_ROWS[zoneId].includes(r.itemId),
          )
          .map((r) => r.weight);
        expect(food, `${zoneId} band ${band} food rows`).toEqual(FOOD_ROWS[zoneId][band]);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
  });

  it('a short cell pays out worse overall than the same zone at its requirement', () => {
    // The property the three schedules exist to produce, asserted once on the
    // thing a player actually feels: how much of the table is a real fish.
    const foodShare = (band: number, zoneId: string) =>
      FISHING_TABLES_BY_BAND[band][zoneId]
        .filter((r) => r.itemId !== null && !JUNK_ROWS[zoneId].includes(r.itemId))
        .reduce((sum, r) => sum + r.weight, 0);
    let checked = 0;
    for (const zoneId of ZONE_IDS) {
      const atRequirement = foodShare(requiredBandFor(zoneId), zoneId);
      for (let band = 0; band < 3; band++) {
        if (shortfallFor(zoneId, band) === 0) continue;
        expect(foodShare(band, zoneId), `${zoneId} band ${band}`).toBeLessThan(atRequirement);
        checked += 1;
      }
    }
    expect(checked).toBe(3);
    // And the worst cell in the world really is bleak: a band-0 angler in
    // Thornpeak lands a fish under a fifth of the time.
    expect(foodShare(0, 'thornpeak_heights')).toBeLessThan(20);
  });
});

describe('the zone rod gate at the cast', () => {
  it('refuses a Thornpeak cast with a tier-2 rod, names the tier, and draws nothing', () => {
    const spot = fishableSpotOn(ZONE_THORNPEAK_LAKE());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1);
    placeAt(sim, spot);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('thornpeak_heights');
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    const evStart = sim.events.length;
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBeNull();
    expect(draws, 'a denial is rng-free').toBe(0);
    expect(deniedEvents(sim.events.slice(evStart))).toEqual([
      {
        type: 'gatherDenied',
        pid: meta.entityId,
        surface: 'fishing',
        professionId: 'fishing',
        requiredTier: 3,
      },
    ]);
    // Nothing else was said: the denial is the only event, so no cast bar
    // flickers and no error line stacks on top of the toast.
    expect(sim.events.slice(evStart)).toHaveLength(1);
  });

  it('allows the same Thornpeak cast once the tier-3 rod is in the bags', () => {
    const spot = fishableSpotOn(ZONE_THORNPEAK_LAKE());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('silverstream_fishing_rod', 1);
    placeAt(sim, spot);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    expect(deniedEvents(sim.events)).toEqual([]);
  });

  it('leaves the starter zone open to the simple pole, which is the whole no-strand story', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    faceLake(sim, LAKE);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('eastbrook_vale');
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    expect(deniedEvents(sim.events)).toEqual([]);
  });

  it('answers only a real attempt to fish: dry land in the peaks gets the water line', () => {
    // The gate sits AFTER the water check on purpose. Nothing else in this
    // file can tell: every other denial test stands on a probed fishable spot,
    // so moving the gate above the water check would leave them all green
    // while changing what a player on dry ground is told. Here the angler
    // faces a hillside with a rod the peaks refuse, and must hear about the
    // water, not about the rod they cannot use yet anyway.
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1);
    const lake = ZONE_THORNPEAK_LAKE();
    // Well clear of the water, facing away from it.
    teleportTo(sim, lake.x + lake.radius + 120, lake.z + lake.radius + 120);
    sim.player.facing = Math.atan2(1, 0);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('thornpeak_heights');
    const evStart = sim.events.length;
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBeNull();
    expect(deniedEvents(sim.events.slice(evStart)), 'the rod gate must not answer here').toEqual(
      [],
    );
    expect(sim.events.slice(evStart)).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You need to face fishable water.' }),
    );
  });

  it('the Codfather quest water now costs the tier-2 rod, and the pole is told which tier', () => {
    // A consequence worth stating out loud rather than discovering in play:
    // the Deepfen Shallows sit in Mirefen, so q_the_codfather is behind the
    // Ironreel. It is a 60-copper counter purchase, sold in the marsh's own
    // hub as well as the starter zone and carrying no proficiency gate,
    // against a quest that pays 450, so the quest is paced rather than
    // blocked. It is not the only thing behind the gate: see the shipped
    // rewards swept below.
    const spot = fishableSpotOn(DEEPFEN_SHALLOWS_LAKE);
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    placeAt(sim, spot);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('mirefen_marsh');
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBeNull();
    // Draw-free on THIS arm too, not just the Thornpeak one: both denials sit
    // on the same code path, and pinning only one leaves the other free to
    // grow a roll.
    expect(draws, 'a denial is rng-free').toBe(0);
    expect(deniedEvents(sim.events)).toEqual([
      {
        type: 'gatherDenied',
        pid: meta.entityId,
        surface: 'fishing',
        professionId: 'fishing',
        requiredTier: 2,
      },
    ]);
    expect(ITEMS.ironreel_fishing_rod.buyValue).toBe(60);
  });

  it('names every shipped reward the gate now sits in front of', () => {
    // The Codfather is the loudest consequence, not the only one, and a list
    // that stops at the loudest one reads as though the rest were checked.
    // Derived from the deed and recipe tables rather than recited, so a new
    // fishing deed or fish-fed recipe joins it automatically.
    const gatedZones = ZONE_IDS.filter((id) => rodTierRequiredForZone(id) > 1);
    expect(gatedZones.sort()).toEqual(['mirefen_marsh', 'thornpeak_heights']);

    // Per-zone fishing deeds in the gated zones.
    const fishMarks = Object.values(DEEDS)
      .filter((d) => {
        const trigger = d.trigger as { kind?: string; markId?: string };
        return trigger.kind === 'visit' && (trigger.markId ?? '').startsWith('fish:');
      })
      .map((d) => (d.trigger as { markId: string }).markId.slice('fish:'.length));
    const gatedDeedZones = fishMarks.filter((zoneId) => gatedZones.includes(zoneId));
    expect(gatedDeedZones.sort()).toEqual(['mirefen_marsh', 'thornpeak_heights']);

    // Recipes fed by a catch that only gated water yields.
    const gatedCatches = new Set<string>();
    for (const byZone of FISHING_TABLES_BY_BAND) {
      for (const zoneId of gatedZones) {
        for (const row of byZone[zoneId]) {
          if (row.itemId === null) continue;
          const elsewhere = FISHING_TABLES_BY_BAND.some((b) =>
            ZONE_IDS.filter((z) => !gatedZones.includes(z)).some((z) =>
              b[z].some((r) => r.itemId === row.itemId),
            ),
          );
          if (!elsewhere) gatedCatches.add(row.itemId);
        }
      }
    }
    const gatedRecipes = ALL_RECIPES.filter((r) =>
      r.reagents.some((reagent) => gatedCatches.has(reagent.itemId)),
    ).map((r) => r.id);
    // Non-vacuity, and the actual list: a handful of cooking recipes plus the
    // tier-5 rod, which is gated ON PURPOSE (that is its self-gate).
    expect(gatedRecipes.length).toBeGreaterThanOrEqual(4);
    expect(gatedRecipes).toContain('recipe_tidewrought_fishing_rod');
  });

  it('the gate reads the SAME zone the catch table does, driven end to end', () => {
    // The two must never disagree, or a player could be refused for one
    // zone's requirement and then fished against another zone's rows. Asserted
    // by DRIVING it: take the tier the gate names at one spot, satisfy exactly
    // that tier, and prove the catch that lands comes from that zone's rows. A
    // gate reading a different zone (or a different axis entirely) passes a
    // map-coverage check but fails this.
    const spot = fishableSpotOn(ZONE_THORNPEAK_LAKE());
    const denied = makeSim();
    const deniedMeta = denied.meta(denied.playerId) as PlayerMeta;
    denied.addItem('simple_fishing_pole', 1);
    placeAt(denied, spot);
    startFishing(denied.ctx, denied.player, deniedMeta);
    const events = deniedEvents(denied.events);
    expect(events).toHaveLength(1);
    const namedTier = (events[0] as { requiredTier: number }).requiredTier;

    const allowed = makeSim();
    const allowedMeta = allowed.meta(allowed.playerId) as PlayerMeta;
    // Exactly the tier the gate asked for, nothing above it.
    const rodOfNamedTier = Object.values(ITEMS).find(
      (def) =>
        isGatherToolUse(def.use) &&
        def.use.professionId === 'fishing' &&
        def.use.tier === namedTier,
    );
    expect(rodOfNamedTier, `no rod of the tier the gate named (${namedTier})`).toBeDefined();
    allowed.addItem((rodOfNamedTier as { id: string }).id, 1);
    placeAt(allowed, spot);
    const zoneId = zoneAt(allowed.player.pos.x, allowed.player.pos.z).id;
    startFishing(allowed.ctx, allowed.player, allowedMeta);
    expect(allowed.player.castingAbility).toBe(FISHING_CAST_ID);
    // Resolve a catch and prove it belongs to the SAME zone's rows.
    const zoneIds = new Set(
      FISHING_TABLES_BY_BAND.flatMap((byZone) => byZone[zoneId].map((r) => r.itemId)),
    );
    const otherIds = new Set(
      FISHING_TABLES_BY_BAND.flatMap((byZone) =>
        Object.entries(byZone)
          .filter(([id]) => id !== zoneId)
          .flatMap(([, rows]) => rows.map((r) => r.itemId)),
      ),
    );
    const before = new Map(
      [...zoneIds, ...otherIds]
        .filter((id): id is string => id !== null)
        .map((id) => [id, allowed.countItem(id)]),
    );
    allowed.player.fishBiteAtTick = 0;
    allowed.player.fishReelDeadlineTick = 0;
    allowed.player.castingAbility = null;
    completeFishing(allowed.ctx, allowed.player, allowedMeta);
    const gained = [...before.keys()].filter((id) => allowed.countItem(id) > (before.get(id) ?? 0));
    for (const id of gained) {
      expect(zoneIds.has(id), `${id} is not on ${zoneId}'s table`).toBe(true);
    }
    // The zone-exclusive rows really are exclusive, so the check above is not
    // satisfied by every zone sharing one id set.
    expect([...zoneIds].some((id) => id !== null && !otherIds.has(id))).toBe(true);
  });
});

describe('a rod rarity rung widens the reel window', () => {
  it('widens on rarity with the tier HELD FIXED, so the term is not tier in disguise', () => {
    // The decisive arm. Rod rarity is collinear with rod tier in shipped
    // content, so every real rod would also pass a tier-only implementation;
    // holding the tier fixed is the only thing that can tell the two apart.
    const tier = 3;
    const common = fishReelWindowSecFor(tier, 'common');
    // NON-VACUITY FIRST. The per-rung assertion below computes its expected
    // value FROM the constant, so at a constant of 0 both sides are 0 and every
    // row passes while the bonus buys nothing. A mutation pass zeroing the
    // constant survived this test until these two lines existed.
    expect(FISH_REEL_WINDOW_RARITY_BONUS_SEC).toBeGreaterThan(0);
    expect(fishReelWindowSecFor(tier, 'epic')).toBeGreaterThan(common);
    for (const [rarity, rungs] of [
      ['uncommon', 1],
      ['rare', 2],
      ['epic', 3],
      ['legendary', 4],
    ] as const) {
      expect(fishReelWindowSecFor(tier, rarity) - common, `${rarity} at tier ${tier}`).toBeCloseTo(
        FISH_REEL_WINDOW_RARITY_BONUS_SEC * rungs,
        10,
      );
      // And each rung is strictly wider than the one below it, stated against
      // the window rather than against the constant, so the ladder cannot
      // collapse to a single step while the arithmetic above still agrees.
      if (rungs > 1) {
        expect(fishReelWindowSecFor(tier, rarity)).toBeGreaterThan(
          common + FISH_REEL_WINDOW_RARITY_BONUS_SEC,
        );
      }
    }
  });

  it('leaves the tier ladder intact, and defaults an omitted rarity to common', () => {
    // Rarity ADDS to the tier ladder rather than replacing it: the pre-rarity
    // behaviour is still exactly what a common rod gets.
    for (let tier = 1; tier <= 5; tier++) {
      expect(fishReelWindowSecFor(tier, 'common')).toBeCloseTo(
        FISH_REEL_WINDOW_SEC + FISH_REEL_WINDOW_ROD_BONUS_SEC * (tier - 1),
        10,
      );
      // The default is the common rung, so a tier-only caller is unchanged.
      expect(fishReelWindowSecFor(tier)).toBe(fishReelWindowSecFor(tier, 'common'));
    }
  });

  it('never NARROWS the window for an off-ladder quality', () => {
    // 'poor' is the one quality MaterialRarity excludes and undefined is a def
    // with no quality at all. Both used to index to -1 and would have
    // subtracted a rung from the base window.
    for (const quality of ['poor', undefined] as const) {
      expect(fishReelWindowSecFor(3, quality)).toBe(fishReelWindowSecFor(3, 'common'));
    }
  });

  it('the shipped rods really do span the rarity ladder, so the bonus is reachable', () => {
    // Vacuity guard: if every rod were common the term above would be dead
    // content, and the budget below would be measuring a case no player holds.
    const rodQualities = Object.values(ITEMS)
      .filter((def) => isGatherToolUse(def.use) && def.use.professionId === 'fishing')
      .map((def) => def.quality);
    expect(new Set(rodQualities).size).toBeGreaterThan(1);
    expect(rodQualities).toContain('epic');
  });
});

describe('the session cap always outlasts a legal reel window', () => {
  // The fairness defect this guards: the cap arm and the miss arm emit the
  // IDENTICAL pair (fishingGotAway plus a failed castStop), so if the cap ever
  // expired while a reel window was still open, the fish would get away with
  // the window still on screen and nothing downstream could tell the two
  // apart. Budgeted in TICKS, because both legs ceil and the cap decays on DT.
  // Every shipped rod as BOTH axes the window reads. Tier alone is no longer
  // enough: rarity widens the window too, so a budget walking bare tiers would
  // under-count the real worst case by the epic rung and pass on a window the
  // world can actually beat.
  const shippedRods = (): { tier: number; quality: ItemDef['quality'] }[] => {
    const rods = Object.values(ITEMS)
      .filter((def) => isGatherToolUse(def.use) && def.use.professionId === 'fishing')
      .map((def) => ({
        tier: isGatherToolUse(def.use) ? def.use.tier : 0,
        quality: def.quality,
      }));
    // Tier 1 is the pole and the bare-hands floor, which no rod def carries;
    // the floor is common, matching bestOwnedGatherToolFor's own default.
    return [{ tier: 1, quality: 'common' as const }, ...rods];
  };

  it('covers the worst legal session over every shipped rod tier, with a tick to spare', () => {
    const capTicks = Math.round(FISHING_SESSION_CAP_SEC / DT);
    // The cap side pinned to a literal: without it BOTH sides of the budget are
    // derived, and a trim to 14.5 s still satisfies every inequality below.
    expect(capTicks, 'the session cap is 300 ticks').toBe(300);
    // ONE loop, over the rod held at the BITE. The bite delay is drawn against
    // the rod held at the CAST and the window is measured against the rod held
    // at the BITE, and since a better rod only ever SHORTENS the delay, the
    // worst bite is always the bare pole's. Looping over the cast tier too
    // would recompute one number per row and inflate the count without adding
    // a case, which is what this used to do.
    const worstBiteTicks = Math.ceil(FISH_BITE_DELAY_MAX_SEC / DT);
    let checked = 0;
    let worstNeedTicks = 0;
    for (const rod of shippedRods()) {
      // The sim's own function, never a second copy of its arithmetic. This
      // line used to re-derive the sum inline, which meant the budget could
      // stay green while the live window grew past it: adding the rarity term
      // to fishReelWindowSecFor alone would have moved the world and left this
      // measuring the old formula.
      const windowSec = fishReelWindowSecFor(rod.tier, rod.quality);
      const needTicks = worstBiteTicks + Math.ceil(windowSec / DT) + 1;
      worstNeedTicks = Math.max(worstNeedTicks, needTicks);
      expect(
        capTicks,
        `a pole cast into a tier-${rod.tier} ${rod.quality} bite needs ${needTicks} ticks`,
      ).toBeGreaterThan(needTicks);
      checked += 1;
    }
    expect(checked).toBe(shippedRods().length);
    expect(checked).toBeGreaterThanOrEqual(5);
    // The rarity term is really IN the worst case, not merely available to it:
    // the widest shipped rod must beat the widest bare-tier window, or this
    // whole budget would be re-deriving the pre-rarity number and calling it
    // covered.
    expect(worstNeedTicks).toBeGreaterThan(
      worstBiteTicks + Math.ceil(fishReelWindowSecFor(5) / DT) + 1,
    );
    // The budget is LIVE, not a formality: the worst legal session really does
    // consume most of the cap, so a cap trimmed for looks would red here.
    expect(worstNeedTicks).toBeGreaterThan(capTicks * 0.8);
    // And the pole really is the worst bite, which is what lets the loop above
    // hold the cast tier fixed.
    const effMaxFor = (tier: number) =>
      Math.max(
        FISH_BITE_DELAY_MIN_SEC,
        FISH_BITE_DELAY_MAX_SEC - FISH_BITE_DELAY_ROD_REDUCTION_SEC * (tier - 1),
      );
    for (const rod of shippedRods()) {
      expect(effMaxFor(rod.tier), `tier ${rod.tier} bite ceiling`).toBeLessThanOrEqual(
        effMaxFor(1),
      );
    }
  });

  it('a real worst-case session still reels inside the cap, through the live loop', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    faceLake(sim, LAKE);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    // Force the worst legal bite (the top of the tier-1 range) and hand the
    // angler the best shipped rod before it lands, which is the widest window
    // the world can produce.
    const startTick = sim.tickCount;
    p.fishBiteAtTick = startTick + Math.ceil(FISH_BITE_DELAY_MAX_SEC / DT);
    const bestRod = Object.values(ITEMS)
      .filter((def) => isGatherToolUse(def.use) && def.use.professionId === 'fishing')
      .sort(
        (a, b) =>
          (isGatherToolUse(b.use) ? b.use.tier : 0) - (isGatherToolUse(a.use) ? a.use.tier : 0),
      )[0];
    sim.addItem(bestRod.id, 1);
    // Run the real tick loop to the bite, then to the last tick of the window.
    for (let tick = startTick + 1; tick <= p.fishBiteAtTick; tick++) {
      sim.tickCount = tick;
      updateCasting(sim.ctx, p, meta);
      p.castRemaining = FISHING_SESSION_CAP_SEC - (tick - startTick) * DT;
    }
    // The window is the WIDEST the world can produce, pinned as its own
    // number. Without this, a regression that scanned the cast-time rod
    // instead of the bite-time rod would arm 50 ticks instead of 125, the loop
    // below would simply run fewer iterations, and every assertion would still
    // pass on a much weaker budget. (125, not 110: 110 is the tier-5 window at
    // COMMON, and the best shipped rod is epic.)
    const widestWindowTicks = Math.ceil(
      fishReelWindowSecFor(isGatherToolUse(bestRod.use) ? bestRod.use.tier : 1, bestRod.quality) /
        DT,
    );
    expect(p.fishReelDeadlineTick - sim.tickCount, 'the bite armed the widest window').toBe(
      widestWindowTicks,
    );
    for (let tick = sim.tickCount + 1; tick <= p.fishReelDeadlineTick; tick++) {
      sim.tickCount = tick;
      p.castRemaining = FISHING_SESSION_CAP_SEC - (tick - startTick) * DT;
      updateCasting(sim.ctx, p, meta);
      expect(p.castingAbility, `the cap ate the window at tick ${tick - startTick}`).toBe(
        FISHING_CAST_ID,
      );
    }
    // The window survived to its last legal tick, so the reel still LANDS: a
    // null castingAbility alone cannot tell a landed catch from a fish that
    // got away, so the catch event is what carries the claim.
    const evStart = sim.events.length;
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBeNull();
    const after = sim.events.slice(evStart);
    expect(
      after.some((e) => (e as { type: string }).type === 'fishingGotAway'),
      'the cap must not have eaten the reel',
    ).toBe(false);
    expect(after).toContainEqual(expect.objectContaining({ type: 'castStop', success: true }));
  });
});

// Thornpeak's fishable water. Resolved from the zone's own lakes rather than
// hardcoded, so a moved lake fails here instead of silently fishing the wrong
// zone.
function ZONE_THORNPEAK_LAKE(): { x: number; z: number; radius: number } {
  const zone = ZONES.find((z) => z.id === 'thornpeak_heights');
  const lake = zone?.lakes?.[0];
  expect(lake, 'thornpeak_heights must ship fishable water').toBeDefined();
  return lake as { x: number; z: number; radius: number };
}

describe('the rod gate reads the WATER zone at the probe point', () => {
  // A cross-boundary cast (caster on one side of a zone line, fishable water
  // up to 24 yd ahead on the other) must answer to the WATER'S zone: the rod
  // gate, the pinned session zone, and the catch table all resolve the probe
  // point's zone, so standing on the cheap side cannot dodge the far side's
  // tier. Builtin lakes sit well clear of every line, so the fixture authors
  // a lake straddling z=180 (the eastbrook/mirefen border) via the active
  // content registry; terrain carves the basin for declared lakes, so the
  // water is genuinely fishable.
  afterEach(() => setActiveWorldContent(null));

  function borderLakeContent() {
    const [vale, marsh, peaks] = ZONES;
    return {
      ...BUILTIN_WORLD,
      zones: [vale, { ...marsh, lakes: [...marsh.lakes, { x: 0, z: 190, radius: 12 }] }, peaks],
    };
  }

  function placeAtBorderShore(sim: Sim) {
    const p = sim.player;
    p.pos.x = 0;
    p.pos.z = 176; // eastbrook side of the z=180 line
    p.pos.y = terrainHeight(0, 176, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = 0; // due north: the probe ring walks into mirefen water
  }

  it('denies an eastbrook-side cast into mirefen water at mirefen tier', () => {
    setActiveWorldContent(borderLakeContent());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    placeAtBorderShore(sim);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('eastbrook_vale'); // the caster stands cheap-side
    sim.events = [];
    startFishing(sim.ctx, sim.player, meta);
    const denies = deniedEvents(sim.events);
    expect(denies).toHaveLength(1);
    expect((denies[0] as { requiredTier: number }).requiredTier).toBe(
      FISHING_ZONE_ROD_TIERS.mirefen_marsh,
    );
    expect(sim.player.castingAbility).toBeNull();
  });

  it('a missed reel and the session cap both book the got-away under the pinned zone and band', () => {
    // The two casting_lifecycle emissions are the only consumers of the
    // pinned zone and the effective band on the got-away path; every other
    // fixture sits on the vale shore at band 0, where a position read and a
    // literal 0 are indistinguishable from the real reads. This one is not:
    // the pin is mirefen while the caster stands in eastbrook, and the band
    // is 1 (tier-2 rod, proficiency past the band-1 threshold).
    setActiveWorldContent(borderLakeContent());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1);
    meta.gatheringProficiency.fishing = 200; // prof band 2; rod band 1 caps it
    placeAtBorderShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.fishCastZoneId).toBe('mirefen_marsh');
    // The miss arm: one past the reel deadline.
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    sim.tickCount = p.fishReelDeadlineTick + 1;
    sim.events = [];
    updateCasting(sim.ctx, p, meta);
    expect(sim.events).toContainEqual({
      type: 'fishingGotAway',
      pid: sim.playerId,
      zoneId: 'mirefen_marsh',
      band: 1,
    });
    // The defensive session-cap arm, same pins.
    startFishing(sim.ctx, p, meta);
    p.castRemaining = DT;
    p.fishBiteAtTick = sim.tickCount + 999;
    sim.events = [];
    updateCasting(sim.ctx, p, meta);
    expect(sim.events).toContainEqual({
      type: 'fishingGotAway',
      pid: sim.playerId,
      zoneId: 'mirefen_marsh',
      band: 1,
    });
  });

  it('with the water zone tier satisfied, the session pins and fishes the WATER zone', () => {
    setActiveWorldContent(borderLakeContent());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1); // tier 2: mirefen's requirement
    placeAtBorderShore(sim);
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    expect(sim.player.fishCastZoneId).toBe('mirefen_marsh');
    // Every catch resolves mirefen rows, not the caster-side eastbrook rows.
    const mirefenIds = new Set(
      FISHING_TABLES_BY_BAND.flatMap((byZone) => byZone.mirefen_marsh.map((r) => r.itemId)),
    );
    const allIds = new Set(
      FISHING_TABLES_BY_BAND.flatMap((byZone) =>
        Object.values(byZone).flatMap((rows) => rows.map((r) => r.itemId)),
      ),
    );
    const before = new Map(
      [...allIds].filter((id): id is string => id !== null).map((id) => [id, sim.countItem(id)]),
    );
    sim.player.fishBiteAtTick = 0;
    sim.player.fishReelDeadlineTick = 0;
    sim.player.castingAbility = null;
    for (let i = 0; i < 10; i++) completeFishing(sim.ctx, sim.player, meta);
    const gained = [...before.keys()].filter((id) => sim.countItem(id) > (before.get(id) ?? 0));
    expect(gained.length).toBeGreaterThan(0);
    for (const id of gained) {
      expect(mirefenIds.has(id), `${id} is not on mirefen_marsh's table`).toBe(true);
    }
  });

  it('a successful REEL books the outcome under the pinned zone, then clears the pin', () => {
    // The one end path the direct completeFishing drive above cannot cover:
    // the reel re-press inside startFishing, whose contract is clear-AFTER-
    // completion (the completion reads the pinned zone for the table, the
    // deed credit, and the outcome event). Every other reel fixture sits
    // where the pinned zone and the position zone coincide, so hoisting the
    // clear above completeFishing would pass the rest of the suite while
    // silently rebooking a cross-boundary catch onto the caster's zone.
    setActiveWorldContent(borderLakeContent());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1);
    meta.gatheringProficiency.fishing = 200; // prof band 2; rod band 1 caps it
    placeAtBorderShore(sim);
    const p = sim.player;
    startFishing(sim.ctx, p, meta);
    expect(p.fishCastZoneId).toBe('mirefen_marsh');
    // Drive the bite, then re-press inside the live reel window.
    sim.tickCount = p.fishBiteAtTick;
    updateCasting(sim.ctx, p, meta);
    expect(p.fishReelDeadlineTick).toBeGreaterThan(0);
    sim.events = [];
    startFishing(sim.ctx, p, meta);
    // The reel landed: castStop success, and the one outcome event (a catch
    // or the honest empty hook, whichever the draw yields) carries the
    // PINNED mirefen zone at band 1, never the caster's eastbrook.
    expect(sim.events).toContainEqual({ type: 'castStop', entityId: p.id, success: true });
    const outcomes = sim.events.filter(
      (e): e is Extract<SimEvent, { type: 'fishingResult' | 'fishingEmptyHook' }> =>
        e.type === 'fishingResult' || e.type === 'fishingEmptyHook',
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].zoneId).toBe('mirefen_marsh');
    expect(outcomes[0].band).toBe(1);
    // And the pin is gone only AFTER the completion consumed it.
    expect(p.fishCastZoneId).toBe('');
    expect(p.castingAbility).toBeNull();
  });

  it('the cross-boundary GAIN answers to the water zone: 0.1 at proficiency 120', () => {
    // The discriminating drive the live map cannot stage: no shipped fishable
    // water lies within the 24 yd cast reach of a tier-DIFFERING zone line
    // (the nearest rim is 36 yd out, at the thornpeak/veiled_hollow border),
    // so the gain amount is discriminated here on the authored border lake.
    // At fishing 120 the mirefen water ahead teaches 0.1 (tier 2 grays at
    // 150) while the eastbrook ground underfoot teaches 0 (tier 1 grayed at
    // 100), so a gain call reading zoneAt(p.pos) instead of the pinned cast
    // zone zeroes this grant. 100..149 is the whole discriminating window:
    // below 100 both zones grant alike, at 150 both gray out; 120 matches
    // the live Mirefen drive in tests/professions_fishing.test.ts.
    setActiveWorldContent(borderLakeContent());
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('ironreel_fishing_rod', 1);
    meta.gatheringProficiency.fishing = 120;
    placeAtBorderShore(sim);
    expect(zoneAt(sim.player.pos.x, sim.player.pos.z).id).toBe('eastbrook_vale');
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.fishCastZoneId).toBe('mirefen_marsh');
    sim.player.fishBiteAtTick = 0;
    sim.player.fishReelDeadlineTick = 0;
    sim.player.castingAbility = null;
    let taught = 0;
    for (let i = 0; i < 60 && taught === 0; i++) {
      const before = meta.pendingGatherGrants.length;
      completeFishing(sim.ctx, sim.player, meta);
      const gained = meta.pendingGatherGrants.slice(before);
      if (gained.length > 0) {
        taught++;
        expect(gained).toEqual([{ professionId: 'fishing', amount: 0.1 }]);
      }
    }
    expect(taught, 'the drive must land a teaching catch').toBe(1);
  });
});

describe('the LIVE map cross-boundary cast site (no content override)', () => {
  it('at (172,936) a veiled_hollow caster fishes evergarden water across x=180', () => {
    // The one cross-boundary stand point the shipped map offers: the probe
    // ring walks due east across the x=180 column line into the east strait
    // (a programmatic border water). Run at the SHIPPED seed (the farshore
    // lesson: pin the world players get), and verified stable on 467, 4242,
    // 1, 99, and 12345 besides: the dry ring at d4..d12 and the water at d16
    // hold on all six. Both zones are tier 1 today, so only the pinned
    // zoneId discriminates (catch table, deed, and gain all collapse to the
    // same answer); the moment either side re-tiers in the zone-4 water pass
    // this same stand point becomes a full gain discriminator for free, so
    // keep the arm.
    const sim = makeSim(WORLD_SEED);
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    teleportTo(sim, 172, 936);
    sim.player.facing = Math.PI / 2; // due east, across the x=180 line
    expect(zoneAt(172, 936).id).toBe('veiled_hollow');
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBe(FISHING_CAST_ID);
    // The pin is the WATER's zone, not the caster's: the shared local that
    // feeds the catch table, the telemetry events, the deed mark, and the
    // gain all resolve from the probe point across the line.
    expect(sim.player.fishCastZoneId).toBe('evergarden');
  });
});

// Memoized per-lake casting spots for the R55 arms below: fishableSpotOn is a
// real-cast ring sweep with its own throwaway sim, so probe each declared
// lake exactly once however many arms read the result.
const LAKE_SPOT_CACHE = new Map<string, { x: number; z: number; facing: number } | null>();
function spotForLake(zoneId: string, lake: { x: number; z: number; radius: number }) {
  // Zone-scoped key: two zones declaring a lake at identical coordinates
  // must not share a cached probe (the review round's cache-collision nit).
  const k = `${zoneId}:${lake.x},${lake.z}`;
  if (!LAKE_SPOT_CACHE.has(k)) {
    try {
      LAKE_SPOT_CACHE.set(k, fishableSpotOn(lake));
    } catch {
      LAKE_SPOT_CACHE.set(k, null);
    }
  }
  return LAKE_SPOT_CACHE.get(k) ?? null;
}

// The two DECORATIVE lakes (the phase 20 fishing-geometry pass, Q14 in
// docs/design/professions-tuning-packet-review.md): declared discs that hold
// no swim-depth water, so no cast can accept on them. Both dried under a
// terrain lift that post-dates their authoring: the farshore Hilltop Spring
// under the Crown dome's +14 (the pre-R55 state, kept as scenery once Gull
// Mere landed) and the Mirrormere under the western-highlands lift. Ruled
// intentional; a lake that goes dry JOINS this list by a human edit, and one
// that gains water must LEAVE it (the census arm reds).
const DECORATIVE_LAKES = ['farshore_isle:388,26', 'veiled_hollow:-120,1105'];

describe('every rod-tier row stands on real water and a real schedule row', () => {
  it('the shipped rod-tier ladder is fully distinguished by the gain schedule', () => {
    // The wield ladder's completeness arm has this shape for land tools; the
    // fishing side had none, so a tier-4 rod row could ship while the
    // teaching derivation silently clamps its water to the tier-3 ceiling.
    // The derivation distinguishes exactly the schedule's row indexes
    // (fishingTeachingCeilingFor clamps zoneTier into [1, rows - 1]), so
    // every shipped tier must sit inside that range: a single zone re-tiered
    // past it clamps silently, which is precisely what this arm reds on.
    // (A strictly-increasing walk over the SHIPPED tier set cannot catch
    // that: a lone tier 4 still beats tier 2 after clamping.)
    const maxDistinguished = FISHING_GAIN_SCHEDULE.length - 1;
    for (const [zoneId, tier] of Object.entries(FISHING_ZONE_ROD_TIERS)) {
      expect(
        tier,
        `${zoneId} ships rod tier ${tier}, past the ${maxDistinguished} the gain schedule derives`,
      ).toBeLessThanOrEqual(maxDistinguished);
    }
    const tiers = [...new Set(Object.values(FISHING_ZONE_ROD_TIERS))].sort((a, b) => a - b);
    for (let i = 1; i < tiers.length; i++) {
      expect(
        fishingTeachingCeilingFor(tiers[i]),
        `tier ${tiers[i]} must teach past tier ${tiers[i - 1]}`,
      ).toBeGreaterThan(fishingTeachingCeilingFor(tiers[i - 1]));
    }
    const top = tiers[tiers.length - 1];
    expect(fishingTeachingCeilingFor(top)).toBe(200);
  });

  it('every declared lake accepts a REAL cast, or is a pinned decorative exemption', () => {
    // The R55 defect class: a zone carrying a live rod-tier row over water no
    // startFishing accepts (farshore shipped that way; the Crown dome dried
    // the Hilltop Spring). Upgraded from some-lake-per-zone to per-lake at
    // the phase 20 pass (Q14): the some() form let a dead lake hide behind a
    // zone's one live one, which is exactly how the two decorative discs
    // shipped unnoticed. Zones with no declared lakes would be served by the
    // programmatic border waters and skipped; every shipped zone declares
    // lakes today, and the count pin keeps this sweep from emptying quietly.
    const dead: string[] = [];
    let checked = 0;
    let lakesChecked = 0;
    for (const zone of ZONES) {
      if (!FISHING_ZONE_ROD_TIERS[zone.id] || zone.lakes.length === 0) continue;
      checked += 1;
      lakesChecked += zone.lakes.length;
      for (const lake of zone.lakes) {
        if (spotForLake(zone.id, lake) === null) dead.push(`${zone.id}:${lake.x},${lake.z}`);
      }
    }
    expect(checked).toBe(14);
    // Per-LAKE non-vacuity (the QA round): the zone count alone let a zone
    // quietly shed lakes (willowfen alone declares 19), shrinking the sweep
    // with a green suite. A lake added or removed anywhere re-mints this.
    expect(lakesChecked).toBe(61);
    expect(dead.sort()).toEqual(DECORATIVE_LAKES);
  });

  const swimDepthCellsIn = (lake: { x: number; z: number; radius: number }): number => {
    let wet = 0;
    for (let dx = -lake.radius; dx <= lake.radius; dx += 0.5) {
      for (let dz = -lake.radius; dz <= lake.radius; dz += 0.5) {
        if (dx * dx + dz * dz > lake.radius * lake.radius) continue;
        const x = lake.x + dx;
        const z = lake.z + dz;
        if (terrainHeight(x, z, WORLD_SEED) < waterLevelAt(x, z) - PLAYER_SWIM_DEPTH) wet++;
      }
    }
    return wet;
  };

  it('the decorative-lake exemptions genuinely hold no swim-depth water', () => {
    // The exemption's own non-rot arm: a decorative disc that gains real
    // water reds HERE and must leave the list, so the pin can never mask a
    // lake that became fishable and then broke.
    for (const entry of DECORATIVE_LAKES) {
      const [zoneId, coords] = entry.split(':');
      const [lx, lz] = coords.split(',').map(Number);
      const zone = ZONES.find((z) => z.id === zoneId);
      const lake = zone?.lakes.find((l) => l.x === lx && l.z === lz);
      expect(lake, `${entry} names a declared lake`).toBeDefined();
      if (!lake) continue;
      const wet = swimDepthCellsIn(lake);
      expect(wet, `${entry} holds swim-depth water and must leave the decorative list`).toBe(0);
    }
    // Positive control (the QA round): the same census over a live lake must
    // find water, or a broken predicate (a sign flip, waterLevelAt going
    // -Infinity inside declared bodies) would measure zero everywhere and
    // green this arm exactly when it is most needed. Mirror Tarn is
    // galecrest's one lake and fully swim-depth (1257 of 1257 in-disc cells
    // when this landed).
    const tarn = ZONES.find((z) => z.id === 'galecrest')?.lakes.find(
      (l) => l.x === 300 && l.z === 560,
    );
    expect(tarn, 'the Mirror Tarn positive control names a declared lake').toBeDefined();
    if (tarn) expect(swimDepthCellsIn(tarn)).toBeGreaterThan(0);
  });

  it('every zone hub is a bounded walk from a fishable shore', () => {
    // Q14's travel-distance claim, measured rather than asserted: the
    // straight-line hub distance to an accepted casting spot, per rod-row
    // zone. Metric honesty (the QA round): fishableSpotOn returns the FIRST
    // accept of its ring scan, not the spot nearest the hub, so this measures
    // an UPPER bound on the true nearest-shore walk. That is the right
    // direction for the ceiling (if the probe spot is within it, the nearest
    // shore certainly is), and the number is stable because the probe's
    // parameters (0.7r start, radius + 10 outer, 72 spokes, 1yd step) are
    // this file's own literals: for galecrest's one 10yd lake the geometry
    // bounds any such probe inside roughly 213 to 253yd of the hub, so
    // editing those literals is a deliberate re-measure of this arm, never a
    // silent drift. Wickharbor is the shipped worst by a wide margin (the
    // Mirror Tarn shore, probe-measured 230yd; the next zone sits at 137yd),
    // the ruling accepted it with the south Lawnmere bank as the second site
    // (the border-water arm below), and the bracket pins that acceptance:
    // a ceiling under 240 that the shipped worst genuinely bites.
    let worst = 0;
    let worstZone = '';
    let measured = 0;
    for (const zone of ZONES) {
      if (!FISHING_ZONE_ROD_TIERS[zone.id] || zone.lakes.length === 0) continue;
      let best = Number.POSITIVE_INFINITY;
      for (const lake of zone.lakes) {
        const spot = spotForLake(zone.id, lake);
        if (!spot) continue;
        best = Math.min(best, Math.hypot(spot.x - zone.hub.x, spot.z - zone.hub.z));
      }
      expect(best, `${zone.id} has no fishable lake at all`).toBeLessThan(Number.POSITIVE_INFINITY);
      measured += 1;
      if (best > worst) {
        worst = best;
        worstZone = zone.id;
      }
    }
    expect(measured).toBe(14);
    expect(worstZone).toBe('galecrest');
    expect(worst).toBeLessThanOrEqual(240);
    // The ceiling bites, per the prose above. Subsumption note (the QA
    // round): while the worstZone pin and the probe literals stand, the
    // geometry bounds any galecrest probe above 213yd, so this lower bracket
    // can only fail after the worstZone pin does; it stays as the record of
    // the acceptance, not as an independent tripwire.
    expect(worst).toBeGreaterThan(200);
  });

  // Walkable-dry for the hub-shore floods below: above the WORLD sea plane
  // (the ocean and every below-plane basin is a swim, whatever waterLevelAt
  // says: outside a declared body it answers -Infinity, which would call the
  // open sea dry) AND not swim-depth inside a declared body. The review
  // round proved the naive declared-water-only form vacuous: 64 percent of
  // the farshore rect sits below the sea plane yet counted as dry foot.
  const dryFoot = (x: number, z: number): boolean => {
    const ground = terrainHeight(x, z, WORLD_SEED);
    if (ground <= waterLevel()) return false;
    const wl = waterLevelAt(x, z);
    return !Number.isFinite(wl) || ground > wl - PLAYER_SWIM_DEPTH;
  };

  const floodFromHub = (
    zone: {
      hub: { x: number; z: number };
      xMin?: number;
      xMax?: number;
      zMin: number;
      zMax: number;
    },
    step: number,
  ): Set<string> => {
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const x0 = zone.xMin ?? 0;
    const x1 = zone.xMax ?? 0;
    const seen = new Set<string>([key(zone.hub.x, zone.hub.z)]);
    const queue: [number, number][] = [[zone.hub.x, zone.hub.z]];
    for (let head = 0; head < queue.length; head++) {
      const [cx, cz] = queue[head];
      for (const [dx, dz] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < x0 || x > x1 || z < zone.zMin || z > zone.zMax) continue;
        const k = key(x, z);
        if (seen.has(k) || !dryFoot(x, z)) continue;
        seen.add(k);
        queue.push([x, z]);
      }
    }
    return seen;
  };

  it('the bottom-map zones reach their nearest fishable shore on dry foot from the hub', () => {
    // The phase 20 bundling premise (nodes placed by fishing shores are only
    // worth the trip if the shore is walkable from town): a coarse dry-cell
    // flood from each hub (the tests/galecrest.test.ts landmass idiom, with
    // the sea-plane-aware dryFoot above) must reach the nearest accepted
    // casting spot.
    const step = 4;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    for (const zoneId of ['willowfen', 'galecrest', 'farshore_isle']) {
      const zone = ZONES.find((z) => z.id === zoneId);
      expect(zone).toBeDefined();
      if (!zone) continue;
      let spot: { x: number; z: number } | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const lake of zone.lakes) {
        const s = spotForLake(zone.id, lake);
        if (!s) continue;
        const d = Math.hypot(s.x - zone.hub.x, s.z - zone.hub.z);
        if (d < best) {
          best = d;
          spot = s;
        }
      }
      expect(spot, `${zoneId} has no accepted casting spot`).not.toBeNull();
      if (!spot) continue;
      expect(zone.xMin, `${zoneId} rect`).toBeDefined();
      expect(zone.xMax, `${zoneId} rect`).toBeDefined();
      const seen = floodFromHub(zone, step);
      // The caster stands at the water's edge, so the spot's own cell can
      // round into the wet side of the shore at this grid: reaching any
      // cell one step around it is reaching the shore.
      let shoreReached = false;
      for (let dx = -step; dx <= step && !shoreReached; dx += step) {
        for (let dz = -step; dz <= step && !shoreReached; dz += step) {
          if (seen.has(key(spot.x + dx, spot.z + dz))) shoreReached = true;
        }
      }
      expect(
        shoreReached,
        `${zoneId} hub flood never reaches the casting spot (${spot.x.toFixed(1)},${spot.z.toFixed(1)})`,
      ).toBe(true);
    }
  });

  it('the hub-shore flood can fail: open sea is not dry foot and stays unreached', () => {
    // The counter-arm the review round demanded after the first predicate
    // proved vacuous. Two halves: the ocean floor south of the farshore
    // strand is genuinely below the world sea plane (the property), and the
    // farshore hub flood never reaches it nor any cell around it (the
    // verdict), so a casting spot on the far side of open water CANNOT
    // satisfy the arm above.
    const step = 4;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const zone = ZONES.find((z) => z.id === 'farshore_isle');
    expect(zone).toBeDefined();
    if (!zone) return;
    // Rect guards (the QA round): floodFromHub degenerates to a single x
    // column on a rect-less zone (`zone.xMin ?? 0`), and the flood clips at
    // the rect, so both halves below only mean something with the probe
    // point INSIDE a real rect. The gather counter-arm pins containment for
    // exactly this reason ("failing to reach it is the wall's doing and not
    // the bounding box's"); without it, a farshore rect re-mint that expels
    // the point would hollow the verdict into a vacuous green.
    expect(zone.xMin, 'farshore rect').toBeDefined();
    expect(zone.xMax, 'farshore rect').toBeDefined();
    if (zone.xMin === undefined || zone.xMax === undefined) return;
    const OFF_STRAND_SEA_FLOOR = { x: 296, z: -172 };
    expect(OFF_STRAND_SEA_FLOOR.x).toBeGreaterThan(zone.xMin);
    expect(OFF_STRAND_SEA_FLOOR.x).toBeLessThan(zone.xMax);
    expect(OFF_STRAND_SEA_FLOOR.z).toBeGreaterThan(zone.zMin);
    expect(OFF_STRAND_SEA_FLOOR.z).toBeLessThan(zone.zMax);
    expect(terrainHeight(OFF_STRAND_SEA_FLOOR.x, OFF_STRAND_SEA_FLOOR.z, WORLD_SEED)).toBeLessThan(
      waterLevel(),
    );
    expect(dryFoot(OFF_STRAND_SEA_FLOOR.x, OFF_STRAND_SEA_FLOOR.z)).toBe(false);
    const seen = floodFromHub(zone, step);
    expect(seen.size).toBeGreaterThan(1000); // the flood really travelled
    let reached = false;
    for (let dx = -step; dx <= step && !reached; dx += step) {
      for (let dz = -step; dz <= step && !reached; dz += step) {
        if (seen.has(key(OFF_STRAND_SEA_FLOOR.x + dx, OFF_STRAND_SEA_FLOOR.z + dz))) reached = true;
      }
    }
    expect(reached, 'the sea floor must stay outside the dry-foot flood').toBe(false);
  });

  it('border waters are fishable declared water: the Lawnmere south bank accepts a REAL cast', () => {
    // The Lawnmere carves swim-depth water into the galecrest side of the
    // z 700 border (ROW_MERES in src/sim/world.ts): the second Wickharbor
    // site the Q14 ruling names. Probed with the same real-cast accept as
    // the lake sweeps, pinned to the galecrest side (zoneAt is exclusive at
    // zMax, so z under 700 resolves galecrest) and to the ruling's rough
    // 330yd distance.
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('silverstream_fishing_rod', 1);
    // Distance is measured from the literal Wickharbor hub; pin the live hub
    // to that literal so a relocation cannot leave this arm measuring from
    // an abandoned point while staying green.
    expect(ZONES.find((z) => z.id === 'galecrest')?.hub).toMatchObject({ x: 420, z: 360 });
    let accepted: { x: number; z: number } | null = null;
    for (let x = 440; x <= 538 && !accepted; x += 2) {
      for (let z = 682; z <= 698 && !accepted; z += 2) {
        teleportTo(sim, x, z);
        sim.player.facing = 0; // toward +z, into the border water at z 700
        startFishing(sim.ctx, sim.player, meta);
        if (sim.player.castingAbility === FISHING_CAST_ID) {
          sim.player.castingAbility = null;
          sim.player.castRemaining = 0;
          sim.player.fishBiteAtTick = 0;
          sim.player.fishReelDeadlineTick = 0;
          accepted = { x, z };
        }
      }
    }
    expect(accepted, 'no accepted cast on the galecrest Lawnmere bank').not.toBeNull();
    if (!accepted) return;
    expect(zoneAt(accepted.x, accepted.z).id).toBe('galecrest');
    // The ruling's rough-330yd distance is carried by the scan-rect literals
    // and the hub pin above, not by a bracket on the measured distance (the
    // QA round): every point of the scanned bank rect lies 322.6 to 358.0yd
    // from the pinned hub, so a distance bracket inside that range could
    // never fail while those literals stand. The rect literals ARE the
    // record of the second site.
  });

  it('the open sea is unfishable: a seaward coastal cast denies with the no-water error', () => {
    // The render draws one world-spanning sea, but the ocean is not a
    // declared water body, so waterLevelAt answers -Infinity there and the
    // 24yd probe walk finds no fishable sample. The farshore south strand
    // faces open ocean with no declared body in reach; the same rod that
    // accepts on Gull Mere denies here.
    // Premise first, the sibling arms' idiom (the QA round): the water this
    // cast faces really is open sea (terrain below the WORLD plane, outside
    // every declared body: -7.70 against -4.5 at the 24yd sample when this
    // landed), so a strand-lifting terrain edit cannot silently degrade this
    // into a duplicate of the dry-hillside deny while it stays green.
    expect(terrainHeight(295, -94, WORLD_SEED)).toBeLessThan(waterLevel());
    expect(Number.isFinite(waterLevelAt(295, -94))).toBe(false);
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('silverstream_fishing_rod', 1);
    teleportTo(sim, 295, -70);
    sim.player.facing = Math.PI; // toward -z, off the strand and out to sea
    const evStart = sim.events.length;
    startFishing(sim.ctx, sim.player, meta);
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.events.slice(evStart)).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You need to face fishable water.' }),
    );
  });

  it('Gull Mere is deeply fishable with a walkable dry shore, at the shipped seed', () => {
    // R55's authored numbers, pinned behaviorally: the census in
    // tests/water_flora_core.test.ts guards the depth INDIRECTLY (lilies
    // place only below WATER_LEVEL - 0.7), but a census red reads as a
    // flora count to re-baseline; this probe names the regression. Division
    // of labor, mutation-proven: a SHRUNK basin is caught by the sample
    // count floor below (effectively a radius gate), while the fraction
    // floor catches a basin still full-size but no longer DEEP (the
    // decorative pre-R55 Hilltop state, or the 1 percent Glimmermere shape:
    // a dome-lifted bed zeroes the fraction). The 0.5 floor is deliberately
    // half the measured 0.82 so terrain noise never flakes it.
    const farshore = ZONES.find((z) => z.id === 'farshore_isle');
    const mere = farshore?.lakes.find((l) => l.x === 350 && l.z === 118);
    expect(mere).toEqual({ x: 350, z: 118, radius: 10 });
    const lake = mere as { x: number; z: number; radius: number };
    const seed = WORLD_SEED;
    let wet = 0;
    let total = 0;
    for (let dx = -lake.radius; dx <= lake.radius; dx += 0.5) {
      for (let dz = -lake.radius; dz <= lake.radius; dz += 0.5) {
        if (dx * dx + dz * dz > lake.radius * lake.radius) continue;
        total++;
        const x = lake.x + dx;
        const z = lake.z + dz;
        if (terrainHeight(x, z, seed) < waterLevelAt(x, z) - PLAYER_SWIM_DEPTH) wet++;
      }
    }
    expect(total).toBeGreaterThan(1000); // the grid itself is real
    expect(wet / total).toBeGreaterThanOrEqual(0.5);
    // The shore ring an angler stands on: dry all the way around.
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = lake.x + Math.cos(a) * (lake.radius + 1.5);
      const z = lake.z + Math.sin(a) * (lake.radius + 1.5);
      expect(
        terrainHeight(x, z, seed) >= waterLevelAt(x, z) - PLAYER_SWIM_DEPTH,
        `shore bearing ${i} is swimmable`,
      ).toBe(true);
    }
  });
});

describe('zoneAt resolves the ACTIVE zones (the swappable-content read)', () => {
  afterEach(() => setActiveWorldContent(null));

  it('a custom band layout regates the vale water at the custom tier', () => {
    // The vale zone's exact geometry (terrain, lake, everything) wearing the
    // thornpeak IDENTITY: the same shore that is tier 1 on builtin content
    // must now gate at thornpeak's tier, because the gate resolves the zone
    // through the ACTIVE walk. A builtin-ZONES read would keep answering
    // eastbrook and let the pole cast.
    const vale = ZONES[0];
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      zones: [{ ...vale, id: 'thornpeak_heights', zMax: 900 }],
    });
    const sim = makeSim();
    const meta = sim.meta(sim.playerId) as PlayerMeta;
    sim.addItem('simple_fishing_pole', 1);
    const pz = LAKE.z - LAKE.radius - 2;
    const p = sim.player;
    p.pos.x = LAKE.x;
    p.pos.z = pz;
    p.pos.y = terrainHeight(LAKE.x, pz, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = Math.atan2(0, LAKE.z - pz);
    sim.events = [];
    startFishing(sim.ctx, p, meta);
    const denies = deniedEvents(sim.events);
    expect(denies).toHaveLength(1);
    expect((denies[0] as { requiredTier: number }).requiredTier).toBe(
      FISHING_ZONE_ROD_TIERS.thornpeak_heights,
    );
    expect(p.castingAbility).toBeNull();
  });

  it('the /zones readout lists the ACTIVE roster with the you-are-here tag', () => {
    // The one sibling of the unification sweep with no swap test of its own:
    // the readout's count, roster, and tag must resolve the same world the
    // gate does, or a custom map's /zones lies about where the player is.
    const [vale, marsh] = ZONES;
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      zones: [
        { ...vale, id: 'custom_south', name: 'Custom South', zMax: 100 },
        { ...marsh, id: 'custom_north', name: 'Custom North', zMax: 900 },
      ],
    });
    const line = zonesReadout(0, 150); // past custom_south's zMax: the north zone
    expect(line).toContain('Zones (2):');
    expect(line).toContain('Custom South');
    expect(line).toContain('Custom North');
    expect(line).toContain('Custom North (Lvl');
    expect(line).toMatch(/Custom North \(Lvl \d+-\d+\) \[you are here\]/);
    expect(line).not.toMatch(/Custom South[^,]*\[you are here\]/);
  });

  it('zoneAt stays total on a zero-zone content (builtin fallback)', () => {
    // A hand-built WorldContent can carry zones: [] (the editor rejects one,
    // but tests in this repo already ship the shape); the declared non-null
    // ZoneDef return must hold rather than throwing at every .id caller.
    setActiveWorldContent({ ...BUILTIN_WORLD, zones: [] });
    const zone = zoneAt(0, 0);
    expect(zone).toBeDefined();
    expect(zone.id).toBe(ZONES[0].id);
    const northmost = ZONES.reduce((a, b) => (b.zMax > a.zMax ? b : a));
    expect(zoneAt(0, 1e9).id).toBe(northmost.id);
  });
});
