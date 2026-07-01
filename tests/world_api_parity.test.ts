// W0c: the IWorld structural-parity gate.
//
// `IWorld` (src/world_api.ts:341-510, 148 members) is the ONE seam render/ui depend
// on. `tsc` already proves both the offline `Sim` and the online `ClientWorld` satisfy
// it structurally, but the interface is erased at build: there is NO runtime member
// list, so nothing catches a present-but-throws stub or a kind flip (method vs read).
// This file adds that runtime layer.
//
// IWORLD_MEMBERS below is the hand-maintained member list, the W0c analog of the
// append-only CALLBACK_KEYS in tests/sim_context.test.ts. It is APPEND-ONLY WITH THE
// INTERFACE: whenever a future slice adds (or removes/renames) a member on `IWorld`,
// it lands the matching edit here in the SAME commit. The count pins (148 / 36 / 112)
// plus the sorted-name `toEqual` snapshots (modeled on the anti-loosening exclude-set
// pin in tests/parity/harness.test.ts:131-162) are what force that: a dropped or
// renamed member reddens deliberately, never silently.
//
// Each entry carries a single structural kind, transcribed verbatim from the interface
// body (world_api.ts:342-509):
//   - 'method': every call-signature declaration `name(args): T`. Probe: a function-
//     VALUED own-or-inherited property descriptor on BOTH Sim.prototype AND
//     ClientWorld.prototype (a getter descriptor for one of these names is a FAIL: that
//     is a kind mismatch). These are NOT invoked (command methods mutate / throw on a
//     bare instance), so a body that throws WHEN CALLED is out of this gate's reach by
//     design (see the QA-handoff note below).
//   - 'data': every property declaration `name: T` (no call signature). Probe: the name
//     is present and READING it does not throw, on a constructed `Sim` AND a constructed
//     `ClientWorld`. The backing is impl-specific and is deliberately NOT pinned: almost
//     every read is a GETTER on `Sim` but a DATA FIELD on `ClientWorld` (`playerId`,
//     `inventory`, `copper`, ...; `player` is the lone getter on both). Asserting
//     "getter on the prototype" would falsely redden every one of those, so the data
//     probe checks contract shape (present + readable), never getter-vs-field backing.

import { beforeAll, describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
// The 20 facet interfaces the W1 split produced (src/world_api/<facet>.ts). Imported
// type-only to pin each facet's runtime member array to its interface key-set below.
import type { IWorldChat } from '../src/world_api/chat';
import type { IWorldCombat } from '../src/world_api/combat';
import type { IWorldCosmetics } from '../src/world_api/cosmetics';
import type { IWorldDelves } from '../src/world_api/delves';
import type { IWorldDuelArena } from '../src/world_api/duel_arena';
import type { IWorldDungeons } from '../src/world_api/dungeons';
import type { IWorldEntityRoster } from '../src/world_api/entity_roster';
import type { IWorldInteraction } from '../src/world_api/interaction';
import type { IWorldInventory } from '../src/world_api/inventory';
import type { IWorldLoot } from '../src/world_api/loot';
import type { IWorldMarket } from '../src/world_api/market';
import type { IWorldParty } from '../src/world_api/party';
import type { IWorldPet } from '../src/world_api/pet';
import type { IWorldProgressionXp } from '../src/world_api/progression_xp';
import type { IWorldQuests } from '../src/world_api/quests';
import type { IWorldSocialGraph } from '../src/world_api/social_graph';
import type { IWorldTalents } from '../src/world_api/talents';
import type { IWorldTargeting } from '../src/world_api/targeting';
import type { IWorldTelemetry } from '../src/world_api/telemetry';
import type { IWorldTrade } from '../src/world_api/trade';

type IWorldMemberKind = 'method' | 'data';

interface IWorldMember {
  readonly name: string;
  readonly kind: IWorldMemberKind;
}

// The 148 members of `interface IWorld`, in interface order (world_api.ts:342-509).
// Partition: 36 `data` + 112 `method` (read-returning + command-void + 3 async).
// biome-ignore lint/suspicious/noExportsInTest: IWORLD_MEMBERS is the W0c pinned structural-parity contract (the authoritative IWorld member list)
export const IWORLD_MEMBERS = [
  // --- core world / player roster + economy reads (data) ---
  { name: 'cfg', kind: 'data' },
  { name: 'entities', kind: 'data' },
  { name: 'playerId', kind: 'data' },
  { name: 'player', kind: 'data' },
  { name: 'moveInput', kind: 'data' },
  { name: 'inventory', kind: 'data' },
  { name: 'vendorBuyback', kind: 'data' },
  { name: 'equipment', kind: 'data' },
  { name: 'accountCosmetics', kind: 'data' },
  { name: 'copper', kind: 'data' },
  { name: 'xp', kind: 'data' },
  { name: 'lifetimeXp', kind: 'data' },
  { name: 'prestigeRank', kind: 'data' },
  { name: 'unlockedMilestones', kind: 'data' },
  { name: 'restedXp', kind: 'data' },
  { name: 'known', kind: 'data' },
  { name: 'questLog', kind: 'data' },
  { name: 'questsDone', kind: 'data' },
  // --- commands + read-returning methods ---
  { name: 'questState', kind: 'method' }, // read-returning (1/6)
  { name: 'castAbility', kind: 'method' },
  { name: 'castAbilityBySlot', kind: 'method' },
  { name: 'cancelAura', kind: 'method' },
  { name: 'targetEntity', kind: 'method' },
  { name: 'tabTarget', kind: 'method' },
  { name: 'targetNearestFriendly', kind: 'method' },
  { name: 'friendlyTabTarget', kind: 'method' },
  { name: 'startAutoAttack', kind: 'method' },
  { name: 'stopAutoAttack', kind: 'method' },
  { name: 'interact', kind: 'method' },
  { name: 'lootCorpse', kind: 'method' },
  { name: 'submitLootRoll', kind: 'method' },
  { name: 'activeLootRolls', kind: 'method' }, // read-returning (2/6)
  { name: 'pickUpObject', kind: 'method' },
  { name: 'acceptQuest', kind: 'method' },
  { name: 'turnInQuest', kind: 'method' },
  { name: 'reportTelemetry', kind: 'method' },
  { name: 'abandonQuest', kind: 'method' },
  { name: 'acceptLinkedQuest', kind: 'method' },
  { name: 'equipItem', kind: 'method' },
  { name: 'unequipItem', kind: 'method' },
  { name: 'useItem', kind: 'method' },
  { name: 'discardItem', kind: 'method' },
  { name: 'buyItem', kind: 'method' },
  { name: 'sellItem', kind: 'method' },
  { name: 'sellAllJunk', kind: 'method' },
  { name: 'buyBackItem', kind: 'method' },
  { name: 'changeSkin', kind: 'method' },
  { name: 'claimEventSkin', kind: 'method' },
  { name: 'unequipMechChroma', kind: 'method' },
  { name: 'releaseSpirit', kind: 'method' },
  { name: 'chat', kind: 'method' },
  { name: 'playEmote', kind: 'method' },
  { name: 'abandonPet', kind: 'method' },
  { name: 'renamePet', kind: 'method' },
  { name: 'revivePet', kind: 'method' },
  { name: 'petAttack', kind: 'method' },
  { name: 'petTaunt', kind: 'method' },
  { name: 'setPetAutoTaunt', kind: 'method' },
  { name: 'feedPet', kind: 'method' },
  { name: 'healPet', kind: 'method' },
  { name: 'setPetMode', kind: 'method' },
  // --- social systems (data reads) ---
  { name: 'partyInfo', kind: 'data' },
  { name: 'tradeInfo', kind: 'data' },
  { name: 'duelInfo', kind: 'data' },
  { name: 'arenaInfo', kind: 'data' },
  { name: 'marketInfo', kind: 'data' },
  // --- party / raid commands + marker read ---
  { name: 'partyInvite', kind: 'method' },
  { name: 'partyAccept', kind: 'method' },
  { name: 'partyDecline', kind: 'method' },
  { name: 'partyLeave', kind: 'method' },
  { name: 'partyKick', kind: 'method' },
  { name: 'partyPromote', kind: 'method' },
  { name: 'convertPartyToRaid', kind: 'method' },
  { name: 'convertRaidToParty', kind: 'method' },
  { name: 'moveRaidMember', kind: 'method' },
  { name: 'setPartyLootMaster', kind: 'method' },
  { name: 'assignMasterLoot', kind: 'method' },
  { name: 'markerFor', kind: 'method' }, // read-returning (3/6)
  { name: 'setMarker', kind: 'method' },
  { name: 'clearMarker', kind: 'method' },
  { name: 'tradeRequest', kind: 'method' },
  { name: 'tradeAccept', kind: 'method' },
  { name: 'tradeSetOffer', kind: 'method' },
  { name: 'tradeConfirm', kind: 'method' },
  { name: 'tradeCancel', kind: 'method' },
  { name: 'duelRequest', kind: 'method' },
  { name: 'duelAccept', kind: 'method' },
  { name: 'duelDecline', kind: 'method' },
  { name: 'realm', kind: 'data' },
  { name: 'socialInfo', kind: 'data' },
  // --- social graph commands + async search ---
  { name: 'friendAdd', kind: 'method' },
  { name: 'friendRemove', kind: 'method' },
  { name: 'blockAdd', kind: 'method' },
  { name: 'blockRemove', kind: 'method' },
  { name: 'guildCreate', kind: 'method' },
  { name: 'guildInvite', kind: 'method' },
  { name: 'guildAccept', kind: 'method' },
  { name: 'guildDecline', kind: 'method' },
  { name: 'guildLeave', kind: 'method' },
  { name: 'guildKick', kind: 'method' },
  { name: 'guildPromote', kind: 'method' },
  { name: 'guildDemote', kind: 'method' },
  { name: 'guildTransfer', kind: 'method' },
  { name: 'guildDisband', kind: 'method' },
  { name: 'searchCharacters', kind: 'method' }, // async (1/2)
  { name: 'arenaQueueJoin', kind: 'method' },
  { name: 'arenaQueueLeave', kind: 'method' },
  { name: 'arenaAugmentPick', kind: 'method' },
  // --- market commands ---
  { name: 'marketSearch', kind: 'method' },
  { name: 'marketList', kind: 'method' },
  { name: 'marketBuy', kind: 'method' },
  { name: 'marketCancel', kind: 'method' },
  { name: 'marketCollect', kind: 'method' },
  // --- dungeons + delves commands and reads ---
  { name: 'enterDungeon', kind: 'method' },
  { name: 'leaveDungeon', kind: 'method' },
  { name: 'enterDelve', kind: 'method' },
  { name: 'leaveDelve', kind: 'method' },
  { name: 'delveInteract', kind: 'method' },
  { name: 'companionUpgrade', kind: 'method' },
  { name: 'delveBuyShopItem', kind: 'method' },
  { name: 'delveShopOffers', kind: 'method' }, // read-returning (4/6)
  { name: 'lockpickState', kind: 'data' },
  { name: 'lockpickEngage', kind: 'method' },
  { name: 'lockpickAction', kind: 'method' },
  { name: 'lockpickAbort', kind: 'method' },
  { name: 'collectDelveChestLoot', kind: 'method' },
  { name: 'delveRun', kind: 'data' },
  { name: 'companionState', kind: 'data' },
  { name: 'delveMarks', kind: 'data' },
  { name: 'companionUpgrades', kind: 'data' },
  { name: 'delveDaily', kind: 'data' },
  { name: 'raidLockouts', kind: 'method' }, // read-returning (5/6)
  { name: 'leaderboard', kind: 'method' }, // async
  { name: 'guildLeaderboard', kind: 'method' }, // async
  { name: 'devLeaderboard', kind: 'method' }, // async
  { name: 'prestige', kind: 'method' },
  // --- talents & specializations (reads + commands) ---
  { name: 'talents', kind: 'data' },
  { name: 'talentSpec', kind: 'data' },
  { name: 'talentRole', kind: 'data' },
  { name: 'loadouts', kind: 'data' },
  { name: 'activeLoadout', kind: 'data' },
  { name: 'talentPoints', kind: 'method' }, // read-returning (6/6)
  { name: 'applyTalents', kind: 'method' },
  { name: 'respec', kind: 'method' },
  { name: 'setSpec', kind: 'method' },
  { name: 'saveLoadout', kind: 'method' },
  { name: 'switchLoadout', kind: 'method' },
  { name: 'deleteLoadout', kind: 'method' },
] as const satisfies readonly IWorldMember[];

const DATA_MEMBERS = IWORLD_MEMBERS.filter((m) => m.kind === 'data');
const METHOD_MEMBERS = IWORLD_MEMBERS.filter((m) => m.kind === 'method');

// --- the two worlds under test: real prototypes + constructed instances ---

const SIM_SEED = 1;
const PROBE_CLASS: PlayerClass = 'warrior';

// A DOM-less, network-free WebSocket stand-in for the ClientWorld ctor
// (online.ts:800-823 opens a real `new WebSocket(...)`). No-op send/close; settable
// on*-handlers, exactly what the ctor assigns.
class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {
    /* no-op: the gate never sends */
  }
  close(): void {
    /* no-op: there is no real socket */
  }
}

// Run `fn` with `globalThis.WebSocket`/`globalThis.window` stubbed, then restore them.
// Keeps the construction deterministic and free of real DOM/network/timers.
function withDomStubs<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prevWebSocket = g.WebSocket;
  const prevWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    return fn();
  } finally {
    g.WebSocket = prevWebSocket;
    g.window = prevWindow;
  }
}

// A real ClientWorld whose FIELD INITIALIZERS have run (a raw
// `Object.create(ClientWorld.prototype)` bareClient would be missing all 36 data
// props). Pass a non-empty `base` so the ctor builds a `ws://localhost/ws` URL instead
// of touching `location`; `.close()` clears the stubbed input timer.
function makeClientWorld(): ClientWorld {
  return withDomStubs(() => {
    const world = new ClientWorld('parity-probe-token', 1, PROBE_CLASS, 'http://localhost');
    world.close();
    return world;
  });
}

// Resolve an own-or-inherited property descriptor (stop before Object.prototype so we
// never match `toString`/`valueOf` and friends).
function resolveDescriptor(proto: object, name: string): PropertyDescriptor | undefined {
  let cur: object | null = proto;
  while (cur && cur !== Object.prototype) {
    const d = Object.getOwnPropertyDescriptor(cur, name);
    if (d) return d;
    cur = Object.getPrototypeOf(cur) as object | null;
  }
  return undefined;
}

function assertMethodMember(proto: object, name: string, label: string): void {
  const d = resolveDescriptor(proto, name);
  expect(d, `${label}.${name} is missing (IWorld method not implemented)`).toBeDefined();
  // A getter descriptor for a call-signature member is a kind mismatch, not a method.
  expect(
    d?.get,
    `${label}.${name} is a getter; expected a call-signature method (kind mismatch)`,
  ).toBeUndefined();
  expect(typeof d?.value, `${label}.${name} is not function-valued (kind mismatch)`).toBe(
    'function',
  );
}

function assertDataMember(instance: object, name: string, label: string): void {
  const bag = instance as Record<string, unknown>;
  expect(name in bag, `${label}.${name} is missing (IWorld data member not present)`).toBe(true);
  // Reading must not throw: a present-but-throws read (e.g. a stubbed getter) is a drift.
  // For `Sim` this exercises the getter body; for `ClientWorld` it reads the field.
  expect(() => {
    void bag[name];
  }, `${label}.${name} threw on read (present-but-throws drift)`).not.toThrow();
}

let sim: Sim;
let client: ClientWorld;

beforeAll(() => {
  sim = new Sim({ seed: SIM_SEED, playerClass: PROBE_CLASS });
  client = makeClientWorld();
});

describe('IWORLD_MEMBERS is the pinned IWorld contract (anti-loosening)', () => {
  it('pins total / data / method counts', () => {
    expect(IWORLD_MEMBERS.length).toBe(148);
    expect(DATA_MEMBERS.length).toBe(36);
    expect(METHOD_MEMBERS.length).toBe(112);
  });

  it('has no duplicate member names', () => {
    const names = IWORLD_MEMBERS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // Sorted-name `toEqual` snapshots: a dropped, renamed, or kind-flipped member reddens
  // these deliberately, forcing a reviewed edit. NOT length-only.
  it('the full sorted member set is exactly the pinned 148', () => {
    expect(IWORLD_MEMBERS.map((m) => m.name).sort()).toEqual([
      'abandonPet',
      'abandonQuest',
      'acceptLinkedQuest',
      'acceptQuest',
      'accountCosmetics',
      'activeLoadout',
      'activeLootRolls',
      'applyTalents',
      'arenaAugmentPick',
      'arenaInfo',
      'arenaQueueJoin',
      'arenaQueueLeave',
      'assignMasterLoot',
      'blockAdd',
      'blockRemove',
      'buyBackItem',
      'buyItem',
      'cancelAura',
      'castAbility',
      'castAbilityBySlot',
      'cfg',
      'changeSkin',
      'chat',
      'claimEventSkin',
      'clearMarker',
      'collectDelveChestLoot',
      'companionState',
      'companionUpgrade',
      'companionUpgrades',
      'convertPartyToRaid',
      'convertRaidToParty',
      'copper',
      'deleteLoadout',
      'delveBuyShopItem',
      'delveDaily',
      'delveInteract',
      'delveMarks',
      'delveRun',
      'delveShopOffers',
      'devLeaderboard',
      'discardItem',
      'duelAccept',
      'duelDecline',
      'duelInfo',
      'duelRequest',
      'enterDelve',
      'enterDungeon',
      'entities',
      'equipItem',
      'equipment',
      'feedPet',
      'friendAdd',
      'friendRemove',
      'friendlyTabTarget',
      'guildAccept',
      'guildCreate',
      'guildDecline',
      'guildDemote',
      'guildDisband',
      'guildInvite',
      'guildKick',
      'guildLeaderboard',
      'guildLeave',
      'guildPromote',
      'guildTransfer',
      'healPet',
      'interact',
      'inventory',
      'known',
      'leaderboard',
      'leaveDelve',
      'leaveDungeon',
      'lifetimeXp',
      'loadouts',
      'lockpickAbort',
      'lockpickAction',
      'lockpickEngage',
      'lockpickState',
      'lootCorpse',
      'markerFor',
      'marketBuy',
      'marketCancel',
      'marketCollect',
      'marketInfo',
      'marketList',
      'marketSearch',
      'moveInput',
      'moveRaidMember',
      'partyAccept',
      'partyDecline',
      'partyInfo',
      'partyInvite',
      'partyKick',
      'partyLeave',
      'partyPromote',
      'petAttack',
      'petTaunt',
      'pickUpObject',
      'playEmote',
      'player',
      'playerId',
      'prestige',
      'prestigeRank',
      'questLog',
      'questState',
      'questsDone',
      'raidLockouts',
      'realm',
      'releaseSpirit',
      'renamePet',
      'reportTelemetry',
      'respec',
      'restedXp',
      'revivePet',
      'saveLoadout',
      'searchCharacters',
      'sellAllJunk',
      'sellItem',
      'setMarker',
      'setPartyLootMaster',
      'setPetAutoTaunt',
      'setPetMode',
      'setSpec',
      'socialInfo',
      'startAutoAttack',
      'stopAutoAttack',
      'submitLootRoll',
      'switchLoadout',
      'tabTarget',
      'talentPoints',
      'talentRole',
      'talentSpec',
      'talents',
      'targetEntity',
      'targetNearestFriendly',
      'tradeAccept',
      'tradeCancel',
      'tradeConfirm',
      'tradeInfo',
      'tradeRequest',
      'tradeSetOffer',
      'turnInQuest',
      'unequipItem',
      'unequipMechChroma',
      'unlockedMilestones',
      'useItem',
      'vendorBuyback',
      'xp',
    ]);
  });

  it('the sorted data-kind set is exactly the pinned 36', () => {
    expect(DATA_MEMBERS.map((m) => m.name).sort()).toEqual([
      'accountCosmetics',
      'activeLoadout',
      'arenaInfo',
      'cfg',
      'companionState',
      'companionUpgrades',
      'copper',
      'delveDaily',
      'delveMarks',
      'delveRun',
      'duelInfo',
      'entities',
      'equipment',
      'inventory',
      'known',
      'lifetimeXp',
      'loadouts',
      'lockpickState',
      'marketInfo',
      'moveInput',
      'partyInfo',
      'player',
      'playerId',
      'prestigeRank',
      'questLog',
      'questsDone',
      'realm',
      'restedXp',
      'socialInfo',
      'talentRole',
      'talentSpec',
      'talents',
      'tradeInfo',
      'unlockedMilestones',
      'vendorBuyback',
      'xp',
    ]);
  });

  it('the sorted method-kind set is exactly the pinned 107', () => {
    expect(METHOD_MEMBERS.map((m) => m.name).sort()).toEqual([
      'abandonPet',
      'abandonQuest',
      'acceptLinkedQuest',
      'acceptQuest',
      'activeLootRolls',
      'applyTalents',
      'arenaAugmentPick',
      'arenaQueueJoin',
      'arenaQueueLeave',
      'assignMasterLoot',
      'blockAdd',
      'blockRemove',
      'buyBackItem',
      'buyItem',
      'cancelAura',
      'castAbility',
      'castAbilityBySlot',
      'changeSkin',
      'chat',
      'claimEventSkin',
      'clearMarker',
      'collectDelveChestLoot',
      'companionUpgrade',
      'convertPartyToRaid',
      'convertRaidToParty',
      'deleteLoadout',
      'delveBuyShopItem',
      'delveInteract',
      'delveShopOffers',
      'devLeaderboard',
      'discardItem',
      'duelAccept',
      'duelDecline',
      'duelRequest',
      'enterDelve',
      'enterDungeon',
      'equipItem',
      'feedPet',
      'friendAdd',
      'friendRemove',
      'friendlyTabTarget',
      'guildAccept',
      'guildCreate',
      'guildDecline',
      'guildDemote',
      'guildDisband',
      'guildInvite',
      'guildKick',
      'guildLeaderboard',
      'guildLeave',
      'guildPromote',
      'guildTransfer',
      'healPet',
      'interact',
      'leaderboard',
      'leaveDelve',
      'leaveDungeon',
      'lockpickAbort',
      'lockpickAction',
      'lockpickEngage',
      'lootCorpse',
      'markerFor',
      'marketBuy',
      'marketCancel',
      'marketCollect',
      'marketList',
      'marketSearch',
      'moveRaidMember',
      'partyAccept',
      'partyDecline',
      'partyInvite',
      'partyKick',
      'partyLeave',
      'partyPromote',
      'petAttack',
      'petTaunt',
      'pickUpObject',
      'playEmote',
      'prestige',
      'questState',
      'raidLockouts',
      'releaseSpirit',
      'renamePet',
      'reportTelemetry',
      'respec',
      'revivePet',
      'saveLoadout',
      'searchCharacters',
      'sellAllJunk',
      'sellItem',
      'setMarker',
      'setPartyLootMaster',
      'setPetAutoTaunt',
      'setPetMode',
      'setSpec',
      'startAutoAttack',
      'stopAutoAttack',
      'submitLootRoll',
      'switchLoadout',
      'tabTarget',
      'talentPoints',
      'targetEntity',
      'targetNearestFriendly',
      'tradeAccept',
      'tradeCancel',
      'tradeConfirm',
      'tradeRequest',
      'tradeSetOffer',
      'turnInQuest',
      'unequipItem',
      'unequipMechChroma',
      'useItem',
    ]);
  });
});

describe('method members are callable functions on both world prototypes', () => {
  for (const m of METHOD_MEMBERS) {
    it(`${m.name} is function-valued on Sim.prototype and ClientWorld.prototype`, () => {
      assertMethodMember(Sim.prototype, m.name, 'Sim.prototype');
      assertMethodMember(ClientWorld.prototype, m.name, 'ClientWorld.prototype');
    });
  }
});

describe('data members are present and readable (no throw) on both constructed worlds', () => {
  for (const m of DATA_MEMBERS) {
    it(`${m.name} reads without throwing on a constructed Sim and ClientWorld`, () => {
      assertDataMember(sim, m.name, 'Sim');
      assertDataMember(client, m.name, 'ClientWorld');
    });
  }
});

describe('membership, not equality: world extras do not fail the gate', () => {
  it('Sim may exceed IWorld (e.g. targetNearestEnemy) without reddening the gate', () => {
    // `targetNearestEnemy` is a real Sim method that is NOT an IWorld member. The gate
    // asserts each IWORLD_MEMBERS name is satisfied, never that the impls carry no
    // extra members, so this (and ClientWorld net-only extras like `drainEvents`,
    // `close`) is allowed.
    const simProto = Sim.prototype as unknown as Record<string, unknown>;
    expect(typeof simProto.targetNearestEnemy).toBe('function');
    const iworldNames = new Set<string>(IWORLD_MEMBERS.map((m) => m.name));
    expect(iworldNames.has('targetNearestEnemy')).toBe(false);
  });
});

// --- W1: aggregate == disjoint union of the 20 facet member sets --------------------
// After the facet split (W1), `interface IWorld extends` 20 domain facet interfaces
// (src/world_api/<facet>.ts; the 19 owner-backed facets plus IWorldTelemetry). This
// block proves the split dropped nothing and duplicated nothing:
//   (1) each facet's runtime name array is pinned to its interface key-set via
//       `satisfies readonly (keyof IWorldX)[]` (rejects a FOREIGN name at compile time);
//   (2) a type-level AssertNever<Exclude<keyof IWorldX, array[number]>> per facet rejects
//       a MISSING name (if the array omits a key, Exclude<> is a non-never union and tsc
//       fails) -- (1)+(2) together make each array EXACTLY its facet key-set;
//   (3) the 20 arrays are pairwise DISJOINT (a member filed in two facets reddens);
//   (4) their union, sorted, equals the pinned 148-name IWORLD_MEMBERS set (a member
//       dropped from the split reddens).
// This is the rigorous form, NOT the tautological `keyof IWorld === keyof (A & B & ...)`
// (IWorld extends them, so that self-equality proves nothing): it asserts against the
// PINNED list, the same anti-loosening baseline the rest of this file uses.

// Compile-time assertion that T is exactly `never`. Used once per facet: if the facet
// interface carries a key absent from its runtime array, `Exclude<...>` is a non-never
// union and the reference fails tsc with "does not satisfy the constraint 'never'".
type AssertNever<T extends never> = T;

const FACET_ENTITY_ROSTER = [
  'cfg',
  'entities',
  'playerId',
  'player',
  'moveInput',
  'realm',
] as const satisfies readonly (keyof IWorldEntityRoster)[];
type _ExhaustEntityRoster = AssertNever<
  Exclude<keyof IWorldEntityRoster, (typeof FACET_ENTITY_ROSTER)[number]>
>;

const FACET_COMBAT = [
  'known',
  'castAbility',
  'castAbilityBySlot',
  'cancelAura',
  'startAutoAttack',
  'stopAutoAttack',
  'releaseSpirit',
] as const satisfies readonly (keyof IWorldCombat)[];
type _ExhaustCombat = AssertNever<Exclude<keyof IWorldCombat, (typeof FACET_COMBAT)[number]>>;

const FACET_TARGETING = [
  'targetEntity',
  'tabTarget',
  'targetNearestFriendly',
  'friendlyTabTarget',
] as const satisfies readonly (keyof IWorldTargeting)[];
type _ExhaustTargeting = AssertNever<
  Exclude<keyof IWorldTargeting, (typeof FACET_TARGETING)[number]>
>;

const FACET_INTERACTION = [
  'interact',
  'lootCorpse',
  'pickUpObject',
] as const satisfies readonly (keyof IWorldInteraction)[];
type _ExhaustInteraction = AssertNever<
  Exclude<keyof IWorldInteraction, (typeof FACET_INTERACTION)[number]>
>;

const FACET_LOOT = [
  'submitLootRoll',
  'activeLootRolls',
] as const satisfies readonly (keyof IWorldLoot)[];
type _ExhaustLoot = AssertNever<Exclude<keyof IWorldLoot, (typeof FACET_LOOT)[number]>>;

const FACET_INVENTORY = [
  'inventory',
  'vendorBuyback',
  'equipment',
  'copper',
  'equipItem',
  'unequipItem',
  'useItem',
  'discardItem',
  'buyItem',
  'sellItem',
  'sellAllJunk',
  'buyBackItem',
] as const satisfies readonly (keyof IWorldInventory)[];
type _ExhaustInventory = AssertNever<
  Exclude<keyof IWorldInventory, (typeof FACET_INVENTORY)[number]>
>;

const FACET_COSMETICS = [
  'accountCosmetics',
  'changeSkin',
  'claimEventSkin',
  'unequipMechChroma',
] as const satisfies readonly (keyof IWorldCosmetics)[];
type _ExhaustCosmetics = AssertNever<
  Exclude<keyof IWorldCosmetics, (typeof FACET_COSMETICS)[number]>
>;

const FACET_QUESTS = [
  'questLog',
  'questsDone',
  'questState',
  'acceptQuest',
  'turnInQuest',
  'abandonQuest',
  'acceptLinkedQuest',
] as const satisfies readonly (keyof IWorldQuests)[];
type _ExhaustQuests = AssertNever<Exclude<keyof IWorldQuests, (typeof FACET_QUESTS)[number]>>;

const FACET_PROGRESSION_XP = [
  'xp',
  'lifetimeXp',
  'prestigeRank',
  'unlockedMilestones',
  'restedXp',
  'leaderboard',
  'guildLeaderboard',
  'devLeaderboard',
  'prestige',
] as const satisfies readonly (keyof IWorldProgressionXp)[];
type _ExhaustProgressionXp = AssertNever<
  Exclude<keyof IWorldProgressionXp, (typeof FACET_PROGRESSION_XP)[number]>
>;

const FACET_TALENTS = [
  'talents',
  'talentSpec',
  'talentRole',
  'loadouts',
  'activeLoadout',
  'talentPoints',
  'applyTalents',
  'respec',
  'setSpec',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
] as const satisfies readonly (keyof IWorldTalents)[];
type _ExhaustTalents = AssertNever<Exclude<keyof IWorldTalents, (typeof FACET_TALENTS)[number]>>;

const FACET_PET = [
  'abandonPet',
  'renamePet',
  'revivePet',
  'petAttack',
  'petTaunt',
  'setPetAutoTaunt',
  'feedPet',
  'healPet',
  'setPetMode',
] as const satisfies readonly (keyof IWorldPet)[];
type _ExhaustPet = AssertNever<Exclude<keyof IWorldPet, (typeof FACET_PET)[number]>>;

const FACET_PARTY = [
  'partyInfo',
  'partyInvite',
  'partyAccept',
  'partyDecline',
  'partyLeave',
  'partyKick',
  'partyPromote',
  'convertPartyToRaid',
  'convertRaidToParty',
  'moveRaidMember',
  'setPartyLootMaster',
  'assignMasterLoot',
  'markerFor',
  'setMarker',
  'clearMarker',
] as const satisfies readonly (keyof IWorldParty)[];
type _ExhaustParty = AssertNever<Exclude<keyof IWorldParty, (typeof FACET_PARTY)[number]>>;

const FACET_TRADE = [
  'tradeInfo',
  'tradeRequest',
  'tradeAccept',
  'tradeSetOffer',
  'tradeConfirm',
  'tradeCancel',
] as const satisfies readonly (keyof IWorldTrade)[];
type _ExhaustTrade = AssertNever<Exclude<keyof IWorldTrade, (typeof FACET_TRADE)[number]>>;

const FACET_CHAT = ['chat', 'playEmote'] as const satisfies readonly (keyof IWorldChat)[];
type _ExhaustChat = AssertNever<Exclude<keyof IWorldChat, (typeof FACET_CHAT)[number]>>;

const FACET_DUEL_ARENA = [
  'duelInfo',
  'duelRequest',
  'duelAccept',
  'duelDecline',
  'arenaInfo',
  'arenaQueueJoin',
  'arenaQueueLeave',
  'arenaAugmentPick',
] as const satisfies readonly (keyof IWorldDuelArena)[];
type _ExhaustDuelArena = AssertNever<
  Exclude<keyof IWorldDuelArena, (typeof FACET_DUEL_ARENA)[number]>
>;

const FACET_SOCIAL_GRAPH = [
  'socialInfo',
  'friendAdd',
  'friendRemove',
  'blockAdd',
  'blockRemove',
  'guildCreate',
  'guildInvite',
  'guildAccept',
  'guildDecline',
  'guildLeave',
  'guildKick',
  'guildPromote',
  'guildDemote',
  'guildTransfer',
  'guildDisband',
  'searchCharacters',
] as const satisfies readonly (keyof IWorldSocialGraph)[];
type _ExhaustSocialGraph = AssertNever<
  Exclude<keyof IWorldSocialGraph, (typeof FACET_SOCIAL_GRAPH)[number]>
>;

const FACET_MARKET = [
  'marketInfo',
  'marketSearch',
  'marketList',
  'marketBuy',
  'marketCancel',
  'marketCollect',
] as const satisfies readonly (keyof IWorldMarket)[];
type _ExhaustMarket = AssertNever<Exclude<keyof IWorldMarket, (typeof FACET_MARKET)[number]>>;

const FACET_DUNGEONS = [
  'enterDungeon',
  'leaveDungeon',
  'raidLockouts',
] as const satisfies readonly (keyof IWorldDungeons)[];
type _ExhaustDungeons = AssertNever<Exclude<keyof IWorldDungeons, (typeof FACET_DUNGEONS)[number]>>;

const FACET_DELVES = [
  'enterDelve',
  'leaveDelve',
  'delveInteract',
  'companionUpgrade',
  'delveBuyShopItem',
  'delveShopOffers',
  'lockpickState',
  'lockpickEngage',
  'lockpickAction',
  'lockpickAbort',
  'collectDelveChestLoot',
  'delveRun',
  'companionState',
  'delveMarks',
  'companionUpgrades',
  'delveDaily',
] as const satisfies readonly (keyof IWorldDelves)[];
type _ExhaustDelves = AssertNever<Exclude<keyof IWorldDelves, (typeof FACET_DELVES)[number]>>;

const FACET_TELEMETRY = ['reportTelemetry'] as const satisfies readonly (keyof IWorldTelemetry)[];
type _ExhaustTelemetry = AssertNever<
  Exclude<keyof IWorldTelemetry, (typeof FACET_TELEMETRY)[number]>
>;

// The 20-facet partition, keyed by facet for legible failure messages.
const FACET_MEMBER_ARRAYS: Readonly<Record<string, readonly string[]>> = {
  entityRoster: FACET_ENTITY_ROSTER,
  combat: FACET_COMBAT,
  targeting: FACET_TARGETING,
  interaction: FACET_INTERACTION,
  loot: FACET_LOOT,
  inventory: FACET_INVENTORY,
  cosmetics: FACET_COSMETICS,
  quests: FACET_QUESTS,
  progressionXp: FACET_PROGRESSION_XP,
  talents: FACET_TALENTS,
  pet: FACET_PET,
  party: FACET_PARTY,
  trade: FACET_TRADE,
  chat: FACET_CHAT,
  duelArena: FACET_DUEL_ARENA,
  socialGraph: FACET_SOCIAL_GRAPH,
  market: FACET_MARKET,
  dungeons: FACET_DUNGEONS,
  delves: FACET_DELVES,
  telemetry: FACET_TELEMETRY,
};

describe('W1: aggregate IWorld member set equals the disjoint union of the 20 facets', () => {
  it('pins the facet count at 20', () => {
    expect(Object.keys(FACET_MEMBER_ARRAYS).length).toBe(20);
  });

  it('each facet array is non-empty and internally duplicate-free', () => {
    for (const [name, arr] of Object.entries(FACET_MEMBER_ARRAYS)) {
      expect(arr.length, `facet ${name} is empty`).toBeGreaterThan(0);
      expect(new Set(arr).size, `facet ${name} has a duplicate member`).toBe(arr.length);
    }
  });

  it('the 20 facet arrays are pairwise disjoint (no member filed in two facets)', () => {
    const entries = Object.entries(FACET_MEMBER_ARRAYS);
    const overlaps: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [aName, a] = entries[i];
        const [bName, b] = entries[j];
        const bSet = new Set(b);
        for (const member of a) {
          if (bSet.has(member)) overlaps.push(`${member}: in both ${aName} and ${bName}`);
        }
      }
    }
    expect(overlaps, `members filed in more than one facet:\n${overlaps.join('\n')}`).toEqual([]);
  });

  it('the union of the 20 facets equals the pinned 148-member IWORLD_MEMBERS set', () => {
    const union = Object.values(FACET_MEMBER_ARRAYS).flatMap((arr) => [...arr]);
    expect(union.length, 'union size before dedup (catches a duplicated member)').toBe(148);
    expect(new Set(union).size, 'union size after dedup (catches a duplicated member)').toBe(148);
    const sortedUnion = [...union].sort();
    const pinned = IWORLD_MEMBERS.map((m) => m.name).sort();
    expect(sortedUnion).toEqual(pinned);
  });
});
