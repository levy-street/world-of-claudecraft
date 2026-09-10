// The online client's guild board wiring (src/net/online.ts): the category the
// window asks for reaches the REST read's query string, and the settings
// object the Pledges tab saves reaches the wire whole, the new flag included.
// The pure helpers are pinned in tests/guild_board_wire.test.ts; this suite
// pins the two call sites that join them to the transport.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { bareClient } from './helpers/bare_client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClientWorld guild board wiring', () => {
  it('forwards the category into the board read, and omits it for the whole board', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        urls.push(String(input));
        return {
          ok: true,
          json: async () => ({ leaders: [], page: 0, pageCount: 1, total: 0, pageSize: 20 }),
        };
      }),
    );
    const client = bareClient(7);
    await client.guildLeaderboard(0, 20, 'newPlayerFriendly');
    await client.guildLeaderboard(2, 20, null);
    await client.guildLeaderboard(1, 20);
    expect(urls.map((u) => u.slice(u.indexOf('/api/')))).toEqual([
      '/api/leaderboard?board=guilds&page=0&pageSize=20&category=newPlayerFriendly',
      '/api/leaderboard?board=guilds&page=2&pageSize=20',
      '/api/leaderboard?board=guilds&page=1&pageSize=20',
    ]);
  });

  it('sends the whole settings object on guild_pledge_settings, the category flag included', () => {
    const sent: Record<string, unknown>[] = [];
    const client = bareClient(7);
    (client as unknown as { ws: unknown }).ws = {
      readyState: 1,
      send: (p: string) => sent.push(JSON.parse(p)),
    };
    client.setGuildPledgeSettings({
      enabled: true,
      minLevel: 12,
      note: 'grog welcome',
      newPlayerFriendly: true,
    });
    expect(sent).toEqual([
      {
        t: 'cmd',
        cmd: 'guild_pledge_settings',
        enabled: true,
        minLevel: 12,
        note: 'grog welcome',
        newPlayerFriendly: true,
      },
    ]);
  });
});
