import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  beginChunkGeometry,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from '../src/render/terrain_chunk_build';
import { FARSHORE_SALVAGE_PLACEMENTS } from '../src/sim/content/farshore_shipwreck_layout';
import { applyFarshoreShipwreckShore } from '../src/sim/farshore_shipwreck_shore';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import { groundHeight, terrainHeight, terrainHeightSansEdits } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('shipwreck anchor shoreline', () => {
  it('retains exactly one original hull pad immediately before the remaining salvage pads', () => {
    const pads = collectCalmAnchorPads();
    const hulls = pads.filter((pad) => pad.x === 302.7 && pad.z === 117.75);
    expect(hulls).toEqual([
      {
        category: 'groundObject',
        x: 302.7,
        z: 117.75,
        rIn: 3.5,
        baseROut: 9,
        optional: true,
      },
    ]);
    expect(pads[pads.indexOf(hulls[0]) + 1]).toMatchObject({
      category: 'groundObject',
      x: 326.2,
      z: 140.6,
    });
  });

  it('keeps the beach below the approved anchor footprint without moving the asset', () => {
    const anchor = FARSHORE_SALVAGE_PLACEMENTS.find((p) => p.key === 'wq_fallen_anchor');
    expect(anchor).toEqual({
      key: 'wq_fallen_anchor',
      x: 320.6,
      y: -4.25,
      z: 130.05,
      rot: 345,
      scale: 2,
    });
    // The original ground at the center was -2.517366319896134, above even
    // the model's top (-3.157). Sample the footprint, not just its center.
    for (const seed of [WORLD_SEED, 1]) {
      for (let dx = -2; dx <= 2; dx += 0.5)
        for (let dz = -2; dz <= 2; dz += 0.5) {
          if (Math.hypot(dx, dz) > 2.5) continue;
          const x = 320.6 + dx,
            z = 130.05 + dz;
          expect(terrainHeight(x, z, seed), `${seed}: ${x},${z}`).toBeLessThanOrEqual(-4.25);
          expect(groundHeight(x, z, seed)).toBe(terrainHeight(x, z, seed));
          expect(terrainHeightSansEdits(x, z, seed)).toBe(terrainHeight(x, z, seed));
        }
    }
  });

  it.each([1.2, 3])('keeps the rendered %s yd terrain lattice below the anchor', (step) => {
    const state = beginChunkGeometry(300, 120, 60, step, WORLD_SEED, false, 2.6, false);
    for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
    for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(state.indices, 1));
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const ray = new THREE.Raycaster();
    // Rounded-out bounds of the actual GLB at the saved yaw and scale.
    for (let x = 319.48; x <= 321.72; x += 0.28) {
      for (let z = 128.85; z <= 131.25; z += 0.3) {
        ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit, `${x},${z}`).toBeDefined();
        expect(hit.point.y, `${x},${z}`).toBeLessThanOrEqual(-4.25);
      }
    }
    geometry.dispose();
    material.dispose();
  });

  it('never raises seabed and joins the untouched beach continuously', () => {
    expect(applyFarshoreShipwreckShore(320.6, 130.05, -6)).toBe(-6);
    for (const radius of [3, 10]) {
      const inside = applyFarshoreShipwreckShore(320.6 + radius - 0.0001, 130.05, 2);
      const outside = applyFarshoreShipwreckShore(320.6 + radius + 0.0001, 130.05, 2);
      expect(Math.abs(inside - outside)).toBeLessThan(0.00001);
    }
    expect(applyFarshoreShipwreckShore(331, 130.05, 2)).toBe(2);
  });

  it('leaves the other placements and outer shoreline at their existing heights', () => {
    const pins = [
      [306, 123.05, -4.986907205810601],
      [326.2, 140.6, -4.437485975669644],
      [322.1, 108.2, 0.34865349973115944],
      [342.2, 126.7, -4.199527675481971],
      [270, 104, -5.331410975407409],
      // A late pad must not alter the divergence probes that size other
      // terrain skirts. Applying it inside those probes shifted this bank.
      [331, 135, -1.349037560755543],
      [333, 137, -1.6659947343373664],
      [335, 143, -4.244835516469797],
    ];
    for (const [x, z, h] of pins) expect(terrainHeight(x, z, WORLD_SEED)).toBe(h);
  });

  it('keeps the blended bank walkable', () => {
    for (let dx = -10; dx <= 10; dx += 0.5) {
      for (let dz = -10; dz <= 10; dz += 0.5) {
        if (dx * dx + dz * dz > 100) continue;
        const x = 320.6 + dx,
          z = 130.05 + dz;
        const sx =
          (terrainHeight(x + 0.25, z, WORLD_SEED) - terrainHeight(x - 0.25, z, WORLD_SEED)) / 0.5;
        const sz =
          (terrainHeight(x, z + 0.25, WORLD_SEED) - terrainHeight(x, z - 0.25, WORLD_SEED)) / 0.5;
        expect(Math.hypot(sx, sz), `${x},${z}`).toBeLessThan(1.5);
      }
    }
  });
});
