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
// FACET MAP: the domain facets (each IWorld member assigned exactly once; the
// authoritative member COUNT lives in the pinned gates below, not this prose).
// One interface per file under ./world_api/; aux types travel with their
// facet. The authoritative member-per-facet split is the W0c parity test.
//
//   entity_roster.ts    IWorldEntityRoster   cfg/entities/player/moveInput/realm reads
//   combat.ts           IWorldCombat         ability casts, auto-attack, spirit release
//   targeting.ts        IWorldTargeting      target selection + tab cycling
//   interaction.ts      IWorldInteraction    civic-service readout + interact / loot / pickup
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
//   battleground.ts     IWorldBattleground   Thornhollow Fields 5v5 capture-the-flag queue + match view
//   social_graph.ts     IWorldSocialGraph    friends/blocks/guild (online-only frames)
//   market.ts           IWorldMarket         World Market browse/list/buy
//   mail.ts             IWorldMail           Ravenpost mail send/take + unread badge
//   dungeons.ts         IWorldDungeons       dungeon enter/leave + raid lockouts
//   delves.ts           IWorldDelves         delve runs, lockpick, companion
//   daily_rewards.ts    IWorldDailyRewards   daily WOC-holder rewards
//   telemetry.ts        IWorldTelemetry      fire-and-forget metrics sink
//   professions.ts      IWorldProfessions    skill/craft/recipe/node read surface (#1164; node
//                                            harvest read + action landed in #1121; recipe
//                                            content + basic crafting action landed in #1127)
//   bank.ts             IWorldBank           per-character deposit box (proximity-gated info +
//                                            deposit/withdraw/buy-slots)
//   guild_bank.ts       IWorldGuildBank      shared guild treasury + item store (guild-wide view
//                                            with canEdit marking officer-plus EDITS,
//                                            proximity-gated info + gold/item/buy-slots commands)
//   mounts.ts           IWorldMounts         rideable ground mounts: pick + mount/dismount
//   dungeon_finder.ts   IWorldDungeonFinder  Dungeon Finder queue/proposals/premade board
//   deeds.ts            IWorldDeeds          earned deeds, lifetime stats, renown, active title,
//                                            rarity + the account-Renown leaderboard reads
//   reliquary.ts        IWorldReliquary      sparse firstFind / marks / recent + pure completion
//
// THREE GATES pin this seam (run before any facet edit; the literal counts are
// pinned THERE and re-stale here, so this prose stays count-free):
//   tests/snapshots.test.ts        (W0a)  selfWireJson <-> applySnapshot round-trip;
//                                          ALL_DELTA_KEYS + TERSE_TO_IWORLD mapping.
//   tests/command_schema.test.ts   (W0b)  COMMAND_NAMES universe; ClientWorld send-set
//                                          subset-of dispatch-set; DISPATCH_ONLY.
//   tests/world_api_parity.test.ts (W0c)  IWORLD_MEMBERS present + same-kind on
//                                          Sim + ClientWorld; aggregate == disjoint
//                                          union of the facets.
// ---------------------------------------------------------------------------

import type { IWorldActionBar } from './world_api/action_bar';
import type { IWorldBank } from './world_api/bank';
import type { IWorldBattleground } from './world_api/battleground';
import type { IWorldCardMinigame } from './world_api/card_minigame';
import type { IWorldChat } from './world_api/chat';
import type { IWorldCombat } from './world_api/combat';
import type { IWorldCosmetics } from './world_api/cosmetics';
import type { IWorldDailyRewards } from './world_api/daily_rewards';
import type { IWorldDeeds } from './world_api/deeds';
import type { IWorldDelves } from './world_api/delves';
import type { IWorldDuelArena } from './world_api/duel_arena';
import type { IWorldDungeonFinder } from './world_api/dungeon_finder';
import type { IWorldDungeons } from './world_api/dungeons';
import type { IWorldEntityRoster } from './world_api/entity_roster';
import type { IWorldGuildBank } from './world_api/guild_bank';
import type { IWorldInteraction } from './world_api/interaction';
import type { IWorldInventory } from './world_api/inventory';
import type { IWorldLoot } from './world_api/loot';
import type { IWorldMail } from './world_api/mail';
import type { IWorldMarket } from './world_api/market';
import type { IWorldMounts } from './world_api/mounts';
import type { IWorldParty } from './world_api/party';
import type { IWorldPet } from './world_api/pet';
import type { IWorldProfessions } from './world_api/professions';
import type { IWorldProgressionXp } from './world_api/progression_xp';
import type { IWorldQuests } from './world_api/quests';
import type { IWorldReliquary } from './world_api/reliquary';
import type { IWorldSocialGraph } from './world_api/social_graph';
import type { IWorldTalents } from './world_api/talents';
import type { IWorldTargeting } from './world_api/targeting';
import type { IWorldTelemetry } from './world_api/telemetry';
import type { IWorldTrade } from './world_api/trade';

// --- pass-through sim re-exports: downstream imports these FROM world_api ---
// Account flair is defined in the host-agnostic sim core (src/sim/account_flair.ts)
// because the server, the client mirror, and the HUD must all agree on its shape;
// it rides through this seam so render/ui never import a concrete world.
export type { PlayerFlair, StreamerLinks, StreamerPlatform } from './sim/account_flair';
export type {
  DeedsLeaderboardPage,
  DevLeaderboardPage,
  GuildLeaderboardPage,
  LeaderboardPage,
} from './sim/leaderboard_page';
export type {
  ArenaCombatant,
  ArenaFormat,
  ArenaStanding,
  DeedStats,
  OverheadEmoteId,
} from './sim/types';

// Online world and required-snapshot compatibility is encoded in the first
// WebSocket frame's discriminator. Changing the authoritative town layout or
// a required snapshot shape requires a new epoch: the strict discriminator
// makes both rolling-deploy directions fail closed before either binary loads
// a character into an incompatible world.
// 7 = Fate Threads moved from the marked target to the Warlock. Mixed binaries
// disagree about the authoritative resource carrier, so they must fail closed.
// 8 = the New Eastbrook program's Copper Dig relocation to the dig headland
// (new coast lobe, dig terrain stamp, moved camps/props/veins and colliders;
// docs/design/eastbrook-revamp/master-plan.md). Numbered 7 on the pre-merge
// eastbrook branch, which forked before the Fate Threads bump.
// 9 = phase 0b of the same program: the dig headland reverts to open sea (the
// ferry lane), the Copper Dig cluster moves northeast past Mirror Lake onto
// the Mirefen road, and the harbor-town plat's basin lobes and grading stamps
// land where the Sowfield stood. (8 on the pre-merge eastbrook branch.)
// 10 = Bank Storage adds required BankInfo socket and two-pool capacity fields.
// Release v0.41.0's auth-world-9 payload lacks them, so mixed binaries must be
// rejected before the new client can consume the old six-field snapshot.
// 11 = Materials Vault snapshots require the identity-preserving `special`
// collection. An epoch-10 client can neither render nor select those rows, and
// an epoch-10 server would omit them, stranding deposited special materials.
// 13 = Varkhul's Forge Links became ten individual room runes with concentric
// movement controls. Mixed binaries disagree about actionable raid instructions,
// so they must fail closed before entering the world.
// 14 = Heroic Forge Links added orphaned-rune rescue state and neighbor signals.
// Older clients cannot render who is authorized to rescue an orphan.
// 15 = Forge Links became one five-track rune loom with moving controls, two
// waves on both difficulties, and explicit Normal/Heroic wire identity. Older
// clients would render ten overlapping stations and give unsafe instructions.
// 16 = Forge Links returned to ten separate room stations while retaining the
// moving controls and two-wave flow. Epoch 15 clients would stack every rune at
// one shared center and present the wrong interaction geometry.
// 17 = Forge Links added two authoritative crucible beams, blocker endpoints,
// forge overheat, and Forge Meltdown. Epoch 16 clients cannot show or react to
// those lethal signals, so mixed binaries must fail closed.
// 18 = Forge Links removed the rune interface and became persistent crucible
// pillars plus timed beam windows, forge heat and portal add waves. Epoch 17
// clients would still render obsolete runes and hide inactive pillar hardware.
// 19 = Varkhul added an authoritative moving Tempering Ray with a first-body
// interceptor. Epoch 18 clients cannot render its lethal line or safe blocker.
// 20 = Varkhul enlarged Cinder Orb fire from 2.4 to 3.5 yards. The persistent
// fire radius is authoritative, but the four-second player warning is compiled
// into the client, so epoch 19 clients would preview a dangerously smaller area.
// 21 = Heroic Varkhul added Worldfire, a compiled six-stage room-filling fire
// wall. Epoch 20 clients would take lethal damage from bands they cannot see.
// 22 = Varkhul's compiled Forgefather's Sweep footprint grew from 30 yards and
// 120 degrees to 42 yards and 140 degrees. Epoch 21 clients would display a
// dangerously smaller warning than the authoritative server damage.
// 23 = The Ignivar raid gained Molten Assembly as a compiled fourth room and
// Varkhul's Assembly gained authoritative wave/enemy counters. Epoch 22 clients
// do not know the new route or enough state to present its add phase safely.
// 24 = Ignivar's compiled arena floor gained a lowered lethal lava perimeter
// whose exact 4x4 stone-tile union and bridge footprint are shared by movement,
// damage and rendering. Epoch 23 clients would render and stand on the old full
// floor while the server burns and lowers the new perimeter.
// 25 = Ignivar's compiled Rain of Cinders cone length grew from 24 to 30 yards.
// Epoch 24 clients would display a dangerously shorter warning than the
// authoritative server damage.
// (12 is deliberately unassigned: 13 through 25 were numbered 11 through 23 on
// the pre-merge raid branch, which forked before the Bank Storage and Materials
// Vault bumps above; that branch's 11 through 20 were in turn 9 through 18
// before the Eastbrook program bumps.)
export const ONLINE_WORLD_LAYOUT_VERSION = 25 as const;
export const ONLINE_WORLD_AUTH_TYPE = `auth-world-${ONLINE_WORLD_LAYOUT_VERSION}` as const;
// The one wire literal both sides emit for a layout-epoch mismatch. The server
// rejects with it, the client synthesizes it for pre-epoch servers, and the UI
// matcher re-localizes it, so all three must stay byte-identical.
export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE =
  'Game and server versions are incompatible. Reload or update, then try again.' as const;

// Snapshot timer wire capability shared by the browser mirror and authoritative
// server. Keep the version exact so rolling deploys can negotiate fail-closed.
export const STABLE_TIMER_WIRE_VERSION = 3 as const;
export type StableTimerWireVersion = typeof STABLE_TIMER_WIRE_VERSION;

// Warlock pet-bar signature command capability. It is negotiated independently
// from the world-layout epoch so rolling deploys fail closed for this optional
// behavior without disconnecting otherwise compatible clients.
export const PET_SPECIAL_WIRE_VERSION = 1 as const;
export type PetSpecialWireVersion = typeof PET_SPECIAL_WIRE_VERSION;

// Dungeon-entry facing acknowledgement capability. The exact entry generation
// proves the client observed the authoritative landing snapshot.
export const DUNGEON_ENTRY_FACING_WIRE_VERSION = 1 as const;
export type DungeonEntryFacingWireVersion = typeof DUNGEON_ENTRY_FACING_WIRE_VERSION;

// Absolute cooldown schedule in server simulation seconds. A number is the
// expiry for 1x recovery. The tuple adds a temporary recovery-rate segment;
// after acceleratedUntil, recovery continues at 1x until expiresAt.
export type StableCooldownWire =
  | number
  | readonly [expiresAt: number, recoveryRate: number, acceleratedUntil: number];

// --- facet aux-type + value re-exports (each travels with its facet file) ---
export type {
  ActionBarFormLayout,
  ActionBarLayout,
  ActionBarLayoutForm,
  ActionBarLayoutRestore,
  ActionBarSlotAction,
} from './world_api/action_bar';
export type { BankBonusSource, BankInfo, VaultInfo, VaultSpecialRef } from './world_api/bank';
export type {
  BgFlagInfo,
  BgInfo,
  BgLadderEntry,
  BgMatchInfo,
  BgPlayerInfo,
  BgProposalInfo,
} from './world_api/battleground';
export type { CardMinigameInfo } from './world_api/card_minigame';
export { isOverheadEmoteId, OVERHEAD_EMOTES } from './world_api/chat';
export type {
  ActiveConsecration,
  ActiveFrostRing,
  ActiveIgnivarMeteorWarning,
  ActiveTemporalHourglass,
  ActiveVarkhulAnvilMeteorWarning,
  ActiveVarkhulAssembly,
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
  ActiveVarkhulForgestormWarning,
} from './world_api/combat';
export type { AccountCosmetics } from './world_api/cosmetics';
export type {
  DailyRewardEligibilityView,
  DailyRewardHistory,
  DailyRewardLeaderboardEntry,
  DailyRewardLeaderboardPage,
  DailyRewardPayoutLogEntry,
  DailyRewardSpinResult,
  DailyRewardSpinView,
  DailyRewardStatus,
  DailyRewardTaskView,
} from './world_api/daily_rewards';
export type {
  DeedsLeaderboardEntry,
  DeedsLeaderboardSelf,
  DeedsRarity,
} from './world_api/deeds';
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
export type {
  DungeonFinderApplicantView,
  DungeonFinderBoard,
  DungeonFinderInfo,
  DungeonFinderListingView,
  DungeonFinderMyListingView,
  DungeonFinderProposalView,
  DungeonFinderQueueView,
} from './world_api/dungeon_finder';
export type { RaidLockout, RiftFloorView } from './world_api/dungeons';
export {
  GUILD_BANK_LOG_LIMIT,
  type GuildBankInfo,
  type GuildBankLogEntry,
  type GuildBankLogOp,
  type GuildBankLogView,
} from './world_api/guild_bank';
export type {
  CivicServiceKind,
  CivicServicePlacement,
  WorldInteractionOutcome,
} from './world_api/interaction';
export type { MailInfo, MailKindView, MailMessageView } from './world_api/mail';
export type { MarketInfo, MarketListingView } from './world_api/market';
export { queryDiffersFromEcho, searchDiffersFromEcho } from './world_api/market';
export type { MountRaceView } from './world_api/mounts';
export type { PartyInfo, PartyMemberAura, PartyMemberInfo } from './world_api/party';
export type {
  CraftingIdentityView,
  CraftResultView,
  DisenchantResultView,
  PlayerProfessionsView,
  RecipeDef,
  ToolEffectSlotView,
} from './world_api/professions';
export type {
  DevLeaderboardEntry,
  GuildLeaderboardEntry,
  GuildRosterEntry,
  GuildRosterInfo,
  LeaderboardEntry,
} from './world_api/progression_xp';
export type {
  ReliquaryCatalogCompletion,
  ReliquaryFirstFindView,
  ReliquaryPageCompletion,
  ReliquaryRarity,
} from './world_api/reliquary';
export type {
  CharacterProfile,
  CharacterSearchResult,
  FriendInfo,
  GuildEventInfo,
  GuildInfo,
  GuildMemberInfo,
  GuildPledgeInfo,
  GuildPledgeSettings,
  GuildRank,
  MyPledgeInfo,
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
    IWorldBattleground,
    IWorldCardMinigame,
    IWorldSocialGraph,
    IWorldMarket,
    IWorldMail,
    IWorldDungeons,
    IWorldDelves,
    IWorldDailyRewards,
    IWorldTelemetry,
    IWorldProfessions,
    IWorldBank,
    IWorldGuildBank,
    IWorldDungeonFinder,
    IWorldActionBar,
    IWorldDeeds,
    IWorldReliquary,
    IWorldMounts {}

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
  'castAt',
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
  'harvestCorpse',
  'lootRoll',
  'pickup',
  'accept',
  'turnin',
  'abandon',
  'qlinkaccept',
  'equip',
  'inv_move',
  'unequip_item',
  'use',
  'discard',
  'lock_item',
  'buy',
  'sell',
  'buyback',
  'sell_all_junk',
  'harvest_node',
  'craft_item',
  'place_mobile_station',
  'change_skin',
  'unequip_mech_chroma',
  'claim_event_skin',
  'change_weapon_skin',
  'release',
  'challengeResponse',
  'chat',
  'emote',
  'pinvite',
  'paccept',
  'pdecline',
  'pleave',
  'pkick',
  'ppromote',
  'praid',
  'punraid',
  'pmoveRaid',
  'setLootMaster',
  'masterAssign',
  'setMarker',
  'clearMarker',
  'readyrespond',
  'pet_abandon',
  'pet_rename',
  'pet_revive',
  'pet_attack',
  'pet_water_jet',
  'pet_taunt',
  'pet_auto_taunt',
  'pet_auto_water_jet',
  'pet_feed',
  'pet_heal',
  'pet_mode',
  'trade_req',
  'trade_accept',
  'trade_offer',
  'trade_confirm',
  'trade_cancel',
  // Landed beside its trade siblings rather than appended at the tail; this
  // list feeds only KNOWN_COMMANDS (a Set) and the CommandName union, and
  // moving an already-shipped token would be the very reorder the tail rule
  // forbids, so it stays filed here.
  'trade_close',
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
  'guild_pledge',
  'guild_pledge_withdraw',
  'guild_pledge_decide',
  'guild_pledge_settings',
  'guild_transfer',
  'guild_disband',
  'arena_queue',
  'arena_leave',
  'arena_augment',
  'card_queue_join',
  'card_queue_leave',
  'play_card',
  'card_forfeit',
  'prestige',
  'applyTalents',
  'respec',
  'setSpec',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
  'market_search',
  'market_sell_price_check',
  'market_list',
  'market_list_instance',
  'market_buy',
  'market_cancel',
  'market_collect',
  'dev_level',
  'dev_teleport',
  'dev_give',
  'dev_complete_quest',
  'dev_complete_all_quests',
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
  'delve_rite_choose',
  'telemetry',
  'equip_bag',
  'unequip_bag',
  'mail_send',
  'mail_take',
  'mail_delete',
  'mail_read',
  'guild_event_create',
  'guild_event_remove',
  'autoloot',
  'resurrect_corpse',
  'resurrect_healer',
  'bank_deposit',
  'bank_withdraw',
  'bank_buy_slots',
  'set_town_focus',
  'set_dungeon_difficulty',
  'heroic_buy',
  'crucible_buy',
  'mount_toggle',
  'mount_train_begin',
  'mount_train_answer',
  'mount_train_abort',
  'mount_race_start',
  'mount_race_cancel',
  'learn_riding',
  'releaseEmpowered',
  'df_roles',
  'df_queue',
  'df_queue_leave',
  'df_proposal',
  'df_list_create',
  'df_list_close',
  'df_apply',
  'df_apply_cancel',
  'df_app_respond',
  'rift_upgrade_item',
  'rift_enchant_item',
  'rift_socket_gem',
  'deed_set_title',
  // personal chat ignores: the chat-only sibling of block_add/block_remove.
  // (An admin "mute" is a moderation action, not a wire command.)
  'ignore_add',
  'ignore_remove',
  'stow_weapon',
  // Local geometry recovery. Appended because wire tokens are never reordered.
  'unstuck',
  // Append-only protocol addition for the canonical Talents V2 row mutation.
  'selectTalentRow',
  'resurrect_respond',
  // Recipe training (Professions 2.0): learn a trainer-taught recipe
  // at its craft's station (Sim.trainRecipe via professions/training.ts).
  'train_recipe',
  // Tool effect slotting: attach a catalog effect to one gathering
  // profession's tool (Sim.slotToolEffect via professions/tools.ts slotEffect),
  // consuming one crafted charm copy from the sender's bags (the acquisition
  // craft). Keyed per PROFESSION rather than per tool item, because the live
  // harvest path resolves a tool tier and never a tool.
  'slot_tool_effect',
  // Tool effect recharge: refill the sender's slotted effect at the R39
  // arcane-material price and the R30 re-derived maximum
  // (Sim.rechargeToolEffect via professions/tools.ts resolveRechargeToolEffect).
  'recharge_tool_effect',
  // Per-character action-bar layout persistence: the owning client uploads its
  // full arranged layout (debounced) so it restores at login on any device.
  'save_hotbar_layout',
  // Enchanting profession actions (Professions 2.0): disenchant a held
  // piece into arcane materials, apply an enchant to a held copy, or salvage a
  // held piece into generic materials (Sim.disenchantItem/applyEnchant/salvageItem
  // via src/sim/professions/enchanting.ts and salvage.ts).
  'disenchant_item',
  'apply_enchant',
  'salvage_item',
  // Maker's Bond unbind service (Professions 2.0): clear the
  // boundTo trade lock on one held bound commission piece for the
  // tier-scaled gold fee (Sim.unbindItem via src/sim/professions/
  // commission.ts).
  'unbind_item',
  // Guild billboard: set (or clear, with '') the officer-editable message
  // pinned atop the social window's Guild tab (SocialService.guildSetMotd).
  'guild_set_motd',
  // Template-authored active on a controlled pet (Abyssal Chain, Felbolt)
  // plus its pet-bar autocast toggle.
  'pet_special',
  'pet_auto_special',
  // Commission order board (Professions 2.0, issue #1298): open/cancel a
  // commission request, or accept/deliver one as a crafter (Sim.
  // openCommissionOrder/cancelCommissionOrder/acceptCommissionOrder/
  // deliverCommissionOrder via src/sim/professions/commission_order.ts).
  'open_commission_order',
  'cancel_commission_order',
  'accept_commission_order',
  'deliver_commission_order',
  // "Stop Auto-Attack on Target Switch" QoL preference (issue #1358): mirrors
  // the client setting onto the authoritative Targeting slice so every
  // target-switch selector can gate on it (Sim.setStopAutoAttackOnTargetSwitch
  // via src/sim/targeting.ts).
  'stopAutoAttackOnTargetSwitch',
  // Thornhollow Fields 5v5 capture-the-flag: queue join/leave and the deliberate
  // battleground action press (flag pickup; Sim.bgQueueJoin/bgQueueLeave/
  // bgFlagAction via src/sim/social/battleground.ts). dev_bg_start is the
  // env-gated force-start (dispatch-only, below).
  'bg_queue',
  'bg_leave',
  'bg_respond',
  'bg_flag',
  'dev_bg_start',
  // Profiler-only server authority: idempotently prevents incoming damage while
  // preserving normal outgoing damage and incoming hit presentation.
  'dev_profiler_invulnerable',
  // The Guild Bank cluster (shared treasury + item store, viewable guild-wide,
  // EDITABLE officer-plus only: every token below is a mutating op the sim
  // refuses for a plain member, src/sim/guild_bank.ts). Its own guild_bank_*
  // tokens forever, NEVER a reuse
  // of the personal bank_* strings (state.md decision; pinned by
  // tests/command_facets.test.ts). `slot` is a container index and `count`
  // optional (the bank_* wire idiom); `amount` is copper. The Sim owns every
  // gameplay rule (banker proximity, officer-plus rank on edits, quest-bind,
  // caps, table price); the server validates shape only.
  'guild_bank_deposit_gold',
  'guild_bank_withdraw_gold',
  'guild_bank_deposit',
  'guild_bank_withdraw',
  'guild_bank_buy_slots',
  // The guild bank ACTIVITY LOG request (the guild-visible history of the
  // append-only bank_ledger rows; readable by every member since the v0.35
  // member read-only view). A pure READ token: it mutates nothing, and
  // its answer comes back on its own one-shot 'gbanklog' frame rather than the
  // 20 Hz snapshot, because the payload is cold, identical for every member of
  // the guild, and 50 rows wide. Sent only while the log view is open.
  'guild_bank_log',
  // Paperdoll eye toggle: helmet-visibility preference on the composed body.
  // Appended because wire tokens are never reordered.
  'set_helm',
  // One-shot bag clean-up (IWorldInventory.sortInventory): no payload, the
  // sim consolidates and restamps cell hints deterministically. Appended
  // because wire tokens are never reordered.
  'inv_sort',
  // Book of Deeds nameplate border selection, the sibling of 'deed_set_title'.
  // Appended rather than filed beside its twin because wire tokens are never
  // reordered.
  'deed_set_border',
  // The backward half of the Tab cycle (IWorldTargeting.tabTargetPrev): no
  // payload, the sim resolves the previous enemy in the same ordered list Tab
  // walks forward. Appended because wire tokens are never reordered.
  'tabPrev',
  // The Materials Vault: the per-material, gold-upgraded material store beside the
  // personal slot bank (src/sim/materials_vault.ts). Appended at the END because
  // wire tokens are never reordered, so these deliberately do NOT sit beside the
  // bank_* cluster they belong to by domain. `slot` is a carried-inventory index
  // and `count` optional (the bank_* wire idiom); withdraw is keyed by `itemId`
  // instead, because the vault has no slots to index. The Sim owns every gameplay
  // rule (banker proximity, material scope, per-material cap, exact copper).
  'vault_deposit',
  'vault_withdraw',
  'vault_buy_upgrade',
  // The vault's batched deposit-all sweep (Bank Storage Phase 03): ONE
  // server-side command, argument-free, so even a full carried sweep (112
  // slots at the phase 05 bag ceiling) costs one
  // command-lane token and one batched ledger write instead of a send per
  // slot. Appended at the END because wire tokens are never reordered.
  'vault_deposit_all',
  // Bank bag sockets (Bank Storage phase 07): the three socket commands the
  // phase 06 sim bodies gate (unlock in order for exact copper; socket a
  // CARRIED payload-free bag, `item` + optional integer `socket` + optional
  // integer `slot` naming the exact carried copy, the equip_bag wire shape
  // verbatim; unsocket by integer `socket`). Appended at the END because wire
  // tokens are never reordered, so these deliberately do NOT sit beside the
  // bank_* cluster they belong to by domain. The Sim owns every gameplay rule
  // (banker proximity, unlock order and price, the payload peek, the
  // carried-side unsocket fit); dispatch is shape-only in server/bank_wire.ts.
  'bank_unlock_socket',
  'bank_socket_bag',
  'bank_unsocket_bag',
  // The tutorial greeting's accept: the ferry ride to the Proving Shore
  // (IWorldQuests.startTutorial; sim/tutorial/greeting.ts re-validates level,
  // life, and band server-side). Appended because wire tokens are never
  // reordered.
  'tutorial_start',
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
  'dev_complete_quest',
  'dev_complete_all_quests',
  'enter_crypt',
  'leave_crypt',
  'social_refresh',
  'targetNearest',
  'dev_bg_start',
  // Riding-lesson leftovers: 'mount_train_answer' (the removed lean-cue arm) and
  // 'mount_train_abort' (the removed course minigame's cancel) no longer have a
  // ClientWorld sender, but the wire strings ARE the protocol (append-only), so
  // the server keeps dispatching them: answer as a no-op, abort as a session
  // abandon.
  'mount_train_answer',
  'mount_train_abort',
  'dev_profiler_invulnerable',
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
  | 'IWorldBattleground'
  | 'IWorldCardMinigame'
  | 'IWorldSocialGraph'
  | 'IWorldMarket'
  | 'IWorldMail'
  | 'IWorldDungeons'
  | 'IWorldDelves'
  | 'IWorldDailyRewards'
  | 'IWorldTelemetry'
  | 'IWorldBank'
  | 'IWorldGuildBank'
  | 'IWorldDungeonFinder'
  | 'IWorldActionBar'
  | 'IWorldDeeds'
  | 'IWorldReliquary'
  | 'IWorldMounts';

export const COMMAND_FACETS = {
  // IWorldCombat: ability casts, auto-attack, spirit release.
  cast: 'IWorldCombat',
  castSlot: 'IWorldCombat',
  castAt: 'IWorldCombat',
  releaseEmpowered: 'IWorldCombat',
  cancel_aura: 'IWorldCombat',
  attack: 'IWorldCombat',
  stopattack: 'IWorldCombat',
  release: 'IWorldCombat',
  unstuck: 'IWorldCombat',
  // Ghost resurrection: run the spirit to its corpse, or accept the Spirit Healer's
  // resurrection (with Resurrection Sickness). Wire strings are snake_case by design.
  resurrect_corpse: 'IWorldCombat',
  resurrect_healer: 'IWorldCombat',
  resurrect_respond: 'IWorldCombat',
  // IWorldTargeting: target selection + tab cycling.
  target: 'IWorldTargeting',
  tab: 'IWorldTargeting',
  tabPrev: 'IWorldTargeting',
  targetNearestFriendly: 'IWorldTargeting',
  tabFriendly: 'IWorldTargeting',
  stopAutoAttackOnTargetSwitch: 'IWorldTargeting',
  // IWorldLoot: need-greed roll submit.
  lootRoll: 'IWorldLoot',
  // IWorldInventory: non-fungible Rift gear progression. These mutate the
  // authoritative inventory copy; every cost and payload is validated again
  // in the sim before the item instance is changed. (salvage_item rides the
  // professions surface and, like the other enchanting-family commands, has
  // no facet row here.)
  rift_upgrade_item: 'IWorldInventory',
  rift_enchant_item: 'IWorldInventory',
  rift_socket_gem: 'IWorldInventory',
  // IWorldInventory: the one-shot bag clean-up; the sim re-derives the whole
  // arrangement, so there is no payload to validate.
  inv_sort: 'IWorldInventory',
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
  selectTalentRow: 'IWorldTalents',
  saveLoadout: 'IWorldTalents',
  switchLoadout: 'IWorldTalents',
  deleteLoadout: 'IWorldTalents',
  // IWorldCosmetics: skin + mech-chroma equips (snake_case wire strings, by design).
  change_skin: 'IWorldCosmetics',
  claim_event_skin: 'IWorldCosmetics',
  unequip_mech_chroma: 'IWorldCosmetics',
  change_weapon_skin: 'IWorldCosmetics',
  stow_weapon: 'IWorldCosmetics',
  set_helm: 'IWorldCosmetics',
  // IWorldPet: hunter-pet commands (snake_case wire strings, by design; pet state
  // mirrors on the owned-mob entity wire, not a self-snapshot field).
  pet_abandon: 'IWorldPet',
  pet_rename: 'IWorldPet',
  pet_revive: 'IWorldPet',
  pet_attack: 'IWorldPet',
  pet_water_jet: 'IWorldPet',
  pet_taunt: 'IWorldPet',
  pet_auto_taunt: 'IWorldPet',
  pet_auto_water_jet: 'IWorldPet',
  pet_special: 'IWorldPet',
  pet_auto_special: 'IWorldPet',
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
  ppromote: 'IWorldParty',
  praid: 'IWorldParty',
  punraid: 'IWorldParty',
  pmoveRaid: 'IWorldParty',
  setLootMaster: 'IWorldParty',
  masterAssign: 'IWorldParty',
  setMarker: 'IWorldParty',
  clearMarker: 'IWorldParty',
  readyrespond: 'IWorldParty',
  // IWorldTrade: peer-to-peer trade-window commands (tradeInfo is a snapshot read,
  // no send).
  trade_req: 'IWorldTrade',
  trade_accept: 'IWorldTrade',
  trade_offer: 'IWorldTrade',
  trade_confirm: 'IWorldTrade',
  trade_cancel: 'IWorldTrade',
  trade_close: 'IWorldTrade',
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
  // IWorldBattleground: the Thornhollow Fields queue + the deliberate flag action.
  bg_queue: 'IWorldBattleground',
  bg_leave: 'IWorldBattleground',
  bg_respond: 'IWorldBattleground',
  bg_flag: 'IWorldBattleground',
  // IWorldCardMinigame: the Card Duel minigame queue + in-match card plays.
  // cardMinigameInfo is a snapshot read (no send).
  card_queue_join: 'IWorldCardMinigame',
  card_queue_leave: 'IWorldCardMinigame',
  play_card: 'IWorldCardMinigame',
  card_forfeit: 'IWorldCardMinigame',
  // IWorldSocialGraph: friends/blocks/guild commands (online only; resolved
  // server-side by character name, handled by the #4 SocialService). socialInfo
  // arrives via the social/socialpos frames (no command); searchCharacters is a REST
  // GET (no wire command); accountFlair is a pure local read of the flair the entity
  // wire and the chat event already carry (no command); social_refresh is a
  // dispatch-only server push (untagged).
  friend_add: 'IWorldSocialGraph',
  friend_remove: 'IWorldSocialGraph',
  block_add: 'IWorldSocialGraph',
  block_remove: 'IWorldSocialGraph',
  ignore_add: 'IWorldSocialGraph',
  ignore_remove: 'IWorldSocialGraph',
  guild_create: 'IWorldSocialGraph',
  guild_invite: 'IWorldSocialGraph',
  guild_pledge: 'IWorldSocialGraph',
  guild_pledge_withdraw: 'IWorldSocialGraph',
  guild_pledge_decide: 'IWorldSocialGraph',
  guild_pledge_settings: 'IWorldSocialGraph',
  guild_accept: 'IWorldSocialGraph',
  guild_decline: 'IWorldSocialGraph',
  guild_leave: 'IWorldSocialGraph',
  guild_kick: 'IWorldSocialGraph',
  guild_promote: 'IWorldSocialGraph',
  guild_demote: 'IWorldSocialGraph',
  guild_transfer: 'IWorldSocialGraph',
  guild_disband: 'IWorldSocialGraph',
  guild_event_create: 'IWorldSocialGraph',
  guild_event_remove: 'IWorldSocialGraph',
  guild_set_motd: 'IWorldSocialGraph',
  // IWorldMarket: World Market browse/list/buy/cancel/collect (snake_case wire
  // strings, by design). marketInfo is a snapshot read (no send, untagged).
  market_search: 'IWorldMarket',
  lock_item: 'IWorldInventory',
  market_sell_price_check: 'IWorldMarket',
  market_list: 'IWorldMarket',
  market_list_instance: 'IWorldMarket',
  market_buy: 'IWorldMarket',
  market_cancel: 'IWorldMarket',
  market_collect: 'IWorldMarket',
  // IWorldMail: Ravenpost letters (snake_case wire strings, by design). mailInfo /
  // mailUnread are snapshot reads (no send, untagged).
  mail_send: 'IWorldMail',
  mail_take: 'IWorldMail',
  mail_delete: 'IWorldMail',
  mail_read: 'IWorldMail',
  // IWorldDungeons: dungeon enter/leave. raidLockouts is a snapshot-derived read
  // (no send, untagged). enter_crypt/leave_crypt are legacy dispatch-only aliases
  // (untagged; on the DISPATCH_ONLY_COMMANDS allowlist), NOT IWorldDungeons.
  enter_dungeon: 'IWorldDungeons',
  leave_dungeon: 'IWorldDungeons',
  set_dungeon_difficulty: 'IWorldDungeons',
  heroic_buy: 'IWorldDungeons',
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
  delve_rite_choose: 'IWorldDelves',
  // IWorldBank: the per-character deposit box (snake_case wire strings, by design).
  // bankInfo is a proximity-gated snapshot read (no send, untagged).
  bank_deposit: 'IWorldBank',
  bank_withdraw: 'IWorldBank',
  bank_buy_slots: 'IWorldBank',
  // The Materials Vault rides the SAME facet as the personal bank (same bursars,
  // same proximity gate); vaultInfo is a proximity-gated snapshot read (no send,
  // untagged), exactly like bankInfo above.
  vault_deposit: 'IWorldBank',
  vault_withdraw: 'IWorldBank',
  vault_buy_upgrade: 'IWorldBank',
  vault_deposit_all: 'IWorldBank',
  // The bank bag sockets ride the SAME facet again (same bursars, same
  // proximity gate; Bank Storage phase 07); the socket readouts ride the
  // bankInfo snapshot read above (no send, untagged).
  bank_unlock_socket: 'IWorldBank',
  bank_socket_bag: 'IWorldBank',
  bank_unsocket_bag: 'IWorldBank',
  // IWorldGuildBank: the officer-plus shared guild treasury + item store
  // (snake_case wire strings, by design; its OWN tokens, never a bank_* reuse).
  // guildBankInfo is a proximity + rank gated snapshot read (no send, untagged).
  guild_bank_deposit_gold: 'IWorldGuildBank',
  guild_bank_withdraw_gold: 'IWorldGuildBank',
  guild_bank_deposit: 'IWorldGuildBank',
  guild_bank_withdraw: 'IWorldGuildBank',
  guild_bank_buy_slots: 'IWorldGuildBank',
  guild_bank_log: 'IWorldGuildBank',
  // IWorldMounts: pick + mount/dismount (snake_case wire strings, by design).
  // The active mount is a self-snapshot read (terse `mnt`, no send, untagged);
  // summoning one is an item use (use_item), not a mount command.
  // mount_train_begin is the legacy riding-lesson entry point; its feedback
  // rides the mountTrain* events (no snapshot field).
  mount_toggle: 'IWorldMounts',
  mount_train_begin: 'IWorldMounts',
  // mount_race_start begins a show-jumping race from the glowing platform;
  // mount_race_cancel exits it. Both are validated server-side and feed the
  // mountRace* events.
  mount_race_start: 'IWorldMounts',
  mount_race_cancel: 'IWorldMounts',
  // learn_riding: purchase the riding skill from Marla (80g, once). No snapshot
  // field; the result rides the ridingTrained snapshot delta (mntRtd).
  learn_riding: 'IWorldMounts',
  // IWorldDungeonFinder: the group finder (snake_case wire strings, by design).
  // dungeonFinderInfo / dungeonFinderBoard are snapshot reads (no send, untagged).
  df_roles: 'IWorldDungeonFinder',
  df_queue: 'IWorldDungeonFinder',
  df_queue_leave: 'IWorldDungeonFinder',
  df_proposal: 'IWorldDungeonFinder',
  df_list_create: 'IWorldDungeonFinder',
  df_list_close: 'IWorldDungeonFinder',
  df_apply: 'IWorldDungeonFinder',
  df_apply_cancel: 'IWorldDungeonFinder',
  df_app_respond: 'IWorldDungeonFinder',
  // IWorldDeeds: the Book of Deeds cosmetic selections, title and nameplate
  // border (snake_case wire strings, by design).
  // deedsEarned/deedStats/renown/activeTitle/activeBorder are snapshot reads
  // (no send, untagged).
  deed_set_title: 'IWorldDeeds',
  deed_set_border: 'IWorldDeeds',
  // IWorldActionBar: the debounced action-bar layout upload. takeActionBarLayoutRestore
  // is a login-time read (no send, untagged).
  save_hotbar_layout: 'IWorldActionBar',
} as const satisfies Partial<Record<ClientCommand, WorldFacet>>;
