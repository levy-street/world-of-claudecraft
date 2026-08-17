// The farmer NPCs (the farming go-live): four static NpcDefs, one per farming
// hub, standing beside their patch's beds. This is the physical half of the
// go-live pinned against the REAL world: the Sim constructor seats every
// static NPC through findSafePos, which silently nudges a bad position out of
// a collider or deep water, so an authored pos that "looks" beside the beds
// can spawn somewhere else with every content pin still green. Every arm here
// reads the SPAWNED entity, never the def alone.
//
// The seams these positions serve: the husk trade's range gate
// (src/sim/professions/farmer_npcs.ts, FARMER_TRADE_RANGE off the NPC) and the
// vendor purchase reach (items.ts buyItem, INTERACT_RANGE + 2), both measured
// from where the entity actually stands.

import { describe, expect, it } from 'vitest';
import { FARM_PATCHES, type FarmPatchDef } from '../src/sim/content/farm_patches';
import { CAMPS, NPCS, zoneAt } from '../src/sim/data';
import { FARMER_TRADE_RANGE } from '../src/sim/professions/farmer_npcs';
import { Sim } from '../src/sim/sim';
import type { Entity, NpcDef } from '../src/sim/types';
import { groundHeight, isInWaterBody, roadDistance, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The four farmers and the patch each one keeps, as LITERALS: the flag walk
// below proves the set is exactly these four, so a fifth farmer (or a
// re-homed one) reds here and re-decides its patch deliberately.
const FARMERS: readonly { id: string; patchId: string; zoneId: string }[] = [
  { id: 'farmer_jessica', patchId: 'patch_eastbrook', zoneId: 'eastbrook_vale' },
  { id: 'farmer_teasel', patchId: 'patch_mirefen', zoneId: 'mirefen_marsh' },
  { id: 'farmer_hollis', patchId: 'patch_thornpeak', zoneId: 'thornpeak_heights' },
  { id: 'farmer_verbena', patchId: 'patch_evergarden', zoneId: 'evergarden' },
];

// How close a farmer stands to the nearest bed of their patch: near enough
// that a player working the beds is a few steps from the trade and the
// counter, far enough that the NPC never stands on a bed. The lower bound is
// the "never on a disc" floor and the upper bound keeps "beside" honest.
const NEAREST_BED_MIN = 3;
const NEAREST_BED_MAX = 9;
const BED_DISC_CLEARANCE = 1.5;
// world.ts refuses to seat any ground object within 5 yd of a road; a farmer
// standing in the lane would read as the same defect.
const ROAD_MARGIN = 5;
const WATER_MARGIN = 1;

function patchOf(id: string): FarmPatchDef {
  const patch = FARM_PATCHES.find((p) => p.id === id);
  if (!patch) throw new Error(`no such patch: ${id}`);
  return patch;
}

function spawned(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!entity) throw new Error(`farmer ${templateId} did not spawn`);
  return entity;
}

function isDryLand(x: number, z: number): boolean {
  if (!isInWaterBody(x, z)) return true;
  return groundHeight(x, z, WORLD_SEED) >= waterLevelAt(x, z, WORLD_SEED) + WATER_MARGIN;
}

describe('the farmer NPCs: content shape', () => {
  it('exactly the four farmers carry the farmer flag, each a static vendor with a greeting', () => {
    const flagged = Object.values(NPCS)
      .filter((npc: NpcDef) => npc.farmer === true)
      .map((npc) => npc.id)
      .sort();
    expect(flagged).toEqual(FARMERS.map((f) => f.id).sort());
    for (const { id } of FARMERS) {
      const def = NPCS[id];
      expect(def, id).toBeDefined();
      expect(def.dynamic, `${id} must be surface-placed by the ctor loop`).toBeUndefined();
      expect(def.greeting.length, `${id} greeting`).toBeGreaterThan(0);
      expect(def.vendorItems?.length ?? 0, `${id} stocks something`).toBeGreaterThan(0);
    }
  });

  it('pins the go-live names and titles as literals (D17: repo-clean, real plant words)', () => {
    expect(FARMERS.map(({ id }) => [id, NPCS[id].name, NPCS[id].title])).toEqual([
      ['farmer_jessica', 'Farmer Jessica', 'Allotment Keeper'],
      ['farmer_teasel', 'Farmer Teasel', 'Fen Paddy Farmer'],
      ['farmer_hollis', 'Farmer Hollis', 'Highwatch Terrace Farmer'],
      ['farmer_verbena', 'Farmer Verbena', 'Parterre Gardener'],
    ]);
    // Distinct signature tints: the shared villager body is told apart by them.
    expect(new Set(FARMERS.map(({ id }) => NPCS[id].color)).size).toBe(4);
  });

  it('Jessica teaches the two go-live sentences verbatim; every farmer greets', () => {
    // The anti-chore promise and the Harvest Journal pointer, the two lines
    // D20 requires the front door to say. Substring pins on the exact
    // literals: a reword that drops the keybind or softens the promise reds.
    const greeting = NPCS.farmer_jessica.greeting;
    expect(greeting).toContain('It keeps growing while you are away, and it never spoils.');
    expect(greeting).toContain(
      'Your Harvest Journal (Shift+K, or the Farming row of your Professions window) lists every planted bed and its timer.',
    );
    for (const { id } of FARMERS) {
      expect(NPCS[id].greeting.trim().length, id).toBeGreaterThan(0);
    }
    // No greeting over-promises the ready notice: a plot ripening during the
    // linkdead grace loses its transient banner (deviation (bb)), so no farmer
    // may say the player will always be told.
    const overPromises = (text: string): boolean =>
      /\balways\b|will be told/.test(text.toLowerCase());
    // Positive control: the predicate trips on the wording it bans.
    expect(overPromises('You will always be told when a crop is ready.')).toBe(true);
    for (const { id } of FARMERS) {
      expect(overPromises(NPCS[id].greeting), id).toBe(false);
    }
  });
});

describe('the farmer NPCs: seated beside their beds in the real world', () => {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });

  it('spawns at EXACTLY the authored pos (findSafePos nudged nothing) with the authored facing', () => {
    for (const { id } of FARMERS) {
      const def = NPCS[id];
      const entity = spawned(sim, id);
      expect({ x: entity.pos.x, z: entity.pos.z }, id).toEqual({ x: def.pos.x, z: def.pos.z });
      expect(entity.facing, `${id} facing`).toBe(def.facing);
    }
  });

  it('stands 3 to 9 yd from the nearest bed of its own patch, never on a bed disc', () => {
    for (const { id, patchId } of FARMERS) {
      const entity = spawned(sim, id);
      const patch = patchOf(patchId);
      const distances = patch.beds.map((bed) =>
        Math.hypot(entity.pos.x - bed.x, entity.pos.z - bed.z),
      );
      const nearest = Math.min(...distances);
      expect(nearest, `${id} nearest bed`).toBeGreaterThanOrEqual(NEAREST_BED_MIN);
      expect(nearest, `${id} nearest bed`).toBeLessThanOrEqual(NEAREST_BED_MAX);
      for (const d of distances)
        expect(d, `${id} on a bed disc`).toBeGreaterThan(BED_DISC_CLEARANCE);
      // The trade gate is reachable from the bed a player just worked: at
      // least one bed of the patch lies inside FARMER_TRADE_RANGE of the
      // farmer, so plant, harvest and trade share one standing spot.
      expect(nearest, `${id} trade reach`).toBeLessThanOrEqual(FARMER_TRADE_RANGE);
    }
  });

  it('faces its beds: the facing vector points toward the patch anchor', () => {
    // facing 0 looks along +z; the direction is (sin f, cos f) (dev_commands
    // and obs.ts read it that way). A farmer turned away from the beds is a
    // content typo this catches before a screenshot does.
    for (const { id, patchId } of FARMERS) {
      const entity = spawned(sim, id);
      const patch = patchOf(patchId);
      const dx = patch.x - entity.pos.x;
      const dz = patch.z - entity.pos.z;
      const len = Math.hypot(dx, dz);
      const dot = (Math.sin(entity.facing) * dx + Math.cos(entity.facing) * dz) / len;
      expect(dot, `${id} looks away from its beds`).toBeGreaterThan(0.7);
    }
  });

  it('stands in its patch zone, on dry land, off the road, outside every camp footprint', () => {
    for (const { id, zoneId, patchId } of FARMERS) {
      const entity = spawned(sim, id);
      expect(zoneAt(entity.pos.x, entity.pos.z).id, id).toBe(zoneId);
      expect(patchOf(patchId).zoneId, `${patchId} zone`).toBe(zoneId);
      expect(isDryLand(entity.pos.x, entity.pos.z), `${id} in the water`).toBe(true);
      expect(roadDistance(entity.pos.x, entity.pos.z), `${id} on the road`).toBeGreaterThanOrEqual(
        ROAD_MARGIN,
      );
      for (const camp of CAMPS) {
        const margin =
          Math.hypot(entity.pos.x - camp.center.x, entity.pos.z - camp.center.z) - camp.radius;
        expect(margin, `${id} inside the ${camp.mobId} camp`).toBeGreaterThan(0);
      }
    }
  });

  it('is a real vendor at spawn: the entity mirrors the def stock in order', () => {
    for (const { id } of FARMERS) {
      expect(spawned(sim, id).vendorItems, id).toEqual(NPCS[id].vendorItems);
    }
  });
});
