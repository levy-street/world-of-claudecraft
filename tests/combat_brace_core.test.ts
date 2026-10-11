// src/render/characters/combat_brace_core.ts + the braced arm of anim_state.desiredBaseState:
// a player rig holds its battle stance for BRACE_SECONDS after it last swung, released a
// hostile cast or took a hit, then relaxes into its idle.
import { describe, expect, it } from 'vitest';
import { type AnimState, desiredBaseState } from '../src/render/characters/anim_state';
import { BRACE_SECONDS, extendBrace, isBraced } from '../src/render/characters/combat_brace_core';

const standing = (): AnimState =>
  ({
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
  }) as AnimState;

describe('the brace clock', () => {
  it('holds for BRACE_SECONDS after the last fight, then lets go', () => {
    const until = extendBrace(Number.NEGATIVE_INFINITY, 10);
    expect(until).toBe(10 + BRACE_SECONDS);
    expect(isBraced(until, 10 + BRACE_SECONDS - 0.01)).toBe(true);
    expect(isBraced(until, 10 + BRACE_SECONDS)).toBe(false);
  });

  it('every new swing extends it, an older one never shortens it', () => {
    let until = extendBrace(Number.NEGATIVE_INFINITY, 10);
    until = extendBrace(until, 14);
    expect(until).toBe(14 + BRACE_SECONDS);
    expect(extendBrace(until, 12)).toBe(14 + BRACE_SECONDS);
  });
});

describe('desiredBaseState with a brace', () => {
  it('a braced, standing rig with a stance clip holds the stance', () => {
    expect(desiredBaseState(standing(), true, true, true, false, false, true)).toBe('combatIdle');
  });

  it('not braced and not engaged: the relaxed idle', () => {
    expect(desiredBaseState(standing(), true, true, true, false, false, false)).toBe('idle');
  });

  it('a rig without the stance clip never enters it, braced or not', () => {
    expect(desiredBaseState(standing(), true, true, false, false, false, true)).toBe('idle');
  });

  it('the brace only changes standing still: moving still walks or runs', () => {
    const s = { ...standing(), moving: true, running: true, speed: 7 };
    expect(desiredBaseState(s, true, true, true, false, false, true)).toBe('run');
  });
});
