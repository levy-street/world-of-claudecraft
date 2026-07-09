import { describe, expect, it } from 'vitest';
import { shouldFloatAuraFade, type VerboseAuraFadeInput } from '../src/ui/verbose_combat_text';

// The pure relevance test behind the "Verbose combat text" option: when verbose is on, a FADED
// aura floats a status floater only over a unit the local player cares about (the player, the
// current target, or a party member). Off / gained / an unrelated unit never floats.

const base: VerboseAuraFadeInput = {
  verbose: true,
  gained: false,
  targetId: 42,
  playerId: 1,
  currentTargetId: null,
  partyMemberIds: [],
};

describe('shouldFloatAuraFade', () => {
  it('never floats when the option is off, even for a relevant fade', () => {
    expect(shouldFloatAuraFade({ ...base, verbose: false, targetId: 1 })).toBe(false);
    expect(shouldFloatAuraFade({ ...base, verbose: false, currentTargetId: 42 })).toBe(false);
  });

  it('never floats a GAINED aura (the feature is falling off, not being applied)', () => {
    expect(shouldFloatAuraFade({ ...base, gained: true, targetId: 1 })).toBe(false);
    expect(shouldFloatAuraFade({ ...base, gained: true, currentTargetId: 42 })).toBe(false);
  });

  it('floats a fade on the local player (your own buff/debuff/HoT falling off you)', () => {
    expect(shouldFloatAuraFade({ ...base, targetId: 1, playerId: 1 })).toBe(true);
  });

  it('floats a fade on your current target (a DoT/debuff dropping off the enemy)', () => {
    expect(shouldFloatAuraFade({ ...base, targetId: 42, currentTargetId: 42 })).toBe(true);
    // A DIFFERENT unit than the current target does not float.
    expect(shouldFloatAuraFade({ ...base, targetId: 99, currentTargetId: 42 })).toBe(false);
    // No target selected: an arbitrary enemy fade does not float.
    expect(shouldFloatAuraFade({ ...base, targetId: 42, currentTargetId: null })).toBe(false);
  });

  it('floats a fade on a party / raid member (a HoT/buff dropping off an ally)', () => {
    expect(shouldFloatAuraFade({ ...base, targetId: 7, partyMemberIds: [7, 8, 9] })).toBe(true);
    expect(shouldFloatAuraFade({ ...base, targetId: 5, partyMemberIds: [7, 8, 9] })).toBe(false);
  });

  it('does not float a fade on an unrelated unit (not you, not target, not party)', () => {
    expect(
      shouldFloatAuraFade({
        ...base,
        targetId: 500,
        playerId: 1,
        currentTargetId: 42,
        partyMemberIds: [7, 8],
      }),
    ).toBe(false);
  });

  it('is pure: same input yields the same answer', () => {
    const input = { ...base, targetId: 1 };
    expect(shouldFloatAuraFade(input)).toBe(shouldFloatAuraFade(input));
  });
});
