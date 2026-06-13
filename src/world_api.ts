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
  marketInfo: MarketInfo | null;
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
  // World Market
  marketList(itemId: string, count: number, price: number): void;
  marketBuy(listingId: number): void;
  marketCancel(listingId: number): void;
  marketCollect(): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
}
