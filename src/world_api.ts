// The surface the renderer + HUD need from a game world. The offline `Sim`
// satisfies this structurally; the online `ClientWorld` implements it by
// mirroring server snapshots and sending commands over the socket.
//
// `IWorld` is split into one interface per domain facet under `./world_api/`;
// this file re-aggregates them via `extends` and re-exports every facet aux type
// so every downstream `from '../world_api'` import path is unchanged. There is
// deliberately NO `./world_api/index.ts`: the bare specifier `./world_api` must
// keep resolving to THIS file, never the sibling directory.
//
// ---------------------------------------------------------------------------
// FACET MAP: the 20 domain facets (each IWorld member assigned exactly once; 142
// total). One interface per file under ./world_api/; aux types travel with their
// facet. The authoritative member-per-facet split is the W0c parity test.
//
//   entity_roster.ts    IWorldEntityRoster   cfg/entities/player/moveInput/realm reads
//   combat.ts           IWorldCombat         ability casts, auto-attack, spirit release
//   targeting.ts        IWorldTargeting      target selection + tab cycling
//   interaction.ts      IWorldInteraction    interact / lootCorpse / pickUpObject
//   loot.ts             IWorldLoot           need/greed loot rolls
//   inventory.ts        IWorldInventory      bags, equipment, vendor, copper
//   cosmetics.ts        IWorldCosmetics      account skins + mech chroma
//   quests.ts           IWorldQuests         quest log + accept/turn-in/abandon
//   progression_xp.ts   IWorldProgressionXp  xp/lifetimeXp/prestige/rested/leaderboard
//   talents.ts          IWorldTalents        talents, specs, loadouts
//   pet.ts              IWorldPet            hunter-pet command surface
//   party.ts            IWorldParty          party/raid + raid-target markers
//   trade.ts            IWorldTrade          peer-to-peer trade window
//   chat.ts             IWorldChat           chat router + emotes
//   duel_arena.ts       IWorldDuelArena      duels + ranked arena + 2v2 fiesta
//   social_graph.ts     IWorldSocialGraph    friends/blocks/guild (online-only frames)
//   market.ts           IWorldMarket         World Market browse/list/buy
//   dungeons.ts         IWorldDungeons       dungeon enter/leave + raid lockouts
//   delves.ts           IWorldDelves         delve runs, lockpick, companion
//   telemetry.ts        IWorldTelemetry      fire-and-forget metrics sink
//
// THREE GATES pin this seam (run before any facet edit):
//   tests/snapshots.test.ts        (W0a)  selfWireJson <-> applySnapshot round-trip;
//                                          ALL_DELTA_KEYS (25) + TERSE_TO_IWORLD mapping.
//   tests/command_schema.test.ts   (W0b)  COMMAND_NAMES universe; ClientWorld send-set
//                                          subset-of dispatch-set; DISPATCH_ONLY (7).
//   tests/world_api_parity.test.ts (W0c)  IWORLD_MEMBERS (142) present + same-kind on
//                                          Sim + ClientWorld; aggregate == disjoint
//                                          union of the 20 facets.
// ---------------------------------------------------------------------------

import type { IWorldChat } from './world_api/chat';
import type { IWorldCombat } from './world_api/combat';
import type { IWorldCosmetics } from './world_api/cosmetics';
import type { IWorldDelves } from './world_api/delves';
import type { IWorldDuelArena } from './world_api/duel_arena';
import type { IWorldDungeons } from './world_api/dungeons';
import type { IWorldEntityRoster } from './world_api/entity_roster';
import type { IWorldInteraction } from './world_api/interaction';
import type { IWorldInventory } from './world_api/inventory';
import type { IWorldLoot } from './world_api/loot';
import type { IWorldMarket } from './world_api/market';
import type { IWorldParty } from './world_api/party';
import type { IWorldPet } from './world_api/pet';
import type { IWorldProgressionXp } from './world_api/progression_xp';
import type { IWorldQuests } from './world_api/quests';
import type { IWorldSocialGraph } from './world_api/social_graph';
import type { IWorldTalents } from './world_api/talents';
import type { IWorldTargeting } from './world_api/targeting';
import type { IWorldTelemetry } from './world_api/telemetry';
import type { IWorldTrade } from './world_api/trade';

// --- pass-through sim re-exports: downstream imports these FROM world_api ---
export type { LeaderboardPage } from './sim/leaderboard_page';
export type { ArenaCombatant, ArenaFormat, ArenaStanding, OverheadEmoteId } from './sim/types';

// --- facet aux-type + value re-exports (each travels with its facet file) ---
export { isOverheadEmoteId, OVERHEAD_EMOTES } from './world_api/chat';
export type { AccountCosmetics } from './world_api/cosmetics';
export type {
  DelveCompanionInfo,
  DelveDailyInfo,
  DelveRunInfo,
  DelveShopOfferView,
  LockpickView,
} from './world_api/delves';
export type {
  ArenaInfo,
  ArenaLadderEntry,
  DuelInfo,
  FiestaAugmentOffer,
  FiestaMatchInfo,
  FiestaPowerupView,
  FiestaScoreboardPlayer,
} from './world_api/duel_arena';
export type { RaidLockout } from './world_api/dungeons';
export type { MarketInfo, MarketListingView } from './world_api/market';
export type { PartyInfo, PartyMemberInfo } from './world_api/party';
export type { LeaderboardEntry } from './world_api/progression_xp';
export type {
  CharacterSearchResult,
  FriendInfo,
  GuildInfo,
  GuildMemberInfo,
  GuildRank,
  PresenceStatus,
  SocialInfo,
} from './world_api/social_graph';
export type { TradeInfo, TradeOffer } from './world_api/trade';

// The aggregate seam. Empty body: every member lives on exactly one facet above,
// so `IWorld` is byte-identical to the pre-split flat interface and both the
// offline `Sim` and the online `ClientWorld` still satisfy it structurally.
export interface IWorld
  extends IWorldEntityRoster,
    IWorldCombat,
    IWorldTargeting,
    IWorldInteraction,
    IWorldLoot,
    IWorldInventory,
    IWorldCosmetics,
    IWorldQuests,
    IWorldProgressionXp,
    IWorldTalents,
    IWorldPet,
    IWorldParty,
    IWorldTrade,
    IWorldChat,
    IWorldDuelArena,
    IWorldSocialGraph,
    IWorldMarket,
    IWorldDungeons,
    IWorldDelves,
    IWorldTelemetry {}

// ---------------------------------------------------------------------------
// Command schema (W0b): the shared wire-token vocabulary.
//
// COMMAND_NAMES is the canonical command universe: every entry is byte-identical
// to a `case 'X':` label in `server/game.ts` dispatchMessage and to a `cmd:'X'`
// literal that `src/net/online.ts` (ClientWorld) sends. Both files import this
// single table so the command-schema lockstep invariant has one source of truth:
// every ClientWorld send is provably a token the server dispatches.
//
// APPEND-ONLY: the wire string IS the protocol. Never rename or remove a token
// (that is a breaking protocol change); the table only ever grows, with new
// tokens added at the end. These literals are the one blessed string set in this
// otherwise string-free seam: they are types-as-data (no t(), no DOM), not
// player-facing copy.
//
// NOTE: this is the protocol vocabulary, deliberately not derived from any per
// command method name, because the wire tokens (`pinvite`, `qlinkaccept`,
// `unequip_item`, ...) intentionally differ from the IWorld member names.
export const COMMAND_NAMES = [
  'castSlot',
  'cast',
  'cancel_aura',
  'target',
  'tab',
  'targetNearest',
  'tabFriendly',
  'targetNearestFriendly',
  'attack',
  'stopattack',
  'interact',
  'loot',
  'lootRoll',
  'pickup',
  'accept',
  'turnin',
  'abandon',
  'qlinkaccept',
  'equip',
  'unequip_item',
  'use',
  'discard',
  'buy',
  'sell',
  'buyback',
  'sell_all_junk',
  'change_skin',
  'unequip_mech_chroma',
  'claim_event_skin',
  'release',
  'challengeResponse',
  'chat',
  'emote',
  'pinvite',
  'paccept',
  'pdecline',
  'pleave',
  'pkick',
  'praid',
  'punraid',
  'pmoveRaid',
  'setLootMaster',
  'masterAssign',
  'setMarker',
  'clearMarker',
  'pet_abandon',
  'pet_rename',
  'pet_revive',
  'pet_attack',
  'pet_taunt',
  'pet_auto_taunt',
  'pet_feed',
  'pet_heal',
  'pet_mode',
  'trade_req',
  'trade_accept',
  'trade_offer',
  'trade_confirm',
  'trade_cancel',
  'duel_req',
  'duel_accept',
  'duel_decline',
  'friend_add',
  'friend_remove',
  'block_add',
  'block_remove',
  'social_refresh',
  'guild_create',
  'guild_invite',
  'guild_accept',
  'guild_decline',
  'guild_leave',
  'guild_kick',
  'guild_promote',
  'guild_demote',
  'guild_transfer',
  'guild_disband',
  'arena_queue',
  'arena_leave',
  'arena_augment',
  'prestige',
  'applyTalents',
  'respec',
  'setSpec',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
  'market_search',
  'market_list',
  'market_buy',
  'market_cancel',
  'market_collect',
  'dev_level',
  'dev_teleport',
  'dev_give',
  'enter_crypt',
  'enter_dungeon',
  'leave_crypt',
  'leave_dungeon',
  'enter_delve',
  'leave_delve',
  'delve_interact',
  'companion_upgrade',
  'delve_buy',
  'lockpick_engage',
  'lockpick_action',
  'lockpick_abort',
  'collect_delve_chest_loot',
  'telemetry',
] as const;

// The union both the send path (`online.ts`) and the dispatch switch
// (`game.ts`) reference.
export type CommandName = (typeof COMMAND_NAMES)[number];

// Dispatch-only extras: commands the server routes but ClientWorld never sends.
// `dev_*` are env-gated cheats (ALLOW_DEV_COMMANDS, never production);
// `enter_crypt`/`leave_crypt` are legacy aliases that fall through to the
// dungeon cases; `social_refresh` is a server-push refresh path; `targetNearest`
// is called directly on the Sim by the headless RL action layer, never over the
// wire. Each must be a member of COMMAND_NAMES (the `satisfies` enforces it).
export const DISPATCH_ONLY_COMMANDS = [
  'dev_level',
  'dev_teleport',
  'dev_give',
  'enter_crypt',
  'leave_crypt',
  'social_refresh',
  'targetNearest',
] as const satisfies readonly CommandName[];

export type DispatchOnlyCommand = (typeof DISPATCH_ONLY_COMMANDS)[number];

// The tokens ClientWorld is allowed to send: the full vocabulary minus the
// dispatch-only extras. The typed `cmd()` send path is keyed to this, so a send
// of any dispatch-only token is a compile error.
export type ClientCommand = Exclude<CommandName, DispatchOnlyCommand>;

// ---------------------------------------------------------------------------
// Command facet tags (W6+). APPEND-ONLY metadata that names, for each wire
// command, the IWorld facet whose method sends it, so the command universe is
// discoverable by domain. Like COMMAND_NAMES this is types-as-data, not
// player-facing copy (no t(), no DOM); it never gates the wire (COMMAND_NAMES is
// the protocol). PARTIAL by design: each cluster slice (W6-W10) appends its
// facet's commands, and members with no wire command (roster reads like `cfg`,
// the HUD-read `activeLootRolls`) are deliberately absent. Keyed by ClientCommand
// so a dispatch-only token (e.g. `targetNearest`, the RL-only Sim action) can
// never be tagged.
export type WorldFacet =
  | 'IWorldEntityRoster'
  | 'IWorldCombat'
  | 'IWorldTargeting'
  | 'IWorldInteraction'
  | 'IWorldLoot'
  | 'IWorldInventory'
  | 'IWorldCosmetics'
  | 'IWorldQuests'
  | 'IWorldProgressionXp'
  | 'IWorldTalents'
  | 'IWorldPet'
  | 'IWorldParty'
  | 'IWorldTrade'
  | 'IWorldChat'
  | 'IWorldDuelArena'
  | 'IWorldSocialGraph'
  | 'IWorldMarket'
  | 'IWorldDungeons'
  | 'IWorldDelves'
  | 'IWorldTelemetry';

export const COMMAND_FACETS = {
  // IWorldCombat: ability casts, auto-attack, spirit release.
  cast: 'IWorldCombat',
  castSlot: 'IWorldCombat',
  cancel_aura: 'IWorldCombat',
  attack: 'IWorldCombat',
  stopattack: 'IWorldCombat',
  release: 'IWorldCombat',
  // IWorldTargeting: target selection + tab cycling.
  target: 'IWorldTargeting',
  tab: 'IWorldTargeting',
  targetNearestFriendly: 'IWorldTargeting',
  tabFriendly: 'IWorldTargeting',
  // IWorldLoot: need-greed roll submit.
  lootRoll: 'IWorldLoot',
  // IWorldTelemetry: fire-and-forget metrics sink.
  telemetry: 'IWorldTelemetry',
  // IWorldProgressionXp: opt-in cosmetic prestige (leaderboard is a REST GET, no
  // wire command; the XP/milestone reads ride the self-snapshot, not a send).
  prestige: 'IWorldProgressionXp',
  // IWorldTalents: allocation commits + loadout edits (talentPoints is a local
  // compute with no send; the server re-validates every allocation).
  applyTalents: 'IWorldTalents',
  respec: 'IWorldTalents',
  setSpec: 'IWorldTalents',
  saveLoadout: 'IWorldTalents',
  switchLoadout: 'IWorldTalents',
  deleteLoadout: 'IWorldTalents',
  // IWorldCosmetics: skin + mech-chroma equips (snake_case wire strings, by design).
  change_skin: 'IWorldCosmetics',
  claim_event_skin: 'IWorldCosmetics',
  unequip_mech_chroma: 'IWorldCosmetics',
  // IWorldPet: hunter-pet commands (snake_case wire strings, by design; pet state
  // mirrors on the owned-mob entity wire, not a self-snapshot field).
  pet_abandon: 'IWorldPet',
  pet_rename: 'IWorldPet',
  pet_revive: 'IWorldPet',
  pet_attack: 'IWorldPet',
  pet_taunt: 'IWorldPet',
  pet_auto_taunt: 'IWorldPet',
  pet_feed: 'IWorldPet',
  pet_heal: 'IWorldPet',
  pet_mode: 'IWorldPet',
  // IWorldParty: party/raid commands + raid-target markers (terse wire strings; the
  // markers belong to IWorldParty, not IWorldTargeting; partyInfo/markerFor are
  // snapshot reads with no send).
  pinvite: 'IWorldParty',
  paccept: 'IWorldParty',
  pdecline: 'IWorldParty',
  pleave: 'IWorldParty',
  pkick: 'IWorldParty',
  praid: 'IWorldParty',
  punraid: 'IWorldParty',
  pmoveRaid: 'IWorldParty',
  setLootMaster: 'IWorldParty',
  masterAssign: 'IWorldParty',
  setMarker: 'IWorldParty',
  clearMarker: 'IWorldParty',
  // IWorldTrade: peer-to-peer trade-window commands (tradeInfo is a snapshot read,
  // no send).
  trade_req: 'IWorldTrade',
  trade_accept: 'IWorldTrade',
  trade_offer: 'IWorldTrade',
  trade_confirm: 'IWorldTrade',
  trade_cancel: 'IWorldTrade',
  // IWorldDuelArena: duels + rated-arena queue + the 2v2 Fiesta augment pick. Fiesta
  // has no top-level member (it lives in arenaInfo.match.fiesta and flows over the
  // events queue); arena_augment is its only command. duelInfo/arenaInfo are snapshot
  // reads (no send).
  duel_req: 'IWorldDuelArena',
  duel_accept: 'IWorldDuelArena',
  duel_decline: 'IWorldDuelArena',
  arena_queue: 'IWorldDuelArena',
  arena_leave: 'IWorldDuelArena',
  arena_augment: 'IWorldDuelArena',
  // IWorldSocialGraph: friends/blocks/guild commands (online only; resolved
  // server-side by character name, handled by the #4 SocialService). socialInfo
  // arrives via the social/socialpos frames (no command); searchCharacters is a REST
  // GET (no wire command); social_refresh is a dispatch-only server push (untagged).
  friend_add: 'IWorldSocialGraph',
  friend_remove: 'IWorldSocialGraph',
  block_add: 'IWorldSocialGraph',
  block_remove: 'IWorldSocialGraph',
  guild_create: 'IWorldSocialGraph',
  guild_invite: 'IWorldSocialGraph',
  guild_accept: 'IWorldSocialGraph',
  guild_decline: 'IWorldSocialGraph',
  guild_leave: 'IWorldSocialGraph',
  guild_kick: 'IWorldSocialGraph',
  guild_promote: 'IWorldSocialGraph',
  guild_demote: 'IWorldSocialGraph',
  guild_transfer: 'IWorldSocialGraph',
  guild_disband: 'IWorldSocialGraph',
  // IWorldMarket: World Market browse/list/buy/cancel/collect (snake_case wire
  // strings, by design). marketInfo is a snapshot read (no send, untagged).
  market_search: 'IWorldMarket',
  market_list: 'IWorldMarket',
  market_buy: 'IWorldMarket',
  market_cancel: 'IWorldMarket',
  market_collect: 'IWorldMarket',
  // IWorldDungeons: dungeon enter/leave. raidLockouts is a snapshot-derived read
  // (no send, untagged). enter_crypt/leave_crypt are legacy dispatch-only aliases
  // (untagged; on the DISPATCH_ONLY_COMMANDS allowlist), NOT IWorldDungeons.
  enter_dungeon: 'IWorldDungeons',
  leave_dungeon: 'IWorldDungeons',
  // IWorldDelves: delve enter/leave + interact + companion upgrade + Marks-vendor buy
  // + lockpick lifecycle + chest collect. Note the wire-name skew: delveBuyShopItem
  // sends `delve_buy`, so the tag is keyed on the WIRE string `delve_buy`. The reads
  // delveShopOffers (pure client compute from the dclears mirror), lockpickState
  // (event-rebuilt), delveRun/companionState/delveMarks/companionUpgrades/delveDaily
  // (snapshot reads) carry no command and stay untagged.
  enter_delve: 'IWorldDelves',
  leave_delve: 'IWorldDelves',
  delve_interact: 'IWorldDelves',
  companion_upgrade: 'IWorldDelves',
  delve_buy: 'IWorldDelves',
  lockpick_engage: 'IWorldDelves',
  lockpick_action: 'IWorldDelves',
  lockpick_abort: 'IWorldDelves',
  collect_delve_chest_loot: 'IWorldDelves',
} as const satisfies Partial<Record<ClientCommand, WorldFacet>>;
