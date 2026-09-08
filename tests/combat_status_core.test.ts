import { describe, expect, it } from 'vitest';
import {
  CONTROL_SLOT_COUNT,
  controlSlot,
  createControlState,
  resolveControlStateInto,
} from '../src/render/combat_status_core';

describe('essential combat statuses', () => {
  it('pins every shader discriminator, including all independent locked schools', () => {
    const kinds = [
      'stun',
      'fear',
      'root',
      'sleep',
      'silence',
      'incapacitate',
      'polymorph',
      'disarm',
      'slow',
      'stasis',
    ];
    expect(kinds.map((kind) => controlSlot({ id: 'ordinary', kind }))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const schools = ['physical', 'holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'];
    expect(
      schools.map((school) => controlSlot({ id: 'interrupted', kind: 'lockout', school })),
    ).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });
  it('suppresses a pre-existing slow during slow immunity without hiding root or stun', () => {
    const state = createControlState();
    const controls = [
      { id: 'chill', kind: 'slow', remaining: 4 },
      { id: 'roots', kind: 'root', remaining: 3 },
      { id: 'stomp', kind: 'stun', remaining: 1 },
    ];
    resolveControlStateInto(state, {
      id: 1,
      auras: [...controls, { id: 'steadfast', kind: 'slow_immunity', remaining: 2 }],
    });
    expect(state.remaining[8]).toBe(0);
    expect(state.remaining[2]).toBe(3);
    expect(state.remaining[0]).toBe(1);
    resolveControlStateInto(state, { id: 1, auras: controls });
    expect(state.remaining[8]).toBe(4);
  });
  it('keeps simultaneous control and separate school restrictions', () => {
    const state = createControlState();
    resolveControlStateInto(state, {
      id: 1,
      auras: [
        { id: 'stomp', kind: 'stun', remaining: 2 },
        { id: 'roots', kind: 'root', remaining: 8 },
        { id: 'seal', kind: 'silence', remaining: 3 },
        { id: 'cs1', kind: 'lockout', school: 'frost', remaining: 4 },
        { id: 'cs2', kind: 'lockout', school: 'fire', remaining: 5 },
      ],
    });
    expect([...state.remaining].filter((n) => n > 0)).toEqual([2, 8, 3, 5, 4]);
    expect(state.remaining).toHaveLength(CONTROL_SLOT_COUNT);
  });
  it('separates slumber, fear, ordinary incapacitates and weapon blindness', () => {
    expect(controlSlot({ id: 'hibernate_incap', kind: 'incapacitate' })).toBe(3);
    expect(controlSlot({ id: 'fear_incap', kind: 'incapacitate' })).toBe(1);
    expect(controlSlot({ id: 'blind_incap', kind: 'incapacitate' })).toBe(5);
    expect(controlSlot({ id: 'dust', kind: 'blind' })).toBe(-1);
    expect(controlSlot({ id: 'unknown', kind: 'lockout' })).toBe(-1);
  });
  it('clears ended states in place, ignores corpses, and retains refreshed duration', () => {
    const state = createControlState();
    const auras = [
      { id: 'a', kind: 'root', remaining: 2, duration: 6 },
      { id: 'b', kind: 'root', remaining: 5, duration: 8 },
    ];
    expect(resolveControlStateInto(state, { id: 1, auras })).toBe(state);
    expect(state.remaining[2]).toBe(5);
    expect(state.duration[2]).toBe(8);
    resolveControlStateInto(state, { id: 1, hp: 0, auras });
    expect(state.remaining.every((n) => n === 0)).toBe(true);
    resolveControlStateInto(state, { id: 1, auras });
    expect(state.remaining[2]).toBe(5);
    resolveControlStateInto(state, { id: 1, auras: [] });
    expect(state.remaining.every((n) => n === 0)).toBe(true);
  });
  it('does not display movement control suppressed by Veilbound March', () => {
    const state = resolveControlStateInto(createControlState(), {
      id: 1,
      auras: [
        { id: 'veilbound_march', kind: 'buff', remaining: 4 },
        { id: 'roots', kind: 'root', remaining: 8 },
        { id: 'chill', kind: 'slow', remaining: 2 },
        { id: 'stomp', kind: 'stun', remaining: 1 },
      ],
    });
    expect(state.remaining[0]).toBe(1);
    expect(state.remaining[2]).toBe(0);
    expect(state.remaining[8]).toBe(0);
  });
});
