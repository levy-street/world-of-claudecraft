import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

const anim = (dead: boolean): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
});

function stubGltf() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('body.position[x]', [0, 1], [0, 0]),
    ]);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
}

async function makeGroundedVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { VISUALS } = await import('../src/render/characters/manifest');
  VISUALS.mob_training_dummy.deathGroundOffset = 0.565;
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  visual.update(0, anim(false), true);
  return visual;
}

describe('CharacterVisual death grounding', () => {
  it('settles the final Death pose through modelWrap and restores its base on revive', async () => {
    const visual = await makeGroundedVisual();
    const modelWrap = visual.root.getObjectByName('character_model_wrap');
    if (!modelWrap) throw new Error('character model wrapper missing');
    const baseY = modelWrap.position.y;

    visual.update(0, anim(true), true);
    const death = (
      visual as unknown as { actions: Map<string, THREE.AnimationAction> }
    ).actions.get('Death');
    if (!death) throw new Error('Death action missing');
    death.time = death.getClip().duration;
    visual.update(0, anim(true), false);

    expect(modelWrap.position.y).toBeCloseTo(baseY - 0.565, 6);

    visual.update(0, anim(false), false);
    expect(modelWrap.position.y).toBeCloseTo(baseY, 6);
  });
});
