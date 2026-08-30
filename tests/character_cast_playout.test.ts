import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// The generic-cast pointing hold and the cast-exit play-out, driven through a REAL
// CharacterVisual and AnimationMixer. The play-out case that matters most is
// the yield: when the sim resumes moving the body while the recovery tail is
// still playing, the rig must hand over to locomotion immediately. Holding the
// one-shot instead glides the model across the floor with no run animation,
// which players read as the boss teleporting to the aggro target after a Slam.

const FRAME = 1 / 60;

const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

/** A minimally real skinned GLB whose clips include the cast lane. */
function stubGltf() {
  const scene = new THREE.Group();
  const rootBone = new THREE.Bone();
  rootBone.name = 'RigRoot';
  const childBone = new THREE.Bone();
  childBone.name = 'RigChild';
  childBone.position.y = 1;
  rootBone.add(childBone);
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const vertexCount = geometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    skinIndices[i * 4] = 1;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, childBone]));
  scene.add(mesh);
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('RigChild.position[x]', [0, 1], [0, 1]),
    ]);
  return {
    scene,
    animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Casting'].map(clip),
  };
}

type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
};

// The stub clips are 1s long; the hold sits inside them the way the live
// Forgefather entry sits inside his 1.033s Casting clip.
const HOLD_POINT = 0.72;

async function makeVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { VISUALS } = await import('../src/render/characters/manifest');
  Object.assign(VISUALS.mob_training_dummy.clips, {
    cast: 'Casting',
    castHoldPointSeconds: HOLD_POINT,
    castPlayOut: ['Casting'],
  });
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  return visual;
}

function castingAction(visual: CharacterVisual): THREE.AnimationAction {
  const action = (visual as unknown as MixerPeek).actions.get('Casting');
  if (!action) throw new Error('no Casting action was created');
  return action;
}

function currentClipName(visual: CharacterVisual): string | null {
  return (visual as unknown as MixerPeek).current?.getClip().name ?? null;
}

describe('generic-cast pointing hold and cast-exit play-out (real mixer)', () => {
  it('plays the raise once, then freezes on the pointing frame while the cast channels', async () => {
    const visual = await makeVisual();
    visual.update(FRAME, anim(), true);
    const casting = anim({ casting: true });
    for (let i = 0; i < Math.ceil(1 / FRAME); i++) visual.update(FRAME, casting, true);
    const action = castingAction(visual);
    for (let i = 0; i < Math.ceil(2 / FRAME); i++) {
      visual.update(FRAME, casting, true);
      expect(action.time).toBe(HOLD_POINT);
      expect(action.paused).toBe(true);
    }
    expect(currentClipName(visual)).toBe('Casting');
  });

  it('finishes the recovery as a one-shot when the cast ends with the body still', async () => {
    const visual = await makeVisual();
    visual.update(FRAME, anim(), true);
    const casting = anim({ casting: true });
    for (let i = 0; i < Math.ceil(1.2 / FRAME); i++) visual.update(FRAME, casting, true);
    const action = castingAction(visual);
    // cast over, body still: the same clip keeps driving, past the hold point
    visual.update(FRAME, anim(), true);
    expect(currentClipName(visual)).toBe('Casting');
    for (let i = 0; i < 6; i++) visual.update(FRAME, anim(), true);
    expect(currentClipName(visual)).toBe('Casting');
    expect(action.time).toBeGreaterThan(HOLD_POINT);
    // and once the clip is done, the rig hands back to the base pose
    for (let i = 0; i < Math.ceil(0.6 / FRAME); i++) visual.update(FRAME, anim(), true);
    expect(currentClipName(visual)).toBe('Idle');
  });

  it('yields the play-out to locomotion the moment the body moves (the post-Slam glide)', async () => {
    const visual = await makeVisual();
    visual.update(FRAME, anim(), true);
    const casting = anim({ casting: true });
    for (let i = 0; i < Math.ceil(1.2 / FRAME); i++) visual.update(FRAME, casting, true);
    // cast ends and the recovery starts playing out
    visual.update(FRAME, anim(), true);
    expect(currentClipName(visual)).toBe('Casting');
    // the sim resumes the chase: the very next frames must run, not glide
    const running = anim({ moving: true, speed: 6 });
    visual.update(FRAME, running, true);
    visual.update(FRAME, running, true);
    expect(currentClipName(visual)).toBe('Walk');
  });
});
