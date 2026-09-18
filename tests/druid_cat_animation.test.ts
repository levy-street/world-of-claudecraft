import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { locomotionTimeScale, POSE_DRIVE_MIN_WEIGHT } from '../src/render/characters/anim_state';
import type { CharacterVisual } from '../src/render/characters/visual';
import { newLocoTrack, updateLocomotion } from '../src/render/locomotion';
import type { Entity } from '../src/sim/types';

const CAT_CLIPS = [
  'Attack_Left',
  'Attack_Right',
  'Bite',
  'Death',
  'Fall',
  'Finisher',
  'Hit_Left',
  'Idle_Look',
  'Jump',
  'Land',
  'Pounce',
  'ProwlIdle',
  'ProwlWalk',
  'Run',
  'Swim',
  'Walk',
  'WalkBack',
];
// Keep the production mixer's cadence assertions tied to the shipped clip times.
const glb = readFileSync(new URL('../public/models/creatures/druid_cat_form.glb', import.meta.url));
const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12))) as {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max: number[] }[];
};
const clipDurations = new Map(
  gltf.animations.map((clip) => [
    clip.name,
    Math.max(...clip.samplers.map((sampler) => gltf.accessors[sampler.input].max[0])),
  ]),
);
const FRAME = 1 / 60;
const state = (over: Partial<AnimState> = {}): AnimState => ({
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
const entity = (wolf = false) =>
  ({
    kind: 'player',
    id: 1,
    templateId: wolf ? 'shaman' : 'druid',
    color: 0xffffff,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [wolf ? { kind: 'buff_speed', id: 'ghost_wolf' } : { kind: 'form_cat', id: 'cat_form' }],
  }) as unknown as Entity;

type MixerPeek = {
  key: string;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction;
  poseWrap: THREE.Object3D;
};
const peek = (visual: CharacterVisual) => visual as unknown as MixerPeek;

/** Small real skinned fixture. Geometry quality is covered by the asset
 *  contract; these tests exercise the production factory, mixer and transitions. */
function stubGltf() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'CatRoot';
  const geometry = new THREE.BoxGeometry(1, 1, 2);
  const count = geometry.getAttribute('position').count;
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  body.add(bone);
  body.bind(new THREE.Skeleton([bone]));
  scene.add(body);
  return {
    scene,
    animations: [...CAT_CLIPS, 'Gallop', 'Attack', 'Idle_HitReact_Left', 'Idle_HitReact_Right'].map(
      (name) =>
        new THREE.AnimationClip(name, clipDurations.get(name) ?? 1, [
          new THREE.NumberKeyframeTrack('CatRoot.position[x]', [0, 0.5, 1], [0, 0.01, 0]),
        ]),
    ),
  };
}

describe('druid cat production animation runtime', () => {
  let create: typeof import('../src/render/characters/index').createCharacterVisual;
  let visual: CharacterVisual;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const { charactersReady } = await import('../src/render/characters/assets');
    await charactersReady();
    create = (await import('../src/render/characters/index')).createCharacterVisual;
  });

  beforeEach(() => {
    const built = create(entity(), 'form_cat');
    if (!built) throw new Error('Cat test fixture failed to load');
    visual = built;
    visual.update(FRAME, state(), true);
  });

  afterEach(() => visual?.dispose());

  const advance = (s: AnimState, frames = 90) => {
    for (let i = 0; i < frames; i++) {
      visual.update(FRAME, s, true);
      const weight = [...peek(visual).actions.values()].reduce(
        (sum, action) => sum + (action.isScheduled() ? action.getEffectiveWeight() : 0),
        0,
      );
      expect(weight).toBeGreaterThan(1 - POSE_DRIVE_MIN_WEIGHT);
    }
  };
  const active = () => peek(visual).current.getClip().name;

  it('binds the full cat set while the shaman still builds the original wolf', () => {
    expect(peek(visual).key).toBe('form_cat');
    expect(visual.swimHeadHeight).toBe(1.74);
    expect(visual.gait).toEqual({ runEnter: 3.2, runExit: 2.6 });
    expect(
      [...peek(visual).actions.keys()].filter((name) => CAT_CLIPS.includes(name)).sort(),
    ).toEqual([...CAT_CLIPS].sort());
    const wolf = create(entity(true), 'form_cat');
    expect(wolf && peek(wolf).key).toBe('form_ghost_wolf');
    expect(wolf?.swimHeadHeight).toBe(1.6 * 0.42);
    expect(wolf?.gait).toBeUndefined();
    wolf?.dispose();
  });

  it('holds the gliding jump past clip duration and lands only on touchdown', () => {
    advance(state({ airborne: true }), 120);
    expect(active()).toBe('Jump');
    expect(peek(visual).current.paused).toBe(true);
    expect(peek(visual).actions.get('Land')?.isScheduled()).toBe(false);
    visual.update(FRAME, state(), true);
    expect(active()).toBe('Land');
    advance(state());
    expect(active()).toBe('Idle_Look');
  });

  it('enters stationary paddling after a jump into water without a ground landing', () => {
    advance(state({ airborne: true }), 70);
    visual.update(FRAME, state({ swimming: true }), true);
    expect(active()).toBe('Swim');
    expect(peek(visual).actions.get('Land')?.isScheduled()).toBe(false);
  });

  it.each([
    [{ airborne: true }, 'Jump'],
    [{ swimming: true }, 'Swim'],
  ] as const)(
    'interrupts a ground recovery immediately for the next physical pose',
    (motion, clip) => {
      advance(state({ airborne: true }), 70);
      visual.update(FRAME, state(), true);
      expect(active()).toBe('Land');
      visual.update(FRAME, state(motion), true);
      expect(active()).toBe(clip);
      advance(state(motion));
    },
  );

  it.each([
    [{ moving: true, running: true, speed: 7 }, 'Run'],
    [{ moving: true, stealthed: true, speed: 6.65 }, 'ProwlWalk'],
  ] as const)('hands a moving touchdown straight to the live gait', (motion, clip) => {
    advance(state({ airborne: true }), 70);
    visual.update(FRAME, state(motion), true);
    expect(active()).toBe(clip);
    advance(state(motion));
  });

  it('enters prowl without a relaxed fidget and returns to the combat stance', () => {
    advance(state({ stealthed: true, combat: true }), 180);
    expect(active()).toBe('ProwlIdle');
    advance(state({ stealthed: true, moving: true, running: true, speed: 6.65 }));
    expect(active()).toBe('ProwlWalk');
    advance(state({ stealthed: true, moving: true, backwards: true, speed: 4.32 }));
    expect(peek(visual).current.timeScale).toBeLessThan(0);
    // The compact set has no combat idle: the stance is the plain idle.
    advance(state({ combat: true }));
    expect(active()).toBe('Idle_Look');
  });

  it('foot-matches a slowed run through the cat gait and timing metadata', () => {
    const track = newLocoTrack();
    for (let i = 0; i < 60; i++) {
      updateLocomotion(track, 0, 7 * FRAME, 0, FRAME, visual.gait);
    }
    for (let i = 0; i < 90; i++) {
      const motion = updateLocomotion(track, 0, 2.8 * FRAME, 0, FRAME, visual.gait);
      visual.update(FRAME, state(motion), true);
    }
    expect(active()).toBe('Run');
    // A humanoid's .6 minimum would drag the feet faster than this slowed cat.
    expect(peek(visual).current.timeScale).toBeLessThan(0.6);
    expect(peek(visual).current.timeScale).toBeGreaterThan(0.3);
  });

  it('keeps walks and stalking slower than a run at the actual game speeds', () => {
    const cadence = (speed: number, flags: Partial<AnimState>, clip: string) => {
      advance(state({ moving: true, speed, ...flags }));
      expect(active()).toBe(clip);
      return Math.abs(peek(visual).current.timeScale) / peek(visual).current.getClip().duration;
    };
    const run = cadence(7, { running: true }, 'Run');
    // 7 / 9.13075 timeScale over the .6s cycle: the 1.92 cat gallops about
    // 1.28 cycles a second (the 1.1 build ran 2.2).
    expect(run).toBeGreaterThan(1.15);
    expect(run).toBeLessThan(1.4);
    expect(cadence(2.2, {}, 'Walk')).toBeLessThan(run);
    expect(cadence(3, {}, 'Walk')).toBeLessThan(run);
    expect(cadence(4.55, { backwards: true }, 'WalkBack')).toBeLessThan(run);
    expect(cadence(6.65, { stealthed: true, running: true }, 'ProwlWalk')).toBeLessThan(run);
    const dash = cadence(10.5, { running: true }, 'Run');
    expect(dash).toBeGreaterThan(run);
    expect(dash).toBeLessThanOrEqual(3.5);
  });

  it.each([
    [3, {}, 'Walk', 2.78992],
    [4.55, { backwards: true }, 'WalkBack', 4.82101],
    [6.65, { stealthed: true, running: true }, 'ProwlWalk', 5.47846],
    [10.5, { running: true }, 'Run', 9.13075],
    [4.2, { wading: true }, 'Walk', 2.78992],
  ] as const)('matches planted foot speed at %s with %s (%s)', (speed, flags, clip, reference) => {
    advance(state({ moving: true, speed, ...flags }));
    expect(active()).toBe(clip);
    expect(Math.abs(peek(visual).current.timeScale) * reference).toBeCloseTo(speed, 4);
  });

  it('clamps every gait against the shared rate ceilings (the cat sets none of its own)', () => {
    for (const [base, ceiling] of [
      ['walk', 1.8],
      ['walkBack', 1.8],
      ['prowlWalk', 1.8],
      ['run', 1.6],
      ['wade', 1.45],
    ] as const) {
      expect(locomotionTimeScale(base, state({ speed: 100 }))).toBe(ceiling);
    }
  });

  it('wades on the walk cycle (no wade clip) while the original wolf retains its water cadence', () => {
    advance(state({ moving: true, wading: true, speed: 2.2 }));
    expect(active()).toBe('Walk');
    expect(locomotionTimeScale('wade', state({ speed: 2.2 }))).toBe(0.65);
    expect(locomotionTimeScale('wade', state({ speed: 4.2 }))).toBe(1);
  });

  it('uses the dedicated deep fall and lets death win over a touchdown', () => {
    advance(state({ airborne: true, falling: true }));
    expect(active()).toBe('Fall');
    advance(state({ dead: true }));
    expect(active()).toBe('Death');
    expect(peek(visual).actions.get('Land')?.isScheduled()).toBe(false);
    visual.update(FRAME, state(), true);
    expect(active()).toBe('Idle_Look');
    advance(state());
    expect(active()).toBe('Idle_Look');
  });

  it('sits on the idle (the compact set has no seated clips) and stands back into a walk', () => {
    visual.update(FRAME, state({ sitting: true }), true);
    advance(state({ sitting: true }));
    expect(active()).toBe('Idle_Look');
    advance(state({ moving: true, backwards: true, speed: 4.55 }));
    expect(active()).toBe('WalkBack');
  });

  it('keeps horizontal paddling at its authored waterline through a swim stop', () => {
    advance(state({ swimming: true, moving: true, speed: 3.2 }));
    expect(active()).toBe('Swim');
    const movingRise = peek(visual).poseWrap.position.y;
    // The authored .21 rise has at most .08 of procedural bob, in either pose.
    expect(movingRise).toBeGreaterThanOrEqual(0.13 - 0.0001);
    expect(movingRise).toBeLessThanOrEqual(0.29 + 0.0001);
    advance(state({ swimming: true }));
    expect(active()).toBe('Swim');
    expect(peek(visual).poseWrap.position.y).toBeGreaterThanOrEqual(0.13 - 0.0001);
    expect(peek(visual).poseWrap.position.y).toBeLessThanOrEqual(0.29 + 0.0001);
    expect(Math.abs(peek(visual).poseWrap.position.y - movingRise)).toBeLessThan(0.2);
    advance(state({ swimming: true, moving: true, submerged: true, speed: 3.2 }));
    expect(active()).toBe('Swim');
    advance(state({ moving: true, wading: true, speed: 4.2 }));
    expect(active()).toBe('Walk');
  });

  it.each([
    ['claw', 'Attack_Left'],
    ['rake', 'Attack_Right'],
    ['ferocious_bite', 'Bite'],
    ['rip', 'Finisher'],
    ['pounce', 'Pounce'],
    ['redharvest', 'Finisher'],
  ])('plays the authored %s action at its original timing', (ability, clip) => {
    visual.playAttack(ability);
    expect(active()).toBe(clip);
    expect(peek(visual).current.timeScale).toBe(1);
    advance(state());
    expect(active()).toBe('Idle_Look');
  });

  it('alternates auto-attack swipes and gives utility buffs no attack gesture', () => {
    visual.playAttack();
    expect(active()).toBe('Attack_Left');
    advance(state());
    visual.playAttack();
    expect(active()).toBe('Attack_Right');
    for (const ability of ['prowl', 'dash', 'tigers_fury', 'cat_form']) {
      expect(visual.hasAttackClipOverride(ability)).toBe(false);
    }
  });
});
