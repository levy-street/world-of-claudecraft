// Unit coverage for discordFlexForAccounts (server/discord.ts), the payload
// assembly behind POST /internal/discord/flex-batch.
//
// tests/server/internal.test.ts mocks this function away to pin the ROUTE, and
// tests/discord_db.test.ts pins the SQL underneath it, so the mapping in the
// middle (row -> DiscordFlex) is what this file owns. That mapping carries the
// load-bearing claim of the whole endpoint: for a LINKED id the batch entry must
// be field-for-field what the per-id GET /internal/discord/flex would have
// answered, because both routes stay live and the bot may call either. The last
// test proves that by running BOTH functions over the same underlying data rather
// than by restating the expected fields twice.
//
// server/db.ts builds a pg Pool at module load and throws when DATABASE_URL is
// unset; it is fully mocked here so the real db never loads, and a dummy URL is
// set defensively all the same. server/realm.ts is mocked too, so the realm and
// the public origin are values this test CHOSE rather than whatever the ambient
// environment happens to hold (an assertion driven by the same expression the
// source reads would pin nothing).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_phase4_flex_batch';
});

// PARTIAL mocks (spread the real module, override only what this file drives).
// A wholesale factory would have to enumerate every export the transitive server
// graph reaches, and would break the day an unrelated module imports one more.
// The real server/db is loaded, which is safe: the pg Pool is constructed but
// never connects, so no statement here reaches a database.
vi.mock('../../server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/db')>()),
  highestCharacterForAccount: vi.fn(),
}));
vi.mock('../../server/discord_db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/discord_db')>()),
  discordFlexRowsForDiscordIds: vi.fn(),
  discordForAccount: vi.fn(),
  loadRewardState: vi.fn(),
}));
// The realm and the public origin are read from the environment at module load,
// so they are pinned to chosen values here: asserting against the same expression
// the source reads would pin nothing.
vi.mock('../../server/realm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/realm')>()),
  REALM: 'testrealm',
  REALM_PUBLIC_ORIGIN: 'https://woc.test',
}));

import { highestCharacterForAccount, pool } from '../../server/db';
import { discordFlexForAccount, discordFlexForAccounts } from '../../server/discord';
import type { DiscordFlexBatchRow } from '../../server/discord_db';
import {
  discordFlexRowsForDiscordIds,
  discordForAccount,
  loadRewardState,
} from '../../server/discord_db';

/**
 * One batched-read row, minted FRESH per call. The mapping stores nothing by
 * reference, but building expectations from a shared object is how a round-trip
 * pin quietly becomes a comparison of an object with itself.
 */
function flexRow(overrides: Partial<DiscordFlexBatchRow> = {}): DiscordFlexBatchRow {
  return {
    discord_user_id: 'du1',
    account_id: 7,
    discord_username: 'coolguy',
    points: 1500,
    lifetime_points: 2000,
    character_name: 'Hero',
    character_class: 'warrior',
    character_level: 40,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discordFlexForAccounts', () => {
  it('reads the whole batch once, through the realm-scoped batched query', async () => {
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([]);

    await discordFlexForAccounts(['du1', 'du2', 'du3']);

    expect(vi.mocked(discordFlexRowsForDiscordIds)).toHaveBeenCalledTimes(1);
    // The realm is the mocked 'testrealm', so this pins that the value is passed
    // through at all rather than defaulted or dropped.
    expect(vi.mocked(discordFlexRowsForDiscordIds)).toHaveBeenCalledWith(
      pool,
      ['du1', 'du2', 'du3'],
      'testrealm',
    );
  });

  it('does not touch the database for an empty id list', async () => {
    expect(await discordFlexForAccounts([])).toEqual([]);
    expect(vi.mocked(discordFlexRowsForDiscordIds)).not.toHaveBeenCalled();
  });

  it('maps a linked row with a character to the full payload', async () => {
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([flexRow()]);

    // 2000 lifetime points is exactly the "knight" rung (index 4) through the REAL
    // discordStatusIndexForPoints, so the tier is derived rather than echoed.
    expect(await discordFlexForAccounts(['du1'])).toEqual([
      {
        discord_user_id: 'du1',
        linked: true,
        found: true,
        username: 'coolguy',
        statusTier: 4,
        points: 1500,
        character: {
          name: 'Hero',
          class: 'warrior',
          level: 40,
          profileUrl: 'https://woc.test/c/Hero',
        },
      },
    ]);
  });

  it('reports found false with a null character for a linked account with none', async () => {
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([
      flexRow({
        discord_user_id: 'du2',
        discord_username: null,
        points: 0,
        lifetime_points: 0,
        character_name: null,
        character_class: null,
        character_level: null,
      }),
    ]);

    // statusTier 1, NOT 0. The rung index is 1-based (discordStatusByIndex
    // accepts 1 to 8) and 0 is the reserved "no rung" sentinel the per-id route
    // answers for an UNLINKED id. Every batch row IS a link row, so a linked
    // account with zero lifetime points sits on the bottom rung rather than on
    // the sentinel; collapsing the two would silently strip the badge from every
    // freshly linked player.
    expect(await discordFlexForAccounts(['du2'])).toEqual([
      {
        discord_user_id: 'du2',
        linked: true,
        found: false,
        username: null,
        statusTier: 1,
        points: 0,
        character: null,
      },
    ]);
  });

  it('percent-encodes a character name into the profile URL', async () => {
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([
      flexRow({ character_name: 'Hero Two' }),
    ]);

    const [entry] = await discordFlexForAccounts(['du1']);
    // A raw space would produce a broken link, so the encoding is contract.
    expect(entry.character?.profileUrl).toBe('https://woc.test/c/Hero%20Two');
    expect(entry.character?.name).toBe('Hero Two');
  });

  it('returns entries only for ids the read matched, never a stub for the rest', async () => {
    // Three ids asked about, one linked. The unlinked two must be ABSENT, which is
    // the batch equivalent of the per-id route's { linked: false }; a zeroed stub
    // would be indistinguishable from a linked account with nothing to show.
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([
      flexRow({ discord_user_id: 'du1' }),
    ]);

    const entries = await discordFlexForAccounts(['du1', 'du2', 'du3']);

    expect(entries).toHaveLength(1);
    expect(entries.map((e) => e.discord_user_id)).toEqual(['du1']);
  });

  it('answers a linked id field-for-field the same as the per-id flex endpoint', async () => {
    // THE parity pin. Both routes stay live (the per-id one is not retired), so a
    // drift between them shows the player a different character or tier depending
    // on which one the bot happened to call. Rather than restating the expected
    // fields, this drives BOTH functions over the SAME underlying account data and
    // compares their outputs.
    const account = {
      accountId: 7,
      discordUserId: 'du1',
      username: 'coolguy',
      points: 1500,
      lifetimePoints: 2000,
      characterName: 'Hero',
      characterClass: 'warrior',
      characterLevel: 40,
    };

    // The per-id path: three separate reads.
    vi.mocked(highestCharacterForAccount).mockResolvedValue({
      id: 1,
      account_id: account.accountId,
      name: account.characterName,
      class: account.characterClass,
      level: account.characterLevel,
      state: null,
      is_gm: false,
      force_rename: false,
    } as never);
    vi.mocked(loadRewardState).mockResolvedValue({
      points: account.points,
      lifetimePoints: account.lifetimePoints,
    });
    vi.mocked(discordForAccount).mockResolvedValue({
      account_id: account.accountId,
      discord_user_id: account.discordUserId,
      discord_username: account.username,
      discord_avatar: null,
      discord_email: null,
      guild_member: true,
      linked_at: 'x',
    });
    const single = await discordFlexForAccount(account.accountId);

    // The batched path: one row carrying the same values.
    vi.mocked(discordFlexRowsForDiscordIds).mockResolvedValue([
      {
        discord_user_id: account.discordUserId,
        account_id: account.accountId,
        discord_username: account.username,
        points: account.points,
        lifetime_points: account.lifetimePoints,
        character_name: account.characterName,
        character_class: account.characterClass,
        character_level: account.characterLevel,
      },
    ]);
    const [batched] = await discordFlexForAccounts([account.discordUserId]);

    // The batch entry is the single payload plus the two routing fields.
    const { discord_user_id, linked, ...payload } = batched;
    expect(payload).toEqual(single);
    expect(discord_user_id).toBe(account.discordUserId);
    expect(linked).toBe(true);
    // Non-vacuous: the shared payload is not an empty object, and it really did
    // carry the derived tier and the character rather than nulls on both sides.
    expect(single.found).toBe(true);
    expect(single.statusTier).toBe(4);
    expect(single.character?.name).toBe('Hero');
  });
});
