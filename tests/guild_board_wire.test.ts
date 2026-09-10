// The online client's guild board wire helpers (src/net/guild_board_wire.ts):
// the REST path for one board page (with and without a category), and the
// social frame's pledge-settings decode across every server generation.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUILD_PLEDGE_SETTINGS,
  decodeGuildBoardPage,
  decodeGuildPledgeSettings,
  emptyGuildBoardPage,
  guildBoardPath,
} from '../src/net/guild_board_wire';
import { GUILD_BOARD_CATEGORY_PARAM } from '../src/sim/guild_board_category';

describe('guildBoardPath', () => {
  it('names the page and size, and nothing else, for the whole board', () => {
    expect(guildBoardPath(0, 20, null)).toBe('/api/leaderboard?board=guilds&page=0&pageSize=20');
  });

  it('appends the category under the shared query key', () => {
    expect(guildBoardPath(2, 20, 'newPlayerFriendly')).toBe(
      `/api/leaderboard?board=guilds&page=2&pageSize=20&${GUILD_BOARD_CATEGORY_PARAM}=newPlayerFriendly`,
    );
  });
});

describe('decodeGuildBoardPage', () => {
  it('carries the echoed category only when the server applied a known one', () => {
    const served = { leaders: [], page: 0, pageCount: 1, total: 0, pageSize: 20 };
    expect(decodeGuildBoardPage({ ...served, category: 'newPlayerFriendly' }, 0, 20)).toEqual({
      ...served,
      category: 'newPlayerFriendly',
    });
    // An older server answers a filtered request with the whole board: no
    // echo, so the page decodes as unfiltered rather than mislabelled.
    expect('category' in decodeGuildBoardPage(served, 0, 20)).toBe(false);
    expect('category' in decodeGuildBoardPage({ ...served, category: 'pvp' }, 0, 20)).toBe(false);
  });

  it('falls back field by field on a malformed body, keeping the requested page', () => {
    expect(decodeGuildBoardPage({ leaders: 'nope', page: 'x' }, 3, 20)).toEqual({
      leaders: [],
      page: 3,
      pageCount: 1,
      total: 0,
      pageSize: 20,
    });
    expect(decodeGuildBoardPage(null, 1, 20)).toEqual({ ...emptyGuildBoardPage(20), page: 1 });
    expect(emptyGuildBoardPage(20).page).toBe(0);
  });
});

describe('decodeGuildPledgeSettings', () => {
  it('decodes a current frame whole', () => {
    expect(
      decodeGuildPledgeSettings({
        enabled: false,
        minLevel: 12,
        note: 'raiders',
        newPlayerFriendly: true,
      }),
    ).toEqual({ enabled: false, minLevel: 12, note: 'raiders', newPlayerFriendly: true });
  });

  it('fills the category flag for a frame that predates categories', () => {
    expect(decodeGuildPledgeSettings({ enabled: true, minLevel: 5, note: 'hi' })).toEqual({
      enabled: true,
      minLevel: 5,
      note: 'hi',
      newPlayerFriendly: false,
    });
  });

  it('resolves an absent or malformed frame to the feature defaults, field by field', () => {
    expect(decodeGuildPledgeSettings(undefined)).toEqual(DEFAULT_GUILD_PLEDGE_SETTINGS);
    expect(decodeGuildPledgeSettings(null)).toEqual(DEFAULT_GUILD_PLEDGE_SETTINGS);
    expect(decodeGuildPledgeSettings('nope')).toEqual(DEFAULT_GUILD_PLEDGE_SETTINGS);
    expect(
      decodeGuildPledgeSettings({
        enabled: 'yes',
        minLevel: 'ten',
        note: 4,
        newPlayerFriendly: 'true',
      }),
    ).toEqual(DEFAULT_GUILD_PLEDGE_SETTINGS);
    // A sub-floor or fractional level normalizes rather than leaking.
    expect(decodeGuildPledgeSettings({ minLevel: 0 }).minLevel).toBe(1);
    expect(decodeGuildPledgeSettings({ minLevel: 7.9 }).minLevel).toBe(7);
    // One bad field never drags the good ones back to their defaults.
    expect(
      decodeGuildPledgeSettings({
        enabled: 'yes',
        minLevel: 12,
        note: 'keep me',
        newPlayerFriendly: true,
      }),
    ).toEqual({ enabled: true, minLevel: 12, note: 'keep me', newPlayerFriendly: true });
    expect(decodeGuildPledgeSettings({ enabled: false, minLevel: 'ten', note: 4 })).toEqual({
      enabled: false,
      minLevel: 1,
      note: '',
      newPlayerFriendly: false,
    });
  });
});
