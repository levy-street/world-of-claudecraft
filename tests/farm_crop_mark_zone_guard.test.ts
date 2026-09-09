// The per-crop chronicle mark is decoupled from the zoneId guard (the
// masterwrought Phase 18 hardening of the harvest tail in
// src/sim/professions/farming.ts): the farm_crop:<cropId> collection mark
// needs no zone, so a zone-resolution failure, impossible today and pinned
// so below, may drop only the ZONE half of the deeds hook (the farm:<zone>
// chronicle and the golden zone announce), never the crop mark. Before this
// change the whole onCropHarvestedForDeeds call sat inside the
// `zoneId !== undefined` guard, so the defensive arm silently ate the
// collection credit too.
//
// The failure is staged by mocking farmBedZoneId to resolve nothing for a
// REAL bed, driving the REAL harvestCrop path: content cannot produce the
// case (the pin below proves that), which is exactly why the guard was
// reachable only as dead defense and why this suite mocks rather than
// hand-calling the hook.

import { describe, expect, it, vi } from 'vitest';
import type { FarmCropDef } from '../src/sim/content/farm_crops';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FARM_BED_IDS, farmBedById, farmBedZoneId } from '../src/sim/content/farm_patches';
import type { PlotState } from '../src/sim/professions/farm_projection';
import { harvestCrop, plantCrop } from '../src/sim/professions/farming';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

vi.mock('../src/sim/content/farm_patches', async (importActual) => {
  const actual = await importActual<typeof import('../src/sim/content/farm_patches')>();
  return {
    ...actual,
    // The staged impossibility: every bed keeps its real record (the bad_bed
    // gate and the range gate stay live), but no bed resolves a zone.
    farmBedZoneId: () => undefined,
  };
});

const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const HOE_ID = 'garden_hoe';
const BED = 'bed_eastbrook_1';
const START_MS = 1_700_000_000_000;
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;

function makeHarness(): { sim: Sim; pid: number; meta: PlayerMeta; advance(ms: number): void } {
  let nowMs = START_MS;
  const sim = new Sim({
    seed: 41,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => nowMs,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  const bed = farmBedById(BED);
  if (!bed) throw new Error(`no such bed: ${BED}`);
  const p = sim.player;
  p.pos.x = bed.x;
  p.pos.z = bed.z;
  p.pos.y = terrainHeight(bed.x, bed.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  sim.addItem(HOE_ID, 1, pid);
  sim.addItem(SEED_ID, 1, pid);
  return {
    sim,
    pid,
    meta,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('the crop mark survives a zone-resolution failure', () => {
  it('a survived harvest with NO resolvable zone still writes farm_crop, only the zone half drops', () => {
    const h = makeHarness();
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID);
    h.sim.player.castingAbility = null;
    h.sim.player.castRemaining = 0;
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    const from = h.sim.events.length;
    harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED);
    // The harvest itself landed (nothing rots on a zone bug either).
    const harvested = h.sim.events.slice(from).filter((e) => e.type === 'farmHarvested');
    expect(harvested).toHaveLength(1);
    // THE PIN: the per-crop collection mark landed without a zone.
    expect(h.meta.deedStats.visited.has(`farm_crop:${CROP_ID}`)).toBe(true);
    // Only the zone-owned half dropped: no farm:<zone> chronicle mark exists
    // anywhere (the '' sentinel is outside every chronicle zone).
    for (const mark of h.meta.deedStats.visited) {
      expect(mark.startsWith('farm:') && mark !== 'farm:planted', mark).toBe(false);
    }
  });

  it('pins the documented impossibility: every shipped bed resolves an authored zone', () => {
    // The guard above is defense-in-depth, and this is the content half that
    // keeps it dead: a bed that passed the bad_bed gate always resolves a
    // zone in shipped content. `farmBedZoneId` here is the REAL one via the
    // mock's captured actual? No: the mock replaces it module-wide, so this
    // arm re-imports the actual implementation directly.
    return (async () => {
      const actual = await vi.importActual<typeof import('../src/sim/content/farm_patches')>(
        '../src/sim/content/farm_patches',
      );
      expect(FARM_BED_IDS.size).toBeGreaterThan(0);
      for (const bedId of FARM_BED_IDS) {
        expect(actual.farmBedZoneId(bedId), bedId).toBeDefined();
      }
    })();
  });

  it('the mock really staged the failure (anti-vacuity)', () => {
    expect(farmBedZoneId(BED)).toBeUndefined();
  });
});
