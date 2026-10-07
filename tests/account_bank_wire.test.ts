import { expect, it } from 'vitest';
import { decodeAccountBankInfo } from '../src/net/account_bank_wire';

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
