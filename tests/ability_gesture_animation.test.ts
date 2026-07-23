import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { CharacterVisual } from '../src/render/characters/visual';
import { ABILITIES } from '../src/sim/data';

// Abilities that carry a dedicated cast gesture (castFx 'gesture') and the clip
// each class's v02 rig plays for them. These replaced emote-as-animation cues:
// the clip is a purpose-built animation on the model, never a reused emote, and
// playGesture plays NOTHING when a rig lacks the clip (never a fallback swing).
const GESTURE_WIRING = [
  { ability: 'taunt', visualKey: 'player_warrior', clip: 'Taunt' },
  { ability: 'pummel', visualKey: 'player_warrior', clip: '2H_Kick' },
  { ability: 'kick', visualKey: 'player_rogue', clip: '2H_Kick' },
] as const;

// holy_taunt / hammer_of_justice are holy-school PROJECTILES: they resolve on the
// bolt path and never reach the castFx emit, so they carry no 'gesture' cue and no
// attackByAbility clip (the paladin Taunt/Stun clips stay unwired). Converting them
// would drop hammer_of_justice's stun-resist roll; pinned so it is a deliberate flip.
const PROJECTILE_NOT_GESTURE = ['holy_taunt', 'hammer_of_justice'] as const;

describe('dedicated ability gesture animations', () => {
  for (const { ability, visualKey, clip } of GESTURE_WIRING) {
    it(`${ability}: 'gesture' cue mapped to the ${clip} clip on ${visualKey}`, () => {
      // sim emits a 'gesture' spellfx on cast; the renderer plays the mapped clip.
      expect(ABILITIES[ability]?.castFx).toBe('gesture');
      expect(VISUALS[visualKey].clips.attackByAbility?.[ability]).toBe(clip);
    });
  }

  it('Ice Block is instant with no cast gesture (was a wave emote, now no animation)', () => {
    expect(ABILITIES.ice_block?.castFx).toBeUndefined();
    expect(VISUALS.player_mage.clips.attackByAbility?.ice_block).toBeUndefined();
  });

  it('holy projectile abilities carry no gesture cue or clip (resolve on the bolt path)', () => {
    for (const id of PROJECTILE_NOT_GESTURE) {
      expect(ABILITIES[id]?.castFx, id).toBeUndefined();
      expect(VISUALS.player_paladin.clips.attackByAbility?.[id]).toBeUndefined();
    }
  });

  it('warrior shouts still emit the shout cue (renderer plays Battlecry, not an emote)', () => {
    for (const id of [
      'battle_shout',
      'demoralizing_shout',
      'emboldening_roar',
      'defiant_bellow',
      'rallying_cry',
      'intimidating_shout',
    ]) {
      expect(ABILITIES[id]?.castFx, id).toBe('shout');
    }
  });

  it('never maps an ability animation to an emote clip (emotes are for emoting only)', () => {
    const EMOTE_CLIPS = new Set(['Cheer', 'Clap']);
    for (const key of ['player_warrior', 'player_paladin', 'player_rogue', 'player_mage']) {
      for (const clip of Object.values(VISUALS[key].clips.attackByAbility ?? {})) {
        expect(EMOTE_CLIPS.has(clip), `${key} maps an ability to emote clip ${clip}`).toBe(false);
      }
    }
  });

  it('plays a mapped gesture once and does nothing for missing mappings or clips', () => {
    const action = {
      reset: vi.fn(),
      setLoop: vi.fn(),
      fadeIn: vi.fn(),
      fadeOut: vi.fn(),
      play: vi.fn(),
      clampWhenFinished: false,
      timeScale: 1,
    } as unknown as THREE.AnimationAction;
    vi.mocked(action.reset).mockReturnValue(action);
    vi.mocked(action.setLoop).mockReturnValue(action);
    vi.mocked(action.fadeIn).mockReturnValue(action);
    vi.mocked(action.fadeOut).mockReturnValue(action);
    vi.mocked(action.play).mockReturnValue(action);

    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.deadLock = false;
    state.current = null;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { attackByAbility: { taunt: 'Taunt', pummel: 'Missing' } } };
    state.actions = new Map([['Taunt', action]]);

    visual.playGesture('taunt');
    expect(action.setLoop).toHaveBeenLastCalledWith(THREE.LoopOnce, 1);
    expect(action.clampWhenFinished).toBe(true);
    expect(action.play).toHaveBeenCalledOnce();

    visual.playGesture('unmapped');
    visual.playGesture('pummel');
    expect(action.play).toHaveBeenCalledOnce();
  });
});
