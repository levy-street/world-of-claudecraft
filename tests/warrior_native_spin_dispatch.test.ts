import * as THREE from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual as Visual } from '../src/render/characters/visual';

const NATIVE = 'Warrior_Bladestorm_Loop';
let CharacterVisual: typeof Visual;
function source() {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = 'root';
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  body.name = 'body';
  scene.add(body);
  scene.add(root);
  const turns: number[] = [];
  for (let i = 0; i <= 8; i++)
    turns.push(
      ...new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * Math.PI) / 4)
        .toArray(),
    );
  return {
    scene,
    animations: [
      new THREE.AnimationClip('Idle', 1, []),
      new THREE.AnimationClip('1H_Melee_Attack_Chop', 1, []),
      new THREE.AnimationClip('Warrior_Storm_Bolt', 0.62, []),
      new THREE.AnimationClip('Warrior_Avatar', 0.74, []),
      new THREE.AnimationClip('Warrior_Widening_Arc', 0.66, []),
      new THREE.AnimationClip(NATIVE, 0.45, [
        new THREE.QuaternionKeyframeTrack(
          'root.quaternion',
          Array.from({ length: 9 }, (_, i) => (i * 0.45) / 8),
          turns,
        ),
      ]),
    ],
  };
}
beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve(source())),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  const prepare = assets.prepareVisual;
  // This deliberately minimal rig does not carry the Knight body-part names
  // used by its bounds normalizer. Supply a finite identity normalization;
  // action selection, mixer integration and wrapper dispatch all remain real.
  vi.spyOn(assets, 'prepareVisual').mockImplementation((key) => ({
    ...prepare(key),
    normScale: 1,
    yOffset: 0,
  }));
  ({ CharacterVisual } = await import('../src/render/characters/visual'));
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});
function state(overrides: Partial<AnimState> = {}): AnimState {
  return {
    speed: 0,
    moving: false,
    running: false,
    airborne: false,
    backwards: false,
    dead: false,
    casting: true,
    castingAbility: 'bladestorm',
    spinning: true,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
    ...overrides,
  };
}
type Peek = {
  poseWrap: THREE.Group;
  current: THREE.AnimationAction | null;
  currentIsOneShot: boolean;
  actions: Map<string, THREE.AnimationAction>;
  playOneShot(name: string, scale: number): void;
};
function setup() {
  const visual = new CharacterVisual('player_warrior', 0xffffff, 0);
  return { visual, peek: visual as unknown as Peek };
}

it.each([
  ['storm_bolt', 0.02],
  ['avatar', 0.05],
  ['sweeping_strikes', 0.05],
] as const)(
  '%s reaches its full authored pose before the loading beat while keeping the outgoing blend normalized',
  (id, time) => {
    const { visual, peek } = setup();
    try {
      const idle = state({ spinning: false, casting: false, castingAbility: null });
      visual.update(0.3, idle, true);
      visual.playAttack(id);
      visual.update(time, idle, true);
      expect(peek.current?.getClip().name).toBe(`Signature_${id}`);
      expect(peek.current?.getEffectiveWeight()).toBeCloseTo(1, 6);
      const total = [...peek.actions.values()]
        .filter((a) => a.isRunning() || a === peek.current)
        .reduce((sum, a) => sum + a.getEffectiveWeight(), 0);
      expect(total).toBeCloseTo(1, 6);
      visual.playAttack(id);
      visual.update(0.005, idle, true);
      expect(peek.current?.getEffectiveWeight()).toBe(1);
    } finally {
      visual.dispose();
    }
  },
);

it('retains the ordinary entry blend for the generic fallback', () => {
  const { visual, peek } = setup();
  try {
    const idle = state({ spinning: false, casting: false, castingAbility: null });
    visual.update(0.3, idle, true);
    peek.playOneShot('1H_Melee_Attack_Chop', 1);
    visual.update(0.05, idle, true);
    expect(peek.current?.getEffectiveWeight()).toBeCloseTo(0.5, 5);
  } finally {
    visual.dispose();
  }
});

it('lets the selected native loop own exactly one world-space turn without wrapper rotation', () => {
  const { visual, peek } = setup();
  try {
    // Finish the ordinary entry crossfade before measuring a complete cycle.
    for (let i = 0; i < 60; i++) visual.update(0.005, state(), true);
    expect(peek.current?.getClip().name).toBe(NATIVE);
    expect(peek.currentIsOneShot).toBe(false);
    const bone = visual.root.getObjectByName('root');
    if (!bone) throw new Error('Native root bone missing');
    const forward = new THREE.Vector3(),
      quaternion = new THREE.Quaternion();
    let previous = 0,
      turn = 0;
    for (let i = 0; i <= 90; i++) {
      if (i) visual.update(0.005, state(), true);
      visual.root.updateMatrixWorld(true);
      expect(bone.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      forward.set(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(quaternion));
      const yaw = Math.atan2(forward.x, forward.z);
      if (i) turn += Math.atan2(Math.sin(yaw - previous), Math.cos(yaw - previous));
      previous = yaw;
    }
    expect(turn).toBeCloseTo(Math.PI * 2, 3);
    expect(peek.poseWrap.rotation.y).toBe(0);
    visual.update(0.01, state({ spinning: false, casting: false, castingAbility: null }), true);
    expect(peek.poseWrap.rotation.y).toBe(0);
    visual.update(0.01, state({ dead: true }), true);
    expect(peek.poseWrap.rotation.y).toBe(0);
  } finally {
    visual.dispose();
  }
});

it('keeps the generic clip fallback rotating and clears it on stop and death', () => {
  const { visual, peek } = setup();
  try {
    peek.actions.delete(NATIVE);
    visual.update(0.05, state(), true);
    expect(peek.current?.getClip().name).toBe('1H_Melee_Attack_Chop');
    expect(peek.poseWrap.rotation.y).toBeCloseTo(0.7);
    visual.update(0.05, state({ spinning: false, casting: false, castingAbility: null }), true);
    expect(peek.poseWrap.rotation.y).toBe(0);
    visual.update(0.05, state(), true);
    expect(peek.poseWrap.rotation.y).toBeCloseTo(0.7);
    visual.update(0.05, state({ dead: true }), true);
    expect(peek.poseWrap.rotation.y).toBe(0);
  } finally {
    visual.dispose();
  }
});

it('does not suppress the ordinary one-shot whirl or a one-shot action bearing the native name', () => {
  const { visual, peek } = setup();
  try {
    const idle = state({ spinning: false, casting: false, castingAbility: null });
    visual.update(0, idle, true);
    visual.playWhirl();
    visual.update(0.02, idle, true);
    expect(peek.currentIsOneShot).toBe(true);
    expect(peek.poseWrap.rotation.y).toBeGreaterThan(0);
    visual.update(1, idle, true);
    expect(peek.poseWrap.rotation.y).toBe(0);
    peek.playOneShot(NATIVE, 1);
    visual.update(0.02, state(), true);
    expect(peek.currentIsOneShot).toBe(true);
    expect(peek.current?.getClip().name).toBe(NATIVE);
    expect(peek.poseWrap.rotation.y).toBeCloseTo(0.28);
  } finally {
    visual.dispose();
  }
});
