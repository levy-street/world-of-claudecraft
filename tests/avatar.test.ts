import { describe, expect, it } from 'vitest';
import { avatarPng, isPlayerClass, isValidSkin, MAX_SKIN, PLAYER_CLASSES } from '../server/avatar';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('avatar validation', () => {
  it('accepts the nine classes and rejects others', () => {
    for (const c of PLAYER_CLASSES) expect(isPlayerClass(c)).toBe(true);
    expect(isPlayerClass('deathknight')).toBe(false);
    expect(isPlayerClass('')).toBe(false);
  });
  it('accepts skins 0..7 only', () => {
    for (let s = 0; s <= MAX_SKIN; s++) expect(isValidSkin(s)).toBe(true);
    expect(isValidSkin(8)).toBe(false);
    expect(isValidSkin(-1)).toBe(false);
    expect(isValidSkin(1.5)).toBe(false);
  });
});

describe('avatarPng', () => {
  it('emits a valid PNG with the right signature and IEND', () => {
    const png = avatarPng('shaman', 3);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR chunk type follows the 8-byte sig + 4-byte length.
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    // IEND chunk = length(4) + type(4) + crc(4); the type sits 8 bytes from the end.
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('is deterministic for the same class+skin', () => {
    expect(avatarPng('mage', 2).equals(avatarPng('mage', 2))).toBe(true);
  });

  it('differs across class and across skin', () => {
    expect(avatarPng('mage', 2).equals(avatarPng('warlock', 2))).toBe(false);
    expect(avatarPng('mage', 2).equals(avatarPng('mage', 5))).toBe(false);
  });

  it('throws on invalid inputs', () => {
    expect(() => avatarPng('paladin', 9)).toThrow();
    expect(() => avatarPng('nope' as any, 0)).toThrow();
  });
});
