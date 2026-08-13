import { describe, expect, it } from 'vitest';
import {
  type AfflictionFamiliarPose,
  afflictionFamiliarLookYaw,
  shouldShowAfflictionFamiliar,
  writeAfflictionFamiliarPose,
} from '../src/render/affliction_familiar_core';

const warlock = {
  id: 7,
  kind: 'player' as const,
  templateId: 'warlock',
  dead: false,
  auras: [],
};

function emptyPose(): AfflictionFamiliarPose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
}

describe('Affliction familiar presentation core', () => {
  it('shows only for the local living Affliction warlock', () => {
    expect(shouldShowAfflictionFamiliar(warlock, 7, 'affliction')).toBe(true);
    expect(shouldShowAfflictionFamiliar(warlock, 7, 'necromancy')).toBe(false);
    expect(shouldShowAfflictionFamiliar(warlock, 7, null)).toBe(false);
    expect(shouldShowAfflictionFamiliar({ ...warlock, dead: true }, 7, 'affliction')).toBe(false);
    expect(shouldShowAfflictionFamiliar({ ...warlock, templateId: 'mage' }, 7, 'affliction')).toBe(
      false,
    );
    expect(shouldShowAfflictionFamiliar({ ...warlock, kind: 'mob' }, 7, 'affliction')).toBe(false);
    expect(shouldShowAfflictionFamiliar(warlock, 8, 'affliction')).toBe(false);
  });

  it('stays beside the caster while it possesses the Evil Eye', () => {
    expect(
      shouldShowAfflictionFamiliar(
        {
          ...warlock,
          auras: [
            {
              id: 'possess_evil_eye',
              name: 'Possess the Evil Eye',
              kind: 'affliction_possession' as const,
              remaining: 10,
              duration: 10,
              value: 1,
              sourceId: 7,
              school: 'shadow' as const,
            },
          ],
        },
        7,
        'affliction',
      ),
    ).toBe(true);
  });

  it('gives the eye restrained deterministic motion without allocating a pose', () => {
    const first = emptyPose();
    const second = emptyPose();
    const returned = writeAfflictionFamiliarPose(first, 1.25, warlock.id, false);
    writeAfflictionFamiliarPose(second, 1.25, warlock.id, false);

    expect(returned).toBe(first);
    expect(second).toEqual(first);
    expect(Object.values(first).every(Number.isFinite)).toBe(true);
    expect(first.x).toBeGreaterThanOrEqual(-1.13);
    expect(first.x).toBeLessThanOrEqual(-0.97);
    expect(first.y).toBeGreaterThanOrEqual(1.64);
    expect(first.y).toBeLessThanOrEqual(1.8);
    expect(first.z).toBeGreaterThanOrEqual(0.08);
    expect(first.z).toBeLessThanOrEqual(0.22);

    const later = emptyPose();
    writeAfflictionFamiliarPose(later, 1.65, warlock.id, false);
    expect(later).not.toEqual(first);
  });

  it('freezes the hover pose when reduced motion is requested', () => {
    const first = emptyPose();
    const later = emptyPose();
    writeAfflictionFamiliarPose(first, 0, warlock.id, true);
    writeAfflictionFamiliarPose(later, 25, warlock.id, true);

    expect(later).toEqual(first);
    expect(first).toEqual({
      x: -1.05,
      y: 1.72,
      z: 0.15,
      yaw: 0,
      pitch: 0,
      roll: 0,
    });
  });

  it('turns the companion toward the possessed target in owner-local space', () => {
    expect(afflictionFamiliarLookYaw(0, 0, 0, 0, 10)).toBeCloseTo(0);
    expect(afflictionFamiliarLookYaw(0, 0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(afflictionFamiliarLookYaw(0, 0, Math.PI / 2, 10, 0)).toBeCloseTo(0);
  });
});
