import { describe, expect, it } from 'vitest';
import { nearestAutoTarget, shouldAutoTarget } from '../src/game/auto_target';

const at = (id: number, x: number) => ({ id, pos: { x, z: 0 } });
const origin = { x: 0, z: 0 };
const anything = () => true;

describe('shouldAutoTarget', () => {
  it('picks for an attack pressed with nothing targeted', () => {
    // The case a new controller player hits first: they see a wolf, press the
    // attack they know, and without this the cast just refuses.
    expect(shouldAutoTarget({ requiresTarget: true }, false)).toBe(true);
  });

  it('leaves a live hostile target alone', () => {
    expect(shouldAutoTarget({ requiresTarget: true }, true)).toBe(false);
  });

  it('never yanks the player off an ally', () => {
    // A heal or a buff with a friendly targeted must not go hunting for an enemy.
    expect(shouldAutoTarget({ requiresTarget: true, targetType: 'friendly' }, false)).toBe(false);
  });

  it('leaves an untargeted AoE untargeted', () => {
    // Abilities that need no target are legal to cast into thin air, and choosing
    // one for them would change where they land.
    expect(shouldAutoTarget({ requiresTarget: false }, false)).toBe(false);
    expect(shouldAutoTarget(null, false)).toBe(false);
    expect(shouldAutoTarget(undefined, false)).toBe(false);
  });
});

describe('nearestAutoTarget', () => {
  it('takes the closest that the caller says is attackable', () => {
    expect(nearestAutoTarget([at(1, 30), at(2, 5), at(3, 12)], origin, anything)).toBe(2);
  });

  it('never second-guesses who may be attacked', () => {
    // The faction, dead and pvp rules stay with the caller: this only answers
    // which of the allowed ones is closest.
    const allowed = (e: { id: number }) => e.id !== 2;
    expect(nearestAutoTarget([at(1, 30), at(2, 5), at(3, 12)], origin, allowed)).toBe(3);
  });

  it('answers null when everything is out of reach', () => {
    expect(nearestAutoTarget([at(1, 500)], origin, anything)).toBeNull();
  });

  it('answers null with nothing attackable at all', () => {
    expect(nearestAutoTarget([at(1, 5)], origin, () => false)).toBeNull();
  });
});
