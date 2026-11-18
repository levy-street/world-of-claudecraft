import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { decorPropPlacements } from '../src/editor/world_prop_placements';
import { PROP_NATURAL_SIZE } from '../src/render/prop_natural_size.generated';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { DECOR_FOOTPRINTS } from '../src/sim/content/decor_footprints';
import { SPIRE_RELOCATIONS } from '../src/sim/content/quartered_spires';
import { PROPS } from '../src/sim/data';
import { buildDecorPropColliders } from '../src/sim/decor_prop_colliders';
import { DECOR_SEAT_MAX_TILT, decorSeat, seatedOnFootprint } from '../src/sim/decor_seat';
import { emptyZoneProps } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// src/sim/decor_seat.ts: a `seat: 'footprint'` decor row sits on the ground under its
// whole footprint, not on the height at its centre. The isle's shattered ground left
// rows floating up to 6 yd on their downhill side when they were seated at the centre.

const flat = (): number => 3;
const plane =
  (gx: number, gz: number) =>
  (x: number, z: number): number =>
    gx * x + gz * z;

describe('decorSeat', () => {
  it('leaves a row alone unless it opts in, floats, or has no known footprint', () => {
    const slope = plane(0.5, 0);
    expect(decorSeat({ key: 'cinderColumnsTall', x: 0, z: 0 }, slope)).toEqual({
      sink: 0,
      pitch: 0,
      roll: 0,
    });
    expect(
      decorSeat({ key: 'cinderColumnsTall', x: 0, z: 0, seat: 'footprint', float: 0.5 }, slope),
    ).toEqual({ sink: 0, pitch: 0, roll: 0 });
    expect(decorSeat({ key: 'notAProp', x: 0, z: 0, seat: 'footprint' }, slope)).toEqual({
      sink: 0,
      pitch: 0,
      roll: 0,
    });
  });

  it('is a no-op on flat ground', () => {
    expect(decorSeat({ key: 'heaveStrataLarge', x: 5, z: 9, seat: 'footprint' }, flat)).toEqual({
      sink: 0,
      pitch: 0,
      roll: 0,
    });
  });

  it('keeps a tall piece upright and sinks it to the low side of its footprint', () => {
    // cinderColumnsTall: 11.34 wide, 12 tall; a 0.3 slope along world x
    const seat = decorSeat(
      { key: 'cinderColumnsTall', x: 0, z: 0, seat: 'footprint' },
      plane(0.3, 0),
    );
    expect(seat.pitch).toBe(0);
    expect(seat.roll).toBe(0);
    // the outer sample ring reaches 0.95 of the half width, on the downhill side
    expect(seat.sink).toBeCloseTo(0.3 * (11.3423 / 2) * 0.95, 2);
  });

  it('scales the footprint by the row scale and turns it by the row yaw', () => {
    const slope = plane(0, 0.2);
    const unscaled = decorSeat({ key: 'gyreStormStone', x: 0, z: 0, seat: 'footprint' }, slope);
    const doubled = decorSeat(
      { key: 'gyreStormStone', x: 0, z: 0, scale: 2, seat: 'footprint' },
      slope,
    );
    expect(doubled.sink).toBeCloseTo(unscaled.sink * 2, 2);
    // a quarter turn swaps which half extent lies along the slope (3.013 wide, 2.7786 deep)
    const turned = decorSeat(
      { key: 'gyreStormStone', x: 0, z: 0, rot: Math.PI / 2, seat: 'footprint' },
      slope,
    );
    expect(unscaled.sink).toBeCloseTo(0.2 * (2.7786 / 2) * 0.95, 2);
    expect(turned.sink).toBeCloseTo(0.2 * (3.013 / 2) * 0.95, 2);
  });

  it('leans a low, flat piece with gentle ground, so it sits flush instead of sinking', () => {
    // frostFloeBroad: 9.07 x 9.29 wide, 1.4 tall; a 0.1 slope along world x
    const seat = decorSeat({ key: 'frostFloeBroad', x: 0, z: 0, seat: 'footprint' }, plane(0.1, 0));
    expect(seat.roll).toBeCloseTo(Math.atan(0.1), 3);
    expect(seat.pitch).toBe(0);
    expect(seat.sink).toBeCloseTo(0, 3);
  });

  it('keeps a standable piece level, so its flat collider top matches the art', () => {
    const row = { key: 'frostFloeBroad', x: 0, z: 0, standableTop: 1.2, r: 4 } as const;
    const seat = decorSeat({ ...row, seat: 'footprint' }, plane(0.1, 0));
    expect(seat.roll).toBe(0);
    expect(seat.pitch).toBe(0);
    expect(seat.sink).toBeCloseTo(0.1 * (9.0731 / 2) * 0.95, 2);
  });

  it('caps the lean on steep ground and sinks the rest', () => {
    const seat = decorSeat({ key: 'frostFloeBroad', x: 0, z: 0, seat: 'footprint' }, plane(0, 1));
    expect(Math.abs(seat.pitch)).toBe(Math.round(DECOR_SEAT_MAX_TILT * 1000) / 1000);
    expect(seat.sink).toBeGreaterThan(0.5);
  });

  it('seatedOnFootprint opts every row in and changes nothing else', () => {
    const rows = [{ key: 'rockTallA', x: 1, z: 2, r: 0.9, h: 3.4 }];
    expect(seatedOnFootprint(rows)).toEqual([{ ...rows[0], seat: 'footprint' }]);
  });
});

describe('DECOR_FOOTPRINTS', () => {
  it('matches the GLB-measured model sizes the renderer draws', () => {
    for (const [key, f] of Object.entries(DECOR_FOOTPRINTS)) {
      const measured = PROP_NATURAL_SIZE[key];
      expect(measured, key).toBeDefined();
      expect(f.x, `${key}.x`).toBeCloseTo(measured.x, 4);
      expect(f.y, `${key}.y`).toBeCloseTo(measured.y, 4);
      expect(f.z, `${key}.z`).toBeCloseTo(measured.z, 4);
    }
  });
});

describe('the Quartered Isle decor sits on its footprint', () => {
  const onIsle = (d: { x: number; z: number }): boolean =>
    d.x >= -260 && d.x <= 260 && d.z >= 1900 && d.z <= 2430;
  const isle = (PROPS.decorProps ?? []).filter((d) => onIsle(d) && d.float === undefined);
  const heightAt = (x: number, z: number): number => terrainHeight(x, z, WORLD_SEED);

  it('every isle row opts in and has a measured footprint', () => {
    expect(isle.length).toBeGreaterThan(60);
    for (const d of isle) {
      expect(d.seat, `${d.key} at (${d.x}, ${d.z})`).toBe('footprint');
      expect(Object.hasOwn(DECOR_FOOTPRINTS, d.key), d.key).toBe(true);
    }
  });

  it('leaves no row hanging over the ground under its footprint, as the renderer poses it', () => {
    // Independent of the seat's own sampling and sign convention: the footprint rings are
    // posed with THREE's Euler(pitch, rot, roll, 'YXZ'), exactly as src/render/props.ts
    // sets a decor group's rotation, at the base Y it draws (ground - 0.05 - sink).
    for (const d of isle) {
      const seat = decorSeat(d, heightAt);
      const f = DECOR_FOOTPRINTS[d.key];
      const s = d.scale ?? 1;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(seat.pitch, d.rot ?? 0, seat.roll, 'YXZ'),
      );
      const baseY = heightAt(d.x, d.z) - 0.05 - seat.sink;
      const p = new THREE.Vector3();
      let worst = -Infinity;
      for (const at of [0.95, 0.8, 0.6, 0.4]) {
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          p.set(Math.cos(a) * (f.x / 2) * s * at, 0, Math.sin(a) * (f.z / 2) * s * at);
          p.applyQuaternion(q);
          worst = Math.max(worst, baseY + p.y - heightAt(d.x + p.x, d.z + p.z));
        }
      }
      expect(worst, `${d.key} at (${d.x}, ${d.z})`).toBeLessThan(0.15);
    }
  });

  it('carries the seat into the editor placements a map is forked from', () => {
    const placements = decorPropPlacements({ ...emptyZoneProps(), decorProps: isle });
    expect(placements).toHaveLength(isle.length);
    for (const [i, d] of isle.entries()) {
      const seat = decorSeat(d, heightAt);
      const p = placements[i];
      expect(p.y, `${d.key} at (${d.x}, ${d.z})`).toBeCloseTo(-seat.sink, 6);
      // the placement's XYZ Euler turns the model exactly as the game's YXZ lean does
      const want = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(seat.pitch, d.rot ?? 0, seat.roll, 'YXZ'),
      );
      const yaw = PROP_ASSET_DEFS[d.key].yaw ?? 0;
      want.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      const got = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(p.rotX ?? 0, p.rotY, p.rotZ ?? 0, 'XYZ'),
      );
      expect(Math.abs(got.dot(want)), `${d.key} at (${d.x}, ${d.z})`).toBeCloseTo(1, 6);
    }
  });

  it('moves the slab the bearing search laid across a heave onto flat ground', () => {
    for (const m of SPIRE_RELOCATIONS) {
      const here = (p: { x: number; z: number }) =>
        isle.filter((d) => d.key === m.key && d.x === p.x && d.z === p.z);
      expect(here(m.from), `${m.key} still at (${m.from.x}, ${m.from.z})`).toHaveLength(0);
      const [moved] = here(m.to);
      expect(moved, `${m.key} at (${m.to.x}, ${m.to.z})`).toBeDefined();
      // it sits on its ground instead of sinking from sight: its centre sinks under 60% of its height
      const seat = decorSeat(moved, heightAt);
      expect(seat.sink).toBeLessThan(DECOR_FOOTPRINTS[m.key].y * (moved.scale ?? 1) * 0.6);
    }
  });

  it('sinks a seated row collider and standable top with its art', () => {
    const standable = isle.filter((d) => d.standableTop !== undefined);
    expect(standable.length).toBeGreaterThan(0);
    for (const d of standable) {
      const [c] = buildDecorPropColliders(WORLD_SEED, [d]);
      const sink = decorSeat(d, heightAt).sink;
      const top = groundHeight(d.x, d.z, WORLD_SEED) - sink + (d.standableTop ?? 0);
      expect(c.moveTopY, `${d.key} at (${d.x}, ${d.z})`).toBeCloseTo(top, 6);
      expect(c.cameraTopY).toBeCloseTo(groundHeight(d.x, d.z, WORLD_SEED) - sink + (d.h ?? 4), 6);
    }
  });
});
