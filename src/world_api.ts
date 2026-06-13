import type { Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, ResourceType } from './sim/types';
import type { ResolvedAbility } from './sim/sim';

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

// ---- Ravenrift 5v5 capture-the-flag ----
export interface SquadLadderEntry {
  pid: number;
  name: string;
  cls: PlayerClass;
  rating: number;
  wins: number;
  losses: number;
}

export interface BgFlagInfo {
  state: 'home' | 'carried' | 'dropped';
  carrierName: string | null;
  carrierTeam: number | null; // which team is carrying it
}

export interface BgPlayerInfo {
  pid: number;
  name: string;
  cls: PlayerClass;
  team: number; // 0 = Crimson, 1 = Azure
  carrying: boolean; // holding the enemy flag
  dead: boolean;
  hp: number;
  mhp: number;
}

export interface BgMatchInfo {
  state: 'countdown' | 'active';
  myTeam: number;
  capsToWin: number;
  scores: [number, number]; // [Crimson, Azure]
  flags: [BgFlagInfo, BgFlagInfo]; // index = flag's home team
  players: BgPlayerInfo[];
  respawnIn: number; // seconds until you respawn, 0 if alive
}

export interface BgInfo {
  rating: number;
  wins: number;
  losses: number;
  queued: boolean;
  queueSize: number; // players waiting (across all groups)
  queuedParty: number; // size of the party you queued with (1 = solo)
  match: BgMatchInfo | null;
  ladder: SquadLadderEntry[];
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
  equipment: Partial<Record<EquipSlot, string>>;
  copper: number;
  xp: number;
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
  buyItem(npcId: number, itemId: string): void;
  sellItem(itemId: string): void;
  releaseSpirit(): void;
  chat(text: string): void;
  // social systems
  partyInfo: PartyInfo | null;
  tradeInfo: TradeInfo | null;
  duelInfo: DuelInfo | null;
  bgInfo: BgInfo | null;
  partyInvite(targetPid: number): void;
  partyAccept(): void;
  partyDecline(): void;
  partyLeave(): void;
  partyKick(targetPid: number): void;
  tradeRequest(targetPid: number): void;
  tradeAccept(): void;
  tradeSetOffer(items: InvSlot[], copper: number): void;
  tradeConfirm(): void;
  tradeCancel(): void;
  duelRequest(targetPid: number): void;
  duelAccept(): void;
  duelDecline(): void;
  bgQueueJoin(): void;
  bgQueueLeave(): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
}
