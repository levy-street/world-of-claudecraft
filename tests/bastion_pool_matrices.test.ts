import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BastionFx } from '../src/render/sunken_bastion/bastion_fx';
import { BASTION_HALBERD_SWEEP } from '../src/sim/mob/trash_kit/bastion_cast_ids';
import type { IWorld } from '../src/world_api';

// Only image/network ownership is replaced; every gameplay painter and floor
// telegraph below is the real production pool, without a WebGL renderer.
vi.mock('../src/render/textures', () => ({ radialGlowTexture: () => new THREE.Texture() }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => ({ scene: new THREE.Group() }),
}));

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;

it('parks Bastion pool matrices while retaining all compile roots and the first actionable pose', async () => {
  const scene = new THREE.Scene();
  const player = {
    id: 1,
    kind: 'player',
    pos: { x: 0, y: 0, z: 0 },
    auras: [],
    dead: false,
  } as unknown as Body;
  const entities = new Map<number, Body>([[1, player]]);
  const world = { player, entities } as IWorld;
  const fx = new BastionFx(scene, () => 2, world);
  await fx.readyForEntry;
  const root = scene.getObjectByName('sunken-bastion-telegraphs');
  if (!root) throw new Error('Bastion telegraph pool was not attached');
  const inventory: THREE.Object3D[] = [];
  root.traverse((node) => inventory.push(node));
  const tells = root.children.filter((node) =>
    node.children.some((child) =>
      Boolean(
        (child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material?.uniforms?.uFill,
      ),
    ),
  );
  expect(inventory.length).toBeGreaterThan(900);
  const compose = vi.spyOn(THREE.Object3D.prototype, 'updateMatrix');
  try {
    scene.updateMatrixWorld(true);
    expect(compose.mock.calls.length).toBeLessThan(inventory.length / 4);
    const parked: THREE.Object3D[] = [];
    root.traverse((node) => parked.push(node));
    expect(parked).toEqual(inventory);
    const caster = {
      id: 2,
      kind: 'mob',
      templateId: 'drowned_watchman',
      pos: { x: 12, y: 2, z: 18 },
      facing: 0.4,
      dead: false,
      auras: [],
      castingAbility: BASTION_HALBERD_SWEEP,
      castRemaining: 1,
      castTotal: 2,
    } as unknown as Body;
    entities.set(caster.id, caster);
    fx.update(0.1);
    scene.updateMatrixWorld();
    const tell = tells.find((node) => node.visible);
    if (!tell) throw new Error('Active cast did not show its floor telegraph');
    expect(tell.matrixWorld.elements[12]).toBe(12);
    expect(tell.matrixWorld.elements[14]).toBe(18);
    caster.castingAbility = null;
    fx.update(0.1);
    expect(tell.visible).toBe(false);
    const walk = vi.spyOn(tell, 'updateMatrixWorld');
    scene.updateMatrixWorld();
    expect(walk).not.toHaveBeenCalled();
    caster.pos.x = 24;
    caster.castingAbility = BASTION_HALBERD_SWEEP;
    fx.update(0.1);
    scene.updateMatrixWorld();
    expect(tell.visible).toBe(true);
    expect(tell.matrixWorld.elements[12]).toBe(24);
  } finally {
    compose.mockRestore();
    fx.dispose();
  }
});
