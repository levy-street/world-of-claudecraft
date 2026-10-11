// src/render/characters/attack_swing_core.ts: which dual-wield clip a swing plays (lone swings
// alternate the halves; a second swing in the same frame is both hands: the next pair clip) and
// how long after a swing starts its blade lands (ClipMap.contacts).
import { describe, expect, it } from 'vitest';
import {
  contactDelaySec,
  dualWieldHalfNames,
  newDualSwingState,
  pickDualSwing,
} from '../src/render/characters/attack_swing_core';
import { dualWieldHalfNames as fromSplit } from '../src/render/characters/clip_split';

const RIG = new Set(['Dual_Chop', 'Dual_Chop#main', 'Dual_Chop#off', 'Dual_Cross']);
const has = (n: string) => RIG.has(n);
const PAIRS = ['Dual_Cross', 'Dual_Chop'] as const;

describe('dualWieldHalfNames', () => {
  it('names the minted halves, and clip_split re-exports the same helper', () => {
    expect(dualWieldHalfNames('Dual_Chop')).toEqual(['Dual_Chop#main', 'Dual_Chop#off']);
    expect(fromSplit).toBe(dualWieldHalfNames);
  });
});

describe('pickDualSwing', () => {
  it('alternates the halves for swings in different frames, mainhand first', () => {
    const st = newDualSwingState();
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 1, st)).toEqual({
      clip: 'Dual_Chop#main',
      contact: 0,
    });
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 2, st)).toEqual({
      clip: 'Dual_Chop#off',
      contact: 0,
    });
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 3, st)).toEqual({
      clip: 'Dual_Chop#main',
      contact: 0,
    });
  });

  it('a second swing in the same frame is both hands: the pair clips cycle, X-slash first', () => {
    const st = newDualSwingState();
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 5, st).clip).toBe('Dual_Chop#main');
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 5, st)).toEqual({
      clip: 'Dual_Cross',
      contact: 1,
    });
    // the next same-tick pair plays the one-two of the whole clip
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 9, st).clip).toBe('Dual_Chop#main');
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 9, st)).toEqual({
      clip: 'Dual_Chop',
      contact: 1,
    });
    // ... and back to the X-slash
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 12, st).clip).toBe('Dual_Chop#main');
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 12, st).clip).toBe('Dual_Cross');
  });

  it('a pair resets the alternation: the next lone swing is the mainhand again', () => {
    const st = newDualSwingState();
    pickDualSwing('Dual_Chop', PAIRS, has, 1, st);
    pickDualSwing('Dual_Chop', PAIRS, has, 1, st);
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 2, st).clip).toBe('Dual_Chop#main');
  });

  it('a third swing in one frame keeps the pair clip playing (no restart)', () => {
    const st = newDualSwingState();
    pickDualSwing('Dual_Chop', PAIRS, has, 4, st);
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 4, st).clip).toBe('Dual_Cross');
    expect(pickDualSwing('Dual_Chop', PAIRS, has, 4, st)).toEqual({ clip: null, contact: 1 });
  });

  it('with no pair list (or none loaded) a same-frame pair plays the whole two-strike clip', () => {
    const st = newDualSwingState();
    pickDualSwing('Dual_Chop', undefined, has, 7, st);
    expect(pickDualSwing('Dual_Chop', undefined, has, 7, st)).toEqual({
      clip: 'Dual_Chop',
      contact: 1,
    });
    const st2 = newDualSwingState();
    pickDualSwing('Dual_Chop', ['Missing'], has, 7, st2);
    expect(pickDualSwing('Dual_Chop', ['Missing'], has, 7, st2).clip).toBe('Dual_Chop');
  });

  it('a rig without minted halves plays the whole clip every swing', () => {
    const st = newDualSwingState();
    const only = (n: string) => n === 'Dual_Chop';
    expect(pickDualSwing('Dual_Chop', PAIRS, only, 1, st)).toEqual({
      clip: 'Dual_Chop',
      contact: 0,
    });
    expect(pickDualSwing('Dual_Chop', PAIRS, only, 1, st)).toEqual({
      clip: 'Dual_Chop',
      contact: 0,
    });
  });
});

describe('contactDelaySec', () => {
  const contacts = { Dual_Chop: [0.125, 0.525], '1H_Chop': [0.47] };
  it('returns the listed contact for the hand, scaled by the playback speed', () => {
    expect(contactDelaySec(contacts, 'Dual_Chop', 0, 1)).toBe(0.125);
    expect(contactDelaySec(contacts, 'Dual_Chop', 1, 1)).toBe(0.525);
    expect(contactDelaySec(contacts, '1H_Chop', 0, 2)).toBeCloseTo(0.235, 6);
  });
  it('clamps a later hand to the last listed contact', () => {
    expect(contactDelaySec(contacts, '1H_Chop', 1, 1)).toBe(0.47);
  });
  it('is 0 (effects at once) for an unlisted clip, no table, no clip or a bad speed', () => {
    expect(contactDelaySec(contacts, 'Block', 0, 1)).toBe(0);
    expect(contactDelaySec(undefined, '1H_Chop', 0, 1)).toBe(0);
    expect(contactDelaySec(contacts, null, 0, 1)).toBe(0);
    expect(contactDelaySec(contacts, '1H_Chop', 0, 0)).toBe(0);
  });
});
