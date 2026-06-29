// Persistent social state, mirrored from the server's SocialService. Mirrors
// server/social.ts shapes; kept here so the HUD has no server-side imports.
export type PresenceStatus = 'online' | 'combat' | 'dungeon' | 'dead';
export type GuildRank = 'leader' | 'officer' | 'member';

export interface FriendInfo {
  id: number;
  name: string;
  cls: string;
  level: number;
  realm: string;
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
  // live world position of an online character, for plotting on the map
  x?: number;
  z?: number;
}

export interface GuildMemberInfo extends FriendInfo {
  rank: GuildRank;
}

export interface GuildInfo {
  id: number;
  name: string;
  rank: GuildRank;
  members: GuildMemberInfo[];
}

export interface SocialInfo {
  friends: FriendInfo[];
  blocks: { id: number; name: string }[];
  guild: GuildInfo | null;
}

export interface CharacterSearchResult {
  name: string;
  cls: string;
  level: number;
}

export interface IWorldSocialGraph {
  // persistent social: friends, ignore/block, guilds (online play only)
  socialInfo: SocialInfo | null;
  friendAdd(name: string): void;
  friendRemove(name: string): void;
  blockAdd(name: string): void;
  blockRemove(name: string): void;
  guildCreate(name: string): void;
  guildInvite(name: string): void;
  guildAccept(): void;
  guildDecline(): void;
  guildLeave(): void;
  guildKick(name: string): void;
  guildPromote(name: string): void;
  guildDemote(name: string): void;
  guildTransfer(name: string): void;
  guildDisband(): void;
  // realm-scoped username typeahead for friend/ignore/guild search
  searchCharacters(query: string): Promise<CharacterSearchResult[]>;
}
