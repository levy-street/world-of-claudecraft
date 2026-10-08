import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type AnimState, combatIdleClamps } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// The muster soldiers' held guard (ClipMap.combatIdleHold), driven through a REAL
// CharacterVisual and AnimationMixer. The owner watched the soldiers raise their shields
// over and over while Balgath was on them: the KayKit `Block` clip is a RAISE that ends on
// the held guard, and looping it drops the shield and brings it back up every second. With
// the hold, the shield comes up ONCE, stays up for as long as the soldier is braced, and
// comes down once when the brace ends.

const FRAME = 1 / 60;
const CLIP_SECONDS = 1;

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

/** A minimally real skinned GLB whose clips include the guard raise. */
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
    new THREE.AnimationClip(name, CLIP_SECONDS, [
      new THREE.NumberKeyframeTrack('RigChild.position[x]', [0, CLIP_SECONDS], [0, 1]),
    ]);
  return {
    scene,
    animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Block'].map(clip),
  };
}

type MixerPeek = {
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
};

async function makeVisual(hold: boolean): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { VISUALS } = await import('../src/render/characters/manifest');
  Object.assign(VISUALS.mob_training_dummy.clips, {
    combatIdle: 'Block',
    combatIdleHold: hold,
  });
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  return visual;
}

function blockAction(visual: CharacterVisual): THREE.AnimationAction {
  const action = (visual as unknown as MixerPeek).actions.get('Block');
  if (!action) throw new Error('no Block action was created');
  return action;
}

function currentClipName(visual: CharacterVisual): string | null {
  return (visual as unknown as MixerPeek).current?.getClip().name ?? null;
}

/** Brace for `seconds`, recording every time the guard clip jumped BACK (a replay). */
function braceFor(visual: CharacterVisual, seconds: number): { replays: number } {
  const braced = anim({ combat: true });
  let replays = 0;
  let last = -1;
  for (let i = 0; i < Math.ceil(seconds / FRAME); i++) {
    visual.update(FRAME, braced, true);
    const t = blockAction(visual).time;
    if (last >= 0 && t < last - 1e-6) replays++;
    last = t;
  }
  return { replays };
}

describe('the muster guard is raised once and held (real mixer)', () => {
  it('raises the shield once and holds its last frame for as long as the brace lasts', async () => {
    const visual = await makeVisual(true);
    visual.update(FRAME, anim(), true);
    const { replays } = braceFor(visual, 6);
    expect(replays).toBe(0);
    expect(currentClipName(visual)).toBe('Block');
    // Clamped on the raised pose, still driving the rig at full weight (not bind pose).
    expect(blockAction(visual).time).toBeCloseTo(CLIP_SECONDS, 5);
    expect(blockAction(visual).getEffectiveWeight()).toBeGreaterThan(0.99);
  });

  it('control: without the hold the same clip loops, which is the replay the owner saw', async () => {
    const visual = await makeVisual(false);
    visual.update(FRAME, anim(), true);
    const { replays } = braceFor(visual, 6);
    expect(replays).toBeGreaterThanOrEqual(4);
  });

  it('lowers the guard once when the brace ends, and raises it once again on the next', async () => {
    const visual = await makeVisual(true);
    visual.update(FRAME, anim(), true);
    braceFor(visual, 3);
    for (let i = 0; i < Math.ceil(1 / FRAME); i++) visual.update(FRAME, anim(), true);
    expect(currentClipName(visual)).toBe('Idle');
    const { replays } = braceFor(visual, 4);
    expect(replays).toBe(0);
    expect(blockAction(visual).time).toBeCloseTo(CLIP_SECONDS, 5);
  });
});

describe('combatIdleClamps', () => {
  it('clamps only the braced stance, and only for a rig that opts in', () => {
    expect(combatIdleClamps('combatIdle', true)).toBe(true);
    expect(combatIdleClamps('combatIdle', false)).toBe(false);
    expect(combatIdleClamps('combatIdle', undefined)).toBe(false);
    expect(combatIdleClamps('idle', true)).toBe(false);
    expect(combatIdleClamps('walk', true)).toBe(false);
  });

  it('is declared by every muster soldier rig, and on the Block raise', async () => {
    vi.resetModules();
    vi.doUnmock('../src/render/assets/loader');
    const { VISUALS } = await import('../src/render/characters/manifest');
    for (const key of [
      'npc_muster_footman',
      'npc_muster_sergeant',
      'npc_muster_chaplain',
      'npc_muster_captain',
      'npc_muster_drillmaster',
    ]) {
      expect(VISUALS[key]?.clips.combatIdle, key).toBe('Block');
      expect(VISUALS[key]?.clips.combatIdleHold, key).toBe(true);
    }
    // Nobody else changes: every other battle stance keeps looping.
    const holders = Object.entries(VISUALS)
      .filter(([, def]) => def.clips.combatIdleHold)
      .map(([key]) => key)
      .sort();
    expect(holders).toEqual([
      'npc_muster_captain',
      'npc_muster_chaplain',
      'npc_muster_drillmaster',
      'npc_muster_footman',
      'npc_muster_sergeant',
    ]);
  });
});
