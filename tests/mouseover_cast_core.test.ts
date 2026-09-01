// mouseover_cast_core.ts: the Clique-style redirect rule shared by the party /
// raid rows and the target-of-target frame. Every gate gets its own negative
// case, because the whole point of the rule is what it REFUSES to redirect: an
// offensive press must never be stolen off the current target by a cursor that
// happens to be resting on a friendly frame.
import { describe, expect, it } from 'vitest';
import { type MouseoverCastAbility, mouseoverCastTarget } from '../src/ui/mouseover_cast_core';

const HEAL: MouseoverCastAbility = { requiresTarget: true, targetType: 'friendly' };
const alive = (id: number) => id === 7;

describe('mouseoverCastTarget', () => {
  it('redirects a friendly targeted ability onto the hovered unit', () => {
    expect(mouseoverCastTarget(7, { enabled: true, ability: HEAL, exists: alive })).toBe(7);
  });

  it('does not redirect when nothing is hovered', () => {
    expect(mouseoverCastTarget(null, { enabled: true, ability: HEAL, exists: alive })).toBeNull();
  });

  it('does not redirect while the mouseoverCast option is off', () => {
    expect(mouseoverCastTarget(7, { enabled: false, ability: HEAL, exists: alive })).toBeNull();
  });

  it('does not redirect an offensive ability, so a hovered frame never steals a nuke', () => {
    const nuke: MouseoverCastAbility = { requiresTarget: true, targetType: 'enemy' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: nuke, exists: alive })).toBeNull();
  });

  it("does not redirect an 'any' ability, whose friendly reading is the ambiguous one", () => {
    const either: MouseoverCastAbility = { requiresTarget: true, targetType: 'any' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: either, exists: alive })).toBeNull();
  });

  it('does not redirect an ability with no targetType at all (defaults to enemy)', () => {
    const untyped: MouseoverCastAbility = { requiresTarget: true };
    expect(mouseoverCastTarget(7, { enabled: true, ability: untyped, exists: alive })).toBeNull();
  });

  it('does not redirect a targetless ability (a self buff, an AOE)', () => {
    const aoe: MouseoverCastAbility = { requiresTarget: false, targetType: 'friendly' };
    expect(mouseoverCastTarget(7, { enabled: true, ability: aoe, exists: alive })).toBeNull();
  });

  it('falls back to the normal cast when the hovered unit went stale', () => {
    // The unit left interest scope (or died and was removed) between the
    // mouseenter and the key press; casting at a vanished id wastes the press.
    expect(mouseoverCastTarget(99, { enabled: true, ability: HEAL, exists: alive })).toBeNull();
  });
});
