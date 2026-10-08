import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { POSE_DRIVE_MIN_WEIGHT } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// The strafe states through a REAL CharacterVisual and AnimationMixer. Five
// links carry a strafe from the displayed motion to the screen, and each one
// fails silently on its own (the rig just keeps playing the forward run while
// the body slides sideways): the renderer must feed the side into the pose
// inputs (applyLocoDirection), the ClipMap names must reach the action map
// (clipNamesOf), the has-both-side-runs flag the state machine (desiredBase),
// the clip the base pose (baseAction), and strafeRef the foot-speed match. The
// pure halves are tests/character_anim_state.test.ts and tests/locomotion.test.ts.

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

/** A minimally real rig carrying the dummy's clips AND the WOC side runs. */
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
  const names = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Strafe_Left', 'Strafe_Right'];
  return { scene, animations: names.map(clip) };
}

type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
};
const peek = (visual: CharacterVisual) => visual as unknown as MixerPeek;
const playing = (visual: CharacterVisual) => peek(visual).current?.getClip().name;

function poseWeight(visual: CharacterVisual): number {
  let total = 0;
  for (const action of peek(visual).actions.values()) {
    if (action.isScheduled()) total += action.getEffectiveWeight();
  }
  return total;
}

/** The training dummy on a stubbed GLB. `sideRuns` hands its def the WOC side
 *  runs, both or only the left one (the def of a FRESH module instance, so
 *  nothing leaks between tests): what is under test is the wiring, not a body. */
async function makeVisual(sideRuns: 'both' | 'leftOnly' | 'none'): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  if (sideRuns !== 'none') {
    const { VISUALS } = await import('../src/render/characters/manifest');
    const def = VISUALS.mob_training_dummy;
    def.clips = { ...def.clips, strafeLeft: 'Strafe_Left' };
    if (sideRuns === 'both') def.clips.strafeRight = 'Strafe_Right';
    def.strafeRef = 5;
  }
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  visual.update(FRAME, anim(), true);
  return visual;
}

/** Hold a state for half a second, asserting the rig never slips toward bind pose. */
function drive(visual: CharacterVisual, s: AnimState, frames = 30): void {
  for (let i = 0; i < frames; i++) {
    visual.update(FRAME, s, true);
    expect(poseWeight(visual)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  }
}

const strafing = (strafe: 'left' | 'right', over: Partial<AnimState> = {}) =>
  anim({ moving: true, running: true, speed: 4, strafe, ...over });

describe('CharacterVisual strafe states', () => {
  let visual: CharacterVisual | null = null;
  afterEach(() => {
    visual?.dispose();
    visual = null;
  });

  it('is fed by the renderer: the side reaches the per-entity pose inputs', () => {
    // The one renderer line (renderer.ts sits at its exact monolith ceiling):
    // reverting it to the old bare backpedal copy leaves every unit test green
    // while no body ever strafes.
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('applyLocoDirection(st, loco, ghostWolf);');
    expect(renderer).not.toContain('st.backwards = loco.backwards;');
  });

  it('plays each side run, timed against strafeRef, and hands back to the run', async () => {
    visual = await makeVisual('both');
    // clipNamesOf built the actions: a name missing there never plays
    expect(peek(visual).actions.has('Strafe_Left')).toBe(true);
    expect(peek(visual).actions.has('Strafe_Right')).toBe(true);
    drive(visual, anim({ moving: true, running: true, speed: 4 }));
    expect(playing(visual)).toBe('Run');
    drive(visual, strafing('left'));
    expect(playing(visual)).toBe('Strafe_Left');
    // 4 yd/s against strafeRef 5; the run's reference (7) would clamp to 0.6
    expect(peek(visual).current?.timeScale).toBeCloseTo(0.8);
    drive(visual, strafing('right'));
    expect(playing(visual)).toBe('Strafe_Right');
    drive(visual, anim({ moving: true, running: true, speed: 4 }));
    expect(playing(visual)).toBe('Run');
  });

  it('blends into and out of the side runs on a short 0.1 s crossfade (owner call)', async () => {
    visual = await makeVisual('both');
    const weight = (name: string) => peek(visual!).actions.get(name)?.getEffectiveWeight() ?? 0;
    const running = anim({ moving: true, running: true, speed: 4 });
    const change = (s: AnimState, from: string, to: string) => {
      // two frames in it is still a blend, never the one-frame snap the owner turned down
      drive(visual!, s, 2);
      expect(weight(to)).toBeGreaterThan(0.1);
      expect(weight(to)).toBeLessThan(0.6);
      expect(weight(from)).toBeGreaterThan(0.4);
      // five frames later (0.117 s) the new state drives the rig alone, where the 0.22 s base
      // crossfade would still be about half way
      drive(visual!, s, 5);
      expect(weight(to)).toBeGreaterThan(0.99);
      expect(weight(from)).toBeLessThan(0.01);
    };
    drive(visual, running);
    change(strafing('left'), 'Run', 'Strafe_Left');
    // left to right, and back to the run, the same
    change(strafing('right'), 'Strafe_Left', 'Strafe_Right');
    change(running, 'Strafe_Right', 'Run');
  });

  it('keeps a slow sideways walk on the walk cycle', async () => {
    visual = await makeVisual('both');
    drive(visual, strafing('left', { running: false, speed: 2.2 }));
    expect(playing(visual)).toBe('Walk');
  });

  it('needs BOTH side runs: a rig with only one never strafes, even to that side', async () => {
    visual = await makeVisual('leftOnly');
    expect(peek(visual).actions.has('Strafe_Left')).toBe(true);
    drive(visual, strafing('left'));
    expect(playing(visual)).toBe('Run');
  });

  it('keeps the run on a rig whose ClipMap names no side runs', async () => {
    visual = await makeVisual('none');
    // the GLB carries them, but the def never asked: no action, no state
    expect(peek(visual).actions.has('Strafe_Left')).toBe(false);
    drive(visual, strafing('left', { speed: 7 }));
    expect(playing(visual)).toBe('Run');
    expect(peek(visual).current?.timeScale).toBeCloseTo(1);
  });
});
