// Two playtest fixes on the trash engine's visuals (src/render/trash_engine_fx):
//
//   - The meltwater quench pools (engine_quench.ts) flickered against the
//     floor of the Sledge Road. A dungeon slot sits about 100,000 yd out, and
//     the pools stored that world position in float32 vertices composed with
//     the view matrix on the GPU: a centimetre of jitter on a 6 cm lift. They
//     now lie in the slot's own frame round an anchor the mesh is placed at,
//     each vertex draped on the real floor, pulled toward the camera in the
//     vertex shader, on the floor ladder's ground band.
//   - The Ogre Sledge-Hauler's Ice Slab (ice_slab_geometry.ts) reads as solid
//     cover: the hauler's iron banding round the block, within its footprint.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLOOR_VFX_LAYER_BASE, FLOOR_VFX_LAYER_SPAN } from '../src/render/floor_vfx_layer';
import { EngineQuench, QUENCH_DEPTH_PULL } from '../src/render/trash_engine_fx/engine_quench';
import {
  buildIceSlabGeometry,
  buildIceSlabShellGeometry,
  SLAB_BAND_BITE,
  SLAB_BAND_PROUD,
} from '../src/render/trash_engine_fx/ice_slab_geometry';
import { quenchPoolsAt, wallBox } from '../src/render/trash_engine_fx/trash_engine_fx_core';
import type { TrashEngineHost } from '../src/render/trash_engine_fx/trash_engine_host';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { SANCTUM_ICE_SLAB } from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { IWorld } from '../src/world_api';

const SANCTUM = 'gravewyrm_sanctum';

/** A floor with a gentle slope, so the drape is exercised. */
const floor = (x: number, z: number): number => 46 + x * 0.01 - z * 0.02;

function quenchHost(slot: number): { host: TrashEngineHost; root: THREE.Group } {
  const o = instanceOrigin(DUNGEONS[SANCTUM].index, slot);
  const root = new THREE.Group();
  const world = { player: { pos: { x: o.x, y: 0, z: o.z + 42 } } } as unknown as IWorld;
  const host = {
    root,
    world,
    density: 1,
    uTime: { value: 0 },
    groundY: floor,
    rand: () => 0.5,
    puff: () => {},
  } as unknown as TrashEngineHost;
  return { host, root };
}

describe('the quench pools: no z-fight with the floor', () => {
  it('lie in the slot frame round an anchor, every vertex a hand over the real floor', () => {
    const { host, root } = quenchHost(2);
    const q = new EngineQuench(host);
    q.update(1 / 30);
    const mesh = root.getObjectByName('trashEngineQuenchPools') as THREE.Mesh;
    expect(mesh.visible).toBe(true);
    const pools = quenchPoolsAt(SANCTUM, 2);
    // The mesh carries the slot's far-out position; the vertices stay small.
    expect(mesh.position.x).toBeCloseTo(pools[0].x, 6);
    expect(mesh.position.z).toBeCloseTo(pools[0].z, 6);
    expect(Math.abs(mesh.position.x)).toBeGreaterThan(1000);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const drawn = mesh.geometry.drawRange.count;
    expect(drawn).toBeGreaterThan(0);
    const index = mesh.geometry.getIndex() as THREE.BufferAttribute;
    let maxAbs = 0;
    for (let i = 0; i < drawn; i++) {
      const v = index.getX(i);
      const wx = pos.getX(v) + mesh.position.x;
      const wz = pos.getZ(v) + mesh.position.z;
      const wy = pos.getY(v) + mesh.position.y;
      maxAbs = Math.max(maxAbs, Math.abs(pos.getX(v)), Math.abs(pos.getZ(v)));
      // Draped: each vertex sits the lift over the floor under IT.
      expect(wy - floor(wx, wz)).toBeGreaterThan(0.03);
      expect(wy - floor(wx, wz)).toBeLessThan(0.1);
    }
    expect(maxAbs).toBeLessThan(400);
    q.dispose();
  });

  it('pulls toward the eye in the vertex shader through the CPU-composed modelViewMatrix', () => {
    const { host, root } = quenchHost(0);
    const q = new EngineQuench(host);
    const mesh = root.getObjectByName('trashEngineQuenchPools') as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.vertexShader).toContain('modelViewMatrix');
    expect(mat.vertexShader).not.toContain('viewMatrix * w');
    expect(mat.vertexShader).toContain(QUENCH_DEPTH_PULL.toFixed(3));
    // A real margin over the 6 cm lift, small enough that a body standing in
    // the pool only wades a few centimetres deep.
    expect(QUENCH_DEPTH_PULL).toBeGreaterThanOrEqual(0.05);
    expect(QUENCH_DEPTH_PULL).toBeLessThanOrEqual(0.12);
    // On the floor ladder's ground band (every telegraph paints over it).
    expect(mesh.renderOrder).toBeGreaterThanOrEqual(FLOOR_VFX_LAYER_BASE.ground);
    expect(mesh.renderOrder).toBeLessThan(
      FLOOR_VFX_LAYER_BASE.ground + FLOOR_VFX_LAYER_SPAN.ground,
    );
    expect(mat.depthWrite).toBe(false);
    q.dispose();
  });
});

describe('the Ice Slab reads as solid cover', () => {
  it('wears the hauler iron banding, seated across the ice faces, inside its footprint', () => {
    const box = wallBox(SANCTUM_ICE_SLAB, 1);
    if (!box) throw new Error('no slab box');
    const geo = buildIceSlabGeometry(box);
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let iron = 0;
    for (let i = 0; i < col.count; i++) {
      // The whole body (block, iron, drift) stays near its footprint: the
      // iron at most SLAB_BAND_PROUD out, the haul ring a hand further.
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(box.hw + 2);
      const dark = col.getX(i) < 0.4 && col.getY(i) < 0.4 && col.getZ(i) < 0.45;
      const grey = Math.abs(col.getX(i) - col.getZ(i)) < 0.08;
      if (!dark || !grey) continue;
      iron++;
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(box.hw + SLAB_BAND_PROUD + 0.05);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(box.hd + SLAB_BAND_PROUD + 0.25);
      expect(pos.getY(i)).toBeLessThan(box.height);
    }
    expect(iron).toBeGreaterThan(100);
    geo.dispose();
  });

  it('never lets the ice poke through the belt, nor the belt float clear of the ice', () => {
    const box = wallBox(SANCTUM_ICE_SLAB, 1);
    if (!box) throw new Error('no slab box');
    const block = buildIceSlabShellGeometry(box);
    const pos = block.getAttribute('position') as THREE.BufferAttribute;
    const beltY = box.height * 0.42;
    let rows = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - beltY) > 0.4) continue;
      const x = Math.abs(pos.getX(i));
      const z = Math.abs(pos.getZ(i));
      // A vertex on a side face (x) or a broad face (z) in the belt's row.
      if (x > box.hw * 0.9 && z < box.hd * 0.8) {
        rows++;
        expect(x).toBeLessThanOrEqual(box.hw + SLAB_BAND_PROUD);
        expect(x).toBeGreaterThanOrEqual(box.hw - SLAB_BAND_BITE);
      }
      if (z > box.hd * 0.9 && x < box.hw * 0.8) {
        rows++;
        expect(z).toBeLessThanOrEqual(box.hd + SLAB_BAND_PROUD);
        expect(z).toBeGreaterThanOrEqual(box.hd - SLAB_BAND_BITE);
      }
    }
    expect(rows).toBeGreaterThan(4);
    expect(SLAB_BAND_PROUD).toBeLessThanOrEqual(0.2);
    block.dispose();
  });
});
