import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { AbilityEffect, Entity } from '../src/sim/types';
import {
  abilityAoeRadius,
  cancelGroundAim,
  clampAimToRange,
  commitGroundAim,
  createGroundAimState,
  DEFAULT_GROUND_AOE_RADIUS,
  enterGroundAim,
  shouldUseGroundAim,
} from '../src/ui/hud/action_bar/ground_aim';

function casterAt(x: number, z: number): Pick<Entity, 'pos'> {
  return { pos: { x, y: 0, z } };
}

describe('ground_aim', () => {
  it('opens touch placement for Meteor without changing other mobile ground casts', () => {
    expect(shouldUseGroundAim('meteor', true, false)).toBe(true);
    expect(shouldUseGroundAim('flamestrike', true, true)).toBe(false);
  });

  it('keeps desktop ground placement controlled by its preference', () => {
    expect(shouldUseGroundAim('meteor', false, true)).toBe(true);
    expect(shouldUseGroundAim('meteor', false, false)).toBe(false);
    expect(shouldUseGroundAim('flamestrike', false, true)).toBe(true);
  });

  it('passes through points inside range', () => {
    const aim = clampAimToRange(casterAt(10, -4), { x: 16, z: -4 }, 8);
    expect(aim).toEqual({ point: { x: 16, z: -4 }, clamped: false });
  });

  it('clamps beyond range with the same math as the sim cast path', () => {
    const aim = clampAimToRange(casterAt(10, -4), { x: 20, z: 20 }, 13);
    const dx = aim.point.x - 10;
    const dz = aim.point.z + 4;
    expect(aim.clamped).toBe(true);
    expect(Math.hypot(dx, dz)).toBeCloseTo(13, 6);
    expect(aim.point.x).toBeCloseTo(15, 6);
    expect(aim.point.z).toBeCloseTo(8, 6);
  });

  it('resolves radius from the first aoeDamage, groundAoE, or channel pulse effect', () => {
    const aoeDamage: AbilityEffect[] = [{ type: 'aoeDamage', min: 1, max: 2, radius: 7 }];
    const groundAoE: AbilityEffect[] = [
      { type: 'groundAoE', min: 1, max: 2, radius: 8, duration: 4, interval: 1 },
    ];
    const channelPulse: AbilityEffect[] = [{ type: 'aoeDamage', min: 1, max: 2, radius: 9 }];

    expect(abilityAoeRadius({ effects: aoeDamage })).toBe(7);
    expect(abilityAoeRadius({ effects: groundAoE })).toBe(8);
    expect(abilityAoeRadius({ effects: channelPulse })).toBe(9);
  });

  it('falls back when no area radius is present', () => {
    expect(abilityAoeRadius({ effects: [{ type: 'directDamage', min: 1, max: 2 }] })).toBe(
      DEFAULT_GROUND_AOE_RADIUS,
    );
  });

  it('uses Meteor actual 8-yard impact radius', () => {
    expect(abilityAoeRadius(ABILITIES.meteor)).toBe(8);
  });

  it('uses the Hourglass capture radius for its compact ground reticle', () => {
    expect(
      abilityAoeRadius({
        effects: [
          {
            type: 'temporalHourglass',
            duration: 5,
            hostilePveDuration: 60,
            hostilePvpDuration: 10,
            groundDuration: 30,
            selfRadius: 1.5,
            captureRadius: 1.75,
            healMaxHpPct: 0.3,
            selfCooldownRate: 2,
            allyCooldownRate: 1.75,
          },
        ],
      }),
    ).toBe(1.75);
  });

  it('transitions enter to cancel to commit', () => {
    const idle = createGroundAimState();
    const active = enterGroundAim(idle, 'flamestrike', 11);
    expect(active).toEqual({ activeAbilityId: 'flamestrike', activeSlot: 11 });
    expect(cancelGroundAim(active)).toEqual({ activeAbilityId: null, activeSlot: null });

    const second = enterGroundAim(idle, 'earthquake', 3);
    expect(commitGroundAim(second)).toEqual({
      abilityId: 'earthquake',
      state: { activeAbilityId: null, activeSlot: null },
    });
  });
});
