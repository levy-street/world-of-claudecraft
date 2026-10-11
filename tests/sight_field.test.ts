// The line-of-sight field's floor surface (src/render/trash_engine_fx/
// sight_field_core.ts + sight_field.ts), shared by the trash engine's G6 nova
// (the Gravecaller Adept's Gravespark Volley) and Cantor Ilvane's Dirge. The
// playtest bug: the field was a fan with a handful of rings, its vertices on
// the floor every 6 yd, so on a ramp, a stair or a terrace lip it ran under
// the stone in bands and z-fought it. These pins hold the fix: a dense grid
// (a station under a yard apart) draped on the REAL floor height at every
// vertex, nearest first under a per-frame budget, a reach that only rewrites
// `aReach`, the shaders' depth pull and steep-triangle cut, and the real
// cloister stair draped vertex for vertex.

import { describe, expect, it } from 'vitest';
import {
  SIGHT_FIELD_VERT,
  SIGHT_STEEP_GLSL,
  SightFieldSurface,
} from '../src/render/trash_engine_fx';
import {
  SIGHT_COLUMNS_PER_SECTOR,
  SIGHT_DEPTH_PULL,
  SIGHT_MAX_STATIONS,
  SIGHT_MIN_NORMAL_Y,
  SIGHT_STATION_YARDS,
  sectorReach,
  sightColumnAngle,
  sightColumnCount,
  sightColumnOf,
  sightDrapeSample,
  sightDrapeSamples,
  sightIndex,
  sightStations,
  sightVertex,
  sightVertexCount,
} from '../src/render/trash_engine_fx/sight_field_core';
import { NOVA_RAYS } from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { ILVANE_TUNING } from '../src/sim/encounters/hollow_crypt/ilvane_ids';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('sight field core: a dense polar grid', () => {
  it('keeps a station under a yard apart on every shipped sight field', () => {
    const adept = MOBS.crypt_gravecaller_adept.trashKit?.nova?.radius ?? 0;
    expect(adept).toBe(30);
    for (const radius of [adept, ILVANE_TUNING.dirgeRadius]) {
      const k = sightStations(radius);
      expect(k).toBeLessThanOrEqual(SIGHT_MAX_STATIONS);
      expect(radius / k).toBeLessThanOrEqual(SIGHT_STATION_YARDS + 1e-9);
    }
    // The old fan's spacing was radius / 5 (6 yd on the adept's volley).
    expect(adept / sightStations(adept)).toBeLessThan(adept / 5 / 7);
  });

  it('lays two quads per station band per sector over in-range vertices', () => {
    const rays = 8;
    const k = 5;
    const idx = sightIndex(rays, k);
    expect(idx.length).toBe(rays * k * (SIGHT_COLUMNS_PER_SECTOR - 1) * 6);
    const count = sightVertexCount(rays, k);
    expect(Math.max(...idx)).toBe(count - 1);
    expect(Math.min(...idx)).toBe(0);
    expect(sightVertex(rays - 1, k, SIGHT_COLUMNS_PER_SECTOR - 1, k)).toBe(count - 1);
  });

  it('shares each ray column between its two sectors and puts the middle between them', () => {
    const rays = NOVA_RAYS;
    expect(sightColumnCount(rays)).toBe(rays * 2);
    expect(sightColumnOf(3, 0, rays)).toBe(6);
    expect(sightColumnOf(3, 1, rays)).toBe(7);
    expect(sightColumnOf(3, 2, rays)).toBe(8);
    expect(sightColumnOf(rays - 1, 2, rays)).toBe(0);
    // The ray columns sit on the sim's ray angles (i / rays of a turn).
    expect(sightColumnAngle(6, rays)).toBeCloseTo((3 / rays) * Math.PI * 2, 12);
    expect(sightColumnAngle(7, rays)).toBeCloseTo((3.5 / rays) * Math.PI * 2, 12);
  });

  it('drapes nearest the caster first, every column of a station before the next', () => {
    const rays = 4;
    const cols = sightColumnCount(rays);
    expect(sightDrapeSample(0, rays)).toEqual({ k: 0, q: 0 });
    expect(sightDrapeSample(cols - 1, rays)).toEqual({ k: 0, q: cols - 1 });
    expect(sightDrapeSample(cols, rays)).toEqual({ k: 1, q: 0 });
    expect(sightDrapeSamples(rays, 6)).toBe(cols * 7);
  });

  it('lights a sector out to the farther of its rays (the shadow only where both are blocked)', () => {
    const reach = [30, 12, 30, 9];
    expect(sectorReach(reach, 0)).toBe(30);
    expect(sectorReach(reach, 1)).toBe(30);
    expect(sectorReach(reach, 3)).toBe(30);
    expect(sectorReach([5, 7, 9], 1)).toBe(9);
  });

  it('pulls toward the camera and cuts steep triangles in its shaders', () => {
    expect(SIGHT_DEPTH_PULL).toBeGreaterThan(0.1);
    expect(SIGHT_DEPTH_PULL).toBeLessThan(0.5);
    // Camera-relative (the CPU's double-precision modelView), never a world
    // point times the view matrix on the GPU: a hundred thousand yards out a
    // float32 world point rounds by more than the lift (the playtest flicker).
    expect(SIGHT_FIELD_VERT).toContain('modelViewMatrix * vec4(position, 1.0)');
    expect(SIGHT_FIELD_VERT).not.toContain('projectionMatrix * viewMatrix');
    expect(SIGHT_FIELD_VERT).toContain(SIGHT_DEPTH_PULL.toFixed(3));
    // The walkable paths' steepest slope (0.75 yd a yard) stays drawn.
    expect(1 / Math.hypot(1, 0.75)).toBeGreaterThan(SIGHT_MIN_NORMAL_Y);
    expect(SIGHT_STEEP_GLSL).toContain('dFdx');
    // Derivatives of the caster-local point, never the world one (instance
    // bands sit tens of thousands of yards out, where float derivatives are
    // noise and the cut fired at random: holes in the field).
    expect(SIGHT_FIELD_VERT).toContain('vLocal = position');
    expect(SIGHT_STEEP_GLSL).toContain(SIGHT_MIN_NORMAL_Y.toFixed(3));
  });
});

describe('sight field surface: draped on the real floor', () => {
  it('begins flat and wholly lit, then drapes every vertex onto the floor within its budget', () => {
    const k = 12;
    const s = new SightFieldSurface(NOVA_RAYS, k);
    const ground = (x: number, z: number) => 0.3 * x - 0.1 * z;
    s.begin(10, 1, 20, 9, 0.06);
    const pos = s.geometry.getAttribute('position');
    const r = s.geometry.getAttribute('aR');
    const reach = s.geometry.getAttribute('aReach');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(0.06, 6);
      expect(reach.getX(i)).toBe(9);
    }
    const samples = sightDrapeSamples(NOVA_RAYS, k);
    let frames = 0;
    let spent = 0;
    while (!s.drapedAll) {
      const used = s.drapeSome(ground, 500);
      // Never past the budget an owner hands it (shared across its fields).
      expect(used).toBeLessThanOrEqual(500);
      spent += used;
      frames++;
    }
    expect(frames).toBe(Math.ceil(samples / 500));
    expect(spent).toBe(samples);
    // Done: it spends nothing.
    expect(s.drapeSome(ground, 500)).toBe(0);
    for (let i = 0; i < pos.count; i++) {
      const wx = 10 + pos.getX(i);
      const wz = 20 + pos.getZ(i);
      expect(pos.getY(i)).toBeCloseTo(ground(wx, wz) - 1 + 0.06, 4);
      expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeLessThanOrEqual(r.getX(i) + 1e-4);
    }
    // Handed nothing (the owner's frame budget is spent): it spends nothing.
    s.begin(10, 1, 20, 9, 0.06);
    expect(s.drapeSome(ground, 0)).toBe(0);
    expect(s.drapedAll).toBe(false);
  });

  it('rewrites only the two sectors that share a ray when its reach carves in', () => {
    const k = 6;
    const s = new SightFieldSurface(NOVA_RAYS, k);
    s.begin(0, 0, 0, 20, 0.06);
    const rays = new Float32Array(NOVA_RAYS).fill(20);
    rays[5] = 4;
    s.setRay(rays, 5);
    const reach = s.geometry.getAttribute('aReach');
    const per = (k + 1) * SIGHT_COLUMNS_PER_SECTOR;
    // Sectors 4 and 5 share ray 5, but each keeps the farther of its two rays.
    for (let v = 4 * per; v < 6 * per; v++) expect(reach.getX(v)).toBe(20);
    rays[4] = 3;
    rays[6] = 2;
    s.setRay(rays, 4);
    s.setRay(rays, 6);
    for (let v = 4 * per; v < 5 * per; v++) expect(reach.getX(v)).toBe(4);
    for (let v = 5 * per; v < 6 * per; v++) expect(reach.getX(v)).toBe(4);
    for (let v = 7 * per; v < 8 * per; v++) expect(reach.getX(v)).toBe(20);
  });

  it('a wave copies a bar field whole: its drape, reach and spot', () => {
    const a = new SightFieldSurface(NOVA_RAYS, 8);
    const b = new SightFieldSurface(NOVA_RAYS, 8);
    a.begin(3, 2, 1, 12, 0.06);
    while (!a.drapedAll) a.drapeSome((x) => x * 0.1);
    const rays = new Float32Array(NOVA_RAYS).fill(12);
    rays[0] = 2;
    a.setRay(rays, 0);
    b.copyFrom(a);
    expect(b.drapedAll).toBe(true);
    expect(Array.from(b.geometry.getAttribute('position').array)).toEqual(
      Array.from(a.geometry.getAttribute('position').array),
    );
    expect(Array.from(b.geometry.getAttribute('aReach').array)).toEqual(
      Array.from(a.geometry.getAttribute('aReach').array),
    );
  });

  it('follows the Chapel Stair down into the cloister vertex for vertex (the adepts home)', () => {
    // The c1 adept at the stair foot (instance-local 0, -54): its volley's
    // field reaches up the Chapel Stair and over the cloister's lips.
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const ground = (x: number, z: number) => groundHeight(x, z, WORLD_SEED);
    const x = o.x;
    const z = o.z - 54;
    const y = ground(x, z);
    const radius = 30;
    const s = new SightFieldSurface(NOVA_RAYS, sightStations(radius));
    s.begin(x, y, z, radius, 0.06);
    while (!s.drapedAll) s.drapeSome(ground);
    const pos = s.geometry.getAttribute('position');
    let span = 0;
    for (let i = 0; i < pos.count; i++) {
      const wx = x + pos.getX(i);
      const wz = z + pos.getZ(i);
      const floor = ground(wx, wz) - y;
      // Every vertex a hand over the real floor: never under it, never floating.
      expect(pos.getY(i) - floor).toBeCloseTo(0.06, 5);
      span = Math.max(span, Math.abs(floor));
    }
    // The field really does cross uneven ground there (the stair climbs).
    expect(span).toBeGreaterThan(3);
  });
});
