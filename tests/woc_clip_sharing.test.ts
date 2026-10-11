// Animation data is shared between rigs, never copied per rig: the two halves a clip is
// cut into at build (ClipMap.dualWieldSplit, ClipMap.clipSplits: clip_split.ts
// sharedClipSplit) and the twin clip a one-shot re-triggers through (clip_twin.ts). A clip is
// immutable data and a mixer binds per root, so every CharacterVisual keeps its OWN actions
// over the same clips. Real CharacterVisuals over a stubbed loader; the cut itself and the
// twin store are pinned without a visual in clip_split.test.ts and clip_twin.test.ts.
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { CharacterVisual as CharacterVisualType } from '../src/render/characters/visual';
import { methodBody } from './helpers/method_body';
import { landWocBodies } from './helpers/woc_streamed';

type Peek = {
  current: THREE.AnimationAction | null;
  loadoutSwap: Readonly<Record<string, string>> | null;
  mixer: THREE.AnimationMixer;
  hasClip: (name: string) => boolean;
  action(name: string | undefined): THREE.AnimationAction | null;
};
const peek = (v: CharacterVisualType): Peek => v as unknown as Peek;

const IDLE: AnimState = {
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
};

/** The stub animation library: one 1 s clip per name. `Combat_Idle_Single` is the only
 *  loadout variant it carries (`1H_Chop_Single` is left out on purpose). */
const LIBRARY = [
  'Idle',
  'Walk',
  'Run',
  'Combat_Idle',
  'Combat_Idle_Single',
  '1H_Chop',
  '1H_Slash',
  '2H_Chop',
  'Dual_Chop',
  'Ranged_Shoot',
  'Cast_Loop',
  'Cast_Shoot',
];

/** A module world whose loader hands every file its own copy of the stub library, as two
 *  files of the real pack hold two sets of clips: the male and the female animation
 *  library are different source clips. */
async function world(keys: readonly string[]) {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() =>
      Promise.resolve({
        scene: new THREE.Group(),
        animations: LIBRARY.map((name) => new THREE.AnimationClip(name, 1, [])),
      }),
    ),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  await landWocBodies(assets, keys);
  const { CharacterVisual } = await import('../src/render/characters/visual');
  const built: CharacterVisualType[] = [];
  return {
    build: (key: string): CharacterVisualType => {
      const visual = new CharacterVisual(key, 0xffffff, 0);
      built.push(visual);
      return visual;
    },
    disposeAll: () => {
      for (const visual of built.splice(0)) visual.dispose();
    },
  };
}

function need(action: THREE.AnimationAction | null): THREE.AnimationAction {
  if (!action) throw new Error('the rig carries no such clip');
  return action;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/render/assets/loader');
});

describe('the halves a clip is cut into are minted once per source clip', () => {
  const HUNTER_HALVES = ['Ranged_Shoot#aim', 'Ranged_Shoot#release'];
  const DUAL_HALVES = ['Dual_Chop#main', 'Dual_Chop#off'];

  it('two rigs of one key hold the same two clips, each on actions of its own', async () => {
    const w = await world(['player_hunter']);
    const a = w.build('player_hunter');
    const b = w.build('player_hunter');
    for (const name of HUNTER_HALVES) {
      const mine = need(peek(a).action(name));
      const theirs = need(peek(b).action(name));
      expect(mine.getClip().name).toBe(name);
      expect(mine.getClip(), name).toBe(theirs.getClip());
      expect(mine, name).not.toBe(theirs);
    }
    // the cut itself is what it was: the hunter's 0.17 s aim, the rest its release
    expect(need(peek(a).action('Ranged_Shoot#aim')).getClip().duration).toBeCloseTo(0.17, 5);
    expect(need(peek(a).action('Ranged_Shoot#release')).getClip().duration).toBeCloseTo(0.83, 5);
    w.disposeAll();
  }, 40000);

  it('every class of one body cuts one pair, and the other body cuts its own', async () => {
    const dual = ['warrior', 'paladin', 'rogue', 'shaman'];
    const w = await world(dual.flatMap((cls) => [`player_${cls}`, `player_${cls}_female`]));
    for (const name of DUAL_HALVES) {
      const male = dual.map((cls) => need(peek(w.build(`player_${cls}`)).action(name)).getClip());
      const female = dual.map((cls) =>
        need(peek(w.build(`player_${cls}_female`)).action(name)).getClip(),
      );
      // one animation library per body fit: its four dual-wield classes share its halves
      expect(new Set(male).size, name).toBe(1);
      expect(new Set(female).size, name).toBe(1);
      // another library is other source clips: never the same halves
      expect(female[0], name).not.toBe(male[0]);
      expect(male[0].name).toBe(name);
      expect(female[0].name).toBe(name);
    }
    w.disposeAll();
  }, 40000);

  it('plays a shared half on one rig without moving the other, and outlives a disposed rig', async () => {
    const w = await world(['player_hunter']);
    const a = w.build('player_hunter');
    const b = w.build('player_hunter');
    for (const v of [a, b]) v.update(1 / 60, IDLE, true);
    // the damage-event arm of a timed shot plays the release half
    a.playAttack('aimed_shot');
    expect(peek(a).current?.getClip().name).toBe('Ranged_Shoot#release');
    a.update(0.1, IDLE, true);
    b.update(0.1, IDLE, true);
    const released = need(peek(a).action('Ranged_Shoot#release'));
    const idle = need(peek(b).action('Ranged_Shoot#release'));
    expect(released.time).toBeGreaterThan(0);
    expect(released.isRunning()).toBe(true);
    expect(idle.time).toBe(0);
    expect(idle.isRunning()).toBe(false);
    // a rig that goes takes its mixer and actions, never the clip its neighbour plays
    const shared = released.getClip();
    a.dispose();
    b.playAttack('aimed_shot');
    b.update(0.1, IDLE, true);
    expect(peek(b).current).toBe(idle);
    expect(need(peek(b).current).getClip()).toBe(shared);
    expect(idle.time).toBeGreaterThan(0);
    // ...and a rig built after that one went is handed the same half again
    const c = w.build('player_hunter');
    expect(need(peek(c).action('Ranged_Shoot#release')).getClip()).toBe(shared);
    w.disposeAll();
  }, 40000);
});

describe('a one-shot started again mid-play crossfades through its twin', () => {
  /** Start the same strike twice on a rig, a tenth of a second apart. */
  function strikeTwice(v: CharacterVisualType) {
    v.update(1 / 60, IDLE, true);
    v.playAttack('raptor_strike', false, 'melee');
    const first = need(peek(v).current);
    v.update(0.1, IDLE, true);
    v.playAttack('raptor_strike', false, 'melee');
    const twin = need(peek(v).current);
    return { first, twin };
  }

  it('plays a second action of the same clip from the top while the first still runs', async () => {
    const w = await world(['player_hunter']);
    const v = w.build('player_hunter');
    const { first, twin } = strikeTwice(v);
    expect(first.getClip().name).toBe('1H_Chop');
    expect(twin).not.toBe(first);
    // one action cannot crossfade into itself, and a mixer keeps one action per clip and
    // root: the twin is another clip object under the same name
    expect(twin.getClip().name).toBe('1H_Chop');
    expect(twin.getClip()).not.toBe(first.getClip());
    expect(twin.getClip().duration).toBe(first.getClip().duration);
    expect(twin.time).toBe(0);
    expect(twin.isRunning()).toBe(true);
    // the first is the outgoing partner: still scheduled, fading under the twin
    expect(first.time).toBeGreaterThan(0);
    expect(first.isRunning()).toBe(true);
    // a third start goes back to the first action: the two alternate, no third is minted
    v.update(0.1, IDLE, true);
    v.playAttack('raptor_strike', false, 'melee');
    expect(peek(v).current).toBe(first);
    v.update(0.1, IDLE, true);
    v.playAttack('raptor_strike', false, 'melee');
    expect(peek(v).current).toBe(twin);
    w.disposeAll();
  }, 40000);

  it('mints the twin clip once per source clip: every rig twins through the same one', async () => {
    const w = await world(['player_hunter']);
    const first = w.build('player_hunter');
    const second = w.build('player_hunter');
    const a = strikeTwice(first);
    const b = strikeTwice(second);
    expect(b.first.getClip()).toBe(a.first.getClip());
    expect(b.twin.getClip()).toBe(a.twin.getClip());
    // ...each on its own action, in its own mixer
    expect(b.twin).not.toBe(a.twin);
    expect(b.twin.getMixer()).not.toBe(a.twin.getMixer());
    expect(peek(first).mixer.existingAction(a.twin.getClip())).toBe(a.twin);
    expect(peek(second).mixer.existingAction(a.twin.getClip())).toBe(b.twin);
    // the twin ACTION is minted on a rig's first re-trigger, never ahead of it: a rig that
    // struck once binds nothing to the twin clip
    const quiet = w.build('player_hunter');
    quiet.update(1 / 60, IDLE, true);
    quiet.playAttack('raptor_strike', false, 'melee');
    expect(need(peek(quiet).current).getClip()).toBe(a.first.getClip());
    expect(peek(quiet).mixer.existingAction(a.twin.getClip())).toBeNull();
    expect(peek(quiet).mixer.existingAction(a.first.getClip())).toBe(peek(quiet).current);
    w.disposeAll();
  }, 40000);
});

describe('a clip name resolves through the loadout swap with no closure per call', () => {
  it('picks the variant the rig carries, the named clip when it does not, nothing when absent', async () => {
    const w = await world(['player_warrior']);
    const { VISUALS } = await import('../src/render/characters/manifest');
    const v = w.build('player_warrior');
    // a one-hand weapon and an empty off hand: the single set (weapon_loadout_core.ts)
    const single = VISUALS.player_warrior.clips.loadoutSwaps?.single;
    expect(single).toBeDefined();
    expect(peek(v).loadoutSwap).toBe(single);
    expect(single?.Combat_Idle).toBe('Combat_Idle_Single');
    expect(single?.['1H_Chop']).toBe('1H_Chop_Single');
    // the variant is in the library: it plays
    expect(peek(v).action('Combat_Idle')?.getClip().name).toBe('Combat_Idle_Single');
    // the variant is NOT in the library: the named clip plays
    expect(peek(v).action('1H_Chop')?.getClip().name).toBe('1H_Chop');
    // a name the swap does not mention is itself
    expect(peek(v).action('Cast_Loop')?.getClip().name).toBe('Cast_Loop');
    // no clip, no name: no action
    expect(peek(v).action('Not_A_Clip')).toBeNull();
    expect(peek(v).action(undefined)).toBeNull();
    // with no swap set, every name is itself
    peek(v).loadoutSwap = null;
    expect(peek(v).action('Combat_Idle')?.getClip().name).toBe('Combat_Idle');
    w.disposeAll();
  }, 40000);

  it('hoists the has-clip probe: action() itself allocates no function', () => {
    const source = readFileSync('src/render/characters/visual.ts', 'utf8');
    const body = methodBody(source, '  private action(name: string | undefined)');
    // the probe is the field built once with the visual...
    expect(body).toContain('swappedClip(this.loadoutSwap, name, this.hasClip)');
    expect(source.match(/private readonly hasClip = /g)).toHaveLength(1);
    // ...so nothing is built here: about ten calls a frame per body, and a closure made in
    // this method is garbage per call
    expect(body).not.toContain('=>');
    expect(body).not.toContain('function');
    expect(body).not.toContain('.bind(');
  });

  it('keeps one probe per rig for its whole life, reading the rig own clips', async () => {
    const w = await world(['player_warrior']);
    const v = w.build('player_warrior');
    const probe = peek(v).hasClip;
    expect(typeof probe).toBe('function');
    peek(v).action('Combat_Idle');
    peek(v).action('1H_Chop');
    expect(peek(v).hasClip).toBe(probe);
    expect(probe('Combat_Idle_Single')).toBe(true);
    expect(probe('1H_Chop_Single')).toBe(false);
    // another rig has a probe of its own (it closes over that rig's actions)
    expect(peek(w.build('player_warrior')).hasClip).not.toBe(probe);
    w.disposeAll();
  }, 40000);
});
