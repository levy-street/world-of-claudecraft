import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildVarkhulInterceptBeamPrewarmVisual,
  VARKHUL_INTERCEPT_BEAM_VISUAL_NAME,
  VarkhulInterceptBeamVisuals,
} from '../src/render/varkhul_intercept_beam_visual';
import type { ActiveVarkhulAssembly } from '../src/sim/varkhul_assembly';

function assembly(blocked = false): ActiveVarkhulAssembly {
  return {
    bossId: 90,
    difficulty: 'normal',
    phase: 'done',
    forgeX: 0,
    forgeZ: 22,
    forgeHp: 100,
    forgeMaxHp: 100,
    forgeOverheat: 0,
    forgeBeamActiveMask: 0,
    forgeBeamWarmupRemaining: 0,
    forgeMeltdownRemaining: 0,
    addWave: 0,
    addWaves: 0,
    addsRemaining: 0,
    forgeBeams: [],
    interceptBeam: {
      sourceId: 90,
      targetId: 12,
      blockerId: blocked ? 7 : null,
      sourceX: 2,
      sourceZ: 4,
      targetX: 14,
      targetZ: 20,
      blockerX: blocked ? 8 : null,
      blockerZ: blocked ? 12 : null,
      width: 1.35,
      duration: 5,
      remaining: 4,
    },
    cores: [],
    deliveryWindowRemaining: 0,
    assignments: [],
    runes: [],
    round: 0,
    rounds: 1,
    remaining: 0,
  };
}

describe('Varkhul Tempering Ray render', () => {
  it('prewarms the full moving-line, target, and interceptor vocabulary', () => {
    const root = buildVarkhulInterceptBeamPrewarmVisual();
    expect(root.getObjectByName('varkhul-tempering-ray-corridor')).toBeTruthy();
    expect(root.getObjectByName('varkhul-tempering-ray-core')).toBeTruthy();
    expect(root.getObjectByName('varkhul-tempering-ray-target-outer')).toBeTruthy();
    expect(root.getObjectByName('varkhul-tempering-ray-blocker-shield')).toBeTruthy();
  });

  it('draws the exact corridor to the moving target and reveals a cyan intercepted segment', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulInterceptBeamVisuals(scene, () => 0);
    const state = assembly(false);
    visuals.sync([state]);

    const root = scene.getObjectByName(`${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-90`);
    if (!root) throw new Error('Tempering Ray visual missing');
    const corridor = root.getObjectByName('varkhul-tempering-ray-corridor') as THREE.Mesh;
    const target = root.getObjectByName('varkhul-tempering-ray-target') as THREE.Group;
    const blocker = root.getObjectByName('varkhul-tempering-ray-blocker') as THREE.Group;
    const intercepted = root.getObjectByName('varkhul-tempering-ray-intercept-core') as THREE.Mesh;
    const sheath = root.getObjectByName('varkhul-tempering-ray-sheath') as THREE.Mesh;
    const core = root.getObjectByName('varkhul-tempering-ray-core') as THREE.Mesh;
    expect(sheath.scale.x).toBeCloseTo(0.42, 6);
    expect(sheath.scale.z).toBeCloseTo(0.42, 6);
    expect(core.scale.x).toBeCloseTo(0.16, 6);
    expect(core.scale.z).toBeCloseTo(0.16, 6);
    expect(corridor.scale.x).toBeCloseTo(2.7, 6);
    expect(corridor.scale.z).toBeCloseTo(20, 6);
    expect(corridor.position.x).toBeCloseTo(8, 6);
    expect(corridor.position.z).toBeCloseTo(12, 6);
    expect(corridor.rotation.y).toBeCloseTo(Math.atan2(12, 16), 6);
    expect(target.position.x).toBe(14);
    expect(target.position.z).toBe(20);
    expect(blocker.visible).toBe(false);
    expect(intercepted.visible).toBe(false);

    if (!state.interceptBeam) throw new Error('Fixture beam missing');
    state.interceptBeam.targetX = -10;
    state.interceptBeam.targetZ = 18;
    state.interceptBeam.blockerId = 7;
    state.interceptBeam.blockerX = -4;
    state.interceptBeam.blockerZ = 11;
    visuals.sync([state]);

    expect(target.position.x).toBe(-10);
    expect(target.position.z).toBe(18);
    expect(corridor.position.x).toBeCloseTo(-4, 6);
    expect(corridor.position.z).toBeCloseTo(11, 6);
    expect(corridor.scale.z).toBeCloseTo(Math.hypot(-12, 14), 6);
    expect(corridor.rotation.y).toBeCloseTo(Math.atan2(-12, 14), 6);
    expect(blocker.visible).toBe(true);
    expect(blocker.position.x).toBe(-4);
    expect(blocker.position.z).toBe(11);
    expect(intercepted.visible).toBe(true);
    expect(intercepted.position.x).toBeCloseTo(-1, 6);
    expect(intercepted.position.y).toBeCloseTo((3.1 + 1.15) * 0.5, 6);
    expect(intercepted.position.z).toBeCloseTo(7.5, 6);
    expect(intercepted.scale.y).toBeCloseTo(Math.hypot(-6, -1.95, 7), 6);
    const expectedQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-6, -1.95, 7).normalize(),
    );
    expect(intercepted.quaternion.angleTo(expectedQuaternion)).toBeCloseTo(0, 6);
    expect((intercepted.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xa2fbff);
    expect((intercepted.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);
    expect(intercepted.renderOrder).toBeGreaterThan(
      (root.getObjectByName('varkhul-tempering-ray-core') as THREE.Mesh).renderOrder,
    );
    expect(root.userData).toMatchObject({ targetId: 12, blockerId: 7, blocked: true });
  });

  it('keeps every actionable signal visible under reduced motion and cleans up after the cast', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulInterceptBeamVisuals(scene, () => 0);
    const state = assembly(true);
    visuals.sync([state]);
    visuals.update(0.5, true);
    const root = scene.getObjectByName(`${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-90`);
    if (!root) throw new Error('Tempering Ray visual missing');
    const corridor = root.getObjectByName('varkhul-tempering-ray-corridor') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const core = root.getObjectByName('varkhul-tempering-ray-core') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(corridor.visible).toBe(true);
    expect(core.visible).toBe(true);
    expect(root.getObjectByName('varkhul-tempering-ray-target')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-tempering-ray-blocker')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-tempering-ray-intercept-sheath')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-tempering-ray-intercept-core')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-tempering-ray-target-inner')?.rotation.y).toBe(0);
    expect(root.userData).toMatchObject({ width: 1.35, remaining: 4, blocked: true });
    const initialCorridorOpacity = corridor.material.opacity;
    const initialCoreOpacity = core.material.opacity;
    if (!state.interceptBeam) throw new Error('Fixture beam missing');
    state.interceptBeam.remaining = 0.5;
    visuals.sync([state]);
    visuals.update(0, true);
    expect(corridor.material.opacity).toBeGreaterThan(initialCorridorOpacity);
    expect(core.material.opacity).toBeGreaterThan(initialCoreOpacity);
    expect(root.userData.remaining).toBe(0.5);
    let visibleMeshes = 0;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.visible) visibleMeshes++;
    });
    expect(visibleMeshes).toBeLessThanOrEqual(10);

    const geometryDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const materialDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const entry of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(entry);
      }
    });
    for (const geometry of geometries) geometryDisposeSpies.push(vi.spyOn(geometry, 'dispose'));
    for (const material of materials) materialDisposeSpies.push(vi.spyOn(material, 'dispose'));

    visuals.sync([]);
    expect(scene.getObjectByName(`${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-90`)).toBeUndefined();
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce();
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce();
  });

  it('disposes every GPU resource through the public lifecycle method', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulInterceptBeamVisuals(scene, () => 0);
    visuals.sync([assembly(true)]);
    const root = scene.getObjectByName(`${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-90`);
    if (!root) throw new Error('Tempering Ray visual missing');
    const geometryDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const materialDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const entry of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(entry);
      }
    });
    for (const geometry of geometries) geometryDisposeSpies.push(vi.spyOn(geometry, 'dispose'));
    for (const material of materials) materialDisposeSpies.push(vi.spyOn(material, 'dispose'));

    visuals.dispose();

    expect(scene.getObjectByName(`${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-90`)).toBeUndefined();
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce();
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce();
  });
});
