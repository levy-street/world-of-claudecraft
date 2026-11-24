// The hazard pool's Three half (src/render/hazard_pool/): the static builder
// draws one pool per sim zone at the zone's own footprint and look, the Litany
// dressing maps tiers to styles, every material shares one program, and the
// dynamic host reconciles the world's rows by id with a drain after removal.

import * as fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placeMarshBlackwaterPools } from '../src/render/delve_marsh_dressing';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import {
  DYNAMIC_HAZARD_POOL_SLOTS,
  DynamicHazardPools,
  HAZARD_POOL_DRAIN_SEC,
  HAZARD_POOL_LOOKS,
  placeHazardPools,
} from '../src/render/hazard_pool';
import { hazardPoolDiscExtent } from '../src/render/hazard_pool/hazard_pool_core';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import { litanyModuleGeometry } from '../src/sim/delve_litany_layout';
import type { HazardPoolView } from '../src/world_api/dungeons';

function poolMeshes(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function maxReach(mesh: THREE.Mesh, cx: number, cz: number, axis: 'x' | 'z'): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let m = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = axis === 'x' ? Math.abs(pos.getX(i) - cx) : Math.abs(pos.getZ(i) - cz);
    m = Math.max(m, d);
  }
  return m;
}

describe('static hazard pools', () => {
  it('places one pool per zone, covering the zone, with its style and rung', () => {
    const group = new THREE.Group();
    const meshes = placeHazardPools(group, [
      { x: -8, z: 18, r: 8, style: 'marsh' },
      { x: -8, z: 18, r: 5, style: 'ember' },
      { x: 0, z: 56, r: 22, rx: 22, rz: 17, style: 'marsh' },
    ]);
    expect(meshes).toHaveLength(3);
    expect(poolMeshes(group)).toHaveLength(3);
    // The disc reaches the damage edge plus the outward margin, on each axis.
    expect(maxReach(meshes[0], -8, 18, 'x')).toBeCloseTo(8 * hazardPoolDiscExtent(8), 4);
    expect(maxReach(meshes[1], -8, 18, 'x')).toBeCloseTo(5 * hazardPoolDiscExtent(5), 4);
    expect(maxReach(meshes[2], 0, 56, 'x')).toBeCloseTo(22 * hazardPoolDiscExtent(22), 4);
    expect(maxReach(meshes[2], 0, 56, 'z')).toBeCloseTo(17 * hazardPoolDiscExtent(22), 4);
    expect(meshes[0].renderOrder).toBe(
      floorVfxRenderOrder('encounter', HAZARD_POOL_LOOKS.marsh.step),
    );
    expect(meshes[1].renderOrder).toBe(
      floorVfxRenderOrder('encounter', HAZARD_POOL_LOOKS.ember.step),
    );
    expect(meshes[1].renderOrder).toBeGreaterThan(meshes[0].renderOrder);
    // One material per style per room; both pools of a style share it.
    expect(meshes[0].material).toBe(meshes[2].material);
    expect(meshes[0].material).not.toBe(meshes[1].material);
  });

  it('shares one shader program across every style (same source, flags)', () => {
    const group = new THREE.Group();
    const [a, b] = placeHazardPools(group, [
      { x: 0, z: 0, r: 4, style: 'marsh' },
      { x: 9, z: 0, r: 4, style: 'ember' },
    ]);
    const ma = a.material as THREE.ShaderMaterial;
    const mb = b.material as THREE.ShaderMaterial;
    expect(ma.vertexShader).toBe(mb.vertexShader);
    expect(ma.fragmentShader).toBe(mb.fragmentShader);
    expect([ma.transparent, ma.depthWrite, ma.fog]).toEqual([true, false, true]);
    expect([mb.transparent, mb.depthWrite, mb.fog]).toEqual([true, false, true]);
  });

  it('draws every Litany room: shallow zones as marsh tar, deep and untiered as ember tar', () => {
    for (const id of [
      'litany_sluice',
      'litany_ledger',
      'litany_ring',
      'litany_baptistry',
      'litany_choir_loft',
      'litany_causeway',
      'litany_apse',
    ] as const) {
      const hazards = litanyModuleGeometry(id)!.hazards;
      const group = new THREE.Group();
      placeMarshBlackwaterPools(group, hazards);
      const meshes = poolMeshes(group);
      expect(meshes).toHaveLength(hazards.length);
      meshes.forEach((mesh, i) => {
        const style = hazards[i].tier === 'shallow' ? 'marsh' : 'ember';
        expect(mesh.name).toBe(`hazardPool_${style}`);
      });
    }
  });
});

describe('dynamic hazard pools', () => {
  const pool = (id: string, ageSec: number, x = 10, z = 20): HazardPoolView => ({
    id,
    x,
    z,
    r: 4,
    style: 'violet',
    ageSec,
    armSec: 1,
    lifeSec: 8,
  });

  function host() {
    const scene = new THREE.Scene();
    const pools = new DynamicHazardPools(scene, undefined, () => 0.5);
    return { scene, pools };
  }

  function visibleSlots(pools: DynamicHazardPools): THREE.Mesh[] {
    return pools.root.children.filter((c) => c.visible) as THREE.Mesh[];
  }

  it('builds its slots up front under one root and draws nothing until a pool lands', () => {
    const { scene, pools } = host();
    expect(scene.children).toContain(pools.root);
    expect(pools.root.children).toHaveLength(DYNAMIC_HAZARD_POOL_SLOTS);
    pools.update([], 1 / 60, false);
    expect(visibleSlots(pools)).toHaveLength(0);
  });

  it('claims a slot at the pool spot, spills, and is fully formed by its first tick', () => {
    const { pools } = host();
    pools.update([pool('a', 0)], 1 / 60, false);
    const [mesh] = visibleSlots(pools);
    expect(mesh.position.toArray()).toEqual([10, 0.5, 20]);
    expect(mesh.renderOrder).toBe(floorVfxRenderOrder('encounter', HAZARD_POOL_LOOKS.violet.step));
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    expect(u.uFilmAmt.value).toBe(1);
    expect(u.uArming.value).toBe(1);
    pools.update([pool('a', 1.2)], 1 / 60, false);
    expect(u.uBody.value).toBe(1);
    expect(u.uArming.value).toBe(0);
    expect(pools.activeCount()).toBe(1);
  });

  it('drains a dropped pool, then frees its slot', () => {
    const { pools } = host();
    pools.update([pool('a', 3)], 1 / 60, false);
    const [mesh] = visibleSlots(pools);
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    pools.update([], HAZARD_POOL_DRAIN_SEC / 2, false);
    expect(mesh.visible).toBe(true);
    expect(u.uFade.value).toBeCloseTo(0.5, 6);
    pools.update([], HAZARD_POOL_DRAIN_SEC, false);
    expect(mesh.visible).toBe(false);
    expect(pools.activeCount()).toBe(0);
  });

  it('keeps one slot per pool id and never steals a live pool', () => {
    const { pools } = host();
    const rows = Array.from({ length: DYNAMIC_HAZARD_POOL_SLOTS + 2 }, (_, i) =>
      pool(`p${i}`, 2, i * 10, 0),
    );
    pools.update(rows, 1 / 60, false);
    expect(pools.activeCount()).toBe(DYNAMIC_HAZARD_POOL_SLOTS);
    const before = visibleSlots(pools).map((m) => m.position.x);
    pools.update(rows, 1 / 60, false);
    expect(visibleSlots(pools).map((m) => m.position.x)).toEqual(before);
  });

  it('holds the surface clock still under reduced motion, never the pool itself', () => {
    const { pools } = host();
    pools.update([pool('a', 2)], 0.5, true);
    const [mesh] = visibleSlots(pools);
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    expect(u.uTime.value).toBe(0);
    expect(mesh.visible).toBe(true);
    expect(u.uBody.value).toBe(1);
    pools.update([pool('a', 2.5)], 0.5, false);
    expect(u.uTime.value).toBe(0.5);
  });
});

describe('hazard pool program and lifecycle contracts', () => {
  it('draws boss pools with the very program the static rooms link (one program to warm)', () => {
    const group = new THREE.Group();
    const [staticMesh] = placeHazardPools(group, [{ x: 0, z: 0, r: 4, style: 'marsh' }]);
    const pools = new DynamicHazardPools(new THREE.Scene(), undefined, () => 0);
    const slot = pools.root.children[0] as THREE.Mesh;
    expect(materialProgramSignature(slot.material as THREE.ShaderMaterial)).toBe(
      materialProgramSignature(staticMesh.material as THREE.ShaderMaterial),
    );
    // A claim restyles through uniforms only: the program never changes.
    const before = materialProgramSignature(slot.material as THREE.ShaderMaterial);
    pools.update(
      [{ id: 'a', x: 0, z: 0, r: 4, style: 'ember', ageSec: 2, armSec: 1, lifeSec: 8 }],
      0.016,
      false,
    );
    expect(materialProgramSignature(slot.material as THREE.ShaderMaterial)).toBe(before);
  });

  it('keeps its slots hidden behind the compile gate until the gate settles', async () => {
    let settle!: () => void;
    const gated: THREE.Object3D[] = [];
    const gate = (root: THREE.Object3D) => {
      gated.push(root);
      return new Promise<void>((r) => {
        settle = r;
      });
    };
    const scene = new THREE.Scene();
    const pools = new DynamicHazardPools(scene, gate, () => 0);
    expect(gated).toEqual([pools.root]);
    expect(scene.children).toContain(pools.root);
    expect(pools.root.visible).toBe(false);
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(pools.root.visible).toBe(true);
  });

  it('disposes terminally: idempotent, detached, and a late update draws nothing', () => {
    const scene = new THREE.Scene();
    const pools = new DynamicHazardPools(scene, undefined, () => 0);
    pools.dispose();
    pools.dispose();
    expect(scene.children).not.toContain(pools.root);
    pools.update(
      [{ id: 'a', x: 0, z: 0, r: 4, style: 'violet', ageSec: 2, armSec: 1, lifeSec: 8 }],
      0.016,
      false,
    );
    expect(pools.activeCount()).toBe(0);
  });
});

describe('hazard pool shader', () => {
  const src = fs.readFileSync('src/render/hazard_pool/hazard_pool_shader.ts', 'utf8');
  it('stays camera-relative and samples its noise in pool-local yards', () => {
    expect(src).not.toMatch(/viewMatrix\s*\*/);
    expect(src).toContain('modelViewMatrix * vec4(pos, 1.0)');
    expect(src).toContain('vec4 mvPosition');
    expect(src).not.toMatch(/\bvWorld\b|modelMatrix\s*\*/);
  });

  it('never draws inside the damage radius: the edge only widens', () => {
    // edgeR = 1 + margin * wander with wander clamped to [0, 1]; the rim fade
    // starts AT edgeR, so every fragment with |aPool| <= 1 keeps full shape.
    expect(src).toContain('float edgeR = 1.0 + vInfo.y * wander;');
    expect(src).toContain('smoothstep(edgeR, edgeR + softN, d)');
    expect(src).toMatch(/float wander = clamp\([^;]*, 0\.0, 1\.0\);/);
  });
});
