import { describe, expect, it } from 'vitest';
import {
  bastionRiteShieldLeft,
  clearBastionRiteShields,
  forgetBastionRiteShield,
  forgetHallowedWallBlock,
  noteBastionRiteShield,
  noteHallowedWallBlock,
  noteVowkeeperWeapon,
  shieldBlockLeft,
  vowkeeperWeaponGlow,
} from '../src/render/paladin_shield_buffs';

describe('Bastion Rite notes for the held shield', () => {
  it('holds a note while it is renewed and lets it lapse when it is not', () => {
    clearBastionRiteShields();
    noteBastionRiteShield(7, 0.6, 1000);
    expect(bastionRiteShieldLeft(7, 1100)).toBeCloseTo(0.6);
    expect(bastionRiteShieldLeft(8, 1100)).toBeNull();
    expect(bastionRiteShieldLeft(undefined, 1100)).toBeNull();
    expect(bastionRiteShieldLeft(7, 2100)).toBeNull();
    noteBastionRiteShield(7, 2, 2000);
    expect(bastionRiteShieldLeft(7, 2000)).toBe(1);
  });

  it("holds Vowkeeper Strike's weapon light while the kit renews it", () => {
    clearBastionRiteShields();
    noteVowkeeperWeapon(3, 0.8, 0.5, 1000);
    expect(vowkeeperWeaponGlow(3, 1100)).toMatchObject({ glow: 0.8, flash: 0.5 });
    expect(vowkeeperWeaponGlow(3, 2100)).toBeNull();
    expect(vowkeeperWeaponGlow('3', 1000)).toBeNull();
  });

  it("lights the held shield for Hallowed Wall's block once its plates are gone", () => {
    clearBastionRiteShields();
    expect(shieldBlockLeft(5, 1000)).toBeNull();
    noteHallowedWallBlock(5, 0.4, 1000);
    expect(shieldBlockLeft(5, 1100)).toBeCloseTo(0.4);
    // With Bastion Rite too, the larger share lights it.
    noteBastionRiteShield(5, 0.9, 1000);
    expect(shieldBlockLeft(5, 1100)).toBeCloseTo(0.9);
    forgetBastionRiteShield(5);
    expect(shieldBlockLeft(5, 1100)).toBeCloseTo(0.4);
    forgetHallowedWallBlock(5);
    expect(shieldBlockLeft(5, 1100)).toBeNull();
    // A note not renewed lapses.
    noteHallowedWallBlock(5, 0.4, 1000);
    expect(shieldBlockLeft(5, 2500)).toBeNull();
  });
});
