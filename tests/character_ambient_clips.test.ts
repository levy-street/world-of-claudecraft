import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// VisualDef.ambientClips (Wobbles the Slime's drifting bubbles): a clip the
// visual loops for its whole life BESIDE the state clips, on its own clock. If
// it rode the state machine, every idle/walk/run/jump change would restart it,
// which is the jump in the bubbles this field exists to remove. Drives a REAL
// CharacterVisual through a real AnimationMixer.

const FRAME = 1 / 60;
const AMBIENT_SECONDS = 10; // long enough that the test never wraps the loop

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

/** The training dummy's ClipMap plus an `Ambient` clip on a bone no state clip keys. */
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
  const ambient = new THREE.AnimationClip('Ambient', AMBIENT_SECONDS, [
    new THREE.NumberKeyframeTrack('RigRoot.position[y]', [0, AMBIENT_SECONDS], [0, 1]),
  ]);
  return {
    scene,
    animations: [
      ...['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Jump', 'Land'].map(clip),
      ambient,
    ],
  };
}

type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  mixer: THREE.AnimationMixer & { _actions: THREE.AnimationAction[] };
};

async function makeVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { VISUALS } = await import('../src/render/characters/manifest');
  const def = VISUALS.mob_training_dummy;
  if (!def) throw new Error('training dummy visual missing from the manifest');
  // Jump plus Land opts the rig into the held-jump path Wobbles uses: Jump
  // clamps while airborne and Land plays as a one-shot on touchdown.
  VISUALS.mob_training_dummy = {
    ...def,
    clips: { ...def.clips, jump: 'Jump', land: 'Land' },
    ambientClips: ['Ambient'],
  };
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  return visual;
}

function ambientAction(visual: CharacterVisual): THREE.AnimationAction {
  // existingAction(name) looks the clip up on the model's own `animations`,
  // which a loaded rig does not carry, so search the mixer's live actions.
  const { mixer } = visual as unknown as MixerPeek;
  const action = mixer._actions.find((a) => a.getClip().name === 'Ambient');
  if (!action) throw new Error('the ambient clip was never started');
  return action;
}

describe('VisualDef.ambientClips', () => {
  it('starts the ambient clip at construction, outside the state machine', async () => {
    const visual = await makeVisual();
    const action = ambientAction(visual);
    expect(action.isRunning()).toBe(true);
    expect([...(visual as unknown as MixerPeek).actions.values()]).not.toContain(action);
    expect((visual as unknown as MixerPeek).actions.has('Ambient')).toBe(false);
  });

  it('keeps its own clock through idle, walk, run, jump, landing and back', async () => {
    const visual = await makeVisual();
    const action = ambientAction(visual);
    const states = [
      anim(),
      anim({ moving: true, speed: 2 }),
      anim({ moving: true, running: true, speed: 7 }),
      anim({ moving: true, running: true, speed: 7, airborne: true }),
      anim({ moving: true, running: true, speed: 7 }), // touchdown: the Land one-shot
      anim(),
    ];
    let frames = 0;
    let last = action.time;
    for (const state of states) {
      for (let i = 0; i < 30; i++) {
        visual.update(FRAME, state, true);
        frames++;
        expect(action.isRunning()).toBe(true);
        expect(action.time).toBeGreaterThan(last); // never restarted by a state change
        last = action.time;
      }
    }
    expect(action.time).toBeCloseTo(frames * FRAME, 6);
    expect(action.getEffectiveWeight()).toBe(1);
  });
});
