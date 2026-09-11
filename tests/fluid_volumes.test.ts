import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  damagingFluidAt,
  FLUID_ASSET_IDS,
  FLUID_PRESETS,
  fluidContains,
  fluidVolumeFromPlacement,
  fluidVolumesFromPlacements,
} from '../src/sim/fluid_volumes';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { Sim } from '../src/sim/sim';
import type { FluidVolume, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Fluid pools (lava/acid/spectral/water): placement resolution, footprint
// containment, the sim's once-per-second damage tick, and document fields.

const SEED = 4242;

function world(extra: Partial<WorldContent>): WorldContent {
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

const LAVA_PLACEMENT = {
  assetId: FLUID_ASSET_IDS.lava,
  x: 0,
  z: 40,
  rotY: 0,
  scale: 1,
  collide: false,
  sizeX: 20,
  sizeZ: 10,
  sizeY: 0.3,
};

describe('fluid volume resolution', () => {
  it('resolves a lava placement with preset defaults', () => {
    const v = fluidVolumeFromPlacement(LAVA_PLACEMENT);
    expect(v).not.toBeNull();
    expect(v?.kind).toBe('lava');
    expect(v?.halfX).toBe(10);
    expect(v?.halfZ).toBe(5);
    expect(v?.offsetY).toBe(0.3);
    expect(v?.dps).toBe(FLUID_PRESETS.lava.dps);
    expect(v?.dpsPct).toBe(FLUID_PRESETS.lava.dpsPct);
    expect(v?.dpsPct).toBe(0.1); // lava burns for 10% max HP/s
    expect(v?.school).toBe('fire');
  });

  it('per-placement overrides beat the preset; non-fluids resolve null', () => {
    const v = fluidVolumeFromPlacement({
      ...LAVA_PLACEMENT,
      hue: 300,
      lum: 0.7,
      fluidDps: 20,
      fluidFx: 5,
    });
    expect(v?.hue).toBe(300);
    expect(v?.lum).toBe(0.7);
    expect(v?.dps).toBe(20);
    expect(v?.fx).toBe(5);
    expect(fluidVolumeFromPlacement({ ...LAVA_PLACEMENT, assetId: 'props/well' })).toBeNull();
    expect(
      fluidVolumesFromPlacements([LAVA_PLACEMENT, { ...LAVA_PLACEMENT, assetId: 'x' }]),
    ).toHaveLength(1);
  });

  it('containment respects the rotated ellipse footprint', () => {
    const v = fluidVolumeFromPlacement({ ...LAVA_PLACEMENT, rotY: Math.PI / 2 }) as FluidVolume;
    // Rotated 90deg: the long axis (halfX=10) now runs along world Z.
    expect(fluidContains(v, 0, 40 + 8)).toBe(true);
    expect(fluidContains(v, 8, 40)).toBe(false);
    expect(fluidContains(v, 0, 40 + 11)).toBe(false);
  });

  it('damagingFluidAt requires dps > 0, containment, and feet at/below surface', () => {
    const lava = fluidVolumeFromPlacement(LAVA_PLACEMENT) as FluidVolume;
    const still = fluidVolumeFromPlacement({
      ...LAVA_PLACEMENT,
      assetId: FLUID_ASSET_IDS.water,
      x: 100,
    }) as FluidVolume;
    const surface = (): number => 5;
    expect(damagingFluidAt([lava, still], 0, 40, 4.9, surface)?.kind).toBe('lava');
    expect(damagingFluidAt([lava, still], 0, 40, 5.5, surface)).toBeNull(); // above surface
    expect(damagingFluidAt([lava, still], 100, 40, 0, surface)).toBeNull(); // dps 0
    expect(damagingFluidAt([lava, still], 50, 40, 0, surface)).toBeNull(); // outside
  });
});

describe('fluid damage tick (sim)', () => {
  it('a player standing in a flat-DPS pool takes its DPS once per second', () => {
    const fluids = fluidVolumesFromPlacements([
      { ...LAVA_PLACEMENT, assetId: FLUID_ASSET_IDS.acid, fluidDps: 10 },
    ]);
    const content = world({ fluids });
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = 0;
    p.pos.z = 40;
    p.pos.y = terrainHeight(0, 40, SEED);
    const hp0 = p.hp;
    for (let i = 0; i < 41; i++) sim.tick(); // at least one whole-second boundary
    // Exact totals depend on tick phase and out-of-combat regen; the invariant
    // is that a flat-DPS pool hurts by roughly its DPS per second, never heals.
    const lost = hp0 - p.hp;
    expect(lost).toBeGreaterThanOrEqual(10);
    expect(lost).toBeLessThanOrEqual(25);
  });

  it('lava burns for 10% of the victim max HP per second', () => {
    // No fluidDps override: lava's flat DPS is 0, so all the damage comes from
    // the 10%-max-HP component (dpsPct), which scales with the victim.
    const fluids = fluidVolumesFromPlacements([{ ...LAVA_PLACEMENT }]);
    const content = world({ fluids });
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = 0;
    p.pos.z = 40;
    p.pos.y = terrainHeight(0, 40, SEED);
    const hp0 = p.hp;
    const perTick = Math.round(0.1 * p.maxHp);
    expect(perTick).toBeGreaterThan(0);
    for (let i = 0; i < 41; i++) sim.tick(); // at least one whole-second boundary
    const lost = hp0 - p.hp;
    // At least one full 10% tick landed and no more than roughly two, so the
    // burn tracks max HP rather than a fixed number.
    expect(lost).toBeGreaterThanOrEqual(perTick);
    expect(lost).toBeLessThanOrEqual(perTick * 2 + 5);
  });

  it('no damage outside the pool or on harmless fluids', () => {
    const fluids = fluidVolumesFromPlacements([
      { ...LAVA_PLACEMENT, assetId: FLUID_ASSET_IDS.water },
    ]);
    const content = world({ fluids });
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.pos.x = 0;
    p.pos.z = 40;
    const hp0 = p.hp;
    for (let i = 0; i < 41; i++) sim.tick();
    expect(p.hp).toBe(hp0);
  });
});

describe('document fields', () => {
  it('fluidDps/fluidFx and waterHue/waterLum survive the sanitizer (clamped)', () => {
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'fluids', seed: SEED },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
      terrainEdits: [],
      placements: [{ ...LAVA_PLACEMENT, fluidDps: 999, fluidFx: 99 }],
      waterHue: 400,
      waterLum: 2,
    });
    expect(doc?.placements[0]?.fluidDps).toBe(50);
    expect(doc?.placements[0]?.fluidFx).toBe(15);
    expect(doc?.waterHue).toBe(360);
    expect(doc?.waterLum).toBe(1);
  });
});
