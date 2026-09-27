import * as THREE from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual as Visual } from '../src/render/characters/visual';

const ARRIVAL = 'Warrior_Onrush_Arrival';
let CharacterVisual: typeof Visual;
beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
      return Promise.resolve({
        scene,
        animations: [
          'Idle',
          'Running_A',
          'Walking_A',
          'Death_A',
          'Jump_Idle',
          '1H_Melee_Attack_Chop',
          '1H_Melee_Attack_Slice_Diagonal',
          'Warrior_Rush_Loop',
          ARRIVAL,
          'Warrior_Brute_Swing',
        ].map((name) => new THREE.AnimationClip(name, name === ARRIVAL ? 0.3 : 1, [])),
      });
    }),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  const prepare = assets.prepareVisual;
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
    casting: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
    ...overrides,
  };
}
function setup() {
  const visual = new CharacterVisual('player_warrior', 0xffffff, 0);
  const peek = visual as unknown as { current: THREE.AnimationAction | null };
  visual.update(0.01, state(), true);
  visual.playAttack('charge');
  visual.update(0.1, state({ moving: true, speed: 21, running: true }), true);
  return { visual, name: () => peek.current?.getClip().name };
}

it('binds and plays arrival once, replacing no real attack with a synthetic final swing', () => {
  const { visual, name } = setup();
  try {
    expect(name()).toBe('Warrior_Rush_Loop');
    // Sim damage is delivered before the following VFX sync/arrival callback.
    visual.update(0.03, state(), true);
    visual.playAttack();
    expect(name()).not.toContain('Melee_Attack');
    visual.arriveFromOnrush();
    visual.update(0.01, state(), true);
    expect(name()).toBe(ARRIVAL);
    visual.playAttack();
    expect(name()).toBe(ARRIVAL);
    for (let i = 0; i < 35; i++) visual.update(0.01, state(), true);
    expect(visual.isPerformingAbility).toBe(false);
    visual.playAttack();
    expect(name()).toBe('1H_Melee_Attack_Chop');
    visual.arriveFromOnrush();
    visual.update(0.01, state(), true);
    expect(name()).toBe('1H_Melee_Attack_Chop');
  } finally {
    visual.dispose();
  }
});

it.each([false, true])('a new explicit ability interrupts arrival, playing=%s', (playing) => {
  const { visual, name } = setup();
  try {
    visual.arriveFromOnrush();
    if (playing) visual.update(0.01, state(), true);
    visual.playAttack('slam');
    visual.update(0.01, state(), true);
    expect(name()).toBe('Signature_slam');
  } finally {
    visual.dispose();
  }
});

it.each(['moving', 'airborne', 'swimming', 'dead', 'casting'] as const)(
  'the planted arrival immediately yields to %s',
  (key) => {
    const { visual, name } = setup();
    try {
      visual.arriveFromOnrush();
      visual.update(0.01, state(), true);
      expect(name()).toBe(ARRIVAL);
      visual.update(0.01, state({ [key]: true, speed: key === 'moving' ? 7 : 0 }), true);
      expect(name()).not.toBe(ARRIVAL);
    } finally {
      visual.dispose();
    }
  },
);

it('Intervene and a charge stopped without an arrival cue never enter the new clip', () => {
  for (const escort of [true, false]) {
    const { visual, name } = setup();
    try {
      if (escort) {
        visual.playAttack('intervene');
        visual.update(0.1, state({ moving: true, speed: 21, running: true }), true);
        visual.arriveFromOnrush();
      }
      visual.update(0.2, state(), true);
      expect(name()).not.toBe(ARRIVAL);
      expect(visual.isPerformingAbility).toBe(false);
    } finally {
      visual.dispose();
    }
  }
});
