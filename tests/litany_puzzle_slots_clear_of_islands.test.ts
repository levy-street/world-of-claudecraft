import { describe, expect, it } from 'vitest';
import { DROWNED_LITANY_MODULES } from '../src/sim/content/delves/drowned_litany';
import { litanyModuleGeometry } from '../src/sim/delve_litany_layout';

// Walk-on Litany puzzle objects (sluice valve, grave tablet, corpse candle) render
// as flat floor plates. The dry stepping-stone islands are 0.2 high slabs drawn on
// top of the floor, so a plate whose footprint overlaps one is buried and the
// player cannot see what to step on.
const WALK_ON = new Set(['sluice_valve', 'grave_tablet', 'corpse_candle']);
// Half of the 3.2 yard plate footprint (PRESSURE_PLATE_WIDTH in render/delve_props.ts).
const PLATE_HALF = 1.6;

describe('Litany walk-on puzzle plates stay off the dry island slabs', () => {
  for (const [moduleId, def] of Object.entries(DROWNED_LITANY_MODULES)) {
    const geo = litanyModuleGeometry(moduleId as never);
    const slots = def.interactableSlots.filter((s) => WALK_ON.has(s.variants[0]));
    if (!geo || slots.length === 0) continue;
    it(`${moduleId}: no plate footprint overlaps an island`, () => {
      for (const s of slots) {
        for (const isle of geo.islands) {
          const overlaps =
            Math.abs(s.x - isle.x) < isle.hw + PLATE_HALF &&
            Math.abs(s.z - isle.z) < isle.hd + PLATE_HALF;
          expect(overlaps, `${s.variants[0]} at ${s.x},${s.z} vs island ${isle.x},${isle.z}`).toBe(
            false,
          );
        }
      }
    });
  }
});
