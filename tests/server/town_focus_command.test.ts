// server/town_focus_command.ts: the set_town_focus wire body, extracted whole
// out of game.ts's dispatch switch. Every case here pins the EXACT
// pre-extraction behavior (root CLAUDE.md, "Fix bugs test-first" applies
// symmetrically to a pure extraction: the acceptance surface must not move).

import { describe, expect, it, vi } from 'vitest';
import { applyTownFocusCommand } from '../../server/town_focus_command';

describe('applyTownFocusCommand', () => {
  it('is a no-op when allocation is missing', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand({ setTownFocus }, {}, 9);
    expect(setTownFocus).not.toHaveBeenCalled();
  });

  it.each([
    ['null', { allocation: null }],
    ['a number', { allocation: 5 }],
    ['a string', { allocation: 'mining' }],
    ['a boolean', { allocation: true }],
    ['undefined', { allocation: undefined }],
  ])('is a no-op when allocation is %s (a non-object scalar)', (_label, msg) => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand({ setTownFocus }, msg, 9);
    expect(setTownFocus).not.toHaveBeenCalled();
  });

  it('treats an array allocation as an object: numeric-indexed entries pass through as string keys', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand({ setTownFocus }, { allocation: [3, 7] }, 9);
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({ '0': 3, '1': 7 }, 'time', 9);
  });

  it('filters an object allocation to numeric entries only, dropping non-number values', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand(
      { setTownFocus },
      {
        allocation: {
          mining: 3,
          herbalism: '5',
          skinning: null,
          fishing: undefined,
          woodcutting: true,
          logging: 2,
        },
      },
      9,
    );
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({ mining: 3, logging: 2 }, 'time', 9);
  });

  it('preserves NaN and Infinity numeric values, leaving their rejection to sim-side validation', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand(
      { setTownFocus },
      { allocation: { mining: Number.NaN, herbalism: Infinity, skinning: -Infinity } },
      9,
    );
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    const [allocation] = setTownFocus.mock.calls[0];
    expect(Number.isNaN(allocation.mining)).toBe(true);
    expect(allocation.herbalism).toBe(Infinity);
    expect(allocation.skinning).toBe(-Infinity);
  });

  it('drops an empty-object allocation to an empty filtered allocation, still dispatching', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand({ setTownFocus }, { allocation: {} }, 9);
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({}, 'time', 9);
  });

  it.each([
    ['missing', {}],
    ['a number', { tier: 1 }],
    ['an unknown string', { tier: 'freebie' }],
    ['the empty string', { tier: '' }],
    // Object.hasOwn (not `in` or a plain index check) is the guard: a
    // prototype-chain member must never be mistaken for an own tier key.
    ['a prototype-chain key (toString)', { tier: 'toString' }],
    ['a prototype-chain key (constructor)', { tier: 'constructor' }],
    ['a prototype-chain key (hasOwnProperty)', { tier: 'hasOwnProperty' }],
  ])('falls back to the free "time" tier when msg.tier is %s', (_label, tierField) => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand({ setTownFocus }, { allocation: { mining: 4 }, ...tierField }, 9);
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({ mining: 4 }, 'time', 9);
  });

  it.each(['time', 'timeAndPartial', 'instant'] as const)(
    'retains a valid own RESPEC_TIER_CONFIG key tier %s verbatim',
    (tier) => {
      const setTownFocus = vi.fn();
      applyTownFocusCommand({ setTownFocus }, { allocation: { mining: 4 }, tier }, 9);
      expect(setTownFocus).toHaveBeenCalledTimes(1);
      expect(setTownFocus).toHaveBeenCalledWith({ mining: 4 }, tier, 9);
    },
  );

  it('uses the authenticated pid argument, never a pid riding the payload', () => {
    const setTownFocus = vi.fn();
    const forged: Record<string, unknown> = {
      allocation: { mining: 4 },
      tier: 'instant',
      pid: 999999,
    };
    applyTownFocusCommand({ setTownFocus }, forged, 9);
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({ mining: 4 }, 'instant', 9);
    // The forged passenger pid is dropped, not merely ignored downstream: it
    // never reaches the allocation record, since it sits outside `allocation`.
    const [allocation] = setTownFocus.mock.calls[0];
    expect(allocation).not.toHaveProperty('pid');
  });

  it('calls sim once on a valid transport frame carrying the envelope plus rid', () => {
    const setTownFocus = vi.fn();
    applyTownFocusCommand(
      { setTownFocus },
      { t: 'cmd', cmd: 'set_town_focus', rid: 3, allocation: { mining: 2 }, tier: 'time' },
      9,
    );
    expect(setTownFocus).toHaveBeenCalledTimes(1);
    expect(setTownFocus).toHaveBeenCalledWith({ mining: 2 }, 'time', 9);
  });
});
