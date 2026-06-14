import { abilitiesKnownAt } from '../sim/data';
import { computeQuestState } from '../sim/sim';
import type { ResolvedAbility } from '../sim/sim';
import {
  Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, SimEvent,
  emptyMoveInput,
} from '../sim/types';
import type { ArenaInfo, CharacterSearchResult, DuelInfo, MarketInfo, PartyInfo, SocialInfo, TradeInfo } from '../world_api';
import type { OnlineWorldClient } from './world_client';
import type { SpacetimeConnectionConfig } from './backend';

const NOT_IMPLEMENTED =
  'SpacetimeDB backend is selected, but only the Phase 0 client seam is wired. Generate module bindings and implement reducers before entering the world.';

function blankEntity(id: number, cls: PlayerClass): Entity {
  return {
    id, kind: 'player', templateId: cls, name: '', level: 1,
    pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, facing: 0, prevFacing: 0,
    vy: 0, onGround: true, fallStartY: 0,
    hp: 1, maxHp: 1, resource: 0, maxResource: 0, resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0, rangedPower: 0, critChance: 0.05, dodgeChance: 0.05, moveSpeed: 7, hostile: false,
    targetId: null, autoAttack: false, swingTimer: 0,
    inCombat: false, combatTimer: 99,
    auras: [], castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [], savedMana: 0,
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, threat: new Map(),
    forcedTargetId: null, forcedTargetTimer: 0, ownerId: null, petTauntTimer: 0,
    pulseTimer: 0, firedSummons: 0, summonedIds: [], enraged: false,
    spawnPos: { x: 0, y: 0, z: 0 }, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff,
  };
}

export class SpacetimeWorld implements OnlineWorldClient {
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  moveInput: MoveInput = emptyMoveInput();
  inventory: InvSlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  xp = 0;
  known: ResolvedAbility[];
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  partyInfo: PartyInfo | null = null;
  tradeInfo: TradeInfo | null = null;
  duelInfo: DuelInfo | null = null;
  socialInfo: SocialInfo | null = null;
  arenaInfo: ArenaInfo | null = null;
  marketInfo: MarketInfo | null = null;
  realm = '';
  lastSnapAt = 0;
  snapInterval = 50;
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;
  readonly characterId: number;
  readonly uri: string;
  readonly moduleName: string;

  private eventQueue: SimEvent[] = [];
  private invChanged = false;

  constructor(config: SpacetimeConnectionConfig, token: string, characterId: number, cls: PlayerClass) {
    void token;
    this.characterId = characterId;
    this.uri = config.uri;
    this.moduleName = config.moduleName;
    this.cfg = { seed: 20061, playerClass: cls };
    this.known = abilitiesKnownAt(cls, 1);
    queueMicrotask(() => this.onDisconnect?.(NOT_IMPLEMENTED));
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1, this.cfg.playerClass);
  }

  close(): void {
    this.connected = false;
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMouselookFacing(_facing: number | null): void {
    // The reducer-backed adapter will forward this with movement input.
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  questState(questId: string): QuestState {
    return computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
  }

  private unsupported(): never {
    throw new Error(NOT_IMPLEMENTED);
  }

  castAbility(_abilityId: string): void { this.unsupported(); }
  castAbilityBySlot(_slot: number): void { this.unsupported(); }
  targetEntity(_id: number | null): void { this.unsupported(); }
  tabTarget(): void { this.unsupported(); }
  startAutoAttack(): void { this.unsupported(); }
  stopAutoAttack(): void { this.unsupported(); }
  interact(): void { this.unsupported(); }
  lootCorpse(_id: number): void { this.unsupported(); }
  pickUpObject(_id: number): void { this.unsupported(); }
  acceptQuest(_questId: string): void { this.unsupported(); }
  turnInQuest(_questId: string): void { this.unsupported(); }
  abandonQuest(_questId: string): void { this.unsupported(); }
  equipItem(_itemId: string): void { this.unsupported(); }
  useItem(_itemId: string): void { this.unsupported(); }
  buyItem(_npcId: number, _itemId: string): void { this.unsupported(); }
  sellItem(_itemId: string): void { this.unsupported(); }
  releaseSpirit(): void { this.unsupported(); }
  chat(_text: string): void { this.unsupported(); }
  partyInvite(_targetPid: number): void { this.unsupported(); }
  partyAccept(): void { this.unsupported(); }
  partyDecline(): void { this.unsupported(); }
  partyLeave(): void { this.unsupported(); }
  partyKick(_targetPid: number): void { this.unsupported(); }
  tradeRequest(_targetPid: number): void { this.unsupported(); }
  tradeAccept(): void { this.unsupported(); }
  tradeSetOffer(_items: InvSlot[], _copper: number): void { this.unsupported(); }
  tradeConfirm(): void { this.unsupported(); }
  tradeCancel(): void { this.unsupported(); }
  duelRequest(_targetPid: number): void { this.unsupported(); }
  duelAccept(): void { this.unsupported(); }
  duelDecline(): void { this.unsupported(); }
  friendAdd(_name: string): void { this.unsupported(); }
  friendRemove(_name: string): void { this.unsupported(); }
  blockAdd(_name: string): void { this.unsupported(); }
  blockRemove(_name: string): void { this.unsupported(); }
  guildCreate(_name: string): void { this.unsupported(); }
  guildInvite(_name: string): void { this.unsupported(); }
  guildAccept(): void { this.unsupported(); }
  guildDecline(): void { this.unsupported(); }
  guildLeave(): void { this.unsupported(); }
  guildKick(_name: string): void { this.unsupported(); }
  guildPromote(_name: string): void { this.unsupported(); }
  guildDemote(_name: string): void { this.unsupported(); }
  guildTransfer(_name: string): void { this.unsupported(); }
  guildDisband(): void { this.unsupported(); }
  async searchCharacters(_query: string): Promise<CharacterSearchResult[]> { return []; }
  arenaQueueJoin(): void { this.unsupported(); }
  arenaQueueLeave(): void { this.unsupported(); }
  marketList(_itemId: string, _count: number, _price: number): void { this.unsupported(); }
  marketBuy(_listingId: number): void { this.unsupported(); }
  marketCancel(_listingId: number): void { this.unsupported(); }
  marketCollect(): void { this.unsupported(); }
  enterDungeon(_dungeonId: string): void { this.unsupported(); }
  leaveDungeon(): void { this.unsupported(); }
}
