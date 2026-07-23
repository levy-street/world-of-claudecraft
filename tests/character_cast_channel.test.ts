import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type AnimState, writeCastingAnimState } from '../src/render/characters/anim_state';
import { CharacterVisual } from '../src/render/characters/visual';

function fakeAction(): THREE.AnimationAction {
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
  return action;
}

describe('CharacterVisual channel animation', () => {
  it('bridges authoritative and visual-only channels into renderer state', () => {
    const state = { casting: false, channeling: false };

    writeCastingAnimState(state, true, false, false, false);
    expect(state).toEqual({ casting: true, channeling: true });

    writeCastingAnimState(state, false, false, true, false);
    expect(state).toEqual({ casting: true, channeling: true });

    writeCastingAnimState(state, true, true, false, true);
    expect(state).toEqual({ casting: false, channeling: false });
  });
  it('keeps the authoritative channel pose looping until the channel ends', () => {
    const channel = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.deadLock = false;
    state.baseState = 'idle';
    state.current = null;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([['Channel', channel]]);

    visual.beginCastChannel();

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopRepeat, Infinity);
    expect(channel.clampWhenFinished).toBe(false);
  });

  it('upgrades an already-current cast pose to a loop when a channel starts', () => {
    const channel = fakeAction();
    channel.paused = true;
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.deadLock = false;
    state.baseState = 'cast';
    state.current = channel;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([['Channel', channel]]);

    visual.beginCastChannel();

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopRepeat, Infinity);
    expect(channel.clampWhenFinished).toBe(false);
    expect(channel.paused).toBe(false);
    expect(channel.reset).not.toHaveBeenCalled();
  });

  it('loops ordinary authoritative channels passed through the renderer state', () => {
    const idle = fakeAction();
    const channel = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.hitCooldown = 0;
    state.stow = { pending: null, timer: 0, attached: false };
    state.wasDead = false;
    state.deadLock = false;
    state.initialized = true;
    state.baseState = 'idle';
    state.current = idle;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([
      ['Idle', idle],
      ['Channel', channel],
    ]);
    state.spinAngle = 0;
    state.spinOnceTimer = 0;
    state.poseWrap = new THREE.Group();
    state.swimPitch = 0;
    state.bobPhase = 0;
    state.swimHidingWeapons = false;
    state.mixer = { update: vi.fn() };

    const anim: AnimState = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: true,
      channeling: true,
      swimming: false,
      sitting: false,
    };
    visual.update(0.1, anim, false);

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopRepeat, Infinity);
    expect(channel.clampWhenFinished).toBe(false);
  });

  it('restores LoopOnce when a hardcast directly follows a channel', () => {
    const channel = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.hitCooldown = 0;
    state.stow = { pending: null, timer: 0, attached: false };
    state.wasDead = false;
    state.deadLock = false;
    state.initialized = true;
    state.baseState = 'cast';
    state.castLooping = true;
    state.current = channel;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([['Channel', channel]]);
    state.spinAngle = 0;
    state.spinOnceTimer = 0;
    state.poseWrap = new THREE.Group();
    state.swimPitch = 0;
    state.bobPhase = 0;
    state.swimHidingWeapons = false;
    state.mixer = { update: vi.fn() };

    const hardcast: AnimState = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: true,
      channeling: false,
      swimming: false,
      sitting: false,
    };
    visual.update(0.1, hardcast, false);

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopOnce, Infinity);
    expect(channel.clampWhenFinished).toBe(true);
    expect(channel.reset).not.toHaveBeenCalled();
  });

  it('applies a channel loop after an active one-shot finishes', () => {
    const attack = fakeAction();
    const channel = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.hitCooldown = 0;
    state.stow = { pending: null, timer: 0, attached: false };
    state.wasDead = false;
    state.deadLock = false;
    state.initialized = true;
    state.baseState = 'idle';
    state.castShouldLoop = false;
    state.castLooping = false;
    state.current = attack;
    state.currentIsOneShot = true;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([['Channel', channel]]);
    state.spinAngle = 0;
    state.spinOnceTimer = 0;
    state.poseWrap = new THREE.Group();
    state.swimPitch = 0;
    state.bobPhase = 0;
    state.swimHidingWeapons = false;
    state.mixer = { update: vi.fn() };

    const anim: AnimState = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: true,
      channeling: true,
      swimming: false,
      sitting: false,
    };
    visual.update(0.1, anim, false);
    expect(channel.setLoop).not.toHaveBeenCalled();

    (visual as unknown as { onFinished(action: THREE.AnimationAction): void }).onFinished(attack);

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopRepeat, Infinity);
    expect(channel.clampWhenFinished).toBe(false);
  });

  it('interrupts an emote into the looping channel mode', () => {
    const emote = fakeAction();
    const channel = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.hitCooldown = 0;
    state.stow = { pending: null, timer: 0, attached: false };
    state.wasDead = false;
    state.deadLock = false;
    state.initialized = true;
    state.baseState = 'idle';
    state.castShouldLoop = false;
    state.castLooping = false;
    state.current = emote;
    state.currentIsOneShot = true;
    state.currentOneShotIsEmote = true;
    state.def = { clips: { cast: 'Channel', idle: 'Idle' } };
    state.actions = new Map([['Channel', channel]]);
    state.spinAngle = 0;
    state.spinOnceTimer = 0;
    state.poseWrap = new THREE.Group();
    state.swimPitch = 0;
    state.bobPhase = 0;
    state.swimHidingWeapons = false;
    state.mixer = { update: vi.fn() };

    const anim: AnimState = {
      speed: 0,
      moving: false,
      running: false,
      airborne: false,
      backwards: false,
      dead: false,
      casting: true,
      channeling: true,
      swimming: false,
      sitting: false,
    };
    visual.update(0.1, anim, false);

    expect(channel.setLoop).toHaveBeenLastCalledWith(THREE.LoopRepeat, Infinity);
    expect(channel.clampWhenFinished).toBe(false);
  });

  it.each([
    ['cast', 'Cast'],
    ['jump', 'Jump'],
  ] as const)('keeps an ordinary %s pose one-shot and clamped', (baseState, clipName) => {
    const action = fakeAction();
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.baseState = baseState;
    state.current = null;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { [baseState]: clipName } };
    state.actions = new Map([[clipName, action]]);

    (
      visual as unknown as {
        fadeTo(next: THREE.AnimationAction, fade: number, oneShot: boolean): void;
      }
    ).fadeTo(action, 0.2, false);

    expect(action.setLoop).toHaveBeenLastCalledWith(THREE.LoopOnce, Infinity);
    expect(action.clampWhenFinished).toBe(true);
  });
});
