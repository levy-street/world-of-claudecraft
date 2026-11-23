// The player-facing /flair command (server/flair_command.ts), the entity stamp it
// re-runs (server/discord_flair_stamp.ts), and the client re-localization of its
// notices (src/ui/server_i18n.ts). The SQL itself runs against real Postgres in
// tests/discord_db_integration.test.ts; here a fake pool pins the statements each
// command issues, so a command that skips its write or its refresh fails.

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { stampDiscordFlair } from '../../server/discord_flair_stamp';
import {
  FLAIR_NOTICES,
  type FlairCommandHost,
  handleFlairChatCommand,
  parseFlairCommand,
  runFlairCommand,
} from '../../server/flair_command';
import type { Entity } from '../../src/sim/types';
import { setLanguage, supportedLanguages } from '../../src/ui/i18n';
import { localizeServerText } from '../../src/ui/server_i18n';

interface FakeSession {
  accountId: number;
}

/** A fake pool: `linked` decides whether discord_links has a row; `hidden` is its flag. */
function rig(opts: { linked: boolean; hidden?: boolean; laneOpen?: boolean }) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT flair_hidden')) {
        return { rows: opts.linked ? [{ flair_hidden: opts.hidden ?? false }] : [], rowCount: 0 };
      }
      if (sql.startsWith('UPDATE discord_links SET flair_hidden')) {
        return { rows: [], rowCount: opts.linked ? 1 : 0 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  } as unknown as Pool;
  const notices: string[] = [];
  const refresh = vi.fn(async () => {});
  const lane = vi.fn(() => opts.laneOpen ?? true);
  const host: FlairCommandHost<FakeSession> = {
    pool,
    consumeCommandLane: lane,
    refreshDiscordFlair: refresh,
    sendChatNotice: (_s, text) => notices.push(text),
  };
  return { host, queries, notices, refresh, lane, session: { accountId: 42 } };
}

describe('parseFlairCommand', () => {
  it('reads the bare command as a status check and on/off as a setting', () => {
    expect(parseFlairCommand('/flair')).toEqual({ kind: 'status' });
    expect(parseFlairCommand('  /flair  ')).toEqual({ kind: 'status' });
    expect(parseFlairCommand('/flair on')).toEqual({ kind: 'set', hidden: false });
    expect(parseFlairCommand('/FLAIR ON')).toEqual({ kind: 'set', hidden: false });
    expect(parseFlairCommand('/flair off')).toEqual({ kind: 'set', hidden: true });
    expect(parseFlairCommand('/flair   Off ')).toEqual({ kind: 'set', hidden: true });
  });

  it('claims any other argument as a usage error so it never reaches chat', () => {
    expect(parseFlairCommand('/flair maybe')).toEqual({ kind: 'usage' });
    expect(parseFlairCommand('/flair on now')).toEqual({ kind: 'usage' });
  });

  it('leaves every other chat line alone', () => {
    for (const text of ['/flairs', 'flair off', '/pvp off', 'my /flair is nice', '']) {
      expect(parseFlairCommand(text), text).toBeNull();
    }
  });
});

describe('runFlairCommand', () => {
  it('/flair off writes hidden = true, re-stamps the entity, then confirms', async () => {
    const r = rig({ linked: true });
    await runFlairCommand(r.host, r.session, { kind: 'set', hidden: true });
    expect(r.queries).toEqual([
      {
        sql: 'UPDATE discord_links SET flair_hidden = $2 WHERE account_id = $1',
        params: [42, true],
      },
    ]);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    expect(r.notices).toEqual([FLAIR_NOTICES.hidden]);
  });

  it('/flair on writes hidden = false, re-stamps the entity, then confirms', async () => {
    const r = rig({ linked: true, hidden: true });
    await runFlairCommand(r.host, r.session, { kind: 'set', hidden: false });
    expect(r.queries.map((q) => q.params)).toEqual([[42, false]]);
    expect(r.refresh).toHaveBeenCalledTimes(1);
    expect(r.notices).toEqual([FLAIR_NOTICES.shown]);
  });

  it('a player with no linked Discord is told to link, and nothing is re-stamped', async () => {
    const r = rig({ linked: false });
    await runFlairCommand(r.host, r.session, { kind: 'set', hidden: true });
    expect(r.refresh).not.toHaveBeenCalled();
    expect(r.notices).toEqual([FLAIR_NOTICES.notLinked]);
  });

  it('a bare /flair reports the stored setting without writing', async () => {
    for (const [linked, hidden, notice] of [
      [true, false, FLAIR_NOTICES.shown],
      [true, true, FLAIR_NOTICES.hidden],
      [false, false, FLAIR_NOTICES.notLinked],
    ] as const) {
      const r = rig({ linked, hidden });
      await runFlairCommand(r.host, r.session, { kind: 'status' });
      expect(r.queries).toEqual([
        { sql: 'SELECT flair_hidden FROM discord_links WHERE account_id = $1', params: [42] },
      ]);
      expect(r.refresh).not.toHaveBeenCalled();
      expect(r.notices).toEqual([notice]);
    }
  });

  it('a usage error answers without touching the database', async () => {
    const r = rig({ linked: true });
    await runFlairCommand(r.host, r.session, { kind: 'usage' });
    expect(r.queries).toEqual([]);
    expect(r.notices).toEqual([FLAIR_NOTICES.usage]);
  });
});

describe('handleFlairChatCommand', () => {
  it('passes an ordinary chat line through without drawing the command lane', () => {
    const r = rig({ linked: true });
    expect(handleFlairChatCommand(r.host, r.session, 'hello there', 1)).toBe(false);
    expect(r.lane).not.toHaveBeenCalled();
  });

  it('claims a /flair line and pays the command lane once', async () => {
    const r = rig({ linked: true });
    expect(handleFlairChatCommand(r.host, r.session, '/flair off', 1)).toBe(true);
    expect(r.lane).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(r.notices).toEqual([FLAIR_NOTICES.hidden]));
  });

  it('bounds completed commands to one per second without queuing repeats', async () => {
    const r = rig({ linked: true });
    handleFlairChatCommand(r.host, r.session, '/flair off', 1);
    await vi.waitFor(() => expect(r.notices).toHaveLength(1));
    for (let n = 0; n < 60; n++) {
      expect(handleFlairChatCommand(r.host, r.session, '/flair off', 1.99)).toBe(true);
    }
    expect(r.queries).toHaveLength(1);
    handleFlairChatCommand(r.host, r.session, '/flair on', 2);
    await vi.waitFor(() => expect(r.notices).toHaveLength(2));
    expect(r.queries).toHaveLength(2);
  });

  it('allows only one pending operation per account while other accounts can proceed', async () => {
    const r = rig({ linked: true });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const query = vi.spyOn(r.host.pool, 'query');
    query.mockImplementationOnce((async () => {
      await pending;
      return { rows: [], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
    }) as typeof r.host.pool.query);
    handleFlairChatCommand(r.host, r.session, '/flair off', 1);
    for (let n = 0; n < 60; n++) {
      handleFlairChatCommand(r.host, { accountId: 42 }, '/flair on', 2 + n);
    }
    expect(query).toHaveBeenCalledTimes(1);
    handleFlairChatCommand(r.host, { accountId: 43 }, '/flair off', 100);
    await vi.waitFor(() => expect(r.notices).toHaveLength(1));
    expect(query).toHaveBeenCalledTimes(2);
    finish();
    await vi.waitFor(() => expect(r.notices).toHaveLength(2));
    handleFlairChatCommand(r.host, r.session, '/flair on', 101);
    await vi.waitFor(() => expect(r.notices).toHaveLength(3));
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('keeps the account busy until its identity refresh completes', async () => {
    const r = rig({ linked: true });
    let finish!: () => void;
    r.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    handleFlairChatCommand(r.host, r.session, '/flair off', 1);
    await vi.waitFor(() => expect(r.refresh).toHaveBeenCalledTimes(1));
    handleFlairChatCommand(r.host, r.session, '/flair on', 10);
    expect(r.queries).toHaveLength(1);
    finish();
    await vi.waitFor(() => expect(r.notices).toHaveLength(1));
    handleFlairChatCommand(r.host, r.session, '/flair on', 11);
    await vi.waitFor(() => expect(r.notices).toHaveLength(2));
  });

  it('releases a failed operation so a later retry can run', async () => {
    const r = rig({ linked: true });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      r.refresh.mockRejectedValueOnce(new Error('refresh failed'));
      handleFlairChatCommand(r.host, r.session, '/flair off', 1);
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
      handleFlairChatCommand(r.host, r.session, '/flair on', 2);
      await vi.waitFor(() => expect(r.notices).toEqual([FLAIR_NOTICES.shown]));
      expect(r.queries).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });

  it('a throttled sender is still claimed (never broadcast) but does no database work', () => {
    const r = rig({ linked: true, laneOpen: false });
    expect(handleFlairChatCommand(r.host, r.session, '/flair off', 1)).toBe(true);
    expect(r.queries).toEqual([]);
    expect(r.notices).toEqual([]);
  });
});

describe('stampDiscordFlair', () => {
  const flair = {
    tier: 3,
    avatarUrl: 'https://cdn.example/a.png',
    name: 'Fizban',
    joinedAtMs: 1_700_000_000_000,
    role: 'juniormods',
  };

  it('copies the linked flair onto the entity', () => {
    const e = {} as Entity;
    stampDiscordFlair(e, flair);
    expect(e.discordTier).toBe(3);
    expect(e.discordAvatar).toBe('https://cdn.example/a.png');
    expect(e.discordName).toBe('Fizban');
    expect(e.discordJoined).toBe(1_700_000_000_000);
    expect(e.discordRole).toBe('juniormods');
  });

  it('a hidden role (null from discordFlairForAccount) clears only the role', () => {
    const e = {} as Entity;
    stampDiscordFlair(e, flair);
    stampDiscordFlair(e, { ...flair, role: null });
    expect(e.discordRole).toBeUndefined();
    expect(e.discordTier).toBe(3);
    expect(e.discordName).toBe('Fizban');
  });

  it('an unlinked account clears every field', () => {
    const e = {} as Entity;
    stampDiscordFlair(e, flair);
    stampDiscordFlair(e, null);
    expect(e.discordTier).toBe(0);
    expect(e.discordAvatar).toBeUndefined();
    expect(e.discordName).toBeUndefined();
    expect(e.discordJoined).toBeUndefined();
    expect(e.discordRole).toBeUndefined();
  });

  it('writes nothing when every field already matches', () => {
    const e = {} as Entity;
    stampDiscordFlair(e, flair);
    let writes = 0;
    let role = e.discordRole;
    Object.defineProperty(e, 'discordRole', {
      get: () => role,
      set: (v) => {
        writes++;
        role = v;
      },
    });
    stampDiscordFlair(e, flair);
    expect(writes).toBe(0);
  });
});

describe('/flair notices are re-localized on the client', () => {
  it('every notice is recognized in every language and translated outside English', () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const notice of Object.values(FLAIR_NOTICES)) {
        const out = localizeServerText(notice);
        expect(out, `${lang}: "${notice}" should be recognized`).not.toBeNull();
        if (lang !== 'en' && lang !== 'en_CA') {
          expect(out, `${lang}: "${notice}" should not stay English`).not.toBe(notice);
        }
      }
    }
    setLanguage('en');
  });
});
