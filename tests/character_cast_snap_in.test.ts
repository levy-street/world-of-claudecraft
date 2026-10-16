import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { castClipSyncs, clipSnapsIn } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// A rise out of the floor (ClipMap.castSnapIn) and a bar-locked cast picked by
// ability (VisualDef.castClipSync as a list), driven through a REAL
// CharacterVisual and AnimationMixer. Vael's shadow copies popped in: the
// rise crossfaded in from the standing idle (an upright figure for the first
// frames) and, at half the bar's length, looped (it rose, dropped back under
// the flags and rose again).

const FRAME = 1 / 60;
const RISE = 'test_rise';
const HYMN = 'test_hymn';
const RISE_BAR = 2;

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
    animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Emerge', 'Hymn'].map(clip),
  };
}

type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
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
  // The stub clips are 1 s; the rise bar is 2 s, so it plays at half rate
  // (as Vael's 0.625 s Emerge over his 1.2 s veil rise).
  Object.assign(VISUALS.mob_training_dummy.clips, {
    castByAbility: { [RISE]: 'Emerge', [HYMN]: 'Hymn' },
    castTimeScaleByAbility: { [RISE]: 1 / RISE_BAR },
    castSnapIn: ['Emerge'],
  });
  Object.assign(VISUALS.mob_training_dummy, { castClipSync: [RISE] });
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  return visual;
}

function action(visual: CharacterVisual, name: string): THREE.AnimationAction {
  const a = (visual as unknown as MixerPeek).actions.get(name);
  if (!a) throw new Error(`no ${name} action`);
  return a;
}

describe('the cast clip pickers', () => {
  it('locks every cast for true, only the listed ones for a list', () => {
    expect(castClipSyncs(true, 'any')).toBe(true);
    expect(castClipSyncs(true, null)).toBe(true);
    expect(castClipSyncs(undefined, 'any')).toBe(false);
    expect(castClipSyncs(false, 'any')).toBe(false);
    expect(castClipSyncs([RISE], RISE)).toBe(true);
    expect(castClipSyncs([RISE], HYMN)).toBe(false);
    expect(castClipSyncs([RISE], null)).toBe(false);
    expect(clipSnapsIn(['Emerge'], 'Emerge')).toBe(true);
    expect(clipSnapsIn(['Emerge'], 'Idle')).toBe(false);
    expect(clipSnapsIn(undefined, 'Emerge')).toBe(false);
  });
});

describe('a rise out of the floor (castSnapIn + a listed castClipSync, real mixer)', () => {
  it('takes the body at full weight on its first frame, no standing pose blended in', async () => {
    const visual = await makeVisual();
    for (let i = 0; i < 10; i++) visual.update(FRAME, anim(), true);
    const idle = action(visual, 'Idle');
    expect(idle.getEffectiveWeight()).toBe(1);
    visual.update(FRAME, anim({ casting: true, castingAbility: RISE, castElapsed: FRAME }), true);
    const emerge = action(visual, 'Emerge');
    expect(emerge.getEffectiveWeight()).toBe(1);
    expect(idle.isRunning() ? idle.getEffectiveWeight() : 0).toBe(0);
  });

  it('plays the rise once over its whole bar and holds its last pose, never looping', async () => {
    const visual = await makeVisual();
    visual.update(FRAME, anim(), true);
    const emerge = () => action(visual, 'Emerge');
    // The bar steps at the sim's 20 Hz while frames run at 60: the clip runs
    // ahead between ticks, and the bar holds at its end for a few frames.
    const TICK = 1 / 20;
    let prev = -1;
    for (let i = 1; i <= Math.round((RISE_BAR + 0.2) / FRAME); i++) {
      const elapsed = Math.min(RISE_BAR, Math.floor((i * FRAME) / TICK) * TICK);
      visual.update(
        FRAME,
        anim({ casting: true, castingAbility: RISE, castElapsed: elapsed }),
        true,
      );
      // Never jumps back to the start (a loop would drop the body under again).
      expect(emerge().time).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = emerge().time;
    }
    // On the bar's end it holds the clip's last pose.
    expect(prev).toBeGreaterThan(0.95);
    expect(emerge().getEffectiveWeight()).toBe(1);
  });

  it('leaves an unlisted channel looping at its own pace (never pinned to the bar)', async () => {
    const visual = await makeVisual();
    visual.update(FRAME, anim(), true);
    const frames = Math.round(2.5 / FRAME);
    let wrapped = false;
    let prev = 0;
    for (let i = 1; i <= frames; i++) {
      visual.update(
        FRAME,
        anim({ casting: true, castingAbility: HYMN, castElapsed: i * FRAME }),
        true,
      );
      const t = action(visual, 'Hymn').time;
      if (t < prev - 0.5) wrapped = true;
      prev = t;
    }
    expect(wrapped).toBe(true);
    // Two and a half seconds into a 1 s loop: halfway through its third pass
    // (a bar-locked clip would sit clamped at its end, nudged off it each frame).
    expect(prev).toBeGreaterThan(0.4);
    expect(prev).toBeLessThan(0.6);
  });
});
