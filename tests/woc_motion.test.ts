// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { VISUALS, type VisualDef } from '../src/render/characters/manifest';
import type { CharacterVisual } from '../src/render/characters/visual';
import wocAutoAttackContacts from '../src/render/characters/woc_autoattack_contacts.json';
import { WOC_WARRIOR_MANIFEST } from '../src/render/characters/woc_character_manifest';
import { WOC_KEYED_CLIP_NAMES } from '../src/render/characters/woc_keyed_animations';
import { wocAllPartNames } from '../src/render/characters/woc_parts_core';
import { landWocBodies } from './helpers/woc_streamed';

// Keep the runtime assembly, attachment and mixer paths real. Only the disk/
// browser loader is replaced with a tiny rig and clips whose motion is visible
// to the CPU, so a selected but unplayed action cannot satisfy the climb check.
function fixtureGltf(url: string) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.3), new THREE.MeshStandardMaterial());
  mesh.name = 'Character_Body';
  scene.add(mesh);
  if (url.includes('/weapons/')) return { scene, animations: [] };
  const hips = new THREE.Bone();
  hips.name = 'hips';
  scene.add(hips);
  for (const name of ['chest', 'head', 'handslotr', 'handslotl']) {
    const bone = new THREE.Bone();
    bone.name = name;
    hips.add(bone);
  }
  const manifest = Object.values(VISUALS).find((def) => def.url === url)?.wocCharacter;
  for (const name of manifest ? wocAllPartNames(manifest) : []) {
    if (scene.getObjectByName(name)) continue;
    const part = new THREE.Group();
    part.name = name;
    hips.add(part);
  }
  return {
    scene,
    animations: [...WOC_WARRIOR_MANIFEST.animationNames, ...WOC_KEYED_CLIP_NAMES].map((name) => {
      const duration = name === 'Climb' ? 0.3 : 1;
      return new THREE.AnimationClip(name, duration, [
        new THREE.VectorKeyframeTrack(
          'hips.position',
          [0, duration],
          [0, 0, 0, 0, name === 'Climb' ? 0.3 : 0, 0],
        ),
      ]);
    }),
  };
}

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async (url: string) => fixtureGltf(url)),
  loadTexture: vi.fn(async () => new THREE.Texture()),
  loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
  releaseGltf: vi.fn(),
}));

type MixerView = {
  current: THREE.AnimationAction;
  baseState: string;
  actions: Map<string, THREE.AnimationAction>;
  def: VisualDef;
};
const peek = (visual: CharacterVisual) => visual as unknown as MixerView;
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
const tick = (visual: CharacterVisual, input: Partial<AnimState> = {}, frames = 1) => {
  for (let frame = 0; frame < frames; frame++) visual.update(1 / 60, state(input), true);
};

let Visual: typeof CharacterVisual;
let heldProps: (root: THREE.Object3D) => THREE.Object3D[];
const live: CharacterVisual[] = [];
function create(key = 'player_warrior') {
  const visual = new Visual(key, 0xffffff, 0);
  live.push(visual);
  return visual;
}
beforeAll(async () => {
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  await landWocBodies(assets);
  heldProps = assets.heldPropHolders;
  Visual = (await import('../src/render/characters/visual')).CharacterVisual;
});
afterEach(() => {
  for (const visual of live.splice(0)) visual.dispose();
});

describe('WOC authored movement and held props', () => {
  it('plays Climb at authored speed, holds its end, and restores locomotion on release', () => {
    const visual = create();
    tick(visual, { airborne: true }, 20);
    visual.setClimbing(true, 0);
    tick(visual, { airborne: true }, 6);
    const climb = peek(visual).actions.get('Climb');
    expect(climb?.getEffectiveWeight()).toBe(1);
    expect(climb?.timeScale).toBe(1);
    expect(climb?.time).toBeCloseTo(0.1);
    expect(visual.root.getObjectByName('hips')?.position.y).toBeCloseTo(0.1);
    expect(peek(visual).current.getEffectiveWeight()).toBe(0);
    tick(visual, { airborne: true }, 30);
    expect(climb?.time).toBeCloseTo(0.3);
    expect(climb?.paused).toBe(true);
    expect(visual.root.getObjectByName('hips')?.position.y).toBeCloseTo(0.3);

    visual.setClimbing(false);
    tick(visual, { moving: true, running: true, speed: 7 }, 60);
    expect(climb?.isRunning()).toBe(false);
    expect(peek(visual).current.getClip().name).toBe('Woc_Run');
    expect(peek(visual).current.getEffectiveWeight()).toBe(1);
    expect(visual.root.getObjectByName('hips')?.position.y).toBeCloseTo(0);
    // Jump yielded under the climb before Run became current. Its cached
    // action must recover too, or the next jump returns to a zero-weight pose.
    tick(visual, { airborne: true }, 20);
    expect(peek(visual).current.getClip().name).toBe('Woc_Jump');
    expect(peek(visual).current.getEffectiveWeight()).toBe(1);
  });

  it('hides both equipped hands while swimming and restores drawn or stowed props on exit', () => {
    const visual = create();
    expect(visual.setWeapon('worn_sword')).toHaveLength(1);
    expect(visual.setOffhand('rusty_dagger')).toHaveLength(1);
    for (const stowed of [false, true]) {
      visual.setWeaponStowed(stowed);
      tick(visual, {}, 60);
      const holders = heldProps(visual.root);
      expect(holders).toHaveLength(2);
      expect(holders.every((holder) => holder.visible)).toBe(true);
      tick(visual, { swimming: true, moving: true });
      expect(peek(visual).current.getClip().name).toBe('Woc_Swim');
      expect(holders.every((holder) => !holder.visible)).toBe(true);
      tick(visual);
      expect(holders.every((holder) => holder.visible)).toBe(true);
    }
  });
});

describe('WOC attack and shout routing', () => {
  it('alternates individual dual-wield strikes and combines two cues in one mixer frame', () => {
    const visual = create();
    visual.setWeapon('worn_sword');
    visual.setOffhand('rusty_dagger');
    // white swings play the hand-keyed dual set (woc_autoattack_core.ts)
    for (const clip of ['Woc_Attack_Dual#main', 'Woc_Attack_Dual#off', 'Woc_Attack_Dual#main']) {
      visual.playAttack();
      expect(peek(visual).current.getClip().name).toBe(clip);
      expect(peek(visual).current.timeScale).toBe(1);
      tick(visual);
    }
    // both hands in one frame: the whole keyed pair; a third cue that frame rides it
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Woc_Attack_Dual#off');
    visual.playAttack();
    const pair = peek(visual).current;
    expect(pair.getClip().name).toBe('Woc_Attack_Dual');
    visual.playAttack();
    expect(peek(visual).current).toBe(pair);
    tick(visual);
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Woc_Attack_Dual#main');
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Woc_Attack_Dual');
  });

  it('a same-frame pair blends in from the pose the rig was in, not a hard cut', () => {
    const visual = create();
    visual.setWeapon('worn_sword');
    visual.setOffhand('rusty_dagger');
    tick(visual, {}, 20);
    const base = peek(visual).current;
    visual.playAttack();
    visual.playAttack();
    const pair = peek(visual).current;
    expect(pair.getClip().name).toBe('Woc_Attack_Dual');
    // the base keeps driving while the pair fades in (the replaced half never drove a pose)
    tick(visual, {}, 1);
    expect(pair.getEffectiveWeight()).toBeLessThan(1);
    expect(base.getEffectiveWeight()).toBeGreaterThan(0);
    expect(pair.getEffectiveWeight() + base.getEffectiveWeight()).toBeCloseTo(1, 5);
    expect(peek(visual).actions.get('Woc_Attack_Dual#main')?.isRunning()).toBe(false);
  });

  it('reports each swing blade contact for the presentation hold (ClipMap.contacts)', () => {
    const visual = create();
    visual.setWeapon('worn_sword');
    visual.setOffhand('rusty_dagger');
    const contacts = peek(visual).def.clips.contacts ?? {};
    const keyed = wocAutoAttackContacts.male;
    expect(visual.playAttack()).toBeCloseTo(keyed['Woc_Attack_Dual#main'][0], 6);
    // the second hand of a same-frame pair lands on the pair clip's second contact
    expect(visual.playAttack()).toBeCloseTo(keyed.Woc_Attack_Dual[1], 6);
    tick(visual);
    // an ability routed through the one-hand slash plays the X-slash with two blades
    expect(visual.playAttack('overpower')).toBeCloseTo(contacts.Dual_Cross[0], 6);
    expect(peek(visual).current.getClip().name).toBe('Dual_Cross');
  });

  it('the same clip started again mid-swing crossfades from where it is (no snap to frame 0)', () => {
    const visual = create();
    visual.setWeapon('worn_sword');
    tick(visual, {}, 20);
    visual.playAttack('overpower');
    const first = peek(visual).current;
    tick(visual, {}, 12);
    const at = first.time;
    expect(at).toBeGreaterThan(0.1);
    visual.playAttack('overpower');
    const again = peek(visual).current;
    expect(again).not.toBe(first);
    expect(again.getClip().name).toBe(first.getClip().name);
    expect(again.time).toBe(0);
    // the running swing is still there, fading out from where it was
    expect(first.time).toBeCloseTo(at, 6);
    tick(visual, {}, 1);
    expect(first.getEffectiveWeight()).toBeGreaterThan(0);
  });

  it.each([
    [null, 'Woc_Run'],
    [undefined, 'Cheer'],
    ['flex', 'Woc_Emote_Flex'],
  ] as const)(
    'shoutEmote %s preserves suppression, default cheer, or the requested emote',
    (shoutEmote, clip) => {
      const visual = create();
      // Exercise the three supported manifest policies without mutating the
      // shared class definition. Its real emote table and actions remain bound.
      peek(visual).def = {
        ...peek(visual).def,
        clips: { ...peek(visual).def.clips, shoutEmote },
      };
      tick(visual, { moving: true, running: true, speed: 7 }, 20);
      visual.playShout(3);
      expect(peek(visual).current.getClip().name).toBe(clip);
      if (shoutEmote !== null) expect(peek(visual).current.repetitions).toBe(3);
      else expect(visual.isMidOneShot).toBe(false);
    },
  );
});

// Owner call, 2026-09-30: no two-hand stance. A two-hander stays in one fist like a one-hand
// sword and fights on the single set (the shield set without the shield hand raised), through
// the real playAttack / playHit / brace path. The fixture binds exactly the shipped library's
// clips (the *_2H set left it the same day), so a map still pointing at a *_2H name would fall
// back to the default one-hand clip and fail the single-set expectations here. White swings
// play the hand-keyed one-hand set (woc_autoattack_core.ts); named strikes keep the single set.
describe('WOC two-hand weapon: the single set, no two-hand stance', () => {
  const clip = (visual: CharacterVisual) => peek(visual).current.getClip().name;

  it('fights a greatsword in one fist: the auto attack, every strike, the stance and the hit', () => {
    const visual = create();
    visual.setWeapon('eastbrook_greatsword');
    tick(visual, {}, 20);
    expect(clip(visual)).toBe('Woc_Idle');
    // the auto attack swings like the one-hand sword: the keyed one-hand pair in turn, never
    // the both-fists two-hand swing, and the presentation waits for ITS blade
    expect(visual.playAttack()).toBeCloseTo(wocAutoAttackContacts.male.Woc_Attack_1H_0[0], 6);
    expect(clip(visual)).toBe('Woc_Attack_1H_0');
    tick(visual, {}, 90);
    expect(clip(visual)).toBe('Combat_Idle_Single');
    visual.playAttack();
    expect(clip(visual)).toBe('Woc_Attack_1H_1');
    tick(visual, {}, 90);
    expect(clip(visual)).toBe('Combat_Idle_Single');
    for (const [ability, strike] of [
      ['mortal_strike', '1H_Chop_Single'],
      ['execute', '1H_Chop_Single'],
      ['heroic_leap', '1H_Chop_Single'],
      ['thunder_clap', '1H_Chop_Single'],
      ['overpower', '1H_Slash_Single'],
      ['heroic_strike', '1H_Slash_Single'],
    ] as const) {
      visual.playAttack(ability);
      expect(clip(visual), ability).toBe(strike);
      tick(visual, {}, 90);
      expect(clip(visual), ability).toBe('Combat_Idle_Single');
    }
    visual.playHit();
    expect(clip(visual)).toBe('Hit_Single');
  });

  it('routes the paladin and shaman two-hand swings the same way, Final Edict included', () => {
    for (const key of ['player_paladin', 'player_shaman'] as const) {
      const visual = create(key);
      visual.setWeapon('ridgebreaker');
      tick(visual, {}, 20);
      visual.playAttack();
      expect(clip(visual), key).toBe('Woc_Attack_1H_0');
      tick(visual, {}, 90);
      expect(clip(visual), key).toBe('Combat_Idle_Single');
    }
    const paladin = create('player_paladin');
    paladin.setWeapon('eastbrook_greatsword');
    tick(paladin, {}, 20);
    paladin.playAttack('final_edict');
    expect(clip(paladin)).toBe('1H_Chop_Single');
  });

  it("keeps a Titan's Grip pair on the crossed-blade dual set", () => {
    const visual = create();
    visual.setWeapon('eastbrook_greatsword');
    visual.setOffhand('eastbrook_greatsword');
    tick(visual, {}, 20);
    visual.playAttack();
    expect(clip(visual)).toBe('Woc_Attack_Dual#main');
    tick(visual, {}, 90);
    expect(clip(visual)).toBe('Combat_Idle_Dual');
    visual.playAttack('mortal_strike');
    expect(clip(visual)).toBe('Dual_Cross');
  });

  it('leaves a staff on its two-hand chop: the caster auto attack and a staff shaman swing', () => {
    const priest = create('player_priest');
    priest.setWeapon('gnarled_staff');
    tick(priest, {}, 20);
    priest.playAttack();
    expect(clip(priest)).toBe('Woc_Attack_2H_0');
    // flagged two-hand, so the shaman swings attackByHand.twohand, but a staff is the single set
    const shaman = create('player_shaman');
    shaman.setWeapon('briarroot_staff');
    tick(shaman, {}, 20);
    shaman.playAttack();
    expect(clip(shaman)).toBe('Woc_Attack_2H_0');
  });
});

describe('hunter cast-to-shot state transitions', () => {
  it('raises and holds through update, then releases the tail on a launch cue without an ability id', () => {
    const visual = create('player_hunter');
    tick(visual, { casting: true, castingAbility: 'aimed_shot' }, 45);
    const aim = peek(visual).current;
    expect(aim.getClip().name).toBe('Ranged_Shoot#aim');
    expect(aim.time).toBeCloseTo(0.15);
    expect(aim.paused).toBe(true);
    tick(visual, { casting: true, castingAbility: 'aimed_shot' }, 30);
    expect(aim.time).toBeCloseTo(0.15);
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Ranged_Shoot#release');
    expect(peek(visual).current.paused).toBe(false);
    // the release half runs 0.76 s (the 2026-09-29 snap shot splits at 0.17 s of 0.93), then
    // the hand-off fade
    tick(visual, {}, 75);
    // the shot braces the rig (combat_brace_core.ts): it holds the battle stance, free hand
    // down (the hunter's crossbow leaves the off hand empty), instead of the relaxed idle
    expect(peek(visual).current.getClip().name).toBe('Combat_Idle_Single');
    expect(peek(visual).current.getEffectiveWeight()).toBe(1);
  });

  it('plays the full shot when the aim has not reached its hold point', () => {
    const visual = create('player_hunter');
    tick(visual, { casting: true, castingAbility: 'aimed_shot' }, 6);
    expect(peek(visual).current.getClip().name).toBe('Ranged_Shoot#aim');
    expect(peek(visual).current.paused).toBe(false);
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Ranged_Shoot');
  });

  it('does not release a paused aim when the base state is no longer casting', () => {
    const visual = create('player_hunter');
    tick(visual, { casting: true, castingAbility: 'aimed_shot' }, 45);
    expect(peek(visual).current.getClip().name).toBe('Ranged_Shoot#aim');
    expect(peek(visual).current.paused).toBe(true);
    // Change only the state: leaving the actual held action paused makes
    // this exercise the cast-state guard independently of its pause guard.
    peek(visual).baseState = 'idle';
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Woc_Attack_Rifle');
  });

  it('releases a cancelled hold back to locomotion and does not reuse its tail for the next auto shot', () => {
    const visual = create('player_hunter');
    tick(visual, { casting: true, castingAbility: 'aimed_shot' }, 45);
    const aim = peek(visual).current;
    expect(aim.paused).toBe(true);
    tick(visual, { moving: true, running: true, speed: 7 }, 20);
    expect(aim.paused).toBe(false);
    expect(peek(visual).current.getClip().name).toBe('Woc_Run');
    visual.playAttack();
    expect(peek(visual).current.getClip().name).toBe('Woc_Attack_Rifle');
  });
});
