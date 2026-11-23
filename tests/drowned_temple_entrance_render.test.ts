// The Moon Stair's cosmetic plan and its painter
// (src/render/drowned_temple_entrance_core.ts and
// src/render/drowned_temple_entrance.ts): one clock, the moonrise, read by
// every effect; the pool's moon traced under its surface with real parallax;
// the mirror that gives back the gate standing over it; the mist and the
// sprites thinned by the static effects tier and frozen under reduced motion;
// and the painter's contract: three effect draws, three effect programs and
// the inlays' own, one budgeted point light, the world's floor-mark layers,
// one fading unit per side of the set piece.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveUiEffectsProfile } from '../src/game/ui_effects_profile';
import {
  buildDrownedTempleEntrance,
  drownedTempleEntranceInternalsForTest as painter,
  TEMPLE_INLAY_PROGRAM_CACHE_KEY,
  TEMPLE_MIST_PROGRAM_CACHE_KEY,
  TEMPLE_MOONWATER_PROGRAM_CACHE_KEY,
  TEMPLE_SPRITE_PROGRAM_CACHE_KEY,
} from '../src/render/drowned_temple_entrance';
import {
  TEMPLE_DRIPS,
  TEMPLE_FALLS,
  TEMPLE_FILM_LAYERS,
  TEMPLE_FILM_LOOK,
  TEMPLE_FILM_MOON,
  TEMPLE_FILM_OCCLUDER,
  TEMPLE_GATE,
  TEMPLE_GATE_LIGHT,
  TEMPLE_GHOST_SETS,
  TEMPLE_GLINTS,
  TEMPLE_HORN_TIP,
  TEMPLE_MIRROR_RUNS,
  TEMPLE_MIRROR_STEP,
  TEMPLE_MIST_FIELDS,
  TEMPLE_MOONRISE,
  TEMPLE_POOL,
  TEMPLE_POOL_MOON,
  TEMPLE_POOL_RUNES,
  TEMPLE_RING_RUNES,
  TEMPLE_SPRITE_KIND,
  TEMPLE_STAIR_RUNES,
  TEMPLE_WATER_KIND,
  type TempleEffectsTier,
  type TempleMoonrise,
  templeFilmLight,
  templeFilmMoonHeight,
  templeFilmMoonSeen,
  templeFilmWhirl,
  templeGateLightIntensity,
  templeGhostShown,
  templeMirrorCells,
  templeMirrorCovers,
  templeMirrorGrid,
  templeMirrorSight,
  templeMistPose,
  templeMistPuff,
  templeMistPuffCount,
  templeMistStrength,
  templeMistSurface,
  templeMoonrise,
  templeNightAmount,
  templeOccluderSet,
  templePoolMoonDepth,
  templePoolTrace,
  templeRuneGlow,
  templeSpritePose,
  templeSprites,
} from '../src/render/drowned_temple_entrance_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { activateGfxProfile, GFX, type GfxTier, getActiveGfxProfile } from '../src/render/gfx';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { OCCLUDER_FADE_ALPHA } from '../src/render/occluder_fade_core';
import {
  clearSetPieceOccluders,
  setPieceOccludersInternalsForTest,
  updateSetPieceOccluders,
} from '../src/render/set_piece_occluders';
import { DUNGEONS } from '../src/sim/data';
import {
  DROWNED_TEMPLE_ENTRANCE_COLLIDERS,
  DROWNED_TEMPLE_ENTRANCE_LEVELS,
} from '../src/sim/drowned_temple_entrance';
import { DROWNED_TEMPLE_STAIR } from '../src/sim/drowned_temple_stair';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const TIERS: readonly TempleEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const DOOR = DUNGEONS.drowned_temple.doorPos;
const BASE = terrainHeight(DOOR.x, DOOR.z, WORLD_SEED);
const ground = (lx: number, lz: number) =>
  terrainHeight(DOOR.x + lx, DOOR.z + lz, WORLD_SEED) - BASE;
const rise = (time: number, motion = 1): TempleMoonrise =>
  templeMoonrise(time, motion, { front: 0, glow: 0, crest: 0 });
const M = TEMPLE_MOONRISE;
const fx4 = (v: number) => v.toFixed(4);
type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];
const compile = (material: THREE.Material, vertexShader: string, fragmentShader: string) => {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader, fragmentShader };
  material.onBeforeCompile(shader as unknown as Shader, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe('the moonrise is one clock', () => {
  it('rests, climbs from the stair to the crown, crests and fades, once a period', () => {
    const quiet = rise(M.period * 0.1);
    expect(quiet.crest).toBe(0);
    expect(quiet.glow).toBe(0);
    expect(quiet.front).toBeLessThan(0);
    // the climb: the front runs from under the first inlay to past the last
    let prev = -1;
    for (let u = M.climbStart; u <= M.climbEnd; u += 0.02) {
      const r = rise(M.period * u);
      expect(r.front).toBeGreaterThanOrEqual(prev);
      prev = r.front;
      expect(r.glow).toBe(1);
    }
    expect(rise(M.period * M.climbEnd).front).toBeGreaterThan(1);
    // the crest stands between the climb's end and the fade
    const crest = rise(M.period * (M.climbEnd + M.crestEnd) * 0.5);
    expect(crest.crest).toBeCloseTo(1, 6);
    expect(rise(M.period * 0.99).crest).toBeLessThan(0.02);
    // periodic
    const a = rise(7.3);
    const b = rise(7.3 + M.period * 3);
    expect(b.front).toBeCloseTo(a.front, 9);
    expect(b.crest).toBeCloseTo(a.crest, 9);
  });

  it('lights the inlays one by one, in the order the Blender build wrote into them', () => {
    // the stair's inlays wax from the drowned foot to the top, the ring's from its feet to the crown
    const orders = [...TEMPLE_STAIR_RUNES, ...TEMPLE_RING_RUNES].map((r) => r[3]);
    expect(orders.length).toBeGreaterThanOrEqual(16);
    for (const order of orders) {
      expect(order).toBeGreaterThanOrEqual(0);
      expect(order).toBeLessThanOrEqual(1);
    }
    // higher on the stair is later: order grows as lz climbs toward the dais
    const stair = [...TEMPLE_STAIR_RUNES].sort((a, b) => a[2] - b[2]);
    for (let i = 1; i < stair.length; i++) expect(stair[i][3]).toBeGreaterThan(stair[i - 1][3]);
    expect(Math.max(...TEMPLE_STAIR_RUNES.map((r) => r[3]))).toBeLessThan(
      Math.min(...TEMPLE_RING_RUNES.map((r) => r[3])),
    );
    // and higher on the ring is later, the keystone last
    const ring = TEMPLE_RING_RUNES.filter((r) => r[1] > TEMPLE_GATE.sill + 1).sort(
      (a, b) => a[1] - b[1],
    );
    for (let i = 1; i < ring.length; i++) expect(ring[i][3]).toBeGreaterThanOrEqual(ring[i - 1][3]);
    // at mid climb the low inlays burn and the high ones still ember
    const mid = rise(M.period * (M.climbStart + M.climbEnd) * 0.5);
    expect(templeRuneGlow(0.1, mid)).toBeGreaterThan(0.9);
    expect(templeRuneGlow(0.95, mid)).toBeCloseTo(M.ember, 3);
    // the flash: an inlay is brightest as the front passes it
    const passing = { front: 0.5, glow: 1, crest: 0 };
    expect(templeRuneGlow(0.5, passing)).toBeGreaterThan(templeRuneGlow(0.3, passing));
    // between risings every live inlay holds its ember, never dark
    expect(templeRuneGlow(0.4, rise(1))).toBeCloseTo(M.ember, 6);
  });

  it('reduced motion holds it still: every inlay evenly lit, no climb, no crest pulse', () => {
    const a = rise(3, 0);
    const b = rise(15.2, 0);
    expect(a).toEqual(b);
    expect(a.front).toBeGreaterThan(1);
    expect(a.glow).toBe(M.stillGlow);
    expect(a.crest).toBe(M.stillCrest);
    expect(templeRuneGlow(0.1, a)).toBeCloseTo(templeRuneGlow(0.9, a), 9);
  });

  it('the gate light and the film follow the crest and never go out', () => {
    expect(templeGateLightIntensity(0)).toBe(TEMPLE_GATE_LIGHT.rest);
    expect(templeGateLightIntensity(1)).toBe(TEMPLE_GATE_LIGHT.crest);
    expect(TEMPLE_GATE_LIGHT.rest).toBeGreaterThan(1);
    expect(templeFilmLight(0)).toBeGreaterThan(0.5);
    expect(templeFilmLight(1)).toBeGreaterThan(templeFilmLight(0));
    // the moon in the film rises to the ring's centre with the crest
    expect(templeFilmMoonHeight(1)).toBe(TEMPLE_GATE.centre + TEMPLE_FILM_MOON.lift);
    expect(templeFilmMoonHeight(0)).toBeCloseTo(
      templeFilmMoonHeight(1) - TEMPLE_FILM_MOON.restDrop,
      9,
    );
    expect(TEMPLE_FILM_MOON.restDrop).toBeGreaterThan(1);
    expect(templeNightAmount(0)).toBeGreaterThan(0.9);
    expect(templeNightAmount(0.5)).toBe(0);
  });
});

describe('the numbers are the Blender build and the sim', () => {
  it('the gate, the mirror and the pool sit where the sim says', () => {
    expect(TEMPLE_GATE.dais).toBe(DROWNED_TEMPLE_ENTRANCE_LEVELS.dais);
    expect(TEMPLE_GATE.dais).toBe(DROWNED_TEMPLE_STAIR.dais);
    expect(TEMPLE_GATE.centre).toBe(DROWNED_TEMPLE_ENTRANCE_LEVELS.ringCentre);
    expect(TEMPLE_GATE.inner).toBe(DROWNED_TEMPLE_ENTRANCE_LEVELS.ringInner);
    expect(TEMPLE_GATE.outer).toBe(DROWNED_TEMPLE_ENTRANCE_LEVELS.ringOuter);
    expect(TEMPLE_GATE.water).toBe(DROWNED_TEMPLE_ENTRANCE_LEVELS.water);
    // the whole circle shows over the sill: the ring is a ring, not an arch
    expect(TEMPLE_GATE.centre - TEMPLE_GATE.inner).toBeGreaterThan(TEMPLE_GATE.dais);
    expect(TEMPLE_GATE.sill).toBeGreaterThan(TEMPLE_GATE.centre - TEMPLE_GATE.inner);
    // the pool lies on the terrace behind the gate, a hand over its ground
    const g = ground(TEMPLE_POOL.lx, TEMPLE_POOL.lz);
    expect(TEMPLE_POOL.water - g).toBeGreaterThan(0.1);
    expect(TEMPLE_POOL.water - g).toBeLessThan(0.7);
    expect(TEMPLE_POOL.rim).toBeGreaterThan(TEMPLE_POOL.water);
    expect(TEMPLE_POOL.lz).toBeGreaterThan(8);
    expect(TEMPLE_HORN_TIP[1]).toBeGreaterThan(TEMPLE_GATE.centre + TEMPLE_GATE.outer + 2);
    expect(TEMPLE_POOL_RUNES.length).toBeGreaterThanOrEqual(4);
    expect(TEMPLE_DRIPS.length).toBeGreaterThanOrEqual(5);
    expect(TEMPLE_GLINTS.length).toBeGreaterThanOrEqual(12);
    expect(TEMPLE_FALLS).toHaveLength(2);
  });

  it('the mirror lies on the shelf at the stair foot, over ground it can cover, never on the stair', () => {
    const cells = templeMirrorCells();
    expect(cells.length / 2).toBeGreaterThan(220);
    let wet = 0;
    for (let i = 0; i < cells.length; i += 2) {
      const cx = cells[i] + TEMPLE_MIRROR_STEP / 2;
      const cz = cells[i + 1] + TEMPLE_MIRROR_STEP / 2;
      // inside the weir's reach, south of the flight's cheeks
      expect(cz).toBeLessThan(-8);
      expect(cz).toBeGreaterThan(-31);
      // the land hides a cell's dry part: no cell floats over ground far above the water
      expect(ground(cx, cz)).toBeLessThan(TEMPLE_GATE.water + 1.3);
      if (ground(cx, cz) < TEMPLE_GATE.water) wet++;
      expect(templeMirrorCovers(cx, cz)).toBe(true);
    }
    // most of it is water over the bed, a shin deep
    expect(wet / (cells.length / 2)).toBeGreaterThan(0.75);
    expect(TEMPLE_GATE.water - ground(-6, -20)).toBeGreaterThan(0.2);
    expect(TEMPLE_GATE.water - ground(-6, -20)).toBeLessThan(0.6);
    expect(templeMirrorCovers(0, -18)).toBe(true);
    expect(templeMirrorCovers(0, -6)).toBe(false);
    expect(templeMirrorCovers(9, -30)).toBe(false);
    expect(TEMPLE_MIRROR_RUNS.length).toBeGreaterThan(8);
    // the grid shares its corners and winds every cell up
    const grid = templeMirrorGrid();
    expect(grid.index.length).toBe((cells.length / 2) * 6);
    expect(grid.positions.length / 2).toBeLessThan((cells.length / 2) * 2);
    const [a, b, c] = grid.index;
    const ax = grid.positions[a * 2];
    const az = grid.positions[a * 2 + 1];
    const cross =
      (grid.positions[b * 2 + 1] - az) * (grid.positions[c * 2] - ax) -
      (grid.positions[b * 2] - ax) * (grid.positions[c * 2 + 1] - az);
    expect(cross).toBeGreaterThan(0);
  });
});

describe('the pool holds a moon with depth', () => {
  it('the moon slides against the kerb as the eye moves: true parallax, bent by the water', () => {
    const depth = templePoolMoonDepth(0);
    const out = { x: 0, z: 0 };
    // straight down over the centre: the moon lies under the centre
    templePoolTrace(
      TEMPLE_POOL.lx,
      TEMPLE_POOL.water + 6,
      TEMPLE_POOL.lz,
      TEMPLE_POOL.lx,
      TEMPLE_POOL.lz,
      depth,
      out,
    );
    expect(out.x).toBeCloseTo(TEMPLE_POOL.lx, 6);
    expect(out.z).toBeCloseTo(TEMPLE_POOL.lz, 6);
    // from the south the sight line lands NORTH of the point it enters at, from the west EAST of it
    const south = templePoolTrace(
      0,
      TEMPLE_POOL.water + 2,
      TEMPLE_POOL.lz - 6,
      0,
      TEMPLE_POOL.lz,
      depth,
      { x: 0, z: 0 },
    );
    expect(south.z).toBeGreaterThan(TEMPLE_POOL.lz + 0.5);
    const west = templePoolTrace(
      6,
      TEMPLE_POOL.water + 2,
      TEMPLE_POOL.lz,
      0,
      TEMPLE_POOL.lz,
      depth,
      { x: 0, z: 0 },
    );
    expect(west.x).toBeLessThan(-0.5);
    // a deeper moon slides further
    const deeper = templePoolTrace(
      0,
      TEMPLE_POOL.water + 2,
      TEMPLE_POOL.lz - 6,
      0,
      TEMPLE_POOL.lz,
      depth * 2,
      { x: 0, z: 0 },
    );
    expect(deeper.z - TEMPLE_POOL.lz).toBeCloseTo((south.z - TEMPLE_POOL.lz) * 2, 6);
    // the water bends the ray down, so even a glancing eye keeps the moon inside the kerb
    const glancing = templePoolTrace(
      0,
      TEMPLE_POOL.water + 1.2,
      TEMPLE_POOL.lz - 9,
      0,
      TEMPLE_POOL.lz,
      depth,
      { x: 0, z: 0 },
    );
    expect(glancing.z - TEMPLE_POOL.lz).toBeLessThan(TEMPLE_POOL.radius - TEMPLE_POOL_MOON.radius);
    // an eye under the surface sees nothing
    expect(
      Number.isNaN(templePoolTrace(0, TEMPLE_POOL.water - 1, 0, 0, TEMPLE_POOL.lz, depth, out).x),
    ).toBe(true);
  });

  it('the moon climbs toward the surface at the crest', () => {
    expect(templePoolMoonDepth(0)).toBe(TEMPLE_POOL_MOON.restDepth);
    expect(templePoolMoonDepth(1)).toBe(TEMPLE_POOL_MOON.crestDepth);
    expect(TEMPLE_POOL_MOON.crestDepth).toBeLessThan(TEMPLE_POOL_MOON.restDepth);
    expect(TEMPLE_POOL_MOON.radius).toBeLessThan(TEMPLE_POOL.radius * 0.5);
  });
});

describe('the mirror gives back the gate', () => {
  it('a wader at the stair foot sees the film in the water, the ring round it, and the sky beyond', () => {
    // a ray leaving the water at (0, -20) toward the ring's centre
    const toward = (ty: number, tx = 0): [number, number, number] => {
      const dx = tx;
      const dy = ty - TEMPLE_GATE.water;
      const dz = 20;
      const len = Math.hypot(dx, dy, dz);
      return [dx / len, dy / len, dz / len];
    };
    expect(templeMirrorSight(0, -20, ...toward(TEMPLE_GATE.centre))).toBe('film');
    expect(templeMirrorSight(0, -20, ...toward(TEMPLE_GATE.centre + TEMPLE_GATE.inner + 0.6))).toBe(
      'ring',
    );
    expect(templeMirrorSight(0, -20, ...toward(TEMPLE_GATE.centre + TEMPLE_GATE.outer + 2))).toBe(
      'sky',
    );
    expect(templeMirrorSight(0, -20, ...toward(TEMPLE_GATE.centre, 8))).toBe('sky');
    // under the sill the film is cut by the floor
    expect(templeMirrorSight(0, -20, ...toward(TEMPLE_GATE.sill - 0.2))).not.toBe('film');
    // a ray going away from the gate sees only sky
    expect(templeMirrorSight(0, -20, 0, 0.5, -0.86)).toBe('sky');
  });
});

describe('the mist', () => {
  it('keeps its fields and thins by the static tier', () => {
    expect(TEMPLE_MIST_FIELDS.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1, 6);
    const counts = TIERS.map(templeMistPuffCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    expect(counts[0]).toBeGreaterThanOrEqual(12);
    expect(counts[3]).toBeLessThanOrEqual(60);
    // every field keeps a puff on the lowest tier
    const low = new Set(
      Array.from({ length: counts[0] }, (_, i) => templeMistPuff(i, counts[0]).field),
    );
    expect(low.size).toBe(TEMPLE_MIST_FIELDS.length);
    expect(templeMistStrength(0)).toBeGreaterThan(0.5);
    expect(templeMistStrength(1)).toBeGreaterThan(templeMistStrength(0));
  });

  it('lies on the mirror, on the pool and on the ground, and drifts on the shared clock', () => {
    // on the water where the mirror covers the bed
    expect(templeMistSurface(-6, -20, ground(-6, -20))).toBe(TEMPLE_GATE.water);
    // on the ground in the pit beyond the weir
    expect(templeMistSurface(9, -30, ground(9, -30))).toBe(ground(9, -30));
    // on the pool's water at its centre
    expect(
      templeMistSurface(TEMPLE_POOL.lx, TEMPLE_POOL.lz, ground(TEMPLE_POOL.lx, TEMPLE_POOL.lz)),
    ).toBeCloseTo(TEMPLE_POOL.water, 6);
    const puff = templeMistPuff(3, 42);
    const a = templeMistPose(puff, 10, 1, { x: 0, t: 0, z: 0, scale: 0, alpha: 0 });
    const b = templeMistPose(puff, 14, 1, { x: 0, t: 0, z: 0, scale: 0, alpha: 0 });
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.05);
    // reduced motion freezes every puff at its own phase
    const still = templeMistPose(puff, 10, 0, { x: 0, t: 0, z: 0, scale: 0, alpha: 0 });
    expect(templeMistPose(puff, 99, 0, { x: 0, t: 0, z: 0, scale: 0, alpha: 0 })).toEqual(still);
    expect(still.t).toBe(puff.phase);
  });
});

describe('the sprites', () => {
  const K = TEMPLE_SPRITE_KIND;

  it('every tier keeps the door own cues: a halo on every live inlay, the flare, the shaft, the glow in the mouth', () => {
    const inlays = TEMPLE_STAIR_RUNES.length + TEMPLE_RING_RUNES.length + TEMPLE_POOL_RUNES.length;
    for (const tier of TIERS) {
      const sprites = templeSprites(tier, ground);
      expect(
        sprites.filter((s) => s.kind === K.halo),
        tier,
      ).toHaveLength(inlays);
      expect(
        sprites.filter((s) => s.kind === K.flare),
        tier,
      ).toHaveLength(1);
      expect(sprites.filter((s) => s.kind === K.shaft).length, tier).toBeGreaterThanOrEqual(1);
      expect(sprites.filter((s) => s.kind === K.glow).length, tier).toBeGreaterThanOrEqual(1);
      expect(
        sprites.filter((s) => s.kind === K.foam),
        tier,
      ).toHaveLength(TEMPLE_FALLS.length);
    }
  });

  it('the tier thins the motes, the glints and the falls, and never grows past a hundred and fifty quads', () => {
    const count = (tier: TempleEffectsTier, kind: number) =>
      templeSprites(tier, ground).filter((s) => s.kind === kind).length;
    for (const kind of [K.mote, K.glint, K.fall]) {
      for (let i = 1; i < TIERS.length; i++) {
        expect(count(TIERS[i], kind), `${TIERS[i]} kind ${kind}`).toBeGreaterThanOrEqual(
          count(TIERS[i - 1], kind),
        );
      }
      expect(count('ultra', kind)).toBeGreaterThan(count('low', kind));
    }
    expect(templeSprites('ultra', ground).length).toBeLessThanOrEqual(150);
    expect(templeSprites('low', ground).length).toBeLessThan(templeSprites('ultra', ground).length);
    // the wide outer shaft and the pool's glow are the richness low sheds
    expect(count('low', K.shaft)).toBe(1);
    expect(count('ultra', K.shaft)).toBe(2);
  });

  it('halos follow the moonrise, motes rise, threads fall, and reduced motion stands them still', () => {
    const sprites = templeSprites('ultra', ground);
    const pose = { x: 0, y: 0, z: 0, alpha: 0 };
    const mid = rise(M.period * (M.climbStart + M.climbEnd) * 0.5);
    const low = sprites.find((s) => s.kind === K.halo && s.range < 0.2);
    const high = sprites.find((s) => s.kind === K.halo && s.range > 0.9);
    if (!low || !high) throw new Error('no halos');
    expect(templeSpritePose(low, 0, 1, 1, mid, pose).alpha).toBeGreaterThan(0.8);
    expect(templeSpritePose(high, 0, 1, 1, mid, pose).alpha).toBeLessThan(0.3);
    // by day a halo keeps a third of itself: the inlay's own glow carries the read
    expect(templeSpritePose(low, 0, 0, 1, mid, pose).alpha).toBeGreaterThan(0.2);
    const shaft = sprites.find((s) => s.kind === K.shaft);
    if (!shaft) throw new Error('no shaft');
    expect(templeSpritePose(shaft, 0, 1, 1, rise(1), pose).alpha).toBe(0);
    expect(
      templeSpritePose(shaft, 0, 1, 1, { front: 1.08, glow: 1, crest: 1 }, pose).alpha,
    ).toBeCloseTo(1, 6);
    expect(shaft.y).toBeGreaterThan(TEMPLE_GATE.centre + TEMPLE_GATE.outer);
    const mote = sprites.find((s) => s.kind === K.mote);
    if (!mote) throw new Error('no mote');
    const y0 = templeSpritePose(mote, 1, 1, 1, rise(1), pose).y;
    const y1 = templeSpritePose(mote, 2, 1, 1, rise(2), pose).y;
    expect(y1).not.toBe(y0);
    expect(templeSpritePose(mote, 1, 1, 0, rise(1, 0), pose).y).toBe(
      templeSpritePose(mote, 50, 1, 0, rise(50, 0), pose).y,
    );
    const thread = sprites.find((s) => s.kind === K.fall);
    if (!thread) throw new Error('no fall');
    for (const t of [0, 0.3, 0.7, 1.4]) {
      const p = templeSpritePose(thread, t, 0, 1, rise(t), pose);
      expect(p.y).toBeLessThanOrEqual(thread.y);
      expect(p.y).toBeGreaterThanOrEqual(thread.y - thread.range - 1e-9);
    }
  });
});

describe('the film is one unbroken sheet of light', () => {
  it('every layer whirls on a whole number of arms, so its phase closes round the circle', () => {
    expect(TEMPLE_FILM_LAYERS).toHaveLength(3);
    for (let layer = 0; layer < TEMPLE_FILM_LAYERS.length; layer++) {
      const arms = TEMPLE_FILM_LAYERS[layer][3];
      expect(Number.isInteger(arms), `layer ${layer}`).toBe(true);
      expect(arms, `layer ${layer}`).toBeGreaterThanOrEqual(1);
      // either side of the line where the angle wraps, west of the layer's heart
      for (const r of [0.2, 1.3, 3.1, 4.5, 9]) {
        for (const time of [0, 7.3, 191]) {
          const above = templeFilmWhirl(layer, -r, 1e-9, time);
          const below = templeFilmWhirl(layer, -r, -1e-9, time);
          // nothing steps across the line: the thread the shader draws is the same either side
          // (whole arms make the wrap whole turns; 3.2 arms left a 0.4 pi step here)
          expect(Math.sin(above)).toBeCloseTo(Math.sin(below), 6);
          expect(Math.cos(above)).toBeCloseTo(Math.cos(below), 6);
        }
      }
    }
  });

  it('the shader draws each layer with the core numbers and takes the wrapped angle through nothing else', () => {
    const water = painter.moonwaterCommon;
    for (const [depth, spin, grain, arms] of TEMPLE_FILM_LAYERS) {
      expect(water).toContain(
        `tFilmLayer(fp, slide, ${fx4(depth)}, ${fx4(spin)}, ${fx4(grain)}, ${arms.toFixed(1)}, tm)`,
      );
    }
    expect(water).toContain('float band = sin(arms * ang + warp * 5.0 + r * grain * 6.0);');
    expect(water).toContain(`${fx4(TEMPLE_FILM_LOOK.twist)} * log(r + 0.35)`);
    // the wrapped angle's only uses: whole arms of it, and its own sine and cosine
    const layer = water.slice(
      water.indexOf('float tFilmLayer'),
      water.indexOf('vec4 templeMoonwater'),
    );
    expect(layer.match(/\bang\b/g)).toHaveLength(4);
    expect(layer).toContain(
      `float ang = atan(q.y, q.x + 1.0e-5) + spin * tm + ${fx4(TEMPLE_FILM_LOOK.twist)} * log(r + 0.35);`,
    );
    expect(layer).toContain('vec2(cos(ang), sin(ang))');
    // the film's own branch quantises nothing by rows (its layers' noise does floor and
    // fract, on the angle's sine and cosine and on the radius, never on the angle)
    const film = water.slice(water.indexOf('THE FILM'), water.indexOf('THE MIRROR'));
    expect(film).not.toMatch(/\b(floor|fract|mod)\(/);
    // the moon and the threads are the core's look
    expect(film).toContain(
      `(${fx4(TEMPLE_FILM_MOON.rest)} + ${fx4(TEMPLE_FILM_MOON.crest)} * rise.z)`,
    );
    expect(film).toContain(
      `light * ${fx4(TEMPLE_FILM_LOOK.threads)} * (1.0 - ${fx4(TEMPLE_FILM_LOOK.moonVeil)} * disc)`,
    );
    expect(film).toContain(`slide * ${fx4(TEMPLE_FILM_MOON.depth)}`);
    expect(film).toContain(`${fx4(TEMPLE_FILM_MOON.restDrop)} * (1.0 - rise.z)`);
    // a layer's threads fade in away from its heart: the whirl shows no eye
    expect(water).toContain(`smoothstep(0.25, ${fx4(TEMPLE_FILM_LOOK.calm)}, r)`);
  });

  it('the moon stands whole in the ring for every eye on the way up, from the far shore to the dais', () => {
    const S = DROWNED_TEMPLE_STAIR;
    const seen = { x: 0, y: 0 };
    const reach = TEMPLE_GATE.inner - TEMPLE_FILM_MOON.radius;
    // the sill cuts the film's foot: the disc must clear it too
    const foot = TEMPLE_GATE.sill - TEMPLE_GATE.centre + TEMPLE_FILM_MOON.radius;
    expect(foot).toBeGreaterThan(-reach);
    // The shader's own line, a fragment at the point the core names: the eye's ray through it,
    // its slide, and the moon's offset mq, which is zero at the disc's centre.
    const shaderMq = (ex: number, ey: number, ez: number, crest: number) => {
      const at = templeFilmMoonSeen(ex, ey, ez, crest, { x: 0, y: 0 });
      const dx = at.x - ex;
      const dy = TEMPLE_GATE.centre + at.y - ey;
      const dz = -ez;
      const len = Math.hypot(dx, dy, dz);
      const along = Math.max(Math.abs(dz / len), 0.14);
      const m = TEMPLE_FILM_MOON;
      return Math.hypot(
        at.x + (dx / len / along) * m.depth,
        at.y + (dy / len / along) * m.depth + m.restDrop * (1 - crest) - m.lift,
      );
    };
    for (const [ex, ey, ez] of [
      [0, -4.15, -12.95],
      [0, 2.2, -2.83],
      [3, 0, -9],
      [-6, -3.9, -25],
      [2.5, 4.5, -11.3],
      [-1, 6, 9],
    ]) {
      for (const crest of [0, 0.4, 1]) expect(shaderMq(ex, ey, ez, crest)).toBeLessThan(1e-9);
    }
    // On the flight's line, from the foot of the dry treads to the stair's head: a walker's own
    // eye, and the camera that follows a character (behind it and over its head).
    for (let tread = 22; tread >= 0; tread -= 2) {
      const lz = S.daisZ0 - (tread + 0.5) * S.tread;
      const eyeY = S.dais - (tread + 1) * S.riser + 1.7;
      for (const [y, z, who] of [
        [eyeY, lz, 'eye'],
        [eyeY + 2, lz - 9.8, 'camera'],
      ] as const) {
        for (const crest of [0, 1]) {
          templeFilmMoonSeen(0, y, z, crest, seen);
          expect(seen.x).toBeCloseTo(0, 9);
          // the whole disc inside the ring's mouth, clear of the sill
          expect(Math.abs(seen.y), `tread ${tread} ${who} crest ${crest}`).toBeLessThan(reach);
          expect(seen.y, `tread ${tread} ${who} crest ${crest}`).toBeGreaterThan(foot);
        }
      }
    }
    // what lies behind a window sinks in it as the eye goes lower
    expect(templeFilmMoonSeen(0, -4, -12, 0, seen).y).toBeLessThan(
      templeFilmMoonSeen(0, 2, -12, 0, { x: 0, y: 0 }).y,
    );
    // the follow camera on the dais
    expect(Math.abs(templeFilmMoonSeen(0, S.dais + 3.7, -11.3, 1, seen).y)).toBeLessThan(reach);
    // on the dais before the ring, and from the far shore of the mere, at rest
    expect(Math.abs(templeFilmMoonSeen(0, S.dais + 1.7, -1.5, 0, seen).y)).toBeLessThan(reach);
    expect(Math.abs(templeFilmMoonSeen(0, TEMPLE_GATE.water + 1.9, -25, 0, seen).y)).toBeLessThan(
      reach,
    );
    // an eye off the axis sees it slide the same way
    expect(templeFilmMoonSeen(3, 0, -9, 0, seen).x).toBeCloseTo(
      (3 * TEMPLE_FILM_MOON.depth) / (9 + TEMPLE_FILM_MOON.depth),
      9,
    );
    // the crest lifts it by its drop, as that drop is seen from where the eye stands
    const rest = templeFilmMoonSeen(0, -3, -12, 0, { x: 0, y: 0 }).y;
    expect(templeFilmMoonSeen(0, -3, -12, 1, seen).y - rest).toBeCloseTo(
      (TEMPLE_FILM_MOON.restDrop * 12) / (12 + TEMPLE_FILM_MOON.depth),
      9,
    );
    // and it is the far side's moon too: the same from the pool's terrace
    expect(templeFilmMoonSeen(0, 0.8, 9, 0, seen).y).toBeCloseTo(
      templeFilmMoonSeen(0, 0.8, -9, 0, { x: 0, y: 0 }).y,
      9,
    );
    // the shader hangs it by the same two numbers
    const water = painter.moonwaterCommon;
    expect(water).toContain(
      `${fx4(TEMPLE_FILM_MOON.restDrop)} * (1.0 - rise.z) - ${fx4(TEMPLE_FILM_MOON.lift)});`,
    );
  });
});

describe('the camera never loses the character behind the set piece', () => {
  it('every collider row belongs to one fading unit, and the film ghosts with the gate', () => {
    const units = new Map<string, number>();
    for (const row of DROWNED_TEMPLE_ENTRANCE_COLLIDERS) {
      const unit = templeOccluderSet(row.name);
      units.set(unit, (units.get(unit) ?? 0) + 1);
      // a flank's rows stand on its own side of the flight
      if (unit === 'east') expect(row.lx, row.name).toBeLessThan(0);
      if (unit === 'west') expect(row.lx, row.name).toBeGreaterThan(0);
    }
    expect([...units.keys()].sort()).toEqual(['east', 'gate', 'west', 'works']);
    expect(units.get('gate')).toBe(2);
    // the film fills the ring's mouth: a camera looking through the ring at the character meets it
    expect(TEMPLE_FILM_OCCLUDER.hw).toBe(TEMPLE_GATE.inner);
    expect(TEMPLE_FILM_OCCLUDER.top).toBe(TEMPLE_GATE.centre + TEMPLE_GATE.inner);
    expect(TEMPLE_FILM_OCCLUDER.hd).toBeLessThan(0.5);
  });

  it('the painter registers the four units: one box a row, plus the film', () => {
    clearSetPieceOccluders();
    painter.resetCaches();
    buildDrownedTempleEntrance(WORLD_SEED);
    expect(setPieceOccludersInternalsForTest.boxCount()).toBe(
      DROWNED_TEMPLE_ENTRANCE_COLLIDERS.length + 1,
    );
    expect(setPieceOccludersInternalsForTest.setCount()).toBe(4);
    // the painter keeps its handles, one a unit, and a rebuild in the same page
    // retires the last build's sets instead of leaving them registered beside the new
    const first = painter.occluderHandles();
    expect(first).toHaveLength(TEMPLE_GHOST_SETS.length);
    buildDrownedTempleEntrance(WORLD_SEED);
    expect(setPieceOccludersInternalsForTest.setCount()).toBe(4);
    expect(setPieceOccludersInternalsForTest.boxCount()).toBe(
      DROWNED_TEMPLE_ENTRANCE_COLLIDERS.length + 1,
    );
    const second = painter.occluderHandles();
    expect(second).toHaveLength(TEMPLE_GHOST_SETS.length);
    for (let i = 0; i < first.length; i++) expect(second[i]).not.toBe(first[i]);
    // the units the rows name are the units the ghost uniform carries
    expect(
      [
        ...new Set(DROWNED_TEMPLE_ENTRANCE_COLLIDERS.map((row) => templeOccluderSet(row.name))),
      ].sort(),
    ).toEqual([...TEMPLE_GHOST_SETS].sort());
    clearSetPieceOccluders();
  });

  it('what hangs on a unit goes with it while it is the ghost, and returns with it', () => {
    // the plan: all of it while the unit is solid, none at the ghost's alpha
    expect(templeGhostShown(1)).toBe(1);
    expect(templeGhostShown(OCCLUDER_FADE_ALPHA)).toBe(0);
    expect(templeGhostShown(0)).toBe(0);
    expect(templeGhostShown((1 + OCCLUDER_FADE_ALPHA) / 2)).toBeCloseTo(0.5, 9);
    let previous = 0;
    for (let a = OCCLUDER_FADE_ALPHA; a <= 1; a += 0.05) {
      expect(templeGhostShown(a)).toBeGreaterThanOrEqual(previous);
      previous = templeGhostShown(a);
    }
    clearSetPieceOccluders();
    painter.resetCaches();
    const view = buildDrownedTempleEntrance(WORLD_SEED);
    const ghost = painter.uniforms.uTempleGhost.value;
    expect(ghost.toArray()).toEqual([1, 1, 1, 1]);
    const [gate] = painter.occluderHandles();
    // a character on the dais south of the ring; the camera north of it looks back through the ring
    const eye = [DOOR.x, BASE + TEMPLE_GATE.dais + 1.6, DOOR.z - 1.6] as const;
    const through = () =>
      updateSetPieceOccluders(DOOR.x, BASE + TEMPLE_GATE.centre, DOOR.z + 6, ...eye, 1 / 60, true);
    const behind = () =>
      updateSetPieceOccluders(DOOR.x, eye[1] + 3, eye[2] - 9, ...eye, 1 / 60, true);
    behind();
    expect(gate.alpha()).toBe(1);
    expect(ghost.x).toBe(1);
    through();
    expect(gate.alpha()).toBe(OCCLUDER_FADE_ALPHA);
    // the film and the gate's lights are not drawn at all: nothing stands in the empty ring
    expect(ghost.x).toBe(0);
    // only the unit in the way goes
    expect([ghost.y, ghost.z, ghost.w]).toEqual([1, 1, 1]);
    behind();
    expect(gate.alpha()).toBe(1);
    expect(ghost.x).toBe(1);
    // a rebuild while the gate is the ghost starts solid again
    through();
    expect(ghost.x).toBe(0);
    buildDrownedTempleEntrance(WORLD_SEED);
    expect(ghost.toArray()).toEqual([1, 1, 1, 1]);
    // the old handle is retired: it no longer answers the camera
    through();
    expect(gate.alpha()).toBe(1);
    expect(painter.occluderHandles()[0].alpha()).toBe(OCCLUDER_FADE_ALPHA);
    behind();
    // the film: the same uniform, dropped before any of its light is traced
    const water = view.group.getObjectByName('drownedTempleMoonwater') as THREE.Mesh;
    const filmShader = compile(
      water.material as THREE.Material,
      '#include <common>\n#include <begin_vertex>',
      '#include <common>\n#include <map_fragment>',
    );
    expect(filmShader.uniforms.uTempleGhost).toBe(painter.uniforms.uTempleGhost);
    expect(filmShader.fragmentShader).toContain('uniform vec4 uTempleGhost;');
    const film = filmShader.fragmentShader.slice(
      filmShader.fragmentShader.indexOf('THE FILM'),
      filmShader.fragmentShader.indexOf('THE MIRROR'),
    );
    expect(film).toContain('if (uTempleGhost.x <= 0.004) discard;');
    expect(film).toContain('alpha = uTempleGhost.x;');
    expect(film.indexOf('discard')).toBeLessThan(film.indexOf('tFilmLayer('));
    // the pool and the mirror hang on nothing that fades
    expect(filmShader.fragmentShader.match(/uTempleGhost\./g)).toHaveLength(2);
    // the sprites: each carries the unit it hangs on beside its kind, and follows that unit
    const sprites = view.group.getObjectByName('drownedTempleSprites') as THREE.InstancedMesh;
    const spriteShader = compile(
      sprites.material as THREE.Material,
      '#include <common>\n#include <project_vertex>',
      '#include <common>\n#include <map_fragment>',
    );
    expect(spriteShader.uniforms.uTempleGhost).toBe(painter.uniforms.uTempleGhost);
    expect(spriteShader.vertexShader).toContain('uniform vec4 uTempleGhost;');
    expect(spriteShader.vertexShader).toContain('float tK = floor(aK.z + 0.02);');
    expect(spriteShader.vertexShader).toContain('float tHung = floor((aK.z - tK) * 10.0 + 0.5);');
    expect(spriteShader.vertexShader).toContain(
      'if (tHung > 0.5) tA *= tHung < 1.5 ? uTempleGhost.x : (tHung < 2.5 ? uTempleGhost.y : (tHung < 3.5 ? uTempleGhost.z : uTempleGhost.w));',
    );
    clearSetPieceOccluders();
  });

  it('every sprite knows the unit it hangs on, and the painter packs it beside the kind', () => {
    const K = TEMPLE_SPRITE_KIND;
    const unit = (name: (typeof TEMPLE_GHOST_SETS)[number]) => TEMPLE_GHOST_SETS.indexOf(name) + 1;
    const flightEnd =
      DROWNED_TEMPLE_STAIR.daisZ0 - DROWNED_TEMPLE_STAIR.treads * DROWNED_TEMPLE_STAIR.tread;
    for (const tier of TIERS) {
      const list = templeSprites(tier, ground);
      const halos = list.filter((s) => s.kind === K.halo);
      // the lists in order: the stair's treads never ghost, the ring is the gate's, the kerb the works'
      const stair = halos.slice(0, TEMPLE_STAIR_RUNES.length);
      const gate = halos.slice(
        TEMPLE_STAIR_RUNES.length,
        TEMPLE_STAIR_RUNES.length + TEMPLE_RING_RUNES.length,
      );
      const pool = halos.slice(TEMPLE_STAIR_RUNES.length + TEMPLE_RING_RUNES.length);
      expect(
        stair.every((s) => s.hung === 0),
        tier,
      ).toBe(true);
      expect(gate).toHaveLength(TEMPLE_RING_RUNES.length);
      expect(
        gate.every((s) => s.hung === unit('gate')),
        tier,
      ).toBe(true);
      expect(pool).toHaveLength(TEMPLE_POOL_RUNES.length);
      expect(
        pool.every((s) => s.hung === unit('works')),
        tier,
      ).toBe(true);
      for (const s of list) {
        if (s.kind === K.flare || s.kind === K.shaft) expect(s.hung, tier).toBe(unit('gate'));
        // the glow in the gate's mouth goes with the gate; the one over the pool's water stays
        if (s.kind === K.glow) expect(s.hung, tier).toBe(s.z < 5 ? unit('gate') : 0);
        if (s.kind === K.mote) expect(s.hung, tier).toBe(0);
        if (s.kind === K.fall || s.kind === K.foam) expect(s.hung, tier).toBe(unit('works'));
        // a glint off the flight lies on the weir's coping
        if (s.kind === K.glint)
          expect(s.hung, `${tier} ${s.z}`).toBe(s.z < flightEnd ? unit('works') : 0);
        expect(Number.isInteger(s.hung) && s.hung >= 0 && s.hung <= TEMPLE_GHOST_SETS.length).toBe(
          true,
        );
      }
      expect(
        list.some((s) => s.kind === K.glint && s.hung === 0),
        tier,
      ).toBe(true);
      expect(
        list.some((s) => s.kind === K.glint && s.hung === unit('works')),
        tier,
      ).toBe(true);
    }
    clearSetPieceOccluders();
    painter.resetCaches();
    const view = buildDrownedTempleEntrance(WORLD_SEED);
    const mesh = view.group.getObjectByName('drownedTempleSprites') as THREE.InstancedMesh;
    const packed = mesh.geometry.getAttribute('aK');
    expect(packed.count).toBe(mesh.count);
    const hung = new Map<number, number>();
    // the shader's own decoding, every step rounded to the float the GPU holds
    const f = Math.fround;
    const decode = (v: number) => {
      const kind = Math.floor(f(v + f(0.02)));
      return { kind, on: Math.floor(f(f(f(v - kind) * 10) + 0.5)) };
    };
    // every kind with every unit: the packing reads back exactly
    for (let kind = 0; kind <= K.glow; kind++) {
      for (let on = 0; on <= TEMPLE_GHOST_SETS.length; on++) {
        expect(decode(f(kind + on * 0.1)), `kind ${kind} hung ${on}`).toEqual({ kind, on });
      }
    }
    // each instance is its own sprite of the tier the painter resolved
    const tier = resolveUiEffectsProfile({
      presetLabel: GFX.effectsTier,
      effectsQuality: 1,
      reduceMotion: false,
    }).tier;
    const list = templeSprites(tier, ground);
    expect(packed.count).toBe(list.length);
    for (let i = 0; i < packed.count; i++) {
      const got = decode(packed.getZ(i));
      expect(got, `sprite ${i}`).toEqual({ kind: list[i].kind, on: list[i].hung });
      hung.set(got.on, (hung.get(got.on) ?? 0) + 1);
    }
    // some of each: what stays, what is the gate's, what is the works'
    expect(hung.get(0)).toBeGreaterThan(0);
    expect(hung.get(unit('gate'))).toBeGreaterThanOrEqual(TEMPLE_RING_RUNES.length + 3);
    expect(hung.get(unit('works'))).toBeGreaterThanOrEqual(
      TEMPLE_POOL_RUNES.length + TEMPLE_FALLS.length,
    );
    clearSetPieceOccluders();
  });
});

describe('the silver inlays keep their moonrise on every fading unit', () => {
  const inlayUnit = () => {
    // a stand-in for the gate's GLB: one inlaid face under the node the gate unit fades
    const scene = new THREE.Group();
    const gate = new THREE.Group();
    gate.name = 'Entrance_Moongate';
    const inlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ name: 'KitGlow' }),
    );
    inlay.name = 'inlay';
    gate.add(inlay);
    scene.add(gate);
    return scene;
  };
  const shaderOf = (material: THREE.Material) =>
    compile(material, '#include <common>', '#include <common>\n#include <color_fragment>');

  it('a clone of the inlay material is still the inlay: its hook, its key', () => {
    painter.resetCaches();
    const inlay = painter.inlayMaterial();
    const clone = inlay.clone();
    expect(clone).not.toBe(inlay);
    expect(clone.customProgramCacheKey()).toBe(TEMPLE_INLAY_PROGRAM_CACHE_KEY);
    expect(shaderOf(clone).fragmentShader).toBe(shaderOf(inlay).fragmentShader);
    expect(shaderOf(clone).fragmentShader).toContain('templeRune(tOrder, templeRise())');
    // and a clone of a clone (the fade twin the registry may take from it)
    expect(clone.clone().customProgramCacheKey()).toBe(TEMPLE_INLAY_PROGRAM_CACHE_KEY);
  });

  it('the registry own copy under a fading unit draws the moonrise, blended ghost or dithered', () => {
    for (const dither of [false, true]) {
      setDitherFadeEnabledForTest(dither);
      clearSetPieceOccluders();
      painter.resetCaches();
      painter.setSourceForTest(painter.urls.main, inlayUnit());
      try {
        const view = buildDrownedTempleEntrance(WORLD_SEED);
        const mesh = view.group.getObjectByName('inlay') as THREE.Mesh;
        const drawn = mesh.material as THREE.Material;
        // the unit fades its own copy, never the shared material
        expect(drawn, `dither ${dither}`).not.toBe(painter.inlayMaterial());
        expect(drawn.name).toBe('DrownedTempleSilverInlay');
        const key = drawn.customProgramCacheKey();
        expect(key.startsWith(TEMPLE_INLAY_PROGRAM_CACHE_KEY), `dither ${dither}: ${key}`).toBe(
          true,
        );
        expect(key === TEMPLE_INLAY_PROGRAM_CACHE_KEY).toBe(!dither);
        const shader = shaderOf(drawn);
        expect(shader.fragmentShader).toContain('templeRune(tOrder, templeRise())');
        expect(shader.fragmentShader).toContain('diffuseColor.a = opacity;');
        expect(shader.uniforms.uTemple).toBe(painter.uniforms.uTemple);
        // an inlay casts no shadow of its own
        expect(mesh.castShadow).toBe(false);
      } finally {
        painter.setSourceForTest(painter.urls.main, null);
        setDitherFadeEnabledForTest(null);
        clearSetPieceOccluders();
        painter.resetCaches();
      }
    }
  });
});

describe('the program keys', () => {
  it('each key is pinned to the text it names: change a shader, bump its key and its pin here', () => {
    painter.resetCaches();
    const digest = (material: THREE.Material) => {
      const shader = compile(
        material,
        '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
        '#include <common>\n#include <color_fragment>\n#include <map_fragment>',
      );
      return createHash('sha256')
        .update(shader.vertexShader)
        .update(shader.fragmentShader)
        .digest('hex')
        .slice(0, 12);
    };
    // (three keys a program on customProgramCacheKey, not on the text: a text that changed
    // under an unchanged key is one program for two shaders in a page that hot reloads)
    expect({
      [painter.inlayMaterial().customProgramCacheKey()]: digest(painter.inlayMaterial()),
      [painter.moonwaterMaterial().customProgramCacheKey()]: digest(painter.moonwaterMaterial()),
      [painter.mistMaterial().customProgramCacheKey()]: digest(painter.mistMaterial()),
      [painter.spriteMaterial().customProgramCacheKey()]: digest(painter.spriteMaterial()),
    }).toEqual({
      'drowned-temple-silver-inlay-v1': 'a409268aa222',
      'drowned-temple-moonwater-v2': '1bf48208ba0c',
      'drowned-temple-mere-mist-v1': '3002659c30f1',
      'drowned-temple-moonrise-sprites-v3': '9321e2015d71',
    });
  });
});

describe('the effects tier is the static preset', () => {
  it('the mist and the sprites are counted from GFX.effectsTier, whatever the graphics tier is', () => {
    const original = getActiveGfxProfile();
    const counts = new Set<number>();
    try {
      for (const effectsTier of ['low', 'ultra'] as const satisfies readonly GfxTier[]) {
        // the graphics tier held at high: only the effects tier moves
        activateGfxProfile({ ...original, settings: { ...GFX, tier: 'high', effectsTier } });
        clearSetPieceOccluders();
        painter.resetCaches();
        const view = buildDrownedTempleEntrance(WORLD_SEED);
        const mist = view.group.getObjectByName('drownedTempleMist') as THREE.InstancedMesh;
        const sprites = view.group.getObjectByName('drownedTempleSprites') as THREE.InstancedMesh;
        expect(mist.count, effectsTier).toBe(templeMistPuffCount(effectsTier));
        expect(sprites.count, effectsTier).toBe(templeSprites(effectsTier, ground).length);
        counts.add(mist.count);
      }
      // the two tiers really differ, so the pin can tell them apart
      expect(counts.size).toBe(2);
    } finally {
      activateGfxProfile(original);
      clearSetPieceOccluders();
      painter.resetCaches();
    }
  });
});

describe('the painter', () => {
  it('draws three effect meshes on the floor-mark layers and one budgeted light', () => {
    clearSetPieceOccluders();
    painter.resetCaches();
    const view = buildDrownedTempleEntrance(WORLD_SEED);
    expect(view.glowLights).toHaveLength(1);
    expect(view.cullGroups).toHaveLength(1);
    const light = view.glowLights[0];
    expect(light.userData.baseIntensity).toBe(light.intensity);
    expect(light.distance).toBe(TEMPLE_GATE_LIGHT.distance);
    expect(light.position.x).toBeCloseTo(DOOR.x + TEMPLE_GATE_LIGHT.lx, 9);
    expect(light.position.y).toBeCloseTo(BASE + TEMPLE_GATE_LIGHT.y, 9);
    const body = view.group.getObjectByName('drownedTempleEntranceBody');
    expect(body?.position.x).toBe(DOOR.x);
    expect(body?.position.y).toBeCloseTo(BASE, 9);
    expect(body?.position.z).toBe(DOOR.z);
    const water = view.group.getObjectByName('drownedTempleMoonwater') as THREE.Mesh;
    const mist = view.group.getObjectByName('drownedTempleMist') as THREE.InstancedMesh;
    const sprites = view.group.getObjectByName('drownedTempleSprites') as THREE.InstancedMesh;
    expect(water.renderOrder).toBe(floorVfxRenderOrder('ground', 0));
    expect(mist.renderOrder).toBe(floorVfxRenderOrder('ground', 1));
    expect(sprites.renderOrder).toBe(floorVfxRenderOrder('ground', 2));
    // the only lights in the set piece
    let lights = 0;
    view.group.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(1);
    // the effect layer is exactly these three meshes: nothing else carries an effect program
    const keys = new Set<string>();
    view.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m) && /^DrownedTemple/.test(m.name))
        keys.add(m.customProgramCacheKey());
    });
    expect([...keys].sort()).toEqual(
      [
        TEMPLE_MIST_PROGRAM_CACHE_KEY,
        TEMPLE_MOONWATER_PROGRAM_CACHE_KEY,
        TEMPLE_SPRITE_PROGRAM_CACHE_KEY,
      ].sort(),
    );
    expect(mist.count).toBeLessThanOrEqual(templeMistPuffCount('ultra'));
    expect(sprites.count).toBeLessThanOrEqual(150);
    expect(mist.frustumCulled).toBe(false);
    clearSetPieceOccluders();
  });

  it('the moonwater is one mesh with three faces: the pool, the film cut by the sill, the mirror', () => {
    const mesh = painter.moonwater(ground);
    const pos = mesh.geometry.getAttribute('position');
    const kind = mesh.geometry.getAttribute('aTempleK');
    expect(kind.itemSize).toBe(2);
    const seen = new Map<number, { n: number; minY: number; maxY: number }>();
    for (let i = 0; i < pos.count; i++) {
      const k = kind.getX(i);
      const row = seen.get(k) ?? { n: 0, minY: Infinity, maxY: -Infinity };
      row.n++;
      row.minY = Math.min(row.minY, pos.getY(i));
      row.maxY = Math.max(row.maxY, pos.getY(i));
      seen.set(k, row);
    }
    const K = TEMPLE_WATER_KIND;
    expect([...seen.keys()].sort()).toEqual([K.pool, K.film, K.mirror]);
    expect(seen.get(K.pool)?.minY).toBe(Math.fround(TEMPLE_POOL.water));
    expect(seen.get(K.pool)?.maxY).toBe(Math.fround(TEMPLE_POOL.water));
    // the film never reaches under the sill
    expect(seen.get(K.film)?.minY).toBeGreaterThan(TEMPLE_GATE.sill - 0.1);
    expect(seen.get(K.film)?.maxY).toBeCloseTo(TEMPLE_GATE.centre + TEMPLE_GATE.inner + 0.08, 4);
    expect(seen.get(K.mirror)?.minY).toBe(Math.fround(TEMPLE_GATE.water));
    expect(seen.get(K.mirror)?.maxY).toBe(Math.fround(TEMPLE_GATE.water));
    // the mirror's vertices carry how deep the bed lies under them
    let wet = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (kind.getX(i) !== K.mirror) continue;
      n++;
      expect(kind.getY(i)).toBeCloseTo(TEMPLE_GATE.water - ground(pos.getX(i), pos.getZ(i)), 4);
      if (kind.getY(i) > 0.1) wet++;
    }
    expect(wet / n).toBeGreaterThan(0.6);
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.customProgramCacheKey()).toBe(TEMPLE_MOONWATER_PROGRAM_CACHE_KEY);
  });

  it('the shaders run the core formulas: the same constants, spliced once', () => {
    const fx = (v: number) => v.toFixed(4);
    for (const text of [painter.riseGlsl]) {
      expect(text).toContain(fx(M.period));
      expect(text).toContain(fx(M.climbStart));
      expect(text).toContain(fx(M.crestEnd));
      expect(text).toContain(fx(M.fadeEnd));
      expect(text).toContain(fx(M.ember));
      expect(text).toContain(fx(M.stillGlow));
      expect(text).toContain(fx(M.stillCrest));
    }
    const water = painter.moonwaterCommon;
    expect(water).toContain(painter.riseGlsl);
    expect(water).toContain(`T_C = ${fx(TEMPLE_GATE.centre)}`);
    expect(water).toContain(`T_IN = ${fx(TEMPLE_GATE.inner)}`);
    expect(water).toContain(`T_WATER = ${fx(TEMPLE_GATE.water)}`);
    expect(water).toContain(fx(TEMPLE_POOL_MOON.restDepth));
    expect(water).toContain(fx(TEMPLE_POOL_MOON.crestDepth));
    expect(water).toContain(fx(TEMPLE_POOL_MOON.radius));
    expect(water).toContain(`${fx(TEMPLE_POOL_MOON.eta)})`);
    expect(water).toContain(fx(TEMPLE_GATE.sill));
    expect(water).toContain(fx(TEMPLE_POOL.radius));
    // the film's light is the core's
    expect(water).toContain(
      `return ${fx(templeFilmLight(0))} + ${fx(templeFilmLight(1) - templeFilmLight(0))} * crest`,
    );
    expect(painter.mistVertex).toContain('templeRise()');
    expect(painter.spriteVertex).toContain('templeRune(aK.w, tRise)');
    expect(painter.mistFieldCount).toBe(TEMPLE_MIST_FIELDS.length);
  });

  it('the materials are shared, keyed, and the inlays carry their order in the colour alpha', () => {
    painter.resetCaches();
    const inlay = painter.inlayMaterial();
    expect(painter.inlayMaterial()).toBe(inlay);
    expect(painter.kitMaterial('KitGlow')).toBe(inlay);
    expect(inlay.vertexColors).toBe(true);
    expect(inlay.customProgramCacheKey()).toBe(TEMPLE_INLAY_PROGRAM_CACHE_KEY);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    inlay.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain('tOrder = vColor.a');
    expect(shader.fragmentShader).toContain('templeRune(tOrder, templeRise())');
    expect(shader.uniforms.uTemple).toBe(painter.uniforms.uTemple);
    for (const [material, key] of [
      [painter.moonwaterMaterial(), TEMPLE_MOONWATER_PROGRAM_CACHE_KEY],
      [painter.mistMaterial(), TEMPLE_MIST_PROGRAM_CACHE_KEY],
      [painter.spriteMaterial(), TEMPLE_SPRITE_PROGRAM_CACHE_KEY],
    ] as const) {
      expect(material.customProgramCacheKey()).toBe(key);
    }
    const sprites = painter.spriteMaterial();
    expect(sprites.blending).toBe(THREE.AdditiveBlending);
    expect(sprites.depthWrite).toBe(false);
    expect(sprites.fog).toBe(false);
    expect(painter.mistMaterial().depthWrite).toBe(false);
    // the lit slots: leaf double sided, wet glossy, stone rough
    expect((painter.kitMaterial('KitLeaf') as THREE.Material).side).toBe(THREE.DoubleSide);
    const wet = painter.kitMaterial('KitWet') as THREE.MeshStandardMaterial;
    const stone = painter.kitMaterial('KitStone') as THREE.MeshStandardMaterial;
    if ('roughness' in wet && 'roughness' in stone)
      expect(wet.roughness).toBeLessThan(stone.roughness);
  });
});
