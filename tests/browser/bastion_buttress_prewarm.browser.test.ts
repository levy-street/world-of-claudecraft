import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import {
  type CompileArmHost,
  linkColorPrograms,
  linkShadowPrograms,
} from '../../src/render/compile_arms';
import { attachSceneGroupGated } from '../../src/render/gated_scene_attach';
import { BastionBossFx } from '../../src/render/sunken_bastion/bastion_boss_fx';
import { bastionKitReady, ensureBastionKit } from '../../src/render/sunken_bastion/bastion_kit';
import type { IWorld } from '../../src/world_api';

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;

it('prepares first buttress colour and shadow draws before the real kit arrives', async () => {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(64, 64, false);
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x556677, 1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(8, 15, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(64, 64);
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 6, 25);
  camera.lookAt(0, 5, 0);
  camera.updateMatrixWorld();
  const root = new THREE.Group();
  const entities = new Map<number, Body>();
  const world = { playerId: 1, entities } as IWorld;
  const fx = new BastionBossFx(root, () => 0, world, false);
  const depth = new Map<string, THREE.MeshDepthMaterial>();
  const target = new THREE.WebGLRenderTarget(8, 8);
  const host: CompileArmHost = {
    webgl: () => renderer,
    camera: () => camera,
    scene: () => scene,
    shadowCamera: () => sun.shadow.camera,
    offscreen: () => false,
    offscreenTarget: () => target,
    depthMaterials: () => depth,
    shadowArm: () => true,
  };
  const errors: string[] = [];
  renderer.debug.onShaderError = (gl, program) => errors.push(gl.getProgramInfoLog(program) ?? '');
  const link = vi.spyOn(WebGL2RenderingContext.prototype, 'linkProgram');
  const seeded: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) seeded.push(object);
  });
  const released = seeded.map((mesh) => {
    const listener = vi.fn();
    mesh.addEventListener('dispose', listener);
    return listener;
  });
  try {
    await attachSceneGroupGated(scene, root, async (group) => {
      expect(group.visible).toBe(false);
      await linkColorPrograms(host, group, false);
      await linkShadowPrograms(host, group);
    });
    const prepared = [...(renderer.info.programs ?? [])];
    expect(prepared.length).toBeGreaterThan(0);
    expect(seeded).toHaveLength(3);
    expect(seeded.every((mesh) => !mesh.visible && !mesh.parent?.visible)).toBe(true);
    // Upgrade the constructor's procedural shapes using the shipped GLB, not a fake mesh.
    await ensureBastionKit();
    expect(bastionKitReady()).toBe(true);
    const buttress = {
      id: 2,
      kind: 'object',
      templateId: 'bastion_buttress_intact',
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as Body;
    entities.set(buttress.id, buttress);
    const linksBefore = link.mock.calls.length;
    for (const state of ['intact', 'cracked', 'broken']) {
      buttress.templateId = `bastion_buttress_${state}`;
      fx.update(0.1);
      renderer.render(scene, camera);
      expect(renderer.info.render.calls).toBeGreaterThan(0);
      expect(link.mock.calls).toHaveLength(linksBefore);
      expect(renderer.info.programs).toEqual(prepared);
    }
    for (const listener of released) expect(listener).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
  } finally {
    fx.dispose();
    for (const material of depth.values()) material.dispose();
    target.dispose();
    sun.shadow.map?.dispose();
    link.mockRestore();
    renderer.dispose();
    renderer.forceContextLoss();
  }
});
