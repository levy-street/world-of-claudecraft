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
      sort: 'name',
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
        sort: 'name',
        page: 2,
      },
    ]);
  });

  it('sends the price-ascending sort axis (issue #3102)', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: '',
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'price',
      page: 0,
    });

    expect(sent).toEqual([
      {
        cmd: 'market_search',
        q: '',
        itemType: 'all',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
        sort: 'price',
        page: 0,
      },
    ]);
  });
});
