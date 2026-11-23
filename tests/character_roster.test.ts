import { expect, it } from 'vitest';
import { applyCharacterRoster } from '../src/net/character_roster';

it.each([10, 15, 20, 25])(
  'preserves the authoritative character cap %s including referral bonus slots',
  (characterLimit) => {
    const target = {
      realm: null,
      characterMembership: { active: false, expiresAt: null },
      characterLimit: 10,
    };
    const characters: [] = [];
    expect(applyCharacterRoster(target, { characters, characterLimit })).toBe(characters);
    expect(target.characterLimit).toBe(characterLimit);
  },
);
it.each([undefined, null, -1, 11, 30, '25', Infinity])(
  'uses the legacy cap for malformed or missing limits',
  (characterLimit) => {
    const target = {
      realm: null,
      characterMembership: { active: false, expiresAt: null },
      characterLimit: 25,
    };
    applyCharacterRoster(target, { characters: [], characterLimit });
    expect(target.characterLimit).toBe(10);
  },
);
