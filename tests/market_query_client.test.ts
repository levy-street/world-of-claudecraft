import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

describe('ClientWorld market query wire', () => {
  it('sends armor class and dominant primary stat with the existing browse filters', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: 'robe',
      itemType: 'armor',
      subtype: 'chest',
      armorClass: 'cloth',
      primaryStat: 'int',
      rarity: 'rare',
      page: 2,
    });

    expect(sent).toEqual([
      {
        cmd: 'market_search',
        q: 'robe',
        itemType: 'armor',
        subtype: 'chest',
        armorClass: 'cloth',
        primaryStat: 'int',
        rarity: 'rare',
        page: 2,
      },
    ]);
  });
});
