// Camp spots and retired slots (CampDef.spots / retiredSlots, src/sim/camp_scatter.ts).
//
// The Studio town rework moved mobs between packs and deleted a few. A shipped
// camp that changed its count would shift the shared world-gen stream, and with
// it every seeded roll after it. So a reworked camp keeps its shipped count:
// its mobs stand on authored spots and its lost mobs are retired slots that
// still consume their draws. These pins hold both halves: the mobs land where
// authored, and the stream after the camp loop is bit-identical.
import { afterAll, describe, expect, it } from 'vitest';
import {
  CAMP_SLOT_DRAWS,
  campSlotPoint,
  campSpawnedCount,
  campSpawnOffset,
  isRetiredCampSlot,
} from '../src/sim/camp_scatter';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { Sim } from '../src/sim/sim';
import type { CampDef, Entity, WorldContent } from '../src/sim/types';

const SEED = 4242;
const CENTER = { x: 600, z: 600 };
const BASE: CampDef = { mobId: 'forest_wolf', center: CENTER, radius: 10, count: 4 };

function makeSim(camps: CampDef[]): Sim {
  const world: WorldContent = { ...BUILTIN_WORLD, camps, npcs: {}, groundObjects: [] };
  setActiveWorldContent(world);
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
}

afterAll(() => setActiveWorldContent(BUILTIN_WORLD));

function wolves(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
  );
}

function after(sim: Sim): { draws: number[]; nextId: number } {
  const nextId = (sim as unknown as { nextId: number }).nextId;
  const draws: number[] = [];
  for (let i = 0; i < 6; i++) draws.push(sim.rng.next());
  return { draws, nextId };
}

describe('campSlotPoint', () => {
  it('returns the authored spot for a pinned slot, whatever the jitter', () => {
    const camp: CampDef = { ...BASE, spots: [{ x: 610, z: 590 }] };
    expect(campSlotPoint(camp, 0, 1.2, 0.7)).toEqual({ x: 610, z: 590 });
    expect(campSlotPoint(camp, 0, 5.9, 0.1)).toEqual({ x: 610, z: 590 });
  });

  it('scatters a slot past the spots list exactly as an unpinned camp does', () => {
    const camp: CampDef = { ...BASE, spots: [{ x: 610, z: 590 }] };
    const off = campSpawnOffset(2, BASE.count, BASE.radius, 1.2, 0.7);
    expect(campSlotPoint(camp, 2, 1.2, 0.7)).toEqual({ x: 600 + off.x, z: 600 + off.z });
    expect(campSlotPoint(BASE, 2, 1.2, 0.7)).toEqual({ x: 600 + off.x, z: 600 + off.z });
  });
});

describe('retired slots', () => {
  it('retires the LAST slots and counts only the rest as spawned', () => {
    const camp: CampDef = { ...BASE, retiredSlots: 2 };
    expect([0, 1, 2, 3].map((i) => isRetiredCampSlot(camp, i))).toEqual([false, false, true, true]);
    expect(campSpawnedCount(camp)).toBe(2);
    expect(campSpawnedCount(BASE)).toBe(4);
    expect(campSpawnedCount({ ...BASE, retiredSlots: 9 })).toBe(0);
  });

  it('pins the per-slot draw count to the spawn loop (five one-next draws)', () => {
    expect(CAMP_SLOT_DRAWS).toBe(5);
  });
});

describe('a reworked camp in a real Sim', () => {
  const SPOTS = [
    { x: 606, z: 604 },
    { x: 594, z: 598 },
  ];
  const REWORKED: CampDef = { ...BASE, spots: SPOTS, retiredSlots: 2 };

  it('spawns only its live slots, each on its authored spot', () => {
    const sim = makeSim([REWORKED]);
    const ws = wolves(sim);
    expect(ws).toHaveLength(2);
    const at = ws.map((w) => ({ x: Math.round(w.pos.x), z: Math.round(w.pos.z) }));
    expect(at).toEqual(expect.arrayContaining(SPOTS));
  });

  it('leaves the shared stream and the entity ids exactly where the shipped camp left them', () => {
    const shipped = after(makeSim([BASE]));
    const reworked = after(makeSim([REWORKED]));
    expect(reworked).toEqual(shipped);
    // Non-vacuous: really changing the count DOES move the stream.
    const recounted = after(makeSim([{ ...BASE, count: 2 }]));
    expect(recounted.draws).not.toEqual(shipped.draws);
  });

  it('keeps a later camp spawning exactly where it did', () => {
    const LATER: CampDef = { mobId: 'wild_boar', center: { x: 640, z: 640 }, radius: 8, count: 3 };
    const boars = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((e) => e.templateId === 'wild_boar')
        .map((e) => ({ x: e.pos.x, z: e.pos.z, level: e.level }));
    expect(boars(makeSim([REWORKED, LATER]))).toEqual(boars(makeSim([BASE, LATER])));
  });
});

describe('the map document keeps spots and retired slots', () => {
  it('round-trips both fields through the sanitizer, bounded by the slot count', () => {
    const doc = sanitizeMapDoc({
      version: 1,
      meta: { name: 'spots' },
      content: {
        camps: [
          {
            ...BASE,
            spots: [{ x: 606, z: 604 }, { x: 'bad' }, { x: 594, z: 598 }],
            retiredSlots: 2,
          },
          { ...BASE, count: 2, spots: [1, 2, 3].map((i) => ({ x: i, z: i })), retiredSlots: 7 },
        ],
      },
    });
    const camps = doc?.content?.camps ?? [];
    expect(camps[0].spots).toEqual([
      { x: 606, z: 604 },
      { x: 594, z: 598 },
    ]);
    expect(camps[0].retiredSlots).toBe(2);
    expect(camps[1].spots).toEqual([
      { x: 1, z: 1 },
      { x: 2, z: 2 },
    ]);
    expect(camps[1].retiredSlots).toBe(2);
  });
});
