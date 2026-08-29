// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { GamepadBindings, labelForGamepadTarget } from '../src/game/gamepad_bindings';
import { GAMEPAD_CONFIRM, GAMEPAD_NONE, GP } from '../src/game/gamepad_map';

beforeEach(() => localStorage.clear());

describe('GamepadBindings labelForAction', () => {
  it('uses the connected controller brand for the default interact and jump buttons', () => {
    const bindings = new GamepadBindings();

    expect(bindings.labelForAction(GAMEPAD_CONFIRM, 'xbox')).toBe('A');
    expect(bindings.labelForAction('jump', 'xbox')).toBe('Y');
    expect(bindings.labelForAction(GAMEPAD_CONFIRM, 'playstation')).toBe('Cross');
    expect(bindings.labelForAction('jump', 'playstation')).toBe('Triangle');
    expect(bindings.labelForAction(GAMEPAD_CONFIRM, 'nintendo')).toBe('B');
    expect(bindings.labelForAction('jump', 'nintendo')).toBe('X');
  });

  it('follows remapped actions and chooses the first matching physical button', () => {
    const bindings = new GamepadBindings();
    bindings.bind(GP.B, 'jump');

    expect(bindings.labelForAction('jump', 'xbox')).toBe('B');
  });

  it('returns null when an action has no controller binding', () => {
    const bindings = new GamepadBindings();
    bindings.bind(GP.A, GAMEPAD_NONE);

    expect(bindings.labelForAction(GAMEPAD_CONFIRM, 'xbox')).toBeNull();
  });

  it('repairs the previous default layout to add a truthful inventory shortcut', () => {
    localStorage.setItem(
      'woc_gamepad',
      JSON.stringify({ [GP.LB]: 'slot2', [GP.BACK]: 'cycleHud', [GP.R3]: 'targetFriendly' }),
    );

    const bindings = new GamepadBindings();

    expect(bindings.actionFor(GP.BACK)).toBe('bags');
    expect(bindings.actionFor(GP.R3)).toBe('cycleHud');
    expect(bindings.actionFor(GP.LB)).toBe(GAMEPAD_NONE);
  });
});

describe('labelForGamepadTarget', () => {
  it('uses the default bare d-pad target cycle when no button has an explicit target action', () => {
    const bindings = new GamepadBindings();

    expect(labelForGamepadTarget(bindings.entries(), 'xbox')).toBe('D-pad →');
  });

  it('prefers a remapped target action over the bare d-pad fallback', () => {
    const bindings = new GamepadBindings();
    bindings.bind(GP.B, 'target');

    expect(labelForGamepadTarget(bindings.entries(), 'xbox')).toBe('B');
  });

  it('falls back to reverse target cycle if the forward d-pad direction is occupied', () => {
    const bindings = new GamepadBindings();
    bindings.bind(GP.DPAD_RIGHT, 'jump');

    expect(labelForGamepadTarget(bindings.entries(), 'xbox')).toBe('D-pad ←');
  });

  it('uses a d-pad slot binding only while the cross hotbar swallows it', () => {
    const bindings = new GamepadBindings();
    bindings.bind(GP.DPAD_RIGHT, 'slot0');
    bindings.bind(GP.DPAD_LEFT, 'slot1');

    expect(labelForGamepadTarget(bindings.entries(), 'xbox', true)).toBe('D-pad →');
    expect(labelForGamepadTarget(bindings.entries(), 'xbox', false)).toBeNull();
  });
});
