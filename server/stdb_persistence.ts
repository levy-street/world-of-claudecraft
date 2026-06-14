import type { CharacterState, MarketSave } from '../src/sim/sim';
import type { DbConnection } from '../src/net/module_bindings';
import type { ChatLogRow } from './chat_log';
import type { GamePersistence } from './game_persistence';
import { REALM } from './realm';
import type { CharInfo, CharRef, GuildRank, SocialDb } from './social';

function table(db: unknown, camelName: string, snakeName = camelName): any {
  const view = db as Record<string, any>;
  return view[camelName] ?? view[snakeName];
}

function rows<T = any>(tbl: any): T[] {
  if (!tbl?.iter) return [];
  return Array.from(tbl.iter()) as T[];
}

function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function bigintId(v: number): bigint {
  return BigInt(Math.max(0, Math.trunc(v)));
}

type CharacterRow = {
  id: bigint;
  name: string;
  className: string;
  level: number;
};

type FriendLinkRow = {
  characterId: bigint;
  friendId: bigint;
};

type BlockLinkRow = {
  characterId: bigint;
  blockedId: bigint;
};

type GuildRow = {
  id: bigint;
  name: string;
  nameKey: string;
  realm: string;
};

type GuildMemberRow = {
  characterId: bigint;
  guildId: bigint;
  rank: GuildRank;
};

type WorldStateRow = {
  key: string;
  payloadJson: string;
};

export class StdbGamePersistence implements GamePersistence {
  readonly socialDb: SocialDb;
  private localSessionCounter = 0;

  constructor(private readonly conn: DbConnection) {
    this.socialDb = new StdbSocialDb(conn);
  }

  async saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<void> {
    await this.conn.reducers.bridgeSaveCharacter({
      characterId: bigintId(characterId),
      level,
      stateJson: JSON.stringify(state),
    });
  }

  async loadMarketState(): Promise<MarketSave | null> {
    const stateTable = table(this.conn.db, 'worldState', 'world_state');
    const row = rows<WorldStateRow>(stateTable).find((r) => r.key === 'market');
    if (!row?.payloadJson) return null;
    try {
      return JSON.parse(row.payloadJson) as MarketSave;
    } catch {
      return null;
    }
  }

  async saveMarketState(save: MarketSave): Promise<void> {
    await this.conn.reducers.bridgeSaveWorldState({
      key: 'market',
      payloadJson: JSON.stringify(save),
    });
  }

  async openPlaySession(accountId: number, characterId: number, characterName: string): Promise<number> {
    const id = Date.now() * 1000 + (this.localSessionCounter++ % 1000);
    await this.conn.reducers.bridgeOpenPlaySession({
      id: BigInt(id),
      accountId: bigintId(accountId),
      characterId: bigintId(characterId),
      characterName,
    });
    return id;
  }

  async closePlaySession(sessionId: number): Promise<void> {
    await this.conn.reducers.bridgeClosePlaySession({ id: BigInt(Math.trunc(sessionId)) });
  }

  async insertChatLogs(logs: ChatLogRow[]): Promise<void> {
    for (const row of logs) {
      await this.conn.reducers.bridgeInsertChatLog({
        accountId: bigintId(row.accountId),
        characterId: bigintId(row.characterId),
        characterName: row.characterName,
        channel: row.channel,
        message: row.message,
      });
    }
  }
}

class StdbSocialDb implements SocialDb {
  constructor(private readonly conn: DbConnection) {}

  async findCharacterByName(name: string): Promise<CharInfo | null> {
    const wanted = name.trim();
    const chars = this.characters();
    const exact = chars.find((c) => c.name === wanted);
    if (exact) return this.charInfo(exact);
    const lower = wanted.toLowerCase();
    const ci = chars.filter((c) => c.name.toLowerCase() === lower);
    return ci.length === 1 ? this.charInfo(ci[0]) : null;
  }

  async getCharacter(id: number): Promise<CharInfo | null> {
    const row = this.characterById(id);
    return row ? this.charInfo(row) : null;
  }

  async addFriend(charId: number, friendId: number): Promise<void> {
    await this.conn.reducers.bridgeAddFriend({ characterId: bigintId(charId), friendId: bigintId(friendId) });
  }

  async removeFriend(charId: number, friendId: number): Promise<void> {
    await this.conn.reducers.bridgeRemoveFriend({ characterId: bigintId(charId), friendId: bigintId(friendId) });
  }

  async listFriends(charId: number): Promise<CharInfo[]> {
    return this.friendLinks()
      .filter((l) => num(l.characterId) === charId)
      .map((l) => this.characterById(num(l.friendId)))
      .filter((c): c is CharacterRow => !!c)
      .map((c) => this.charInfo(c))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async whoFriended(charId: number): Promise<number[]> {
    return this.friendLinks().filter((l) => num(l.friendId) === charId).map((l) => num(l.characterId));
  }

  async addBlock(charId: number, blockedId: number): Promise<void> {
    await this.conn.reducers.bridgeAddBlock({ characterId: bigintId(charId), blockedId: bigintId(blockedId) });
  }

  async removeBlock(charId: number, blockedId: number): Promise<void> {
    await this.conn.reducers.bridgeRemoveBlock({ characterId: bigintId(charId), blockedId: bigintId(blockedId) });
  }

  async listBlocks(charId: number): Promise<CharRef[]> {
    return this.blockLinks()
      .filter((l) => num(l.characterId) === charId)
      .map((l) => this.characterById(num(l.blockedId)))
      .filter((c): c is CharacterRow => !!c)
      .map((c) => ({ id: num(c.id), name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async blockedIds(charId: number): Promise<number[]> {
    return this.blockLinks().filter((l) => num(l.characterId) === charId).map((l) => num(l.blockedId));
  }

  async createGuild(name: string): Promise<number> {
    const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (this.guilds().some((g) => g.nameKey === key)) throw new Error('guild name already exists');
    const id = this.nextGuildId();
    await this.conn.reducers.bridgeCreateGuild({ id: bigintId(id), name });
    return id;
  }

  async deleteGuild(id: number): Promise<void> {
    await this.conn.reducers.bridgeDeleteGuild({ id: bigintId(id) });
  }

  async guildMembership(charId: number): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const member = this.guildMembersRows().find((m) => num(m.characterId) === charId);
    if (!member) return null;
    const guild = this.guilds().find((g) => num(g.id) === num(member.guildId));
    return guild ? { guildId: num(guild.id), guildName: guild.name, rank: member.rank } : null;
  }

  async addGuildMember(guildId: number, charId: number, rank: GuildRank): Promise<void> {
    await this.conn.reducers.bridgeAddGuildMember({
      guildId: bigintId(guildId),
      characterId: bigintId(charId),
      rank,
    });
  }

  async removeGuildMember(charId: number): Promise<void> {
    await this.conn.reducers.bridgeRemoveGuildMember({ characterId: bigintId(charId) });
  }

  async setGuildRank(charId: number, rank: GuildRank): Promise<void> {
    await this.conn.reducers.bridgeSetGuildRank({ characterId: bigintId(charId), rank });
  }

  async guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]> {
    return this.guildMembersRows()
      .filter((m) => num(m.guildId) === guildId)
      .map((m) => {
        const c = this.characterById(num(m.characterId));
        return c ? { ...this.charInfo(c), rank: m.rank } : null;
      })
      .filter((m): m is CharInfo & { rank: GuildRank } => !!m);
  }

  private characters(): CharacterRow[] {
    return rows<CharacterRow>(table(this.conn.db, 'character'));
  }

  private friendLinks(): FriendLinkRow[] {
    return rows<FriendLinkRow>(table(this.conn.db, 'friendLink', 'friend_link'));
  }

  private blockLinks(): BlockLinkRow[] {
    return rows<BlockLinkRow>(table(this.conn.db, 'blockLink', 'block_link'));
  }

  private guilds(): GuildRow[] {
    return rows<GuildRow>(table(this.conn.db, 'guild'));
  }

  private guildMembersRows(): GuildMemberRow[] {
    return rows<GuildMemberRow>(table(this.conn.db, 'guildMember', 'guild_member'));
  }

  private characterById(id: number): CharacterRow | null {
    return this.characters().find((c) => num(c.id) === id) ?? null;
  }

  private charInfo(row: CharacterRow): CharInfo {
    return {
      id: num(row.id),
      name: row.name,
      cls: text(row.className),
      level: num(row.level),
      realm: REALM,
    };
  }

  private nextGuildId(): number {
    const maxExisting = this.guilds().reduce((max, g) => Math.max(max, num(g.id)), 0);
    return Math.max(maxExisting + 1, Date.now());
  }
}
