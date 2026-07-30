import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { ANIM_REPAIR_FRAMES, POSE_DRIVE_MIN_WEIGHT } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import type { Entity } from '../src/sim/types';

// A three.js SkinnedMesh renders BIND POSE (the T-pose) whenever the summed
// effective weight of the mixer's scheduled actions falls short of 1: the
// PropertyMixer blends the deficit back toward the bind transform. Every case
// below drives a REAL CharacterVisual through a real AnimationMixer and asserts
// on that sum, which is the quantity players see as a T-pose.

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
  sitting: false,
  ...over,
});

/** The training dummy's whole ClipMap, as a minimally real GLB. */
function stubGltf() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
}

/** The mixer state the visual keeps private; reading it is the only way to
 *  measure the bind-pose deficit that the bug renders as a T-pose. */
type MixerPeek = { actions: Map<string, THREE.AnimationAction> };

function poseWeight(visual: CharacterVisual): number {
  const actions = (visual as unknown as MixerPeek).actions;
  let total = 0;
  for (const action of actions.values()) {
    if (action.isScheduled()) total += action.getEffectiveWeight();
  }
  return total;
}

async function makeVisual(): Promise<CharacterVisual> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
  await preloadTrainingDummyAssets();
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const visual = createCharacterVisual(dummyEntity);
  if (!visual) throw new Error('test harness failed to build a CharacterVisual');
  return visual;
}

describe('CharacterVisual keeps something driving the rig', () => {
  let visual: CharacterVisual;

  beforeEach(async () => {
    visual = await makeVisual();
    visual.update(FRAME, anim(), true);
  });

  it('starts and stays driven while a held state runs', () => {
    for (let i = 0; i < 10; i++) visual.update(FRAME, anim({ moving: true, speed: 2 }), true);
    expect(poseWeight(visual)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });

  it('re-drives a rig that was left with no action at all, within the debounce window', () => {
    // The whole H1 class in one shape: something stopped every action while a
    // HELD state (strafe/cast/walk) was running, so no base-state edge is ever
    // coming to repair it. Nothing else in the machine can recover from this.
    const actions = (visual as unknown as MixerPeek).actions;
    for (const action of actions.values()) action.stop();
    expect(poseWeight(visual)).toBe(0);

    for (let i = 0; i < ANIM_REPAIR_FRAMES; i++) {
      visual.update(FRAME, anim({ moving: true, speed: 2 }), true);
    }
    expect(poseWeight(visual)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });

  it('does not wait for the mixer to catch up when the rig is throttled', () => {
    const actions = (visual as unknown as MixerPeek).actions;
    for (const action of actions.values()) action.stop();
    for (let i = 0; i < ANIM_REPAIR_FRAMES; i++) visual.update(FRAME, anim(), false);
    expect(poseWeight(visual)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });

  it('never blends toward bind pose across death and respawn (the rez T-pose)', () => {
    const weights: number[] = [];
    for (let i = 0; i < 6; i++) {
      visual.update(FRAME, anim({ dead: true }), true);
      weights.push(poseWeight(visual));
    }
    // ...and back up, standing still: with no base-state edge on the revive
    // frame, revive()'s own hand-off is the only thing driving the rig, and it
    // must hand the incoming clip an outgoing partner (the clamped death pose).
    for (let i = 0; i < 6; i++) {
      visual.update(FRAME, anim(), true);
      weights.push(poseWeight(visual));
    }
    expect(Math.min(...weights)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });

  it('never blends toward bind pose when the same swing clip re-triggers', () => {
    const weights: number[] = [];
    for (let swing = 0; swing < 3; swing++) {
      visual.playAttack();
      for (let i = 0; i < 4; i++) {
        visual.update(FRAME, anim(), true);
        weights.push(poseWeight(visual));
      }
    }
    expect(Math.min(...weights)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });

  it('leaves a dead rig on a real pose when its rig ships no death clip', () => {
    // dead-lock freezes the watchdog, so enterDeath is the only repair there is.
    const actions = (visual as unknown as MixerPeek).actions;
    actions.delete('Death');
    for (const action of actions.values()) action.stop();
    visual.update(FRAME, anim({ dead: true }), true);
    expect(poseWeight(visual)).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
  });
});
