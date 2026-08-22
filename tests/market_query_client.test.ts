import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  encodeMarketLocalizedItemMask,
  MARKET_LOCALIZED_ITEM_CATALOG_IDS,
} from '../src/sim/market_query';

describe('ClientWorld market query wire', () => {
  it('sends the compact localized-name membership hint with the raw search', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: 'colmillo',
      localizedItemMask: 'catalog-mask',
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'name',
      page: 0,
      collapseLowest: false,
    } as Parameters<ClientWorld['marketSearch']>[0] & { localizedItemMask: string });

    expect(sent).toEqual([
      {
        cmd: 'market_search',
        q: 'colmillo',
        localizedItemMask: 'catalog-mask',
        itemType: 'all',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
        sort: 'name',
        page: 0,
        collapseLowest: false,
      },
    ]);
  });

  it('keeps even full-catalog localized membership far below the 16 KiB frame cap', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: 'e',
      localizedItemMask: encodeMarketLocalizedItemMask(MARKET_LOCALIZED_ITEM_CATALOG_IDS),
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'name',
      page: 0,
      collapseLowest: false,
    });

    expect(JSON.stringify(sent[0]).length).toBeLessThan(1024);
  });

  it('sends armor class and dominant primary stat with the existing browse filters', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: 'robe',
      localizedItemMask: '',
      itemType: 'armor',
      subtype: 'chest',
      armorClass: 'cloth',
      primaryStat: 'int',
      rarity: 'rare',
      sort: 'name',
      page: 2,
      collapseLowest: true,
    });

    expect(sent).toEqual([
      {
        cmd: 'market_search',
        q: 'robe',
        localizedItemMask: '',
        itemType: 'armor',
        subtype: 'chest',
        armorClass: 'cloth',
        primaryStat: 'int',
        rarity: 'rare',
        sort: 'name',
        page: 2,
        collapseLowest: true,
      },
    ]);
  });

  it('sends the price-ascending sort axis (issue #3102)', () => {
    const sent: unknown[] = [];
    const client = { cmd: (payload: unknown) => sent.push(payload) } as unknown as ClientWorld;

    ClientWorld.prototype.marketSearch.call(client, {
      search: '',
      localizedItemMask: '',
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
      sort: 'price',
      page: 0,
      collapseLowest: false,
    });

    expect(sent).toEqual([
      {
        cmd: 'market_search',
        q: '',
        localizedItemMask: '',
        itemType: 'all',
        subtype: 'all',
        armorClass: 'all',
        primaryStat: 'all',
        rarity: 'all',
        sort: 'price',
        page: 0,
        collapseLowest: false,
      },
    ]);
  });
});
