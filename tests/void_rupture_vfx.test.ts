import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  VOID_RUPTURE_LIFETIME,
  VOID_RUPTURE_SLOTS,
  VOID_RUPTURE_SURFACE_OFFSET,
  VoidRuptures,
} from '../src/render/ability_vfx/void_rupture';
import { abilityVfxSpec } from '../src/render/ability_vfx_registry';
import { inCastVfxEngine } from '../src/render/cast_vfx_family';
import { bindSpellEffectsWorld, setSpellEffectsEnabled } from '../src/render/spell_effects_switch';
import { createVfxAnchor } from '../src/render/vfx_anchor';

const pools: VoidRuptures[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose();
  setSpellEffectsEnabled(true);
  bindSpellEffectsWorld(() => undefined);
});
function fixture(height = 2) {
  const scene = new THREE.Scene();
  const anchor = vi.fn(
    createVfxAnchor((id, out) => {
      if (id !== 2) return false;
      Object.assign(out, { x: 3, y: 2, z: 4, height });
      return true;
    }),
  );
  const pool = new VoidRuptures(scene, anchor);
  pools.push(pool);
  return {
    scene,
    pool,
    anchor,
    mesh: scene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  };
}
describe('Void Rupture pooled target impact', () => {
  it('is bounded, pretagged, reuses all geometry/materials and snapshots a target anchor', () => {
    const { scene, pool, anchor, mesh } = fixture();
    const geometry = mesh.geometry,
      material = mesh.material;
    expect(scene.children).toHaveLength(VOID_RUPTURE_SLOTS);
    expect(scene.children.every(inCastVfxEngine)).toBe(true);
    expect(pool.spawn(1, 99)).toBe(false);
    for (let i = 0; i < VOID_RUPTURE_SLOTS; i++) expect(pool.spawn(1, 2)).toBe(true);
    expect(pool.spawn(1, 2)).toBe(false);
    pool.update(0, new THREE.Quaternion());
    expect(mesh.visible).toBe(true);
    expect(mesh.position.toArray()).toEqual([3, 3.2, 4]);
    expect(anchor.mock.calls.every((call) => call[2] instanceof THREE.Vector3)).toBe(true);
    pool.update(VOID_RUPTURE_LIFETIME, new THREE.Quaternion());
    expect(scene.children.every((child) => !child.visible)).toBe(true);
    expect(pool.spawn(1, 2)).toBe(true);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
  });
  it('places its camera-facing surface in front of the victim while retaining world depth occlusion', () => {
    const { pool, mesh } = fixture();
    const camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.8, 0));
    pool.spawn(1, 2);
    pool.update(0.16, camera);
    mesh.updateMatrixWorld(true);
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
    expect(center.toArray()).toEqual([0, 0, 0]);
    center.z = mesh.material.uniforms.uSurfaceOffset.value;
    const surface = center.applyMatrix4(mesh.matrixWorld);
    const towardCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(camera);
    expect(surface.sub(mesh.position).dot(towardCamera)).toBeCloseTo(VOID_RUPTURE_SURFACE_OFFSET);
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
  });
  it('adapts its front-surface offset to large target rigs with a bounded maximum', () => {
    const giant = fixture(12);
    giant.pool.spawn(1, 2);
    expect(giant.mesh.material.uniforms.uSurfaceOffset.value).toBeCloseTo(4.2);
    const enormous = fixture(100);
    enormous.pool.spawn(1, 2);
    expect(enormous.mesh.material.uniforms.uSurfaceOffset.value).toBe(8);
  });
  it('retains its fissure at minimum quality and removes moving ornament in reduced motion', () => {
    const { pool, mesh } = fixture();
    pool.spawn(1, 2);
    const camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, 0));
    pool.update(0.2, camera, true, 0);
    expect(mesh.visible).toBe(true);
    expect(mesh.quaternion.equals(camera)).toBe(true);
    expect(mesh.material.uniforms.uQuality.value).toBe(0);
    expect(mesh.material.uniforms.uReduced.value).toBe(1);
    expect(mesh.material.uniforms.uAge.value).toBe(0.2);
  });
  it('refuses cold spawns and revokes a live effect when the engine gate closes', () => {
    const { pool, mesh } = fixture();
    let open = false;
    pool.spawnGate = { allows: () => open };
    expect(pool.spawn(1, 2)).toBe(false);
    open = true;
    expect(pool.spawn(1, 2)).toBe(true);
    pool.update(0.1, new THREE.Quaternion());
    expect(mesh.visible).toBe(true);
    open = false;
    pool.update(0.1, new THREE.Quaternion());
    expect(mesh.visible).toBe(false);
    open = true;
    pool.update(0, new THREE.Quaternion());
    expect(mesh.visible).toBe(false);
  });
  it('clears and disposes every owned resource once', () => {
    const { pool, scene, mesh } = fixture();
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const materials = scene.children.map((child) =>
      vi.spyOn((child as typeof mesh).material, 'dispose'),
    );
    pool.spawn(1, 2);
    pool.clear();
    pool.update(0, new THREE.Quaternion());
    expect(mesh.visible).toBe(false);
    pool.dispose();
    pool.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(materials.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(pool.spawn(1, 2)).toBe(false);
  });
});

function routing(open = true, spawn = true) {
  const fx = { setDelegates: vi.fn(), spawnVoidRupture: vi.fn(() => spawn) };
  const tick = vi.fn(),
    triggerAttack = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: fx as unknown as AbilityVfxFx,
      vfx: { tick } as never,
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack,
      castVfxAdmit: () => open,
      castVfxReady: () => open,
    },
    () => 0,
  );
  return { painter, fx, tick };
}
const event = {
  sourceId: 1,
  targetId: 2,
  school: 'shadow',
  kind: 'hit',
  amount: 80,
  crit: false,
  abilityId: 'void_rupture',
  ability: 'void_rupture',
};
describe('Void Rupture production routing', () => {
  it('routes the hit directly to its target without an area radius', () => {
    const h = routing();
    expect(abilityVfxSpec('void_rupture')?.rg).toBeUndefined();
    expect(h.painter.onDamage(event)).toBeUndefined();
    expect(h.fx.spawnVoidRupture).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(h.tick).not.toHaveBeenCalled();
  });
  it('sheds bespoke meshes under the real global spam budget while keeping generic hit ownership', () => {
    const h = routing();
    for (let sourceId = 10; sourceId < 110; sourceId++) h.painter.onDamage({ ...event, sourceId });
    const admitted = h.fx.spawnVoidRupture.mock.calls.length;
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(100);
    expect(h.painter.onDamage({ ...event, sourceId: 999 })).toBeUndefined();
    expect(h.fx.spawnVoidRupture).toHaveBeenCalledTimes(admitted);
  });
  it('accepts critical hits but never draws a fissure for resisted or fully absorbed damage', () => {
    const h = routing();
    h.painter.onDamage({ ...event, crit: true });
    expect(h.fx.spawnVoidRupture).toHaveBeenCalledTimes(1);
    h.painter.onDamage({ ...event, kind: 'resist', amount: 0 });
    h.painter.onDamage({ ...event, amount: 0, absorbed: 80 });
    expect(h.fx.spawnVoidRupture).toHaveBeenCalledTimes(1);
  });
  it('refuses cold GPU work and preserves generic hit ownership when the pool is full', () => {
    const cold = routing(false);
    expect(cold.painter.onDamage(event)).toBeUndefined();
    expect(cold.fx.spawnVoidRupture).not.toHaveBeenCalled();
    expect(cold.tick).not.toHaveBeenCalled();
    const full = routing(true, false);
    expect(full.painter.onDamage(event)).toBeUndefined();
    expect(full.fx.spawnVoidRupture).toHaveBeenCalledExactlyOnceWith(1, 2);
  });
});
