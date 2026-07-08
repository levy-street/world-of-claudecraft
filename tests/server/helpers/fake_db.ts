// In-memory fakes for the database functions the API pipeline depends on, plus a
// build-time drift guard that keeps the hand-written interfaces honest against the
// real server/db.ts (and server/moderation_db.ts) signatures.
//
// Why fakes and not a mocked pool: server/db.ts constructs a pg Pool at module
// load and THROWS when DATABASE_URL is unset, so a logic test must NOT import it
// at runtime. Everything below references db.ts only through `import type`, which
// is fully erased: this module has zero runtime imports and never constructs the
// pool. Tests inject one of these fakes wherever production code would take a real
// CharactersDb / LeaderboardDb / ReportsDb, mirroring the SocialDb/PgSocialDb
// idiom in server/social.ts + server/social_db.ts.
import type * as Db from '../../../server/db';
import type * as ModDb from '../../../server/moderation_db';
import type { CharacterState, MailSave, MarketSave } from '../../../src/sim/sim';
import type { ArenaFormat, PlayerClass } from '../../../src/sim/types';

// ---------------------------------------------------------------------------
// Interfaces (extracted faithfully from the real db.ts signatures)
// ---------------------------------------------------------------------------

// Character reads + writes. Optional params mirror the real defaults
// (createCharacterCapped limit/state, searchCharacters limit,
// listCharacterNamesForSitemap limit), so the real functions stay assignable.
export interface CharactersDb {
  listCharacters(accountId: number): Promise<Db.CharacterRow[]>;
  getCharacter(accountId: number, characterId: number): Promise<Db.CharacterRow | null>;
  getCharacterById(characterId: number): Promise<Db.CharacterRow | null>;
  createCharacterCapped(
    accountId: number,
    name: string,
    cls: PlayerClass,
    limit?: number,
    state?: CharacterState | null,
  ): Promise<Db.CharacterRow | null>;
  renameCharacter(
    accountId: number,
    characterId: number,
    name: string,
  ): Promise<Db.CharacterRow | null>;
  deleteCharacter(accountId: number, characterId: number): Promise<boolean>;
  characterCountsByRealm(accountId: number): Promise<Record<string, number>>;
  searchCharacters(prefix: string, limit?: number): Promise<Db.CharacterSearchRow[]>;
  saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<void>;
  saveCharacterAndMarketState(
    characterId: number,
    level: number,
    state: CharacterState,
    market: MarketSave,
    mail: MailSave,
  ): Promise<void>;
  lifetimeXpStanding(
    accountId: number,
    characterId: number,
  ): Promise<{ rank: number; total: number } | null>;
  lifetimeXpRankForCharacter(characterId: number): Promise<{ rank: number; total: number } | null>;
  guildNameForCharacter(characterId: number): Promise<string | null>;
  findCharacterReportTargetByName(name: string): Promise<ModDb.LiveReportTarget | null>;
  listCharacterNamesForSitemap(limit?: number): Promise<string[]>;
}

export interface LeaderboardDb {
  topLifetimeXp(limit?: number, opts?: { global?: boolean }): Promise<Db.LifetimeXpLeaderRow[]>;
  topArenaRatings(limit?: number, format?: ArenaFormat): Promise<Db.ArenaLeaderRow[]>;
  topGuilds(limit?: number, opts?: { global?: boolean }): Promise<Db.GuildLeaderRow[]>;
}

export interface ReportsDb {
  createPlayerReport(input: {
    reporterAccountId: number;
    reporterCharacterId: number;
    reporterCharacterName: string;
    target: ModDb.LiveReportTarget;
    reason: ModDb.ReportReason;
    details: unknown;
  }): Promise<{ id: number }>;
}

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

// The fakes only need a single synthetic realm to bucket characterCountsByRealm.
const FAKE_REALM = 'test-realm';
// Mirror the real defaults so the cap/limit behaviour matches db.ts.
const DEFAULT_CHARACTER_CAP = 10;
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_TOP_LIMIT = 100;
const DEFAULT_ARENA_TOP_LIMIT = 20;
const DEFAULT_SITEMAP_LIMIT = 50000;

export class FakeCharactersDb implements CharactersDb {
  // Keyed by character id, the in-memory equivalent of the characters table.
  private readonly rows = new Map<number, Db.CharacterRow>();
  private nextId = 1;
  // Optional seedable lookups for the standing/guild reads.
  private readonly standings = new Map<number, { rank: number; total: number }>();
  private readonly guildNames = new Map<number, string>();
  // The last market and mail blobs saved alongside a character, for assertions.
  lastMarket: MarketSave | null = null;
  lastMail: MailSave | null = null;

  // Test seam: insert a fully-formed row and keep nextId ahead of it.
  seed(row: Db.CharacterRow): Db.CharacterRow {
    this.rows.set(row.id, row);
    if (row.id >= this.nextId) this.nextId = row.id + 1;
    return row;
  }

  seedStanding(characterId: number, standing: { rank: number; total: number }): void {
    this.standings.set(characterId, standing);
  }

  seedGuildName(characterId: number, guildName: string): void {
    this.guildNames.set(characterId, guildName);
  }

  private owned(accountId: number): Db.CharacterRow[] {
    return [...this.rows.values()].filter((r) => r.account_id === accountId);
  }

  async listCharacters(accountId: number): Promise<Db.CharacterRow[]> {
    return this.owned(accountId).sort((a, b) => a.id - b.id);
  }

  async getCharacter(accountId: number, characterId: number): Promise<Db.CharacterRow | null> {
    const row = this.rows.get(characterId);
    return row && row.account_id === accountId ? row : null;
  }

  async getCharacterById(characterId: number): Promise<Db.CharacterRow | null> {
    return this.rows.get(characterId) ?? null;
  }

  async createCharacterCapped(
    accountId: number,
    name: string,
    cls: PlayerClass,
    limit = DEFAULT_CHARACTER_CAP,
    state: CharacterState | null = null,
  ): Promise<Db.CharacterRow | null> {
    if (this.owned(accountId).length >= limit) return null; // cap reached
    const row: Db.CharacterRow = {
      id: this.nextId++,
      account_id: accountId,
      name,
      class: cls,
      level: 1,
      state,
      is_gm: false,
      force_rename: false,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async renameCharacter(
    accountId: number,
    characterId: number,
    name: string,
  ): Promise<Db.CharacterRow | null> {
    const row = this.rows.get(characterId);
    // Like db.ts: a rename only lands on an owned row flagged force_rename, and it
    // clears the flag so it self-limits to one rename per moderator action.
    if (!row || row.account_id !== accountId || !row.force_rename) return null;
    const next: Db.CharacterRow = { ...row, name, force_rename: false };
    this.rows.set(characterId, next);
    return next;
  }

  async deleteCharacter(accountId: number, characterId: number): Promise<boolean> {
    const row = this.rows.get(characterId);
    if (!row || row.account_id !== accountId) return false;
    this.rows.delete(characterId);
    return true;
  }

  async characterCountsByRealm(accountId: number): Promise<Record<string, number>> {
    const count = this.owned(accountId).length;
    return count > 0 ? { [FAKE_REALM]: count } : {};
  }

  async searchCharacters(
    prefix: string,
    limit = DEFAULT_SEARCH_LIMIT,
  ): Promise<Db.CharacterSearchRow[]> {
    const term = prefix.trim().toLowerCase();
    if (!term) return [];
    return [...this.rows.values()]
      .filter((r) => r.name.toLowerCase().startsWith(term))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((r) => ({ name: r.name, cls: r.class, level: r.level }));
  }

  async saveCharacterState(
    characterId: number,
    level: number,
    state: CharacterState,
  ): Promise<void> {
    const row = this.rows.get(characterId);
    if (row) this.rows.set(characterId, { ...row, level, state });
  }

  async saveCharacterAndMarketState(
    characterId: number,
    level: number,
    state: CharacterState,
    market: MarketSave,
    mail: MailSave,
  ): Promise<void> {
    await this.saveCharacterState(characterId, level, state);
    this.lastMarket = market;
    this.lastMail = mail;
  }

  async lifetimeXpStanding(
    accountId: number,
    characterId: number,
  ): Promise<{ rank: number; total: number } | null> {
    const row = this.rows.get(characterId);
    if (!row || row.account_id !== accountId) return null; // ownership gate
    return this.standings.get(characterId) ?? null;
  }

  async lifetimeXpRankForCharacter(
    characterId: number,
  ): Promise<{ rank: number; total: number } | null> {
    if (!this.rows.has(characterId)) return null;
    return this.standings.get(characterId) ?? null;
  }

  async guildNameForCharacter(characterId: number): Promise<string | null> {
    return this.guildNames.get(characterId) ?? null;
  }

  async findCharacterReportTargetByName(name: string): Promise<ModDb.LiveReportTarget | null> {
    const term = name.trim().toLowerCase();
    if (!term) return null;
    const row = [...this.rows.values()].find((r) => r.name.toLowerCase() === term);
    return row ? { accountId: row.account_id, characterId: row.id, characterName: row.name } : null;
  }

  async listCharacterNamesForSitemap(limit = DEFAULT_SITEMAP_LIMIT): Promise<string[]> {
    return [...this.rows.values()].map((r) => r.name).slice(0, Math.max(0, limit));
  }
}

export class FakeLeaderboardDb implements LeaderboardDb {
  private lifetimeXp: Db.LifetimeXpLeaderRow[] = [];
  private arena: Db.ArenaLeaderRow[] = [];
  private guilds: Db.GuildLeaderRow[] = [];

  // Tests seed pre-sorted rows; the fake returns them in order, honouring limit.
  seedLifetimeXp(rows: Db.LifetimeXpLeaderRow[]): void {
    this.lifetimeXp = [...rows];
  }

  seedArena(rows: Db.ArenaLeaderRow[]): void {
    this.arena = [...rows];
  }

  seedGuilds(rows: Db.GuildLeaderRow[]): void {
    this.guilds = [...rows];
  }

  async topLifetimeXp(
    limit = DEFAULT_TOP_LIMIT,
    _opts: { global?: boolean } = {},
  ): Promise<Db.LifetimeXpLeaderRow[]> {
    return this.lifetimeXp.slice(0, limit);
  }

  async topArenaRatings(
    limit = DEFAULT_ARENA_TOP_LIMIT,
    _format: ArenaFormat = '1v1',
  ): Promise<Db.ArenaLeaderRow[]> {
    return this.arena.slice(0, limit);
  }

  async topGuilds(
    limit = DEFAULT_TOP_LIMIT,
    _opts: { global?: boolean } = {},
  ): Promise<Db.GuildLeaderRow[]> {
    return this.guilds.slice(0, limit);
  }
}

type StoredReport = Parameters<ReportsDb['createPlayerReport']>[0] & { id: number };

export class FakeReportsDb implements ReportsDb {
  // Every accepted report, in insertion order, for assertions.
  readonly reports: StoredReport[] = [];
  private nextId = 1;

  async createPlayerReport(
    input: Parameters<ReportsDb['createPlayerReport']>[0],
  ): Promise<{ id: number }> {
    const id = this.nextId++;
    this.reports.push({ ...input, id });
    return { id };
  }
}

// ---------------------------------------------------------------------------
// Build-time drift guard
// ---------------------------------------------------------------------------
//
// The interfaces above are hand-written, so they can silently drift from the real
// db.ts / moderation_db.ts functions they mirror. These assertions pin them at
// COMPILE time without ever loading the pg pool (the `import type * as` above is
// fully erased). For each interface, an object whose properties are the REAL
// function types must stay assignable to the interface: if a real signature
// changes incompatibly, the conformance type stops being `true`, the `= true`
// assignment below fails, and tsc errors here. To prove the guard bites, change
// one interface method's signature and re-run `tsc`.
type _AssertAssignable<A, B> = A extends B ? true : ['DRIFT', A, B];

type _CharactersConforms = _AssertAssignable<
  {
    listCharacters: typeof Db.listCharacters;
    getCharacter: typeof Db.getCharacter;
    getCharacterById: typeof Db.getCharacterById;
    createCharacterCapped: typeof Db.createCharacterCapped;
    renameCharacter: typeof Db.renameCharacter;
    deleteCharacter: typeof Db.deleteCharacter;
    characterCountsByRealm: typeof Db.characterCountsByRealm;
    searchCharacters: typeof Db.searchCharacters;
    saveCharacterState: typeof Db.saveCharacterState;
    saveCharacterAndMarketState: typeof Db.saveCharacterAndMarketState;
    lifetimeXpStanding: typeof Db.lifetimeXpStanding;
    lifetimeXpRankForCharacter: typeof Db.lifetimeXpRankForCharacter;
    guildNameForCharacter: typeof Db.guildNameForCharacter;
    findCharacterReportTargetByName: typeof Db.findCharacterReportTargetByName;
    listCharacterNamesForSitemap: typeof Db.listCharacterNamesForSitemap;
  },
  CharactersDb
>;
const _charactersCheck: _CharactersConforms = true;

type _LeaderboardConforms = _AssertAssignable<
  {
    topLifetimeXp: typeof Db.topLifetimeXp;
    topArenaRatings: typeof Db.topArenaRatings;
    topGuilds: typeof Db.topGuilds;
  },
  LeaderboardDb
>;
const _leaderboardCheck: _LeaderboardConforms = true;

type _ReportsConforms = _AssertAssignable<
  { createPlayerReport: typeof ModDb.createPlayerReport },
  ReportsDb
>;
const _reportsCheck: _ReportsConforms = true;
