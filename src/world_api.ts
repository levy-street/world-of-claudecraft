import type { Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, ResourceType } from './sim/types';
import type { ResolvedAbility } from './sim/sim';
import type { TalentAllocation, SavedLoadout, Role } from './sim/content/talents';

export interface PartyMemberInfo {
  pid: number;
  name: string;
  cls: PlayerClass;
  level: number;
  hp: number;
  mhp: number;
  res: number;
  mres: number;
  rtype: ResourceType | null;
  x: number;
  z: number;
  dead: number;
  inCombat: number;
}

export interface PartyInfo {
  leader: number;
  members: PartyMemberInfo[];
}

export interface TradeOffer {
  items: InvSlot[];
  copper: number;
}

export interface TradeInfo {
  otherPid: number;
  otherName: string;
  myOffer: TradeOffer;
  theirOffer: TradeOffer;
  myAccepted: boolean;
  theirAccepted: boolean;
}

export interface DuelInfo {
  otherPid: number;
  otherName: string;
  state: 'countdown' | 'active';
}

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

// One ranked row of the lifetime-XP leaderboard (Max-Level XP Overflow). Always
// computed server-side; the client only displays it.
export interface LeaderboardEntry {
  rank: number;
  name: string;
  cls: PlayerClass;
  level: number;
  virtualLevel: number;
  lifetimeXp: number;
  prestigeRank: number;
  realm?: string; // present on the global (cross-realm) home-page board
}

export interface ArenaLadderEntry {
  pid: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
}

export interface ArenaInfo {
  rating: number;
  wins: number;
  losses: number;
  queued: boolean;
  queueSize: number;
  // present only while in a match
  match: {
    state: 'countdown' | 'active' | 'over';
    oppName: string;
    oppClass: PlayerClass;
    oppLevel: number;
    oppPid: number;
    returnIn?: number; // whole seconds left in the post-bout aftermath ('over')
  } | null;
  // live standings of rated players currently online, best first
  ladder: ArenaLadderEntry[];
}

// ---------------------------------------------------------------------------
// The World Market (the Merchant's auction house). Listings are global and
// shared by every player; collections are the per-player gold + items waiting
// to be picked up (sale proceeds, expired/returned listings).
// ---------------------------------------------------------------------------

export interface MarketListingView {
  id: number;
  sellerName: string;
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack
  mine: boolean; // the viewer is the seller (offer them Cancel, not Buy)
  house: boolean; // the Merchant's own standing stock
}

export interface MarketInfo {
  listings: MarketListingView[];
  collectionCopper: number; // proceeds waiting to be collected
  collectionItems: InvSlot[]; // returned/expired items waiting to be collected
  cutPct: number; // the Merchant's cut on a sale, as a percentage
  maxListings: number; // per-seller active-listing cap
  myListingCount: number; // how many active listings the viewer already has
}

// The surface the renderer + HUD need from a game world. The offline `Sim`
// satisfies this structurally; the online `ClientWorld` implements it by
// mirroring server snapshots and sending commands over the socket.
export interface IWorld {
  cfg: { seed: number; playerClass: PlayerClass };
  entities: Map<number, Entity>;
  playerId: number;
  player: Entity;
  moveInput: MoveInput;
  inventory: InvSlot[];
  vendorBuyback: InvSlot[];
  equipment: Partial<Record<EquipSlot, string>>;
  copper: number;
  xp: number;
  // Post-cap progression (Max-Level XP Overflow). All server-authoritative;
  // the client renders these as-is and derives virtual level from lifetimeXp.
  lifetimeXp: number;
  prestigeRank: number;
  unlockedMilestones: string[];
  known: ResolvedAbility[];
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  questState(questId: string): QuestState;
  castAbility(abilityId: string): void;
  castAbilityBySlot(slot: number): void;
  targetEntity(id: number | null): void;
  tabTarget(): void;
  startAutoAttack(): void;
  stopAutoAttack(): void;
  interact(): void;
  lootCorpse(id: number): void;
  pickUpObject(id: number): void;
  acceptQuest(questId: string): void;
  turnInQuest(questId: string): void;
  abandonQuest(questId: string): void;
  equipItem(itemId: string): void;
  useItem(itemId: string): void;
  discardItem(itemId: string, count?: number): void;
  buyItem(npcId: number, itemId: string): void;
  sellItem(itemId: string, count?: number): void;
  buyBackItem(itemId: string): void;
  releaseSpirit(): void;
  chat(text: string): void;
  // social systems
  partyInfo: PartyInfo | null;
  tradeInfo: TradeInfo | null;
  duelInfo: DuelInfo | null;
  arenaInfo: ArenaInfo | null;
  marketInfo: MarketInfo | null;
  partyInvite(targetPid: number): void;
  partyAccept(): void;
  partyDecline(): void;
  partyLeave(): void;
  partyKick(targetPid: number): void;
  // raid/target markers (party-scoped): markerId 0..7, null = no mark
  markerFor(entityId: number): number | null;
  setMarker(entityId: number, markerId: number): void;
  clearMarker(entityId: number): void;
  tradeRequest(targetPid: number): void;
  tradeAccept(): void;
  tradeSetOffer(items: InvSlot[], copper: number): void;
  tradeConfirm(): void;
  tradeCancel(): void;
  duelRequest(targetPid: number): void;
  duelAccept(): void;
  duelDecline(): void;
  // the realm (world/shard) this character lives on; '' in offline play
  realm: string;
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
  arenaQueueJoin(): void;
  arenaQueueLeave(): void;
  // World Market
  marketList(itemId: string, count: number, price: number): void;
  marketBuy(listingId: number): void;
  marketCancel(listingId: number): void;
  marketCollect(): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
  // Post-cap progression: the realm-scoped lifetime-XP leaderboard, and the
  // opt-in cosmetic prestige action (Phase 4).
  leaderboard(): Promise<LeaderboardEntry[]>;
  prestige(): void;
  // Talents & Specializations. State is server-authoritative; the client stages
  // edits locally and commits via applyTalents (the server re-validates).
  talents: TalentAllocation;
  talentSpec: string | null;
  talentRole: Role | null;
  loadouts: SavedLoadout[];
  activeLoadout: number;
  talentPoints(): { total: number; spent: number };
  applyTalents(alloc: TalentAllocation): void;
  respec(): void;
  setSpec(specId: string | null): void;
  saveLoadout(name: string, bar: (string | null)[], alloc?: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
}
