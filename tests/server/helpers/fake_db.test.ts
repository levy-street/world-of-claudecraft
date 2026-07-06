// Self-tests for the in-memory db fakes. These exercise the fakes' behaviour AND
// prove the file (including the build-time drift guard in fake_db.ts) compiles and
// runs without ever constructing the pg pool: the fakes have zero runtime imports,
// so this suite needs no DATABASE_URL, no mock, and no live Postgres.
import { describe, expect, it } from 'vitest';
import type {
  ArenaLeaderRow,
  CharacterRow,
  GuildLeaderRow,
  LifetimeXpLeaderRow,
} from '../../../server/db';
import type { LiveReportTarget } from '../../../server/moderation_db';
import { FakeCharactersDb, FakeLeaderboardDb, FakeReportsDb } from './fake_db';

function charRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1,
    account_id: 1,
    name: 'Aldric',
    class: 'warrior',
    level: 1,
    state: null,
    is_gm: false,
    force_rename: false,
    ...over,
  };
}

function xpRow(name: string, lifetimeXp: number): LifetimeXpLeaderRow {
  return { name, class: 'warrior', level: 60, realm: 'test-realm', lifetimeXp, prestigeRank: 0 };
}

describe('FakeCharactersDb', () => {
  it('seeds a character and reads it back, enforcing ownership', async () => {
    const db = new FakeCharactersDb();
    db.seed(charRow({ id: 7, account_id: 3, name: 'Mira', class: 'mage' }));

    expect(await db.getCharacterById(7)).toMatchObject({ id: 7, name: 'Mira' });
    expect(await db.getCharacter(3, 7)).toMatchObject({ id: 7, name: 'Mira' });
    // getCharacter is ownership-scoped: a different account sees nothing.
    expect(await db.getCharacter(99, 7)).toBeNull();
    expect(await db.getCharacterById(999)).toBeNull();

    const list = await db.listCharacters(3);
    expect(list.map((c) => c.id)).toEqual([7]);
    expect(await db.listCharacters(99)).toEqual([]);
  });

  it('createCharacterCapped respects the cap and hands out distinct ids', async () => {
    const db = new FakeCharactersDb();
    const a = await db.createCharacterCapped(1, 'One', 'warrior', 2);
    const b = await db.createCharacterCapped(1, 'Two', 'mage', 2);
    const c = await db.createCharacterCapped(1, 'Three', 'rogue', 2);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull(); // cap of 2 reached
    expect(a?.id).not.toBe(b?.id);
    expect((await db.listCharacters(1)).length).toBe(2);

    // The cap is per account, so a different account can still create.
    expect(await db.createCharacterCapped(2, 'Other', 'priest', 2)).not.toBeNull();
  });

  it('deleteCharacter returns the right boolean', async () => {
    const db = new FakeCharactersDb();
    db.seed(charRow({ id: 5, account_id: 2 }));

    expect(await db.deleteCharacter(2, 5)).toBe(true); // owned + present
    expect(await db.deleteCharacter(2, 5)).toBe(false); // already gone
    expect(await db.deleteCharacter(2, 404)).toBe(false); // never existed
    db.seed(charRow({ id: 6, account_id: 2 }));
    expect(await db.deleteCharacter(99, 6)).toBe(false); // not owned by caller
  });

  it('renameCharacter only renames an owned, force_rename row and clears the flag', async () => {
    const db = new FakeCharactersDb();
    db.seed(charRow({ id: 8, account_id: 4, name: 'Old', force_rename: true }));

    expect(await db.renameCharacter(4, 8, 'New')).toMatchObject({
      name: 'New',
      force_rename: false,
    });
    // Flag cleared, so a second rename no longer lands.
    expect(await db.renameCharacter(4, 8, 'Newer')).toBeNull();
  });

  it('findCharacterReportTargetByName resolves a live target shape', async () => {
    const db = new FakeCharactersDb();
    db.seed(charRow({ id: 11, account_id: 5, name: 'Griefer' }));
    const target = await db.findCharacterReportTargetByName('griefer');
    expect(target).toEqual<LiveReportTarget>({
      accountId: 5,
      characterId: 11,
      characterName: 'Griefer',
    });
    expect(await db.findCharacterReportTargetByName('nobody')).toBeNull();
  });
});

describe('FakeLeaderboardDb', () => {
  it('returns seeded lifetime-xp rows in order, honouring the limit', async () => {
    const db = new FakeLeaderboardDb();
    db.seedLifetimeXp([xpRow('Top', 1000), xpRow('Mid', 500), xpRow('Low', 100)]);

    expect((await db.topLifetimeXp()).map((r) => r.name)).toEqual(['Top', 'Mid', 'Low']);
    expect((await db.topLifetimeXp(2)).map((r) => r.name)).toEqual(['Top', 'Mid']);
  });

  it('returns seeded arena and guild rows', async () => {
    const db = new FakeLeaderboardDb();
    const arena: ArenaLeaderRow[] = [
      { name: 'Gladiator', class: 'warrior', level: 60, rating: 2400, wins: 50, losses: 5 },
    ];
    const guilds: GuildLeaderRow[] = [
      {
        name: 'Ascendant',
        realm: 'test-realm',
        memberCount: 30,
        totalLifetimeXp: 9999,
        topLevel: 60,
      },
    ];
    db.seedArena(arena);
    db.seedGuilds(guilds);

    expect((await db.topArenaRatings(10, '2v2')).map((r) => r.name)).toEqual(['Gladiator']);
    expect((await db.topGuilds()).map((r) => r.name)).toEqual(['Ascendant']);
  });
});

describe('FakeReportsDb', () => {
  it('createPlayerReport returns an incrementing id and records each input', async () => {
    const db = new FakeReportsDb();
    const target: LiveReportTarget = { accountId: 9, characterId: 90, characterName: 'Griefer' };

    const first = await db.createPlayerReport({
      reporterAccountId: 1,
      reporterCharacterId: 10,
      reporterCharacterName: 'Aldric',
      target,
      reason: 'harassment',
      details: 'spammed me',
    });
    const second = await db.createPlayerReport({
      reporterAccountId: 2,
      reporterCharacterId: 20,
      reporterCharacterName: 'Mira',
      target,
      reason: 'spam',
      details: null,
    });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(db.reports.length).toBe(2);
    expect(db.reports[0]).toMatchObject({ id: 1, reason: 'harassment' });
  });
});
