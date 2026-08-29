// Persistent social state, mirrored from the server's SocialService. Mirrors
// server/social.ts shapes; kept here so the HUD has no server-side imports.
import type { PlayerFlair } from '../sim/account_flair';

export type PresenceStatus = 'online' | 'combat' | 'dungeon' | 'dead' | 'afk';
export type GuildRank = 'leader' | 'officer' | 'member';

export interface FriendInfo {
  id: number;
  name: string;
  cls: string;
  level: number;
  realm: string;
  // The selected Book of Deeds title: a deed id (never display text; the
  // client localizes through deed_i18n.ts deedTitleText), null when untitled.
  activeTitle: string | null;
  online: boolean;
  zone?: string;
  status?: PresenceStatus;
  // live world position of an online character, for plotting on the map
  x?: number;
  z?: number;
}

export interface GuildMemberInfo extends FriendInfo {
  rank: GuildRank;
  // ISO-8601 timestamp of this member's last world entry, or null if never
  // recorded. Rides the 'social' frame; drives the "last seen" roster readout.
  lastLogin: string | null;
  // Epoch-ms timestamp of when this member joined the guild, or null when the
  // server did not send one. Rides the 'social' frame; drives the roster tenure
  // badges (New / Veteran).
  joinedAt: number | null;
}

// One guild calendar event (the event calendar's guild lane). `day` is a UTC
// 'YYYY-MM-DD'; `hour` is 0-23 or null for an all-day event; `createdBy` is
// the author's display name (verbatim proper noun).
export interface GuildEventInfo {
  id: number;
  day: string;
  hour: number | null;
  title: string;
  note: string;
  createdBy: string;
}

// Guild pledge board (docs/prd/guild-pledge-board.md): the recruiting settings
// the Guild Master and officers control. Mirrors server/social.ts.
export interface GuildPledgeSettings {
  enabled: boolean;
  minLevel: number;
  note: string;
}

// One open pledge on the officer dashboard: who is asking, and since when.
export interface GuildPledgeInfo {
  id: number;
  name: string;
  cls: string;
  level: number;
  realm: string;
  sinceMs: number;
}

// The viewer's OWN standing pledge (unguilded characters only): the guild it
// names, when it was made, and that guild's colour tier for display.
export interface MyPledgeInfo {
  guildName: string;
  sinceMs: number;
  tier: number;
}

export interface GuildInfo {
  id: number;
  name: string;
  rank: GuildRank;
  // The guild billboard: a short officer-set message pinned atop the Guild tab
  // ('' when unset), with the setter's display name for attribution. Rendered
  // as plain escaped text only (player-controlled; never linkified).
  motd: string;
  motdSetBy: string;
  members: GuildMemberInfo[];
  events: GuildEventInfo[];
  // Pledge board: the recruiting settings every member sees, the open pledges
  // (server sends them only to officer-plus; empty for plain members), and the
  // guild's lifetime-XP colour tier (guildTierForLifetimeXp).
  pledgeSettings: GuildPledgeSettings;
  pledges: GuildPledgeInfo[];
  tier: number;
}

export interface SocialInfo {
  friends: FriendInfo[];
  blocks: { id: number; name: string }[];
  // personal chat ignores: hides their public chat from you and nothing else.
  // A block is the heavy tool (invites, whispers, mail, /who all die with it).
  // Neither is the ADMIN "mute", which is a staff silence applied to a player.
  ignores: { id: number; name: string }[];
  guild: GuildInfo | null;
  // The viewer's own standing pledge; null when none (and always null while
  // guilded: joining any guild clears the pledge server-side).
  myPledge: MyPledgeInfo | null;
}

export interface CharacterSearchResult {
  name: string;
  cls: string;
  level: number;
}

// The public character sheet, as served by GET /api/public/characters/:name/sheet.
// This is the already-crawlable subset (the same one behind the public /c/:name
// page), so it deliberately carries NO wallet balance, Discord/GitHub identity,
// or equipped gear: those stay on the proximity-gated entity wire, visible only
// when you are actually standing next to the player.
export interface CharacterProfile {
  name: string;
  cls: string;
  classLabel: string;
  spec: string;
  level: number;
  guild: string | null;
  zone: string;
  skin: number;
  realm: string;
}

export interface IWorldSocialGraph {
  // persistent social: friends, ignore/block, guilds (online play only)
  socialInfo: SocialInfo | null;
  friendAdd(name: string): void;
  friendRemove(name: string): void;
  blockAdd(name: string): void;
  blockRemove(name: string): void;
  // personal chat ignore: chat-only, and unlike a block it may coexist with a friendship
  ignoreAdd(name: string): void;
  ignoreRemove(name: string): void;
  guildCreate(name: string): void;
  guildInvite(name: string): void;
  // Guild pledge board (docs/prd/guild-pledge-board.md): the public
  // aspiration, its withdrawal, the officer decision, and the recruiting
  // settings. Online-only like every guild op; the offline Sim no-ops.
  guildPledge(name: string): void;
  guildPledgeWithdraw(): void;
  guildPledgeDecide(name: string, accept: boolean): void;
  setGuildPledgeSettings(enabled: boolean, minLevel: number, note: string): void;
  guildAccept(): void;
  guildDecline(): void;
  guildLeave(): void;
  guildKick(name: string): void;
  guildPromote(name: string): void;
  guildDemote(name: string): void;
  guildTransfer(name: string): void;
  guildDisband(): void;
  // guild calendar events (officers + the Guild Master manage; everyone views
  // them via socialInfo.guild.events)
  guildEventCreate(day: string, hour: number | null, title: string, note: string): void;
  guildEventRemove(eventId: number): void;
  // guild billboard: set (or clear, with '') the message pinned atop the Guild
  // tab. Officers + the Guild Master only; the server enforces the rank gate.
  guildSetMotd(text: string): void;
  // realm-scoped username typeahead for friend/ignore/guild search
  searchCharacters(query: string): Promise<CharacterSearchResult[]>;
  // public profile for any character on the realm, by name. Lets the player menu
  // show info for someone you have only seen in chat and who is nowhere near
  // your ~120yd interest scope (so there is no entity to read locally).
  // Resolves to null offline, and when the name does not exist.
  characterProfile(name: string): Promise<CharacterProfile | null>;
  // Operator-set account flair (cosmetic): the AI-operated mark and an official
  // streamer's platform links, for the [AI] chat tag and the player menu's stream
  // links. Resolves by NAME (not pid) because chat reaches you from players far
  // outside your interest scope, where no entity exists. Null offline and for an
  // unknown or unflagged name. A pure LOCAL read (the flair rides the entity wire
  // and the chat event), so unlike characterProfile it is synchronous.
  accountFlair(name: string): PlayerFlair | null;
}
