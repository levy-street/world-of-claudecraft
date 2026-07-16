import { describe, expect, it, vi } from 'vitest';
import {
  defaultSkinEventChoice,
  skinEventChoices,
  skinEventLandingAngle,
} from '../src/ui/hud/cosmetics/skin_event_model';

describe('skin event model', () => {
  it('uses stable, catalog-qualified choice keys for class and mech rewards', () => {
    const classChoices = skinEventChoices('class');
    const mechChoices = skinEventChoices('mech');

    expect(classChoices.every((choice) => choice.key === `${choice.rank}:${choice.index}`)).toBe(
      true,
    );
    expect(mechChoices.every((choice) => choice.key === `mech:${choice.index}`)).toBe(true);
    expect(new Set(mechChoices.map((choice) => choice.id)).size).toBe(mechChoices.length);
  });

  it('defaults to the highest granted choice that the current model can render', () => {
    const choices = skinEventChoices('class');
    const selected = defaultSkinEventChoice('epic', choices, (choice) => choice.index < 3);

    expect(selected?.rank).toBe('rare');
    expect(selected?.index).toBe(2);
    expect(defaultSkinEventChoice('uncommon', choices, () => false)).toBeNull();
  });

  it('keeps every landing inside its rarity segment and consumes one random draw', () => {
    const random = vi.fn(() => 0.5);

    expect(skinEventLandingAngle('uncommon', random)).toBe(-15);
    expect(skinEventLandingAngle('rare', random)).toBe(-172.5);
    expect(skinEventLandingAngle('epic', random)).toBe(-247.5);
    expect(random).toHaveBeenCalledTimes(3);

    expect(skinEventLandingAngle('uncommon', () => 0)).toBeGreaterThanOrEqual(-90);
    expect(skinEventLandingAngle('uncommon', () => 1)).toBeLessThanOrEqual(60);
    expect(skinEventLandingAngle('rare', () => 0)).toBeGreaterThanOrEqual(-208.5);
    expect(skinEventLandingAngle('rare', () => 1)).toBeLessThanOrEqual(-136.5);
    expect(skinEventLandingAngle('epic', () => 0)).toBeGreaterThanOrEqual(-261.5);
    expect(skinEventLandingAngle('epic', () => 1)).toBeLessThanOrEqual(-233.5);
  });
});
