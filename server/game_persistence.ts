import type { CharacterState, MarketSave } from '../src/sim/sim';
import type { ChatLogRow } from './chat_log';
import type { CharInfo, CharRef, GuildRank, SocialDb } from './social';

export interface GamePersistence {
  readonly socialDb: SocialDb;
  saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<void>;
  loadMarketState(): Promise<MarketSave | null>;
  saveMarketState(save: MarketSave): Promise<void>;
  openPlaySession(accountId: number, characterId: number, characterName: string): Promise<number | null>;
  closePlaySession(sessionId: number): Promise<void>;
  insertChatLogs(rows: ChatLogRow[]): Promise<void>;
}

class MemorySocialDb implements SocialDb {
  private nextGuild = 1;
  private readonly guilds = new Map<number, { name: string }>();
  private readonly guildByCharacter = new Map<number, { guildId: number; rank: GuildRank }>();

  async findCharacterByName(_name: string): Promise<CharInfo | null> {
    return null;
  }

  async getCharacter(_id: number): Promise<CharInfo | null> {
    return null;
  }

  async addFriend(_charId: number, _friendId: number): Promise<void> {}

  async removeFriend(_charId: number, _friendId: number): Promise<void> {}

  async listFriends(_charId: number): Promise<CharInfo[]> {
    return [];
  }

  async whoFriended(_charId: number): Promise<number[]> {
    return [];
  }

  async addBlock(_charId: number, _blockedId: number): Promise<void> {}

  async removeBlock(_charId: number, _blockedId: number): Promise<void> {}

  async listBlocks(_charId: number): Promise<CharRef[]> {
    return [];
  }

  async blockedIds(_charId: number): Promise<number[]> {
    return [];
  }

  async createGuild(name: string): Promise<number> {
    const key = name.trim().toLowerCase();
    for (const guild of this.guilds.values()) {
      if (guild.name.trim().toLowerCase() === key) throw new Error('guild name already exists');
    }
    const id = this.nextGuild++;
    this.guilds.set(id, { name });
    return id;
  }

  async deleteGuild(id: number): Promise<void> {
    this.guilds.delete(id);
    for (const [charId, member] of this.guildByCharacter) {
      if (member.guildId === id) this.guildByCharacter.delete(charId);
    }
  }

  async guildMembership(charId: number): Promise<{ guildId: number; guildName: string; rank: GuildRank } | null> {
    const member = this.guildByCharacter.get(charId);
    if (!member) return null;
    const guild = this.guilds.get(member.guildId);
    return guild ? { guildId: member.guildId, guildName: guild.name, rank: member.rank } : null;
  }

  async addGuildMember(guildId: number, charId: number, rank: GuildRank): Promise<void> {
    this.guildByCharacter.set(charId, { guildId, rank });
  }

  async removeGuildMember(charId: number): Promise<void> {
    this.guildByCharacter.delete(charId);
  }

  async setGuildRank(charId: number, rank: GuildRank): Promise<void> {
    const member = this.guildByCharacter.get(charId);
    if (member) this.guildByCharacter.set(charId, { ...member, rank });
  }

  async guildMembers(guildId: number): Promise<(CharInfo & { rank: GuildRank })[]> {
    void guildId;
    return [];
  }
}

export function createMemoryGamePersistence(): GamePersistence {
  return {
    socialDb: new MemorySocialDb(),
    async saveCharacterState(_characterId: number, _level: number, _state: CharacterState): Promise<void> {},
    async loadMarketState(): Promise<MarketSave | null> {
      return null;
    },
    async saveMarketState(_save: MarketSave): Promise<void> {},
    async openPlaySession(_accountId: number, _characterId: number, _characterName: string): Promise<number | null> {
      return null;
    },
    async closePlaySession(_sessionId: number): Promise<void> {},
    async insertChatLogs(_rows: ChatLogRow[]): Promise<void> {},
  };
}
