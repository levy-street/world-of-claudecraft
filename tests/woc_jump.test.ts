// @vitest-environment happy-dom
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { VISUALS } from '../src/render/characters/manifest';
import type { CharacterVisual } from '../src/render/characters/visual';
import { landWocBodies } from './helpers/woc_streamed';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => ({
    scene: new THREE.Group(),
    // Include the discarded experiment's clips to prove the runtime never
    // selects them, even if an old cached asset supplies them.
    animations: [
      'Idle',
      'Walk',
      'Run',
      'Jump',
      'Fall',
      'Land',
      'Jump_Start',
      'Jump_Land',
      'Death',
      'Swim',
    ].map((name) => new THREE.AnimationClip(name, name === 'Land' ? 0.6 : 1, [])),
  })),
  loadTexture: vi.fn(async () => new THREE.Texture()),
  loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
  releaseGltf: vi.fn(),
}));

const state = (overrides: Partial<AnimState> = {}): AnimState => ({
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
});

type MixerView = { current: THREE.AnimationAction; actions: Map<string, THREE.AnimationAction> };
const current = (visual: CharacterVisual) => (visual as unknown as MixerView).current;
const tick = (visual: CharacterVisual, input: Partial<AnimState>, count = 1) => {
  for (let frame = 0; frame < count; frame++) visual.update(1 / 60, state(input), true);
};
let Visual: typeof CharacterVisual;
beforeAll(async () => {
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  await landWocBodies(assets);
  Visual = (await import('../src/render/characters/visual')).CharacterVisual;
});

const keys = Object.entries(VISUALS)
  .filter(([, def]) => def.wocCharacter)
  .map(([key]) => key);

describe('WOC jumps hold in the air and land on touchdown', () => {
  it('covers every class and both body types with the held jump, the flail and the landing', () => {
    expect(keys).toHaveLength(18);
    for (const key of keys) {
      expect(VISUALS[key].clips.jump, key).toBe('Jump');
      expect(VISUALS[key].clips.fall, key).toBe('Fall');
      expect(VISUALS[key].clips.land, key).toBe('Land');
      expect(VISUALS[key].wocCharacter?.animationNames, key).toContain('Land');
      expect(VISUALS[key].wocCharacter?.animationNames, key).not.toContain('Jump_Land');
    }
  });

  it.each(keys)('%s lands standing, runs straight out of a moving touchdown', (key) => {
    const visual = new Visual(key, 0xffffff, 0);
    for (let jump = 0; jump < 3; jump++) {
      tick(visual, { airborne: true }, 90);
      expect(current(visual).getClip().name).toBe('Jump');
      // standing touchdown: the landing one-shot, then back to the idle
      tick(visual, {});
      expect(current(visual).getClip().name).toBe('Land');
      tick(visual, {}, 60);
      expect(current(visual).getClip().name).toBe('Idle');
      expect(current(visual).getEffectiveWeight()).toBeCloseTo(1);
      // moving touchdown: the landing yields to the run at once
      tick(visual, { airborne: true }, 30);
      tick(visual, { moving: true, running: true, speed: 7 }, 2);
      expect(current(visual).getClip().name).toBe('Run');
      tick(visual, {}, 30);
    }
    expect((visual as unknown as MixerView).actions.has('Jump_Land')).toBe(false);
    visual.dispose();
  });

  it('enters swimming or death directly after an airborne frame', () => {
    for (const [input, clip] of [
      [{ swimming: true, moving: true }, 'Swim'],
      [{ dead: true }, 'Death'],
    ] as const) {
      const visual = new Visual('player_warrior', 0xffffff, 0);
      tick(visual, { airborne: true }, 30);
      tick(visual, input);
      expect(current(visual).getClip().name).toBe(clip);
      visual.dispose();
    }
  });
});
