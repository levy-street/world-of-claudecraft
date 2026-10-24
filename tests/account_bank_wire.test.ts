import { expect, it } from 'vitest';
import {
  accountBankAutoSelect,
  decodeAccountBankInfo,
  selectAccountBankMirror,
} from '../src/net/account_bank_wire';
import { membershipBankView } from '../src/sim/membership_bank';

it('validates bounded roster identity before displaying any other character bank', () => {
  const info = {
    characters: [{ characterId: 2, name: 'Alice' }],
    selectedCharacterId: null,
    bank: null,
  };
  expect(decodeAccountBankInfo(info)).toEqual(info);
  expect(decodeAccountBankInfo({ ...info, selectedCharacterId: 99 })).toBeNull();
  expect(
    decodeAccountBankInfo({ ...info, characters: [info.characters[0], info.characters[0]] }),
  ).toBeNull();
  expect(
    decodeAccountBankInfo({
      ...info,
      characters: Array.from({ length: 21 }, (_, n) => ({ characterId: n + 1, name: 'A' })),
    }),
  ).toBeNull();
  expect(
    decodeAccountBankInfo({ ...info, selectedCharacterId: 2, bank: { slots: [] } }),
  ).toBeNull();
  expect(decodeAccountBankInfo(null)).toBeNull();
});

it('accepts the unpriced bank view the server builds for another character', () => {
  // membershipBankView offers no purchases, so both prices are null. The strict
  // personal-bank ladder rejected that, and every opened bank read as missing.
  const bank = JSON.parse(
    JSON.stringify(
      membershipBankView({
        inventory: [{ itemId: 'copper_ore', count: 2 }],
        purchasedSlots: 0,
        bonusSlots: 0,
      }),
    ),
  );
  const info = { characters: [{ characterId: 2, name: 'Alice' }], selectedCharacterId: 2, bank };
  expect(decodeAccountBankInfo(info)?.bank?.slots).toEqual([{ itemId: 'copper_ore', count: 2 }]);
  expect(decodeAccountBankInfo({ ...info, bank: { ...bank, nextExpansionCost: 100 } })).toBeNull();
});

it('opens the remembered character bank, else the first, only on a fresh roster', () => {
  const characters = [
    { characterId: 2, name: 'Alice' },
    { characterId: 3, name: 'Bram' },
  ];
  const roster = { characters, selectedCharacterId: null, bank: null };
  expect(accountBankAutoSelect(roster, null)).toBe(2);
  expect(accountBankAutoSelect(roster, 3)).toBe(3);
  expect(accountBankAutoSelect(roster, 9)).toBe(2);
  expect(accountBankAutoSelect({ ...roster, error: 'busy' }, null)).toBeNull();
  expect(accountBankAutoSelect({ ...roster, selectedCharacterId: 3 }, null)).toBeNull();
  expect(accountBankAutoSelect({ ...roster, characters: [] }, null)).toBeNull();
  expect(accountBankAutoSelect(null, 2)).toBeNull();
});

it('drops an earlier refusal when another character is selected', () => {
  const info = {
    characters: [
      { characterId: 2, name: 'Alice' },
      { characterId: 3, name: 'Bram' },
    ],
    selectedCharacterId: 2,
    bank: null,
    error: 'online',
  };
  expect(selectAccountBankMirror(info, 3)).toMatchObject({
    selectedCharacterId: 3,
    bank: null,
    error: undefined,
  });
});
